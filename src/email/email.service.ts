import { HttpException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AuthEmailType,
  EmailLanguage,
  renderAuthEmail,
} from './email.templates';

const RESEND_URL = 'https://api.resend.com/emails';
// Standard Webhooks tolerance; an older delivery is treated as a replay.
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;

/** Body Supabase posts to the Send Email Hook. */
export interface SendEmailHookPayload {
  user: {
    email: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

export interface WebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/**
 * The error shape Supabase Auth expects from a hook; it shows `message` to the
 * caller of `signUp` / `resetPasswordForEmail`.
 */
export const hookError = (status: number, message: string) =>
  new HttpException({ error: { http_code: status, message } }, status);

/**
 * Sends Supabase Auth's emails (sign-up confirmation, password reset) through
 * Resend. With the Send Email Hook enabled Supabase sends nothing itself, so
 * every type it hands us must either be sent here or fail loudly.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /**
   * Standard Webhooks verification: HMAC-SHA256 over `id.timestamp.body` with
   * the base64 secret Supabase shows as `v1,whsec_<secret>`.
   */
  verifySignature(
    rawBody: string,
    headers: WebhookHeaders,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): void {
    const secret = process.env.SEND_EMAIL_HOOK_SECRET;
    if (!secret) throw hookError(500, 'Send email hook is not configured');

    const { id, timestamp, signature } = headers;
    if (!id || !timestamp || !signature) {
      throw hookError(401, 'Missing webhook signature');
    }
    if (Math.abs(nowSeconds - Number(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS) {
      throw hookError(401, 'Webhook timestamp out of range');
    }

    const key = Buffer.from(secret.replace(/^v1,whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest();

    // The header may carry several space-separated `v1,<sig>` entries.
    const valid = signature.split(' ').some((entry) => {
      const [version, value] = entry.split(',');
      if (version !== 'v1' || !value) return false;
      const given = Buffer.from(value, 'base64');
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
    if (!valid) throw hookError(401, 'Invalid webhook signature');
  }

  async sendAuthEmail(
    payload: SendEmailHookPayload,
    idempotencyKey: string,
  ): Promise<void> {
    const { user, email_data: emailData } = payload;
    const type = emailData.email_action_type;
    if (type !== 'signup' && type !== 'recovery') {
      this.logger.error(`Unsupported auth email type: ${type}`);
      throw hookError(400, `Unsupported email type: ${type}`);
    }

    const email = renderAuthEmail(
      type,
      languageOf(user.user_metadata),
      verifyLink(type, emailData),
      emailData.token,
    );

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from)
      throw hookError(500, 'Email sending is not configured');

    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Supabase retries a hook that times out; the webhook id keeps a retry
        // from sending the same email twice.
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Resend error ${response.status}: ${detail}`);
      throw hookError(502, 'Could not send email');
    }
  }
}

/** Set by the app at sign-up as `options.data.language`; Czech otherwise. */
export function languageOf(metadata?: Record<string, unknown>): EmailLanguage {
  return metadata?.language === 'en' ? 'en' : 'cs';
}

/** Supabase's verify endpoint, which then redirects to `redirect_to`. */
export function verifyLink(
  type: AuthEmailType,
  emailData: SendEmailHookPayload['email_data'],
): string {
  const params = new URLSearchParams({
    token: emailData.token_hash,
    type,
    redirect_to: emailData.redirect_to || emailData.site_url,
  });
  return `${process.env.SUPABASE_URL}/auth/v1/verify?${params.toString()}`;
}

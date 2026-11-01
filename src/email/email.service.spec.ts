import { HttpException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  EmailService,
  languageOf,
  SendEmailHookPayload,
  verifyLink,
} from './email.service';

const SECRET_BYTES = Buffer.from('test-secret-for-the-send-email-hook');
const NOW = 1_800_000_000;

const sign = (id: string, timestamp: number, body: string) =>
  'v1,' +
  createHmac('sha256', SECRET_BYTES)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');

const payload = (
  type: string,
  metadata: Record<string, unknown> = {},
): SendEmailHookPayload => ({
  user: { email: 'a@example.com', user_metadata: metadata },
  email_data: {
    token: '123456',
    token_hash: 'hash',
    redirect_to: 'fitnessapp://auth-callback',
    email_action_type: type,
    site_url: 'https://site.example',
  },
});

const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as HttpException).getStatus();
  }
  return null;
};

describe('EmailService', () => {
  const service = new EmailService();
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      SEND_EMAIL_HOOK_SECRET: `v1,whsec_${SECRET_BYTES.toString('base64')}`,
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'App <noreply@example.com>',
      SUPABASE_URL: 'https://proj.supabase.co',
    };
  });
  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
  });

  describe('verifySignature', () => {
    const body = JSON.stringify(payload('signup'));

    it('accepts a valid signature', () => {
      const signature = sign('msg_1', NOW, body);
      expect(
        statusOf(() =>
          service.verifySignature(
            body,
            { id: 'msg_1', timestamp: String(NOW), signature },
            NOW,
          ),
        ),
      ).toBeNull();
    });

    it('accepts when one of several signatures matches', () => {
      const signature = `v1,bm9wZQ== ${sign('msg_1', NOW, body)}`;
      expect(
        statusOf(() =>
          service.verifySignature(
            body,
            { id: 'msg_1', timestamp: String(NOW), signature },
            NOW,
          ),
        ),
      ).toBeNull();
    });

    it('rejects a tampered body', () => {
      const signature = sign('msg_1', NOW, body);
      expect(
        statusOf(() =>
          service.verifySignature(
            body + ' ',
            { id: 'msg_1', timestamp: String(NOW), signature },
            NOW,
          ),
        ),
      ).toBe(401);
    });

    it('rejects an old timestamp', () => {
      const old = NOW - 10 * 60;
      const signature = sign('msg_1', old, body);
      expect(
        statusOf(() =>
          service.verifySignature(
            body,
            { id: 'msg_1', timestamp: String(old), signature },
            NOW,
          ),
        ),
      ).toBe(401);
    });

    it('rejects missing headers', () => {
      expect(statusOf(() => service.verifySignature(body, {}, NOW))).toBe(401);
    });
  });

  it('picks the language from user metadata, Czech by default', () => {
    expect(languageOf({ language: 'en' })).toBe('en');
    expect(languageOf({ language: 'de' })).toBe('cs');
    expect(languageOf(undefined)).toBe('cs');
  });

  it('builds the Supabase verify link', () => {
    const link = new URL(
      verifyLink('recovery', payload('recovery').email_data),
    );
    expect(link.origin + link.pathname).toBe(
      'https://proj.supabase.co/auth/v1/verify',
    );
    expect(link.searchParams.get('token')).toBe('hash');
    expect(link.searchParams.get('type')).toBe('recovery');
    expect(link.searchParams.get('redirect_to')).toBe(
      'fitnessapp://auth-callback',
    );
  });

  it('sends the English reset email through Resend', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await service.sendAuthEmail(
      payload('recovery', { language: 'en' }),
      'msg_1',
    );

    const [url, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'msg_1',
    );
    expect(sent.to).toEqual(['a@example.com']);
    expect(sent.subject).toBe('Reset your password');
    expect(sent.html).toContain('123456');
  });

  it('sends the Czech sign-up email by default', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await service.sendAuthEmail(payload('signup'), 'msg_2');

    const sent = JSON.parse(
      fetchMock.mock.calls[0][1]!.body as string,
    ) as Record<string, unknown>;
    expect(sent.subject).toBe('Potvrďte svou registraci');
  });

  it('fails on an unsupported email type instead of dropping it', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      service.sendAuthEmail(payload('magiclink'), 'msg_3'),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when Resend rejects the email', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('bad', { status: 422 }));
    await expect(
      service.sendAuthEmail(payload('signup'), 'msg_4'),
    ).rejects.toMatchObject({ status: 502 });
  });
});

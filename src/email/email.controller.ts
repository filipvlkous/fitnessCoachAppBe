import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { EmailService, hookError, SendEmailHookPayload } from './email.service';

/**
 * Supabase Auth's Send Email Hook. Public: the caller is Supabase, and the
 * webhook signature is the authentication.
 */
@ApiExcludeController()
@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('auth-hook')
  @HttpCode(200)
  async authHook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('webhook-id') id?: string,
    @Headers('webhook-timestamp') timestamp?: string,
    @Headers('webhook-signature') signature?: string,
  ): Promise<Record<string, never>> {
    // The signature covers the exact bytes Supabase sent, not re-serialized JSON.
    const rawBody = req.rawBody?.toString('utf8');
    if (!rawBody) throw hookError(400, 'Missing body');

    this.emailService.verifySignature(rawBody, { id, timestamp, signature });
    await this.emailService.sendAuthEmail(
      JSON.parse(rawBody) as SendEmailHookPayload,
      id as string,
    );
    return {};
  }
}

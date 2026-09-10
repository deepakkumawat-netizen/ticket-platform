import { Controller, Headers, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { IntakeService } from './intake.service';
import { verifySvixSignature } from './svix-verify';

// Public — no staff/customer auth guard, same as IntakePublicController.
// Trust here comes entirely from the Svix signature (verifySvixSignature),
// not from any session/token, since this is called by Resend's servers, not
// a browser. Requires `rawBody: true` on NestFactory.create (see main.ts) —
// signature verification needs the EXACT bytes Resend signed, which a
// parsed-then-re-stringified JSON body is not guaranteed to reproduce
// byte-for-byte.
@Controller('intake/webhooks')
export class IntakeWebhooksController {
  constructor(
    private intake: IntakeService,
    private config: ConfigService,
  ) {}

  @Post('inbound-email')
  async inboundEmail(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    const secret = this.config.get<string>('RESEND_INBOUND_WEBHOOK_SECRET');
    // Unlike every other optional integration in this codebase (Gemini,
    // Groq, SMTP, reCAPTCHA), there is no safe "no-op until configured"
    // behavior here — an unset secret would mean either rejecting every
    // real webhook anyway (no way to verify it) or, far worse, silently
    // trusting unsigned requests. Refuse outright instead.
    if (!secret) {
      throw new ServiceUnavailableException('Inbound email is not configured on this server');
    }
    if (!req.rawBody || !verifySvixSignature(req.rawBody, { svixId, svixTimestamp, svixSignature }, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = JSON.parse(req.rawBody.toString());
    return this.intake.handleInboundEmail(event);
  }
}

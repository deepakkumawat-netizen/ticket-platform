import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { lookup } from 'dns/promises';

// Thin wrapper so the rest of the app never touches an email provider
// directly. Mirrors GeminiService/GroqService's resilience shape: if the
// required config is missing, sendMail() logs and no-ops instead of
// throwing. Email is a nice-to-have on top of the in-app Notification row
// NotificationsService always writes first — a broken/unset email config
// must never take down an escalation.
//
// Two providers, tried in order:
//  1. Resend (RESEND_API_KEY) — a plain HTTPS API. Preferred (Deepak's
//     pick, 2026-08-31) because Render's free plan blocks outbound SMTP
//     entirely (ports 25/465/587) as of Sept 2025 — live-confirmed via a
//     persistent "Connection timeout" on every send no matter what else
//     was fixed. HTTPS isn't affected by that block at all.
//  2. SMTP (SMTP_HOST) — kept as a fallback for a future non-Render deploy
//     or a paid Render plan (which lifts the SMTP block), not for Render's
//     free plan today.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly resendApiKey?: string;
  private readonly resendFrom: string;
  private readonly host?: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from: string;

  constructor(private config: ConfigService) {
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY') || undefined;
    this.resendFrom = this.config.get<string>('RESEND_FROM') ?? 'onboarding@resend.dev';
    this.host = this.config.get<string>('SMTP_HOST') || undefined;
    this.port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    this.user = this.config.get<string>('SMTP_USER');
    this.pass = this.config.get<string>('SMTP_PASSWORD');
    this.from = this.config.get<string>('SMTP_FROM') ?? 'tickets@example.com';
  }

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    if (this.resendApiKey) {
      await this.sendViaResend(to, subject, text);
      return;
    }
    if (!this.host) {
      this.logger.log(`Email not configured — skipping email to ${to}: "${subject}"`);
      return;
    }
    try {
      const transport = await this.buildTransport(this.host);
      await transport.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      // Never let a mail-delivery failure surface as a 500 on the caller's
      // request (e.g. assigning/escalating a ticket) — this is best-effort.
      this.logger.warn(`Failed to send email to ${to} via SMTP: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Note for whoever hits this next: until RESEND_FROM's domain is verified
  // in Resend's dashboard, Resend will only actually deliver to the email
  // address the Resend account was signed up with — every other recipient
  // gets a clean-looking send that silently never arrives. Not something
  // this code can detect (Resend's API accepts the request either way).
  private async sendViaResend(to: string, subject: string, text: string) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.resendApiKey}` },
        body: JSON.stringify({ from: this.resendFrom, to, subject, text }),
      });
      if (!res.ok) {
        throw new Error(`Resend request failed (${res.status}): ${await res.text()}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to send email to ${to} via Resend: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Built fresh per send rather than cached on the instance — this is a
  // low-volume mailer (one ticket lifecycle event at a time), so the extra
  // lookup + transport construction is cheap, and it means a Gmail IP
  // change never sticks around for the process's whole lifetime.
  //
  // Render's outbound network can't route IPv6 (live-confirmed 2026-08-31:
  // "connect ENETUNREACH 2607:...:587" trying to reach Gmail). The
  // installed nodemailer resolves BOTH the A and AAAA records for the host
  // and connects to one picked at RANDOM (see its lib/shared/index.js
  // resolveHostname) — there's no supported option to force IPv4 in this
  // version (a plain `family` option is accepted by the types but silently
  // ignored by the actual connection code), so roughly half of all sends
  // picked an unreachable IPv6 address. Resolving the IPv4 address
  // ourselves and connecting to that literal IP sidesteps it entirely.
  // `servername` (real nodemailer supports it — see smtp-connection's SNI
  // handling — even though @types/nodemailer's Options type is stale and
  // doesn't declare it, hence the cast below) keeps TLS/SNI validating
  // against the real hostname instead of the raw IP. Falls back to the
  // plain hostname (nodemailer's own resolution) if no IPv4 address exists,
  // so an IPv6-only SMTP host still works exactly as before.
  private async buildTransport(configuredHost: string) {
    const options: Record<string, unknown> = {
      port: this.port,
      auth: { user: this.user, pass: this.pass },
    };
    try {
      const resolved = await lookup(configuredHost, { family: 4 });
      options.host = resolved.address;
      options.servername = configuredHost;
    } catch (err) {
      options.host = configuredHost;
      this.logger.warn(
        `Could not resolve an IPv4 address for ${configuredHost} — using default DNS resolution instead: ${err instanceof Error ? err.message : err}`,
      );
    }
    return nodemailer.createTransport(options as nodemailer.TransportOptions);
  }
}

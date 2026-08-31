import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { lookup } from 'dns/promises';

// Thin wrapper so the rest of the app never touches nodemailer directly.
// Mirrors GeminiService's resilience shape: if the required config is
// missing (SMTP_HOST unset — the default in .env.example), sendMail() logs
// and no-ops instead of throwing. Email is a nice-to-have on top of the
// in-app Notification row NotificationsService always writes first — a
// broken/unset SMTP config must never take down an escalation.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly host?: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from: string;

  constructor(private config: ConfigService) {
    this.host = this.config.get<string>('SMTP_HOST') || undefined;
    this.port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    this.user = this.config.get<string>('SMTP_USER');
    this.pass = this.config.get<string>('SMTP_PASSWORD');
    this.from = this.config.get<string>('SMTP_FROM') ?? 'tickets@example.com';
  }

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    if (!this.host) {
      this.logger.log(`SMTP not configured — skipping email to ${to}: "${subject}"`);
      return;
    }
    try {
      const transport = await this.buildTransport(this.host);
      await transport.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      // Never let a mail-delivery failure surface as a 500 on the caller's
      // request (e.g. assigning/escalating a ticket) — this is best-effort.
      this.logger.warn(`Failed to send email to ${to}: ${err instanceof Error ? err.message : err}`);
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

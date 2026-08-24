import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Thin wrapper so the rest of the app never touches nodemailer directly.
// Mirrors GeminiService's resilience shape: if the required config is
// missing (SMTP_HOST unset — the default in .env.example), sendMail() logs
// and no-ops instead of throwing. Email is a nice-to-have on top of the
// in-app Notification row NotificationsService always writes first — a
// broken/unset SMTP config must never take down an escalation.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transport: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('SMTP_FROM') ?? 'tickets@example.com';
    if (host) {
      this.transport = nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('SMTP_PORT') ?? '587'),
        auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASSWORD') },
      });
    }
  }

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) {
      this.logger.log(`SMTP not configured — skipping email to ${to}: "${subject}"`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      // Never let a mail-delivery failure surface as a 500 on the caller's
      // request (e.g. assigning/escalating a ticket) — this is best-effort.
      this.logger.warn(`Failed to send email to ${to}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

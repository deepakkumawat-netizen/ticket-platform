import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Google reCAPTCHA v3 verification — invisible to the user, scores how
// "human" the request looked (0 = definitely a bot, 1 = definitely human).
// Same resilience shape as GeminiService/MailerService: if
// RECAPTCHA_SECRET_KEY isn't configured yet, verify() no-ops (passes)
// instead of locking everyone out of login before Deepak finishes setting
// it up — see .env.example.
@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  constructor(private config: ConfigService) {}

  private get secretKey(): string | undefined {
    return this.config.get<string>('RECAPTCHA_SECRET_KEY');
  }

  private get minScore(): number {
    return Number(this.config.get<string>('RECAPTCHA_MIN_SCORE') ?? '0.5');
  }

  /** Throws UnauthorizedException if the token is missing/invalid/too
   * bot-like, or if `action` doesn't match what the frontend requested the
   * token for (stops a token minted for one action being replayed on another). */
  async verify(token: string | undefined, action: string): Promise<void> {
    const secret = this.secretKey;
    if (!secret) return; // not configured yet — see class comment

    if (!token) {
      throw new UnauthorizedException('Bot check failed — please reload the page and try again');
    }

    try {
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }),
      });
      const body = await res.json();
      const passed = body.success === true && body.action === action && (typeof body.score !== 'number' || body.score >= this.minScore);
      if (!passed) {
        this.logger.warn(`reCAPTCHA rejected an attempt: ${JSON.stringify(body)}`);
        throw new UnauthorizedException('Bot check failed — please reload the page and try again');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Google's endpoint itself being unreachable shouldn't lock out real
      // users — log it and let the request through, same as any other
      // third-party outage in this codebase degrades to "skip, don't break."
      this.logger.warn(`reCAPTCHA verification unreachable, allowing through: ${err instanceof Error ? err.message : err}`);
    }
  }
}

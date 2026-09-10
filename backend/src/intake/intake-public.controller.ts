import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RecaptchaService } from '../auth/recaptcha.service';
import { IntakeService } from './intake.service';
import { CreateIntakeQueryDto } from './dto/create-intake-query.dto';

// Same throttle shape as staff-auth.controller.ts's AUTH_THROTTLE — this is
// the other genuinely public, unauthenticated route in the app, so it gets
// the same brute-force/spam-blunting treatment.
const INTAKE_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

// No auth guard at all — a website visitor with no account submits a query
// here. It never becomes a Ticket directly (see IntakeQuery's schema
// comment); a human always reviews and converts it via
// IntakeAdminController below.
@Controller('intake/queries')
export class IntakePublicController {
  constructor(
    private intake: IntakeService,
    private recaptcha: RecaptchaService,
  ) {}

  @Post()
  @Throttle(INTAKE_THROTTLE)
  async create(@Body() dto: CreateIntakeQueryDto) {
    await this.recaptcha.verify(dto.captchaToken, 'intake_query');
    await this.intake.createFromWebForm(dto);
    // Deliberately don't echo back the AI classification/reasoning or
    // internal id to an anonymous caller — nothing for them to act on, and
    // no reason to expose either.
    return { ok: true as const, message: "Thanks — we've received your message and will get back to you soon." };
  }
}

import { Body, Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
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
    private config: ConfigService,
  ) {}

  @Post()
  @Throttle(INTAKE_THROTTLE)
  async create(@Body() dto: CreateIntakeQueryDto) {
    // Switched off by default (2026-09-15, Deepak's ask) — there's no public
    // website pointing at this endpoint right now. Nothing else about this
    // feature was touched (frontend pages, this whole module, the DB table
    // all still exist) — set PUBLIC_INTAKE_ENABLED=true to turn it back on,
    // and re-add the /contact route + Intake Queue sidebar link (see
    // frontend/src/App.tsx's routing comment).
    if (this.config.get<string>('PUBLIC_INTAKE_ENABLED') !== 'true') {
      throw new ServiceUnavailableException('This intake channel is not currently accepting submissions');
    }
    await this.intake.createFromWebForm(dto);
    // Deliberately don't echo back the AI classification/reasoning or
    // internal id to an anonymous caller — nothing for them to act on, and
    // no reason to expose either.
    return { ok: true as const, message: "Thanks — we've received your message and will get back to you soon." };
  }
}

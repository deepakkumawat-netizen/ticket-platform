import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Apply to every staff-only route (@UseGuards(StaffAuthGuard)). Delegates to
// the 'jwt-staff' Passport strategy, which itself rejects a token whose
// principalType isn't STAFF — see staff-jwt.strategy.ts.
@Injectable()
export class StaffAuthGuard extends AuthGuard('jwt-staff') {}

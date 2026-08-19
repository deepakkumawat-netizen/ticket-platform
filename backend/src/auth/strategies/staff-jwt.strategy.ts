import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrincipalType } from '@ticket-platform/shared';
import { StaffJwtPayload } from '../jwt-payload.interface';

// Registered under the 'jwt-staff' Passport strategy name (see StaffAuthGuard).
@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, 'jwt-staff') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Runs after signature/expiry verification. Rejecting here on a wrong
  // principalType is what makes a customer-issued token unusable on any
  // staff route, even if someone tried to hand-craft the claims.
  validate(payload: StaffJwtPayload): StaffJwtPayload {
    if (payload.principalType !== PrincipalType.STAFF) {
      throw new UnauthorizedException('Not a staff token');
    }
    return payload;
  }
}

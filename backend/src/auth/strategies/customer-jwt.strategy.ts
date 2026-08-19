import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrincipalType } from '@ticket-platform/shared';
import { CustomerJwtPayload } from '../jwt-payload.interface';

// Registered under the 'jwt-customer' Passport strategy name (see CustomerAuthGuard).
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, 'jwt-customer') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Same signing secret as staff for v1 simplicity — the claim check
      // below (not a different secret) is what enforces the boundary.
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: CustomerJwtPayload): CustomerJwtPayload {
    if (payload.principalType !== PrincipalType.CUSTOMER) {
      throw new UnauthorizedException('Not a customer token');
    }
    return payload;
  }
}

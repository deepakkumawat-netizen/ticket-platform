import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrincipalType } from '@ticket-platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerJwtPayload } from '../jwt-payload.interface';

// Registered under the 'jwt-customer' Passport strategy name (see CustomerAuthGuard).
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, 'jwt-customer') {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Same signing secret as staff for v1 simplicity — the claim check
      // below (not a different secret) is what enforces the boundary.
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Mirrors StaffJwtStrategy.validate() (see that file's comment for why):
  // re-checks the DB on every request so a deactivated customer is rejected
  // on its very next request instead of staying valid for the rest of the
  // access token's life. This was previously missing here — a deactivated
  // customer kept full portal access until their token naturally expired.
  async validate(payload: CustomerJwtPayload): Promise<CustomerJwtPayload> {
    if (payload.principalType !== PrincipalType.CUSTOMER) {
      throw new UnauthorizedException('Not a customer token');
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
    if (!customer || !customer.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }
    return payload;
  }
}

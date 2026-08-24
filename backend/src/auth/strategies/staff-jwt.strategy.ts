import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrincipalType } from '@ticket-platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffJwtPayload } from '../jwt-payload.interface';

// Registered under the 'jwt-staff' Passport strategy name (see StaffAuthGuard).
@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, 'jwt-staff') {
  constructor(private prisma: PrismaService, config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Runs after signature/expiry verification, on every request. Rejecting
  // here on a wrong principalType is what makes a customer-issued token
  // unusable on any staff route, even if someone tried to hand-craft the
  // claims. The extra DB lookup also closes the gap the access token's long
  // TTL (8h, no refresh flow) would otherwise leave open: a deactivated or
  // role-changed account is rejected on its very next request instead of
  // staying valid for the rest of the token's life. Role/departmentId are
  // re-read fresh from the DB rather than trusted from the token, so a role
  // change (e.g. demotion) takes effect immediately, not after re-login.
  async validate(payload: StaffJwtPayload): Promise<StaffJwtPayload> {
    if (payload.principalType !== PrincipalType.STAFF) {
      throw new UnauthorizedException('Not a staff token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }
    return { ...payload, role: user.role, departmentId: user.departmentId };
  }
}

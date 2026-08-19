import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthMethod, PrincipalType } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerJwtPayload, StaffJwtPayload } from './jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async validateStaff(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credentials: { where: { method: AuthMethod.LOCAL_PASSWORD } } },
    });
    const cred = user?.credentials[0];
    if (!user || !user.isActive || !cred?.passwordHash || !(await argon2.verify(cred.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  issueStaffTokens(user: { id: string; role: string; departmentId: string | null; orgId: string }) {
    const payload: StaffJwtPayload = {
      sub: user.id,
      principalType: PrincipalType.STAFF,
      role: user.role as StaffJwtPayload['role'],
      departmentId: user.departmentId,
      orgId: user.orgId,
    };
    return this.signPair(payload);
  }

  async validateCustomer(email: string, password: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { email },
      include: { credentials: { where: { method: AuthMethod.LOCAL_PASSWORD } } },
    });
    const cred = customer?.credentials[0];
    if (
      !customer ||
      !customer.isActive ||
      !cred?.passwordHash ||
      !(await argon2.verify(cred.passwordHash, password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return customer;
  }

  issueCustomerTokens(customer: { id: string; companyId: string | null; orgId: string }) {
    const payload: CustomerJwtPayload = {
      sub: customer.id,
      principalType: PrincipalType.CUSTOMER,
      companyId: customer.companyId,
      orgId: customer.orgId,
    };
    return this.signPair(payload);
  }

  private signPair(payload: StaffJwtPayload | CustomerJwtPayload) {
    // Refresh-token revocation (Redis-backed, per the plan) lands with the
    // sessions module — v1 issues a long-lived-ish access token only so the
    // rest of Phase 0 (RBAC, low-code engine, tickets) isn't blocked on it.
    const accessToken = this.jwt.sign(payload);
    return { accessToken };
  }

  static async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain);
  }
}

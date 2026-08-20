import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthMethod, PrincipalType, StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerJwtPayload, StaffJwtPayload } from './jwt-payload.interface';
import { SignupDto } from './dto/signup.dto';

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

  // Public self-signup — deliberately EMPLOYEE only. An open signup form
  // that could mint an AGENT/DEPT_ADMIN/SUPER_ADMIN account would be a real
  // privilege-escalation hole; EMPLOYEE is safe to self-serve because it can
  // only ever touch its own tickets (see StaffRole in @ticket-platform/shared
  // and the EMPLOYEE carve-outs across tickets/departments/ticket-types).
  // Single-org assumption: this app has never had more than the one seeded
  // Organization, so signup just attaches to whichever org exists rather
  // than asking the person to pick/create one.
  async signupEmployee(dto: SignupDto) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('An account with this email already exists');
    }
    const org = await this.prisma.organization.findFirstOrThrow();
    const user = await this.prisma.user.create({
      data: { orgId: org.id, email: dto.email, name: dto.name, role: StaffRole.EMPLOYEE, departmentId: null },
    });
    await this.prisma.authCredential.create({
      data: { userId: user.id, method: AuthMethod.LOCAL_PASSWORD, passwordHash: await argon2.hash(dto.password) },
    });
    return { ...this.issueStaffTokens(user), user: { id: user.id, email: user.email, name: user.name, role: user.role, departmentId: user.departmentId } };
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

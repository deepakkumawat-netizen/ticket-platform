import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { AuthMethod, StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Admin-only onboarding: there's no self-signup, and no email delivery in
  // this v1, so a SUPER_ADMIN creates every login (including EMPLOYEE
  // accounts) and relays the generated password out-of-band. See
  // users.controller.ts for the @Roles(SUPER_ADMIN) guard.
  async create(orgId: string, dto: CreateUserDto) {
    const needsDepartment = dto.role === StaffRole.DEPT_ADMIN || dto.role === StaffRole.AGENT;
    if (needsDepartment && !dto.departmentId) {
      throw new BadRequestException(`${dto.role} accounts need a departmentId`);
    }
    if (!needsDepartment && dto.departmentId) {
      throw new BadRequestException(`${dto.role} accounts aren't scoped to a department — omit departmentId`);
    }
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: dto.departmentId, orgId } });
      if (!dept) throw new BadRequestException('Department not found');
    }
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('A user with this email already exists');
    }

    const password = dto.password ?? randomBytes(9).toString('base64url');
    const user = await this.prisma.user.create({
      data: { orgId, email: dto.email, name: dto.name, role: dto.role, departmentId: dto.departmentId ?? null },
    });
    await this.prisma.authCredential.create({
      data: { userId: user.id, method: AuthMethod.LOCAL_PASSWORD, passwordHash: await argon2.hash(password) },
    });

    // temporaryPassword is only ever present in THIS response — it isn't
    // stored anywhere in plaintext and can't be recovered afterward.
    return { id: user.id, email: user.email, name: user.name, role: user.role, departmentId: user.departmentId, temporaryPassword: password };
  }

  // Active staff in one department — feeds the ticket assignee dropdown and
  // the dashboard's agent-workload labels. Controller already enforces the
  // caller can see this department (assertDepartmentAccess).
  listByDepartment(departmentId: string) {
    return this.prisma.user.findMany({
      where: { departmentId, isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  // Org-wide staff search — feeds the "who is this ticket for" requester
  // picker on ticket creation for an internal-helpdesk setup, where the
  // requester is a colleague, not an external Customer. Deliberately not
  // department-scoped: an employee in Sales can raise a ticket that TECH
  // will work, so the requester search must see across the whole org.
  search(orgId: string, query?: string) {
    return this.prisma.user.findMany({
      where: {
        orgId,
        isActive: true,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { email: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true, role: true, departmentId: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }
}

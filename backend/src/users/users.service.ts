import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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

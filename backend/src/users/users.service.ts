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
}

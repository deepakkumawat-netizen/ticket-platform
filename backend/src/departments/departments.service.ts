import { Injectable } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  // SUPER_ADMIN sees every department, including inactive ones (needed for
  // the cross-department dashboard and for onboarding the next department).
  // EMPLOYEE sees every LIVE department org-wide (they're not scoped to any
  // one department — they need to pick which one to raise a self-service
  // ticket against). Everyone else (DEPT_ADMIN, AGENT) only sees their own.
  list(staff: StaffJwtPayload) {
    if (staff.role === StaffRole.SUPER_ADMIN) {
      return this.prisma.department.findMany({ where: { orgId: staff.orgId } });
    }
    if (staff.role === StaffRole.EMPLOYEE) {
      return this.prisma.department.findMany({ where: { orgId: staff.orgId, isActive: true } });
    }
    return this.prisma.department.findMany({ where: { id: staff.departmentId ?? '' } });
  }

  update(id: string, dto: UpdateDepartmentDto) {
    return this.prisma.department.update({ where: { id }, data: dto });
  }
}

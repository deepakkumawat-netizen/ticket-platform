import { Injectable } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  // SUPER_ADMIN sees every department (needed for the cross-department
  // dashboard and for onboarding the next department); everyone else only
  // ever sees their own.
  list(staff: StaffJwtPayload) {
    const where = staff.role === StaffRole.SUPER_ADMIN ? { orgId: staff.orgId } : { id: staff.departmentId ?? '' };
    return this.prisma.department.findMany({ where });
  }

  update(id: string, dto: UpdateDepartmentDto) {
    return this.prisma.department.update({ where: { id }, data: dto });
  }
}

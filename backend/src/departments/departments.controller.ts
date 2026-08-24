import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { DepartmentsService } from './departments.service';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@UseGuards(StaffAuthGuard, RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private departments: DepartmentsService) {}

  @Get()
  list(@CurrentStaff() staff: StaffJwtPayload) {
    return this.departments.list(staff);
  }

  // Flipping isActive live is the literal "go live" moment for a department
  // in the phased rollout (Tech first, then Operations, ...) — SUPER_ADMIN only.
  @Patch(':id')
  @Roles(StaffRole.SUPER_ADMIN)
  update(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(id, dto, staff.sub);
  }
}

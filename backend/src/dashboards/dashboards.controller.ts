import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { DashboardsService } from './dashboards.service';

@UseGuards(StaffAuthGuard, RolesGuard)
@Controller()
export class DashboardsController {
  constructor(private dashboards: DashboardsService) {}

  @Get('departments/:departmentId/dashboard')
  get(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string) {
    assertDepartmentAccess(staff, departmentId);
    return this.dashboards.getDashboard(departmentId);
  }
}

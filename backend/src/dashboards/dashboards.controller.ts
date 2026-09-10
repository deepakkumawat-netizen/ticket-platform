import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
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

  // The CEO/cross-department view — every active department's stats in one
  // screen, instead of picking one at a time from a dropdown. Explicit
  // @Roles here even though RolesGuard already lets SUPER_ADMIN through any
  // check — this documents the intent (CEO-only) rather than relying on
  // that implicit bypass alone.
  @Get('dashboards/org')
  @Roles(StaffRole.SUPER_ADMIN)
  getOrg(@CurrentStaff() staff: StaffJwtPayload) {
    return this.dashboards.getOrgDashboard(staff.orgId);
  }
}

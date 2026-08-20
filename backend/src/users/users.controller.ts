import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { UsersService } from './users.service';

// Read-only: no @Roles restriction — any authenticated staff member in the
// department (or SUPER_ADMIN anywhere) can list its agents, since this is
// just "who can I assign this ticket to", not an admin surface.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller()
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('departments/:departmentId/users')
  list(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string) {
    assertDepartmentAccess(staff, departmentId);
    return this.users.listByDepartment(departmentId);
  }

  // Org-wide — see UsersService.search for why this isn't department-scoped.
  @Get('users')
  search(@CurrentStaff() staff: StaffJwtPayload, @Query('q') query?: string) {
    return this.users.search(staff.orgId, query);
  }
}

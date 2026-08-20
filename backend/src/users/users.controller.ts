import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

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

  // Onboarding: the only way a login gets created in this v1 (no
  // self-signup). SUPER_ADMIN only — see UsersService.create for the
  // per-role departmentId rules.
  @Post('users')
  @Roles(StaffRole.SUPER_ADMIN)
  create(@CurrentStaff() staff: StaffJwtPayload, @Body() dto: CreateUserDto) {
    return this.users.create(staff.orgId, dto);
  }
}

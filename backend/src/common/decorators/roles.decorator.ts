import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';

export const ROLES_KEY = 'roles';

// @Roles(StaffRole.DEPT_ADMIN, StaffRole.SUPER_ADMIN) on a staff route,
// enforced by RolesGuard below. Must be combined with StaffAuthGuard (which
// runs first and populates request.principal).
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

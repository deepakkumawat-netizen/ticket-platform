import { ForbiddenException } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffJwtPayload, CustomerJwtPayload } from '../auth/jwt-payload.interface';

// These are the two functions every ticket/comment/attachment query MUST run
// its `where` clause through. Deliberately explicit (called at the top of
// each service method) rather than an interceptor silently rewriting query
// objects — for a security boundary this important, "grep for
// departmentScopeWhere/customerScopeWhere" should find every place scoping
// is applied, with nothing implicit.

/** SUPER_ADMIN sees the whole org; everyone else is pinned to their own department. */
export function departmentScopeWhere(staff: StaffJwtPayload): { departmentId?: string } {
  if (staff.role === StaffRole.SUPER_ADMIN) return {};
  return { departmentId: staff.departmentId ?? '__no_department__' };
}

/** A B2B contact sees their whole company's tickets; a standalone B2C
 * customer sees only their own. Never both. */
export function customerScopeWhere(customer: CustomerJwtPayload): { companyId: string } | { customerId: string } {
  if (customer.companyId) return { companyId: customer.companyId };
  return { customerId: customer.sub };
}

/** Same shape as departmentScopeWhere, keyed on an IntakeQuery's routing
 * suggestion rather than a ticket's real department — a query nobody's
 * department has claimed yet (suggestedDepartmentId null) is visible only to
 * SUPER_ADMIN, mirroring "no signal either way" elsewhere in this file. */
export function intakeQueryScopeWhere(staff: StaffJwtPayload): { suggestedDepartmentId?: string } {
  if (staff.role === StaffRole.SUPER_ADMIN) return {};
  return { suggestedDepartmentId: staff.departmentId ?? '__no_department__' };
}

/** Throws unless `staff` is allowed to act on `departmentId` — SUPER_ADMIN
 * always is; everyone else must belong to that exact department. Call this
 * at the top of any controller action scoped by a :departmentId route param
 * (route-param scoping can't be expressed as a Prisma `where` clause the way
 * departmentScopeWhere() is for list/query endpoints). */
export function assertDepartmentAccess(staff: StaffJwtPayload, departmentId: string): void {
  if (staff.role === StaffRole.SUPER_ADMIN) return;
  if (staff.departmentId !== departmentId) {
    throw new ForbiddenException("You don't have access to this department");
  }
}

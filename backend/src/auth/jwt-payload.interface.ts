import { PrincipalType, StaffRole } from '@ticket-platform/shared';

// The hard boundary between the staff app and the customer portal: every JWT
// this system issues carries `principalType`, and each Passport strategy
// below refuses to validate a token whose principalType doesn't match what
// it expects — a customer token can never satisfy a staff-only route by
// accident, and vice versa.
export interface StaffJwtPayload {
  sub: string; // User.id
  principalType: typeof PrincipalType.STAFF;
  role: StaffRole;
  departmentId: string | null; // null only for SUPER_ADMIN
  orgId: string;
}

export interface CustomerJwtPayload {
  sub: string; // Customer.id
  principalType: typeof PrincipalType.CUSTOMER;
  companyId: string | null; // null => standalone B2C customer
  orgId: string;
}

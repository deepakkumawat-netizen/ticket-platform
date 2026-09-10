import { ForbiddenException } from '@nestjs/common';
import { PrincipalType, StaffRole } from '@ticket-platform/shared';
import { assertDepartmentAccess, customerScopeWhere, departmentScopeWhere, intakeQueryScopeWhere } from './scope';
import { StaffJwtPayload, CustomerJwtPayload } from '../auth/jwt-payload.interface';

// These are the exact functions every ticket/comment/attachment query must
// run through — the RBAC/multi-tenant boundary the whole plan depends on.
// If these are wrong, a customer sees another company's tickets, or an
// Agent sees another department's queue.

const superAdmin: StaffJwtPayload = {
  sub: 'u-super',
  principalType: PrincipalType.STAFF,
  role: StaffRole.SUPER_ADMIN,
  departmentId: null,
  orgId: 'org-1',
};

const techAgent: StaffJwtPayload = {
  sub: 'u-agent',
  principalType: PrincipalType.STAFF,
  role: StaffRole.AGENT,
  departmentId: 'dept-tech',
  orgId: 'org-1',
};

describe('departmentScopeWhere', () => {
  it('lets SUPER_ADMIN see every department (no filter)', () => {
    expect(departmentScopeWhere(superAdmin)).toEqual({});
  });

  it('pins a non-super-admin staff member to their own department', () => {
    expect(departmentScopeWhere(techAgent)).toEqual({ departmentId: 'dept-tech' });
  });
});

describe('assertDepartmentAccess', () => {
  it('allows SUPER_ADMIN into any department', () => {
    expect(() => assertDepartmentAccess(superAdmin, 'dept-ops')).not.toThrow();
  });

  it('allows a staff member into their own department', () => {
    expect(() => assertDepartmentAccess(techAgent, 'dept-tech')).not.toThrow();
  });

  it('blocks a staff member from a department that is not theirs', () => {
    expect(() => assertDepartmentAccess(techAgent, 'dept-ops')).toThrow(ForbiddenException);
  });
});

describe('customerScopeWhere', () => {
  it('scopes a B2B contact to their whole company, not just themselves', () => {
    const b2bContact: CustomerJwtPayload = {
      sub: 'cust-1',
      principalType: PrincipalType.CUSTOMER,
      companyId: 'company-acme',
      orgId: 'org-1',
    };
    expect(customerScopeWhere(b2bContact)).toEqual({ companyId: 'company-acme' });
  });

  it('scopes a standalone B2C customer to only their own tickets', () => {
    const b2cCustomer: CustomerJwtPayload = {
      sub: 'cust-2',
      principalType: PrincipalType.CUSTOMER,
      companyId: null,
      orgId: 'org-1',
    };
    expect(customerScopeWhere(b2cCustomer)).toEqual({ customerId: 'cust-2' });
  });
});

describe('intakeQueryScopeWhere', () => {
  it('lets SUPER_ADMIN see every intake query (no filter)', () => {
    expect(intakeQueryScopeWhere(superAdmin)).toEqual({});
  });

  it('scopes a non-super-admin staff member to queries suggested for their own department', () => {
    expect(intakeQueryScopeWhere(techAgent)).toEqual({ suggestedDepartmentId: 'dept-tech' });
  });
});

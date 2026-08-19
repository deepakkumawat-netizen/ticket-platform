import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthMethod, PrincipalType, StaffRole } from '@ticket-platform/shared';
import { AuthService } from './auth.service';

// "Custom login for testing" — exercises both login flows (staff + portal)
// against a real argon2 hash/verify and a real JwtService (test secret), so
// this proves the actual login mechanism works, not just that it compiles.
// PrismaService is the only thing mocked (no DB needed for this).

describe('AuthService (login)', () => {
  let prisma: { user: { findUnique: jest.Mock }; customer: { findUnique: jest.Mock } };
  let jwt: JwtService;
  let auth: AuthService;
  const plainPassword = 'CorrectHorseBattery1!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(plainPassword);
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() }, customer: { findUnique: jest.fn() } };
    jwt = new JwtService({ secret: 'test-secret' });
    auth = new AuthService(prisma as any, jwt);
  });

  describe('staff login', () => {
    // Built inside beforeEach, not as a describe-body const — a plain const
    // here would capture `passwordHash` while it's still undefined (describe
    // callbacks run during Jest's collection phase, before beforeAll
    // resolves), silently turning every "correct password" case into a
    // false failure. Caught by actually running this suite.
    let activeUser: any;
    beforeEach(() => {
      activeUser = {
        id: 'user-1',
        email: 'admin@codevidhya.com',
        isActive: true,
        role: StaffRole.DEPT_ADMIN,
        departmentId: 'dept-tech',
        orgId: 'org-1',
        credentials: [{ method: AuthMethod.LOCAL_PASSWORD, passwordHash }],
      };
    });

    it('accepts the correct password and returns the user', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      const result = await auth.validateStaff('admin@codevidhya.com', plainPassword);
      expect(result).toBe(activeUser);
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      await expect(auth.validateStaff('admin@codevidhya.com', 'WrongPassword!')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(auth.validateStaff('nobody@codevidhya.com', plainPassword)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a deactivated user even with the correct password', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });
      await expect(auth.validateStaff('admin@codevidhya.com', plainPassword)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a token whose principalType is STAFF and carries the role/department', () => {
      const { accessToken } = auth.issueStaffTokens(activeUser);
      const decoded = jwt.decode(accessToken) as any;
      expect(decoded.principalType).toBe(PrincipalType.STAFF);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.role).toBe(StaffRole.DEPT_ADMIN);
      expect(decoded.departmentId).toBe('dept-tech');
    });
  });

  describe('customer portal login', () => {
    let activeCustomer: any;
    beforeEach(() => {
      activeCustomer = {
        id: 'cust-1',
        email: 'buyer@client.com',
        isActive: true,
        companyId: 'company-acme',
        orgId: 'org-1',
        credentials: [{ method: AuthMethod.LOCAL_PASSWORD, passwordHash }],
      };
    });

    it('accepts the correct password and returns the customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer);
      const result = await auth.validateCustomer('buyer@client.com', plainPassword);
      expect(result).toBe(activeCustomer);
    });

    it('rejects a wrong password', async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer);
      await expect(auth.validateCustomer('buyer@client.com', 'nope')).rejects.toThrow(UnauthorizedException);
    });

    it('issues a token whose principalType is CUSTOMER, never STAFF', () => {
      const { accessToken } = auth.issueCustomerTokens(activeCustomer);
      const decoded = jwt.decode(accessToken) as any;
      expect(decoded.principalType).toBe(PrincipalType.CUSTOMER);
      expect(decoded.companyId).toBe('company-acme');
      expect(decoded.role).toBeUndefined();
    });
  });
});

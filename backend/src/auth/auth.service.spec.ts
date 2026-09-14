import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthMethod, PrincipalType, StaffRole } from '@ticket-platform/shared';
import { AuthService } from './auth.service';

// "Custom login for testing" — exercises both login flows (staff + portal)
// against a real argon2 hash/verify and a real JwtService (test secret), so
// this proves the actual login mechanism works, not just that it compiles.
// PrismaService is the only thing mocked (no DB needed for this).

describe('AuthService (login)', () => {
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock }; customer: { findUnique: jest.Mock }; organization: { findFirstOrThrow: jest.Mock }; authCredential: { create: jest.Mock } };
  let jwt: JwtService;
  let config: { get: jest.Mock };
  let auth: AuthService;
  const plainPassword = 'CorrectHorseBattery1!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(plainPassword);
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      customer: { findUnique: jest.fn() },
      organization: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      authCredential: { create: jest.fn() },
    };
    jwt = new JwtService({ secret: 'test-secret' });
    config = { get: jest.fn().mockReturnValue(undefined) }; // undefined => default domain, codevidhya.com
    auth = new AuthService(prisma as any, jwt, config as any);
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

    // Without normalizing the lookup, a user who typed a different case at
    // signup than at login would get a false "Invalid email or password" —
    // the stored row and the login attempt must agree on casing.
    it('logs in with a different case than the email was stored in', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser); // stored as all-lowercase
      await auth.validateStaff('Admin@CodeVidhya.com', plainPassword);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'admin@codevidhya.com' } }));
    });

    it('hashes the supplied password even when no account exists, so a nonexistent-email login is not measurably faster', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      // Spy on the raw CJS module (not the `import * as argon2` binding
      // above) — ts-jest's namespace-import wrapper defines getter-only,
      // non-configurable properties that jest.spyOn can't redefine, but it
      // forwards to this same underlying module object, so spying here is
      // still observed by auth.service.ts's own `import * as argon2`.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rawArgon2 = require('argon2');
      const hashSpy = jest.spyOn(rawArgon2, 'hash');
      await expect(auth.validateStaff('nobody@codevidhya.com', 'whatever')).rejects.toThrow(UnauthorizedException);
      expect(hashSpy).toHaveBeenCalledWith('whatever');
      hashSpy.mockRestore();
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

  // Email uniqueness alone stops the SAME address signing up twice, but not
  // someone registering a second identity under a different personal email
  // with a different name — this domain check is what actually closes that.
  describe('signupEmployee — company-domain restriction', () => {
    it('rejects a personal email domain (e.g. Gmail)', async () => {
      await expect(auth.signupEmployee({ name: 'Ramesh', email: 'ramesh@gmail.com', password: 'Password123!' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('accepts the default company domain (codevidhya.com)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'ramesh@codevidhya.com',
        name: 'Ramesh',
        role: StaffRole.EMPLOYEE,
        departmentId: null,
        orgId: 'org-1',
      });
      await expect(
        auth.signupEmployee({ name: 'Ramesh', email: 'ramesh@codevidhya.com', password: 'Password123!' }),
      ).resolves.toBeDefined();
    });

    it('honors SIGNUP_ALLOWED_EMAIL_DOMAINS when configured to more than one domain', async () => {
      config.get.mockReturnValue('codevidhya.com,partner-org.com');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'someone@partner-org.com',
        name: 'Someone',
        role: StaffRole.EMPLOYEE,
        departmentId: null,
        orgId: 'org-1',
      });
      await expect(
        auth.signupEmployee({ name: 'Someone', email: 'someone@partner-org.com', password: 'Password123!' }),
      ).resolves.toBeDefined();
    });

    it('still rejects a duplicate email with the domain check passing', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        auth.signupEmployee({ name: 'Ramesh', email: 'ramesh@codevidhya.com', password: 'Password123!' }),
      ).rejects.toThrow(ConflictException);
    });

    // Without normalizing, "Ramesh@codevidhya.com" and "ramesh@codevidhya.com"
    // would pass User.email's case-sensitive unique constraint as two
    // different accounts — closed by storing and checking the same lowercased
    // form everywhere.
    it('stores the email lowercased regardless of the case typed at signup', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-new', email: 'ramesh@codevidhya.com', name: 'Ramesh', role: StaffRole.EMPLOYEE, departmentId: null, orgId: 'org-1' });
      await auth.signupEmployee({ name: 'Ramesh', email: 'Ramesh@CodeVidhya.com', password: 'Password123!' });
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'ramesh@codevidhya.com' }) }));
    });

    it('catches a duplicate signup that only differs by email case', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' }); // as if ramesh@codevidhya.com already exists
      await expect(
        auth.signupEmployee({ name: 'Ramesh', email: 'RAMESH@codevidhya.com', password: 'Password123!' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

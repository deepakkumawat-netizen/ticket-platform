import { UnauthorizedException } from '@nestjs/common';
import { PrincipalType } from '@ticket-platform/shared';
import { CustomerJwtStrategy } from './customer-jwt.strategy';

// Mirrors staff-jwt.strategy.ts's own re-validation behavior (no spec file
// exists for that one either, but this is the exact gap that was missing
// here before: a deactivated customer kept full portal access until their
// access token naturally expired, since validate() never checked the DB.

function makeStrategy(customer: { id: string; isActive: boolean } | null) {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer) } };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const strategy = new CustomerJwtStrategy(prisma as any, config as any);
  return { strategy, prisma };
}

const PAYLOAD = { sub: 'cust-1', principalType: PrincipalType.CUSTOMER, companyId: null, orgId: 'org-1' } as any;

describe('CustomerJwtStrategy.validate', () => {
  it('accepts a token for an active customer, re-reading the DB', async () => {
    const { strategy, prisma } = makeStrategy({ id: 'cust-1', isActive: true });
    const result = await strategy.validate(PAYLOAD);
    expect(result).toEqual(PAYLOAD);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({ where: { id: 'cust-1' } });
  });

  it('rejects a token for a deactivated customer even though the token itself is still valid/unexpired', async () => {
    const { strategy } = makeStrategy({ id: 'cust-1', isActive: false });
    await expect(strategy.validate(PAYLOAD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token for a customer that no longer exists', async () => {
    const { strategy } = makeStrategy(null);
    await expect(strategy.validate(PAYLOAD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-customer token outright', async () => {
    const { strategy } = makeStrategy({ id: 'cust-1', isActive: true });
    await expect(strategy.validate({ ...PAYLOAD, principalType: PrincipalType.STAFF })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

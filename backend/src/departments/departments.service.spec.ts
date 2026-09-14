import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

// Activating a department with nothing to raise a ticket against would be a
// dead end for whoever tries it — this is what makes the "Departments" admin
// screen a one-click, fully-working toggle instead of a half-working one.

function makeService(hasExistingTicketType: boolean, exists = true) {
  const provisionDefaultTicketType = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    department: {
      findUnique: jest.fn().mockResolvedValue(exists ? { id: 'dept-ops' } : null),
      update: jest.fn().mockResolvedValue({ id: 'dept-ops', isActive: true }),
    },
    ticketTypeDefinition: { findFirst: jest.fn().mockResolvedValue(hasExistingTicketType ? { id: 'existing' } : null) },
  };
  const ticketTypes = { provisionDefaultTicketType };
  const service = new DepartmentsService(prisma as any, ticketTypes as any);
  return { service, prisma, provisionDefaultTicketType };
}

describe('DepartmentsService.update — auto-provisioning on activation', () => {
  it('provisions a default ticket type when activating a department that has none', async () => {
    const { service, provisionDefaultTicketType } = makeService(false);
    await service.update('dept-ops', { isActive: true }, 'admin-1');
    expect(provisionDefaultTicketType).toHaveBeenCalledWith('dept-ops', 'admin-1');
  });

  it('does not re-provision a department that already has a ticket type', async () => {
    const { service, provisionDefaultTicketType } = makeService(true);
    await service.update('dept-ops', { isActive: true }, 'admin-1');
    expect(provisionDefaultTicketType).not.toHaveBeenCalled();
  });

  it('does not provision anything when deactivating (or on a non-activating update)', async () => {
    const { service, provisionDefaultTicketType } = makeService(false);
    await service.update('dept-ops', { isActive: false }, 'admin-1');
    await service.update('dept-ops', { name: 'Operations' }, 'admin-1');
    expect(provisionDefaultTicketType).not.toHaveBeenCalled();
  });

  it('throws a clean 404 for a nonexistent department id instead of a raw Prisma error', async () => {
    const { service } = makeService(false, false);
    await expect(service.update('does-not-exist', { isActive: true }, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('swallows a concurrent-activation P2002 (two requests both provisioning) instead of a raw 500', async () => {
    const { service, provisionDefaultTicketType } = makeService(false);
    provisionDefaultTicketType.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.update('dept-ops', { isActive: true }, 'admin-1')).resolves.toEqual({ id: 'dept-ops', isActive: true });
  });

  it('still throws a non-P2002 error from provisioning', async () => {
    const { service, provisionDefaultTicketType } = makeService(false);
    provisionDefaultTicketType.mockRejectedValue(new Error('boom'));
    await expect(service.update('dept-ops', { isActive: true }, 'admin-1')).rejects.toThrow('boom');
  });
});

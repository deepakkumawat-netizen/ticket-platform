import { DepartmentsService } from './departments.service';

// Activating a department with nothing to raise a ticket against would be a
// dead end for whoever tries it — this is what makes the "Departments" admin
// screen a one-click, fully-working toggle instead of a half-working one.

function makeService(hasExistingTicketType: boolean) {
  const provisionDefaultTicketType = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    department: { update: jest.fn().mockResolvedValue({ id: 'dept-ops', isActive: true }) },
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
});

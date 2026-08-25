import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerType, FieldAppliesTo, FieldType, TicketTypeVersionStatus } from '@ticket-platform/shared';
import { TicketTypesService } from './ticket-types.service';

// The publish() guardrails and snapshot-building logic are the entire point
// of the low-code engine's "editing a definition never corrupts an existing
// ticket" design (see the plan) — this is the highest-value thing to test
// before any real ticket ever gets created against it.

function makeDefinition(overrides: Partial<any> = {}) {
  return {
    id: 'tt-1',
    departmentId: 'dept-tech',
    fields: [
      {
        id: 'f-1',
        key: 'contractTier',
        label: 'Contract Tier',
        fieldType: FieldType.SELECT,
        appliesTo: FieldAppliesTo.B2B,
        required: true,
        options: [{ value: 'gold', label: 'Gold' }],
        order: 0,
        isDeprecated: false,
      },
      {
        id: 'f-2',
        key: 'oldField',
        label: 'Old Field',
        fieldType: FieldType.TEXT,
        appliesTo: FieldAppliesTo.BOTH,
        required: false,
        options: [],
        order: 1,
        isDeprecated: true, // must be excluded from the published snapshot
      },
    ],
    statuses: [
      { key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 },
      { key: 'CLOSED', label: 'Closed', isInitial: false, isTerminal: true, order: 1 },
    ],
    transitions: [{ fromStatusKey: 'OPEN', toStatusKey: 'CLOSED', allowedRoles: ['AGENT'] }],
    slaRules: [
      { customerType: CustomerType.B2B, priority: 'HIGH', responseTimeMinutes: 30, resolutionTimeMinutes: 480 },
    ],
    escalationRules: [],
    ...overrides,
  };
}

function makeServiceWithDefinition(definition: any, lastVersionNumber: number | null = null) {
  const created: any[] = [];
  const prisma = {
    ticketTypeDefinition: { findUnique: jest.fn().mockResolvedValue(definition) },
    ticketTypeVersion: {
      findFirst: jest.fn().mockResolvedValue(lastVersionNumber ? { versionNumber: lastVersionNumber } : null),
      create: jest.fn().mockImplementation(({ data }) => {
        created.push(data);
        return { id: 'version-1', ...data };
      }),
    },
  };
  const service = new TicketTypesService(prisma as any);
  return { service, prisma, created };
}

describe('TicketTypesService.publish', () => {
  it('refuses to publish with no statuses defined', async () => {
    const { service } = makeServiceWithDefinition(makeDefinition({ statuses: [] }));
    await expect(service.publish('tt-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to publish when no status is marked as initial', async () => {
    const { service } = makeServiceWithDefinition(
      makeDefinition({ statuses: [{ key: 'OPEN', label: 'Open', isInitial: false, isTerminal: false, order: 0 }] }),
    );
    await expect(service.publish('tt-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to publish with no SLA rules defined', async () => {
    const { service } = makeServiceWithDefinition(makeDefinition({ slaRules: [] }));
    await expect(service.publish('tt-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('publishes version 1 when there is no prior version', async () => {
    const { service, created } = makeServiceWithDefinition(makeDefinition());
    await service.publish('tt-1', 'user-42');
    expect(created[0].versionNumber).toBe(1);
    expect(created[0].status).toBe(TicketTypeVersionStatus.PUBLISHED);
    expect(created[0].publishedByUserId).toBe('user-42');
  });

  it('increments the version number on top of the last published version', async () => {
    const { service, created } = makeServiceWithDefinition(makeDefinition(), 3);
    await service.publish('tt-1', 'user-1');
    expect(created[0].versionNumber).toBe(4);
  });

  it('excludes deprecated fields from the published snapshot', async () => {
    const { service, created } = makeServiceWithDefinition(makeDefinition());
    await service.publish('tt-1', 'user-1');
    const keys = created[0].fieldSchemaSnapshot.map((f: any) => f.key);
    expect(keys).toEqual(['contractTier']);
    expect(keys).not.toContain('oldField');
  });

  it('freezes statuses, transitions, and SLA rules into the snapshot', async () => {
    const { service, created } = makeServiceWithDefinition(makeDefinition());
    await service.publish('tt-1', 'user-1');
    expect(created[0].statusSchemaSnapshot.statuses).toHaveLength(2);
    expect(created[0].statusSchemaSnapshot.transitions).toHaveLength(1);
    expect(created[0].slaSnapshot).toHaveLength(1);
    expect(created[0].slaSnapshot[0].customerType).toBe(CustomerType.B2B);
  });

  it('freezes an empty escalationSnapshot when no escalation rules are configured', async () => {
    const { service, created } = makeServiceWithDefinition(makeDefinition());
    await service.publish('tt-1', 'user-1');
    expect(created[0].escalationSnapshot).toEqual([]);
  });

  it('freezes configured escalation rules into the snapshot', async () => {
    const { service, created } = makeServiceWithDefinition(
      makeDefinition({
        escalationRules: [
          { customerType: CustomerType.B2B, priority: 'HIGH', escalateOnSlaBreach: true, reassignmentThreshold: 3 },
        ],
      }),
    );
    await service.publish('tt-1', 'user-1');
    expect(created[0].escalationSnapshot).toHaveLength(1);
    expect(created[0].escalationSnapshot[0]).toEqual({
      customerType: CustomerType.B2B,
      priority: 'HIGH',
      escalateOnSlaBreach: true,
      reassignmentThreshold: 3,
    });
  });
});

// These back the assertDepartmentAccess() check every :id/:fieldId route in
// TicketTypesController now runs BEFORE delegating to the service — the gap
// where a DEPT_ADMIN in one department could read/edit another department's
// ticket-type config was exactly this lookup being missing.
describe('TicketTypesService department lookups', () => {
  it('getDepartmentIdForDefinition returns the owning department', async () => {
    const { service } = makeServiceWithDefinition(makeDefinition());
    await expect(service.getDepartmentIdForDefinition('tt-1')).resolves.toBe('dept-tech');
  });

  it('getDepartmentIdForDefinition throws NotFoundException for an unknown id', async () => {
    const prisma = { ticketTypeDefinition: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new TicketTypesService(prisma as any);
    await expect(service.getDepartmentIdForDefinition('missing')).rejects.toThrow(NotFoundException);
  });

  it('getDepartmentIdForField walks up to the owning definition\'s department', async () => {
    const prisma = {
      fieldDefinition: {
        findUnique: jest.fn().mockResolvedValue({ ticketTypeDefinition: { departmentId: 'dept-tech' } }),
      },
    };
    const service = new TicketTypesService(prisma as any);
    await expect(service.getDepartmentIdForField('f-1')).resolves.toBe('dept-tech');
  });

  it('getDepartmentIdForField throws NotFoundException for an unknown field', async () => {
    const prisma = { fieldDefinition: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new TicketTypesService(prisma as any);
    await expect(service.getDepartmentIdForField('missing')).rejects.toThrow(NotFoundException);
  });
});

// The "type a name, click one button" one-click path added 2026-08-25 so a
// non-technical admin never has to understand fields/statuses/transitions/
// SLA rules just to get a NEW ticket type usable. Spies on the
// already-covered addStatus/addTransition/addSlaRule/publish rather than
// re-mocking the whole create->publish DB round trip.
describe('TicketTypesService.quickCreateDefinition', () => {
  function makeQuickCreateHarness() {
    const prisma = {
      ticketTypeDefinition: {
        findUnique: jest.fn().mockResolvedValue(null), // no existing def with this key yet
        create: jest.fn().mockResolvedValue({ id: 'tt-new' }),
      },
    };
    const service = new TicketTypesService(prisma as any);
    jest.spyOn(service, 'addStatus').mockResolvedValue({} as any);
    jest.spyOn(service, 'addTransition').mockResolvedValue({} as any);
    jest.spyOn(service, 'addSlaRule').mockResolvedValue({} as any);
    jest.spyOn(service, 'publish').mockResolvedValue({ id: 'tt-new', versionNumber: 1 } as any);
    return { service, prisma };
  }

  it('rejects a duplicate key before creating anything', async () => {
    const { service, prisma } = makeQuickCreateHarness();
    (prisma.ticketTypeDefinition.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });
    await expect(service.quickCreateDefinition('dept-tech', { key: 'bug', name: 'Bug' } as any, 'user-1')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.ticketTypeDefinition.create).not.toHaveBeenCalled();
  });

  it('sets up default statuses, transitions, and SLA rules, then publishes immediately', async () => {
    const { service } = makeQuickCreateHarness();
    const result = await service.quickCreateDefinition('dept-tech', { key: 'bug', name: 'Bug' } as any, 'user-1');
    expect(service.addStatus).toHaveBeenCalledTimes(3);
    expect(service.addTransition).toHaveBeenCalledTimes(3);
    expect(service.addSlaRule).toHaveBeenCalledTimes(8); // 4 priorities x 2 customer types
    expect(service.publish).toHaveBeenCalledWith('tt-new', 'user-1');
    // Returns the DEFINITION (same shape createDefinition() returns), not
    // publish()'s TicketTypeVersion return value — the admin UI's list/
    // detail code expects id/key/name/isActive, not a version row. This is
    // exactly the bug a live smoke test caught before this was fixed.
    expect(result).toEqual({ id: 'tt-new' });
  });

  it('marks exactly one status as initial and one as terminal', async () => {
    const { service } = makeQuickCreateHarness();
    await service.quickCreateDefinition('dept-tech', { key: 'bug', name: 'Bug' } as any, 'user-1');
    const statusCalls = (service.addStatus as jest.Mock).mock.calls.map(([, dto]: any) => dto);
    expect(statusCalls.filter((c: any) => c.isInitial)).toHaveLength(1);
    expect(statusCalls.filter((c: any) => c.isTerminal)).toHaveLength(1);
  });
});

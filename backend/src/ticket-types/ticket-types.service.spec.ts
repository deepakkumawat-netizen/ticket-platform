import { BadRequestException } from '@nestjs/common';
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
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffRole } from '@ticket-platform/shared';
import { TicketsService } from './tickets.service';

// Covers transition() specifically: the firstRespondedAt/resolvedAt
// stamping rules, and the "log + email the requester on every status move"
// full-tracking behavior added 2026-08-25 alongside connecting SMTP.

const AGENT_TECH = { sub: 'agent-1', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-tech', orgId: 'org-1' } as any;

const SCHEMA = {
  statuses: [
    { key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 },
    { key: 'RESOLVED', label: 'Resolved', isInitial: false, isTerminal: true, order: 1 },
  ],
  transitions: [
    { fromStatusKey: 'OPEN', toStatusKey: 'RESOLVED', allowedRoles: [] },
    { fromStatusKey: 'RESOLVED', toStatusKey: 'OPEN', allowedRoles: [] },
  ],
};

function makeHarness(ticketOverrides: Partial<any> = {}) {
  const updateCalls: any[] = [];
  const ticket = {
    id: 'ticket-1',
    departmentId: 'dept-tech',
    statusKey: 'OPEN',
    firstRespondedAt: null,
    resolvedAt: null,
    rowVersion: 1,
    ticketTypeVersion: { statusSchemaSnapshot: SCHEMA },
    ...ticketOverrides,
  };
  const auditLogCalls: any[] = [];
  const prisma = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockImplementation(({ where, data }) => {
        updateCalls.push({ where, data });
        if ('rowVersion' in where && where.rowVersion !== ticket.rowVersion) {
          throw new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'x' });
        }
        return {
          ...ticket,
          ...data,
          department: { key: 'TECH', name: 'Tech' },
          ticketNumber: 42,
          customer: { id: 'cust-1', name: 'Alex', email: 'alex@codevidhya.com' },
        };
      }),
    },
    auditLog: { create: jest.fn().mockImplementation(({ data }) => auditLogCalls.push(data)) },
  };
  const notifications = { notifyRequester: jest.fn().mockResolvedValue(undefined) };
  const service = new TicketsService(prisma as any, {} as any, notifications as any, {} as any, {} as any);
  return { service, prisma, notifications, updateCalls, auditLogCalls };
}

describe('TicketsService.transition', () => {
  it('rejects a move not defined in the schema', async () => {
    const { service } = makeHarness({ statusKey: 'RESOLVED' }); // no RESOLVED -> RESOLVED move exists
    await expect(service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a role the transition's allowedRoles excludes", async () => {
    const restricted = {
      statuses: SCHEMA.statuses,
      transitions: [{ fromStatusKey: 'OPEN', toStatusKey: 'RESOLVED', allowedRoles: [StaffRole.DEPT_ADMIN] }],
    };
    const { service } = makeHarness({ ticketTypeVersion: { statusSchemaSnapshot: restricted } });
    await expect(service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stamps firstRespondedAt on the first move away from the initial status', async () => {
    const { service, updateCalls } = makeHarness();
    await service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED');
    expect(updateCalls[0].data).toHaveProperty('firstRespondedAt');
  });

  it('stamps resolvedAt/closedAt and emails the requester on first resolution', async () => {
    const { service, updateCalls, notifications } = makeHarness();
    await service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED');
    expect(updateCalls[0].data).toMatchObject({ resolvedAt: expect.any(Date), closedAt: expect.any(Date) });
    expect(notifications.notifyRequester).toHaveBeenCalledTimes(1);
    expect(notifications.notifyRequester).toHaveBeenCalledWith(
      'alex@codevidhya.com',
      'TICKET_RESOLVED',
      expect.objectContaining({ displayId: 'TECH-42' }),
      expect.objectContaining({ subject: expect.stringContaining('Resolved') }),
    );
  });

  it('does not re-stamp resolvedAt on a later move once already resolved (but still logs + emails the move)', async () => {
    const { service, updateCalls, notifications } = makeHarness({ statusKey: 'RESOLVED', resolvedAt: new Date('2026-08-20T00:00:00Z') });
    await service.transition(AGENT_TECH, 'ticket-1', 'OPEN');
    expect(updateCalls[0].data).not.toHaveProperty('resolvedAt');
    // Reopening is still a real status move -- full tracking means it's
    // still logged and the requester is still told, just not as a
    // "resolved" email a second time.
    expect(notifications.notifyRequester).toHaveBeenCalledWith(
      'alex@codevidhya.com',
      'TICKET_STATUS_CHANGED',
      expect.anything(),
      expect.anything(),
    );
  });

  it('logs TICKET_STATUS_CHANGED with the before/after status on every move', async () => {
    const { service, auditLogCalls } = makeHarness();
    await service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED');
    const statusLog = auditLogCalls.find((c) => c.action === 'TICKET_STATUS_CHANGED');
    expect(statusLog).toMatchObject({ beforeJson: { statusKey: 'OPEN' }, afterJson: { statusKey: 'RESOLVED', label: 'Resolved' } });
  });

  it('emails a non-terminal move with "moved to X" wording, not resolution wording', async () => {
    const nonTerminalSchema = {
      statuses: [
        { key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 },
        { key: 'IN_PROGRESS', label: 'In Progress', isInitial: false, isTerminal: false, order: 1 },
      ],
      transitions: [{ fromStatusKey: 'OPEN', toStatusKey: 'IN_PROGRESS', allowedRoles: [] }],
    };
    const { service, notifications } = makeHarness({ ticketTypeVersion: { statusSchemaSnapshot: nonTerminalSchema } });
    await service.transition(AGENT_TECH, 'ticket-1', 'IN_PROGRESS');
    expect(notifications.notifyRequester).toHaveBeenCalledWith(
      'alex@codevidhya.com',
      'TICKET_STATUS_CHANGED',
      expect.anything(),
      expect.objectContaining({ subject: expect.stringContaining('In Progress') }),
    );
  });

  it('surfaces a concurrent-edit conflict (rowVersion mismatch, P2025) as a clean ConflictException', async () => {
    const { service, prisma } = makeHarness();
    // Simulate someone else updating the row in between the read above and
    // this write — Prisma's `where: { id, rowVersion }` then matches
    // nothing, which Prisma reports as P2025.
    (prisma.ticket.update as jest.Mock).mockImplementation(() => {
      throw new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'x' });
    });
    await expect(service.transition(AGENT_TECH, 'ticket-1', 'RESOLVED')).rejects.toBeInstanceOf(ConflictException);
  });
});

import { NotFoundException } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { TicketsService } from './tickets.service';

// Covers create()'s auto-assign step specifically — separate from
// tickets.service.spec.ts (which covers assign/escalate/acknowledge/
// notifyManager) since exercising create() needs a much bigger mock
// harness (department, ticket type, customer, SLA snapshot, ...).

const STAFF = { sub: 'requester-1', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-tech', orgId: 'org-1' } as any;

const VERSION = {
  id: 'version-1',
  fieldSchemaSnapshot: [],
  statusSchemaSnapshot: {
    statuses: [{ key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 }],
    transitions: [],
  },
  slaSnapshot: [{ customerType: 'B2C', priority: 'MEDIUM', responseTimeMinutes: 240, resolutionTimeMinutes: 1440 }],
};

function makeCreateHarness(candidates: { id: string; name: string }[], geminiImpl?: (...args: any[]) => any) {
  const ticketCreateCalls: any[] = [];
  const auditLogCalls: any[] = [];
  const prisma = {
    department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept-tech', isActive: true }) },
    ticketTypeDefinition: { findUnique: jest.fn().mockResolvedValue({ id: 'tt-1', departmentId: 'dept-tech' }) },
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', orgId: 'org-1', companyId: null }) },
    user: {
      findMany: jest.fn().mockResolvedValue(candidates),
      findUnique: jest.fn(),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => {
        ticketCreateCalls.push(data);
        // department/ticketNumber mirror what the real TICKET_INCLUDE select
        // would carry back — needed for the "{key}-{number}" displayId built
        // by notifyAgentAssigned.
        return { id: 'ticket-new', ...data, department: { key: 'TECH' }, ticketNumber: 1 };
      }),
    },
    auditLog: { create: jest.fn().mockImplementation(({ data }) => auditLogCalls.push(data)) },
  } as any;
  // create() runs its ticket.create + audit-log writes inside
  // $transaction(tx => ...) — hand the callback this same mocked prisma
  // object as `tx` so every mock above still exercises exactly as before.
  prisma.$transaction = jest.fn().mockImplementation((cb: (tx: any) => unknown) => cb(prisma));
  const ticketTypes = { getLatestPublishedVersion: jest.fn().mockResolvedValue(VERSION) };
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notifyDepartmentManagers: jest.fn(), markReadForTicket: jest.fn(), notify };
  const gemini = { generateJson: jest.fn().mockImplementation(geminiImpl ?? (() => Promise.reject(new Error('unexpected call')))) };
  const service = new TicketsService(prisma as any, ticketTypes as any, notifications as any, gemini as any, {} as any);
  return { service, prisma, gemini, ticketCreateCalls, auditLogCalls, notify };
}

const BASE_DTO = { ticketTypeDefinitionId: 'tt-1', customerId: 'cust-1', priority: 'MEDIUM', subject: 'WiFi is down', description: 'Cannot connect since morning' };

describe('TicketsService.create — AI auto-assign', () => {
  it('leaves the ticket unassigned when the department has no agents (no Gemini call)', async () => {
    const { service, ticketCreateCalls, gemini } = makeCreateHarness([]);
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBeNull();
    expect(ticket.autoAssignReasoning).toBeNull();
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('auto-assigns directly to the sole agent without calling Gemini', async () => {
    const { service, ticketCreateCalls, gemini } = makeCreateHarness([{ id: 'agent-1', name: 'Alex' }]);
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBe('agent-1');
    expect(ticket.autoAssignReasoning).toContain('Only one agent');
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it("uses Gemini's pick among multiple candidates and logs an audit entry", async () => {
    const { service, ticketCreateCalls, auditLogCalls } = makeCreateHarness(
      [{ id: 'agent-1', name: 'Alex' }, { id: 'agent-2', name: 'Sam' }],
      () => Promise.resolve({ agentId: 'agent-2', reasoning: 'Sam has handled WiFi issues before and has capacity.' }),
    );
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBe('agent-2');
    expect(ticket.autoAssignReasoning).toContain('Sam');
    // Also logs TICKET_CREATED unconditionally (2026-08-25's tracking-history
    // addition) — look up by action rather than assume index, since that
    // entry's exact position isn't the point of this test.
    const autoAssignLog = auditLogCalls.find((c: any) => c.action === 'TICKET_AUTO_ASSIGNED');
    expect(autoAssignLog?.afterJson).toMatchObject({ agentId: 'agent-2' });
    expect(auditLogCalls.some((c: any) => c.action === 'TICKET_CREATED')).toBe(true);
  });

  it('never overrides an explicit assignedAgentId (Gemini not consulted)', async () => {
    const { service, prisma, ticketCreateCalls, gemini } = makeCreateHarness([{ id: 'agent-1', name: 'Alex' }, { id: 'agent-2', name: 'Sam' }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', departmentId: 'dept-tech' });
    const ticket = await service.create(STAFF, 'dept-tech', { ...BASE_DTO, assignedAgentId: 'agent-1' } as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBe('agent-1');
    expect(ticket.autoAssignReasoning).toBeNull();
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('falls back to Unassigned (never throws) if Gemini is unavailable', async () => {
    const { service, ticketCreateCalls } = makeCreateHarness(
      [{ id: 'agent-1', name: 'Alex' }, { id: 'agent-2', name: 'Sam' }],
      () => Promise.reject(new Error('GEMINI_API_KEY not configured')),
    );
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBeNull();
    expect(ticket.autoAssignReasoning).toBeNull();
  });

  it("ignores a Gemini pick that isn't one of the real candidates", async () => {
    const { service, ticketCreateCalls } = makeCreateHarness(
      [{ id: 'agent-1', name: 'Alex' }, { id: 'agent-2', name: 'Sam' }],
      () => Promise.resolve({ agentId: 'agent-made-up', reasoning: 'hallucinated' }),
    );
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticketCreateCalls[0].assignedAgentId).toBeNull();
    expect(ticket.autoAssignReasoning).toBeNull();
  });
});

// Agent-facing counterpart to the requester-email tests in tickets.service.spec.ts
// (Deepak's ask, 2026-08-31): whoever a ticket lands on should be told, not just
// the requester who raised it.
describe('TicketsService.create — agent notification', () => {
  it('notifies the auto-assigned agent once a real agent is picked', async () => {
    const { service, prisma, notify } = makeCreateHarness([{ id: 'agent-1', name: 'Alex' }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'alex@codevidhya.com' });
    await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(notify).toHaveBeenCalledWith(
      [{ id: 'agent-1', email: 'alex@codevidhya.com' }],
      'TICKET_ASSIGNED_TO_YOU',
      expect.objectContaining({ subject: BASE_DTO.subject }),
      expect.objectContaining({ subject: expect.stringContaining('New ticket assigned to you') }),
    );
  });

  it('does not notify anyone when the ticket is left unassigned', async () => {
    const { service, notify } = makeCreateHarness([]);
    await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(notify).not.toHaveBeenCalled();
  });

  // 2026-09-14 hardening pass: the ticket row + its audit-log entries commit
  // as one transaction, but the agent-assigned notification runs AFTER that
  // transaction and is best-effort (safeNotify) — a mailer/notification
  // failure must never turn an already-successful ticket creation into a 500
  // for the caller.
  it('still returns the created ticket even if notifying the assigned agent fails', async () => {
    const { service, prisma, notify } = makeCreateHarness([{ id: 'agent-1', name: 'Alex' }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'alex@codevidhya.com' });
    notify.mockRejectedValueOnce(new Error('SMTP down'));
    const ticket = await service.create(STAFF, 'dept-tech', BASE_DTO as any);
    expect(ticket.id).toBe('ticket-new');
  });
});

// Cross-org customerId guard: without this, a customerId belonging to a
// DIFFERENT org (guessed, leaked, or left over from a prior migration) could
// get a ticket created against it — leaking that customer's name/email into
// a ticket the wrong org can see, and emailing the wrong person.
describe('TicketsService.create — customerId org scoping', () => {
  it('refuses to create a ticket for a customerId belonging to a different org', async () => {
    const { service, prisma } = makeCreateHarness([]);
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', orgId: 'org-OTHER', companyId: null });
    await expect(service.create(STAFF, 'dept-tech', BASE_DTO as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to create a ticket for a customerId that does not exist at all', async () => {
    const { service, prisma } = makeCreateHarness([]);
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(service.create(STAFF, 'dept-tech', BASE_DTO as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});

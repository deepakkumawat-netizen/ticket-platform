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
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', companyId: null }) },
    user: {
      findMany: jest.fn().mockResolvedValue(candidates),
      findUnique: jest.fn(),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => {
        ticketCreateCalls.push(data);
        return { id: 'ticket-new', ...data };
      }),
    },
    auditLog: { create: jest.fn().mockImplementation(({ data }) => auditLogCalls.push(data)) },
  };
  const ticketTypes = { getLatestPublishedVersion: jest.fn().mockResolvedValue(VERSION) };
  const notifications = { notifyDepartmentManagers: jest.fn(), markReadForTicket: jest.fn() };
  const gemini = { generateJson: jest.fn().mockImplementation(geminiImpl ?? (() => Promise.reject(new Error('unexpected call')))) };
  const service = new TicketsService(prisma as any, ticketTypes as any, notifications as any, gemini as any, {} as any);
  return { service, prisma, gemini, ticketCreateCalls, auditLogCalls };
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
    expect(auditLogCalls[0].action).toBe('TICKET_AUTO_ASSIGNED');
    expect(auditLogCalls[0].afterJson).toMatchObject({ agentId: 'agent-2' });
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

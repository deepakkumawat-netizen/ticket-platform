import { AiService } from './ai.service';

// Covers bulkAssist() specifically -- the rest of AiService (triage/
// checkLanguage/draftReply/insights/chat) has no unit tests by design in
// this codebase, verified live against a real Gemini key instead (see
// ticketplatform-session-2026-08-20). bulkAssist earns its own tests
// because it has real control flow beyond a prompt template: batching,
// the truncation flag, and isolating one ticket's failure from the rest.

const SCHEMA = { statusSchemaSnapshot: { statuses: [{ key: 'OPEN', label: 'Open' }] } };

function makeTicket(overrides: Partial<any> = {}) {
  return {
    id: 't-1',
    ticketNumber: 1,
    subject: 'WiFi down',
    description: 'Cannot connect',
    priority: 'MEDIUM',
    statusKey: 'OPEN',
    customFields: {},
    assignedAgentId: null,
    assignedAgent: null,
    department: { key: 'TECH' },
    ticketTypeVersion: SCHEMA,
    ...overrides,
  };
}

function makeHarness(tickets: any[]) {
  const prisma = {
    ticket: { findMany: jest.fn().mockResolvedValue(tickets) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Sam' }) },
  };
  const tickets_ = { suggestAgent: jest.fn().mockResolvedValue({ agentId: 'agent-2', reasoning: 'Best fit' }) };
  const dashboards = {};
  const gemini = { generateText: jest.fn().mockResolvedValue('Thanks for reaching out, looking into it now.') };
  const service = new AiService(prisma as any, tickets_ as any, dashboards as any, gemini as any);
  // bulkAssist paces itself with a real ~15s delay between tickets in
  // production (see its comment) to respect a free-tier Gemini key's
  // 5-requests/minute cap -- zero it out here so this spec stays fast.
  (service as any).bulkAssistPaceMs = 0;
  return { service, prisma, tickets: tickets_, gemini };
}

describe('AiService.bulkAssist', () => {
  it('returns nothing (not truncated) when there are no open tickets', async () => {
    const { service } = makeHarness([]);
    const result = await service.bulkAssist('dept-tech');
    expect(result).toEqual({ items: [], truncated: false });
  });

  it('drafts a reply and suggests an agent for an unassigned ticket', async () => {
    const { service, tickets } = makeHarness([makeTicket()]);
    const { items } = await service.bulkAssist('dept-tech');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      displayId: 'TECH-1',
      draft: 'Thanks for reaching out, looking into it now.',
      suggestedAgent: { agentId: 'agent-2', name: 'Sam', reasoning: 'Best fit' },
    });
    expect(tickets.suggestAgent).toHaveBeenCalledWith('dept-tech', 'WiFi down', 'Cannot connect');
  });

  it('does not suggest an agent for a ticket that already has one', async () => {
    const { service, tickets } = makeHarness([makeTicket({ assignedAgentId: 'agent-1', assignedAgent: { id: 'agent-1', name: 'Alex' } })]);
    const { items } = await service.bulkAssist('dept-tech');
    expect(items[0].currentAssigneeName).toBe('Alex');
    expect(items[0].suggestedAgent).toBeNull();
    expect(tickets.suggestAgent).not.toHaveBeenCalled();
  });

  it("one ticket's draft failure does not affect the others in the batch", async () => {
    const { service, gemini } = makeHarness([makeTicket({ id: 't-1', ticketNumber: 1 }), makeTicket({ id: 't-2', ticketNumber: 2 })]);
    gemini.generateText.mockRejectedValueOnce(new Error('Gemini 503')).mockResolvedValueOnce('A real draft for the second one.');
    const { items } = await service.bulkAssist('dept-tech');
    expect(items).toHaveLength(2);
    expect(items[0].draft).toBeNull();
    expect(items[1].draft).toBe('A real draft for the second one.');
  });

  it('flags truncated when there are more than 20 open tickets, and only returns 20', async () => {
    const many = Array.from({ length: 25 }, (_, i) => makeTicket({ id: `t-${i}`, ticketNumber: i }));
    const { service, prisma } = makeHarness(many.slice(0, 21)); // findMany is mocked to the take:21 result
    const { items, truncated } = await service.bulkAssist('dept-tech');
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }));
    expect(truncated).toBe(true);
    expect(items).toHaveLength(20);
  });

  it('is not truncated when there are exactly 20 open tickets', async () => {
    const exactly20 = Array.from({ length: 20 }, (_, i) => makeTicket({ id: `t-${i}`, ticketNumber: i }));
    const { service } = makeHarness(exactly20);
    const { items, truncated } = await service.bulkAssist('dept-tech');
    expect(truncated).toBe(false);
    expect(items).toHaveLength(20);
  });
});

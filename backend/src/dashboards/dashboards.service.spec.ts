import { DashboardsService } from './dashboards.service';

// Regression coverage for a real math bug found 2026-09-14: onTrack used to
// be openTickets.length - noSlaRule - Math.max(responseBreached,
// resolutionBreached), which undercounts breaches whenever the
// response-breach and resolution-breach sets are disjoint (max() assumes
// they overlap). Fixed to count each ticket once if it breaches EITHER SLA.

const SCHEMA = {
  statusSchemaSnapshot: {
    statuses: [
      { key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 },
      { key: 'RESOLVED', label: 'Resolved', isInitial: false, isTerminal: true, order: 1 },
    ],
  },
};

const NOW = new Date('2026-09-14T12:00:00Z');
const PAST = new Date('2026-09-14T00:00:00Z'); // due date already passed
const FUTURE = new Date('2026-09-15T00:00:00Z'); // due date not yet passed

function baseTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `t-${Math.random()}`,
    ticketNumber: 1,
    subject: 'Something',
    priority: 'MEDIUM',
    statusKey: 'OPEN',
    createdAt: PAST,
    responseDueAt: null,
    resolutionDueAt: null,
    firstRespondedAt: null,
    resolvedAt: null,
    assignedAgentId: null,
    assignedAgent: null,
    ticketTypeVersion: SCHEMA,
    isEscalated: false,
    escalatedAt: null,
    escalationReason: null,
    escalationAcknowledgedAt: null,
    ...overrides,
  };
}

function makeService(tickets: ReturnType<typeof baseTicket>[]) {
  const prisma = {
    department: { findUniqueOrThrow: jest.fn().mockResolvedValue({ key: 'TECH' }) },
    ticket: { findMany: jest.fn().mockResolvedValue(tickets) },
  };
  return new DashboardsService(prisma as any);
}

describe('DashboardsService.getDashboard — SLA on-track math', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts disjoint response-only and resolution-only breaches separately, not via Math.max', async () => {
    const tickets = [
      ...Array.from({ length: 5 }, () => baseTicket({ responseDueAt: PAST, resolutionDueAt: FUTURE })), // response-only breach
      ...Array.from({ length: 5 }, () => baseTicket({ responseDueAt: FUTURE, resolutionDueAt: PAST, firstRespondedAt: NOW })), // resolution-only breach
    ];
    const service = makeService(tickets);
    const dashboard = await service.getDashboard('dept-tech');

    expect(dashboard.slaSummary.responseBreached).toBe(5);
    expect(dashboard.slaSummary.resolutionBreached).toBe(5);
    // The old Math.max(5, 5) implementation reported onTrack = 10 - 0 - 5 = 5,
    // i.e. "5 tickets on track" when actually zero of these 10 are.
    expect(dashboard.slaSummary.onTrack).toBe(0);
  });

  it('does not double-count a ticket breaching BOTH SLAs', async () => {
    const tickets = [baseTicket({ responseDueAt: PAST, resolutionDueAt: PAST })];
    const service = makeService(tickets);
    const dashboard = await service.getDashboard('dept-tech');

    expect(dashboard.slaSummary.responseBreached).toBe(1);
    expect(dashboard.slaSummary.resolutionBreached).toBe(1);
    expect(dashboard.slaSummary.onTrack).toBe(0); // not -1
  });

  it('counts a ticket on track when neither SLA is breached', async () => {
    const tickets = [baseTicket({ responseDueAt: FUTURE, resolutionDueAt: FUTURE })];
    const service = makeService(tickets);
    const dashboard = await service.getDashboard('dept-tech');
    expect(dashboard.slaSummary.onTrack).toBe(1);
  });
});

import { EscalationReason } from '@ticket-platform/shared';
import { SlaBreachCheckService } from './sla-breach-check.service';

// First test coverage this cron job has ever had. Written alongside the
// 2026-09-14 dedup fix (this service used to hand-roll its own escalation
// email instead of reusing tickets.service.ts's — see
// notifications/escalation-notify.ts) to lock in that it now goes through
// the shared helper with the shared wording.

const SCHEMA = { statuses: [{ key: 'OPEN', isTerminal: false }, { key: 'RESOLVED', isTerminal: true }] };

function makeCandidate(overrides: Partial<any> = {}) {
  return {
    id: 'ticket-1',
    orgId: 'org-1',
    departmentId: 'dept-tech',
    ticketNumber: 42,
    subject: 'WiFi is down',
    statusKey: 'OPEN',
    customerType: 'B2C',
    priority: 'HIGH',
    department: { key: 'TECH' },
    ticketTypeVersion: { statusSchemaSnapshot: SCHEMA, escalationSnapshot: null },
    ...overrides,
  };
}

function makeService(candidates: any[]) {
  const prisma = {
    ticket: {
      findMany: jest.fn().mockResolvedValue(candidates),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn() },
  };
  const notifyDepartmentManagers = jest.fn().mockResolvedValue(undefined);
  const notifications = { notifyDepartmentManagers };
  const service = new SlaBreachCheckService(prisma as any, notifications as any);
  return { service, prisma, notifyDepartmentManagers };
}

describe('SlaBreachCheckService.checkBreaches', () => {
  it('escalates a breaching ticket through the shared notifyEscalation helper', async () => {
    const { service, notifyDepartmentManagers } = makeService([makeCandidate()]);
    await service.checkBreaches();
    expect(notifyDepartmentManagers).toHaveBeenCalledWith(
      'org-1',
      'dept-tech',
      'TICKET_ESCALATED',
      expect.objectContaining({ ticketId: 'ticket-1', displayId: 'TECH-42', reason: EscalationReason.SLA_BREACH }),
      expect.objectContaining({ subject: expect.stringContaining('SLA breach') }),
    );
  });

  it('skips a ticket whose escalation snapshot has escalateOnSlaBreach disabled', async () => {
    const { service, notifyDepartmentManagers, prisma } = makeService([
      makeCandidate({ ticketTypeVersion: { statusSchemaSnapshot: SCHEMA, escalationSnapshot: [{ customerType: 'B2C', priority: 'HIGH', escalateOnSlaBreach: false, reassignmentThreshold: null }] } }),
    ]);
    await service.checkBreaches();
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });

  it('skips a ticket whose current status is already terminal', async () => {
    const { service, notifyDepartmentManagers, prisma } = makeService([makeCandidate({ statusKey: 'RESOLVED' })]);
    await service.checkBreaches();
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });

  it('is race-safe: does not notify if another run already claimed the ticket (updateMany count 0)', async () => {
    const { service, notifyDepartmentManagers, prisma } = makeService([makeCandidate()]);
    (prisma.ticket.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await service.checkBreaches();
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });
});

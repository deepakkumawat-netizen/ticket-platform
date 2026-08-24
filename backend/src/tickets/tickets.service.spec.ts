import { BadRequestException } from '@nestjs/common';
import { EscalationReason, StaffRole } from '@ticket-platform/shared';
import { TicketsService } from './tickets.service';

// Covers the three escalation entry points TicketsService owns directly:
// assign()'s reassignment-threshold auto-escalate, escalate()'s manual
// trigger, and acknowledgeEscalation(). The SLA_BREACH trigger lives in
// sla/sla-breach-check.service.spec.ts instead, since it's a different
// service entirely.

const STAFF = { sub: 'user-agent', principalType: 'STAFF', role: StaffRole.AGENT, departmentId: 'dept-tech', orgId: 'org-1' } as any;

function makeTicket(overrides: Partial<any> = {}) {
  return {
    id: 'ticket-1',
    departmentId: 'dept-tech',
    assignedAgentId: 'agent-a',
    reassignmentCount: 0,
    isEscalated: false,
    customerType: 'B2C',
    priority: 'HIGH',
    subject: 'Something broke',
    department: { key: 'TECH' },
    ticketNumber: 42,
    ticketTypeVersion: { escalationSnapshot: null }, // null => defaults (threshold 2, escalateOnSlaBreach true)
    ...overrides,
  };
}

function makeService(ticket: any, opts: { agentDepartmentId?: string } = {}) {
  const updateCalls: any[] = [];
  const auditLogCalls: any[] = [];
  const notifyDepartmentManagers = jest.fn().mockResolvedValue(undefined);
  const markReadForTicket = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockImplementation(({ data }) => {
        updateCalls.push(data);
        return { ...ticket, ...data, department: { key: 'TECH' }, ticketNumber: 42 };
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'agent-b', departmentId: opts.agentDepartmentId ?? 'dept-tech' }),
    },
    auditLog: { create: jest.fn().mockImplementation(({ data }) => auditLogCalls.push(data)) },
  };
  const notifications = { notifyDepartmentManagers, markReadForTicket };
  const service = new TicketsService(prisma as any, {} as any, notifications as any);
  return { service, prisma, updateCalls, auditLogCalls, notifyDepartmentManagers, markReadForTicket };
}

describe('TicketsService.assign — reassignment-threshold escalation', () => {
  it('does not count the FIRST assignment (from Unassigned) as a reassignment', async () => {
    const { service, updateCalls, notifyDepartmentManagers } = makeService(makeTicket({ assignedAgentId: null }));
    await service.assign(STAFF, 'ticket-1', 'agent-b');
    expect(updateCalls[0]).not.toHaveProperty('reassignmentCount');
    expect(updateCalls[0]).not.toHaveProperty('isEscalated');
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });

  it('increments reassignmentCount but does not escalate below the threshold', async () => {
    const { service, updateCalls, notifyDepartmentManagers } = makeService(
      makeTicket({ assignedAgentId: 'agent-a', reassignmentCount: 0 }),
    );
    await service.assign(STAFF, 'ticket-1', 'agent-b');
    expect(updateCalls[0].reassignmentCount).toBe(1);
    expect(updateCalls[0]).not.toHaveProperty('isEscalated');
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });

  it('auto-escalates once the reassignment threshold (default 2) is reached', async () => {
    const { service, updateCalls, auditLogCalls, notifyDepartmentManagers } = makeService(
      makeTicket({ assignedAgentId: 'agent-a', reassignmentCount: 1 }),
    );
    await service.assign(STAFF, 'ticket-1', 'agent-b');
    expect(updateCalls[0].reassignmentCount).toBe(2);
    expect(updateCalls[0].isEscalated).toBe(true);
    expect(updateCalls[0].escalationReason).toBe(EscalationReason.REASSIGNMENT_THRESHOLD);
    expect(auditLogCalls).toHaveLength(1);
    expect(notifyDepartmentManagers).toHaveBeenCalledTimes(1);
  });

  it('respects a configured reassignmentThreshold override from the frozen escalationSnapshot', async () => {
    const { service, updateCalls } = makeService(
      makeTicket({
        assignedAgentId: 'agent-a',
        reassignmentCount: 0,
        customerType: 'B2C',
        priority: 'HIGH',
        ticketTypeVersion: {
          escalationSnapshot: [
            { customerType: 'B2C', priority: 'HIGH', escalateOnSlaBreach: true, reassignmentThreshold: 1 },
          ],
        },
      }),
    );
    await service.assign(STAFF, 'ticket-1', 'agent-b');
    expect(updateCalls[0].isEscalated).toBe(true);
  });

  it('never re-escalates a ticket that is already escalated', async () => {
    const { service, updateCalls, notifyDepartmentManagers } = makeService(
      makeTicket({ assignedAgentId: 'agent-a', reassignmentCount: 5, isEscalated: true }),
    );
    await service.assign(STAFF, 'ticket-1', 'agent-b');
    expect(updateCalls[0]).not.toHaveProperty('isEscalated');
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });
});

describe('TicketsService.escalate — manual trigger', () => {
  it('is a no-op that returns the ticket unchanged if already escalated', async () => {
    const ticket = makeTicket({ isEscalated: true });
    const { service, prisma, notifyDepartmentManagers } = makeService(ticket);
    const result = await service.escalate(STAFF, 'ticket-1', 'still stuck');
    expect(result).toBe(ticket);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(notifyDepartmentManagers).not.toHaveBeenCalled();
  });

  it('flags the ticket, logs an audit entry, and notifies department managers', async () => {
    const { service, updateCalls, auditLogCalls, notifyDepartmentManagers } = makeService(makeTicket());
    await service.escalate(STAFF, 'ticket-1', 'need help');
    expect(updateCalls[0].isEscalated).toBe(true);
    expect(updateCalls[0].escalationReason).toBe(EscalationReason.MANUAL);
    expect(auditLogCalls[0].afterJson).toMatchObject({ reason: EscalationReason.MANUAL, note: 'need help' });
    expect(notifyDepartmentManagers).toHaveBeenCalledTimes(1);
  });
});

describe('TicketsService.acknowledgeEscalation', () => {
  it('refuses to acknowledge a ticket that was never escalated', async () => {
    const { service } = makeService(makeTicket({ isEscalated: false }));
    await expect(service.acknowledgeEscalation(STAFF, 'ticket-1')).rejects.toThrow(BadRequestException);
  });

  it('records who acknowledged an active escalation', async () => {
    const { service, updateCalls } = makeService(makeTicket({ isEscalated: true }));
    await service.acknowledgeEscalation(STAFF, 'ticket-1');
    expect(updateCalls[0].escalationAcknowledgedByUserId).toBe(STAFF.sub);
    expect(updateCalls[0].escalationAcknowledgedAt).toBeInstanceOf(Date);
  });

  it('also clears the related notification so the bell stops nagging once handled', async () => {
    const { service, markReadForTicket } = makeService(makeTicket({ isEscalated: true }));
    await service.acknowledgeEscalation(STAFF, 'ticket-1');
    expect(markReadForTicket).toHaveBeenCalledWith('ticket-1');
  });
});

describe('TicketsService.notifyManager — FYI, not an escalation', () => {
  it('never touches the ticket itself (no update call, no isEscalated flip)', async () => {
    const { service, prisma } = makeService(makeTicket());
    await service.notifyManager(STAFF, 'ticket-1', 'heads up');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('logs an audit entry and notifies department managers with the FYI type', async () => {
    const { service, auditLogCalls, notifyDepartmentManagers } = makeService(makeTicket());
    await service.notifyManager(STAFF, 'ticket-1', 'heads up');
    expect(auditLogCalls[0].action).toBe('TICKET_MANAGER_NOTIFIED');
    expect(auditLogCalls[0].afterJson).toMatchObject({ note: 'heads up' });
    expect(notifyDepartmentManagers).toHaveBeenCalledTimes(1);
    expect(notifyDepartmentManagers.mock.calls[0][2]).toBe('TICKET_MANAGER_FYI');
  });

  it('can be sent more than once (no idempotency guard, unlike escalate)', async () => {
    const { service, notifyDepartmentManagers } = makeService(makeTicket());
    await service.notifyManager(STAFF, 'ticket-1');
    await service.notifyManager(STAFF, 'ticket-1');
    expect(notifyDepartmentManagers).toHaveBeenCalledTimes(2);
  });
});

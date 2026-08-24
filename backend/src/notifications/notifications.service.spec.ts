import { NotFoundException } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { NotificationsService } from './notifications.service';

// The DEPT_ADMIN -> SUPER_ADMIN fallback is the whole point of
// notifyDepartmentManagers() — an escalation must never be silently dropped
// just because a department hasn't had a manager onboarded yet (see seed.ts).

function makeService(userFindManyImpl: (args: any) => any[]) {
  const notifyCalls: any[] = [];
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    user: { findMany: jest.fn().mockImplementation(userFindManyImpl) },
    notification: {
      createMany: jest.fn().mockImplementation(({ data }) => notifyCalls.push(...data)),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  const mailer = { sendMail };
  const service = new NotificationsService(prisma as any, mailer as any);
  return { service, prisma, notifyCalls, sendMail };
}

describe('NotificationsService.notifyDepartmentManagers', () => {
  it('notifies every active DEPT_ADMIN in the department when one exists', async () => {
    const { service, notifyCalls, sendMail } = makeService((args) =>
      args.where.role === StaffRole.DEPT_ADMIN
        ? [{ id: 'mgr-1', email: 'mgr1@co.com' }, { id: 'mgr-2', email: 'mgr2@co.com' }]
        : [],
    );
    await service.notifyDepartmentManagers('org-1', 'dept-tech', 'TICKET_ESCALATED', { ticketId: 't-1' }, {
      subject: 'Escalated',
      body: 'body',
    });
    expect(notifyCalls).toHaveLength(2);
    expect(notifyCalls.map((n) => n.recipientUserId).sort()).toEqual(['mgr-1', 'mgr-2']);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('falls back to org-wide SUPER_ADMINs when the department has no DEPT_ADMIN', async () => {
    const { service, notifyCalls } = makeService((args) =>
      args.where.role === StaffRole.SUPER_ADMIN ? [{ id: 'super-1', email: 'super@co.com' }] : [],
    );
    await service.notifyDepartmentManagers('org-1', 'dept-empty', 'TICKET_ESCALATED', { ticketId: 't-1' });
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].recipientUserId).toBe('super-1');
  });

  it('does not throw when nobody at all can be notified (no DEPT_ADMIN, no SUPER_ADMIN)', async () => {
    const { service, notifyCalls } = makeService(() => []);
    await expect(
      service.notifyDepartmentManagers('org-1', 'dept-empty', 'TICKET_ESCALATED', { ticketId: 't-1' }),
    ).resolves.not.toThrow();
    expect(notifyCalls).toHaveLength(0);
  });
});

describe('NotificationsService.markRead', () => {
  it("throws NotFoundException for someone else's notification", async () => {
    const prisma = {
      notification: { findUnique: jest.fn().mockResolvedValue({ id: 'n-1', recipientUserId: 'someone-else' }) },
    };
    const service = new NotificationsService(prisma as any, { sendMail: jest.fn() } as any);
    await expect(service.markRead('me', 'n-1')).rejects.toThrow(NotFoundException);
  });
});

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';

type Recipient = { id: string; email: string };
type EmailContent = { subject: string; body: string };

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  // In-app Notification rows are always written first and never depend on
  // email succeeding — see MailerService's resilience note. `email` is
  // optional per call site; omit it for notification types that don't need one.
  async notify(recipients: Recipient[], type: string, payload: Record<string, unknown>, email?: EmailContent) {
    if (recipients.length === 0) {
      this.logger.warn(`notify("${type}") had nobody to notify — check department manager staffing`);
      return;
    }
    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        recipientType: 'STAFF',
        recipientUserId: r.id,
        type,
        payload: payload as Prisma.InputJsonValue,
      })),
    });
    if (email) {
      await Promise.all(recipients.map((r) => this.mailer.sendMail(r.email, email.subject, email.body)));
    }
  }

  /** The escalation fan-out target: every active DEPT_ADMIN in the ticket's
   * department. If a department somehow has none (nobody's been onboarded as
   * its manager yet — see seed.ts), falls back to every active org-wide
   * SUPER_ADMIN, so an escalation is never silently dropped. */
  async notifyDepartmentManagers(
    orgId: string,
    departmentId: string,
    type: string,
    payload: Record<string, unknown>,
    email?: EmailContent,
  ) {
    let managers = await this.prisma.user.findMany({
      where: { departmentId, role: StaffRole.DEPT_ADMIN, isActive: true },
      select: { id: true, email: true },
    });
    if (managers.length === 0) {
      managers = await this.prisma.user.findMany({
        where: { orgId, role: StaffRole.SUPER_ADMIN, isActive: true },
        select: { id: true, email: true },
      });
    }
    await this.notify(managers, type, payload, email);
  }

  listMine(userId: string) {
    // Unpaginated + capped, same v1 scope as every other list endpoint in
    // this codebase (tickets, departments, ticket-types) — fine at this scale.
    return this.prisma.notification.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { recipientUserId: userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    // Not yours (or doesn't exist) reads identically — same pattern as
    // tickets.service.ts's getMineOrThrow.
    if (!notification || notification.recipientUserId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  /** Called from tickets.service.ts's acknowledgeEscalation() — once a
   * manager has handled a ticket, the notification that told them about it
   * shouldn't keep nagging the bell. Marks every unread notification that
   * references this ticket (any type — escalation or FYI) as read, for
   * whoever received it, not just the person who clicked Acknowledge. */
  async markReadForTicket(ticketId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { readAt: null, payload: { path: ['ticketId'], equals: ticketId } },
      data: { readAt: new Date() },
    });
  }
}

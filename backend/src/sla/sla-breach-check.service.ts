import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EscalationReason, EscalationRuleEntry, resolveEscalationRule } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type StatusSchemaSnapshot = { statuses: { key: string; isTerminal: boolean }[] };

// The automatic half of the escalation engine's SLA_BREACH trigger — the
// manual (agent-pressed) and REASSIGNMENT_THRESHOLD triggers live in
// tickets.service.ts's escalate()/assign(). This job is what
// app.module.ts's ScheduleModule.forRoot() comment ("powers the SLA
// breach-check job, next") was left pointing at.
@Injectable()
export class SlaBreachCheckService {
  private readonly logger = new Logger(SlaBreachCheckService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkBreaches() {
    const now = new Date();
    const candidates = await this.prisma.ticket.findMany({
      where: {
        isEscalated: false,
        isArchived: false, // a "removed" ticket shouldn't get auto-escalated
        OR: [
          { responseDueAt: { lt: now }, firstRespondedAt: null },
          { resolutionDueAt: { lt: now }, resolvedAt: null },
        ],
      },
      select: {
        id: true,
        orgId: true,
        departmentId: true,
        ticketNumber: true,
        subject: true,
        statusKey: true,
        customerType: true,
        priority: true,
        department: { select: { key: true } },
        ticketTypeVersion: { select: { statusSchemaSnapshot: true, escalationSnapshot: true } },
      },
    });

    let escalatedCount = 0;
    for (const ticket of candidates) {
      const schema = ticket.ticketTypeVersion.statusSchemaSnapshot as unknown as StatusSchemaSnapshot;
      const isTerminal = schema.statuses.find((s) => s.key === ticket.statusKey)?.isTerminal ?? false;
      if (isTerminal) continue;

      const rule = resolveEscalationRule(
        ticket.ticketTypeVersion.escalationSnapshot as unknown as EscalationRuleEntry[] | null,
        ticket.customerType,
        ticket.priority,
      );
      if (!rule.escalateOnSlaBreach) continue;

      // The isEscalated:false guard makes this idempotent/race-safe if two
      // runs ever overlap — count is 0 if another run already claimed it.
      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, isEscalated: false },
        data: { isEscalated: true, escalatedAt: now, escalationReason: EscalationReason.SLA_BREACH },
      });
      if (count === 0) continue;

      await this.prisma.auditLog.create({
        data: {
          orgId: ticket.orgId,
          actorType: 'SYSTEM',
          action: 'TICKET_ESCALATED',
          entityType: 'Ticket',
          entityId: ticket.id,
          afterJson: { reason: EscalationReason.SLA_BREACH },
        },
      });

      const displayId = `${ticket.department.key}-${ticket.ticketNumber}`;
      await this.notifications.notifyDepartmentManagers(
        ticket.orgId,
        ticket.departmentId,
        'TICKET_ESCALATED',
        { ticketId: ticket.id, displayId, subject: ticket.subject, reason: EscalationReason.SLA_BREACH },
        {
          subject: `[${displayId}] Escalated — SLA breached`,
          body: `Ticket ${displayId} ("${ticket.subject}") missed its SLA deadline and has been escalated. Please review it in the Ticket Platform.`,
        },
      );
      escalatedCount += 1;
    }

    if (escalatedCount > 0) {
      this.logger.log(`SLA breach check: escalated ${escalatedCount} ticket(s)`);
    }
  }
}

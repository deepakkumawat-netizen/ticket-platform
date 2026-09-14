import { EscalationReason } from '@ticket-platform/shared';
import type { NotificationsService } from './notifications.service';

// Shared by tickets.service.ts (manual escalate + the reassignment-threshold
// auto-escalate in assign()) and sla-breach-check.service.ts (the SLA_BREACH
// cron trigger) — all three escalation triggers previously built this same
// "notify the department's managers" email independently, and had already
// drifted into slightly different wording for the same event (found in the
// 2026-09-14 review). One function now, one place to change the wording.
const REASON_LABELS: Record<EscalationReason, string> = {
  [EscalationReason.SLA_BREACH]: 'SLA breach',
  [EscalationReason.MANUAL]: 'manually escalated',
  [EscalationReason.REASSIGNMENT_THRESHOLD]: 'reassigned too many times',
};

export type EscalatableTicket = {
  id: string;
  departmentId: string;
  ticketNumber: number;
  subject: string;
  department: { key: string };
};

export async function notifyEscalation(
  notifications: NotificationsService,
  orgId: string,
  ticket: EscalatableTicket,
  reason: EscalationReason,
): Promise<void> {
  const displayId = `${ticket.department.key}-${ticket.ticketNumber}`;
  const reasonLabel = REASON_LABELS[reason] ?? reason.replace(/_/g, ' ').toLowerCase();
  await notifications.notifyDepartmentManagers(
    orgId,
    ticket.departmentId,
    'TICKET_ESCALATED',
    { ticketId: ticket.id, displayId, subject: ticket.subject, reason },
    {
      subject: `[${displayId}] Escalated — ${reasonLabel}`,
      body: `Ticket ${displayId} ("${ticket.subject}") has been escalated (${reasonLabel}). Please review it in the Ticket Platform.`,
    },
  );
}

import { CustomerType } from './enums';

// The escalation-equivalent of SlaRule — one row per department+ticket-type
// per customerType×priority, frozen into TicketTypeVersion.escalationSnapshot
// on publish (see ticket-types.service.ts's publish()). Unlike SlaRule this
// is OPTIONAL: a priority with no configured rule (or a version published
// before this feature existed, where the whole snapshot is null) just uses
// DEFAULT_ESCALATION_RULE below — see resolveEscalationRule().
export type EscalationRuleEntry = {
  customerType: CustomerType;
  priority: string;
  escalateOnSlaBreach: boolean;
  reassignmentThreshold: number | null;
};

export const DEFAULT_ESCALATION_RULE: Omit<EscalationRuleEntry, 'customerType' | 'priority'> = {
  escalateOnSlaBreach: true,
  reassignmentThreshold: 2,
};

/** The one place "what escalation policy applies to this ticket" is decided
 * — called from both tickets.service.ts (reassignment-threshold check on
 * assign()) and the SLA breach-check cron job, so the two triggers can never
 * quietly disagree about what a ticket's rule is. `snapshot` is a ticket's
 * OWN frozen `ticketTypeVersion.escalationSnapshot` (null on versions
 * published before this feature existed). */
export function resolveEscalationRule(
  snapshot: EscalationRuleEntry[] | null | undefined,
  customerType: CustomerType,
  priority: string,
): Omit<EscalationRuleEntry, 'customerType' | 'priority'> {
  const rule = snapshot?.find((r) => r.customerType === customerType && r.priority === priority);
  if (!rule) return DEFAULT_ESCALATION_RULE;
  return { escalateOnSlaBreach: rule.escalateOnSlaBreach, reassignmentThreshold: rule.reassignmentThreshold };
}

import { HistoryEntry } from '../../lib/api';

// The "where's my ticket" view Deepak asked for (2026-08-25) — a delivery-
// tracker-style vertical timeline over the ticket's real history (every
// entry already existed in AuditLog; this is just a friendly read of it).
// Oldest first, like a parcel's tracking page: "Order placed" at the top,
// working down to wherever it is now — the last entry is the current step.
function describe(entry: HistoryEntry): { icon: string; text: string } {
  const after = entry.afterJson as Record<string, unknown> | null;
  switch (entry.action) {
    case 'TICKET_CREATED':
      return { icon: '📝', text: 'Ticket raised' };
    case 'TICKET_ASSIGNED':
    case 'TICKET_AUTO_ASSIGNED': {
      const agentName = after?.agentName as string | undefined;
      return agentName ? { icon: '👤', text: `Assigned to ${agentName}` } : { icon: '👤', text: 'Moved back to Unassigned' };
    }
    case 'TICKET_STATUS_CHANGED': {
      const label = (after?.label as string | undefined) ?? (after?.statusKey as string | undefined) ?? 'a new status';
      return { icon: '🔧', text: `Status changed to "${label}"` };
    }
    case 'TICKET_ESCALATED':
      return { icon: '🚩', text: 'Escalated to the manager' };
    case 'TICKET_ESCALATION_ACKNOWLEDGED':
      return { icon: '✅', text: 'Escalation acknowledged by the manager' };
    case 'TICKET_MANAGER_NOTIFIED':
      return { icon: '📣', text: 'Manager given an FYI update' };
    case 'TICKET_ARCHIVED':
      return { icon: '📦', text: 'Archived' };
    case 'TICKET_UNARCHIVED':
      return { icon: '📤', text: 'Unarchived' };
    default:
      return { icon: '•', text: entry.action.replace(/_/g, ' ').toLowerCase() };
  }
}

export function TicketTracker({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="ticket-tracker">
      <h2>Tracking</h2>
      <ol className="tracker-list">
        {entries.map((entry, i) => {
          const { icon, text } = describe(entry);
          const isCurrent = i === entries.length - 1;
          return (
            <li key={entry.id} className={`tracker-step${isCurrent ? ' tracker-step-current' : ''}`}>
              <span className="tracker-icon">{icon}</span>
              <div className="tracker-step-body">
                <span className="tracker-step-text">{text}</span>
                <span className="tracker-step-meta">
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.actorUser && ` · ${entry.actorUser.name}`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

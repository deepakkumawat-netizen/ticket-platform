import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, staffToken, ticketDisplayId, TicketDetail } from '../../lib/api';

// Read-only — an employee can see their own ticket's status/history but
// can't assign or transition it, that's staff work. See TicketDetailPage
// for the staff-facing equivalent with those controls.
export function MyTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = staffToken.get();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getMyTicket(id, token).then(setTicket).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'));
  }, [id, token]);

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  const currentLabel = ticket.ticketTypeVersion.statusSchemaSnapshot.statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>
          <span className="ticket-id-badge">{ticketDisplayId(ticket)}</span> {ticket.subject}
        </h1>
        <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
      </div>

      <p className="ticket-meta">
        {ticket.department.name} · {ticket.ticketTypeDefinition.name} · raised {new Date(ticket.createdAt).toLocaleString()}
      </p>

      <p className="status-line">
        Status: <strong>{currentLabel}</strong>
      </p>

      <section className="ticket-description">
        <h2>Description</h2>
        <p>{ticket.description}</p>
      </section>

      {Object.keys(ticket.customFields).length > 0 && (
        <section className="ticket-custom-fields">
          <h2>Details</h2>
          <dl>
            {Object.entries(ticket.customFields).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="ticket-sla">
        <h2>Response time</h2>
        <dl>
          <div>
            <dt>Expected by</dt>
            <dd>{ticket.responseDueAt ? new Date(ticket.responseDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>First response</dt>
            <dd>{ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt).toLocaleString() : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : 'Not yet'}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

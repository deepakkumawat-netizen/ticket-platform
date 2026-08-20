import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, ticketDisplayId, TicketSummary } from '../../lib/api';

// The EMPLOYEE-facing view: only tickets this person raised, across every
// department — no queue, no assignment, no admin surface. See
// tickets.service.ts's listMine for the scoping (by requester, not department).
export function MyTicketsPage() {
  const token = staffToken.get();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listMyTickets(token)
      .then(setTickets)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your tickets'));
  }, [token]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>My Tickets</h1>
        <Link to="/app/my-tickets/new" className="button-link">
          + Raise a ticket
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      {tickets === null ? (
        <p>Loading…</p>
      ) : (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>Department</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Raised</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td className="ticket-id-cell">
                  <Link to={`/app/my-tickets/${t.id}`}>{ticketDisplayId(t)}</Link>
                </td>
                <td>
                  <Link to={`/app/my-tickets/${t.id}`}>{t.subject}</Link>
                </td>
                <td>{t.department.name}</td>
                <td>
                  <span className={`priority-chip priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                </td>
                <td>{t.statusKey}</td>
                <td>{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  You haven't raised any tickets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

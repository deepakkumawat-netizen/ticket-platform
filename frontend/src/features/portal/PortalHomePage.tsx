import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, customerToken, useCustomerToken, ticketDisplayId, TicketSummary } from '../../lib/api';

// Read-only in v1 — see api.listPortalTickets's comment on why there's no
// creation UI here yet (the public /contact form, not a portal login, is
// the actual "no staff login" intake path today). Reuses
// TicketsService.listForPortalCustomer on the backend, scoped by
// customerScopeWhere (a B2B contact's whole company, or a standalone B2C
// customer's own tickets).
export function PortalHomePage() {
  const navigate = useNavigate();
  const token = useCustomerToken();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPortalTickets(token)
      .then(setTickets)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your tickets'));
  }, [token]);

  function signOut() {
    customerToken.clear();
    navigate('/portal/login');
  }

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>My Tickets</h1>
        <button onClick={signOut}>Sign out</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !tickets && <p>Loading…</p>}
      {tickets && tickets.length === 0 && <p>You haven't raised any tickets yet.</p>}

      {tickets && tickets.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Raised</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>{ticketDisplayId(t)}</td>
                <td>{t.subject}</td>
                <td>{t.statusKey}</td>
                <td>{t.priority}</td>
                <td>{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

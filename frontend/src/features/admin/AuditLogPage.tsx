import { useEffect, useState } from 'react';
import { api, staffToken, AuditLogEntry } from '../../lib/api';

// SUPER_ADMIN-only browser over the AuditLog table — every row already
// existed before this (written by tickets/sla/intake services); this is
// purely a new read surface, not a new write path. Ticket-scoped history
// already existed (TicketTracker on the ticket detail page); this is the
// first cross-entity, org-wide view of the same table.
export function AuditLogPage() {
  const token = staffToken.get();
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAuditLog({ entityType: entityType || undefined, action: action || undefined }, token)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the audit log'));
  }, [entityType, action, token]);

  return (
    <div className="page-shell">
      <h1>Audit Log</h1>
      <p className="dash-subtitle">Every meaningful change across the platform — nothing here is ever deleted.</p>

      <div className="row-actions" style={{ marginBottom: 16 }}>
        <input placeholder="Filter by entity type (e.g. Ticket)" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        <input placeholder="Filter by action (e.g. TICKET_ESCALATED)" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !entries && <p>Loading…</p>}

      {entries && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actorUser ? `${e.actorUser.name} (${e.actorUser.role.replace('_', ' ')})` : e.actorType}</td>
                <td>{e.action.replace(/_/g, ' ')}</td>
                <td>
                  {e.entityType} #{e.entityId.slice(0, 8)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-row">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

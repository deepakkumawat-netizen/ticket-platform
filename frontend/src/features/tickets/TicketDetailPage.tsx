import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, staffToken, staffUser, ticketDisplayId, StaffMember, TicketDetail } from '../../lib/api';

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = staffToken.get();
  const me = staffUser.get();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api.getTicket(id, token).then(setTicket).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'));
  }, [id, token]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    // departmentId isn't in the summary shape TicketDetail carries directly,
    // but assignment needs the department's staff list — fetch it once we
    // know who's assigned (or just from the logged-in staff's own department
    // for the common case where staff work their own department's queue).
    if (me?.departmentId) api.listDepartmentUsers(me.departmentId, token).then(setStaffMembers);
  }, [me?.departmentId, token]);

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  const statuses = ticket.ticketTypeVersion.statusSchemaSnapshot.statuses;
  const currentLabel = statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;
  const availableMoves = ticket.ticketTypeVersion.statusSchemaSnapshot.transitions.filter(
    (t) =>
      t.fromStatusKey === ticket.statusKey &&
      (t.allowedRoles.length === 0 || t.allowedRoles.includes(me?.role ?? '') || me?.role === 'SUPER_ADMIN'),
  );

  async function onAssign(agentId: string) {
    if (!ticket) return;
    setTicket(await api.assignTicket(ticket.id, agentId || null, token));
  }

  async function onTransition(toStatusKey: string) {
    if (!ticket) return;
    try {
      setTicket(await api.transitionTicket(ticket.id, toStatusKey, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change status');
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>
          <span className="ticket-id-badge">{ticketDisplayId(ticket)}</span> {ticket.subject}
        </h1>
        <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
      </div>

      <p className="ticket-meta">
        {ticket.ticketTypeDefinition.name} · {ticket.customer.name} ({ticket.customer.email})
        {ticket.company && ` · ${ticket.company.name}`} · opened {new Date(ticket.createdAt).toLocaleString()}
      </p>

      <p className="status-line">
        Status: <strong>{currentLabel}</strong>
        {availableMoves.map((m) => {
          const label = statuses.find((s) => s.key === m.toStatusKey)?.label ?? m.toStatusKey;
          return (
            <button key={m.toStatusKey} className="status-move" onClick={() => onTransition(m.toStatusKey)}>
              → {label}
            </button>
          );
        })}
      </p>

      <label className="inline-filter">
        Assigned to
        <select value={ticket.assignedAgent?.id ?? ''} onChange={(e) => onAssign(e.target.value)}>
          <option value="">Unassigned</option>
          {staffMembers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

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
        <h2>SLA</h2>
        <dl>
          <div>
            <dt>Response due</dt>
            <dd>{ticket.responseDueAt ? new Date(ticket.responseDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Resolution due</dt>
            <dd>{ticket.resolutionDueAt ? new Date(ticket.resolutionDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>First responded</dt>
            <dd>{ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

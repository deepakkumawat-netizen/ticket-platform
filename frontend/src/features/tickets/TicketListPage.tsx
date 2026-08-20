import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, staffUser, ticketDisplayId, Department, StaffMember, TicketSummary } from '../../lib/api';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export function TicketListPage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);

  const [priority, setPriority] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => {
        const active = all.filter((d) => d.isActive);
        setDepartments(active);
        // Without this, the <select> visually defaults to showing the first
        // option while departmentId (React state) stays '' — every effect
        // below keys off departmentId, so nothing would ever load.
        if (!departmentId && active[0]) setDepartmentId(active[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (departmentId) api.listDepartmentUsers(departmentId, token).catch(() => []).then((members) => setStaffMembers(members ?? []));
  }, [departmentId, token]);

  useEffect(() => {
    if (!departmentId) return;
    setError(null);
    api
      .listTickets(departmentId, { priority: priority || undefined, assignedAgentId: assignedAgentId || undefined, search: search || undefined }, token)
      .then(setTickets)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load tickets'));
  }, [departmentId, priority, assignedAgentId, search, token]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Tickets</h1>
        <Link to="/app/tickets/new" className="button-link">
          + New ticket
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      {isSuperAdmin && (
        <label className="inline-filter">
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="" disabled>
              Select a department…
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="filter-row">
        <input placeholder="Search subject/description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)}>
          <option value="">All assignees</option>
          {staffMembers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <table className="ticket-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Subject</th>
            <th>Type</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Assignee</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td className="ticket-id-cell">
                <Link to={`/app/tickets/${t.id}`}>{ticketDisplayId(t)}</Link>
              </td>
              <td>
                <Link to={`/app/tickets/${t.id}`}>{t.subject}</Link>
              </td>
              <td>{t.ticketTypeDefinition.name}</td>
              <td>
                <span className={`priority-chip priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
              </td>
              <td>{t.statusKey}</td>
              <td>{t.assignedAgent?.name ?? 'Unassigned'}</td>
              <td>{new Date(t.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {tickets.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-row">
                No tickets match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, staffUser, Department, TicketTypeSummary } from '../../lib/api';

// SUPER_ADMIN/DEPT_ADMIN — the entry point into the low-code ticket-type
// builder (previously API-only, see TicketTypeBuilderPage for the actual
// field/status/SLA authoring). Same "SUPER_ADMIN picks a department,
// DEPT_ADMIN is pinned to their own" pattern as DepartmentDashboardPage.
export function TicketTypesAdminPage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => {
        setDepartments(all);
        setDepartmentId((current) => current || all[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!departmentId) return;
    setError(null);
    setTicketTypes(null);
    api
      .listTicketTypes(departmentId, token)
      .then(setTicketTypes)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load ticket types'));
  }, [departmentId, token]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!departmentId) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createTicketTypeDefinition(
        departmentId,
        { key: newKey.trim(), name: newName.trim(), description: newDescription.trim() || undefined },
        token,
      );
      setTicketTypes((prev) => [...(prev ?? []), created]);
      setNewKey('');
      setNewName('');
      setNewDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this ticket type');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>Ticket Types</h1>
      <p className="dash-subtitle">
        What an employee can raise a ticket for in this department — its fields, statuses, and SLA rules. A ticket type
        needs a Publish (from its builder page) before anyone can actually use it.
      </p>

      {isSuperAdmin && (
        <label className="inline-filter">
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {ticketTypes === null ? (
        <p>Loading…</p>
      ) : (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ticketTypes.map((t) => (
              <tr key={t.id}>
                <td>
                  <code>{t.key}</code>
                </td>
                <td>{t.name}</td>
                <td>
                  <span className={`dept-status ${t.isActive ? 'dept-status-live' : 'dept-status-off'}`}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <Link to={`/app/ticket-types/${t.id}`}>Open builder →</Link>
                </td>
              </tr>
            ))}
            {ticketTypes.length === 0 && (
              <tr>
                <td colSpan={4}>No ticket types yet in this department — create one below.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h2>New ticket type</h2>
      <form className="ticket-form" onSubmit={onCreate}>
        <label>
          Key
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. bug-report" required />
        </label>
        <label>
          Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Bug Report" required />
        </label>
        <label>
          Description (optional)
          <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
        </label>
        <button type="submit" disabled={creating || !departmentId}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, staffUser, Department, TicketTypeSummary } from '../../lib/api';

// A department key like "affected-system-check" from a typed name — lets
// the create form ask for just a Name, never a separate "key" field (a
// technical identifier concept a non-technical admin shouldn't need to
// learn). A collision (two names that slugify the same) is still caught
// server-side with a clear message — see quickCreateDefinition's pre-check.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// SUPER_ADMIN/DEPT_ADMIN — the entry point into ticket-type setup. Simplified
// 2026-08-25 per Deepak's feedback ("too hard for a non-technical admin to
// follow") — creating one is now "type a name, click one button" and it's
// immediately usable (see api.ts's quickCreateTicketType / the backend's
// quickCreateDefinition for the sane defaults this fills in automatically:
// Open/In Progress/Resolved statuses, the moves between them, and a full SLA
// matrix). The full field/status/SLA builder (TicketTypeBuilderPage) still
// exists for anyone who wants to add extra questions or tune the defaults —
// linked below as "Customize", clearly optional, not required to get going.
export function TicketTypesAdminPage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
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
    if (!departmentId || !newName.trim()) return;
    setCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const created = await api.quickCreateTicketType(departmentId, { key: slugify(newName), name: newName.trim() }, token);
      setTicketTypes((prev) => [...(prev ?? []), created]);
      setSuccessMessage(`✅ "${created.name}" is ready to use right now — no extra steps needed.`);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this ticket type');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>Ticket Types</h1>
      <p className="dash-subtitle">What an employee can raise a ticket about in this department. Type a name below to add a new one — it's ready to use immediately.</p>

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
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ticketTypes.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <span className={`dept-status ${t.isActive ? 'dept-status-live' : 'dept-status-off'}`}>
                    {t.isActive ? 'Ready to use' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <Link to={`/app/ticket-types/${t.id}`}>Customize (optional) →</Link>
                </td>
              </tr>
            ))}
            {ticketTypes.length === 0 && (
              <tr>
                <td colSpan={3}>None yet — add one below.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h2>Add a new one</h2>
      <form className="ticket-form" onSubmit={onCreate}>
        <label>
          Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Bug Report" required />
        </label>
        <button type="submit" disabled={creating || !departmentId || !newName.trim()}>
          {creating ? 'Creating…' : 'Create — ready to use right away'}
        </button>
      </form>

      {successMessage && <p className="notify-manager-confirm">{successMessage}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

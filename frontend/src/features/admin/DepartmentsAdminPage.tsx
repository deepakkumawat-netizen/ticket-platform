import { useEffect, useState } from 'react';
import { api, staffToken, Department } from '../../lib/api';

// SUPER_ADMIN only — turns a department "live" for the phased rollout
// (TECH first, per the plan; this is how the next ones get switched on).
// Activating one with no ticket type yet auto-provisions a default
// "General Support" ticket type on the backend (see departments.service.ts),
// so flipping the toggle here is a one-click, fully-working action.
export function DepartmentsAdminPage() {
  const token = staffToken.get();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listDepartments(token)
      .then(setDepartments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [token]);

  async function onToggle(dept: Department) {
    setError(null);
    setBusyId(dept.id);
    try {
      const updated = await api.updateDepartment(dept.id, { isActive: !dept.isActive }, token);
      setDepartments((prev) => prev?.map((d) => (d.id === updated.id ? updated : d)) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this department');
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!departments) return <p>Loading…</p>;

  return (
    <div className="page-shell">
      <h1>Departments</h1>
      <p className="dash-subtitle">
        Turn a department on to make it usable — activating one with no ticket type yet automatically sets up a
        default "General Support" ticket type so it works immediately.
      </p>

      <table className="ticket-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>
                <span className={`dept-status ${d.isActive ? 'dept-status-live' : 'dept-status-off'}`}>
                  {d.isActive ? 'Live' : 'Off'}
                </span>
              </td>
              <td>
                <button type="button" onClick={() => onToggle(d)} disabled={busyId === d.id}>
                  {busyId === d.id ? 'Working…' : d.isActive ? 'Turn off' : 'Turn on'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

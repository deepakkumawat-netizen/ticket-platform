import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, DirectoryUser } from '../../lib/api';

const ROLE_ORDER = ['SUPER_ADMIN', 'DEPT_ADMIN', 'AGENT', 'EMPLOYEE'];

// "How many people use this tool, and who are they" — SUPER_ADMIN only.
// A read-only roster; onboarding a new login still happens on CreateUserPage.
export function UserDirectoryPage() {
  const token = staffToken.get();
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listUserDirectory(token)
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the team directory'));
  }, [token]);

  if (error) return <p className="error">{error}</p>;
  if (!users) return <p>Loading…</p>;

  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Team Directory</h1>
        <Link to="/app/team/new" className="button-link">
          + Add Team Member
        </Link>
      </div>
      <p className="dash-subtitle">Every login in the system — {users.length} total.</p>

      <div className="stat-cards">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="stat-card">
            <span className="stat-value">{counts.get(role) ?? 0}</span>
            <span className="stat-label">{role.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <table className="ticket-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Department</th>
            <th>Status</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.isActive ? undefined : 'ticket-row-inactive'}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role.replace('_', ' ')}</td>
              <td>{u.department?.name ?? '—'}</td>
              <td>{u.isActive ? 'Active' : 'Deactivated'}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-row">
                No logins yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

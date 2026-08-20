import { FormEvent, useEffect, useState } from 'react';
import { api, staffToken, Department } from '../../lib/api';

const ROLES = ['SUPER_ADMIN', 'DEPT_ADMIN', 'AGENT', 'EMPLOYEE'];
const NEEDS_DEPARTMENT = new Set(['DEPT_ADMIN', 'AGENT']);

// SUPER_ADMIN-only onboarding screen — the only way a login gets created in
// this v1 (no self-signup, no email delivery). See UsersService.create.
export function CreateUserPage() {
  const token = staffToken.get();
  const [departments, setDepartments] = useState<Department[]>([]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; temporaryPassword: string } | null>(null);

  useEffect(() => {
    api.listDepartments(token).then(setDepartments).catch(() => {});
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.createUser(
        { name, email, role, departmentId: NEEDS_DEPARTMENT.has(role) ? departmentId : undefined },
        token,
      );
      setCreated(user);
      setName('');
      setEmail('');
      setDepartmentId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this login');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>Add a Team Member</h1>
      <p className="dash-subtitle">Creates a login. There's no email delivery yet — copy the password shown below and share it directly.</p>

      {created && (
        <div className="callout-success">
          <strong>{created.name}</strong> ({created.email}) can now sign in with:
          <div className="temp-password">{created.temporaryPassword}</div>
          <p>This is shown once and isn't stored anywhere — save it now.</p>
        </div>
      )}

      <form className="ticket-form" onSubmit={onSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {NEEDS_DEPARTMENT.has(role) && (
          <label>
            Department
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
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

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create login'}
        </button>
      </form>
    </div>
  );
}

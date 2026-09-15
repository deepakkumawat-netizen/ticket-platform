import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, staffToken, staffUser } from '../../lib/api';
import { AuthShell } from './AuthShell';

// Public, EMPLOYEE-only — see auth.service.ts's signupEmployee. Anyone can
// create an account here, but it can only ever raise/read its own tickets.
export function StaffSignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      const { accessToken, user } = await api.staffSignup(name, email, password);
      staffToken.set(accessToken);
      staffUser.set(user);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="For raising and tracking your own tickets — support staff accounts are created by an admin.">
      <form className="auth-form" onSubmit={onSubmit} autoComplete="off">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          Work email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/staff/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

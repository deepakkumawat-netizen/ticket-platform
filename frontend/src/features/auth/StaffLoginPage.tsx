import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, staffToken, staffUser } from '../../lib/api';
import { getRecaptchaToken } from '../../lib/recaptcha';
import { AuthShell } from './AuthShell';

export function StaffLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const captchaToken = await getRecaptchaToken('login');
      const { accessToken, user } = await api.staffLogin(email, password, captchaToken);
      staffToken.set(accessToken);
      staffUser.set(user);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your work account to raise, track, or manage tickets.">
      {/* autoComplete="off" on both the form and each field stops the browser
          from silently pre-filling a previously saved login on page load —
          important here since staff routinely switch between several test
          accounts (admin/agent/manager), not just one personal login. */}
      <form className="auth-form" onSubmit={onSubmit} autoComplete="off">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="off" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="auth-switch">
        New here? <Link to="/staff/signup">Create an account</Link>
      </p>
    </AuthShell>
  );
}

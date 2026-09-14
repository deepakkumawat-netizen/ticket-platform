import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, customerToken } from '../../lib/api';
import { getRecaptchaToken } from '../../lib/recaptcha';
import { RecaptchaDisclosure } from '../../components/RecaptchaDisclosure';

export function PortalLoginPage() {
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
      const captchaToken = await getRecaptchaToken('portal_login');
      const { accessToken } = await api.portalLogin(email, password, captchaToken);
      customerToken.set(accessToken);
      navigate('/portal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Customer Portal Sign In</h1>
      <form onSubmit={onSubmit} autoComplete="off">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
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
      <RecaptchaDisclosure />
    </div>
  );
}

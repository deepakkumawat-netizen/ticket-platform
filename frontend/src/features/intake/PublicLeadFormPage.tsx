import { FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { getRecaptchaToken } from '../../lib/recaptcha';
import { RecaptchaDisclosure } from '../../components/RecaptchaDisclosure';
import { AuthShell } from '../auth/AuthShell';

// The one genuinely public, unauthenticated page in the app — no login, no
// staff account. Submitting here never creates a Ticket directly (see
// backend's IntakeQuery) — it lands in the staff triage queue
// (IntakeQueuePage), where a human reviews, confirms/overrides the
// department, and converts it into a real ticket.
export function PublicLeadFormPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  // Honeypot — hidden from real visitors via CSS below, a bot filling every
  // field blindly fills this too. See CreateIntakeQueryDto's @MaxLength(0).
  const [website, setWebsite] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (website) return; // silently drop — see honeypot comment above
    setError(null);
    setSubmitting(true);
    try {
      const captchaToken = await getRecaptchaToken('intake_query');
      await api.submitIntakeQuery(
        { name, email, phone: phone || undefined, companyName: companyName || undefined, subject, description },
        captchaToken,
      );
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell title="Thanks!" subtitle="We've received your message and will get back to you soon.">
        <p>You don't need to do anything else — a member of our team will follow up by email.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Get in touch" subtitle="Tell us what's going on and we'll route it to the right team.">
      <form className="auth-form" onSubmit={onSubmit} autoComplete="off">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          Phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Company (optional)
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
        </label>
        <label>
          What can we help with?
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required maxLength={5000} />
        </label>
        {/* Honeypot: visually hidden, never shown to a real visitor. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send message'}
        </button>
      </form>
      <RecaptchaDisclosure />
    </AuthShell>
  );
}

import { ReactNode } from 'react';

// Shared two-panel shell for the staff login/signup screens — branding on
// the left, the actual form (passed as children) on the right. Matches the
// sidebar's sky-blue + indigo palette from the staff app itself, rather
// than the plain unstyled card these pages started as.
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-branding">
        <div className="auth-brand-mark">
          <span className="auth-brand-logo">TP</span>
          <span>Ticket Platform</span>
        </div>
        <h1>Internal helpdesk, all in one place</h1>
        <ul className="auth-feature-list">
          <li>Raise a ticket in seconds, track it to resolution</li>
          <li>Live department dashboards — status, SLAs, workload</li>
          <li>AI-assisted triage and draft replies</li>
        </ul>
      </div>
      <div className="auth-form-panel">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

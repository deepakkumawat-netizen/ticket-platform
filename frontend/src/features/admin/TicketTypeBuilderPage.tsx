import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, staffToken, TicketTypeDefinitionAdmin } from '../../lib/api';

const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'USER_REF', 'COMPANY_REF'];
const APPLIES_TO = ['BOTH', 'B2B', 'B2C'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const CUSTOMER_TYPES = ['B2C', 'B2B'] as const;
const ROLES_FOR_TRANSITIONS = ['AGENT', 'DEPT_ADMIN'];

// SUPER_ADMIN/DEPT_ADMIN — the actual low-code authoring surface (fields,
// statuses, transitions, SLA rules, escalation rules), previously API-only.
// Everything the backend accepts here is append-only in v1 (no edit/delete —
// see ticket-types.service.ts's comment on why), so this page is a set of
// "add" forms plus read-only tables of what's already there, not a full
// editor. Publish freezes the current draft into an immutable version once
// it's ready to actually be used.
export function TicketTypeBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const token = staffToken.get();
  const [def, setDef] = useState<TicketTypeDefinitionAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  function load() {
    if (!id) return;
    api
      .getTicketTypeAdminDetail(id, token)
      .then(setDef)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this ticket type'));
  }

  useEffect(load, [id, token]);

  async function onPublish() {
    if (!id) return;
    setPublishing(true);
    setError(null);
    setPublishMessage(null);
    try {
      const result = await api.publishTicketType(id, token);
      setPublishMessage(`✅ Published as version ${result.versionNumber} — this is now live for new tickets.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish — check the requirements below');
    } finally {
      setPublishing(false);
    }
  }

  if (error && !def) return <p className="error">{error}</p>;
  if (!def) return <p>Loading…</p>;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>
          {def.name} <span className="ticket-id-badge">{def.key}</span>
        </h1>
        <button type="button" className="builder-publish-button" onClick={onPublish} disabled={publishing}>
          {publishing ? 'Publishing…' : '🚀 Publish'}
        </button>
      </div>
      <p className="dash-subtitle">
        Publishing needs at least one status marked "initial" and at least one SLA rule — you'll get a clear error below
        if something's missing.
      </p>
      {publishMessage && <p className="notify-manager-confirm">{publishMessage}</p>}
      {error && <p className="error">{error}</p>}

      <FieldsSection def={def} token={token} onChanged={load} />
      <StatusesSection def={def} token={token} onChanged={load} />
      <TransitionsSection def={def} token={token} onChanged={load} />
      <SlaRulesSection def={def} token={token} onChanged={load} />
      <EscalationRulesSection def={def} token={token} onChanged={load} />
      <VersionsSection def={def} />
    </div>
  );
}

type SectionProps = { def: TicketTypeDefinitionAdmin; token: string | null; onChanged: () => void };

function FieldsSection({ def, token, onChanged }: SectionProps) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('TEXT');
  const [appliesTo, setAppliesTo] = useState('BOTH');
  const [required, setRequired] = useState(false);
  // Only meaningful for SELECT/MULTISELECT — "value:Label" per line, kept as
  // plain text rather than a repeating option-row sub-form for v1.
  const [optionsText, setOptionsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const needsOptions = fieldType === 'SELECT' || fieldType === 'MULTISELECT';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      const options = needsOptions
        ? optionsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [value, label] = line.split(':').map((s) => s.trim());
              return { value, label: label || value };
            })
        : [];
      await api.addTicketTypeField(
        def.id,
        { key: key.trim(), label: label.trim(), fieldType, appliesTo, required, options, order: def.fields.length },
        token,
      );
      setKey('');
      setLabel('');
      setOptionsText('');
      setRequired(false);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add this field');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="builder-section">
      <h2>Fields ({def.fields.length})</h2>
      {def.fields.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Applies to</th>
              <th>Required</th>
            </tr>
          </thead>
          <tbody>
            {def.fields.map((f) => (
              <tr key={f.id} className={f.isDeprecated ? 'builder-row-deprecated' : ''}>
                <td>
                  <code>{f.key}</code>
                </td>
                <td>{f.label}</td>
                <td>{f.fieldType}</td>
                <td>{f.appliesTo}</td>
                <td>{f.required ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="ticket-form builder-form" onSubmit={onSubmit}>
        <label>
          Key (camelCase)
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. affectedSystem" required />
        </label>
        <label>
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Affected system" required />
        </label>
        <label>
          Field type
          <select value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Applies to
          <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
            {APPLIES_TO.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="builder-checkbox">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        {needsOptions && (
          <label>
            Options (one per line, <code>value:Label</code>)
            <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder={'wifi:WiFi\nvpn:VPN'} />
          </label>
        )}
        {localError && <p className="error">{localError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add field'}
        </button>
      </form>
    </section>
  );
}

function StatusesSection({ def, token, onChanged }: SectionProps) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [isInitial, setIsInitial] = useState(false);
  const [isTerminal, setIsTerminal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await api.addTicketTypeStatus(def.id, { key: key.trim(), label: label.trim(), isInitial, isTerminal, order: def.statuses.length }, token);
      setKey('');
      setLabel('');
      setIsInitial(false);
      setIsTerminal(false);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add this status');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="builder-section">
      <h2>Statuses ({def.statuses.length})</h2>
      {def.statuses.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Initial</th>
              <th>Terminal</th>
            </tr>
          </thead>
          <tbody>
            {def.statuses.map((s) => (
              <tr key={s.id}>
                <td>
                  <code>{s.key}</code>
                </td>
                <td>{s.label}</td>
                <td>{s.isInitial ? '✓' : ''}</td>
                <td>{s.isTerminal ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="ticket-form builder-form" onSubmit={onSubmit}>
        <label>
          Key
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. IN_PROGRESS" required />
        </label>
        <label>
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. In Progress" required />
        </label>
        <label className="builder-checkbox">
          <input type="checkbox" checked={isInitial} onChange={(e) => setIsInitial(e.target.checked)} />
          Initial status (where a new ticket starts)
        </label>
        <label className="builder-checkbox">
          <input type="checkbox" checked={isTerminal} onChange={(e) => setIsTerminal(e.target.checked)} />
          Terminal status (counts as resolved/closed)
        </label>
        {localError && <p className="error">{localError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add status'}
        </button>
      </form>
    </section>
  );
}

function TransitionsSection({ def, token, onChanged }: SectionProps) {
  const [fromStatusKey, setFromStatusKey] = useState('');
  const [toStatusKey, setToStatusKey] = useState('');
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function toggleRole(role: string) {
    setAllowedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await api.addTicketTypeTransition(def.id, { fromStatusKey, toStatusKey, allowedRoles }, token);
      setFromStatusKey('');
      setToStatusKey('');
      setAllowedRoles([]);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add this transition');
    } finally {
      setSubmitting(false);
    }
  }

  if (def.statuses.length === 0) {
    return (
      <section className="builder-section">
        <h2>Transitions</h2>
        <p className="comment-empty">Add at least one status first.</p>
      </section>
    );
  }

  return (
    <section className="builder-section">
      <h2>Transitions ({def.transitions.length})</h2>
      {def.transitions.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Allowed roles</th>
            </tr>
          </thead>
          <tbody>
            {def.transitions.map((t) => (
              <tr key={t.id}>
                <td>
                  <code>{t.fromStatusKey}</code>
                </td>
                <td>
                  <code>{t.toStatusKey}</code>
                </td>
                <td>{t.allowedRoles.length === 0 ? 'Anyone in-department' : t.allowedRoles.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="ticket-form builder-form" onSubmit={onSubmit}>
        <label>
          From status
          <select value={fromStatusKey} onChange={(e) => setFromStatusKey(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {def.statuses.map((s) => (
              <option key={s.id} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          To status
          <select value={toStatusKey} onChange={(e) => setToStatusKey(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {def.statuses.map((s) => (
              <option key={s.id} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="builder-checkbox-group">
          <span>Allowed roles (none selected = anyone in-department)</span>
          {ROLES_FOR_TRANSITIONS.map((role) => (
            <label key={role} className="builder-checkbox">
              <input type="checkbox" checked={allowedRoles.includes(role)} onChange={() => toggleRole(role)} />
              {role.replace('_', ' ')}
            </label>
          ))}
        </div>
        {localError && <p className="error">{localError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add transition'}
        </button>
      </form>
    </section>
  );
}

function SlaRulesSection({ def, token, onChanged }: SectionProps) {
  const [customerType, setCustomerType] = useState<(typeof CUSTOMER_TYPES)[number]>('B2C');
  const [priority, setPriority] = useState('MEDIUM');
  const [responseTimeMinutes, setResponseTimeMinutes] = useState(60);
  const [resolutionTimeMinutes, setResolutionTimeMinutes] = useState(480);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await api.addTicketTypeSlaRule(def.id, { customerType, priority, responseTimeMinutes, resolutionTimeMinutes }, token);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add this SLA rule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="builder-section">
      <h2>SLA rules ({def.slaRules.length})</h2>
      <p className="comment-empty">One rule per customer type × priority combination — at least one is required to publish.</p>
      {def.slaRules.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Customer type</th>
              <th>Priority</th>
              <th>Response (min)</th>
              <th>Resolution (min)</th>
            </tr>
          </thead>
          <tbody>
            {def.slaRules.map((r) => (
              <tr key={r.id}>
                <td>{r.customerType}</td>
                <td>{r.priority}</td>
                <td>{r.responseTimeMinutes}</td>
                <td>{r.resolutionTimeMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="ticket-form builder-form" onSubmit={onSubmit}>
        <label>
          Customer type
          <select value={customerType} onChange={(e) => setCustomerType(e.target.value as 'B2C' | 'B2B')}>
            {CUSTOMER_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Response time (minutes)
          <input type="number" min={1} value={responseTimeMinutes} onChange={(e) => setResponseTimeMinutes(Number(e.target.value))} required />
        </label>
        <label>
          Resolution time (minutes)
          <input type="number" min={1} value={resolutionTimeMinutes} onChange={(e) => setResolutionTimeMinutes(Number(e.target.value))} required />
        </label>
        {localError && <p className="error">{localError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add SLA rule'}
        </button>
      </form>
    </section>
  );
}

function EscalationRulesSection({ def, token, onChanged }: SectionProps) {
  const [customerType, setCustomerType] = useState<(typeof CUSTOMER_TYPES)[number]>('B2C');
  const [priority, setPriority] = useState('MEDIUM');
  const [escalateOnSlaBreach, setEscalateOnSlaBreach] = useState(true);
  const [reassignmentThreshold, setReassignmentThreshold] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await api.addTicketTypeEscalationRule(def.id, { customerType, priority, escalateOnSlaBreach, reassignmentThreshold }, token);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add this escalation rule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="builder-section">
      <h2>Escalation rules ({def.escalationRules.length})</h2>
      <p className="comment-empty">
        Optional — a customer type × priority with no rule here still escalates on SLA breach after 2 reassignments (the
        platform default).
      </p>
      {def.escalationRules.length > 0 && (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Customer type</th>
              <th>Priority</th>
              <th>Escalate on SLA breach</th>
              <th>Reassignment threshold</th>
            </tr>
          </thead>
          <tbody>
            {def.escalationRules.map((r) => (
              <tr key={r.id}>
                <td>{r.customerType}</td>
                <td>{r.priority}</td>
                <td>{r.escalateOnSlaBreach ? 'Yes' : 'No'}</td>
                <td>{r.reassignmentThreshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="ticket-form builder-form" onSubmit={onSubmit}>
        <label>
          Customer type
          <select value={customerType} onChange={(e) => setCustomerType(e.target.value as 'B2C' | 'B2B')}>
            {CUSTOMER_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="builder-checkbox">
          <input type="checkbox" checked={escalateOnSlaBreach} onChange={(e) => setEscalateOnSlaBreach(e.target.checked)} />
          Escalate automatically on SLA breach
        </label>
        <label>
          Reassignment threshold
          <input type="number" min={1} value={reassignmentThreshold} onChange={(e) => setReassignmentThreshold(Number(e.target.value))} />
        </label>
        {localError && <p className="error">{localError}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add escalation rule'}
        </button>
      </form>
    </section>
  );
}

function VersionsSection({ def }: { def: TicketTypeDefinitionAdmin }) {
  return (
    <section className="builder-section">
      <h2>Published versions ({def.versions.length})</h2>
      {def.versions.length === 0 ? (
        <p className="comment-empty">Not published yet.</p>
      ) : (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {def.versions.map((v) => (
              <tr key={v.id}>
                <td>{v.versionNumber}</td>
                <td>{v.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

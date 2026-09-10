import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, staffToken, staffUser, Department, IntakeQuery, StaffMember, TicketTypeSummary } from '../../lib/api';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// The staff-facing triage queue for everything that lands in IntakeQuery —
// the public web lead form today, inbound email later. This is where "human
// can override the AI classification" actually happens: suggestedDepartment/
// classificationReasoning are shown as a starting point, but every field
// below is editable before Convert is clicked, exactly like NewTicketPage's
// AI-triage suggestion. Rejecting instead just marks the query done with no
// ticket created.
export function IntakeQueuePage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
  const navigate = useNavigate();

  const [queries, setQueries] = useState<IntakeQuery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listIntakeQueries('PENDING', token)
      .then(setQueries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the intake queue'));
  }, [token]);

  function onHandled(id: string) {
    setQueries((prev) => prev?.filter((q) => q.id !== id) ?? null);
    setExpandedId(null);
  }

  if (error) return <p className="error">{error}</p>;
  if (!queries) return <p>Loading…</p>;

  return (
    <div className="page-shell">
      <h1>Intake Queue</h1>
      <p className="dash-subtitle">
        Queries submitted through the public contact form (and, later, email) land here first — nothing becomes a
        ticket until you confirm the department and ticket type below.
      </p>

      {queries.length === 0 && <p>Nothing pending — the queue is empty.</p>}

      {queries.map((q) => (
        <div key={q.id} className="ticket-form" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong>{q.subject}</strong>
              <p style={{ margin: '4px 0' }}>{q.description}</p>
              <p className="dash-subtitle" style={{ margin: 0 }}>
                From {q.contactName ?? '(no name)'} — {q.contactEmail ?? '(no email — fill in manually)'}
                {q.contactPhone ? ` — ${q.contactPhone}` : ''}
                {q.companyName ? ` — ${q.companyName}` : ''}
              </p>
              {q.suggestedDepartment && (
                <p className="ai-reasoning">
                  ✨ Suggested department: {q.suggestedDepartment.name}
                  {q.classificationReasoning ? ` — ${q.classificationReasoning}` : ''}
                </p>
              )}
              {!q.suggestedDepartment && <p className="ai-reasoning">No department suggestion — pick one below.</p>}
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}>
                {expandedId === q.id ? 'Close' : 'Review'}
              </button>
            </div>
          </div>
          {expandedId === q.id && (
            <ConvertPanel query={q} isSuperAdmin={isSuperAdmin} me={me} token={token} onDone={() => onHandled(q.id)} onOpenTicket={(id) => navigate(`/app/tickets/${id}`)} />
          )}
        </div>
      ))}
    </div>
  );
}

function ConvertPanel({
  query,
  isSuperAdmin,
  me,
  token,
  onDone,
  onOpenTicket,
}: {
  query: IntakeQuery;
  isSuperAdmin: boolean;
  me: { departmentId: string | null } | null;
  token: string | null;
  onDone: () => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(query.suggestedDepartment?.id ?? me?.departmentId ?? '');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeSummary[]>([]);
  const [ticketTypeId, setTicketTypeId] = useState(query.suggestedTicketTypeDefinitionId ?? '');
  const [priority, setPriority] = useState(query.suggestedPriority ?? 'MEDIUM');
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [assignedAgentId, setAssignedAgentId] = useState('');

  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => setDepartments(all.filter((d) => d.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!departmentId) return;
    api
      .listTicketTypes(departmentId, token)
      .then((all) => setTicketTypes(all.filter((t) => t.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load ticket types'));
    api.listDepartmentUsers(departmentId, token).catch(() => []).then((members) => setStaffMembers(members ?? []));
  }, [departmentId, token]);

  async function onSuggestWithAi() {
    if (!departmentId) {
      setError('Pick a department first');
      return;
    }
    setAiSuggesting(true);
    setError(null);
    try {
      const result = await api.triage(departmentId, query.subject, query.description, token);
      setTicketTypeId(result.ticketTypeId);
      setPriority(result.priority);
      setAiReasoning(result.reasoning);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      setAiSuggesting(false);
    }
  }

  async function onConvert() {
    setError(null);
    if (!departmentId) return setError('Pick a department first');
    if (!ticketTypeId) return setError('Pick a ticket type first');
    setBusy(true);
    try {
      const ticket = await api.convertIntakeQuery(
        query.id,
        { departmentId, ticketTypeDefinitionId: ticketTypeId, priority, assignedAgentId: assignedAgentId || undefined },
        token,
      );
      onDone();
      onOpenTicket(ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert this query');
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    setError(null);
    setBusy(true);
    try {
      await api.rejectIntakeQuery(query.id, rejectReason || undefined, token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject this query');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', marginTop: 12, paddingTop: 12 }}>
      {isSuperAdmin && (
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

      {departmentId && (
        <label>
          Ticket type
          <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} required>
            <option value="" disabled>
              Select a ticket type…
            </option>
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ai-suggest-row">
        <button type="button" onClick={onSuggestWithAi} disabled={aiSuggesting || !departmentId}>
          ✨ {aiSuggesting ? 'Thinking…' : 'Suggest ticket type & priority'}
        </button>
        {aiReasoning && <p className="ai-reasoning">{aiReasoning}</p>}
      </div>

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
        Assign to (optional)
        <select value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)}>
          <option value="">Unassigned (or AI auto-assign)</option>
          {staffMembers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error">{error}</p>}
      <div className="row-actions">
        <button type="button" onClick={onConvert} disabled={busy}>
          {busy ? 'Working…' : 'Convert to ticket'}
        </button>
        <input
          placeholder="Reason for rejecting (optional)"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={onReject} disabled={busy}>
          Reject
        </button>
      </div>
    </div>
  );
}

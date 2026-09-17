import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  staffToken,
  staffUser,
  Department,
  FieldDefinition,
  StaffMember,
  StaffSearchResult,
  TicketTypeSummary,
} from '../../lib/api';
import { DynamicFormRenderer } from '../../components/DynamicFormRenderer';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// Who a ticket is raised for. 'staff' is the normal internal-helpdesk case —
// picked from the org's own staff list, no external Customer ever entered by
// hand. 'external' is the fallback for someone not in that list (or a real
// external customer, if this deployment ever needs that) — it still goes
// through the Customer API, just without exposing "Customer" as a concept.
type Requester =
  | { kind: 'staff'; id: string; name: string; email: string }
  | { kind: 'external'; id: string; name: string; email: string; company: { id: string; name: string } | null };

export function NewTicketPage() {
  const navigate = useNavigate();
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeSummary[]>([]);
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [noPublishedVersion, setNoPublishedVersion] = useState(false);
  const [customFields, setCustomFields] = useState<FieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  const [requesterQuery, setRequesterQuery] = useState('');
  const [staffResults, setStaffResults] = useState<StaffSearchResult[]>([]);
  const [selectedRequester, setSelectedRequester] = useState<Requester | null>(null);
  const [showNewRequester, setShowNewRequester] = useState(false);
  const [newRequesterName, setNewRequesterName] = useState('');
  const [newRequesterEmail, setNewRequesterEmail] = useState('');
  // Separate from the page-level `error` below — that one renders at the
  // very bottom of the whole form, far from this mini add-person form, so a
  // failure here (e.g. duplicate email) looked like "the Add button does
  // nothing" (reported 2026-08-31). This one renders right next to Add.
  const [newRequesterError, setNewRequesterError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [assignedAgentId, setAssignedAgentId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiAutoTriaged, setAiAutoTriaged] = useState(false);
  // True once the person has touched the ticket-type picker themselves — a
  // ref (not state) so the in-flight auto-triage call below can check the
  // live value after its await, instead of the stale value from whenever
  // that call started.
  const typeManuallyPickedRef = useRef(false);

  // SUPER_ADMIN can raise a ticket in any live department; everyone else is
  // fixed to their own — mirrors assertDepartmentAccess on the backend.
  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => setDepartments(all.filter((d) => d.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!departmentId) return;
    setTicketTypeId('');
    typeManuallyPickedRef.current = false;
    setAiAutoTriaged(false);
    api
      .listTicketTypes(departmentId, token)
      .then((all) => setTicketTypes(all.filter((t) => t.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load ticket types'));
    api.listDepartmentUsers(departmentId, token).catch(() => []).then((members) => setStaffMembers(members ?? []));
  }, [departmentId, token]);

  // Once a ticket type AND a requester are both chosen, fetch the frozen
  // field schema for this requester's customer type (B2B/B2C) so the form
  // matches exactly what the backend will validate against. Staff
  // requesters are always B2C — there's no "company" concept internally.
  useEffect(() => {
    setPublishedVersion(null);
    setNoPublishedVersion(false);
    setCustomFields([]);
    setCustomFieldValues({});
    if (!ticketTypeId || !selectedRequester) return;

    api
      .getTicketTypeDefinition(ticketTypeId, token)
      .then((def) => {
        const latestPublished = def.versions.filter((v) => v.status === 'PUBLISHED').sort((a, b) => b.versionNumber - a.versionNumber)[0];
        if (!latestPublished) {
          setNoPublishedVersion(true);
          return;
        }
        setPublishedVersion(latestPublished.versionNumber);
        const customerType = selectedRequester.kind === 'external' && selectedRequester.company ? 'B2B' : 'B2C';
        api
          .getTicketTypeVersion(ticketTypeId, latestPublished.versionNumber, customerType, token)
          .then((v) => setCustomFields(v.fields))
          .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this ticket type\'s form'));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this ticket type'));
  }, [ticketTypeId, selectedRequester, token]);

  async function onSearchRequesters(q: string) {
    setRequesterQuery(q);
    if (q.trim().length < 2) {
      setStaffResults([]);
      return;
    }
    try {
      setStaffResults(await api.searchStaff(q, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search your team');
    }
  }

  async function onCreateExternalRequester(e: FormEvent) {
    e.preventDefault();
    setNewRequesterError(null);
    try {
      const created = await api.createCustomer({ name: newRequesterName, email: newRequesterEmail }, token);
      setSelectedRequester({ kind: 'external', id: created.id, name: created.name, email: created.email, company: created.company });
      setShowNewRequester(false);
    } catch (err) {
      // Shown right next to the Add button (see newRequesterError above) —
      // it used to set the page-level `error`, which renders at the bottom
      // of the whole form and looked like the button did nothing.
      setNewRequesterError(err instanceof Error ? err.message : 'Could not add this person');
    }
  }

  // Never submits anything itself — the picker below still shows whatever
  // it lands on so it can be overridden before Create ticket is clicked.
  // `auto` distinguishes the two ways this fires:
  //  - auto=false: the "Suggest ticket type & priority" button — an
  //    explicit human request, always applied regardless of confidence,
  //    same behavior this had before auto-triage existed.
  //  - auto=true: fired automatically (see the effect below) once
  //    subject+description are filled, with no click. Still always fills
  //    the pickers so today's manual-suggest UX survives unchanged for
  //    anything below 'high' confidence, but ALSO marks the ticket
  //    aiAutoTriaged (sent to the backend for its audit trail — see
  //    tickets.service.ts) only when the model self-reports 'high'
  //    confidence, matching Deepak's 2026-09-17 call: auto-act only when
  //    confident, suggest-only otherwise.
  async function runTriage(auto: boolean) {
    if (!departmentId || !subject.trim() || !description.trim()) {
      if (!auto) setError('Fill in the department, subject, and description first');
      return;
    }
    setAiSuggesting(true);
    if (!auto) setError(null);
    try {
      const result = await api.triage(departmentId, subject, description, token);
      // A human may have picked a type by hand while this call was in
      // flight — never clobber that with a stale auto-suggestion.
      if (auto && typeManuallyPickedRef.current) return;
      setTicketTypeId(result.ticketTypeId);
      setPriority(result.priority);
      setAiReasoning(result.reasoning);
      setAiAutoTriaged(auto && result.confidence === 'high');
    } catch (err) {
      // Auto-triage failing silently is fine — same "leave it for a human"
      // degrade every other AI feature in this app already has; the manual
      // button still surfaces the error since that's an explicit request.
      if (!auto) setError(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      setAiSuggesting(false);
    }
  }

  // Auto-triage: fires ~1s after the person stops typing a subject+
  // description long enough to triage meaningfully, as long as they
  // haven't already picked a ticket type by hand. Debounced so it doesn't
  // fire a Gemini/Groq call on every keystroke.
  useEffect(() => {
    if (typeManuallyPickedRef.current) return;
    if (!departmentId || subject.trim().length < 3 || description.trim().length < 8) return;
    const timer = setTimeout(() => runTriage(true), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, subject, description]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate on click with a specific message instead of silently
    // disabling the button — a disabled button with no explanation reads as
    // "broken", not "incomplete".
    if (!departmentId) return setError('Select a department first');
    if (!ticketTypeId) return setError('Select a ticket type first');
    if (!selectedRequester) return setError('Choose who this ticket is for');
    if (noPublishedVersion) return setError('This ticket type has no published version yet — ask a Dept Admin to publish it first');
    if (publishedVersion === null) return setError('Still loading this ticket type\'s form — wait a moment and try again');
    if (!subject.trim()) return setError('Enter a subject');
    if (!description.trim()) return setError('Enter a description');

    setSubmitting(true);
    try {
      const ticket = await api.createTicket(
        departmentId,
        {
          ticketTypeDefinitionId: ticketTypeId,
          ...(selectedRequester.kind === 'staff'
            ? { requesterUserId: selectedRequester.id }
            : { customerId: selectedRequester.id }),
          priority,
          subject,
          description,
          customFields: customFieldValues,
          assignedAgentId: assignedAgentId || undefined,
          aiAutoTriaged,
        },
        token,
      );
      navigate(`/app/tickets/${ticket.id}`, { state: { autoAssignReasoning: ticket.autoAssignReasoning } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>New Ticket</h1>
      <form className="ticket-form" onSubmit={onSubmit}>
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
            <select
              value={ticketTypeId}
              onChange={(e) => {
                typeManuallyPickedRef.current = true;
                setAiAutoTriaged(false);
                setTicketTypeId(e.target.value);
              }}
              required
            >
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

        <fieldset className="customer-picker">
          <legend>Who is this for?</legend>
          {selectedRequester ? (
            <div className="selected-customer">
              <span>
                <strong>{selectedRequester.name}</strong> ({selectedRequester.email})
              </span>
              <button type="button" onClick={() => setSelectedRequester(null)}>
                Change
              </button>
            </div>
          ) : showNewRequester ? (
            <div className="new-customer-form">
              <input placeholder="Name" value={newRequesterName} onChange={(e) => setNewRequesterName(e.target.value)} required />
              <input placeholder="Email" type="email" value={newRequesterEmail} onChange={(e) => setNewRequesterEmail(e.target.value)} required />
              {newRequesterError && <p className="error">{newRequesterError}</p>}
              <div className="row-actions">
                <button type="button" onClick={onCreateExternalRequester}>
                  Add
                </button>
                <button type="button" onClick={() => { setShowNewRequester(false); setNewRequesterError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="customer-search">
              <input
                placeholder="Search your team by name or email…"
                value={requesterQuery}
                onChange={(e) => onSearchRequesters(e.target.value)}
              />
              {staffResults.length > 0 && (
                <ul className="customer-results">
                  {staffResults.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setSelectedRequester({ kind: 'staff', id: s.id, name: s.name, email: s.email })}>
                        {s.name} ({s.email})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => { setShowNewRequester(true); setNewRequesterError(null); }}>
                + Someone not on this list
              </button>
            </div>
          )}
        </fieldset>

        {noPublishedVersion && (
          <p className="error">This ticket type has no published version yet — ask a Dept Admin to publish it first.</p>
        )}

        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
        </label>

        <div className="ai-suggest-row">
          <button type="button" onClick={() => runTriage(false)} disabled={aiSuggesting}>
            ✨ {aiSuggesting ? 'Thinking…' : 'Suggest ticket type & priority'}
          </button>
          {aiAutoTriaged ? (
            <p className="ai-reasoning">✓ Auto-triaged by AI (high confidence) — {aiReasoning}</p>
          ) : (
            aiReasoning && <p className="ai-reasoning">{aiReasoning}</p>
          )}
        </div>

        <label>
          Priority
          <select
            value={priority}
            onChange={(e) => {
              setAiAutoTriaged(false);
              setPriority(e.target.value);
            }}
          >
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
            <option value="">Unassigned</option>
            {staffMembers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {customFields.length > 0 && (
          <DynamicFormRenderer
            fields={customFields}
            values={customFieldValues}
            onChange={(key, value) => setCustomFieldValues((prev) => ({ ...prev, [key]: value }))}
            staffMembers={staffMembers}
          />
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create ticket'}
        </button>
      </form>
    </div>
  );
}

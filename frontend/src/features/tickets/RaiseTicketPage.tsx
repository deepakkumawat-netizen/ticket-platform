import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, staffToken, Department, FieldDefinition, TicketTypeSummary } from '../../lib/api';
import { DynamicFormRenderer } from '../../components/DynamicFormRenderer';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// The EMPLOYEE-facing "raise a ticket for myself" form — no requester
// picker at all (the backend forces requesterUserId to the caller; see
// tickets.service.ts's createForSelf), and any live department is
// selectable since an employee isn't scoped to one.
export function RaiseTicketPage() {
  const navigate = useNavigate();
  const token = staffToken.get();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeSummary[]>([]);
  const [ticketTypeId, setTicketTypeId] = useState('');

  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [noPublishedVersion, setNoPublishedVersion] = useState(false);
  const [customFields, setCustomFields] = useState<FieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listDepartments(token)
      .then((all) => setDepartments(all.filter((d) => d.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [token]);

  useEffect(() => {
    if (!departmentId) return;
    setTicketTypeId('');
    api
      .listTicketTypes(departmentId, token)
      .then((all) => setTicketTypes(all.filter((t) => t.isActive)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load ticket types'));
  }, [departmentId, token]);

  // Employees are always B2C (there's no company concept for a self-service
  // requester) — see findOrCreateCustomerForStaff on the backend.
  useEffect(() => {
    setPublishedVersion(null);
    setNoPublishedVersion(false);
    setCustomFields([]);
    setCustomFieldValues({});
    if (!ticketTypeId) return;

    api
      .getTicketTypeDefinition(ticketTypeId, token)
      .then((def) => {
        const latestPublished = def.versions.filter((v) => v.status === 'PUBLISHED').sort((a, b) => b.versionNumber - a.versionNumber)[0];
        if (!latestPublished) {
          setNoPublishedVersion(true);
          return;
        }
        setPublishedVersion(latestPublished.versionNumber);
        api
          .getTicketTypeVersion(ticketTypeId, latestPublished.versionNumber, 'B2C', token)
          .then((v) => setCustomFields(v.fields))
          .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this ticket type\'s form'));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this ticket type'));
  }, [ticketTypeId, token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!departmentId) return setError('Select a department first');
    if (!ticketTypeId) return setError('Select a ticket type first');
    if (noPublishedVersion) return setError('This ticket type has no published version yet — ask a Dept Admin to publish it first');
    if (publishedVersion === null) return setError('Still loading this ticket type\'s form — wait a moment and try again');
    if (!subject.trim()) return setError('Enter a subject');
    if (!description.trim()) return setError('Enter a description');

    setSubmitting(true);
    try {
      const ticket = await api.createMyTicket(
        { departmentId, ticketTypeDefinitionId: ticketTypeId, priority, subject, description, customFields: customFieldValues },
        token,
      );
      navigate(`/app/my-tickets/${ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>Raise a Ticket</h1>
      <form className="ticket-form" onSubmit={onSubmit}>
        <label>
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
            <option value="" disabled>
              Who do you need help from?
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {departmentId && (
          <label>
            What's this about?
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

        {customFields.length > 0 && (
          <DynamicFormRenderer
            fields={customFields}
            values={customFieldValues}
            onChange={(key, value) => setCustomFieldValues((prev) => ({ ...prev, [key]: value }))}
          />
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Raise ticket'}
        </button>
      </form>
    </div>
  );
}

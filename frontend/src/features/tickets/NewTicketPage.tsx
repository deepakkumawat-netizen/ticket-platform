import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  staffToken,
  staffUser,
  CustomerRecord,
  Department,
  FieldDefinition,
  StaffMember,
  TicketTypeSummary,
} from '../../lib/api';
import { DynamicFormRenderer } from '../../components/DynamicFormRenderer';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

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

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerRecord[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerCompany, setNewCustomerCompany] = useState('');

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [assignedAgentId, setAssignedAgentId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // SUPER_ADMIN can raise a ticket in any live department; everyone else is
  // fixed to their own — mirrors assertDepartmentAccess on the backend.
  useEffect(() => {
    if (isSuperAdmin) {
      api.listDepartments(token).then((all) => setDepartments(all.filter((d) => d.isActive)));
    }
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!departmentId) return;
    setTicketTypeId('');
    api.listTicketTypes(departmentId, token).then((all) => setTicketTypes(all.filter((t) => t.isActive)));
    api.listDepartmentUsers(departmentId, token).then(setStaffMembers);
  }, [departmentId, token]);

  // Once a ticket type AND a customer are both chosen, fetch the frozen
  // field schema for this customer's type (B2B/B2C) so the form matches
  // exactly what the backend will validate against.
  useEffect(() => {
    setPublishedVersion(null);
    setNoPublishedVersion(false);
    setCustomFields([]);
    setCustomFieldValues({});
    if (!ticketTypeId || !selectedCustomer) return;

    api.getTicketTypeDefinition(ticketTypeId, token).then((def) => {
      const latestPublished = def.versions.filter((v) => v.status === 'PUBLISHED').sort((a, b) => b.versionNumber - a.versionNumber)[0];
      if (!latestPublished) {
        setNoPublishedVersion(true);
        return;
      }
      setPublishedVersion(latestPublished.versionNumber);
      const customerType = selectedCustomer.company ? 'B2B' : 'B2C';
      api.getTicketTypeVersion(ticketTypeId, latestPublished.versionNumber, customerType, token).then((v) => setCustomFields(v.fields));
    });
  }, [ticketTypeId, selectedCustomer, token]);

  async function onSearchCustomers(q: string) {
    setCustomerQuery(q);
    if (q.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    setCustomerResults(await api.searchCustomers(q, token));
  }

  async function onCreateCustomer(e: FormEvent) {
    e.preventDefault();
    const created = await api.createCustomer(
      { name: newCustomerName, email: newCustomerEmail, phone: newCustomerPhone || undefined, companyName: newCustomerCompany || undefined },
      token,
    );
    setSelectedCustomer(created);
    setShowNewCustomer(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate on click with a specific message instead of silently
    // disabling the button — a disabled button with no explanation reads as
    // "broken", not "incomplete".
    if (!departmentId) return setError('Select a department first');
    if (!ticketTypeId) return setError('Select a ticket type first');
    if (!selectedCustomer) return setError('Choose or create a customer first');
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
          customerId: selectedCustomer.id,
          priority,
          subject,
          description,
          customFields: customFieldValues,
          assignedAgentId: assignedAgentId || undefined,
        },
        token,
      );
      navigate(`/app/tickets/${ticket.id}`);
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

        <fieldset className="customer-picker">
          <legend>Customer</legend>
          {selectedCustomer ? (
            <div className="selected-customer">
              <span>
                <strong>{selectedCustomer.name}</strong> ({selectedCustomer.email})
                {selectedCustomer.company && ` — ${selectedCustomer.company.name}`}
              </span>
              <button type="button" onClick={() => setSelectedCustomer(null)}>
                Change
              </button>
            </div>
          ) : showNewCustomer ? (
            <div className="new-customer-form">
              <input placeholder="Name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} required />
              <input placeholder="Email" type="email" value={newCustomerEmail} onChange={(e) => setNewCustomerEmail(e.target.value)} required />
              <input placeholder="Phone (optional)" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
              <input
                placeholder="Company (optional — leave blank for a B2C customer)"
                value={newCustomerCompany}
                onChange={(e) => setNewCustomerCompany(e.target.value)}
              />
              <div className="row-actions">
                <button type="button" onClick={onCreateCustomer}>
                  Create customer
                </button>
                <button type="button" onClick={() => setShowNewCustomer(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="customer-search">
              <input
                placeholder="Search by name or email…"
                value={customerQuery}
                onChange={(e) => onSearchCustomers(e.target.value)}
              />
              {customerResults.length > 0 && (
                <ul className="customer-results">
                  {customerResults.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setSelectedCustomer(c)}>
                        {c.name} ({c.email}) {c.company && `— ${c.company.name}`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setShowNewCustomer(true)}>
                + New customer
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

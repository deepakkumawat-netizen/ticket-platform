import { FieldDefinition, StaffMember } from '../lib/api';

// Renders customFields inputs from a published TicketTypeVersion's frozen
// field schema — the same schema (already narrowed to one customerType via
// fieldsForCustomerType on the backend) that validates the submission, so
// what's shown here and what's accepted can never drift apart.
//
// COMPANY_REF is intentionally unsupported (rendered as a note, not an
// input): a ticket's company is already derived from the chosen customer,
// so a custom field of this type would be redundant with that — flagged
// here rather than silently ignored.
export function DynamicFormRenderer({
  fields,
  values,
  onChange,
  staffMembers = [],
}: {
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  staffMembers?: StaffMember[];
}) {
  if (fields.length === 0) return null;

  return (
    <div className="dynamic-fields">
      {fields.map((field) => (
        <label key={field.key} className="dynamic-field">
          <span>
            {field.label}
            {field.required && <span className="required-mark">*</span>}
          </span>
          {renderInput(field, values[field.key], (v) => onChange(field.key, v), staffMembers)}
        </label>
      ))}
    </div>
  );
}

function renderInput(
  field: FieldDefinition,
  value: unknown,
  set: (v: unknown) => void,
  staffMembers: StaffMember[],
) {
  switch (field.fieldType) {
    case 'TEXT':
      return <input type="text" value={(value as string) ?? ''} required={field.required} onChange={(e) => set(e.target.value)} />;
    case 'TEXTAREA':
      return <textarea value={(value as string) ?? ''} required={field.required} onChange={(e) => set(e.target.value)} rows={3} />;
    case 'NUMBER':
      return (
        <input
          type="number"
          value={(value as number) ?? ''}
          required={field.required}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'DATE':
      return <input type="date" value={(value as string) ?? ''} required={field.required} onChange={(e) => set(e.target.value)} />;
    case 'BOOLEAN':
      return (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />
      );
    case 'SELECT':
      return (
        <select value={(value as string) ?? ''} required={field.required} onChange={(e) => set(e.target.value)}>
          <option value="" disabled>
            Select…
          </option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'MULTISELECT': {
      const selected = new Set((value as string[]) ?? []);
      return (
        <div className="multiselect">
          {field.options.map((o) => (
            <label key={o.value} className="multiselect-option">
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  set([...next]);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'USER_REF':
      return (
        <select value={(value as string) ?? ''} required={field.required} onChange={(e) => set(e.target.value)}>
          <option value="" disabled>
            Select a staff member…
          </option>
          {staffMembers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    case 'COMPANY_REF':
      return <p className="field-note">Company is set from the chosen customer — no separate input needed.</p>;
    default:
      return <input type="text" value={(value as string) ?? ''} onChange={(e) => set(e.target.value)} />;
  }
}

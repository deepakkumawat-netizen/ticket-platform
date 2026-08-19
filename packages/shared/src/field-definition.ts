import { z } from 'zod';
import { CustomerType, FieldAppliesTo, FieldType } from './enums';

// ── The low-code engine's core contract ─────────────────────────────────────
// A FieldDefinition describes ONE custom field on a ticket type. This shape
// is authored via the admin UI, frozen into a TicketTypeVersion snapshot on
// publish (see TicketTypeVersionSnapshot below), and consumed by BOTH:
//   - the backend, to validate a ticket's `customFields` JSONB on create/update
//   - the frontend's DynamicFormRenderer, to decide what to render
// Defining it once here (instead of a Zod schema on the backend and a
// hand-rolled JS equivalent on the frontend) is the whole reason this is a
// TypeScript full stack — see the plan's tech-stack rationale.

export const FieldOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const FieldDefinitionSchema = z.object({
  id: z.string(),
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, 'key must be a camelCase identifier'),
  label: z.string().min(1),
  fieldType: z.nativeEnum(FieldType),
  appliesTo: z.nativeEnum(FieldAppliesTo),
  required: z.boolean().default(false),
  // Only meaningful for SELECT/MULTISELECT; empty otherwise.
  options: z.array(FieldOptionSchema).default([]),
  order: z.number().int().default(0),
  // Once ANY published TicketTypeVersion references this key, it must never
  // be renamed or retyped — only soft-deprecated (hidden from new tickets,
  // still readable on old ones) or additively replaced by a new key.
  isDeprecated: z.boolean().default(false),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

// key + fieldType are set once at creation and never appear in the update
// schema below — that omission IS the enforcement mechanism for "a field key
// must never be renamed or retyped once created" (see FieldDefinitionSchema's
// isDeprecated comment). There is deliberately no schema that allows both.
export const CreateFieldDefinitionSchema = FieldDefinitionSchema.omit({ id: true });
export type CreateFieldDefinition = z.infer<typeof CreateFieldDefinitionSchema>;

export const UpdateFieldDefinitionSchema = FieldDefinitionSchema.omit({
  id: true,
  key: true,
  fieldType: true,
}).partial();
export type UpdateFieldDefinition = z.infer<typeof UpdateFieldDefinitionSchema>;

export const StatusDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  isInitial: z.boolean().default(false),
  isTerminal: z.boolean().default(false),
  order: z.number().int().default(0),
});
export type StatusDefinitionT = z.infer<typeof StatusDefinitionSchema>;

export const StatusTransitionSchema = z.object({
  fromStatusKey: z.string().min(1),
  toStatusKey: z.string().min(1),
  allowedRoles: z.array(z.string()).default([]),
});
export type StatusTransitionT = z.infer<typeof StatusTransitionSchema>;

export const SlaRuleSchema = z.object({
  customerType: z.nativeEnum(CustomerType),
  priority: z.string().min(1),
  responseTimeMinutes: z.number().int().positive(),
  resolutionTimeMinutes: z.number().int().positive(),
});
export type SlaRuleT = z.infer<typeof SlaRuleSchema>;

// The immutable snapshot frozen onto TicketTypeVersion at publish time.
// A Ticket always stores which version it was created against, so editing
// these later never changes how an existing ticket validates or renders.
export const TicketTypeVersionSnapshotSchema = z.object({
  fields: z.array(FieldDefinitionSchema),
  statuses: z.array(StatusDefinitionSchema),
  transitions: z.array(StatusTransitionSchema),
  slaRules: z.array(SlaRuleSchema),
});
export type TicketTypeVersionSnapshot = z.infer<typeof TicketTypeVersionSnapshotSchema>;

/** Fields relevant to one customer type, in display order — the single
 * function both the DynamicFormRenderer and the backend validator call so
 * "which fields apply to this ticket" is decided in exactly one place. */
export function fieldsForCustomerType(
  fields: FieldDefinition[],
  customerType: CustomerType,
): FieldDefinition[] {
  return fields
    .filter((f) => !f.isDeprecated)
    .filter((f) => f.appliesTo === FieldAppliesTo.BOTH || f.appliesTo === customerType)
    .sort((a, b) => a.order - b.order);
}

/** Compiles a snapshot's field list (already narrowed to one customer type)
 * into a Zod object schema for `customFields`, so validation logic never has
 * to be hand-written per field type on either end. */
export function buildCustomFieldsSchema(fields: FieldDefinition[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.fieldType) {
      case FieldType.TEXT:
      case FieldType.TEXTAREA:
      case FieldType.USER_REF:
      case FieldType.COMPANY_REF:
        schema = z.string();
        break;
      case FieldType.NUMBER:
        schema = z.number();
        break;
      case FieldType.DATE:
        schema = z.string().datetime().or(z.string().date());
        break;
      case FieldType.BOOLEAN:
        schema = z.boolean();
        break;
      case FieldType.SELECT: {
        const values = field.options.map((o) => o.value) as [string, ...string[]];
        schema = values.length ? z.enum(values) : z.string();
        break;
      }
      case FieldType.MULTISELECT: {
        const values = field.options.map((o) => o.value) as [string, ...string[]];
        schema = z.array(values.length ? z.enum(values) : z.string());
        break;
      }
      default:
        schema = z.any();
    }
    shape[field.key] = field.required ? schema : schema.optional().nullable();
  }
  return z.object(shape);
}

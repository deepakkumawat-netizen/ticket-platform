// Platform-wide enums. These are shared verbatim between the NestJS backend
// (Prisma schema + validation) and the React frontend (dynamic form
// rendering) so the two never drift apart — see field-definition.ts for why
// that matters.

export const StaffRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DEPT_ADMIN: 'DEPT_ADMIN',
  AGENT: 'AGENT',
  // Self-service only: raises tickets for themself and reads their own
  // ticket history via /my-tickets. Never department-scoped (departmentId
  // is null, like SUPER_ADMIN) and never granted the department queue,
  // dashboard, assignment, or admin routes — see the EMPLOYEE carve-outs in
  // departments.service.ts, ticket-types.controller.ts, and tickets.controller.ts.
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export const DepartmentKey = {
  TECH: 'TECH',
  OPERATIONS: 'OPERATIONS',
  CONTENT: 'CONTENT',
  SALES: 'SALES',
} as const;
export type DepartmentKey = (typeof DepartmentKey)[keyof typeof DepartmentKey];

// Fixed platform-wide priority scale (kept simple for the SLA matrix —
// see the plan's "Deferred to implementation kickoff" notes).
export const Priority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

// Every ticket, in every department, is one of these. This is the axis that
// both the FieldDefinition.appliesTo and SlaRule.customerType key off of —
// it is never special-cased per department.
export const CustomerType = {
  B2B: 'B2B',
  B2C: 'B2C',
} as const;
export type CustomerType = (typeof CustomerType)[keyof typeof CustomerType];

// FieldDefinition.appliesTo: which CustomerType(s) see/require this field.
export const FieldAppliesTo = {
  B2B: 'B2B',
  B2C: 'B2C',
  BOTH: 'BOTH',
} as const;
export type FieldAppliesTo = (typeof FieldAppliesTo)[keyof typeof FieldAppliesTo];

export const FieldType = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  SELECT: 'SELECT',
  MULTISELECT: 'MULTISELECT',
  BOOLEAN: 'BOOLEAN',
  USER_REF: 'USER_REF',
  COMPANY_REF: 'COMPANY_REF',
} as const;
export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export const TicketTypeVersionStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type TicketTypeVersionStatus =
  (typeof TicketTypeVersionStatus)[keyof typeof TicketTypeVersionStatus];

// Why a ticket got flagged for its department manager's attention — see
// backend/src/sla (auto, on SLA breach), tickets.service.ts's escalate()
// (manual, agent-triggered) and assign() (auto, reassignment-threshold).
export const EscalationReason = {
  SLA_BREACH: 'SLA_BREACH',
  MANUAL: 'MANUAL',
  REASSIGNMENT_THRESHOLD: 'REASSIGNMENT_THRESHOLD',
} as const;
export type EscalationReason = (typeof EscalationReason)[keyof typeof EscalationReason];

export const CommentVisibility = {
  INTERNAL: 'INTERNAL',
  PUBLIC: 'PUBLIC',
} as const;
export type CommentVisibility = (typeof CommentVisibility)[keyof typeof CommentVisibility];

export const AuthMethod = {
  LOCAL_PASSWORD: 'LOCAL_PASSWORD',
  // Reserved for Phase 4+ — adding a value here plus a new auth strategy is
  // all that's needed to support SSO; no schema migration of User/Customer.
  GOOGLE_OIDC: 'GOOGLE_OIDC',
  MICROSOFT_OIDC: 'MICROSOFT_OIDC',
} as const;
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

// JWT principalType claim — the hard boundary between the staff app and the
// customer portal (see auth guards in the backend). A token minted for one
// principal type must never be accepted by a guard expecting the other.
export const PrincipalType = {
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;
export type PrincipalType = (typeof PrincipalType)[keyof typeof PrincipalType];

import { useSyncExternalStore } from 'react';

// Minimal fetch wrapper. Deliberately two separate token slots (staff vs
// customer) mirroring the backend's principalType split — never merge these
// into one "auth token" concept, that's exactly the boundary the backend
// guards enforce (see backend/src/auth/jwt-payload.interface.ts).

// Tiny pub-sub so React can react to a token being set/cleared. Without
// this, `App.tsx` reading `staffToken.get()` directly in JSX only ever runs
// once at initial mount (nothing about a plain localStorage read tells React
// to re-render) — so logging in bounced straight back to /staff/login until
// a hard reload, since the RequireAuth guard was still holding the `null`
// it captured before login. Wrap get/set/clear in a store React can
// subscribe to (via useSyncExternalStore below) instead.
function createTokenStore(storageKey: string) {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    get: () => localStorage.getItem(storageKey),
    set: (t: string) => {
      localStorage.setItem(storageKey, t);
      notify();
    },
    clear: () => {
      localStorage.removeItem(storageKey);
      notify();
    },
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

// Default '/api' covers BOTH local dev (Vite's proxy forwards it to
// localhost:3000/api — see vite.config.ts) AND the standard production
// deploy, where the backend serves this built frontend itself from the same
// origin (see backend's ServeStaticModule in app.module.ts) and its real API
// routes already live under /api (main.ts's setGlobalPrefix). Only set
// VITE_API_BASE_URL at build time if the frontend is ever deployed
// separately from the backend (a different origin) — then it must be the
// backend's full URL, e.g. "https://ticketplatform-backend.onrender.com".
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

const STAFF_TOKEN_KEY = 'tp_staff_token';
const CUSTOMER_TOKEN_KEY = 'tp_customer_token';

export const staffToken = createTokenStore(STAFF_TOKEN_KEY);
// React hook counterpart of `staffToken.get()` — use this (not `.get()`)
// anywhere the result feeds a route guard or otherwise needs to force a
// re-render when login/logout happens without a full page reload.
export function useStaffToken() {
  return useSyncExternalStore(staffToken.subscribe, staffToken.get);
}

// Staff identity (id/role/departmentId) from the login response — pages need
// this to know "which department am I in" without decoding the JWT client-side.
const STAFF_USER_KEY = 'tp_staff_user';
export type StaffUser = { id: string; email: string; name: string; role: string; departmentId: string | null };
export const staffUser = {
  get: (): StaffUser | null => {
    const raw = localStorage.getItem(STAFF_USER_KEY);
    return raw ? (JSON.parse(raw) as StaffUser) : null;
  },
  set: (u: StaffUser) => localStorage.setItem(STAFF_USER_KEY, JSON.stringify(u)),
  clear: () => localStorage.removeItem(STAFF_USER_KEY),
};

export const customerToken = createTokenStore(CUSTOMER_TOKEN_KEY);
export function useCustomerToken() {
  return useSyncExternalStore(customerToken.subscribe, customerToken.get);
}

async function request<T>(path: string, opts: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = opts;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Shapes returned by the tickets/dashboards/ticket-types endpoints ───────
// Kept here rather than in packages/shared because these are plain API
// response shapes (not cross-cutting validation contracts like
// FieldDefinition) — see backend's TICKET_INCLUDE for the source of truth.

export type Department = { id: string; key: string; name: string; isActive: boolean };
export type TicketTypeSummary = { id: string; key: string; name: string; description: string | null; isActive: boolean };
export type FieldOption = { value: string; label: string };
export type FieldDefinition = {
  id: string;
  key: string;
  label: string;
  fieldType: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'BOOLEAN' | 'USER_REF' | 'COMPANY_REF';
  appliesTo: 'B2B' | 'B2C' | 'BOTH';
  required: boolean;
  options: FieldOption[];
  order: number;
};
export type TicketTypeVersionForRenderer = { id: string; versionNumber: number; fields: FieldDefinition[] };
export type TicketTypeDefinitionDetail = {
  id: string;
  name: string;
  versions: { id: string; versionNumber: number; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }[];
};

// ── Ticket-type admin builder (SUPER_ADMIN/DEPT_ADMIN) ──────────────────
// The low-code engine's authoring surface — fields/statuses/transitions/SLA
// & escalation rules are append-only in v1 (no edit/delete, see
// ticket-types.service.ts's comment on why), so there's nothing here to
// edit either, only "add" forms plus a Publish action.
export type StatusDefinition = { id: string; key: string; label: string; isInitial: boolean; isTerminal: boolean; order: number };
export type StatusTransition = { id: string; fromStatusKey: string; toStatusKey: string; allowedRoles: string[] };
export type SlaRule = { id: string; customerType: CustomerType; priority: string; responseTimeMinutes: number; resolutionTimeMinutes: number };
export type EscalationRule = { id: string; customerType: CustomerType; priority: string; escalateOnSlaBreach: boolean; reassignmentThreshold: number };
export type TicketTypeDefinitionAdmin = {
  id: string;
  departmentId: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  fields: (FieldDefinition & { isDeprecated: boolean })[];
  statuses: StatusDefinition[];
  transitions: StatusTransition[];
  slaRules: SlaRule[];
  escalationRules: EscalationRule[];
  versions: { id: string; versionNumber: number; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }[];
};
export type CustomerType = 'B2B' | 'B2C';

export type CustomerRecord = { id: string; name: string; email: string; phone: string | null; company: { id: string; name: string } | null };
export type StaffMember = { id: string; name: string; email: string; role: string };
export type StaffSearchResult = { id: string; name: string; email: string; role: string; departmentId: string | null };

export type TicketSummary = {
  id: string;
  ticketNumber: number;
  // Already on every ticket response as a plain scalar (backend's include:
  // TICKET_INCLUDE only adds relations, it doesn't restrict scalars away) —
  // just wasn't declared here before. Needed so a SUPER_ADMIN viewing a
  // ticket outside their own department (they have none) can still fetch
  // THAT department's staff list for the assignee dropdown.
  departmentId: string;
  department: { key: string; name: string };
  subject: string;
  priority: string;
  statusKey: string;
  createdAt: string;
  customer: { id: string; name: string; email: string };
  company: { id: string; name: string } | null;
  assignedAgent: { id: string; name: string } | null;
  ticketTypeDefinition: { id: string; name: string };
  // See backend's EscalationReason — isEscalated stays true after
  // acknowledgement (it's history, not a live flag); escalationAcknowledgedAt
  // is what "still needs attention" checks should look at instead.
  isEscalated: boolean;
  escalatedAt: string | null;
  escalationReason: string | null;
  escalationAcknowledgedAt: string | null;
  // Reversible "removed from the queue" — see backend's Ticket.isArchived.
  isArchived: boolean;
  archivedAt: string | null;
};

// "TECH-42" — the Zoho-style human-facing ID. Always derive this from live
// data, never store/duplicate the string itself.
export function ticketDisplayId(t: { ticketNumber: number; department: { key: string } }) {
  return `${t.department.key}-${t.ticketNumber}`;
}
export type TicketDetail = TicketSummary & {
  description: string;
  customFields: Record<string, unknown>;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  ticketTypeVersion: { statusSchemaSnapshot: { statuses: { key: string; label: string; isTerminal: boolean }[]; transitions: { fromStatusKey: string; toStatusKey: string; allowedRoles: string[] }[] } };
};

// INTERNAL (agent-only notes) vs PUBLIC (also shown to the requester on
// their own /my-tickets view) — see backend's tickets.service.ts comment
// methods. The employee-facing routes only ever return/accept PUBLIC.
export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type CommentVisibility = 'INTERNAL' | 'PUBLIC';
export type Comment = {
  id: string;
  ticketId: string;
  visibility: CommentVisibility;
  body: string;
  createdAt: string;
  staffAuthor: { id: string; name: string; role: string } | null;
  customerAuthor: { id: string; name: string } | null;
};

export type DashboardData = {
  departmentKey: string;
  totals: { open: number; total: number };
  statusCounts: { statusKey: string; label: string; count: number }[];
  slaSummary: { onTrack: number; responseBreached: number; resolutionBreached: number; noSlaRule: number };
  agentWorkload: { agentId: string | null; agentName: string; openCount: number; totalCount: number }[];
  aging: { id: string; ticketNumber: number; subject: string; priority: string; statusLabel: string; assignedAgentName: string; ageHours: number }[];
  escalations: { active: number; acknowledged: number };
  escalationQueue: {
    id: string;
    ticketNumber: number;
    subject: string;
    priority: string;
    statusLabel: string;
    assignedAgentName: string;
    escalationReason: string | null;
    escalatedAt: string | null;
  }[];
};

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  department: { key: string; name: string } | null;
};

// Only present on the CREATE response, never on a later GET — see
// tickets.service.ts's create() comment on why this isn't persisted.
export type CreatedTicket = TicketDetail & { autoAssignReasoning: string | null };

export type NotificationItem = {
  id: string;
  type: string; // 'TICKET_ESCALATED' (urgent) | 'TICKET_MANAGER_FYI' (calm, no action needed)
  payload: { ticketId?: string; displayId?: string; subject?: string; reason?: string; note?: string | null };
  readAt: string | null;
  createdAt: string;
};

export const api = {
  // captchaToken: see lib/recaptcha.ts's getRecaptchaToken() — undefined if
  // reCAPTCHA isn't configured, backend skips verification in that case too.
  staffLogin: (email: string, password: string, captchaToken?: string) =>
    request<{ accessToken: string; user: { id: string; email: string; name: string; role: string; departmentId: string | null } }>(
      '/auth/staff/login',
      { method: 'POST', body: JSON.stringify({ email, password, captchaToken }) },
    ),
  // EMPLOYEE only — see auth.service.ts's signupEmployee for why this is
  // safe to leave unauthenticated.
  staffSignup: (name: string, email: string, password: string, captchaToken?: string) =>
    request<{ accessToken: string; user: { id: string; email: string; name: string; role: string; departmentId: string | null } }>(
      '/auth/staff/signup',
      { method: 'POST', body: JSON.stringify({ name, email, password, captchaToken }) },
    ),
  portalLogin: (email: string, password: string, captchaToken?: string) =>
    request<{ accessToken: string; customer: { id: string; name: string } }>('/auth/portal/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaToken }),
    }),
  health: () => request<{ status: string }>('/health'),

  listDepartments: (token: string | null) => request<Department[]>('/departments', { token }),
  // SUPER_ADMIN only. Activating a department with no ticket type yet
  // auto-provisions a default "General Support" one on the backend, so
  // there's nothing extra to do here to make it usable.
  updateDepartment: (id: string, dto: { name?: string; isActive?: boolean }, token: string | null) =>
    request<Department>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(dto), token }),

  listTicketTypes: (departmentId: string, token: string | null) =>
    request<TicketTypeSummary[]>(`/departments/${departmentId}/ticket-types`, { token }),
  getTicketTypeDefinition: (id: string, token: string | null) =>
    request<TicketTypeDefinitionDetail>(`/ticket-types/${id}`, { token }),
  getTicketTypeVersion: (id: string, versionNumber: number, customerType: 'B2B' | 'B2C', token: string | null) =>
    request<TicketTypeVersionForRenderer>(`/ticket-types/${id}/versions/${versionNumber}?customerType=${customerType}`, { token }),

  // ── Ticket-type admin builder (SUPER_ADMIN/DEPT_ADMIN) ─────────────────
  // Same GET /ticket-types/:id route as getTicketTypeDefinition above — the
  // backend always returns the full fields/statuses/transitions/SLA/
  // escalation shape, this just types the wider view the builder page needs.
  createTicketTypeDefinition: (departmentId: string, dto: { key: string; name: string; description?: string }, token: string | null) =>
    request<TicketTypeSummary>(`/departments/${departmentId}/ticket-types`, { method: 'POST', body: JSON.stringify(dto), token }),
  getTicketTypeAdminDetail: (id: string, token: string | null) =>
    request<TicketTypeDefinitionAdmin>(`/ticket-types/${id}`, { token }),
  updateTicketTypeDefinition: (id: string, dto: { name?: string; description?: string; isActive?: boolean }, token: string | null) =>
    request<TicketTypeSummary>(`/ticket-types/${id}`, { method: 'PATCH', body: JSON.stringify(dto), token }),
  addTicketTypeField: (
    id: string,
    dto: { key: string; label: string; fieldType: string; appliesTo: string; required: boolean; options: FieldOption[]; order: number },
    token: string | null,
  ) => request<FieldDefinition>(`/ticket-types/${id}/fields`, { method: 'POST', body: JSON.stringify(dto), token }),
  addTicketTypeStatus: (
    id: string,
    dto: { key: string; label: string; isInitial?: boolean; isTerminal?: boolean; order?: number },
    token: string | null,
  ) => request<StatusDefinition>(`/ticket-types/${id}/statuses`, { method: 'POST', body: JSON.stringify(dto), token }),
  addTicketTypeTransition: (
    id: string,
    dto: { fromStatusKey: string; toStatusKey: string; allowedRoles?: string[] },
    token: string | null,
  ) => request<StatusTransition>(`/ticket-types/${id}/transitions`, { method: 'POST', body: JSON.stringify(dto), token }),
  addTicketTypeSlaRule: (
    id: string,
    dto: { customerType: CustomerType; priority: string; responseTimeMinutes: number; resolutionTimeMinutes: number },
    token: string | null,
  ) => request<SlaRule>(`/ticket-types/${id}/sla-rules`, { method: 'POST', body: JSON.stringify(dto), token }),
  addTicketTypeEscalationRule: (
    id: string,
    dto: { customerType: CustomerType; priority: string; escalateOnSlaBreach?: boolean; reassignmentThreshold?: number },
    token: string | null,
  ) => request<EscalationRule>(`/ticket-types/${id}/escalation-rules`, { method: 'POST', body: JSON.stringify(dto), token }),
  publishTicketType: (id: string, token: string | null) =>
    request<{ id: string; versionNumber: number }>(`/ticket-types/${id}/publish`, { method: 'POST', token }),

  listDepartmentUsers: (departmentId: string, token: string | null) =>
    request<StaffMember[]>(`/departments/${departmentId}/users`, { token }),
  searchStaff: (q: string, token: string | null) =>
    request<StaffSearchResult[]>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }),

  searchCustomers: (q: string, token: string | null) =>
    request<CustomerRecord[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }),
  createCustomer: (
    dto: { name: string; email: string; phone?: string; companyName?: string },
    token: string | null,
  ) => request<CustomerRecord>('/customers', { method: 'POST', body: JSON.stringify(dto), token }),

  createTicket: (
    departmentId: string,
    dto: {
      ticketTypeDefinitionId: string;
      customerId?: string;
      requesterUserId?: string;
      priority: string;
      subject: string;
      description: string;
      customFields?: Record<string, unknown>;
      assignedAgentId?: string;
    },
    token: string | null,
  ) => request<CreatedTicket>(`/departments/${departmentId}/tickets`, { method: 'POST', body: JSON.stringify(dto), token }),

  listTickets: (
    departmentId: string,
    filters: { statusKey?: string; priority?: string; assignedAgentId?: string; search?: string; archived?: 'true' | 'false' },
    token: string | null,
  ) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    const qs = params.toString();
    return request<TicketSummary[]>(`/departments/${departmentId}/tickets${qs ? `?${qs}` : ''}`, { token });
  },
  getTicket: (id: string, token: string | null) => request<TicketDetail>(`/tickets/${id}`, { token }),
  assignTicket: (id: string, assignedAgentId: string | null, token: string | null) =>
    request<TicketDetail>(`/tickets/${id}/assign`, { method: 'PATCH', body: JSON.stringify({ assignedAgentId }), token }),
  transitionTicket: (id: string, toStatusKey: string, token: string | null) =>
    request<TicketDetail>(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ toStatusKey }), token }),
  // SUPER_ADMIN/DEPT_ADMIN only — reversible "remove an unrequired ticket".
  archiveTicket: (id: string, token: string | null) => request<TicketDetail>(`/tickets/${id}/archive`, { method: 'PATCH', token }),
  unarchiveTicket: (id: string, token: string | null) => request<TicketDetail>(`/tickets/${id}/unarchive`, { method: 'PATCH', token }),
  escalateTicket: (id: string, note: string | undefined, token: string | null) =>
    request<TicketDetail>(`/tickets/${id}/escalate`, { method: 'POST', body: JSON.stringify({ note }), token }),
  acknowledgeEscalation: (id: string, token: string | null) =>
    request<TicketDetail>(`/tickets/${id}/escalation/acknowledge`, { method: 'PATCH', token }),
  // Calm, non-urgent "keep the manager posted" — unlike escalate, this never
  // changes the ticket itself (see tickets.service.ts's notifyManager).
  notifyManager: (id: string, note: string | undefined, token: string | null) =>
    request<{ ok: true }>(`/tickets/${id}/notify-manager`, { method: 'POST', body: JSON.stringify({ note }), token }),

  // ── Comments ──────────────────────────────────────────────────────────
  listComments: (ticketId: string, token: string | null) => request<Comment[]>(`/tickets/${ticketId}/comments`, { token }),
  addComment: (ticketId: string, body: string, visibility: CommentVisibility, token: string | null) =>
    request<Comment>(`/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify({ body, visibility }), token }),
  // Employee self-service — always PUBLIC server-side, nothing to pass here.
  listMyComments: (ticketId: string, token: string | null) => request<Comment[]>(`/my-tickets/${ticketId}/comments`, { token }),
  addMyComment: (ticketId: string, body: string, token: string | null) =>
    request<Comment>(`/my-tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify({ body }), token }),

  getDashboard: (departmentId: string, token: string | null) =>
    request<DashboardData>(`/departments/${departmentId}/dashboard`, { token }),

  // ── Notifications (escalation fan-out lands here) ───────────────────
  listNotifications: (token: string | null) => request<NotificationItem[]>('/notifications', { token }),
  getUnreadNotificationCount: (token: string | null) =>
    request<{ count: number }>('/notifications/unread-count', { token }),
  markNotificationRead: (id: string, token: string | null) =>
    request<NotificationItem>(`/notifications/${id}/read`, { method: 'PATCH', token }),

  // ── Self-service (EMPLOYEE) ──────────────────────────────────────────
  createMyTicket: (
    dto: {
      departmentId: string;
      ticketTypeDefinitionId: string;
      priority: string;
      subject: string;
      description: string;
      customFields?: Record<string, unknown>;
    },
    token: string | null,
  ) => request<CreatedTicket>('/my-tickets', { method: 'POST', body: JSON.stringify(dto), token }),
  listMyTickets: (token: string | null) => request<TicketSummary[]>('/my-tickets', { token }),
  getMyTicket: (id: string, token: string | null) => request<TicketDetail>(`/my-tickets/${id}`, { token }),

  // ── AI (Gemini-powered, human-in-the-loop — see backend/src/ai) ─────
  triage: (departmentId: string, subject: string, description: string, token: string | null) =>
    request<{ ticketTypeId: string; priority: string; reasoning: string }>(`/departments/${departmentId}/ai/triage`, {
      method: 'POST',
      body: JSON.stringify({ subject, description }),
      token,
    }),
  draftReply: (ticketId: string, token: string | null) =>
    request<{ draft: string }>(`/tickets/${ticketId}/ai/draft-reply`, { method: 'POST', token }),
  getDashboardInsights: (departmentId: string, token: string | null) =>
    request<{ summary: string }>(`/departments/${departmentId}/ai/insights`, { token }),
  // Warn-not-block: flags inappropriate language but never prevents
  // submission — see ai.service.ts's checkLanguage.
  checkLanguage: (subject: string, description: string, token: string | null) =>
    request<{ flagged: boolean; reason: string }>('/ai/check-language', {
      method: 'POST',
      body: JSON.stringify({ subject, description }),
      token,
    }),
  // Stateless server-side — send the whole running conversation back each
  // time (see ai.service.ts's chat()). history omits the message just sent.
  chat: (message: string, history: ChatTurn[], token: string | null) =>
    request<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, history }), token }),

  // ── Admin: onboarding logins (SUPER_ADMIN only) ─────────────────────
  createUser: (
    dto: { email: string; name: string; role: string; departmentId?: string; password?: string },
    token: string | null,
  ) =>
    request<{ id: string; email: string; name: string; role: string; departmentId: string | null; temporaryPassword: string }>(
      '/users',
      { method: 'POST', body: JSON.stringify(dto), token },
    ),
  // "How many people use this tool" — SUPER_ADMIN only, unfiltered roster.
  listUserDirectory: (token: string | null) => request<DirectoryUser[]>('/users/directory', { token }),
};

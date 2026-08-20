// Minimal fetch wrapper. Deliberately two separate token slots (staff vs
// customer) mirroring the backend's principalType split — never merge these
// into one "auth token" concept, that's exactly the boundary the backend
// guards enforce (see backend/src/auth/jwt-payload.interface.ts).

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

export const staffToken = {
  get: () => localStorage.getItem(STAFF_TOKEN_KEY),
  set: (t: string) => localStorage.setItem(STAFF_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(STAFF_TOKEN_KEY),
};

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

export const customerToken = {
  get: () => localStorage.getItem(CUSTOMER_TOKEN_KEY),
  set: (t: string) => localStorage.setItem(CUSTOMER_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(CUSTOMER_TOKEN_KEY),
};

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

export type CustomerRecord = { id: string; name: string; email: string; phone: string | null; company: { id: string; name: string } | null };
export type StaffMember = { id: string; name: string; email: string; role: string };
export type StaffSearchResult = { id: string; name: string; email: string; role: string; departmentId: string | null };

export type TicketSummary = {
  id: string;
  ticketNumber: number;
  department: { key: string; name: string };
  subject: string;
  priority: string;
  statusKey: string;
  createdAt: string;
  customer: { id: string; name: string; email: string };
  company: { id: string; name: string } | null;
  assignedAgent: { id: string; name: string } | null;
  ticketTypeDefinition: { id: string; name: string };
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

export type DashboardData = {
  departmentKey: string;
  totals: { open: number; total: number };
  statusCounts: { statusKey: string; label: string; count: number }[];
  slaSummary: { onTrack: number; responseBreached: number; resolutionBreached: number; noSlaRule: number };
  agentWorkload: { agentId: string | null; agentName: string; openCount: number; totalCount: number }[];
  aging: { id: string; ticketNumber: number; subject: string; priority: string; statusLabel: string; assignedAgentName: string; ageHours: number }[];
};

export const api = {
  staffLogin: (email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; email: string; name: string; role: string; departmentId: string | null } }>(
      '/auth/staff/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),
  // EMPLOYEE only — see auth.service.ts's signupEmployee for why this is
  // safe to leave unauthenticated.
  staffSignup: (name: string, email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; email: string; name: string; role: string; departmentId: string | null } }>(
      '/auth/staff/signup',
      { method: 'POST', body: JSON.stringify({ name, email, password }) },
    ),
  portalLogin: (email: string, password: string) =>
    request<{ accessToken: string; customer: { id: string; name: string } }>('/auth/portal/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  health: () => request<{ status: string }>('/health'),

  listDepartments: (token: string | null) => request<Department[]>('/departments', { token }),

  listTicketTypes: (departmentId: string, token: string | null) =>
    request<TicketTypeSummary[]>(`/departments/${departmentId}/ticket-types`, { token }),
  getTicketTypeDefinition: (id: string, token: string | null) =>
    request<TicketTypeDefinitionDetail>(`/ticket-types/${id}`, { token }),
  getTicketTypeVersion: (id: string, versionNumber: number, customerType: 'B2B' | 'B2C', token: string | null) =>
    request<TicketTypeVersionForRenderer>(`/ticket-types/${id}/versions/${versionNumber}?customerType=${customerType}`, { token }),

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
  ) => request<TicketDetail>(`/departments/${departmentId}/tickets`, { method: 'POST', body: JSON.stringify(dto), token }),

  listTickets: (
    departmentId: string,
    filters: { statusKey?: string; priority?: string; assignedAgentId?: string; search?: string },
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

  getDashboard: (departmentId: string, token: string | null) =>
    request<DashboardData>(`/departments/${departmentId}/dashboard`, { token }),

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
  ) => request<TicketDetail>('/my-tickets', { method: 'POST', body: JSON.stringify(dto), token }),
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

  // ── Admin: onboarding logins (SUPER_ADMIN only) ─────────────────────
  createUser: (
    dto: { email: string; name: string; role: string; departmentId?: string; password?: string },
    token: string | null,
  ) =>
    request<{ id: string; email: string; name: string; role: string; departmentId: string | null; temporaryPassword: string }>(
      '/users',
      { method: 'POST', body: JSON.stringify(dto), token },
    ),
};

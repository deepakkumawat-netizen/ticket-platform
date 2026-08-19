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

export const api = {
  staffLogin: (email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; name: string; role: string } }>('/auth/staff/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  portalLogin: (email: string, password: string) =>
    request<{ accessToken: string; customer: { id: string; name: string } }>('/auth/portal/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  health: () => request<{ status: string }>('/health'),
};

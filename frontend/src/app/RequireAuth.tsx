import { Navigate, Outlet } from 'react-router-dom';

// Route guard for the two SPA trees below — mirrors the backend's principalType
// split: a staff token unlocks /app/*, a customer token unlocks /portal/*,
// and neither substitutes for the other.
export function RequireAuth({ token, redirectTo }: { token: string | null; redirectTo: string }) {
  return token ? <Outlet /> : <Navigate to={redirectTo} replace />;
}

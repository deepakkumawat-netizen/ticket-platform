import { Navigate, Outlet } from 'react-router-dom';

// Route guard for the two SPA trees below — mirrors the backend's principalType
// split: a staff token unlocks /app/*, a customer token unlocks /portal/*,
// and neither substitutes for the other.
//
// Takes the *hook* (useStaffToken/useCustomerToken), not a plain string, and
// calls it here rather than in App.tsx. App.tsx only renders once (nothing
// about a raw `staffToken.get()` call in its JSX tells React to re-render
// it), so a `token` prop computed there freezes at whatever value existed at
// initial mount — login would set localStorage, navigate to /app, but this
// guard would still be holding the stale `null` from before login and bounce
// straight back to /staff/login. Calling the hook *inside* this component
// lets its own useSyncExternalStore subscription force a re-render the
// moment the token store changes, independent of whether App.tsx re-renders.
export function RequireAuth({ useToken, redirectTo }: { useToken: () => string | null; redirectTo: string }) {
  const token = useToken();
  return token ? <Outlet /> : <Navigate to={redirectTo} replace />;
}

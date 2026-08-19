import { Navigate, Route, Routes } from 'react-router-dom';
import { StaffLoginPage } from './features/auth/StaffLoginPage';
import { PortalLoginPage } from './features/auth/PortalLoginPage';
import { StaffHomePage } from './features/tickets/StaffHomePage';
import { PortalHomePage } from './features/portal/PortalHomePage';
import { RequireAuth } from './app/RequireAuth';
import { staffToken, customerToken } from './lib/api';

// Two independent route trees sharing one SPA (per the plan's pragmatic v1
// folder structure) — /app/* is the internal staff tree, /portal/* is the
// external customer tree. They never share a token or a guard.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/staff/login" replace />} />

      <Route path="/staff/login" element={<StaffLoginPage />} />
      <Route element={<RequireAuth token={staffToken.get()} redirectTo="/staff/login" />}>
        <Route path="/app" element={<StaffHomePage />} />
      </Route>

      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route element={<RequireAuth token={customerToken.get()} redirectTo="/portal/login" />}>
        <Route path="/portal" element={<PortalHomePage />} />
      </Route>
    </Routes>
  );
}

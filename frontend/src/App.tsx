import { Navigate, Route, Routes } from 'react-router-dom';
import { StaffLoginPage } from './features/auth/StaffLoginPage';
import { PortalLoginPage } from './features/auth/PortalLoginPage';
import { TicketListPage } from './features/tickets/TicketListPage';
import { NewTicketPage } from './features/tickets/NewTicketPage';
import { TicketDetailPage } from './features/tickets/TicketDetailPage';
import { DepartmentDashboardPage } from './features/dashboards/DepartmentDashboardPage';
import { PortalHomePage } from './features/portal/PortalHomePage';
import { RequireAuth } from './app/RequireAuth';
import { StaffLayout } from './app/StaffLayout';
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
        <Route element={<StaffLayout />}>
          <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/app/dashboard" element={<DepartmentDashboardPage />} />
          <Route path="/app/tickets" element={<TicketListPage />} />
          <Route path="/app/tickets/new" element={<NewTicketPage />} />
          <Route path="/app/tickets/:id" element={<TicketDetailPage />} />
        </Route>
      </Route>

      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route element={<RequireAuth token={customerToken.get()} redirectTo="/portal/login" />}>
        <Route path="/portal" element={<PortalHomePage />} />
      </Route>
    </Routes>
  );
}

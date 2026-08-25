import { Navigate, Route, Routes } from 'react-router-dom';
import { StaffLoginPage } from './features/auth/StaffLoginPage';
import { StaffSignupPage } from './features/auth/StaffSignupPage';
import { PortalLoginPage } from './features/auth/PortalLoginPage';
import { TicketListPage } from './features/tickets/TicketListPage';
import { NewTicketPage } from './features/tickets/NewTicketPage';
import { TicketDetailPage } from './features/tickets/TicketDetailPage';
import { MyTicketsPage } from './features/tickets/MyTicketsPage';
import { RaiseTicketPage } from './features/tickets/RaiseTicketPage';
import { MyTicketDetailPage } from './features/tickets/MyTicketDetailPage';
import { CreateUserPage } from './features/admin/CreateUserPage';
import { UserDirectoryPage } from './features/admin/UserDirectoryPage';
import { DepartmentsAdminPage } from './features/admin/DepartmentsAdminPage';
import { DepartmentDashboardPage } from './features/dashboards/DepartmentDashboardPage';
import { PortalHomePage } from './features/portal/PortalHomePage';
import { RequireAuth } from './app/RequireAuth';
import { StaffLayout } from './app/StaffLayout';
import { staffUser, useStaffToken, useCustomerToken } from './lib/api';

// EMPLOYEE has no department queue/dashboard — land them on their own
// ticket list instead. Everyone else lands on the dashboard, as before.
function AppIndex() {
  const isEmployee = staffUser.get()?.role === 'EMPLOYEE';
  return <Navigate to={isEmployee ? '/app/my-tickets' : '/app/dashboard'} replace />;
}

// Two independent route trees sharing one SPA (per the plan's pragmatic v1
// folder structure) — /app/* is the internal staff tree, /portal/* is the
// external customer tree. They never share a token or a guard.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/staff/login" replace />} />

      <Route path="/staff/login" element={<StaffLoginPage />} />
      <Route path="/staff/signup" element={<StaffSignupPage />} />
      <Route element={<RequireAuth useToken={useStaffToken} redirectTo="/staff/login" />}>
        <Route element={<StaffLayout />}>
          <Route path="/app" element={<AppIndex />} />
          <Route path="/app/dashboard" element={<DepartmentDashboardPage />} />
          <Route path="/app/tickets" element={<TicketListPage />} />
          <Route path="/app/tickets/new" element={<NewTicketPage />} />
          <Route path="/app/tickets/:id" element={<TicketDetailPage />} />
          <Route path="/app/my-tickets" element={<MyTicketsPage />} />
          <Route path="/app/my-tickets/new" element={<RaiseTicketPage />} />
          <Route path="/app/my-tickets/:id" element={<MyTicketDetailPage />} />
          <Route path="/app/departments" element={<DepartmentsAdminPage />} />
          <Route path="/app/team" element={<UserDirectoryPage />} />
          <Route path="/app/team/new" element={<CreateUserPage />} />
        </Route>
      </Route>

      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route element={<RequireAuth useToken={useCustomerToken} redirectTo="/portal/login" />}>
        <Route path="/portal" element={<PortalHomePage />} />
      </Route>
    </Routes>
  );
}

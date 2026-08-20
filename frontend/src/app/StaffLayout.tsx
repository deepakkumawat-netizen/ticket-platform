import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { staffToken, staffUser } from '../lib/api';

// Shared shell for every /app/* screen — sidebar + topbar, TailAdmin-style.
// Individual pages (DepartmentDashboardPage, TicketListPage, ...) render
// inside <Outlet/> and only own their own content, not navigation chrome.
export function StaffLayout() {
  const navigate = useNavigate();
  const me = staffUser.get();
  const isEmployee = me?.role === 'EMPLOYEE';
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  function signOut() {
    staffToken.clear();
    staffUser.clear();
    navigate('/staff/login');
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <span className="app-sidebar-logo">TP</span>
          <span>Ticket Platform</span>
        </div>
        <nav className="app-sidebar-nav">
          {isEmployee ? (
            <>
              <NavLink to="/app/my-tickets" end className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <TicketIcon /> My Tickets
              </NavLink>
              <NavLink to="/app/my-tickets/new" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <PlusIcon /> Raise a Ticket
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/app/dashboard" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <GridIcon /> Dashboard
              </NavLink>
              <NavLink to="/app/tickets" end className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <TicketIcon /> Tickets
              </NavLink>
              <NavLink to="/app/tickets/new" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <PlusIcon /> New Ticket
              </NavLink>
              {isSuperAdmin && (
                <NavLink to="/app/team/new" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                  <UserPlusIcon /> Add Team Member
                </NavLink>
              )}
            </>
          )}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div />
          <div className="app-topbar-user">
            <span className="app-topbar-name">{me?.name}</span>
            <span className="app-topbar-role">{me?.role.replace('_', ' ')}</span>
            <button className="app-signout" onClick={signOut}>
              <LogoutIcon /> Sign out
            </button>
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
      <line x1="12" y1="6" x2="12" y2="18" strokeDasharray="2 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

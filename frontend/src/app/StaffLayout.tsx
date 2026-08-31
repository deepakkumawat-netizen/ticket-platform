import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, NotificationItem, staffToken, staffUser } from '../lib/api';
import { AiChatWidget } from './AiChatWidget';

// Shared shell for every /app/* screen — sidebar + topbar, TailAdmin-style.
// Individual pages (DepartmentDashboardPage, TicketListPage, ...) render
// inside <Outlet/> and only own their own content, not navigation chrome.
export function StaffLayout() {
  const navigate = useNavigate();
  const me = staffUser.get();
  const isEmployee = me?.role === 'EMPLOYEE';
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
  const isDeptAdmin = me?.role === 'DEPT_ADMIN';

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
              <NavLink to="/app/bulk-assist" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                <SparkleIcon /> Bulk AI Assist
              </NavLink>
              {(isSuperAdmin || isDeptAdmin) && (
                <NavLink to="/app/ticket-types" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                  <BuildingIcon /> Ticket Types
                </NavLink>
              )}
              {isSuperAdmin && (
                <>
                  <NavLink to="/app/departments" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                    <BuildingIcon /> Departments
                  </NavLink>
                  <NavLink to="/app/team" end className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                    <UsersIcon /> Team Directory
                  </NavLink>
                  <NavLink to="/app/team/new" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                    <UserPlusIcon /> Add Team Member
                  </NavLink>
                </>
              )}
            </>
          )}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <NotificationBell />
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
      <AiChatWidget />
    </div>
  );
}

// Polls rather than pushes (no websocket in this codebase) — good enough for
// v1, same tradeoff every other "live-ish" number here makes (dashboard
// stats are refetched on navigation, not streamed).
function NotificationBell() {
  const token = staffToken.get();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!token) return;
    const poll = () => api.getUnreadNotificationCount(token).then((r) => setCount(r.count)).catch(() => {});
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [token]);

  function toggle() {
    if (!open && token) {
      api.listNotifications(token).then(setItems).catch(() => {});
    }
    setOpen((o) => !o);
  }

  function onItemClick(n: NotificationItem) {
    if (!n.readAt && token) {
      api.markNotificationRead(n.id, token).then(() => setCount((c) => Math.max(0, c - 1)));
    }
    setOpen(false);
  }

  return (
    <div className="notification-bell-wrap">
      <button type="button" className="notification-bell" onClick={toggle} aria-label="Notifications">
        <BellIcon />
        {count > 0 && <span className="notification-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notification-dropdown">
          <p className="notification-dropdown-title">Notifications</p>
          {items.length === 0 && <p className="notification-empty">Nothing yet</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              to={n.payload.ticketId ? `/app/tickets/${n.payload.ticketId}` : '#'}
              className={`notification-item${n.readAt ? '' : ' unread'}`}
              onClick={() => onItemClick(n)}
            >
              <span className="notification-item-title">
                {n.type === 'TICKET_ESCALATED' ? '🚩 ' : n.type === 'TICKET_MANAGER_FYI' ? '📣 ' : n.type === 'TICKET_ASSIGNED_TO_YOU' ? '📋 ' : ''}
                {n.payload.displayId ? `${n.payload.displayId} — ` : ''}
                {n.payload.subject ?? n.type}
              </span>
              <span className="notification-item-time">{new Date(n.createdAt).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
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

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
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

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <line x1="9" y1="7" x2="9" y2="7.01" />
      <line x1="15" y1="7" x2="15" y2="7.01" />
      <line x1="9" y1="12" x2="9" y2="12.01" />
      <line x1="15" y1="12" x2="15" y2="12.01" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

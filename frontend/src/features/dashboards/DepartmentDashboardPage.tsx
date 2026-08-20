import { ReactNode, useEffect, useState } from 'react';
import { api, staffToken, staffUser, DashboardData, Department } from '../../lib/api';

// The management-facing view this whole feature exists for: replaces the
// Excel sheet with a live read of the same Ticket rows the queue works from.
export function DepartmentDashboardPage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => {
        const active = all.filter((d) => d.isActive);
        setDepartments(active);
        if (!departmentId && active[0]) setDepartmentId(active[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'))
      .finally(() => setDepartmentsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!departmentId) return;
    setError(null);
    api
      .getDashboard(departmentId, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the dashboard'));
  }, [departmentId, token]);

  const maxStatusCount = data ? Math.max(1, ...data.statusCounts.map((s) => s.count)) : 1;
  const maxWorkload = data ? Math.max(1, ...data.agentWorkload.map((w) => w.openCount)) : 1;
  const currentDeptName = departments.find((d) => d.id === departmentId)?.name;

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dash-subtitle">{currentDeptName ? `${currentDeptName} department` : 'Live view of ticket activity'}</p>
        </div>
        {isSuperAdmin && (
          <select className="dash-dept-select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {isSuperAdmin && departmentsLoaded && departments.length === 0 ? (
        <p>No department is live yet — activate one from the departments list before there's anything to show here.</p>
      ) : !data ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="stat-cards">
            <StatCard icon={<InboxIcon />} tone="neutral" value={data.totals.open} label="Open tickets" />
            <StatCard icon={<LayersIcon />} tone="neutral" value={data.totals.total} label="Total tickets" />
            <StatCard icon={<CheckIcon />} tone="good" value={data.slaSummary.onTrack} label="On track" />
            <StatCard icon={<ClockIcon />} tone="warn" value={data.slaSummary.responseBreached} label="Response SLA breached" />
            <StatCard icon={<AlertIcon />} tone="danger" value={data.slaSummary.resolutionBreached} label="Resolution SLA breached" />
          </div>

          <div className="dash-grid">
            <section className="dash-card">
              <h2>Tickets by status</h2>
              <div className="bar-chart">
                {data.statusCounts.map((s) => (
                  <div key={s.statusKey} className="bar-row">
                    <span className="bar-label">{s.label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(s.count / maxStatusCount) * 100}%` }} />
                    </div>
                    <span className="bar-value">{s.count}</span>
                  </div>
                ))}
                {data.statusCounts.length === 0 && <p className="empty-row">No tickets yet.</p>}
              </div>
            </section>

            <section className="dash-card">
              <h2>Agent workload</h2>
              <div className="bar-chart">
                {data.agentWorkload.map((w) => (
                  <div key={w.agentId ?? 'unassigned'} className="bar-row">
                    <span className="bar-label">{w.agentName}</span>
                    <div className="bar-track">
                      <div className="bar-fill bar-fill-agent" style={{ width: `${(w.openCount / maxWorkload) * 100}%` }} />
                    </div>
                    <span className="bar-value">
                      {w.openCount} open / {w.totalCount} total
                    </span>
                  </div>
                ))}
                {data.agentWorkload.length === 0 && <p className="empty-row">No tickets yet.</p>}
              </div>
            </section>
          </div>

          <section className="dash-card dash-card-wide">
            <h2>Oldest open tickets</h2>
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {data.aging.map((t) => (
                  <tr key={t.id}>
                    <td>{t.subject}</td>
                    <td>{t.statusLabel}</td>
                    <td>
                      <span className={`priority-chip priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    </td>
                    <td>{t.assignedAgentName}</td>
                    <td>{t.ageHours < 24 ? `${t.ageHours}h` : `${Math.round(t.ageHours / 24)}d`}</td>
                  </tr>
                ))}
                {data.aging.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-row">
                      No open tickets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: 'neutral' | 'good' | 'warn' | 'danger';
  value: number;
  label: string;
}) {
  return (
    <div className="stat-card">
      <span className={`stat-icon stat-icon-${tone}`}>{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.3 2.3L15.5 9" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

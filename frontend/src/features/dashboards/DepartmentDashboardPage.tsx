import { useEffect, useState } from 'react';
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Dashboard</h1>
        {isSuperAdmin && (
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
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
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-value">{data.totals.open}</span>
              <span className="stat-label">Open tickets</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{data.totals.total}</span>
              <span className="stat-label">Total tickets</span>
            </div>
            <div className="stat-tile stat-tile-good">
              <span className="stat-value">{data.slaSummary.onTrack}</span>
              <span className="stat-label">On track</span>
            </div>
            <div className="stat-tile stat-tile-warn">
              <span className="stat-value">{data.slaSummary.responseBreached}</span>
              <span className="stat-label">Response SLA breached</span>
            </div>
            <div className="stat-tile stat-tile-danger">
              <span className="stat-value">{data.slaSummary.resolutionBreached}</span>
              <span className="stat-label">Resolution SLA breached</span>
            </div>
          </div>

          <section className="dashboard-section">
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

          <section className="dashboard-section">
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

          <section className="dashboard-section">
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

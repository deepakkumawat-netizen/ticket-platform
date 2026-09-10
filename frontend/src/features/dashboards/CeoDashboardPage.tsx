import { useEffect, useState } from 'react';
import { api, staffToken, OrgDashboardData } from '../../lib/api';

// SUPER_ADMIN only (see dashboards.controller.ts's @Roles) — every active
// department's dashboard in one screen, instead of DepartmentDashboardPage's
// pick-one-at-a-time dropdown. Reuses the exact same DashboardData shape
// each department card renders from — nothing here recomputes SLA/
// escalation numbers, it's a read-only rollup over what
// DashboardsService.getDashboard already returns per department.
export function CeoDashboardPage() {
  const token = staffToken.get();
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOrgDashboard(token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the org dashboard'));
  }, [token]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <h1>Org Dashboard</h1>
          <p className="dash-subtitle">Every department's queue, SLA health, and escalations — one screen, no switching.</p>
        </div>
      </div>

      <div className="stat-cards">
        <StatCard value={data.totals.open} label="Open tickets (all departments)" tone="neutral" />
        <StatCard value={data.totals.total} label="Total tickets" tone="neutral" />
        <StatCard value={data.totals.activeEscalations} label="Active escalations" tone="danger" />
        <StatCard value={data.totals.responseBreached} label="Response SLA breaches" tone="warn" />
        <StatCard value={data.totals.resolutionBreached} label="Resolution SLA breaches" tone="danger" />
      </div>

      {data.worstSlaDepartment && (
        <p className="ai-reasoning">⚠️ {data.worstSlaDepartment} has the most SLA breaches right now — worth a look first.</p>
      )}

      {data.departments.length === 0 && <p>No department is live yet.</p>}

      <div className="dash-grid">
        {data.departments.map((d) => (
          <section key={d.departmentId} className="dash-card">
            <h2>{d.departmentName}</h2>
            <table className="ticket-table">
              <tbody>
                <tr>
                  <td>Open / Total</td>
                  <td>
                    {d.totals.open} / {d.totals.total}
                  </td>
                </tr>
                <tr>
                  <td>On track</td>
                  <td>{d.slaSummary.onTrack}</td>
                </tr>
                <tr>
                  <td>Response breached</td>
                  <td>{d.slaSummary.responseBreached}</td>
                </tr>
                <tr>
                  <td>Resolution breached</td>
                  <td>{d.slaSummary.resolutionBreached}</td>
                </tr>
                <tr className={d.escalations.active > 0 ? 'ticket-row-escalated' : undefined}>
                  <td>Active escalations</td>
                  <td>{d.escalations.active}</td>
                </tr>
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

function StatCard({ value, label, tone }: { value: number; label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' }) {
  return (
    <div className="stat-card">
      <span className={`stat-value stat-value-${tone}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

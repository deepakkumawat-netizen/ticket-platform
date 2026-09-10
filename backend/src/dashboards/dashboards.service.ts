import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type StatusSchemaSnapshot = {
  statuses: { key: string; label: string; isInitial: boolean; isTerminal: boolean; order: number }[];
};

// One query, then plain-JS aggregation — not a handful of separate Prisma
// groupBy calls — because "is this ticket open" and "what's this status's
// label" both depend on each ticket's OWN frozen ticketTypeVersion snapshot
// (a department can have several ticket types, each with its own status
// set), not a single global status enum. Fine at this data scale; revisit
// with real SQL aggregation if a department's ticket volume grows large.
@Injectable()
export class DashboardsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(departmentId: string) {
    const department = await this.prisma.department.findUniqueOrThrow({ where: { id: departmentId }, select: { key: true } });
    const tickets = await this.prisma.ticket.findMany({
      // Archived tickets are "removed" from the working queue — exclude
      // them from every stat here, same as the ticket list's default view.
      where: { departmentId, isArchived: false },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        statusKey: true,
        createdAt: true,
        responseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        assignedAgentId: true,
        assignedAgent: { select: { id: true, name: true } },
        ticketTypeVersion: { select: { statusSchemaSnapshot: true } },
        isEscalated: true,
        escalatedAt: true,
        escalationReason: true,
        escalationAcknowledgedAt: true,
      },
    });

    const now = new Date();
    const isTerminal = (t: (typeof tickets)[number]) => {
      const schema = t.ticketTypeVersion.statusSchemaSnapshot as unknown as StatusSchemaSnapshot;
      return schema.statuses.find((s) => s.key === t.statusKey)?.isTerminal ?? false;
    };
    const statusLabel = (t: (typeof tickets)[number]) => {
      const schema = t.ticketTypeVersion.statusSchemaSnapshot as unknown as StatusSchemaSnapshot;
      return schema.statuses.find((s) => s.key === t.statusKey)?.label ?? t.statusKey;
    };

    // ── Status counts ──────────────────────────────────────────────────
    const statusCounts = new Map<string, { statusKey: string; label: string; count: number }>();
    for (const t of tickets) {
      const entry = statusCounts.get(t.statusKey) ?? { statusKey: t.statusKey, label: statusLabel(t), count: 0 };
      entry.count += 1;
      statusCounts.set(t.statusKey, entry);
    }

    const openTickets = tickets.filter((t) => !isTerminal(t));

    // ── SLA compliance ────────────────────────────────────────────────
    let responseBreached = 0;
    let resolutionBreached = 0;
    let noSlaRule = 0;
    for (const t of openTickets) {
      if (!t.responseDueAt && !t.resolutionDueAt) {
        noSlaRule += 1;
        continue;
      }
      if (!t.firstRespondedAt && t.responseDueAt && now > t.responseDueAt) responseBreached += 1;
      if (!t.resolvedAt && t.resolutionDueAt && now > t.resolutionDueAt) resolutionBreached += 1;
    }
    const onTrack = openTickets.length - noSlaRule - Math.max(responseBreached, resolutionBreached);

    // ── Agent workload ────────────────────────────────────────────────
    const workload = new Map<string, { agentId: string | null; agentName: string; openCount: number; totalCount: number }>();
    for (const t of tickets) {
      const key = t.assignedAgentId ?? '__unassigned__';
      const entry = workload.get(key) ?? {
        agentId: t.assignedAgentId,
        agentName: t.assignedAgent?.name ?? 'Unassigned',
        openCount: 0,
        totalCount: 0,
      };
      entry.totalCount += 1;
      if (!isTerminal(t)) entry.openCount += 1;
      workload.set(key, entry);
    }

    // ── Aging — oldest open tickets first ────────────────────────────
    const aging = [...openTickets]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        priority: t.priority,
        statusLabel: statusLabel(t),
        assignedAgentName: t.assignedAgent?.name ?? 'Unassigned',
        ageHours: Math.round((now.getTime() - t.createdAt.getTime()) / 3_600_000),
      }));

    // ── Escalations ────────────────────────────────────────────────────
    // isEscalated stays true forever once set (it's ticket history — see
    // tickets.service.ts) — "active" here means "still needs a manager's
    // attention", i.e. not yet acknowledged.
    const escalated = tickets.filter((t) => t.isEscalated);
    const activeEscalations = escalated.filter((t) => !t.escalationAcknowledgedAt);
    const escalationQueue = [...activeEscalations]
      .sort((a, b) => (b.escalatedAt?.getTime() ?? 0) - (a.escalatedAt?.getTime() ?? 0))
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        priority: t.priority,
        statusLabel: statusLabel(t),
        assignedAgentName: t.assignedAgent?.name ?? 'Unassigned',
        escalationReason: t.escalationReason,
        escalatedAt: t.escalatedAt,
      }));

    return {
      departmentKey: department.key,
      totals: { open: openTickets.length, total: tickets.length },
      statusCounts: [...statusCounts.values()].sort((a, b) => b.count - a.count),
      slaSummary: { onTrack: Math.max(onTrack, 0), responseBreached, resolutionBreached, noSlaRule },
      agentWorkload: [...workload.values()].sort((a, b) => b.openCount - a.openCount),
      aging,
      escalations: { active: activeEscalations.length, acknowledged: escalated.length - activeEscalations.length },
      escalationQueue,
    };
  }

  // ── CEO cross-department view ────────────────────────────────────────
  // Extends, rather than duplicates, getDashboard() above — calls it once
  // per active department (in parallel) and wraps the results with a thin
  // org-level rollup computed from what each call already returns. Nothing
  // here re-derives SLA/escalation logic a second time. SUPER_ADMIN-only
  // (see dashboards.controller.ts) — this is the one screen giving a live
  // view of every department at once, instead of picking one at a time.
  async getOrgDashboard(orgId: string) {
    const departments = await this.prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const perDepartment = await Promise.all(
      departments.map(async (d) => ({ departmentId: d.id, departmentName: d.name, ...(await this.getDashboard(d.id)) })),
    );

    const totals = perDepartment.reduce(
      (acc, d) => ({
        open: acc.open + d.totals.open,
        total: acc.total + d.totals.total,
        activeEscalations: acc.activeEscalations + d.escalations.active,
        responseBreached: acc.responseBreached + d.slaSummary.responseBreached,
        resolutionBreached: acc.resolutionBreached + d.slaSummary.resolutionBreached,
      }),
      { open: 0, total: 0, activeEscalations: 0, responseBreached: 0, resolutionBreached: 0 },
    );

    const worstSlaDepartment =
      [...perDepartment]
        .filter((d) => d.slaSummary.responseBreached + d.slaSummary.resolutionBreached > 0)
        .sort((a, b) => b.slaSummary.responseBreached + b.slaSummary.resolutionBreached - (a.slaSummary.responseBreached + a.slaSummary.resolutionBreached))[0]
        ?.departmentName ?? null;

    return { totals, worstSlaDepartment, departments: perDepartment };
  }
}

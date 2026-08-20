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
    const tickets = await this.prisma.ticket.findMany({
      where: { departmentId },
      select: {
        id: true,
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
        subject: t.subject,
        priority: t.priority,
        statusLabel: statusLabel(t),
        assignedAgentName: t.assignedAgent?.name ?? 'Unassigned',
        ageHours: Math.round((now.getTime() - t.createdAt.getTime()) / 3_600_000),
      }));

    return {
      totals: { open: openTickets.length, total: tickets.length },
      statusCounts: [...statusCounts.values()].sort((a, b) => b.count - a.count),
      slaSummary: { onTrack: Math.max(onTrack, 0), responseBreached, resolutionBreached, noSlaRule },
      agentWorkload: [...workload.values()].sort((a, b) => b.openCount - a.openCount),
      aging,
    };
  }
}

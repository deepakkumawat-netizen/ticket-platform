import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogQueryDto } from './dto/list-audit-log.query.dto';

// Purely a new read surface — AuditLog is already written correctly
// everywhere (tickets.service.ts, sla-breach-check.service.ts,
// intake.service.ts). Every existing read of it is ticket-scoped
// (TicketsService.getHistory/getMyHistory); this is the first org-wide
// browser over the same table. SUPER_ADMIN-only (see audit.controller.ts).
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  list(orgId: string, filters: ListAuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };
    // Unpaginated + capped, same v1 scope as every other list endpoint in
    // this codebase (tickets, departments, ticket-types, intake) — fine at
    // this data scale; add real pagination if the org's audit volume
    // outgrows a single 200-row page.
    return this.prisma.auditLog.findMany({
      where,
      include: { actorUser: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

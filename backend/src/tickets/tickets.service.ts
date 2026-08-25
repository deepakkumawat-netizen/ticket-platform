import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CommentVisibility, Prisma } from '@prisma/client';
import {
  buildCustomFieldsSchema,
  CustomerType,
  EscalationReason,
  EscalationRuleEntry,
  fieldsForCustomerType,
  resolveEscalationRule,
  StaffRole,
} from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GeminiService } from '../ai/gemini.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListTicketsQueryDto } from './dto/list-tickets.query.dto';

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, companyId: true } },
  company: { select: { id: true, name: true } },
  assignedAgent: { select: { id: true, name: true } },
  ticketTypeDefinition: { select: { id: true, name: true } },
  // department.key powers the human-facing "{key}-{ticketNumber}" ID (e.g.
  // "TECH-42") shown in the UI — ticketNumber itself is a plain scalar
  // column, already present on every response without being listed here.
  department: { select: { key: true, name: true } },
};

// staffAuthor is populated for every comment in v1 (agents/employees are all
// Users) — customerAuthor exists on the model for the dormant /portal/*
// surface but nothing writes it yet.
const COMMENT_INCLUDE = {
  staffAuthor: { select: { id: true, name: true, role: true } },
  customerAuthor: { select: { id: true, name: true } },
};

type StatusSchemaSnapshot = {
  statuses: { key: string; label: string; isInitial: boolean; isTerminal: boolean; order: number }[];
  transitions: { fromStatusKey: string; toStatusKey: string; allowedRoles: string[] }[];
};
type SlaSnapshotEntry = { customerType: CustomerType; priority: string; responseTimeMinutes: number; resolutionTimeMinutes: number };

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private prisma: PrismaService,
    private ticketTypes: TicketTypesService,
    private notifications: NotificationsService,
    private gemini: GeminiService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────
  // Everything a ticket needs at creation time is derived from ONE frozen
  // TicketTypeVersion (see ticket-types.service.ts's publish()): which
  // fields are valid, what the initial status is, and which SLA clock to
  // start. This is the same snapshot the DynamicFormRenderer fetches, so
  // "what the form showed" and "what got validated" can never drift apart.
  async create(staff: StaffJwtPayload, departmentId: string, dto: CreateTicketDto) {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department || !department.isActive) {
      throw new BadRequestException('That department is not available');
    }

    const ticketTypeDef = await this.prisma.ticketTypeDefinition.findUnique({
      where: { id: dto.ticketTypeDefinitionId },
    });
    if (!ticketTypeDef || ticketTypeDef.departmentId !== departmentId) {
      throw new BadRequestException('That ticket type does not belong to this department');
    }

    if (!dto.customerId && !dto.requesterUserId) {
      throw new BadRequestException('Choose who this ticket is for');
    }
    const customer = dto.requesterUserId
      ? await this.findOrCreateCustomerForStaff(staff.orgId, dto.requesterUserId)
      : await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const customerType: CustomerType = customer.companyId ? CustomerType.B2B : CustomerType.B2C;

    const version = await this.ticketTypes.getLatestPublishedVersion(dto.ticketTypeDefinitionId);

    const fields = fieldsForCustomerType(version.fieldSchemaSnapshot as any, customerType);
    const parsedFields = buildCustomFieldsSchema(fields).safeParse(dto.customFields ?? {});
    if (!parsedFields.success) {
      throw new BadRequestException(parsedFields.error.flatten());
    }

    const statusSchema = version.statusSchemaSnapshot as unknown as StatusSchemaSnapshot;
    const initialStatus = statusSchema.statuses.find((s) => s.isInitial);
    if (!initialStatus) {
      // publish() refuses to freeze a version with no initial status, so this
      // would mean the data got here some other way — fail loudly, not silently.
      throw new BadRequestException('This ticket type has no initial status configured');
    }

    if (dto.assignedAgentId) {
      await this.assertAgentInDepartment(dto.assignedAgentId, departmentId);
    }

    const slaRules = version.slaSnapshot as unknown as SlaSnapshotEntry[];
    const slaRule = slaRules.find((r) => r.customerType === customerType && r.priority === dto.priority);
    const now = new Date();
    const responseDueAt = slaRule ? new Date(now.getTime() + slaRule.responseTimeMinutes * 60_000) : null;
    const resolutionDueAt = slaRule ? new Date(now.getTime() + slaRule.resolutionTimeMinutes * 60_000) : null;

    // Auto-assign: only when nobody explicitly picked someone — an explicit
    // assignedAgentId (from NewTicketPage's "Assign to" picker) always wins.
    // Best-effort: a failed/unavailable AI call must never block ticket
    // creation, it just leaves the ticket Unassigned like it always could.
    let assignedAgentId = dto.assignedAgentId ?? null;
    let autoAssignReasoning: string | null = null;
    if (!assignedAgentId) {
      const pick = await this.pickBestAgent(departmentId, dto.subject, dto.description);
      if (pick) {
        assignedAgentId = pick.agentId;
        autoAssignReasoning = pick.reasoning;
      }
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        orgId: staff.orgId,
        departmentId,
        ticketTypeDefinitionId: dto.ticketTypeDefinitionId,
        ticketTypeVersionId: version.id,
        customerType,
        companyId: customer.companyId,
        customerId: customer.id,
        assignedAgentId,
        priority: dto.priority,
        statusKey: initialStatus.key,
        subject: dto.subject,
        description: dto.description,
        customFields: parsedFields.data as Prisma.InputJsonValue,
        responseDueAt,
        resolutionDueAt,
      },
      include: TICKET_INCLUDE,
    });

    if (autoAssignReasoning) {
      await this.prisma.auditLog.create({
        data: {
          orgId: staff.orgId,
          actorType: 'SYSTEM',
          action: 'TICKET_AUTO_ASSIGNED',
          entityType: 'Ticket',
          entityId: ticket.id,
          afterJson: { agentId: assignedAgentId, reasoning: autoAssignReasoning },
        },
      });
    }

    // Not a persisted Ticket field — a one-time explanation for the create
    // response only, so NewTicketPage/RaiseTicketPage can show it once right
    // after creation (see their onSubmit handlers). A later GET of this same
    // ticket won't carry it, same as AI triage's reasoning isn't stored either.
    return { ...ticket, autoAssignReasoning };
  }

  // ── AI auto-assign ────────────────────────────────────────────────────
  // Human-in-the-loop everywhere ELSE in this codebase's AI features means
  // "suggest, never act" — auto-assign is the one deliberate exception,
  // scoped narrowly: it only ever picks WHO works a ticket, never touches
  // its content, status, or resolution (see the AI features doc / Deepak's
  // explicit call: auto-assign yes, auto-resolve no). Never throws — a
  // missing GEMINI_API_KEY, a Gemini outage, or zero available agents all
  // degrade to "leave it Unassigned," exactly like before this existed.
  private async pickBestAgent(
    departmentId: string,
    subject: string,
    description: string,
  ): Promise<{ agentId: string; reasoning: string } | null> {
    try {
      const candidates = await this.prisma.user.findMany({
        where: { departmentId, isActive: true, role: { in: [StaffRole.AGENT, StaffRole.DEPT_ADMIN] } },
        select: { id: true, name: true },
      });
      if (candidates.length === 0) return null;
      if (candidates.length === 1) {
        // Nothing to pick between — save the AI call.
        return { agentId: candidates[0].id, reasoning: 'Only one agent available in this department.' };
      }

      const withContext = await Promise.all(
        candidates.map(async (c) => {
          const [openCount, recentResolved] = await Promise.all([
            this.prisma.ticket.count({ where: { assignedAgentId: c.id, departmentId, resolvedAt: null } }),
            this.prisma.ticket.findMany({
              where: { assignedAgentId: c.id, departmentId, resolvedAt: { not: null } },
              orderBy: { resolvedAt: 'desc' },
              take: 5,
              select: { subject: true },
            }),
          ]);
          return { ...c, openCount, recentSubjects: recentResolved.map((t) => t.subject) };
        }),
      );

      const prompt = `You are assigning a new support ticket to the best-fit agent in a department. Given
the ticket and the candidate agents below (their current open-ticket workload, and the subjects of
tickets they've recently resolved as a rough signal of what they're familiar with), pick exactly one
agent. Prefer a good subject-matter match, but don't pick someone clearly overloaded if an
equally-suited agent has more capacity. Always pick exactly one agent ID from the list.

Ticket:
Subject: ${subject}
Description: ${description}

Candidates:
${withContext.map((c) => `- id: "${c.id}", name: "${c.name}", openTickets: ${c.openCount}, recentlyResolved: ${JSON.stringify(c.recentSubjects)}`).join('\n')}`;

      const result = await this.gemini.generateJson<{ agentId: string; reasoning: string }>(prompt, {
        type: 'OBJECT',
        properties: {
          agentId: { type: 'STRING', enum: candidates.map((c) => c.id) },
          reasoning: { type: 'STRING' },
        },
        required: ['agentId', 'reasoning'],
      });

      if (!candidates.some((c) => c.id === result.agentId)) return null;
      return result;
    } catch (err) {
      // e.g. GEMINI_API_KEY not set, or Gemini unreachable — leave Unassigned.
      this.logger.warn(`Auto-assign skipped: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ── Self-service (EMPLOYEE role) ─────────────────────────────────────
  // Deliberately thin wrappers around create()/the customer-scoping idea
  // above — an employee raising their own ticket is the exact same write
  // path as a DEPT_ADMIN/AGENT raising one on a colleague's behalf, just
  // with the requester forced to "me" and assignment stripped, never taken
  // from the client. See tickets.controller.ts for why no @Roles guard is
  // needed here (it's inherently self-scoped for any role).

  createForSelf(staff: StaffJwtPayload, departmentId: string, dto: CreateTicketDto) {
    return this.create(staff, departmentId, {
      ...dto,
      requesterUserId: staff.sub,
      customerId: undefined,
      assignedAgentId: undefined,
    });
  }

  async listMine(staff: StaffJwtPayload) {
    const customerId = await this.myCustomerId(staff);
    if (!customerId) return []; // never raised a ticket yet — nothing to show, don't create a Customer row on a read
    return this.prisma.ticket.findMany({
      where: { customerId },
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getMineOrThrow(staff: StaffJwtPayload, id: string) {
    const customerId = await this.myCustomerId(staff);
    const ticket = customerId
      ? await this.prisma.ticket.findUnique({
          where: { id },
          include: {
            ...TICKET_INCLUDE,
            ticketTypeVersion: { select: { statusSchemaSnapshot: true, fieldSchemaSnapshot: true, versionNumber: true } },
          },
        })
      : null;
    // Not yours (or doesn't exist) reads identically — no signal either way
    // about whether some other employee's ticket with that id exists.
    if (!ticket || ticket.customerId !== customerId) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private async myCustomerId(staff: StaffJwtPayload): Promise<string | null> {
    const me = await this.prisma.user.findUnique({ where: { id: staff.sub } });
    if (!me) return null;
    const customer = await this.prisma.customer.findUnique({ where: { email: me.email } });
    return customer?.id ?? null;
  }

  // ── List / detail ────────────────────────────────────────────────────
  // Unpaginated + capped, same v1 scope as every other list endpoint in this
  // codebase (departments, ticket-types) — fine for a department's queue at
  // this stage; add real pagination if a department's ticket volume outgrows it.
  list(departmentId: string, filters: ListTicketsQueryDto) {
    const where: Prisma.TicketWhereInput = {
      departmentId,
      // Archived tickets are hidden from the normal queue by default — pass
      // ?archived=true to see the Archived view instead. Never both at once,
      // since "removed from the queue" is the whole point of archiving.
      isArchived: filters.archived === 'true',
      ...(filters.statusKey ? { statusKey: filters.statusKey } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.assignedAgentId ? { assignedAgentId: filters.assignedAgentId } : {}),
      ...(filters.search
        ? {
            OR: [
              { subject: { contains: filters.search, mode: 'insensitive' as const } },
              { description: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.prisma.ticket.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getByIdOrThrow(staff: StaffJwtPayload, id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
        ticketTypeVersion: { select: { statusSchemaSnapshot: true, fieldSchemaSnapshot: true, versionNumber: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return ticket;
  }

  // ── Comments ──────────────────────────────────────────────────────────
  // Two visibilities: INTERNAL (agent notes, department-only — never shown
  // to the requester) and PUBLIC (also shown on the requester's own
  // /my-tickets view). Attachments aren't wired up yet even though the
  // schema supports them — no file-storage backend exists in this v1.

  async listComments(staff: StaffJwtPayload, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return this.prisma.comment.findMany({
      where: { ticketId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(staff: StaffJwtPayload, ticketId: string, dto: CreateCommentDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    // Default to INTERNAL — an agent note should never leak to the
    // requester unless explicitly marked PUBLIC.
    const visibility = dto.visibility ?? CommentVisibility.INTERNAL;
    const comment = await this.prisma.comment.create({
      data: { ticketId, staffAuthorId: staff.sub, visibility, body: dto.body },
      include: COMMENT_INCLUDE,
    });
    // A PUBLIC reply is a real response to the requester — stamp
    // firstRespondedAt here too, not just on the first status move (see
    // transition()'s comment on why that was the only signal before
    // comments existed). An INTERNAL note isn't a response, so it doesn't count.
    if (visibility === CommentVisibility.PUBLIC && !ticket.firstRespondedAt) {
      await this.prisma.ticket.update({ where: { id: ticketId }, data: { firstRespondedAt: new Date() } });
    }
    return comment;
  }

  // Employee self-service equivalents — reuse getMineOrThrow's ownership
  // check (am I the requester) rather than assertStaffCanAccessTicket
  // (department membership), same split as listMine/getMineOrThrow above.
  // INTERNAL comments are never returned here, and a posted comment is
  // always PUBLIC — never taken from the client.

  async listMyComments(staff: StaffJwtPayload, ticketId: string) {
    await this.getMineOrThrow(staff, ticketId);
    return this.prisma.comment.findMany({
      where: { ticketId, visibility: CommentVisibility.PUBLIC },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMyComment(staff: StaffJwtPayload, ticketId: string, dto: CreateCommentDto) {
    await this.getMineOrThrow(staff, ticketId);
    return this.prisma.comment.create({
      data: { ticketId, staffAuthorId: staff.sub, visibility: CommentVisibility.PUBLIC, body: dto.body },
      include: COMMENT_INCLUDE,
    });
  }

  // ── Assignment ────────────────────────────────────────────────────────
  // A "reassignment" (bouncing a ticket from one agent to another, not the
  // first assignment out of Unassigned) is one of the three escalation
  // triggers — see EscalationReason.REASSIGNMENT_THRESHOLD. The threshold
  // itself comes from the ticket's own frozen escalationSnapshot, same
  // "decided in exactly one place" pattern as SLA due dates.

  async assign(staff: StaffJwtPayload, id: string, assignedAgentId: string | null | undefined) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { ticketTypeVersion: { select: { escalationSnapshot: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);

    if (assignedAgentId) {
      await this.assertAgentInDepartment(assignedAgentId, ticket.departmentId);
    }

    const isReassignment = !!ticket.assignedAgentId && !!assignedAgentId && assignedAgentId !== ticket.assignedAgentId;
    // Unchecked form (raw FK scalar) to match the original assignedAgentId
    // update — the checked TicketUpdateInput only accepts the relation form.
    const data: Prisma.TicketUncheckedUpdateInput = {
      assignedAgentId: assignedAgentId ?? null,
      rowVersion: { increment: 1 },
    };

    let willAutoEscalate = false;
    if (isReassignment) {
      const nextCount = ticket.reassignmentCount + 1;
      data.reassignmentCount = nextCount;
      const rule = resolveEscalationRule(
        ticket.ticketTypeVersion.escalationSnapshot as unknown as EscalationRuleEntry[] | null,
        ticket.customerType,
        ticket.priority,
      );
      if (!ticket.isEscalated && rule.reassignmentThreshold !== null && nextCount >= rule.reassignmentThreshold) {
        willAutoEscalate = true;
        data.isEscalated = true;
        data.escalatedAt = new Date();
        data.escalationReason = EscalationReason.REASSIGNMENT_THRESHOLD;
      }
    }

    // Optimistic lock, same as transition() below — without checking
    // rowVersion here, two agents reassigning the same ticket at nearly the
    // same moment can race: the second write silently overwrites the first
    // (including its reassignmentCount bump), instead of the second caller
    // getting a clean "reload and try again".
    let updated;
    try {
      updated = await this.prisma.ticket.update({ where: { id, rowVersion: ticket.rowVersion }, data, include: TICKET_INCLUDE });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new ConflictException('This ticket was modified by someone else — reload and try again');
      }
      throw err;
    }

    if (willAutoEscalate) {
      await this.prisma.auditLog.create({
        data: {
          orgId: staff.orgId,
          actorType: 'SYSTEM',
          action: 'TICKET_ESCALATED',
          entityType: 'Ticket',
          entityId: id,
          afterJson: { reason: EscalationReason.REASSIGNMENT_THRESHOLD, reassignmentCount: updated.reassignmentCount },
        },
      });
      await this.notifyEscalation(staff.orgId, updated, EscalationReason.REASSIGNMENT_THRESHOLD);
    }

    return updated;
  }

  // ── Escalation ────────────────────────────────────────────────────────
  // The other two triggers: an agent manually flagging a ticket they're
  // stuck on, and (backend/src/sla's cron job) an SLA deadline passing.
  // isEscalated stays true forever once set — it's ticket HISTORY, not a
  // live alert flag. escalationAcknowledgedAt is what "is this still an
  // active alert" queries (dashboards, notification fan-out) filter on.

  async escalate(staff: StaffJwtPayload, id: string, note?: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    if (ticket.isEscalated) return ticket; // idempotent — already flagged, nothing to do

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isEscalated: true, escalatedAt: new Date(), escalationReason: EscalationReason.MANUAL },
      include: TICKET_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'TICKET_ESCALATED',
        entityType: 'Ticket',
        entityId: id,
        afterJson: { reason: EscalationReason.MANUAL, note: note ?? null },
      },
    });
    await this.notifyEscalation(staff.orgId, updated, EscalationReason.MANUAL);

    return updated;
  }

  async acknowledgeEscalation(staff: StaffJwtPayload, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    if (!ticket.isEscalated) {
      throw new BadRequestException('This ticket has not been escalated');
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { escalationAcknowledgedAt: new Date(), escalationAcknowledgedByUserId: staff.sub },
      include: TICKET_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'TICKET_ESCALATION_ACKNOWLEDGED',
        entityType: 'Ticket',
        entityId: id,
      },
    });
    // Handling the ticket IS handling the alert — don't make the manager
    // separately hunt down and click the bell notification too.
    await this.notifications.markReadForTicket(id);

    return updated;
  }

  // ── FYI to the manager ────────────────────────────────────────────────
  // Deliberately NOT an escalation: no Ticket field changes, nothing turns
  // red, it never appears in the dashboard's "Active escalations" queue —
  // this is just "keep you posted," for when an agent wants the manager
  // aware of something without sounding an alarm. Can be sent any number of
  // times (no idempotency guard, unlike escalate()).
  async notifyManager(staff: StaffJwtPayload, id: string, note?: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);

    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'TICKET_MANAGER_NOTIFIED',
        entityType: 'Ticket',
        entityId: id,
        afterJson: { note: note ?? null },
      },
    });

    const displayId = `${ticket.department.key}-${ticket.ticketNumber}`;
    await this.notifications.notifyDepartmentManagers(
      staff.orgId,
      ticket.departmentId,
      'TICKET_MANAGER_FYI',
      { ticketId: ticket.id, displayId, subject: ticket.subject, note: note ?? null },
      {
        subject: `[${displayId}] FYI from the team`,
        body: `${ticket.subject}${note ? ` — ${note}` : ''}\n\nNo action required — this is just an update, not an escalation.`,
      },
    );

    return { ok: true as const };
  }

  private async notifyEscalation(
    orgId: string,
    ticket: { id: string; departmentId: string; ticketNumber: number; subject: string; department: { key: string } },
    reason: EscalationReason,
  ) {
    const displayId = `${ticket.department.key}-${ticket.ticketNumber}`;
    const reasonLabel = reason.replace(/_/g, ' ').toLowerCase();
    await this.notifications.notifyDepartmentManagers(
      orgId,
      ticket.departmentId,
      'TICKET_ESCALATED',
      { ticketId: ticket.id, displayId, subject: ticket.subject, reason },
      {
        subject: `[${displayId}] Escalated — ${reasonLabel}`,
        body: `Ticket ${displayId} ("${ticket.subject}") has been escalated (${reasonLabel}). Please review it in the Ticket Platform.`,
      },
    );
  }

  // ── Archive (SUPER_ADMIN/DEPT_ADMIN only — see tickets.controller.ts) ──
  // Reversible "remove an unrequired ticket" — never a real delete, and
  // deliberately orthogonal to statusKey/the status-transition system (see
  // the schema comment on Ticket.isArchived). Idempotent, matching
  // escalate()'s style: archiving an already-archived ticket (or
  // unarchiving one that isn't) is a no-op, not an error.

  async archive(staff: StaffJwtPayload, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    if (ticket.isArchived) return this.prisma.ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date(), archivedByUserId: staff.sub },
      include: TICKET_INCLUDE,
    });
    await this.prisma.auditLog.create({
      data: { orgId: staff.orgId, actorType: 'STAFF', actorUserId: staff.sub, action: 'TICKET_ARCHIVED', entityType: 'Ticket', entityId: id },
    });
    return updated;
  }

  async unarchive(staff: StaffJwtPayload, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    if (!ticket.isArchived) return this.prisma.ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isArchived: false, archivedAt: null, archivedByUserId: null },
      include: TICKET_INCLUDE,
    });
    await this.prisma.auditLog.create({
      data: { orgId: staff.orgId, actorType: 'STAFF', actorUserId: staff.sub, action: 'TICKET_UNARCHIVED', entityType: 'Ticket', entityId: id },
    });
    return updated;
  }

  // ── Status transitions ───────────────────────────────────────────────
  // Every rule here — which moves are even legal, and who's allowed to make
  // them — comes from the ticket's OWN frozen ticketTypeVersion, never the
  // live (possibly since-edited) TicketTypeDefinition tables.

  async transition(staff: StaffJwtPayload, id: string, toStatusKey: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { ticketTypeVersion: { select: { statusSchemaSnapshot: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);

    const schema = ticket.ticketTypeVersion.statusSchemaSnapshot as unknown as StatusSchemaSnapshot;
    const move = schema.transitions.find((t) => t.fromStatusKey === ticket.statusKey && t.toStatusKey === toStatusKey);
    if (!move) {
      throw new BadRequestException(`No transition from "${ticket.statusKey}" to "${toStatusKey}" is defined`);
    }
    if (move.allowedRoles.length > 0 && staff.role !== StaffRole.SUPER_ADMIN && !move.allowedRoles.includes(staff.role)) {
      throw new ForbiddenException(`Your role can't move a ticket from "${ticket.statusKey}" to "${toStatusKey}"`);
    }

    const toStatusDef = schema.statuses.find((s) => s.key === toStatusKey);
    const now = new Date();
    const data: Prisma.TicketUpdateInput = { statusKey: toStatusKey };
    if (!ticket.firstRespondedAt) {
      // Simplification for v1: the first status move a staff member makes
      // away from the initial status counts as "first response" for the SLA
      // clock. There's no separate "reply" action yet (comments aren't
      // built) — see the workflow doc for what's still planned.
      data.firstRespondedAt = now;
    }
    if (toStatusDef?.isTerminal && !ticket.resolvedAt) {
      // Another v1 simplification: this schema has no distinct "resolved but
      // not yet closed" concept beyond the isTerminal flag, so reaching any
      // terminal status stamps both resolvedAt and closedAt together.
      data.resolvedAt = now;
      data.closedAt = now;
    }

    try {
      return await this.prisma.ticket.update({
        where: { id, rowVersion: ticket.rowVersion },
        data: { ...data, rowVersion: { increment: 1 } },
        include: TICKET_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new ConflictException('This ticket was modified by someone else — reload and try again');
      }
      throw err;
    }
  }

  // ── Internal-helpdesk requester mapping ─────────────────────────────
  // Ticket.customerId is a required FK to Customer no matter who the
  // ticket is for — rather than migrate that (and everything keyed off
  // CustomerType: SlaRule, FieldDefinition.appliesTo), an internal request
  // transparently gets a Customer row of its own, upserted by the
  // requester's staff email so re-raising for the same colleague reuses it.
  // Always B2C (companyId null) — there's no "company" concept for an
  // internal requester.
  private async findOrCreateCustomerForStaff(orgId: string, requesterUserId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterUserId } });
    if (!requester || requester.orgId !== orgId) {
      throw new NotFoundException('Requester not found');
    }
    return this.prisma.customer.upsert({
      where: { email: requester.email },
      update: {},
      create: { orgId, name: requester.name, email: requester.email },
    });
  }

  // ── Shared guards ─────────────────────────────────────────────────────

  private assertStaffCanAccessTicket(staff: StaffJwtPayload, ticketDepartmentId: string) {
    if (staff.role === StaffRole.SUPER_ADMIN) return;
    if (staff.departmentId !== ticketDepartmentId) {
      throw new ForbiddenException("You don't have access to this ticket's department");
    }
  }

  private async assertAgentInDepartment(agentId: string, departmentId: string) {
    const agent = await this.prisma.user.findUnique({ where: { id: agentId } });
    if (!agent || agent.departmentId !== departmentId) {
      throw new BadRequestException('That agent is not a member of this department');
    }
  }
}

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
import { StorageService } from '../storage/storage.service';
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

// TICKET_INCLUDE plus the frozen ticketTypeVersion schema — deliberately
// NOT folded into TICKET_INCLUDE itself, since list() also uses that and a
// ticket list of up to 200 rows doesn't need this schema blob duplicated on
// every row. Used by every endpoint whose response TicketDetailPage.tsx
// might drop straight into its `ticket` state (getByIdOrThrow, assign,
// transition) — that page reads `ticket.ticketTypeVersion.statusSchemaSnapshot`
// unconditionally once `ticket` is non-null, so any of those responses
// missing this field crashes the page on the very next render (live-caught
// 2026-08-31: assign()/transition() were TICKET_INCLUDE-only and did
// exactly that).
const TICKET_DETAIL_INCLUDE = {
  ...TICKET_INCLUDE,
  ticketTypeVersion: { select: { statusSchemaSnapshot: true, fieldSchemaSnapshot: true, versionNumber: true } },
};

// staffAuthor is populated for every comment in v1 (agents/employees are all
// Users) — customerAuthor exists on the model for the dormant /portal/*
// surface but nothing writes it yet.
const COMMENT_INCLUDE = {
  staffAuthor: { select: { id: true, name: true, role: true } },
  customerAuthor: { select: { id: true, name: true } },
};

// Metadata only — deliberately never selects anything blob-shaped, since
// the bytes live in AttachmentBlob (see storage.service.ts), not here.
const ATTACHMENT_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploadedByStaffId: true,
} as const;

// Loose shape (structurally matches Express.Multer.File, and the plain
// object create()/tickets.service.spec's tests construct) rather than
// importing Express's own type here — this service has no other Express
// dependency and shouldn't need one just for this.
type UploadedFileLike = { buffer: Buffer; mimetype: string; originalname: string; size: number };

// Images, PDFs, plain text — enough for "attach a screenshot of the error",
// this codebase's actual use case, without accepting arbitrary executables.
// 5MB is generous for a screenshot and small enough to keep comfortably in
// Postgres (see storage.service.ts on why DB-backed, not local disk).
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

// The "parcel tracker" timeline (Deepak's ask, 2026-08-25) — staff/admins
// see every AuditLog entry for full visibility, but the requester only sees
// milestones that are actually about THEIR ticket's journey. Internal ops
// noise (an escalation firing, a manager being pinged, an archive/unarchive
// housekeeping action) is deliberately left out of their view — same
// reasoning as INTERNAL comments never reaching them.
const REQUESTER_VISIBLE_HISTORY_ACTIONS = ['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_AUTO_ASSIGNED', 'TICKET_STATUS_CHANGED'];

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
    private storage: StorageService,
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

    // First entry on the ticket's tracking timeline (2026-08-25's full-
    // tracking addition) — unconditional, every ticket gets one.
    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'TICKET_CREATED',
        entityType: 'Ticket',
        entityId: ticket.id,
        afterJson: { subject: dto.subject, priority: dto.priority, statusKey: initialStatus.key },
      },
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

    if (assignedAgentId) {
      const displayId = `${ticket.department.key}-${ticket.ticketNumber}`;
      await this.notifyAgentAssigned(ticket.id, assignedAgentId, dto.subject, displayId);
    }

    // Not a persisted Ticket field — a one-time explanation for the create
    // response only, so NewTicketPage/RaiseTicketPage can show it once right
    // after creation (see their onSubmit handlers). A later GET of this same
    // ticket won't carry it, same as AI triage's reasoning isn't stored either.
    return { ...ticket, autoAssignReasoning };
  }

  /** Agent-facing counterpart to notifyRequester's assignment email (Deepak's
   * ask, 2026-08-31) — until now only the requester learned a ticket had
   * been picked up; the agent it landed on had to notice by checking the
   * queue. Fires from both create() (explicit pick or AI auto-assign) and
   * assign() (manual reassignment). Best-effort: looks the agent's email up
   * fresh rather than widening the shared TICKET_INCLUDE select just for
   * this, and no-ops quietly if the agent can't be found — a missing
   * notification must never block the ticket action that triggered it. */
  private async notifyAgentAssigned(ticketId: string, agentId: string, subject: string, displayId: string) {
    const agent = await this.prisma.user.findUnique({ where: { id: agentId }, select: { id: true, email: true } });
    if (!agent) return;
    await this.notifications.notify(
      [{ id: agent.id, email: agent.email }],
      'TICKET_ASSIGNED_TO_YOU',
      { ticketId, displayId, subject },
      {
        subject: `[${displayId}] New ticket assigned to you`,
        body: `The ticket "${subject}" has been assigned to you.`,
      },
    );
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

  // Public wrapper around pickBestAgent above — lets ai.service.ts's
  // bulk-assist reuse the exact same candidate-scoring logic create()
  // already uses internally, instead of duplicating it.
  async suggestAgent(departmentId: string, subject: string, description: string) {
    return this.pickBestAgent(departmentId, subject, description);
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
      include: TICKET_DETAIL_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return ticket;
  }

  // Looks a ticket up by its human-facing number (the digits in "TECH-42")
  // rather than its cuid — for ai.service.ts's chat assistant, which only
  // ever sees the display ID a staff member typed, never the real id.
  // ticketNumber is a single global sequence (not per-department, see the
  // schema comment on Ticket.ticketNumber), so the department key prefix
  // isn't needed to disambiguate — it's accepted for readability only, not
  // matched against. Returns null rather than throwing on "not found" OR
  // "found but not yours to see" — same "no signal either way" reasoning as
  // getMineOrThrow, since this is used to build AI context, not to serve a
  // real detail page.
  async findByTicketNumberForChat(staff: StaffJwtPayload, ticketNumber: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { ticketNumber },
      include: TICKET_DETAIL_INCLUDE,
    });
    if (!ticket) return null;
    try {
      if (staff.role === StaffRole.EMPLOYEE) {
        const customerId = await this.myCustomerId(staff);
        if (!customerId || ticket.customerId !== customerId) return null;
      } else {
        this.assertStaffCanAccessTicket(staff, ticket.departmentId);
      }
    } catch {
      return null;
    }
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

  // ── Attachments ───────────────────────────────────────────────────────
  // File bytes live in a separate AttachmentBlob row (see
  // storage.service.ts) — Attachment itself only ever carries metadata, so
  // listing a ticket's attachments never pulls file contents along with it.
  // Always ticket-level (commentId left null) in v1 — the schema supports
  // tying a file to one specific comment, nothing in the UI does that yet.

  async listAttachments(staff: StaffJwtPayload, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return this.prisma.attachment.findMany({
      where: { ticketId },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addAttachment(staff: StaffJwtPayload, ticketId: string, file: UploadedFileLike) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return this.storeAttachment(ticketId, staff.sub, file);
  }

  // Fetches the actual bytes for download — separate from listAttachments
  // (metadata only) so browsing a ticket never has to move file contents
  // over the wire until someone actually clicks to download one.
  async getAttachmentOrThrow(staff: StaffJwtPayload, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { ticket: { select: { departmentId: true } } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    this.assertStaffCanAccessTicket(staff, attachment.ticket.departmentId);
    return this.readAttachmentBytes(attachment);
  }

  // Employee self-service equivalents — same ownership check as
  // listMyComments/addMyComment above.

  async listMyAttachments(staff: StaffJwtPayload, ticketId: string) {
    await this.getMineOrThrow(staff, ticketId);
    return this.prisma.attachment.findMany({
      where: { ticketId },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMyAttachment(staff: StaffJwtPayload, ticketId: string, file: UploadedFileLike) {
    await this.getMineOrThrow(staff, ticketId);
    return this.storeAttachment(ticketId, staff.sub, file);
  }

  async getMyAttachmentOrThrow(staff: StaffJwtPayload, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.getMineOrThrow(staff, attachment.ticketId); // throws NotFoundException if this isn't their ticket
    return this.readAttachmentBytes(attachment);
  }

  private async storeAttachment(ticketId: string, uploadedByStaffId: string, file: UploadedFileLike) {
    this.assertAttachmentAllowed(file);
    const storageKey = await this.storage.save(file.buffer, file.mimetype);
    return this.prisma.attachment.create({
      data: { ticketId, storageKey, fileName: file.originalname, mimeType: file.mimetype, size: file.size, uploadedByStaffId },
      select: ATTACHMENT_SELECT,
    });
  }

  private async readAttachmentBytes(attachment: { fileName: string; mimeType: string; storageKey: string }) {
    const blob = await this.storage.read(attachment.storageKey);
    // Shouldn't happen (nothing deletes an AttachmentBlob out from under a
    // live Attachment row today) but a missing blob should 404, not 500.
    if (!blob) throw new NotFoundException('Attachment file is missing');
    return { fileName: attachment.fileName, mimeType: attachment.mimeType, buffer: blob.buffer };
  }

  private assertAttachmentAllowed(file: { mimetype: string; size: number }) {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type "${file.mimetype}" isn't allowed — images, PDFs, and plain text only`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('File is too large — 5MB max');
    }
  }

  // ── Tracking history ─────────────────────────────────────────────────
  // The "parcel tracker" timeline — every AuditLog row already written by
  // create()/assign()/transition()/escalate()/archive() etc., just read
  // back in order. Nothing new is written here; this is purely a read path
  // over history those methods already produce.

  async getHistory(staff: StaffJwtPayload, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Ticket', entityId: ticketId },
      include: { actorUser: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Employee self-service — same ownership check as comments/attachments
  // above, plus a narrower set of visible steps (see
  // REQUESTER_VISIBLE_HISTORY_ACTIONS) so this reads like a delivery
  // tracker's milestones, not an internal ops log.
  async getMyHistory(staff: StaffJwtPayload, ticketId: string) {
    await this.getMineOrThrow(staff, ticketId);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Ticket', entityId: ticketId, action: { in: REQUESTER_VISIBLE_HISTORY_ACTIONS } },
      include: { actorUser: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
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
      updated = await this.prisma.ticket.update({ where: { id, rowVersion: ticket.rowVersion }, data, include: TICKET_DETAIL_INCLUDE });
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

    // Full tracking (Deepak's ask, 2026-08-25): every assignment change gets
    // logged for the timeline AND emails the requester who's now on it —
    // same "delivery tracker" spirit as the resolution email, just for the
    // "assigned to an agent" step. Only when a real agent actually changed
    // (not on plain unassign, and not a no-op re-save of the same agent).
    if (ticket.assignedAgentId !== updated.assignedAgentId) {
      await this.prisma.auditLog.create({
        data: {
          orgId: staff.orgId,
          actorType: 'STAFF',
          actorUserId: staff.sub,
          action: 'TICKET_ASSIGNED',
          entityType: 'Ticket',
          entityId: id,
          beforeJson: { agentId: ticket.assignedAgentId },
          afterJson: { agentId: updated.assignedAgentId, agentName: updated.assignedAgent?.name ?? null },
        },
      });
      if (updated.assignedAgentId && updated.assignedAgent) {
        const displayId = `${updated.department.key}-${updated.ticketNumber}`;
        await this.notifications.notifyRequester(
          updated.customer.email,
          'TICKET_ASSIGNED',
          { ticketId: updated.id, displayId, subject: updated.subject, agentName: updated.assignedAgent.name },
          {
            subject: `[${displayId}] Assigned to ${updated.assignedAgent.name}`,
            body: `Your ticket "${updated.subject}" is now being worked on by ${updated.assignedAgent.name}.`,
          },
        );
        await this.notifyAgentAssigned(updated.id, updated.assignedAgentId, updated.subject, displayId);
      }
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
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: TICKET_DETAIL_INCLUDE });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertStaffCanAccessTicket(staff, ticket.departmentId);
    if (ticket.isEscalated) return ticket; // idempotent — already flagged, nothing to do

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isEscalated: true, escalatedAt: new Date(), escalationReason: EscalationReason.MANUAL },
      include: TICKET_DETAIL_INCLUDE,
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
      include: TICKET_DETAIL_INCLUDE,
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
    if (ticket.isArchived) return this.prisma.ticket.findUnique({ where: { id }, include: TICKET_DETAIL_INCLUDE });

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date(), archivedByUserId: staff.sub },
      include: TICKET_DETAIL_INCLUDE,
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
    if (!ticket.isArchived) return this.prisma.ticket.findUnique({ where: { id }, include: TICKET_DETAIL_INCLUDE });

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { isArchived: false, archivedAt: null, archivedByUserId: null },
      include: TICKET_DETAIL_INCLUDE,
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
    // Only the FIRST time a ticket reaches a terminal status — not
    // "!ticket.resolvedAt" alone, that condition also gates whether to
    // email the requester below, so a re-resolve after a reopen doesn't
    // silently re-notify.
    const isFirstResolution = !!toStatusDef?.isTerminal && !ticket.resolvedAt;
    if (isFirstResolution) {
      // Another v1 simplification: this schema has no distinct "resolved but
      // not yet closed" concept beyond the isTerminal flag, so reaching any
      // terminal status stamps both resolvedAt and closedAt together.
      data.resolvedAt = now;
      data.closedAt = now;
    }

    let updated;
    try {
      updated = await this.prisma.ticket.update({
        where: { id, rowVersion: ticket.rowVersion },
        data: { ...data, rowVersion: { increment: 1 } },
        include: TICKET_DETAIL_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new ConflictException('This ticket was modified by someone else — reload and try again');
      }
      throw err;
    }

    const displayId = `${updated.department.key}-${updated.ticketNumber}`;
    const toLabel = toStatusDef?.label ?? toStatusKey;

    // Full tracking (Deepak's ask, 2026-08-25): every status move is a step
    // on the timeline, not just resolution — same "delivery tracker" shape
    // as the assignment step above.
    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'TICKET_STATUS_CHANGED',
        entityType: 'Ticket',
        entityId: id,
        beforeJson: { statusKey: ticket.statusKey },
        afterJson: { statusKey: toStatusKey, label: toLabel },
      },
    });

    // And once email is connected, the requester should actually hear about
    // it, not just see it update in an app they may not be checking.
    // Best-effort — see MailerService: a broken/unset SMTP config just logs
    // and skips, it never fails the transition itself.
    await this.notifications.notifyRequester(
      updated.customer.email,
      isFirstResolution ? 'TICKET_RESOLVED' : 'TICKET_STATUS_CHANGED',
      { ticketId: updated.id, displayId, subject: updated.subject, statusKey: toStatusKey, statusLabel: toLabel },
      isFirstResolution
        ? {
            subject: `[${displayId}] Resolved — ${updated.subject}`,
            body: `Your ticket "${updated.subject}" has been marked "${toLabel}".\n\nIf this doesn't look right, reply on the ticket in the Ticket Platform and it'll get looked at again.`,
          }
        : {
            subject: `[${displayId}] Now "${toLabel}" — ${updated.subject}`,
            body: `Your ticket "${updated.subject}" moved to "${toLabel}".`,
          },
    );

    return updated;
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

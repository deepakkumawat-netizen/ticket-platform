import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommentVisibility, CustomerType, IntakeChannel, IntakeQueryStatus, extractTicketNumber } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { TicketsService } from '../tickets/tickets.service';
import { AiService } from '../ai/ai.service';
import { assertDepartmentAccess, intakeQueryScopeWhere } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { CreateIntakeQueryDto } from './dto/create-intake-query.dto';
import { ConvertIntakeQueryDto } from './dto/convert-intake-query.dto';
import { RejectIntakeQueryDto } from './dto/reject-intake-query.dto';
import { ListIntakeQueriesQueryDto } from './dto/list-intake-queries.query.dto';
import { parseFromHeader, stripQuotedReplyText } from './email-reply-parser';

const INTAKE_QUERY_INCLUDE = {
  suggestedDepartment: { select: { id: true, key: true, name: true } },
};

// Resend's `email.received` webhook payload is metadata-only (no body) —
// verified live against Resend's docs (resend.com/docs/dashboard/receiving)
// on 2026-09-10, since this codebase calls Resend's HTTPS API directly
// rather than via their SDK (see mailer.service.ts). The full body is a
// separate GET to /emails/receiving/:id, whose real shape is what's typed
// below (from/subject/text/html/attachments) — everything else in that
// response this codebase doesn't use.
type ResendReceivedEmail = { from: string; subject: string; text: string | null; html: string };

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private prisma: PrismaService,
    private customers: CustomersService,
    private tickets: TicketsService,
    private ai: AiService,
    private config: ConfigService,
  ) {}

  // ── Public web-form intake ───────────────────────────────────────────
  // Landing zone only — see IntakeQuery's schema comment for why this can't
  // just create a Ticket directly. Best-effort AI/rule department
  // classification runs inline so the triage queue already has a suggestion
  // to show; a failure here never blocks the 201, it just leaves the query
  // unrouted for a human to file manually (same degrade-to-null contract as
  // every other AI feature in this codebase).
  async createFromWebForm(dto: CreateIntakeQueryDto) {
    return this.createStagedQuery({
      channel: IntakeChannel.WEB_FORM,
      contactName: dto.name,
      contactEmail: dto.email,
      contactPhone: dto.phone,
      companyName: dto.companyName,
      subject: dto.subject,
      description: dto.description,
      rawPayload: { source: 'web_form', ...dto },
    });
  }

  // ── Inbound-email intake ─────────────────────────────────────────────
  // Called by IntakeWebhooksController once the Svix signature on the
  // webhook has already been verified (see svix-verify.ts) — this method
  // trusts its input completely, so it must never be reachable any other way.
  //
  // Two outcomes: a reply to an EXISTING ticket (subject carries its display
  // ID, e.g. "Re: [TECH-42] ...", and the sender's address matches that
  // ticket's own customer) becomes a new PUBLIC comment on it directly — no
  // human review needed, this is just "the requester replied," the same as
  // if they'd typed it on the portal. Anything else (a new query, or a
  // reply from an address that doesn't match) lands in the same staging
  // queue the web form uses, for a human to triage.
  async handleInboundEmail(event: { type?: string; data?: { email_id?: string } }) {
    if (event.type !== 'email.received' || !event.data?.email_id) {
      return { ok: true as const, skipped: true as const }; // some other Resend event type, or a malformed payload — ignore, don't error
    }

    const full = await this.fetchReceivedEmail(event.data.email_id);
    if (!full) return { ok: true as const, skipped: true as const };

    const { name: contactName, email: contactEmail } = parseFromHeader(full.from);
    const subject = full.subject || '(no subject)';
    const description = stripQuotedReplyText(full.text ?? full.html ?? '');

    const replied = contactEmail ? await this.tryAddReplyComment(subject, description, contactEmail) : null;
    if (replied) return { ok: true as const, action: 'comment_added' as const, ticketId: replied.ticketId };

    await this.createStagedQuery({
      channel: IntakeChannel.INBOUND_EMAIL,
      contactName,
      contactEmail,
      subject,
      description,
      rawPayload: event as object,
    });
    return { ok: true as const, action: 'intake_query_created' as const };
  }

  // If the subject carries an existing ticket's display ID AND the sender's
  // address matches that exact ticket's own customer, this is a genuine
  // reply — post it as a PUBLIC comment (customerAuthorId set, matching the
  // schema's dormant /portal/* customer-authored-comment support) rather
  // than staging a duplicate query for something already being worked.
  // Deliberately does NOT stamp firstRespondedAt — that tracks STAFF
  // response time, not the requester's own replies.
  private async tryAddReplyComment(subject: string, description: string, contactEmail: string): Promise<{ ticketId: string } | null> {
    const ticketNumber = extractTicketNumber(subject);
    if (ticketNumber === null) return null;

    const ticket = await this.prisma.ticket.findUnique({
      where: { ticketNumber },
      select: { id: true, orgId: true, customerId: true, customer: { select: { email: true } } },
    });
    if (!ticket || ticket.customer.email.toLowerCase() !== contactEmail.toLowerCase()) return null;

    await this.prisma.comment.create({
      data: { ticketId: ticket.id, visibility: CommentVisibility.PUBLIC, body: description, customerAuthorId: ticket.customerId },
    });
    await this.prisma.auditLog.create({
      data: { orgId: ticket.orgId, actorType: 'CUSTOMER', action: 'TICKET_EMAIL_REPLY_ADDED', entityType: 'Ticket', entityId: ticket.id },
    });
    return { ticketId: ticket.id };
  }

  // Best-effort: Resend's webhook payload carries only metadata (email_id,
  // from, subject) — the actual body needs this separate authenticated GET.
  // Never throws: a missing RESEND_API_KEY, a transient Resend outage, or a
  // malformed response all just mean this email is silently dropped rather
  // than 500ing the webhook (Resend would retry a non-2xx response, and a
  // permanently malformed email would retry forever for no benefit).
  private async fetchReceivedEmail(emailId: string): Promise<ResendReceivedEmail | null> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('Inbound email received but RESEND_API_KEY is not set — cannot fetch its content');
      return null;
    }
    try {
      const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`Resend receiving-email request failed (${res.status}): ${await res.text()}`);
      return await res.json();
    } catch (err) {
      this.logger.warn(`Could not fetch inbound email ${emailId} from Resend: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // Shared by createFromWebForm and handleInboundEmail — every channel with
  // no human already choosing a department funnels through here. Best-effort
  // AI/rule classification runs inline; a failure never blocks the write, it
  // just leaves the query unrouted for a human to file manually (same
  // degrade-to-null contract as every other AI feature in this codebase).
  private async createStagedQuery(input: {
    channel: IntakeChannel;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone?: string;
    companyName?: string;
    subject: string;
    description: string;
    rawPayload: object;
  }) {
    // No JWT on either channel that reaches here (the public web form, or a
    // webhook) to read an orgId from, unlike every other write path in this
    // app. This app is single-tenant today (see prisma/seed.ts — exactly
    // one Organization row exists), so the first/only org is always the
    // right one; findFirst rather than hardcoding the seed script's literal
    // id keeps this correct even if that ever changes.
    const org = await this.prisma.organization.findFirst({ select: { id: true } });
    if (!org) throw new BadRequestException('This platform has not been set up yet');

    const classification = await this.ai
      .classifyDepartment(org.id, input.subject, input.description)
      .catch((err) => {
        this.logger.warn(`Department classification failed on intake, leaving unrouted: ${err instanceof Error ? err.message : err}`);
        return null;
      });

    return this.prisma.intakeQuery.create({
      data: {
        orgId: org.id,
        channel: input.channel,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        companyName: input.companyName,
        subject: input.subject,
        description: input.description,
        suggestedDepartmentId: classification?.departmentId,
        classificationReasoning: classification?.reasoning,
        rawPayload: input.rawPayload as object,
      },
      include: INTAKE_QUERY_INCLUDE,
    });
  }

  // ── Staff triage queue ────────────────────────────────────────────────

  list(staff: StaffJwtPayload, query: ListIntakeQueriesQueryDto) {
    return this.prisma.intakeQuery.findMany({
      where: {
        orgId: staff.orgId,
        status: query.status ?? IntakeQueryStatus.PENDING,
        ...intakeQueryScopeWhere(staff),
      },
      include: INTAKE_QUERY_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  private async getVisibleOrThrow(staff: StaffJwtPayload, id: string) {
    const query = await this.prisma.intakeQuery.findFirst({
      where: { id, orgId: staff.orgId, ...intakeQueryScopeWhere(staff) },
      include: INTAKE_QUERY_INCLUDE,
    });
    if (!query) throw new NotFoundException('Intake query not found');
    return query;
  }

  // Converts a pending query into a real Ticket — a thin wrapper around the
  // EXISTING TicketsService.create(), so nothing here duplicates
  // ticket-creation logic (customer dedup, SLA computation, auto-assign,
  // notifications all run exactly as they would for a staff-created
  // ticket). This is also where "human can override the AI classification"
  // actually happens: dto.departmentId/ticketTypeDefinitionId/priority are
  // whatever staff picked on the triage screen, not necessarily what was
  // suggested.
  async convert(staff: StaffJwtPayload, id: string, dto: ConvertIntakeQueryDto) {
    const query = await this.getVisibleOrThrow(staff, id);
    if (query.status !== IntakeQueryStatus.PENDING) {
      throw new BadRequestException(`This query is already ${query.status.toLowerCase()}`);
    }
    if (!query.contactEmail) {
      throw new BadRequestException('This query has no contact email on file — fill it in before converting (edit not yet supported; reject and re-file manually if needed)');
    }
    assertDepartmentAccess(staff, dto.departmentId);

    const customer = await this.customers.findOrCreateByEmail(
      staff.orgId,
      query.contactName ?? query.contactEmail,
      query.contactEmail,
      query.contactPhone ?? undefined,
      query.companyName ?? undefined,
    );

    const ticket = await this.tickets.create(staff, dto.departmentId, {
      ticketTypeDefinitionId: dto.ticketTypeDefinitionId,
      customerId: customer.id,
      priority: dto.priority,
      subject: query.subject,
      description: query.description,
      customFields: dto.customFields,
      assignedAgentId: dto.assignedAgentId,
    });

    await this.prisma.intakeQuery.update({
      where: { id },
      data: {
        status: IntakeQueryStatus.CONVERTED,
        convertedTicketId: ticket.id,
        reviewedByUserId: staff.sub,
        reviewedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'INTAKE_QUERY_CONVERTED',
        entityType: 'IntakeQuery',
        entityId: id,
        afterJson: { ticketId: ticket.id, customerType: customer.companyId ? CustomerType.B2B : CustomerType.B2C },
      },
    });

    return ticket;
  }

  async reject(staff: StaffJwtPayload, id: string, dto: RejectIntakeQueryDto) {
    const query = await this.getVisibleOrThrow(staff, id);
    if (query.status !== IntakeQueryStatus.PENDING) {
      throw new BadRequestException(`This query is already ${query.status.toLowerCase()}`);
    }

    const updated = await this.prisma.intakeQuery.update({
      where: { id },
      data: {
        status: IntakeQueryStatus.REJECTED,
        rejectedReason: dto.reason,
        reviewedByUserId: staff.sub,
        reviewedAt: new Date(),
      },
      include: INTAKE_QUERY_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: staff.orgId,
        actorType: 'STAFF',
        actorUserId: staff.sub,
        action: 'INTAKE_QUERY_REJECTED',
        entityType: 'IntakeQuery',
        entityId: id,
        afterJson: { reason: dto.reason ?? null },
      },
    });

    return updated;
  }
}

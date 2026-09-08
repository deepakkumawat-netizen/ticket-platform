import { BadRequestException, Injectable } from '@nestjs/common';
import { Priority, StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { GeminiService } from './gemini.service';

type TriageResult = { ticketTypeId: string; priority: Priority; reasoning: string };
type LanguageCheckResult = { flagged: boolean; reason: string };
type ChatTurn = { role: 'user' | 'assistant'; text: string };

// Static context so the chat assistant can answer "how do I do X" questions
// about the tool itself, not just ticket data — added 2026-09-08 after live
// testing showed it had nothing to say beyond "I don't have access to the
// ticket database" for anything not already in its recent-10-tickets list.
const TOOL_BLURB = `This tool is an internal IT/helpdesk ticket platform. Staff raise tickets
against a department (e.g. TECH, OPERATIONS); each ticket gets a human-facing ID like "TECH-42"
(department key + a number) — that's what people mean by "ticket ID" or "ticket number". Roles:
EMPLOYEE (self-service — can only raise and view their own tickets, under "My Tickets"), AGENT
(works tickets in their department), DEPT_ADMIN (manages a department, including escalations),
SUPER_ADMIN (org-wide access to everything). Tickets move through a status flow defined per ticket
type (e.g. Open -> In Progress -> Resolved), can be commented on (internal notes vs public replies
visible to the requester), can have files attached, can be escalated to a department manager, and
can be archived (soft-removed from the active queue, reversible). There's also built-in AI triage
(suggests a ticket type + priority while raising a ticket), AI draft-reply, and AI dashboard
insights — all "suggest only", a human always confirms/sends.`;
type BulkAssistItem = {
  ticketId: string;
  displayId: string;
  subject: string;
  priority: string;
  currentAssigneeName: string | null;
  draft: string | null; // null if the draft-reply call itself failed (e.g. Gemini outage) — that one ticket just gets no draft, the rest of the batch is unaffected
  suggestedAgent: { agentId: string; name: string; reasoning: string } | null;
};

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private dashboards: DashboardsService,
    private gemini: GeminiService,
  ) {}

  // ── Triage agent ─────────────────────────────────────────────────────
  // Human-in-the-loop: this only SUGGESTS a ticket type + priority for the
  // person filling out the form to confirm or override before submitting —
  // it never creates or modifies a ticket itself.
  async triage(departmentId: string, subject: string, description: string): Promise<TriageResult> {
    const ticketTypes = await this.prisma.ticketTypeDefinition.findMany({
      where: { departmentId, isActive: true },
      select: { id: true, name: true, description: true },
    });
    if (ticketTypes.length === 0) {
      throw new BadRequestException('This department has no active ticket types to triage against');
    }

    const prompt = `You are triaging a support ticket for an internal helpdesk. Given the subject and
description below, pick the single best-matching ticket type from the provided list, and suggest a
priority. Be decisive — always pick exactly one ticket type ID from the list, even if the match is
imperfect.

Ticket types available:
${ticketTypes.map((t) => `- id: "${t.id}", name: "${t.name}"${t.description ? `, description: "${t.description}"` : ''}`).join('\n')}

Subject: ${subject}
Description: ${description}`;

    const result = await this.gemini.generateJson<TriageResult>(prompt, {
      type: 'OBJECT',
      properties: {
        ticketTypeId: { type: 'STRING', enum: ticketTypes.map((t) => t.id) },
        priority: { type: 'STRING', enum: Object.values(Priority) },
        reasoning: { type: 'STRING' },
      },
      required: ['ticketTypeId', 'priority', 'reasoning'],
    });

    if (!ticketTypes.some((t) => t.id === result.ticketTypeId)) {
      throw new BadRequestException("Gemini's suggestion didn't match a real ticket type — try again");
    }
    return result;
  }

  // ── Language check ────────────────────────────────────────────────────
  // Warn-not-block by design (Deepak's explicit call): flags inappropriate
  // language so the requester gets a chance to rephrase, but never prevents
  // submission — a false positive blocking someone's genuinely urgent ticket
  // would be worse than letting an occasional bad-language one through.
  // Never throws: if Gemini is unavailable, the caller should treat that as
  // "not flagged" rather than blocking ticket creation on an AI outage.
  async checkLanguage(subject: string, description: string): Promise<LanguageCheckResult> {
    try {
      const prompt = `You are reviewing a workplace internal-helpdesk ticket submission for inappropriate
language — profanity, insults, harassment, or threats directed at a person. Be lenient: normal
frustration, urgency, or blunt phrasing about a broken system is NOT inappropriate and must not be
flagged. Only flag actual profanity, insults, or abusive language.

Subject: ${subject}
Description: ${description}`;

      return await this.gemini.generateJson<LanguageCheckResult>(prompt, {
        type: 'OBJECT',
        properties: {
          flagged: { type: 'BOOLEAN' },
          reason: { type: 'STRING' },
        },
        required: ['flagged', 'reason'],
      });
    } catch {
      return { flagged: false, reason: '' };
    }
  }

  // ── Response-drafting agent ─────────────────────────────────────────
  // Also human-in-the-loop: returns text for an agent to read, edit, and
  // send themselves (post it as a PUBLIC comment — see comments, added
  // 2026-08-25 — or ignore it and write their own reply from scratch).
  async draftReply(staff: StaffJwtPayload, ticketId: string): Promise<{ draft: string }> {
    const ticket = await this.tickets.getByIdOrThrow(staff, ticketId);
    return { draft: await this.buildDraftReply(ticket) };
  }

  // Shared by draftReply above and bulkAssist below — same prompt whether
  // it's requested for one ticket or generated for a whole batch at once.
  private async buildDraftReply(ticket: {
    subject: string;
    priority: string;
    statusKey: string;
    description: string;
    customFields: unknown;
    ticketTypeVersion: { statusSchemaSnapshot: unknown };
  }): Promise<string> {
    // statusSchemaSnapshot/customFields are Prisma Json columns — typed as
    // JsonValue, not their real shape; same cast pattern as tickets.service.ts.
    const statusSchema = ticket.ticketTypeVersion.statusSchemaSnapshot as unknown as {
      statuses: { key: string; label: string }[];
    };
    const statusLabel = statusSchema.statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;
    const customFields = ticket.customFields as Record<string, unknown>;

    const prompt = `You are a support agent replying to a colleague's internal helpdesk ticket. Write a
short, professional, friendly first reply (3-6 sentences). Acknowledge the issue, note the current
status, and ask for any missing information you'd genuinely need — don't invent details not given below.

Ticket: ${ticket.subject}
Priority: ${ticket.priority}
Current status: ${statusLabel}
Description: ${ticket.description}
${Object.keys(customFields).length ? `Additional details: ${JSON.stringify(customFields)}` : ''}`;

    return this.gemini.generateText(prompt);
  }

  // ── Bulk assist (multiple tickets at once, still human-approved) ────
  // Deepak's ask (2026-08-25): handle many open tickets in one pass instead
  // of one at a time. Runs draftReply + the same auto-assign scoring
  // create() uses, for every open/not-yet-responded ticket in a
  // department, IN PARALLEL — but applies nothing itself. The frontend
  // shows each suggestion for a human to edit/approve/skip; approving
  // calls the exact same addComment/assign endpoints a human would call
  // by hand. This is still "suggest, never act" — just suggesting for a
  // whole queue at once instead of one ticket at a time.
  async bulkAssist(departmentId: string): Promise<{ items: BulkAssistItem[]; truncated: boolean }> {
    // +1 over the real cap so we can tell "exactly 20 open tickets" apart
    // from "more than 20" without a second count query.
    const candidates = await this.prisma.ticket.findMany({
      where: { departmentId, isArchived: false, resolvedAt: null, firstRespondedAt: null },
      include: {
        department: { select: { key: true } },
        assignedAgent: { select: { id: true, name: true } },
        ticketTypeVersion: { select: { statusSchemaSnapshot: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 21,
    });
    const truncated = candidates.length > 20;
    if (truncated) candidates.pop();
    if (candidates.length === 0) return { items: [], truncated: false };

    // NOT Promise.all across every ticket — live-tested against a real
    // (free-tier) Gemini key, which caps at 5 requests/minute total across
    // this WHOLE app, not just this endpoint. Firing 2 calls x N tickets at
    // once blew through that instantly and every call past the first ~2
    // tickets came back 429, silently, all at once. One ticket at a time
    // (its own 2 calls still run in parallel), with a pause between —
    // slower, but each ticket actually gets a real answer instead of
    // racing every other ticket for the same 5-per-minute budget. A paid
    // Gemini tier removes this ceiling entirely if that matters more than
    // this endpoint's own latency.
    const results: BulkAssistItem[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const ticket = candidates[i];
      if (i > 0) await this.sleep(this.bulkAssistPaceMs);
      const [draft, suggestedAgent] = await Promise.all([
        this.buildDraftReply(ticket).catch(() => null),
        ticket.assignedAgentId ? Promise.resolve(null) : this.tickets.suggestAgent(departmentId, ticket.subject, ticket.description).catch(() => null),
      ]);
      let suggestedAgentName: string | null = null;
      if (suggestedAgent) {
        const agent = await this.prisma.user.findUnique({ where: { id: suggestedAgent.agentId }, select: { name: true } });
        suggestedAgentName = agent?.name ?? null;
      }
      results.push({
        ticketId: ticket.id,
        displayId: `${ticket.department.key}-${ticket.ticketNumber}`,
        subject: ticket.subject,
        priority: ticket.priority,
        currentAssigneeName: ticket.assignedAgent?.name ?? null,
        draft,
        suggestedAgent:
          suggestedAgent && suggestedAgentName
            ? { agentId: suggestedAgent.agentId, name: suggestedAgentName, reasoning: suggestedAgent.reasoning }
            : null,
      });
    }
    // No silent cap: the caller (BulkAssistPage) surfaces `truncated` to the
    // user rather than quietly covering only the first 20 and looking like
    // it handled everything.
    return { items: results, truncated };
  }

  // Each ticket fires up to 2 calls (draft + suggest-agent) in parallel, so
  // pacing needs (2 calls / 5-per-minute) x 60s = 24s minimum to stay under
  // a free-tier Gemini key's quota (shared across the whole app, not just
  // this endpoint) — 25s for a small safety margin. A private field (not a
  // literal inline) so tests can override it to 0.
  private bulkAssistPaceMs = 25_000;
  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Dashboard-insights agent ─────────────────────────────────────────
  async insights(departmentId: string): Promise<{ summary: string }> {
    const data = await this.dashboards.getDashboard(departmentId);
    if (data.totals.total === 0) {
      return { summary: 'No tickets yet in this department — nothing to report on.' };
    }

    const prompt = `You manage a support department. Given this dashboard data (JSON), write a short
plain-English briefing (3-5 sentences) for a manager: what needs attention first, and why. Be
specific with numbers from the data. Don't restate every field — pick out what actually matters
(SLA breaches, an overloaded agent, a ticket that's aged unusually long).

${JSON.stringify(data)}`;

    return { summary: await this.gemini.generateText(prompt) };
  }

  // ── Chat assistant ────────────────────────────────────────────────────
  // The 4th originally-scoped AI feature. Deliberately read-only and
  // stateless server-side, same "human-in-the-loop" spirit as the other
  // three: it can discuss the caller's own visible tickets (their own, for
  // an EMPLOYEE; their department's, for everyone else) but never creates,
  // edits, or closes anything — same reasoning as draftReply above.
  // Multi-turn is done by re-sending the whole transcript as plain text in
  // one prompt each time rather than Gemini's own multi-turn `contents`
  // array — simpler, and plenty for a short back-and-forth at this scale.
  async chat(staff: StaffJwtPayload, message: string, history: ChatTurn[] = []): Promise<{ reply: string }> {
    const context = await this.buildChatContext(staff, message);
    const transcript = history.map((t) => `${t.role === 'user' ? 'Staff member' : 'Assistant'}: ${t.text}`).join('\n');

    const prompt = `You are a helpful assistant embedded in an internal IT/support helpdesk tool. Answer
the staff member's question conversationally and concisely (2-4 sentences unless real detail is
needed).

${TOOL_BLURB}

Below is what you currently know about tickets relevant to this staff member — use it to answer
questions about a specific ticket or their recent tickets, but say you're not sure rather than
inventing anything not shown there. For anything about how the tool itself works, answer from the
description above. You cannot create, edit, assign, or close a ticket yourself — if asked to do
that, tell them to use the ticket screen instead of doing it here.

${context}
${transcript ? `Conversation so far:\n${transcript}\n` : ''}
Staff member: ${message}
Assistant:`;

    const reply = await this.gemini.generateText(prompt);
    return { reply: reply.trim() };
  }

  // If the staff member mentioned a ticket by its display ID (e.g. "TECH-42",
  // "ticket 42", "#42"), pull that ticket up in full regardless of whether
  // it's one of their 10 most recent — that's the "ask about his ticket by
  // ticket ID" case, which the old recent-10-only context couldn't answer
  // once a ticket aged out of the list.
  private extractTicketNumber(message: string): number | null {
    const dashMatch = message.match(/\b[A-Za-z]{2,15}-(\d{1,9})\b/);
    if (dashMatch) return Number(dashMatch[1]);
    const wordMatch = message.match(/\bticket\s*#?\s*(\d{1,9})\b/i) ?? message.match(/#(\d{1,9})\b/);
    return wordMatch ? Number(wordMatch[1]) : null;
  }

  private describeTicketForChat(ticket: NonNullable<Awaited<ReturnType<TicketsService['findByTicketNumberForChat']>>>): string {
    const statusSchema = ticket.ticketTypeVersion.statusSchemaSnapshot as unknown as { statuses: { key: string; label: string }[] };
    const statusLabel = statusSchema.statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;
    return `- ID: ${ticket.department.key}-${ticket.ticketNumber}
- Subject: ${ticket.subject}
- Description: ${ticket.description}
- Status: ${statusLabel}
- Priority: ${ticket.priority}
- Assigned to: ${ticket.assignedAgent?.name ?? 'nobody yet'}
- Raised by: ${ticket.customer.name}
- Escalated: ${ticket.isEscalated ? 'yes' : 'no'}
- Resolved: ${ticket.resolvedAt ? 'yes' : 'no'}`;
  }

  private async buildChatContext(staff: StaffJwtPayload, message: string): Promise<string> {
    const parts: string[] = [];

    const ticketNumber = this.extractTicketNumber(message);
    if (ticketNumber !== null) {
      const ticket = await this.tickets.findByTicketNumberForChat(staff, ticketNumber);
      parts.push(
        ticket
          ? `The staff member asked about a specific ticket. Here is everything known about it:\n${this.describeTicketForChat(ticket)}`
          : `The staff member mentioned ticket number ${ticketNumber}, but no such ticket exists that they have access to — say so rather than guessing at its details.`,
      );
    }

    if (staff.role === StaffRole.EMPLOYEE) {
      const mine = await this.tickets.listMine(staff);
      parts.push(
        mine.length === 0
          ? "This person hasn't raised any tickets yet."
          : `Their recent tickets:\n${mine
              .slice(0, 10)
              .map((t) => `- ${t.department.key}-${t.ticketNumber}: "${t.subject}" — status ${t.statusKey}, priority ${t.priority}`)
              .join('\n')}`,
      );
    } else if (staff.departmentId) {
      const deptTickets = await this.tickets.list(staff.departmentId, {});
      parts.push(
        deptTickets.length === 0
          ? "This department has no tickets yet."
          : `Recent tickets in their department:\n${deptTickets
              .slice(0, 10)
              .map((t) => `- ${t.department.key}-${t.ticketNumber}: "${t.subject}" — status ${t.statusKey}, assigned to ${t.assignedAgent?.name ?? 'nobody'}`)
              .join('\n')}`,
      );
    } else {
      // SUPER_ADMIN has no single departmentId (org-wide, not
      // department-scoped) — show a recent cross-department slice instead of
      // nothing, so this role isn't stuck with "answer generally" as the
      // only option (that's what produced the "I don't have access to the
      // ticket database" reply live-caught 2026-09-08).
      const recent = await this.prisma.ticket.findMany({
        where: { orgId: staff.orgId, isArchived: false },
        include: { department: { select: { key: true } }, assignedAgent: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      parts.push(
        recent.length === 0
          ? 'No tickets exist in this organization yet.'
          : `Recent tickets across all departments:\n${recent
              .map((t) => `- ${t.department.key}-${t.ticketNumber}: "${t.subject}" — status ${t.statusKey}, assigned to ${t.assignedAgent?.name ?? 'nobody'}`)
              .join('\n')}`,
      );
    }

    return parts.join('\n\n');
  }
}

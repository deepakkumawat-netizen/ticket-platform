import { BadRequestException, Injectable } from '@nestjs/common';
import { Priority } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { GeminiService } from './gemini.service';

type TriageResult = { ticketTypeId: string; priority: Priority; reasoning: string };

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

  // ── Response-drafting agent ─────────────────────────────────────────
  // Also human-in-the-loop: returns text for an agent to read, edit, and
  // send themselves (there's no comment/reply feature built yet — see the
  // workflow doc — so this has nowhere to auto-send to regardless).
  async draftReply(staff: StaffJwtPayload, ticketId: string): Promise<{ draft: string }> {
    const ticket = await this.tickets.getByIdOrThrow(staff, ticketId);
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

    return { draft: await this.gemini.generateText(prompt) };
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
}

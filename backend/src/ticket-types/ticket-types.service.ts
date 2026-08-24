import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateFieldDefinition,
  CustomerType,
  fieldsForCustomerType,
  TicketTypeVersionStatus,
  UpdateFieldDefinition,
} from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketTypeDefinitionDto, UpdateTicketTypeDefinitionDto } from './dto/ticket-type-definition.dto';
import { CreateStatusDefinitionDto, CreateStatusTransitionDto } from './dto/status.dto';
import { CreateSlaRuleDto } from './dto/sla-rule.dto';
import { CreateEscalationRuleDto } from './dto/escalation-rule.dto';

const DEFINITION_INCLUDE = {
  fields: { orderBy: { order: 'asc' as const } },
  statuses: { orderBy: { order: 'asc' as const } },
  transitions: true,
  slaRules: true,
  escalationRules: true,
  versions: { orderBy: { versionNumber: 'desc' as const }, take: 5 },
};

@Injectable()
export class TicketTypesService {
  constructor(private prisma: PrismaService) {}

  // ── Ticket type definitions (draft/authoring container) ─────────────────

  createDefinition(departmentId: string, dto: CreateTicketTypeDefinitionDto) {
    return this.prisma.ticketTypeDefinition.create({
      data: { departmentId, ...dto },
    });
  }

  listDefinitions(departmentId: string) {
    return this.prisma.ticketTypeDefinition.findMany({ where: { departmentId } });
  }

  async getDefinitionOrThrow(id: string) {
    const def = await this.prisma.ticketTypeDefinition.findUnique({
      where: { id },
      include: DEFINITION_INCLUDE,
    });
    if (!def) throw new NotFoundException('Ticket type not found');
    return def;
  }

  /** Lightweight lookup so a controller can run assertDepartmentAccess
   * BEFORE touching the definition, without pulling the full include set
   * that getDefinitionOrThrow does. */
  async getDepartmentIdForDefinition(ticketTypeDefinitionId: string): Promise<string> {
    const def = await this.prisma.ticketTypeDefinition.findUnique({
      where: { id: ticketTypeDefinitionId },
      select: { departmentId: true },
    });
    if (!def) throw new NotFoundException('Ticket type not found');
    return def.departmentId;
  }

  /** Same as above, but for routes scoped by :fieldId instead of :id
   * (updateField) — walks up to the owning definition's department. */
  async getDepartmentIdForField(fieldId: string): Promise<string> {
    const field = await this.prisma.fieldDefinition.findUnique({
      where: { id: fieldId },
      select: { ticketTypeDefinition: { select: { departmentId: true } } },
    });
    if (!field) throw new NotFoundException('Field not found');
    return field.ticketTypeDefinition.departmentId;
  }

  updateDefinition(id: string, dto: UpdateTicketTypeDefinitionDto) {
    return this.prisma.ticketTypeDefinition.update({ where: { id }, data: dto });
  }

  // ── Field authoring ───────────────────────────────────────────────────
  // Create sets key+fieldType once; update deliberately cannot touch either
  // (see UpdateFieldDefinitionSchema in packages/shared) — that's the whole
  // enforcement for "never rename/retype a published field key".

  addField(ticketTypeDefinitionId: string, data: CreateFieldDefinition) {
    return this.prisma.fieldDefinition.create({
      data: { ticketTypeDefinitionId, ...data },
    });
  }

  async updateField(fieldId: string, data: UpdateFieldDefinition) {
    const existing = await this.prisma.fieldDefinition.findUnique({ where: { id: fieldId } });
    if (!existing) throw new NotFoundException('Field not found');
    return this.prisma.fieldDefinition.update({ where: { id: fieldId }, data });
  }

  // ── Status / transition / SLA authoring ──────────────────────────────
  // v1 scope: append-only (no PATCH/DELETE) — a status/SLA rule that's wrong
  // gets superseded by adding a corrected one and re-publishing; existing
  // tickets are unaffected either way because they hold a frozen snapshot.

  addStatus(ticketTypeDefinitionId: string, dto: CreateStatusDefinitionDto) {
    return this.prisma.statusDefinition.create({ data: { ticketTypeDefinitionId, ...dto } });
  }

  addTransition(ticketTypeDefinitionId: string, dto: CreateStatusTransitionDto) {
    return this.prisma.statusTransition.create({
      data: { ticketTypeDefinitionId, ...dto, allowedRoles: dto.allowedRoles ?? [] },
    });
  }

  addSlaRule(ticketTypeDefinitionId: string, dto: CreateSlaRuleDto) {
    return this.prisma.slaRule.create({ data: { ticketTypeDefinitionId, ...dto } });
  }

  // Escalation rules are OPTIONAL, unlike SLA rules — publish() below never
  // requires one. A priority with no rule at all just uses the defaults
  // documented on the EscalationRule Prisma model (escalate on breach, 2
  // reassignments) — see tickets.service.ts/sla-breach-check.service.ts.
  addEscalationRule(ticketTypeDefinitionId: string, dto: CreateEscalationRuleDto) {
    return this.prisma.escalationRule.create({ data: { ticketTypeDefinitionId, ...dto } });
  }

  // Turning a department "live" is meaningless if it has nothing to raise a
  // ticket against — this is the same starter content seed.ts provisions for
  // TECH (see seedReadyToUseTechSetup), reused so activating ANY department
  // from the admin UI (departments.service.ts's update()) makes it
  // immediately usable in one click instead of a half-working toggle that
  // needs someone to hand-author a ticket type via the API first.
  async provisionDefaultTicketType(departmentId: string, publishedByUserId: string) {
    const def = await this.prisma.ticketTypeDefinition.create({
      data: { departmentId, key: 'general-support', name: 'General Support', description: 'Default catch-all ticket type.' },
    });

    await Promise.all([
      this.addField(def.id, { key: 'affectedSystem', label: 'Affected system', fieldType: 'TEXT', appliesTo: 'BOTH', required: false, order: 0, options: [] } as any),
      this.addField(def.id, { key: 'stepsToReproduce', label: 'Steps to reproduce', fieldType: 'TEXTAREA', appliesTo: 'BOTH', required: false, order: 1, options: [] } as any),
    ]);
    await Promise.all([
      this.addStatus(def.id, { key: 'OPEN', label: 'Open', isInitial: true, isTerminal: false, order: 0 } as any),
      this.addStatus(def.id, { key: 'IN_PROGRESS', label: 'In Progress', isInitial: false, isTerminal: false, order: 1 } as any),
      this.addStatus(def.id, { key: 'RESOLVED', label: 'Resolved', isInitial: false, isTerminal: true, order: 2 } as any),
    ]);
    await Promise.all([
      this.addTransition(def.id, { fromStatusKey: 'OPEN', toStatusKey: 'IN_PROGRESS', allowedRoles: [] }),
      this.addTransition(def.id, { fromStatusKey: 'IN_PROGRESS', toStatusKey: 'RESOLVED', allowedRoles: [] }),
      this.addTransition(def.id, { fromStatusKey: 'OPEN', toStatusKey: 'RESOLVED', allowedRoles: [] }),
    ]);
    // Placeholder minutes, identical to TECH's — adjust once there's a real
    // admin UI for tuning these (or edit the SlaRule rows directly).
    const slaMinutesByPriority: Record<string, { response: number; resolution: number }> = {
      URGENT: { response: 30, resolution: 240 },
      HIGH: { response: 60, resolution: 480 },
      MEDIUM: { response: 240, resolution: 1440 },
      LOW: { response: 480, resolution: 4320 },
    };
    await Promise.all(
      (['B2B', 'B2C'] as const).flatMap((customerType) =>
        Object.entries(slaMinutesByPriority).map(([priority, minutes]) =>
          this.addSlaRule(def.id, {
            customerType,
            priority: priority as any,
            responseTimeMinutes: minutes.response,
            resolutionTimeMinutes: minutes.resolution,
          }),
        ),
      ),
    );

    return this.publish(def.id, publishedByUserId);
  }

  // ── Publish: freezes the current draft tables into an immutable version ──

  async publish(ticketTypeDefinitionId: string, publishedByUserId: string) {
    const def = await this.getDefinitionOrThrow(ticketTypeDefinitionId);

    if (def.statuses.length === 0) {
      throw new BadRequestException('Cannot publish a ticket type with no statuses defined');
    }
    if (!def.statuses.some((s) => s.isInitial)) {
      throw new BadRequestException('Cannot publish: no status is marked as the initial status');
    }
    if (def.slaRules.length === 0) {
      throw new BadRequestException(
        'Cannot publish a ticket type with no SLA rules defined (need at least one customerType x priority rule)',
      );
    }

    const lastVersion = await this.prisma.ticketTypeVersion.findFirst({
      where: { ticketTypeDefinitionId },
      orderBy: { versionNumber: 'desc' },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const fieldSchemaSnapshot = def.fields
      .filter((f) => !f.isDeprecated)
      .map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        appliesTo: f.appliesTo,
        required: f.required,
        options: f.options,
        order: f.order,
        isDeprecated: f.isDeprecated,
      }));

    const statusSchemaSnapshot = {
      statuses: def.statuses.map((s) => ({
        key: s.key,
        label: s.label,
        isInitial: s.isInitial,
        isTerminal: s.isTerminal,
        order: s.order,
      })),
      transitions: def.transitions.map((t) => ({
        fromStatusKey: t.fromStatusKey,
        toStatusKey: t.toStatusKey,
        allowedRoles: t.allowedRoles,
      })),
    };

    const slaSnapshot = def.slaRules.map((r) => ({
      customerType: r.customerType,
      priority: r.priority,
      responseTimeMinutes: r.responseTimeMinutes,
      resolutionTimeMinutes: r.resolutionTimeMinutes,
    }));

    const escalationSnapshot = def.escalationRules.map((r) => ({
      customerType: r.customerType,
      priority: r.priority,
      escalateOnSlaBreach: r.escalateOnSlaBreach,
      reassignmentThreshold: r.reassignmentThreshold,
    }));

    return this.prisma.ticketTypeVersion.create({
      data: {
        ticketTypeDefinitionId,
        versionNumber,
        status: TicketTypeVersionStatus.PUBLISHED,
        fieldSchemaSnapshot,
        statusSchemaSnapshot,
        slaSnapshot,
        escalationSnapshot,
        publishedAt: new Date(),
        publishedByUserId,
      },
    });
  }

  async getLatestPublishedVersion(ticketTypeDefinitionId: string) {
    const version = await this.prisma.ticketTypeVersion.findFirst({
      where: { ticketTypeDefinitionId, status: TicketTypeVersionStatus.PUBLISHED },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version) throw new NotFoundException('This ticket type has no published version yet');
    return version;
  }

  /** The payload the DynamicFormRenderer fetches: one version's fields,
   * already narrowed to the ticket's customerType via the same shared helper
   * the backend uses for validation — one decision, used on both ends. */
  async getVersionForRenderer(ticketTypeDefinitionId: string, versionNumber: number, customerType: CustomerType) {
    const version = await this.prisma.ticketTypeVersion.findUnique({
      where: { ticketTypeDefinitionId_versionNumber: { ticketTypeDefinitionId, versionNumber } },
    });
    if (!version) throw new NotFoundException('Version not found');
    const fields = fieldsForCustomerType(version.fieldSchemaSnapshot as any, customerType);
    return { ...version, fields };
  }
}

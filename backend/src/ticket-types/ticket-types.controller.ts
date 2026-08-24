import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateFieldDefinitionSchema,
  CustomerType,
  StaffRole,
  UpdateFieldDefinitionSchema,
} from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { TicketTypesService } from './ticket-types.service';
import { CreateTicketTypeDefinitionDto, UpdateTicketTypeDefinitionDto } from './dto/ticket-type-definition.dto';
import { CreateStatusDefinitionDto, CreateStatusTransitionDto } from './dto/status.dto';
import { CreateSlaRuleDto } from './dto/sla-rule.dto';
import { CreateEscalationRuleDto } from './dto/escalation-rule.dto';

// Every mutation here is DEPT_ADMIN+ (SUPER_ADMIN always passes RolesGuard —
// see roles.guard.ts) — this whole module IS the low-code admin surface, so
// AGENTs get read access only.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller()
export class TicketTypesController {
  constructor(private ticketTypes: TicketTypesService) {}

  @Post('departments/:departmentId/ticket-types')
  @Roles(StaffRole.DEPT_ADMIN)
  create(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('departmentId') departmentId: string,
    @Body() dto: CreateTicketTypeDefinitionDto,
  ) {
    assertDepartmentAccess(staff, departmentId);
    return this.ticketTypes.createDefinition(departmentId, dto);
  }

  @Get('departments/:departmentId/ticket-types')
  list(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string) {
    // EMPLOYEE isn't pinned to a department (see departments.service.ts) —
    // they need to browse any live department's ticket types to raise a
    // self-service ticket against it. Every other role stays scoped.
    if (staff.role !== StaffRole.EMPLOYEE) assertDepartmentAccess(staff, departmentId);
    return this.ticketTypes.listDefinitions(departmentId);
  }

  // Read access: like `list` above, EMPLOYEE bypasses (they need to browse
  // any live department's ticket types to raise a self-service ticket);
  // every other role must belong to the department that owns this
  // definition — otherwise a DEPT_ADMIN/AGENT in one department could read
  // (or, below, write) another department's field/status/SLA config just by
  // guessing/enumerating a ticket-type id.
  @Get('ticket-types/:id')
  async get(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    const departmentId = await this.ticketTypes.getDepartmentIdForDefinition(id);
    if (staff.role !== StaffRole.EMPLOYEE) assertDepartmentAccess(staff, departmentId);
    return this.ticketTypes.getDefinitionOrThrow(id);
  }

  @Patch('ticket-types/:id')
  @Roles(StaffRole.DEPT_ADMIN)
  async update(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTicketTypeDefinitionDto,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.updateDefinition(id, dto);
  }

  @Post('ticket-types/:id/fields')
  @Roles(StaffRole.DEPT_ADMIN)
  async addField(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateFieldDefinitionSchema)) body: any,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.addField(id, body);
  }

  @Patch('ticket-types/fields/:fieldId')
  @Roles(StaffRole.DEPT_ADMIN)
  async updateField(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(UpdateFieldDefinitionSchema)) body: any,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForField(fieldId));
    return this.ticketTypes.updateField(fieldId, body);
  }

  @Post('ticket-types/:id/statuses')
  @Roles(StaffRole.DEPT_ADMIN)
  async addStatus(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateStatusDefinitionDto,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.addStatus(id, dto);
  }

  @Post('ticket-types/:id/transitions')
  @Roles(StaffRole.DEPT_ADMIN)
  async addTransition(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateStatusTransitionDto,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.addTransition(id, dto);
  }

  @Post('ticket-types/:id/sla-rules')
  @Roles(StaffRole.DEPT_ADMIN)
  async addSlaRule(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateSlaRuleDto,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.addSlaRule(id, dto);
  }

  @Post('ticket-types/:id/escalation-rules')
  @Roles(StaffRole.DEPT_ADMIN)
  async addEscalationRule(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateEscalationRuleDto,
  ) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.addEscalationRule(id, dto);
  }

  @Post('ticket-types/:id/publish')
  @Roles(StaffRole.DEPT_ADMIN)
  async publish(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    assertDepartmentAccess(staff, await this.ticketTypes.getDepartmentIdForDefinition(id));
    return this.ticketTypes.publish(id, staff.sub);
  }

  // Schema payload for the frontend's DynamicFormRenderer, pre-filtered to
  // one customerType via the same shared helper the backend validates with.
  // Same read policy as `get` above — the returned version snapshot also
  // carries the full field/status/SLA schema, so it needs the same guard.
  @Get('ticket-types/:id/versions/:versionNumber')
  async getVersion(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @Param('versionNumber') versionNumber: string,
    @Query('customerType') customerType: CustomerType,
  ) {
    const departmentId = await this.ticketTypes.getDepartmentIdForDefinition(id);
    if (staff.role !== StaffRole.EMPLOYEE) assertDepartmentAccess(staff, departmentId);
    return this.ticketTypes.getVersionForRenderer(id, Number(versionNumber), customerType);
  }
}

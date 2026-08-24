import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMyTicketDto } from './dto/create-my-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets.query.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';

// No @Roles restrictions anywhere here — unlike ticket-types (the admin
// authoring surface), working tickets is the normal job of every staff role
// in-department; RolesGuard already confines everyone to their own
// department via assertDepartmentAccess / the ticket's own departmentId.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller()
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Post('departments/:departmentId/tickets')
  create(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('departmentId') departmentId: string,
    @Body() dto: CreateTicketDto,
  ) {
    assertDepartmentAccess(staff, departmentId);
    return this.tickets.create(staff, departmentId, dto);
  }

  @Get('departments/:departmentId/tickets')
  list(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('departmentId') departmentId: string,
    @Query() query: ListTicketsQueryDto,
  ) {
    assertDepartmentAccess(staff, departmentId);
    return this.tickets.list(departmentId, query);
  }

  @Get('tickets/:id')
  get(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.getByIdOrThrow(staff, id);
  }

  @Patch('tickets/:id/assign')
  assign(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.tickets.assign(staff, id, dto.assignedAgentId);
  }

  @Patch('tickets/:id/status')
  transition(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: TransitionTicketDto) {
    return this.tickets.transition(staff, id, dto.toStatusKey);
  }

  // Manual escalation trigger — like assign/transition above, this is any
  // in-department staff role's job (an agent flagging their OWN ticket as
  // stuck), not an admin action, so no @Roles restriction.
  @Post('tickets/:id/escalate')
  escalate(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: EscalateTicketDto) {
    return this.tickets.escalate(staff, id, dto.note);
  }

  // Acknowledging IS an admin action — only the department manager (or
  // SUPER_ADMIN, via RolesGuard's auto-pass) can silence an active escalation.
  @Patch('tickets/:id/escalation/acknowledge')
  @Roles(StaffRole.DEPT_ADMIN)
  acknowledgeEscalation(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.acknowledgeEscalation(staff, id);
  }

  // ── Self-service (any staff role, but this is what EMPLOYEE is for) ───
  // Not department-scoped — see tickets.service.ts's createForSelf/listMine/
  // getMineOrThrow, which scope by "am I the requester", not departmentId.

  @Post('my-tickets')
  createMine(@CurrentStaff() staff: StaffJwtPayload, @Body() dto: CreateMyTicketDto) {
    return this.tickets.createForSelf(staff, dto.departmentId, dto);
  }

  @Get('my-tickets')
  listMine(@CurrentStaff() staff: StaffJwtPayload) {
    return this.tickets.listMine(staff);
  }

  @Get('my-tickets/:id')
  getMine(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.getMineOrThrow(staff, id);
  }
}

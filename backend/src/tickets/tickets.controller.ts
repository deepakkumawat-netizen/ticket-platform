import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets.query.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';

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
}

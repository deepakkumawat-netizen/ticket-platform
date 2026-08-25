import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
import { NotifyManagerDto } from './dto/notify-manager.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

// Matches tickets.service.ts's MAX_ATTACHMENT_BYTES — multer rejects an
// oversized upload at the stream level (before it's even fully buffered);
// the service-side check is the defense-in-depth backstop for any future
// caller that doesn't go through this interceptor.
const ATTACHMENT_UPLOAD_OPTIONS = { limits: { fileSize: 5 * 1024 * 1024 } };

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

  // FYI to the manager — calm, non-urgent, no ticket state changes (unlike
  // escalate above). Same "any in-department staff role's job" reasoning.
  @Post('tickets/:id/notify-manager')
  notifyManager(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: NotifyManagerDto) {
    return this.tickets.notifyManager(staff, id, dto.note);
  }

  // Acknowledging IS an admin action — only the department manager (or
  // SUPER_ADMIN, via RolesGuard's auto-pass) can silence an active escalation.
  @Patch('tickets/:id/escalation/acknowledge')
  @Roles(StaffRole.DEPT_ADMIN)
  acknowledgeEscalation(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.acknowledgeEscalation(staff, id);
  }

  // Archive/unarchive: SUPER_ADMIN/DEPT_ADMIN only, per Deepak's ask — a
  // reversible "remove an unrequired ticket" (see tickets.service.ts).
  @Patch('tickets/:id/archive')
  @Roles(StaffRole.DEPT_ADMIN)
  archive(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.archive(staff, id);
  }

  @Patch('tickets/:id/unarchive')
  @Roles(StaffRole.DEPT_ADMIN)
  unarchive(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.unarchive(staff, id);
  }

  // ── Comments ──────────────────────────────────────────────────────────
  // Same "any in-department staff role's job" reasoning as assign/transition
  // above — no @Roles restriction.

  @Get('tickets/:id/comments')
  listComments(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.listComments(staff, id);
  }

  @Post('tickets/:id/comments')
  addComment(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.tickets.addComment(staff, id, dto);
  }

  // ── Attachments ───────────────────────────────────────────────────────
  // Same "any in-department staff role's job" reasoning as comments above.

  @Get('tickets/:id/attachments')
  listAttachments(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.listAttachments(staff, id);
  }

  @Post('tickets/:id/attachments')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  addAttachment(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.tickets.addAttachment(staff, id, file);
  }

  // Shared by both the staff and employee attachment views below — an
  // attachment id doesn't carry which route created it, so this branches on
  // the caller's own role rather than needing two separate download routes.
  @Get('attachments/:id/download')
  async downloadAttachment(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Res() res: Response) {
    const file =
      staff.role === StaffRole.EMPLOYEE
        ? await this.tickets.getMyAttachmentOrThrow(staff, id)
        : await this.tickets.getAttachmentOrThrow(staff, id);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
    res.send(file.buffer);
  }

  // ── Tracking history ──────────────────────────────────────────────────

  @Get('tickets/:id/history')
  getHistory(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.getHistory(staff, id);
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

  @Get('my-tickets/:id/comments')
  listMyComments(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.listMyComments(staff, id);
  }

  @Post('my-tickets/:id/comments')
  addMyComment(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.tickets.addMyComment(staff, id, dto);
  }

  @Get('my-tickets/:id/attachments')
  listMyAttachments(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.listMyAttachments(staff, id);
  }

  @Post('my-tickets/:id/attachments')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  addMyAttachment(
    @CurrentStaff() staff: StaffJwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.tickets.addMyAttachment(staff, id, file);
  }

  @Get('my-tickets/:id/history')
  getMyHistory(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.tickets.getMyHistory(staff, id);
  }
}

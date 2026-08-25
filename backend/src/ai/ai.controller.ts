import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { assertDepartmentAccess } from '../common/scope';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { AiService } from './ai.service';
import { TriageDto } from './dto/triage.dto';
import { CheckLanguageDto } from './dto/check-language.dto';
import { ChatDto } from './dto/chat.dto';

// Every route here only ever SUGGESTS — see ai.service.ts's comments. None
// of these write to a ticket; the caller (NewTicketPage/RaiseTicketPage/
// TicketDetailPage) decides what to do with the suggestion.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller()
export class AiController {
  constructor(private ai: AiService) {}

  @Post('departments/:departmentId/ai/triage')
  triage(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string, @Body() dto: TriageDto) {
    // EMPLOYEE isn't pinned to a department (same reasoning as the
    // ticket-types list route) — they need to triage against any live
    // department they're raising a self-service ticket to.
    if (staff.role !== StaffRole.EMPLOYEE) assertDepartmentAccess(staff, departmentId);
    return this.ai.triage(departmentId, dto.subject, dto.description);
  }

  // Not department-scoped — any authenticated staff member (including
  // EMPLOYEE self-service) can check text before submitting a ticket.
  @Post('ai/check-language')
  checkLanguage(@Body() dto: CheckLanguageDto) {
    return this.ai.checkLanguage(dto.subject, dto.description);
  }

  @Post('tickets/:id/ai/draft-reply')
  draftReply(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.ai.draftReply(staff, id);
  }

  @Get('departments/:departmentId/ai/insights')
  insights(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string) {
    assertDepartmentAccess(staff, departmentId);
    return this.ai.insights(departmentId);
  }

  // Not department-scoped — every staff role gets an assistant scoped to
  // whatever tickets THEY can already see (their own for EMPLOYEE, their
  // department's otherwise), same access model as ai.service.ts's
  // buildChatContext.
  @Post('ai/chat')
  chat(@CurrentStaff() staff: StaffJwtPayload, @Body() dto: ChatDto) {
    return this.ai.chat(staff, dto.message, dto.history);
  }

  // Queue-management work (like insights above), not an EMPLOYEE self-
  // service route — this is deliberately scoped by real department access,
  // not the EMPLOYEE bypass triage/insights use elsewhere in this file.
  @Post('departments/:departmentId/ai/bulk-assist')
  bulkAssist(@CurrentStaff() staff: StaffJwtPayload, @Param('departmentId') departmentId: string) {
    assertDepartmentAccess(staff, departmentId);
    return this.ai.bulkAssist(departmentId);
  }
}

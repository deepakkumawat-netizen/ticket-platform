import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { IntakeService } from './intake.service';
import { ConvertIntakeQueryDto } from './dto/convert-intake-query.dto';
import { RejectIntakeQueryDto } from './dto/reject-intake-query.dto';
import { ListIntakeQueriesQueryDto } from './dto/list-intake-queries.query.dto';

// The staff-facing triage queue for everything IntakePublicController (and,
// later, inbound-email) lands in IntakeQuery for. No @Roles restriction —
// same "any in-department staff role's job" reasoning as tickets.controller.ts
// (working the queue), scoped by intakeQueryScopeWhere rather than an
// explicit role check.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller('intake/queries')
export class IntakeAdminController {
  constructor(private intake: IntakeService) {}

  @Get()
  list(@CurrentStaff() staff: StaffJwtPayload, @Query() query: ListIntakeQueriesQueryDto) {
    return this.intake.list(staff, query);
  }

  @Patch(':id/convert')
  convert(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: ConvertIntakeQueryDto) {
    return this.intake.convert(staff, id, dto);
  }

  @Patch(':id/reject')
  reject(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string, @Body() dto: RejectIntakeQueryDto) {
    return this.intake.reject(staff, id, dto);
  }
}

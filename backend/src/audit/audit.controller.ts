import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@ticket-platform/shared';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { AuditService } from './audit.service';
import { ListAuditLogQueryDto } from './dto/list-audit-log.query.dto';

@UseGuards(StaffAuthGuard, RolesGuard)
@Controller('audit-log')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  @Roles(StaffRole.SUPER_ADMIN)
  list(@CurrentStaff() staff: StaffJwtPayload, @Query() query: ListAuditLogQueryDto) {
    return this.audit.list(staff.orgId, query);
  }
}

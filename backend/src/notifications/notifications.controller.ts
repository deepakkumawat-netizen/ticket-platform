import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { NotificationsService } from './notifications.service';

// No RolesGuard/@Roles here — every staff member reads only their OWN
// notifications (see NotificationsService.listMine/markRead), so there's
// nothing to role-gate.
@UseGuards(StaffAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentStaff() staff: StaffJwtPayload) {
    return this.notifications.listMine(staff.sub);
  }

  @Get('unread-count')
  async unreadCount(@CurrentStaff() staff: StaffJwtPayload) {
    return { count: await this.notifications.unreadCount(staff.sub) };
  }

  @Patch(':id/read')
  markRead(@CurrentStaff() staff: StaffJwtPayload, @Param('id') id: string) {
    return this.notifications.markRead(staff.sub, id);
  }
}

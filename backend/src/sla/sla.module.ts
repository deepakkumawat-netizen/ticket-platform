import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SlaBreachCheckService } from './sla-breach-check.service';

@Module({
  imports: [NotificationsModule],
  providers: [SlaBreachCheckService],
})
export class SlaModule {}

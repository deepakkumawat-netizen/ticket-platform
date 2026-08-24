import { Module } from '@nestjs/common';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TicketTypesModule, // for getLatestPublishedVersion() at creation time
    NotificationsModule, // for escalation fan-out (manual escalate + reassignment-threshold auto-escalate)
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}

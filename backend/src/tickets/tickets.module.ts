import { Module } from '@nestjs/common';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GeminiModule } from '../ai/gemini.module';
import { StorageModule } from '../storage/storage.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TicketTypesModule, // for getLatestPublishedVersion() at creation time
    NotificationsModule, // for escalation fan-out (manual escalate + reassignment-threshold auto-escalate)
    GeminiModule, // for AI auto-assign at creation time — see TicketsService.pickBestAgent
    StorageModule, // for attachment upload/download — see storage.service.ts
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}

import { Module } from '@nestjs/common';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [TicketTypesModule], // for getLatestPublishedVersion() at creation time
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}

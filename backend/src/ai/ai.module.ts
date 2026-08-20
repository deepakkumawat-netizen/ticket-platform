import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';

@Module({
  imports: [TicketsModule, DashboardsModule],
  controllers: [AiController],
  providers: [AiService, GeminiService],
})
export class AiModule {}

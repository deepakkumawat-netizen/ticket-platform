import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { GeminiModule } from './gemini.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TicketsModule, DashboardsModule, GeminiModule],
  controllers: [AiController],
  providers: [AiService],
  // Exported so IntakeModule can call classifyDepartment() directly, rather
  // than duplicating a second Gemini-backed classifier.
  exports: [AiService],
})
export class AiModule {}

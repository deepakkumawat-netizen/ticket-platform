import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AiModule } from '../ai/ai.module';
import { IntakePublicController } from './intake-public.controller';
import { IntakeAdminController } from './intake-admin.controller';
import { IntakeWebhooksController } from './intake-webhooks.controller';
import { IntakeService } from './intake.service';

@Module({
  imports: [
    CustomersModule, // findOrCreateByEmail() at conversion time
    TicketsModule, // the EXISTING create() every converted query goes through
    AiModule, // classifyDepartment() — best-effort suggestion only
  ],
  controllers: [IntakePublicController, IntakeAdminController, IntakeWebhooksController],
  providers: [IntakeService],
})
export class IntakeModule {}

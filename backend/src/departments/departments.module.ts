import { Module } from '@nestjs/common';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({
  imports: [TicketTypesModule], // for provisionDefaultTicketType() when activating an empty department
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
})
export class DepartmentsModule {}

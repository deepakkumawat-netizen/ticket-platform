import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // powers the SLA breach-check job (sla module, next)
    PrismaModule,
    AuthModule,
    DepartmentsModule,
    TicketTypesModule, // the low-code engine: ticket types, fields, statuses, SLA rules, publish/versioning
    // Next up (Phase 0 continuation): UsersModule, CustomersModule,
    // TicketsModule, SlaModule, NotificationsModule, DashboardsModule.
  ],
  controllers: [AppController],
})
export class AppModule {}

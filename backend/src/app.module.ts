import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { TicketsModule } from './tickets/tickets.module';
import { DashboardsModule } from './dashboards/dashboards.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // powers the SLA breach-check job (sla module, next)
    // Serves the built frontend (frontend/dist) from this same process, so a
    // single Render service (or any single deploy target) hosts both — no
    // separate static-site deploy, no cross-origin URL to keep in sync.
    // Excluding /api/(.*) is the ONLY thing that keeps this from swallowing
    // API routes, and it never needs updating as new modules are added
    // (see main.ts's setGlobalPrefix('api')).
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'frontend', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    PrismaModule,
    AuthModule,
    DepartmentsModule,
    TicketTypesModule, // the low-code engine: ticket types, fields, statuses, SLA rules, publish/versioning
    UsersModule, // staff listing, scoped per department — feeds assignee pickers
    CustomersModule, // customer/company search + quick-create for ticket intake
    TicketsModule, // ticket create/list/detail/assign/status-transition
    DashboardsModule, // per-department aggregate view (status/SLA/workload/aging)
    // Next up (Phase 0 continuation): SlaModule (breach-check job),
    // NotificationsModule, Comments/Attachments, the Gemini-powered
    // auto-categorize/prioritize + draft-reply + summarize + chatbot pipeline.
  ],
  controllers: [AppController],
})
export class AppModule {}

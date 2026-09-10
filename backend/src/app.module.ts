import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { TicketsModule } from './tickets/tickets.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { AiModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SlaModule } from './sla/sla.module';
import { IntakeModule } from './intake/intake.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global default: 60 req/min per IP across the whole API. Auth routes
    // additionally set a much tighter per-route @Throttle (see
    // staff-auth.controller.ts) since login/signup are the actual
    // brute-force/credential-stuffing targets.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    ScheduleModule.forRoot(), // powers SlaModule's breach-check cron job, below
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
    AiModule, // Gemini-powered triage/draft-reply/dashboard-insights — needs GEMINI_API_KEY set to actually work
    NotificationsModule, // in-app + email fan-out — currently just the escalation workflow's delivery mechanism
    SlaModule, // cron job: auto-escalates tickets whose SLA deadline has passed
    IntakeModule, // unauthenticated intake (public web lead form today) staged into IntakeQuery, converted to a real Ticket by a human
    AuditModule, // org-wide read-only browser over AuditLog — SUPER_ADMIN only
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

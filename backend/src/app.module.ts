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
    // Next up (Phase 0 continuation): UsersModule, CustomersModule,
    // TicketsModule, SlaModule, NotificationsModule, DashboardsModule.
  ],
  controllers: [AppController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService],
  exports: [DashboardsService], // consumed by AiModule for dashboard-insights
})
export class DashboardsModule {}

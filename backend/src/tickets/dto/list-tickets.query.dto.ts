import { IsIn, IsOptional, IsString } from 'class-validator';
import { Priority } from '@ticket-platform/shared';

export class ListTicketsQueryDto {
  @IsOptional()
  @IsString()
  statusKey?: string;

  @IsOptional()
  @IsIn(Object.values(Priority))
  priority?: Priority;

  @IsOptional()
  @IsString()
  assignedAgentId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  // Omitted/'false' (default): normal queue, archived tickets hidden.
  // 'true': the "Archived" view instead — see tickets.service.ts's list().
  @IsOptional()
  @IsIn(['true', 'false'])
  archived?: string;
}

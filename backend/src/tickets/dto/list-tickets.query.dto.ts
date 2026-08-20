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
}

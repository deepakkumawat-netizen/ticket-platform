import { IsOptional, IsString } from 'class-validator';

export class AssignTicketDto {
  // Omit or null to unassign.
  @IsOptional()
  @IsString()
  assignedAgentId?: string | null;
}

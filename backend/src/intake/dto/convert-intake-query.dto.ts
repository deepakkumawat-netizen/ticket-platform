import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Priority } from '@ticket-platform/shared';

// Staff confirms/overrides the AI/rule suggestion here before conversion —
// nothing on IntakeQuery.suggested* is binding, this is the actual human
// decision. Shape deliberately mirrors CreateTicketDto's fields that matter
// at this step; the rest (customerId, subject/description) come from the
// IntakeQuery row itself, not re-typed by staff.
export class ConvertIntakeQueryDto {
  @IsString()
  @MinLength(1)
  departmentId!: string;

  @IsString()
  @MinLength(1)
  ticketTypeDefinitionId!: string;

  @IsIn(Object.values(Priority))
  priority!: Priority;

  @IsOptional()
  @IsString()
  assignedAgentId?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Priority } from '@ticket-platform/shared';

// customFields is validated separately in TicketsService against the
// ticket type's frozen field schema (via buildCustomFieldsSchema) — that
// shape depends on which ticketTypeDefinition/customerType this is, so it
// can't be pinned down by a static class-validator decorator here.
export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  ticketTypeDefinitionId!: string;

  @IsString()
  @MinLength(1)
  customerId!: string;

  @IsIn(Object.values(Priority))
  priority!: Priority;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  assignedAgentId?: string;
}

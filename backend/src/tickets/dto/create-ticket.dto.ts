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

  // Exactly one of these two must be given (checked in TicketsService, not
  // here — class-validator doesn't cleanly express "at least one of").
  // customerId: an existing external Customer (the original B2B/B2C flow).
  // requesterUserId: an internal staff member the ticket is raised for —
  // TicketsService transparently finds-or-creates a Customer row keyed to
  // their email, so the rest of the ticket model (which always requires a
  // customerId) doesn't need to change for an internal-helpdesk setup.
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  requesterUserId?: string;

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

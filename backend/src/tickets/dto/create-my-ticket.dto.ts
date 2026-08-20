import { IsString, MinLength } from 'class-validator';
import { CreateTicketDto } from './create-ticket.dto';

// Same shape as CreateTicketDto, plus departmentId — a department-scoped
// staff route gets departmentId from the URL param, but /my-tickets isn't
// scoped to any one department (an employee can raise a ticket to any live
// one), so it has to come from the body instead.
export class CreateMyTicketDto extends CreateTicketDto {
  @IsString()
  @MinLength(1)
  departmentId!: string;
}

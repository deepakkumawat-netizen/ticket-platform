import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EscalateTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

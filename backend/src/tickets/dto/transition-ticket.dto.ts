import { IsString, MinLength } from 'class-validator';

export class TransitionTicketDto {
  @IsString()
  @MinLength(1)
  toStatusKey!: string;
}

import { IsString, MinLength } from 'class-validator';

export class TriageDto {
  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  description!: string;
}

import { IsString, MinLength } from 'class-validator';

export class CheckLanguageDto {
  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  description!: string;
}

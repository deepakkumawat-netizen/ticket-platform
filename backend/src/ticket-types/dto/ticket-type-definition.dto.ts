import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTicketTypeDefinitionDto {
  @IsString()
  @MinLength(1)
  key!: string; // e.g. "bug-report" — stable identifier, not shown to users

  @IsString()
  @MinLength(1)
  name!: string; // e.g. "Bug Report" — shown in the UI

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateTicketTypeDefinitionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

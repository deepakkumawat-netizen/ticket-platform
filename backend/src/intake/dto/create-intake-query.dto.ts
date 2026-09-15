import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// The one genuinely public, unauthenticated DTO in this codebase — every
// other create-style DTO is filled out by an authenticated staff member, so
// this is the only one that needs its own length bounds and a honeypot field
// on top of the controller's own throttle.
export class CreateIntakeQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  // Honeypot: a real visitor never sees or fills this field (hidden via CSS
  // on the form) — a bot filling every field blindly does. Silently
  // rejected as a validation error rather than surfaced as "spam detected",
  // so a bot gets no signal about why it failed.
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}

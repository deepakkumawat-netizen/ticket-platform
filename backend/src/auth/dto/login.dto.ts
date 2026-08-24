import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Optional so local dev without RECAPTCHA_SECRET_KEY configured still
  // works — see RecaptchaService's resilience note.
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

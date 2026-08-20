import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { StaffRole } from '@ticket-platform/shared';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(Object.values(StaffRole))
  role!: StaffRole;

  // Required for DEPT_ADMIN/AGENT, must be omitted for SUPER_ADMIN/EMPLOYEE
  // — enforced in UsersService, not here (it depends on the role value).
  @IsOptional()
  @IsString()
  departmentId?: string;

  // Omit to have one generated and returned once in the response — there's
  // no email delivery in this v1, so the admin has to relay it manually.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

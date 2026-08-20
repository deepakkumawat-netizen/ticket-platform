import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

@Controller('auth/staff')
export class StaffAuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.auth.validateStaff(dto.email, dto.password);
    const tokens = this.auth.issueStaffTokens(user);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, departmentId: user.departmentId },
    };
  }

  // Public — see AuthService.signupEmployee for why this is safe (EMPLOYEE
  // only, never a privileged role).
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signupEmployee(dto);
  }
}

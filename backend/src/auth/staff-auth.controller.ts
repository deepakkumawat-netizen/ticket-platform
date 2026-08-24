import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

// 10 attempts/min/IP — well above any real user's typo rate, low enough to
// blunt credential-stuffing/brute-force against these two public routes.
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

@Controller('auth/staff')
export class StaffAuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @Throttle(AUTH_THROTTLE)
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
  @Throttle(AUTH_THROTTLE)
  signup(@Body() dto: SignupDto) {
    return this.auth.signupEmployee(dto);
  }
}

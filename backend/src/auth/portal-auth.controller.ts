import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RecaptchaService } from './recaptcha.service';
import { LoginDto } from './dto/login.dto';

// Deliberately a separate controller/route prefix from staff login — see
// jwt-payload.interface.ts and the two Passport strategies for why staff and
// customer tokens can never be used interchangeably.
@Controller('auth/portal')
export class PortalAuthController {
  constructor(
    private auth: AuthService,
    private recaptcha: RecaptchaService,
  ) {}

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() dto: LoginDto) {
    await this.recaptcha.verify(dto.captchaToken, 'portal_login');
    const customer = await this.auth.validateCustomer(dto.email, dto.password);
    const tokens = this.auth.issueCustomerTokens(customer);
    return {
      ...tokens,
      customer: { id: customer.id, email: customer.email, name: customer.name, companyId: customer.companyId },
    };
  }
}

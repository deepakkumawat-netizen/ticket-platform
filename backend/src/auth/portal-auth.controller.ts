import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

// Deliberately a separate controller/route prefix from staff login — see
// jwt-payload.interface.ts and the two Passport strategies for why staff and
// customer tokens can never be used interchangeably.
@Controller('auth/portal')
export class PortalAuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const customer = await this.auth.validateCustomer(dto.email, dto.password);
    const tokens = this.auth.issueCustomerTokens(customer);
    return {
      ...tokens,
      customer: { id: customer.id, email: customer.email, name: customer.name, companyId: customer.companyId },
    };
  }
}

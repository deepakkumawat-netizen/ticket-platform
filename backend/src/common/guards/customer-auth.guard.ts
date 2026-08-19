import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Apply to every customer-portal route (@UseGuards(CustomerAuthGuard)).
// Delegates to the 'jwt-customer' Passport strategy — see
// customer-jwt.strategy.ts for the principalType enforcement.
@Injectable()
export class CustomerAuthGuard extends AuthGuard('jwt-customer') {}

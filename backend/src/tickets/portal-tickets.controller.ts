import { Controller, Get, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard } from '../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../common/decorators/current-principal.decorator';
import { CustomerJwtPayload } from '../auth/jwt-payload.interface';
import { TicketsService } from './tickets.service';

// Separate controller from TicketsController on purpose — that one is
// guarded by StaffAuthGuard at the class level, and Nest runs class- and
// method-level guards together (AND), not as an override, so a
// customer-only route can't live there. CustomerAuthGuard existed already
// (customer-jwt.strategy.ts) but nothing applied it to a real route until now.
@UseGuards(CustomerAuthGuard)
@Controller('portal/tickets')
export class PortalTicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list(@CurrentCustomer() customer: CustomerJwtPayload) {
    return this.tickets.listForPortalCustomer(customer);
  }
}

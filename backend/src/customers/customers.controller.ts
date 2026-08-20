import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '../common/guards/staff-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentStaff } from '../common/decorators/current-principal.decorator';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

// Customers aren't department-scoped (a company/contact can raise tickets to
// any department) — scoped by orgId only, open to any authenticated staff
// role, since picking/creating a customer is step one of raising a ticket.
@UseGuards(StaffAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get()
  search(@CurrentStaff() staff: StaffJwtPayload, @Query('q') query?: string) {
    return this.customers.search(staff.orgId, query);
  }

  @Post()
  create(@CurrentStaff() staff: StaffJwtPayload, @Body() dto: CreateCustomerDto) {
    return this.customers.create(staff.orgId, dto);
  }
}

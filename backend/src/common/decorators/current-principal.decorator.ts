import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CustomerJwtPayload, StaffJwtPayload } from '../../auth/jwt-payload.interface';

// Use behind StaffAuthGuard: @CurrentStaff() staff: StaffJwtPayload
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffJwtPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);

// Use behind CustomerAuthGuard: @CurrentCustomer() customer: CustomerJwtPayload
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerJwtPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);

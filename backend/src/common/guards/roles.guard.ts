import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@ticket-platform/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { StaffJwtPayload } from '../../auth/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const principal = request.user as StaffJwtPayload | undefined;
    // SUPER_ADMIN implicitly satisfies any role requirement.
    return !!principal && (principal.role === StaffRole.SUPER_ADMIN || required.includes(principal.role));
  }
}

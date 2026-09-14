import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffRole } from '@ticket-platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { StaffJwtPayload } from '../auth/jwt-payload.interface';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private ticketTypes: TicketTypesService,
  ) {}

  // SUPER_ADMIN sees every department, including inactive ones (needed for
  // the cross-department dashboard and for onboarding the next department).
  // EMPLOYEE sees every LIVE department org-wide (they're not scoped to any
  // one department — they need to pick which one to raise a self-service
  // ticket against). Everyone else (DEPT_ADMIN, AGENT) only sees their own.
  list(staff: StaffJwtPayload) {
    if (staff.role === StaffRole.SUPER_ADMIN) {
      return this.prisma.department.findMany({ where: { orgId: staff.orgId } });
    }
    if (staff.role === StaffRole.EMPLOYEE) {
      return this.prisma.department.findMany({ where: { orgId: staff.orgId, isActive: true } });
    }
    return this.prisma.department.findMany({ where: { id: staff.departmentId ?? '' } });
  }

  // Activating an empty department (no ticket type at all yet) auto-
  // provisions the same "General Support" starter content seed.ts gives
  // TECH — see TicketTypesService.provisionDefaultTicketType for why: a
  // live department with nothing to raise a ticket against is a dead end,
  // and there's no admin UI yet for hand-authoring one from scratch.
  async update(id: string, dto: UpdateDepartmentDto, activatedByUserId: string) {
    // Prisma's update() throws a raw P2025 ("record not found") for a
    // nonexistent id, which isn't an HttpException and surfaces as an
    // unhandled 500 — pre-check so this is a clean 404 instead.
    if (!(await this.prisma.department.findUnique({ where: { id } }))) {
      throw new NotFoundException('Department not found');
    }
    const updated = await this.prisma.department.update({ where: { id }, data: dto });
    if (dto.isActive) {
      const hasTicketType = await this.prisma.ticketTypeDefinition.findFirst({ where: { departmentId: id } });
      if (!hasTicketType) {
        try {
          await this.ticketTypes.provisionDefaultTicketType(id, activatedByUserId);
        } catch (err) {
          // Check-then-act race: two concurrent "activate" requests can both
          // see "no ticket type yet" and both try to provision one, and the
          // @@unique([departmentId, key]) constraint makes the loser throw a
          // raw P2002 instead of returning cleanly. The department is still
          // activated either way and a ticket type now exists (the winner's),
          // so this is a harmless double-activation, not a real error.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
            throw err;
          }
        }
      }
    }
    return updated;
  }
}

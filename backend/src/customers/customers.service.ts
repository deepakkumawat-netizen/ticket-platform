import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  // Search-as-you-type for the "who is this ticket for" picker on ticket
  // creation. Deliberately unpaginated + capped, same v1 scope as every other
  // list endpoint in this codebase (see ticket-types/departments) — fine for
  // an org-internal tool, revisit if a company ever has thousands of contacts.
  search(orgId: string, query?: string) {
    return this.prisma.customer.findMany({
      where: {
        orgId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { email: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  // Quick-create used inline from the new-ticket form. If companyName is
  // given, finds-or-creates a Company by that name within the org and
  // attaches the new customer to it (=> B2B); otherwise the customer is
  // standalone B2C. There's no full Companies CRUD yet — this is the only
  // way a Company gets created in v1, which keeps ticket intake to one form
  // instead of a separate company-management screen.
  async create(orgId: string, dto: CreateCustomerDto) {
    // Customer.email is globally unique — without this check, a duplicate
    // surfaced as a raw Prisma P2002 (generic 500) instead of a clean,
    // actionable message. Same pre-check pattern as users.service.ts's create().
    if (await this.prisma.customer.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('Someone with this email is already in the system — search for them above instead of adding again');
    }

    const companyId = await this.resolveCompanyId(orgId, dto.companyName);
    return this.prisma.customer.create({
      data: {
        orgId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        companyId,
      },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  // Shared by create() above and findOrCreateByEmail() below — finds-or-
  // creates a Company by name within the org, or returns undefined if no
  // company name was given (standalone B2C).
  private async resolveCompanyId(orgId: string, companyName?: string): Promise<string | undefined> {
    if (!companyName) return undefined;
    const existing = await this.prisma.company.findFirst({ where: { orgId, name: companyName } });
    return existing?.id ?? (await this.prisma.company.create({ data: { orgId, name: companyName } })).id;
  }

  // Idempotent upsert-by-email for system-originated intake (public web
  // form, inbound email) — unlike create() above (staff-authored, throws
  // ConflictException on a duplicate email), a repeat submission from the
  // same address should just resolve to the same Customer. Same dedup
  // spirit as tickets.service.ts's findOrCreateCustomerForStaff, but keyed
  // by a raw email/name from an unauthenticated submission instead of an
  // existing User row.
  async findOrCreateByEmail(orgId: string, name: string, email: string, phone?: string, companyName?: string) {
    const companyId = await this.resolveCompanyId(orgId, companyName);
    return this.prisma.customer.upsert({
      where: { email },
      update: companyId ? { companyId } : {},
      create: { orgId, name, email, phone, companyId },
      include: { company: { select: { id: true, name: true } } },
    });
  }
}

// Seeds a minimal, real dev fixture: one Organization, all 4 departments
// (inactive until each is onboarded per the phased roadmap), and one
// SUPER_ADMIN staff account so `/auth/staff/login` is testable end-to-end.
// Run with: npm run prisma:seed --workspace backend
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as argon2 from 'argon2';
import { AuthMethod, CustomerType, DepartmentKey, StaffRole } from '@ticket-platform/shared';

// See src/prisma/prisma.service.ts for why this goes through Neon's
// serverless driver instead of a bare `new PrismaClient()`.
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaNeon(pool) });

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: 'seed-org' },
    update: {},
    create: { id: 'seed-org', name: 'Codevidhya' },
  });

  for (const key of Object.values(DepartmentKey)) {
    await prisma.department.upsert({
      where: { orgId_key: { orgId: org.id, key } },
      update: {},
      create: { orgId: org.id, key, name: key.charAt(0) + key.slice(1).toLowerCase(), isActive: false },
    });
  }

  const email = 'admin@codevidhya.com';
  let superAdmin = await prisma.user.findUnique({ where: { email } });
  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: {
        orgId: org.id,
        email,
        name: 'Super Admin',
        role: StaffRole.SUPER_ADMIN,
        departmentId: null,
      },
    });
    await prisma.authCredential.create({
      data: {
        userId: superAdmin.id,
        method: AuthMethod.LOCAL_PASSWORD,
        passwordHash: await argon2.hash('ChangeMe123!'),
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded SUPER_ADMIN login: ${email} / ChangeMe123!  (change this before real use)`);
  }

  const techDept = await prisma.department.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: DepartmentKey.TECH } },
  });
  await seedStaffMember(org.id, techDept.id, 'tech-agent@codevidhya.com', 'Tech Agent', StaffRole.AGENT);
  // The escalation workflow's target — without a DEPT_ADMIN in a department,
  // notifyDepartmentManagers() falls back to org-wide SUPER_ADMINs, which
  // works but isn't what real usage looks like; seed one so TECH is
  // testable end-to-end out of the box.
  await seedStaffMember(org.id, techDept.id, 'tech-manager@codevidhya.com', 'Tech Manager', StaffRole.DEPT_ADMIN);
  // EMPLOYEE is never department-scoped (see enums.ts) — this is the
  // self-service login: raises tickets to any live department, sees only
  // its own via /my-tickets.
  await seedStaffMember(org.id, null, 'employee@codevidhya.com', 'Sample Employee', StaffRole.EMPLOYEE);
  await seedReadyToUseTechSetup(techDept.id, superAdmin.id);
}

async function seedStaffMember(orgId: string, departmentId: string | null, email: string, name: string, role: StaffRole) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const user = await prisma.user.create({ data: { orgId, departmentId, email, name, role } });
  await prisma.authCredential.create({
    data: { userId: user.id, method: AuthMethod.LOCAL_PASSWORD, passwordHash: await argon2.hash('ChangeMe123!') },
  });
  // eslint-disable-next-line no-console
  console.log(`Seeded ${role} login: ${email} / ChangeMe123!  (change this before real use)`);
  return user;
}

// Flips TECH live (first in the rollout order — see README) and provisions
// one fully published "General Support" ticket type under it, so the
// ticket-creation UI has something real to submit against on day one instead
// of requiring someone to hand-author a ticket type via curl first. This
// mirrors exactly what the ticket-types admin UI will eventually do — it's
// seed data in these same tables, not a special code path.
async function seedReadyToUseTechSetup(departmentId: string, publishedByUserId: string) {
  await prisma.department.update({ where: { id: departmentId }, data: { isActive: true } });

  const existing = await prisma.ticketTypeDefinition.findUnique({
    where: { departmentId_key: { departmentId, key: 'general-support' } },
  });
  if (existing) return;

  const def = await prisma.ticketTypeDefinition.create({
    data: { departmentId, key: 'general-support', name: 'General Support', description: 'Default catch-all ticket type for TECH.' },
  });

  const fields = await Promise.all([
    prisma.fieldDefinition.create({
      data: { ticketTypeDefinitionId: def.id, key: 'affectedSystem', label: 'Affected system', fieldType: 'TEXT', appliesTo: 'BOTH', required: false, order: 0 },
    }),
    prisma.fieldDefinition.create({
      data: { ticketTypeDefinitionId: def.id, key: 'stepsToReproduce', label: 'Steps to reproduce', fieldType: 'TEXTAREA', appliesTo: 'BOTH', required: false, order: 1 },
    }),
  ]);

  const statuses = await Promise.all([
    prisma.statusDefinition.create({ data: { ticketTypeDefinitionId: def.id, key: 'OPEN', label: 'Open', isInitial: true, order: 0 } }),
    prisma.statusDefinition.create({ data: { ticketTypeDefinitionId: def.id, key: 'IN_PROGRESS', label: 'In Progress', order: 1 } }),
    prisma.statusDefinition.create({ data: { ticketTypeDefinitionId: def.id, key: 'RESOLVED', label: 'Resolved', isTerminal: true, order: 2 } }),
  ]);

  const transitions = await Promise.all([
    prisma.statusTransition.create({ data: { ticketTypeDefinitionId: def.id, fromStatusKey: 'OPEN', toStatusKey: 'IN_PROGRESS', allowedRoles: [] } }),
    prisma.statusTransition.create({ data: { ticketTypeDefinitionId: def.id, fromStatusKey: 'IN_PROGRESS', toStatusKey: 'RESOLVED', allowedRoles: [] } }),
    prisma.statusTransition.create({ data: { ticketTypeDefinitionId: def.id, fromStatusKey: 'OPEN', toStatusKey: 'RESOLVED', allowedRoles: [] } }),
  ]);

  // Response/resolution minutes are placeholder values — adjust once there's
  // a real admin UI (or edit these SlaRule rows directly) to match actual
  // support commitments.
  const slaMinutesByPriority: Record<string, { response: number; resolution: number }> = {
    URGENT: { response: 30, resolution: 240 },
    HIGH: { response: 60, resolution: 480 },
    MEDIUM: { response: 240, resolution: 1440 },
    LOW: { response: 480, resolution: 4320 },
  };
  const slaRules = await Promise.all(
    Object.values(CustomerType).flatMap((customerType) =>
      Object.entries(slaMinutesByPriority).map(([priority, minutes]) =>
        prisma.slaRule.create({
          data: {
            ticketTypeDefinitionId: def.id,
            customerType,
            priority,
            responseTimeMinutes: minutes.response,
            resolutionTimeMinutes: minutes.resolution,
          },
        }),
      ),
    ),
  );

  await prisma.ticketTypeVersion.create({
    data: {
      ticketTypeDefinitionId: def.id,
      versionNumber: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      publishedByUserId,
      fieldSchemaSnapshot: fields.map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        appliesTo: f.appliesTo,
        required: f.required,
        options: f.options,
        order: f.order,
        isDeprecated: f.isDeprecated,
      })),
      statusSchemaSnapshot: {
        statuses: statuses.map((s) => ({ key: s.key, label: s.label, isInitial: s.isInitial, isTerminal: s.isTerminal, order: s.order })),
        transitions: transitions.map((t) => ({ fromStatusKey: t.fromStatusKey, toStatusKey: t.toStatusKey, allowedRoles: t.allowedRoles })),
      },
      slaSnapshot: slaRules.map((r) => ({
        customerType: r.customerType,
        priority: r.priority,
        responseTimeMinutes: r.responseTimeMinutes,
        resolutionTimeMinutes: r.resolutionTimeMinutes,
      })),
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded TECH department (live) with a published "General Support" ticket type.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

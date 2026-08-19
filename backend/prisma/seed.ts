// Seeds a minimal, real dev fixture: one Organization, all 4 departments
// (inactive until each is onboarded per the phased roadmap), and one
// SUPER_ADMIN staff account so `/auth/staff/login` is testable end-to-end.
// Run with: npm run prisma:seed --workspace backend
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as argon2 from 'argon2';
import { AuthMethod, DepartmentKey, StaffRole } from '@ticket-platform/shared';

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
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
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
        userId: user.id,
        method: AuthMethod.LOCAL_PASSWORD,
        passwordHash: await argon2.hash('ChangeMe123!'),
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded SUPER_ADMIN login: ${email} / ChangeMe123!  (change this before real use)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import * as dns from 'dns';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Belt-and-suspenders: set here too (not just main.ts) so this module works
// correctly regardless of which entry point imports it first (e.g. a
// standalone migration/seed script that never imports main.ts at all).
dns.setDefaultResultOrder('ipv4first');

// Connects via the `pg` driver adapter instead of Prisma's default Rust
// query engine. This is not a style preference — it's a fix for a confirmed
// production issue: Prisma's Rust engine resolves/connects to the DB itself,
// bypassing Node's dns module entirely, so a host that can't route IPv6 to
// the DB (confirmed on Render, connecting to Neon) fails every query with
// P1001 no matter what NODE_OPTIONS says. The `pg` package uses Node's own
// net/dns stack, which DOES respect NODE_OPTIONS=--dns-result-order=ipv4first
// (set in render.yaml) and connects successfully.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Thin wrapper so every module injects PrismaService instead of constructing
// its own PrismaClient — one connection pool, clean shutdown.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

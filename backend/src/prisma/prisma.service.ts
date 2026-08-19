import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Connects via Neon's own serverless driver (HTTPS/WebSocket, port 443)
// instead of Prisma's default Rust engine OR a plain `pg` pool (raw TCP on
// port 5432). Both of those hit real, confirmed connectivity failures on
// Render talking to Neon — first "P1001: Can't reach database server"
// (Prisma's Rust engine resolves/connects itself, bypassing Node's dns
// module entirely, and Render can't route IPv6 to Neon's endpoint), then
// "getaddrinfo ENOTFOUND" even after switching to plain `pg` (raw TCP DNS
// lookups proved unreliable on Render's network for this host). Neon's
// serverless driver sidesteps the whole class of raw-socket/DNS issues by
// speaking to Neon over a WebSocket tunneled through standard HTTPS, which
// works reliably anywhere outbound HTTPS works — this is Neon's own
// recommended approach for serverless/edge-style hosts.
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaNeon(pool);

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

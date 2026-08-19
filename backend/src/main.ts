import * as dns from 'dns';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Node 18+ resolves hostnames IPv6-first by default. Many hosts (confirmed:
// Render) can't actually route IPv6 to Neon's endpoint, so Prisma fails with
// "P1001: Can't reach database server" even though the exact same
// connection string works fine anywhere IPv4-first resolution happens. This
// only fixes the app process itself — `prisma migrate deploy` in the start
// command runs as its own separate Node process, which is why
// NODE_OPTIONS=--dns-result-order=ipv4first is ALSO set in render.yaml (it
// covers both processes; this line is belt-and-suspenders for the app).
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // tighten to the real frontend origin(s) before deploying
  // Every controller route lives under /api/... — this is what lets
  // ServeStaticModule (app.module.ts) serve the built frontend from the
  // SAME process/origin without ever colliding with an API route: it
  // excludes /api/(.*) and serves everything else (including future
  // modules — nothing to remember to update) as static files / SPA
  // fallback to index.html.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Ticket Platform API listening on http://localhost:${port}`);
}
bootstrap();

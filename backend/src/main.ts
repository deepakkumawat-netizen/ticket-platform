import * as dns from 'dns';
import helmet from 'helmet';
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
  // rawBody: true attaches the exact request bytes as req.rawBody alongside
  // Nest's normal JSON parsing — needed only by
  // IntakeWebhooksController.inboundEmail, which must verify Resend's Svix
  // signature against the EXACT bytes it signed (a parsed-then-re-serialized
  // JSON body isn't guaranteed to match byte-for-byte). Every other route's
  // behavior is unaffected — this only adds a field, it doesn't change how
  // the body is parsed anywhere else.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Default helmet CSP is script-src/frame-src 'self' only — that silently
  // blocked Google's reCAPTCHA script (auth/recaptcha.service.ts) from ever
  // loading, no console error a typical user would notice, just a missing
  // token → every login rejected with "Bot check failed". Explicitly allow
  // just the two Google hosts reCAPTCHA v3 needs, nothing broader.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
          'frame-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
        },
      },
    }),
  );
  // CORS_ORIGIN is a comma-separated allowlist. In production the frontend
  // is served from this same process/origin (see ServeStaticModule below),
  // so this mainly matters for local dev (Vite on :5173) and any standalone
  // frontend deploy — set it in the environment rather than widening this.
  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
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

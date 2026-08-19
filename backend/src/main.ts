import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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

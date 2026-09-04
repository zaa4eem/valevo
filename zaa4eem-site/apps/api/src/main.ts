import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  const logger = new Logger('CORS');

  // Exactly one reverse proxy (nginx-proxy) sits in front of this API in
  // every real deployment (infra/docker-compose.yml) — without this,
  // Express's req.ip resolves to nginx-proxy's own address for every
  // request, so @nestjs/throttler's default IP-based rate limiting (e.g.
  // 5/min on /auth/login) is shared across ALL real visitors instead of
  // isolated per client. `1` trusts exactly one hop back from the socket,
  // taking nginx's own appended X-Forwarded-For entry as the real client —
  // not an attacker-supplied one further left in the header.
  app.set('trust proxy', 1);

  // Uploaded avatars live outside the `api` prefix (they're static files, not
  // API responses) — served at /uploads/avatars/<file>, matching the URL
  // avatar-storage.ts + UsersController build and store on the User row.
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const webOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  logger.log(`Allowed origins: ${webOrigins.join(', ')}`);
  app.enableCors({
    // A callback instead of the plain array lets a rejected origin be
    // logged — otherwise a WEB_ORIGIN misconfiguration (missing scheme,
    // trailing slash, wrong host) silently drops CORS headers, and a
    // credentialed cross-origin request failing that way looks identical
    // to a refresh-token problem from the browser's side (the cookie never
    // gets stored in the first place, so every subsequent refresh 401s).
    origin: (origin, callback) => {
      if (!origin || webOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`Rejected Origin "${origin}" — not in allowed list [${webOrigins.join(', ')}]`);
        callback(null, false);
      }
    },
    credentials: true,
  });

  app.use(cookieParser());
  // Bare /health (not /api/health) so Docker's HEALTHCHECK and an external
  // uptime monitor don't need to know about API path versioning.
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`zaa4eem API listening on :${port}`);
}

bootstrap();

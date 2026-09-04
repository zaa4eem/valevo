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

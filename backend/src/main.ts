import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load the repo-root .env before anything reads process.env. Real environments
// inject variables directly, so a missing file is normal, not an error.
const rootEnv = join(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const env = app.get<Env>(ENV);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet());

  // Only believe forwarding headers when something trustworthy writes them.
  // `1` means "trust exactly the nearest hop", so a client cannot prepend its
  // own X-Forwarded-For entry and choose which rate-limit bucket it lands in.
  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  warnAboutDatabaseTls(env, logger);
  // cookie-parser is applied in AppModule so tests share the behaviour.
  app.enableCors({
    origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  // No global ValidationPipe: request validation is done per-route with
  // ZodValidationPipe against the schemas in @wellovue/types, so the API
  // enforces exactly the contract the frontend compiles against.
  // ZodExceptionFilter is registered in AppModule.
  app.enableShutdownHooks();

  // API docs are a development aid; they describe every health-data endpoint,
  // so they stay off outside development.
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Wellovue API')
      .setDescription(
        'Core API for the causal Type 2 diabetes platform. ' +
          'Every insight endpoint returns evidence strength, confidence, and limitations.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
    logger.log(`API docs: http://localhost:${env.BACKEND_PORT}/api/docs`);
  }

  await app.listen(env.BACKEND_PORT);
  logger.log(`Backend listening on http://localhost:${env.BACKEND_PORT}/api`);
}

/**
 * Says, on every boot, whether the database connection can actually be trusted.
 *
 * `sslmode=require` with `rejectUnauthorized: false` encrypts the connection
 * and verifies nothing. It stops someone reading the traffic and does not stop
 * someone answering as the database, which for a health record is the half
 * that matters. The platform runs this way today against the VM's self-signed
 * certificate.
 *
 * This warns rather than exits by default, because exiting would take a
 * running deployment down for a condition it has always had. Setting
 * REQUIRE_VERIFIED_DB_TLS=true turns it into a boot failure, which is the
 * switch to flip once a CA-signed certificate is installed and the URL says
 * `sslmode=verify-full`. Until then the warning is loud and repeats forever,
 * because a risk nobody is reminded of is a risk nobody fixes.
 */
function warnAboutDatabaseTls(env: Env, logger: Logger): void {
  if (env.DATABASE_SSL_REJECT_UNAUTHORIZED) return;

  const message =
    'Database TLS is ENCRYPTED BUT UNVERIFIED ' +
    '(DATABASE_SSL_REJECT_UNAUTHORIZED=false). An attacker who can answer as ' +
    'the database will not be detected. Install a CA-signed certificate, set ' +
    'sslmode=verify-full, then set DATABASE_SSL_REJECT_UNAUTHORIZED=true and ' +
    'REQUIRE_VERIFIED_DB_TLS=true. See infra/README.md.';

  if (env.REQUIRE_VERIFIED_DB_TLS) {
    throw new Error(`Refusing to start: ${message}`);
  }
  logger.warn(message);
}

bootstrap().catch((err) => {
  // A failure here is almost always misconfiguration; make it readable.
  console.error('Failed to start backend:', err instanceof Error ? err.message : err);
  process.exit(1);
});

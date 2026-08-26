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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet());
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

bootstrap().catch((err) => {
  // A failure here is almost always misconfiguration; make it readable.
  console.error('Failed to start backend:', err instanceof Error ? err.message : err);
  process.exit(1);
});

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';

import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { EngineModule } from './engine/engine.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GlucoseModule } from './glucose/glucose.module';
import { MealsModule } from './meals/meals.module';
import { LabsModule } from './labs/labs.module';
import { ExperimentsModule } from './experiments/experiments.module';
import { MedicationsModule } from './medications/medications.module';
import { TimelineModule } from './timeline/timeline.module';
import { EvidenceModule } from './evidence/evidence.module';
import { DiabetesProfileModule } from './diabetes-profile/diabetes-profile.module';
import { HealthModule } from './health/health.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { SupportModule } from './support/support.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import {
  ScopedThrottlerGuard,
  THROTTLE_AUTH,
  THROTTLE_REFRESH,
  THROTTLE_WRITE,
} from './common/guards/throttle.guard';
import { ENV, type Env } from './config/env';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';

@Module({
  imports: [
    // Infrastructure (all @Global)
    ConfigModule,
    DatabaseModule,
    StorageModule,
    AuditModule,
    EngineModule,

    // Limits are read from the validated environment rather than hardcoded:
    // the right number depends on what fronts the service, and the test suite
    // has to be able to reach a limit without waiting fifteen minutes.
    //
    // Storage is in-process. That is correct for one container and wrong for
    // several: N replicas mean N independent budgets, so an attacker gets N
    // times the attempts. Redis is already in the compose file and unused;
    // wiring @nest-lab/throttler-storage-redis is the change to make before
    // running more than one backend. Noted in infra/README.md.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [
          { name: 'default', ttl: env.THROTTLE_GLOBAL_TTL_S * 1000, limit: env.THROTTLE_GLOBAL_LIMIT },
          { name: THROTTLE_AUTH, ttl: env.THROTTLE_AUTH_TTL_S * 1000, limit: env.THROTTLE_AUTH_LIMIT },
          { name: THROTTLE_REFRESH, ttl: env.THROTTLE_REFRESH_TTL_S * 1000, limit: env.THROTTLE_REFRESH_LIMIT },
          { name: THROTTLE_WRITE, ttl: env.THROTTLE_WRITE_TTL_S * 1000, limit: env.THROTTLE_WRITE_LIMIT },
        ],
      }),
    }),

    // Domains
    AuthModule,
    UsersModule,
    GlucoseModule,
    MealsModule,
    LabsModule,
    ExperimentsModule,
    MedicationsModule,
    TimelineModule,
    EvidenceModule,
    DiabetesProfileModule,
    HealthModule,
    WaitlistModule,
    SupportModule,
  ],
  providers: [
    // Order matters: the throttler runs before authentication, so an
    // unauthenticated flood is rejected without ever reaching argon2 or the
    // database. Verifying a password is deliberately expensive, which makes an
    // unthrottled login endpoint a CPU exhaustion vector as well as a
    // brute-force one.
    { provide: APP_GUARD, useClass: ScopedThrottlerGuard },

    // Authentication is on by default. Opening a route requires an explicit
    // @Public() decorator, so nothing is exposed by omission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // Registered here rather than in main.ts so the tests, which build the
    // app through the testing module, get the same behaviour as production.
    // useClass, not useFactory: the filter extends BaseExceptionFilter, which
    // has its own injected HttpAdapterHost. Constructing it by hand leaves that
    // undefined and every delegated exception then throws inside the filter.
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  // Applied here rather than only in main.ts so the tests, which build the app
  // through the testing module, can read the refresh cookie too.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}

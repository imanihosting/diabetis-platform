import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { MedicationsModule } from './medications/medications.module';
import { TimelineModule } from './timeline/timeline.module';
import { HealthModule } from './health/health.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';

@Module({
  imports: [
    // Infrastructure (all @Global)
    ConfigModule,
    DatabaseModule,
    StorageModule,
    AuditModule,
    EngineModule,

    // Domains
    AuthModule,
    UsersModule,
    GlucoseModule,
    MealsModule,
    MedicationsModule,
    TimelineModule,
    HealthModule,
  ],
  providers: [
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

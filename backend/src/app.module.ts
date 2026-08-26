import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

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
  ],
})
export class AppModule {}

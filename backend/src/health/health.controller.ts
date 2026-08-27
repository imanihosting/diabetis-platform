import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerStorage } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { EngineClient } from '../engine/engine.client';
import { ResilientThrottlerStorage } from '../common/guards/throttle-storage';
import { ENV, type Env } from '../config/env';

@ApiTags('health')
// Docker probes these every ten seconds from the same address as everything
// else behind the proxy. Counting them would spend the budget on ourselves.
//
// Bare @SkipThrottle() skips the throttler named 'default' and only that one.
// That is the whole exemption here because the named limits are opt-in: this
// controller declares no scope, so none of them apply to it.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly engine: EngineClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(ThrottlerStorage) private readonly throttlerStorage: ThrottlerStorage,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness — is the process up' })
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — are dependencies reachable' })
  async ready() {
    const [database, storage, engine] = await Promise.all([
      this.db.ping().catch(() => false),
      this.storage.ping().catch(() => false),
      this.engine.ping().catch(() => false),
    ]);

    // The metabolic engine is not required to serve the timeline, so its
    // absence degrades the service rather than failing readiness.
    const ready = database && storage;

    return {
      status: ready ? 'ok' : 'degraded',
      checks: { database, storage, metabolicEngine: engine },
      // Posture, not health. None of these fail readiness: they are all states
      // the platform legitimately runs in today, and a probe that went red for
      // the configuration it shipped with would be turned off within a week.
      // They are reported so a deploy gate can assert them from outside —
      // see scripts/canary.mjs, which is the thing that should go red.
      posture: this.posture(),
    };
  }

  @Public()
  @Get('posture')
  @ApiOperation({
    summary: 'The security posture this process is running with',
    description:
      'Separate from readiness because none of it is a health question. ' +
      'Whether database TLS is verified and whether rate limits are shared ' +
      'across replicas are both states the platform runs in deliberately ' +
      'today, and both stop being acceptable at a specific knowable moment. ' +
      'Exposed so a deploy gate can check them without reading the ' +
      'environment of a container it does not have a shell on.',
  })
  posture() {
    const throttler = this.throttlerStorage;

    return {
      // True only when the connection actually verifies the certificate.
      // `sslmode=verify-full` in the URL alone proves nothing: node-postgres
      // is handed `rejectUnauthorized` separately and that is what decides.
      databaseTlsVerified: this.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
      rateLimit:
        throttler instanceof ResilientThrottlerStorage
          ? {
              // Configured but not shared means Redis was set and is not
              // answering: limits are still enforced, per process.
              configured: throttler.configured,
              sharedAcrossReplicas: throttler.sharedAcrossReplicas,
            }
          : { configured: false, sharedAcrossReplicas: false },
      trustProxy: this.env.TRUST_PROXY,
    };
  }
}

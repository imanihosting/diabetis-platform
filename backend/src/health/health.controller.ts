import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { EngineClient } from '../engine/engine.client';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly engine: EngineClient,
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
    };
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createGlucoseSampleSchema,
  glucoseUnitSchema,
  importGlucoseSchema,
  type GlucoseUnit,
} from '@diabetes/types';
import { GlucoseService } from './glucose.service';
import { parseGlucoseCsv } from './csv-parser';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { StorageService } from '../storage/storage.service';
import { DatabaseService } from '../database/database.service';

@ApiTags('glucose')
@Controller('glucose')
export class GlucoseController {
  constructor(
    private readonly glucose: GlucoseService,
    private readonly storage: StorageService,
    private readonly db: DatabaseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Record a single glucose reading' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createGlucoseSampleSchema)) body: unknown,
  ) {
    return this.glucose.create(
      user.id,
      body as Parameters<GlucoseService['create']>[1],
    );
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import glucose samples as JSON' })
  importJson(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importGlucoseSchema)) body: unknown,
  ) {
    return this.glucose.import(
      user.id,
      body as Parameters<GlucoseService['import']>[1],
    );
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Import a CGM or meter CSV export' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async importCsv(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const parsed = parseGlucoseCsv(file.buffer.toString('utf8'));
    if (parsed.samples.length === 0) {
      throw new BadRequestException({
        message: 'No usable rows found in the CSV',
        rejected: parsed.rejected.slice(0, 20),
      });
    }

    // Keep the original upload: imports must stay replayable and auditable.
    const objectKey = this.storage.buildKey(user.id, 'imports', file.originalname);
    await this.storage.put(objectKey, file.buffer, file.mimetype || 'text/csv');

    const job = await this.db.queryOne<{ id: string }>(
      `insert into integrations.import_jobs
         (user_id, source, kind, object_key, status, rows_total)
       values ($1, 'csv_import', 'glucose', $2, 'processing', $3)
       returning id`,
      [user.id, objectKey, parsed.samples.length + parsed.rejected.length],
    );

    const result = await this.glucose.import(user.id, {
      source: 'csv_import',
      samples: parsed.samples,
    });

    await this.db.query(
      `update integrations.import_jobs
          set status = 'completed',
              rows_imported = $2,
              rows_rejected = $3,
              error_summary = $4,
              completed_at = now()
        where id = $1`,
      [
        job!.id,
        result.imported,
        parsed.rejected.length + result.rejected.length,
        JSON.stringify({ parseErrors: parsed.rejected.slice(0, 100) }),
      ],
    );

    return { importJobId: job!.id, objectKey, ...result, parseErrors: parsed.rejected };
  }

  @Get()
  @ApiOperation({ summary: 'List glucose readings in a time range' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const range = parseRange(from, to);
    return this.glucose.list(user.id, range.from, range.to);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Descriptive glucose summary for a time range' })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('unit') unit?: string,
  ) {
    const range = parseRange(from, to);
    const parsedUnit: GlucoseUnit = unit
      ? glucoseUnitSchema.parse(unit)
      : 'mmol/L';
    return this.glucose.summary(user.id, range.from, range.to, parsedUnit);
  }
}

function parseRange(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException('`from` and `to` must be valid ISO dates');
  }
  if (fromDate >= toDate) {
    throw new BadRequestException('`from` must be before `to`');
  }
  return { from: fromDate, to: toDate };
}

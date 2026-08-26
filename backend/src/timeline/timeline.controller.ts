import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTimelineEventSchema,
  timelineQuerySchema,
  type CreateTimelineEventInput,
} from '@diabetes/types';
import { TimelineService } from './timeline.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('timeline')
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  @ApiOperation({
    summary: 'The unified metabolic timeline for a time range',
  })
  query(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    const defaults = {
      to: query.to ?? new Date().toISOString(),
      from:
        query.from ??
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const parsed = timelineQuerySchema.parse({ ...query, ...defaults });
    return this.timeline.query(user.id, parsed);
  }

  @Post('events')
  @ApiOperation({ summary: 'Add an event to the timeline' })
  addEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTimelineEventSchema))
    body: CreateTimelineEventInput,
  ) {
    return this.timeline.addEvent(user.id, body);
  }
}

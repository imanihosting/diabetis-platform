import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTimelineEventSchema,
  timelineQueryInputSchema,
  type CreateTimelineEventInput,
  type TimelineQueryInput,
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
    @Query(new ZodValidationPipe(timelineQueryInputSchema))
    query: TimelineQueryInput,
  ) {
    return this.timeline.query(user.id, query);
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

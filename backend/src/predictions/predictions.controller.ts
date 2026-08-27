import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attachOutcomeSchema,
  createPredictionSchema,
  type AttachOutcomeInput,
  type CreatePredictionInput,
} from '@wellovue/types';
import { PredictionsService } from './predictions.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

/**
 * There is no PUT, PATCH or DELETE here, and there will not be.
 *
 * A prediction is the record of what the platform expected before it knew the
 * answer. An endpoint that could revise one would make every number computed
 * from them meaningless, and the absence of that endpoint is the first of two
 * defences — the trigger on `ai.predictions` is the second.
 */
@ApiTags('predictions')
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record what is expected of an experiment, before it runs',
    description:
      'The client names an experiment. Everything predicted is derived on the ' +
      'server from the evidence as it stands, because a record of how often ' +
      'the platform was right is worth nothing if the platform chose the ' +
      'answer after seeing the question.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPredictionSchema)) body: CreatePredictionInput,
  ) {
    return this.predictions.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Every prediction made, newest first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.predictions.list(user.id);
  }

  @Post(':id/outcome')
  @ApiOperation({
    summary: 'Record what actually happened',
    description:
      'Written once. Advances the prediction from pending to matched, which ' +
      'is the only change its trigger permits.',
  })
  attachOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attachOutcomeSchema)) body: AttachOutcomeInput,
  ) {
    return this.predictions.attachOutcome(user.id, id, body);
  }

  @Get(':id/outcome')
  @ApiOperation({ summary: 'The outcome attached to a prediction, if there is one' })
  outcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.predictions.outcomeFor(user.id, id);
  }
}

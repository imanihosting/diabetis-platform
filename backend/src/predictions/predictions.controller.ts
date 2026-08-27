import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PredictionsService } from './predictions.service';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

/**
 * Predictions are read here and written nowhere.
 *
 * There is no PUT, PATCH or DELETE, and there will not be. A prediction is the
 * record of what the platform expected before it knew the answer, and an
 * endpoint that could revise one would make every number computed from them
 * meaningless. The absence of that endpoint is the first of two defences — the
 * trigger on `ai.predictions` is the second.
 *
 * There is no POST either, which is newer. A prediction is written when an
 * experiment starts, in the same transaction as the start, and that is the
 * only moment it can be written: an expectation recorded against an experiment
 * that never began can never be measured against anything, because finishing
 * one requires it to have run. The endpoint that did this produced only that
 * dead end, and migration 0019 now refuses a second prediction for the same
 * experiment anyway — "what was predicted" is a question with one answer.
 *
 * Nor is there a way to write an outcome from here. Recording what happened is
 * how an experiment finishes, so it belongs to the experiment and lives at
 * `POST /experiments/:id/complete`. An outcome that could be attached on its
 * own would leave the trial it settles running forever, and two doors into the
 * same write are how the two states eventually disagree. Reading one back is
 * harmless and stays.
 */
@ApiTags('predictions')
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  @Get()
  @ApiOperation({ summary: 'Every prediction made, newest first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.predictions.list(user.id);
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

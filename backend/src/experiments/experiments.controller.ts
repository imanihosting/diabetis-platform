import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attachOutcomeSchema,
  createExperimentSchema,
  type AttachOutcomeInput,
  type CreateExperimentInput,
} from '@wellovue/types';
import { ExperimentsService } from './experiments.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('experiments')
@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Propose an experiment, and receive the safety decision',
    description:
      'Always 201, including when the answer is no. A refused experiment is ' +
      'recorded as a draft that can never start: blocked insulin dosing is ' +
      'not malformed input, it is a real question the product declines, and ' +
      'the record of what was asked and why it was refused is worth keeping. ' +
      'The safety status and the review requirement are derived on the ' +
      'server and are not accepted from the request.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createExperimentSchema)) body: CreateExperimentInput,
  ) {
    return this.experiments.create(user.id, body);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: 'Start an allowed experiment, recording its prediction first',
    description:
      'The prediction and the status change are one transaction, and the ' +
      'database refuses the transition to active without a prediction ' +
      'attached. Blocked experiments are refused outright; clinician-gated ' +
      'ones stay waiting, because there is no way to record a review yet.',
  })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.experiments.start(user.id, id);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Finish an experiment by recording what actually happened',
    description:
      'The mirror of start: the measurement is written first, the status ' +
      'changes second, both in one transaction, and the database refuses the ' +
      'transition to completed without an outcome attached. This is the only ' +
      'way an outcome can be recorded — one that could be written against a ' +
      'prediction on its own would leave the experiment running with its ' +
      'answer already known. The result is scored against an expectation ' +
      'frozen before the trial began, and neither side of that comparison can ' +
      'be revised afterwards.',
  })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attachOutcomeSchema)) body: AttachOutcomeInput,
  ) {
    return this.experiments.complete(user.id, id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Every experiment proposed, newest first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.experiments.list(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One experiment, with what was predicted and what was observed',
    description:
      'All three together, because the screen this serves is meaningless in ' +
      'pieces: predicted without observed is a promise, and observed without ' +
      'predicted is a measurement of nothing in particular.',
  })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.experiments.detail(user.id, id);
  }
}

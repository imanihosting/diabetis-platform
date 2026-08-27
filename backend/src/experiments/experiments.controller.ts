import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createExperimentSchema, type CreateExperimentInput } from '@wellovue/types';
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

  @Get()
  @ApiOperation({ summary: 'Every experiment proposed, newest first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.experiments.list(user.id);
  }
}

import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLabResultSchema,
  labListQuerySchema,
  type CreateLabResultInput,
  type LabListQuery,
} from '@wellovue/types';
import { LabsService } from './labs.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('labs')
@Controller('labs')
export class LabsController {
  constructor(private readonly labs: LabsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a lab or body measurement',
    description:
      'HbA1c, fasting glucose, weight, BMI and anything else a printout ' +
      'carries. Stored in the unit it was entered in.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createLabResultSchema)) body: CreateLabResultInput,
  ) {
    return this.labs.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'List lab results, newest first' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(labListQuerySchema)) query: LabListQuery,
  ) {
    return this.labs.list(user.id, query);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { evidenceQuerySchema, type EvidenceQuery } from '@wellovue/types';
import { EvidenceService } from './evidence.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  @ApiOperation({
    summary: 'Structured findings for the signed-in user over a time range',
    description:
      'Every finding carries an effect estimate, a confidence, a sample count, ' +
      'and its limitations. A window the data cannot support returns an ' +
      '"insufficient data" finding, which is a real answer and is shown as one.',
  })
  findings(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(evidenceQuerySchema)) query: EvidenceQuery,
  ) {
    return this.evidence.findings(user.id, query);
  }
}

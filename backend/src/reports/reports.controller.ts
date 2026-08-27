import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  clinicianPacketQuerySchema,
  type ClinicianPacketQuery,
} from '@wellovue/types';
import { ReportsService } from './reports.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('clinician')
  @ApiOperation({
    summary: 'Thirty or ninety days on one page, for an appointment',
    description:
      'Findings with their limitations, the glucose summary, lab trends, the ' +
      'experiments that ran with the expectation recorded before each one, ' +
      'and what is worth raising. Thirty days or ninety and nothing between: ' +
      'an arbitrary window would let the period be chosen after the answer is ' +
      'seen. Everything is derived on the server, and every item raised for ' +
      'discussion comes from a structured signal rather than from a sentence ' +
      'somebody wrote at render time.',
  })
  clinicianPacket(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(clinicianPacketQuerySchema)) query: ClinicianPacketQuery,
  ) {
    return this.reports.clinicianPacket(user.id, query.days);
  }
}

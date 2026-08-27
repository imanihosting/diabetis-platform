import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  recordSafetyFlagSchema,
  updateDiabetesProfileSchema,
  type RecordSafetyFlagInput,
  type UpdateDiabetesProfileInput,
} from '@wellovue/types';
import { DiabetesProfileService } from './diabetes-profile.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('diabetes-profile')
@Controller('diabetes-profile')
export class DiabetesProfileController {
  constructor(private readonly profiles: DiabetesProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'The profile, the safety flags in force, and what they permit',
    description:
      'Care mode and safety tier are derived on the server from the recorded ' +
      'diagnosis and active flags. Neither is accepted from the client: they ' +
      'decide which analysis a person’s data is put through.',
  })
  context(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.context(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Update the recorded diagnosis' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateDiabetesProfileSchema))
    body: UpdateDiabetesProfileInput,
  ) {
    return this.profiles.update(user.id, body);
  }

  @Post('flags')
  @ApiOperation({
    summary: 'Record a safety flag',
    description:
      'Append-only. A flag is ended by recording that it ended, never by ' +
      'editing the row that raised it, so the platform can always say what it ' +
      'believed and when.',
  })
  recordFlag(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recordSafetyFlagSchema)) body: RecordSafetyFlagInput,
  ) {
    return this.profiles.recordFlag(user.id, body);
  }

  @Get('flags')
  @ApiOperation({ summary: 'Every safety flag ever recorded, newest first' })
  flagHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.flagHistory(user.id);
  }
}

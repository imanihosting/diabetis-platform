import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMedicationRecordSchema,
  type CreateMedicationRecordInput,
} from '@wellovue/types';
import { MedicationsService } from './medications.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('medications')
@Controller('medications')
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Post()
  @ApiOperation({ summary: 'Record a medication the user reports taking' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMedicationRecordSchema))
    body: CreateMedicationRecordInput,
  ) {
    return this.medications.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'List the user’s medication records' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.medications.list(user.id);
  }

  @Post(':id/taken')
  @HttpCode(204)
  @ApiOperation({ summary: 'Log that a dose was taken' })
  async taken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { takenAt?: string },
  ): Promise<void> {
    await this.medications.recordTaken(
      user.id,
      id,
      body?.takenAt ? new Date(body.takenAt) : new Date(),
    );
  }
}

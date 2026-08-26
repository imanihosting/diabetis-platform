import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createMealSchema, type CreateMealInput } from '@wellovue/types';
import { MealsService } from './meals.service';
import { StorageService } from '../storage/storage.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

@ApiTags('meals')
@Controller('meals')
export class MealsController {
  constructor(
    private readonly meals: MealsService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Log a meal with optional items' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMealSchema)) body: CreateMealInput,
  ) {
    return this.meals.create(user.id, body);
  }

  @Post('photo')
  @ApiOperation({
    summary: 'Upload a meal photo, returning the key to attach to a meal',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type: ${file.mimetype}. Allowed: ${ALLOWED_PHOTO_TYPES.join(', ')}`,
      );
    }

    const key = this.storage.buildKey(user.id, 'meal-photos', file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);
    return { objectKey: key };
  }

  @Get()
  @ApiOperation({ summary: 'List meals in a time range' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
    return this.meals.list(user.id, fromDate, toDate);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one meal, with a signed photo URL if present' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meals.findOne(user.id, id);
  }
}

import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  waitlistSignupSchema,
  type WaitlistSignupInput,
  type WaitlistSignupResult,
} from '@diabetes/types';
import { WaitlistService } from './waitlist.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Register interest from the landing page' })
  @UsePipes(new ZodValidationPipe(waitlistSignupSchema))
  signUp(@Body() body: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    return this.waitlist.signUp(body);
  }
}

import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottleScope, THROTTLE_WRITE } from '../common/guards/throttle.guard';
import {
  waitlistSignupSchema,
  type WaitlistSignupInput,
  type WaitlistSignupResult,
} from '@wellovue/types';
import { WaitlistService } from './waitlist.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Public()
  // Reaches a table a human reads. Five an hour per address is more than a
  // person needs and far less than a spam run wants.
  @ThrottleScope(THROTTLE_WRITE)
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Register interest from the landing page' })
  @UsePipes(new ZodValidationPipe(waitlistSignupSchema))
  signUp(@Body() body: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    return this.waitlist.signUp(body);
  }
}

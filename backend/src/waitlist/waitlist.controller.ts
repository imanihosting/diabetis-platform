import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottleScope, THROTTLE_WRITE } from '../common/guards/throttle.guard';
import {
  waitlistConfirmSchema,
  waitlistSignupSchema,
  type WaitlistConfirmInput,
  type WaitlistConfirmResult,
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
  // Deliberately the write limit, keyed on the caller's address, and not the
  // mail limit — even though this now sends an email.
  //
  // THROTTLE_MAIL folds the submitted email into the key, which is right for
  // password reset and verification resend, where rotating addresses gains an
  // attacker nothing because no mail is sent for an address with no account.
  // Here every address is deliverable, so per-address keying would hand one
  // machine a fresh budget for every address it invents. The caller's own
  // budget is the one that has to bind; MailService's per-recipient limit
  // covers the other direction, many callers aimed at one inbox.
  @ThrottleScope(THROTTLE_WRITE)
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Register interest from the landing page' })
  @UsePipes(new ZodValidationPipe(waitlistSignupSchema))
  signUp(@Body() body: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    return this.waitlist.signUp(body);
  }

  @Public()
  @ThrottleScope(THROTTLE_WRITE)
  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a waitlist address from a mailed link' })
  @UsePipes(new ZodValidationPipe(waitlistConfirmSchema))
  confirm(@Body() body: WaitlistConfirmInput): Promise<WaitlistConfirmResult> {
    // A refused token comes back 200 with `confirmed: false`. The page has
    // three things to say — confirmed, expired, not valid — and two of them
    // are expected outcomes rather than failures.
    return this.waitlist.confirm(body.token);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ThrottleScope,
  THROTTLE_AUTH,
  THROTTLE_MAIL,
  THROTTLE_REFRESH,
  THROTTLE_WRITE,
} from '../common/guards/throttle.guard';
import type { Request, Response } from 'express';
import {
  loginSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
  type AuthResponse,
  type LoginInput,
  type MailRequestResult,
  type PasswordResetCompleteInput,
  type PasswordResetCompleteResult,
  type PasswordResetRequestInput,
  type RegisterInput,
  type ResendVerificationInput,
  type VerifyEmailInput,
  type VerifyEmailResult,
} from '@wellovue/types';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { ENV, type Env } from '../config/env';

/**
 * What the browser receives: the user, a short-lived access token, and when it
 * expires. The refresh token is deliberately absent from the body — it travels
 * only in an HttpOnly cookie the page's JavaScript cannot read.
 */
type ClientAuthResponse = Omit<AuthResponse, 'tokens'> & {
  tokens: Omit<AuthResponse['tokens'], 'refreshToken'>;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** Moves the refresh token out of the payload and into the cookie. */
  private respond(response: Response, result: AuthResponse): ClientAuthResponse {
    setRefreshCookie(response, result.tokens.refreshToken, this.isProduction);
    const { refreshToken: _refreshToken, ...tokens } = result.tokens;
    return { user: result.user, tokens };
  }

  @Public()
  // Keyed on address plus the submitted email, so an attacker cannot work
  // around the limit by rotating either one alone.
  @ThrottleScope(THROTTLE_AUTH)
  @Post('register')
  @ApiOperation({ summary: 'Create a patient account' })
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientAuthResponse> {
    return this.respond(response, await this.auth.register(body));
  }

  @Public()
  @ThrottleScope(THROTTLE_AUTH)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientAuthResponse> {
    // The user agent, and only the user agent. It is what decides whether this
    // sign-in gets a "new device" notification; the address is deliberately not
    // passed, because the platform has not reviewed what turning an IP into a
    // location would mean for someone's record.
    return this.respond(
      response,
      await this.auth.login(body, request.get('user-agent')),
    );
  }

  @Public()
  // Looser than login: several tabs legitimately refresh at the same moment,
  // and possession of the rotating cookie is already the check that matters.
  @ThrottleScope(THROTTLE_REFRESH)
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate the refresh cookie for a new access token',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientAuthResponse> {
    const token = request.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('No refresh session');
    }

    try {
      return this.respond(response, await this.auth.refresh(token));
    } catch (err) {
      // The cookie is spent or invalid either way; clearing it stops the
      // browser retrying with a token that will never work again.
      clearRefreshCookie(response, this.isProduction);
      throw err;
    }
  }

  @Post('logout')
  // Signing out is not product use. An account that cannot get in still has to
  // be able to get out.
  @AllowUnverified()
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session and revoke its refresh token' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user.id, request.cookies?.[REFRESH_COOKIE_NAME]);
    clearRefreshCookie(response, this.isProduction);
  }

  @Public()
  // The token is the secret, so this is not guessable and does not need the
  // account-keyed limit. The write limit is here to stop somebody grinding
  // through the token space, which would take longer than the heat death of
  // the sun but costs us nothing to refuse.
  @ThrottleScope(THROTTLE_WRITE)
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Prove an email address using a mailed token' })
  @UsePipes(new ZodValidationPipe(verifyEmailSchema))
  async verifyEmail(@Body() body: VerifyEmailInput): Promise<VerifyEmailResult> {
    // A refused token comes back 200 with `verified: false` rather than as an
    // error. The page has three different things to say — verified, expired,
    // invalid — and an exception carrying a reason code is a worse way to say
    // one of three expected outcomes.
    return this.verification.verifyEmail(body.token);
  }

  @Public()
  @ThrottleScope(THROTTLE_MAIL)
  @Post('verify-email/resend')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send another verification link' })
  @UsePipes(new ZodValidationPipe(resendVerificationSchema))
  async resendVerification(
    @Body() body: ResendVerificationInput,
  ): Promise<MailRequestResult> {
    // Always `accepted`. Whether an account exists, and whether it is already
    // verified, are both invisible from out here — see VerificationService.
    return this.verification.resendVerification(body.email);
  }

  @Public()
  @ThrottleScope(THROTTLE_MAIL)
  @Post('password-reset')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask for a password reset link' })
  @UsePipes(new ZodValidationPipe(passwordResetRequestSchema))
  async requestPasswordReset(
    @Body() body: PasswordResetRequestInput,
  ): Promise<MailRequestResult> {
    return this.verification.requestPasswordReset(body.email);
  }

  @Public()
  // The auth limit, not the mail limit: this one takes a password, so it is
  // the same surface as sign-in and deserves the same treatment.
  @ThrottleScope(THROTTLE_AUTH)
  @Post('password-reset/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password using a mailed token' })
  @UsePipes(new ZodValidationPipe(passwordResetCompleteSchema))
  async completePasswordReset(
    @Body() body: PasswordResetCompleteInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PasswordResetCompleteResult> {
    const result = await this.verification.completePasswordReset(
      body.token,
      body.password,
    );

    // Every session was revoked server-side. Clearing the cookie here stops
    // this browser retrying with a refresh token that will never work again,
    // and stops the readable session hint claiming a session that is gone.
    if (result.reset) clearRefreshCookie(response, this.isProduction);

    return result;
  }
}

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
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@diabetes/types';
import { AuthService } from './auth.service';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
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
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientAuthResponse> {
    return this.respond(response, await this.auth.login(body));
  }

  @Public()
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
}

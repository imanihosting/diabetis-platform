import { Body, Controller, HttpCode, Post, Req, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  contactMessageSchema,
  type ContactMessageInput,
  type ContactMessageResult,
} from '@wellovue/types';
import { SupportService } from './support.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('support')
@Controller('contact')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a message from the contact page' })
  @UsePipes(new ZodValidationPipe(contactMessageSchema))
  async submit(
    @Body() body: ContactMessageInput,
    @Req() request: Request,
  ): Promise<ContactMessageResult> {
    // Public so a stranger can write in, but a signed-in sender is recognised
    // when they happen to carry a token, which lets a reply find their account.
    return this.support.submit(body, this.optionalUserId(request));
  }

  private optionalUserId(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;

    try {
      const payload = this.jwt.verify<{ sub: string }>(header.slice('Bearer '.length));
      return payload.sub ?? null;
    } catch {
      // An expired token on a public route is not an error; it just means the
      // message arrives unattributed.
      return null;
    }
  }
}

import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Safety net that turns an escaped Zod validation error into a 400.
 *
 * Validation normally runs through ZodValidationPipe, which raises a proper
 * BadRequestException. This exists so that a schema parsed inline somewhere —
 * now or later — still reports a caller's bad input as their error rather than
 * a 500 with a stack trace.
 *
 * Detection is structural, not `instanceof`. The backend and the shared
 * contract package can resolve different module instances of zod (one ESM, one
 * CJS), and across that boundary `err instanceof ZodError` is false even
 * though the error is a genuine ZodError — which is exactly how this filter
 * failed to fire the first time. Shape is the reliable signal.
 */
interface ZodLikeIssue {
  path: (string | number)[];
  message: string;
}

function asZodError(exception: unknown): ZodLikeIssue[] | null {
  if (typeof exception !== 'object' || exception === null) return null;

  const candidate = exception as { name?: unknown; issues?: unknown };
  if (candidate.name !== 'ZodError' || !Array.isArray(candidate.issues)) {
    return null;
  }

  const issues = candidate.issues as unknown[];
  const valid = issues.every(
    (issue) =>
      typeof issue === 'object' &&
      issue !== null &&
      Array.isArray((issue as ZodLikeIssue).path) &&
      typeof (issue as ZodLikeIssue).message === 'string',
  );

  return valid ? (issues as ZodLikeIssue[]) : null;
}

@Catch()
export class ZodExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const issues = asZodError(exception);

    // Anything that is not a Zod error — including every HttpException — is
    // handed back to Nest's own handling untouched.
    if (!issues || exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.BAD_REQUEST)
      .json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
  }
}

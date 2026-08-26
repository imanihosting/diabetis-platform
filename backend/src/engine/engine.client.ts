import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  patternResponseSchema,
  type PatternRequest,
  type PatternResponse,
} from '@wellovue/types';
import { ENV, type Env } from '../config/env';

/**
 * Client for the Python metabolic intelligence service.
 *
 * The boundary is deliberate: NestJS owns application state and workflows,
 * the engine owns scientific computation. Responses are validated against the
 * shared contract, so a drifting engine fails here rather than surfacing a
 * malformed finding to a patient.
 */
@Injectable()
export class EngineClient {
  private readonly logger = new Logger(EngineClient.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetch('/health/live', { method: 'GET' }, 3000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async detectPatterns(request: PatternRequest): Promise<PatternResponse> {
    const res = await this.fetch('/patterns/detect', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Metabolic engine returned ${res.status}: ${detail.slice(0, 200)}`,
      );
    }

    const parsed = patternResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      this.logger.error(
        `Engine response failed contract validation: ${parsed.error.message}`,
      );
      throw new ServiceUnavailableException(
        'Metabolic engine returned a response that does not match the agreed contract',
      );
    }
    return parsed.data;
  }

  private async fetch(
    path: string,
    init: RequestInit,
    timeoutMs = 30_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.env.METABOLIC_ENGINE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init.headers,
          ...(this.env.METABOLIC_ENGINE_TOKEN
            ? { authorization: `Bearer ${this.env.METABOLIC_ENGINE_TOKEN}` }
            : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

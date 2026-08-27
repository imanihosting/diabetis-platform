import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { orderFindings, type EvidenceQuery, type PatternResponse } from '@wellovue/types';
import { EngineClient } from '../engine/engine.client';

/**
 * The bridge between the Evidence surface and the metabolic engine.
 *
 * It owns two things the engine deliberately does not: whose data may be
 * analysed, and what a failure looks like to a patient. The engine itself is
 * a computation service — it answers about whatever user id it is given, and
 * it reports failures in its own terms.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(private readonly engine: EngineClient) {}

  async findings(userId: string, range: EvidenceQuery): Promise<PatternResponse> {
    let response: PatternResponse;

    try {
      // `userId` comes from the verified access token, never from the request.
      // This is the only place the engine learns whose data to read, so the
      // authorisation decision is made once, here.
      response = await this.engine.detectPatterns({
        userId,
        from: range.from,
        to: range.to,
      });
    } catch (err) {
      // The engine's own message names its status code and echoes its body,
      // which is operator detail rather than something to put in front of a
      // patient. It is logged in full and replaced with what the reader can
      // actually act on.
      this.logger.error(
        `Pattern detection failed for the window ${range.from.toISOString()}` +
          `..${range.to.toISOString()}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'The pattern engine could not be reached, so no findings can be produced ' +
          'right now. Nothing you have logged has been affected.',
      );
    }

    // The engine emits findings in detector order. Ordering by strength is a
    // presentation decision, and it is made once here so every surface that
    // reads this endpoint shows the same record in the same order.
    return { ...response, findings: orderFindings(response.findings) };
  }
}

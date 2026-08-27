import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  orderFindings,
  type EvidenceQuery,
  type PatternResponse,
  type StructuredFinding,
} from '@wellovue/types';
import { EngineClient } from '../engine/engine.client';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';

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

  constructor(
    private readonly engine: EngineClient,
    private readonly profiles: DiabetesProfileService,
  ) {}

  async findings(userId: string, range: EvidenceQuery): Promise<PatternResponse> {
    // The care mode decides whether the pattern engine runs at all, and it is
    // read from the server's own record rather than taken from the request.
    // Every detector in the engine today models Type 2 physiology; running
    // them over a Type 1 or gestational record would produce confident
    // findings from the wrong model of the body, and the person reading them
    // would have no way to tell. Falling back to Type 2 logic is the specific
    // failure this gate exists to prevent.
    const { capabilities } = await this.profiles.context(userId);

    if (!capabilities.evidenceEnabled) {
      return this.unsupported(userId, capabilities.careMode, capabilities.unsupportedReason);
    }

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

  /**
   * The answer for a care mode the platform cannot yet interpret.
   *
   * Deliberately shaped like every other finding: a summary, a limitation, and
   * what would change it. "We do not analyse this yet" is a real answer and
   * belongs in the same frame as the others, not behind an error state. A 404
   * or an empty list would let the screen imply the question was never asked.
   */
  private unsupported(
    userId: string,
    careMode: string,
    reason: string | null,
  ): PatternResponse {
    const finding: StructuredFinding = {
      findingType: 'care_mode_unsupported',
      summary:
        reason ??
        'Wellovue does not yet produce findings for this care mode.',
      effectEstimate: null,
      effectUnit: null,
      confidence: 0,
      sampleCount: 0,
      limitations: [
        `No detector has been reviewed for the care mode "${careMode}"`,
        'Your data is still being recorded and nothing has been lost',
      ],
      clinicianReviewRecommended: false,
      wouldImproveWith: [
        'Confirm what kind of diabetes you have in your profile',
        'Ask your clinician whether Wellovue is a useful record to bring to an appointment',
      ],
    };

    return {
      userId,
      generatedAt: new Date(),
      modelVersion: 'care-mode-gate',
      findings: [finding],
    };
  }
}

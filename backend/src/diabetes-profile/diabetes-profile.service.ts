import { Injectable } from '@nestjs/common';
import {
  careModeCapabilities,
  deriveCareMode,
  deriveSafetyTier,
  type CareMode,
  type CareModeCapabilities,
  type DiabetesProfile,
  type DiabetesSafetyFlag,
  type RecordSafetyFlagInput,
  type SafetyFlag,
  type UpdateDiabetesProfileInput,
} from '@wellovue/types';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface DiabetesContext {
  profile: DiabetesProfile;
  activeFlags: SafetyFlag[];
  capabilities: CareModeCapabilities;
}

/**
 * The diabetes profile: what kind of diabetes someone has, and what the
 * platform is therefore willing to say about their data.
 *
 * Two things here are deliberate and load-bearing.
 *
 * **Care mode is derived, never accepted.** Nothing a browser sends decides
 * which analysis runs. `deriveCareMode` computes it from the recorded
 * diagnosis and the flags currently active, so a request cannot ask for a
 * Type 1 record to be interpreted by detectors written for Type 2 physiology.
 *
 * **Flags are history, not state.** The table is append-only and a flag is
 * resolved by recording that it ended, so the platform can always answer what
 * it believed and when. "Currently active" is the latest row per flag.
 */
@Injectable()
export class DiabetesProfileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates the profile that accompanies a new account.
   *
   * Takes the caller's transaction client so the profile and the account it
   * belongs to commit together. A user who exists without a profile would be
   * `unknown`, which is the state that switches the evidence screen off, and
   * arriving in it by way of a half-failed registration is not a safety
   * decision anybody made.
   *
   * Recorded as Type 2 with the source `assumed`. That is what the product
   * currently offers and says on its landing page, so it is the honest default
   * — and marking it as an assumption keeps it distinguishable from an answer
   * once onboarding exists to ask the question.
   */
  async createForNewUser(userId: string, client: PoolClient): Promise<void> {
    await client.query(
      `insert into clinical.diabetes_profiles
         (user_id, diabetes_type, care_mode, diagnosis_source)
       values ($1, 'type_2', 'type_2_standard', 'assumed')
       on conflict (user_id) do nothing`,
      [userId],
    );
  }

  /**
   * The profile, the flags in force, and what follows from them.
   *
   * One round trip's worth of reads rather than three endpoints, because every
   * caller that wants the care mode also wants to know what it permits, and
   * splitting them invites a caller to act on one without the other.
   */
  async context(userId: string): Promise<DiabetesContext> {
    const [profileRow, activeFlags] = await Promise.all([
      this.db.queryOne<ProfileRow>(
        `select user_id, diabetes_type, care_mode, diagnosed_on, diagnosis_source,
                clinician_supported, created_at, updated_at
           from clinical.diabetes_profiles
          where user_id = $1`,
        [userId],
      ),
      this.activeFlags(userId),
    ]);

    // No row means no profile, which is not the same as a profile that says
    // "unknown" — but it has to behave identically, because the platform knows
    // exactly as little in both cases.
    const profile: DiabetesProfile = profileRow
      ? toProfile(profileRow)
      : unknownProfile(userId);

    return {
      profile,
      activeFlags,
      capabilities: careModeCapabilities(profile.careMode, activeFlags),
    };
  }

  async update(
    userId: string,
    input: UpdateDiabetesProfileInput,
  ): Promise<DiabetesContext> {
    const activeFlags = await this.activeFlags(userId);
    // Recomputed from the incoming diagnosis rather than carried over: a person
    // correcting Type 2 to Type 1 must not keep the Type 2 analysis.
    const careMode = deriveCareMode(input.diabetesType, activeFlags);

    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ care_mode: CareMode }>(
        `insert into clinical.diabetes_profiles
           (user_id, diabetes_type, care_mode, diagnosed_on, diagnosis_source, clinician_supported)
         values ($1, $2, $3, $4, 'self_reported', coalesce($5, false))
         on conflict (user_id) do update
            set diabetes_type       = excluded.diabetes_type,
                care_mode           = excluded.care_mode,
                diagnosed_on        = excluded.diagnosed_on,
                diagnosis_source    = excluded.diagnosis_source,
                clinician_supported = excluded.clinician_supported
         returning care_mode`,
        [
          userId,
          input.diabetesType,
          careMode,
          input.diagnosedOn ?? null,
          input.clinicianSupported ?? null,
        ],
      );

      // A profile change decides which analysis a person's health data is put
      // through. That is a health-data change, not an account preference, so it
      // is audited in the same transaction as the write it describes.
      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'diabetes_profile.update',
          resourceType: 'diabetes_profile',
          resourceId: null,
          metadata: {
            diabetesType: input.diabetesType,
            careMode: rows[0].care_mode,
            safetyTier: deriveSafetyTier(careMode, activeFlags),
          },
        },
        client,
      );
    });

    return this.context(userId);
  }

  /**
   * Records what is true now. Never edits what was true before.
   *
   * The table refuses UPDATE and DELETE, so ending a flag means inserting a row
   * that says it ended. Re-deriving the care mode afterwards is the point of
   * flags existing: recording insulin therapy has to move a Type 2 user into
   * the mode with the tighter safety boundaries, and it would be useless if it
   * only changed a display.
   */
  async recordFlag(
    userId: string,
    input: RecordSafetyFlagInput,
  ): Promise<DiabetesContext> {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into clinical.diabetes_safety_flags
           (user_id, flag, status, source, metadata)
         values ($1, $2, $3, 'self_reported', $4)
         returning id`,
        [userId, input.flag, input.status, JSON.stringify(input.metadata ?? {})],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'diabetes_profile.flag',
          resourceType: 'diabetes_safety_flag',
          resourceId: rows[0].id,
          metadata: { flag: input.flag, status: input.status },
        },
        client,
      );

      const profile = await client.query<{ diabetes_type: string }>(
        'select diabetes_type from clinical.diabetes_profiles where user_id = $1',
        [userId],
      );
      if (profile.rows.length === 0) return;

      const flags = await activeFlagsWith(client, userId);
      await client.query(
        'update clinical.diabetes_profiles set care_mode = $2 where user_id = $1',
        [
          userId,
          deriveCareMode(
            profile.rows[0].diabetes_type as Parameters<typeof deriveCareMode>[0],
            flags,
          ),
        ],
      );
    });

    return this.context(userId);
  }

  /** Every flag ever recorded, newest first. The trail, not the summary. */
  async flagHistory(userId: string): Promise<DiabetesSafetyFlag[]> {
    const rows = await this.db.query<FlagRow>(
      `select id, user_id, flag, status, source, recorded_at, metadata
         from clinical.diabetes_safety_flags
        where user_id = $1
        order by recorded_at desc`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      flag: r.flag,
      status: r.status,
      source: r.source,
      recordedAt: r.recorded_at,
      metadata: r.metadata,
    }));
  }

  private async activeFlags(userId: string): Promise<SafetyFlag[]> {
    const rows = await this.db.query<{ flag: SafetyFlag }>(
      LATEST_ACTIVE_FLAGS_SQL,
      [userId],
    );
    return rows.map((r) => r.flag);
  }
}

/**
 * The flags currently in force.
 *
 * `distinct on` takes the newest row per flag and keeps it only if that row
 * says the flag is active. Filtering on `status = 'active'` without the
 * ordering would resurrect a flag that had since been resolved, because the row
 * that raised it is still there — which is the cost of an append-only table and
 * the reason this query is written once and shared.
 */
const LATEST_ACTIVE_FLAGS_SQL = `
  select flag from (
    select distinct on (flag) flag, status
      from clinical.diabetes_safety_flags
     where user_id = $1
     order by flag, recorded_at desc
  ) latest
  where status = 'active'
`;

async function activeFlagsWith(client: PoolClient, userId: string): Promise<SafetyFlag[]> {
  const { rows } = await client.query<{ flag: SafetyFlag }>(LATEST_ACTIVE_FLAGS_SQL, [
    userId,
  ]);
  return rows.map((r) => r.flag);
}

interface ProfileRow {
  user_id: string;
  diabetes_type: DiabetesProfile['diabetesType'];
  care_mode: CareMode;
  diagnosed_on: Date | null;
  diagnosis_source: DiabetesProfile['diagnosisSource'];
  clinician_supported: boolean;
  created_at: Date;
  updated_at: Date;
}

interface FlagRow {
  id: string;
  user_id: string;
  flag: SafetyFlag;
  status: DiabetesSafetyFlag['status'];
  source: DiabetesSafetyFlag['source'];
  recorded_at: Date;
  metadata: Record<string, unknown>;
}

function toProfile(row: ProfileRow): DiabetesProfile {
  return {
    userId: row.user_id,
    diabetesType: row.diabetes_type,
    careMode: row.care_mode,
    diagnosedOn: row.diagnosed_on,
    diagnosisSource: row.diagnosis_source,
    clinicianSupported: row.clinician_supported,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function unknownProfile(userId: string): DiabetesProfile {
  const now = new Date();
  return {
    userId,
    diabetesType: 'unknown',
    careMode: 'unknown',
    diagnosedOn: null,
    diagnosisSource: 'assumed',
    clinicianSupported: false,
    createdAt: now,
    updatedAt: now,
  };
}

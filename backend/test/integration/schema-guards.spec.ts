import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureError, connect, createUser } from './helpers';

/**
 * The platform's safety rules are enforced by the database, not just by
 * application code. These tests attempt to violate each one directly over SQL —
 * bypassing the API entirely — and assert that PostgreSQL refuses.
 */
describe('database safety guarantees', () => {
  let db: Client;
  let userId: string;

  beforeAll(async () => {
    db = await connect();
    userId = await createUser(db, 'guard');
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('extensions and hypertables', () => {
    it('has the same extensions as production', async () => {
      const { rows } = await db.query<{ extname: string }>(
        `select extname from pg_extension
          where extname in ('timescaledb', 'vector', 'pgcrypto')`,
      );
      expect(rows.map((r) => r.extname).sort()).toEqual([
        'pgcrypto',
        'timescaledb',
        'vector',
      ]);
    });

    it('stores dense measurements in hypertables', async () => {
      const { rows } = await db.query<{ name: string }>(
        `select hypertable_schema || '.' || hypertable_name as name
           from timescaledb_information.hypertables`,
      );
      expect(rows.map((r) => r.name).sort()).toEqual([
        'metabolic.activity_samples',
        'metabolic.glucose_samples',
      ]);
    });

    it('indexes semantic observations for vector search', async () => {
      const { rows } = await db.query(
        `select indexname from pg_indexes
          where indexname = 'observations_embedding_idx'`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('predictions are immutable', () => {
    async function makePrediction(): Promise<string> {
      const model = await db.query<{ id: string }>(
        `insert into ai.model_versions (model_name, version)
         values ('test-model', $1) returning id`,
        [`v${Date.now()}-${Math.random()}`],
      );
      const prediction = await db.query<{ id: string }>(
        `insert into ai.predictions
           (user_id, model_version_id, prediction_type, input_snapshot, prediction, confidence)
         values ($1, $2, 'meal_peak', '{"carbs":60}', '{"peak":10.4}', 0.7)
         returning id`,
        [userId, model.rows[0].id],
      );
      return prediction.rows[0].id;
    }

    it('allows the status to advance as an outcome arrives', async () => {
      const id = await makePrediction();
      const error = await captureError(() =>
        db.query('update ai.predictions set status = $1 where id = $2', ['matched', id]),
      );
      expect(error).toBeNull();
    });

    it('refuses to alter the prediction itself', async () => {
      const id = await makePrediction();
      const error = await captureError(() =>
        db.query('update ai.predictions set prediction = $1 where id = $2', [
          '{"peak":5.0}',
          id,
        ]),
      );
      expect(error?.message).toMatch(/immutable/);
    });

    it('refuses to alter the input snapshot a prediction was made from', async () => {
      const id = await makePrediction();
      const error = await captureError(() =>
        db.query('update ai.predictions set input_snapshot = $1 where id = $2', [
          '{"carbs":10}',
          id,
        ]),
      );
      expect(error?.message).toMatch(/immutable/);
    });

    it('refuses deletion', async () => {
      const id = await makePrediction();
      const error = await captureError(() =>
        db.query('delete from ai.predictions where id = $1', [id]),
      );
      expect(error?.message).toMatch(/immutable/);
    });
  });

  describe('the audit trail is append-only', () => {
    async function makeAuditEntry(action: string): Promise<void> {
      await db.query(
        `insert into audit.events (actor_user_id, subject_user_id, action, resource_type)
         values ($1, $1, $2, 'test')`,
        [userId, action],
      );
    }

    it('refuses to rewrite what happened', async () => {
      const action = `test.write.${Date.now()}`;
      await makeAuditEntry(action);
      const error = await captureError(() =>
        db.query('update audit.events set action = $1 where action = $2', [
          'tampered',
          action,
        ]),
      );
      expect(error?.message).toMatch(/append-only/);
    });

    it('refuses deletion', async () => {
      const action = `test.delete.${Date.now()}`;
      await makeAuditEntry(action);
      const error = await captureError(() =>
        db.query('delete from audit.events where action = $1', [action]),
      );
      expect(error?.message).toMatch(/append-only/);
    });

    it('refuses to reassign an entry to a different person', async () => {
      const action = `test.reassign.${Date.now()}`;
      await makeAuditEntry(action);
      const other = await createUser(db, 'other');
      const error = await captureError(() =>
        db.query('update audit.events set subject_user_id = $1 where action = $2', [
          other,
          action,
        ]),
      );
      expect(error?.message).toMatch(/only be cleared/);
    });

    it('lets a person be erased while the record of events survives', async () => {
      // The two requirements have to hold together: the trail is never
      // rewritten, but a person can still be unlinked from it.
      const erasable = await createUser(db, 'erasable');
      const action = `test.erasure.${Date.now()}`;
      await db.query(
        `insert into audit.events (actor_user_id, subject_user_id, action, resource_type)
         values ($1, $1, $2, 'test')`,
        [erasable, action],
      );

      await db.query('delete from identity.users where id = $1', [erasable]);

      const { rows } = await db.query<{ actor_user_id: string | null }>(
        'select actor_user_id from audit.events where action = $1',
        [action],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_user_id).toBeNull();
    });
  });

  describe('experiment safety gating', () => {
    async function insertExperiment(
      safety: string,
      reviewRequired: boolean,
      status: string,
    ) {
      return db.query(
        `insert into experiments.experiments
           (user_id, title, question, protocol, safety_status,
            clinician_review_required, status)
         values ($1, 'T', 'Q', '{}', $2, $3, $4)`,
        [userId, safety, reviewRequired, status],
      );
    }

    it('refuses a clinician-gated experiment that skips review', async () => {
      const error = await captureError(() =>
        insertExperiment('clinician_gated', false, 'active'),
      );
      expect(error?.message).toMatch(/experiments_gate_chk/);
    });

    it('refuses to activate a blocked experiment', async () => {
      const error = await captureError(() => insertExperiment('blocked', true, 'active'));
      expect(error?.message).toMatch(/experiments_blocked_chk/);
    });

    it('allows a safe experiment to run', async () => {
      const error = await captureError(() => insertExperiment('allowed', false, 'active'));
      expect(error).toBeNull();
    });
  });

  describe('measurement integrity', () => {
    it('rejects a physiologically impossible glucose value', async () => {
      const error = await captureError(() =>
        db.query(
          `insert into metabolic.glucose_samples
             (user_id, measured_at, glucose_value, unit, source)
           values ($1, now(), 250, 'mmol/L', 'manual')`,
          [userId],
        ),
      );
      expect(error?.message).toMatch(/glucose_value_chk/);
    });

    it('rejects an unrecognised glucose unit', async () => {
      const error = await captureError(() =>
        db.query(
          `insert into metabolic.glucose_samples
             (user_id, measured_at, glucose_value, unit, source)
           values ($1, now(), 7.2, 'mmol', 'manual')`,
          [userId],
        ),
      );
      expect(error?.message).toMatch(/glucose_unit_chk/);
    });

    it('rejects a confidence outside 0-1', async () => {
      const error = await captureError(() =>
        db.query(
          `insert into metabolic.events
             (user_id, occurred_at, event_type, source, confidence)
           values ($1, now(), 'meal_started', 'inferred', 1.5)`,
          [userId],
        ),
      );
      expect(error?.message).toMatch(/events_confidence_chk/);
    });

    it('keeps re-imported readings from silently overwriting history', async () => {
      const at = new Date();
      await db.query(
        `insert into metabolic.glucose_samples
           (user_id, measured_at, glucose_value, unit, source)
         values ($1, $2, 7.2, 'mmol/L', 'csv_import')`,
        [userId, at],
      );
      const second = await db.query(
        `insert into metabolic.glucose_samples
           (user_id, measured_at, glucose_value, unit, source)
         values ($1, $2, 9.9, 'mmol/L', 'csv_import')
         on conflict (user_id, measured_at, source) do nothing`,
        [userId, at],
      );

      expect(second.rowCount).toBe(0);

      const { rows } = await db.query<{ glucose_value: string }>(
        `select glucose_value from metabolic.glucose_samples
          where user_id = $1 and measured_at = $2 and source = 'csv_import'`,
        [userId, at],
      );
      expect(Number(rows[0].glucose_value)).toBe(7.2);
    });
  });
});

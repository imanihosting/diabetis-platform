import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { testClientConfig } from './helpers';

/**
 * The engine's own refusal, tested by going around the backend entirely.
 *
 * Everything else in this suite reaches the engine through NestJS, which has
 * its own gate and never asks for an analysis it should not request. That
 * proves the backend behaves; it proves nothing about the engine, because the
 * request the engine refuses is one the backend never sends.
 *
 * So these call the engine directly over HTTP, the way a future service, a
 * background job, or a mistake would. If the only enforcement point is NestJS,
 * every one of these returns Type 2 findings and the two-layer design is a
 * description of an intention rather than of the system.
 */
describe('engine care-mode gate (direct, bypassing the API)', () => {
  const engineUrl = process.env.METABOLIC_ENGINE_URL ?? 'http://localhost:58000';
  const token = process.env.METABOLIC_ENGINE_TOKEN;

  let pool: Client;
  let userId: string;

  const from = new Date('2026-04-01T00:00:00.000Z');
  const to = new Date('2026-04-21T00:00:00.000Z');

  interface Finding {
    findingType: string;
    effectEstimate: number | null;
    sampleCount: number;
    limitations: string[];
  }

  async function detect(body: Record<string, unknown>) {
    const res = await fetch(`${engineUrl}/patterns/detect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userId,
        from: from.toISOString(),
        to: to.toISOString(),
        ...body,
      }),
    });
    return { status: res.status, body: (await res.json()) as { findings: Finding[] } };
  }

  const typeTwoFindings = (findings: Finding[]) =>
    findings.filter((f) => f.findingType !== 'care_mode_unsupported');

  beforeAll(async () => {
    pool = new Client(testClientConfig());
    await pool.connect();

    const { rows } = await pool.query<{ id: string }>(
      'insert into identity.users (email) values ($1) returning id',
      [`engine-gate-${Date.now()}@test.local`],
    );
    userId = rows[0].id;

    // Twenty mornings of real readings, so a Type 2 analysis genuinely has
    // something to find. Without data every mode would return "insufficient
    // data" and the tests would pass for the wrong reason.
    for (let day = 0; day < 20; day += 1) {
      const at = new Date(from.getTime() + day * 24 * 60 * 60 * 1000);
      at.setUTCHours(7, 0, 0, 0);
      await pool.query(
        `insert into metabolic.glucose_samples
           (user_id, measured_at, glucose_value, unit, source)
         values ($1, $2, $3, 'mmol/L', 'cgm_device')
         on conflict do nothing`,
        [userId, at.toISOString(), 6 + (day % 3) * 0.4],
      );
    }
  });

  afterAll(async () => {
    await pool?.query('delete from identity.users where id = $1', [userId]);
    await pool?.end();
  });

  it('analyses a Type 2 record, so the refusals below mean something', async () => {
    const { status, body } = await detect({ careMode: 'type_2_standard' });
    expect(status).toBe(200);

    const real = typeTwoFindings(body.findings);
    expect(real.length).toBeGreaterThan(0);
    expect(real.some((f) => f.findingType === 'morning_glucose_pattern')).toBe(true);
  });

  it('refuses Type 1 even though the caller asked directly', async () => {
    const { status, body } = await detect({ careMode: 'type_1_cgm_insulin' });
    expect(status).toBe(200);

    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].findingType).toBe('care_mode_unsupported');
    expect(typeTwoFindings(body.findings)).toHaveLength(0);
  });

  it('refuses an unknown care mode', async () => {
    const { body } = await detect({ careMode: 'unknown' });
    expect(typeTwoFindings(body.findings)).toHaveLength(0);
  });

  it('refuses when the care mode is omitted entirely', async () => {
    // The dangerous omission. A caller that forgets the field must not get the
    // Type 2 analysis by default, because that is exactly the caller most
    // likely to be pointing at a record it has not thought about.
    const { body } = await detect({});
    expect(typeTwoFindings(body.findings)).toHaveLength(0);
    expect(body.findings[0].findingType).toBe('care_mode_unsupported');
  });

  it('refuses a care mode it has never heard of', async () => {
    const { body } = await detect({ careMode: 'type_2_standard_v2' });
    expect(typeTwoFindings(body.findings)).toHaveLength(0);
  });

  it('refuses a supported care mode when a blocked flag is in force', async () => {
    // Type 2 is supported and pregnancy blocks every detector anyway. The
    // upstream derivation would turn this into `gestational` before it ever
    // reached the engine — which is the point: the engine does not rely on
    // that having happened.
    const { body } = await detect({
      careMode: 'type_2_standard',
      activeFlags: ['pregnancy'],
    });
    expect(typeTwoFindings(body.findings)).toHaveLength(0);
  });

  it('states why it refused rather than returning an empty list', async () => {
    const { body } = await detect({ careMode: 'type_1_cgm_insulin' });
    const [refusal] = body.findings;
    expect(refusal.effectEstimate).toBeNull();
    expect(refusal.sampleCount).toBe(0);
    expect(refusal.limitations.length).toBeGreaterThan(0);
  });
});

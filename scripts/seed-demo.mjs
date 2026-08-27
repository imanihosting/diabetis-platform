#!/usr/bin/env node
/**
 * Seeds a demo patient with ~60 days of plausible Type 2 diabetes data:
 * CGM-style glucose, meals with macros, post-meal walks on some days,
 * medication records, and labs.
 *
 * The data is generated with a deliberate, known structure — walking after a
 * meal genuinely blunts the modelled rise — so the pattern engine can be
 * checked against a ground truth we control.
 *
 *   node --env-file=.env scripts/seed-demo.mjs
 *
 * Safe to re-run: it removes and recreates the demo user.
 */
import pg from 'pg';
import * as argon2 from 'argon2';

const DEMO_EMAIL = 'demo.patient@wellovue.local';
/** Known password so the seeded account can actually be signed into locally. */
const DEMO_PASSWORD = 'demo-patient-password';
const DAYS = 60;
const CGM_INTERVAL_MINUTES = 15;

// Ground truth the seeded data encodes, for checking engine output against.
//
// The walk effect is clean: walks are assigned at random, so the engine should
// recover roughly -1.3 mmol/L.
//
// The late-meal penalty is deliberately confounded: the only meal template
// after 20:00 is also the highest-carbohydrate one, so the *observed* late-meal
// difference is much larger than this constant. That is intentional — it gives
// the pattern engine a case where the honest answer is "these groups differ in
// composition as well as timing", and lets us check that the limitation is
// actually reported rather than glossed over.
const TRUE_WALK_EFFECT_MMOL = -1.3;
const TRUE_LATE_MEAL_PENALTY_MMOL = 0.9;

/** Deterministic PRNG so repeated seeds produce identical data. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(20260826);

function gaussian(mean, stdDev) {
  const u = Math.max(random(), 1e-9);
  const v = Math.max(random(), 1e-9);
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const MEAL_TEMPLATES = [
  { type: 'breakfast', hour: 7,  desc: 'Porridge with berries', carbs: 45, protein: 8,  fat: 6,  fiber: 6 },
  { type: 'breakfast', hour: 8,  desc: 'Eggs on toast',         carbs: 28, protein: 18, fat: 14, fiber: 3 },
  { type: 'lunch',     hour: 13, desc: 'Chicken salad wrap',    carbs: 38, protein: 30, fat: 12, fiber: 5 },
  { type: 'lunch',     hour: 12, desc: 'Rice and vegetables',   carbs: 62, protein: 10, fat: 8,  fiber: 7 },
  { type: 'dinner',    hour: 18, desc: 'Salmon and potatoes',   carbs: 40, protein: 34, fat: 18, fiber: 4 },
  { type: 'dinner',    hour: 21, desc: 'Pasta with sauce',      carbs: 75, protein: 16, fat: 14, fiber: 5 },
];

function clientConfig() {
  const url = new URL(process.env.DATABASE_URL);
  const sslmode = url.searchParams.get('sslmode') ?? 'prefer';
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl:
      sslmode === 'disable'
        ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  };
}

async function main() {
  const client = new pg.Client(clientConfig());
  await client.connect();

  console.log(`Seeding ${DAYS} days of demo data for ${DEMO_EMAIL} ...`);

  // Deleting the user clears the audit rows' actor/subject references via the
  // foreign key's `on delete set null`. The append-only guard permits exactly
  // that (see migration 0010), so the trail of what happened survives while the
  // identity link does not.
  await client.query('delete from identity.users where email = $1', [DEMO_EMAIL]);

  const { rows: userRows } = await client.query(
    `insert into identity.users (email, display_name, primary_role)
     values ($1, 'Demo Patient', 'patient') returning id`,
    [DEMO_EMAIL],
  );
  const userId = userRows[0].id;

  await client.query(
    'insert into identity.credentials (user_id, password_hash) values ($1, $2)',
    [userId, await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id })],
  );

  // Without a profile the demo user reads as care mode `unknown`, which
  // switches the evidence screen off — and the whole point of this seed is an
  // evidence screen with a known answer on it.
  await client.query(
    `insert into clinical.diabetes_profiles
       (user_id, diabetes_type, care_mode, diagnosis_source)
     values ($1, 'type_2', 'type_2_standard', 'self_reported')
     on conflict (user_id) do nothing`,
    [userId],
  );

  const now = new Date();
  const start = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

  // --- Meals, walks, and the glucose curve they produce ---------------------
  const meals = [];
  for (let day = 0; day < DAYS; day += 1) {
    const dayStart = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    // Two or three meals a day, drawn from the templates.
    const count = 2 + (random() < 0.6 ? 1 : 0);
    const chosen = [...MEAL_TEMPLATES].sort(() => random() - 0.5).slice(0, count);

    for (const template of chosen) {
      const at = new Date(dayStart);
      at.setUTCHours(template.hour, Math.floor(random() * 50), 0, 0);
      // Walks happen after roughly half of meals.
      const walked = random() < 0.5;
      meals.push({ ...template, at, walked });
    }
  }

  for (const meal of meals) {
    const { rows } = await client.query(
      `insert into nutrition.meals
         (user_id, started_at, ended_at, meal_type, description, source, confidence)
       values ($1, $2, $3, $4, $5, 'manual', 1.0) returning id`,
      [
        userId,
        meal.at,
        new Date(meal.at.getTime() + 25 * 60 * 1000),
        meal.type,
        meal.desc,
      ],
    );
    const mealId = rows[0].id;

    await client.query(
      `insert into nutrition.meal_items
         (meal_id, item_name, estimated_carbs_g, estimated_protein_g,
          estimated_fat_g, estimated_fiber_g, portion_text, confidence)
       values ($1, $2, $3, $4, $5, $6, 'standard portion', 0.6)`,
      [mealId, meal.desc, meal.carbs, meal.protein, meal.fat, meal.fiber],
    );

    await client.query(
      `insert into metabolic.events
         (user_id, occurred_at, event_type, source, confidence, payload)
       values ($1, $2, 'meal_started', 'manual', 1.0, $3)`,
      [userId, meal.at, JSON.stringify({ mealId, mealType: meal.type, description: meal.desc })],
    );

    if (meal.walked) {
      const walkAt = new Date(meal.at.getTime() + (20 + random() * 25) * 60 * 1000);
      await client.query(
        `insert into metabolic.events
           (user_id, occurred_at, event_type, source, confidence, payload)
         values ($1, $2, 'exercise_started', 'manual', 1.0, $3)`,
        [userId, walkAt, JSON.stringify({ kind: 'walk', minutes: 12 + Math.floor(random() * 12) })],
      );
    }
  }

  // CGM-style readings every 15 minutes, shaped by the meals above.
  const samples = [];
  const totalPoints = Math.floor((DAYS * 24 * 60) / CGM_INTERVAL_MINUTES);
  for (let i = 0; i < totalPoints; i += 1) {
    const at = new Date(start.getTime() + i * CGM_INTERVAL_MINUTES * 60 * 1000);
    if (at > now) break;

    // Baseline with a mild dawn rise.
    const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
    let value = 6.2 + 0.8 * Math.exp(-((hour - 6) ** 2) / 6);

    for (const meal of meals) {
      const minutesSince = (at.getTime() - meal.at.getTime()) / 60000;
      if (minutesSince < 0 || minutesSince > 240) continue;

      // Rise peaks around 60 minutes, decaying after.
      const shape = Math.exp(-((minutesSince - 60) ** 2) / 1800);
      let amplitude = (meal.carbs / 45) * 3.4;
      if (meal.walked) amplitude += TRUE_WALK_EFFECT_MMOL;
      if (meal.at.getUTCHours() >= 20) amplitude += TRUE_LATE_MEAL_PENALTY_MMOL;
      value += Math.max(0, amplitude) * shape;
    }

    value = Math.max(3.3, gaussian(value, 0.35));
    samples.push([at, Math.round(value * 10) / 10]);
  }

  // Batched insert: 17k+ rows one at a time is needlessly slow.
  const BATCH = 500;
  for (let i = 0; i < samples.length; i += BATCH) {
    const batch = samples.slice(i, i + BATCH);
    const values = batch
      .map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3}, 'mmol/L', 'cgm_device')`)
      .join(',');
    await client.query(
      `insert into metabolic.glucose_samples
         (user_id, measured_at, glucose_value, unit, source)
       values ${values}
       on conflict do nothing`,
      [userId, ...batch.flat()],
    );
  }

  // --- Medications and labs -------------------------------------------------
  await client.query(
    `insert into clinical.medication_records
       (user_id, medication_name, dose_text, frequency_text, started_on, status, source)
     values ($1, 'Metformin', '1000 mg', 'twice daily', $2, 'active', 'manual')`,
    [userId, new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000)],
  );

  for (const [monthsAgo, hba1c] of [[9, 7.9], [6, 7.4], [3, 7.1], [0, 6.8]]) {
    await client.query(
      `insert into clinical.lab_results
         (user_id, test_name, code_system, code, value_numeric, unit, collected_at, source)
       values ($1, 'HbA1c', 'loinc', '4548-4', $2, '%', $3, 'lab_import')`,
      [userId, hba1c, new Date(now.getTime() - monthsAgo * 30 * 24 * 60 * 60 * 1000)],
    );
  }

  await client.query(
    `insert into audit.events (actor_user_id, subject_user_id, action, resource_type, metadata)
     values ($1, $1, 'seed.demo_data', 'user', $2)`,
    [userId, JSON.stringify({ days: DAYS, meals: meals.length, samples: samples.length })],
  );

  console.log(`  sign in as:     ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  user id:        ${userId}`);
  console.log(`  meals:          ${meals.length} (${meals.filter((m) => m.walked).length} followed by a walk)`);
  console.log(`  glucose:        ${samples.length} samples`);
  console.log(`  ground truth:   walk effect ${TRUE_WALK_EFFECT_MMOL} mmol/L (randomised — the engine should recover this)`);
  console.log(`                  late-meal +${TRUE_LATE_MEAL_PENALTY_MMOL} mmol/L, confounded with carbohydrate load by design`);
  console.log('Done.');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

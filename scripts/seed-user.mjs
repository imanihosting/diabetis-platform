#!/usr/bin/env node
/**
 * Adds synthetic metabolic data to an account that ALREADY EXISTS.
 *
 * Deliberately different from scripts/seed-demo.mjs, which begins by deleting
 * the user it is about to create. That is right for a throwaway demo account
 * and catastrophic on a real one: it takes the password and every genuine
 * record with it.
 *
 * This script:
 *   - never writes to identity.users or identity.credentials
 *   - never deletes anything
 *   - tags every glucose row source='cgm_device' so it stays separable from
 *     hand-entered 'manual' readings
 *   - records the insert in the append-only audit trail
 *   - writes an exact undo script naming every row it created
 *
 *   node --env-file=.env seed-existing-user.mjs <email> [--undo-out <path>]
 */
import pg from 'pg';
import { writeFileSync } from 'node:fs';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node seed-existing-user.mjs <email> [--undo-out <path>]');
  process.exit(1);
}
const undoIdx = process.argv.indexOf('--undo-out');
const undoPath = undoIdx !== -1 ? process.argv[undoIdx + 1] : './undo-seed.sql';

const DAYS = 60;
const CGM_INTERVAL_MINUTES = 15;
const TRUE_WALK_EFFECT_MMOL = -1.3;
const TRUE_LATE_MEAL_PENALTY_MMOL = 0.9;

function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(20260827);

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

  const { rows: found } = await client.query(
    'select id, display_name from identity.users where email = $1',
    [email],
  );
  if (found.length === 0) {
    throw new Error(
      `No account with email ${email}. This script only adds data to an ` +
        'existing account; it will not create one.',
    );
  }
  const userId = found[0].id;
  console.log(`Adding ${DAYS} days of data to ${email} (${userId})`);

  const before = await client.query(
    `select
       (select count(*) from metabolic.glucose_samples where user_id = $1) as glucose,
       (select count(*) from nutrition.meals            where user_id = $1) as meals,
       (select count(*) from metabolic.events           where user_id = $1) as events`,
    [userId],
  );
  console.log('  before:', before.rows[0]);

  const now = new Date();
  const start = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const meals = [];
  for (let day = 0; day < DAYS; day += 1) {
    const dayStart = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    const count = 2 + (random() < 0.6 ? 1 : 0);
    const chosen = [...MEAL_TEMPLATES].sort(() => random() - 0.5).slice(0, count);
    for (const template of chosen) {
      const at = new Date(dayStart);
      at.setUTCHours(template.hour, Math.floor(random() * 50), 0, 0);
      meals.push({ ...template, at, walked: random() < 0.5 });
    }
  }

  const mealIds = [];
  const eventIds = [];

  for (const meal of meals) {
    const { rows } = await client.query(
      `insert into nutrition.meals
         (user_id, started_at, ended_at, meal_type, description, source, confidence)
       values ($1, $2, $3, $4, $5, 'manual', 1.0) returning id`,
      [userId, meal.at, new Date(meal.at.getTime() + 25 * 60 * 1000), meal.type, meal.desc],
    );
    const mealId = rows[0].id;
    mealIds.push(mealId);

    await client.query(
      `insert into nutrition.meal_items
         (meal_id, item_name, estimated_carbs_g, estimated_protein_g,
          estimated_fat_g, estimated_fiber_g, portion_text, confidence)
       values ($1, $2, $3, $4, $5, $6, 'standard portion', 0.6)`,
      [mealId, meal.desc, meal.carbs, meal.protein, meal.fat, meal.fiber],
    );

    const ev = await client.query(
      `insert into metabolic.events
         (user_id, occurred_at, event_type, source, confidence, payload)
       values ($1, $2, 'meal_started', 'manual', 1.0, $3) returning id`,
      [userId, meal.at, JSON.stringify({ mealId, mealType: meal.type, description: meal.desc, seeded: true })],
    );
    eventIds.push(ev.rows[0].id);

    if (meal.walked) {
      const walkAt = new Date(meal.at.getTime() + (20 + random() * 25) * 60 * 1000);
      const walk = await client.query(
        `insert into metabolic.events
           (user_id, occurred_at, event_type, source, confidence, payload)
         values ($1, $2, 'exercise_started', 'manual', 1.0, $3) returning id`,
        [userId, walkAt, JSON.stringify({ kind: 'walk', minutes: 12 + Math.floor(random() * 12), seeded: true })],
      );
      eventIds.push(walk.rows[0].id);
    }
  }

  const samples = [];
  const totalPoints = Math.floor((DAYS * 24 * 60) / CGM_INTERVAL_MINUTES);
  for (let i = 0; i < totalPoints; i += 1) {
    const at = new Date(start.getTime() + i * CGM_INTERVAL_MINUTES * 60 * 1000);
    if (at > now) break;

    const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
    let value = 6.2 + 0.8 * Math.exp(-((hour - 6) ** 2) / 6);

    for (const meal of meals) {
      const minutesSince = (at.getTime() - meal.at.getTime()) / 60000;
      if (minutesSince < 0 || minutesSince > 240) continue;
      const shape = Math.exp(-((minutesSince - 60) ** 2) / 1800);
      let amplitude = (meal.carbs / 45) * 3.4;
      if (meal.walked) amplitude += TRUE_WALK_EFFECT_MMOL;
      if (meal.at.getUTCHours() >= 20) amplitude += TRUE_LATE_MEAL_PENALTY_MMOL;
      value += Math.max(0, amplitude) * shape;
    }

    value = Math.max(3.3, gaussian(value, 0.35));
    samples.push([at, Math.round(value * 10) / 10]);
  }

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < samples.length; i += BATCH) {
    const batch = samples.slice(i, i + BATCH);
    const values = batch
      .map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3}, 'mmol/L', 'cgm_device')`)
      .join(',');
    const res = await client.query(
      `insert into metabolic.glucose_samples
         (user_id, measured_at, glucose_value, unit, source)
       values ${values}
       on conflict do nothing`,
      [userId, ...batch.flat()],
    );
    inserted += res.rowCount;
  }

  // Permanent record that these rows are synthetic. audit.events is
  // append-only, so this survives the undo script below.
  await client.query(
    `insert into audit.events
       (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
     values (null, $1, 'seed.synthetic_data', 'user', $1, $2)`,
    [
      userId,
      JSON.stringify({
        reason: 'Demonstration data for the Evidence screen',
        days: DAYS,
        glucoseInserted: inserted,
        glucoseSource: 'cgm_device',
        mealsInserted: mealIds.length,
        eventsInserted: eventIds.length,
        windowFrom: start.toISOString(),
        windowTo: now.toISOString(),
      }),
    ],
  );

  const after = await client.query(
    `select
       (select count(*) from metabolic.glucose_samples where user_id = $1) as glucose,
       (select count(*) from nutrition.meals            where user_id = $1) as meals,
       (select count(*) from metabolic.events           where user_id = $1) as events`,
    [userId],
  );

  const undo = `-- Removes exactly the rows seeded into ${email} on ${now.toISOString()}.
-- Hand-entered 'manual' glucose readings are untouched; so is the account
-- and its password. The audit entry recording the seed is append-only and
-- deliberately survives.
begin;
delete from metabolic.glucose_samples
 where user_id = '${userId}'
   and source = 'cgm_device'
   and measured_at >= '${start.toISOString()}'
   and measured_at <= '${now.toISOString()}';
delete from metabolic.events where id in (
${eventIds.map((id) => `  '${id}'`).join(',\n')}
);
-- meal_items cascade from meals.
delete from nutrition.meals where id in (
${mealIds.map((id) => `  '${id}'`).join(',\n')}
);
commit;
`;
  writeFileSync(undoPath, undo);

  console.log('  after: ', after.rows[0]);
  console.log(`  glucose inserted: ${inserted} (source=cgm_device)`);
  console.log(`  meals inserted:   ${mealIds.length}`);
  console.log(`  events inserted:  ${eventIds.length}`);
  console.log(`  undo script:      ${undoPath}`);
  await client.end();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

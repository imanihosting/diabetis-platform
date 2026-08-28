#!/usr/bin/env node
/**
 * Minimal, transparent SQL migration runner.
 *
 * Deliberately not an ORM migration tool: this schema uses TimescaleDB
 * hypertables, pgvector index types, and PL/pgSQL guard triggers that ORM
 * migration DSLs model poorly. Plain SQL files stay readable and reviewable.
 *
 * Each file in infra/db/migrations runs once, in filename order, inside a
 * transaction, and is recorded in public.schema_migrations.
 *
 *   node scripts/migrate.mjs           apply pending migrations
 *   node scripts/migrate.mjs status    show applied / pending
 */
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The CA the database connection should trust, when an internal one is in use.
 *
 * `DATABASE_CA_CERT` when set, otherwise the copy committed to this repository.
 * A CA certificate is a public trust anchor rather than a secret, so keeping it
 * beside the code is what lets these scripts verify without per-machine setup.
 *
 * Scoped to this connection deliberately, rather than exported through
 * NODE_EXTRA_CA_CERTS — that would let an internal CA meant for one database
 * vouch for every other TLS connection the process makes.
 */
function databaseCa(rootDir) {
  const configured = process.env.DATABASE_CA_CERT;
  try {
    return readFileSync(configured ?? join(rootDir, 'infra', 'db', 'ca.crt'), 'utf8');
  } catch {
    if (configured) {
      console.error(`DATABASE_CA_CERT is set to ${configured}, which cannot be read.`);
      process.exit(2);
    }
    return undefined;
  }
}

const MIGRATIONS_DIR = join(ROOT, "infra", "db", "migrations");

/**
 * node-postgres does not understand libpq's `sslmode=require` the same way
 * libpq does: libpq encrypts without verifying, node-pg verifies by default.
 * DATABASE_SSL_REJECT_UNAUTHORIZED bridges that difference so the same
 * DATABASE_URL works for psql, psycopg, and node alike.
 */
function clientConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  // node-pg lets `sslmode` in the URL win over an explicit `ssl` option, and it
  // interprets `require` more strictly than libpq does. Strip the parameter and
  // decide here so one URL works for every driver.
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode") ?? "prefer";
  url.searchParams.delete("sslmode");

  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

  return {
    connectionString: url.toString(),
    ssl:
      sslmode === "disable"
        ? false
        : { rejectUnauthorized, ca: databaseCa(ROOT) },
  };
}

/**
 * The migration with its comments and formatting removed.
 *
 * Two checksums are recorded per migration: one over the file exactly as it is,
 * and one over this. A comment corrected after the migration ran changes the
 * first and not the second, which is the difference between "somebody fixed a
 * sentence" and "the schema history no longer matches the code". Only the
 * second is a reason to refuse to go on.
 *
 * That distinction is the whole point. Without it, correcting a typo in an
 * applied migration bricks every future one, and the pressure is then to leave
 * documentation wrong rather than touch the file — which is how a migration
 * ends up explaining something it does not do.
 */
function normaliseSql(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      return {
        name,
        sql,
        checksum: hash(sql),
        sqlChecksum: hash(normaliseSql(sql)),
      };
    }),
  );
}

async function main() {
  const command = process.argv[2] ?? "up";
  const client = new pg.Client(clientConfig());
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);
  // Added after the fact, so rows written by an older runner have it null.
  // A null means the executable SQL of that migration was never recorded and
  // drift in it cannot be judged automatically.
  await client.query(
    "alter table public.schema_migrations add column if not exists sql_checksum text",
  );

  const migrations = await loadMigrations();
  let { rows } = await client.query(
    "select name, checksum, sql_checksum from public.schema_migrations",
  );
  let applied = new Map(rows.map((r) => [r.name, r]));

  // Backfill the executable-SQL checksum for anything applied before this
  // runner recorded one. No judgement is involved: the raw checksum matching
  // means the file is byte-identical to what ran, so its normalised SQL is
  // definitionally what was applied. Without this, every migration written
  // before today stays unjudgeable forever, and the first comment corrected in
  // one of them blocks the next schema change — which is exactly the failure
  // this whole mechanism exists to stop.
  const backfill = migrations.filter((m) => {
    const was = applied.get(m.name);
    return was && !was.sql_checksum && was.checksum === m.checksum;
  });
  if (backfill.length > 0) {
    for (const m of backfill) {
      await client.query(
        "update public.schema_migrations set sql_checksum = $2 where name = $1",
        [m.name, m.sqlChecksum],
      );
    }
    ({ rows } = await client.query(
      "select name, checksum, sql_checksum from public.schema_migrations",
    ));
    applied = new Map(rows.map((r) => [r.name, r]));
  }

  /** How a file on disk compares with what was recorded when it ran. */
  function compare(m) {
    const was = applied.get(m.name);
    if (!was) return "pending";
    if (was.checksum === m.checksum) return "applied";
    if (was.sql_checksum && was.sql_checksum === m.sqlChecksum) return "comments-only";
    if (!was.sql_checksum) return "unverifiable";
    return "changed";
  }

  const STATE_LABELS = {
    pending: "PENDING",
    applied: "applied",
    "comments-only": "applied (comments edited)",
    unverifiable: "APPLIED (drift, unverifiable)",
    changed: "APPLIED (SQL CHANGED!)",
  };

  if (command === "status") {
    for (const m of migrations) {
      console.log(`${STATE_LABELS[compare(m)].padEnd(30)} ${m.name}`);
    }
    await client.end();
    return;
  }

  if (command === "repair") {
    // The escape hatch for a migration edited before this runner recorded the
    // executable SQL separately. It cannot verify anything — the original file
    // is gone — so it says exactly that and re-records what is on disk now.
    // Deliberately a separate command: repairing has to be something somebody
    // decided to do, not something that happens because they ran `migrate`.
    const drifted = migrations.filter((m) =>
      ["unverifiable", "changed", "comments-only"].includes(compare(m)),
    );
    if (drifted.length === 0) {
      console.log("Nothing to repair.");
      await client.end();
      return;
    }
    for (const m of drifted) {
      console.log(`re-recording ${m.name} (${compare(m)})`);
      await client.query(
        "update public.schema_migrations set checksum = $2, sql_checksum = $3 where name = $1",
        [m.name, m.checksum, m.sqlChecksum],
      );
    }
    console.log(
      `\nRe-recorded ${drifted.length} migration(s) against the files as they are now.\n` +
        "This asserts the database already matches them. Verify the live schema\n" +
        "before trusting it: the original file contents are not recoverable.",
    );
    await client.end();
    return;
  }

  // A changed file that already ran means the recorded history no longer
  // matches the code. Fail loudly rather than silently diverging — but only
  // when the change is one that could have changed the schema.
  for (const m of migrations) {
    const state = compare(m);

    if (state === "comments-only") {
      // The statements are identical; somebody corrected the prose around
      // them. Bring the recorded checksum up to date and carry on, saying so.
      console.log(`${m.name}: comments changed since it ran, SQL identical. Re-recording.`);
      await client.query(
        "update public.schema_migrations set checksum = $2, sql_checksum = $3 where name = $1",
        [m.name, m.checksum, m.sqlChecksum],
      );
      continue;
    }

    if (state === "changed") {
      console.error(
        `Migration ${m.name} was already applied and its SQL has changed.\n` +
          "Add a new migration instead of editing an applied one.",
      );
      await client.end();
      process.exit(1);
    }

    if (state === "unverifiable") {
      console.error(
        `Migration ${m.name} has changed since it ran, and this database has no\n` +
          "record of its executable SQL, so the change cannot be judged.\n\n" +
          "If the change was to comments only and the live schema already matches\n" +
          "the file, run `npm run db:repair`. Otherwise add a new migration.",
      );
      await client.end();
      process.exit(1);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.name));
  if (pending.length === 0) {
    console.log("No pending migrations.");
    await client.end();
    return;
  }

  for (const m of pending) {
    process.stdout.write(`applying ${m.name} ... `);
    try {
      await client.query("begin");
      await client.query(m.sql);
      await client.query(
        "insert into public.schema_migrations (name, checksum, sql_checksum) values ($1, $2, $3)",
        [m.name, m.checksum, m.sqlChecksum],
      );
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(err.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log(`Applied ${pending.length} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

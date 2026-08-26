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
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
    ssl: sslmode === "disable" ? false : { rejectUnauthorized },
  };
}

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
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

  const migrations = await loadMigrations();
  const { rows } = await client.query("select name, checksum from public.schema_migrations");
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  if (command === "status") {
    for (const m of migrations) {
      const was = applied.get(m.name);
      const state = !was ? "PENDING" : was === m.checksum ? "applied" : "APPLIED (checksum drift!)";
      console.log(`${state.padEnd(26)} ${m.name}`);
    }
    await client.end();
    return;
  }

  // A changed file that already ran means the recorded history no longer
  // matches the code. Fail loudly rather than silently diverging.
  for (const m of migrations) {
    const was = applied.get(m.name);
    if (was && was !== m.checksum) {
      console.error(
        `Migration ${m.name} was already applied but its contents changed.\n` +
          "Add a new migration instead of editing an applied one.",
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
        "insert into public.schema_migrations (name, checksum) values ($1, $2)",
        [m.name, m.checksum],
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

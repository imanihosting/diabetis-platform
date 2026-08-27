# Infrastructure

## Provisioned services

| Service | Host | Notes |
|---|---|---|
| PostgreSQL 17 + TimescaleDB + pgvector | `10.10.5.185:5432` | Database `diabetes`, app role `diabetes_app` |
| MinIO (S3-compatible) | `10.10.5.240:9000` | Bucket `medicaldata`, prefix `diabetes-platform/` |
| Redis | local Docker | `docker compose -f infra/docker/docker-compose.yml up -d` |

Credentials live in the repo-root `.env`, which is gitignored. Copy
`.env.example` and fill it in.

## Database

### Provisioning

The database VM was set up with `scripts/provision-db.sh` (Ubuntu 26.04,
`resolute` apt repos):

- PostgreSQL 17 from the PGDG repository
- TimescaleDB 2.29 for the glucose and activity hypertables
- pgvector 0.8 for semantic observations
- `timescaledb-tune` applied for the VM's memory and CPU
- `ufw` restricted to SSH plus port 5432 from the private LAN

### Migrations

Plain SQL files in `db/migrations`, applied in filename order by
`scripts/migrate.mjs`:

```bash
npm run db:migrate     # apply pending
npm run db:status      # show applied / pending
```

Each file runs once inside a transaction and is recorded in
`public.schema_migrations` with a checksum. Editing a migration that has
already run is rejected — add a new one instead.

Migrations are plain SQL rather than an ORM DSL because the schema uses
TimescaleDB hypertables, pgvector index types, and PL/pgSQL guard triggers that
ORM migration tools model poorly.

### Guarantees enforced in the database

These are not conventions the application is trusted to follow — the database
rejects violations directly:

| Guarantee | Mechanism |
|---|---|
| Predictions are immutable; only `status` may change | trigger `predictions_immutable` |
| Predictions cannot be deleted | trigger `predictions_immutable` |
| The audit trail cannot be rewritten or deleted | trigger `audit_events_append_only` |
| Audit rows can be anonymised for erasure, never reassigned | migration `0010` |
| A clinician-gated experiment cannot skip review | check `experiments_gate_chk` |
| A blocked experiment can never be active | check `experiments_blocked_chk` |
| Confidence values stay within 0–1 | check constraints on every table carrying one |

## TLS

The PostgreSQL VM currently presents its default self-signed certificate, so
connections are encrypted but unverified (`sslmode=require` plus
`DATABASE_SSL_REJECT_UNAUTHORIZED=false`).

Encryption without verification stops someone reading the traffic and does
nothing about someone answering as the database. For a health record that is
the half that matters, so this is a go-live blocker rather than a hardening
nice-to-have.

The backend now says so on every boot. While `DATABASE_SSL_REJECT_UNAUTHORIZED`
is false it logs a warning naming the risk; setting `REQUIRE_VERIFIED_DB_TLS=true`
turns that warning into a refusal to start. It is opt-in rather than implied by
`NODE_ENV`, because the running deployment has always had this condition and
enforcing it on upgrade would take the service down rather than fix it.

**The sequence:**

1. Issue a CA-signed certificate for the database host. An internal CA is fine;
   what matters is that the client can verify a chain it was configured to
   trust. `verify-full` also checks the hostname against the certificate, so
   the certificate must be issued for the name the URL connects to. Connecting
   by bare IP (`10.10.5.185`) cannot satisfy that, so this step includes giving
   the host a DNS name and using it in `DATABASE_URL`.
2. Install the certificate and key on the VM, point `ssl_cert_file` and
   `ssl_key_file` at them, and reload PostgreSQL.
3. Distribute the CA certificate to every client that connects: the backend
   container, the metabolic engine container, and the migration runner.
4. Change `DATABASE_URL` to `sslmode=verify-full`, set
   `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, and set `REQUIRE_VERIFIED_DB_TLS=true`.
5. Verify before trusting it. `npm run db:verify-tls` connects and reports what
   the connection actually negotiated; it exits non-zero if the certificate did
   not verify. Run it from a machine that is not the database host.

Note that the Python engine reads `sslmode` straight from the URL, so step 4
covers it too — psycopg honours `verify-full` natively and needs no separate
flag.

## Object storage

The `medicaldata` bucket lives on a MinIO instance shared with unrelated
buckets, so the platform uses a dedicated service account (`diabetes-platform`)
scoped to that bucket alone — verified to be denied access to the others.
Everything the platform writes is namespaced under `diabetes-platform/` and
partitioned by user id.

Object keys are opaque UUIDs, and the bucket is not public: browsers receive
short-lived presigned URLs, never raw keys.

## Containers

Three images, all built from the repository root because the services share the
`@wellovue/types` workspace:

| Image | Dockerfile | Notes |
|---|---|---|
| backend | `backend/Dockerfile` | Multi-stage; runs unprivileged as `node` |
| frontend | `frontend/Dockerfile` | Next standalone output |
| metabolic-engine | `metabolic-engine/Dockerfile` | Dependencies installed from `pyproject.toml` alone so code edits do not reinstall numpy/scipy |
| migrations | `infra/docker/Dockerfile.migrate` | One-shot runner, kept separate from the API |

Each Dockerfile also defines a `test` stage, so `target:` is set explicitly in
both compose files — otherwise the last stage in the file would be selected.

### Two compose files

`docker-compose.yml` runs Wellovue against the provisioned VMs.
`docker-compose.test.yml` brings up its own throwaway PostgreSQL and MinIO for
the test suites, and touches no shared infrastructure.

The test database runs with `fsync=off`, `synchronous_commit=off`, and
`full_page_writes=off`. Durability is pure overhead for a database that is
destroyed after every run — never use those settings where the data matters.

### The frontend's `/api` proxy

The browser talks to `/api/*` on its own origin, and a route handler
(`frontend/src/app/api/[...path]/route.ts`) forwards to the backend. The access
token therefore never travels in a cross-site request, and there is no CORS
preflight.

This is a route handler rather than a `next.config` rewrite on purpose:
rewrites are resolved when the app is built, so a containerised frontend would
carry a baked-in `localhost:4000` pointing at itself. The handler reads
`BACKEND_URL` at run time, so one image works in every environment.

## Security posture

| Concern | How it is handled |
|---|---|
| Credentials in the repo | None. Everything is read from the gitignored root `.env`; the docs point at the password manager. |
| Object storage access | A service account scoped to `medicaldata` alone, verified to be denied the other buckets on that shared MinIO. |
| Refresh token | HttpOnly, Secure (in production), SameSite=Strict cookie scoped to `/api/auth`. Never in the response body, never in `localStorage`. |
| Access token | In memory for the tab's lifetime. Not persisted anywhere. |
| Refresh token reuse | Single-use. Rotated on every refresh; a replay is rejected and the cookie cleared. |
| Session storage at rest | Only a SHA-256 hash of the refresh token is stored, so a database leak yields no usable sessions. |
| Password storage | argon2id, in a table separate from the user record. |
| Login timing | A dummy verification runs when the account does not exist, so a wrong password and an unknown account take comparable time. |
| Route exposure | The JWT guard is global; opening a route needs an explicit `@Public()`. |
| Cross-user access | Ownership is verified before any write that references another record, and a foreign id returns the same 404 as a missing one. |
| Audit integrity | Append-only at the database level; writes commit in the same transaction as the data they describe. |
| Engine authentication | Service-token auth may only be disabled when `ENVIRONMENT=development`; anywhere else a missing token fails startup. |
| Dependency advisories | `npm audit` clean. Pinned minimums for transitives live in the root `overrides`. |

### Still outstanding

- **PostgreSQL TLS is unverified.** The VM presents its default self-signed
  certificate. Follow the sequence under [TLS](#tls) above; the backend warns
  about it on every boot until it is done.
- **Rate limits are per process.** The throttler counts in memory, so N backend
  replicas mean N independent budgets and an attacker gets N times the
  attempts. Correct for the single container running today, wrong the moment a
  second one starts. Redis is already in the compose file and unused;
  `@nest-lab/throttler-storage-redis` is the change to make before scaling out.
- **Client addresses are not visible to the rate limiter yet.** Requests reach
  the backend through the frontend's `/api` proxy, which cannot see the
  caller's socket address and deliberately strips the forwarding headers the
  caller sent, since it has no way to tell a real one from a forged one.
  IP-keyed limits therefore currently apply per proxy rather than per visitor.
  The per-account limit on sign-in is unaffected and works today. Put a real
  reverse proxy in front, have it overwrite `X-Forwarded-For`, then set
  `TRUST_PROXY=true` to make the address-keyed limits meaningful.

### Resolved

- **Shared infrastructure credentials.** The VM `support` login and the MinIO
  root account appeared in this repository's early history. They have since
  been rotated by the infrastructure owner. The old history is still reachable
  by SHA on GitHub, so the rotation is what makes those values worthless rather
  than their removal from the repository.

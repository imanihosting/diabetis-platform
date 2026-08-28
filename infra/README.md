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
| An outcome cannot be rewritten or deleted | trigger `prediction_outcomes_immutable` |
| An experiment has at most one prediction | unique index `predictions_one_per_experiment` |
| A prediction has at most one outcome | unique constraint on `prediction_id` |
| A clinician-gated experiment cannot skip review | check `experiments_gate_chk` |
| A blocked experiment can never be active | check `experiments_blocked_chk` |
| An experiment cannot become active without a prediction | trigger `experiments_active_requires_prediction` |
| An experiment cannot be completed without an outcome | trigger `experiments_completed_requires_outcome` |
| Confidence values stay within 0–1 | check constraints on every table carrying one |

Immutability here means "cannot be revised while it belongs to somebody", not
"can never be removed". Predictions and outcomes leave with the account they
describe; the triggers tell erasure from tampering by checking whether the
parent row still resolves, since PostgreSQL removes a parent before cascading.

## TLS

The PostgreSQL VM currently presents its own self-signed certificate — issued
to `medical-db`, by `medical-db` — so connections are encrypted but unverified
(`sslmode=require` plus `DATABASE_SSL_REJECT_UNAUTHORIZED=false`).

Encryption without verification stops someone reading the traffic and does
nothing about someone answering as the database. For a health record that is
the half that matters, so this is a go-live blocker rather than a hardening
nice-to-have.

The backend says so on every boot. While `DATABASE_SSL_REJECT_UNAUTHORIZED` is
false it logs a warning naming the risk; `REQUIRE_VERIFIED_DB_TLS=true` turns
that warning into a refusal to start.

### What actually blocks it

Not the certificate — the name. `verify-full` checks that the certificate was
issued for the host being connected to, and RFC 6066 does not permit an IP
literal in SNI. `DATABASE_URL` connects to `10.10.5.185`, which has no name to
check a certificate against, and no certificate can fix that. Setting
`REQUIRE_VERIFIED_DB_TLS=true` while the URL is still an address is refused at
boot with that reason, rather than failing the handshake and sending somebody
after their certificate for a week.

So the name comes first, and it is the only step here with a lead time.

### Getting a name and a certificate without exposing the database

The database is on the private network with every client that talks to it. It
does not need to be publicly reachable, and putting it behind a tunnel to make
it so would add a public path to Postgres in exchange for nothing.

What is needed is narrower: a **name**, and a **certificate issued for that
name** that the clients already trust. Both are obtainable without the host
being reachable from the internet, because ACME's DNS-01 challenge proves
control of the *name* by writing a TXT record — it never connects to the host.

Two ways to hold the name, and the second is preferred.

**A — a public DNS-only record.** In Cloudflare, an `A` record for
`db.example.com` pointing at `10.10.5.185`, with the proxy **off** (grey
cloud). Cloudflare accepts private addresses on unproxied records; it cannot
proxy them, and 5432 is not a proxied port in any case. Simple and needs no
per-client configuration. It publishes internal addressing to anyone who asks,
permanently, and some resolvers strip RFC1918 answers from public DNS as
rebinding protection — so test resolution from inside a container before
relying on it.

**B — no public record at all.** DNS-01 never reads the `A` record, so a
certificate can be issued for a name that only resolves privately. Put the
mapping where it is used: `extra_hosts` on the `backend` and `metabolic-engine`
services in `docker-compose.yml`, and `/etc/hosts` on any machine that runs
`db:migrate` or `db:verify-tls`.

```yaml
    extra_hosts:
      - "db.example.com:10.10.5.185"
```

Nothing about the internal network becomes queryable, and no resolver can strip
an answer that was never served. The cost is a mapping per client, and the
failure mode when one is missed is loud: the name does not resolve, or the boot
check refuses an IP-literal URL by name.

### The sequence

Each step is independently reversible, and none of them changes what the
running application does until step 5. Do not start at step 5.

1. **Choose the name and make it resolve.** Option A or B above. Verify from
   where it matters rather than from a laptop:
   ```bash
   docker exec wellovue-backend-1 getent hosts db.example.com
   ```
2. **Check CAA does not block issuance.** `dig CAA example.com`. Empty means no
   restriction, which is fine. If there are records and `letsencrypt.org` is
   not among them, issuance fails with an unhelpful error.
3. **Issue the certificate on the database VM**, so the private key is
   generated where it will be used and never travels. The Cloudflare API token
   wants Zone → DNS → Edit on that one zone and nothing else.
   ```bash
   sudo apt install certbot python3-certbot-dns-cloudflare
   printf 'dns_cloudflare_api_token = %s\n' "$TOKEN" | sudo tee /root/.cf.ini
   sudo chmod 600 /root/.cf.ini
   sudo certbot certonly --dns-cloudflare \
     --dns-cloudflare-credentials /root/.cf.ini -d db.example.com
   ```
4. **Install it and make renewal reinstall it.** PostgreSQL requires the key to
   be `0600` and owned by the `postgres` user, which Let's Encrypt's own
   directory permissions do not satisfy — copy the files rather than symlinking
   into `/etc/letsencrypt/live`, point `ssl_cert_file` and `ssl_key_file` at
   the copies, and reload.

   The deploy hook is the step people skip, and it is the one that fails
   silently: certbot renews on schedule, PostgreSQL goes on serving the old
   certificate from memory, and nothing says so until it expires.
   ```bash
   sudo certbot renew --deploy-hook /usr/local/bin/reload-postgres-cert
   sudo certbot renew --dry-run   # proves DNS-01 and the hook, before trusting them
   ```
5. **Switch the URL, then verification, then enforcement** — three separate
   changes, each safe to stop at:
   - `DATABASE_URL` to `postgresql://…@db.example.com:5432/diabetes?sslmode=verify-full`,
     leaving `DATABASE_SSL_REJECT_UNAUTHORIZED=false`. Nothing is enforced yet;
     the application should behave exactly as before.
   - `DATABASE_SSL_REJECT_UNAUTHORIZED=true`. Now the certificate is actually
     checked. If this breaks, the change to revert is one line.
   - `REQUIRE_VERIFIED_DB_TLS=true`, which only makes the state
     non-regressable: from here a misconfiguration refuses to boot instead of
     quietly downgrading.
6. **Verify, rather than assume.** `npm run db:verify-tls` connects with
   verification demanded regardless of what the environment asks for, reports
   the certificate's subject, issuer, names and expiry, and exits non-zero if
   anything did not check out. Run it from a machine that is not the database
   host, so the path under test is the one real traffic takes.

### After it is on, watch the date

Verification and expiry monitoring are one piece of work. Before step 5 an
expiring certificate is a tolerated weakness; after it, an expired one is a
backend that will not start. The gap between those two facts is a scheduled
outage if nobody is watching.

`/api/health/posture` reports the certificate the database presented, and
`npm run canary -- <url>` warns under 21 days and fails under 7 — Let's Encrypt
issues for 90 days and renews at 30, so anything inside three weeks means
renewal has already stopped working. A renewed certificate sitting on disk that
PostgreSQL never reloaded looks identical from outside, which is the case the
deploy hook in step 4 exists to prevent.

Note that the Python engine reads `sslmode` straight from the URL, so step 5
covers it too — psycopg honours `verify-full` natively and needs no separate
flag. Neither service needs a CA bundle for this: Node carries its own root
store and the engine image has the system one, which is the practical argument
for a publicly-trusted certificate over an internal CA, since the latter would
need `NODE_EXTRA_CA_CERTS` and `sslrootcert` wired into both.

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

## Rate limiting

Counts live in Redis when `REDIS_URL` is set, which makes one budget shared by
every replica. Without it they live in the backend process: correct for the one
container running today, and wrong the moment a second starts, because N
replicas would give an attacker N times the attempts against the same account.

`REQUIRE_SHARED_RATE_LIMIT=true` turns running without Redis into a refusal to
start. It is the same shape as `REQUIRE_VERIFIED_DB_TLS` and for the same
reason: the unsafe state is the one the platform runs in today, so making it
fatal by default would stop a working deployment for a condition it has always
had. Flip it at the moment a second replica appears. Until then the boot
warning repeats, because a risk nobody is reminded of is a risk nobody fixes.

**When Redis is configured and then stops answering**, the counts fall back to
the backend's own memory. That is deliberate and it is the third of three
possible behaviours, the other two being worse. Failing open would delete
brute-force protection at the moment the system is already unwell, silently.
Failing closed would turn a Redis blip into a total outage of a health record
somebody may be reading in an appointment. Falling back keeps the limits
enforced and stops them being shared — the state the platform had before Redis
existed, which is known and survivable. The degradation is logged once per
outage rather than once per request, and `/api/health/posture` reports
`rateLimit.configured: true` with `sharedAcrossReplicas: false` while it lasts.

Verified against the running stack rather than assumed: with Redis stopped, the
tenth failed sign-in for one account still returns 429, one error line is
logged, and the recovery line appears when Redis comes back.

## Checking a deployment from outside

```bash
npm run canary -- http://localhost:4000
npm run canary -- https://api.example.com --require-production
```

`scripts/canary.mjs` takes a base URL and reports whether a deployment should
carry traffic. Health checks — process up, database and object storage
reachable — fail it anywhere. Posture checks — verified database TLS, shared
rate limits — are warnings by default and failures under
`--require-production`, because both are states the platform runs in on purpose
today and a gate that goes red for the configuration something shipped with is
a gate that gets switched off.

Everything is observed over HTTP. Nothing needs a shell on the host or the
environment of a container, so the same command works against the compose
stack, a staging box, and whatever production turns out to be.

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
| Rate limit counts | Shared across replicas in Redis when `REDIS_URL` is set; per process otherwise, and the backend says which on every boot and at `/api/health/posture`. |

### Still outstanding

- **PostgreSQL TLS is unverified.** The VM presents its default self-signed
  certificate. Follow the sequence under [TLS](#tls) above; the backend warns
  about it on every boot until it is done.
- **Client addresses are the remaining half of rate limiting.** The counts are
  shared now (see [Rate limiting](#rate-limiting)), but they are keyed on an
  address the backend cannot yet see. Requests reach it through the frontend's
  `/api` proxy, which strips the forwarding headers the caller sent because it
  cannot tell a real one from a forged one, so address-keyed limits apply per
  proxy rather than per visitor. The per-account limit on sign-in is unaffected
  and works today.
  Put a real reverse proxy in front, have it overwrite `X-Forwarded-For`, then
  set `TRUST_PROXY=true`. Express is configured to trust exactly one hop, so a
  client cannot prepend its own entry and choose which bucket it lands in.

### Resolved

- **Shared infrastructure credentials.** The VM `support` login and the MinIO
  root account appeared in this repository's early history. They have since
  been rotated by the infrastructure owner. The old history is still reachable
  by SHA on GitHub, so the rotation is what makes those values worthless rather
  than their removal from the repository.

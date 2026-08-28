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

**Done.** The database presents a certificate issued by an internal CA, and
every client verifies it: `sslmode=verify-full`,
`DATABASE_SSL_REJECT_UNAUTHORIZED=true`, `REQUIRE_VERIFIED_DB_TLS=true`.

| | |
|---|---|
| Certificate | `CN=medical-db`, SANs `DNS:medical-db` and `IP:10.10.5.185` |
| Issuer | `Wellovue Internal CA`, valid to 2036 |
| Server cert expiry | 2031 |
| On the VM | cert and key in `/etc/postgresql/ssl`, CA in `/etc/postgresql/ca` |
| Configured by | a drop-in at `conf.d/20-ssl.conf`; delete it to fall back to snakeoil |
| Trusted via | `infra/db/ca.crt`, committed — a CA certificate is a public trust anchor, not a secret |

Reproduce with `scripts/issue-db-cert.sh`, which refuses to overwrite an
existing certificate.

### Why an internal CA rather than Let's Encrypt

Every client of this database is ours: two containers and a migration runner on
the private network. Public trust buys nothing there, and paying for it would
mean a third party in the trust path of a health record, an API token stored on
the database host, an outbound dependency, and a ninety-day renewal that fails
quietly — a renewed certificate PostgreSQL never reloaded looks identical to a
working one until it expires. A ten-year internal CA has none of that. The cost
is distributing the CA certificate to three clients, which `infra/db/ca.crt`
and two compose mounts handle.

### Clients must connect by name, not address

This is the part that decides the design, and it is a property of the driver
rather than of certificates. From `pg/lib/connection.js`:

```js
if (net.isIP && net.isIP(host) === 0) {
  options.servername = host
}
```

node-postgres tells Node which host to verify **only when the host is not an IP
address**. Connect to `10.10.5.185` and nothing is passed, so Node falls back to
checking the name `localhost` against the certificate and the connection is
refused — no matter what SANs the certificate carries. An `IP:` SAN does not
help here; it is in the certificate anyway because `psql` and `psycopg` do match
it.

So `DATABASE_URL` uses `medical-db`, and that name has to resolve wherever a
client runs:

- **Containers**: `extra_hosts` on `backend` and `metabolic-engine` in
  `docker-compose.yml`.
- **Developer machines**, for `npm run db:migrate` and `npm run db:verify-tls`:
  ```bash
  echo "10.10.5.185 medical-db" | sudo tee -a /etc/hosts
  ```

The backend refuses to start if `REQUIRE_VERIFIED_DB_TLS=true` while
`DATABASE_URL` still points at a bare address, and says why — rather than
failing a TLS handshake and sending the next person after their certificate.

### How the CA reaches each client

Scoped to the database connection in every case, never `NODE_EXTRA_CA_CERTS`,
which would widen trust for every TLS connection the process makes and let a CA
meant for one database vouch for the engine and object storage too.

| Client | Mechanism |
|---|---|
| Backend | `DATABASE_CA_CERT` → passed as `ssl.ca` on the pool alone |
| Metabolic engine | `PGSSLROOTCERT`, libpq's own variable, honoured by psycopg |
| Scripts | `DATABASE_CA_CERT`, defaulting to `infra/db/ca.crt` in the repository |

### If the VM is lost

The CA private key lives only at `/etc/postgresql/ca/ca.key`, root-only, and
signs one certificate. There is no revocation infrastructure and for one
certificate there does not need to be. Losing the host means running
`scripts/issue-db-cert.sh` again and replacing `infra/db/ca.crt`.

### Watching the date

`/api/health/posture` reports the certificate the database presented, and
`npm run canary -- <url>` warns under 21 days and fails under 7. The server
certificate runs to 2031, so this is quiet for years — which is exactly why it
is wired up now rather than at the point it starts mattering.

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
| Database TLS | Verified against an internal CA. The backend refuses to start if verification is off, or if the URL is an IP address that cannot be verified. |
| Client addresses | Caddy overwrites `X-Forwarded-For`; the frontend proxy forwards it only when `TRUST_PROXY` is set; the backend trusts exactly one hop. Break any link and every request keys on one bucket. |
| Logs | No query is built by interpolating a value, so the slow-query log carries statements and never data. Asserted by `backend/test/launch-hardening.spec.ts`. |
| Serving with a blocker open | `PUBLIC_LAUNCH=true` makes each one fatal: the frontend image will not build with a legal placeholder in a page, and the backend will not start with a runtime blocker open. |

### Still outstanding

- **Legal review.** The five placeholders and a lawyer. See
  [Going live](#going-live); the frontend image will not build with
  `PUBLIC_LAUNCH=true` while any placeholder remains, and filling them in is
  not the same as review.
- **The DNS records and the certificate.** `wellovue.com` is chosen and
  configured; nothing has been pointed at anything yet. See
  [Going live](#going-live).

## Going live

The domain is **wellovue.com**. Everything below is what stands between the
running stack and serving somebody real.

### The one switch

`PUBLIC_LAUNCH=true` makes every launch blocker fatal, at the earliest moment
each can be caught:

- **The frontend image will not build** while `[LEGAL ENTITY]` or any of the
  other four placeholders is in a user-facing page. The check runs during the
  image build because by boot the page is already compiled.
- **The backend will not start** while any of the four runtime blockers is
  open. It prints them, with what fixes each, and exits.

It is deliberately not derived from `NODE_ENV`: the containers already run with
`NODE_ENV=production` because that is how a Node app is built, and tying the
gate to it would fail every developer's `docker:up`. A gate that goes red for
the configuration something shipped with is a gate somebody switches off.

The four runtime blockers, from `backend/src/config/launch.ts`:

| Blocker | Fixed by |
|---|---|
| `database-host-is-an-address` | Give the database host a DNS name and reissue its certificate for that name |
| `database-tls-unverified` | `sslmode=verify-full`, `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, `REQUIRE_VERIFIED_DB_TLS=true` |
| `rate-limits-not-shared` | `REDIS_URL` set and answering, `REQUIRE_SHARED_RATE_LIMIT=true` |
| `client-addresses-not-known` | A reverse proxy that overwrites `X-Forwarded-For`, and `TRUST_PROXY=true` on **both** the backend and the frontend |

### DNS

Two records, both at the apex and the `www` name, pointing at the host running
the proxy:

```
wellovue.com.        A     <public IPv4 of the proxy host>
www.wellovue.com.    A     <public IPv4 of the proxy host>
```

Add `AAAA` records too if the host has IPv6. Caddy answers the ACME HTTP-01
challenge on port 80, so **both 80 and 443 must be reachable from the internet**
before the first certificate can be issued — port 80 cannot simply be firewalled
off, even though every request on it redirects.

`medical-db` is separate and is not a public name. It resolves on the private
network only; see [Clients must connect by name, not
address](#clients-must-connect-by-name-not-address).

### TLS termination

`infra/proxy/Caddyfile`, run by the `proxy` service in
`infra/docker/docker-compose.production.yml`. Caddy obtains and renews the
certificate itself, which removes the single most common way a small deployment
goes dark three months after launch: a certbot timer that stopped and told
nobody.

The certificates live on the `caddy-data` volume. **Do not delete that volume
to "start clean"** — Let's Encrypt rate-limits issuance hard enough that
re-issuing repeatedly can lock the domain out for a week.

TLS terminates at the proxy. The application behind it speaks plain HTTP on the
private network and never sees a certificate, which is why `TRUST_PROXY` exists:
from that point on, the forwarding headers are the only record of who the caller
was.

### The forwarding chain has three links

Caddy sets `X-Forwarded-For` by **overwriting** — appending would let a caller
prepend an address of their own and pick which rate-limit bucket they land in.
The frontend's `/api` proxy then passes it through, but only when its own
`TRUST_PROXY` is set; otherwise it drops it, which is correct when nothing
trustworthy is in front. The backend reads it, trusting exactly one hop.

**Break any link and the whole deployment is one rate-limit bucket.** The
frontend is the one people forget, because nothing about it looks like a proxy.

### Running it

```bash
docker compose -f infra/docker/docker-compose.yml \
               -f infra/docker/docker-compose.production.yml \
               --env-file .env up -d --build
```

Then, from somewhere outside:

```bash
npm run canary -- https://wellovue.com --require-production
```

That checks liveness, dependencies, database TLS and certificate expiry, shared
rate limits, the applied migration count against the tree, the launch blockers
the process reports, the public pages, and that the signed-in routes refuse a
caller with no session. It exits non-zero if the deployment should not carry
traffic.

## Backups and restore

**Not automated yet.** What follows is what to run and what has actually been
verified, which is not the same thing — a backup nobody has restored is a
belief, not a backup.

### Taking one

From a host that can reach `medical-db` by name:

```bash
docker run --rm --add-host medical-db:10.10.5.185 \
  -v "$PWD/backups:/backups" \
  -e PGPASSWORD="$DB_PASSWORD" postgres:17 \
  pg_dump -h medical-db -U wellovue -d wellovue \
          --format=custom --file=/backups/wellovue-$(date +%F).dump
```

`--format=custom` rather than plain SQL: it restores selectively, in parallel,
and compresses. The dump contains **every glucose reading, meal and lab result
in the system**, so it is a health record in a file and belongs wherever those
are allowed to be — encrypted at rest, access logged, and never on a laptop.

### Restoring one

Into an empty database, never over a live one:

```bash
createdb -h medical-db -U wellovue wellovue_restore
pg_restore -h medical-db -U wellovue -d wellovue_restore --clean --if-exists \
  backups/wellovue-2026-08-28.dump
```

Then check the restore rather than assuming it:

```bash
psql -h medical-db -U wellovue -d wellovue_restore -c \
  "select count(*) from public.schema_migrations;
   select count(*) from metabolic.glucose_samples;
   select count(*) from audit.events;"
```

The migration count must match `ls infra/db/migrations | wc -l`. A restore that
brings back the data and not the schema version will run migrations again on
next boot and fail on the checksum.

### What is not covered

- **No schedule.** Nothing takes these automatically. That is a launch blocker
  in the ordinary sense even though it is not in `launchBlockers()` — a running
  process cannot know whether anybody is backing it up.
- **No off-host copy.** A dump beside the database survives a dropped table and
  not a lost VM.
- **No tested restore.** The commands above are correct and have not been run
  end to end against a production-shaped dataset. Do that before launch, not
  after the first incident.
- **Object storage is separate.** Uploads live in MinIO, not in the dump.

### Resolved

- **PostgreSQL TLS is verified.** An internal CA signs a certificate for
  `medical-db`; every client checks it, and `REQUIRE_VERIFIED_DB_TLS=true`
  means a regression refuses to boot rather than downgrading quietly. See
  [TLS](#tls).
- **Rate limits are shared across replicas.** Counts live in Redis, and fall
  back to per-process rather than failing open or closed when it stops
  answering. See [Rate limiting](#rate-limiting).
- **Shared infrastructure credentials.** The VM `support` login and the MinIO
  root account appeared in this repository's early history. They have since
  been rotated by the infrastructure owner. The old history is still reachable
  by SHA on GitHub, so the rotation is what makes those values worthless rather
  than their removal from the repository.

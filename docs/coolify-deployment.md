# Deploying Wellovue on Coolify

Everything needed to stand up `wellovue.com` on Coolify behind a Cloudflare
Tunnel. `infra/README.md` explains *why* each of these is what it is; this page
is the values.

**No secret is written down here.** The three that matter live in the
gitignored root `.env` and in your password manager. There is a command below
that prints them for copy-and-paste.

---

## 1. Application settings

| Setting | Value |
|---|---|
| Build Pack | **Docker Compose** — not Dockerfile. This is four services. |
| Branch | `main` |
| Base Directory | `/` |
| Docker Compose Location | `/infra/docker/docker-compose.coolify.yml` |

**Not** `/infra/docker/docker-compose.yml`. That one is the developer stack: it
publishes ports, and although they are now bound to loopback, it carries none of
the launch switches and is not built to be served.

## 2. Domains

| Service | Domain |
|---|---|
| frontend | `https://wellovue.com` |
| backend | *leave empty* |
| metabolic-engine | *leave empty* |

Only the frontend is routable. The backend is the API and the engine's only
protection is a service token; a domain on either is a way into the record that
skips the browser's origin entirely.

## 3. Environment variables

### Required — the deploy fails without these

```
DATABASE_URL=postgresql://diabetes_app:PASSWORD@medical-db:5432/diabetes?sslmode=verify-full
JWT_SECRET=
METABOLIC_ENGINE_TOKEN=
S3_ENDPOINT=http://10.10.5.240:9000
S3_REGION=limk-dub
S3_BUCKET=medicaldata
S3_ACCESS_KEY_ID=diabetes-platform
S3_SECRET_ACCESS_KEY=
```

Fill the four blanks from the values already in your `.env`:

```bash
grep -E '^(DATABASE_URL|JWT_SECRET|METABOLIC_ENGINE_TOKEN|S3_SECRET_ACCESS_KEY)=' .env
```

### Two things about `DATABASE_URL` that will stop the boot

- **`medical-db`, not `10.10.5.185`.** node-postgres only tells Node which host
  to verify when the host is not an IP literal — SNI cannot carry an address,
  so there is no name to check the certificate against. Using the IP gives
  `Refusing to start: database-host-is-an-address`. The compose file maps the
  name inside the containers, so nothing needs DNS.
- **`sslmode=verify-full`, not `sslmode=require`.** `require` encrypts without
  checking who answered. Using it gives `database-tls-unverified`.

Verified live against that connection: database `diabetes`, role
`diabetes_app`, PostgreSQL 17.11, TimescaleDB 2.29.2, pgvector 0.8.6.

### Optional — only to override a default

```
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
S3_FORCE_PATH_STYLE=true
S3_PREFIX=diabetes-platform/
```

### Do not set these

They are fixed in `docker-compose.coolify.yml` so they cannot be forgotten on a
redeploy or quietly changed in a dashboard. Setting any of them in Coolify is
how the launch gate gets defeated by accident.

```
PUBLIC_LAUNCH   TRUST_PROXY   CLIENT_IP_HEADER
REQUIRE_VERIFIED_DB_TLS   REQUIRE_SHARED_RATE_LIMIT
DATABASE_SSL_REJECT_UNAUTHORIZED
NODE_ENV   ENVIRONMENT   BACKEND_PORT
REDIS_URL   BACKEND_URL   METABOLIC_ENGINE_URL
NEXT_PUBLIC_APP_URL   DATABASE_CA_CERT   PGSSLROOTCERT
```

`NEXT_PUBLIC_SITE_URL` is absent on purpose too. It is a **build argument**,
already fixed to `https://wellovue.com`; Next inlines it during the build, so
setting it as an environment variable would silently do nothing.

## 4. Cloudflare

| Setting | Value |
|---|---|
| Tunnel public hostname | `wellovue.com` |
| Service | `http://frontend:3000` |
| DNS records | `wellovue.com` and `www.wellovue.com`, **proxied** (orange cloud) |

`http://` on the tunnel route is correct and is not a downgrade: that hop is
inside the tunnel, which is encrypted end to end from the Cloudflare edge.

The records must stay proxied. A grey-cloud record points at nothing, and the
orange cloud is what guarantees `CF-Connecting-IP` is set on every request —
which is the header rate limiting keys on.

## 5. The first deploy will fail, on purpose

The frontend build stops with:

```
Unfilled placeholders are still in user-facing pages:
  frontend/src/app/privacy/page.tsx:16  [LEGAL ENTITY]
      needs: the registered company that controls the data
  ...
```

That is the launch gate, not a misconfiguration. The platform must not be able
to look live while a page tells somebody `[LEGAL ENTITY]` is responsible for
their health data.

To get past it, in order:

1. Fill in the five legal facts. `npm run check:launch` passes when they are gone.
2. Have a lawyer read Privacy and Terms against the jurisdiction they name, and
   delete the `lawyer-review` job in `.github/workflows/release-gate.yml` in the
   commit that records it.
3. Deploy.

To prove the tunnel and the database **before** the legal work, point Coolify at
`/infra/docker/docker-compose.yml` for that run. It has no launch switches and
every page it serves is honest about being unfinished.

## 6. After the deploy

```bash
npm run canary -- https://wellovue.com --require-production
```

Run it over the public name, not against the host. Reaching the containers
directly proves the containers work and proves nothing about the tunnel, the DNS
record, or the edge — where three of the four things that break a deployment
like this actually live.

## 7. Before real people use it

The provisioned database currently holds seeded accounts, including an
end-to-end test user and two demo patients — roughly 17,000 synthetic glucose
rows. None of this is caught by the launch gate, because a running process
cannot tell seeded data from real data.

```
bryne@blaquesoul.com                   5762 glucose   159 meals
demo.patient@diabetes-platform.local   5760 glucose   158 meals   4 labs
demo.patient@wellovue.local            5760 glucose   158 meals   4 labs
e2e-1787749053@test.local               151 glucose     1 meal
bryne@khayaonline.com                     0            0
```

Remove them through the application's erasure path rather than with SQL.
Migration 0010 makes user deletion null the audit actor and subject while
keeping the events; a raw `DELETE` fights the append-only trigger, and deleting
rows by hand across eleven schemas leaves orphans.

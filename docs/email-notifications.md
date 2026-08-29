# Email and notifications

Wellovue sends account mail through **Microsoft Graph**, using Entra
client-credentials auth. This page covers what has to exist in the tenant, how
mail is turned on and off, and what to do when something goes wrong.

Nothing here is optional reading before enabling mail in a deployment: a
half-configured provider is an account nobody can activate.

---

## What the platform sends, and what it will not

Seven templates, and that is the whole list:

| Template | When |
| --- | --- |
| `email_verification.v1` | A new account is created, or someone asks for another link |
| `welcome.v1` | An address is verified — never before |
| `password_reset.v1` | A reset is requested for an address with an account |
| `password_changed.v1` | A reset completes |
| `new_device_sign_in.v1` | A successful sign-in from a browser not seen before |
| `email_changed.v1` | The address on an account changes |
| `security_alert.v1` | A fixed set of account-security events |

**No message contains health information.** Not a glucose value, not a lab
result, not a diagnosis, not a finding, not anything from a clinician report.
This is enforced rather than agreed: every render passes through
`assertNoSensitiveProse` in `backend/src/notifications/mail.templates.ts`,
which throws if the prose contains any term in `BANNED_EMAIL_TERMS` — including
terms that arrived through a variable. `backend/test/mail-templates.spec.ts`
renders every template and checks the same property.

Adding a template means adding it to that file, with a version suffix. There is
no way for a caller to compose a subject or a body.

---

## Setting up the Microsoft Entra app

One app registration, one application permission, one mailbox.

1. **Register the application.** Entra admin centre → App registrations → New
   registration. Single tenant. No redirect URI: this is a daemon, and nobody
   signs in to it.

2. **Grant `Mail.Send` as an *application* permission.** API permissions → Add
   a permission → Microsoft Graph → **Application permissions** → `Mail.Send`.

   Delegated `Mail.Send` is the wrong one and looks identical in the list. A
   delegated permission acts on behalf of a signed-in user, and there is no
   signed-in user in a client-credentials flow.

3. **Grant admin consent.** The button beside the permission. Without it the
   token request succeeds and `sendMail` returns `403 ErrorAccessDenied`, which
   is the single most common way this is misconfigured. The Graph client marks
   403 permanent and does not retry it — see the runbook below.

4. **Create a client secret.** Certificates & secrets → New client secret. Copy
   the **Value**, not the Secret ID; they look alike in the portal and only the
   value works. Note the expiry — a secret that lapses stops all mail, and the
   symptom is `AADSTS7000215` in the outbox's `last_error`.

5. **Have a sender mailbox.** `GRAPH_SENDER_USER` must be a real, licensed
   mailbox in the tenant (`support@wellovue.com`). A user without an Exchange
   licence answers `MailboxNotEnabledForRESTAPI`.

   Application `Mail.Send` lets the app send as *any* mailbox in the tenant. If
   that is more than the deployment should have, scope it with an Exchange
   application access policy limiting the app to a mail-enabled security group
   containing only this mailbox.

> **Outstanding, as of this writing.** The registered app currently holds
> `Mail.ReadWrite`, `Mail.Read`, `Mail.ReadBasic`, `Mail.ReadBasic.All` and
> `Mail.Send`. The platform uses only `Mail.Send`; the other four let this
> application read every mailbox in the tenant, which is a far larger blast
> radius than a leaked secret should have. Remove them in the app registration,
> and add the Exchange application access policy above so the remaining
> `Mail.Send` is scoped to the sender mailbox alone. Neither change requires a
> code change.

---

## Configuration

All of it is environment. Nothing is in source; see `.env.example` for the full
annotated list.

| Variable | Notes |
| --- | --- |
| `MAIL_ENABLED` | The single switch. Default `false`. |
| `MAIL_DRY_RUN` | Render and log, never call Graph. |
| `GRAPH_TENANT_ID` | Directory (tenant) ID. |
| `GRAPH_CLIENT_ID` | Application (client) ID. |
| `GRAPH_CLIENT_SECRET` | The secret **value**. A credential. |
| `GRAPH_SENDER_USER` | The mailbox mail is sent as, and the only thing that sets the From address. |
| `GRAPH_BASE_URL` | `https://graph.microsoft.com/v1.0`. |
| `GRAPH_AUTHORITY_URL` | `https://login.microsoftonline.com`. Differs in sovereign clouds. |
| `APP_PUBLIC_URL` | The origin links point at. |
| `MAIL_SUPPORT_EMAIL` | The address every template tells people to write to. |
| `MAIL_SAVE_TO_SENT_ITEMS` | `false`. See below. |
| `EMAIL_VERIFICATION_TTL` / `PASSWORD_RESET_TTL` | `24h` / `60m`. |
| `THROTTLE_MAIL_LIMIT` / `THROTTLE_MAIL_TTL_S` | Per caller **and** per address, on the endpoints that mail somebody. |
| `MAIL_PER_RECIPIENT_LIMIT` / `_WINDOW_S` | A backstop counted in the outbox itself. |
| `MAIL_MAX_ATTEMPTS` | Retries before a transient failure is treated as permanent. |

`MAIL_ENABLED=true` without `MAIL_DRY_RUN` requires the four Graph variables,
and the backend **refuses to start** without them. That is deliberate: the
alternative is finding out from the first person who cannot activate an
account.

`MAIL_SAVE_TO_SENT_ITEMS` is `false` because every message is addressed to one
person about their own account, and retaining thousands of them in a shared
support mailbox builds a record of who signed up and when that no part of the
product needs.

### Locally

The default is mail off. To exercise the whole flow without a mailbox:

```bash
MAIL_ENABLED=true MAIL_DRY_RUN=true npm run dev:backend
```

The rendered message, including the verification link, is written to the
backend log. Paste the link into a browser to finish the flow.

### Production secrets

The secret goes in the deployment's secret store — Coolify's environment for
this platform — and nowhere else. It is not in `.env.example`, not in any
compose file, and not in the repository. `infra/docker/docker-compose.coolify.yml`
names the variables and refuses to start without them; the values live in
Coolify.

---

## How mail actually gets sent

Queued first, sent by a worker. Never inline.

1. Something happens — a signup, a reset request, a sign-in from a new device.
2. A row is written to `notify.mail_outbox` **in the same transaction**. A
   signup that rolls back has emailed nobody.
3. `MailWorker` wakes every `MAIL_WORKER_INTERVAL_MS`, claims due rows with
   `for update skip locked`, and hands each to Microsoft Graph.
4. Graph answers `202 Accepted` and the row becomes `sent`.

**`sent` means Graph took the message. It is not delivery.** Graph returns 202
with an empty body and no message id; a bounce an hour later is invisible from
here.

Failures are sorted into transient and permanent, because the retry policy is
only as good as that distinction. 429, 500, 502, 503, 504 and network errors
are retried with exponential backoff — or with Graph's own `Retry-After` when
it names one, capped at 15 minutes. Everything else (400 on a bad recipient,
403 with `Mail.Send` unconsented, 404 on a missing mailbox) fails on the first
attempt: retrying does nothing except lengthen the queue behind it.

### What the outbox stores, and what it does not

The template name, the subject, the recipient, safe metadata — never a rendered
body. One exception, `payload`, holds the template's variables and therefore
the live token for a verification or reset link. It is erased the moment the
row reaches `sent`, `failed` or `skipped`. The migration
(`infra/db/migrations/0021_mail_and_email_verification.sql`) explains why it
exists and what bounds it.

---

## Verification, and the accounts that predate it

**The product rule:** an account whose address is not verified can sign in, see
who it is, ask for another link, and sign out. It reaches nothing else.
`EmailVerifiedGuard` is registered globally, so a route is closed to unverified
accounts by omission; opening one takes an explicit `@AllowUnverified()`.

The looser alternative — let people in with a banner — is wrong here. An
unverified address means nobody has shown they can read that inbox, while the
account behind it accumulates glucose imports and clinical context. A typo at
signup means the real owner of what was typed can request a password reset and
walk into a stranger's health record. A banner does not close that.

**Accounts created before this shipped were marked verified**, by the backfill
in migration 0021, which records one `identity.email_verified_backfill` audit
event per account. The reasoning is in the migration: the alternative locks
every existing account — including the demo accounts the platform is shown
with — out of the product at the moment the migration lands, silently, having
told nobody a verification email was coming. Those addresses were never
confirmed, which is the state the platform was already in; this stops it
growing rather than fixing it retroactively.

To put a specific pre-existing account through verification:

```sql
update identity.users set email_verified_at = null where lower(email) = lower('...');
```

They will be asked to verify on their next request, and can send themselves a
link from the app.

---

## Runbook

### Turn mail off

```bash
MAIL_ENABLED=false   # then restart the backend
```

Queued rows are left alone and nothing is attempted. New mail is still recorded
— written `skipped` with `last_error = 'MAIL_ENABLED=false'` — so the trail
says what would have gone out. Turning it back on does **not** send the skipped
rows; they are a record, not a backlog. To actually send one, requeue it (see
below).

### Rotate the Graph client secret

1. Create a second client secret in the Entra app registration. Do not delete
   the old one yet — two valid secrets is the whole point of doing it in this
   order.
2. Update `GRAPH_CLIENT_SECRET` in the deployment's secret store.
3. Restart the backend. The cached access token is held in memory only, so a
   restart is what picks up the new secret; there is no cache to clear.
4. Confirm mail is flowing:
   ```sql
   select status, count(*) from notify.mail_outbox
    where created_at > now() - interval '15 minutes' group by status;
   ```
5. Delete the old secret in Entra.

If step 4 shows `failed` rows with `AADSTS7000215`, the new value is wrong —
most often the Secret **ID** was copied instead of the Value.

### Inspect failed mail

```sql
select id, created_at, template, status, attempt_count, left(last_error, 200)
  from notify.mail_outbox
 where status = 'failed'
 order by created_at desc
 limit 50;
```

What the common errors mean:

| `last_error` contains | Cause | Fix |
| --- | --- | --- |
| `ErrorAccessDenied` (403) | Admin consent not granted, or delegated `Mail.Send` instead of application | Grant admin consent on the **application** permission |
| `MailboxNotEnabledForRESTAPI` | `GRAPH_SENDER_USER` has no Exchange licence | Licence the mailbox, or point at one that is |
| `ErrorInvalidRecipients` (400) | The address is not deliverable | Nothing to do; the person mistyped it |
| `AADSTS7000215` | Wrong or expired client secret | Rotate, above |
| `ApplicationThrottled` (429) | Graph throttling | Already retried with `Retry-After`; only investigate if rows reach `failed` |

The recipient's address is in the row. The message body is not, and neither is
the token — by the time a row is `failed`, `payload` is empty.

### Resend failed mail safely

A `failed` row cannot simply be flipped back to `queued`: its `payload` was
erased, so there is nothing left to render. That is a deliberate trade and it
means **requeue at the source, not at the row**.

- **Verification** — ask the person to use "send the link again" on
  `/check-email`, or call the endpoint:
  ```bash
  curl -X POST https://wellovue.com/api/auth/verify-email/resend \
       -H 'content-type: application/json' -d '{"email":"person@example.com"}'
  ```
- **Password reset** — the person requests another from `/forgot-password`.
  There is deliberately no operator path that mints a reset link.
- **Welcome, sign-in notices** — informational. Do not resend; the moment they
  described has passed.

Both endpoints are rate limited per caller and per address. Repeated operator
calls will hit that limit, which is correct.

To see whether a queue is stuck rather than failing:

```sql
select status, count(*), min(next_attempt_at)
  from notify.mail_outbox
 where status in ('queued','sending') group by status;
```

A growing `queued` count with `next_attempt_at` in the past means the worker is
not running — check that `MAIL_ENABLED` is true and that the backend logged
`Mail worker started` at boot.

### Clean up old rows

Outbox rows hold an address and are not needed forever:

```sql
delete from notify.mail_outbox
 where created_at < now() - interval '90 days';
```

The audit trail records that each message was queued and sent, and holds no
address — deliberately, because `audit.events` is append-only and an address
written into it could not be removed when somebody asks to be erased.

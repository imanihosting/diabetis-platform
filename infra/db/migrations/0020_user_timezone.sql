-- 0020: give every account a timezone, because hour-of-day decides findings
--
-- The engine reads glucose and meals as UTC — `pd.to_datetime(..., utc=True)`
-- everywhere — and then takes `.hour` off the result. Three findings depend on
-- that hour: the morning window (05:00-09:00), the late-meal split at 20:00,
-- and the fasting-glucose window.
--
-- For anybody not on UTC those windows are simply wrong. A 20:00 dinner in
-- UTC+10 is logged at 10:00 UTC and counted as an earlier meal; "morning
-- glucose" for the same person reads their evening. The finding is not
-- uncertain, it is about the wrong hours, and it says nothing to indicate that.
--
-- The bug is invisible in development, which is the part worth remembering:
-- `scripts/seed-demo.mjs` authors meals with `setUTCHours`, so the seeded
-- ground truth and the detector agree in UTC and every demo finding looks
-- right.
--
-- On identity.users rather than clinical.diabetes_profiles: where somebody
-- lives is a fact about the person, not about their diabetes, and a profile
-- row is optional while this is needed for anyone with data.
--
-- Defaults to UTC, which preserves today's behaviour exactly for every
-- existing row. That is deliberate: the alternative is guessing, and a guessed
-- timezone produces the same wrong findings while looking like a decision
-- somebody made.
alter table identity.users
  add column if not exists timezone text not null default 'UTC';

comment on column identity.users.timezone is
  'IANA name, e.g. Europe/Dublin. Decides the local hour the engine reads for '
  'morning, fasting and late-meal windows. UTC is the default rather than a '
  'guess from the browser, because a wrong timezone is silently wrong findings.';

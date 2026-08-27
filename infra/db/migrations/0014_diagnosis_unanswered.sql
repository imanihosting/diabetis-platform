-- 0014: clinical — a diagnosis source meaning "nobody has said yet"
--
-- Phase B of docs/diabetes-wide-platform.md. New accounts stop being recorded
-- as Type 2 and start as `unknown` until someone answers the question.
--
-- That needs a source `assumed` cannot carry. `assumed` means the platform
-- filled the gap itself, which is true of the accounts backfilled by migration
-- 0013 and false of an account that has simply not been asked yet. Collapsing
-- the two would lose the only signal that distinguishes "we guessed Type 2" —
-- a claim that could be wrong — from "we have no claim", and the second is not
-- a weaker version of the first.
--
-- Additive: widens a check constraint, changes no rows.

alter table clinical.diabetes_profiles
  drop constraint if exists diagnosis_source_chk;

alter table clinical.diabetes_profiles
  add constraint diagnosis_source_chk check (
    diagnosis_source in (
      'self_reported',
      'clinician',
      'imported',
      -- The platform filled the gap. Migration 0013 backfilled every account
      -- that predated the profile layer this way.
      'assumed',
      -- Nobody has said. The state a new account starts in, and the reason the
      -- evidence screen declines to interpret anything for them.
      'unanswered'
    )
  );

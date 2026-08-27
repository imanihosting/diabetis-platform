-- 0015: clinical — let account erasure remove safety flags
--
-- Fixes a defect introduced by migration 0013.
--
-- `diabetes_safety_flags.user_id` references `identity.users` with
-- `on delete cascade`, and 0013 put a trigger on the table that refuses every
-- DELETE. The two together mean the cascade is refused, so **an account that
-- has ever recorded a safety flag cannot be deleted at all**. Erasing a person
-- fails with "clinical.diabetes_safety_flags is append-only", which is a
-- confusing message for an operation that has nothing to do with rewriting
-- history.
--
-- That is worse than an inconvenience. The platform's position, set out in
-- migration 0010, is that erasure unlinks identity from the audit trail while
-- keeping the trail itself. Everything that is health data about a person —
-- glucose, meals, events — goes with the account. Safety flags are health data
-- about a person, not a record of what the platform did, so they belong in the
-- first group and must go too.
--
-- The append-only guarantee that 0013 wanted is narrower than "no DELETE ever":
-- it is that a flag cannot be rewritten or quietly removed *while the person
-- still has an account*. That is what this preserves.
--
-- The distinction is available to the trigger. PostgreSQL removes the parent
-- row before cascading to children, so inside a cascade-triggered delete the
-- referenced user no longer resolves. Verified against a real database rather
-- than assumed: a probe trigger reports zero visible parent rows during the
-- cascade, and one during a direct delete.

create or replace function clinical.guard_safety_flag_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception
      'clinical.diabetes_safety_flags is append-only; resolve a flag by inserting a row with status = ''inactive''';
  end if;

  -- DELETE. Allowed only as part of removing the account the flag belongs to,
  -- which is the one case where the history has no subject left to protect.
  if exists (select 1 from identity.users where id = old.user_id) then
    raise exception
      'clinical.diabetes_safety_flags is append-only; resolve a flag by inserting a row with status = ''inactive''';
  end if;

  return old;
end;
$$;

drop trigger if exists diabetes_safety_flags_append_only on clinical.diabetes_safety_flags;
create trigger diabetes_safety_flags_append_only
  before update or delete on clinical.diabetes_safety_flags
  for each row execute function clinical.guard_safety_flag_append_only();

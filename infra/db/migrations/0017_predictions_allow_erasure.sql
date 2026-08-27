-- 0017: ai — let account erasure remove predictions
--
-- The same defect migration 0015 fixed for safety flags, here since 0007 and
-- unnoticed because nothing wrote to these tables until now. Two separate
-- blockers, either of which alone makes an account undeletable:
--
--   1. `ai.predictions.user_id` cascades from identity.users, and the
--      immutability trigger refuses every DELETE. The cascade is refused, and
--      erasing the person fails with "rows are immutable and cannot be
--      deleted".
--
--   2. `ai.prediction_outcomes.prediction_id` is `on delete restrict`. Even
--      with the trigger fixed, deleting a prediction that has an outcome is
--      refused by the foreign key.
--
-- The first surfaced the moment a test tried to clean up after writing a
-- prediction. Nobody had written one before.
--
-- The immutability guarantee this platform makes is that a prediction cannot be
-- rewritten or removed *while it belongs to somebody*. That is what makes a
-- record of how often the system was right worth anything: the expectation
-- cannot be revised after the answer is known. It was never a claim that a
-- person cannot leave, and reading it that way turns an accountability feature
-- into a reason erasure fails.
--
-- Predictions are health data about a person — they contain that person's
-- findings and the estimates drawn from their glucose — so they leave with the
-- account, like glucose and meals, and unlike audit.events, which survives with
-- its identity unlinked.
--
-- PostgreSQL removes the parent row before cascading to children, so inside a
-- cascade-triggered delete the referenced user no longer resolves. That is the
-- test the trigger uses, verified against a real database rather than assumed.

create or replace function ai.guard_prediction_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Allowed only as part of removing the account the prediction belongs to,
    -- which is the one case where there is no longer anybody it is a record
    -- about.
    if exists (select 1 from identity.users where id = old.user_id) then
      raise exception 'ai.predictions rows are immutable and cannot be deleted';
    end if;
    return old;
  end if;

  -- Everything except `status` is frozen at write time.
  if (new.id, new.user_id, new.model_version_id, new.prediction_type, new.made_at,
      new.target_at, new.input_snapshot, new.prediction, new.confidence)
     is distinct from
     (old.id, old.user_id, old.model_version_id, old.prediction_type, old.made_at,
      old.target_at, old.input_snapshot, old.prediction, old.confidence)
  then
    raise exception 'ai.predictions is immutable; only status may change';
  end if;

  return new;
end;
$$;

-- An outcome without its prediction is meaningless, so it goes when the
-- prediction does. `restrict` was right while the prediction could never be
-- deleted at all; now that erasure can remove one, it is the second thing
-- blocking erasure.
alter table ai.prediction_outcomes
  drop constraint if exists prediction_outcomes_prediction_id_fkey;

alter table ai.prediction_outcomes
  add constraint prediction_outcomes_prediction_id_fkey
  foreign key (prediction_id) references ai.predictions(id) on delete cascade;

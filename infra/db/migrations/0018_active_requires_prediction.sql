-- 0018: an experiment cannot become active without a prediction
--
-- The landing page's claim is that the prediction is written down before the
-- trial begins and cannot be edited afterwards. Ticket 3 makes the application
-- do that in one transaction. This makes the database refuse anything else,
-- which is where every other safety rule in this platform lives: an invariant
-- enforced only by the code that happens to be calling today is an invariant
-- until somebody writes different code.
--
-- Two pieces are missing before it can be enforced at all.

-- 1. A prediction had no first-class link to its experiment. The experiment was
--    recorded inside `input_snapshot`, which is right for replaying the
--    reasoning and useless to a constraint: nothing can be checked against a
--    value buried in jsonb without trusting its shape.
--
--    Cascading rather than nulling on delete. An orphaned prediction is a
--    record of an expectation about nothing, and the alternative — setting the
--    column null — is an UPDATE that the immutability trigger below refuses
--    anyway. While the user exists this makes an experiment carrying a
--    prediction undeletable, which is the correct direction: the record of
--    what was expected should not be removable by deleting the thing it was
--    about.
alter table ai.predictions
  add column if not exists experiment_id uuid
    references experiments.experiments(id) on delete cascade;

create index if not exists predictions_experiment_idx
  on ai.predictions (experiment_id) where experiment_id is not null;

-- 2. `experiment_id` has to be frozen like everything else. Left mutable, a
--    prediction could be moved onto a different experiment after the fact,
--    which is the same failure as editing it: the expectation would end up
--    attached to a question it was not made about.
create or replace function ai.guard_prediction_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Allowed only as part of removing the account the prediction belongs to.
    if exists (select 1 from identity.users where id = old.user_id) then
      raise exception 'ai.predictions rows are immutable and cannot be deleted';
    end if;
    return old;
  end if;

  if (new.id, new.user_id, new.model_version_id, new.prediction_type, new.made_at,
      new.target_at, new.input_snapshot, new.prediction, new.confidence,
      new.experiment_id)
     is distinct from
     (old.id, old.user_id, old.model_version_id, old.prediction_type, old.made_at,
      old.target_at, old.input_snapshot, old.prediction, old.confidence,
      old.experiment_id)
  then
    raise exception 'ai.predictions is immutable; only status may change';
  end if;

  return new;
end;
$$;

-- The invariant itself.
--
-- Checked on the transition rather than on every write, so an experiment that
-- is already active stays writable for the fields a later ticket will need
-- (ended_at, completion). Insert is covered too: without it, a row could be
-- created active and skip the transition entirely.
--
-- AFTER, not BEFORE, and that matters. A BEFORE trigger runs ahead of the check
-- constraints from migration 0006, so it would answer first for a row that
-- those constraints were going to refuse anyway — an active blocked experiment
-- would be rejected for having no prediction rather than for being blocked.
-- Both refusals are correct and the wrong one is less useful, and worse, the
-- constraints would stop being exercised by anything. Running afterwards keeps
-- `experiments_blocked_chk` and `experiments_gate_chk` as the first answer for
-- what they cover, and leaves this one to catch what they do not.
create or replace function experiments.guard_active_requires_prediction()
returns trigger language plpgsql as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
  then
    if not exists (
      select 1 from ai.predictions p where p.experiment_id = new.id
    ) then
      raise exception
        'an experiment cannot become active without a prediction recorded first';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists experiments_active_requires_prediction on experiments.experiments;
create trigger experiments_active_requires_prediction
  after insert or update on experiments.experiments
  for each row execute function experiments.guard_active_requires_prediction();

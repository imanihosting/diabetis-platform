-- 0019: an experiment cannot be completed without a measured outcome, and an
-- outcome cannot be rewritten once it is recorded
--
-- Migration 0018 closed one half of the accountability claim: nothing becomes
-- active without a prediction written first. This closes the other half. A loop
-- that can write down what it expects and then finish without ever saying what
-- happened produces exactly the record a system would keep if it wanted the
-- flattering half only.
--
-- All three guarantees live here rather than in the service that happens to be
-- calling today, for the reason every other safety rule in this platform does.

-- 1. An outcome is written once and never edited.
--
--    Until now this was true only because no code updated the table. The unique
--    constraint on `prediction_id` stops a second row; nothing stopped the
--    first one being rewritten. That is the same defect as an editable
--    prediction and it lands in the same place: a disappointing result quietly
--    becoming a better one, and every accuracy figure downstream turning into
--    a claim about the last time somebody edited the table.
--
--    DELETE follows the rule migrations 0015 and 0017 settled: immutable means
--    "cannot be revised while it belongs to somebody", not "can never be
--    removed". `prediction_outcomes` cascades from `ai.predictions`, which
--    cascades from `identity.users`, and PostgreSQL removes a parent row before
--    cascading to its children — so inside an erasure the parent prediction no
--    longer resolves, and that is what tells erasure apart from tampering.
create or replace function ai.guard_outcome_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from ai.predictions where id = old.prediction_id) then
      raise exception 'ai.prediction_outcomes rows are immutable and cannot be deleted';
    end if;
    return old;
  end if;

  -- No column of an outcome is revisable. Unlike a prediction, which has a
  -- status that legitimately advances, there is nothing here that changes
  -- after the fact: what was observed, when, and how it scored are all fixed
  -- at the moment of writing.
  raise exception 'ai.prediction_outcomes is immutable; an outcome is recorded once';
end;
$$;

drop trigger if exists prediction_outcomes_immutable on ai.prediction_outcomes;
create trigger prediction_outcomes_immutable
  before update or delete on ai.prediction_outcomes
  for each row execute function ai.guard_outcome_immutability();

-- 2. One experiment, one prediction.
--
--    0018 gave the link a column and required at least one row; nothing stopped
--    a second. Two expectations attached to the same trial makes "what was
--    predicted" a question with two answers, and any screen or report showing
--    one of them is choosing which — after the fact, which is the one thing
--    this table exists to prevent.
--
--    Partial, because rows written before 0018 have no experiment and are not
--    in competition with anything.
create unique index if not exists predictions_one_per_experiment
  on ai.predictions (experiment_id) where experiment_id is not null;

-- 3. Completion requires the measurement.
--
--    Checked on the transition, and AFTER rather than BEFORE, for the same two
--    reasons as 0018: an experiment already completed stays writable, and the
--    check constraints from 0006 keep the first answer for what they cover.
--
--    `abandoned` is deliberately not guarded. Giving up on an experiment
--    without measuring it is an honest end, and the status says so — it is
--    completion specifically that asserts there is an answer.
create or replace function experiments.guard_completed_requires_outcome()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
  then
    if not exists (
      select 1
        from ai.predictions p
        join ai.prediction_outcomes o on o.prediction_id = p.id
       where p.experiment_id = new.id
    ) then
      raise exception
        'an experiment cannot be completed without an outcome recorded against its prediction';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists experiments_completed_requires_outcome on experiments.experiments;
create trigger experiments_completed_requires_outcome
  after insert or update on experiments.experiments
  for each row execute function experiments.guard_completed_requires_outcome();

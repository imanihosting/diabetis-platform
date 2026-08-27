-- 0016: experiments — record what the safety decision was about
--
-- `experiments.experiments` stored `safety_status` and
-- `clinician_review_required` but not the template they were derived from. The
-- decision was persisted without its subject: a row saying "blocked" with no
-- record of what had been asked.
--
-- That is thin for an audit trail and impossible for anything downstream. A
-- prediction has to know what the experiment tests before it can predict
-- anything about it, and reconstructing that from the title is guesswork.
--
-- Nullable rather than not-null. Rows written before this column existed
-- cannot have one, and inventing a value for them would put a claim in the
-- record that nobody made. Everything the service writes from here on has it.

alter table experiments.experiments
  add column if not exists template text;

comment on column experiments.experiments.template is
  'The experiment template this row was classified as. Null only for rows written before migration 0016.';

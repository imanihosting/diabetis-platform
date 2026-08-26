-- 0010: let the audit trail survive user erasure
--
-- `audit.events` is append-only, but its actor/subject columns reference
-- identity.users with `on delete set null`. That cascade performs an UPDATE,
-- which the original guard rejected — so deleting a user failed outright.
--
-- Two requirements have to hold together:
--   * the record of what happened must never be rewritten, and
--   * a person must be able to have their identity unlinked from it.
--
-- So the guard now permits exactly one kind of update: clearing the user
-- references while every other column stays byte-for-byte identical. That is
-- anonymisation, not revision. Everything else — including any DELETE — is
-- still refused.

create or replace function audit.guard_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit.events is append-only and cannot be deleted';
  end if;

  if (new.id, new.action, new.resource_type, new.resource_id, new.metadata, new.occurred_at)
     is distinct from
     (old.id, old.action, old.resource_type, old.resource_id, old.metadata, old.occurred_at)
  then
    raise exception 'audit.events is append-only; only actor/subject may be cleared for erasure';
  end if;

  -- The only permitted change is clearing a reference, never repointing it.
  if (new.actor_user_id is not null and new.actor_user_id is distinct from old.actor_user_id)
     or (new.subject_user_id is not null and new.subject_user_id is distinct from old.subject_user_id)
  then
    raise exception 'audit.events actor/subject may only be cleared, not reassigned';
  end if;

  return new;
end;
$$;

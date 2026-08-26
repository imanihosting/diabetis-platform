-- 0012: support — inbound messages from the contact page
--
-- Its own schema rather than a table in `identity`: these arrive from people
-- who may never become users, and the contents are correspondence, not a
-- record of who someone is.

create schema if not exists support;

create table if not exists support.contact_messages (
  id           uuid primary key default gen_random_uuid(),
  name         text,
  email        text not null,
  topic        text not null,
  message      text not null,
  -- Set when a signed-in user sends the message; null for anonymous senders.
  user_id      uuid references identity.users(id) on delete set null,
  status       text not null default 'new',
  created_at   timestamptz not null default now(),
  constraint contact_messages_status_chk check (status in ('new', 'read', 'answered', 'spam')),
  constraint contact_messages_topic_chk
    check (topic in ('general', 'account', 'data', 'clinician', 'press'))
);

create index if not exists contact_messages_status_idx
  on support.contact_messages (status, created_at desc);

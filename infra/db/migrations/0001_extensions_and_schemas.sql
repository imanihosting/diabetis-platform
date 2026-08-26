-- 0001: extensions + domain schemas
-- Idempotent. Safe to re-run.

create extension if not exists timescaledb;
create extension if not exists vector;
create extension if not exists pgcrypto;

create schema if not exists identity;
create schema if not exists clinical;
create schema if not exists metabolic;
create schema if not exists nutrition;
create schema if not exists experiments;
create schema if not exists ai;
create schema if not exists devices;
create schema if not exists integrations;
create schema if not exists audit;
create schema if not exists billing;

-- Shared trigger: keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

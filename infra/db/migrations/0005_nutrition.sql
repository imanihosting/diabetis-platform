-- 0005: nutrition — meals and meal items

create table if not exists nutrition.meals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references identity.users(id) on delete cascade,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  meal_type         text,
  description       text,
  -- Object key in the S3 bucket. The bytes never live in Postgres.
  photo_object_key  text,
  source            text not null,
  confidence        numeric not null default 1.0,
  created_at        timestamptz not null default now(),
  constraint meals_type_chk       check (meal_type is null or meal_type in ('breakfast','lunch','dinner','snack','other')),
  constraint meals_confidence_chk check (confidence >= 0 and confidence <= 1),
  constraint meals_range_chk      check (ended_at is null or ended_at >= started_at)
);
create index if not exists meals_user_time_idx on nutrition.meals (user_id, started_at desc);

create table if not exists nutrition.meal_items (
  id                  uuid primary key default gen_random_uuid(),
  meal_id             uuid not null references nutrition.meals(id) on delete cascade,
  item_name           text not null,
  estimated_carbs_g   numeric,
  estimated_protein_g numeric,
  estimated_fat_g     numeric,
  estimated_fiber_g   numeric,
  portion_text        text,
  confidence          numeric not null default 0.5,
  created_at          timestamptz not null default now(),
  constraint meal_items_confidence_chk check (confidence >= 0 and confidence <= 1)
);
create index if not exists meal_items_meal_idx on nutrition.meal_items (meal_id);

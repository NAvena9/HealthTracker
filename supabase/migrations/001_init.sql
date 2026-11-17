-- 001_init.sql  --  Proof of Work: core schema (Postgres / Supabase)
-- Binding docs: docs/00_CONTEXT_AND_DECISIONS.md, docs/01_PRD_AND_BUSINESS_RULES.md
-- Column names mirror code/src/lib/domain/types.ts (snake_case) 1:1.
-- Uses gen_random_uuid() (built in since PG13). No extensions required.
-- Empty is not zero: nutrition/steps/weight/energy columns are NULLABLE with NO default.

-- =====================================================================
-- Helper: updated_at
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- user_settings
-- =====================================================================
create table public.user_settings (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  timezone            text not null default 'America/Hermosillo',
  program_start_date  date,
  strong_default_unit text not null default 'lb' check (strong_default_unit in ('kg', 'lb')),
  appearance          text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint user_settings_program_start_is_monday
    check (program_start_date is null or extract(isodow from program_start_date) = 1)
);
comment on table public.user_settings is 'One row per user. program_start_date must be a Monday (week 1 = the week starting that date).';

-- =====================================================================
-- sync_credentials  (service role only; hash is never readable by browser)
-- =====================================================================
create table public.sync_credentials (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  secret_hash  text not null unique,           -- sha256 hex of the webhook secret
  secret_last4 text,
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz
);
comment on table public.sync_credentials is 'Webhook secret hash. RLS enabled with NO client policies: only the service role can read/write.';

-- =====================================================================
-- phases
-- =====================================================================
create table public.phases (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  name                     text not null,
  start_date               date not null,
  end_date                 date,
  start_weight_kg          numeric(5,2) check (start_weight_kg is null or start_weight_kg between 30 and 300),
  target_weight_kg         numeric(5,2) check (target_weight_kg is null or target_weight_kg between 30 and 300),
  -- ACTIVE day macro goals
  active_protein_g         integer not null default 190 check (active_protein_g between 0 and 2000),
  active_carbs_g           integer not null default 240 check (active_carbs_g between 0 and 2000),
  active_fat_g             integer not null default 70  check (active_fat_g between 0 and 2000),
  active_kcal              integer not null default 2350 check (active_kcal between 0 and 10000),
  -- REST day macro goals
  rest_protein_g           integer not null default 190 check (rest_protein_g between 0 and 2000),
  rest_carbs_g             integer not null default 200 check (rest_carbs_g between 0 and 2000),
  rest_fat_g               integer not null default 60  check (rest_fat_g between 0 and 2000),
  rest_kcal                integer not null default 2100 check (rest_kcal between 0 and 10000),
  daily_step_goal          integer not null default 10000 check (daily_step_goal between 0 and 100000),
  weekly_step_goal         integer not null default 70000 check (weekly_step_goal between 0 and 700000),
  weekly_weighin_goal      integer not null default 3 check (weekly_weighin_goal between 0 and 7),
  weekly_cardio_sessions   integer check (weekly_cardio_sessions is null or weekly_cardio_sessions between 0 and 21),
  weekly_strength_sessions integer check (weekly_strength_sessions is null or weekly_strength_sessions between 0 and 21),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint phases_end_after_start check (end_date is null or end_date >= start_date)
);
-- At most one open phase per user.
create unique index phases_one_open_per_user on public.phases (user_id) where end_date is null;
create index phases_user_start_idx on public.phases (user_id, start_date);
comment on table public.phases is 'Goal phases. GoalsSnapshot mapping: active={active_protein_g,active_carbs_g,active_fat_g,active_kcal->calories_kcal}, rest likewise, plus daily_step_goal, weekly_step_goal, weekly_weighin_goal, weekly_cardio_sessions, weekly_strength_sessions, target_weight_kg.';

-- =====================================================================
-- weekly_checkins
-- =====================================================================
create table public.weekly_checkins (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  week_start_date       date not null,
  phase_id              uuid references public.phases (id) on delete set null,
  goals_snapshot        jsonb not null,
  waist_cm              numeric(5,1) check (waist_cm is null or waist_cm between 10 and 300),
  hip_cm                numeric(5,1) check (hip_cm   is null or hip_cm   between 10 and 300),
  chest_cm              numeric(5,1) check (chest_cm is null or chest_cm between 10 and 300),
  arm_cm                numeric(5,1) check (arm_cm   is null or arm_cm   between 10 and 300),
  leg_cm                numeric(5,1) check (leg_cm   is null or leg_cm   between 10 and 300),
  photo_front_path      text,
  photo_side_path       text,
  photo_back_path       text,
  external_folder_url   text,
  reflection_highlights text,
  reflection_hard       text,
  reflection_next_goals text,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint weekly_checkins_week_is_monday check (extract(isodow from week_start_date) = 1),
  constraint weekly_checkins_user_week_unique unique (user_id, week_start_date)
);
comment on table public.weekly_checkins is 'Maps to types.ts WeeklyCheckin (all keys are columns; goals_snapshot is jsonb shaped as GoalsSnapshot). closed_at not null = locked week.';

-- =====================================================================
-- daily_logs
-- =====================================================================
create table public.daily_logs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  log_date               date not null,
  week_start_date        date not null,
  day_type               text not null default 'ACTIVE' check (day_type in ('ACTIVE', 'REST')),
  weight_kg              numeric(5,2)  check (weight_kg between 30 and 300),
  steps                  integer       check (steps between 0 and 100000),
  protein_g              numeric(6,1)  check (protein_g between 0 and 2000),
  carbs_g                numeric(6,1)  check (carbs_g between 0 and 2000),
  fat_g                  numeric(6,1)  check (fat_g between 0 and 2000),
  calories_kcal          integer       check (calories_kcal between 0 and 10000),
  resting_kcal           integer       check (resting_kcal between 0 and 10000),
  active_kcal_total      integer       check (active_kcal_total between 0 and 10000),
  edited_fields          text[] not null default '{}',
  apple_health_synced_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint daily_logs_week_is_monday check (extract(isodow from week_start_date) = 1),
  constraint daily_logs_week_matches_date check (week_start_date = log_date - (extract(isodow from log_date)::int - 1)),
  constraint daily_logs_edited_fields_valid check (
    edited_fields <@ array['weight_kg','steps','protein_g','carbs_g','fat_g','calories_kcal','resting_kcal','active_kcal_total']::text[]
  ),
  constraint daily_logs_user_date_unique unique (user_id, log_date)
);
create index daily_logs_user_week_idx on public.daily_logs (user_id, week_start_date);
comment on table public.daily_logs is 'Maps to types.ts DailyLog (log_date, week_start_date, day_type, weight_kg, steps, protein_g, carbs_g, fat_g, calories_kcal, resting_kcal, active_kcal_total, edited_fields, apple_health_synced_at). Sync payload field active_kcal -> active_kcal_total. Nullable columns have NO default: empty is not zero.';
comment on column public.daily_logs.active_kcal_total is 'Apple Health Active Energy for the whole day (types.ts active_kcal_total). Sync payload name: active_kcal.';
comment on column public.daily_logs.edited_fields is 'Fields typed by hand; sync must never overwrite them (types.ts edited_fields).';

-- =====================================================================
-- workouts
-- =====================================================================
create table public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  log_date        date not null,
  week_start_date date not null,
  category        text not null check (category in ('CARDIO', 'STRENGTH')),
  type_label      text not null,
  active_kcal     integer      check (active_kcal between 0 and 5000),
  duration_min    numeric(6,1) check (duration_min >= 0),
  started_at      timestamptz,
  source          text not null check (source in ('apple_health', 'manual', 'strong')),
  volume_kg       numeric(8,1) check (volume_kg >= 0),
  strong_title    text,
  strong_raw_txt  text,
  strong_parsed   jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint workouts_week_is_monday check (extract(isodow from week_start_date) = 1),
  constraint workouts_week_matches_date check (week_start_date = log_date - (extract(isodow from log_date)::int - 1))
);
create index workouts_user_week_idx on public.workouts (user_id, week_start_date);
create index workouts_user_date_idx on public.workouts (user_id, log_date);
-- Dedupe of synced sessions (doc 01 section 4).
create unique index workouts_dedupe_started
  on public.workouts (user_id, log_date, type_label, started_at)
  where started_at is not null;
create unique index workouts_dedupe_no_start
  on public.workouts (user_id, log_date, type_label, active_kcal)
  where started_at is null and source = 'apple_health';
comment on table public.workouts is 'Maps to types.ts Workout (id, log_date, category, type_label, active_kcal, duration_min, started_at, source, volume_kg, strong_title, strong_raw_txt, strong_parsed[jsonb = StrongParseResult]).';

-- =====================================================================
-- updated_at triggers
-- =====================================================================
create trigger trg_user_settings_updated_at   before update on public.user_settings   for each row execute function public.set_updated_at();
create trigger trg_phases_updated_at          before update on public.phases          for each row execute function public.set_updated_at();
create trigger trg_weekly_checkins_updated_at before update on public.weekly_checkins for each row execute function public.set_updated_at();
create trigger trg_daily_logs_updated_at      before update on public.daily_logs      for each row execute function public.set_updated_at();
create trigger trg_workouts_updated_at        before update on public.workouts        for each row execute function public.set_updated_at();

-- =====================================================================
-- Closed-week lock
--   daily_logs / workouts: INSERT, UPDATE, DELETE rejected when the row's week
--   (old or new) has weekly_checkins.closed_at not null.
--   weekly_checkins: UPDATE/DELETE of a closed row rejected, EXCEPT
--     (a) the update that sets closed_at to null (reopen), and
--     (b) ON DELETE SET NULL from phases (only phase_id -> null changes).
--   Cascade deletion of the owning auth user is always allowed.
--   Applies to every role including service_role (defense in depth for sync).
--   NOTE: INSERT is blocked too (stricter than "UPDATE/DELETE" in the brief) so
--   nothing can be added to a locked record.
-- =====================================================================
create or replace function public.week_is_closed(p_user uuid, p_week date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.weekly_checkins
    where user_id = p_user and week_start_date = p_week and closed_at is not null
  );
$$;
revoke all on function public.week_is_closed(uuid, date) from public;

create or replace function public.enforce_closed_week_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- user being deleted (auth.users cascade): allow
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if public.week_is_closed(old.user_id, old.week_start_date) then
      raise exception 'week % is closed; reopen it before changing % rows', old.week_start_date, tg_table_name
        using errcode = 'P0001', hint = 'closed_week';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if public.week_is_closed(new.user_id, new.week_start_date) then
      raise exception 'week % is closed; reopen it before changing % rows', new.week_start_date, tg_table_name
        using errcode = 'P0001', hint = 'closed_week';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_checkin_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.closed_at is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;  -- user deletion cascade
    end if;
    raise exception 'week % is closed; reopen it before deleting', old.week_start_date
      using errcode = 'P0001', hint = 'closed_week';
  end if;

  -- UPDATE on a closed row
  if new.closed_at is null then
    return new;    -- reopen
  end if;
  if new.phase_id is null and old.phase_id is not null
     and (to_jsonb(new) - 'phase_id' - 'updated_at') = (to_jsonb(old) - 'phase_id' - 'updated_at') then
    return new;    -- phases ON DELETE SET NULL
  end if;
  raise exception 'week % is closed; reopen it before editing', old.week_start_date
    using errcode = 'P0001', hint = 'closed_week';
end;
$$;

create trigger trg_daily_logs_closed_lock
  before insert or update or delete on public.daily_logs
  for each row execute function public.enforce_closed_week_lock();
create trigger trg_workouts_closed_lock
  before insert or update or delete on public.workouts
  for each row execute function public.enforce_closed_week_lock();
create trigger trg_weekly_checkins_closed_lock
  before update or delete on public.weekly_checkins
  for each row execute function public.enforce_checkin_lock();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.user_settings    enable row level security;
alter table public.sync_credentials enable row level security;  -- no policies: service role only
alter table public.phases           enable row level security;
alter table public.weekly_checkins  enable row level security;
alter table public.daily_logs       enable row level security;
alter table public.workouts         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['user_settings','phases','weekly_checkins','daily_logs','workouts'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- sync_credentials: no access for client roles at all.
revoke all on public.sync_credentials from anon, authenticated;
grant all on public.sync_credentials to service_role;

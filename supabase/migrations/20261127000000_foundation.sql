-- Phase 0 foundation schema.
-- Measurements from buoys and forecasts are stored in metric as received.
-- Rules, thresholds, reports and the angler's log use feet, mph and F, the units
-- their sources and the angler use; they are named with their unit.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Owner (admin) identity
-- ---------------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- No policies: only the service role reads or writes this table directly.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- Places and stations
-- ---------------------------------------------------------------------------
create table public.ports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null,
  lake text not null default 'michigan',
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  shore text not null check (shore in ('east', 'west')),
  home_river text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, state)
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ndbc', 'seagull', 'nws')),
  external_id text not null,
  name text not null,
  lake text not null default 'michigan',
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  has_temp_profile boolean not null default false,
  seasonal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.port_stations (
  id uuid primary key default gen_random_uuid(),
  port_id uuid not null references public.ports (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  distance_mi numeric(6, 1) not null check (distance_mi >= 0),
  rank int not null check (rank >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (port_id, station_id),
  unique (port_id, rank)
);

-- ---------------------------------------------------------------------------
-- Cached conditions
-- ---------------------------------------------------------------------------
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete cascade,
  observed_at timestamptz not null,
  wind_dir_deg numeric(4, 1) check (wind_dir_deg >= 0 and wind_dir_deg <= 360),
  wind_speed_ms numeric(5, 2) check (wind_speed_ms >= 0),
  wave_height_m numeric(4, 2) check (wave_height_m >= 0),
  air_temp_c numeric(4, 1),
  water_temp_c numeric(4, 1),
  temp_profile jsonb, -- [{ "depth_m": 0, "temp_c": 0 }, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, observed_at)
);
create index observations_station_time on public.observations (station_id, observed_at desc);

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  port_id uuid not null references public.ports (id) on delete cascade,
  valid_at timestamptz not null,
  sky_cover_pct numeric(4, 1) check (sky_cover_pct between 0 and 100),
  wind_dir_deg numeric(4, 1) check (wind_dir_deg >= 0 and wind_dir_deg <= 360),
  wind_speed_ms numeric(5, 2) check (wind_speed_ms >= 0),
  hazards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (port_id, valid_at)
);

-- ---------------------------------------------------------------------------
-- Fishing reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'michigan_dnr',
  source_url text not null unique,
  report_date date not null,
  raw_text text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  port_id uuid not null references public.ports (id) on delete cascade,
  species text not null,
  source_paragraph text, -- shown beside the row in the review queue
  water_depth_min_ft numeric(5, 1),
  water_depth_max_ft numeric(5, 1),
  lure_depth_min_ft numeric(5, 1),
  lure_depth_max_ft numeric(5, 1),
  lures text[] not null default '{}',
  colors text[] not null default '{}',
  water_temp_f numeric(4, 1),
  break_depth_ft numeric(5, 1),
  notes text,
  passed_validation boolean not null default false,
  review_status text not null default 'auto' check (review_status in ('auto', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index report_rows_port on public.report_rows (port_id, species);

-- Only auto rows that passed validation and approved rows feed recommendations.
create view public.usable_report_rows with (security_invoker = true) as
  select rr.*, r.report_date, r.source_url
  from public.report_rows rr
  join public.reports r on r.id = rr.report_id
  where rr.review_status = 'approved'
     or (rr.review_status = 'auto' and rr.passed_validation);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.lures (
  id uuid primary key default gen_random_uuid(),
  lure_type text not null check (lure_type in ('spoon', 'plug', 'fly', 'meat_rig', 'attractor')),
  name text not null,
  brand text,
  is_house_brand boolean not null default false,
  size_in numeric(4, 2),
  body_style text,
  speed_min_mph numeric(3, 1),
  speed_max_mph numeric(3, 1),
  dive_notes text,
  photo_url text,
  shop_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lure_type, name),
  check (speed_min_mph is null or speed_max_mph is null or speed_min_mph <= speed_max_mph),
  -- Only the owner's own lures carry a shop link.
  check (shop_url is null or is_house_brand)
);

create table public.lure_finishes (
  id uuid primary key default gen_random_uuid(),
  lure_id uuid not null references public.lures (id) on delete cascade,
  name text not null,
  base_color text not null,
  finish_types text[] not null check (
    cardinality(finish_types) >= 1
    and finish_types <@ array['chrome', 'glow', 'fluorescent', 'uv', 'paint']
  ),
  pattern text,
  color_family text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lure_id, name)
);

-- ---------------------------------------------------------------------------
-- Rules and thresholds, as data
-- ---------------------------------------------------------------------------
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  priority int not null,
  stage text not null check (stage in ('location', 'depth', 'presentation', 'color', 'speed', 'tip')),
  "when" jsonb not null,
  recommend jsonb not null,
  tags text[] not null check (
    cardinality(tags) between 1 and 2 and tags <@ array['science', 'reports', 'lore']
  ),
  source_note text not null,
  lakes text[] not null default array['michigan'],
  species text not null default 'chinook',
  enabled boolean not null default true,
  version int not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.thresholds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  value jsonb, -- number, { "min": n, "max": n }, or null for a placeholder with no value
  unit text not null,
  is_owner_estimate boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Recommendation audit
-- ---------------------------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  port_id uuid not null references public.ports (id) on delete cascade,
  requested_for date not null,
  cache_key text,
  context jsonb not null,
  engine_output jsonb not null,
  agent_output jsonb,
  used_fallback boolean not null default false,
  model text,
  prompt_version text,
  temp_source_level int not null check (temp_source_level between 0 and 5),
  confidence text check (confidence in ('low', 'medium', 'high')),
  latency_ms int check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recommendations_cache on public.recommendations (cache_key, created_at desc);
create index recommendations_user on public.recommendations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Trolling log. Ids are client-generated so offline retries cannot duplicate.
-- ---------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  port_id uuid not null references public.ports (id),
  started_at timestamptz not null,
  ended_at timestamptz,
  lines jsonb not null default '[]'::jsonb, -- line names, set once per trip
  clarity text check (clarity in ('clear', 'stained', 'murky', 'unknown')),
  speed_source text check (speed_source in ('gps', 'probe')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index trips_user on public.trips (user_id, started_at desc);

-- A pass is written when it ends, so outcome is always known.
create table public.passes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  line_name text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  lure_type text not null check (lure_type in ('spoon', 'flasher_fly', 'meat_rig', 'plug')),
  lure_id uuid references public.lures (id),
  finish_id uuid references public.lure_finishes (id),
  attractor_id uuid references public.lures (id),
  attractor_finish_id uuid references public.lure_finishes (id),
  leader_in numeric(4, 1) check (leader_in > 0),
  lure_depth_ft numeric(5, 1) check (lure_depth_ft between 0 and 400),
  speed_mph numeric(3, 1) check (speed_mph between 0 and 10),
  speed_source text check (speed_source in ('gps', 'probe')),
  lure_temp_f numeric(4, 1) check (lure_temp_f between 32 and 85),
  break_depth_ft numeric(5, 1) check (break_depth_ft between 0 and 400),
  water_depth_ft numeric(6, 1) check (water_depth_ft between 0 and 1000),
  clarity text check (clarity in ('clear', 'stained', 'murky', 'unknown')),
  sky text check (sky in ('bright', 'overcast', 'low_light')),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  outcome text not null check (outcome in ('no_hit', 'hit', 'landed')),
  hit_at timestamptz,
  species text,
  notes text, -- bait type on meat rigs, anything else
  conditions_snapshot jsonb not null default '{}'::jsonb,
  recommendation_id uuid references public.recommendations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index passes_trip on public.passes (trip_id, started_at);
create index passes_recommendation on public.passes (recommendation_id);

-- ---------------------------------------------------------------------------
-- The angler's own data
-- ---------------------------------------------------------------------------
create table public.probe_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete cascade,
  taken_at timestamptz not null,
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  profile jsonb, -- up to six { "depth_ft": n, "temp_f": n } pairs; optional
  break_depth_ft numeric(5, 1) check (break_depth_ft between 0 and 400),
  speed_at_ball_mph numeric(3, 1) check (speed_at_ball_mph between 0 and 10),
  surface_speed_mph numeric(3, 1) check (surface_speed_mph between 0 and 10),
  ball_depth_ft numeric(5, 1) check (ball_depth_ft between 0 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile is not null or break_depth_ft is not null)
);
create index probe_readings_user on public.probe_readings (user_id, taken_at desc);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_type text not null check (subject_type in ('port', 'lure', 'trip', 'pattern')),
  subject_id uuid, -- null for a standalone pattern note
  body text not null check (length(body) between 1 and 4000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_type = 'pattern' or subject_id is not null)
);
create index notes_user_subject on public.notes (user_id, subject_type, subject_id);

-- Row-level security does not apply to materialized views, so the view lives in
-- a schema the API roles cannot reach and is read through a filtered view.
create schema if not exists private;
revoke all on schema private from public;

create materialized view private.personal_results as
  select
    t.user_id,
    t.port_id,
    extract(month from p.started_at at time zone 'America/Detroit')::int as month,
    (floor(p.lure_depth_ft / 10) * 10)::int as depth_band, -- lower edge of a 10 ft band
    p.lure_type,
    p.lure_id,
    p.finish_id,
    (floor(p.speed_mph / 0.2) * 0.2)::numeric(3, 1) as speed_band, -- lower edge of a 0.2 mph band
    count(*)::int as passes,
    (count(*) filter (where p.outcome in ('hit', 'landed')))::int as hits,
    (sum(extract(epoch from (p.ended_at - p.started_at))) / 3600.0)::numeric(8, 2) as hours
  from public.passes p
  join public.trips t on t.id = p.trip_id
  group by 1, 2, 3, 4, 5, 6, 7, 8;
create index personal_results_user on private.personal_results (user_id, port_id, month);

create view public.personal_results as
  select * from private.personal_results where user_id = (select auth.uid());

create or replace function public.refresh_personal_results() returns void
language sql security definer set search_path = '' as $$
  refresh materialized view private.personal_results
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ports', 'stations', 'port_stations', 'observations', 'forecasts', 'reports',
    'report_rows', 'lures', 'lure_finishes', 'rules', 'thresholds',
    'recommendations', 'trips', 'passes', 'probe_readings', 'notes'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Public read, owner write: catalog, ports, stations, rules, thresholds, cached conditions.
do $$
declare t text;
begin
  foreach t in array array[
    'ports', 'stations', 'port_stations', 'lures', 'lure_finishes', 'rules',
    'thresholds', 'observations', 'forecasts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

-- Reports: the owner reviews them; anglers see them only through server routes.
do $$
declare t text;
begin
  foreach t in array array['reports', 'report_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_all on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

-- Recommendations are written by the server. An angler can read their own; the owner reads all.
alter table public.recommendations enable row level security;
create policy own_or_admin_read on public.recommendations for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- The angler's own data: owner of the row only. Not even the app owner reads it through the API.
do $$
declare t text;
begin
  foreach t in array array['trips', 'probe_readings', 'notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.passes enable row level security;
create policy own_rows on public.passes for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = (select auth.uid())));

revoke all on public.personal_results from anon;
grant select on public.personal_results to authenticated;
revoke execute on function public.refresh_personal_results() from public, anon, authenticated;
grant execute on function public.refresh_personal_results() to service_role;

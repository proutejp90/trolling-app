-- NOAA lake model (Phase 2b): sample points off each port, modeled temperature profiles,
-- checks of the model against measurements, and forecast waves.

create table if not exists public.model_points (
  id uuid primary key default gen_random_uuid(),
  port_id uuid not null references public.ports (id) on delete cascade,
  label text not null check (label in ('near', 'mid', 'off')),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  node_index int not null check (node_index >= 0),
  bottom_depth_m numeric(6, 2) not null check (bottom_depth_m > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (port_id, label)
);

-- One profile per point per hour. A newer run replaces an older run's value for the same hour.
create table if not exists public.model_profiles (
  id uuid primary key default gen_random_uuid(),
  model_point_id uuid not null references public.model_points (id) on delete cascade,
  run_at timestamptz not null,
  valid_at timestamptz not null,
  is_forecast boolean not null,
  profile jsonb not null,
  surface_temp_c numeric(5, 2),
  break_depth_m numeric(6, 2) check (break_depth_m >= 0),
  band_depth_m numeric(6, 2) check (band_depth_m >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_point_id, valid_at)
);
create index if not exists model_profiles_valid on public.model_profiles (valid_at);

create table if not exists public.model_checks (
  id uuid primary key default gen_random_uuid(),
  model_point_id uuid not null references public.model_points (id) on delete cascade,
  checked_at timestamptz not null,
  measured_source text not null check (measured_source in ('buoy', 'probe')),
  measured_break_m numeric(6, 2) not null,
  modeled_break_m numeric(6, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wave_forecasts (
  id uuid primary key default gen_random_uuid(),
  model_point_id uuid not null references public.model_points (id) on delete cascade,
  run_at timestamptz not null,
  valid_at timestamptz not null,
  wave_height_m numeric(5, 2) check (wave_height_m >= 0),
  peak_period_s numeric(5, 2) check (peak_period_s >= 0),
  direction_deg numeric(4, 1) check (direction_deg >= 0 and direction_deg <= 360),
  source text not null check (source in ('glwu', 'nws_grid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_point_id, valid_at, source)
);

do $$
declare t text;
begin
  foreach t in array array['model_points', 'model_profiles', 'model_checks', 'wave_forecasts'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop policy if exists admin_delete on public.%I', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

insert into public.thresholds (name, value, unit, is_owner_estimate, note) values
  ('model_max_age_h', '12', 'h', false, 'The lake model is skipped when its latest run is older than this.'),
  ('model_agree_ft', '10', 'ft', true, 'A buoy or probe within this of the model''s break depth raises model confidence to high.')
on conflict (name) do nothing;

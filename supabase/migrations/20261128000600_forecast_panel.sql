-- Forecast panel: hourly rain chance and air temperature, the nearshore marine forecast text,
-- active alerts for each port's marine zone, and wave period on buoy readings.

alter table public.ports
  add column if not exists marine_zone text,
  add column if not exists time_zone text not null default 'America/Detroit';

alter table public.forecasts
  add column if not exists fetched_at timestamptz,
  add column if not exists precip_pct numeric(4, 1) check (precip_pct between 0 and 100),
  add column if not exists air_temp_c numeric(5, 2);

alter table public.observations
  add column if not exists wave_period_s numeric(5, 2) check (wave_period_s >= 0);

-- One row per port. The text and the alerts cover a zone and a span of days, not one hour,
-- so they do not sit on the hourly forecasts rows.
create table if not exists public.marine_forecasts (
  id uuid primary key default gen_random_uuid(),
  port_id uuid not null unique references public.ports (id) on delete cascade,
  zone text not null,
  forecast_text text,
  issued_at timestamptz,
  text_fetched_at timestamptz,
  -- Each alert exactly as issued: event, headline, issued_at, starts_at, ends_at, url.
  alerts jsonb not null default '[]'::jsonb,
  alerts_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.marine_forecasts;
create trigger set_updated_at before update on public.marine_forecasts for each row execute function public.set_updated_at();

alter table public.marine_forecasts enable row level security;
drop policy if exists public_read on public.marine_forecasts;
create policy public_read on public.marine_forecasts for select to anon, authenticated using (true);
drop policy if exists admin_insert on public.marine_forecasts;
create policy admin_insert on public.marine_forecasts for insert to authenticated with check ((select public.is_admin()));
drop policy if exists admin_update on public.marine_forecasts;
create policy admin_update on public.marine_forecasts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists admin_delete on public.marine_forecasts;
create policy admin_delete on public.marine_forecasts for delete to authenticated using ((select public.is_admin()));

insert into public.thresholds (name, value, unit, is_owner_estimate, note) values
  ('forecast_stale_hours', '3', 'h', false, 'A forecast fetched longer ago than this is marked stale on the forecast panel.'),
  ('alerts_stale_minutes', '30', 'min', false, 'Alerts fetched longer ago than this are marked stale on the forecast panel.')
on conflict (name) do nothing;

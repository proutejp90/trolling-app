-- Phase 2. What the fetch jobs need to know about each station and port.
alter table public.stations add column meta jsonb not null default '{}'::jsonb; -- Seagull dataset and parameter ids
alter table public.ports add column nws jsonb; -- NWS grid and observation station, resolved once by the refresh job

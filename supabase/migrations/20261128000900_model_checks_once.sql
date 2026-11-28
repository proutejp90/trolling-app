-- One check per sample point, reading and source, so the refresh job can run it every cycle without duplicates.
create unique index if not exists model_checks_once on public.model_checks (model_point_id, checked_at, measured_source);

insert into public.thresholds (name, value, unit, is_owner_estimate, note) values
  ('model_upwelling_drop_f', '2', '°F', true, 'How much colder the near-shore surface must be than a day earlier, with the cold layer a model layer shallower, to read an upwelling from the lake model.'),
  ('model_check_max_miles', '5', 'mi', true, 'A buoy profile is compared with the lake model at a sample point within this distance.')
on conflict (name) do nothing;

-- The lake model is level "1m" on the ladder, between a buoy profile (1) and a buoy's surface reading (2),
-- so the level stored with each recommendation becomes text.
alter table public.recommendations drop constraint if exists recommendations_temp_source_level_check;
alter table public.recommendations alter column temp_source_level type text using temp_source_level::text;
alter table public.recommendations add constraint recommendations_temp_source_level_check check (temp_source_level in ('0', '1', '1m', '2', '3', '4', '5'));

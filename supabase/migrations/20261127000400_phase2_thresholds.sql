-- Phase 2 thresholds. Inserted only where missing, so an owner's value is never replaced.
insert into public.thresholds (name, value, unit, is_owner_estimate, note) values
  ('obs_max_age_hours', '24', 'h', true, 'Buoy readings older than this are not used at all.'),
  ('trip_max_days_ahead', '2', 'd', true, 'Buoy readings are used only for trips within this many days of now.'),
  ('sky_overcast_min_pct', '70', '%', true, 'Forecast sky cover at or above this counts as overcast; below it, bright.'),
  ('wind_calm_max_mph', '6', 'mph', true, 'Forecast wind at or below this counts as calm for P07.')
on conflict (name) do nothing;

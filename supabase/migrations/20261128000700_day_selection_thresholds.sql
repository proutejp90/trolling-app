-- Day selection and prefilled conditions (build spec, second version).
-- Buoy readings now apply to today only, so trip_max_days_ahead is retired, and calm is set in knots.
insert into public.thresholds (name, value, unit, is_owner_estimate, note) values
  ('lines_default', '4', 'lines', true, 'Lines a spread assumes until the angler says otherwise.'),
  ('wind_calm_max_kt', '5', 'kt', true, 'Wind at or below this counts as calm for P07, from a buoy today or the forecast otherwise.'),
  ('low_light_minutes', '45', 'min', true, 'Light is low this long either side of sunrise and sunset.'),
  ('forecast_horizon_days', '5', 'd', true, 'Forecasts are used for trips up to this many days ahead. Beyond it, month defaults.'),
  ('clarity_answer_max_age_days', '3', 'd', true, 'An angler''s clarity answer at a port is offered again for this many days.')
on conflict (name) do nothing;
delete from public.thresholds where name in ('trip_max_days_ahead', 'wind_calm_max_mph');

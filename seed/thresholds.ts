import type { Threshold } from "@recommender/engine";

const t = (
  name: string,
  value: Threshold["value"],
  unit: string,
  note: string,
  is_owner_estimate = false,
): Threshold => ({ name, value, unit, note, is_owner_estimate });

export const thresholds: Threshold[] = [
  // Depth and color (spec: Thresholds)
  t("temp_band_f", { min: 45, max: 55 }, "F", "Preferred Chinook temperature band."),
  t("red_max_ft", 20, "ft", "Depth where plain red stops reading as red."),
  t("orange_max_ft", 30, "ft", "Depth where plain orange fades."),
  t("yellow_max_ft", 45, "ft", "Depth where yellow fades."),
  t("green_max_ft", 65, "ft", "Depth where green fades."),
  t("blue_max_ft", 110, "ft", "Depth where blue fades."),
  t("uv_max_ft", 60, "ft", "Deepest lure depth where UV finishes are allowed."),
  t("glow_lead_ft", 65, "ft", "Below this lure depth glow ranks first."),
  t("murky_factor", 0.5, "ratio", "Multiplier on color band depths in stained or murky water. No research behind it.", true),
  t("upwelling_wind_hours", 24, "h", "Hours of north or east wind in the last 48 that mark an upwelling. No research behind it.", true),
  t("upwelling_shift_ft", 15, "ft", "How far R08 moves the depth range shallower. From six summers of Ludington buoy history; see docs/research/upwelling-shift.md.", true),
  t("warm_water_f", null, "F", "Temperature at the lure that counts as warm for P09. Not set; P09 is skipped until the owner gives a value.", true),

  // Speed by lure type (all Lore). Plug ranges live in R17 and R18.
  t("speed_spoon_mph", { min: 2.4, max: 3.0 }, "mph", "Spoon speed range."),
  t("speed_flasher_fly_mph", { min: 2.0, max: 2.5 }, "mph", "Flasher and fly speed range."),
  t("speed_meat_rig_mph", { min: 1.8, max: 2.2 }, "mph", "Meat rig speed range. Sources say only that meat runs slower than spoons.", true),

  // Presentation
  t("spoon_first_max_ft", 55, "ft", "P01, P07: spoons rank first above this lure depth."),
  t("spoon_exclude_min_ft", 100, "ft", "P02, P03: below this lure depth spoons are excluded."),
  t("big_attractor_min_ft", 80, "ft", "P10: below this lure depth use 10 to 12 inch attractors."),
  t("staging_water_max_ft", 70, "ft", "P05: Aug to Oct in this much water or less ranks plugs first."),
  t("meat_min_hours_after_sunrise", 2, "h", "P06: meat joins the spread this long after sunrise."),
  t("no_bite_swap_minutes", 45, "min", "P12 tip: swap one line to a plug after this long with no bites."),
  t("default_lines", 4, "lines", "Lines assumed when the angler gives none.", true),
  t("third_type_min_lines", 6, "lines", "A third lure type appears only with this many lines."),
  t("leader_8in_flasher_in", 23, "in", "Fly leader behind an 8 inch flasher."),
  t("leader_11in_flasher_in", 28, "in", "Fly leader behind an 11 inch flasher."),

  // Angler's own data
  t("probe_max_age_h", 3, "h", "How long a probe reading stays level 0.", true),
  t("probe_max_miles", 5, "mi", "How far from the boat a probe reading stays level 0.", true),
  t("min_personal_passes", 20, "passes", "Passes needed before the personal results stage runs.", true),
  t("min_option_passes", 5, "passes", "Passes an option needs before its hits per hour count.", true),

  // Data freshness
  t("station_max_miles", 25, "mi", "Farthest buoy used for a port's water temperature."),
  t("obs_stale_hours", 6, "h", "Observations older than this show the stale state."),
  t("obs_fresh_hours", 3, "h", "Observations must be newer than this for high confidence."),
  t("report_max_age_days", 21, "d", "Reports older than this are ignored."),
  t("obs_max_age_hours", 24, "h", "Buoy readings older than this are not used at all.", true),

  // Reading the forecast
  t("sky_overcast_min_pct", 70, "%", "Forecast sky cover at or above this counts as overcast; below it, bright.", true),
  t("lines_default", 4, "lines", "Lines a spread assumes until the angler says otherwise.", true),
  t("wind_calm_max_kt", 5, "kt", "Wind at or below this counts as calm for P07, from a buoy today or the forecast otherwise.", true),
  t("low_light_minutes", 45, "min", "Light is low this long either side of sunrise and sunset.", true),
  t("forecast_horizon_days", 5, "d", "Forecasts are used for trips up to this many days ahead. Beyond it, month defaults.", true),
  t("clarity_answer_max_age_days", 3, "d", "An angler's clarity answer at a port is offered again for this many days.", true),

  // The lake model
  t("model_max_age_h", 12, "h", "The lake model is skipped when its latest run is older than this."),
  t("model_upwelling_drop_f", 2, "°F", "How much colder the near-shore surface must be than a day earlier, with the cold layer a model layer shallower, to read an upwelling from the lake model.", true),
  t("model_check_max_miles", 5, "mi", "A buoy profile is compared with the lake model at a sample point within this distance.", true),
  t("model_agree_ft", 10, "ft", "A buoy or probe within this of the model's break depth raises model confidence to high.", true),

  // The forecast panel
  t("forecast_stale_hours", 3, "h", "A forecast fetched longer ago than this is marked stale on the forecast panel."),
  t("alerts_stale_minutes", 30, "min", "Alerts fetched longer ago than this are marked stale on the forecast panel."),
];

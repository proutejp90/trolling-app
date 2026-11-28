"use client";

import { Check, ChevronRight, Clock } from "lucide-react";
import type { Conditions, StationReading } from "@/server/conditions";
import { Badge } from "@/components/ui/badge";
import { Card, Panel, Zone } from "@/components/ui/card";
import { capBadges, isStale } from "@/lib/chips";
import { ago, compass, windHistoryLine } from "@/lib/format";

const hasWater = (r: StationReading) => r.water_temp_f !== null || r.wave_height_ft !== null || Boolean(r.temp_profile?.length);
const hasWind = (r: StationReading) => r.wind_speed_mph !== null;

function StationRow({ r, staleHours, farther }: { r: StationReading; staleHours: number; farther: boolean }) {
  const badges = capBadges([
    ...(farther ? [<Badge key="unused" kind="label">Not used</Badge>] : r.used_for.map((u) => <Badge key={u} tone="accent" icon={Check}>Used for {u}</Badge>)),
    ...(isStale(r.age_minutes, staleHours) ? [<Badge key="stale" tone="warning" icon={Clock}>Stale</Badge>] : []),
    ...r.sources.map((s) => <Badge key={s} kind="label">{s}</Badge>),
  ]);
  const values = [
    r.water_temp_f !== null ? `Water ${r.water_temp_f} °F` : null,
    r.wave_height_ft !== null ? `Waves ${r.wave_height_ft} ft` : null,
    r.wind_speed_mph !== null ? `Wind ${r.wind_speed_mph} mph${r.wind_dir_deg !== null ? ` from the ${compass(r.wind_dir_deg)}` : ""}` : null,
    r.air_temp_f !== null ? `Air ${r.air_temp_f} °F` : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-border-subtle px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{r.station}</span>
        <span className="shrink-0 text-small tabular-nums text-fg-tertiary">{r.distance_mi} mi</span>
      </div>
      <p className="text-small text-fg-tertiary">{ago(r.age_minutes)}</p>
      <p className="mt-1 text-fg-secondary tabular-nums">{values.join(" · ") || "No readings the app uses."}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {badges.shown}
        {badges.more ? <Badge>+{badges.more}</Badge> : null}
      </div>
      {r.temp_profile && r.temp_profile.length >= 3 ? (
        <table className="mt-2 w-full text-small tabular-nums text-fg-secondary">
          <caption className="pb-1 text-left text-fg-tertiary">Temperature at depth</caption>
          <tbody>
            {r.temp_profile.map((p) => (
              <tr key={p.depth_ft} className="border-t border-border-subtle">
                <th scope="row" className="py-1 text-left font-normal">{p.depth_ft} ft</th>
                <td className="py-1 text-right">{p.temp_f} °F</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </li>
  );
}

/** The raw inputs, grouped by what was measured: water, wind, forecast. */
export function ConditionsView({ c }: { c: Conditions }) {
  const near = c.readings.filter((r) => r.in_range), far = c.readings.filter((r) => !r.in_range);
  // A station that reports both is listed under Water, with its wind on the same row.
  const water = near.filter(hasWater), wind = near.filter((r) => !hasWater(r) && hasWind(r));
  const rows = (list: StationReading[], farther: boolean) => (
    <Card><ul>{list.map((r) => <StationRow key={`${r.source}/${r.station}`} r={r} staleHours={c.limits.stale_hours} farther={farther} />)}</ul></Card>
  );
  const forecast = c.forecast
    ? [
        c.forecast.sky_cover_pct !== null ? `Sky cover ${c.forecast.sky_cover_pct}%` : null,
        c.forecast.wind_speed_mph !== null ? `Wind ${c.forecast.wind_speed_mph} mph${c.forecast.wind_dir_deg !== null ? ` from the ${compass(c.forecast.wind_dir_deg)}` : ""}` : null,
        c.forecast.hazards.length ? `Marine hazard in effect: ${c.forecast.hazards.map((h) => `${h.phenomenon}.${h.significance}`).join(", ")}` : null,
      ].filter(Boolean).join(" · ")
    : "No forecast covers that time.";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-t2" tabIndex={-1} data-screen-heading>Conditions at {c.port.name}</h1>
        {c.messages.length ? (
          <Panel><ul className="flex list-disc flex-col gap-2 pl-5 text-fg-secondary">{c.messages.map((m) => <li key={m}>{m}</li>)}</ul></Panel>
        ) : null}
      </div>
      <Zone label="Water">
        {water.length ? rows(water, false) : <p className="text-fg-secondary">No station within {c.limits.max_miles} miles has reported water temperature or waves in the last three days.</p>}
      </Zone>
      <Zone label="Wind">
        {wind.length ? rows(wind, false) : null}
        <Card className="p-4">
          <h3 className="text-small text-fg-tertiary">Last 48 hours</h3>
          <p className="mt-1 text-fg-secondary">{windHistoryLine(c.wind_48h, c.days_to_trip)}</p>
        </Card>
      </Zone>
      <Zone label="Forecast">
        <Card className="p-4"><p className="text-fg-secondary tabular-nums">{forecast}</p></Card>
      </Zone>
      <div className="flex flex-col gap-3">
        {far.length ? (
          <details>
            <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-sm text-fg [&::-webkit-details-marker]:hidden">
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" className="chevron shrink-0 text-fg-tertiary transition-transform duration-150" />
              Farther stations, not used
            </summary>
            {rows(far, true)}
          </details>
        ) : null}
        <p className="text-small text-fg-tertiary">Buoy data from NOAA NDBC and GLOS. Forecast from the National Weather Service. This app gives no navigation or safety guidance.</p>
      </div>
    </div>
  );
}

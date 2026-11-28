"use client";

import { Check, ChevronRight, Clock } from "lucide-react";
import type { Conditions, StationReading } from "@/server/conditions";
import type { ForecastPanel as Panel_ } from "@/server/forecast-panel";
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

const clock = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
const hourOf = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", timeZone });
const dayAndTime = (iso: string, timeZone: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
const minutesSince = (iso: string, now: string) => Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60_000));

/** An alert exactly as the National Weather Service issued it. No color here says safe or unsafe. */
export function AlertNotice({ alert, timeZone }: { alert: Panel_["alerts"][number]; timeZone: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 p-4">
      <p className="font-medium text-fg">{alert.headline}</p>
      <p className="mt-1 text-small text-fg-tertiary">
        Issued {dayAndTime(alert.issued_at, timeZone)}{alert.ends_at ? `. In effect until ${dayAndTime(alert.ends_at, timeZone)}` : ""}. National Weather Service.
      </p>
      <a href={alert.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-touch items-center text-accent-text underline underline-offset-2">Read the full text at weather.gov</a>
    </div>
  );
}

/** The trip day's weather as stored. It gives no advice and no rating of the day. */
function ForecastPanel({ c }: { c: Conditions }) {
  const p = c.forecast_panel, tz = p.time_zone;
  const sun = c.sunrise && c.sunset ? `Sunrise ${clock(c.sunrise, tz)}. Sunset ${clock(c.sunset, tz)}.` : null;
  const stale = p.stale || p.alerts_stale;
  return (
    <>
      {p.alerts.map((a) => <AlertNotice key={a.headline} alert={a} timeZone={tz} />)}
      <Card>
        <div className="flex flex-col gap-2 border-b border-border-subtle p-4">
          <p className="text-small text-fg-tertiary">
            National Weather Service.
            {p.fetched_at ? ` Forecast fetched ${ago(minutesSince(p.fetched_at, c.now))}.` : ""}
            {p.is_today && p.alerts_fetched_at ? ` Alerts checked ${ago(minutesSince(p.alerts_fetched_at, c.now))}.` : ""}
          </p>
          {stale ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning" icon={Clock}>Stale</Badge>
              <a href={p.more_url} target="_blank" rel="noreferrer" className="inline-flex min-h-touch items-center text-accent-text underline underline-offset-2">See the current forecast at weather.gov</a>
            </div>
          ) : null}
          {sun ? <p className="text-fg-secondary tabular-nums">{sun}</p> : null}
        </div>
        {p.hours.length ? (
          <table className="w-full text-small tabular-nums text-fg-secondary">
            <caption className="sr-only">Forecast by hour</caption>
            <thead>
              <tr className="text-left text-fg-tertiary">
                <th scope="col" className="py-2 pl-4 font-medium">Time</th>
                <th scope="col" className="py-2 font-medium">Wind</th>
                <th scope="col" className="py-2 font-medium">Sky</th>
                <th scope="col" className="py-2 font-medium">Rain</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Air</th>
              </tr>
            </thead>
            <tbody>
              {p.hours.map((h) => (
                <tr key={h.valid_at} className="border-t border-border-subtle">
                  <th scope="row" className="py-2 pl-4 text-left font-normal">{hourOf(h.valid_at, tz)}</th>
                  <td className="py-2">{h.wind_speed_mph === null ? "" : `${Math.round(h.wind_speed_mph)} mph${h.wind_dir_deg === null ? "" : ` ${COMPASS_SHORT[Math.round(h.wind_dir_deg / 45) % 8]}`}`}</td>
                  <td className="py-2">{h.sky_cover_pct === null ? "" : `${Math.round(h.sky_cover_pct)}% cloud`}</td>
                  <td className="py-2">{h.precip_pct === null ? "" : `${Math.round(h.precip_pct)}%`}</td>
                  <td className="py-2 pr-4 text-right">{h.air_temp_f === null ? "" : `${h.air_temp_f} °F`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-4 text-fg-secondary">No forecast covers that time.</p>}
      </Card>
      {p.observed_waves ? (
        <Card className="p-4">
          <h3 className="text-small text-fg-tertiary">Waves, observed</h3>
          <p className="mt-1 text-fg-secondary tabular-nums">
            {p.observed_waves.height_ft} ft{p.observed_waves.period_s !== null ? `, ${p.observed_waves.period_s} second period` : ""} at {p.observed_waves.station}, {ago(p.observed_waves.age_minutes)}.
          </p>
        </Card>
      ) : null}
      {p.marine ? (
        <Card className="p-4">
          <h3 className="text-small text-fg-tertiary">Nearshore marine forecast{p.marine.issued_at ? `, issued ${dayAndTime(p.marine.issued_at, tz)}` : ""}</h3>
          <div className="mt-2 flex flex-col gap-2 text-fg-secondary">{marineParagraphs(p.marine.text).map((para) => <p key={para}>{para}</p>)}</div>
        </Card>
      ) : null}
    </>
  );
}
/**
 * The product is typed in 69-column lines, which wrap badly on a phone. The words are left
 * exactly as issued; only the line breaks inside a paragraph are removed. A new paragraph
 * starts at a blank line or at a line that opens with a period (".TONIGHT...").
 */
export function marineParagraphs(text: string): string[] {
  const out: string[] = [];
  let fresh = true;
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (!line) { fresh = true; continue; }
    if (fresh || line.startsWith(".")) out.push(line); else out[out.length - 1] += ` ${line}`;
    fresh = false;
  }
  return out;
}
const COMPASS_SHORT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The raw inputs, grouped by what was measured: water, wind, forecast. */
export function ConditionsView({ c }: { c: Conditions }) {
  const near = c.readings.filter((r) => r.in_range), far = c.readings.filter((r) => !r.in_range);
  // A station that reports both is listed under Water, with its wind on the same row.
  const water = near.filter(hasWater), wind = near.filter((r) => !hasWater(r) && hasWind(r));
  const rows = (list: StationReading[], farther: boolean) => (
    <Card><ul>{list.map((r) => <StationRow key={`${r.source}/${r.station}`} r={r} staleHours={c.limits.stale_hours} farther={farther} />)}</ul></Card>
  );
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
        <ForecastPanel c={c} />
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

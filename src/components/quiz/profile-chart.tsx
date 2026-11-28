"use client";

import { useState } from "react";
import type { ModelView } from "@/server/model";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const POINT_NAME = { near: "Near shore", mid: "Mid", off: "Offshore" } as const;
type Point = ModelView["points"][number];

/**
 * Temperature against depth for one sample point: one line, depth running down the page.
 * The break is a shaded band with its range written beside it, so it never depends on color.
 */
function DepthChart({ point }: { point: Point }) {
  const W = 320, H = 240, left = 44, right = 12, top = 24, bottom = 12;
  const temps = point.profile.map((p) => p.temp_f);
  const lo = Math.floor(Math.min(...temps)) - 1, hi = Math.ceil(Math.max(...temps)) + 1;
  const x = (t: number) => left + ((t - lo) / (hi - lo)) * (W - left - right);
  const y = (d: number) => top + (d / point.water_depth_ft) * (H - top - bottom);
  const line = point.profile.map((p, i) => `${i ? "L" : "M"}${x(p.temp_f).toFixed(1)},${y(p.depth_ft).toFixed(1)}`).join(" ");
  const depthTicks = [0, Math.round(point.water_depth_ft / 2), point.water_depth_ft];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Modeled water temperature by depth, ${POINT_NAME[point.label].toLowerCase()} point, over ${point.water_depth_ft} feet of water`} className="w-full">
      {point.break_ft ? (
        <>
          <rect x={left} y={y(point.break_ft.min)} width={W - left - right} height={Math.max(2, y(point.break_ft.max) - y(point.break_ft.min))} fill="var(--surface-3)" />
          {/* Above the break the water is warm, so the line is on the right and the label sits clear of it on the left. */}
          <text x={left + 6} y={y(point.break_ft.min) - 4} fontSize="11" fill="var(--text-secondary)">Break {point.break_ft.min} to {point.break_ft.max} ft</text>
        </>
      ) : null}
      {/* Recessive frame: the surface line, depth ticks and the temperature range. */}
      <line x1={left} y1={top} x2={W - right} y2={top} stroke="var(--border)" />
      <line x1={left} y1={top} x2={left} y2={H - bottom} stroke="var(--border)" />
      {depthTicks.map((d) => <text key={d} x={left - 6} y={y(d) + 4} textAnchor="end" fontSize="11" fill="var(--text-tertiary)">{d} ft</text>)}
      <text x={left} y={top - 8} fontSize="11" fill="var(--text-tertiary)">{lo} °F</text>
      <text x={W - right} y={top - 8} textAnchor="end" fontSize="11" fill="var(--text-tertiary)">{hi} °F</text>
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {point.profile.map((p) => (
        <g key={p.depth_ft}>
          <circle cx={x(p.temp_f)} cy={y(p.depth_ft)} r="3" fill="var(--accent)" stroke="var(--surface-2)" strokeWidth="1.5" />
          {/* A larger target than the mark, so a finger or pointer finds it. */}
          <circle cx={x(p.temp_f)} cy={y(p.depth_ft)} r="10" fill="transparent"><title>{p.depth_ft} ft down: {p.temp_f} °F</title></circle>
        </g>
      ))}
    </svg>
  );
}

/** NOAA's lake model at the three sample points. Everything here is modeled, and says so. */
export function ModelProfile({ model, now, timeZone }: { model: ModelView; now: string; timeZone: string }) {
  const [label, setLabel] = useState(model.point);
  const point = model.points.find((p) => p.label === label) ?? model.points[0]!;
  const when = new Date(point.valid_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone });
  const age = Math.round((new Date(now).getTime() - new Date(model.run_at).getTime()) / 3_600_000);
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-border-subtle p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-t3">Temperature at depth</h3>
          <Badge kind="label" tone="accent">Modeled</Badge>
          {model.is_forecast ? <Badge kind="label" tone="accent">Forecast</Badge> : null}
        </div>
        <p className="text-small text-fg-tertiary">
          NOAA lake model{model.is_forecast ? `, forecast for ${when}` : ""}, run {age <= 0 ? "under an hour" : `${age} ${age === 1 ? "hour" : "hours"}`} ago. Modeled, not measured, and it can be wrong near shore.
        </p>
        <div className="flex gap-2" role="group" aria-label="Sample point">
          {model.points.map((p) => (
            <button
              key={p.label} type="button" aria-pressed={p.label === point.label} onClick={() => setLabel(p.label)}
              className={`inline-flex min-h-touch flex-1 flex-col items-center justify-center rounded-sm border px-2 text-small transition-colors duration-100 ${p.label === point.label ? "border-border-strong bg-accent-soft font-medium text-fg" : "border-border bg-surface-2 text-fg-secondary hover:border-border-strong"}`}
            >
              <span>{POINT_NAME[p.label]}</span>
              <span className="tabular-nums text-fg-tertiary">{p.water_depth_ft} ft<span className="sr-only"> of water</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <p className="text-fg-secondary tabular-nums">
          {point.break_ft ? `Break ${point.break_ft.min} to ${point.break_ft.max} ft down.` : "No break: the water does not cool with depth here."}
          {point.surface_temp_f !== null ? ` Surface ${point.surface_temp_f} °F.` : ""}
          {model.is_forecast && label === model.point && model.break_today_ft ? ` Today's break: ${model.break_today_ft.min} to ${model.break_today_ft.max} ft.` : ""}
        </p>
        <p className="text-small text-fg-tertiary">The model resolves about {point.layer_ft} ft here, so the break is a range.</p>
        <div className="mt-2"><DepthChart point={point} /></div>
        <details className="mt-2">
          <summary className="flex min-h-touch cursor-pointer items-center text-fg-secondary">Show as a table</summary>
          <table className="w-full text-small tabular-nums text-fg-secondary">
            <caption className="sr-only">Modeled temperature by depth</caption>
            <tbody>
              {point.profile.map((p) => (
                <tr key={p.depth_ft} className="border-t border-border-subtle">
                  <th scope="row" className="py-1 text-left font-normal">{p.depth_ft} ft</th>
                  <td className="py-1 text-right">{p.temp_f} °F</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Card>
  );
}

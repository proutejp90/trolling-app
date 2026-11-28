"use client";

import { Check, ChevronRight, CircleAlert, CircleCheck, CircleX, Clock, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import type { EngineResult, Setup, SetupLureType, Tag } from "@recommender/engine";
import type { Recommendation } from "@/server/recommend";
import type { Explanation, Reason } from "@/server/agent/schema";
import { Badge, CONFIDENCE, EVIDENCE_TAGS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Panel, Zone } from "@/components/ui/card";
import { capBadges, conditionChips, dataAge } from "@/lib/chips";
import { monthName } from "@/lib/format";
import { nextSeasonStart } from "@/lib/home";
import { AlertNotice } from "./conditions-view";
import { caveatsToShow, FOOTER, KNOWN_LIMITS, TAG_EXPLAINER, TYPE_NAME } from "@/lib/reasons";

const CONFIDENCE_ICON = { high: CircleCheck, medium: CircleAlert, low: CircleX } as const;
type Range = { min: number; max: number };
const span = (r: Range, digits = 0) => (r.min === r.max ? r.min.toFixed(digits) : `${r.min.toFixed(digits)} to ${r.max.toFixed(digits)}`);

/** A key number: the figures at title size, the unit small beside them, read as one phrase. */
function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="tabular-nums">
      <span className="text-t1">{value}</span>
      <span className="text-small text-fg-secondary"> {unit}</span>
    </span>
  );
}

/**
 * One reason with its evidence tags. A tag is a tag chip: a button that draws a
 * badge inside it. Tapping it opens one fixed sentence about that kind of
 * evidence under the reason, and tapping again closes it. The tags sit in a
 * fixed-width column so every reason's text starts at the same edge.
 */
function ReasonRow({ tags, text }: { tags: Tag[]; text: string }) {
  const [open, setOpen] = useState<Tag | null>(null);
  const id = useId();
  return (
    <li>
      <div className="flex items-start gap-3">
        <span className="flex w-20 shrink-0 flex-col items-start">
          {tags.map((t) => (
            <button
              key={t} type="button" aria-expanded={open === t} aria-controls={id}
              onClick={() => setOpen(open === t ? null : t)}
              className="inline-flex h-touch items-center rounded-sm"
            >
              <Badge tone={EVIDENCE_TAGS[t].tone}>{EVIDENCE_TAGS[t].label}</Badge>
            </button>
          ))}
        </span>
        <span className="flex min-h-touch items-center text-fg-secondary">{text}</span>
      </div>
      <p id={id} className="ml-[92px] text-small text-fg-tertiary">{open ? TAG_EXPLAINER[open] : null}</p>
    </li>
  );
}

function SetupCard({ type, setups, reasons, traits, startOpen }: { type: SetupLureType; setups: Setup[]; reasons: Reason[]; traits: Recommendation["traits"]; startOpen: boolean }) {
  const first = setups[0]!;
  const [open, setOpen] = useState(startOpen);
  return (
    <Card>
      <CardHeader
        title={TYPE_NAME[type]}
        right={
          <span className="flex items-center gap-2">
            {first.position === "deepest" ? <span className="text-small text-fg-tertiary">Deepest lines</span> : null}
            <Badge>{setups.length} {setups.length === 1 ? "line" : "lines"}</Badge>
          </span>
        }
      />
      <dl className="grid grid-cols-1 gap-3 p-4 min-[340px]:grid-cols-2">
        <div>
          <dt className="text-small text-fg-tertiary">Depth</dt>
          <dd><Figure value={span(first.depth_ft)} unit="ft down" /></dd>
        </div>
        <div>
          <dt className="text-small text-fg-tertiary">Speed at the lure</dt>
          <dd><Figure value={span(first.speed_mph, 1)} unit="mph" /></dd>
        </div>
      </dl>
      <ul className="border-t border-border-subtle">
        {setups.map((s, i) => {
          const t = traits[s.finish_id];
          const badges = capBadges([
            ...(i === 0 ? [<Badge key="top" tone="accent">Top pick</Badge>] : []),
            ...(t?.glow ? [<Badge key="glow" kind="label">Glow</Badge>] : []),
            ...(t?.uv ? [<Badge key="uv" kind="label">UV</Badge>] : []),
            ...(t?.house_brand ? [<Badge key="house" kind="label" tone="accent">House brand</Badge>] : []),
          ]);
          return (
            <li key={s.rank} className="flex min-h-touch items-start gap-3 border-b border-border-subtle px-4 py-2">
              <span className="w-4 shrink-0 text-small leading-[22px] tabular-nums text-fg-tertiary">{s.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{s.finish_name}</span>
                  {badges.shown}
                  {badges.more ? <Badge>+{badges.more}</Badge> : null}
                </span>
                <span className="block text-small text-fg-secondary">
                  {s.lure_name}
                  {s.attractor_name ? `, behind a ${s.attractor_finish_name?.toLowerCase()} ${s.attractor_name}` : ""}
                  {s.leader_in ? `, ${s.leader_in} inch leader` : ""}
                </span>
                {s.breaks_rule ? <span className="block text-small text-warning">Closest match. Breaks rule {s.breaks_rule}.</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <details className="px-4" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-sm text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" className={`shrink-0 text-fg-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          Why this setup
        </summary>
        <ul className="flex flex-col pb-2">
          {reasons.map((r) => <ReasonRow key={r.text} tags={r.tags} text={r.text} />)}
        </ul>
      </details>
    </Card>
  );
}

export function Result({ rec, explanation, writing, portName, date, modeAnswered, onConditions, onEdit, onTryDate }: {
  rec: Recommendation; explanation: Explanation; writing: boolean; portName: string; date: string; modeAnswered: boolean;
  onConditions: () => void; onEdit: () => void; onTryDate: (date: string) => void;
}) {
  const result: EngineResult = rec.engine;
  if (rec.status === "out_of_season") {
    const opening = nextSeasonStart(date);
    return (
      <Card className="flex flex-col gap-3 p-4">
        <h1 className="text-t3" tabIndex={-1} data-screen-heading>Out of season</h1>
        <p className="text-fg-secondary">
          {monthName(date)} is outside the season. The rules cover April through October. Pick a date in that range, or see the setup for opening day.
        </p>
        <Button variant="primary" size="touch" onClick={() => onTryDate(opening)}>Show {monthName(opening)}</Button>
      </Card>
    );
  }
  const groups: { type: SetupLureType; setups: Setup[] }[] = [];
  for (const s of result.setups) {
    const last = groups[groups.length - 1];
    if (last && last.type === s.lure_type) last.setups.push(s); else groups.push({ type: s.lure_type, setups: [s] });
  }
  const confidence = CONFIDENCE[rec.confidence];
  const c = rec.conditions;
  const age = dataAge(c.age_minutes, c.limits.fresh_hours);
  const chips = conditionChips({
    water: { temp_f: c.water_temp_surface_f, has_station: Boolean(c.temp_station) }, inputs: rec.inputs, sources: rec.sources, upwelling: Boolean(result.upwelling_likely),
  });
  const lines = result.setups.length;
  const leftOut = [...result.dropped_types.map((d) => d.reason), ...result.dropped_lures.map((d) => `${d.name}: ${d.reason}`), ...result.notes];
  return (
    <div className="flex flex-col gap-8">
      {/* Zone 1, the plan. No label: it is the top of the page. */}
      <div className="flex flex-col gap-3">
        {/* An active alert for the port's zone, word for word, above everything else. */}
        {c.forecast_panel.alerts.map((a) => <AlertNotice key={a.headline} alert={a} timeZone={c.forecast_panel.time_zone} />)}
        <div>
          <h1 className="text-t2" tabIndex={-1} data-screen-heading>{portName}, {monthName(date)}</h1>
          <p className="mt-1 text-fg-secondary">
            {explanation.conditions_summary}
            {/* Said only when the angler chose where to fish. In other months the summary already places the fish. */}
            {modeAnswered ? (result.mode === "staging" ? " This setup is for staging fish." : " This setup is for offshore fish.") : ""}
            {result.water_depth_ft ? ` Fish over ${result.water_depth_ft.min} to ${result.water_depth_ft.max} ft of water.` : ""}
          </p>
        </div>
        <Card>
          {result.spread_speed_mph ? (
            <div className="border-b border-border-subtle p-4">
              <p className="text-small text-fg-tertiary">Run the whole spread at</p>
              <p><Figure value={span(result.spread_speed_mph, 1)} unit="mph" /></p>
              <p className="text-small text-fg-tertiary">at the lure, on {lines} {lines === 1 ? "line" : "lines"}</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-b border-border-subtle p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={confidence.tone} icon={CONFIDENCE_ICON[rec.confidence]}>{confidence.label}</Badge>
              <Badge tone={age.tone} icon={Clock}>{age.text}</Badge>
            </div>
            {/* The one place that says where depth came from and why confidence is what it is. */}
            <p className="text-fg-secondary">{explanation.confidence_reason}</p>
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-small text-fg-tertiary">
              {writing ? <><span aria-hidden="true" className="pulse h-2 w-2 rounded-full bg-accent" />Writing reasons…</> : null}
            </p>
          </div>
          <div className="flex flex-col gap-2 p-4">
            <ul className="flex flex-wrap gap-2" aria-label="What the setup is based on">
              {chips.map((chip) => <li key={chip.text} className="flex"><Badge kind="label" tone={chip.tone}>{chip.text}</Badge></li>)}
            </ul>
            <div className="flex flex-wrap gap-x-6">
              <button type="button" onClick={onEdit} className="inline-flex h-touch items-center rounded-sm text-accent-text underline underline-offset-2">Change conditions</button>
              <button type="button" onClick={onConditions} className="inline-flex h-touch items-center rounded-sm text-accent-text underline underline-offset-2">View conditions</button>
            </div>
          </div>
        </Card>
      </div>

      <Zone label={`Your spread · ${lines} ${lines === 1 ? "line" : "lines"}`}>
        {groups.map((g, i) => (
          <SetupCard key={g.type} type={g.type} setups={g.setups} traits={rec.traits} startOpen={i === 0} reasons={explanation.groups.find((x) => x.lure_type === g.type)?.reasons ?? []} />
        ))}
        {lines === 0 ? (
          <Card className="p-4">
            <h3 className="text-t3">No setup fits</h3>
            <p className="mt-2 text-fg-secondary">Nothing in the catalog passes the rules for these conditions.</p>
          </Card>
        ) : null}
        {leftOut.length ? (
          <Panel>
            <h3 className="text-t3">Left out</h3>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-fg-secondary">{leftOut.map((text) => <li key={text}>{text}</li>)}</ul>
          </Panel>
        ) : null}
      </Zone>

      {explanation.report_notes.length ? (
        <Zone label="Recent reports">
          <Card className="p-4">
            <ul className="flex flex-col gap-3">
              {explanation.report_notes.map((n) => (
                <li key={n.text} className="flex items-start gap-3">
                  <Badge tone={n.agrees ? "success" : "warning"} icon={n.agrees ? Check : TriangleAlert}>{n.agrees ? "Agrees" : "Conflicts"}</Badge>
                  <span className="text-fg-secondary">{n.text} <span className="text-fg-tertiary">Michigan DNR, {monthName(n.report_date)}.</span></span>
                </li>
              ))}
            </ul>
          </Card>
        </Zone>
      ) : null}

      {result.tips.length ? (
        <Zone label="If nothing bites">
          <Card className="px-4 py-2">
            <ul className="flex flex-col">{result.tips.map((tip) => <ReasonRow key={tip.rule_code} tags={["lore"]} text={tip.text} />)}</ul>
          </Card>
        </Zone>
      ) : null}

      <Zone label="Good to know">
        <Panel className="text-small text-fg-secondary">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {[...caveatsToShow(explanation.caveats, rec.sources.depth), ...KNOWN_LIMITS].map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-3 border-t border-border-subtle pt-3">{FOOTER}</p>
        </Panel>
      </Zone>
    </div>
  );
}

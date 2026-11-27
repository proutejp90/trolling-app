"use client";

import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { evaluate, type EngineContext, type EngineResult, type Setup, type SetupLureType, type Tag } from "@recommender/engine";
import { Badge, CONFIDENCE, EVIDENCE_TAGS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { FOOTER, KNOWN_LIMITS, REASONS, SPEED_CAVEAT, TAG_EXPLAINER, TYPE_NAME, TYPE_SPEED_REASON } from "@/lib/reasons";
import { catalog, ports, rules, thresholds } from "@/lib/ruleset";

type Step = "home" | "questions" | "result";
type TimeOfDay = "before_sunrise" | "early" | "day" | "after_sunset";

const TIME: Record<TimeOfDay, Pick<EngineContext, "light_period" | "hours_after_sunrise">> = {
  before_sunrise: { light_period: "before_sunrise", hours_after_sunrise: 0 },
  early: { light_period: "day", hours_after_sunrise: 1 },
  day: { light_period: "day", hours_after_sunrise: 5 },
  after_sunset: { light_period: "after_sunset", hours_after_sunrise: 15 },
};

const feet = (r: { min: number; max: number }) => (r.min === r.max ? `${r.min} ft down` : `${r.min} to ${r.max} ft down`);
const mph = (r: { min: number; max: number }) => (r.min === r.max ? `${r.min.toFixed(1)} mph` : `${r.min.toFixed(1)} to ${r.max.toFixed(1)} mph`);
const monthName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const inputClass = "h-touch w-full rounded-sm border border-border bg-surface-2 px-3 text-body text-fg hover:border-border-strong";

function Tags({ tags }: { tags: Tag[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {tags.map((t) => (
        <span key={t} title={TAG_EXPLAINER[t]}>
          <Badge tone={EVIDENCE_TAGS[t].tone}>{EVIDENCE_TAGS[t].label}</Badge>
        </span>
      ))}
    </span>
  );
}

function SetupCard({ type, setups, result }: { type: SetupLureType; setups: Setup[]; result: EngineResult }) {
  const first = setups[0]!;
  const tagsOf = new Map(result.fired.map((f) => [f.code, f.tags]));
  const reasonCodes = [...new Set(setups.flatMap((s) => s.rule_codes))].filter((c) => REASONS[c]);
  const speedReason = type === "plug" ? null : TYPE_SPEED_REASON[type];
  return (
    <section className="rounded-md border border-border-subtle bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-t3">{TYPE_NAME[type]}</h3>
        <span className="text-small text-fg-tertiary">{setups.length} {setups.length === 1 ? "line" : "lines"}{first.position === "deepest" ? ", deepest" : ""}</span>
      </div>
      <dl className="mt-3 flex flex-col gap-2">
        <div>
          <dt className="text-small text-fg-tertiary">Depth</dt>
          <dd className="text-t1 tabular-nums">{feet(first.depth_ft)}</dd>
        </div>
        <div>
          <dt className="text-small text-fg-tertiary">Speed at the lure</dt>
          <dd className="text-t1 tabular-nums">{mph(first.speed_mph)}</dd>
        </div>
      </dl>
      <ul className="mt-3 border-t border-border-subtle">
        {setups.map((s) => (
          <li key={s.rank} className="flex min-h-touch items-center gap-3 border-b border-border-subtle py-2">
            <span className="w-4 shrink-0 text-small tabular-nums text-fg-tertiary">{s.rank}</span>
            <span className="min-w-0">
              <span className="block font-medium">{s.finish_name}</span>
              <span className="block text-small text-fg-secondary">
                {s.lure_name}
                {s.attractor_name ? `, behind a ${s.attractor_finish_name?.toLowerCase()} ${s.attractor_name}` : ""}
                {s.leader_in ? `, ${s.leader_in} inch leader` : ""}
              </span>
              {s.breaks_rule ? <span className="block text-small text-warning">Closest match. Breaks rule {s.breaks_rule}.</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="flex min-h-touch cursor-pointer items-center text-fg-secondary">Why this setup</summary>
        <ul className="flex flex-col gap-3 pb-1">
          {reasonCodes.map((code) => (
            <li key={code} className="flex items-start gap-3">
              <Tags tags={tagsOf.get(code) ?? ["lore"]} />
              <span className="text-fg-secondary">{REASONS[code]}</span>
            </li>
          ))}
          {speedReason ? (
            <li className="flex items-start gap-3">
              <Tags tags={speedReason.tags} />
              <span className="text-fg-secondary">{speedReason.text}</span>
            </li>
          ) : null}
        </ul>
      </details>
    </section>
  );
}

function Result({ result, portName, date }: { result: EngineResult; portName: string; date: string }) {
  if (result.status === "out_of_season") {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-2 p-4">
        <h2 className="text-t3">Out of season</h2>
        <p className="mt-2 text-fg-secondary">The rules cover April through October. Pick a date in that range to get a setup.</p>
      </div>
    );
  }
  const groups: { type: SetupLureType; setups: Setup[] }[] = [];
  for (const s of result.setups) {
    const last = groups[groups.length - 1];
    if (last && last.type === s.lure_type) last.setups.push(s); else groups.push({ type: s.lure_type, setups: [s] });
  }
  const confidence = CONFIDENCE.low;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-t2">{portName}, {monthName(date)}</h2>
        <p className="mt-1 text-fg-secondary">
          {REASONS[result.fired.find((f) => f.stage === "location")?.code ?? ""]}
          {result.mode === "staging" ? " This setup is for staging fish." : " This setup is for offshore fish."}
          {result.water_depth_ft ? ` Fish over ${result.water_depth_ft.min} to ${result.water_depth_ft.max} ft of water.` : ""}
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-1 p-3">
        <Badge tone={confidence.tone}>{confidence.label}</Badge>
        <p className="text-fg-secondary">
          Live water data is not connected yet. Depth comes from {result.depth_source === "angler" ? "the lure depth you gave" : result.depth_source === "R05" ? "the break depth you gave" : "month defaults"}.
        </p>
      </div>
      {result.spread_speed_mph ? (
        <div className="rounded-md border border-border-subtle bg-surface-2 p-4">
          <p className="text-small text-fg-tertiary">Run the whole spread at</p>
          <p className="text-t1 tabular-nums">{mph(result.spread_speed_mph)}</p>
          <p className="text-small text-fg-tertiary">at the lure, on {result.setups.length} {result.setups.length === 1 ? "line" : "lines"}</p>
        </div>
      ) : null}
      {groups.map((g) => <SetupCard key={g.type} type={g.type} setups={g.setups} result={result} />)}
      {result.setups.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-2 p-4">
          <h3 className="text-t3">No setup fits</h3>
          <p className="mt-2 text-fg-secondary">Nothing in the catalog passes the rules for these conditions.</p>
        </div>
      ) : null}
      {result.dropped_types.length || result.dropped_lures.length || result.notes.length ? (
        <section>
          <h3 className="text-t3">Left out</h3>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-fg-secondary">
            {result.dropped_types.map((d) => <li key={d.lure_type}>{d.reason}</li>)}
            {result.dropped_lures.map((d) => <li key={d.lure_id}>{d.name}: {d.reason}</li>)}
            {result.notes.filter((n) => !n.includes("DECISIONS.md")).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      ) : null}
      {result.tips.length ? (
        <section>
          <h3 className="text-t3">If nothing bites</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {result.tips.map((tip) => (
              <li key={tip.rule_code} className="flex items-start gap-3">
                <Tags tags={["lore"]} />
                <span className="text-fg-secondary">{tip.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="text-small text-fg-tertiary">
        <p>{SPEED_CAVEAT}</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">{KNOWN_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}

export function Quiz() {
  const [step, setStep] = useState<Step>("home");
  const [portName, setPortName] = useState(ports.find((p) => p.name === "Muskegon")?.name ?? ports[0]!.name);
  const [date, setDate] = useState("");
  const [clarity, setClarity] = useState<NonNullable<EngineContext["clarity"]> | null>(null);
  const [sky, setSky] = useState<NonNullable<EngineContext["sky"]> | null>(null);
  const [time, setTime] = useState<TimeOfDay | null>(null);
  const [wind, setWind] = useState<"calm" | "breezy" | null>(null);
  const [mode, setMode] = useState<"offshore" | "staging" | null>(null);
  const [depthKind, setDepthKind] = useState<"none" | "break" | "lure">("none");
  const [depthValue, setDepthValue] = useState("");
  const [lines, setLines] = useState(4);

  // Today's date is set on the device so the prerendered page carries no stale date.
  useEffect(() => { setDate((d) => d || new Date().toLocaleDateString("en-CA")); }, []);

  const port = ports.find((p) => p.name === portName)!;
  const month = date ? Number(date.slice(5, 7)) : 0;
  const depthNumber = Number(depthValue);
  const depthGiven = depthKind !== "none" && depthValue !== "" && depthNumber >= 0 && depthNumber <= 400;

  const result = useMemo(() => {
    if (!date) return null;
    const context: EngineContext = {
      date, shore: port.shore, temp_source_level: depthGiven && depthKind === "break" ? 4 : 5, lines_available: lines,
      ...(clarity ? { clarity } : {}), ...(sky ? { sky } : {}), ...(time ? TIME[time] : {}),
      ...(wind ? { wind_calm: wind === "calm" } : {}), ...(mode && month === 8 ? { mode } : {}),
      ...(depthGiven && depthKind === "break" ? { break_depth_ft: depthNumber } : {}),
      ...(depthGiven && depthKind === "lure" ? { lure_depth_ft: depthNumber } : {}),
    };
    return evaluate(context, rules, thresholds, catalog);
  }, [date, port.shore, clarity, sky, time, wind, mode, month, depthKind, depthGiven, depthNumber, lines]);

  const needsDepth = result?.status === "needs_input";
  const answered = clarity && sky && time && wind && (month !== 8 || mode) && !needsDepth;

  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="-ml-2 inline-flex h-touch items-center gap-2 self-start rounded-sm px-2 text-fg-secondary hover:bg-surface-3 hover:text-fg">
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back
    </button>
  );

  if (step === "home") {
    return (
      <form className="flex flex-1 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setStep(result?.status === "out_of_season" ? "result" : "questions"); }}>
        <div>
          <h1 className="text-t1">Get a starting setup</h1>
          <p className="mt-2 text-fg-secondary">Pick a port and a date to see which lures to run, how deep and how fast, and why.</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-t3">Port</span>
          <select value={portName} onChange={(e) => setPortName(e.target.value)} className={inputClass}>
            {ports.map((p) => <option key={p.name} value={p.name}>{p.name}, {p.state}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-t3">Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        <div className="mt-auto flex flex-col gap-2">
          <Button type="submit" variant="primary" size="touch" disabled={!date}>Get setup</Button>
          <p className="text-small text-fg-tertiary">Live buoy and report data are not connected yet. This build asks you for conditions.</p>
        </div>
      </form>
    );
  }

  if (step === "questions") {
    return (
      <form className="flex flex-1 flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (answered) setStep("result"); }}>
        {back("home")}
        <h1 className="text-t2">{portName}, {monthName(date)}</h1>
        <Choice legend="Water clarity" value={clarity} onChange={setClarity} options={[{ value: "clear", label: "Clear" }, { value: "stained", label: "Stained" }, { value: "murky", label: "Murky" }, { value: "unknown", label: "Not sure" }]} />
        <Choice legend="Sky" value={sky} onChange={setSky} options={[{ value: "bright", label: "Bright" }, { value: "overcast", label: "Overcast" }, { value: "low_light", label: "Low light" }]} />
        <Choice legend="Time on the water" value={time} onChange={setTime} options={[{ value: "before_sunrise", label: "Before sunrise" }, { value: "early", label: "First two hours" }, { value: "day", label: "Daytime" }, { value: "after_sunset", label: "After sunset" }]} />
        <Choice legend="Wind" value={wind} onChange={setWind} options={[{ value: "calm", label: "Calm" }, { value: "breezy", label: "Breezy or more" }]} />
        {month === 8 ? <Choice legend="Where are you fishing" hint="In August some fish are still offshore and some are staging." value={mode} onChange={setMode} options={[{ value: "offshore", label: "Offshore" }, { value: "staging", label: "Near the river mouth" }]} /> : null}
        <div className="flex flex-col gap-2">
          <Choice
            legend="Depth"
            hint={needsDepth ? "There is no depth default for this month without temperature data. Give the break depth or the lure depth you plan to run." : "Optional. Leave it to the month default, or give what you know."}
            value={depthKind}
            onChange={setDepthKind}
            options={[...(needsDepth ? [] : [{ value: "none" as const, label: "Use the default" }]), { value: "break" as const, label: "I know the break" }, { value: "lure" as const, label: "I know my lure depth" }]}
          />
          {depthKind !== "none" ? (
            <label className="flex flex-col gap-1">
              <span className="text-small text-fg-secondary">{depthKind === "break" ? "Break depth, in feet" : "Lure depth, in feet"}</span>
              <input type="number" inputMode="numeric" min={0} max={400} required value={depthValue} onChange={(e) => setDepthValue(e.target.value)} className={inputClass} />
            </label>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-t3" id="lines-label">Lines</span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="lines-label">
            <Button size="touch" aria-label="Fewer lines" disabled={lines <= 1} onClick={() => setLines((n) => Math.max(1, n - 1))}><Minus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
            <output className="w-8 text-center text-t2 tabular-nums" aria-live="polite">{lines}</output>
            <Button size="touch" aria-label="More lines" disabled={lines >= 12} onClick={() => setLines((n) => Math.min(12, n + 1))}><Plus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          <Button type="submit" variant="primary" size="touch" disabled={!answered}>Show setup</Button>
          {!answered ? <p className="text-small text-fg-tertiary">Answer each question to see the setup.</p> : null}
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {back(result?.status === "out_of_season" ? "home" : "questions")}
      {result ? <Result result={result} portName={portName} date={date} /> : null}
      <p className="mt-auto border-t border-border-subtle pt-4 text-small text-fg-tertiary">{FOOTER}</p>
    </div>
  );
}

"use client";

import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineResult, Setup, SetupLureType, Tag } from "@recommender/engine";
import type { Conditions } from "@/server/conditions";
import type { QuestionField, Recommendation } from "@/server/recommend";
import { Badge, CONFIDENCE, EVIDENCE_TAGS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { FOOTER, KNOWN_LIMITS, REASONS, SPEED_CAVEAT, TAG_EXPLAINER, TYPE_NAME, TYPE_SPEED_REASON } from "@/lib/reasons";

type Step = "home" | "questions" | "result" | "conditions";
type TimeOfDay = "before_sunrise" | "early" | "day" | "after_sunset";
type Clarity = "clear" | "stained" | "murky" | "unknown";
type Sky = "bright" | "overcast" | "low_light";

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;
const ago = (minutes: number) => (minutes < 60 ? `${minutes} minutes ago` : minutes < 36 * 60 ? `${Math.round(minutes / 60)} hours ago` : `${Math.round(minutes / 1440)} days ago`);

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

function ConditionsSummary({ c }: { c: Conditions }) {
  if (!c.temp_station) return null;
  return (
    <p className="text-fg-secondary">
      {c.temp_station.name}, {c.temp_station.distance_mi} miles away, read {c.water_temp_surface_f} °F at the surface {ago(c.age_minutes ?? 0)}
      {c.temp_profile ? ", with temperature at depth" : ""}.
    </p>
  );
}

function Result({ rec, portName, date, onConditions }: { rec: Recommendation; portName: string; date: string; onConditions: () => void }) {
  const result: EngineResult = rec.engine;
  if (rec.status === "out_of_season") {
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
  const confidence = CONFIDENCE[rec.confidence];
  const c = rec.conditions;
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
      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-1 p-3">
        <div className="flex items-start gap-3">
          <Badge tone={confidence.tone}>{confidence.label}</Badge>
          <p className="text-fg-secondary">{rec.confidence_reason}</p>
        </div>
        <ConditionsSummary c={c} />
        <p className="text-fg-secondary">
          Depth comes from {rec.sources.depth}.
          {rec.sources.sky ? ` Sky comes from ${rec.sources.sky === "you" ? "your answer" : rec.sources.sky === "forecast" ? "the forecast" : "the time of day"}.` : ""}
          {result.upwelling_likely ? ` ${c.wind_station ?? "Wind history"} shows a day or more of north or east wind.` : ""}
        </p>
        <button type="button" onClick={onConditions} className="inline-flex h-touch items-center self-start rounded-sm text-accent-text underline underline-offset-2">View conditions</button>
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
            {result.notes.map((n) => <li key={n}>{n}</li>)}
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

/** The raw inputs: what each station last reported and how old it is. */
function ConditionsView({ c }: { c: Conditions }) {
  const north = c.wind_history.filter((w) => w.dir_deg >= 315 || w.dir_deg <= 135).length;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-t2">Conditions at {c.port.name}</h2>
      {c.messages.length ? (
        <ul className="flex list-disc flex-col gap-2 rounded-md border border-border-subtle bg-surface-1 p-3 pl-8 text-fg-secondary">
          {c.messages.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      <section>
        <h3 className="text-t3">Stations</h3>
        {c.readings.length === 0 ? <p className="mt-2 text-fg-secondary">No station linked to this port has reported in the last three days.</p> : (
          <ul className="mt-2 border-t border-border-subtle">
            {c.readings.map((r) => (
              <li key={`${r.source}/${r.station}`} className="border-b border-border-subtle py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.station}</span>
                  <span className="shrink-0 text-small text-fg-tertiary">{r.distance_mi} mi</span>
                </div>
                <p className="text-small text-fg-tertiary">{ago(r.age_minutes)}{r.age_minutes > 360 ? ", more than 6 hours old" : ""}</p>
                <p className="mt-1 text-fg-secondary tabular-nums">
                  {[
                    r.water_temp_f !== null ? `Water ${r.water_temp_f} °F` : null,
                    r.wind_speed_mph !== null ? `Wind ${r.wind_speed_mph} mph${r.wind_dir_deg !== null ? ` from the ${compass(r.wind_dir_deg)}` : ""}` : null,
                    r.wave_height_ft !== null ? `Waves ${r.wave_height_ft} ft` : null,
                    r.air_temp_f !== null ? `Air ${r.air_temp_f} °F` : null,
                  ].filter(Boolean).join(". ") || "No readings the app uses."}
                </p>
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
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-t3">Wind, last 48 hours</h3>
        <p className="mt-2 text-fg-secondary">
          {c.wind_history.length ? `${c.wind_station}: ${north} of ${c.wind_history.length} hours from the north or east.` : "Too little wind history to say."}
        </p>
      </section>
      <section>
        <h3 className="text-t3">Forecast for the trip</h3>
        <p className="mt-2 text-fg-secondary tabular-nums">
          {c.forecast
            ? [c.forecast.sky_cover_pct !== null ? `Sky cover ${c.forecast.sky_cover_pct}%` : null, c.forecast.wind_speed_mph !== null ? `Wind ${c.forecast.wind_speed_mph} mph${c.forecast.wind_dir_deg !== null ? ` from the ${compass(c.forecast.wind_dir_deg)}` : ""}` : null, c.forecast.hazards.length ? `Marine hazard in effect: ${c.forecast.hazards.map((h) => `${h.phenomenon}.${h.significance}`).join(", ")}` : null].filter(Boolean).join(". ")
            : "No forecast covers that time."}
        </p>
      </section>
      <p className="text-small text-fg-tertiary">Buoy data from NOAA NDBC and GLOS. Forecast from the National Weather Service. This app gives no navigation or safety guidance.</p>
    </div>
  );
}

export function Quiz({ ports }: { ports: { name: string; state: string }[] }) {
  const [step, setStep] = useState<Step>("home");
  const [portName, setPortName] = useState(ports.find((p) => p.name === "Muskegon")?.name ?? ports[0]!.name);
  const [date, setDate] = useState("");
  const [time, setTime] = useState<TimeOfDay | null>(null);
  const [clarity, setClarity] = useState<Clarity | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [wind, setWind] = useState<"calm" | "breezy" | null>(null);
  const [mode, setMode] = useState<"offshore" | "staging" | null>(null);
  const [depthKind, setDepthKind] = useState<"none" | "break" | "lure">("none");
  const [depthValue, setDepthValue] = useState("");
  const [lines, setLines] = useState(4);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [asked, setAsked] = useState<QuestionField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // Today's date is set on the device so the page carries no stale date.
  useEffect(() => { setDate((d) => d || new Date().toLocaleDateString("en-CA")); }, []);

  const depthNumber = Number(depthValue);
  const depthGiven = depthKind !== "none" && depthValue !== "" && depthNumber >= 0 && depthNumber <= 400;

  const ask = useCallback(async () => {
    const id = ++latest.current;
    setBusy(true);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          port: portName, date, ...(time ? { time_of_day: time } : {}),
          answers: {
            ...(clarity ? { clarity } : {}), ...(sky ? { sky } : {}), ...(wind ? { wind } : {}), ...(mode ? { mode } : {}), lines,
            ...(depthGiven && depthKind === "break" ? { break_depth_ft: depthNumber } : {}),
            ...(depthGiven && depthKind === "lure" ? { lure_depth_ft: depthNumber } : {}),
          },
        }),
      });
      const body = await res.json();
      if (id !== latest.current) return null;
      if (!res.ok) { setError(body.error ?? "Couldn't build a setup. Check your connection and try again."); return null; }
      setError(null);
      setRec(body as Recommendation);
      // A question stays on screen once asked, so answering it does not make it vanish.
      setAsked((prev) => [...new Set([...prev, ...(body as Recommendation).questions])]);
      return body as Recommendation;
    } catch {
      if (id === latest.current) setError("Couldn't build a setup. Check your connection and try again.");
      return null;
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, [portName, date, time, clarity, sky, wind, mode, lines, depthKind, depthGiven, depthNumber]);

  // Each answer can settle other questions (the forecast may cover the chosen time), so ask again as answers change.
  useEffect(() => { if (step === "questions") void ask(); }, [step, ask]);

  const needsDepth = rec?.questions.includes("depth") ?? false;
  const ready = rec?.status === "ok" && !busy;
  const show = (f: QuestionField) => asked.includes(f);

  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="-ml-2 inline-flex h-touch items-center gap-2 self-start rounded-sm px-2 text-fg-secondary hover:bg-surface-3 hover:text-fg">
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back
    </button>
  );
  const errorLine = error ? <p role="alert" className="rounded-sm bg-danger-soft p-3 text-danger">{error}</p> : null;

  if (step === "home") {
    return (
      <form
        className="flex flex-1 flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setAsked([]);
          const first = await ask();
          if (first) setStep(first.status === "out_of_season" ? "result" : "questions");
        }}
      >
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
          {errorLine}
          <Button type="submit" variant="primary" size="touch" disabled={!date || busy}>Get setup</Button>
        </div>
      </form>
    );
  }

  if (step === "questions") {
    const c = rec?.conditions;
    return (
      <form className="flex flex-1 flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (ready) setStep("result"); }}>
        {back("home")}
        <div>
          <h1 className="text-t2">{portName}, {monthName(date)}</h1>
          {c ? <div className="mt-1"><ConditionsSummary c={c} /></div> : null}
          {c?.messages.length ? <p className="mt-1 text-fg-secondary">{c.messages[0]}</p> : null}
        </div>
        {show("time_of_day") ? <Choice legend="Time on the water" value={time} onChange={setTime} options={[{ value: "before_sunrise", label: "Before sunrise" }, { value: "early", label: "First two hours" }, { value: "day", label: "Daytime" }, { value: "after_sunset", label: "After sunset" }]} /> : null}
        {show("clarity") ? <Choice legend="Water clarity" value={clarity} onChange={setClarity} options={[{ value: "clear", label: "Clear" }, { value: "stained", label: "Stained" }, { value: "murky", label: "Murky" }, { value: "unknown", label: "Not sure" }]} /> : null}
        {show("sky") ? <Choice legend="Sky" hint="No forecast covers that time." value={sky} onChange={setSky} options={[{ value: "bright", label: "Bright" }, { value: "overcast", label: "Overcast" }, { value: "low_light", label: "Low light" }]} /> : null}
        {show("wind") ? <Choice legend="Wind" hint="No forecast covers that time." value={wind} onChange={setWind} options={[{ value: "calm", label: "Calm" }, { value: "breezy", label: "Breezy or more" }]} /> : null}
        {show("mode") ? <Choice legend="Where are you fishing" hint="In August some fish are still offshore and some are staging." value={mode} onChange={setMode} options={[{ value: "offshore", label: "Offshore" }, { value: "staging", label: "Near the river mouth" }]} /> : null}
        <div className="flex flex-col gap-2">
          <Choice
            legend="Depth"
            hint={needsDepth || (show("depth") && depthKind !== "none") ? "There is no depth default for this month without temperature at depth. Give the break depth or the lure depth you plan to run." : "Optional. Leave it to the app, or give what you know."}
            value={depthKind}
            onChange={setDepthKind}
            options={[...(show("depth") ? [] : [{ value: "none" as const, label: c?.temp_profile ? "Use the buoy" : "Use the default" }]), { value: "break" as const, label: "I know the break" }, { value: "lure" as const, label: "I know my lure depth" }]}
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
          {errorLine}
          <Button type="submit" variant="primary" size="touch" disabled={!ready}>Show setup</Button>
          {!ready && !error ? <p className="text-small text-fg-tertiary">Answer each question to see the setup.</p> : null}
        </div>
      </form>
    );
  }

  if (step === "conditions" && rec) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {back("result")}
        <ConditionsView c={rec.conditions} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {back(rec?.status === "out_of_season" ? "home" : "questions")}
      {rec ? <Result rec={rec} portName={portName} date={date} onConditions={() => setStep("conditions")} /> : null}
      <p className="mt-auto border-t border-border-subtle pt-4 text-small text-fg-tertiary">{FOOTER}</p>
    </div>
  );
}

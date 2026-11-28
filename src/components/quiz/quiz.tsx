"use client";

import { ArrowLeft, LocateFixed, Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Prefilled, QuestionField, Recommendation } from "@/server/recommend";
import type { Explanation } from "@/server/agent/schema";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Choice } from "@/components/ui/choice";
import { monthName } from "@/lib/format";
import { checkDate, dayStrip, nearestFirst, todayAt, type PortOption } from "@/lib/home";
import { ConditionsView } from "./conditions-view";
import { Result } from "./result";

type Step = "home" | "questions" | "conditions";
type Window = "first_light" | "morning" | "midday" | "evening";
type Clarity = "clear" | "stained" | "murky" | "unknown";
type Sky = "bright" | "overcast" | "low_light";

const QUESTION_NAME: Record<QuestionField, string> = { clarity: "Water clarity", sky: "Sky", wind: "Wind", mode: "Where are you fishing", depth: "Depth" };
const inputClass = "h-touch w-full rounded-sm border border-border bg-surface-2 px-3 text-body text-fg hover:border-border-strong";

const WINDOWS = [{ value: "first_light", label: "First light" }, { value: "morning", label: "Morning" }, { value: "midday", label: "Midday" }, { value: "evening", label: "Evening" }] as const;
const CLARITIES = [{ value: "clear", label: "Clear" }, { value: "stained", label: "Stained" }, { value: "murky", label: "Murky" }, { value: "unknown", label: "Not sure" }] as const;
const SKIES = [{ value: "bright", label: "Bright" }, { value: "overcast", label: "Overcast" }, { value: "low_light", label: "Low light" }] as const;
const WINDS = [{ value: "calm", label: "Calm" }, { value: "breezy", label: "Breezy or more" }] as const;
const MODES = [{ value: "offshore", label: "Offshore" }, { value: "staging", label: "Near the river mouth" }] as const;

/** How each condition reads on the Conditions in use screen. */
const FIELD_NAME: Record<Prefilled["field"], string> = { time_window: "Time on the water", sky: "Sky", wind: "Wind", clarity: "Water clarity", mode: "Where you are fishing", lines: "Lines", depth: "Depth", water_point: "Water fished" };
const VALUE_NAME: Record<string, string> = {
  now: "Now", first_light: "First light", morning: "Morning", midday: "Midday", evening: "Evening", before_sunrise: "Before sunrise", early: "First two hours", day: "Daytime", after_sunset: "After sunset",
  bright: "Bright", overcast: "Overcast", low_light: "Low light", calm: "Calm", breezy: "Breezy or more",
  near: "Near shore", mid: "Mid", off: "Offshore", clear: "Clear", stained: "Stained", murky: "Murky", unknown: "Not sure", offshore: "Offshore", staging: "Near the river mouth",
};
const valueName = (v: string | number | null) => (v === null ? "Not known" : typeof v === "number" ? String(v) : VALUE_NAME[v] ?? v);
/** The dot beside a source label. A default is marked so it is never mistaken for a measurement. */
const SOURCE_TONE: Record<string, BadgeTone> = { Measured: "info", Forecast: "accent", Modeled: "accent", Default: "warning", "Your answer": "neutral", "Your last answer": "neutral" };

const LAST_PORT = "last-port", LAST_LINES = "last-lines", clarityKey = (port: string) => `clarity:${port}`;
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode: nothing is remembered */ } };
/** The port order after "Use my location", kept for this browser session. It holds port names, never coordinates. */
const PORT_ORDER_KEY = "port-order";

export function Quiz({ ports: listed }: { ports: PortOption[] }) {
  const [step, setStep] = useState<Step>("home");
  const [ports, setPorts] = useState(listed);
  // No port until the device says which: the last one used, or the nearest when location is already allowed.
  const [portName, setPortName] = useState<string | null>(null);
  const [picked, setPicked] = useState(listed.find((p) => p.name === "Muskegon")?.name ?? listed[0]!.name);
  const [ready, setReady] = useState(false);
  const [date, setDate] = useState("");
  const [window_, setWindow] = useState<Window | null>(null);
  const [otherDate, setOtherDate] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  // What is being typed in the calendar field. It becomes the trip date once typing stops or the field is left.
  const [dateDraft, setDateDraft] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const dateHelp = useId();
  const [clarity, setClarity] = useState<Clarity | null>(null);
  const [clarityAt, setClarityAt] = useState<string | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [wind, setWind] = useState<"calm" | "breezy" | null>(null);
  const [mode, setMode] = useState<"offshore" | "staging" | null>(null);
  const [depthKind, setDepthKind] = useState<"none" | "break" | "lure">("none");
  const [depthValue, setDepthValue] = useState("");
  const [lines, setLines] = useState<number | null>(null);
  const [waterPoint, setWaterPoint] = useState<"near" | "mid" | "off" | null>(null);
  // Answers that came from an earlier visit, not from this one.
  const [remembered, setRemembered] = useState<("clarity" | "lines")[]>([]);
  const [editing, setEditing] = useState<Prefilled["field"] | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [asked, setAsked] = useState<QuestionField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentExplanation, setAgentExplanation] = useState<{ for: string; explanation: Explanation } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const latest = useRef(0);
  // A question stays on screen once asked. Ones that arrive later fade in and are announced.
  const askedNow = useRef<QuestionField[]>([]);
  const [late, setLate] = useState<QuestionField[]>([]);
  const resetAsked = () => { askedNow.current = []; setAsked([]); setLate([]); };

  const port = useMemo(() => listed.find((p) => p.name === portName) ?? null, [listed, portName]);
  const timeZone = port?.time_zone ?? "America/Detroit";
  const today = port ? todayAt(timeZone) : "";
  const isToday = date === today;

  // Each screen opens at the top with its main heading focused, as a new page would.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector<HTMLElement>("[data-screen-heading]")?.focus({ preventScroll: true });
  }, [step]);

  /** Opens a port on today, with whatever the device remembers about it. */
  const openPort = useCallback((name: string) => {
    const p = listed.find((x) => x.name === name);
    if (!p) return;
    resetAsked();
    setRec(null); setSky(null); setWind(null); setMode(null); setWaterPoint(null); setDepthKind("none"); setDepthValue(""); setWindow(null); setOtherDate(false); setDateError(null);
    setPortName(name); setPicked(name); setDate(todayAt(p.time_zone ?? "America/Detroit"));
    write(LAST_PORT, name);
    const keep: ("clarity" | "lines")[] = [];
    try {
      const saved = JSON.parse(read(clarityKey(name)) ?? "null") as { value: Clarity; at: string } | null;
      if (saved?.value && saved.at) { setClarity(saved.value); setClarityAt(saved.at); keep.push("clarity"); } else { setClarity(null); setClarityAt(null); }
    } catch { setClarity(null); setClarityAt(null); }
    const savedLines = Number(read(LAST_LINES));
    if (savedLines >= 1 && savedLines <= 12) { setLines(savedLines); keep.push("lines"); } else setLines(null);
    setRemembered(keep);
  }, [listed]);

  // On open: the last port used; failing that the nearest, but only when location is already allowed. Nothing prompts.
  useEffect(() => {
    try {
      const order: unknown = JSON.parse(sessionStorage.getItem(PORT_ORDER_KEY) ?? "null");
      if (Array.isArray(order) && order.length) {
        const sorted = order.map((name) => listed.find((p) => p.name === name)).filter((p): p is PortOption => Boolean(p));
        if (sorted.length === listed.length) { setPorts(sorted); setPicked(sorted[0]!.name); }
      }
    } catch { /* no session storage: the list keeps its order */ }
    const last = read(LAST_PORT);
    if (last && listed.some((p) => p.name === last)) { openPort(last); setReady(true); return; }
    const finish = () => setReady(true);
    if (!navigator.permissions || !navigator.geolocation) return finish();
    navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (status.state !== "granted") return finish();
      navigator.geolocation.getCurrentPosition(
        (pos) => { const sorted = nearestFirst(listed, { lat: pos.coords.latitude, lon: pos.coords.longitude }); setPorts(sorted); openPort(sorted[0]!.name); finish(); },
        finish, { timeout: 5_000, maximumAge: 600_000 },
      );
    }).catch(finish);
  }, [listed, openPort]);

  // Asked for only on a tap. The position is used once to sort the list and is not kept.
  const useMyLocation = () => {
    const off = () => { setLocating(false); setLocationNote("Location is off. Pick a port from the list."); };
    if (!navigator.geolocation) return off();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const sorted = nearestFirst(listed, { lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPorts(sorted); setLocating(false);
        setLocationNote(`Nearest port: ${sorted[0]!.name}.`);
        try { sessionStorage.setItem(PORT_ORDER_KEY, JSON.stringify(sorted.map((p) => p.name))); } catch { /* not kept */ }
        if (portName) openPort(sorted[0]!.name); else setPicked(sorted[0]!.name);
      },
      (err) => (err.code === err.PERMISSION_DENIED ? off() : (setLocating(false), setLocationNote("Couldn't get your location. Pick a port from the list."))),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const depthNumber = Number(depthValue);
  const depthGiven = depthKind !== "none" && depthValue !== "" && depthNumber >= 0 && depthNumber <= 400;
  const request = useMemo(() => (portName && date ? {
    port: portName, date, ...(!isToday && window_ ? { time_window: window_ } : {}),
    ...(remembered.length ? { remembered } : {}), ...(remembered.includes("clarity") && clarityAt ? { clarity_answered_at: clarityAt } : {}),
    answers: {
      ...(clarity ? { clarity } : {}), ...(sky ? { sky } : {}), ...(wind ? { wind } : {}), ...(mode ? { mode } : {}), ...(lines ? { lines } : {}), ...(waterPoint ? { water_point: waterPoint } : {}),
      ...(depthGiven && depthKind === "break" ? { break_depth_ft: depthNumber } : {}),
      ...(depthGiven && depthKind === "lure" ? { lure_depth_ft: depthNumber } : {}),
    },
  } : null), [portName, date, isToday, window_, remembered, clarityAt, clarity, sky, wind, mode, lines, waterPoint, depthGiven, depthKind, depthNumber]);

  const ask = useCallback(async () => {
    if (!request) return;
    const id = ++latest.current;
    setBusy(true);
    try {
      const res = await fetch("/api/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      const body = await res.json();
      if (id !== latest.current) return;
      if (!res.ok) {
        if (body.field === "date") { setDateError(body.error); setError(null); }
        else setError(body.error ?? "Couldn't build a setup. Check your connection and try again.");
        return;
      }
      setError(null);
      setRec(body as Recommendation);
      const before = askedNow.current;
      const added = (body as Recommendation).questions.filter((q) => !before.includes(q));
      if (added.length) {
        if (before.length) setLate((prev) => [...prev, ...added]);
        askedNow.current = [...before, ...added];
        setAsked(askedNow.current);
      }
    } catch {
      if (id === latest.current) setError("Couldn't build a setup. Check your connection and try again.");
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, [request]);

  // The recommendation loads with no tap, and again whenever the port, the day or an answer changes.
  useEffect(() => { void ask(); }, [ask]);

  // Today's result is kept current: every five minutes, and when the angler comes back to the app.
  useEffect(() => {
    if (!isToday || !portName) return;
    const timer = setInterval(() => void ask(), 5 * 60_000);
    const onShow = () => { if (document.visibilityState === "visible") void ask(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [isToday, portName, ask]);

  // The engine result shows at once with templated reasons. The agent's explanation replaces them when it
  // arrives; if it never does, nothing on screen changes and no error is shown. A short wait first, so
  // flicking along the day strip does not ask for an explanation of every day passed over.
  const recKey = rec?.status === "ok" ? rec.recommendation_id : null;
  useEffect(() => {
    if (!rec || !rec.agent_available || !recKey || !request || agentExplanation?.for === recKey) return;
    const controller = new AbortController();
    const wait = setTimeout(() => {
      setExplaining(true);
      fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ ...request, recommendation_id: recKey }) })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => { if (body?.explanation) setAgentExplanation({ for: recKey, explanation: body.explanation as Explanation }); })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setExplaining(false); });
    }, 700);
    return () => { clearTimeout(wait); controller.abort(); setExplaining(false); };
    // The answers are fixed for a given recommendation, so its id is the only trigger.
  }, [recKey]);

  // An answer given now is the angler's own for this visit, and is remembered for the next one.
  const forget = (f: "clarity" | "lines") => setRemembered((r) => r.filter((x) => x !== f));
  const answerClarity = (v: Clarity) => {
    const at = new Date().toISOString();
    setClarity(v); setClarityAt(at); forget("clarity");
    if (portName) write(clarityKey(portName), v === "unknown" ? null : JSON.stringify({ value: v, at }));
  };
  const answerLines = (n: number) => { setLines(n); forget("lines"); write(LAST_LINES, String(n)); };
  const lineCount = lines ?? (rec?.prefilled.find((p) => p.field === "lines")?.data_value as number | undefined) ?? 4;
  /** Every value goes back to what the data says. */
  const resetAll = () => {
    setSky(null); setWind(null); setMode(null); setClarity(null); setClarityAt(null); setLines(null); setDepthKind("none"); setDepthValue(""); setWindow(null); setWaterPoint(null); setRemembered([]); setEditing(null);
    if (portName) write(clarityKey(portName), null);
    write(LAST_LINES, null);
  };
  const pickDate = (next: string) => { resetAsked(); setDateDraft(""); setDate(next); setWindow(null); setSky(null); setWind(null); setMode(null); setDepthKind("none"); setDepthValue(""); setDateError(null); };

  // A date typed by keyboard passes through other valid dates on the way (the month alone changes it),
  // so it is taken when typing has stopped for a moment, or at once when the field is left.
  const commitDraft = (showError: boolean) => {
    if (!dateDraft) return;
    const problem = checkDate(dateDraft, today);
    if (problem) { if (showError) setDateError(problem); return; }
    if (dateDraft !== date) pickDate(dateDraft);
    setDateDraft("");
  };
  useEffect(() => {
    if (!dateDraft) return;
    const wait = setTimeout(() => commitDraft(false), 700);
    return () => clearTimeout(wait);
    // Only the draft restarts the wait.
  }, [dateDraft]);

  const needsDepth = rec?.questions.includes("depth") ?? false;
  const show = (f: QuestionField) => asked.includes(f);
  const fade = (f: QuestionField) => (late.includes(f) ? "fade-in" : "");
  const part = "border-b border-border-subtle p-4 last:border-b-0";

  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="-ml-2 inline-flex h-touch items-center gap-2 self-start rounded-sm px-2 text-fg-secondary hover:bg-surface-3 hover:text-fg">
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back
    </button>
  );
  const errorLine = error ? <p role="alert" className="rounded-sm bg-danger-soft p-3 text-danger">{error}</p> : null;

  // The controls for one condition. The same ones serve the question card on Home and the edit rows.
  const depthControl = (
    <div className="flex flex-col gap-2">
      <Choice
        legend="What you know"
        tag={needsDepth || show("depth") ? undefined : <Badge kind="label">Optional</Badge>}
        hint={(needsDepth || show("depth")) && (needsDepth || depthKind !== "none") ? "There is no depth default for this month without temperature at depth. Give the break depth or the lure depth you plan to run." : "Leave it to the app, or give what you know."}
        value={depthKind}
        onChange={setDepthKind}
        options={[...(show("depth") ? [] : [{ value: "none" as const, label: rec?.conditions.temp_profile ? "Use the buoy" : "Use the default" }]), { value: "break" as const, label: "I know the break" }, { value: "lure" as const, label: "I know my lure depth" }]}
      />
      {depthKind !== "none" ? (
        <label className="flex flex-col gap-1">
          <span className="text-small text-fg-secondary">{depthKind === "break" ? "Break depth, in feet" : "Lure depth, in feet"}</span>
          <input type="number" inputMode="numeric" min={0} max={400} value={depthValue} onChange={(e) => setDepthValue(e.target.value)} className={inputClass} />
        </label>
      ) : null}
    </div>
  );
  const control = (f: Prefilled["field"]) =>
    f === "clarity" ? <Choice legend="Water clarity" value={clarity} onChange={answerClarity} options={CLARITIES} />
    : f === "sky" ? <Choice legend="Sky" value={sky ?? (rec?.inputs.sky as Sky | null) ?? null} onChange={setSky} options={SKIES} />
    : f === "wind" ? <Choice legend="Wind" value={wind ?? (rec?.inputs.wind_calm == null ? null : rec.inputs.wind_calm ? "calm" : "breezy")} onChange={setWind} options={WINDS} />
    : f === "mode" ? <Choice legend="Where are you fishing" hint="In August some fish are still offshore and some are staging." value={mode} onChange={setMode} options={MODES} />
    : f === "time_window" ? <Choice legend="Time on the water" value={window_ ?? "first_light"} onChange={setWindow} options={WINDOWS} />
    : f === "depth" ? depthControl
    : f === "water_point" ? (
      <Choice
        legend="Water fished" hint="Three points straight off the port in NOAA's lake model. The depth shown is the water there." value={waterPoint ?? rec?.conditions.model?.point ?? "mid"} onChange={setWaterPoint}
        options={(rec?.conditions.model?.points ?? []).map((p) => ({ value: p.label, label: `${VALUE_NAME[p.label]}, ${p.water_depth_ft} ft` }))}
      />
    )
    : (
      <div className="flex items-center justify-between gap-3">
        <span className="text-t3" id="lines-label">Lines</span>
        <div className="flex items-center gap-2" role="group" aria-labelledby="lines-label">
          <Button size="touch" aria-label="Fewer lines" disabled={lineCount <= 1} onClick={() => answerLines(Math.max(1, lineCount - 1))}><Minus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
          <output className="w-8 text-center text-t2 tabular-nums" aria-live="polite">{lineCount}</output>
          <Button size="touch" aria-label="More lines" disabled={lineCount >= 12} onClick={() => answerLines(Math.min(12, lineCount + 1))}><Plus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
        </div>
      </div>
    );

  // Port and location on one row, so the recommendation starts high on the screen.
  const portField = (value: string, onChange: (name: string) => void) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-t3">Port</span>
          <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
            {ports.map((p) => <option key={p.name} value={p.name}>{p.name}, {p.state}</option>)}
          </select>
        </label>
        <Button size="touch" className="shrink-0 px-3" disabled={locating} onClick={useMyLocation}>
          <LocateFixed size={16} strokeWidth={1.5} aria-hidden="true" /> Use my location
        </Button>
      </div>
      {locationNote ? <p role="status" className="text-small text-fg-tertiary">{locationNote}</p> : null}
    </div>
  );

  // ---- Conditions in use: every value, where it came from, and a way to change it ----
  if (step === "questions" && rec) {
    const rows = rec.prefilled.filter((p) => !(p.field === "time_window" && rec.day.is_today) && !(p.field === "mode" && rec.engine.month !== 8));
    return (
      <div className="flex flex-1 flex-col gap-4">
        {back("home")}
        <div>
          <h1 className="text-t2" tabIndex={-1} data-screen-heading>Conditions in use</h1>
          <p className="mt-1 text-fg-secondary">{portName}, {monthName(date)}. Each value shows where it came from. Change any that looks wrong from where you are.</p>
        </div>
        <Card>
          <ul>
            {rows.map((p) => (
              <li key={p.field} className={part}>
                <div className="flex min-h-touch items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small text-fg-tertiary">{FIELD_NAME[p.field]}</p>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{valueName(p.value)}{p.field === "water_point" ? `, ${rec.conditions.model?.points.find((x) => x.label === p.value)?.water_depth_ft ?? "?"} ft of water` : ""}</span>
                      {p.source ? <Badge kind="label" tone={SOURCE_TONE[p.source]}>{p.source}</Badge> : <Badge kind="label">Needs your answer</Badge>}
                    </p>
                    {p.source === "Your answer" && p.data_value !== null && p.data_value !== p.value ? <p className="text-small text-fg-tertiary">The data said {valueName(p.data_value).toLowerCase()} ({p.data_source}).</p> : null}
                  </div>
                  <Button size="touch" aria-expanded={editing === p.field} onClick={() => setEditing(editing === p.field ? null : p.field)}>
                    {editing === p.field ? "Close" : "Change"}<span className="sr-only"> {FIELD_NAME[p.field].toLowerCase()}</span>
                  </Button>
                </div>
                {editing === p.field ? <div className="mt-3">{control(p.field)}</div> : null}
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-2">
          {errorLine}
          <Button size="touch" onClick={resetAll}>Reset to the data</Button>
          <Button variant="primary" size="touch" onClick={() => setStep("home")}>Done</Button>
        </div>
      </div>
    );
  }

  if (step === "conditions" && rec) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {back("home")}
        <ConditionsView c={rec.conditions} />
      </div>
    );
  }

  // ---- Home, before a port is known: the one screen with Get setup ----
  if (!portName) {
    if (!ready) return <p className="text-fg-secondary">Loading…</p>;
    return (
      <form className="flex flex-1 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); openPort(picked); }}>
        <div>
          <h1 className="text-t1" tabIndex={-1} data-screen-heading>Get a starting setup</h1>
          <p className="mt-2 text-fg-secondary">Pick a port to see which lures to run today, how deep and how fast, and why.</p>
        </div>
        <Card className="p-4">{portField(picked, setPicked)}</Card>
        <div className="mt-auto flex flex-col gap-2 md:mt-0">
          <Button type="submit" variant="primary" size="touch">Get setup</Button>
          <p className="text-small text-fg-tertiary">The season runs April through October.</p>
        </div>
      </form>
    );
  }

  // ---- Home: today's recommendation, loaded with no tap ----
  const strip = dayStrip(today);
  const inStrip = strip.some((d) => d.date === date);
  const agentWords = agentExplanation && agentExplanation.for === recKey ? agentExplanation.explanation : null;
  const updated = rec?.day.updated_at ? new Date(rec.day.updated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }) : null;
  const questions = (["clarity", "sky", "wind", "mode", "depth"] as const).filter(show);
  return (
    <div className="flex flex-1 flex-col gap-4">
      {portField(portName, openPort)}

      <div className="flex flex-col gap-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Day">
          {strip.map((d) => (
            <button
              key={d.date} type="button" aria-pressed={d.date === date} onClick={() => { setOtherDate(false); pickDate(d.date); }}
              className={`inline-flex h-touch shrink-0 items-center whitespace-nowrap rounded-sm border px-3 transition-colors duration-100 ${d.date === date ? "border-border-strong bg-accent-soft font-medium text-fg" : "border-border bg-surface-2 text-fg-secondary hover:border-border-strong"}`}
            >
              {d.label}
            </button>
          ))}
          <button
            type="button" aria-pressed={otherDate || !inStrip} aria-expanded={otherDate || !inStrip} onClick={() => setOtherDate(!otherDate)}
            className={`inline-flex h-touch shrink-0 items-center whitespace-nowrap rounded-sm border px-3 transition-colors duration-100 ${!inStrip ? "border-border-strong bg-accent-soft font-medium text-fg" : "border-border bg-surface-2 text-fg-secondary hover:border-border-strong"}`}
          >
            {inStrip ? "Other date" : monthName(date)}
          </button>
        </div>
        {otherDate || !inStrip ? (
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="text-t3">Date</span>
              <input
                type="date" value={dateDraft || date} aria-invalid={dateError ? true : undefined} aria-describedby={dateHelp} className={`${inputClass} ${dateError ? "border-danger" : ""}`}
                onChange={(e) => { setDateDraft(e.target.value); setDateError(null); }}
                onBlur={() => commitDraft(true)}
              />
            </label>
            <div id={dateHelp} className="text-small">{dateError ? <p role="alert" className="text-danger">{dateError}</p> : null}</div>
          </div>
        ) : null}
        {!isToday && rec?.status !== "out_of_season" ? <Choice legend="Time on the water" value={window_ ?? "first_light"} onChange={setWindow} options={WINDOWS} /> : null}
        <div className="flex min-h-touch items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2 text-small text-fg-tertiary" role="status">
            {rec?.day.kind === "past" ? <Badge kind="label">Past date</Badge> : null}
            {rec ? (isToday ? (updated ? `Today, now. Data updated ${updated}.` : "Today, now. No live data yet.") : rec.day.kind === "past" ? "Shown for review, not as advice." : rec.day.kind === "beyond" ? "Forecasts do not reach this date." : "A forecast day.") : "Loading…"}
          </p>
          <Button variant="ghost" size="touch" className="shrink-0 px-3" disabled={busy} onClick={() => void ask()}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      {errorLine}
      <p role="status" aria-live="polite" className="sr-only">{late.length ? `Added: ${late.map((f) => QUESTION_NAME[f]).join(", ")}` : ""}</p>
      {questions.length ? (
        <Card>
          <CardHeader level="h2" title={questions.length === 1 ? "One question" : "A few questions"} right={<Badge tone={rec?.questions.length ? "neutral" : "success"}>{rec?.questions.length ? `${rec.questions.length} left` : "Done"}</Badge>} />
          {questions.map((f) => <div key={f} className={`${part} ${fade(f)}`}>{control(f)}</div>)}
        </Card>
      ) : null}

      {rec && (rec.status === "ok" || rec.status === "out_of_season") ? (
        <Result
          rec={rec} explanation={agentWords ?? rec.explanation} writing={explaining && !agentWords}
          portName={portName} date={date} modeAnswered={mode !== null && rec.engine.month === 8}
          onConditions={() => setStep("conditions")} onEdit={() => { setEditing(null); setStep("questions"); }} onTryDate={pickDate}
        />
      ) : rec ? (
        <div>
          <h1 className="text-t2" tabIndex={-1} data-screen-heading>{portName}, {monthName(date)}</h1>
          <p className="mt-1 text-fg-secondary">Answer {rec.questions.length === 1 ? "the question" : "the questions"} above to see the setup.</p>
        </div>
      ) : null}
    </div>
  );
}

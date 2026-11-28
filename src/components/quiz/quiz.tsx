"use client";

import { ArrowLeft, Check, LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Conditions } from "@/server/conditions";
import type { QuestionField, Recommendation } from "@/server/recommend";
import type { Explanation } from "@/server/agent/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Choice } from "@/components/ui/choice";
import { groupStatus } from "@/lib/chips";
import { ago, monthName } from "@/lib/format";
import { checkDate, defaultDate, nearestFirst, type PortOption } from "@/lib/home";
import { ConditionsView } from "./conditions-view";
import { Result } from "./result";

type Step = "home" | "questions" | "result" | "conditions";
type TimeOfDay = "before_sunrise" | "early" | "day" | "after_sunset";
type Clarity = "clear" | "stained" | "murky" | "unknown";
type Sky = "bright" | "overcast" | "low_light";

const QUESTION_NAME: Record<QuestionField, string> = { time_of_day: "Time on the water", clarity: "Water clarity", sky: "Sky", wind: "Wind", mode: "Where are you fishing", depth: "Depth" };
const inputClass = "h-touch w-full rounded-sm border border-border bg-surface-2 px-3 text-body text-fg hover:border-border-strong";

function ConditionsSummary({ c }: { c: Conditions }) {
  if (!c.temp_station) return null;
  return (
    <p className="text-fg-secondary">
      {c.temp_station.name}, {c.temp_station.distance_mi} miles away, read {c.water_temp_surface_f} °F at the surface {ago(c.age_minutes ?? 0)}
      {c.temp_profile ? ", with temperature at depth" : ""}.
    </p>
  );
}

const today = () => new Date().toLocaleDateString("en-CA");
/** The port order after "Use my location", kept for this browser session. It holds port names, never coordinates. */
const PORT_ORDER_KEY = "port-order";

export function Quiz({ ports: listed }: { ports: PortOption[] }) {
  const [step, setStep] = useState<Step>("home");
  const [ports, setPorts] = useState(listed);
  const [portName, setPortName] = useState(listed.find((p) => p.name === "Muskegon")?.name ?? listed[0]!.name);
  const [date, setDate] = useState("");
  const [openingDay, setOpeningDay] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const dateHelp = useId();
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
  const [agentExplanation, setAgentExplanation] = useState<{ for: string; explanation: Explanation } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const latest = useRef(0);
  // Questions added after the form first rendered: they fade in and are announced, so a shift is never silent.
  const askedNow = useRef<QuestionField[]>([]);
  const [late, setLate] = useState<QuestionField[]>([]);
  const resetAsked = () => { askedNow.current = []; setAsked([]); setLate([]); };

  // Each screen opens at the top with its main heading focused, as a new page would.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector<HTMLElement>("[data-screen-heading]")?.focus({ preventScroll: true });
  }, [step]);

  // The date is set on the device so the page carries no stale date. Out of season it is opening day.
  useEffect(() => {
    const start = defaultDate(today());
    setDate((d) => d || start.date);
    if (start.openingDay) setOpeningDay(start.date);
    try {
      const order: unknown = JSON.parse(sessionStorage.getItem(PORT_ORDER_KEY) ?? "null");
      if (Array.isArray(order) && order.length) {
        const sorted = order.map((name) => listed.find((p) => p.name === name)).filter((p): p is PortOption => Boolean(p));
        if (sorted.length === listed.length) { setPorts(sorted); setPortName(sorted[0]!.name); }
      }
    } catch { /* no session storage: the list keeps its order */ }
  }, [listed]);

  // Asked for only on a tap. The position is used once to sort the list and is not kept.
  const useMyLocation = () => {
    const off = () => { setLocating(false); setLocationNote("Location is off. Pick a port from the list."); };
    if (!navigator.geolocation) return off();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const sorted = nearestFirst(listed, { lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPorts(sorted); setPortName(sorted[0]!.name); setLocating(false);
        setLocationNote(`Nearest port: ${sorted[0]!.name}.`);
        try { sessionStorage.setItem(PORT_ORDER_KEY, JSON.stringify(sorted.map((p) => p.name))); } catch { /* not kept */ }
      },
      (err) => (err.code === err.PERMISSION_DENIED ? off() : (setLocating(false), setLocationNote("Couldn't get your location. Pick a port from the list."))),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const depthNumber = Number(depthValue);
  const depthGiven = depthKind !== "none" && depthValue !== "" && depthNumber >= 0 && depthNumber <= 400;

  const ask = useCallback(async (forDate?: string) => {
    const id = ++latest.current;
    setBusy(true);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          port: portName, date: forDate ?? date, ...(time ? { time_of_day: time } : {}),
          answers: {
            ...(clarity ? { clarity } : {}), ...(sky ? { sky } : {}), ...(wind ? { wind } : {}), ...(mode ? { mode } : {}), lines,
            ...(depthGiven && depthKind === "break" ? { break_depth_ft: depthNumber } : {}),
            ...(depthGiven && depthKind === "lure" ? { lure_depth_ft: depthNumber } : {}),
          },
        }),
      });
      const body = await res.json();
      if (id !== latest.current) return null;
      if (!res.ok) {
        if (body.field === "date") { setDateError(body.error); setError(null); }
        else setError(body.error ?? "Couldn't build a setup. Check your connection and try again.");
        return null;
      }
      setError(null);
      setRec(body as Recommendation);
      // A question stays on screen once asked, so answering it does not make it vanish.
      const before = askedNow.current;
      const added = (body as Recommendation).questions.filter((q) => !before.includes(q));
      if (added.length) {
        if (before.length) setLate((prev) => [...prev, ...added]);
        askedNow.current = [...before, ...added];
        setAsked(askedNow.current);
      }
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

  // The engine result shows at once with templated reasons. The agent's explanation replaces them when it
  // arrives; if it never does, nothing on screen changes and no error is shown.
  const recKey = rec?.recommendation_id ?? null;
  useEffect(() => {
    if (step !== "result" || !rec || !rec.agent_available || !recKey || agentExplanation?.for === recKey) return;
    const controller = new AbortController();
    setExplaining(true);
    fetch("/api/explain", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({
        port: portName, date, ...(time ? { time_of_day: time } : {}), recommendation_id: recKey,
        answers: {
          ...(clarity ? { clarity } : {}), ...(sky ? { sky } : {}), ...(wind ? { wind } : {}), ...(mode ? { mode } : {}), lines,
          ...(depthGiven && depthKind === "break" ? { break_depth_ft: depthNumber } : {}),
          ...(depthGiven && depthKind === "lure" ? { lure_depth_ft: depthNumber } : {}),
        },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body?.explanation) setAgentExplanation({ for: recKey, explanation: body.explanation as Explanation }); })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setExplaining(false); });
    return () => { controller.abort(); setExplaining(false); };
    // The answers are fixed while the result is on screen, so the recommendation id is the only trigger.
  }, [step, recKey]);

  const needsDepth = rec?.questions.includes("depth") ?? false;
  const ready = rec?.status === "ok" && !busy;
  const show = (f: QuestionField) => asked.includes(f);
  const fade = (f: QuestionField) => (late.includes(f) ? "fade-in" : undefined);

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
          const problem = checkDate(date, today());
          setDateError(problem);
          if (problem) { dateInput.current?.focus(); return; }
          resetAsked();
          const first = await ask();
          if (first) setStep(first.status === "out_of_season" ? "result" : "questions");
        }}
      >
        <div>
          <h1 className="text-t1" tabIndex={-1} data-screen-heading>Get a starting setup</h1>
          <p className="mt-2 text-fg-secondary">Pick a port and a date to see which lures to run, how deep and how fast, and why.</p>
        </div>
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="text-t3">Port</span>
              <select value={portName} onChange={(e) => setPortName(e.target.value)} className={inputClass}>
                {ports.map((p) => <option key={p.name} value={p.name}>{p.name}, {p.state}</option>)}
              </select>
            </label>
            <Button variant="ghost" size="touch" className="-ml-3 self-start px-3" disabled={locating} onClick={useMyLocation}>
              <LocateFixed size={16} strokeWidth={1.5} aria-hidden="true" /> Use my location
            </Button>
            <p role="status" className="text-small text-fg-tertiary">{locationNote}</p>
          </div>
          <div className="flex flex-col gap-1 border-t border-border-subtle pt-4">
            <label className="flex flex-col gap-1">
              <span className="text-t3">Date</span>
              <input
                ref={dateInput} type="date" value={date} aria-invalid={dateError ? true : undefined} aria-describedby={dateHelp}
                onChange={(e) => { setDate(e.target.value); setDateError(null); }}
                onBlur={() => { if (date) setDateError(checkDate(date, today())); }}
                className={`${inputClass} ${dateError ? "border-danger" : ""}`}
              />
            </label>
            <div id={dateHelp} className="text-small">
              {dateError ? <p role="alert" className="text-danger">{dateError}</p> : openingDay && date === openingDay ? <p className="text-fg-tertiary">Out of season now. Showing opening day.</p> : null}
            </div>
          </div>
        </Card>
        <div className="mt-auto flex flex-col gap-2 md:mt-0">
          {errorLine}
          <Button type="submit" variant="primary" size="touch" disabled={!date || busy}>Get setup</Button>
          <p className="text-small text-fg-tertiary">The season runs April through October.</p>
        </div>
      </form>
    );
  }

  if (step === "questions") {
    const c = rec?.conditions;
    // A question still needs an answer while the server lists it. A depth choice with no number is one more.
    const need = rec?.questions ?? [];
    const left = (fields: QuestionField[]) => fields.filter((f) => need.includes(f)).length;
    const depthOpen = depthKind !== "none" && !depthGiven;
    const depthRequired = needsDepth || show("depth");
    const groups = [
      { key: "trip", left: left(["time_of_day", "mode"]), shown: true },
      { key: "water", left: left(["clarity", "sky", "wind"]), shown: show("clarity") || show("sky") || show("wind") },
      { key: "depth", left: needsDepth || depthOpen ? 1 : 0, shown: true },
    ].filter((g) => g.shown);
    const done = groups.filter((g) => g.left === 0).length;
    const status = (key: string) => {
      const s = groupStatus(groups.find((g) => g.key === key)!.left);
      return <Badge tone={s.tone} icon={s.tone === "success" ? Check : undefined}>{s.text}</Badge>;
    };
    const part = "border-b border-border-subtle p-4 last:border-b-0";
    return (
      <form className="flex flex-1 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) setStep("result"); }}>
        {back("home")}
        <div>
          <h1 className="text-t2" tabIndex={-1} data-screen-heading>{portName}, {monthName(date)}</h1>
          {c ? <div className="mt-1"><ConditionsSummary c={c} /></div> : null}
          {c?.messages.length ? <p className="mt-1 text-fg-secondary">{c.messages[0]}</p> : null}
        </div>
        <p role="status" aria-live="polite" className="sr-only">{late.length ? `Added: ${late.map((f) => QUESTION_NAME[f]).join(", ")}` : ""}</p>

        <Card>
          <CardHeader level="h2" title="Your trip" right={status("trip")} />
          {show("time_of_day") ? <div className={part}><Choice legend="Time on the water" value={time} onChange={setTime} options={[{ value: "before_sunrise", label: "Before sunrise" }, { value: "early", label: "First two hours" }, { value: "day", label: "Daytime" }, { value: "after_sunset", label: "After sunset" }]} /></div> : null}
          <div className={`${part} flex items-center justify-between gap-3`}>
            <span className="text-t3" id="lines-label">Lines</span>
            <div className="flex items-center gap-2" role="group" aria-labelledby="lines-label">
              <Button size="touch" aria-label="Fewer lines" disabled={lines <= 1} onClick={() => setLines((n) => Math.max(1, n - 1))}><Minus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
              <output className="w-8 text-center text-t2 tabular-nums" aria-live="polite">{lines}</output>
              <Button size="touch" aria-label="More lines" disabled={lines >= 12} onClick={() => setLines((n) => Math.min(12, n + 1))}><Plus size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
            </div>
          </div>
          {show("mode") ? <div className={`${part} ${fade("mode") ?? ""}`}><Choice legend="Where are you fishing" hint="In August some fish are still offshore and some are staging." value={mode} onChange={setMode} options={[{ value: "offshore", label: "Offshore" }, { value: "staging", label: "Near the river mouth" }]} /></div> : null}
        </Card>

        {show("clarity") || show("sky") || show("wind") ? (
          <Card>
            <CardHeader level="h2" title="On the water" right={status("water")} />
            {show("clarity") ? <div className={`${part} ${fade("clarity") ?? ""}`}><Choice legend="Water clarity" value={clarity} onChange={setClarity} options={[{ value: "clear", label: "Clear" }, { value: "stained", label: "Stained" }, { value: "murky", label: "Murky" }, { value: "unknown", label: "Not sure" }]} /></div> : null}
            {show("sky") ? <div className={`${part} ${fade("sky") ?? ""}`}><Choice legend="Sky" hint={time === "before_sunrise" || time === "after_sunset" ? "Not used in the dark: light is low." : "No forecast covers that time."} value={sky} onChange={setSky} options={[{ value: "bright", label: "Bright" }, { value: "overcast", label: "Overcast" }, { value: "low_light", label: "Low light" }]} /></div> : null}
            {show("wind") ? <div className={`${part} ${fade("wind") ?? ""}`}><Choice legend="Wind" hint="No forecast covers that time." value={wind} onChange={setWind} options={[{ value: "calm", label: "Calm" }, { value: "breezy", label: "Breezy or more" }]} /></div> : null}
          </Card>
        ) : null}

        <Card>
          <CardHeader level="h2" title="Depth" right={status("depth")} />
          <div className={`${part} flex flex-col gap-2`}>
            <Choice
              legend="What you know"
              tag={depthRequired ? undefined : <Badge kind="label">Optional</Badge>}
              hint={depthRequired && (needsDepth || depthKind !== "none") ? "There is no depth default for this month without temperature at depth. Give the break depth or the lure depth you plan to run." : "Leave it to the app, or give what you know."}
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
        </Card>

        <div className="mt-auto flex flex-col gap-2 md:mt-0">
          {errorLine}
          {/* Kept in place when everything is done, so the button under it does not move. */}
          <div className={`flex items-center gap-3 ${done === groups.length ? "invisible" : ""}`}>
            <div className="flex flex-1 gap-1" role="progressbar" aria-label="Question groups done" aria-valuemin={0} aria-valuemax={groups.length} aria-valuenow={done}>
              {groups.map((g) => <span key={g.key} className={`h-1 flex-1 rounded-full ${g.left === 0 ? "bg-accent" : "bg-surface-3"}`} />)}
            </div>
            <span className="text-small tabular-nums text-fg-tertiary">{done} of {groups.length} done</span>
          </div>
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

  const agentWords = agentExplanation && agentExplanation.for === recKey ? agentExplanation.explanation : null;
  return (
    <div className="flex flex-1 flex-col gap-4">
      {back(rec?.status === "out_of_season" ? "home" : "questions")}
      {rec ? (
        <Result
          rec={rec} explanation={agentWords ?? rec.explanation} writing={explaining && !agentWords}
          portName={portName} date={date} modeAnswered={asked.includes("mode")} onConditions={() => setStep("conditions")}
          onTryDate={async (next) => {
            setDate(next);
            resetAsked();
            const first = await ask(next);
            if (first && first.status !== "out_of_season") setStep("questions");
          }}
        />
      ) : null}
    </div>
  );
}

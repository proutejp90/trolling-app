/**
 * What the chips and indicators say. Pure functions: the screens only draw
 * what these return, and every limit comes in as an argument from the thresholds.
 */
export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export interface Chip { text: string; tone: ChipTone }

/** How old the water reading behind the depth is. Success up to the fresh limit, warning past it. */
export function dataAge(ageMinutes: number | null, freshHours: number, model?: { forecast: boolean } | null): Chip {
  // The lake model is not a reading, so it gets no fresh-or-stale tone: only what it is and how old the run is.
  if (model) return { text: model.forecast ? "Model forecast" : ageMinutes !== null && ageMinutes >= 60 ? `Model run ${Math.round(ageMinutes / 60)} h old` : "Model run under 1 h old", tone: "accent" };
  if (ageMinutes === null) return { text: "No live water data", tone: "neutral" };
  const text = ageMinutes < 60 ? `Buoy ${ageMinutes} min old` : `Buoy ${Math.round(ageMinutes / 60)} h old`;
  return { text, tone: ageMinutes <= freshHours * 60 ? "success" : "warning" };
}

/** A station reading is stale past the stale limit. At the limit it is not. */
export const isStale = (ageMinutes: number, staleHours: number) => ageMinutes > staleHours * 60;

interface ChipInput {
  water: { temp_f: number | null; has_station: boolean; modeled?: boolean };
  inputs: { sky: string | null; wind_calm: boolean | null; clarity: string | null };
  sources: { sky: "forecast" | "you" | "time of day" | null; wind: "forecast" | "buoy" | "you" | null; depth_kind: "buoy" | "model" | "break" | "lure" | "default" | null };
  upwelling: boolean;
}

const WHO: Record<string, { word: string; tone: ChipTone }> = {
  you: { word: "you", tone: "neutral" }, buoy: { word: "buoy", tone: "info" }, forecast: { word: "forecast", tone: "accent" }, "time of day": { word: "time of day", tone: "neutral" },
};
const DEPTH: Record<string, Chip> = {
  buoy: { text: "Depth · buoy", tone: "info" }, model: { text: "Depth · modeled", tone: "accent" }, break: { text: "Depth · your break", tone: "neutral" },
  lure: { text: "Depth · your lure depth", tone: "neutral" }, default: { text: "Depth · month default", tone: "warning" },
};

/** One chip per input the engine used, each saying the value and where it came from. The tone is the dot. */
export function conditionChips(r: ChipInput): Chip[] {
  const chips: Chip[] = [];
  if (r.water.modeled && r.water.temp_f !== null) chips.push({ text: `Water ${r.water.temp_f} °F · modeled`, tone: "accent" });
  else if (r.water.has_station && r.water.temp_f !== null) chips.push({ text: `Water ${r.water.temp_f} °F · buoy`, tone: "info" });
  if (r.inputs.sky && r.sources.sky) chips.push({ text: `Sky ${r.inputs.sky.replace("_", " ")} · ${WHO[r.sources.sky]!.word}`, tone: WHO[r.sources.sky]!.tone });
  if (r.inputs.wind_calm !== null && r.sources.wind) chips.push({ text: `Wind ${r.inputs.wind_calm ? "calm" : "breezy"} · ${WHO[r.sources.wind]!.word}`, tone: WHO[r.sources.wind]!.tone });
  if (r.inputs.clarity && r.inputs.clarity !== "unknown") chips.push({ text: `Clarity ${r.inputs.clarity} · you`, tone: "neutral" });
  if (r.sources.depth_kind) chips.push(DEPTH[r.sources.depth_kind]!);
  if (r.upwelling) chips.push({ text: "Upwelling likely · wind history", tone: "info" });
  return chips;
}

/** Meridian: never more than three badges in a row. The rest collapse into "+2". */
export function capBadges<T>(badges: T[], max = 3): { shown: T[]; more: number } {
  return badges.length <= max ? { shown: badges, more: 0 } : { shown: badges.slice(0, max - 1), more: badges.length - (max - 1) };
}

/** Status of one group of questions: how many still need an answer. */
export const groupStatus = (left: number): Chip => (left === 0 ? { text: "Done", tone: "success" } : { text: `${left} left`, tone: "neutral" });

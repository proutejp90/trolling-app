/**
 * Templated reasons, one sentence per rule. Shown by the quiz now and used as
 * the fallback whenever the agent is unavailable (Phase 3). They state no
 * numbers: depths and speeds are always read from the engine output.
 */
import type { SetupLureType, Tag } from "@recommender/engine";

export const REASONS: Record<string, string> = {
  R01: "In April and May, Chinook hold near shore in the top of the water column.",
  R02: "In June and July, fish are suspended offshore and moving north.",
  R03: "In August, fish are offshore and some begin to stage near river mouths.",
  R04: "In September and October, fish stage at river mouths and pierheads.",
  R05: "Depth starts where the water cools into the preferred temperature band, or at the break, and runs below it.",
  R06: "With no temperature data, depth comes from July fishing reports.",
  R07: "With no temperature data, depth comes from August fishing reports.",
  R08: "North or east wind brings cold water up on this shore, so the range moves shallower.",
  R09: "This shallow, every color still shows.",
  R10: "Red and orange fade at this depth unless the finish is fluorescent.",
  R11: "At this depth, green, blue, silver, chartreuse, chrome, glow and fluorescent finishes are what still show.",
  R12: "Glow leads when lures run deep or light is low.",
  R13: "UV finishes are left out unless the lure runs shallow in clear water.",
  R14: "Stained water favors chartreuse, firetiger and glow, and colors fade at shallower depths.",
  R15: "Clear water under a bright sky favors chrome or silver with a green or blue back, in smaller sizes.",
  R16: "Staging fish respond to fluorescent and glow finishes, ladderback patterns first.",
  R17: "For staging fish, plugs hold their action across a wide speed range.",
  R18: "Offshore, plugs run best in a narrow, faster band.",
  R20: "Past the depth where blue fades, only silver, chrome and glow still show.",
  P01: "Spoons lead when lures run this shallow.",
  P02: "Flasher and fly leads at this depth, with one spoon line kept.",
  P03: "This deep, run flasher and fly and meat only.",
  P04: "In the dark, glow spoons lead, with one glow plug from July on.",
  P05: "For staging fish, plugs lead and meat follows.",
  P06: "From July on, meat rigs go on the deepest lines once the sun is well up.",
  P07: "Bright and calm near the surface calls for clean lures with no attractors.",
  P08: "Stained water calls for at least one flasher and fly.",
  P09: "Warm water at the lure moves a spoon line to flasher and fly.",
  P10: "This deep, use larger attractors and fewer lines.",
  P11: "Meat takes no more than half the lines.",
};

export const TYPE_NAME: Record<SetupLureType, string> = {
  spoon: "Spoon", flasher_fly: "Flasher and fly", meat_rig: "Meat rig", plug: "Plug",
};

export const TYPE_SPEED_REASON: Record<Exclude<SetupLureType, "plug">, { text: string; tags: Tag[] }> = {
  spoon: { text: "Spoon speed comes from captain experience.", tags: ["lore"] },
  flasher_fly: { text: "Flasher and fly speed comes from captain experience.", tags: ["lore"] },
  meat_rig: { text: "Meat rig speed is an estimate: sources say only that meat runs slower than spoons.", tags: ["lore"] },
};

/** One sentence per evidence tag, shown when the tag is tapped. Fixed here so the agent never writes them. */
export const TAG_EXPLAINER: Record<Tag | "your_log", string> = {
  science: "Based on fisheries research.",
  reports: "Based on recent Michigan DNR fishing reports.",
  lore: "Captain and angler experience. No research backs it.",
  your_log: "Based on your own logged trips.",
};

/** Shown with every result. */
export const SPEED_CAVEAT = "Speeds are speed at the lure, which can differ from the speed your GPS shows.";
export const FOOTER = "A starting setup based on conditions, reports and angler experience.";
export const KNOWN_LIMITS = [
  "The rules cover Chinook on Lake Michigan only.",
  "Color depth bands come from angling literature and have not been measured for this lake.",
  "Speed and lure type guidance is captain and angler experience. No research supports it.",
];

/**
 * Where depth came from is said once, in the confidence box. This line is added
 * there only when the confidence reason does not already name the source.
 */
export function depthSourceLine(confidenceReason: string, depthSource: string): string | null {
  return confidenceReason.toLowerCase().includes(depthSource.toLowerCase()) ? null : `Depth comes from ${depthSource}.`;
}

const RESTATES_DEPTH_SOURCE = /\bmonth(ly)? defaults?\b|\bdepth (comes|is|are)\b[^.;]*\b(from|estimate|starting)\b|\bno (live |recent )?(water|buoy) (data|reading)/i;

/** The caveats to show: any that restate where depth came from are dropped, since the confidence box covers it. */
export function caveatsToShow(caveats: string[], depthSource: string): string[] {
  return caveats.filter((c) => !c.toLowerCase().includes(depthSource.toLowerCase()) && !RESTATES_DEPTH_SOURCE.test(c));
}

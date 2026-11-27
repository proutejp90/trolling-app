/**
 * PLACEHOLDER catalog. Non-plug entries are generic archetypes, as the spec
 * assumes. The plugs stand in for the owner's own line: house brand, no names,
 * photos, tested speed ranges or shop links yet.
 */
import type { CATALOG_LURE_TYPES, COLOR_FAMILIES, FINISH_TYPES } from "@recommender/engine";

export interface FinishSeed {
  name: string; base_color: string;
  finish_types: (typeof FINISH_TYPES)[number][];
  pattern: string | null;
  color_family: (typeof COLOR_FAMILIES)[number];
}
export interface LureSeed {
  lure_type: (typeof CATALOG_LURE_TYPES)[number];
  name: string; brand: string | null; is_house_brand: boolean;
  size_in: number | null; body_style: string | null;
  speed_min_mph: number | null; speed_max_mph: number | null;
  dive_notes: string | null; shop_url: string | null;
  finishes: FinishSeed[];
}

const fin = (name: string, base_color: string, color_family: FinishSeed["color_family"], finish_types: FinishSeed["finish_types"], pattern: string | null = null): FinishSeed =>
  ({ name, base_color, color_family, finish_types, pattern });

/** Covers every color rule's boundary cases: plain and fluorescent red, UV-only, glow, chrome backs, ladderback. */
const hardBaitFinishes: FinishSeed[] = [
  fin("Green glow", "green", "green", ["glow"]),
  fin("Blue glow", "blue", "blue", ["glow"]),
  fin("White glow", "white", "white", ["glow"]),
  fin("Glow ladderback", "white", "green", ["glow"], "ladderback"),
  fin("Chrome, green back", "silver", "silver", ["chrome"], "green back"),
  fin("Chrome, blue back", "silver", "silver", ["chrome"], "blue back"),
  fin("Plain silver", "silver", "silver", ["paint"]),
  fin("Chartreuse", "chartreuse", "chartreuse", ["fluorescent"]),
  fin("Firetiger", "chartreuse", "chartreuse", ["fluorescent", "paint"], "firetiger"),
  fin("Plain red", "red", "red", ["paint"]),
  fin("Fluorescent red", "red", "red", ["fluorescent"]),
  fin("Plain orange", "orange", "orange", ["paint"]),
  fin("Fluorescent orange", "orange", "orange", ["fluorescent"]),
  fin("UV blue", "blue", "blue", ["uv"]),
];

const attractorFinishes: FinishSeed[] = [
  fin("White", "white", "white", ["paint"]),
  fin("White glow", "white", "white", ["glow"]),
  fin("Chrome", "silver", "silver", ["chrome"]),
  fin("Green glow", "green", "green", ["glow"]),
  fin("Chartreuse", "chartreuse", "chartreuse", ["fluorescent"]),
];

const softFinishes: FinishSeed[] = [
  fin("Green", "green", "green", ["paint"]),
  fin("Green glow", "green", "green", ["glow"]),
  fin("Blue", "blue", "blue", ["paint"]),
  fin("White glow", "white", "white", ["glow"]),
  fin("Chartreuse", "chartreuse", "chartreuse", ["fluorescent"]),
];

const lure = (lure_type: LureSeed["lure_type"], name: string, size_in: number | null, speed: [number, number] | null, finishes: FinishSeed[], extra: Partial<LureSeed> = {}): LureSeed => ({
  lure_type, name, brand: null, is_house_brand: false, size_in, body_style: null,
  speed_min_mph: speed?.[0] ?? null, speed_max_mph: speed?.[1] ?? null,
  dive_notes: null, shop_url: null, finishes, ...extra,
});

export const lures: LureSeed[] = [
  lure("spoon", "Mini spoon", 2.75, [2.4, 3.0], hardBaitFinishes),
  lure("spoon", "Standard spoon", 3.75, [2.4, 3.0], hardBaitFinishes),
  lure("spoon", "Magnum spoon", 4.75, [2.4, 3.0], hardBaitFinishes),

  // Tested speed ranges are placeholders spanning R17 and R18 until the owner supplies them.
  lure("plug", "House plug, small (placeholder)", 3.5, [1.8, 3.0], hardBaitFinishes, { is_house_brand: true, body_style: "placeholder" }),
  lure("plug", "House plug, large (placeholder)", 4.5, [1.8, 3.0], hardBaitFinishes, { is_house_brand: true, body_style: "placeholder" }),

  lure("attractor", "8 inch flasher", 8, null, attractorFinishes, { body_style: "flasher" }),
  lure("attractor", "11 inch flasher", 11, null, attractorFinishes, { body_style: "flasher" }),

  lure("fly", "Trolling fly", null, [2.0, 2.5], softFinishes),
  lure("meat_rig", "Meat rig, head and teaser", null, [1.8, 2.2], softFinishes, { dive_notes: "Bait type is a note on the pass." }),
];

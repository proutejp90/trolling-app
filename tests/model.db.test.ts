/** The lake model upload: what the Python job posts is checked and stored. Real job output, no network. */
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { modelSetup, modelUpload, storeModel, type ModelUpload } from "../src/server/jobs/model";
import { loadRuleset } from "../src/server/ruleset";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("lake model upload", () => {
  let db: pg.Client, upload: ModelUpload;
  const now = new Date("2026-11-28T15:40:00Z");
  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    const port = (await db.query("select id from public.ports where name = 'Muskegon'")).rows[0].id;
    const raw = JSON.parse(readFileSync("fixtures/lmhofs/upload-muskegon.json", "utf8"));
    const withId = <T extends { port_id: string }>(rows: T[]) => rows.map((r) => ({ ...r, port_id: port }));
    upload = modelUpload.parse({ run_at: raw.run_at, points: withId(raw.points), profiles: withId(raw.profiles) });
  });
  beforeEach(() => db.query("truncate public.model_points cascade"));
  afterAll(async () => { await db.query("truncate public.model_points cascade"); await db.end(); });

  it("tells the job which ports to read and where the temperature band tops out", async () => {
    const setup = await modelSetup(db, (await loadRuleset(db)).thresholds);
    expect(setup.temp_band_top_f).toBe(55);
    expect(setup.ports).toHaveLength(10);
    expect(setup.ports.find((p) => p.name === "Muskegon")).toMatchObject({ lat: 43.227, lon: -86.341, shore: "east" });
  });

  it("stores three sample points and a profile for each", async () => {
    expect(await storeModel(db, upload, now)).toEqual({ points: 3, profiles: 3 });
    const points = (await db.query("select label, bottom_depth_m, node_index from public.model_points order by bottom_depth_m")).rows;
    expect(points.map((p) => p.label)).toEqual(["near", "mid", "off"]);
    // About 60, 120 and 200 ft of water.
    expect(points.map((p) => Math.round(Number(p.bottom_depth_m) * 3.28084))).toEqual([62, 116, 200]);
    const off = (await db.query("select pr.* from public.model_profiles pr join public.model_points mp on mp.id = pr.model_point_id where mp.label = 'off'")).rows[0];
    expect(off.profile).toHaveLength(20);
    expect(off.is_forecast).toBe(false);
    expect(Number(off.band_depth_m)).toBe(0); // late November: the whole column is under 55 F
    expect(Number(off.break_depth_m)).toBeGreaterThan(20);
    expect(new Date(off.run_at).toISOString()).toBe("2026-11-28T12:00:00.000Z");
  });

  it("lets a newer run replace an hour, and never an older one", async () => {
    await storeModel(db, upload, now);
    const warmer = { ...upload, points: [], profiles: upload.profiles.map((p) => ({ ...p, surface_temp_c: 20 })) };
    expect((await storeModel(db, { ...warmer, run_at: "2026-11-28T06:00:00Z" }, now)).profiles).toBe(0);
    expect((await db.query("select distinct surface_temp_c from public.model_profiles")).rows.every((r) => Number(r.surface_temp_c) < 15)).toBe(true);
    expect((await storeModel(db, { ...warmer, run_at: "2026-11-28T18:00:00Z" }, now)).profiles).toBe(3);
    expect((await db.query("select distinct surface_temp_c from public.model_profiles")).rows.map((r) => Number(r.surface_temp_c))).toEqual([20]);
    expect((await db.query("select count(*)::int as n from public.model_profiles")).rows[0].n).toBe(3); // still one per point per hour
  });

  it("drops profiles more than two days past, and ignores a port it does not know", async () => {
    await storeModel(db, upload, now);
    await storeModel(db, { ...upload, points: [], profiles: [] }, new Date("2026-12-01T00:00:00Z"));
    expect((await db.query("select count(*)::int as n from public.model_profiles")).rows[0].n).toBe(0);
    const stranger = "00000000-0000-4000-8000-000000000000";
    expect(await storeModel(db, { ...upload, points: upload.points.map((p) => ({ ...p, port_id: stranger })), profiles: upload.profiles.map((p) => ({ ...p, port_id: stranger })) }, now)).toMatchObject({ profiles: 0 });
  });

  it("refuses an upload that is not in shape", () => {
    expect(modelUpload.safeParse({ ...upload, profiles: [{ ...upload.profiles[0], surface_temp_c: 80 }] }).success).toBe(false); // Fahrenheit by mistake
    expect(modelUpload.safeParse({ ...upload, points: [{ ...upload.points[0], label: "deep" }] }).success).toBe(false);
    expect(modelUpload.safeParse({ ...upload, extra: true }).success).toBe(false);
  });
});

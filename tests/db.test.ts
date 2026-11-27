/**
 * Database checks against the migrated and seeded schema. Skipped when
 * DATABASE_URL is not set, so unit tests run without Postgres. CI sets it.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe.skipIf(!url)("database", () => {
  let db: pg.Client;

  /** Runs fn as the given API role and user inside a transaction that always rolls back. */
  async function as<T>(role: "anon" | "authenticated", user: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query("begin");
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
      await db.query(`set local role ${role}`);
      return await fn();
    } finally {
      await db.query("rollback");
    }
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [A, B]);
    const port = (await db.query("select id from public.ports order by name limit 1")).rows[0].id;
    await db.query(
      `insert into public.trips (id, user_id, port_id, started_at) values ($1, $2, $3, now() - interval '2 hours')`,
      [A, A, port],
    );
    await db.query(
      `insert into public.passes (trip_id, started_at, ended_at, lure_type, lure_depth_ft, speed_mph, outcome)
       values ($1, now() - interval '2 hours', now() - interval '1 hour', 'plug', 62, 2.5, 'hit'),
              ($1, now() - interval '1 hour', now(), 'plug', 64, 2.4, 'no_hit')`,
      [A],
    );
    await db.query(`insert into public.notes (user_id, subject_type, subject_id, body, pinned) values ($1, 'port', $2, 'A private note', true)`, [A, port]);
    await db.query(`insert into public.probe_readings (user_id, trip_id, taken_at, break_depth_ft) values ($1, $1, now(), 62)`, [A]);
    await db.query("select public.refresh_personal_results()");
  });

  afterAll(async () => {
    await db.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await db.query("select public.refresh_personal_results()");
    await db.end();
  });

  it("is seeded with rules, thresholds, ports, stations and all lure types", async () => {
    const { rows } = await db.query(
      `select (select count(*)::int from public.rules where code like 'R%') as r,
              (select count(*)::int from public.rules where code like 'P%') as p,
              (select count(*)::int from public.thresholds) as thresholds,
              (select count(*)::int from public.ports) as ports,
              (select count(*)::int from public.stations) as stations,
              (select count(distinct lure_type)::int from public.lures where active) as lure_types`,
    );
    expect(rows[0]).toMatchObject({ r: 19, p: 12, lure_types: 5 });
    expect(rows[0].thresholds).toBeGreaterThanOrEqual(10);
    expect(rows[0].ports).toBeGreaterThan(0);
    expect(rows[0].stations).toBe(6);
  });

  it("lets anyone read the catalog, ports and rules but not change them", async () => {
    await as("anon", null, async () => {
      expect((await db.query("select count(*)::int as n from public.rules")).rows[0].n).toBe(31);
      expect((await db.query("select count(*)::int as n from public.lures")).rows[0].n).toBeGreaterThan(0);
      expect((await db.query("update public.rules set enabled = false")).rowCount).toBe(0);
    });
    await as("authenticated", B, async () => {
      expect((await db.query("update public.thresholds set value = '1'")).rowCount).toBe(0);
    });
  });

  it("lets the owner change a rule", async () => {
    await db.query("insert into public.app_admins (user_id) values ($1)", [B]);
    try {
      await as("authenticated", B, async () => {
        expect((await db.query("update public.rules set enabled = false where code = 'R19'")).rowCount).toBe(1);
      });
    } finally {
      await db.query("delete from public.app_admins where user_id = $1", [B]);
    }
  });

  it("shows an angler their own trips, passes, notes, readings and results", async () => {
    await as("authenticated", A, async () => {
      for (const [table, n] of [["trips", 1], ["passes", 2], ["notes", 1], ["probe_readings", 1]] as const) {
        expect((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, table).toBe(n);
      }
      const results = (await db.query("select depth_band, speed_band::float, passes, hits from public.personal_results order by speed_band")).rows;
      expect(results).toEqual([
        { depth_band: 60, speed_band: 2.4, passes: 2, hits: 1 },
      ]);
    });
  });

  it("shows another angler and the public none of it", async () => {
    for (const [role, user] of [["authenticated", B], ["anon", null]] as const) {
      await as(role, user, async () => {
        for (const table of ["trips", "passes", "notes", "probe_readings"]) {
          expect((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, `${role} ${table}`).toBe(0);
        }
        if (role === "authenticated") {
          expect((await db.query("select count(*)::int as n from public.personal_results")).rows[0].n).toBe(0);
          await expect(db.query("insert into public.passes (trip_id, started_at, ended_at, lure_type, outcome) values ($1, now(), now(), 'plug', 'hit')", [A])).rejects.toThrow(/row-level security/);
        } else {
          await expect(db.query("select 1 from public.personal_results")).rejects.toThrow(/permission denied/);
        }
      });
    }
  });

  it("requires an outcome on every pass", async () => {
    await expect(
      db.query("insert into public.passes (trip_id, started_at, ended_at, lure_type) values ($1, now(), now(), 'plug')", [A]),
    ).rejects.toThrow(/outcome/);
  });
});

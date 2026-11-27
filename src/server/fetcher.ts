/**
 * The one door to the outside. Every external fetch goes through here so it
 * gets a timeout, retries, a short in-process cache, an identifying User-Agent,
 * and a recorded-fixture mode for tests.
 *
 *   FIXTURES=replay:<set>  read fixtures/<set>/<key>.json, never touch the network
 *   FIXTURES=record:<set>  fetch live, then write that file
 *
 * Tests always replay. A missing fixture in replay mode is an error, not a fetch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Fetched { status: number; body: string }
export interface FetchOptions {
  /** Stable name for this request, independent of dates in the URL. Doubles as the fixture file name. */
  key: string;
  timeoutMs?: number;
  retries?: number;
  cacheMs?: number;
  headers?: Record<string, string>;
}

const cache = new Map<string, { at: number; value: Fetched }>();
const fixtureMode = () => {
  const [mode, set] = (process.env.FIXTURES ?? "").split(":");
  return (mode === "replay" || mode === "record") && set ? { mode, set } : null;
};
const fixturePath = (set: string, key: string) => join(process.cwd(), "fixtures", set, `${key.replace(/[^A-Za-z0-9._/-]/g, "_")}.json`);

/** In replay mode the clock can be pinned so fixtures line up with "now". Ignored otherwise. */
export function currentTime(): Date {
  const fixed = process.env.FIXED_NOW;
  return fixed && fixtureMode()?.mode === "replay" ? new Date(fixed) : new Date();
}

export async function fetchText(url: string, opts: FetchOptions): Promise<Fetched> {
  const fx = fixtureMode();
  if (fx?.mode === "replay") {
    const path = fixturePath(fx.set, opts.key);
    if (!existsSync(path)) throw new Error(`No fixture for ${opts.key} in set ${fx.set}. Tests never call live APIs.`);
    const { status, body } = JSON.parse(readFileSync(path, "utf8")) as Fetched;
    return { status, body };
  }

  const hit = cache.get(url);
  if (hit && opts.cacheMs && Date.now() - hit.at < opts.cacheMs) return hit.value;

  const retries = opts.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": process.env.NWS_USER_AGENT ?? "conditions-recommender", Accept: "*/*", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      // A 404 is an answer (a buoy pulled for winter), not a failure. Retry only server errors and rate limits.
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      const value = { status: res.status, body: await res.text() };
      cache.set(url, { at: Date.now(), value });
      if (fx?.mode === "record") {
        const path = fixturePath(fx.set, opts.key);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ url, recorded_at: new Date().toISOString(), ...value }, null, 1));
      }
      return value;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Fetch failed for ${opts.key}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

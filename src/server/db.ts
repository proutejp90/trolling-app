import pg from "pg";

/** Anything with query(): the pool in the app, a client inside a test transaction. */
export type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | null = null;

/** Without DATABASE_URL the app still runs: bundled rules, no live conditions. */
export const hasDb = () => Boolean(process.env.DATABASE_URL);

export function db(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return pool;
}

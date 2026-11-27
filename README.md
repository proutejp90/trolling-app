# Conditions recommender

A mobile web app that tells a Lake Michigan salmon troller which lures to run, how deep and how fast, for a chosen port and date, and explains why. A rules engine decides; an LLM agent explains; a trolling log records every setup, including the ones that catch nothing.

Status: **Phase 1, rules engine.** The engine passes golden scenarios G1 to G16 and a manual quiz returns a spread for April through October. Live conditions arrive in Phase 2.

## Start from a fresh clone

You need Node 20 or newer and a Postgres 16 database. For a local one:

```bash
docker compose up -d
```

Then one command installs, generates the design tokens, migrates, seeds and builds:

```bash
npm run setup
```

It reads `DATABASE_URL` and defaults to the local database above. Copy `.env.example` to `.env.local` for the app's own settings.

```bash
npm run dev
```

## Checks

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/conditions npm test
```

```bash
npm run build && npm run test:e2e
```

## Where things are

| Path | What |
|---|---|
| `packages/engine` | Standalone rules engine: `evaluate(context, rules, thresholds, catalog)` |
| `seed/` | 19 starter rules, 12 presentation rules, thresholds, placeholder ports, stations and lures |
| `supabase/migrations` | Postgres schema with row-level security |
| `design-system/` | Meridian, the owner's design system |
| `src/` | Next.js app |
| `DECISIONS.md` | Every choice the spec left open, and why |

Fishing report data, where shown, is credited to the Michigan DNR.

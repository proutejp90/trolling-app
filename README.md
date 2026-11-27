# Conditions recommender

A mobile web app that tells a Lake Michigan salmon troller which lures to run, how deep and how fast, for a chosen port and date, and explains why. A rules engine decides; an LLM agent explains; a trolling log records every setup, including the ones that catch nothing.

Status: **Phase 2, live conditions.** A scheduled job caches buoy and forecast data in Postgres, and recommendations are built from that cache, asking only what the data could not answer. The explaining agent arrives in Phase 3.

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

The flow tests need the database: they load the recorded autumn fixtures into the cache first.

## Refreshing conditions

```bash
npm run job:refresh
```

In production a scheduler posts to `/api/jobs/refresh` every 30 minutes with `Authorization: Bearer $CRON_SECRET`. Buoy data is from NOAA NDBC and GLOS; forecasts are from the National Weather Service.

## Where things are

| Path | What |
|---|---|
| `packages/engine` | Standalone rules engine: `evaluate(context, rules, thresholds, catalog)` |
| `seed/` | 19 starter rules, 12 presentation rules, thresholds, placeholder ports, stations and lures |
| `supabase/migrations` | Postgres schema with row-level security |
| `design-system/` | Meridian, the owner's design system |
| `src/` | Next.js app. `src/server` holds the fetch module, source parsers, refresh job and conditions service |
| `fixtures/` | Recorded source responses that tests replay |
| `DECISIONS.md` | Every choice the spec left open, and why |

Fishing report data, where shown, is credited to the Michigan DNR.

# Decisions

Every choice the build spec left open, and why it was made. Newest phase last. Items marked **Owner to confirm** are proposals, not settled.

## Phase 0: foundation

### Repo and tooling

| Decision | Why |
|---|---|
| npm workspaces: the Next.js app at the root, the engine at `packages/engine` | The spec wants the engine in a standalone package with no framework imports. An ESLint rule blocks Next, React, Supabase and Anthropic imports there. |
| Next.js 16, React 19, Tailwind 3.4 | Tailwind 3 takes Meridian's `tailwind.config.js` mapping exactly as `implementation.md` section 2 gives it. |
| Fonts load from Google Fonts by CSS import, as `implementation.md` shows | Keeps the build free of network calls. Revisit self-hosting for offline use in Phase 5. |
| Migrations are plain SQL in `supabase/migrations`, applied by `scripts/db.mts` | The same files run on Supabase and on plain Postgres. Local and CI use plain Postgres plus `supabase/local-shim.sql`, which adds `auth.users`, `auth.uid()` and the `anon`, `authenticated` and `service_role` roles. The shim is skipped when an `auth` schema exists. |
| Re-seeding never overwrites existing rules or thresholds | The owner edits those in admin. A re-seed inserts only missing rows. |
| Supabase project `conditions-recommender` (ref `eyegnwclepsypoejhrmj`, us-east-2), created for this app | The account's other project was left untouched. The build environment cannot open a Postgres connection to Supabase, so the migrations were applied through Supabase's migration tool and the seed through `npm run db:seed:sql`, which prints the same rows as `db:seed` as one SQL script. A checksum over rules, thresholds, finishes and port links matches the local database. `db:migrate` recognises migrations Supabase already recorded. |
| `is_admin()` is not executable by signed-out callers | Supabase's security check flags security-definer functions open to `anon`. Its other two findings are by design: `app_admins` has no policies, and `public.personal_results` is a definer view filtered by `auth.uid()`. |

### Schema

| Decision | Why |
|---|---|
| `rules.tags` is a `text[]` of one or two tags, strongest first | R05 is Science + Lore and R12 is Science + Reports. A single tag column cannot hold them. |
| `rules.lakes` and `rules.species`; `ports.lake`; `stations.lake` | The spec asks to keep species and lake as fields. |
| P08 is seeded disabled | Its only evidence is a Lake Ontario poster, and the spec says to seed Lake Ontario-only evidence as disabled notes. |
| R08 and P09 are seeded enabled but cannot fire | They read `upwelling_shift_ft` and `warm_water_f`, which have no value. A rule that reads a null threshold is skipped. Golden scenario G8 needs `upwelling_shift_ft` before Phase 1 can pass. |
| Thresholds beyond the spec's table are rows too: per-type speed ranges, the presentation depth cutoffs (55, 80, 100 ft), leader lengths, default lines, probe trust limits, personal-results minimums, freshness limits | So the owner can tune them without editing rules. |
| `passes` rows are written when a pass ends; `outcome` and `ended_at` are `not null` | The spec requires an outcome on every pass. A line still down lives in the device queue until it closes. |
| `passes.line_name`, `passes.hit_at`, `passes.notes`; `trips.lines`, `trips.clarity`, `trips.speed_source` | The log flow names lines once per trip, stamps Fish on, records bait type as a note, and asks clarity and speed source once per trip. |
| `report_rows.source_paragraph` and `report_rows.passed_validation`; view `usable_report_rows` | The review queue shows the source paragraph. The view is the one place that applies "auto rows that pass validation, and approved rows". |
| `personal_results` is a materialized view in a `private` schema, read through `public.personal_results` filtered by `auth.uid()` | Row-level security does not apply to materialized views. |
| Depth bands are 10 ft and speed bands 0.2 mph, lower edge; month uses America/Detroit | The spec names the bands but not their width. **Owner to confirm.** |
| `app_admins` table and `is_admin()` gate owner writes | The spec says owner write but not how the owner is identified. |
| Anglers' trips, passes, readings and notes have no admin read policy | The spec says they are private to the angler. Log-versus-rule conflicts for the admin screen (G21) will be written as counts by the server, without exposing rows. |
| `recommendations` also stores `prompt_version`, `used_fallback`, `confidence`, `cache_key` | The spec asks to store the prompt version, and these make the 30 minute cache and the fallback rate measurable. |

### Rule conditions

Rules keep the spec's shape. A leaf compares a context field with a literal `value` or a named `threshold`, so rules like R10 read `red_max_ft` and `yellow_max_ft` and move when the owner tunes them. `{ "all": [] }` means always. The `recommend` payload is free-form JSON per stage in Phase 0; Phase 1 tightens it as the golden scenarios are written.

### Seed data, all placeholders

| Item | Status |
|---|---|
| Ports | Ten Michigan-side ports, St. Joseph to Leland. Coordinates are approximate, from memory. **Owner to supply the launch list.** |
| Stations | The six NDBC stations the spec names. Coordinates are approximate and **unverified**: NDBC, GLOS Seagull and NWS were not reachable when Phase 0 was built. They are allowed now, through the `conditions-recommender` cloud environment. With only these six, Pentwater, Ludington, Manistee, Frankfort and Leland have no buoy within 25 miles. Phase 2 rebuilds the table from the live station lists. |
| Lures | Generic archetypes: three spoons, two flashers, one fly, one meat rig, and two unnamed house-brand plugs with a placeholder speed range of 1.8 to 3.0 mph. Finishes cover every color rule's boundary case. |

### Design system

Meridian was copied from the owner's design system into `/design-system` (README, tokens.json, implementation.md, components). `src/styles/tokens.css` is generated from `tokens.json`; CI fails if it is stale.

On-water profile, angler screens only, as the spec lists:

| Meridian default | Angler screens | Status |
|---|---|---|
| 36px list rows | 44px rows (`h-touch`) | Meridian's own touch rule |
| 28px controls | 44px controls; Fish on and Probe 56px (`h-touch-lg`) | 56px is beyond Meridian. **Owner to confirm.** |
| 13px default text | 14px body as default (`.on-water`); key numbers at title-1 | Reading at arm's length |
| Dark theme first | Follows the phone on first load; one-tap switch in the top bar; choice saved on the device | Meridian's `implementation.md` also defaults to the OS preference |
| Sidebar | Overlay drawer under 768px | Meridian's own responsive rule |
| One accent-filled button per view | Every Fish on button on Active trip is accent-filled | Beyond Meridian. **Owner to confirm.** |
| Keyboard shortcut for every action | Shortcuts and command palette on desktop and admin only | Beyond Meridian. **Owner to confirm.** |

The design lint (`scripts/lint-design.mjs`) fails the build on any hex color or default Tailwind palette class under `src/`, and Tailwind's default palette is removed by the mapping.

## Still open for later phases

- Which Seagull platforms near each port report temperature at depth, and their parameter ids (Phase 2).
- Whether the DNR site's terms and robots rules permit a weekly automated fetch; otherwise a paste-in flow for the owner (Phase 4).
- Current Anthropic model ids and the tool-use and structured-output features to rely on (Phase 3).
- How to source 48 hours of wind per port out of season (Phase 2).
- Rule version history for the admin screen: `rules.version` exists; a history table arrives with the editor in Phase 6.

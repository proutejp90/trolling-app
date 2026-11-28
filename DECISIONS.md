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

## Phase 1: rules engine

### Changes to the seeded rules and thresholds

| Change | Why |
|---|---|
| `upwelling_shift_ft` is 15 ft | From six summers of Ludington buoy history (`docs/research/upwelling-shift.md`). The owner approved using it. It stays flagged as an estimate. |
| R05 fires whenever a profile or a break depth is known, not only at source level 1 | G17 needs it at level 0 (the angler's probe), and an angler who answers the break-depth question (level 4) would otherwise get no depth at all. |
| P03 ranks flasher and fly first | The spec says "flasher and fly and meat only". Without a ranking, meat alone would take every line over 100 ft. |

These went to existing databases as a guarded migration that changes a row only while it still holds its Phase 0 value.

### How the engine reads the spec

| Decision | Why |
|---|---|
| A rule whose condition reads a missing input is skipped with the reason recorded, not treated as false | The app has to say what it does not know. P06 without a time of day, or P05 without a water depth, shows up in the skipped list with the missing input named. |
| Unknown clarity is a value, not a gap | R13 allows UV only in clear water. With clarity unknown, UV stays out. A property test over random contexts caught this. |
| G1, G2, G3 and G7 to G10 run with only plugs available | They predate the Presentation stage. G1 expects 2.4 to 2.8 mph, which is the plug band; with every lure type available the same trip is G11. |
| R01 supplies the depth in April and May | G3 expects 0 to 30 ft in May, so the location rule's "top 30 ft" is the default. June, September and October still have none and ask the angler. |
| A lure depth the angler states replaces the Depth stage | G4 and G14. The depth rules are listed as skipped with that reason. |
| R08 shifts month and report defaults, not a measured profile | A live profile already shows the upwelling; shifting it again would double count. R08 still fires and says no shift was applied. |
| Wind "from the north or east" is 315° through 135° | The spec does not give the sectors. |
| `murky_factor` rescales the five color bands (red, orange, yellow, green, blue) in stained or murky water | The owner turned it on (2026-11-27) at the seeded 0.5. Golden scenario G4 changes with it: at 15 ft in murky water R10 now fires where the spec listed R09. `uv_max_ft` and `glow_lead_ft` are not scaled; the spec says "color band depths". |
| R11 also allows chartreuse and fluorescent finishes; new rule R20 allows only silver, chrome and glow past the blue limit | Both approved by the owner (2026-11-27). Without the first, the colors R14 ranks first in stained water were excluded between 22.5 and 55 ft. Without the second, no color rule applied below the blue limit, so plain red came back at 60 ft in murky water and below 110 ft in clear. R20 is tagged Science as an extension of R11; the spec had 19 R rules and now has 20. |
| Finish ranking: Science outweighs Reports outweighs Lore, then catalog order | "When Science and Lore rankings disagree, Science ranks first and the Lore pick ranks second." |
| Lines in a spread take the best finish of each ranking tier in turn | So a four-line spread shows glow and the chrome pick, not four glows. `finish_ranking` on the result holds the full order. |
| Every setup carries the full depth range; meat lines are flagged `deepest` | The spec gives one depth range. Splitting it into per-line depths would be the engine inventing numbers. |
| Speed overlap is checked in rank order against the running spread band | G11: spoons overlap flasher and fly alone, but not flasher and fly plus meat, and the scenario expects them dropped for speed. |
| "Keep one spoon line" (P02) and "add one glow plug" (P04) mean exactly that many lines, taken from the type with the most | Read literally. They do not count toward the two-type limit under six lines. |
| When no rule-ranked type can run, the engine falls back to spoon, plug, flasher and fly, meat, in that order | G16, and any angler who carries only some lure types. |
| Meat rigs get no leader length | The spec seeds leaders for flies only. |
| The quiz runs the engine in the browser on the bundled seed ruleset | "A manual quiz that needs no live data." Phase 2 moves rules, thresholds and catalog to the rows in Postgres. |
| The quiz always shows Low confidence | Every answer is month defaults or the angler's own. The spec's confidence levels arrive with live data. |
| Templated reasons state no numbers | Depths and speeds are read from the engine output, so an owner's edit to a rule can never leave a stale number in the text. |

## Phase 2: live conditions

### Where the sources differ from the spec

Found against the live APIs on 2026-11-27 and reported to the owner.

| Spec | What the source does | What the app does |
|---|---|---|
| Seagull `/api/v1/obs` returns history | It serves the last 30 days only. Older ranges answer `[]` with an `X-Note` header. | Reads the last three days each cycle. The upwelling research used the archive files instead. |
| Seagull `/api/v1/obs-latest` returns latest values | The endpoint does not exist. The API definition lists `/api/v2/obs-latest`. | Uses `/obs`, which covers it. One request fetches every dataset. |
| Seagull and NDBC give the same readings | For the same buoy Seagull lagged NDBC by nine days (Port Sheldon). Seagull reports kelvin and timestamps with no zone. | Each buoy is two station rows: NDBC for surface readings and wind, Seagull for temperature at depth. |
| A buoy is in the water or pulled | Muskegon's buoy lost its wind sensor on Oct 14 and still reports waves and water temperature in late November. | The newest row can be partial, so gaps are filled from the same station's earlier rows inside the age limit. |

### Open questions the spec asked to resolve

| Question | Answer |
|---|---|
| Which Seagull platforms near each port report temperature at depth? | Cook (dataset 33), South Haven (37), Port Sheldon (3), Grand Haven Spotter (671), Muskegon (49), Whitehall Spotter (672), Ludington (62), Sleeping Bear Dunes (58). Parameter ids are in `seed/stations.ts`, generated by `scripts/build-stations.mts`. In the 2026 season several of these reported only the surface. |
| How to source 48 hours of wind out of season? | The nearest NWS observation station to each port, usually the airport, found once through `/points` and stored as a station. In season the buoy is nearer and wins. |

### Choices

| Decision | Why |
|---|---|
| Server code talks to Postgres with `pg` and `DATABASE_URL` | One path for local, CI and production. Without `DATABASE_URL` the app still answers from the bundled rules and says live data is not connected. |
| The station list is generated: Michigan side only (east of 86.7° W), within 40 miles of a seeded port, open lake only | West-shore buoys see the opposite upwelling. Inland-lake and bay buoys (Muskegon Lake, Lake Macatawa, Grand Traverse Bay) say nothing about the open lake. |
| One row per station per clock hour in the cache; observations pruned after 7 days | Sources report every 10 minutes. The rules need hourly wind and the latest water reading. |
| Readings up to 24 hours old are used and flagged stale past 6 hours | The spec names the 6 hour state but not a cut-off. `obs_max_age_hours` is a threshold. |
| Buoy readings are used only for trips within 2 days of now | Today's water says little about a trip next week. Beyond that the result uses month defaults and says so. |
| Time on the water is asked as four choices and placed on the clock from sunrise and sunset | A date alone does not say when. The forecast is read at that hour. |
| Sky is overcast at 70% forecast cover or more, bright below; calm is 6 mph or less | The spec gives no numbers. Both are thresholds flagged as estimates. |
| Before sunrise and after sunset the sky is low light whatever the cloud | It is dark. |
| The angler's answer for sky or wind beats the forecast | They are looking at it. |
| A break depth the angler gives is used only when no buoy profile is | The ladder ranks a buoy profile (1) above the angler's answer (4). A lure depth they state outright always wins. |
| Confidence never reaches High yet | High needs an agreeing fishing report from the last 21 days. Reports arrive in Phase 4. |
| Hazards come from the forecast grid's own hazard series and are shown as codes | The app gives no safety guidance. |
| `FIXED_NOW` pins the clock only when `FIXTURES=replay:<set>` is also set | So a test clock can never leak into production. |
| The 30 minute recommendation cache is not built yet | It matters once the agent call exists (Phase 3). Engine-only requests take milliseconds. |

### Known limits

- NOS harbor stations (Holland, Ludington) report water temperature from inside the channel. When no buoy nearby reports, that reading can stand in as the surface temperature. It affects only what is shown and the confidence level, never the depth.
- The winter fixture set answers 404 for every NDBC station. In a real winter the shore towers keep reporting wind.
- The Netlify scheduled function is written but untested until the site is deployed.
- Fixtures were recorded in late November, when most buoys were pulled. The July profile fixture is assembled from real archive readings because the live API can no longer serve July.

## Phase 3: agent

### How "the engine decides and the LLM explains" is enforced

The spec has the agent return the whole recommendation as JSON and the server compare every lure, depth and speed with the engine's. This build goes one step further: **the agent never returns those fields at all.** It returns words only (a summary, reasons with rule codes, report notes, a confidence reason, caveats), and the server attaches the engine's lures, finishes, depths, speeds and evidence tags. A wrong number in a structured field is impossible, not just detected.

What can still go wrong is the prose, so the server checks it and rejects the whole answer on any failure:

| Check | Why |
|---|---|
| Every number in the text is one the engine or the cached conditions produced | "Never invents a depth or speed" |
| A lure type, color or finish word appears only where the engine put it, or in the text of a rule cited in that same reason | "Never invents a color or lure" |
| Every rule code fired and shaped that lure type; one reason never mixes rules with different evidence tags | Tags are attached by the server from the rules, so a reason must map to one tag |
| No promise of a catch; no safety, weather or navigation advice; no exclamation marks | Product principles |
| A report note cites only a report that was provided | Reports are untrusted data |

One retry tells the model what was rejected. After a second failure, a refusal, an error or 12 seconds, the templated explanation is shown and the angler sees no error.

### Choices

| Decision | Why |
|---|---|
| One structured-output call, no tools | The spec lists five tools "so the agent can re-run with an answer to its follow-up question". Here the route computes the unanswered questions in code and the screen re-posts with the answers, so the agent has nothing to fetch. One call also meets the cost target. Tools can be added when the predictive model arrives (Phase 7). |
| `needs_input` is decided in code, not by the agent | Whether clarity "changes the result" is testable: the engine is run once per clarity and the spreads compared. The agent is only called once every question is answered. The spec's second worked example (a `needs_input` case) is replaced by a no-live-data case with a conflicting, instruction-bearing report. |
| The engine result and templated reasons come back first; `POST /api/explain` swaps in the agent's words | "Show the engine result immediately." The explain route rebuilds the recommendation from the same inputs, so nothing the browser sends is trusted as engine output. |
| Explanations are cached 30 minutes by port, date, hour and answers, in the `recommendations` table | The spec's cost target. Serverless instances share no memory, so the cache is in Postgres. |
| Model `claude-opus-5-5` by default, from `ANTHROPIC_MODEL`; effort `low`; system prompt cached | The model name is an env var as the spec asks. Low effort suits a short, tightly specified writing task and the 6 second target. The owner can pick a cheaper model by setting the variable. |
| No server-side refusal fallback to another model | The templated explanation is the fallback for every failure, including a refusal. |
| The prompt version (`PROMPT_VERSION`) and model are stored with each recommendation | Spec. |
| Eval results are committed under `evals/results/<prompt version>.json` | "Store results with the prompt version." |

### Not yet verified

The eval suite (32 contexts) and the latency target need a real API key and have **not been run**. Everything else is covered by tests with a stubbed model. The CI eval job runs only when agent, rule or prompt files change and an `ANTHROPIC_API_KEY` repository secret exists; without the secret it warns and skips.

## UI review fixes, Part A

Source: `docs/UI-REVIEW-FIXES.md`.

- **"A forecast covers part of the date"** means a cached forecast hour sits within 90 minutes of any of the four times of day the angler can pick (the same window the trip-time lookup uses). It is `forecast_covers_date` on the conditions. With no database connected it is always false, so sky and wind are asked at once.
- **In the dark, a sky answer is not used.** Sky is now on screen before the time is chosen, so an angler can answer "Bright" and then pick "Before sunrise". Before sunrise and after sunset the light is low whatever was answered, and the result says the sky came from the time of day. The question stays on screen (a question once asked stays) with the hint "Not used in the dark: light is low." Before this change the answer won, which only happened if the angler changed the time after answering.
- **Focus on a new screen** goes to the element marked `data-screen-heading`. The first page load is left alone, so the browser's own focus order applies there. The result and conditions headings are still `h2`; Part C4 makes them `h1`.
- **A question counts as added late** when it arrives after the first answer for that port and date. Late questions fade in and are announced together ("Added: Sky, Wind"). The fade-in path only runs when a forecast covers part of the date, which none of the recorded in-season fixtures do, so it is not covered by a browser test.
- **The offshore or staging sentence** shows when the "Where are you fishing" question was on screen, which today is August only.

## Still open for later phases

- Whether the DNR site's terms and robots rules permit a weekly automated fetch; otherwise a paste-in flow for the owner (Phase 4).
- Rule version history for the admin screen: `rules.version` exists; a history table arrives with the editor in Phase 6.

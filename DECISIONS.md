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

## UI review fixes, Part B

- **Date check timing.** The date is checked when the angler leaves the field and when they press Get setup, not on each keystroke: a date field passes through years like 0002 while "2027" is being typed. The error clears as soon as the date changes.
- **Date range** is by calendar year on the device: last year through two years ahead. The server still accepts any four-digit-year date; it now answers a bad date with `field: "date"` and the same "Enter a date like 07/15/2027." message.
- **The opening-day note** shows while the date is the opening day the app filled in. It goes when the angler picks another date.
- **"Remember the choice for the session"** is the sorted list of port names in `sessionStorage`. The coordinates are used once to sort and are never stored or sent. Closing the tab forgets it.
- **Location messages.** A refusal, or a browser with no location support, says "Location is off. Pick a port from the list." A timeout or other failure says "Couldn't get your location. Pick a port from the list." Success says "Nearest port: [name]."
- **Browser tests pin the device clock** to the fixture time, so the date-range check does not start failing them in a later year.

## UI review fixes, Part C

- **Saying the depth source once.** The confidence reason is the one place. The "Depth comes from ..." line is added under it only when the confidence reason does not already contain the source's words (for example "month defaults"), so the fact shows once whether the agent or the template wrote the reason. The check is done on screen, so explanations cached before this change are covered too.
- **Which caveats count as restating it.** A caveat is dropped when it contains the depth source's words, or says "month defaults", "depth comes from / is ...", or "no water data / no buoy reading". The speed-at-the-lure caveat and caveats about other things stay. The rule is `caveatsToShow` in `src/lib/reasons.ts`, with tests.
- **The summary line** now says only where the fish are this time of year, from the agent and from the template. The buoy reading that used to follow it in the template still shows in the confidence box.
- **Prompt version `2026-11-28.2`.** The agent is told to keep data sources out of the summary and caveats and to name the depth source in the confidence reason. This is an instruction, not a server check: an agent answer that ignores it still passes, and the screen rules above keep the depth source to one mention in the box and caveats but not in the summary line.
- **Section headings** under each screen's `h1` moved from `h3` to `h2` so the levels do not skip. Their styles are unchanged. "Out of season" is that screen's `h1`.
- **Tag chips are an on-water departure from Meridian.** Meridian says badges are not buttons. A tag chip is a button that draws a badge inside it, so the badge itself stays a badge. Tag buttons are 44px tall with the badge centered inside, and the reason text is centered against them. The sentence opens under the reason; one tag's sentence shows at a time per reason. "If nothing bites" tips use the same tappable tags.
- **Wide screens** means Tailwind's `md` breakpoint, 768px.

## UI review fixes, Part D

- **Why "Wind, last 48 hours" was empty (D4).** The cache was not short. On 2026-11-28 the Muskegon Coast Guard station, the GLOS feed for the same place, the GLOS Muskegon buoy feed and the airport each had 47 or 48 hourly wind readings in the last 48 hours, and the refresh job keeps 72 hours. The review looked at April 1 and July 15, months away, and for a trip more than `trip_max_days_ahead` away the app deliberately gives the engine no wind history. The screen reused that empty list and said "Too little wind history to say", which was wrong. The 24-hour bar is unchanged.
- **What the wind line says now.** With a day or more of readings: "[station]: [n] of [h] hours from the north or east." For a trip too far off to use them it adds "Not used for this trip: it is [n] days away." With less than a day: "Wind history needs a day of readings. [n] hours so far."
- **Merging stations (D1)** uses each station's own position: feeds within 0.1 mile of each other become one row. It applies to the Conditions list only. The engine's inputs (water temperature source, wind history) still read each feed on its own, and a test checks that merging changes nothing else.
- **In a merged row** the name comes from the NDBC feed when there is one, then GLOS, then NWS. Water, waves and air each show the newest value any feed has. Wind speed and direction are taken together from the newest feed that reported wind. The row's age is the newest feed's. Sources read "NDBC", "GLOS" (the Seagull feed) and "NWS".
- **"In range" (D2)** is `station_max_miles` from the thresholds, not a number in the screen.
- **Reading ages (D3).** `ago()` moved to `src/lib/format.ts`. Under a minute reads "just now". Hours run up to 36, then days, as before, so the smallest day count is 2 and "1 day ago" cannot occur with today's cut-over; the singular is in place and tested for when it can.
- **Known and unchanged:** a trip date in the past still reads as "[n] days away".

## UI review fixes, Part E

Where the doc's own parts pull against each other, and what was chosen:

- **Condition chips replace the "Depth from month defaults · Sky from your answer" line (E4 against E6 and C1).** The chips say the same thing with a word and a dot. Showing both would state each source twice, and C1 asks for the depth source once. The depth source now reads in the confidence reason as a sentence and in one chip ("Depth · month default").
- **Condition chips wrap; other badge rows cap at three (E6).** The doc asks for one wrapping row of condition chips and also for at most three badges in a row. The cap is applied where Meridian means it, on list rows: finish rows and station rows collapse the rest into "+2".
- **The check on a chosen option sits inside the radio dot, not beside it (E6 against A2).** Beside it, longer labels ("Breezy or more", "Use the default") wrap to two lines when chosen and the form below moves, which A2 forbids.
- **The progress bar is hidden, not removed, when every group is done**, so Show setup does not move (A2).
- **Freshness limits.** The data-age chip is success up to `obs_fresh_hours` (3) and warning past it. The "Stale" badge on a station row uses `obs_stale_hours` (6), the threshold whose description is "show the stale state". Both reach the screen in `conditions.limits`; no component carries a number.
- **Question groups.** A question still needs an answer while the server lists it, so "On the water" counts only what the engine needs. The "On the water" card shows only when one of its questions is asked, so the progress bar has two segments on dates where a forecast answers sky and wind and clarity changes nothing. The Depth card's question is labeled "What you know", since the card is already titled Depth.
- **Key numbers** are drawn with the figures at `title-1` and the unit in `small` beside them ("2.4 to 3.0 mph"). At full title size the unit wraps under the figures in a two-column row at 390px.
- **Reason tags** sit in an 80px column. A reason with two tags stacks them.
- **"Left out"** is not in the doc's four zones. It sits at the end of the spread zone as a muted panel, since it explains what is missing from the spread.
- **Conditions zones.** In-range stations with water temperature or waves are under Water (with their wind on the same row); in-range stations with wind only are under Wind. In-range stations reporting neither are not listed. "Used for water / wind" comes from the server (`used_for`), and for a trip too far off to use live data no station is marked. "Not used" shows only on the farther stations, as the doc lists it.
- **Finish traits** come from the catalog: "Glow" and "UV" from the finish's types, "House brand" from the lure. **The shop link on house-brand rows is not built**: the catalog has no shop URLs yet.
- **"Your log" tag chip** has no reasons to attach to until Phase 5b.
- **Zone labels** are `h2` in `micro`; card titles under them are `h3`. On the questions screen the three cards are the zones, so their titles are `h2` at `title-3`.
- **Screenshots** are in `docs/ui-review/part-e`, made by `scripts/screenshots.mjs` on the autumn fixtures. Contrast is checked by `scripts/contrast.mjs`.

## Build spec, second version: forecast panel

The spec in `docs/BUILD-SPEC.md` replaces the one this build started from. It adds the forecast panel, the lake model, day selection and prefilled conditions. This section covers the forecast panel, built first because it needs no new data source.

### What the spec asked to be confirmed (checked live 2026-11-28)

- **A port's marine zone** is `forecastZone` in the `/points` answer for the port's own position, such as `LMZ847` for Muskegon. The job stores it in `ports.marine_zone`, with the port's time zone from the same answer. The ten seeded ports fall in seven zones across two offices (GRR and APX).
- **Zone alerts** come from `/alerts/active?zone={zone}`.
- **The marine zone forecast has no API route.** `/zones/forecast/{zone}/forecast` answers 404 for marine zones. The text comes from the Nearshore Marine Forecast product: `/products/types/NSH/locations/{office}` lists them newest first and `/products/{id}` holds the text, one section per zone. The section is stored word for word.
- **NWS gridpoint data does carry wave height for Lake Michigan**, but not at the port itself. At Muskegon's own grid cell `waveHeight` is a single zero for the week. At a cell about four miles offshore it is populated (metres, with period and direction). So the simpler path the spec asks to check first looks usable for forecast waves at the offshore sample points. That work belongs with the sample points in Phase 2b and is not built here; the GRIB2 wave model may not be needed.

### Choices

- **Marine text and alerts sit in their own table, `marine_forecasts`, one row per port**, not on the hourly `forecasts` rows as the spec's table lists them. They cover a zone and several days, not one hour.
- **Alerts refresh every 15 minutes** through `/api/jobs/alerts` and a second scheduled function at :15 and :45. The half-hourly full refresh fetches them too.
- **The alert link** is the zone's page, `https://forecast.weather.gov/shmrn.php?mz={zone}`, where the alert and forecast can be read in full. This build session cannot reach that host, so the link format is **unverified**; the owner should open one.
- **An alert shows only on today, and only until it ends.** The trip date is compared with today at the port, in the port's time zone.
- **The alert box uses a neutral surface and border**, not the warning or danger colors, since the spec rules out any color that implies safe or unsafe.
- **Marine text shows for today through six days ahead**, the span the product covers, and never for a past date.
- **Observed waves show for today only**, from the nearest in-range buoy that reports wave height, with its period when the station gives one (`observations.wave_period_s`, from NDBC's `DPD`). No forecast wave value exists in the panel until Phase 2b, so there is nothing to fill with a guess.
- **The marine text is reflowed for a phone.** The product is typed in 69-column lines. Line breaks inside a paragraph are removed; no word is changed, and a test checks that.
- **Staleness limits are thresholds**: `forecast_stale_hours` (3) and `alerts_stale_minutes` (30).
- **The agent is given nothing from the panel.** The facts it receives hold no alert, marine text or hazard, and a test checks that (G33 by construction).
- **Fixtures.** The alert and marine forecast were recorded on 2026-11-28, a day after the rest of the `november` set. The `autumn` and `winter` sets hold the empty answers the API gives when nothing is active.

### Not changed yet, though the new spec changes them

These wait for the day-selection and prefilled-conditions work: the time windows (now, first light, morning, midday, evening), the calm limit in knots, the 30% bright cutoff, the five-day forecast horizon, the today-first Home screen, and the confidence rule that lets a fresh buoy profile alone reach High. The owner's earlier rule decisions (R20, chartreuse in R11, `upwelling_shift_ft` of 15) stay in force; the new spec's text does not include them.

## Build spec, second version: day selection and prefilled conditions

### Where this replaces earlier work
- **Home** no longer has a date field and a Get setup step. It opens on today's recommendation for the last port used. Get setup shows only on a first visit, when no port is known.
- **The questions screen** is gone as a step. What no source can supply is asked in one card on Home, above the result. The spec's Quick questions screen is "Conditions in use", reached from "Change conditions" on the plan card.
- **UI review B1** (default to opening day out of season) gives way to the spec's "opens on today". Out of season, Home shows the out-of-season card at once, with one tap to opening day, so the angler still does not have to press anything to find out.
- **UI review Part A's rule that the dark beats a sky answer** is reversed. The spec says an angler's change always wins and is marked as theirs.
- **Buoy readings apply to today only**, as the spec's day table says. Before, they were used up to two days ahead (`trip_max_days_ahead`, now retired). Until the lake model is built, tomorrow through five days ahead falls back to month defaults for water, with the weather forecast for that day.

### Choices the spec left open
- **Time windows.** First light is 30 minutes before sunrise; morning is 2 hours after sunrise; midday is halfway between sunrise and sunset; evening is 30 minutes before sunset. "Now" is the current time and only applies today. The first quiz's four windows are still accepted by the API, so stored requests and the engine tests keep working.
- **Low light** is the dark, plus `low_light_minutes` (45) either side of sunrise and sunset. So first light and evening are low light whatever the cloud cover.
- **Cloud cover between 30% and 70%** counts as bright. The spec gives 30% as the top of bright and 70% as the bottom of overcast and says nothing of the gap; the engine has only bright, overcast and low light. No `sky_bright_max_cover_pct` threshold was added, since nothing would read it. **Open question for the owner.**
- **Calm** is 5 knots (`wind_calm_max_kt`), replacing 6 mph. Today it is read from the nearest in-range station on the water with a reading under `obs_fresh_hours` old; airports do not count. Otherwise, and on other days, it comes from the forecast.
- **Source labels.** Low light worked out from the sun's position with no forecast behind it is labeled Default, since nothing measured it. With a forecast for the hour it is labeled Forecast, as scenario G46 expects.
- **"Today" is today at the port.** The day strip, the trip date and the alerts all use the port's time zone.
- **Past dates** get month defaults, low confidence and a "Past date" label. The stored snapshot beside a logged trip (G40) needs the trolling log and is not built.
- **Remembered answers** (clarity per port, line count) live in the browser's local storage, since there is no sign-in yet. Clarity is offered again only within `clarity_answer_max_age_days` (3); the server checks the age.
- **Overrides** are stored in `recommendations.context.overrides`, each with the value it replaced and that value's source. No new table.
- **Refresh.** Today's result refreshes every five minutes, when the angler returns to the app, and from a Refresh button. A pull-to-refresh gesture is not built: browsers already use that gesture to reload the page.
- **The calendar field** takes a typed date once typing stops for a moment or the field is left. Typing a date passes through other valid dates on the way.
- **Confidence** follows the spec's list in `src/server/confidence.ts`. A fresh buoy profile now reaches High on its own. Nothing raises or lowers a step for reports or the log yet, since neither exists.
- **The agent's explanation** is requested after a short pause on a result, so moving along the day strip does not ask for one per day.

### Not built here
- Water depth fished (near, mid, offshore sample points), the lake model's forecast profile and forecast waves: Phase 2b.
- Turbidity from a buoy: no seeded station reports it.
- "Plan card above the fold" is no longer checked by a browser test: with questions on screen the plan card sits below them. With nothing to ask it starts about 330px down at 390px wide.

## Phase 2b, part one: the lake model job

### What the spec asked to be confirmed (checked 2026-11-28)

- **Where the files are.** NOAA's THREDDS server and tidesandcurrents.noaa.gov are not reachable from this build session. The model's public archive on AWS is, and it is the documented alternative: `https://noaa-nos-ofs-pds.s3.amazonaws.com/lmhofs/netcdf/YYYY/MM/DD/`. The job reads from there.
- **File naming.** `lmhofs.tCCz.YYYYMMDD.fields.nHHH.nc` for the nowcast (n000 to n006, the six hours up to the run) and `...fields.fHHH.nc` for the forecast (f000 to f120, hourly). There are also `regulargrid` files and small `stations` files.
- **Run times.** Four runs a day, at 00, 06, 12 and 18 UTC. On 2026-11-27 each run's last file reached AWS 3 h 15 to 3 h 17 min after the run time. The job runs at 03:35, 09:35, 15:35 and 21:35 UTC and waits for 3 h 20 min.
- **Grid.** 90,806 nodes and **20** vertical layers (21 levels, which is where the spec's "21 layers" comes from). Each file is about 188 MB and holds one hour.
- **Subsetting.** The server has no subsetting service, but `temp` is stored uncompressed, so the netCDF library reads just our nodes over HTTP byte ranges (`#mode=bytes`). No file is downloaded. Reading 12 files took 57 seconds from this session through its proxy.
- **The stations files** hold modeled profiles at 48 fixed points (the buoy positions, such as 45161 off Muskegon in 70 ft). They are small, but they are not over 60, 120 and 200 ft off each port, so the job uses the gridded files as the spec says.

### Choices

- **Sample points** are found on a line due west of an east-shore port (due east from the west shore), stepping a tenth of a mile. For each target depth the first node at least that deep is taken, or the node before it when that one is closer in depth. Real results on 2026-11-28: all ten ports have three points; most are within a few feet of the target (Muskegon 62, 116 and 200 ft); steep shores are further off (Manistee's nearest usable node for 60 ft is over 92 ft). The actual bottom depth is stored and should be shown, not the target. **Open question for the owner**, as in the spec: are these the right contours?
- **The points are recomputed on every run** from the grid, so a grid change at NOAA cannot leave a stale node index behind.
- **Break depth** is the midpoint between the two layers with the steepest cooling per metre. It is null when the water does not cool with depth anywhere.
- **Band depth** is where the profile first cools to the top of `temp_band_f`, interpolated. It is 0 when the surface is already that cold, and null when the water never gets that cold.
- **The job posts to the app; the app writes to the database.** `GET /api/jobs/model` gives the job the ports and the band; `POST` stores points and profiles. GitHub holds no database password.
- **The job proves who it is with a token GitHub signs, not a stored secret.** GitHub Actions gives the workflow a short-lived token naming the repository, branch and workflow file. The app checks the signature against GitHub's published keys and accepts it only from `proutejp90/trolling-app`, on `main`, from `lake-model.yml`, addressed to this site (`src/server/github-oidc.ts`). So nothing has to be entered in GitHub's settings. `CRON_SECRET` is still accepted, for a run from anywhere else. The site address defaults to the live site in the workflow; a repository variable `SITE_URL` overrides it. If the repository is renamed or moved, set `LAKE_MODEL_REPOSITORY` in Netlify.
- **A newer run replaces an older run's value for the same hour, never the reverse.** Profiles more than 48 hours past are deleted; yesterday's is kept so an upwelling can be seen arriving.
- **The netCDF library is not thread-safe**, so each file is read in its own process (six at a time). Threads crash it.
- **Each file's surface height (`zeta`) is added to the bottom depth** when layers are turned into depths.

### Not built in this part
Using the profiles: level 1m in the fallback ladder, forecast profiles for future days, the modeled label, the depth chart and sample-point tabs, model checks against buoys, and forecast waves. The tables for all of them exist.

## Phase 2b, part two: using the lake model

- **Where the model sits.** Today: a buoy temperature profile within range wins (level 1); with none, a model run under `model_max_age_h` (12) old is used (level "1m"), ahead of a buoy's surface reading. Tomorrow through the forecast horizon: the model's forecast for the trip's time. Beyond the horizon and in the past: month defaults. A break depth the angler types still beats the model, as any answer of theirs does.
- **The engine learned two things.** The source level "1m", and `profile_resolution_ft`: with a modeled profile the depth range starts half a model layer above where the profile enters the temperature band and ends half a layer below, plus the usual 20 ft. So a modeled break is never stated more finely than the model resolves it (golden scenario G24: break 35 to 45 ft gives 35 to 65 ft).
- **Break as a range.** One layer is the water depth at the point divided by 20: about 3 ft over 60 ft of water and 10 ft over 200 ft. The break is shown as that range, clipped to the surface and the bottom.
- **Upwelling from the model.** When the near-shore point has a profile for the trip time and for 24 hours earlier, an upwelling is read from them: the surface at least `model_upwelling_drop_f` (2 °F, owner estimate) colder and the cold layer at least one model layer shallower. That replaces the wind rule's verdict for that trip. With nothing to compare, the wind rule decides as before. Either way a modeled profile is not shifted again by R08, since it already shows the cold water.
- **Water fished.** The near, mid and offshore sample points are the choices, mid by default, each named with its real water depth. In August the choice settles offshore or staging (staging at `staging_water_max_ft`, 70 ft, or less), so "Where are you fishing" is asked only when there is no model.
- **Labels.** A modeled depth reads "modeled" in the confidence reason, the depth and water chips, the data-age chip ("Model run 3 h old", or "Model forecast"), the Conditions in use screen and the chart. No buoy is named as the source of a modeled number.
- **The agent** is told when the depth is modeled or forecast, and its confidence reason is rejected if it says neither. The spec asks for this in the conditions summary; since the UI review the data source is said once, in the confidence reason, so the rule is applied there. Prompt version `2026-11-28.3`. **The evals have not been run on it.**
- **Confidence** from the model alone is medium, and capped at medium for any forecast day. Raising it to high needs a probe reading that agrees (Phase 5); a buoy profile that exists is simply used instead.
- **Model checks** are written by the conditions refresh, not by requests: wherever a buoy profile from the last three hours sits within `model_check_max_miles` (5) of a sample point, the measured and modeled break depths are stored, once per point and reading. The admin view of the running error is Phase 6.
- **The stored source level is text** (`recommendations.temp_source_level`), so it can hold "1m".
- **The chart** is one line of temperature against depth, depth running down, with the break as a shaded band and its range written on it. The same numbers are available as a table. It is drawn for the model only; a buoy's profile still shows as a table on its station row.

### Not built here
- **Forecast waves.** NWS grid data has them offshore (see the forecast panel notes); wiring that to the sample points is the next piece.
- **Today's break beside the forecast break** is shown as text, not as a second line on the chart.

## Still open for later phases

- Whether the DNR site's terms and robots rules permit a weekly automated fetch; otherwise a paste-in flow for the owner (Phase 4).
- Rule version history for the admin screen: `rules.version` exists; a history table arrives with the editor in Phase 6.

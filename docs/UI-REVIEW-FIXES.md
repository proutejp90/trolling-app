# UI review fixes (2026-11-28)

Fixes from a UI review of the live app (evanstism.netlify.app), run against the build spec, "Conditions Recommender: Build Spec for Claude Code". The review covered Home, Quick questions, Recommendation and Conditions at Muskegon for three dates: Nov 28 (out of season), April 1 and July 15, in both themes.

Five parts, one branch and one pull request each, in this order. Each pull request carries its part's acceptance list as a checklist. Record every choice this doc leaves open in DECISIONS.md.

## Prompts to paste into Claude Code

Part A:

> Read `CLAUDE.md`, then `docs/UI-REVIEW-FIXES.md`. Build Part A only, on its own branch. Write or update the tests first. Run `npm run lint`, `npm run typecheck` and `npm test`, and `npm run test:e2e` after `npm run build`. Open a pull request with Part A's acceptance list as a checklist. Then tell me in plain language what you built, what you left out, and what I should look at.

Parts B to E: the same prompt, with the part's letter. Start each one only after the one before it is merged.

## What stays the same

* The engine and its rules. No change in `packages/engine` or `seed/rules.ts` in this doc. The one rules question is listed at the end for the owner.
* The engine decides and the LLM explains. No new number reaches the agent's words.
* Meridian and the on-water profile in CLAUDE.md: 44px controls, 14px body, semantic tokens only.
* The request path reads only the Postgres cache.

## Part A: must fix

### A1. Every screen opens at the top

Problem: the step changes inside one component (`src/components/quiz/quiz.tsx`), so the window keeps its scroll position. "Show setup" lands the angler on the spoon list, past the heading, the confidence note and the spread speed.

Fix: whenever `step` changes, scroll the window to the top and move focus to that screen's main heading (`tabIndex={-1}`, no visible focus ring on a programmatic focus). Under `prefers-reduced-motion` the scroll is instant; otherwise it's instant too, since a smooth scroll on a page swap reads as lag.

Acceptance: on a 390px-wide viewport, answer the questions with the page scrolled to Show setup, then press it. The result opens with "Muskegon, April 1" at the top and focused. The same holds for View conditions, Back, and Show April 1.

### A2. Questions don't appear in the middle of the form

Problem: Sky and Wind are added to the form only after a "Time on the water" is chosen, because the server works out forecast coverage for that time. They are inserted above Depth, which pushes Depth, Lines and Show setup down, so a tap lands on the wrong option.

Fix:

* When no forecast covers any part of the chosen date (for example, more than 7 days out), `/api/recommend` returns `sky` and `wind` in `questions` on the first call, before a time is chosen.
* When the forecast covers part of the date, keep today's behavior. A question added later appears with a 150ms fade (none under reduced motion), and its legend is announced in a polite live region ("Added: Sky").
* A question once asked stays on screen (today's rule).

Acceptance: April 1 and July 15 show Time, Clarity, Sky, Wind, Depth and Lines on the first render. Picking a time moves nothing below it. Add a Playwright test that picks a time, then taps Overcast at its first-render position and checks that Overcast is selected.

### A3. The opening line matches the fish's location

Problem: `Result` in `quiz.tsx` always ends the summary with "This setup is for offshore fish." (or staging), whatever the month. In April the agent's own line says Chinook "hold near shore in the top of the water column", and the next sentence says offshore.

Fix: add the offshore or staging sentence only when the angler answered the "Where are you fishing" question (`asked` includes `mode`). Otherwise add nothing.

Acceptance: April 1 and July 15 show no offshore or staging sentence. An August date, answered "Near the river mouth", shows "This setup is for staging fish."

## Part B: Home

### B1. The default date is in season

Problem: Home defaults to today. From November to March that's out of season, and the angler finds out only after pressing Get setup.

Fix: from November through March, default the date to the next April 1 (the existing `nextSeasonStart`). Under the field, add in `text-small text-fg-tertiary`: "Out of season now. Showing opening day." Dates typed in by hand still get the out-of-season screen as they do today.

Acceptance: with the device clock set to Nov 28, 2026, Home shows 04/01/2027 and the note. With the clock set to July 10, it shows July 10 and no note.

### B2. Date errors appear at the field and say what's wrong

Problem: a bad date (a typo in the year gave "152027") returns the server's catch-all, "Check the port, date and answers and try again.", in a box above the button and far from the field.

Fix:

* Check the date on the client before sending: a real date with a four-digit year, from last year through two years ahead.
* Show the error under the Date field, tied to it with `aria-describedby` and `aria-invalid`: "Enter a date like 07/15/2027." for a malformed date, and "Pick a date between [year] and [year]." outside the range.
* Keep the server check. Give the 400 response a `field` key when zod fails on `date`, so the client can put that message at the field too.

Acceptance: typing a six-digit year shows the message under Date and sends no request. The general error box still shows for network failures.

### B3. Nearest port first

Problem: the spec says the port picker lists the nearest port first, using location permission. Today the list runs south to north with Muskegon preselected.

Fix:

* Add a "Use my location" ghost button under the Port field. It asks for location only when tapped, never on load.
* On success, re-sort the list by distance using the port coordinates already in the database, and preselect the nearest port.
* On refusal, keep the list as it is and say "Location is off. Pick a port from the list."
* Remember the choice for the session only. Don't store the location.

Acceptance: with a mocked location in Grand Haven, Grand Haven is selected and listed first. With location refused, the list is unchanged and the message shows.

## Part C: Recommendation screen

### C1. Say the low-confidence reason once

Problem: with no live data, the same fact appears three or four times: in the agent's summary line, next to the Low confidence badge, in "Depth comes from month defaults", and in a caveat at the bottom.

Fix:

* The confidence box next to the badge is the one place it's said.
* The bottom caveats drop any caveat that restates the depth source when the confidence reason already covers it.
* In `src/server/agent/prompt.ts`, tell the agent to leave the data source out of `conditions_summary`, because `confidence_reason` covers it. Bump `PROMPT_VERSION` and run `npm run evals`; report the pass rates in the pull request.
* Update the templated fallback (`template.ts`) to match.

Acceptance: for April 1 at Muskegon, "month defaults" appears once on the screen, with the agent's explanation and with the templated fallback (API key removed). The evals pass at the spec's thresholds.

### C2. "Why this setup" looks like something to tap

Problem: it's a `<details>` summary with no marker, so it reads like a label.

Fix:

* Add a 16px `ChevronRight` in `text-fg-tertiary` before the words. It turns 90° when the section is open (150ms, none under reduced motion).
* Change the text color to `text-fg`.
* Open the top card's section by default, and leave the others closed.

Acceptance: the chevron shows in both themes, and the first card opens with its reasons showing.

### C3. Tapping a tag explains it

Problem: the spec says tapping a Science, Reports, Lore or Your log tag explains the tag in a sentence. The tags are plain badges.

Fix:

* Make each tag a tag chip (see E6): a button at least 44px tall that draws the badge inside it.
* Tapping it opens one line under the reason, and tapping again closes it. No hover tooltips.
* Put the four sentences in `src/lib/reasons.ts`, so the agent never writes them:
  * Science: "Based on fisheries research."
  * Reports: "Based on recent Michigan DNR fishing reports."
  * Lore: "Captain and angler experience. No research backs it."
  * Your log: "Based on your own logged trips."

Acceptance: each tag opens and closes its sentence by tap and by keyboard, and screen readers announce it as expanded or collapsed.

### C4. Every screen has a main heading

Fix: the port-and-date heading on the result screen and "Conditions at [port]" become `h1`, with their current styles. The questions screen already uses `h1`. This is also the heading A1 moves focus to.

### C5. Get setup sits under the fields on wide screens

Problem: on a desktop browser, `mt-auto` pins Get setup and Show setup to the bottom of the window, about 380px below the last field.

Fix: keep `mt-auto` under 768px, and from 768px let the button follow the last field with the normal gap.

## Part D: Conditions screen

### D1. One row per station

Problem: the same physical station appears twice under two sources ("Muskegon CG Station, Muskegon, MI" and "MKGM4 Muskegon", both 0.1 mi). So do "Muskegon Buoy, MI" and "Muskegon" (both 3.1 mi).

Fix: in `src/server/conditions.ts`, merge readings from stations within 0.1 mi of each other into one row. The row is named after the NDBC station when there is one, shows the newest reading for each field, and lists the sources in small text ("NDBC, NWS").

Acceptance: the Muskegon list has no two rows at the same distance for the same place. Write a unit test with two sources for one station.

### D2. Show the stations the app uses

Problem: the list runs to 58 miles, but the app only uses stations within `station_max_miles` (25).

Fix: list the in-range stations under "Stations". Put the rest behind a closed "Farther stations, not used" row, so the angler can still see them.

Acceptance: for Muskegon, the stations listed openly are all 25 miles or closer.

### D3. Grammar in reading ages

Fix: in `ago()` in `quiz.tsx`, use "1 hour ago" and "1 day ago" in the singular, and "1 minute ago" too. Add unit tests at 1, 59, 60, 89, 90 and 2160 minutes.

### D4. Find out why wind history is empty

Problem: "Wind, last 48 hours" says "Too little wind history to say" while ten stations are reporting wind. The code needs 24 or more hourly readings from one station.

Fix: find out why before changing anything. Check how many hours of wind each Muskegon station has in the cache, and whether the refresh job keeps them. Report what you find. If the cache is short because the job started recently, change only the copy: "Wind history needs a day of readings. [n] hours so far." Don't lower the 24-hour bar without the owner's OK.

Acceptance: the pull request explains the cause. The screen says how much history there is when it's too short.

## Part E: visual segmentation

**Problem:** every screen is one column of similar boxes, all the same weight, with the same gaps between them. On the result screen, the plan, the spread, the fallback advice and the fine print run together, so the eye has nowhere to land. The questions screen is seven groups of identical option boxes. The Conditions list mixes water and wind readings in one long run of rows.

**Approach:** group each screen into a few labeled zones, and make zones look different from the items inside them. Use only Meridian's own tools for this:

- **Zone labels** in Meridian's `micro` style (11/14, weight 500, `text-fg-tertiary`). Use sentence case, so no capital letters for emphasis.
- **Space:** 32px between zones, 12px between items inside a zone, 16px inside a card.
- **Surfaces:** the page on `surface-0`, cards on `surface-2`, and card header strips and muted panels on `surface-1`.
- **Hairline borders** (`border-subtle`) to split a card into parts.
- **Type steps:** `title-1` for the key numbers, `title-3` for card headers and `body` for prose.

Still not allowed: shadows on cards, colored left borders, gradients, icons used as decoration, or status shown by color alone.

### E1. Top bar

The top bar runs the full width of the window on `surface-1` with a `border-subtle` bottom edge. The app name and theme toggle stay lined up with the page's content column. Today the bar is only as wide as the column, so on desktop it floats.

### E2. Home

- One card holds Port and Date. The B1 season note sits inside the card, under Date.
- Get setup sits under the card (C5).
- The page heading and intro sit above the card with no box.

### E3. Quick questions: three groups

Replace the seven loose question groups with three cards, each with a `title-3` header strip on `surface-1` and a hairline between questions inside it:

| Card | Questions |
|---|---|
| Your trip | Time on the water, Lines, and Where are you fishing (when asked) |
| On the water | Water clarity, Sky, Wind |
| Depth | Depth choice and its feet field |

- Each card header shows "Done" with a check icon once every required question in it is answered, so the word and the icon carry the status.
- The A2 rule still holds: once the first answer is in, nothing moves.

### E4. Recommendation: four zones

From top to bottom:

1. **Plan** (no zone label; it's the top of the page).
   - The h1 "Muskegon, July 15", then the summary sentence in `body`.
   - Then one plan card in place of today's two separate boxes. Its top row has the spread speed in `title-1` ("2.4 to 3.0 mph"), with "at the lure, on 4 lines" under it. Under a hairline: the confidence badge and its one-sentence reason (C1). Under another hairline: "Depth from month defaults · Sky from your answer" in `small`, and View conditions as a text link.
2. **Your spread · 4 lines.** One card per lure type:
   - **Header strip** on `surface-1`: lure type in `title-3`, line count in `small` on the right.
   - **Numbers row:** Depth and Speed side by side in two columns (label in `small`, value in `title-1`, tabular figures), in place of stacked. On widths under 340px they stack.
   - **Finish list:** numbered rows on Meridian's ListRow pattern at the 44px on-water height, with a hairline between rows.
   - **Why this setup** (C2), under a hairline. Reasons are a list with the tag at a fixed width on the left, so the reason text lines up.
3. **If nothing bites.** Its own card on `surface-2`, with the same reason-list layout.
4. **Good to know.** One muted panel on `surface-1` with no border, holding the caveats as a list in `small` `text-fg-secondary`. The footer line ("A starting setup based on…") follows under a hairline.

Report notes, when there are any, go between zones 2 and 3 under the label "Recent reports".

### E5. Conditions: grouped by what was measured

- Under the h1, the two notes (no live data, no forecast) go in one muted panel.
- Then the zones **Water**, **Wind**, **Forecast**:
  - **Water:** stations that report water temperature or waves, each a ListRow: station name and age on the left, distance on the right, and the readings as label and value pairs ("Water 43 °F · Waves 2.6 ft").
  - **Wind:** stations that report wind only, the same row layout, then the wind-history line (D4).
  - **Forecast:** the forecast line.
- A station reporting both water and wind is listed under Water, with its wind on the same row.
- The D2 "Farther stations, not used" row closes the screen above the data-source line.

### E6. Chips and indicators

Each screen should show its state at a glance: where each number came from, how fresh it is, what's done and what's still loading. Two kinds of element, kept apart:

- **Badges** are Meridian's Badge: 20px, `small` text, never a button. There are two kinds. A **Tone** badge has a soft fill and is for system states. A **Label** badge is outlined, with an 8px dot, and is for categories and sources. Every badge has a word, and status badges also have a 12px Lucide icon, so color is never the only signal. At most three badges in a row; collapse the rest into "+2".
- **Tag chips** are the one tappable chip (C3). Meridian says badges aren't buttons, so a tag chip is a 44px-tall button that draws a badge inside it. Record it in DECISIONS.md as an on-water departure.

| Where | Element | Kind and tone | Words and icon | When |
|---|---|---|---|---|
| Top bar | Connection | Tone, warning | `WifiOff` "Offline" | `navigator.onLine` is false. Hidden when online |
| Plan card | Condition chips, one row that wraps | Label; dot by source: buoy `info`, forecast `accent`, your answer neutral, month default `warning` | "Water 43 °F · buoy", "Sky overcast · you", "Wind calm · you", "Depth · month default" | Always. One chip per input the engine used |
| Plan card | Data age | Tone: `success` under the freshness limit, `warning` over it, neutral with no data | `Clock` "Buoy 47 min old" / "Buoy 7 h old" / "No live water data" | Always |
| Plan card | Confidence | Tone: high `success`, medium `warning`, low `danger` | `CircleCheck` / `CircleAlert` / `CircleX` with "High", "Medium" or "Low confidence" | Always (add the icons to today's badge) |
| Plan card | Agent status | Plain `small` text with an 8px pulsing dot (static under reduced motion), in a polite live region | "Writing reasons…" | While `/api/explain` is pending. It disappears when the reasons arrive or the fallback stays. Never shows an error |
| Setup card header | Lines | Tone, neutral | "4 lines" | Always |
| Finish row | Finish traits | Label | "Glow", "UV", "House brand" (`accent` dot) | Only when the catalog marks the finish. House brand rows also get the shop link |
| Finish row | Top pick | Tone, accent | "Top pick" | Row 1 of each card only |
| Reasons | Evidence tag | Tag chip (above) | Science, Reports, Lore, Your log | Every reason (today's tags, made tappable) |
| Recent reports | Agreement | Tone: `success` or `warning` | `Check` "Agrees" / `TriangleAlert` "Conflicts" | Each report note (add the icons) |
| Question card header | Group status | Tone: `success` when done, neutral otherwise | `Check` "Done" / "1 left" | Each of the three E3 cards |
| Question legend | Optional | Label, neutral dot | "Optional" | Depth, and any question the engine doesn't need |
| Above Show setup | Progress | A 3-segment bar (4px tall, `surface-3` track, `accent` fill per finished group) with text | "2 of 3 done" | Questions screen, until all three are done |
| Station row | Source | Label, neutral | "NDBC", "GLOS", "NWS" (several after the D1 merge) | Every row |
| Station row | Used | Tone, accent | `Check` "Used for water" / "Used for wind" | The station(s) the engine read |
| Station row | Freshness | Tone, warning | `Clock` "Stale" | Reading older than the freshness limit. Fresh rows show only their age text |
| Farther stations | Not used | Label, neutral | "Not used" | Rows behind the D2 row |

Rules:

- The thresholds behind "stale" and the data-age tones come from the existing freshness rows in `thresholds`, never from numbers written in the component.
- Selected options in the question cards keep today's look (radio dot and `accent-soft` fill) and add a 16px `Check` before the label once chosen. A selected answer then reads at a glance, as on the ABC Tracker quick log.
- New badges are built from `src/components/ui/badge.tsx`. Add a `label` kind there, with the dot, following the Badge README. No one-off chip styles in screen code.

### Part E acceptance

- Screenshots of Home, Quick questions, Recommendation (April 1 and July 15) and Conditions, at 390px and 1440px, in both themes, are attached to the pull request.
- On the result screen at 390px, the plan card shows the spread speed and the confidence above the fold.
- `npm run lint` passes: no hex colors, and no Tailwind default palette.
- Each zone label is real text (an `h2` styled `micro`), so screen readers can jump between zones.
- Contrast is AA in both themes, measured on the new `surface-1` panels too.
- Every E6 chip appears in the April 1 and July 15 screenshots where its "When" column says it should. The Offline chip is shown by a Playwright test in offline mode.
- No badge shows color without a word. Status badges also carry their icon.
- Unit tests cover the data-age and freshness tones at, below and above each threshold.

## Open question for the owner (rules, not code)

Should a four-line spread ever be all spoons? In both April and July the app returned four spoons. That's the rules working as written: the lure depth's midpoint (47.5 ft for 25 to 70 ft) is above the 55 ft cutoff (`spoon_first_max_ft`), so P01 ranks spoons first, and nothing else fires without live data or an August answer. Options:

1. Keep it.
2. Lower `spoon_first_max_ft`, so flasher and fly joins sooner.
3. Add a rule that keeps one line of a second type on four or more lines, the way P02 keeps one spoon line.

Option 2 is a threshold edit with no deploy. Options 2 and 3 need new golden scenarios in `packages/engine/test` before they change.

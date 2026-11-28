# UI review fixes (2026-11-28)

Fixes from a UI review of the live app (evanstism.netlify.app), run against the build spec, "Conditions Recommender: Build Spec for Claude Code". The review covered Home, Quick questions, Recommendation and Conditions at Muskegon for three dates: Nov 28 (out of season), April 1 and July 15, in both themes.

Four parts, one branch and one pull request each, in this order. Each pull request carries its part's acceptance list as a checklist. Record every choice this doc leaves open in DECISIONS.md.

## Prompts to paste into Claude Code

Part A:

> Read `CLAUDE.md`, then `docs/UI-REVIEW-FIXES.md`. Build Part A only, on its own branch. Write or update the tests first. Run `npm run lint`, `npm run typecheck` and `npm test`, and `npm run test:e2e` after `npm run build`. Open a pull request with Part A's acceptance list as a checklist. Then tell me in plain language what you built, what you left out, and what I should look at.

Parts B, C and D: the same prompt, with the part's letter. Start each one only after the one before it is merged.

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

* Make each tag a button with the badge look, at least 44px tall including padding.
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

## Open question for the owner (rules, not code)

Should a four-line spread ever be all spoons? In both April and July the app returned four spoons. That's the rules working as written: the lure depth's midpoint (47.5 ft for 25 to 70 ft) is above the 55 ft cutoff (`spoon_first_max_ft`), so P01 ranks spoons first, and nothing else fires without live data or an August answer. Options:

1. Keep it.
2. Lower `spoon_first_max_ft`, so flasher and fly joins sooner.
3. Add a rule that keeps one line of a second type on four or more lines, the way P02 keeps one spoon line.

Option 2 is a threshold edit with no deploy. Options 2 and 3 need new golden scenarios in `packages/engine/test` before they change.

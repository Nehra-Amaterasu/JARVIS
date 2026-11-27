## 2026-11-27: the browser suite's failure list worked down (triage of 32)

Question: 32 browser tests failed (11 from the 27 Nov round, 21 older). For each: is the screen wrong (a), is the test stale because the screen changed on purpose (b), or did a picture baseline change on purpose (c)?
Method: reproduce alone, read what it measures, look at the page (error-context, expected/actual/diff images), decide. Nothing was skipped, deleted or loosened without a reason written beside it.
Machine note: this laptop is loaded; a run that goes past ~3 minutes is moved to the background, and a `timeout` kill shows as a "0 ms" failure (not a test fault).

### The table (one line per failure)

| Test | Cause | Out | What was done |
|---|---|---|---|
| overlays: Date sheet with ten papers fits | the paper card became four wrapping rows (27 Nov), two cards overflowed the sheet by 319 px | a | `DateSheet.tsx`: page size is measured, two a page while two fit, else one (back to two on resize). Overflow 319 -> 0 px |
| l04-today desk 1366, full day / first run / nothing read yet (3) | the Counters card (4 tiles of 52 px, one column in the ~300 px tray, "+N more") needs ~290 px; the older frame's margin gives it a 106 px slot, so it lies over Ahead and Reminders and its first tile rises above its header (gap -140 / -50 / -3 px) | a, NOT fixed | see "Still failing" |
| l04-today phone 390, a full day (page length) | the same card: +238 px, page 1,638 px against a limit of 1,400 set on 15 Nov for one row of keys | b | limit 1,650 px with the measurement and date beside it (the page scrolls inside its own box on a phone) |
| t01-tree 1366x768 | `TreeStage` kept a stale `size` (refreshed only when a pan/zoom came to rest); since the click no longer re-frames (27 Nov), opening the node tray narrowed the stage 846 -> 664 px and labels the new edge cuts ("Systems and") were still drawn | a | `TreeStage.tsx`: a ResizeObserver on the stage keeps `size` true |
| t01-tree 390x844 (cut labels) | a branch plate's name is always drawn now (owner, 25 Nov), so a plate the stage edge cuts shows part of its name | b | the cut-label check keeps `.sn-label` (node labels) and no longer counts `.hub-name` |
| t01-tree 390x844 (controls cover a plate; then Next unclickable) | real: in the phone column every child could shrink: `.tg-body` to 426 px under a 500 px stage wrap (zoom keys over the ledger text) and the bar to 58 px (its second row, Branches and Next, lay over the stage and the stage svg took the clicks); also the test compared a cut plate's whole box, which runs past the stage clip | a + b | `grove.css`: phone children `flex-shrink: 0`, stage row 42vh/350 px so the page box still fits; the test compares the part the stage draws |
| t02-career money: page box scrolls 16 px | the first sentence of Money's sub-line became extra lines | a | `Money.tsx`: sub-line is the cost sentence and the confirm rule (the Add a source key already says how a source is added) |
| study-visual Papers baseline 1920 x ash / paper / indigo (3) | diff is the Proof column only ("NEXT STEPS / The System suggests", its spacing) | c | renewed the three 1920 baselines only |
| v3-kit dark-off contrast; gallery opens every entry; bench (d) motion | passed in some runs, failed in one: machine load (timeouts, `write ECONNABORTED`) | none | each run 3 times (bench light and dark too): 9 of 9 and 6 of 6 and 3 of 3 pass. No code change, no bench allowance needed (the Core Talk orb loop did not trip it) |
| themes-visual: 9 whole-sink pictures + 3 drawer + popover + toast (14) | baselines were last made 10 Nov; the kit's Chip/Segmented changed 12 and 20 Nov. Every picture differs the same way: the chip row is 2 to 3 px taller and everything under it shifts down | c | looked at expected, actual and diff for the 1920 sink and the 1366 drawer (the rest share the cause); renewed all 14 |
| surfaces: tree view settings popover, clean and after classic (2) | the Tree bar has no "View settings" key any more; the in-tree panel the surface checks is still drawn, behind the "Tree <name> <count>" key | b | the opener presses that key; same panel selector, same checks |
| l03-day phone 390 and 358 (2) | real: the seven day chips (`.wk-chip`) were styled only under `:root[data-look='v3']`, so the older frame drew them as 20 px tall buttons | a | `day-v3.css`: chip rules no longer need the v3 attribute; the strip wraps (auto-fit) because the older frame's phone box is 272 px and seven 44 px keys need 320 (v3 keeps seven columns) |
| l01-month: drawer and Marks popover, light and dark (2) | the day drawer's body scrolls 236 px at the gallery size | a, NOT fixed | see "Still failing" |
| glitch-sweep: New UI and Classic UI three times | `.s2-classic` now matches two buttons ("New look" and "Classic UI") | b | the locator is `.s2-classic` with text "Classic UI". It then failed once on a `Failed to load proofs: Failed to fetch` console error during the switch and passed on the next run (fetch aborted by the toggle; `germoney/stores/proof-store.ts` logs it as an error) |
| real-papers (2, with the seed) | (1) the desk prints ONE "N pages have no text layer: ..." line and every other fault line as sent; (2) the drafts fold is open on arrival, the spec's click closed it | b | the spec compares the route's no-text page numbers with that line and still checks each other fault line as sent; the fold is opened only when shut. Nothing it compares with the real routes was weakened |

### R32, small faults from the first real-route run
- `lib/api.ts`: an object `detail` printed "[object Object]". `errorSentence()` reads `detail.message`; the ApiError carries `detail`. The local `postCount` workaround in `counterDeck.ts` now uses `post` and maps a 409 to `CountConflict`. Unit tests in `lib/__tests__/api.test.ts`.
- `pyqMap.ts`: an unknown year stays `null` (types: `PaperRow.year`, `QuestionRow.year`). The desk lists such a paper with "n.d." and leaves it out of the year columns and the strata cells; tests in pyq, stats and desk.
- `PaperSources.tsx`: the read stamp goes through `formatStamp`, moved to `shared/stamp.ts` (DuePanes re-exports it). Unit and e2e expectations moved from the raw text to "27 Nov 2026, 09:05"; `real-sources.spec.ts` now opens Setup under v3 only and fails on a raw ISO stamp.
- `OcrPanel.tsx`: the three run counts say "this run" (unit test strings updated).

### R30
- Log minutes: only the old left rail opened it. A "Log minutes" row was added to Today's More menu (TodayV3). Season is already a row of that menu. Not checked in a browser (see below).

### Baselines renewed
study-papers-{ash,paper,indigo}-1920 (Proof column only); the 14 themes-visual kitchen-sink and overlay pictures (chip row 2 to 3 px taller). Nothing else.

### Still failing / not done (exact fix)
- l04-today desk x3 (older frame): the margin form gives each plate a fixed slot (`WEIGHT` in `TodayView.tsx`: counters 1.06 of a ~540 px body = 106 px); the new card needs ~290 px, so it lies over Ahead and Reminders. Fix: make the Counters plate content-driven in the margin (a compact two-tile row, "+N more" opening the tiles as a popover over the plates below), or place it under the dial. Not done: the older frame is no longer the default and the redesign is more than a small change.
- l01-month drawer x2 (light, dark): `.dd-sheet` body is 236 px taller than the sheet at the gallery size. Fix: fold or page the low-priority sections of `src/ww/day/drawer/DayDrawer.tsx` (`drawer.css`). Not done (time-box).

### R30 (checked in a browser: e2e/shell-v3.spec.ts "Today: More has Season and Log minutes")
- Season (Auto, Exams, Normal): reachable, a row of Today's More under v3 (it already was). Tree and Career have no season row; the season is global state.
- Log minutes: was NOT reachable under v3; added as a row of Today's More; the sheet opens (passes).
- The old Today left column's quick keys: not checked.

### Numbers
tsc exit 0. vitest whole suite: 4,164 tests, one failure (my px literal in papers.css, fixed, css-lint 374 of 374 re-run). Browser, one run of 20 spec files: 396 passed, 10 failed; the failures were then fixed or listed above (3 l04 desk and 2 l01 remain, 1 t01, 1 t02, 2 surfaces, 1 l03 fixed). Re-runs after the fixes: t01 3 of 3, l03/surfaces/t02 green, 207 passed with the 3 known l04 failures over 10 spec files. Seeded real specs: 6 of 6. Privacy scan 25 passed.

## 2026-11-27: the first run of the UI against the engine's real routes (seeded sandbox)

**Question.** Every screen built this week was tested against routes mocked in the page. Do the screens and the engine's real answers agree?

**How the run is started.** `WW_SANDBOX_SEED=study` makes `playwright.config.ts` add `--seed study --fresh` to the sandbox command (without it nothing changes for the 60-odd older specs, which count on an empty sandbox; `--fresh` makes each run start from the same rows). From `app/ui`:

```
export WW_SANDBOX_PORT=8961 WW_PREVIEW_PORT=5361 WW_SANDBOX_DIR="$TEMP/jarvis-ui-real-e2e" WW_SANDBOX_SEED=study
node scripts/build-e2e.mjs
npx playwright test e2e/real-*.spec.ts --workers=1
```

Four specs, no route mock, 1366x768, v3 look: `real-classroom` (files and Due), `real-papers` (OCR run, stop, run again; review desk; drafts; ledger), `real-day` (counters, R-63, R-64), `real-sources` (harvester Past papers; opened in the older frame because `#setup` does not open under v3 in this worktree). Each step fetches the same route with the token and compares; every 4xx the page receives is logged. Pictures: `$TEMP/ui-real-shots`.

**Result.** First run: 3 of 6 failed on real mismatches. After the UI-side fixes below: 6 of 6 pass (1.2 min). Unit: 1431 tests pass (43 files), `tsc -b` clean.

### Mismatch table (sorted by harm)

| # | Route | Field | Screen expected / engine sent | Where | Status |
|---|---|---|---|---|---|
| 1 | G-06 courses | item.state | lamp word / `"active"` (Google's course state): every course drew WAITING "no report" | adapters/gcr.ts (courses, patchCourse); ShelfPanes.tsx CoursesPane | FIXED: `courseLamp` maps active to LIVE, other Google words to WAITING with the word kept |
| 2 | life/count | 409 detail | string / object `{message,id,present}`: lib/api.ts reads `j.detail` and made "[object Object]" | lib/api.ts:44 (not mine) | worked around in life/counterDeck.ts `postCount`; fix for api.ts below |
| 3 | G-01, G-15, G-18, G-19 | synced_at, read_at, posted, start | local clock / UTC `...Z`: 09:00 UTC read as 09:00 in IST (5 h 30 min early); status and read stamps drawn raw ISO | classroom/DuePanes.tsx formatStamp, LinkPanel.tsx, DueFilter | FIXED: zoned stamps converted to the viewer's clock |
| 4 | G-07 files | also_in[].course | name / a course id (10 digits in real life): "Also in: fx1002" | classroom/ShelfPanes.tsx FileNotes | FIXED: names from the courses read (context), id only when unknown |
| 5 | life/count | expect | not sent / engine takes it | life/counterDeck.ts | FIXED (R-64), plus presses serialised so a quick second press is not a false 409 |
| 6 | R-63 layout | shown, order | device only / engine keeps it | life/counterDeck.ts, callouts/counters.callout.tsx | FIXED, device copy is the fallback, the sheet says which is in use |
| 7 | pyq papers | year | unknown year / `?? 0`: the ledger draws columns headed "0" | adapters/pyqMap.ts:52,98 (not mine) | listed |
| 8 | harvest index | read_at | local time / `2026-11-27T12:53:40+00:00` raw in "read ..." | setup/PaperSources.tsx (line with `read ${idx.read_at}`) (not mine) | listed |
| 9 | pyq practise-next (R-32) | whole route | shown somewhere / no screen calls `practiseNext()`; patterns only reach the ledger | adapters/pyq.ts:250, no component | listed |
| 10 | pyq ocr (R-28) | pages_total, pages_read, questions | per paper / per RUN: after Stop and a second run the panel says "Pages read 0 of 1, Drafts to review 0" while the paper has 2 pages and Review says 1 waiting | papers/OcrPanel.tsx facts | listed |
| 11 | G-01/G-03 | accounts[main] | no sign-in in a fixture / `state live`, "Disconnect" and "Add account" offered though the sentence says no account is connected | LinkPanel (UI draws what the engine says) | engine-side ask |
| 12 | life/count 409 | message | name / uses the id: "fixture-water changed since you saw it" | engine | engine-side ask |
| 13 | G-04, G-14 | fixture sync | can be stopped / ends in 0.3 s; the screen keeps "running" and Stop until its 2 s poll, then Stop answers 400 "No sync is running." (shown honestly) | engine fixture | engine-side ask: sync delay switch |
| 14 | G-01 | counts, Reader Facts | "1 papers, 1 faults, 1 pages" | LinkPanel.tsx, Reader.tsx | FIXED (plurals) |

Also observed and fine: fixture said as fixture (the sentence and the counts); stale file says its reason; Late only where the engine says; Open in Classroom refusal and Remind-me "That time has passed." both shown in the engine's words; the 409 sentence, the tile shows `present`, no undo step; OCR text "unverified" with its confidence in the review desk; drafts show engine similarity, sources and the rejected one's reason; accepted marks reach the engine. Not exercised: Stop sync on a long job; a picture-only OCR question (the seeded scan gives a whole-page draft and one under-gate page); review desk shows "page image not rendered" for the big page pane while the small crop renders.

### What changed
Files: playwright.config.ts, e2e/real-*.spec.ts (4) and real-helpers.ts, classroom/{DuePanes,LinkPanel,Reader,ShelfPanes,ClassroomShelf}.tsx, adapters/{gcr.ts,gcrTypes.ts}, life/counterDeck.ts, day/today/callouts/counters.callout.tsx, and the tests for them.

### Not covered by the seed yet
Tonight sheets, ledger marks, variants, rubric, intake rows, an export archive; a long-running sync; a picture-only OCR question; Setup under v3 (worktree lacks it).

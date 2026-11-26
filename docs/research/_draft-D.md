## 2026-11-25: Day fixes (Date sheet, Proof, counters, the gym session inside Body)

Package D of plan 08 (rows R2 to R5), UI only, under the v3 look. Worktree `ui-day`, branch `ui/day-fixes`, nothing committed. The owner's own pictures were the evidence; I never opened `data/`. Every fixture is invented (subjects "Signals and Systems", "Circuits", "Digital Design"; counters "Cigarettes", "Joints", "Drinks" are generic stand-ins).

### R2. The Date sheet (opened from the Ahead card)

- **Fault.** The paper card was a six-column grid. Subject (2 wide) sat under Paper's column, "Units covered" (2 wide) under a 1-wide label, "Out of" ran past the sheet's right edge, and the units hint was cut.
- **Done.** Four rows that wrap by themselves (flex-wrap, each field has a minimum basis and may shrink to 0): Subject with Paper; Date, Starts, Ends; How hard with "Aim for of Out of"; Units covered alone, so its whole hint shows. The card is a soft tone (`--acc-tray`), no hairline. The title and the bin share one line, the two ticks sit under them. Paging, Add a paper, Save N changes, Discard, delete and both ticks are unchanged. One bug fixed on the way: "Units covered" could not take a comma (it re-read `1,` from the numbers and dropped it); it now keeps the typed text and parses on every key.
- **Measured (Chromium, built app, v3).** At 1366x768, 800x900, 390x844 and 360x740, on both pages of papers: the nine fields of every visible paper have pairwise no intersecting boxes, none starts left of or ends right of the sheet body, every label is above and in the column of its own input, every input is at least 43.5 px tall, the sheet body has no horizontal scroll, the hint reads "Numbers, commas. Empty is all." with no clipping.
- **Not verified.** The owner's real subjects (the select shows what the plan store returns; an unknown subject id is still listed as itself). Date and time inputs use the browser's own pickers, whose width differs by browser.

### R3. The Proof drawer

- **Fault.** The drawer held the relief and then one fold, "Every proof card", with ten boxed cards inside it: boxes in boxes in a sheet. The stat numerals used the dotted display face (`--f-dot`), unreadable. Every meter bar was drawn full: every meter bar was drawn as a complete bar (seen in the 25 Nov picture of my own run: 80 of 180 XP and 32 of 60 hours both full). The likely cause is that the `.ww-fill` scaleX rule (`ww/design/motion.css`) does not reach this drawer in the built app; I fixed it in `proof.css` without proving that cause.
- **Done.** `ProofPanel` takes `tidy` (used only by the drawer, `ProofStrip`). Rank, "The System suggests" (kicker "Next steps") and Stats are three plain sections with a heading each and room between them; the cards keep their element, id and order but lose their face (`.ww-proof-flat`). The other seven (quest lines, weekly review, building hours, proof of work, wins, recent, what got in the way) wait behind one closed fold, "More proof (7)", mounted only when opened; a suggestion that points at one opens the fold first. Stat cells wrap with `auto-fit` (two a row on the 32 rem drawer, one on a phone); numerals and labels are the reading face; the meter fill carries its own scaleX. Met and Open stay words. "Not counted" and "Advice with sources" stay closed and open in place. Every number keeps its state word (the Stat tile still shows "Next: ..." only when the value is 0, which is the kit's rule and was kept).
- **Measured.** At the same four sizes: no horizontal scroll in the drawer, nothing of the three sections passes the body's right edge, no bordered element in them (meter dashed state and controls excepted), exactly six stat cells, the numeral face is not the dot face, the fold opens without changing the sheet's width, "Show quest lines" opens "More proof" and shows P4.
- **Not verified.** The real Proof data (all five routes were answered with invented rows); the relief above the three sections is untouched.

### R4. Counters on Day / Today

- **How a count is stored (read from `germoney.py` `life_tap`).** One integer per counter per day (0 to 500) in `state.life[date].counts[id]`, set by `POST /api/mission/life/count {id, value}` or nudged by `{id, delta}`. They are not items, so `/life/item`, `/item/delete` and `/item/restore` (meals, media, reels) do not apply to counters.
- **Done.** `ww/life/counterDeck.ts` (store) and the rebuilt `counters.callout.tsx`:
  - "+N more" opens the rest in the plate and never leaves Today (the old key called `go('day','week')`).
  - Each count tile has a minus and a plus, 44 px each. Minus is `{delta: -1}`; a refusal from the engine is shown in its own words ("a count is 0 to 500") and the number goes back.
  - Went to college (want "yes", or the counter named `college`) is ONE tick tile: pressed sends `{value: 1}`, pressed again `{value: 0}`. It never shows a number; an old stored 2 shows as Yes. I used the life count route with `value`, not the attendance or habit routes: the counter already exists there and `value` is exactly a yes or no.
  - Undo is a stack for the visit (module state, survives Today to Week to Today), newest first, 30 deep, entries older than 15 minutes are forgotten. Each undo sets the exact number before (`{value: before}`), so it is right after other taps too. A refused undo stays on the stack.
  - "Choose counters": a right-hand sheet to show or hide each counter and move it up or down. Kept in `localStorage` key `ww.day.counters.v1`, and the sheet says "Kept on this device".
  - The Capture Line's water (through the left store) is merged into the deck without another read; each deck write also asks the left store to re-read its life slice.
- **Measured.** 9 unit tests against a fake engine that enforces `life_tap`'s rules (+N more in place, plus and minus with the exact bodies sent, refusal shown and rolled back, college tick sets 1 then 0 and never shows 2, undo walks back newest first and ends disabled, undo of a tick, 15-minute expiry, choose and order saved, arrange and isTick). Chromium at 1366x768, 390x844 and 360x740: the plate shows four tiles, "+2 more" shows six and the hash stays `#day/today`, plus, minus, undo twice and the tick move the numbers the engine holds, every key on the plate is at least 43.5 px.
- **Not verified.** The owner's real counters and which are "yes" counters in his private inputs (the tick rule covers want "yes" and the id `college`; a yes or no under another id with another want shows as a count).
- **Needed from the engine.** (a) `GET /api/mission/life` already answers `want`; nothing else is needed for the above. (b) For the list of shown counters to follow him across devices: `GET/PUT /api/mission/life/layout {shown: string[], order: string[]}`. (c) If undo should survive a reload: `POST /api/mission/life/count {id, value, expect: <number before>}` answering the new row, so a stale window gets a 409 instead of overwriting.

### R5. The gym session inside Body

- **Fault.** "Log a session" opened a side sheet, "Gym session", holding the old Forge page with its Mission headings and cards.
- **Done.** Under v3 the Body page's first tray is the session ("1 SESSION"), the week and the last four weeks and the water are tray 2 ("2 WEEK"), the reminders tray 3. One key starts it in place; muscles are chips (the sparkle still marks back and shoulders); "Build the session (n)" gives one row per exercise: name, a small cue line, the "LAST 4x10 @ 40 kg" line or "LAST: no history yet", and Sets, Reps, Kg inputs 44 px tall; Change muscles, Cancel and "Save session (n/N filled)" (locked with its reason until one lift has all three numbers). The tray is a container: under 30 rem the inputs drop under the name. The logic is `useGymSession.ts`, the Forge page's own calls in the same order on save (`addSession`, `recordHours('workout', 1)`, `plan.log` 45 min on the body track, `markRep`, the `+10 XP` burst); the classic look still opens the Forge page in a drawer. I copied about 30 lines of Forge's logic instead of editing `germoney/pages/Forge.tsx` (outside my folders); if Forge changes how a save pays, `useGymSession.ts` needs the same change.
- **Measured.** Chromium at 1366x768, 390x844 and 360x740: the key starts the session with no sheet opened, chips choose, the build gives at least two rows, every row has three inputs of at least 43.5 px that stay inside the tray, nothing of the session is outside the window, the page does not scroll sideways, Save is aria-disabled until a lift is filled, saving posts the plan log with `track: body` and returns the tray to its start with "Session saved: n lift", Change muscles returns to the choice.
- **Not verified.** A real save's XP and ledger effects (the plan log route was answered by the test). The sandbox keeps the session a test saves, so a second run starts with a "LAST" line (the test copes with both).

### What remains / for the integrator

- Shell (not my folders): at 390x844 `.s3-body` in a tray sheet is `flex: 1 1 0%` with overflow visible, so 446 px stood around 684 px of content and the Done key lay over the last tiles. I added a scoped rule in `ww/day/v3/day-v3.css` (`.s3-body:has(> .tv3) { flex: none }` plus `.tv3 { flex: none }` in a sheet); the general fix belongs in `shell-v3.css`.
- The meter fill fix lives in `proof.css`; if the cause is as assumed, any other Meter drawn outside the old frame is full too.
- Files: see the report.

### Final run (27 Nov, nothing pulled)

- `npx tsc -b`: exit 0.
- `npx vitest run src/ww/day src/ww/life src/ww/proof src/ww/overlays src/__tests__/ww src/__tests__/shared --maxWorkers=2`: 39 files, 1252 tests passed, exit 0.
- `npx playwright test e2e/day-fixes.spec.ts --workers=1` (sandbox 8901, preview 5301): 14 passed, exit 0. It includes the bars' computed scaleX (80/180, 32/60, 3/3) and, for Body, that no part of the session is outside the window.
- Privacy scan (`pytest tests -q`): see the report.
- Pictures looked at: date 1366 and 360, proof 1366, 360, stats 390 and 800, counters 1366, 390 and 360, counters-chosen 390 and 1366, body session 1366, 390, 360 and idle 390. Fixed after looking: bin placed at the right edge of the Date card (an old `justify-content: space-between` shrank the grid track), counter tiles made one row each, bars made honest, sheet tiles no longer under Done.
- Left as it is: body-idle pictures are taken while the trays fade in, so tray 2 and 3 are not drawn in them; the peek pills on the phone belong to the shell.

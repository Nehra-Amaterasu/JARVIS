# When the whole application is complete

Written 15 Nov 2026 from the plan files, the budget rules and the git log. It supersedes the date columns of spec 21.2 for planning, because the budget rules (15 Nov) changed what a unit of work costs. Every figure is tagged **M** (measured in this repository) or **A** (assumed). The gaps this forecast works against are listed in `docs/design/overhaul-gaps.md`, part D.

## 1. What "complete" means

**UI overhaul**
- [ ] All 14 rows of gaps part B rebuilt on the new interface (10 sections, 36 views in the spec).
- [ ] The 20 gaps of part C closed; the Part D UI rows closed.
- [ ] One jury and one verification wave pass (pass line 8.0; no jury has passed yet, best 6.6 to 7.3, M).
- [ ] The old layout retired (B13), with the owner's OK and not during exams.

**Well Wisher engine**
- [ ] Exam generator end to end: text-layer papers, scanned pages (OCR), intake from notes and decks, drafts accepted by the owner, practice paper, print set, marks, one real-paper smoke test.
- [ ] Harvest: a question source runs on the owner's switches and queues local papers.
- [ ] Classroom link live (needs his own sign-in); folder, paste and calendar-file doors as fallback.
- [ ] Depth: spaced review, intents, logs, term arithmetic; habit, spending and body desks; the ten skill trees as data; career engine; Library and Today wired.
- [ ] Life engines: calendar link, reminders, evidence, week and month reviews.

**Yaadash integration**
- [ ] Well Wisher reads and writes the shared memory port (namespaces `ww/*`), counsel and day plan use it, one export and delete flow.
- [ ] JARVIS Memory section rebuilt, with weekly review and corrections.
- Status: **no package exists for the Well Wisher side** (gaps D26).

**JARVIS agents integration**
- [ ] Core intents, an agents console, scenes and rules, briefing drawer, notices, devices and energy.
- [ ] A read-only retrieval route for outside agents, whole-chat rating, richer export.
- Status: **reserve list only**, no `core/agents` or `core/rules` code (gaps D10).

**Aankhen and Room hardware where they touch the app**
- [ ] Room and Senses sections rebuilt; relay pin map (built); the board's soak finished; the board token set by the owner; drill days and a held-out day before "predicting" is dropped.

**Verification, polish and the flag flip**
- [ ] The polish pass, one jury, privacy scan, parity ledger with no NO HOME row, flag flip.

## 2. What is done (counts)

| Item | Done | Of | Tag |
|---|---|---|---|
| UI rows rebuilt (gaps part B) | 4 (Core, Day Today and Month, Focus, Paper and Review Desks) | 14; 1 built and awaiting review, 2 cut off and checkpointed, 7 classic pages hosted or tidied | M |
| UI waves merged | 4 (UW5, UW6, UW7, UW8) | 10 planned (UW5 to UW14) | M |
| Engine waves merged | 1 (EW7) | 5 planned (EW7 to EW11); EW8 planned and paused | M |
| Engine routes live | 27 (R-01 to R-27) | 47 contracted (R-28 to R-47 in EW8) | M |
| Checks at the last merge | vitest 2871 of 2871, Playwright 258 passed on 11 specs, app suite 2084 passed (EW7 log, 14 Nov) | | M |
| Parity ledger | about 11 rows BUILT, 40 on classic pages, 19 NOT BUILT, 7 NO HOME | | M (word counts in the file, so approximate) |
| Polish rows open | 20 | 20 | M |

## 3. Remaining work

Rates used. **M:** a six-agent wave takes about 75 minutes of agent time and about 1.8 million agent tokens; integration of a wave about 40 to 70 minutes; 12 agents took 3.1 million tokens and 116 minutes (NOW, 14 Nov). **M:** both lanes together burned 38 points of a window in about 40 minutes on 15 Nov. **A:** under the 80 percent cap and with no reviewers (budget rules 4b), a five-hour window carries about 6 Sonnet builders plus integration, so one UI wave takes about one window; the engine lane takes its turn inside the same windows. The cap, not the clock, is the limit, so the last column counts windows, not hours.

| Block | What | Agents | Running hours (builders plus integration) | Windows (low / mid / high) | Tag |
|---|---|---|---|---|---|
| R0 | Finish UW8 leftovers: integrate X03, relaunch C03 | 2 | 0.6 | 0.2 / 0.25 / 0.5 | A |
| R1 | EW8 relaunch: OCR and columns, drafts, intake store, harvester core, Classroom export door | 4 | 1.2 | 0.4 / 0.5 / 0.9 | A |
| R2 | UW9: Pattern Loom, week and body and close, Room, Core glance strip, intake adapters, Tree | 6 | 2.0 | 0.9 / 1.0 / 1.5 | M for the rate |
| R3 | UW10: Memory, Console, Career, Exam Hall, Deck, Week and Month Reviews | 6 | 2.0 | 0.9 / 1.0 / 1.5 | M |
| R4 | UW11: Senses, cursors and boot, Exam Room, System dashboard, Connect, adapters | 6 | 2.0 | 0.9 / 1.0 / 1.5 | M |
| R5 | UW12: trees one to ten, settings dissolved, calendar and Classroom adapters | 6 | 2.0 | 0.9 / 1.0 / 1.5 | M |
| R6 | UW13: one-key links, phone, learning loops, Coach | 6 | 2.0 | 0.9 / 1.0 / 1.5 | M |
| R7 | EW9: adapters, Google OAuth core, review queue with spaced review, term arithmetic, intents, logs | 5 | 1.5 | 0.5 / 0.6 / 1.0 | A |
| R8 | EW10 and EW11: Classroom sync, trees data, harvest sources, career engine, reviews | 8 over 2 waves | 3.0 | 0.9 / 1.2 / 2.0 | A |
| R9 | Yaadash into Well Wisher (new: one engine wave and one adapter wave) | 6 | 2.0 | 0.7 / 1.0 / 1.5 | A |
| R10 | JARVIS agents (reserve JH01 to JH11, two waves; new `core/agents`, `core/rules`) | 12 | 4.0 | 1.5 / 2.0 / 3.0 | A |
| R11 | Well Wisher reserve desks H04 to H11 (two waves) | 12 | 4.0 | 1.5 / 2.0 / 3.0 | A |
| R12 | Polish pass over 20 plus the Part D rows | 8 over 2 rounds | 3.0 | 1.0 / 1.75 / 2.5 | A |
| R13 | Verification: full check, one jury, gallery pass, privacy scan, flag flip (UW14) | 5 plus jury | 2.5 | 1.0 / 1.5 / 2.0 | A |
| R14 | Rework and outage buffer | | | 1.0 / 1.5 / 3.5 | A (two measured outages: 100 and 76 minutes) |

**Totals (windows).** UI overhaul complete = R0, R2 to R6, R12, R13: 6.5 / 8.5 / 12. Exam generator end to end = R0, R1, the intake and adapter parts of R2, a smoke test: 1.5 / 2.5 / 4. Well Wisher complete = R0 to R3 WW share, R5 to R9, R11 to R14: 11 / 14 / 20. Whole application = everything: 15 / 19 / 28.

## 4. Scenarios from 15 Nov 2026

First work day is 16 Nov (the 15 Nov window is nearly spent). **Windows a day:** best 3 (laptop on mains all day, owner away), expected 2 (the pace of 14 and 15 Nov, **M** as an upper bound only), slow 1. **College exams in December** (end-semester papers start about 7 Dec, **A**; dates not yet given): from 1 Dec to about 20 Dec the rate falls to 1, 1 and 0.5 windows a day, and no flag flip happens in that stretch (spec 21.2). Dates assume the owner steps in section 5 happen the day they are needed.

| Milestone | Windows (low / mid / high) | Best | Expected | Slow |
|---|---|---|---|---|
| UI overhaul complete, behind the flag | 6.5 / 8.5 / 12 | 18 Nov | 20 Nov | 27 Nov |
| Exam generator usable end to end | 1.5 / 2.5 / 4 | 16 Nov | 17 Nov (needs his real paper) | 19 Nov |
| Well Wisher complete (Classroom live, Yaadash in, desks) | 11 / 14 / 20 | 19 Nov | 22 Nov | 10 Dec |
| Whole application (adds JARVIS agents, reserve work) | 15 / 19 / 28 | 20 Nov | 25 Nov | about 26 Dec |
| Flag flipped and the old layout retired | UI complete plus his OK | 21 Nov | 23 Nov, or after his last paper if exams intervene | after the exams |

A day at the best rate is three full windows, about 15 hours of agent time. The earlier forecast (spec 21.2) gave D, the flag flip, as 17 to 24 Nov at 8 hours a day; this one agrees in the expected case and moves the slow case into December.

## 5. Assumptions, risks, and what only the owner can do

**Assumptions (A).** The window rate above; no reviewer and no jury until the build ends (15 Nov rule); each wave merges on type check plus its own tests; engine lane gets turns inside the windows; the usage cap is the only binding constraint, not the weekly cap (unknown); the Yaadash and agents blocks R9 and R10 are my sizing of work that has no plan row yet.

**Five biggest risks.**
1. **Jury debt.** No jury has passed the 8.0 line (best 6.6 to 7.3, M); deferring review means the polish pass may need more than 1.75 windows.
2. **Rate of work per window.** Budget rules estimate a six-agent wave with fixes at about a third of a window (with reviewers); the 6-builders-per-window figure used here is about half that. If the cheaper figure holds, dates move earlier; if the cap bites on integration, later.
3. **Unscoped work.** Yaadash into Well Wisher and the JARVIS agents have no packages; R9 and R10 could double.
4. **Classroom and OCR on the owner's real data.** Real papers may lack a text layer; the personal-account sign-in may be weekly-limited (Q-V3-3); GPU OCR means replacing the runtime the voice stack shares (engine plan, owner item 3).
5. **December exams.** Work slows or stops in the owner's attention (reviews, signings, the flag OK) exactly when the slow case lands; the application must stay usable at every merge.

**Only the owner can do.** Google sign-in (six steps in the engine plan section 8); one real text-layer paper for a smoke test; permission to replace the OCR runtime with the GPU build with the app closed; the end-semester date sheet; the board token in the firmware secrets file; flashing with the app closed; the soak and drill days; the gallery pass and the OK to retire the old layout; decisions on the attribution trailer in an old commit, the existing explanation-grading task, and each harvest source switch.

# Test audit: Mission Germoney (plan engine, bank, UI tree)

**Date:** 2026-10-23 (finished 2026-10-25), on main at 53f5cdb (the rebuild).
**Question:** do the Mission Germoney tests prove the rules we agreed (constraints:
Mission Germoney logic, Honesty for Mission, Privacy), where do they not, and where
does the engine itself break under random graphs, gaps and an exam season?
**Scope:** `app/jarvis_app/germoney.py`, `routes_mission.py`, `core/mission.py`,
`app/ui/src/germoney/**`, the Mission tab entries in `lib/store.ts`, their tests, and
the bank JSON in `app/ui/src/germoney/data/bank/`.
**New tests:** `app/tests/test_mission_audit.py` (163 cases),
`app/ui/src/__tests__/mission-audit.test.ts` (30 cases). All offline, scratch folders,
fictional subjects, fixed seeds.

## 1. Constraint → test matrix

| Constraint | Before (test_mission_plan.py / UI) | Now |
|---|---|---|
| Skill tree is an acyclic DAG | one hand-made 3-cycle; real bank "no errors" | + random DAGs (60) with an injected back-edge always caught; real bank `find_cycles == []` in Python and TS |
| Every prereq exists | fixture warnings | + real bank: 0 warnings, and the raw files checked before the merge drops anything |
| Resources owned by one node | none | real bank: one owner each, except 3 whole NPTEL maths courses that span 2-3 maths nodes on purpose (listed) |
| Only legal links | none | every resource, legal PDF and cert URL is https (1 documented http-only publisher PDF) and on a reviewed host list (120 hosts); piracy hosts rejected |
| Contract has context, hint, success check, "why" | fixture spot check | real bank: all 254 contracts; property test: every contract of every built day (random graphs, exam days) has title, context, hint, success check, why and steps |
| Engine never picks a locked node | indirect | property (40 seeds × 4 graphs): no locked, mastered or finished node in a built day; plus `complete`/`choose` with arbitrary keys (40 seeds × 45 ops) |
| Max 3 in progress | `start_node` refuses a 4th | + built days never start more new nodes than the cap has room for; random op sequences; 8 concurrent completes → exactly 3 in progress |
| Exam mode: re-sits first | phase fixtures | property (25 seeds × 6 worlds): a dated re-sit in the window always wins, the nearest one; else the nearest paper |
| Never invents an exam date | backlog "date to confirm" voice line | property: the exam date is always one from the file; TBC and impossible dates (2026-02-30) are no date; a phase counting to an assumed day is labelled and the voice says "probably about … the date isn't confirmed" |
| Past-paper questions never repeated | one question, one week later | ids unique per question (OR pairs), stable under a reordered file; 12 days with a restart every day and a migration on day 5: no done question ever offered again, and every question eventually practised |
| SEE marks needed from the pass rule | 2 cases | boundaries (IA 21 → 24, IA 20 → 25, IA at 40, IA below the CIE floor → not possible), 55 % cases, and 3,000 random rules against brute force with exact fractions |
| Rotation 5 days, resumes next week | next Monday only | rotation checked for every day of 2026-2028; resume after 1, 3 weeks, over New Year and over 29 Feb 2028; rescue week lines across New Year |
| Protected slot never filled | one day | every built day in every property and simulation test |
| Welcome back after ≥ 4 idle days, no shaming | 7-day gap | 1/3 days: none; 4/9/40: shown; same message on reload; gone after one win; shaming-word check |
| Refreshers after 30 days | 35 days | 29: none, 30 and 90: shown; gone after it's done |
| Learning log limits, no traversal | `../../evil.md` | 8 hostile/unicode names, exactly 10 MB accepted, 10 MB + 1, 7 files, bad type, no extension, bad base64, wrong shapes, bad dates: refused and nothing written |
| Internship deadlines within 14 days on Today | one 10-day case | 0, 14 shown; 15, −1, applied, not-eligible not; a past one is not "open" and never in the spoken list |
| Goal ladder: every contract serves a goal | 2 contracts | every real-bank branch maps to a milestone; 0 goal-less contracts across the 90-day run |
| No personal data in tracked files | none | bank + fixtures scanned for e-mails, phone numbers, CGPA/marks phrases, roll/register numbers |
| Voice claims only with a receipt (core/mission.py) | parse cases in test_game_bridge | + a question ("did I finish it?") never parses as a completion; 2,000 random utterances never raise |
| Mission tab entries | none | every mission tab lands on one of the 5 screens; the docked tabs are exactly Today/Tree/Focus/Log/Road with matching titles |

## 2. Bugs found and fixed (each with a short decision comment in the code)

1. **Marks needed off by one (honesty).** `ceil(agg/100*(see+cie) - ia)` in floats:
   55 % of 100 is 55.000000000000007, so ceil asked for one mark too many (1,799 of the
   0-100 % × 6 totals grid disagreed with exact maths; at realistic pass marks: 55 %
   of 100 and 200). Now exact fractions, plus `cie_ok` and `possible` (IA below the CIE
   floor, or a target above the paper's maximum, is "not possible", not a number).
2. **Two real questions shared one id.** The real papers mark both alternatives of a
   choice as `"2 (OR)"`; `sitting:choice_group` made them one id (every OR pair in
   the private question bank collided). Doing one ticked the other off unseen, and the
   second never came up. Missing groups used the list index, which shifted on any
   rewrite. Now: unique group ids unchanged, the rest get a hash of the question text.
3. **A locked node, or a 4th new node, through the side doors.** `complete()` on any
   tree key set the node in progress (even locked, even past the cap); `choose()`
   swapped in any key. Now the contract always counts, but the node stays queued
   ("stays locked" / "waits in the queue"), and is mastered when its prerequisite is,
   if its work is already done. `choose()` and the offered alternatives follow one rule.
4. **Impossible dates crashed Today.** "2026-02-30" passed the shape check and
   `date.fromisoformat` then raised inside `today()`. Now it is "no date".
5. **Assumed countdowns spoken as fact.** A backlog phase anchored on the end-sem date
   while the backlog block is TBC (the real file does this) or on an approximate end-sem
   date said "N days to go". Now `anchor_assumed` and a hedged line.
6. **The exam phase outlived the exams** (90-day run). The open-ended "internals week"
   phase ran 45 days past its anchor: after the last paper it kept scheduling
   "next-internal-paper" cards. Now it ends when no paper is ahead (a TBC re-sit still
   counts as ahead), and placeholder blocks with nothing to point at are dropped.
7. **Empty Thursdays** (90-day run). After the exams, the academics day picked a
   re-sit already written, all its units done: 4 empty library blocks in 90 days. Now
   it picks a dated paper, else a re-sit still waiting for its date, else borrows the
   best tree node and says so.
8. **Year-end rescue weeks.** "(Dec 28-Jan 3)" never matched any day. Fixed.
9. **Blank contract text.** A plan block whose subject is not in academics.json, or a
   unit with no weight and no strategy, gave a card with no context or hint. Defaults now.
10. **Goal ladder gaps.** `ai_hardware`, `ml`, `deep_learning`, `embedded`, `security`,
    `dsa`, `analog`, `devices` served no milestone with the default ladder.
11. **Wrong JSON shapes were 500s (BUG-R1).** settings (`rotation: []`…), exam
    (`days: "soon"`), learning (`minutes: "ten"`): now 400; the learning log validates
    everything before it writes a byte.
12. **State twice as large as needed (speed).** Stored days kept each tree contract's
    reading list, which `refresh_contract` rebuilds from the bank anyway: 12 KB → 6 KB a
    day over the 45 kept days. A 56-day simulation went from 24.2 s to 9.6 s (JSON
    encode/decode was 85 % of the time).

**Data fixes (genuine errors only):** `resources-career.json`: Cummings' papers
`http://www.sunburst-design.com/papers/` → `https://www.paradigm-works.com/technical-library`
(the old address now redirects there; checked the page lists the nonblocking papers);
Eyeriss tutorial `http://` → `https://` (checked 200). Left as is: Keshav's "How to Read a
Paper" (`ccr.sigcomm.org` times out on https, the publisher copy is http only).

**Not changed, for Aman to decide:**
- 11 academic PYQ links point at `notesgallery.com`, a third-party mirror of AKTU
  question papers. Papers, not textbooks, but not the university's own site. On the
  reviewed list as a judgment call. The bank also names the university (AKTU) in
  resource titles; not personal data, but it narrows who the repo is about.
- `tier` is not monotone along prerequisite edges (38 edges, mostly the maths track's
  own tier scale meeting the tree's). Every node is still reachable from the 3 starting
  nodes (tier ≤ 1), but ranking subtracts 2 × tier, so e.g. `dig.logic` (tier 1) behind
  `math.discrete` (tier 2) ranks slightly oddly. A data decision, not a bug I could prove.
- Both careers weight all 16 maths nodes 0, so maths only comes from Tuesdays, the
  rescue and exam plans (still 24 % of minutes below).

## 3. Vision alignment: 8 weeks on the real bank (no exams, a user who does everything)

26 Oct-20 Dec 2026, 223 contracts, 46 nodes mastered, never more than 3 in progress.

| Career set | Trunk (VLSI) | Maths | Other | AI-HW branch |
|---|---|---|---|---|
| none (best of both) | 3,690 min (51 %) | 1,746 (24 %) | 1,400 (20 %) | 330 (5 %) |
| vlsi_design | 3,730 (52 %) | 1,746 (24 %) | 1,385 (19 %) | 285 (4 %) |
| ai_hw_architect | 3,480 (48 %) | 1,766 (25 %) | 1,615 (22 %) | 330 (5 %) |

Trunk = digital_logic, hdl, verification, implementation, fpga, architecture,
programming; AI-HW = ai_hardware, ml, deep_learning. By branch (no career): math 1,746,
hdl 1,110, programming 820, soft_skills 660, digital_logic 535, architecture 530,
implementation 465, ml 200, security 165, verification 150, deep_learning 130.

Reading: the trunk leads, as the research asks. Two honest gaps: **`ai_hardware`
gets 0 minutes in 8 weeks** (its nodes sit behind HDL and architecture; the branch is
fed only through ml/deep_learning), and **verification only 150-210 min** although the
research ranks DV as the entry job (it is gated by HDL). With `ai_hw_architect`,
Fridays drift to security (400 min) because the Friday track includes it. Neither is a
code bug; both are tree/rotation choices to revisit after the first month.

**Exam season** (fictional academics, re-sit block set to 14 Dec): every week had
maths; every weekday in the 14 days before the re-sit had re-sit work in the library,
except the days of and before a sem-5 paper, which the plan's own "exam window" phase
gives to that paper (he is sitting it).

## 4. 90 days of realistic use (seed 2026)

26 Oct 2026-23 Jan 2027: ~1 day in 5 skipped, a 9-day gap from 18 Dec, the fictional
exam season, days finished fully, 60 % or 30 %, the odd swap, learning-log entries.
Result after the fixes: 65 days opened, 25 skipped, 39 exam-plan days, 138 contracts,
17 nodes mastered, 4 welcome-backs (one per gap ≥ 4 days), 1 refresher, 3 swaps,
5 learning entries, 0 goal-less contracts, 0 invariant breaks.

Where it lost track before the fixes: the 4 empty Thursdays (bug 7) and 10 days of
stale exam plan after the last paper (bug 6). Still true: frozen past days are never
re-planned, so missed contracts are only counted (welcome-back says "N planned
contracts didn't happen"), not carried over; that is the agreed no-shaming design.

## 5. Speed

Measured on this laptop (shared with other agents, so timings vary ±2x):

| Suite | Before | After |
|---|---|---|
| test_mission_plan + test_game_bridge | 27.2 s (122 tests) | 27-48 s (122), unchanged by the audit |
| test_mission_audit (new) | n/a | 20.2 s (163) quiet machine |
| all four mission files (+ test_germoney) | n/a | 82 s (300) while the full app suite ran beside it |
| full app suite | ~200 s (agreed baseline) | 288 s (1,044 passed, 14 skipped) under contention |
| UI: `npx tsc -b` | n/a | 18 s |
| UI: `npx vitest run` | 238 tests | 268 tests in 10.2 s (66 % of it creating happy-dom 23 times) |

The heavy cases (3 vision runs, the exam run, the 90-day run) take 1-2 s each after
the state slim-down; the 40 random op-sequence cases ~0.3 s each.

Cheap next step for the UI suite (not done, config change): vitest's own hint, one
happy-dom per worker (`pool: 'vmThreads'` or `isolate: false`), would cut most of the 66 %.

## 6. A UI bug seen in passing (not fixed here: another agent owns the pages)

`Road.tsx` `Goals()` selects `usePlan((s) => s.applications?.goals ?? [])`. Before the
applications load (the first render of Road; they are fetched by an effect), the
selector returns a new `[]` on every call. With zustand 5 and React 19 that is an
unstable `getSnapshot`, which React answers with "Maximum update depth exceeded": a
blank screen. The same pattern is in `Road.tsx` `Parking()` (`s.state?.parking ?? []`),
`Log.tsx` (`s.state?.events ?? []`) and `Today.tsx` (`s.today?.deadlines ?? []`).
Fix: select the raw value and default outside, or use one module-level empty array.
The backend views (applications, campaigns, certs, ladder, today, state, academics)
all ran clean on a scratch copy of the real private data (applications and
academics, read-only), on five dates through the exam season.

## 7. Sources

- Constraints: the agreed constraints file (Mission Germoney logic, Honesty, Privacy).
- Career weights: [2026-10-23-future-proof-careers-and-ms.md](2026-10-23-future-proof-careers-and-ms.md)
  (VLSI trunk, verification as the entry job, AI-accelerator architecture + power as the branch).
- Link checks (2026-10-23): https://www.paradigm-works.com/technical-library (200, lists the
  Cummings nonblocking papers; http://www.sunburst-design.com/papers/ redirects to it),
  https://eyeriss.mit.edu/tutorial.html (200), https://ccr.sigcomm.org/... (timeout; http 200).

## 8. What it changed

The engine fixes above, two new test files, two bank links. The real plan state does
not exist yet (no `@mission_v2` key in the store), so the question-id change needs no
migration.

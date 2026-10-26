# Well Wisher: running research file

One file for the Well Wisher topic, newest section on top. Older dated notes stay as they are (2026-10-23-mission-germoney-rebuild.md, 2026-10-25-well-wisher-v1.md, 2026-10-25-well-wisher-engines.md).

## 2026-10-26 (later): building hours from commits, and a director over the engines

**Question.** Can the hours spent building (with an AI pair, commits every 20–60 min) be counted from real evidence? And can the engines feed one ordered answer instead of six cards?

**Sessions model (ww_sessions.py).**
- Commits less than **90 min** apart form one session; each session adds **30 min** of lead-in before its first commit; a session is capped at 8 h.
- The area of a commit comes from its conventional-commit scope, with old names merged (mission / germoney / wellwisher become well-wisher).
- On this repo (26 Oct): **166 commits in 14 days**, **15.5 h of building in 7 days**, 4 h 52 min on the day.
- The commits are real; the minutes are an estimate from timestamps, and the card says so.
- Importing logs each session once (keyed by its first commit) as a "build" log, with the last commit's URL as proof.

**Director (ww_director.py).**
- It takes only the other engines' answers and adds no new model of him.
- In exam week (a paper within 14 days), today's study blocks come first, and building is capped at 60 min a day until today's study is logged; otherwise up to 180 min. Both caps are in Settings.
- Then the due recall and the unticked habits, then the build block.
- A practice paper under its target moves that paper up and names the gap.

**Exams: difficulty and targets.**
- Per-paper difficulty scales the learn time: easy 0.7, hard 1.3.
- The target is checked against the latest practice paper.
- On the real sheet (target 16/20; three papers easy, four hard) the plan is **about 10 h short**, up from 4 h with no difficulty set.

**Tests.** 14 new (sessions grouping, lead-in, aliases, import idempotence through the plan, the git-log parser, the director's caps and ordering, the difficulty scaling, target clamping); app 1240 passed, UI 324 passed.

## 2026-10-26: an exams engine, and Settings the engines actually read

**Question.** The owner's internals are 7 papers over 4 days, each on two units of the syllabus. Can Well Wisher turn a typed date sheet into a block-by-block plan to the last paper that stays honest? And can it use what he types in Settings at all?

**What was found (audit of the code, not the web).**
- The Settings drawer only changed the library rotation, exam dates, the certificate budget and the plan style. The engines read `engine-inputs.json`, which only a text editor could change. So nothing typed in Settings reached the counsel. **Fixed:** `PUT /api/mission/inputs/{section}` writes one section (date sheet, study time, profile, deadlines…), keeps a daily backup, and answers what normalization ignored.
- **A bug found on the way.** `merge_plan_state` keeps only the keys in `default_plan_state`. Habit taps (`habits`) and the knowledge-of-the-day record (`learn`) were not listed, so both were dropped on every reload since they were built (25 Oct). Added, with a test.

**Design of the exams engine (ww_exams.py, engine 10).**
- **Coverage** per paper = Σ weight × credit / Σ weight over the topics of the units the paper covers. Weights: high 3, medium 2, low 1. Credits: none 0, learned 0.6, solid 1.
  - It is a **self-report**, so the UI never calls it a score. The only measured number is a timed practice paper's marks.
- **Work estimates** (stated as guesses in the code):
  - 45 / 35 / 25 min to first learn a high / medium / low topic;
  - 40 % of that again to make a learned topic solid;
  - 80 min for a timed paper plus marking.
- **Allocation:**
  1. **Reserved stretches first:** the last free day before a paper day goes to that day's papers; the gap between two papers on one day (minus 60 min for travel and lunch, capped at 150) goes to the second.
  2. **Everything else** in 30-minute chunks to the paper with the largest remaining work ÷ free minutes before it.
  3. Minutes already logged today come off today's block.
- **Order inside a paper:** unseen high-weight topics, then the timed paper, then the solidifying redos. So any shortfall lands on the low-weight end.
- **Forecast:** coverage on the day at 50 % and at 100 % adherence to the plan. A range with its assumption written next to it; no single-number promise.

**Numbers on the real date sheet (26 Oct, nothing tapped yet).**
- About **50 h of work against about 46 h free** (240 min on weekdays, 300 on weekends, 150 on exam evenings).
- Forecast coverage on the day: **39–46 % at half the plan, 78–93 % at the full plan**, per paper.
- One paper has no unit list (no syllabus on the laptop), so it is flagged and gets revision blocks only.

**Tests.** 24 new in `app/tests/test_ww_exams.py` (fictional subjects): purity, the reserved-gap and day-before rules, weighting, the logged-minutes deduction, the forecast bounds, no-shame wording, the Settings save path, file matching. Plus 3 UI tests. App suite 1226 passed.

**What it changed.** Today has an Internals card. Settings has "What the System knows". The engine count is 10.

**Sources.** The code itself; the sprint plan's own rule ("the last full block before each paper belongs to that paper", 2026-10-25 internals pack). Spaced recall and closed-book redo follow the testing-effect rationale already cited in `ww_learning.py`.

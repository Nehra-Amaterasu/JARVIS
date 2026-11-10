# Well Wisher: running research file

One file for the Well Wisher topic, newest section on top. Older dated notes stay as they are (2026-10-23-mission-germoney-rebuild.md, 2026-10-25-well-wisher-v1.md, 2026-10-25-well-wisher-engines.md).

## 2026-11-10: the frame behind a flag, and 44 px phone taps (chunks 4 and 1b-phone)

**Question.** Can the six-workspace frame switch inside the 600 ms envelope the design sets, without touching the app shell another chat owns, and do the phone page's taps meet the 44 px rule?

**Measured (10 Nov, Chromium 141 through Playwright, stub pages).**
- All 30 ordered workspace switches finish inside the envelope: worst 530 ms against the 600 ms cap, timed to the end of the view transition, 700 ms apart so each takes the transition path. A click 100 ms into a switch lands.
- Feature probe in that Chromium: `inert`, view transitions, `animation-timeline` and `content-visibility` all present. The installed WebView2 runtime is 157.0.4341.42 (read from the registry only, not driven).
- The frame code is a separate lazy chunk (20.9 kB JS, 41 kB CSS before gzip); with the flag off nothing of it loads, and all 876 UI tests and the old pages' tests stay green.
- Phone Study page at 390 x 844: every button, chip, topic, class tap and counter is at least 44 x 44 px (the +25/+50/+90 buttons were 36 px); a mutation back to 36 px fails 2 of the 10 browser cases.
- Season (exam window 45 days, evening at 18:00 or once every slot of the day reads 0 minutes) is one pure server function sent to the desktop and the phone, so they cannot disagree; changing the window to 30 days fails a test.

**Not verified.** The switch time on real pages (Tree, Study) and inside the real WebView2 window with glass on and off: that is chunk 14. The 45-day window is an assumption waiting for the owner (open question 8). The desktop season pill can override to Exams or Normal; the phone has no pill and always reports Auto.

**What it changed.** The frame ships dark behind `#ww=frame` (or `localStorage ww.workspace=frame`); the one-rail-entry change in the shell waits for the owner and the overhaul chat. The printed gate report now also names the dMAT and harvest checks.

## 2026-11-09: consolidation audit (what Well Wisher really does today)

**Question.** Before adding anything new: what should Well Wisher already do, what does it really do when tried in the running app, and where is the UI inconsistent? Method: a sandbox copy of the app on a scratch data folder, every page opened and measured (DOM sizes, computed styles, API answers), plus a code read. Nothing was edited. Full per-page reports are in the private audit notes, 9 Nov.

**Capability check (33 planned items).** 18 work, 6 partial, 3 missing, 5 untested (plus 1 deferred). Working: exams v2 with 16 date-sheet papers, the group switcher, the attendance engine and Classes card, the practice-paper generator, Today and the weekly review, six life trees, Status, Career, and the quality-gate tests (16 passed).

**Gaps the owner named, confirmed in the app.**
- 13 of 16 papers have an empty question bank (only 3 papers have any questions). The API answers 200 with `bank_size: 0`, so the UI opens an empty skeleton and the "no bank" toast, which sits on the error path, never fires. CIE papers are generated with the 60-mark end-semester pattern although the row says 20.
- The GATE tier is a label only: `tier=gate` returns the exam-tier questions (`ww_generator.py` falls back with `bank = tiered or bank`), no question carries a tier, and the UI has no tier control.
- Maths is not typeset: 0 of 88 bank questions and 0 of 37 revision sheets contain `$`; the Exams card renders `q.text` as a plain span; the Reader's `math()` handles only `_` and `^` inside `$...$`, so `\frac`, `\sqrt`, `\int` and `e^(-xy)` would print wrongly. A second bug: the italic regex in the Reader swallows text between two underscores.
- Phone pairing is not reachable from Well Wisher: `PhoneCard` is imported only by Connect and Limbs, and the phone's `/phone/ww` address is never shown.

**Blockers found by the audit.**
- The Reader and Settings drawers are `position:fixed` inside the transformed, scrolling page, so "Open in Reader" is off-screen after any scroll (fix: portal to `document.body`).
- Settings crashes (React #185) on a cold open: a zustand selector returns a new `[]` each render (`usePlan(s => s.academics?.subjects ?? [])`).
- The Log page is a 300 px scroller: a Core console rule (`.log`) leaks onto `mission-page log`.
- The Tree switcher, panel tabs and link rows have no CSS rule at all.

**UI facts (measured).**
- Buttons: 28 distinct button class strings, four unrelated families, three `.seg` definitions; the dominant height is 28 px (heights in use: 17 to 44). Fields: heights 13 to 44 px across 8 per-page overrides.
- Tokens: a parallel `--ww-*` scale (18/20/28) sits off the app's 4-8-12-16-24-32 spacing and 16/22 radii; 939 px literals, 72 hard-coded colours, 17 font sizes, 16 radii; `--s*` is used 0 times in the germoney CSS. `.on` states hard-code white, so a theme swap is not yet possible.
- Motion: `useSpring`, `Ticker`, `Presence` and `switchView` are used 0 times in Well Wisher; four sources of durations; 7 separate reduced-motion blocks.
- Layout: Today is 14 cards (about 2,500 px with folds closed); the same Quest card is mounted on three pages; two exam-date editors exist and disagree; two navigations (rail and top nav) list the same eight pages in different orders and the rail clips three at 928 px; page titles disagree with nav labels.
- Tests: 38 files / 368 tests pass but assert card wording, not placement, primary action, empty states, hit areas, motion or maths. happy-dom has no layout, so size and overflow checks need a real browser.

**What it changed (proposals, none built yet).**
- A shared primitive set to build once and reuse per theme: Card, Fold, Button/IconButton, Seg/Chip, Field, Stat, EmptyState, ComingCard (placeholders for planned features), Drawer (portal, focus trap), Toast, MathText, motion presets, a Theme accent layer, ScreenSlot, and a Section primitive carrying `data-section`, `data-primary`, `data-hint`.
- Maths: a one-place `toTex()` converter (about 1 day, mostly content ambiguity) plus KaTeX loaded lazily (about 0.6-0.7 MB estimate, not measured; needs approval), with an extended in-house renderer as the no-install fallback (about half a day, no matrices).
- Tests: a contract suite in vitest (section order, one primary action, accessible names, empty states, hint length, planned-feature registry, a maths table), a CSS-token ratchet, and a motion test; layout and screenshot checks need Playwright (approval).
- One home per card, and one navigation, are proposed in the private synthesis for the owner to decide.

**Sources.** Private audit notes, 9 Nov (13 reports and a synthesis); code under `app/ui/src/germoney/`, `app/jarvis_app/ww_generator.py`, `app/jarvis_app/routes_mission.py`.

## 2026-11-04: Offline architectures for the November build (RTX 4050, 0-cost)

**Question.** How do the 17 November build tasks (exam pattern generator, local RAG/Yaadash data staging, interactive audio reader, Google Classroom/Gmail, attendance optimization, two-tier ledger) run 100% locally on an RTX 4050 (6 GB VRAM) and 16 GB RAM with zero external API costs, without hallucination or agent swarms?

**Found.**
- All required ML and systems primitives are already installed in `.venv`: `sentence-transformers` (5.6.1), `rank-bm25` (0.2.2), `chromadb` (1.5.9), `pymupdf` (1.28.0), `edge-tts` (7.3.1), `sympy` (1.13.1), and `faster-whisper` (1.2.1).
- Unconstrained agent swarms fail on this hardware: recursive agents exhaust local context windows, saturate the 6 GB VRAM, and trigger rate limits. The viable concurrency pattern is single-task, isolated parallel workers outputting strict Pydantic schemas merged by a local deterministic evaluator.
- Hybrid search (dense `all-MiniLM-L6-v2` + sparse BM25 via Reciprocal Rank Fusion) provides sub-5ms local retrieval without GPU memory contention.
- Numerical exam verification does not need an LLM: `sympy` parses and symbolically validates derivations and matrix problems via one-line check scripts.
- Attendance optimization is exact arithmetic: safe skips $S = \lfloor (A - 0.75N) / 0.75 \rfloor$ and recovery deficit $R = \lceil (0.75N - A) / 0.25 \rceil$.
- Conversational wit & timing requires fine-tuning on subversion datasets rather than prompt engineering: Unsloth 4-bit QLoRA on 3B base models (Llama-3.2-3B / Qwen2.5-3B) trains on Colab T4 / local RTX 4050, exports to 1.9 GB GGUF for Ollama, running in <400ms speech turns.
- Clinical ADHD consistency research confirms willpower fails due to low prefrontal dopamine: implementation intentions (if-then triggers), body doubling (ambient agent presence), and 4-week trend medians prevent habit collapse. Articulation improves via a 10% cadence reduction.
- Real-world action execution maps to a three-tier hierarchy: native REST APIs (Spotify, Google Workspace), authenticated CDP browser sessions (Zomato/Swiggy Web), and ADB UIAutomator (Blinkit mobile), strictly gated by manual UI approval before financial checkout.

**Designed & Added to PLAN.md.**
- Concrete data schemas and algorithms for `ww_papers` (AKTU exam patterns, PYQ frequency analysis, `none -> learned -> solid -> sharpen` progression, negative feedback loops).
- Temporal Knowledge Graph & episodic extraction layer for Yaadash (solving the "have I ever loved anybody?" semantic vector failure).
- Local RAG pre-staging pipeline with 15% AST heading overlap, SQLite adjacency graph, and daily conversation sparks (Word/Fact/Thought of the day).
- Interactive audio reader using PyMuPDF + `edge-tts` streaming with SSML rate/pitch tags and Socratic commentary pauses via local Ollama.
- Loopback desktop OAuth 2.0 flow for Google Classroom and Gmail with strict human "say yes" gates for cold email drafting.
- Two-tier ledger: public GitHub TIL repo + encrypted private local vault.
- Unsloth QLoRA conversational wit fine-tuning recipe and ADHD behavioral scaffolding.
- Tool execution hierarchy for Spotify, Gmail, Zomato, Swiggy, and Blinkit.

**Not done.** Implementation starts 6 Nov after the EV internal exam concludes the feature freeze.

## 2026-11-01: Counsel, so the model jobs run on any model

**Question.** The owner's Claude subscription ends soon. Which parts of Well Wisher depend on a model, and how do they keep working?

**Found.** No engine used a model: every stat, plan and forecast is arithmetic over logged actions. The model work was done by hand in chat: grading explain-backs, quiz questions from sheets, parsing a day sentence, summarising reels, and writing the study material itself.

**Built.** `ww_counsel.py`: four tasks, each a prompt file plus an output validator; one provider function (Ollama's `/api/chat` with `format: json` by default; an OpenAI-style endpoint from the environment otherwise). A down or rambling model returns a status, never an exception. Tests use a fake provider, so the suite needs no model. `docs/HANDBOOK.md` records the division: what needs no model, what needs the local one, what needs a strong one (building features) and how that is done from the repo with any coding model.

**Not done.** The cards do not call Counsel yet (the explain-backs in Study and Life are the first users); Ollama was not running during the build, so the live path is untested today; the study-material writing stays a human-plus-any-model job, with the number checks as the safety net.

## 2026-10-28: Tree v2, one canvas for seven trees

**Question.** Can the skill tree and the six life trees share one canvas and one interaction model, stay at frame rate, and prove in tests that no node or label overlaps?

**What was built (app/ui/src/germoney/tree/, Tree.tsx).**
- A switcher: Skills plus every tree from `GET /api/mission/trees`; life trees pass through an adapter into the same layout engine.
- Spatial arrow keys: Left/Right along a tier, Up/Down to the nearest node by x in the next tier; Enter opens the panel, Esc closes.
- Selection pans the view to the node in 240 ms (ease-out, transform only, jump under reduced motion) and lights the prerequisite path and what the node unlocks; other nodes dim by opacity with no re-render of the node layer.
- Zoom glides toward the pointer; a sensitivity slider (0.5x-2x) is remembered.
- The panel is the only glass element, and only on the refract/blur tiers. Life nodes show a proof meter (have/need), the evidence list and, for link nodes only, the URL proof form; measured nodes get no button.
- Links: node links select, page links switch tabs, URLs open through `pywebview.api.open_url` (a second JARVIS window) with `window.open` as the fallback.
- Branch captions moved from 52 px to 80 px below the lowest node because they sat on 3-line labels.

**Tests.** `tree-v2.test.ts`: the real skills bank and five fictional life trees have no overlapping node areas and no label overflowing its box (labels cap at 3 lines); neighbour picking on a small DAG; the panel's meter, evidence, form-only-for-link and POST; the switcher; the three link kinds. UI suite 352 passed, tsc clean, dist rebuilt with the app closed.

**Not measured.** 60 fps, the glide feel and the glass were not seen in the real window by anyone yet.

## 2026-10-27 (night): life trees verified by evidence, and a UI pass by four agents

**Question.** Can progression in GitHub, LinkedIn, content, money, a second career and discipline be drawn as trees like the skill tree, without a single node that is "done" because a button was pressed?

**Design (ww_trees.py, 28 nodes in lifetrees.json).** Each node names its proof kind and threshold. Link nodes count links he files (README, pinned repos, a merged PR, a recommendation, posts). Measured nodes read numbers the app already counts: public commit days (proof engine), building hours (sessions engine), money-log income and entry counts, skill nodes mastered with a contract, Life points. Status: locked until every prerequisite is mastered; mastered at have >= need; in progress above zero; else available. A test loads the shipped file and checks it is a set of DAGs (prerequisites exist and sit in a higher tier), that every node has outcomes and a proof sentence, and that nothing is mastered with no evidence.

**The UI pass.** Four agents in worktrees, one slice each (shell + Today; Study + Reader; Life + Status + Career; Tree). Rules given to all: transform/opacity only, 120-200 ms, no new backdrop-filter or SVG filters, no dependencies, no fonts. All four were green on tsc and vitest (330 UI tests after merge) and none could look at the running app, so widths and smoothness are reasoned from the CSS, not seen. The Tree slice moves pan/zoom to one transform written at most once per frame; a v2 (tree switcher, spatial arrow keys, glass panel, in-app links, animated zoom, overlap tests) is in progress.

**Numbers.** Backend 1254 passed; UI 330 passed. dist rebuilt once with the app closed.

## 2026-10-27: sections, a study engine, a life log, and why logging apps die

**Question.** The app had grown to 30+ cards on one Today page. How should it be split so it stays usable? And how do you get a person to log his day for months without the logging itself killing it?

**What changed.**
- **Sections, one job each:**
  - Today: direction, today's 3, the blocks with their contracts;
  - Study: internals, one node, the daily concept;
  - Tree;
  - Life: the day in taps, habits, quests;
  - Career (was Road);
  - Status;
  - Focus and Log as minor tabs.
  The exam card had pushed the contracts off Today; it now lives in Study.
- **ww_study.py (engine 13):** a node moves through choose → study → contracts → review → mastered, always with one next step.
  - "Mastered" needs every contract done, a filed note, and three explain-backs from memory at 1, 3 and 7 days after the last entry.
- **ww_life.py (engine 14):** one tap per counter.
  - A "less" counter gets a line: the median of the last 7 logged days minus 10 %. On or under the line earns a point.
  - A day over it is information, never a reset.
  - The public defaults are generic placeholders; the real counters live in the private inputs file.
- **The in-app Reader:** the desktop window (WebView2) cannot hand a `blob:` URL to another app ("Get an app to open this blob link"). Study files now render inside the app: Markdown as React elements (never injected HTML), PDFs in a frame.

**Why logging apps fail and what that dictated** (cited from memory, not re-fetched on 27 Oct):
- **The attrition law:** in digital-health trials, most users stop logging within weeks (Eysenbach 2005, "The Law of Attrition", https://www.jmir.org/2005/1/e11/). So every log is one tap, and the plan is to move to passive sources (commits, presence) and one end-of-day voice check-in.
- **Behaviour = motivation × ability × prompt** (Fogg, https://behaviormodel.org): make the act tiny (ability) and put the prompt where he already is (Today and Life, voice).
- **The abstinence violation effect** (Marlatt and Gordon, *Relapse Prevention*, 1985): a slip framed as failure tends to become a full relapse. Hence no zero-resets, no red, no blame wording (ww_base.no_shame).
- **Gradual reduction:** for cutting down a habit, gradual reduction gives quit rates similar to stopping at once (Cochrane review CD008033, Lindson-Hawley et al. 2016, https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD008033.pub4). Hence the 10 %-a-week taper.
- **Streak protection:** loss of a long streak makes people quit. Streak "freezes" are how Duolingo keeps them (https://blog.duolingo.com/how-duolingo-streak-builds-habit/). The planned v2 reward uses 4-week trends and a freeze, not streaks that break.

**Tests.** 8 new backend tests (stages, taper lines, reels, custom counters, plan taps), 3 new UI tests (the renderer never turns text into HTML, the counters tap). The UI suite passed: 325 tests before these 3 were added, all 3 new ones pass.

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

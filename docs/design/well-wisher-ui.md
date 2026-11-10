# Well Wisher UI plan: where every part lives and how it looks

Status: plan, 2026-11-09. Public file: no personal data, no habit or attendance numbers, no names. Every sample value in a wireframe is a placeholder (`Subject A`, `N`, `n`), never real data.
Inputs: the 9 Nov consolidation audit (private notes), three design proposals and three judgments of them, [`../research/ui-design.md`](../research/ui-design.md) (sourced principles), [`../research/question-sources.md`](../research/question-sources.md) (what questions may be fetched, and under which terms), the 9 Nov motion and taste studies of twelve reference sites (private notes), and the working plan (private). "(M)" marks a number measured by the audit or by me; "(A)" marks an assumption to be measured when it is built.

Contents: 1 Why (1b: the 9 Nov bar) . 2 Principles . 3 Information architecture . 4 Wireframes . 5 Design system (5.7 the motion system) . 6 Formatting . 7 The carcass . 8 Tests and verification protocols . 9 Build order . 10 Open questions . Objections considered.
Revised twice on 2026-11-09: first after an adversary pass (22 objections; the ones taken in part or not taken are answered in the last section), then to the owner's 9 Nov bar (section 1b): the two installs are done, the maths section is definite, the motion system is section 5.7, the Playwright protocols are section 8.4 and 8.6, the carcass is complete, and the build order has a verification per chunk plus two backend chunks (H, the question harvester; 2b, dMAT).

---

## 1. Why

1. The app works: of 33 capability rows the audit graded 18 working, 6 partial, 3 missing and 5 untested (M); the engines are real and the gate passes. The problem is the screen, not the engine.
2. "Piled up" is measurable: Today is 14 cards in about 2,500 px with the real work (the Library block) 1.3 screens down; the same Quest card is mounted on 3 pages (M).
3. "Not placed right" is measurable: 2 navigations in different orders, the rail clips 3 of 8 destinations at 928 px, 5 embedded pages bring a second H1, and the tab is called Career while its title says Road (M).
4. "Buttons too shrunk" is measurable: the dominant button is 28 px, 11 control heights are in play, 28 distinct button class strings, 4 unrelated button families, and `.seg` is defined 3 times (M).
5. The look cannot be themed: 72 hard-coded colours, 939 px literals, 17 font sizes, 16 radii, and every `.on` state hard-codes white; the app's own motion helpers have 0 uses in Well Wisher (M).
6. Three accessibility numbers fail on today's tokens: `--ink-3` 3.77:1 (needs 4.5), `--ink-4` 1.79:1, white on saffron 2.60:1 (M, recomputed for this plan).
7. What he asked for and cannot do: a CIE paper (13 of 16 seeded papers answer 200 with an empty bank), GATE-level questions (the tier is a label), maths as maths (0 of 88 bank questions contain `$`), and pairing a phone from inside Well Wisher (the only door is another section of the app) (M).
8. The plan lists features but never says where they go or what they look like, and no "coming" card exists; 38 test files pass 368 tests and could not have caught any blocker (M).
9. This plan answers with 1 persistent left column ("what now"), 6 workspaces named like the pages he knows, 1 proof rail, 8 overlays, 68 cards each with exactly 1 home, a 3-tier token system with 3 themes whose contrast is computed, and a registry that renders every unbuilt feature honestly.
10. It changes the order of work: tokens, motion and primitives first, so every later page only consumes them; the CIE and maths fixes ship early and live; the new UI ships behind a flag so the current one keeps working through the exams.
11. On 9 Nov the owner raised the bar: "much more extravagant", a look that changes from section to section with a reason, motion with weight and gravity on components, transitions and scroll, a carcass for what is not built, verification protocols for all of it, and no slowdown. Section 1b records the decisions that bind this revision; section 5.7 is the answer for motion.

### 1a. How the frame was chosen, and the judgment calls

Three proposals were scored by three judges (owner's lens, builder's lens, design lens; each out of 70): Workspace ("Studio") 53, 57, 54; Loop-first 52, 53, 50; One-screen Hub 51, 47, 51. The workspace frame won on every judge, narrowly, so it is the base. The judges demanded grafts; where they disagreed this plan decides:

| Question | Options | Decision | Why, in one line |
|---|---|---|---|
| Frame | workspace (3 regions) / loops / hub with sheets | Workspace frame, Hub's caps on top | Closest to the pages he knows, the only phone slice, cheapest to land dark; the Hub's budget stops it piling. |
| Three persistent regions vs one screen | keep / collapse | Keep left column and tabs; proof column is a 56 px rail below 1500 px and never pinned at 1366 | Design judge: density was the workspace's weakest point; the rail removes one column at 1366. |
| Season and evening states | none / Hub's swap | Adopt, with a visible Season pill and override | Best idea of the Hub; the surprise risk is handled by an override and a spoken line. |
| Tree inspector | opaque / frosted | Opaque body, glass at most as a 1 px edge; toolbar flat | The owner asked for a frosted look earlier (private log); the adversary pass computed ink-3 at 3.78:1 on a 58 % tint over a lit saffron node and 2.53:1 over white, so text never sits on glass (5.6). |
| New aggregator route for the left column | add / compose existing | Compose existing routes first; add a route only if phone parity needs it (chunk 13) | Builder judge: fewest moving parts during exams. |
| Where the Quest log lives | Day / Life | Life | It is a body habit and Life owns the day's small things. |
| Where Status lives | own page / rail / Memory | Proof rail and panel | The scoreboard is read, not worked in; 2 clicks at 1366, 1 at 1500+. |
| Fold height animation | animate rows / snap | Snap (fade + 8 px slide inside) | Research: animate transform and opacity only. |
| Travel duration | 480 ms / 400 ms | 400 ms | NN/g: 400 ms is the ceiling for big movement. |
| Delivery | in-place rewrite / new folder + flag | New folder `app/ui/src/ww/` + flag, old UI deleted last | Builder judge: pages import each other, an in-place rewrite breaks importers. |
| Loop-first's Memory place and LoopStrip | adopt / drop | Drop Memory; keep one stage strip on Study > Papers with computed counts only | Memory was a 17-card junk drawer by its own admission. |
| Log as a place | keep / dissolve | Dissolve; one Log-minutes sheet (O6) plus Recent in the proof panel | All three agreed; the 300 px box dies with the page. |
| One navigation or two (9 Nov: "whatever is better") | two (rail destinations plus tabs) / one | One: the six-tab strip is the only navigation inside Well Wisher | The audit counted two navigations in different orders and a rail that clips 3 of 8 destinations; the research default is one. |
| How extravagant, on which stack (9 Nov) | GSAP + Lenis + WebGL like the reference sites / CSS, IntersectionObserver and a few hundred bytes of JS | The second, with a performance budget and a load governor | Of the 8 reference sites whose code could be read, 6 have no reduced-motion handling and the cost sits in smooth-scroll libraries, full-screen blur and WebGL loops, none of which is approved; the look is copied, the stack is not. |

### 1b. The 9 Nov bar: decisions that bind this revision

| # | Decision (owner, 9 Nov) | Where it lands |
|---|---|---|
| 1 | `katex` is installed (0.16.21 in `package.json` and `node_modules`); load it lazily | Section 6 is definite: no "needs approval" remains; chunk 3 |
| 2 | Playwright is installed (1.56.1, with Chromium) for layout, hit-area, per-theme screenshot, motion and frame-rate checks | 8.4 and 8.6 are specs, not a manual checklist; chunk 1a builds the harness |
| 3 | One navigation (the panel's default) | 3.2, principle 7, chunk 4 |
| 4 | Phone pairing doorway inside Well Wisher: Setup > Phone, with a pointer in the left column until paired | SU15 and L5 (3.3), O2, 4.1 note |
| 5 | dMAT means the Digital Master Test; it is a practice mode of its own, never a tier of the exam generator | Study > dMAT, card S9 (3.3, 4.15); backend chunk 2b |
| 6 | A question harvester: permitted sources only, downloads to local disk under `data/bank/questions/`, the generator serves from disk and queues new downloads, the UI shows the queue and a source line per question | Backend chunk H; card SU18 (Setup), the Reader's source line, the Practice cell's queue line; sources and terms in `docs/research/question-sources.md` |
| 7 | Taste: a more extravagant look, section themes that are justified, animation for components, transitions and scroll, weight and gravity, a carcass, verification protocols, no slowdown | 5.7 (motion system), 7 (carcass), 8.6 (protocols), 9 (chunks) |

---

## 2. Principles

Each principle is one sentence, tied to a source (`UD` = `docs/research/ui-design.md`; `A` = audit id).

1. Screen one carries the one primary action and "what now"; supporting cards sit on screen two; nothing important lives after about two screenfuls. (UD 1: viewing time above the fold fell 80 % to 57 %, 74 % in the first two screenfuls; A TODAY-11.)
2. At 1366x768 at most 7 `Card` surfaces are visible on screen one (the left column counts 4, the centre at most 3), and no view scrolls past 2 screens. Counted on the wireframes in section 4: Study > Papers 7, Life 7, Career 7, Tree 7. (UD 1; Hub budget; design judge.)
3. One engine owns "next"; every other card displays it and never re-decides it. (A TODAY-01/02.)
4. Exactly one element carries `data-primary` and the saffron fill at any time. (UD 1 NN/g minimalist design; `theme.css` already says so.)
5. Two levels of depth at most: workspace then view, then one overlay; Esc closes the top overlay first. (UD 1 progressive disclosure: three levels leave users lost.)
6. Spacing encodes grouping: 8 px inside a group of cards, 24 px between groups (3x, above the 2x rule of thumb); equal gaps everywhere read as one pile. (UD 1 proximity.)
7. There is one navigation inside Well Wisher, in one order, with names equal to titles. (A IA-1, CAREER-STATUS-01.)
8. Every card lives on exactly one page and a test fails if a card id is mounted twice; overlays count as pages. (Owner rule; A TODAY-05/06.)
9. A placeholder says what is missing and why, shows no number it did not compute, never uses the accent, never animates like a live feature, and has no live-looking button. (UD 5; NN/g empty states; project rule that simulated data is never shown as measured.)
10. The System suggests, you decide: every suggestion dismisses in one tap, nothing returns the same day, a missed day shows a neutral "start again", and no copy is loss-framed; the Crucible wager and guards are opt-in with neutral copy (4.8). (UD 1 Gray 2018, Fogg; owner rule.)
11. The last thing seen each day is a finished-day state, never a nag or an empty shell. (UD 1 peak-end, Kahneman et al. 1993.)
12. Motion comes from one vocabulary of 12 named motions (5.7.3) built from tokens (durations 100 / 160 / 240 / 180 / 300 / 400 ms, three curves, five springs); it enters on ease-out, animates transform and opacity only, nothing runs over 400 ms except the workspace switch (600 ms cap), and no event animates more than 6 layers (8 on a cross-workspace jump), counted per event in 5.7.7. (UD 2 NN/g, Material token source, web.dev.)
13. Reduced motion is one switch at the token layer that turns travel into a fade, with an in-app override that does not depend on the OS flag, and a load governor lowers the effects when the machine is busy (5.7.7, 5.7.8). (UD 2 WCAG 2.3.3, MDN; the audit sandbox reports `reduce`, so motion could not be judged.)
14. Components read only semantic and component tokens; a theme redefines the semantic tier alone. (UD 3 Radix, shadcn, Linear; A components 5.)
15. Contrast is computed, not eyeballed: text 4.5:1, large text and control boundaries 3:1, and a test recomputes every pair for every theme. (UD 3 WCAG 1.4.3 / 1.4.11; measured fails above.)
16. Glass is at most one thin surface (the Back chip's rim or an inspector edge; drawer and sheet headers are flat), never behind text (every label sits on an opaque inner surface), tier `blur` at most, with a flat fallback that is the default and a first-class design. (UD 4 Apple summaries; A TREE-05; contrast computed in the adversary pass.)
17. Visible controls are 36 to 48 px high; a control with a neighbour closer than 44 px is 44 px high for real, because overlapping invisible hit areas steal taps; the dominant 28 px button disappears. (Audit measurement; the 44 px figure is a platform convention, not fetched, UNVERIFIED as a source.)
18. Layout and motion facts happy-dom cannot test (hit area, fold position, horizontal scroll, theme screenshots, reduced motion, frame rate) are Playwright specs run against a sandbox (8.4, 8.6); a spec that cannot run is reported as "not run", never silently skipped. (A tests.md 6.)
19. Text a person must read is at least 12 px, 16/26 and at most 68 characters wide for papers and sheets. (UD 3 Baymard 50 to 75, WCAG 1.4.8 cap 80.)
20. Weight and gravity: heavier things (sheets, the Focus workspace) arrive later and longer, never bouncier; up is arrival and down is departure; overshoot is capped by class (1 % of travel for layout, 3 % functional, 10 % expressive on three things only). (5.7.2.)
21. A workspace colour says where you are and nothing else: it redefines at most 7 tokens, only in the centre, never the provenance colours, and contrast is recomputed for 3 themes x 6 workspaces. (5.7.5.)
22. The end state is the default state: every effect starts from the CSS final state, so a failed script, a missing browser feature or reduced motion shows the finished page. (5.7.6.)

---

## 3. Information architecture

### 3.1 The map

A "page" below is a place a card can live: the left column, a workspace, the proof column, or an overlay. A card lives on exactly one page; a link to an overlay from elsewhere is a launcher, not a second copy.

```
Well Wisher
|-- L   Today (left column, always visible)   Countdown | Now | Classes | Counters | Phone pointer
|-- C1  Study    views: Papers | Plan | Library | dMAT
|-- C2  Tree
|-- C3  Life
|-- C4  Career   views: Pipeline | Certificates | Abroad | Money | Plan
|-- C5  Focus    views: Crucible | Drill
|-- C6  Setup    (index + sections)
|-- R   Proof    (56 px rail, opens as a 320 px panel; pinned at >= 1500 px)
`-- O   Overlays: Date sheet | Phone | Reader | Record | Roadmap | Log minutes | Confirm | Add questions
```

### 3.2 The two navigations, resolved into one

| Today | After |
|---|---|
| Rail lists the 8 Well Wisher destinations (Log, Study, Status sit below its visible bottom at 928 px, M) | Rail has one Well Wisher entry (the app-level switch); it no longer duplicates destinations. Decided 9 Nov: one navigation. Touches `Shell.tsx`; chunk 4 makes the edit and reports it in its gate report. |
| Top nav in a second order, with Focus and Log dimmed as if disabled | One tab strip, 6 workspaces in one order: Study, Tree, Life, Career, Focus, Setup. Nothing dimmed. Alt+1..6 (Ctrl+1..6 stays the app shell's). |
| Page titles differ from labels (Career / Road / Trials); M-numbers collide; 5 embedded pages bring a second H1 | The tab label is the page title; M-numbers are dropped; an embedded section uses a section head, never `MissionHeader`. |
| 15 legacy tab ids map to 8 screens (M, `SCREEN_OF`), several with no inbound UI caller | All 15 stay as aliases so deep links and saved tab choices keep working (table below). |

Serial position (first and last are best recalled): Study first in exam season, Setup last. In normal season the first open lands on Life (A, owner decides; question 9).

Keys: `Shell.tsx:197-199` already binds Ctrl/Cmd+1..6 to the app-level tabs and Ctrl+0 to Core, and `Shell.tsx` has no Alt binding (M, grep), so Well Wisher uses Alt+1..6 and Shell's handler is not touched. A test asserts that Ctrl+n still leaves Well Wisher and Alt+n does not.

Legacy ids to destinations (to be asserted by a test that replaces the one-to-one check in `mission-audit.test.ts`):

| Legacy tab id | Opens |
|---|---|
| `mission` | default workspace (Study in exam season, Life otherwise) with the left column |
| `schedule` | Study > Plan |
| `syllabus` | Tree |
| `quests` | Life |
| `campaign`, `trials` | Career > Pipeline, Career > Abroad |
| `armory` | Career > Money |
| `status`, `proof` | Proof panel over the default workspace |
| `crucible`, `drill` | Focus > Crucible, Focus > Drill |
| `terminal` | Log-minutes sheet (O6) over the default workspace |
| `forge` | Life (Gym card) |
| `interrogation` | Study > Library (explain-back action, A: not inspected by the audit) |
| `calibration` | Setup > Calibration |

### 3.3 Pages: question, primary action, sections in order

Rules for the primary: `PrimaryOwner` evaluates top-down and grants `data-primary` to exactly one element: (1) an open overlay that declares a primary (an overlay marked "none, close only" declares nothing and rule 2 applies beneath its scrim); (2) the active workspace's declared primary if its precondition holds; (3) otherwise the Start button in Now; (4) a pinned side panel (Proof at 1500 px and up) owns none and its action is drawn quiet. In the left column, "All present" takes the fill while a class is pending and Life declares no primary then. A workspace with nothing to do declares "none" on purpose (Setup clean and paired): rule 3 then grants Now's Start, so there is always exactly one fill. A test iterates PAGES x states (clean, dirty, paired, empty bank, class pending) and asserts exactly one `data-primary`.

| Page | Question it answers | Primary action | Sections in order (card ids) |
|---|---|---|---|
| **L Today** (left column) | What do I do now, and is today on track? | **Start** (Now). Evening: **Close the day**. | L1 Countdown (exam season) or Horizon (normal season); L2 Now (one sentence from the director, welcome-back line, Start, +25 / +50 / +90 / Other, "Why this?" fold); L3 Classes today (tap Present / Absent / Cancelled, All present); L4 Counters (6 taps); L5 Phone pointer (a link row, not a card: "Not paired. Set up" until paired, then a quiet "Phone: paired") |
| **C1 Study** | What must I revise for the next paper? | **Practice paper**; **Add questions** (opens O8) when the bank is empty and nothing is queued; in the dMAT view **Start set** | Papers: S1 Paper list (its head line is the exam stage strip: Bank, Paper, Marks, Proficiency, Tomorrow; computed or "not measured"; a strip, not a card), S2 Topics and sheets, S3 Practice. Plan: S4 Today's plan (blocks, contracts, per-row Swap, brief line), S5 Free time. Library: S6 Knowledge of the day, S7 Skill-tree study, S8 Findings (hidden in exam season). dMAT: S9 dMAT practice (figure sequences, equation puzzles, Latin squares; a timed set and a score; generated by our own code from the public rules, never copied from the test) |
| **C2 Tree** | What do I learn next and why? | **Study this node** (the NEXT node when none is selected) | T1 Toolbar (tree switcher with counts, find, zoom, branch chips, "Whole me: soon"), T2 Canvas, T3 Inspector (opaque body), T4 First-visit coach mark |
| **C3 Life** | Did I do the day's small things? | **Log session** (Quest) once a set value or proof is typed; before that Now's Start, or All present while a class is pending | LF1 Add to day (with Logged today: undo / delete / show all), LF4 Quest, LF2 Attendance (margins, no taps); screen two: LF3 This week, LF5 Gym |
| **C4 Career** | What is the next deadline and what ships? | **Do next step** on the soonest deadline | Pipeline: CA1 Up next, CA2 Pipeline, CA3 Campaigns. Certificates: CA4. Abroad: CA5 Trials, CA6 Universities. Money: CA7 War chest (rupees only). Plan: CA8 Ladder, CA9 Goals (read-only, Edit link), CA10 Parking, CA11 Rewards (game currency) |
| **C5 Focus** | Can I start a focused block now? | **Start session** | F1 Crucible (tracks built from the rotation), F2 Drill |
| **C6 Setup** | Does the System know the truth about my semester? | **Save N changes** when dirty, else **Pair phone** (opens O2) when unpaired, else none | Sticky index, then SU1 Rotation, SU2 Subjects and question bank (with a link row "Questions: n in bank [Add questions]" that opens O8), SU3 Goals, SU4 Timetable, SU5 Attendance rule, SU6 Deadlines, SU7 Study time, SU8 About you, SU9 Certificate budget, SU10 How the plan works with you, SU11 Calibration, SU12 Career settings, SU13 Connections (disabled, with reasons), SU14 Backup, SU15 Phone (the doorway: a status line and a link row to O2, not a card; L5 points here until paired), SU16 Dates (link row to O1, not a card), SU17 Appearance (theme, motion, glass, contrast, tab badges), SU18 Question harvester (sources with licence, the download queue, pause, queue a topic) |
| **R Proof** | Is it working? | **Open review** (weekly review) while the panel is an overlay; quiet when pinned | P1 Rank (all requirements, met and unmet), P2 The System suggests (each with a button to the exact place), P3 Stats (6 tiles, each shows its next step when 0), P4 Quest lines, P5 Weekly review (monthly line inside), P6 Building hours, P7 Proof of work, P8 Wins, P9 Recent (grouped by day), P10 What got in the way |
| **O Overlays** | (summoned) | each states its own: O1 Save N changes; O2 Pair a phone while unpaired, else none; O3 Save marks once marks are entered, else none; O4 and O5 none, close only; O6 Log; O7 Confirm; O8 Add question | O1 Date sheet editor (one card per paper), O2 Phone (the existing `PhoneCard` with its server-supplied pairing QR, no QR library and no new route, plus the `/phone/ww` address), O3 Reader (papers and sheets), O4 Record, O5 Roadmap, O6 Log minutes, O7 Confirm dialogs, O8 Add questions (stem, marks, topic, tier) |

Counts (M for today, A for this plan): today Well Wisher has about 35 named `.card` variants, 21 `<details>` and 14 cards on Today alone; this plan has 68 cards: L 4 (L5 is a link row), Study 9 (the stage strip is the head of S1; S9 is the dMAT card), Tree 3 (the coach mark T4 is transient, not a card), Life 5, Career 11, Focus 2, Setup 16 (SU15 and SU16 are link rows; SU18 is the harvester), Proof 10, Overlays 8 (4+9+3+5+11+2+16+10+8 = 68). Screen one never shows more than 7 `Card` surfaces (4 in the left column, at most 3 in the centre, declared per page in the PAGES table); the other 61 are on screen two or behind a view, a tab or an overlay.

State rules (A, owner may change them):
- **Season** (pill in the tab strip, Auto / Exams / Normal): Exams when the nearest dated paper is within `season_window` days (assumed 45, question 8). In Exams, L1 is Countdown, Study opens first, Findings are hidden, "Due soon" looks 3 days ahead. In Normal, L1 is Horizon (next application and first step), Life opens first, "Due soon" looks 7 days ahead. A change crossfades only, reserves its space, and is announced once in an `aria-live` line.
- **Evening** (after 18:00 local or when the last block is done): L2 becomes "Close the day" (what moved, "not done: kept, not lost", tomorrow's first block). Primary: **Close the day** if a `day_closed` event is added to the plan log (A); otherwise the primary is **See tomorrow**, which needs no new event.
- **Empty bank**: the Practice cell says so. If the harvester has this paper queued, it says "Queued: n" and shows no fill (the word "Fetching" appears only while a request is in flight or finished in the last 5 minutes; otherwise "Queued: n, off" or "Queued: n, paused", because the harvester is off by default); otherwise its button becomes **Add questions**. The bank is the questions on disk plus those typed by hand, and a request for a paper with a shortfall queues the missing topics for download (chunk H).

### 3.4 Every current card, to its new home

"Merged" = the content survives inside the target card. "Removed" always says why.

| Current card (page it is on today) | New home | Note |
|---|---|---|
| Today header and pills (Level, n of N done, streak) | removed as a header | The tab names the page. Level goes to P1; "n of N done" becomes a meta line in L2; the streak pill is removed because a loss-framed counter is a dark pattern (UD 1, Gray 2018). |
| WelcomeBackCard (Today) | L2 one sub-line | One source for days away (A TODAY-08). |
| DirectionCard (day's shape, step 1) | L2 | Step 1 is the sentence and the Start target; the other steps open in a "Day shape" popover. |
| ExamBanner "earlier-sitting-first build" strip | L1 | Earlier-sitting papers first, then "+N more"; no repeated "28 d" chip; one "dates tentative" line (A TODAY-03/04). |
| TodaysThree ("Today's 2") | merged into S4 | Contracts sit on the block rows; removes the 3 competing "do this first" (A TODAY-01). |
| Blocks (Library, Social/rest, Evening) | S4 | One card, three groups. |
| Alternatives "Not feeling X?" | S4 per-row Swap | Sits beside what it swaps (A TODAY-07). |
| QuestCards (mounted on Today, Life, Status) | LF4, mounted once | Two mounts removed because duplicates; P4 Quest lines stay (progress, not the log form). |
| Deadlines "Due now" | CA1 | A count badge sits on the Career tab. |
| SessionsCard "Building" | P6 | |
| FloorCard "The floor" | removed | It repeats the Direction rows and its OPEN buttons are the tabs. |
| WeeklyReview | P5 | The monthly review form is merged in as a second line. |
| ProofCard "Proof of work" | P7 | Merged with Log's GitHub proof. |
| More > Wins | P8 | |
| More > Deadlines | removed | Duplicate of CA1. |
| More > Comeback | merged into L2 | |
| More > ParkIdea | CA10 | Also a command-palette verb. |
| More > Brief | S4 header line | One titled line. |
| More > Findings | S8 | Hidden in exam season, filtered to the active subject (A TODAY-09). |
| More > Rituals | LF3 | |
| Calendar fold (embeds the Schedule page) | S5 | Cards only, no second H1, free time = day minus plan blocks (A TODAY-10). |
| Study header | removed | The tab. |
| ExamsCard (filter chips + 16 tiles) | S1 | Tiles become rows of a wrapping list; no sideways scroll (A STUDY-09). |
| PaperTopics (topic chips, marks box, files) | S2 and S3 | The manual marks box goes: one Practice block, one resulting score (A STUDY-08). |
| PaperPanel (generated paper, inline) | S3 header + O3 Reader | The paper opens in the Reader, typeset; the 30-row inline panel is removed. |
| TodayLine (slots, 30' / 60' buttons) | removed | L2 has +25 / +50 / +90. |
| "N risks" details | merged into L1 | |
| StudyNodeCard "Study a node" | S7 | Renamed; follows the Tree node (A STUDY-13). |
| LearnCard "Knowledge of the day" | S6 | |
| Interrogation (explain-back) | S7 action (A) | Alias screen, not inspected by the audit. |
| Tree switcher, branch chips, find, zoom | T1 | Styled on primitives (A TREE-01/02/04). |
| Canvas | T2 | Wrapped, not rewritten. |
| NodePanel | T3 | Opaque body, glass at most a 1 px edge (A TREE-05; 5.6). |
| (new) | T4 First-visit coach mark | One sentence and labelled chips, dismissed once (A TREE-09). Transient, not counted as a card. |
| (new) | O8 Add questions | The one proper door to the bank by hand: today a bank can change only by hand-editing JSON in Setup (SETTINGS-CORE-PHONE-03, -09) and no write route exists (only `GET /api/mission/bank`, M). Needs a route (chunk 2). |
| (new) | S9 dMAT practice | Study > dMAT. Decided 9 Nov: a practice mode of its own, not a tier. Three task kinds from public rules, a timed set, a score; backend chunk 2b, view in chunk 7. Until then a placeholder (section 7). |
| (new) | SU18 Question harvester | Setup. The download queue, the per-source status and licence, pause, queue a topic. The questions it fetches reach papers through the disk bank; each printed question carries its source line. Backend chunk H, card in chunk 12. |
| Life header | removed | The tab. |
| DayCard counter tiles | L4 | The "Went to college" tile is derived from the class list or dropped (A LIFE-06). |
| DayCard add-row and "How points work" | LF1 | Plus a Logged today list with undo / delete / show all (A LIFE-07). |
| ClassesCard | split: L3 (taps) and LF2 (margins, no taps) | Two cards, no overlap. |
| HabitsCard "This week" | LF3 | |
| Career header, UpNext | CA1 | |
| Career tabs 01 to 06 | five views + O4 | Pipeline, Certificates, Abroad, Money, Plan; Record becomes an overlay. |
| Embedded Trials / Universities | CA5 / CA6 | Section heads, no second H1. |
| WarChest + Shop | CA7 (rupees) and CA11 (game currency) | Split (A CAREER-STATUS-07). |
| Ladder, Goals (read-only), Parking, monthly form | CA8, CA9, CA10; monthly form to P5 | |
| Record, Achievements, Season One | O4 | |
| Status header, RankCard | P1 | "Not counted" merged in; one rank vocabulary (question 7). |
| "The System suggests" | P2 | Each line gets a button to its place and a source. |
| Quest lines (Body ON, Money PLANNED) | P4 | |
| StatsCard | P3 | |
| Status's third QuestCards | removed | Duplicate. |
| Focus header + Crucible / Drill switch | F1, F2 | One H1 (the tab). |
| Log: Log time + Learning | O6 and P9 | Merged because they nearly duplicate (A FOCUS-LOG-08). |
| Log: Gym (Forge) | LF5 | |
| Log: What got in the way | P10 | |
| Log: GitHub proof | P7 | |
| Settings drawer: Career, Weekly library rotation | SU12, SU1 | |
| Settings: Exams dates | removed | Same data as the Date sheet (A SETTINGS-CORE-PHONE-02). |
| Settings: Date sheet | O1 (SU16 is a link row) | One card per paper, labelled fields. |
| Settings: Study time, About you, Deadlines, Your subjects, Goals, Timetable, Attendance rule | SU7, SU8, SU6, SU2, SU3, SU4, SU5 | Raw JSON becomes forms; "Advanced: JSON" stays as a closed fold. |
| Settings: Certificate budget, How the plan works, Calibration, Backup | SU9, SU10, SU11, SU14 | |
| Reader drawer | O3 | Portalled to `document.body`. |
| PhoneCard (on Connect and Limbs) | O2 | One card; L5, SU15 and the other sections link to it. |
| Core's "Well Wisher" card | stays on Core, rebuilt from plan state | Retire "Rank 0/10" and the retired directives (A SETTINGS-CORE-PHONE-14/20); chunk 9, needs the owner's OK. |

Card-ownership test (section 8): the set of `data-card` ids mounted in a full render of every page has no duplicates, and its size equals the 68 above.

### 3.5 Entry points and click counts

Counted from app start, which lands on Core, so each count includes the 1 rail click into Well Wisher. "Before" is measured by the audit; "After" is design arithmetic (A), assuming Study is the remembered workspace.

| Task | Before | After |
|---|---|---|
| Edit the date sheet | 3 clicks + about 1,750 px of scroll + an expand; the drawer crashed on a cold open (now fixed) | **2**: rail, L1 "Edit" opens O1; no scroll |
| Take a practice paper | 3 (the working papers sat under one chip) | **2**: rail, Practice paper (next paper preselected); 3 for another paper |
| Add questions to an empty paper | not possible (a skeleton opened) | **3 to the form** (rail, pick the paper, Add questions), then typing |
| Tap a class | 2 + about 0.85 screen of scroll | **2**, no scroll, from any workspace; **1** once inside Well Wisher |
| Tap a topic | 3 | **2** for the next paper; 3 for another |
| Log minutes | 2 (Study shortcut) or 3 with a clipped form | **2**: rail, +25 / +50 / +90; a custom amount 3 |
| Pair the phone | rail + about 2.6 screens + listener switch + Pair, outside Well Wisher | **3**: rail, L5 chip, Pair; **4** whenever the listener is off (the switch is in the same overlay), which includes first use |
| Read a sheet | 2, but no paper has a linked file | **2** when a sheet is linked; 3 through Library |
| Review the week | 1 + about 1.8 screens | **3** at 1366 (rail, proof rail, Open review); **2** at 1500+ (pinned, Open review) |
| Set goals | 2 + about 1,950 px + expand + raw JSON | **3**: rail, Setup, Goals form |
| Start a dMAT set | not possible | **3**: rail, dMAT view, Start set (A) |
| See what the harvester is fetching | not possible | **3**: rail, Setup, Question harvester (A) |
| Close the day (evening) | no such action | **2**: rail, Close the day |
| Change the season | no such control | **2**: rail, Season pill |

Honest reading: the gain on practice paper and topic taps is fewer decisions and no scroll, not fewer clicks; log-minutes is no slower than today's best path.

---

## 4. Wireframes

**How to read them.** Frame: window 1366x768 at 100 % scale. The page area is about 1290 x 682 px (A: 1366 minus the 76 px app rail; 768 minus a 52 px title bar and a 34 px ticker; measure the real window before fixing any y-value). One character is about 12 px wide, one row 22 px, so 31 rows are drawn above the fold. Columns: left 248 px, centre about 970 px, proof rail 56 px. `[####]` is the single saffron fill, `[ ... ]` a quiet button, `( ... )` a chip or segment, `~~ FOLD` marks y = 682 px. Rows are text lines only: card padding (2 x 16 px) and gaps (8 px) are not drawn, so a card of n text rows is about 22n + 32 px tall; blank rows near the fold are budget not used. At 125 % Windows scaling the page area falls to about 1093 x 540 px: the left column then shows 2 class rows and folds Counters into one summary line (stated here, not left to chance), and the Study list collapses to list-over-detail (section 5.4). The audit measured windows 898 to 984 px tall, not 768, so every y-value here is provisional until the owner gives his real window size (question 14).

**What 1920x1080 adds, for every page.** The page area becomes about 1844 x 940 px: the proof column is pinned open (no click), the left column widens to 320 px and lists five class rows and the next two blocks, the Tree inspector docks beside the canvas, and Career > Abroad shows Trials and Universities side by side. 1920 adds breathing room and pins the proof column; it never adds a card or moves one to another region.

**What the wireframes do not show.** Colour and motion. In the real centre each workspace carries its own accent and tint (5.7.5) and the left column, tab strip and overlays keep the chosen theme; the wireframes mark only the one saffron-or-room-colour fill (`[####]`). Motion lives in 5.7: the frame never moves, and only the centre transitions.

### 4.1 The left column in its three states (it is the same four cards on every page)

```
EXAM (default)              NORMAL SEASON               EVENING (after 18:00)
--------------              -------------               ---------------------
COUNTDOWN                   HORIZON                     COUNTDOWN
Next: Subject C N d         Application X in N d        Next: Subject C N d
CIE n End n Other n         first step: update CV       CIE n End n Other n
dates tentative Edit>       goal rung: Build>Ship       dates tentative Edit>
------------------------    ------------------------    ------------------------
NOW                         NOW                         CLOSE THE DAY  n of N
Start Subject C             Start the 25 min skill      Moved today: Subject A
unit 2, 45 min.             step, then the draft.       +n min, n topics.
[##### Start #####]         [##### Start #####]         Not done: kept, not lost
+25  +50  +90  Other        +25  +50  +90  Other        [## Close the day ##]
------------------------    ------------------------    See tomorrow
CLASSES TODAY               CLASSES TODAY               ------------------------
10:00 Subject A PAC         10:00 Subject A PAC         CLASSES TODAY (tappable)
11:00 Subject B PAC         11:00 Subject B PAC         ------------------------
14:00 Subject C PAC         ------------------------    COUNTERS (6)
------------------------    COUNTERS (6)                Phone: not paired >
COUNTERS (6)
Phone: not paired >         Phone: not paired >
```
The Phone pointer (L5) reads "Not paired. Set up >" and opens O2 until a phone is paired; afterwards it is a quiet "Phone: paired" line with no arrow. It never takes the fill (it is a link row), and Setup > Phone (SU15) is the permanent doorway.

Height arithmetic at compact density (A): Countdown 112 + Now 180 (kicker 16, sentence 2 lines 40, Start 40, presets 44 because they sit closer than 44 px to each other and so are real 44 px buttons, gaps and padding 40) + Classes 164 (header 32 + 3 x 44) + Counters 128 + chip 40 + 4 gaps x 8 = 656 of 680 px, 24 px spare. Below 720 px of container height, Classes shows 3 rows and Counters 2 rows of 3; 720 to 900 px, 5 class rows; above 900 px, Now also lists the next two blocks.

### 4.2 Study > Papers (default in exam season)

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | [Papers] | Plan | Library                                                      |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | Bank 0 > Paper - > Marks - > Proficiency - > Tomorrow -  (- = not measured)    |      |
|----------------------|                                                                                |week  |
|NOW                   | PAPERS (n)          SUBJECT C . CIE . tentative . N d                          |(.)   |
|Start Subject C       | All|CIE|End|Other   Marks n/N  . aim n . Covered n of N topics                 |      |
|unit 2, 45 min.       | > Subject C CIE N d UNIT 1                        PRACTICE                     |paper |
|welcome back, N d away|   Subject D CIE N d (Topic a: solid)              Exam | GATE (none yet)       |n/N   |
|[      Start       ]  |   Subject E CIE N d (Topic b: learned)            Bank: 0 questions.           |      |
|+25  +50  +90  Other  |   Subject F End N d UNIT 2                        No CIE questions yet. A      |open> |
|----------------------|   Subject G End N d (Topic c: to do)              CIE paper is N marks;        |      |
|CLASSES TODAY         |   Subject H End N d (Topic d: to do)              its shape is not set.        |      |
|10:00 Subject A P A C |   Subject I Oth N d Sheet: Unit 2  [Read]         [## Add questions ##]        |      |
|11:00 Subject B P A C |   Subject J Oth N d UNIT 3                                                     |      |
|14:00 Subject C P A C |   Subject K Oth N d (Topic e: to do)                                           |      |
|+N more               |   Subject L Oth N d (Topic f: to do)              WEAKEST TOPIC FIRST          |      |
|----------------------|   Subject M End N d No sheet yet for              Topic c. Why?                |      |
|COUNTERS              |   Subject N End N d Unit 3.  [Link a sheet]                                    |      |
|Water n Walk n Read n |   Subject O End N d UNIT 4                        PREVIOUS PAPERS              |      |
|Sleep - Meal n Reel n |   Subject P End N d (Topic g: to do)              None taken yet.              |      |
|----------------------|   Subject Q End N d (Topic h: to do)                                           |      |
|Phone: not paired >   |   Subject R End N d Sheet: Unit 4  [Read]                                      |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Primary on this screen: [Add questions] (the saffron fill; opens the sheet O8). Now's Start is drawn quiet, so there is one saffron fill.
Below the fold: more units. The paper list keeps all papers in a wrapping column: no sideways scroll.
```
Fixes drawn here: the paper list wraps (no sideways scroll), the Marks and Covered values are labelled separately, one "tentative" line replaces a tilde on every row, the stage strip shows "not measured" instead of a guess, and the empty bank turns the button into **Add questions**. The stage strip is the head line of the Papers card, not a card of its own (this is what brings the page to 7 surfaces). A "Paste a past paper" button was drawn in the first version of this plan and removed: nothing builds it (it needs a parser), so it is a Roadmap entry only (section 7). With a bank, the Practice cell reads:
```
PRACTICE (the same cell when a bank exists)
Exam | GATE (none yet)       level: Exam
Bank: n questions for this paper
[#### Practice paper ####]   seed 8045 . N marks
Answer any n of m, per section (opens in the Reader)
After marking, the line below appears:
Saved. Tomorrow's blocks changed: Topic b +20 min, Topic c +10 min
or, when nothing moved: Saved. No change to tomorrow's plan.
Queue line (only when the harvester has work for this paper, worded from its real state): Queued: n topics (off | paused)  or  Fetching: n topics (a request in flight) [Queue]
Each printed question ends with a quiet source line: source: <name>, <licence> (open)
```
With the GATE segment: it shows "GATE: n on disk, n queued" instead of a bare "none yet"; it stays aria-disabled with its reason while n on disk is 0, and a request for GATE never returns exam questions unlabelled.

### 4.3 Study > Plan

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | Papers | [Plan] | Library                                                      |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | TODAY'S PLAN    Exam week: library blocks first.   Why this order? v           |      |
|----------------------|                                                                                |week  |
|NOW                   | LIBRARY   Unit 2, Subject C                           45 min   [Start]  Swap v |(.)   |
|Start Subject C       |           contract: solve 10 questions, log marks                 Done         |      |
|unit 2, 45 min.       | LIBRARY   Unit 1, Subject D                           30 min   (Start)  Swap v |paper |
|welcome back, N d away| SOCIAL    protected rest                              60 min                   |n/N   |
|[###### Start ######] | EVENING   review and log                              30 min                   |      |
|+25  +50  +90  Other  |                                                                                |open> |
|----------------------|                                          [Rebuild today's plan v]  (asks first)|      |
|CLASSES TODAY         |                                                                                |      |
|10:00 Subject A P A C | FREE TIME   no calendar linked: free = day minus plan blocks                   |      |
|11:00 Subject B P A C |             [Link a calendar]                                                  |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Primary on this screen: Now's Start (no paper selected, so Study declares no primary of its own).
```

### 4.4 Study > Library

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | Papers | Plan | [Library]                                                      |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | KNOWLEDGE OF THE DAY                   SKILL-TREE STUDY (follows the Tree node)|      |
|----------------------|                                                                                |week  |
|NOW                   | One concept, two lines.                   Node: Git branching   stage 2 of 5   |(.)   |
|Start Subject C       | (Read it)                                Resource: book ch. 3  (Open) (Start)  |      |
|unit 2, 45 min.       |                                           Chapter checklist: not built yet     |paper |
|welcome back, N d away|                                           Studied [____] min  [__]  (Log)      |n/N   |
|[###### Start ######] |                                                                                |      |
|+25  +50  +90  Other  | FINDINGS   hidden in exam season; in normal season, the active subject only    |open> |
|----------------------|                                                                                |      |
|CLASSES TODAY         | ROADMAP HINT   Three tracks a day need the concept bank. Today there is one.   |      |
|10:00 Subject A P A C |                                                                                |      |
|11:00 Subject B P A C |                                                                                |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Primary on this screen: Now's Start.
```

### 4.5 Tree

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             |  Study   [Tree]   Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | Skills|GitHub|LinkedIn|Content|Money|Second career|Discipline|Whole me: soon   |  E   |
|CIE n End n Other n   | Find a node [__________]   Zoom - +   Fit   Next                (flat bar)     |rank  |
|dates tentative Edit> |                                                                                |      |
|----------------------| +--------------------------------------------+ +------------------------------+|week  |
|NOW                   | |  First time here? Each hexagon is one skill| | INSPECTOR  (opaque body)     ||(.)   |
|Start Subject C       | |  step. The lit path is what to learn next. | | Node: Git branching          ||      |
|unit 2, 45 min.       | |                                       [x]  | | stage 2 of 5                 ||paper |
|welcome back, N d away| |        (o)--(o)--(o)                       | | [## Study this node ##]      ||n/N   |
|[      Start       ]  | |       /           \                        | | Links | Evidence | Proof     ||      |
|+25  +50  +90  Other  | |     (o)           (o)--( NEXT )            | |                              ||open> |
|----------------------| |       \           /                        | | Sharpen: off. Needs one GATE ||      |
|CLASSES TODAY         | |        (o)--(o)--(o)                       | | question; no GATE bank yet.  ||      |
|10:00 Subject A P A C | |                                            | |                              ||      |
|11:00 Subject B P A C | +--------------------------------------------+ +------------------------------+|      |
|14:00 Subject C P A C |  Branches:  Branch A n/N   Branch B n/N   Branch C n/N   (a chip zooms to it)  |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Inspector opens over the canvas at 1366 and docks at >= 1500 px. Toolbar and inspector body are opaque; at most a 1 px glass edge on the inspector (5.6).
```

### 4.6 Life

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             |  Study    Tree   [Life]   Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  |                                                                                |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | ADD TO DAY                            QUEST                                    |      |
|----------------------| (Meal)(Anime)(Movie)(Series)(Reel)    Set 1 [__]  Set 2 [__]  Set 3 [__]       |week  |
|NOW                   | text [__________] min [__] (Add)      proof [__________]                       |(.)   |
|Start Subject C       | How points work (i)                   [##### Log session #####]                |      |
|unit 2, 45 min.       | LOGGED TODAY                                                                   |paper |
|welcome back, N d away| Meal  text   n min       (x) undo     ATTENDANCE (per subject, no taps)        |n/N   |
|[      Start       ]  | Reel  text   will ask tomorrow        Subject A  behind by n classes           |      |
|+25  +50  +90  Other  | show all                              Subject B  margin n classes              |open> |
|----------------------|                                       Rule: N % per subject (confirmed)        |      |
|CLASSES TODAY         |                                       Behind is neutral text and an icon,      |      |
|10:00 Subject A P A C |                                       never red below a minimum sample.        |      |
|11:00 Subject B P A C |                                                                                |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Screen two: THIS WEEK (LF3, three habit rows), GYM (Forge) Today's session [Start]; ROADMAP discipline bank (not built). LF3 moved below the fold to keep screen one at 7 surfaces.
Primary on this screen: [Log session] in Quest once a set value or proof is typed; while a class is pending [All present] in the left column takes the fill; otherwise Now's Start.
```

### 4.7 Career (the other four views follow the same card pattern: a header action, then rows)

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             |  Study    Tree    Life   [Career]   Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | [Pipeline] | Certificates | Abroad | Money | Plan                              |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | UP NEXT   next deadline in N d . N due now               [### Do next step ###]|      |
|----------------------|   Application X   due N d   next: send documents    confidence: approximate    |week  |
|NOW                   |   Application Y   due N d   next: draft statement   confidence: set            |(.)   |
|Start Subject C       |                                                                                |      |
|unit 2, 45 min.       | PIPELINE   N rows . stage stepper . a next action on every row                 |paper |
|welcome back, N d away|   Application X   (Preparing > Drafting > Submitted)   next: send documents    |n/N   |
|[      Start       ]  |   Application Y   (Preparing > Drafting > Submitted)   next: draft statement   |      |
|+25  +50  +90  Other  |   ... N more                                                                   |open> |
|----------------------|                                                                                |      |
|CLASSES TODAY         | CAMPAIGNS   'Finish line' hidden when empty; such a campaign cannot start      |      |
|10:00 Subject A P A C |   Campaign 1   finish line: not set   [Set a finish line]                      |      |
|11:00 Subject B P A C |                                                                                |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Opening Career from anywhere starts on Pipeline. The tab badge is the due-now count.
```

### 4.8 Focus

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             |  Study    Tree    Life    Career   [Focus]   Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | [Crucible] | Drill                                                             |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | CRUCIBLE    Track  (Maths)(ML)(Arch)(...)      built from your rotation        |      |
|----------------------|             Length ( 25 )( 50 )( 75 )( 90 )    selected = outline + wash, 44 px|week  |
|NOW                   |             Optional wager (off) rises with length. 25 minutes minimum.        |(.)   |
|Start Subject C       |                                                                                |      |
|unit 2, 45 min.       |                          (   dial, 120 ticks   )                               |paper |
|welcome back, N d away|                                                                                |n/N   |
|[      Start       ]  |             [########## Start session ##########]                              |      |
|+25  +50  +90  Other  |                                                                                |open> |
|----------------------|             eyes: not live (no hardware) . guards: heartbeat, 20 s distraction |      |
|CLASSES TODAY         |             Minutes go through the one log writer, so they reach Recent.       |      |
|10:00 Subject A P A C |                                                                                |      |
|11:00 Subject B P A C |                                                                                |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Starting a session collapses the left column and the proof rail to a 48 px timer rail; Esc restores them. The wager and the guards are opt-in (off by default), copy is neutral ("session ended", never "failed" or "lost"), and no countdown shows until a session is started.
```

### 4.9 Setup

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             |  Study    Tree    Life    Career    Focus   [Setup]    Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  |                                                                                |  E   |
|CIE n End n Other n   | Save: nothing to save                                                          |rank  |
|dates tentative Edit> |                                                                                |      |
|----------------------| INDEX (sticky)         ROTATION (weekly library)                               |week  |
|NOW                   | > Rotation             Mon [Subject A][Subject B] ... one row per day          |(.)   |
|Start Subject C       |   Dates                                                                        |      |
|unit 2, 45 min.       |   Subjects             DATES                   [Edit the date sheet]           |paper |
|welcome back, N d away|   Goals                One card per paper, labelled fields:                    |n/N   |
|[      Start       ]  |   Timetable            Tentative [x]  Aim for [__] of [__]                     |      |
|+25  +50  +90  Other  |   Attendance rule                                                              |open> |
|----------------------|   Deadlines            PHONE   Not paired. Steps and QR: Phone sheet only.     |      |
|CLASSES TODAY         |   Study time                   [### Pair phone ###] opens Phone sheet (O2)     |      |
|10:00 Subject A P A C |   About you                                                                    |      |
|11:00 Subject B P A C |   Certificate budget                                                           |      |
|14:00 Subject C P A C |   How the plan works   APPEARANCE  Theme (Ash)(Paper)(Indigo)                  |      |
|+N more               |   Calibration                    Motion (Auto)(Full)(Calm) Glass (Auto)(Flat)  |      |
|----------------------|   Career settings                  Contrast (Normal)(High) Tab badges (On)(Off)|      |
|COUNTERS              |   Connections                                                                  |      |
|Water n Walk n Read n |   Phone                (screen two: Subjects and question bank,                |      |
|Sleep - Meal n Reel n |   Appearance            Goals, Timetable as forms; 'Advanced: JSON' closed)    |      |
|----------------------|   Backup                                                                       |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
One save model: a dirty dot per section and a sticky 'Save N changes'; leaving asks. Primary = Save when dirty, else Pair phone while unpaired.
```

### 4.10 Proof (opened from the rail)

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  |  (centre dimmed with a 62 % scrim, not blurred)                                |(open)|
|CIE n End n Other n   |                                                                                |      |
|dates tentative Edit> |                                            +-------------------------------+   |      |
|----------------------|                                            | PROOF                    (pin)|   |      |
|NOW                   |                                            | RANK E                        |   |      |
|Start Subject C       |                                            | [x] hours  [x] proof  [ ] n   |   |      |
|unit 2, 45 min.       |                                            | ring = rank, line = level     |   |      |
|welcome back, N d away|                                            | THE SYSTEM SUGGESTS           |   |      |
|[      Start       ]  |                                            | 1. Log Unit 2   [Go to Study] |   |      |
|+25  +50  +90  Other  |                                            | STATS this week               |   |      |
|----------------------|                                            | 4-week line: not built yet    |   |      |
|CLASSES TODAY         |                                            | QUEST LINES  Body ON  Money - |   |      |
|10:00 Subject A P A C |                                            | WEEK   review ready           |   |      |
|11:00 Subject B P A C |                                            |        [### Open review ###]  |   |      |
|14:00 Subject C P A C |                                            | BUILDING n h . PROOF OF WORK  |   |      |
|+N more               |                                            | WINS . RECENT (by day, total) |   |      |
|----------------------|                                            +-------------------------------+   |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Opaque panel, 320 px, over the dimmed centre. Pinned as a column at >= 1500 px container width. Esc or a click outside closes it. While pinned it owns no primary: Open review is drawn quiet (rule 4, 3.3).
```

### 4.11 Reader (overlay for a generated paper or a sheet)

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | [Papers] | Plan | Library                                                      |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> | +----------------------------------------------------------------------------+ |      |
|----------------------| | READER   Subject C . CIE . N marks . 45 min  . seed 8045     (raw)  (x)    | |week  |
|NOW                   | | Section A. Answer any 5 of 10. 2 marks each.                               | |(.)   |
|Start Subject C       | |  1.  State the condition for stability of  y' = a y.            [2]        | |      |
|unit 2, 45 min.       | |  2.  Find  x^2 z  at  (1, 2)  where  z = e^(-xy).               [2]        | |paper |
|welcome back, N d away| |        (typeset as maths; 'raw' shows the source string)                   | |n/N   |
|[      Start       ]  | | Section B. Answer any 3 of 5. 4 marks each.                                | |      |
|+25  +50  +90  Other  | |  11. Evaluate the integral from 0 to infinity ...               [4]        | |open> |
|----------------------| |        display maths sits on its own centred line                          | |      |
|CLASSES TODAY         | | Marks: [0..2] [0..2] ...   Total n/N      [### Save marks ###]             | |      |
|10:00 Subject A P A C | | Saved. Tomorrow's blocks changed: ...                                      | |      |
|11:00 Subject B P A C | +----------------------------------------------------------------------------+ |      |
|14:00 Subject C P A C |                                                                                |      |
|+N more               |                                                                                |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Opens over the centre only (left column and rail stay). Portalled to document.body, so it works with the page scrolled. J/K move between sections.
```

### 4.12 Roadmap drawer (the one home of everything unbuilt)

```
+----------------------+--------------------------------------------------------------------------------+------+
|COUNTDOWN             | [Study]   Tree    Life    Career    Focus    Setup     Season: Auto v  Roadmap |PROOF |
|Next: Subject C  N d  | [Papers] | Plan | Library                                                      |  E   |
|CIE n End n Other n   |                                                                                |rank  |
|dates tentative Edit> |                             +------------------------------------------------+ |      |
|----------------------|                             | ROADMAP   what is not built, and why      (x)  | |week  |
|NOW                   |                             | Study                                          | |(.)   |
|Start Subject C       |                             |  Sharpen and de-master   needs one GATE-tier   | |      |
|unit 2, 45 min.       |                             |     question solved; no GATE bank yet          | |paper |
|welcome back, N d away|                             |  Parameterised numericals   not built          | |n/N   |
|[      Start       ]  |                             | Life                                           | |      |
|+25  +50  +90  Other  |                             |  Music, Reels v2, Books   not built            | |open> |
|----------------------|                             | Setup                                          | |      |
|CLASSES TODAY         |                             |  College mail and Classroom   waits on a       | |      |
|10:00 Subject A P A C |                             |     one-hour feasibility test                  | |      |
|11:00 Subject B P A C |                             | Generated from plannedFeatures.ts; each row    | |      |
|14:00 Subject C P A C |                             | names what it needs.                           | |      |
|+N more               |                             +------------------------------------------------+ |      |
|----------------------|                                                                                |      |
|COUNTERS              |                                                                                |      |
|Water n Walk n Read n |                                                                                |      |
|Sleep - Meal n Reel n |                                                                                |      |
|----------------------|                                                                                |      |
|Phone: not paired >   |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
|                      |                                                                                |      |
~~ FOLD: y = 682 px (31 rows x 22 px) at 1366x768, 100 % scale; rows below are screen two ~~~~~~~~~~~~
Right-side drawer, 420 px, opaque. One entry point for everything unbuilt; an inline hint appears only where a placeholder changes today's decision.
```

### 4.13 Date sheet, Phone and Add-questions overlays

```
O1 DATE SHEET (centre overlay)                O2 PHONE (centre overlay)
+--------------------------------------+      +-------------------------------------+
| Subject A   End-sem                  |      | Phone   status: Not paired          |
| Date [______]  Tentative [x]         |      | 1 Turn on the phone listener [ ]    |
| Aim for [__] of [__]   May sit [x]   |      | 2 [### Pair a phone ###] (own QR)   |
|--------------------------------------|      | 3 Scan the QR with the phone        |
| Subject B   CIE                      |      | Well Wisher on the phone: /phone/ww |
| Date [______]  Tentative [x]         |      | Taps that work there: topic, +min,  |
| Aim for [__] of [__]                 |      |  class P/A/C, counters.             |
| [### Save 2 changes ###]             |      | Not there yet: papers, formulas.    |
+--------------------------------------+      +-------------------------------------+

O8 ADD QUESTIONS (centre overlay, opened from Study or Setup)
+----------------------------------------------------+
| Subject C   CIE   bank: 0 questions                 |
| Stem   [_______________________________________]    |
| Marks [__]  Topic [v]  Tier (Exam)(GATE)            |
| Answer / key [__________________________________]   |
| Maths is typed as $...$; the Reader typesets it     |
| [### Add question ###]   (Add another)              |
+----------------------------------------------------+
```
The phone's QR is the existing server-supplied pairing QR (`PhoneCard` renders `qr_svg`); no QR library is added. O8 needs a write route (`POST /api/mission/bank/questions`, chunk 2); the primary is **Add question**.

### 4.14 The phone page is the left column alone (390 px wide)

```
+------------------------------+
| TODAY                        |
| COUNTDOWN  Subject C   N d   |
| CIE n . End n . Other n      |
| NOW  Library: Unit 2, 45 min |
| [########## Start ##########]|
| +25      +50      +90  Other |
| CLASSES TODAY                |
| 10:00 Subject A   [P][A][C]  |
| 11:00 Subject B   [P][A][C]  |
| COUNTERS   (3 columns x 2)   |
| [ n ] [ n ] [ n ]            |
| [ n ] [ n ] [ n ]            |
| Desktop only: papers, Tree,  |
| Setup (not on the phone yet) |
+------------------------------+
```
Same view-model, same section order and ids as L1 to L4; every tap target 44 px; one column below 600 px (today `ww.css` has no breakpoint, M). It cannot show papers or formulas yet and says so in its last line instead of hiding it.

### 4.15 Study > dMAT and Setup > Question harvester

```
STUDY > dMAT (S9)                                    SETUP > QUESTION HARVESTER (SU18)
+---------------------------------------------+      +--------------------------------------------------+
| dMAT PRACTICE      Digital Master Test prep |      | QUESTION HARVESTER        questions on disk: n   |
| (Figure sequences)(Equations)(Latin squares)|      | Source                   status      licence     |
| Length (10)(20)(30) tasks    Timer (on)     |      |  Open course material    on          CC BY-NC-SA |
| Level  (1)(2)(3)                            |      |  Open textbooks          on          per book    |
| Last set: n of N correct in t min           |      |  Q&A site API            on (limit)  CC BY-SA    |
| Rules are public; every item is generated   |      |  Official GATE papers    pointer     reserved    |
| by this app. None is copied from the test.  |      |  Textbooks               pointer     reserved    |
| [#### Start set ####]                       |      | QUEUE (n)  Subject C / Topic a    waiting        |
+---------------------------------------------+      |            Subject D / Topic b    fetching 2/5   |
                                                     |            Subject E / Topic c    refused: robots|
                                                     | [ Pause ]  [ Queue a topic ]      last run: date |
                                                     +--------------------------------------------------+
Source line under a printed question:  source: <course or book, licence> (open)     origin: pointer shows "Solve: <reference>"
```
Plain rules for the harvester card: a source row is "on" only after its licence line is recorded; "pointer" means link, topic and marks only, never stored text; a refused fetch shows the reason (robots, rate limit, licence unknown) and is not retried the same day; nothing in the card is shown as fetched that is not on disk.

---

## 5. The design system

Three tiers. Primitives hold raw values and are never referenced by a component. The semantic tier is the only thing a theme redefines. The component tier maps semantic tokens to a component's slots, so one component can be overridden locally without a new theme. All tokens are scoped to `.ww, .ww-portal` (the portal root carries them too, because drawers render on `document.body`) and replace the parallel `--ww-*` set; the rest of JARVIS keeps `styles/tokens.css` untouched, except for the contrast fix noted in 5.2.

### 5.1 Tier 1: primitives (`--p-*`, files `styles/design/primitive.css` (shared app-wide; see 9.0))

| Group | Values |
|---|---|
| Ash (dark neutrals) | ash-0 `#050506`, ash-1 `#0b0c0f`, ash-2 `#111317`, ash-3 `#181b20` |
| Ink alphas (of the theme's ink colour) | 7, 8, 10, 12, 22, 30, 40, 55, 56, 58, 66, 72, 100 % (the steps the three themes use) |
| Saffron | 500 `#ff7a2e`, 400 `#ff9454`, 950 `#1c0b00` |
| Provenance (fixed in every theme) | cyan `#5ce1ff`, amber `#ffb020`, red `#ff453a` |
| Sand (new, for "behind") | `#d6b98c` |
| Space | 4, 8, 12, 16, 24, 32, 48 (retires 939 px literals and the off-scale 20 and 28) |
| Radius | 6, 10, 14, 999 (retires 16 distinct radii and the 22 / 18 / 16 card split) |
| Type | sizes 12, 13, 14, 16, 18, 24, 40; weights 400, 500, 600; line heights 16, 18, 20, 24, 26, 32, 40 |
| Duration | 100, 120, 160, 180, 200, 240, 300, 360, 400 ms (named in 5.7.1; nothing longer, the 640 ms celebrate is gone) |
| Easing | standard `(0.2, 0, 0, 1)`; enter `(0.05, 0.7, 0.1, 1)`; exit `(0.3, 0, 0.8, 0.15)` (Material token source, UD 2); plus three bounded back curves for the three expressive uses (5.7.1) |
| Springs (stiffness / damping / mass) | press 400 / 30 / 1 (ratio 0.75); settle 260 / 28 / 1 (0.87); calm 170 / 22 / 1 (0.84; today's `useSpring` default); heavy 288 / 40 / 2 (0.83); lively 120 / 14 / 1 (0.64, celebration only). Table and weights in 5.7.1 |

Damping ratio = friction / (2 sqrt(stiffness x mass)), mass 1 (arithmetic on the documented preset form, UD 2). In use: JS `useSpring` only for numbers shown as text; every other spring is a CSS `linear()` curve (5.7.1), because `useSpring` runs a React state update on every frame (`lib/motion.tsx:19-47`). The curves and the JS constants are emitted from the same k, c, m by `scripts/gen-springs.mjs`, so they cannot drift.

### 5.2 Tier 2: semantic (the theme tier)

Values for the default theme **Saffron Ash** (dark), then the two alternates. Ratios were computed for this plan with the WCAG relative-luminance formula (inputs and corrections in `docs/research/ui-design.md`, 2026-11-09 plan section), on the surface named; where a token is a translucent ink, the alpha is blended over that surface first. The chunk 1 contrast test recomputes them from the token files.

| Token | Role | Saffron Ash (default) | Vibhuti Paper (light) | Indigo Night (dark) |
|---|---|---|---|---|
| `--surface-0` | window | `#050506` | `#f4f1ea` | `#07080f` |
| `--surface-1` | columns, cards | `#0b0c0f` | `#fbf9f4` | `#0c0e1a` |
| `--surface-2` | raised, inputs, hover | `#111317` | `#ebe7dd` | `#0f1220` |
| `--surface-3` | overlays, popovers (opaque) | `#181b20` | `#ffffff` | `#161a2c` |
| `--ink-1` | text | `#f5f6f8` | `#1a1814` | `#eef0ff` |
| `--ink-2` | secondary text | ink 66 % | ink 72 % | ink 66 % |
| `--ink-3` | quiet text (passes body) | ink 56 % | ink 66 % | ink 58 % |
| `--ink-off` | decorative glyphs only; **never text** | ink 22 % | ink 30 % | ink 22 % |
| `--ink-disabled` | text of a disabled control, always paired with a lock icon and the printed reason | ink 50 % (M) | ink 62 % (M) | ink 52 % (M) |
| `--line` | decorative hairline (no contrast requirement) | ink 7 % | ink 10 % | ink 8 % |
| `--line-ui` | control boundaries | ink 40 % | ink 55 % | ink 40 % |
| `--accent` | primary fill, active-tab underline, accent text | `#ff7a2e` | `#a63a06` | `#9aa0ff` |
| `--accent-hi` | hover, focus ring | `#ff9454` | `#c24a0c` (hover only, never text) | `#aab0ff` |
| `--on-accent` | the only text colour on an accent fill | `#1c0b00` | `#ffffff` | `#0b0d24` |
| `--accent-wash` | accent-tinted surface (ink text only) | accent 14 % | accent 12 % | accent 14 % |
| `--selected-bg` | every selected chip, segment, row (**not accent**) | ink 12 % over surface-2 | ink 8 % | ink 12 % |
| `--selected-ink` | text on a selected surface | `--ink-1` | `--ink-1` | `--ink-1` |
| `--focus-ring` | 2 px ring, offset 2 | `--accent-hi` | `#a63a06` | `--accent-hi` |
| `--live`, `--sim`, `--fault` | provenance, same meaning in every theme | `#5ce1ff`, `#ffb020`, `#ff453a` | `#0a6a85`, `#8a5a00`, `#b3261e` | as Ash |
| `--behind` | attendance below the line; neutral, never red | `#d6b98c` | `#7a5c25` | `#d6b98c` |
| `--scrim` | behind overlays | black 62 % | black 45 % | black 62 % |
| `--glass-bg`, `--glass-edge` | one thin surface only, never behind text (5.6) | dark tint 58 % | forced flat | dark blue tint 58 % |

Saffron is identity, never data; provenance colours keep one meaning across themes (cyan measured, amber inferred, red fault). A theme is about 25 lines and redefines these names only.

**Computed contrast, minimum over the four surfaces of each theme** (text needs 4.5, large text and non-text 3):

| Pair | Ash | Paper | Indigo | Rule |
|---|---|---|---|---|
| ink-1 on surface | 15.96 | 14.36 | 15.22 | 4.5 |
| ink-2 on surface | 7.59 | 6.30 | 7.23 | 4.5 |
| ink-3 on surface | 5.82 | 5.23 | 5.87 | 4.5 |
| `--line-ui` on surface | 3.50 | 3.72 | 3.45 | 3 (WCAG 1.4.11) |
| accent as text on surface-0..3 | 6.64 to 7.83 | 5.27 to 6.50 | 7.26 to 8.42 | 4.5 |
| `--on-accent` on `--accent` | 7.36 | 6.50 | 8.06 | 4.5 |
| `--live` / `--sim` / `--fault` on surface | 11.24 / 9.44 / 5.07 | 4.98 / 4.80 / 5.29 | 11.22 / 9.43 / 5.06 | 4.5 |
| `--behind` on surface | 9.19 | 5.02 | 9.18 | 4.5 |
| `--focus-ring` on surface | 7.90 | 5.27 | 8.51 | 3 |
| `--ink-1` on `--selected-bg` | 12.58 | 12.22 | 12.07 | 4.5 |
| `--ink-3` on `--selected-bg` | 5.08 | 4.83 | 5.15 | 4.5 |
| `--ink-disabled` on surface | 4.86 (M, 50 %; the floor is 48 %) | 4.58 (M, 62 %; 60 % is 4.31 and fails) | 4.72 (M, 50 %; 52 % is 4.97; 48 % is 4.46 and fails) | 4.5; the test picks the lowest alpha that passes on all four surfaces |

Three rules came out of the computation and are enforced by the contrast test (section 8): **accent-coloured text is never placed on `--accent-wash`** (Paper: 4.42, fails; selected states use `--selected-ink` instead), `--ink-off` is never a text colour (1.79 to 1.98), and `--accent-hi` is never a text colour either (3.97:1 on Paper surface-2, adversary recompute). Disabled text uses `--ink-disabled`; the cue that a control is disabled is its lock icon and printed reason, not low contrast.

**Fixes to the measured failures:**

| Defect (M) | Was | Now |
|---|---|---|
| `--ink-3` as body text | 3.77:1 (fails 4.5) | 56 % alpha: 5.82 to 6.05:1 on every Ash surface; the AA floor is about 48 % alpha (4.61:1 on surface-3) |
| `--ink-4` used for the 12 px "minor" tab | 1.79:1 | renamed `--ink-off`, barred from text by a test; Focus is a normal tab |
| White on a saffron fill | 2.60:1 | `--on-accent` `#1c0b00`: 7.36:1 |
| Control borders (hairline) | white 7 %, about 1.16:1 on surface-1 | `--line-ui` 40 %: 3.50:1 or more |
| Selected chip: white fill with near-black ink (unreadable child) | per-child failure | `--selected-bg` wash with `--selected-ink`; a test computes every child |
| `--line` undefined (A STUDY-12) | border fell back to the text colour | defined |
| Focus ring | cyan against a saffron identity | `--accent-hi` |
| `.icon-btn:hover` in fault red for a neutral action | red | `--selected-bg` |
| Attendance "behind" shown red | red on a shame-free page (A LIFE-01) | `--behind` plus a hollow icon and the words "behind by n"; red only after a real breach with a minimum sample |

Where the repo's own `styles/tokens.css` must change (shared with the rest of JARVIS): `--ink-3` alpha 0.42 to 0.56 and `--ink-4` use restricted; this is the only change to `tokens.css` and it is a contrast fix (chunk 1a, owner's OK because Core reads it; the acceptance includes a before and after screenshot of Core, since every Core caption dims or brightens). The other edits outside `ww/` are the glass hook and the scoped page transition, listed in chunk 1a.

**Workspace layer (a second, centre-scoped tier).** Each workspace may redefine 7 semantic tokens, only inside the centre (`.ww-centre[data-ws="..."]`); the left column, tab strip, rail and overlays keep the chosen theme. The values, the reason for each and the computed contrast of all 18 combinations (3 themes x 6 workspaces, tint 4 %) are in 5.7.5. `tokens.test.ts` loops over the 18 combinations and recomputes them from the token files.

**High-contrast knob** (a variable, not a fourth theme): `data-contrast="high"` raises `--ink-3` to 72 % and `--line-ui` to 60 % (computed: ink-3 8.78 Ash, 8.39 Indigo, 6.30 Paper; line 6.45, 6.19, 4.31). This is Linear's "contrast" input (UD 3).

### 5.3 Tier 3: component tokens (`ww/design/component.css`)

Default to semantic tokens; override locally without a new theme.

```css
--card-bg: var(--surface-1);   --card-pad: var(--pad-card);   --card-radius: var(--radius-card);
--btn-primary-bg: var(--accent);  --btn-primary-ink: var(--on-accent);
--btn-quiet-bg: transparent;     --btn-quiet-ring: var(--line-ui);
--seg-selected-bg: var(--selected-bg);  --field-h: 40px;  --field-ring: var(--line-ui);
--tab-underline: var(--accent);  --col-l: 248px;  --col-r: 56px;  --hit: 44px;
```
Semantic scales used by components: `--gap-card` 8, `--gap-group` 24, `--pad-card` 12 / 16 / 20 (compact / regular / roomy), `--row-h` 40 / 44 / 48, `--radius-chip` 6, `--radius-control` 10, `--radius-card` 14, z-index `--z-nav` 20, `--z-scrim` 40, `--z-sheet` 50, `--z-toast` 60 (retires raw 1, 2, 3, 5, 60). No component CSS may reference a primitive or a literal colour (lint test, section 8).

### 5.4 Type, spacing, density

Fonts unchanged: Inter (interface), Anton (the display step only), Doto (numbers that change, through `Stat`), Geist Mono (identifiers, units, timestamps; never sentence-length lines).

| Role | Size / line | Weight | Used for |
|---|---|---|---|
| label | 12 / 16, mono caps +0.08em, `--ink-2` | 500 | kickers (`NOW`, `PRACTICE`), badges |
| small | 13 / 18 | 400 | meta, helper, table cells |
| body | 14 / 20 | 400 | default |
| read | 16 / 26, 68 ch max | 400 | papers, sheets, long text |
| title | 18 / 24 | 600 | card title (a real `h2` / `h3`) |
| heading | 24 / 32 | 600 | drawer and overlay titles |
| display | 40 / 40, Anton | 400 | big numbers on a page (rare) |

Seven steps replace 17 sizes (M). Floor 12 px for anything read; under 13 px use `--ink-2` or brighter.

Density follows the **container** (a `ResizeObserver` on the root, not the viewport), so the 76 px rail is already subtracted:

| Container width | Density | Left column | Centre | Proof |
|---|---|---|---|---|
| < 1000 px | narrow | becomes the page: L1 to L4 stacked, 44 px taps | tabs move to a bottom bar; Study shows list over detail | opens as a full sheet |
| 1000 to 1499 px (1366 lands at 1290) | compact: pad 12, row 40 | 248 px | flexible, minimum 700 px | 56 px rail, 320 px panel over the centre |
| 1500 to 1799 px | regular: pad 16, row 44 | 280 px | flexible | pinned, 320 px |
| 1800 px and up (1920 lands at 1844) | roomy: pad 20, row 48 | 320 px | max 1120 px, centred | pinned, 360 px |

Spacing: 8 px between cards, 24 px between groups; radius 6 chip, 10 control, 14 card, 999 pill. Control heights: sm 36, md 40, lg 48. A control with any neighbour closer than 44 px (TapGroup, the +25 / +50 / +90 presets, class taps, counter tiles) is 44 px high for real; an invisible 44 px `::after` hit area is allowed only on an isolated control with at least 8 px clear space beyond it, because overlapping hit areas steal taps (36 + 8 gap is less than 44).

### 5.5 Primitives (`app/ui/src/ww/kit/`; pages import from the kit, never from each other)

| Primitive | Props | States | Replaces |
|---|---|---|---|
| `Frame` | `left`, `centre`, `right`, `density` (auto) | compact / regular / roomy, focus-mode collapse, rail-open | `MissionRoot` layout, `MissionNav`, the rail's Well Wisher entries |
| `WorkspaceTabs` | `tabs[{id,label,badge,dirty}]`, `active` | active (accent underline on transform), badge (a plain number in ink, never a coloured or animated dot; Appearance > Tab badges hides it), dirty mark (static, neutral), roving tabindex, Alt+1..6; the strip is opaque `--surface-3` at 96 % | `MISSION_TABS` nav, `tb-btn` |
| `Card`, `CardHead` | `title`, `kicker`, `action`, `tone`, `data-card` (required by type) | default, raised, quiet, loading (skeleton), error (boundary with retry) | `.card` and its 35 variants, `tp-sec`, `set-sec`, `c-sec`, `road-panel`, `rm-box`, `explain-box`, `ex-block` |
| `Section` | `id`, `hint`, `primary?` | carries `data-section`, `data-hint`, `data-primary`; registers order | nothing today (makes placement testable) |
| `PrimaryOwner` | context | exactly one `data-primary` | ad hoc `.btn.primary` placement |
| `Fold` | `title`, `open`, `lazy` | closed, open, focus; mounts nothing until opened when `lazy`; no height animation | `details.card > summary`, `fold-head`, `contract-head` (21 `<details>`) |
| `Button` | `size` sm / md / lg, `tone` primary / quiet / danger, `loading`, `disabledReason` | rest, hover, press (1 px, 100 ms), focus-visible, loading, **disabled-with-reason** (stays focusable, `aria-disabled`, text in `--ink-disabled` with a lock icon, reason printed beside it) | 28 class strings, `.btn`, `.tb-btn`, `.tap-btn`, `.link-btn` |
| `IconButton` | `label` (required by type), `size` | as Button; hover is neutral, never fault red | `.icon-btn`, `reader-x` |
| `Segmented` | `options`, `value`, `variant` view / choice / compact | selected (wash + ink, not accent), disabled option with reason | 3 `.seg` definitions, `life-kinds`, `ex-chips` |
| `Chip` | `tone`, `selected`, `count` | rest, selected, cycle (topic: to do, learned, solid) | `chip`, `pill`, `life-chip`, `track-tag` |
| `Field` | `label`, `hint`, `error`, `unit`, `kind` | rest, focus, error, disabled; label above; 40 px | `field`, `field sm`, `input sm`, `area`, 8 height overrides |
| `Row` | `lead`, `title`, `meta`, `action`, `state` | default, done, behind (sand), overdue | deadline, contract, class, log and link rows |
| `Stat` | `label`, `value`, `unit`, `next?` | uses `Ticker`; a 0 shows the single next step; empty shows "not measured yet" | `.status-stats`, `.stat-how` (10 px) |
| `Meter`, `Spark` | `value` 0..1, `points[]` | `scaleX` fill with a visible zero; Spark with no data shows a dashed baseline and "no history" | the invisible `.tp-meter-bar` (height 0), `.ex-bar` |
| `StageStrip` | `stages[{id,label,count,state}]` | done / current / todo / unknown ("not measured") | new; used on Study > Papers only |
| `TapGroup` | `options`, `value`, `onTap` | one active (a filled pressed state, never an inset-shadow stripe), same tap clears, 44 px real height, optimistic with a rollback toast | class taps, counter tiles, `.cls-taps` |
| `MasterDetail` | `list`, `detail`, `selectedId` | remembers selection per workspace; collapses to list-over-detail under 720 px | Exams strip + PaperTopics, Tree switcher |
| `EmptyState` | `title`, `body`, `action?`, `reason?` | shown after loading finishes | about 20 `small muted` strings, the "Loading" div |
| `ComingCard` | `featureId` (from the registry) | static; dashed outline in `--line-ui` (the outline is the only cue that it is not live, so it must clear 3:1); never accent, never animated, no live button | `pill.planned` (unused) |
| `Drawer`, `Sheet` | `place`, `titleId`, `onClose` | portal to `document.body`, focus trap, Esc, scrim 62 %, `inert` background, exit through `Presence`, header flat and opaque (its title is text and the body scrolls under it, so no glass, 5.6) | Settings drawer, Reader drawer, `tb-menu` (3 `role=dialog` copies) |
| `Popover` | `anchor`, `placement` | open 160 ms, closes on Esc and outside click | Day shape, Log minutes (small) |
| `Banner` | `tone`, `action?` | the single "dates tentative" line | per-row `~` marks |
| `Toast` | `tone`, `message`, `action?` | stacked, `aria-live=polite`, exit animation; an `action` gives Undo | `useStore().toast` presentation |
| `CoachMark` | `id`, `text` | shown once per id, dismiss in one tap, never returns the same session | nothing today (Tree first visit) |
| `MathText` | `children` (plain or TeX), `display?` | engine ready, fallback, error shows the source | `math()` in the Reader, raw `{q.text}` |
| `Reveal` | `index` | the `arrive` motion (5.7.3 #1): one-shot IntersectionObserver, none below the fold; cap 3 at a switch, 6 in a scrolled group | `.rise`, `.pop` used ad hoc |
| `HoldButton` | `label`, `onConfirm`, `reason?` | rest, holding (ring fill `scaleX` 400 ms, linear), released early (reverse 120 ms, nothing happens), done (`press` spring, then the action); Enter or Space opens a plain Confirm; reduced motion: Confirm only | destructive resets, end session, delete (the `hold` motion, 5.7.3 #10) |
| `PinHeader` | `title` | fixed 56 px; rest, stuck (hairline); title scale 1 to 0.92 over 96 px where `animation-timeline` exists, an IO sentinel otherwise | Reader, Study and Career heads (the `pin` motion, #11) |
| `CursorLabel` | `data-cursor` on a target | a label companion at most 24 px tall, `transform` only, one pointermove handler on rAF; absent on touch, under calm and when the governor says low | none (Tree nodes, drag handles, hold buttons) |
| `Skeleton` | `lines` | static block in `--surface-2`, shown only if data has not arrived after 200 ms, removed with a 100 ms opacity step; never a shimmer | the "Loading" div |
| `LockChip` | `id`, `reason` | on first show in a session plays one `arrive` and writes one polite `aria-live` line, "Locked: <reason>"; silent afterwards (`sessionStorage`, try/catch) | `disabledReason` groups, Connections, Sharpen |

`Segmented`, `Chip`, `Button` and `Field` go first in the migration because 28 button strings and 8 field heights are the visible "shrunk borders" complaint.

Ownership: chunk 1b owns every primitive in this table except `MathText` (chunk 3) and the frame ones (`Frame`, `WorkspaceTabs`, `BackChip`, `workspaceMemory` and the overlay registry `openOverlay(id)`, chunk 4); `Section` and `PrimaryOwner` are chunk 1b. `Card` takes `data-card` as a required prop by type, and in development a check throws if two mounted cards share an id.

### 5.6 Glass rules

- **Where.** At most one glass surface on screen, and only a thin one: the Back chip (rim only, its label on an opaque inner pill) or a 1 px edge on the Tree inspector. A `Drawer` / `Sheet` header is flat: its title is text, ink-1 on the 58 % tint is 4.45:1 over white and 8.36:1 over lit saffron (recomputed 9 Nov), and its body scrolls under it, so a blur would repaint on every scroll frame (`sections.css`). Forbidden: cards, columns, the proof panel, popover bodies, the Reader body, the inspector body, anything holding text to read, and the workspace tab strip (opaque `--surface-3` at 96 %: a translucent sticky strip over scrolling text is the collision the audit recorded as CAREER-STATUS-12, and `sections.css` already records that a full-height backdrop-filter repaints on every scroll).
- **Why text never sits on glass (adversary recompute).** Ink on a 58 % dark tint over the backdrop: ink-1 is 8.32:1 but ink-3 is 3.78:1 over a lit saffron node; over white, ink-1 is 4.44 and ink-3 2.53. Body text on glass fails 4.5:1 on colours the Tree itself draws, so the inspector's text sits on an opaque inner surface.
- **Cost.** The inspector floats over the Tree's SVG, whose group transform is rewritten on every pan and zoom frame (`Tree.tsx:89`; it is SVG, not a canvas), and `liquidGlass.tsx` recomputes the blur on every changed frame, so an inspector body in glass would be the slowest case at the narrowest width. It docks (opaque) at 1500 px and up; at 1366 it floats with an opaque body.
- No glass on glass, no animated blur radius, glass renders flat during a workspace transition and while a Tree pan, glide or zoom runs (the SVG under it repaints every frame).
- **Tier.** The ceiling is `blur`. `refract` (`feDisplacementMap` through `backdrop-filter`: no owner for its visual comparison, cost unmeasured) is a measured opt-in only: Appearance > Glass > Refract becomes selectable after the 20-switch sampler (5.8.5, 8.6) reports a 5th-percentile frame rate of at least 55 fps with glass on at the real window size, and it falls back to `blur` the moment a later sample drops under 50 (question 17). `useGlassTier` today starts at `refract` and probes only after 1.5 s plus 2 s (`liquidGlass.tsx:95-103`), then keeps an average-fps verdict forever. Chunk 1a adds, additively, a `{ ceiling: 'blur', start: 'flat' }` option so first paint is flat until measured, and a 5th-percentile measure with a 55 fps floor.
- The build strips CSS `backdrop-filter`, so glass is driven inline through the `useGlassTier` pattern; the lint test bans `backdrop-filter` in `ww` CSS.
- **Flat fallback is the default and a first-class design**: `--surface-3` at 96 % plus `--line`. It applies until the tier is measured, when the tier is `flat`, when the OS asks for reduced transparency, when Appearance > Glass is Flat, when the 5th-percentile frame rate is under 55 fps, and always in the light theme.

### 5.7 Motion system

Answer to "much more extravagant, with weight and gravity, and no slowdown": a small vocabulary of 12 named motions on a fixed token skeleton, drawn from the 12 reference sites the owner shared. The expensive-feeling sites are mostly `transform` and `opacity` on a tight set of curves (S: Goodfight, monopo, Super Evil Genius); the cost sits in smooth-scroll libraries, GSAP, full-screen blur, WebGL loops and video loaders, none of which is approved or used here. Of the 8 sites whose code could be read, 6 have no `prefers-reduced-motion` handling and 2 gate it; 4 sites could not be read at all. So the look is copied, the stack is not, and reduced motion is a first-class path.

Labels: (M) computed by script (closed-form damped spring, sampled curves, WCAG luminance) or measured; (S) read in a study of a reference site; (A) assumption to be measured when built. No browser was run for this section, so every frame-rate number is a target, not a result.

#### 5.7.1 Tokens

All in `styles/design/primitive.css` (shared app-wide; see 9.0); a component never writes a literal duration or curve.

| Token | ms | Used for |
|---|---|---|
| `--dur-feedback` | 100 | press, toggle, tap confirmation |
| `--dur-state` | 160 | hover, selected change, chip cycle, focus ring |
| `--dur-enter` | 240 x tempo | card enter, popover open, row insert |
| `--dur-exit` | 180 x tempo | everything leaving (shorter than entering) |
| `--dur-sheet-in` / `--dur-sheet-out` | 300 / 200 | drawers, sheets |
| `--dur-switch-out` / `--dur-switch-in` | 200 / 360 | workspace switch |
| `--dur-travel` | 400 | a shared element moving (list row to header) |
| `--dur-hold` | 400 | press-and-hold fill |
| `--dur-celebrate` | 400 | marks saved, day closed; at most once per surface per session |
| `--stagger` | 40 per item | card groups (caps in #1) |

Hard ceiling: nothing animates longer than 400 ms except the workspace switch envelope (600 ms cap, 520 ms planned, 5.7.4). Tempo (`--tempo`, 0.8 to 1.25 per workspace) scales only enter, exit and stagger, never feedback, switch, travel or hold.

| Curve token | Cubic-bezier | Peak (M) | Use |
|---|---|---|---|
| `--ease-standard` | (0.2, 0, 0, 1) | 1.000 | state changes |
| `--ease-enter` | (0.05, 0.7, 0.1, 1) | 1.000 | everything arriving |
| `--ease-exit` | (0.3, 0, 0.8, 0.15) | 1.000 | everything leaving |
| `--ease-back-soft` | (0.34, 1.3, 0.64, 1) | 1.030 (3.0 % overshoot) | functional pop: chip cycle, count confirm |
| `--ease-back` | (0.34, 1.56, 0.64, 1) | 1.098 (9.8 %) | expressive only: the page title, the one `data-primary` when it changes owner inside a workspace, celebrate |
| `--ease-in-back` | (0.36, 0, 0.66, -0.56) | -0.098 (anticipation) | a title leaving, nothing else |

One house-curve rule (S: monopo uses one easeOutQuart almost everywhere and that is most of its "expensive" feel): components pick a token; a lint bans any other `cubic-bezier(` and any `transition: all`.

Springs (omega0 = sqrt(k/m), zeta = c / (2 sqrt(k m)), overshoot = exp(-pi zeta / sqrt(1 - zeta^2)), settle = time to stay within 2 % = 4 / (zeta omega0)); all (M):

| Spring | k / c / m | zeta | Overshoot | Settle 2 % | Weight class and use |
|---|---|---|---|---|---|
| `press` | 400 / 30 / 1 | 0.750 | 2.84 % | 267 ms | light: button, chip, tap rebound |
| `settle` | 260 / 28 / 1 | 0.868 | 0.41 % | 286 ms | light-medium: numbers, gauges |
| `calm` | 170 / 22 / 1 | 0.844 | 0.72 % | 364 ms | medium: tab indicator, fills, cards, zoom |
| `heavy` | 288 / 40 / 2 | 0.833 | 0.88 % | 400 ms | heavy: sheets, paper, the Focus workspace, the rubber-band return |
| `lively` | 120 / 14 / 1 | 0.639 | 7.35 % | 571 ms, cut at 400 ms (residual under 5 %) | celebrate only |

The existing `--spring-calm` (`styles/motion.css:16`) was sampled at zeta 0.75, not 0.84, so it and `--spring` are regenerated from this table by `scripts/gen-springs.mjs`. Test `spring-curves.test.ts`: every emitted `linear()` sample is within 0.5 % of the closed form x(t) = 1 - e^(-zeta omega0 t) (cos(wd t) + (zeta / sqrt(1 - zeta^2)) sin(wd t)).

#### 5.7.2 Weight and gravity, made concrete

1. Mass classes. Light things (chip, button, counter) use `press` or `settle` and settle in under 290 ms. Medium things (tab indicator, card, fill) use `calm`, 364 ms. Heavy things (sheet, paper, the Focus workspace, anything wider than 320 px) use `heavy` (m = 2): a slower start, the same low overshoot, 400 ms. Heavier means a later and longer arrival, never a bouncier one.
2. Overshoot limits by class: layout and position at most 1 % of travel (0.12 px on a 12 px move); functional scale pop at most 3 % (`--ease-back-soft`, `press`); expressive at most 10 % (`--ease-back`, `lively`), allowed on exactly three things: a page title entering, the single `data-primary` element when `PrimaryOwner` hands it over inside a workspace (never during a switch, where it would be a 9th animated layer), and celebrate (at most once per surface per session).
3. Gravity as asymmetry. Entering things decelerate (ease-out) and rise into place from 12 px below; leaving things accelerate (ease-in) and fall 8 px, for 180 ms against 240. Up is arrival and down is departure on every card, popover and toast. Side sheets are the one exception (they travel on x).
4. Inertia on drag. Release velocity is sampled over the last 80 ms; the glide decays as v(t) = v0 e^(-t / tau) with tau = 110 ms, throw velocity capped at 3 px/ms, at rest when |v| < 0.05 px/ms: from the cap that is tau ln(60) = 450 ms worst case, a typical throw (2 px/ms) 406 ms and 220 px of glide (M). Past a bound the drag is resisted (displacement x 0.35) and returns on `heavy`. Nothing glides on a keyboard or reduced-motion path.
5. Settle times are budgets: a Playwright spec (8.6) measures the time from the last input to the last changed frame for each motion and fails above its table value plus 50 ms.

#### 5.7.3 The twelve motions

Distance is transform only. Stagger offsets are per item.

| # | Motion | Primitive | Values | Reference |
|---|---|---|---|---|
| 1 | `arrive` | Card enter (`Reveal`, `Card`) | opacity 0 to 1, translateY 12 px to 0, 240 ms x tempo, `--ease-enter`; stagger 40 ms, cap 3 items at a workspace switch, the page title counting as one of them (120 ms total), cap 6 for a scroll-revealed group (240 ms total); one-shot per element, only in the viewport (IntersectionObserver, threshold 0.25, unobserved after firing) | Goodfight and Fitsole one-shot reveal |
| 2 | `switch` | Workspace switch | old centre: opacity to 0, translateY 8 px, 200 ms `--ease-exit`; new centre: opacity 0 to 1, translateY 12 px to 0, 360 ms `--ease-enter`, from t = 120 ms; master pane +0, detail pane +40 ms; first 3 cards stagger 40 ms from t = 160; the tab indicator slides on `calm` from t = 0 (translateX + scaleX on a 2 px bar). Envelope 520 ms planned, 600 ms cap. A second switch within 600 ms takes the fast path: 160 ms opacity only, no stagger | Cyd Stumpel root-group choreography cut from 1.3 s to 0.5 s; monopo route change |
| 3 | `sheet` | Overlay (`Drawer`, `Sheet`, `Popover`) | sheet: translateX 100 % to 0, 300 ms `--ease-enter`, out 200 ms `--ease-exit`; scrim 0 to 0.62 over 240 ms; weight `heavy`, no layout overshoot; popover: opacity + translateY 8 px, 160 ms in, 120 ms out; the parked state is `inert` + `visibility: hidden` after exit (never only `pointer-events: none`); drag to dismiss: 5.7.6 | GlobeKit slide-out panels; Goodfight corner tray and its `inert` gap |
| 4 | `tap` | Chip tap, button press, `TapGroup` | press: translateY 1 px + scale 0.985 in 100 ms, release rebound on `press` (2.84 %, 267 ms); chip cycle (to do, learned, solid): `--selected-bg` cross-fade 160 ms + scale 1 to 1.03 to 1 on `--ease-back-soft`; optimistic, never waits for the network; the stripe is never an inset shadow | Disney anticipation (UD 2); Super Evil Genius hover timelines as plain CSS |
| 5 | `tick` | Counter tick (`Ticker`, `Stat`) | JS `settle` spring on a displayed number only; digits roll up when the value rises and down when it falls, 286 ms; a 160 ms `--selected-bg` highlight on the row; at most 2 rolling at once; a count that changes off screen or in a hidden workspace snaps; under calm it shows the final value | the quiet living number in a header (Mysta, Super Evil Genius) |
| 6 | `paper` | Paper reveal (the Reader opening a paper or a sheet) | the sheet slides in as `sheet`; the paper then lands: translateY 16 px to 0 + opacity, 280 ms, `heavy`; the first 3 question blocks in view unveil with clip-path inset(0 0 100% 0) to inset(0) (clip-path is repainted on the main thread, not composited, so at most 3 at once; the rest are already at their final state), 240 ms `--ease-enter`, 40 ms stagger, one-shot; maths (KaTeX, lazy) swaps in with a 100 ms opacity step on a reserved line box so nothing shifts; a 2 px reading-progress bar via `animation-timeline: scroll()` (scaleX 0 to 1) | Fitsole full-screen viewer; Quechua and Rally clip-path reveals |
| 7 | `glide` | Tree pan and zoom | pan: pointer capture, 1:1 while down; release inertia tau 110 ms (5.7.2 #4); rubber band 0.35 then `heavy`; wheel zoom: factor 1.0015^(-deltaY) eased to the target on `calm` (at most 364 ms); the rAF loop exists only while a pointer is down or a glide or zoom runs and stops at rest (0 callbacks idle); the SVG `<g>` transform is rewritten per frame (`Tree.tsx:89`), so the pan repaints on the main thread and is the one motion that is not compositor-only; no DOM layer animates; "Fit" and "Next" animate the camera on `calm`; keyboard: arrows pan 80 px, +/- zoom, no glide | GlobeKit drag-to-navigate (inferred), Mysta lerp |
| 8 | `fill` | Progress fill (`Meter`, stage strip) | `transform: scaleX(v)` from the left, `calm` 364 ms; first mount 0 to value in 400 ms on `--ease-enter` when it enters the viewport, afterwards only deltas; a visible zero tick; an `unknown` (not measured) value draws no fill and never animates; during a workspace switch the fill snaps to its value; indeterminate is a static striped bar, not a looping shimmer | Goodfight loading bar with scaleX instead of width |
| 9 | `lift` | Hover lift (interactive cards and rows only) | `@media (hover: hover) and (pointer: fine)`: translateY -2 px on an inner face, 160 ms `--ease-standard` in, 180 ms out, while the hit area stays on the stationary outer box (a 2 px lift would otherwise drop the card out from under a pointer resting on its last 2 px and make it flicker); the shadow is a pre-painted `::after` whose opacity animates 0 to 1 (never `box-shadow` itself); optional tilt on one `data-tilt` card at a time: at most 4 deg, perspective 800 px, lerp 0.12, rAF only while the pointer is inside and the angle is still moving (the loop stops when the remaining angle is under 0.05 deg and restarts on the next pointermove, so a parked pointer costs 0 callbacks), return 300 ms ease-out; keyboard focus shows the same lift without tilt | Mysta tilt (6 deg, tightened to 4); Super Evil Genius perspective tilt; monopo lerp 0.12 |
| 10 | `hold` | Press-and-hold (destructive or costly only) | pointerdown: `scaleX` fill 0 to 1, linear, 400 ms, on the control's own ring; release before 400 ms: reverse in 120 ms, nothing happens; completion: `press` spring, then the action; Enter or Space on the focused control opens a plain confirm dialog; reduced motion: no fill, the confirm only; never for navigation or anything safe | MakeReign (the pattern itself was not found in its code, so this is our design) |
| 11 | `pin` | Scroll-driven header | sticky header at a fixed 56 px (no shrinking); inside `@supports (animation-timeline: scroll())`: title scale 1 to 0.92 (origin left) and a 1 px hairline opacity 0 to 1 over the first 96 px (`animation-range: 0 96px`); without support a one-shot IO sentinel toggles `data-stuck` (hairline appears, no scrub); used on the Reader, Study and Career; no parallax anywhere (WCAG 2.3.3 names it) | Cyd Stumpel `view-timeline` title |
| 12 | `tint` | Theme crossfade (a workspace theme, and the Appearance theme switch) | every custom property changes in one style recalc inside the view-transition callback; the browser cross-fades two snapshots (opacity, compositor only); a workspace change is part of `switch`; an Appearance change is a root view transition of 200 ms opacity; chrome outside the snapshot (tab underline, primary fill) transitions its own `background-color` and `color` for 160 ms; no `@property` colour transition across the subtree, no re-mount | GlobeKit (one frame, six skins), SPYLT theme shifts |

#### 5.7.4 Choreography: the workspace envelope and the rules that keep him oriented

```
t(ms)  0         120       160  200            360        480  520        600
tab    |-- indicator slides (calm, 364) ------------|
old    |-- fade+fall 8px (200, exit) --|
new               |-- master pane fade+rise 12px (360, enter) -------------|
cards                  |c1..|c2..|c3.. (arrive 240, +40 each, ends 480)
detail                      |-- +40 ---------------------------------------|
                                                                    520 planned, 600 cap
```
1. The frame never moves, and only the centre is named: the centre alone carries `view-transition-name: ww-centre`; the left column, rail and tab strip carry none. The browser still captures everything unnamed as the implicit `root` group, so `html[data-ww] { view-transition-name: none }` is set as well: the frame then stays live (the Shell clock and the left column's Tickers keep updating, hover and focus rings keep drawing) and only two textures exist, the old and new centre (about 5.3 MB at 1366x768 and 8.3 MB at 1920x1080, 4 bytes per pixel). If Chromium still captures root, `::view-transition-group(root) { animation: none }` makes it static and the cost is two more full-window textures (8.4 MB at 1366x768). UNVERIFIED; P6 asserts a left-column Ticker changes during a switch. Well Wisher does not use the app-level `switchView`: `.main` already carries `view-transition-name: page` (`shell.css:94`) and `motion.css:73-75` runs it at 220 ms out and 560 ms in with `filter: blur(8px)`, which would break the budget. Chunk 1a edits `shell.css` and `motion.css` only to scope: under `html[data-ww]`, `.main` has `view-transition-name: none` and `ww-centre` runs 200 ms out and 360 ms in with opacity and 12 px of travel, no filter. Core and the other sections keep today's behaviour byte for byte. `html::view-transition { pointer-events: none }` so the snapshot overlay cannot eat a click (UNVERIFIED that Chromium would otherwise; the spec in 8.6 decides, and `skipTransition()` is the fallback). Without `startViewTransition` the switch is a 160 ms fade.
2. The tab indicator slides under the new tab with a CSS transform on `calm`, starting at t = 0.
3. The new workspace enters after the pane: master pane +0, detail +40. The stagger applies to the first 3 cards above the fold (120 ms total) and not at all on a workspace with more than 3 cards above the fold; `Reveal` gates it so nothing below the fold animates.
4. Each workspace remembers its scene (scroll per pane, selected id, view, filter, open fold, draft text) in a persisted `workspaceMemory` store; a dirty dot appears on the tab when the scene is not default; restoring a scroll is not animated.
5. A cross-workspace jump (Tree "Study this node", L1 paper, a proof suggestion) sends the clicked element to its target with a one-shot `view-transition-name` (400 ms) and shows a **Back to Tree** chip with no timer (WCAG 2.2.1: the only route back must not expire); the chip goes away when used, dismissed, or on the next navigation; click, Alt+Left or Esc returns to the stored scene.
6. The left column does not re-animate on a switch; data changes inside it use `Ticker` (at most 2 rolls at once; a switch never starts a roll because the column does not re-mount) and a 160 ms row highlight in `--selected-bg` (never saffron).
7. Esc order: popover, then overlay, then focus mode, then the Back chip. Never more than one overlay deep.
8. One workspace is mounted at a time; the last one stays hidden (`content-visibility: hidden`, timers paused) only for the Tree and only if its measured remount cost exceeds 150 ms (A).
9. `inert`, `content-visibility`, `animation-timeline` and `document.startViewTransition` are Chromium features. Chunk 4 starts by recording the installed WebView2 version in the gate report and feature-testing each (A: present). Fallbacks: no `inert` means a focus trap plus `aria-hidden`; no view transition means the 160 ms fade; no scroll timeline means the IO sentinel.

#### 5.7.5 Section themes: a look per workspace, with a reason

Rule: a workspace layer redefines at most 7 semantic tokens, only inside the centre (`.ww-centre[data-ws="..."]`). The colour says "you are in this room"; layout, type scale, spacing, radius, provenance colours and component tokens are identical everywhere. The 7 tokens: `--accent`, `--on-accent`, `--accent-wash` (14 % of accent), `--tint` (4 % of the accent mixed into surface-0..3, centre only), `--type-kicker` (colour of the 12 px mono kicker labels), `--tempo` (scales enter, exit, stagger) and `--spring-main` (which spring the scene uses). `--accent-hi` and `--focus-ring` derive from `--accent` and are covered by the contrast test.

The 4 % tint moves surface luminance by well under the step between two surfaces, so no surface pair loses its separation, and the contrast test recomputes everything on the tinted surfaces. Provenance stays fixed in every workspace (cyan measured, amber inferred, red fault); the workspace accents avoid those three hues, and saffron stays the Study accent. Exactly one `data-primary` still holds the fill, so a screen shows one accent fill, in the colour of the room the primary lives in.

| Workspace | The job, so the mood | Accent (Ash) | Kicker colour | Tempo / spring | Signature motion |
|---|---|---|---|---|---|
| Study | Pressure and focus before a paper: the identity colour, the warmest | `#ff7a2e` | accent | 1.0 / `calm` | `arrive` on paper rows, `fill` on the stage strip |
| Tree | Growth and orientation: a cool green says "a path through a map" | `#4fd1a1` | accent | 1.0 / `calm` | `glide`, the lit path fading in as one opacity step (a stroke-dash draw would animate `stroke-dashoffset`, a paint property outside the allowed set) |
| Life | Body and small daily things: soft, human, quick | `#ff8fa3` | accent | 0.9 / `settle` | `tap` and `tick` (many small taps) |
| Career | Long horizon and deadlines: a steadier violet, slightly slower | `#b794ff` | accent | 1.1 / `calm` | stage-stepper `fill`, `lift` on pipeline rows |
| Focus | Nothing competes with the block: no hue, ink is the accent | `#f5f6f8` | ink-1 | 1.25 / `heavy` | the dial is the only light; `hold` for end-session |
| Setup | Truth and settings: neutral graphite-blue, nothing decorative | `#a9b8d0` | ink-2 | 0.8 / `press` | `hold` on a destructive reset, minimal motion |

Tempo changes enter and exit only: Focus enter = 240 x 1.25 = 300 ms (still under 400), Setup 192 ms. `switch` is never scaled, so the 600 ms cap holds for every pair. dMAT (Study) and the harvester card (Setup) take their workspace's layer; a view never has its own colour.

| Token (Ash) | Study | Tree | Life | Career | Focus | Setup |
|---|---|---|---|---|---|---|
| `--accent` | `#ff7a2e` | `#4fd1a1` | `#ff8fa3` | `#b794ff` | `#f5f6f8` | `#a9b8d0` |
| `--on-accent` | `#1c0b00` | `#04140d` | `#1c0409` | `#12062b` | `#050506` | `#0a0f18` |
| `--tint` (4 %, centre) | none | accent | accent | accent | none | accent |
| `--tempo` | 1.0 | 1.0 | 0.9 | 1.1 | 1.25 | 0.8 |
| `--spring-main` | calm | calm | settle | calm | heavy | press |

The other two themes keep the same hue families so a workspace reads the same across themes (accent / on-accent):

| Workspace | Vibhuti Paper | Indigo Night |
|---|---|---|
| Study | `#a63a06` / `#ffffff` | `#9aa0ff` / `#0b0d24` (the theme identity) |
| Tree | `#0b6b4d` / `#ffffff` | `#7fe0c0` / `#04140d` |
| Life | `#a3263f` / `#ffffff` | `#ffa0b4` / `#1c0409` |
| Career | `#5b2bb3` / `#ffffff` | `#c3a8ff` / `#12062b` |
| Focus | `#1a1814` / `#f4f1ea` | `#eef0ff` / `#07080f` |
| Setup | `#34506e` / `#ffffff` | `#b8c4ff` / `#0b0d24` |

Computed contrast (M, all 18 combinations, minimum over the four tinted surfaces; accent as text needs 4.5, on-accent on accent 4.5):

| Workspace | Ash: accent text / on-accent | Paper | Indigo |
|---|---|---|---|
| Study | 6.30 / 7.36 | 4.97 / 6.50 | 6.85 / 8.06 |
| Tree | 8.44 / 9.87 | 4.99 / 6.51 | 10.10 / 11.99 |
| Life | 7.48 / 9.07 | 5.49 / 7.23 | 8.42 / 10.22 |
| Career | 6.72 / 8.00 | 6.52 / 8.60 | 7.92 / 9.54 |
| Focus | 14.40 / 18.84 | 13.32 / 15.71 | 13.75 / 17.65 |
| Setup | 8.03 / 9.55 | 6.38 / 8.34 | 9.40 / 11.28 |

The lowest `--ink-3` on any tinted surface is 5.04 (Paper, Career; recomputed 9 Nov: 5.05 Life, 5.07 Tree; Focus has no tint and is 5.23). The Study row above (6.30 / 4.97 / 6.85) is lower than Study's untinted values (6.64 / 5.27 / 7.26) although Study declares no tint: conservative, but not reproducible from the stated rules, so `tokens.test.ts` is the source of truth and the table is regenerated from it. The plan's rule still holds: accent-coloured text is never placed on `--accent-wash`. In Indigo Night, Study (periwinkle) and Career (violet) are the closest pair; the kicker label and the tab indicator carry the difference, and the screenshot baselines will show whether it is enough (A; if not, Career moves to a warmer violet).

The transition between themes (the `tint` motion): `data-ws` is set on the centre root in the same synchronous commit that mounts the next workspace, inside `document.startViewTransition(cb)`. One style recalculation changes every custom property; the old centre is captured as a bitmap first, so the cross-fade is two textures blended on the compositor: no per-frame style work, no animated custom property, no re-mount of the frame (the cost is two snapshots in GPU memory for about 300 ms). Where `startViewTransition` is missing, or `data-motion` is calm, or the governor says low load, the fallback is a 160 ms `ww-fade` on the new centre with `data-ws` already set. The Appearance theme switch uses a root view transition of 200 ms opacity only; the fallback is an instant swap.

#### 5.7.6 Interaction catalogue

| Input | Does | Never |
|---|---|---|
| Hover (`hover: hover` and `pointer: fine` only) | `lift` on interactive cards and rows (-2 px, 160 ms); the link underline grows with `scaleX` over 160 ms; tab hover tint (colour, 160 ms); optional `tilt` on one `data-tilt` card (at most 4 deg); a pointer companion label | reveal the only copy of information; start a loop that outlives the pointer; animate layout; fire on touch |
| Click or tap | `tap` press 100 ms + rebound; state change with a 160 ms colour or opacity cross-fade; optimistic update with a rollback toast; `celebrate` once per surface per session | wait for the network before moving; confetti or sound; shake a refused control (a disabled-with-reason control keeps focus and flashes its reason in `--selected-bg` for 160 ms, colour only) |
| Press and hold | `hold` on destructive or costly actions only (400 ms) | be the only way to do anything; be used for navigation or safe actions |
| Scroll | native scroll always; `arrive` through a one-shot IntersectionObserver; `pin` header and the Reader progress bar through CSS scroll timelines; `scroll-snap-type: x mandatory` rows (week strip, class cards) with `tabindex=0` and a visible focus ring | smooth-scroll libraries (they break find-in-page and keyboard in every reference site that uses them; none approved); `scroll` event listeners (lint-banned); pinned scrubbed storytelling; parallax; hidden scrollbars |
| Keyboard | Tab order is reading order; Alt+1..6 switch workspaces with the same `switch` (focus lands on the new workspace heading after the transition, `preventScroll`); Esc closes the top overlay first (popover, overlay, focus mode, Back chip); Enter or Space on a `hold` control opens a confirm; arrows pan the Tree, +/- zoom; focus ring 2 px `--focus-ring`, offset 2, visible in every theme; closed drawers are `inert` | trap focus outside an open dialog; move focus mid-transition; rely on hover for an action |
| Drag | Tree pan (`glide`, pointer capture, `touch-action: none` on the canvas only); sheet drag-to-dismiss (threshold 60 px or release velocity above 0.5 px/ms, `touch-action: pan-y`, follows 1:1 then settles on `heavy`); horizontal rows by native snap with optional pointer-drag for a mouse | be the only path (every drag has arrows, buttons or native scroll); drive layout (transform only); keep a rAF loop after the release finishes |
| Cursor | the native pointer is always visible; a label companion (at most 24 px tall, `transform` only, offset 16 px right and down, one shared pointermove handler coalesced to rAF) appears on `data-cursor` targets: Tree nodes, drag handles, `hold` buttons | `cursor: none`; replace or hide the pointer; `mix-blend-mode` on anything larger than 48 px; run on touch, under calm, or when the governor says low |
| Focus | focus enters a workspace heading after a switch, a sheet's first control after it opens, and returns to the opener on close | steal focus from a field the user is typing in |

Global rules (each is a spec in 8.6):
1. No layout-triggering animation: no animated `width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `border-width`, `font-size`, `box-shadow`, `filter` or blur radius. Allowed: `transform`, `opacity`, `clip-path` on elements under 640 px across (paper blocks, headings), and paint-only colour at 160 ms or less on elements under 300 px. (The current `rise` keyframe animates `filter` and `.bar > i` animates `width`, `motion.css:23-28, 46`; both stay in the legacy UI and are replaced in `ww/`.)
2. No animation blocks input: nothing sits over a control with `pointer-events`; a new input during a transition finishes it (`skipTransition()`), it is never queued; every interaction answers within 100 ms.
3. Nothing over 400 ms except the workspace switch envelope (600 ms cap).
4. No per-frame JS while idle: zero `requestAnimationFrame` callbacks and zero running animations two seconds after the last input; loops start on pointerenter or pointerdown and stop at rest.
5. No cursor replacement that hides the pointer.
6. Frequent beats slow: a repeated action inside 600 ms takes the short path.
7. The end state is the default state: every effect starts from the CSS final state.
8. Nothing animates below the fold, in a hidden workspace, or in a backgrounded tab (`visibilitychange` stops the Crucible dial and the companion).

#### 5.7.7 Performance budget and the motion governor

| Item | Limit | Why |
|---|---|---|
| Animated surfaces at once | 6 in steady state; 8 only for a cross-workspace jump | the busiest planned event is the switch: 2 snapshots + tab indicator + 3 staggered cards = 6; each promoted layer costs a texture and the app shares a 6 GB-VRAM laptop with local models |
| Typical per workspace (A until the sampler runs) | Study 6, Life 4, Career 4, Focus 3 (dial, meter, primary), Tree 2 (inspector + coach mark; the SVG is not a layer, its pan is main-thread paint, see 5.8.9). These are event peaks; steady state is 0 everywhere except Focus during a running session (the dial), Setup 2 | counted from the event table in 5.8.9 |
| Animated properties | `transform`, `opacity`; `clip-path` on small elements; paint-only colour at 160 ms or less on elements under 300 px | compositor-only (UD 2: web.dev) |
| `will-change` | only while a transition runs, removed on `transitionend` or `animationend`; never in static CSS; at most 8 elements at once | each layer is GPU memory |
| Scroll | IntersectionObserver and CSS `animation-timeline` only; no scroll listeners | every reference site that used a scroll listener paid for it |
| Idle | in `.ww` and `.ww-portal`: 0 rAF callbacks, 0 running animations, and no timer added by Well Wisher faster than 1 per minute. Pre-existing timers outside `ww/` are listed, not hidden: the Shell clock `useNow(1000)` (`Shell.tsx:47`), the game bridge at 60 s and 30 s (`bridge.ts:109, 170`), while a session runs the Crucible beat and guard (`Crucible.tsx:176, 180`), and the infinite keyframe on `.core-chip.live .led` (`shell.css:35`) when the core is live | owner: "does not load up or create new loads" |
| JS added by the motion system | at most 6 KB gzip in the entry chunk (A: spring helper, Reveal IO, hold, glide, switch wrapper) and no new dependency | no GSAP, Framer or Lenis (not approved) |
| KaTeX | dynamic `import()` on first `MathText` render; 0 bytes in the entry chunk; fonts load on demand | section 6 |

The motion governor is one switch with three levels, read from the glass probe's verdict (sampled only while something animates, never at idle) and set on the root as `data-motion-load`:
- `high` (glass tier refract or blur, 5th-percentile frame rate at least 50): everything in 5.7.3.
- `low` (tier flat, or 5th percentile under 50, or the tab hidden, or battery saver): tilt, the pointer companion, pointer light, the `pin` scrub and stagger turn off; `switch` becomes the 160 ms fade; glass is flat. Feedback motion stays.
- `none` (`data-motion=calm` or the OS asks for reduced motion): 5.7.8.

Glass is confined to the navigation and control layer (the Back chip's rim and a 1 px inspector edge; Sheet headers are flat) and never on the tab strip, cards, columns, the Reader body, the inspector body or any text (5.6); it is driven inline through `useGlassTier` because the build strips CSS `backdrop-filter`.

#### 5.7.8 Reduced motion at the token layer

The root carries `data-motion="auto | full | calm"`; `auto` follows `prefers-reduced-motion`; Setup > Appearance can force either (the audit sandbox reports `reduce`, so motion could never be judged there). Under reduce or calm, in tokens only:
- travel distances are 0; `--dur-switch-in`, `--dur-travel`, `--dur-celebrate` and `--dur-hold` collapse to 120 ms opacity only; `--stagger` is 0; no view transition is started;
- `useSpring` returns its target in one frame and `Ticker` shows the final value; scroll timelines are disabled (final state); tilt, the companion, inertia and the rubber band are off; `hold` is replaced by the confirm dialog; the tab indicator jumps; the celebration is a static check mark;
- auto-playing motion (the Crucible dial sweep) pauses (WCAG 2.2.2) but the dial still shows time; progress meters still update; 100 ms colour or opacity feedback stays; glass drops to the flat fallback.

`full` keeps travel even when the OS says reduce, for review only. `useReducedMotion()` replaces today's 4 implementations (7 CSS blocks, `motion.tsx`, `Tree.tsx` `matchMedia`, the global rule).

### 5.8 Performance rules

1. Animate `transform` and `opacity` only (compositor). Documented exceptions: paint-only colour properties (`background-color`, `border-color`, `color`) at 100 to 160 ms on elements narrower than 300 px, for hover and selected feedback, and `clip-path` on elements under 640 px across (5.7.6). No animated width, height, top, left, margin, padding, `box-shadow`, `filter` or blur radius. (The current `rise` keyframe animates `filter`; it is replaced.)
2. `will-change` only while a transition runs, removed on `transitionend`; at most 8 simultaneously animating layers; stagger total never above 240 ms.
3. `Reveal` animates only elements in view (IntersectionObserver); nothing off screen animates or polls; hidden workspaces do not animate.
4. The left column subscribes with narrow `zustand` selectors, each card is `React.memo`, and render-count tests prove that tapping a class re-renders only L3 and that a Ticker roll re-renders only its own `Stat` (builder judge; adversary pass).
5. Glass is measured, not assumed. `measureFps` returns an average, so chunk 1a adds a per-frame sampler (a `requestAnimationFrame` loop that runs only while a switch, sheet or Tree pan is animating, stops 300 ms after the last animation ends, keeps the last 5 windows and is never free-running, so idle stays at 0 callbacks; it stores each frame gap and reports 5th-percentile fps = 1000 / the 95th-percentile gap) and runs it over 20 workspace switches with glass on and off; glass ships only if that value is at least 55 fps at the owner's real window size (the Playwright run in 8.6 measures it; chunk 14 records it). The tier starts flat (5.6). Evidence that backdrop blur costs is secondary (UD 2), hence the in-app measurement.
6. Nothing new loads at first paint: KaTeX and its fonts load by dynamic `import()` on first use; no UI dependency beyond the two installed on 9 Nov (`katex`, `@playwright/test`) is added by this plan. Python side: the harvester uses `httpx` and `lxml`, both already in `.venv`, and the standard library's `urllib.robotparser`; `pypdf` is not added until the owner answers question 19, and until then PDFs go through the local `pdftotext` when present or are not read.
7. Budgets to log in the gate report (A): transitions per page, layers promoted, longest frame during a switch (16.7 ms frame; about 10 ms script).
8. Appearance > Motion, Glass, Contrast and Tab badges are in-app switches (default Auto / On), because the OS flag is not always set. The motion governor (5.7.7) lowers effects on load by itself.
9. **Animated layers per event** (A until the fps sampler runs; the cap is 8):

| Event | Layers | Max at once | Main-thread work per frame |
|---|---|---|---|
| Workspace switch (no jump) | centre old + centre new snapshots 2; tab indicator 1; stagger at most 3 (the page title is item 1 of the 3; the primary's overshoot is not played during a switch and a `fill` snaps, so the title, primary and stage strip add no layers) | 6 | none (CSS only) |
| Cross-workspace jump | the 6 above + shared element 1 + Back chip 1 | 8 | none |
| Left-column data change | Ticker roll (text only), at most 2 at once | 2 | one React state update per frame per rolling Ticker (`useSpring`), so at most 2 |
| Drawer or sheet open | panel 1 + scrim 1 | 2 | none |
| Paper reveal in the Reader | sheet 1 + scrim 1 + paper 1 + at most 3 unveiling blocks (the reading-progress bar is scroll-driven and counts only while scrolling) | 6 | `clip-path` repaint of at most 3 blocks (main thread, not composited) |
| Tree pan or zoom | the SVG `<g>` transform is rewritten each frame by `useViewport` (`Tree.tsx:89`); no compositor layer, the SVG repaints on the main thread; the inspector's glass edge is flat meanwhile | 0 layers, 1 repaint surface | one `setAttribute` per frame, unchanged |
| Crucible dial | the dial (transform) 1; the column collapse snaps | 2 | none |

A switch animates the centre only.

---

## 6. Formatting

**Maths decision (definite since 9 Nov: `katex` is installed).** Convert what exists, render with KaTeX loaded lazily, and store LaTeX from now on.
1. **`toTex(plain)`**: one pure function that turns the bank's ASCII dialect (`int_0^inf int_0^x e^(-xy) y dy dx`, `x^2 z`, `Gamma(1/2)`) and the sheets' mixed Unicode / caret dialect into `$...$`. It lives in `ww/math/` and only converts tokens in a math context (a line matches a symbol pattern, or the author fenced it). The cost and risk are in the content, not the renderer: `d_k` against `s_i s_j`, the word "pi", "int" inside "integration". It is table-tested on all 88 bank strings plus about 100 sheet lines (about 1 day, an audit estimate). Any converted line in the Reader has a visible **raw** toggle, so wrong maths is never silent.
2. **`MathText`**, one component used by the paper, the Reader, Drill, Study, the Tree panel and Findings, so surfaces cannot drift. It renders with **KaTeX 0.16 (installed, 0.16.21), lazy-loaded**: a dynamic `import()` on the first `MathText` render, its stylesheet and fonts bundled locally (the app is offline), 0 bytes in the entry chunk. While the chunk loads, or if it fails, `MathText` shows a small home-grown fallback (exponents, subscripts, `^( )`, Greek words, `sqrt()`, stacked `a/b`, `int_a^b`, `sum_`, `<= >= ->`; no matrices or cases) in a reserved line box so nothing shifts, and an error shows the source string.
3. **New content is authored in LaTeX** (`$...$`, `$$...$$`); `toTex` exists only to migrate what is already there. GATE-level items need matrices and cases that a hand-rolled renderer cannot do.

What it covers: question stems, sub-parts, answers, sheets, glossary lines, the Reader, Drill cards, Findings titles, Tree node text. What it does not: the phone page (plain text with Unicode until the server emits it; the phone's last line says so).

Rejected: MathML as the primary (WebView2 is Chromium and has MathML Core, but the installed version was not verified and a plain-to-MathML emitter is a second project); MathJax (larger, asynchronous). The home-grown `math()` is kept only as the loading and failure fallback.

**Installed 9 Nov (commit `bbaedac`, approved by the owner):**
- `katex` 0.16.21: about 0.6 to 0.7 MB uncompressed from memory, none at first paint, not measured; fonts bundled locally; chunk 3 records the Vite output delta in the research note (output goes to `dist-e2e`, never `app/ui/dist` while `JARVIS.pyw` runs) and `scripts/bundle-budget.mjs` fails the build if `katex` reaches the entry chunk.
- `@playwright/test` 1.56.1 with Chromium: the protocols are in 8.4 and 8.6. Never run against the live app; the harness starts a sandbox on a scratch data dir and refuses ports 8777 and 8778.

Required: the italic regex stays fixed (A STUDY-04, done) with its test; a paper renders as one numbered list; the paper and the Reader share one renderer; the existing LaTeX unit test is replaced by one that uses `String.raw` (the old one writes `\sqrt` in a plain JS string, `\s` collapses, and it passes while LaTeX does nothing).

**Typesetting.**
- **Question**: number in a fixed 32 px gutter (`q.n`, finally rendered); stem in `read` (16 / 26); sub-parts (a)(b)(c) with a hanging indent; marks as a right-aligned badge; formulas inline, and a line with an integral, sum or fraction set in display style on its own centred line with 12 px margin. Topic and source are one quiet line under the stem: `source: <name>, <licence>` with an Open link; a harvested item with `origin: pointer` has no stem text and reads "Solve: <reference>" so the app never stores copyrighted text. No breaking inside an expression (`overflow-wrap: normal` for maths; a too-wide formula scrolls inside its own box). "p 10 %" is hidden when it is the untapped default.
- **Paper**: header block (subject, kind, total marks, time, seed), then Section A / B / C each headed in words ("Answer any n of m, x marks each"), numbering continuous across the paper as one list (the audit found 20 one-item lists each numbered 1), a mark-scheme fold closed until the paper is attempted, marks entry beside the paper (a stepper per question, a running total, one **Save marks**), and the line "Saved. Tomorrow's blocks changed: ..." after saving: the one deliberate peak of the exam loop. (A, unverified: the audit never pressed the marks write, so this loop stays unverified until the `ww_check` case in 8.5 passes; if nothing changes the line reads "Saved. No change to tomorrow's plan." rather than staying silent.) A CIE paper scales the pattern to the row's maximum and says so; its real shape waits on question 5.
- **Sheet**: Markdown plus `$...$`; 68 ch measure; a left table-of-contents rail in the Reader; Definition, Theorem, Example, Common mistake as callouts with a left rule in `--line-ui` (not accent); derivations as numbered steps with right-aligned equation numbers; a References line per sheet (plan item 7); an A4 print stylesheet.
- **Reader (O3)**: opens over the centre only, portalled to `document.body` (so it survives scroll), J / K between sections, Esc closes.
- **Notation**: durations always "45 min" (today `m`, `min`, `a prime mark` and bare all appear); dates "18 Dec" with the ISO date in a `title` attribute (today five forms, one raw ISO); mono type only for ids, units and timestamps.

---

## 7. The carcass: a placeholder for every unbuilt feature

One registry, `ww/plannedFeatures.ts`, renders everything below, so placement is testable and the Roadmap drawer (O5) is generated, not written twice.

```ts
export type Pattern = 'empty' | 'disabled' | 'coming' | 'roadmap'
export interface Planned {
  id: string; planItem?: number
  page: string; section: string        // where it renders (card ids from 3.3)
  label: string; pattern: Pattern
  line: string                         // the one line shown: 15 to 140 characters, says what is missing and why
  needs: string                        // the precondition, shown on the Roadmap row
  when?: string                        // 'Sprint 3' | 'after the end-sems' | 'needs a decision'
  chunk?: string                       // the build chunk that ships it (section 9); deleted with it
}
```

**Four patterns, safest first.**
- **E** empty state with a real first action: the feature is built, data is missing.
- **D** disabled with a visible reason: a control exists but a precondition is missing. It stays focusable (`aria-disabled`, not the `disabled` attribute) and the reason is text beside it, not only a tooltip.
- **C** `ComingCard`: only where the feature has a natural home and changes a decision he makes today.
- **R** Roadmap entry: weeks away, no value yet; shown only in the Roadmap drawer, never in the layout.

**Rules.** A placeholder never uses the accent, draws its dashed outline in `--line-ui` (the outline is the only cue that it is not live, so it must clear 3:1), never animates like a live feature, has no enabled button other than an E action that does something real, and contains no number that could be read as measured unless it is computed from live data (use `N` otherwise; step numbers in a how-to are allowed). The entry is **deleted in the same commit that ships the feature**; a test fails if an entry's `page` and `section` now hold a live control. The Roadmap lists every entry; an inline hint appears only where it changes today's decision.

**Coverage (the carcass is complete when this holds).** Every planned feature has exactly one entry: plan items 7 to 19 appear once each by `planItem`, and the other rows carry no item number. The registry has 28 entries today. `plannedFeatures.test.ts` fails if a plan item is missing, if an entry has no `line` of 15 to 140 characters, or if two entries claim the same `page` and `section` with the same label. Every workspace also keeps its slots: a view that will gain a card later has the card's place reserved by its registry entry, so adding the feature replaces a placeholder and moves nothing else.

**The carcass as motion.** A placeholder is static: no keyframes, no transition, no shimmer, no pulse, no hover lift, no focus animation beyond the global ring; it arrives once with its siblings (`arrive`) and never moves again. A loading skeleton is a static block that appears only if data has not arrived after 200 ms. A locked section announces itself once per session (`LockChip`: one `arrive` plus one polite live line, "Locked: <reason>"); a refused activation does not shake, focus stays and the reason flashes in `--selected-bg` for 160 ms. `carcass.spec.ts` (8.4) proves all of it.

| Item | Page, card | Pattern | The one line shown | What un-greys it |
|---|---|---|---|---|
| 7 Sheets rewritten with formulas and references | C1 S2 | E | "No sheet is linked to this paper yet (N of N units). [Link a sheet]" | A sheet linked per unit (every paper's `files` is empty today, M) and `$...$` content |
| 8 Sharpen and de-master | C2 T3 | D | "Sharpen needs one GATE-tier question solved on this node. No GATE bank yet." | (A) A GATE-tier question on the node. The line is the plan's wording, not an engine rule the audit inspected, so the server must supply the real blocker and the UI shows that text |
| 9 Resource progress | C1 S7 | R, with a real Open | "Chapter checklists per resource: not built. The resource itself opens now." | A checklist typed once per resource. The Open link ships in chunk 7 (STUDY-14: `Res.url` is unused today); only the checklist is "not built" |
| 10 Knowledge of the day x3 | C1 S6 | R + hint | "Today shows one track. Exam, skill and life tracks arrive with the concept bank." | A concept bank that grows from sheets and notes |
| 11 Trees v3, one canvas ("Whole me") | C2 T1 | D | "One canvas for all six trees is not built. Each tree opens on its own for now." | The single-canvas build; cross-tree prerequisites (none exist today, M) |
| 12 Status v2, 4-week lines and sourced advice | R P3 | E (dashed baseline) | "4-week line: not built. Each tile shows this week only." | The chart; "Needs 4 weeks of logs; N so far" appears only when that is the true blocker |
| 13 Life v2: library and music minutes, holiday switch | C3 LF1, C6 SU5 | D | "Holiday switch is not built. Mark that day's classes Cancelled for now." | The switch in the timetable engine |
| 14 Body, grand: discipline bank, V-taper targets | C3 LF5 | R | "Disciplines and standards are not built. Gym logs one session at a time." | A discipline bank as data; never medical advice |
| 15 Music (history import, then the API) | C3 LF1 | R | "Spotify history import is not built. It needs your data export file first." | The export file; later his own developer app |
| 16 Reels v2 (saved-file transcription) | C3 LF1 | R | "Reels: a link and one line today. Transcription and summary are not built." | A transcription job and a model summary |
| 17 Books (read-aloud, explain-back) | C1 S6 | R | "Book reader with read-aloud and explain-back is not built; the voice needs internet." | The reader; the online voice |
| 18 Ledger (publish today's ledger) | R P7 | D | "Publishing is not built." | A public repo, a public-safe filter and an approval step per entry (design not decided) |
| 19 College mail and Classroom | C6 SU13 | D | "Waits on a one-hour test: can your college account authorise this app? Fallback: a watched folder." | The test result; otherwise the folder and a calendar file |
| CIE practice papers | C1 S3 | E | "No CIE questions yet. A CIE paper is N marks; its shape is not set. [Add questions]" | Questions in the bank (typed by hand, or on disk from the harvester, chunk H; B1 makes the empty state honest) and the owner's answer on the shape |
| Paste a past paper | C1 S3 | R | "Importing a pasted past paper needs a parser: not built. Add questions one at a time for now." | A parser from pasted text to stem, marks and topic; the owner's answer on sources (question 5) |
| GATE tier | C1 S3 level control | D | "GATE: none on disk yet (N queued). Allowed sources only." | GATE-tier items on disk per topic from the harvester (own-written, openly licensed with a licence line, or pointer-only records); the control exists and never silently falls back to exam questions |
| Parameterised numericals | C1 S3 | R | "Numbers drawn fresh for each paper: not built." | The symbolic generator that draws numbers and computes the key |
| Proficiency per topic | C1 S1 head, S2 | E | "Proficiency per topic: not measured until you mark a paper." | One marked paper |
| Money and Social quest lines (already PLANNED) | R P4 | D | keeps the existing locked line that says why | existing |
| Phone pairing from Well Wisher | L5, C6 SU15, O2 | built (real), D when blocked | "Not paired. Turn on the listener, pair, then scan." If the listener cannot start: "Listener off. [Turn on]" | already works as `PhoneCard`; this plan only adds the door |
| Papers and formulas on the phone | phone page last line | D | "Desktop only: papers, Tree, Setup (not on the phone yet)." | Server-emitted text for formulas and a phone paper view |
| Question harvester | C6 SU18 | E, then D per blocked source | "Nothing fetched yet. [Queue a topic]". A blocked source: "<Source>: licence not recorded, so it stays off." | Backend chunk H; each source's licence line recorded before it is switched on |
| PDF text for the harvester | C6 SU18 | D | "PDF text uses the local PDF reader when present. A Python PDF library is not installed." | The owner's OK for a PDF library; until then only the local reader |
| dMAT practice | C1 S9 | R, then E once built | "dMAT practice is not built. It will generate figure sequences, equation puzzles and Latin squares from the public rules." After the build: "No set taken yet." | Backend chunk 2b and the view in chunk 7; (A) the owner confirmed on 9 Nov that dMAT is the Digital Master Test |
| Drafted questions to accept | C1 S3 | R | "Drafted questions to accept or reject: not built. Add questions by hand or wait for the harvester." | A drafting job and an accept or reject list; the owner's answer on sources (question 5) |
| Calendar file of exams and study blocks | C6 SU13 | R | "A calendar file (.ics) to import on the phone: not built." | The fallback of item 19: the file writer |
| Share a link from the phone | phone page last line | D | "Sharing a reel from the phone: not built." | The phone path of item 16 |
| Yaadash link | C6 SU13 | D | "Records are written to a staging folder for Yaadash to read. The reading side is not built here." | Yaadash's reader of the staging folder; (A) whether the writer side is complete is unverified |

---

## 8. Tests and verification protocols

Tests live in `app/ui/src/__tests__/ww/` (vitest + happy-dom, the `createRoot` + `act` + `vi.stubGlobal('fetch')` pattern the repo already uses, no new dependency); the layout, motion and per-theme checks that need a real browser are Playwright specs (8.4, 8.6). **Chunk 1a first fixes `vitest.config.ts`**: its `include` is `src/**/*.test.ts`, so `.test.tsx` files would silently never run; it becomes `src/**/*.test.{ts,tsx}` with a smoke test that proves a `.tsx` test is collected. A shared `contract.ts` holds the PAGES table (page id, ordered `data-section` ids, `data-hint`, primary label, empty fixture) and three fixtures per page: full, empty (every list `[]`, every store field `null`: the class that caused the cold-open crash) and failing (the API rejects). Stubs needed because happy-dom has no layout: `matchMedia`, `ResizeObserver` plus `clientWidth` / `clientHeight`, `IntersectionObserver`, `document.startViewTransition`. All of them live in one file, `__tests__/ww/_stubs.ts` (chunk 1a), and every ww test imports it, so authors do not re-invent them (the pattern behind 38 separate happy-dom environments, adversary pass).

### 8.1 UI contract per page (vitest descriptions)

**Frame and tabs (`frame.test.tsx`)**
- `renders left, centre and right regions with landmarks and one h1 per workspace named like its tab`
- `has exactly six tabs in the order Study, Tree, Life, Career, Focus, Setup and none is dimmed`
- `Alt+1..6 switch workspace and move focus to the new workspace heading; Ctrl+1..6 still leaves Well Wisher for the app-level tab (Shell's handler is untouched)`
- `sets data-density compact at 1290x680, regular at 1600, roomy at 1844 (stubbed sizes)`
- `shows the proof column as a rail below 1500 and pinned from 1500`
- `keeps the left column mounted, with identical DOM nodes, across a switch`
- `restores scroll, selected id, view and a draft text when returning to a workspace`
- `shows a Back chip after a cross-workspace jump and returns on Alt+Left and Esc; the chip has no timer and goes away on the next navigation`
- `openOverlay(id) mounts the registered overlay (a stub until chunk 12) for every id O1 to O8, and Esc closes it`
- `a workspace switch names only the centre (view-transition-name ww-centre); under data-ww the .main page transition is none`
- `workspaceMemory remembers view and selection per tree id, not only per workspace`
- `Esc closes the top overlay first, then focus mode, then the Back chip`
- `puts a static, neutral dirty mark on Setup when a section has unsaved edits; Appearance > Tab badges off hides every badge`
- `every one of the 15 legacy tab ids resolves to the destination in 3.2` (replaces the one-to-one check in `mission-audit.test.ts`), and one deep link per alias opens its destination
- `the season pill switches the left column between Countdown and Horizon, announces it once in an aria-live line, and reserves its space`

**Primary action (`primary.test.tsx`, runs for every workspace and view)**
- `exactly one element has data-primary in the whole tree`
- `for every PAGES x state (clean, dirty, paired, empty bank, class pending) exactly one data-primary exists, and a pinned Proof panel owns none`
- `budget: each PAGES entry declares its screen-one card ids and the list has at most 7 (4 left, at most 3 centre); the real fold position is checked in 8.4`
- `the primary is Now's Start by default and moves to the workspace's primary when its precondition holds`
- `an open overlay owns the only data-primary and gives it back on close`
- `only .btn.primary and the active tab reference --accent as a fill`
- `evening swaps Now for Close the day and the primary follows; without a day_closed event the primary is See tomorrow`

**Left column (`left.test.tsx`)**
- `renders Countdown, Now, Classes, Counters, Phone chip in that order`
- `Countdown lists earlier-sitting papers first and shows "+N more" rather than cutting them`
- `shows one "dates tentative" line, not a tilde per row`
- `Now shows the director's step 1 only; no second "first pick" exists anywhere in the tree`
- `Now shows one welcome-back line and its day count equals the idle-days field`
- `+25 +50 +90 post minutes through usePlan.log and show a toast; Other opens the Log-minutes sheet`
- `class taps carry aria-labels with subject, time and status, are 44 px by class, and a second tap on the same status clears it`
- `with academics null and an empty fixture the column renders no "undefined", "NaN", "null" or "[object"`
- `tapping a class re-renders only the Classes card (render-count test)`
- `the phone chip says Not paired and opens the Phone overlay`
- `the phase sentence (for example "Exam week: library blocks first") appears once in the whole tree (TODAY-12)`
- `the +25 +50 +90 presets and class taps are 44 px by class, and a Ticker roll re-renders only its own Stat`

**Study (`study.test.tsx`)**
- `views are Papers, Plan, Library, dMAT and Papers is the default`
- `Papers shows list, topics and the Practice cell above the fold marker; the stage strip prints "not measured" for any stage with no data`
- `selecting a paper in the list or in the Countdown selects it in both and survives a tab round trip`
- `a topic chip cycles to do, learned, solid and its aria-label says what the next tap does`
- `a paper with an empty bank shows the CIE empty state with Add questions and no Practice paper button; Add questions opens O8 and an added question raises the bank count`
- `the Exam / GATE control exists; GATE is aria-disabled with its visible reason when no GATE questions exist; requesting gate never returns exam questions unlabelled`
- `a generated paper is one ordered list with continuous numbers and "answer any n of m" per section`
- `the practice cell is keyed by paper id and clears when another paper is chosen`
- `Open in Reader works with scrollTop > 0 because the Reader is portalled`
- `a resource's Open link opens its url (STUDY-14)`
- `after Save marks the line "Saved. Tomorrow's blocks changed" appears and lists computed changes only; with no change it reads "No change to tomorrow's plan"`
- `Plan shows one next action; Swap sits inside the block row; Rebuild asks to confirm`
- `Library hides Findings in exam season and shows them filtered to the active subject in normal season`
- `with an empty bank and a queued harvest the Practice cell says "Queued: n" and shows no fill (the word "Fetching" appears only while a request is in flight or finished in the last 5 minutes; otherwise "Queued: n, off" or "Queued: n, paused", because the harvester is off by default); with an empty bank and nothing queued it shows Add questions; a printed question ends with its source line, and an origin: pointer item reads "Solve: <reference>" with no stem text`

**dMAT and harvester UI (`dmat.test.tsx`, `harvest.test.tsx`)**
- `dMAT offers three task kinds, a length, a level and a timer, and Start set is the view's primary`
- `a dMAT set with the same seed shows the same tasks; the score line counts correct answers only`
- `the dMAT view says that the items are generated here and none is copied from the test`
- `the harvester card lists every source with its status and licence; a source with no recorded licence is off with the reason printed`
- `the queue lists waiting, fetching and refused rows with the refusal reason; Pause and Queue a topic call the harvest routes and roll back on failure`
- `nothing in the harvester card is labelled fetched unless the route reports it on disk`

**Tree (`tree.test.tsx`)**
- `toolbar controls are at least 36 px by class and have names; the switcher shows tree names with counts, not a run-on string`
- `selecting a node shows the inspector with Study this node as the primary; with none selected the primary targets NEXT`
- `Study this node switches to Study and shows the Back chip`
- `Sharpen is aria-disabled with its reason while there is no GATE bank`
- `no glass surface holds text: the inspector body and the tab strip are opaque, the toolbar is flat`
- `the first-visit coach mark shows once, dismisses in one tap, and labelled branch chips exist`
- `no label overlaps at 100 %` (the existing test, kept)
- `Fit on the largest tree renders branch chips and no label overlap (TREE-08)`
- `switching trees and back restores each tree's view and selection (TREE-06)`
- `Meter at 0 paints a non-zero track (TREE-03)`

**Life (`life.test.tsx`)**
- `Add to day, Quest, Attendance, This week render in that order; class taps are not duplicated here`
- `Attendance shows behind as text plus an icon and never red below a minimum sample`
- `the counter tile and the class list agree: no "went to college" zero beside logged classes`
- `a logged item offers undo, delete and show all; delete calls the new route and rolls back on failure`
- `a reel added today says "will ask tomorrow" and raises a pending count`
- `Log session is the primary once a set value or proof is typed; All present takes it while a class is pending; otherwise Now's Start`
- `Quest renders once in the whole tree`
- `a pressed TapGroup button is filled, not an inset-shadow stripe (LIFE-02)`

**Career (`career.test.tsx`)**
- `views are Pipeline, Certificates, Abroad, Money, Plan; opening Career always starts on Pipeline`
- `Do next step targets the soonest deadline; the tab badge equals the due-now count`
- `a campaign with no finish line hides that line and offers no Start`
- `the certificate list pages through every row (all N of N reachable)`
- `Mark earned is aria-disabled until a link is typed`
- `Goals are read-only with an Edit link to Setup > Goals; War chest shows rupees only and Rewards shows game currency only`
- `each pipeline row shows a stage stepper and a next action (CAREER-STATUS-03)`

**Focus (`focus.test.tsx`)**
- `one h1; length chips are Segmented with the 44 px hit class and a selected state whose children all pass contrast, computed from the resolved token pair of each child class (happy-dom has no rendered pixels; the rendered check is in 8.4)`
- `tracks are built from the rotation`
- `a finished session writes through usePlan.log and appears in Recent`
- `starting a session collapses left and right to the timer rail and Esc restores them`
- `the wager is off by default and no countdown renders until a session is started`

**Setup (`setup.test.tsx`)**
- `mounts with academics null without a crash` (regression for SETTINGS-CORE-PHONE-01)
- `the index lists sections in order; clicking scrolls and focuses the section`
- `one save model: a dirty dot per section, a sticky "Save N changes", leaving asks`
- `timetable, goals, subjects and attendance rule render as forms; "Advanced: JSON" is closed; no 44 px textarea`
- `the date sheet shows one card per paper with labelled fields ("Tentative", "Aim for __ of __"); no bare Target or Sit?`
- `the phone row shows one status line and a button that opens O2; the pairing steps and /phone/ww appear only in O2`
- `Connections rows are disabled with their reasons`
- `the Question harvester section (SU18) is in the index, after Appearance, and shows its placeholders when the harvest routes answer 404`

**Proof (`proof.test.tsx`)**
- `renders Rank, Suggests, Stats, Quest lines, Weekly review, Building, Proof of work, Wins, Recent in that order`
- `rank lists every requirement, met and unmet`
- `each suggestion has a button that switches to its place`
- `a stat with no history shows "not built" or "not measured yet", never a zero trend line, and a 0 shows its next step`
- `Recent groups by day with totals and collapses zero-XP rows`
- `on every page, overlay and the phone page, no string matches /streak (lost|broken)|you missed|don't break|session (failed|lost)/i`

**Overlays and roadmap (`overlays.test.tsx`)**
- `a Drawer moves focus in, traps Tab, closes on Esc, returns focus and makes the background inert`
- `Date sheet, Phone, Reader, Record and Add questions open from every entry point in 3.5`
- `the Roadmap lists every registry entry; each inline placeholder matches its registry line (15 to 140 characters)`
- `no placeholder has an enabled button or the accent class`
- `a registry entry whose page and section now hold a live control fails` (stale-placeholder test)
- `no card id is mounted twice across all pages, and the set has 68 members`
- `plannedFeatures coverage: plan items 7 to 19 appear once each, and all 28 registry entries have a line of 15 to 140 characters`

**Maths (`math.test.ts`)**
- `toTex converts all 88 bank strings with no leftover ^ _ { or backslash in the rendered text` (table test)
- `renders exponent, subscript, fraction, root, integral with limits, sum, Greek`
- `a LaTeX string written with String.raw renders` (guards the `\s` collapse)
- `underscores in identifiers outside maths do not italicise text`
- `MathText falls back to the home-grown engine while KaTeX loads or when it fails; a converted line has a raw toggle`
- `KaTeX is a dynamic import: no entry-chunk module imports it statically (bundle:check in 8.6 repeats this on the build)`

**Phone parity (`phone-parity.test.ts`, with `test_phone_ww.py`)**
- `ww.html built from the left-column view-model lists the same section ids in the same order as L1 to L4`
- `phone taps send the same payloads as the desktop taps (shared fixture)`
- `the phone stylesheet has a single-column rule below 600 px and 44 px targets (CSS text check)`

### 8.2 The CSS lint test (`css-lint.test.ts`)

Scans every `.css` file under `app/ui/src/ww/` as text:
- no hex, `rgb(`, `rgba(`, `hsl(` or `color-mix(` outside `design/primitive.css` and `design/themes/*.css`;
- no `px` literal for `font-size`, `border-radius`, `padding`, `margin` or `gap` outside the token files (0 and 1 px allowed);
- no `!important`, no `backdrop-filter` (it is stripped by the build; glass is inline), no `height` or `max-height` fixed on an element whose class starts with `ww-page` (regression for the 300 px Log box);
- `--ink-off` and `--accent-hi` are never used in `color:`; no `box-shadow: inset` on a state class (the 3 px stripe that bled into rounded corners, LIFE-02); the dashed placeholder border is `--line-ui`; `--accent` appears only in `.btn.primary`, the active-tab rule, the focus ring and the registry-free token files;
- no `cubic-bezier(` and no literal `ms` or `s` duration outside the token files; no `transition: all`; no `will-change` in static CSS; no `cursor: none`; every `@keyframes` and `transition-property` list inside the allowed set (5.7.6 rule 1);
- TSX scan: no `addEventListener('scroll'`, no `cursor = 'none'`, no import of `gsap`, `framer-motion`, `motion`, `lenis` or `locomotive-scroll`;
- a ratchet: counts of hex, `rgba(`, px radii and `!important` in the legacy `germoney/**` CSS may fall and may never rise (baseline: 72 colours, 939 px literals, 17 font sizes, 16 radii, 11 `!important`, M).

### 8.3 The reduced-motion and motion tests (`motion.test.ts`)

- `every @keyframes and every transition-property list in ww CSS names only transform and opacity, plus background-color, border-color and color at <= 160 ms` (parsed from the CSS text)
- `durations come from --dur-* only; no literal ms in ww CSS`
- `with matchMedia reduce: useReducedMotion is true, useSpring returns the target, Ticker shows the final value, Reveal renders without a transform, switchView applies the change without startViewTransition`
- `data-motion="calm" gives the same result when the OS flag is off; data-motion="full" keeps travel when the OS flag is on`
- `under calm, --dur-switch, --dur-travel and --dur-celebrate resolve to 120 ms and --stagger to 0` (token resolution from the CSS text)
- `stagger total never exceeds 240 ms; at most 8 elements carry will-change at once`
- `every theme passes the contrast table in 5.2` (`tokens.test.ts`; computed from the token files, recomputed for each theme)
- `all 18 theme x workspace combinations of 5.7.5 pass: accent text 4.5, on-accent 4.5, ink-3 4.5, on the four tinted surfaces`
- `spring-curves.test.ts: every emitted linear() sample is within 0.5 % of the closed form for press, settle, calm, heavy and lively`
- `the emitted CSS equals what scripts/gen-springs.mjs writes from k, c, m (no hand-edited curve)`
- `accent text is never rendered on --accent-wash`
- `--ink-disabled passes 4.5:1 on all four surfaces of every theme`

### 8.4 Checks happy-dom cannot do: Playwright specs (installed 9 Nov, 1.56.1 with Chromium)

Every row of the old manual checklist is now a spec in `app/ui/e2e/`. Each runs against the sandbox (`python -m jarvis_app.ww_sandbox` on port 8791 with synthetic fixture data), never the live app; a check that could not run is written as "not run" in the dated gate report, never as a pass.

| Check | Spec | Born in chunk |
|---|---|---|
| Every animation respects `prefers-reduced-motion` and `data-motion` | `motion-reduced.spec.ts` | 1a |
| No animated width, height, top, left; layout count and layout shift in a real run | `motion-props.spec.ts` | 1a |
| 400 ms ceiling, 600 ms envelope, idle = 0, input never blocked, layers at most 6 (8 on a jump), no scroll listeners | `interaction-budget.spec.ts` | 1a |
| Before and after screenshot of Core (the `--ink-3` fix and the `html[data-ww]` scoping change nothing else); local and git-ignored, never committed (Core shows live data and draws with `three`): one run pair, the clock, the ticker and every `canvas` masked | `core-shot.spec.ts` | 1a |
| Hit area at least 40 px (44 in groups), no overlapping hit areas, at 1366 and 390 | `hit-areas.spec.ts` | 1b |
| 3 themes x 6 workspaces x 3 viewports against baselines; one primary; at most 7 cards in the first 682 px; no horizontal scroll at 390 and 1280; per-child contrast of selected states computed in the page | `themes-visual.spec.ts` | 1b (kitchen sink), 4 (frame), 6 to 12 (each workspace adds its rows) |
| Placeholders static, locked sections announce once | `carcass.spec.ts` | 1b, extended in 5 |
| KaTeX swaps in on a reserved line box: 12 formula samples render, layout shift at most 0.02 | `math.spec.ts` | 3 |
| Every primary reachable by keyboard, focus visible, Esc order, no traps, Alt+n versus Ctrl+n | `keyboard.spec.ts` | 4, extended by each workspace |
| Frame rate: workspace switch with glass on and off, Tree pan and zoom | `perf-trace.spec.ts` | 10 (Tree), 14 (all) |
| The phone page at 390 px: single column, 44 px taps | `hit-areas.spec.ts` and `themes-visual.spec.ts` on `/phone/ww` | 13 |
| The shipped WebView2 version and the presence of `inert`, `startViewTransition`, `animation-timeline` | not Playwright: chunk 4 reads them from the running app's webview and records them in the gate report | 4 |

Honest limit: Playwright's Chromium proves the code, not the engine the app ships in (WebView2), and headless Chromium rasterises in software unless a GPU is exposed, so frame-rate numbers are lower bounds for compositor effects. Both are stated in the report.

### 8.5 What the gate adds (`python -m jarvis_app.ww_check`, run before every push)

- the paper route answers `empty: true` when `bank_size` is 0, and a 20-mark CIE pattern sums to exactly 20 for any row maximum;
- `tier=gate` with no gate-tier twin returns a `tier_note` and never a shortfall list that implies GATE questions exist;
- the existing 50-seed sweep still passes with the scaled pattern;
- the marks loop: saving marks for a paper on a scratch data dir changes the next plan response, or the response says there is no change; until this passes the Study peak line is (A, unverified);
- `POST /api/mission/bank/questions` adds one validated question on a scratch dir (the bank count rises by 1) and refuses an invalid body;
- any new route (life-item delete, optional left view-model, the harvest routes, the dMAT route) is covered by the route-drift check, and the view-model carries the keys the UI and the phone need;
- harvester (`ww_check_harvest.py`, chunk H): on recorded fixtures with no network, a path disallowed by `robots.txt` is refused with its reason, a second 403 or 429 from a host stops that host for the day, the queue survives a restart, a source with no recorded licence is never fetched, and every served item carries `source`, `license` and `origin` while an `origin: pointer` item carries no stem text; on a scratch dir a paper with a shortfall is served from disk and the missing topics are queued;
- dMAT (`ww_check_dmat.py`, chunk 2b): the same seed gives the same set; for 200 seeds per task kind an independent solver agrees with the key (a sequence's rule reproduces the shown terms, every Latin square is valid, every equation's answer is computed), and no stored text comes from the test's own material;
- the dated report records the UI suite's counts (`npx vitest run src/__tests__/ww`) and the Playwright results of 8.4 (A: the gate shells out to the UI suite and `npm run ww:verify` only if node is on the path; otherwise it records "not run").

Backend tests (`app/tests/`): `test_ww_generator.py` additions (scaled CIE pattern, empty flag, tier note), `test_ww_life.py` (delete and undo), `test_ww_harvest.py` and `test_ww_bank_store.py` (chunk H), `test_ww_dmat.py` (chunk 2b), and `test_phone_ww.py` parity. `ww_check.py` stays owned by chunk 2; chunks H and 2b put their gate cases in their own modules, and whichever merges second adds the one-line import.

### 8.6 Verification protocols

Everything runs against the sandbox (flags today: `--port`, `--token`, `--dir`, `--fresh`; it copies `data/app`, turns off the phone listener, Aankhen, core autostart and Uno). Never port 8777 or 8778.

**8.6.1 Files, scripts, run.** New in `app/ui/` (chunk that creates each is in 8.4):
```
playwright.config.ts            workers 1, retries 0, viewport 1366x768, colorScheme dark, two webServers
e2e/fixtures.ts                 sandbox guard, theme / workspace / motion helpers, frame sampler, hit-test grid
e2e/*.spec.ts                   the specs of 8.4
scripts/gen-springs.mjs         emits linear() curves + JS constants from k, c, m
scripts/bundle-budget.mjs       reads the Vite manifest and enforces 5.7.7
src/__tests__/ww/{css-lint,motion,spring-curves,tokens}.test.ts      (vitest)
```
`package.json` scripts (A: names are proposals):
```
"e2e":           "playwright test"
"e2e:motion":    "playwright test e2e/motion-reduced.spec.ts e2e/motion-props.spec.ts e2e/interaction-budget.spec.ts e2e/carcass.spec.ts"
"e2e:layout":    "playwright test e2e/hit-areas.spec.ts e2e/keyboard.spec.ts"
"e2e:shots":     "playwright test e2e/themes-visual.spec.ts"
"e2e:perf":      "playwright test e2e/perf-trace.spec.ts --workers=1"
"e2e:update":    "playwright test e2e/themes-visual.spec.ts --update-snapshots"
"bundle:check":  "vite build --outDir dist-e2e && node scripts/bundle-budget.mjs dist-e2e"
"ww:verify":     "tsc -b && vitest run src/__tests__/ww && npm run bundle:check && playwright test"
```
The two `webServer` commands are the sandbox (`..\.venv\Scripts\python.exe -m jarvis_app.ww_sandbox --port 8791 --token ww-e2e`, cwd `app`) and `vite preview --outDir dist-e2e --port 5174` with a proxy to 8791. Build output goes to `dist-e2e` (git-ignored), never `app/ui/dist`. `globalSetup` refuses to start if the target port is 8777 or 8778, and proves the target is the sandbox by calling a token-guarded route (`/api/core`) with the sandbox token `ww-e2e`: the live app does not know that token and answers 401, so the run stops (`/api/health` returns only `ok` and the version, so it cannot identify a sandbox).

**8.6.2 Two prerequisites, both in chunk 1a.** (1) `vite.config.ts` proxies `/api` and `/ws` to 8777 by default, so `npm run dev` or `preview` would hit the live app: it reads the target from `WW_API_TARGET` (default unchanged) and the Playwright command sets it. (2) The sandbox copies the real `data/app`, so screenshots would contain real data: `ww_sandbox` gains a `--fixture` option that seeds synthetic data (Subject A/B/C, placeholder dates). Baselines are committed under `e2e/__screenshots__/` only from runs that used the fixture; volatile text (clocks, countdowns, dates) carries `data-volatile` and is masked.

**P1 Reduced motion (`motion-reduced.spec.ts`).** Context `reducedMotion: 'reduce'`; run each workspace switch (all 30 ordered pairs), each overlay open and close, a tap on each primitive, a counter change, a Tree pan with release, a hold and a theme change. A fixture samples `document.getAnimations({subtree:true})` at 0, 50, 100 and 200 ms after each action and asserts every animation is opacity or colour only, 120 ms or shorter, with no non-identity `transform` keyframe. Also: `document.startViewTransition` was not called (spied); `animationName` is `none` on `pin` headers and the Reader progress bar; `--dur-switch-in` resolves to 120ms and `--stagger` to 0; the Tree has no rAF callback after pointerup; a `hold` control shows no fill and Enter opens the confirm; tilt and companion elements are absent. A second context checks that OS `reduce` with `data-motion=full` keeps travel and OS `no-preference` with `data-motion=calm` behaves as reduce. A third check: no running animation older than 3 s anywhere, except `data-allow-anim="dial"` while a Crucible session runs.

**P2 No layout animation (`motion-props.spec.ts`).** During a 3 s scripted scroll on every workspace (wheel steps of 120 px every 50 ms), all 30 switches, every sheet open and close, and a fill update and a tick: (a) keyframe audit, every animation's `effect.getKeyframes()` properties must be inside {opacity, transform, offset, easing, composite, clipPath, backgroundColor, borderColor, color}, and `clipPath` or colour fail on a target wider than 640 px or 300 px; (b) computed-style audit, a rAF sampler records `offsetWidth`, `offsetHeight`, `offsetTop`, `offsetLeft` of every `[data-card]`, the frame regions and the tab strip each frame, and any change outside `data-layout-change-ok` fails; (c) CDP `Performance.getMetrics` `LayoutCount` delta during the scroll at most 1, layout-shift entries during a switch sum to at most 0.02, and `will-change` never on more than 8 elements and back to 0 at rest.

**P3 Hit areas (`hit-areas.spec.ts`).** For each page, view and overlay at 1366x768 (mouse) and 390x844 (`hasTouch`), collect visible interactive elements (`button, a[href], [role=button|tab|switch|checkbox|menuitem|option], input, select, summary, [tabindex]:not([tabindex="-1"])`). The effective hit rectangle is measured, not read from CSS: probe `document.elementFromPoint` on a 4 px grid over the element's box grown by 12 px each side and take the bounding box of points that resolve to the element or a descendant. Fail if the box is under 40 x 40 px, under 44 px for `data-tapgroup` members and any control with a neighbour closer than 44 px, or if two effective boxes of different controls overlap. Exempt only inline links inside running text (`.link-inline`, the WCAG exception); every exemption is listed in the report.

**P4 Per-theme screenshots (`themes-visual.spec.ts`).** 3 themes x 6 workspaces x 3 viewports (1366x768, 1920x1080, 390x844) = 54 baselines, plus the 8 overlays at Ash and 1366 = 62. The theme is set before load through the Appearance storage key (A: `ww.theme`), `data-motion=calm`, `animations: 'disabled'`, `caret: 'hide'`, volatile text masked, `document.fonts.ready` awaited. `toHaveScreenshot` with `maxDiffPixelRatio: 0.002`, `threshold: 0.2`, `fullPage: false` (the first screen is what the plan budgets). Windows baselines only; the Chromium build is pinned by the lockfile. Non-pixel assertions on the same page: the workspace accent token equals the table in 5.7.5; `data-primary` count is exactly 1; `scrollWidth <= clientWidth` at 390 and 1280; at most 7 `[data-card]` in the first 682 px. A baseline update needs `npm run e2e:update` and a reviewed diff; it is never automatic.

**P5 Frame-rate traces (`perf-trace.spec.ts`).** An in-page sampler (a rAF loop pushing frame gaps) plus a `PerformanceObserver` for `longtask`, started just before the action and stopped 300 ms after the last animation ends; CDP `Emulation.setCPUThrottlingRate` for the 4x runs; 5th-percentile fps = 1000 / the 95th-percentile gap (the same method as the in-app glass sampler, so the numbers compare). Workspace switch: 20 switches cycling Alt+1..6, glass on and off, unthrottled and 4x; also the last animation ends within 600 ms of the keypress, at most 6 animations run at once (8 for a jump), and glass-on is no more than 5 fps below glass-off. Tree pan: a 600 px drag over 500 ms in 30 steps, release at about 2 px/ms, a glide, a wheel zoom of 5 notches, a second drag; after rest, 0 rAF callbacks for 2 s; the throw distance within 15 % of the table in 5.7.2 #4. Output is a JSON per run to `data/notes/well-wisher/perf/<date>.json` (private) with machine, Chromium version, p5, max gap and long tasks; the next run compares and fails on a worse-than-10 % regression of p5 or max gap. A missing baseline writes one and reports "baseline created", not a pass.

| Measure | Unthrottled | CPU 4x | Source of the number |
|---|---|---|---|
| p5 fps during 20 workspace switches | at least 55 | at least 38 | 55 is the plan's glass floor; 38 is the line under which the app's own glass probe drops to `flat` (`liquidGlass.tsx:108`) |
| p5 fps during a Tree pan + glide + zoom | at least 55 | at least 38 | same |
| Longest frame gap | at most 50 ms | at most 100 ms | 3 missed frames at 60 fps, and 6 (A) |
| Long tasks (over 50 ms) | 0 | at most 2 | monopo test sketch |
| Layout count during a 3 s scroll | at most 1 | at most 1 | scrolling must not relayout (A) |
| Cumulative layout shift during a switch | at most 0.02 | at most 0.02 | A |
| Pointermove handler cost (hover, tilt, companion, pan) | under 1 ms mean | under 4 ms | study sketch |

These are targets until the first run (UNVERIFIED). Headless Chromium rasterises in software, so each run records `raster: gpu | software`; the absolute floors are a hard gate only on a `gpu` run, a `software` run is compared with the stored per-machine baseline only and is reported as "floors not tested", and glass-on is forced through Appearance > Glass (the in-app probe would settle on `flat` in software). The 55 fps glass opt-in is decided from a headed run on the owner's machine at his real window size, never from a headless one. P3 adds a hover-stability check: hover 1 px above a lifting card's bottom edge and the card is still `:hover` after 300 ms.

**P6 Budget and input (`interaction-budget.spec.ts`).** Every motion in 5.7.3 is triggered once and its last-frame time recorded against its table value plus 50 ms; nothing over 400 ms except `switch`. Input not blocked: 100 ms after a workspace switch starts, click a left-column control and a tab, and both must respond; a second switch during the first completes the first at once. Idle: 2 s after the last input, zero rAF callbacks (an init script wraps `requestAnimationFrame`) and `getAnimations()` on the `.ww` and `.ww-portal` subtrees is empty (the Shell's own indicators are outside the claim) on every workspace, with a Crucible session stopped, once with the pointer parked on a `data-tilt` card and once on a `data-cursor` target; the glass sampler is not running; an init script also wraps `setInterval` and lists every delay under 60 s with its stack, and the list must equal the allow-list in 5.7.7; a left-column Ticker keeps changing during a workspace switch (the frame is not snapshotted). No element has `cursor: none`; the companion, if present, has `pointer-events: none`. No `scroll` listener registered by app code (`addEventListener` is wrapped and recorded); IO-driven reveals disconnect after firing.

**P7 Keyboard (`keyboard.spec.ts`).** The source of truth is a registry of primary actions (`ww/registry/actions.ts`, one id per primary in 3.3: Start, Practice paper, Add questions, Start set, Log session, Do next step, Start session, Save changes, Pair phone, Close the day, Open review). For each page and overlay: Tab from the page start and every action id is reached within 40 stops or has a documented shortcut that works; `:focus-visible` has an outline of at least 2 px and 3:1 against the surface under it in all 3 themes; Alt+1..6 switch workspaces and Ctrl+n still leaves Well Wisher; Esc closes in the order popover, overlay, focus mode, Back chip and returns focus to the opener; Tab never lands in a closed drawer (`inert`); a `hold` control opens a confirm on Enter; focus is on the new workspace heading after a switch finishes.

**P8 Carcass (`carcass.spec.ts`).** For every `[data-coming]` and `[data-skeleton]`: `getAnimations()` is empty for 3 s after the page settles, `animation-name` is `none`, `transition-duration` is `0s` for the card itself, and no rAF callback is scheduled. The registry count equals the number of rendered `ComingCard`s, each exactly once. A locked section writes exactly one live-region message per session and none on a second visit without reload. With reduced motion the same assertions hold.

**P9 Bundle (`scripts/bundle-budget.mjs`, run by `npm run bundle:check`).** Reads the Vite manifest of the `dist-e2e` build: the entry chunk contains no `katex`; JS added by the motion system is at most 6 KB gzip; no import of `gsap`, `framer-motion`, `motion`, `lenis`, `locomotive-scroll`, `three` or `@react-three/*`, and no `getContext('webgl')` or `getContext('webgl2')` under `ww/` (`three` is already a dependency for Core's views; a Well Wisher page must not pull it into its chunk).

**Enforcement map.**

| Rule | Where enforced |
|---|---|
| Only allowed properties in keyframes and transitions; durations and curves from tokens; no `will-change`, `transition: all`, `cursor: none`, `backdrop-filter`, `!important`, scroll listeners | `css-lint.test.ts`, `motion.test.ts` (vitest, text scan) |
| Spring curves match the closed form | `spring-curves.test.ts` |
| Reduced-motion switch resolves | `motion.test.ts` (tokens) + P1 (browser) |
| No layout animation in a real run | P2 |
| Budget (layers, idle, 400 ms, 600 ms envelope, input not blocked) | P6 |
| Frame rate | P5 |
| Entry chunk size, KaTeX not in the entry | P9 |
| Render counts (a tap re-renders only L3; a Ticker roll only its Stat) | vitest render-count tests (5.8.4) |
| A theme, density or `data-motion` change keeps every mounted DOM node (no re-mount) | `frame.test.tsx` (tag every `[data-card]` node, flip each switch, assert node identity) and a P6 step |

---

## 9. Build order

### 9.0 The phone in every chunk, and the seam with the app-wide overhaul (9 Nov)

**The phone ships inside each chunk, not as cleanup at the end.** The phone Study page (`/phone/ww`,
`phone_page/ww.{html,js,css}`) gets the same redesign as the desktop, on the 4.14 layout: the left column
alone at 390 px, the same view-model and the same section ids as L1 to L4, 44 px targets, one column below
600 px, and the honest last line "Desktop only: papers, Tree, Setup". Each chunk's Acceptance cell adds its
phone part:

| Chunk | Phone deliverable |
|---|---|
| 1a | the primitives and the Well Wisher semantic tokens reach `phone_page/` as generated CSS (never hand-copied); `ww.css` reads them; the motion governor's `data-motion-load="low"` level (no tilt, no stagger, 160 ms fades) and reduced motion work on the phone page |
| 1b | the phone's buttons, chips and counters use the same component tokens (sizes, radii, focus ring); a 390 px hit-area check |
| 2, 2b, H | the phone API (`/api/phone/ww/*`) reports the same honesty flags as the desktop (empty bank, scaled pattern, queue state), so the phone never shows a number the desktop would not |
| 4 | season and evening states are computed once on the server and sent to both pages |
| 6 | L1 to L4 rendered on the phone from the same view-model: Countdown, Now with Start and +25/+50/+90, Classes with P/A/C, Counters; the phone chip becomes "This is your phone" |
| 7, 8 | the phone gets read-only views where they are cheap: today's paper list (titles, dates, coverage) and the day's log; papers stay desktop-only and say so |
| 13 | becomes a parity check (same ids, same order, same flags, the 390 px screenshot) instead of the phone's first redesign |

**Seam with the app-wide UI-overhaul chat** (`docs/design/app-ui-overhaul.md` section 4):
1. Tier-1 primitives (`--p-*`) are one shared file, `app/ui/src/styles/design/primitive.css`. Chunk 1a lands
   it there and the overhaul chat adopts it; nobody writes a second set.
2. Well Wisher's themes stay scoped to its root: `.ww` and `.ww-portal`, which carry
   `data-section="wellwisher"`. Study and Life sit under that root. No theme writes html-level tokens.
3. One motion governor app-wide: `app/ui/src/ww/design/motion/governor.ts` (levels high / low / none; one
   owner switch `data-motion="calm"`, reduced motion, a low-power path from the glass probe, hidden tabs and
   battery saver). Announced in NOW.md section 6.
4. The phone gets the primitives and the section tokens as plain CSS written to `phone_page/` by the same build
   step as the board page (the overhaul chat owns that step); Well Wisher's `ww.css` consumes the file.
5. Invariants kept everywhere: device colours (white `#e9f3ff`, warm `#ffb347`, pink `#ff5fa8`, fan `#5aa9e6`),
   status meanings (confirmed, waiting, fault, simulated), 44 px targets, contrast 4.5:1 for body and 3:1 for UI.


Rules for every chunk: one agent, one worktree, files owned are listed and no other chunk edits them; commit per step in first person with the measurement and no attribution; merge and push after each green merge; tests against scratch data dirs (`JARVIS_DATA_DIR`, `AANKHEN_DATA_DIR`), never the real `data/`; never build into `app/ui/dist` while `JARVIS.pyw` runs (the bundle check builds into `dist-e2e`); never touch port 8777. The whole workspace ships **behind a flag** (`localStorage` key `ww.workspace`, also a Setup switch; default off until chunk 15) so the current UI keeps working through the exams. Gate per chunk: in `app/ui` `npx vitest run` and `npx tsc -b` plus the chunk's own e2e scripts from the verification table below; from `app/` `..\.venv\Scripts\python.exe -m pytest tests` and `..\.venv\Scripts\python.exe -m jarvis_app.ww_check`. **A chunk is not done until its verification ran in a sandbox and the output is in the dated gate report.** Playwright specs are written in the chunk that creates the thing they test (8.4 names the chunk of each).

Chunk ids are stable: 1a to 15 keep their numbers; the 9 Nov bar adds two backend chunks, `2b` (dMAT generators) and `H` (the question harvester), which touch no UI file and run in parallel with everything.

Sizes are estimates (A): files and tests are new or changed counts for one agent; days are agent-days.

| # | Chunk | Files owned | Acceptance | Size | Depends on |
|---|---|---|---|---|---|
| **1a** | **Design system core: tokens, themes, motion vocabulary, theme crossfade, glass hook, test and Playwright harness** | `app/ui/src/ww/design/{primitive,component,motion,base}.css`, `design/themes/{ash,paper,indigo,workspace}.css` (the 6 workspace layers of 5.7.5), `ww/design/motion/*` (generated springs, `arrive` IO helper, `hold`, `glide` core, `useWorkspaceTransition`, the `tint` wrapper around `startViewTransition`), `ww/design/_lab.tsx` (a dev route that exercises every motion and token), `ww/useReducedMotion.ts`, `lib/motion.tsx` (additions only), `lib/liquidGlass.tsx` (additive: `ceiling` and `start` options, per-frame p5 sampler), `styles/motion.css` and `styles/shell.css` (scoped under `html[data-ww]` only, per 5.7.4), `styles/tokens.css` (the `--ink-3` fix only), `vitest.config.ts`, `__tests__/ww/_stubs.ts`, `__tests__/ww/{tokens,motion,spring-curves,css-lint}.test.*`, `app/ui/playwright.config.ts`, `app/ui/e2e/{fixtures,motion-reduced,motion-props,interaction-budget,core-shot}.spec.ts`, `scripts/{gen-springs,bundle-budget}.mjs`, `vite.config.ts` (the `WW_API_TARGET` proxy variable only), `app/jarvis_app/ww_sandbox.py` (the `--fixture` option), `package.json` (scripts only) | 3 themes load; the contrast table passes in all, including `--ink-disabled` and the 18 workspace combinations; the 12 motions exist as tokens plus helpers and run on the lab route; spring `linear()` curves match the closed form within 0.5 %; the theme crossfade works through `startViewTransition` with the 160 ms fallback, `html::view-transition { pointer-events: none }` is set, and a click 100 ms into a switch lands; `data-motion` and `data-motion-load` switch work; 0 literal colours, curves or durations in `ww` CSS; a `.tsx` test is collected and imports `_stubs.ts`; glass starts flat and never exceeds `blur`; Playwright refuses ports 8777 and 8778 and runs against the fixture sandbox; JS added is at most 6 KB gzip; Core is unchanged apart from the `--ink-3` fix and a before and after Core screenshot is attached; the `html[data-ww]` scoping leaves Core's page transition unchanged | about 40 files, about 60 tests plus 4 specs, 3 d | none |
| **1b** | **Primitives and kitchen sink** | `ww/kit/*` (every primitive of 5.5 except `MathText` and the frame ones; includes `Section`, `PrimaryOwner`, `HoldButton`, `PinHeader`, `CursorLabel`, `Skeleton`, `LockChip`), `ww/kit/_kitchen.tsx` dev route, `__tests__/ww/kit-*.test.*`, `e2e/{hit-areas,themes-visual,carcass}.spec.ts` | each primitive has its states, a label, 36 px visible and 44 px real height wherever a neighbour is closer than 44 px; `Card` requires `data-card` by type; the motion-bearing primitives behave per 5.7.3 (`arrive`, `tick`, `tap`, `hold`, `pin`, `lift`, `fill`); the kitchen sink renders every primitive in all 3 themes and its baselines are created from the fixture and reviewed; primitives land in order of first consumer (Button, Segmented, Chip, Field, Card, Section, PrimaryOwner, Drawer, then the rest) so chunk 4 can start on the first group | about 45 files, about 80 tests plus 3 specs, 2.5 d | 1a |
| **2** | **Backend honesty (B1)** | `app/jarvis_app/ww_generator.py`, `routes_mission.py` (paper route and the new add-question route), `ww_check.py`, `app/tests/test_ww_generator.py` | CIE pattern scaled to the row's maximum; `empty: true` when `bank_size` is 0; loud `tier_note` for a gate request without a twin; optional server `latex` field; `POST /api/mission/bank/questions` adds one validated question (stem, marks, topic, tier) on a scratch dir and refuses an invalid body; a `ww_check` case saves marks and asserts tomorrow's plan changes or reports no change; gate sweep still green. Live-safe: no UI dependency | about 6 files, about 20 tests, 1.5 d | none (parallel with 1a) |
| **2b** | **dMAT generators (backend)** | `app/jarvis_app/ww_dmat.py`, `routes_ww_dmat.py` (routes load alphabetically, no registration edit), `ww_check_dmat.py`, `app/tests/test_ww_dmat.py` | three task kinds from the public rules (figure sequences, equation puzzles, Latin squares), each with a seed, a level, a key and a timed set; `GET /api/mission/dmat/set?kind=&seed=&n=` and `POST .../dmat/score`; same seed gives the same set; an independent solver agrees with the key on 200 seeds per kind; no text from the test's own material is stored (decided 9 Nov: a practice mode of its own, never a tier). Live-safe: additive | about 4 files, about 24 tests, 1.5 d | none (parallel) |
| **H** | **Question harvester (backend)** | `app/jarvis_app/ww_harvest.py` (fetchers per source, robots check, politeness, licence record, PDF text), `ww_bank_store.py` (the disk bank under `data/bank/questions/`, loaded by the generator), `routes_ww_harvest.py` (queue, sources, pause, queue a topic), `ww_check_harvest.py`, `app/tests/{test_ww_harvest,test_ww_bank_store}.py`; the one-line generator hook in `ww_generator.py` is the last step and waits for chunk 2 | sources and terms exactly as in `docs/research/question-sources.md`: openly licensed material (MIT OCW CC BY-NC-SA 4.0, OpenStax per-book licence line, the Q&A site's official API under CC BY-SA with `backoff` honoured) stored with `source`, `source_url`, `license`, `origin`, `ref`; official GATE papers, NPTEL (licence unconfirmed) and textbooks as `origin: pointer` records only, never stored text; coaching banks and Reddit not used; politeness: `robots.txt` per host, one request at a time, 1 request per 2 to 5 s, a descriptive User-Agent naming the tool (no contact address: the owner's rule keeps personal details out of requests), every page cached on disk, never a login, never a 403 or 429 twice; a source with no recorded licence stays off; downloads go to `data/bank/questions/` (git-ignored, never leaves the machine); the generator serves from disk and, on a shortfall, queues the missing topics; the harvester is off until the owner switches it on and sees the sources list; PDF text through the local `pdftotext` (a Python PDF library needs the owner's OK); the gate cases of 8.5 pass on recorded fixtures with no network; one supervised live fetch of one allowed source on a scratch dir is recorded in `question-sources.md`. Live-safe: with an empty disk bank the generator behaves byte for byte as today | about 8 files, about 40 tests, 3 d | none (parallel); its generator hook after 2 |
| **3** | **Maths engine and typesetting** | `ww/math/{toTex,MathText,fallback,katex-loader}.ts(x)`, `germoney/Reader.tsx` (renderer only), `germoney/pages/Exams.tsx` (the `q.text` line only), `__tests__/ww/math.test.ts`, `e2e/math.spec.ts` | the 88-string table passes; `katex` (installed, 0.16.21) loaded by a dynamic `import()` and absent from the first-paint chunk; fonts bundled locally; the fallback shows while it loads or fails; **wired into the old Reader and paper panel too**, so the maths fix is live before the new UI | about 9 files, about 45 tests plus 1 spec, 1.5 d | none (tokens only for styling; parallel with 1a); the bundle check runs once 1a has merged |
| **4** | **Frame, tabs, memory, density, season, flag** | `ww/frame/*` (Frame, WorkspaceTabs, workspaceMemory, density, season, BackChip, `overlayRegistry.ts` with `openOverlay(id)` and a stub for each of O1 to O8), `germoney/MissionRoot.tsx` (flag branch only), `lib/store.ts` (tab table), `components/Shell.tsx` (one rail entry), `__tests__/mission-audit.test.ts` (updated), `__tests__/ww/frame.test.tsx`, `e2e/keyboard.spec.ts` | six tabs on Alt+1..6 (Ctrl+1..6 still leaves Well Wisher; Shell's key handler untouched); the `switch` and `tint` motions run on the real frame within the 600 ms envelope for all 30 pairs; scene restore with per-tree memory; Back chip without a timer; `data-density`; `openOverlay` opens a stub for every overlay id; WebView2 version recorded and `inert`, `startViewTransition` and `animation-timeline` feature-tested; flag off keeps the old UI byte-for-byte; 15 legacy ids resolve; old tests still green | about 14 files, about 26 tests plus 1 spec, 2 d | 1a, and the first group of 1b |
| **5** | **Carcass registry and Roadmap** | `ww/plannedFeatures.ts` (28 entries), `ww/kit/ComingCard` use, `ww/overlays/Roadmap.tsx`, `__tests__/ww/{overlays-roadmap,plannedFeatures}.test.*`, the carcass spec extended | every row of section 7 registered; the four patterns render; the coverage test passes (plan items 7 to 19 once each); the stale-placeholder test passes; the Roadmap lists the registry; placeholders are static in a real browser | about 6 files, about 12 tests, 1 d | 4 |
| **6** | **Left column** | `ww/left/*` (L1 to L5, season swap, Close the day, welcome-back line, Why-this fold, the Phone pointer), `__tests__/ww/left.test.tsx` | the four cards and the phone pointer render from existing routes (no new route); overlays open through `openOverlay` (stubs until chunk 12); 3 class rows at compact; empty data renders; taps optimistic; render-count test passes; Now owns "next" and nothing else re-decides it; the pointer shows until paired | about 10 files, about 25 tests, 1.5 d | 4, 5 |
| **7** | **Study workspace** | `ww/study/*` (Papers, Plan, Library, dMAT, StageStrip use), `ww/overlays/Reader.tsx` (overlay shell, marks entry, source line; typesetting from chunk 3), `ww/overlays/AddQuestions.tsx` (O8), `__tests__/ww/{study,dmat}.test.tsx` | preselects the next paper; **Add questions** on an empty bank opens O8 and posts to the new route (chunk 2); the Practice cell shows the harvester queue line when work is queued and each question its source line (chunk H; absent, they simply do not render); the dMAT view runs a set from chunk 2b (until it has merged S9 shows its placeholder); a resource's Open link opens its url; Exam / GATE control honest; Reader opens when scrolled; the `paper` motion; one Practice block; "Saved. Tomorrow's blocks changed" line or "No change to tomorrow's plan"; list-over-detail under 720 px | about 24 files, about 44 tests, 4.5 d | 4, 5, 2, 3 (2b and H light up S9 and the queue line) |
| **8** | **Life workspace** | `ww/life/*`, `app/jarvis_app/ww_life.py` + route (delete / undo a logged item), `app/tests/test_ww_life.py`, `__tests__/ww/life.test.tsx` | five cards in order; neutral behind state; undo and delete work; reel cue and pending count; the counter tile derives from the class list | about 9 files, about 14 tests, 1.5 d | 4, 5 |
| **9** | **Proof rail and panel, Record** | `ww/proof/*`, `ww/overlays/Record.tsx`, the Core "Well Wisher" card (owner's OK; if declined, CAREER-STATUS-19 and SETTINGS-CORE-PHONE-14 and -20 stay open and the gate report says so), `__tests__/ww/proof.test.tsx` | ten cards in order; rank lists all requirements; 4-week slot honest; Recent grouped by day; rail at 1366, pinned at 1500 | about 10 files, about 15 tests, 1.5 d | 4, 5 |
| **10** | **Tree and Focus** | `ww/tree/*` (wraps `germoney/tree/*` unchanged), `ww/focus/*` (wraps Crucible and Drill), `e2e/perf-trace.spec.ts` (the Tree part), `__tests__/ww/{tree,focus}.test.tsx` | toolbar and inspector on primitives; inspector body opaque with at most a 1 px glass edge (flat by default); the `glide` motion with its rAF loop stopping at rest; per-tree view and selection memory; Fit on the largest tree shows branch chips; first-visit coach mark and branch chips; Study-this jumps with the Back chip; length chips readable; `hold` on end-session; tracks from the rotation; minutes through the one log writer; the existing tree suites pass unmodified | about 13 files, about 20 tests plus 1 spec, 2.5 d | 4, 5 |
| **11** | **Career** | `ww/career/*`, `__tests__/ww/career.test.tsx` | five views; opens on Pipeline; paging reaches every row; Mark earned; War chest and Rewards split | about 8 files, about 12 tests, 1.5 d | 4, 5 |
| **12** | **Setup and overlays** | `ww/setup/*` (includes SU18, the Question harvester card), `ww/overlays/{DateSheet,Phone,LogMinutes,Confirm}.tsx`, `__tests__/ww/{setup,overlays,harvest}.test.tsx` | cold open without a crash; forms replace the JSON editors; one save model; the date sheet is one card per paper; the Phone overlay shows `/phone/ww` and the existing pairing QR (no QR library); the Setup phone row is one status line and a button; Log-minutes sheet is the one composer; SU18 shows sources with licence, the queue and Pause from the harvest routes (placeholders when they are absent) | about 18 files, about 28 tests, 3.5 d | 4, 5 (H lights up SU18) |
| **13** | **Phone page parity** | `app/jarvis_app/phone_page/{ww.html,ww.js,ww.css}`, shared fixture, optionally one read-only view-model route (`ww_left.py`) only if the page cannot compose existing routes, `app/tests/test_phone_ww.py`, `__tests__/ww/phone-parity.test.ts` | renders L1 to L4 from one view-model in the same order; one column under 600 px; 44 px taps; the tab is labelled Well Wisher; the honest last line | about 5 files, about 9 tests, 1 d | 6 |
| **14** | **Contract sweep and perf** | `__tests__/ww/contract.ts` + PAGES table, the full Playwright run (`npm run ww:verify`), `e2e/perf-trace.spec.ts` (the switch part), baseline review | one primary everywhere; card-ownership test passes with 68 cards; the PAGES x states primary test and the screen-one budget test pass; the 20-switch trace with glass on and off at 1x and 4x meets 8.6 P5 and its JSON is stored; budgets of 5.7.7 and 5.8 logged; every spec of 8.4 is green or reported "not run" with the reason; baselines reviewed once as a set | about 4 files, about 12 tests, 1.5 d | 6 to 12 |
| **15** | **Switch on and retire the old** | removal of `germoney/pages/*` replaced by `ww/*`, old nav, `.tb-btn`, `.tap-btn`, `.life-kinds`, two of three `.seg`, `--ww-*`, the three Quest mounts; lower the ratchet baselines | old UI code gone; token counts only fall; full suite and `ww:verify` green; the click-count table of 3.5 walked in a sandbox | deletions, about 6 tests, 1 d | 14, and the owner's OK to flip the flag |

**Verification per chunk** (what is run, and what is written into the gate report):

| # | Verification | Evidence recorded |
|---|---|---|
| 1a | vitest (`tokens` 18 combinations, `motion`, `spring-curves`, `css-lint`); `npm run e2e:motion` on the lab route; `core-shot.spec.ts`; `npm run bundle:check` | contrast table, spring errors, JS gzip, glass p5 with the sampler, Core before and after |
| 1b | vitest `kit-*`; `npm run e2e:layout` (hit areas) and `e2e:shots` on the kitchen sink; carcass spec | hit-area exemptions list, 3 themes x 3 viewports baselines |
| 2 | pytest `test_ww_generator.py`; `ww_check` including the marks loop | sweep result, route-drift result |
| 2b | pytest `test_ww_dmat.py`; `ww_check_dmat` (200 seeds x 3 kinds, independent solver) | seeds checked, mismatches (0 expected) |
| H | pytest harvest and bank-store tests on recorded fixtures (no network); `ww_check_harvest`; one supervised live fetch on a scratch dir | refusals by reason, sources with recorded licence, bytes on disk, the supervised run |
| 3 | vitest `math.test.ts` (88 strings, `String.raw`); `e2e/math.spec.ts`; `npm run bundle:check` | strings converted, layout shift, KaTeX absent from the entry chunk, Vite output delta |
| 4 | vitest `frame` and `primary`; `e2e/keyboard.spec.ts`; `interaction-budget` for all 30 switches; `themes-visual` for the frame | WebView2 version and feature probe, envelope end times, input-not-blocked result |
| 5 | vitest registry and coverage; `carcass.spec.ts` on the real 28 entries | entry count, patterns used |
| 6 | vitest `left` incl. render counts; `hit-areas` on the left column; `themes-visual` left column | render counts, 44 px result |
| 7 | vitest `study`, `dmat`; `hit-areas` and `themes-visual` for the Study views and the Reader; `interaction-budget` for `paper`; the marks loop walked in a sandbox | the marks-loop result, paper reveal end time |
| 8 | vitest `life` + pytest `test_ww_life.py`; `hit-areas`, `themes-visual` for Life | undo and delete round trips |
| 9 | vitest `proof`; `themes-visual` at 1366 (rail) and 1500 (pinned) | rail and pin screenshots |
| 10 | vitest `tree`, `focus`, plus the existing tree suites unmodified; `perf-trace` Tree part; `hold` in `interaction-budget` | Tree p5 and rest-state rAF count, throw distance |
| 11 | vitest `career`; `hit-areas`, `themes-visual` for Career | paging result |
| 12 | vitest `setup`, `overlays`, `harvest`; `keyboard` for overlays; `themes-visual` for the 8 overlays | focus-trap and Esc-order result |
| 13 | pytest `test_phone_ww.py`; `phone-parity`; `hit-areas` and `themes-visual` at 390 px on `/phone/ww` | single-column and 44 px result |
| 14 | `npm run ww:verify`; `perf-trace` full | the 8.6 P5 table filled in, budgets, baseline review |
| 15 | `npm run ww:verify`; the click-count walk of 3.5 in a sandbox; ratchet counts | before and after click counts, ratchet numbers |

Total about 36 agent-days (A). The 26 before the 9 Nov bar grew by 1.5 (chunk 1a: motion vocabulary, theme crossfade, Playwright harness), 0.5 (1b: five more primitives and their specs), 0.5 (4: transitions on the real frame and the keyboard spec), 0.5 (5: coverage and carcass spec), 1 (7: dMAT view, queue and source lines), 0.5 (10: the `glide` motion and its trace), 0.5 (12: the harvester card), 0.5 (14: the full run), 1.5 (2b) and 3 (H). Parallelism: wave A = chunks 1a, 2, 2b, 3 and H (disjoint folders; 1a alone edits the shared CSS, `vite.config.ts` and `ww_sandbox.py`); wave A2 = 1b; wave B = 4 (needs the first group of 1b); wave C = 5; wave D = 6 to 12 in parallel (disjoint folders; chunk 7 consumes chunk 3's files and chunk 2's backend, and shows placeholders until 2b and H merge); wave E = 13; then 14, then 15. Critical path: 1a, 1b, 4, 5, then the longest of 7 or 12 (about 13 agent-days of the 36). Overlays are stubs in the registry from chunk 4, so chunks 6 to 11 depend on 4 and 5 only, never on 12.

What lands during the exam freeze (bug fixes only, from the freeze date in the plan): chunks 2, 2b, 3 and H are live-safe and additive (backend honesty, a new generator no screen calls yet, the maths fix in the old Reader, and a harvester that is off until the owner switches it on, whose disk bank changes nothing while it is empty); chunks 1a, 1b and the rest merge dark behind the flag; the flag flips only after the end-sems and the owner's OK. The question bank itself (CIE and later-semester questions, GATE twins) is content, not a UI chunk: it is plan item 4 and open questions 5 and 6, now fed partly by the harvester.

---

## 10. Open questions for the owner

1. DECIDED 9 Nov: `katex` is installed (0.16.21), lazy-loaded, fonts bundled locally.
2. DECIDED 9 Nov: Playwright is installed (1.56.1, with Chromium) for the layout, hit-area, theme-screenshot, motion and frame-rate protocols.
3. Are 3 regions on screen (left column, centre, proof rail) right during exam stress? If not, the fallback is one screen with sheets, using this left column as the hero.
4. DECIDED 9 Nov: one navigation. The rail keeps a single Well Wisher entry; chunk 4 makes the `Shell.tsx` edit and reports it.
5. A CIE paper: 20 marks, and in what sections? Will you paste past papers, or should the Counsel draft a bank for you to accept?
6. GATE questions: partly answered on 9 Nov by the harvester design (the permitted list, with openly licensed text stored and official papers and textbooks kept as pointers). Still open: the Q&A site's terms for GATE Overflow (unread), the NPTEL licence (unconfirmed, so pointer-only), any source beyond the list; and the app says "no GATE questions yet" until some are on disk (assumed yes).
7. One rank vocabulary: keep letter rank plus level, retire Core's "Rank 0/10"? (this plan assumes yes)
8. Season: Auto from the nearest dated paper within how many days (assumed 45)? Evening starts at 18:00 or when the last block is done: right?
9. Which workspace should the first open of a day land on in normal season (assumed Life)?
10. Quest log lives in Life (assumed), not on the left column: agree?
11. Themes: Saffron Ash default, Vibhuti Paper (light) and Indigo Night are placeholders, and the six workspace accents of 5.7.5 are first guesses (Study saffron, Tree green, Life rose, Career violet, Focus ink, Setup graphite); which do you want changed?
12. May the new workspace stay behind the flag until the end-sems, with the flip left to you?
13. Is "Close the day" wanted? It may need one new plan-log event; without it the evening primary is "See tomorrow".
14. What is your real window size and Windows scale (one screenshot of the app is enough)? The audit saw windows 898 to 984 px tall, the wireframes assume 1366x768 at 100 %, and at 125 % the left column loses rows (section 4).
15. Tree: should the 7-up "whole me" overview ship before the end-sems, or stay deferred as planned (each tree remembers its own view and selection meanwhile)?
16. Status: the 4-week line is an honest placeholder in this plan (a `Spark` primitive exists). Do you want it built before the end-sems?
17. Glass: keep `blur` as a hard ceiling, or allow `refract` as a measured opt-in (selectable only after the 20-switch sampler reports a 5th-percentile frame rate of at least 55 fps, and dropped the moment it falls under 50)? This plan allows the opt-in.
18. Harvester: may it run on its own once switched on (this plan: off by default, a supervised first run), and what disk cap for `data/bank/questions/` (assumed 500 MB, A)?
19. PDF ingestion: may I add a Python PDF library (for example `pypdf`), or should the harvester use only the local `pdftotext`? (Asking, per your rule on installs.)
20. dMAT sits as a view of Study (assumed), next to Papers, Plan and Library. Or do you want it inside Focus beside Drill?
21. Motion: the audit browser reports reduced motion, so you will see the full vocabulary only after Setup > Appearance > Motion is set to Full. Is a default of Auto right, and is 12 motions with six workspace tempos the right amount of extravagance?

---

## Objections considered

The adversary pass raised 22 objections. Those not listed here are fixed as asked. The ones below were taken in part or not taken, with the reason.

- Obj 19 (the Crucible wager is loss framing): the wager and the distraction guards stay. They are existing Crucible mechanics the owner built and the audit says must survive; they are now opt-in (off by default), neutral in copy, with no countdown before a session starts, and the loss-copy test runs on every page. Deleting them would delete a feature he chose.
- Obj 20 (badges are attention hooks): the due-now count stays as a plain number on the tab, because it is information he acts on; it is never a coloured or animated dot, and Appearance > Tab badges turns every badge off.
- Obj 10.1 (TREE-06, no 7-up overview): per-tree view and selection memory is added; the overview stays deferred as an owner decision (question 15), because it is a new canvas feature, not a placement fix.
- Obj 10.9 (CAREER-STATUS-22, no 4-week line): not built here; the honest placeholder stays and the owner is asked (question 16).
- Obj 10.8 (Core card left optional): it stays in chunk 9 with the owner's OK because it edits another section; a refusal is recorded in the gate report as an open finding, not skipped silently.
- Obj 3 (change the principle instead): the principle stays at 7 surfaces and the pages changed (stage strip merged into the paper list's head; This week below the fold), because that cap is what the redesign is for.
- Obj 22 (spring and contrast arithmetic) and the section F passes: the critique itself found the damping ratios and the contrast table correct (differences of 0.04 at most), so nothing changed.
- Obj 21 (personal data): already applied before this revision; confirmed by grep that the dated request line and the old academic-standing label are absent and that no line says which papers have banks (only "13 of 16").

### The 9 Nov revision: calls made, and what is not verified

- No GSAP, Lenis, WebGL or smooth-scroll library, though most reference sites use them: none is approved, the cost lives in them, and 6 of the 8 readable sites ignore reduced motion. The extravagance comes from the vocabulary, the section themes and the weight rules, on CSS, IntersectionObserver and a few hundred bytes of JS.
- `--dur-celebrate` falls from 640 to 400 ms so that nothing animates over 400 ms except the workspace switch (600 ms cap, 520 ms planned).
- `refract` glass stays out by default and is a measured opt-in (question 17); the Back chip is added to the allowed glass surfaces.
- dMAT is placed in Study as a fourth view (question 20), not in Focus, because it is exam preparation; it is a mode, not a tier.
- Chunk 1a grows from 1.5 to 3 days on purpose: every later chunk consumes the motion vocabulary, the workspace layers and the harness, so a wrong token costs more later than a day now.
- Not verified: whether Chromium's view-transition overlay swallows input without `html::view-transition { pointer-events: none }` (the P6 spec decides); the installed WebView2's support for `animation-timeline`, `inert` and `startViewTransition` (chunk 4 records it); the real layer counts (an assumption until the sampler runs); headless frame rates against a GPU run; the 6 KB gzip budget; whether Indigo Night's Study and Career accents are distinguishable; and the studies themselves (4 of the 12 reference sites could not be read, and the press-and-hold pattern was not found in its site's code, so `hold` is our own design).

### The 9 Nov speed-and-honesty pass (adversary 2: 19 objections taken, 7 probes rejected)

The full critique with numbers is private (`data/notes/well-wisher/ui-audit/2026-11-09/taste-critique.md`). Taken and applied above: the frame is snapshotted unless root is un-named (5.7.4); the Tree is SVG, not canvas, so its pan is main-thread paint (5.6, 5.7.3 #7, 5.8.9); the lit-path draw is an opacity fade; the switch and paper layer counts were 9 and 10 against a cap of 6 and are now 6 each (5.7.2, 5.7.3, 5.8.9); the glass sampler runs only while something animates; tilt stops its loop at rest; the idle claim is scoped to `ww` with the Shell's own timers listed; hover lift moves an inner face; glass is off every text-bearing header; the sandbox guard uses a token-guarded route; absolute frame-rate floors gate only GPU runs; "Fetching" is worded from the harvester's real state; `fill` never animates an unknown value; the contrast table's Study row and the `--ink-disabled` cells are corrected; `three` is banned under `ww/`; the Python dependencies are named; `core-shot` is local; a no-re-mount test is added.

Rejected, with the reason:
- Backdrop-filter outside the nav/control layer: none found. Every glass mention is a header, the Back chip or an inspector edge, and cards, columns, the tab strip and the Reader body are opaque; the objection that did hold (text on glass) is applied.
- Animation of layout properties: none specified in `ww/`. The legacy `rise` (filter) and `.bar > i` (width) stay in the old UI and are replaced in `ww/`; folds, the Crucible collapse and toasts snap.
- A dependency beyond `katex` and `@playwright/test` on the JavaScript side: none. The spring and bundle scripts use node only and `vite preview` ships with Vite. The Python side is named in 5.8.6.
- WebGL added to a page that has none: none specified; only a guard against a later import is added.
- A "coming" placeholder that loops: none. `ComingCard`, `Skeleton` and `LockChip` are static or one-shot and `carcass.spec.ts` asserts it; the pretending case ("Fetching") is fixed.
- A theme change that re-mounts a page: by design only a workspace switch mounts a workspace; the Appearance theme is an attribute change, and a test now proves it.
- A contrast pair under 4.5:1 body or 3:1 UI: none among about 150 recomputed pairs; `vite preview` ignoring the proxy is also rejected (Vite's `preview.proxy` defaults to `server.proxy`, from the Vite docs; chunk 1a confirms when it adds `WW_API_TARGET`).

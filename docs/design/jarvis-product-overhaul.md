# JARVIS and Well Wisher product overhaul: design specification

Written 2026-11-12

**Direction v2 (13 Nov 2026).** The owner changed direction on 13 Nov 2026. Section 20 holds the revision and **governs wherever it contradicts an earlier section**; the earlier subsections it supersedes carry a one-line pointer. Read section 20 first, then the section you need.

**Expanded horizons (14 Nov 2026).** The owner confirmed that "gcr" is Google Classroom, approved four installs and asked for an exam-paper harvester, dashboards and a wider feature set built in two parallel lanes by two chats. Section 21 holds the revision; **it governs wherever it contradicts section 20 or section 15.6**. Section 15.6 is rewritten as two lanes, and sections 16.9, 17.5, 19 and Appendix A carry the matching decisions, questions, rules and package blocks.

**Status.** Design. This file is the design source of truth for the overhaul of JARVIS and Well Wisher. It supersedes nothing yet: until the flags it names (`app.shell`, `ww.ia`) flip, the existing plans keep governing the code that is built and running. The precise relation to the three existing design documents in this folder:

| Document | Date | Relation to this specification |
|---|---|---|
| `clay-overhaul-brief.md` | 10 Nov | The owner's brief. It is the input this specification answers, ask by ask (clay look, genres, art centrepieces, voice hill, no page scroll, daily use, a control for every planned feature). It stays as the record of what was asked. This specification narrows two points, both logged: "variable but honest rewards" becomes deterministic, optional rewards from a visible sequence (D17, F2), and "streaks shown as facts" becomes totals that only go up with rest days built in (§2.4). Its rule that the voice hill shows the real signal is kept and made testable (§9) |
| `app-ui-overhaul.md` | 9 Nov | The plan for the shell, foundation, loose ends, phone shell and the seam. Its decision 1 ("no unified theme, each section a different brand") is already overtaken by the 10 Nov brief; this specification reconciles the two as one shared clay material with a per-section world (§6.1, §8). Its loose-ends list (orphan cards, duplicate PhoneCard, Uno leftovers) is absorbed in §5.3. It remains authoritative for chat ownership of files until §17 (X1) is answered. It is superseded section by section only as each flag flips |
| `well-wisher-ui.md` | 9 Nov | The plan for the built Well Wisher frame: pages, wireframes, tokens, tests, the motion system (its 5.7) and the carcass. It stays authoritative for the built behaviour and its tests until `ww.ia` flips. This specification re-homes its six workspaces and the Left column into five sections (§3.1, §5.4), extends its motion system app-wide (§10) and generalises its planned-feature registry (§12) |

The research behind every number is `docs/research/product-design-overhaul.md` (Strands 0 to 6; index in Appendix B). Nothing in this file edits application code, CSS, routes or tests.

**Contents**

1. 0 Executive summary and how to read this
2. 1 Product thesis
3. 2 Users, jobs, daily loops and ethical retention
4. 3 Information architecture and section map
5. 4 Screen-by-screen workflows (desktop and mobile)
6. 5 Migration map from the current carcass
7. 6 Design system
8. 7 Component inventory
9. 8 Art direction and asset policy
10. 9 JARVIS voice visualiser
11. 10 Motion system
12. 11 Responsive, keyboard and accessibility
13. 12 Planned-feature registry
14. 13 AI, personalisation and local learning loops
15. 14 Engineering feasibility and performance budgets
16. 15 Implementation roadmap and work packages
17. 16 Decision log
18. 17 Open questions for the owner
19. 18 Risks
20. 19 Do-not-build list
21. 20 Direction v2 (13 Nov 2026): what changed and what now governs (placed after section 19; it governs where it contradicts an earlier section)
22. 21 Expanded horizons (13 to 14 Nov 2026): the exam generator first, the classroom connector, dashboards, and the wider feature set (placed after section 20; it governs where it contradicts section 20 or 15.6)
23. Appendix A Implementation prompts
24. Appendix B Research index

---
## 0 Executive summary and how to read this

### 0.1 What this is

A complete design for turning two products that share one shell today into one coherent product now and two separable products later: **JARVIS** (the place: voice, memory, switches and Wi-Fi sensing for a room and the person in it) and **Well Wisher** (the day: one question, "what is the next small thing, and is the semester on track?"). It covers the thesis, the users and loops, the section map, every screen at 1366x768 with dimensions, the migration from the existing code, the design system, 38 components, art direction with a two-track rights policy, the voice visualiser, motion, accessibility, the planned-feature registry, where a model belongs, performance budgets, a 27-package roadmap and the agent prompts to execute it.

### 0.2 The decisions that shape everything else

*Superseded in part by 20.2 (decisions D-V2-1 to D-V2-28); items 8 and 10 are changed by D-V2-1 and D-V2-22.*

1. **Base proposal: "two brands, one seam" (D1).** The two products share a shell, tokens, kit, motion governor and a planned-feature mechanism, and meet only through four ports (`voice`, `memory`, `notify`, `ambient`) with null adapters (§1.4). A `VITE_PRODUCT=ww` build contains no module from `jarvis/` and no three.js, and the reverse (§1.4, §5.7).
2. **Ten sections, five per product, one rail, one title bar (D2, D3), ordered by how often they are reused (I37).** Replaces 14 dock items plus 6 workspace tabs (20 navigation targets) with 10 sections plus the Proof rail and three shell sheets (§3.1, §3.4). All ids are frozen (§3.2); their order is not: the rail, Ctrl+1 to Ctrl+5 and the view switches list the most reused first (JARVIS: Core, Room, Senses, Memory, Console; Well Wisher: Day, Focus, Study, Tree, Career), from the estimates in §3.1.2.
3. **Honesty is typed (D12).** Every reading carries one of five lamp states (LIVE, WAITING, SIMULATED, PLANNED, FAULT), shown by shape plus text, never colour alone; a unit test fails any widget that renders a number without a state (§6.6).
4. **The voice hill is a reading or it is not drawn (D23).** It is driven only by a real analyser level; with no signal it shows a hollow, still placeholder that says so (§9).
5. **Depth is feel, edges are legibility (D11).** The neumorphic recipe computes to 1.27:1 and 1.72:1 (Strand 2), so every control also gets a real 3:1 edge, an icon or text, and a 2 px outline focus ring; the accent orange is a fill only (2.83:1 on the light ground) (§6.1, §6.3).
6. **No coercion (§2.4, §2.5).** No loss-framed streaks, fake urgency, variable rewards, leaderboards, nagging or claim to manage, treat or screen for ADHD; a Quiet switch the app cannot lift; at most three user-set check-ins a day.
7. **Signals only (§1).** Aankhen is Wi-Fi CSI with no camera and no radar; one link sees that a body moved, not its pose; simulated data is never shown or spoken as measured.
8. **Art is derived, never pasted (§8).** One centrepiece per section; every moving piece has a static and a reduced-motion form; one canvas in the whole product (the hill); "growing" art is a pure function of the current real counts (it never changes with time, has no high-water mark and may fall if the student deletes or un-marks something, and each caption says so). A private-build track (a non-distributed taste study, §8.6.2) and a customer-release track keep the public repository clean; the two builds differ visually until the customer-quality gate Q04 passes (§8.6.3).
9. **Models only where they beat a rule (§13).** FSRS, voice activity detection with a wake word, a narrow local drafting model; rules for proficiency, next action and energy; embeddings only after a local A/B.
10. **The UI/UX overhaul is priority one and is built to scale (I33 to I36, owner decision of 2026-11-12 evening; §15.1, §15.2).** There is no exam freeze: the programme runs straight through, and exam features, relay and wall-box work wait until the UI/UX is remapped, then resume. The ordering principle is **shared layers first, sections after**: tokens, kit, lamp, registry, shell, ports, then the ten sections on top of them. Quality safety stays: flags default off for risky flips, the app works at every merge, nothing is built into `dist` while the app runs, live-process changes sit behind an env flag. Work that only measures (R01 and the like) runs alongside the build and no longer blocks it. Well Wisher's section map still flips behind `ww.ia`, with "moved to" hints after the flip.

### 0.3 How to read this file

| If you are | Read first | Then |
|---|---|---|
| The owner | §0, §17 (the questions that need you), §16.2 | §4.3 and §4.4 for the screens |
| A designer | §1 to §3, §6 to §8 | §4, §9 to §11 |
| An engineer | §3.2 (frozen ids), §3.3 (geometry), §5, §14, §15 | Appendix A for the prompt of your work package |
| A reviewer | §16 (every decision and every deviation), §18, §19 | §14.1 (every budget) |

### 0.4 What the numbers mean

Every number in this file is one of four kinds. **Research** numbers cite a strand of `docs/research/product-design-overhaul.md` (Strand 0 is the code audit, Strands 1 to 6 are web research). **Computed** numbers say how they were computed (the WCAG 2.2 relative-luminance formula for contrast, shown arithmetic for geometry); the contrast oracle is a script named in §6.3. **Target** and **assumption** mark numbers nobody has measured; all geometry and every performance figure is a target until the measurement session on the real WebView2 window (F8, work package R01) replaces it. Click counts are counts of written steps, not measurements. No screen was rendered; no art was drawn; no application file was changed.

### 0.5 Cross-reference key

Sections of this file are written `§N.M`. The source specification was assembled from a core text and six parts, and decision ids keep their original form: `D1` to `D24` (core decisions), `I1` onward (integration decisions made while assembling, §16.3), `F1` to `F14` (core open questions), `K1` to `K16` (risks), `T1` to `T10` (registry tests), `S1` to `S6`, `X1`, `X2`, `C1` to `C7` (part-level questions and conflicts, §17). "Strand N" always means Strand N of the research file. The word "core" has two meanings: the voice and brain process behind the Core page ("core state", "the core reports", `core/playback.py`), and, only in the decision log, the core specification text (§16.3 defines which sections). Catalogue ids such as C02-02 name reference pictures from the owner's private collection by neutral description only; no picture is embedded or reproduced anywhere in this file.

**Where the source texts' older section letters landed** (for anyone holding an earlier draft): thesis A is §1, users B is §2, information architecture C is §3, visual foundation D is §6.1, §6.3 (palette) and §6.6 (lamp) plus §8.1 (centrepieces), decisions E is §16, open questions F is §17.

### 0.6 Counts at a glance

*Superseded in part by 20.13 and 15.6: views 36, 47 new work packages in 10 waves, 78 new components.*

| Item | Count | Where |
|---|---|---|
| Sections | 10 (5 per product) plus the Proof rail | §3.1 |
| Views | 34 in the ten sections (computed from the table in §3.2: JARVIS 2 + 2 + 3 + 4 + 5 = 16, Well Wisher 4 + 3 + 5 + 1 + 5 = 18 in the rail order Day, Focus, Study, Tree, Career; the unit test `viewCount.test.ts` asserts 34 against the id table so the count cannot drift) | §3.2 |
| Components | 38 (11 + 10 + 10 + 7) | §7 |
| Reference pictures assigned | 186: 150 sit outside the deck section (149 product slots plus one recorded refusal, C01-25, which sits in `room`) and 36 in the deck section (24 refusals and 12 mood and technique pictures); 25 refusals in all. Counts come from `tools/art/count_assets.py` over the JSON (§8.7) | §8.7 |
| Decisions in the core log | 24 (D1 to D24) | §16.2 |
| Planned-feature entries | 28 Well Wisher carried over, 6 new Well Wisher, 13 JARVIS plus one phone row | §12.6 |
| Work packages | 32 (R 4, V 4, P 3, B 17, Q 4; the review of 2026-11-12 added B03b, B03c, B05b, B06b and Q04) | §15.3 |
| Open questions | F1 to F14 plus part-level items | §17 |
| Risks | K1 to K16 | §18 |

### 0.7 First action

**Start work package B03 now (§15.4): tokens layers 1 to 3 as new, attribute-scoped files, the lowest shared layer and the one every other layer reads.** It is additive (no existing rule or font changes until B13), needs no measurement and no owner answer to begin, and runs in parallel with R01, the measurement session (frame time, memory, idle CPU, the real maximised window size; F7, F8, X1), which no longer blocks it. The second package in flight is B01 (seam cuts, disjoint files), which waits only for the owner's one-line answer to X1. R01 still needs the owner's OK for one app restart (a restart turns the relays off); its numbers replace the targets when they land.

### 0.8 Self-review against the brief

The brief asks eight questions. Each answer cites a section and says whether it is verified (a computed or tested fact) or unverified (a design claim until a measurement or an owner session).

| # | Question | Answer | Where | Tag |
|---|---|---|---|---|
| 1 | Does a first-time user find the highest-value action in seconds? | Partly. One filled primary per product (JARVIS: Wake; Well Wisher: Start a 10-minute block, which asks "what was it for?" once, optionally, after it ends). JARVIS first run is one screen with no picker (§4.2.5). The V01 pass line is 10 s. | §3.5, §4.2.5, §8.4, V01 | unverified (mocks only) |
| 2 | Does a returning user resume without hunting? | Yes by design: Resume pill, stale-record rule, missed-days line. | §3.4, §4.2.3, P03 | unverified (P03 not run) |
| 3 | Does each visual treatment clarify purpose? | For the centrepieces, yes (each row has "what drives it" and a growth rule). The four bespoke route sweeps, the sigil watermarks and the scanline overlay did not; they are replaced by one shared sweep, removed, or removed (review 2026-11-12). | §8.1, §8.4, §10.5 | unverified |
| 4 | Is every planned feature unmistakably honest? | Yes by design: lamp shapes, dashed plate, registry tests T1 to T10, V02. Built-but-unverified code is WAITING "built, not verified", never PLANNED. | §6.6, §12.4, V02 | unverified (V02 not run) |
| 5 | Does it run gracefully on the laptop with no idle visual overhead? | Specified (one canvas, SVG elsewhere, governor, activity gate); every figure is a target until R01. Budget rows are split into sandbox-measurable and real-window-only. | §8.8, §10.6, §14.1 | unverified |
| 6 | Does reduced motion preserve the whole experience? | Yes: every art row has a reduced-motion form carrying the same information; the voice picture keeps state, source and level. | §8.3, §9.10, §10 | unverified (tests specified) |
| 7 | Are JARVIS and Well Wisher distinct yet one system? | Mostly. Distinct by accent budget, tempo, default theme and copy; radii, chrome ground and corner treatment are product-scoped so neither product borrows the other's silhouette. | §1.2, §6.3.5, §6.3.6 | unverified (V03) |
| 8 | Are all visual sources used with purpose rather than forced? | Partly. 111 of 186 are component references; each must name the single trait it contributes (Appendix C); 50 are never rendered and are labelled "reference" or "refused", not "use"; refused ids may not appear in §7 or §8 (A.Q01 check). | §7, §8.7, Appendix C | partly verified (script check) |

---

## 1 Product thesis

### 1.1 Thesis

1. **JARVIS is the place.** A local-first personal operating system for a room and the person in it: voice, memory, switches and Wi-Fi sensing. It is judged by whether it answers fast, tells the truth about what it senses, and keeps data on the machine.
2. **Well Wisher is the day.** A student life system with one question: "what is the next small thing, and is the semester on track?" It is judged by whether a returning student resumes in one tap after a bad week and is never made to feel guilty.
3. **They are one product today and two products later.** They share one assistant voice, one memory, one shell grammar and one paired phone, reached through four narrow ports. Each works with the other absent.
4. **Honesty is the signature.** Every reading carries a state (§6.6). A feature that is not built is a labelled, dashed, explained home and never a fake switch. Art that moves encodes a real state or marks a transition, and always has a static form.
5. **Nothing coerces.** No streak loss, no fake urgency, no leaderboards, no variable rewards, no claim to manage, treat or screen for ADHD.

### 1.2 How they differ

| | JARVIS | Well Wisher |
|---|---|---|
| Question it answers | "What are the room and the machine doing, and what can I ask of them?" | "What do I do next, and does it add up?" |
| Role | Instrument: glanceable, mono readouts, honest signals | Notebook on a desk: calm sentences, one primary action, recovery language |
| Typical visit | Seconds, many times a day, often by voice | A block of study, minutes to hours |
| Tempo (motion durations, target) | 80 to 160 ms | 160 to 280 ms (Strand 2 and the built governor; B in judging) |
| Brand colour use | No accent hue of its own: bone and charcoal plus the provenance triad (cyan measured, amber simulated, red fault) so colour only ever means state (Strand 1, W9) | One warm accent (orange, `--accent-fill`) for the single primary action and exam proximity only; section marks are limited to a hue budget of one accent plus at most three section marks (§6.3.5) |
| First-run default theme | clay-dark | clay-light |
| Copy voice | Dry, warm butler, mono metadata, English. Decided once here and reconciled with the owner's persona brief: understatement, a light callback to something the owner said earlier, no joke about a fault, a failed reading or a refusal | Plain, kind, no outcome claims |
| May name | rooms, devices, signals | classes, papers, exams, goals |
| Must never borrow | student-wellbeing claims (Strand 4, architecture notes) | home or sensing claims |

### 1.3 How they connect (one assistant, one memory, one grammar, one phone)

| Shared thing | What is shared | What stays each product's own |
|---|---|---|
| **One assistant** | The Ask orb in the rail, the `voice` port (`speak(text)`, `inputLevel`, `outputLevel`, `state`), the command palette's Ask group, the persona rules | Wake word, speech-to-text, text-to-speech engines and the room-aware commands (JARVIS); academic nudges are plain text unless the port is present (Well Wisher) |
| **One memory** | The `memory` port (`remember(ns, fact)`, `recall(q)`, `export(ns)`, `forget(ns)`); one export and delete flow; one plain-language statement of where data lives | Namespaces `jarvis/*` and `ww/*`; Memory (Yaadash) is JARVIS's UI for its namespace. Well Wisher has a local fallback store (assumption: reuse its existing stores) so it works alone |
| **One shell grammar** | Title bar, rail, Resume pill, command palette, overlay depth rule (one deep), kit, lamps, tokens layers 1 and 2, motion governor, planned-feature registry mechanism, keyboard map | Section content, section themes (token layer 3), art, copy, stores, registries |
| **One phone** | One pairing, one token, one generated `phone_page/tokens.css`, the same lamp shapes and motion rule | Two pages and two web manifests: `/phone/` (JARVIS) and `/phone/ww` (Well Wisher), so either ships alone |
| **Notify** | One toast and reminder layer; the Quiet switch silences all of it | What triggers a reminder |
| **Ambient (optional)** | A read-only `ambient` port: `{motion_recent, source, predicting}` (motion seen in the last 60 s, never "present" or "empty": one link cannot see a still person) and the room mode. Well Wisher may offer "study lights" through it only on the student's tap; off by default | Aankhen implements it; Well Wisher never infers attention or mood from it (§2.4, rule N5) |

#### 1.3.1 What leaves the machine, whom sensing covers, and what the phone can do

**Egress register (built in R01, verified by a whole-app network trace in Q03).** `memory.keep` never states "nothing leaves" as a fixed claim. Its statement is generated from a register with one row per outbound path (host, trigger, user-initiated or not) and reads "designed to stay on this machine; exceptions: <list>" until Q03 has verified the register against a trace, then "verified on <date>; exceptions: <list>". Known exceptions to list at the start (assumption, R01 confirms or extends):

| Path | Trigger | Initiated by |
|---|---|---|
| The app opens a Spotify search in the Spotify app or browser | A button in `core.sound` | the owner |
| The Review-for-Claude export (renamed "Share a review") | The owner sends the file somewhere; the app itself sends nothing | the owner |
| Phone traffic over the home LAN | A paired phone talking to the app's listener | the owner (pairing) |
| Model or package downloads | An install the owner approved | the owner |
| Local voice paths (Kokoro, pygame, Ollama) | Local processes on 127.0.0.1 | n/a (no external host) |

**Sensing covers everyone in range.** The Wi-Fi link detects the motion of anyone in range (family, visitors) and identifies no one. Therefore: a persistent **SENSING ON** annunciator in the title bar and in the `senses` view header with a one-tap **Pause sensing**; **Delete raw signal now** and a retention control in `memory.keep` (default 7 days, the owner's decision; shorter allowed); and the line "detects motion of anyone in range, identifies no one" printed on the Senses screens themselves. Seven days of raw CSI is an occupancy-pattern record, so it is treated as private data, never exported by default and never shown as an activity or sleep record.

**The phone.** The pairing token is scoped per page: the JARVIS page token can talk, switch the room and read the Senses status list; the Well Wisher page token can act on Well Wisher routes only; neither can export memory, read raw CSI or edit rules. Phone Talk shows a persistent mic-open indicator and a stop control (§4.6.1).

### 1.4 The seam (separation is a build target)

Four ports only: `voice`, `memory`, `notify`, `ambient`. A fifth needs a decision-log entry.

| Layer | Shared (`app/ui/src/shared/`, `app/ui/src/shell/`) | JARVIS owns (`app/ui/src/jarvis/`) | Well Wisher owns (`app/ui/src/ww/`) |
|---|---|---|---|
| Tokens | Layer 1 primitives, layer 2 semantic tokens, provenance tokens, clay shadow tokens, type scale | `[data-product=jarvis]` brand layer and the five section themes | `[data-product=ww]` brand layer and the five section themes |
| Kit | The 31 built kit exports move up (Button, Segmented, Drawer, Sheet, Popover, Toast, Meter, Row, Skeleton, EmptyState, HoldButton, ComingCard, LockChip ...) plus the lamp | Dial, VoiceHill, RingBars, ChannelMatrix, TerminalFrame | StageStrip, Stat, TapGroup, CoachMark, DayDial |
| Motion | Governor (`high`, `low`, `none`), reduced-motion path, Calm switch | Hill and ring budgets | Reveal choreography |
| Registry | `plannedFeatures` mechanism and the "What is coming" overlay | JARVIS entries | Well Wisher entries (28 built, Strand 0 section 2) |

Acceptance test, defined now and enforced in the first implementation phase (target): a `VITE_PRODUCT=ww` build contains no module from `jarvis/` and no three.js; a `VITE_PRODUCT=jarvis` build contains no module from `ww/`; an ESLint `no-restricted-imports` rule plus a vitest import-graph test enforce it; `scripts/bundle-budget.mjs` is extended to check each build. Each port ships a null adapter so each product renders its honest empty state when the other is absent ("text only", "no sensing here").

The couplings that exist today and must be cut first (Strand 0, section 7.2): Core's MissionCard imports Well Wisher stores (delete it); `App.tsx` mounts FxLayer, GameFx and Dialogs on every JARVIS page (mount only inside the `ww` root); `primitive.css` is scoped to `.ww` only (re-scope to the shared layer); two navigations (one, see §3.4); the phone has three palettes (one generated file).

Commercial note, not a design driver: openWakeWord's pretrained models are CC BY-NC-SA 4.0 (Strand 0, "What it changed" item 6). Fine in the personal app; a blocker for a sold JARVIS. Well Wisher has no wake word and is unaffected. Flag in the roadmap; do not design around it.

---

## 2 Users, jobs, daily loops and ethical retention

### 2.1 Users

- **The student (primary, both products).** A taste-conscious young person on a 1366x768 laptop, in a semester with dated papers, subjects they find hard, a long-range career decision, and attention that drifts. Judges an app in ten seconds by how it looks and whether it demands setup. Will not tolerate guilt copy or streak loss (Strand 1: the Harvard farewell audit found manipulative farewells in about 37 % of 1,200 companion farewells).
- **The builder-resident (primary for JARVIS).** The same person wearing the owner's hat: runs the room, the wall box, the ESP32 and the phone; wants to see what the room knows and delete it; reads "predicting, not measured" without help. Two hats, one human; the student's loops never route through operator screens.
- **The buyer-to-be (secondary).** Someone who would buy Well Wisher alone (no hardware) or JARVIS alone (no student life). Their first ten minutes decide the product, so each product has its own first run and empty states.

### 2.2 Jobs to be done

| # | When ... I want to ... | Section.view that owns it |
|---|---|---|
| J1 | I open the app after any gap, land where I stopped with one next step and no guilt | shell Resume (every product) |
| J2 | I plan the day in under three minutes with "when X, I will Y" starts (Strand 4, USE 1) | `day.today` |
| J3 | A class ends and I have a gap, see how long it is and start a block that fits | `day.today` |
| J4 | I sit down to study, run one block on one thing, see elapsed time calmly, log it in one tap | `focus.session`, overlay `log` |
| J5 | An exam is near, see papers, weak topics, dates, and what to do tonight | `study.papers`, `study.plan` |
| J6 | I close the day, see what really got logged, set tomorrow's first start, stop | `day.close` |
| J7 | I need a real break, take one without penalty | `focus.rest` |
| J8 | I choose what to learn next and why | `tree.tree` |
| J9 | I think about the longer road, see the next concrete step | `career.pipeline` |
| J10 | I want to know it is working, with honest proof | rail `proof` |
| J11 | I want to talk to it and see that it heard me | `core.talk` |
| J12 | My hands are busy, switch the light or fan and see the board confirm | `room.switches`, rail All off |
| J13 | I wonder if someone is moving in the room, honestly | `senses.presence` |
| J14 | I want to know what it remembers, fix it, export it, delete it | `memory.*` |
| J15 | Something is broken, name the one part and give a fix | `console.health` |
| J16 | I hand over the phone, show only what makes sense on it | phone (§3.5) |

### 2.3 Daily loops

A loop has a trigger, one screen, one action and a close. The section map in C is derived from these.

**Well Wisher loops (notebook tempo, minutes)**

| Loop | Trigger | Where | The one action | Close |
|---|---|---|---|---|
| W0 Resume | Opening the app after any gap | Last section and view; Resume pill | "Pick up: <thing>" or "Start fresh" | Pill clears when the thing is done or dropped |
| W1 Plan | First open of the day, or a user-set time | `day.today` | Choose up to three starts: "When <cue>, I will <step> for <n> min" | Plan saved; cue times become the only optional check-ins |
| W2 Class gap | Timetable slot ends | `day.today` | "Start a block in this gap" (+25, +50, +90 presets, the same taps as the phone) | Block opens in `focus.session` |
| W3 Block | Cue time or tap | `focus.start` then `focus.session` | Begin; Pause; Done | Log-minutes sheet (overlay `log`), back to `day.today` |
| W4 Break | Block ends, or Rest tapped | `focus.rest` | Take 5, or skip with no penalty | Back to the block or the day, remembered |
| W5 Close | User-set time or tap | `day.close` | Confirm today's real log; pick tomorrow's first start | "Done for today"; the app then goes quiet |
| W6 Exam season | Server `season` is exams | `day.today` gains an exams strip; `study` opens on `papers` | "Do tonight's paper" | Proof updates with real marks only |
| W7 Missed days | Return after one or more days | Resume pill and one calm line | "Pick up here" | No counter resets, no red, no apology copy |

**JARVIS loops (instrument tempo, seconds)**

| Loop | Trigger | Where | The one action | Close |
|---|---|---|---|---|
| J-L1 Ask | Speaking, or the Ask orb | `core.talk`, or the orb anywhere | Say it | Three honest stages: heard, working, done or failed with reason (Strand 1, J-principle 1) |
| J-L2 Room | Passing the laptop, or voice | `room.switches`; rail All off | Tap a channel | State comes from the board's own report (cyan "confirmed by board") |
| J-L3 Recall | "What do you remember about ..." | `memory.recall` | Search | Real excerpts; fix or delete in place |
| J-L4 Weekly | At most three belief questions | `memory.beliefs` | Answer | Amber until answered |
| J-L5 Owner check | Something feels off | `console.health`, `senses.signal` | The one fix that applies | A log line in `console.events` |

**Targets (all assumption until measured in Playwright tap counts and on the real window):** app open to a running block in 2 taps; resume in 1 tap; log minutes in 2 taps; first run to first running block in 30 s with no setup gate (Strand 1, Tiimo's setup cost is a documented complaint); an operator task that took one tap on the old dock takes at most two.

### 2.4 Ethical retention principles (binding; from Strand 4)

**USE (evidence plus low harm).**

| # | Pattern | Rule | Evidence note |
|---|---|---|---|
| U1 | If-then start planning ("When X, I will open Y for 10 minutes"), editable, optional, resurfacing at the cue time | Plan for a small-to-moderate effect. Never quote d = 0.65; the 2024 update (642 tests) reports .27 to .66 and secondary sources give bias-corrected d = 0.35 (verify before quoting) | Strand 4, finding 1. ADHD evidence is child lab tasks only |
| U2 | Missed-day re-entry: neutral, kind, one-tap resume, no counter reset to zero, no penalty | Totals only go up; rest days are first-class in the week | Breines and Chen 2012 (self-compassion, student lab samples); Strand 4, finding 6. Inference, not a tested app intervention |
| U3 | Notification budget | At most three batched check-ins a day, user-set, silent by default on first install, one-tap mute, no urgency words | Fitz 2019 (237 participants: three batches a day helped, hourly did not); Kushlev 2016 (221 students) |
| U4 | Calm, opt-in elapsed-time display (disc or bar, no flashing, silent end option) | No countdown pressure | Time-perception research is real (Zheng 2020, 27 studies); the benefit of visible timers is unproven. Say nothing about efficacy |
| U5 | Task splitting under user control | Suggest a first small step, let the student edit it; never auto-lock a task into micro-steps | No trial found; practice, not proof |
| U6 | The SDT check on every feature | "Who chose this? Can I decline it? Does it show I got better? Does it connect me to someone I chose?" | Peters, Calvo and Ryan 2018 (METUX). Check each instrument's licence before embedding questionnaires verbatim |

**TEST (local, the owner's own data, no external telemetry, no claims until tested).**

| # | Test | Measure |
|---|---|---|
| T1 | Rolling "days this week" with built-in rest days versus plain total days | Return after a gap, not opens |
| T2 | Body-double presence: a silent "session is live" indicator, no fake partner | Self-reported fit only. Evidence is one 12-person preprint (Strand 4, finding 4) |
| T3 | Timer style: disc, bar, or none | Self-reported anxiety and block completion |
| T4 | Competence feedback only (progress, the skills tree), no leaderboards, no loss mechanics | Hanus and Fox (about 71 students, badges plus ranking lowered motivation and scores) is the warning |
| T5 | Cue-time wording: plan echo versus generic nudge | One sentence, no emoji, no guilt |
| T6 | "Tiny start" label | Whether starts happen, not whether tasks finish |

**NEVER (house rules).**

| # | Never | Why |
|---|---|---|
| N1 | Loss-framed streaks, countdown-to-loss, streak repair, "you'll lose your tree", "your plant is dying" | FTC names false countdowns as dark patterns; the EU Digital Fairness Act consultation names streaks as addictive design (Strand 4, finding 11) |
| N2 | Variable or randomised rewards, mystery boxes, pull-to-refresh novelty | Conflicts with autonomy (SDT); regulators name the pattern |
| N3 | Nagging: re-asking after a decline, escalating frequency, "we miss you" re-engagement | Gray 2018 taxonomy; DSA Article 25(3) |
| N4 | Obstruction: hidden mute, export, delete, reset; confirm-shaming; default-on engagement; harder to leave than to start | Same |
| N5 | Fake measurement: invented progress, a "focus score" or attention estimate, simulated data shown as measured. No use of Wi-Fi sensing to infer attention or emotion | Project honesty rule |
| N6 | Leaderboards; any claim or screening that reads as ADHD diagnosis or treatment | ASA and MHRA rulings (Strand 4, finding 12) |
| N7 | Points for opening the app or any reward that substitutes for the task | Count completed planned actions, not opens |

**Architecture rules that follow.**
- A "Why am I seeing this" line on every nudge. One **Quiet** switch (in Settings) that disables every nudge, check-in and sound cue, and that the app cannot lift.
- Any engagement analytics stay local and visible to the student; no external telemetry.
- Rewards are deterministic and optional: one short moment per real completion (Things-style checkbox, Tiimo-style small delight), from a fixed visible sequence. This narrows the owner's 10 Nov wording ("variable but honest rewards"); logged as decision D17 and open question F9.
- Exit without guilt: ending a session, leaving a chat or closing the app triggers nothing.
- Strictness settings (for example a pause before opening a distraction) are the student's choice and free (Opal publishes a 7 s pause; Strand 1).

### 2.5 What the product may say and may not say

| May say (plain functions) | May not say |
|---|---|
| "Plan when and where you will start" | "Manage your ADHD", "fixes focus", "clinically proven" |
| "Break a task into steps" | "ADHD mode", "screens for ADHD", test-style calls to action |
| "See how long a block has run" | "Scientifically proven to build habits", any retention or efficacy number |
| "Pick up where you left off" | "Your streak is at risk", "don't break the chain", "we miss you" |
| "Designed with attention difficulties in mind" only if the design basis is stated with no outcome promise | "Neurodivergent-friendly" as an efficacy claim; borrowing EndeavorRx or any regulated product's wording |

Draft re-entry copy for the copy specialist (not final): "Pick up here: Paper 2, topic 4." and "Rest days are part of the week." App-store text, README and in-app copy must agree, because the MHRA and ASA tests look at all promotional material. Legal review by a UK or EU qualified reviewer before any public launch (Strand 4, "Uncertain").

---

## 3 Information architecture and section map

**The binding list for every specialist** (from the core):

1. The section ids, view ids, overlay ids and shell ids in §3.2 are frozen. Use them verbatim in file names, `data-section`, `data-view`, route fragments, test ids and the asset manifest.
2. The geometry in §3.3 (1366x768 budgets) is the contract every layout is drawn against.
3. The five-state signal lamp (LIVE, WAITING, SIMULATED, PLANNED, FAULT) in §6.6 is the only way a reading or a capability state is shown.
4. The ethical rules in §2.4 and the say / do-not-say list in §2.5 are binding on copy, motion, notifications and rewards.
5. One centrepiece per section is fixed in §8.1. Specialists derive from it; they do not swap it without a conflict note.
6. The seam (§1.4) is a build target: a product must run, test and ship without importing the other.

### 3.1 Method and the section map

*Superseded in part by 20.2 (D-V2-10): Day gains `day.month`, Focus gains `focus.drill`.*

Method: start from the jobs (§2.2) and loops (§2.3), not from today's 21 tab ids. A section exists only if it has its own one job, its own one primary action and its own honest state. Anything that is not an object of a loop becomes a view, an overlay, a sheet, or is deleted. Result: **10 sections (5 per product)** plus the Proof rail and three shell sheets, replacing 21 tab ids, a 14-item dock and a second 6-item workspace strip (Strand 0, 1.1). Computed: 5 + 5 = 10 sections versus 14 dock items plus 6 workspace tabs = 20 navigation targets today.

Every view fits the canvas in §3.3 without document scroll. A view that cannot fit becomes two views, a drawer or an overlay.

**Row order is the rail order (revised 2026-11-12 evening, I37).** The rows of the table below list each product's sections in the order the rail, Ctrl+1 to Ctrl+5 and the palette use: most reused first, by the estimates and rule of §3.1.2. The section ids are unchanged; only the order and the key numbers moved (Well Wisher: Focus was Ctrl+5, now Ctrl+2; Study, Tree and Career each moved one place down). JARVIS keeps its order, which the estimates confirm.

| Section id | Product | Label | One job | Primary action | Named views (ids) | Keys | Absorbs from today | Rationale |
|---|---|---|---|---|---|---|---|---|
| `core` | jarvis | Core | Talk to JARVIS and see it listen | Wake / Sleep (voice); Send in text mode | `talk`, `sound` | Ctrl+1 | Core page (Reactor becomes the hill, conversation, flags; "Share a review", formerly "Review for Claude", moves to `memory.keep`, I39); MediaCard and LibraryPanel become `sound`. MissionCard deleted. SystemsCard and Staff move to `console` | Conversation and the sound it plays share one voice path. Removes the Core-to-Well Wisher import |
| `room` | jarvis | Room | Operate the room and trust what the board confirms | Toggle a channel (All off lives in the rail) | `switches`, `rules` | Ctrl+2 | Limbs: WallBox (all 8 channels drawn, absent ones shown "unavailable"), DeviceCards, Modes, PresenceRule; orphans AwayModeCard, the card named SecurityAlert (renamed MotionNotice before mounting) and EnergyCard mounted under `rules` once their backends are confirmed live, else PLANNED (not built) or WAITING "built, not verified" cards | A voice command and its physical result are one moment. Ends ten stacked blocks and a hidden-absent-relay filter |
| `senses` | jarvis | Senses (Aankhen) | Say whether a body moved, with its provenance | None while live (read-only); "Teach this quiet baseline" when not ready | `presence`, `signal`, `teach` | Ctrl+3 | Aankhen page whole: twin, presence core, zones, EyesView (renamed Signal so nothing reads as a camera), teach and train, readiness, first light, sim check | Keeps the one full-bleed canvas page. "Predicting" until readiness passes |
| `memory` | jarvis | Memory (Yaadash) | Show, correct, export and delete what it knows | Search (focused on open) | `recall`, `beliefs`, `people`, `keep` | Ctrl+4 | Yaadash: search, belief queue, learned-lately, reminders, people, taste. Connect 05.3 exports become `keep`. ReminderAlerts mounted once in the shell | Memory is ownership (Strand 1, J-principle 8). One-click export and delete, stated plainly |
| `console` | jarvis | Console | Know it works, fix it, connect things | The one fix that applies (restart brain, free GPU), else none | `health`, `events`, `connections`, `hardware`, `crew` | Ctrl+5 | System page; Connect 05.1, 05.2, 05.5; boards, ports, ESP32 link, firmware from Limbs; Assistants roster (the former Staff roster); Ticker (14 events) becomes `events` and the Alt+L overlay | One plumbing place instead of three. Admin tools (formerly "Owner hat") live here, two taps deep at most |
| `day` | ww | Day | Know today and start the next block | "Start next block" (evening: "Close the day") | `today`, `week`, `body`, `close` | Ctrl+1 / Alt+1 | Left column L1 Countdown (now "Papers ahead"), L2 Now, L3 Classes become the `today` canvas, L4 Counters move to `week`; Life workspace (today, week, gym, attendance, quest) becomes `week` and `body`; Study plan's day blocks | Life and Today answered the same question on two pages. The column cost width on every workspace |
| `focus` | ww | Focus | Run one block with a calm timer | "Start session" | `start`, `session`, `rest` | Ctrl+2 / Alt+2 | Focus workspace (Crucible) as `start` and `session`; the break panel is a new first-class view `rest` | A break is a screen, not a paused state |
| `study` | ww | Study | Prepare for the next paper | "Practice paper" (Add questions if the bank is empty) | `papers`, `practice`, `plan`, `library`, `dmat` | Ctrl+3 / Alt+3 | Study workspace (papers, plan, library, dmat) unchanged; Drill moves in from Focus as `practice`; Interrogation to `library` | Drill is practice, not a session mode |
| `tree` | ww | Tree | Choose what to learn next | "Study this node" | `tree` | Ctrl+4 / Alt+4 | Tree workspace (canvas plus Inspector) | Kept whole: built, tested, its own job |
| `career` | ww | Career | Move the next deadline on the long road | "Do next step" | `pipeline`, `certs`, `abroad`, `money`, `ladder` | Ctrl+5 / Alt+5 | Career workspace; its Plan view becomes `ladder` (goals, parking). Game currency (CA11) moves to the Proof "Wins" card | Currency is proof, not a deadline |
| `proof` | ww | Proof | Is it working? Show honest evidence | None by design (existing rule); "Open review" lives inside the panel | Rail only: collapsed 56 px, panel 320 px; ten cards plus Wins | rail button, Alt+P | Proof panel and rail, legacy `status` and `proof` ids | Built and tested; not a navigation item |

Shell ids that are not sections: `resume` (pill), `palette`, `ask` (orb), `pair` (phone sheet, replaces Phone overlay O2), `settings` (sheet), `roadmap` (overlay O5 renamed "What is coming"), `shortcuts` (the `?` sheet), `events` overlay (Alt+L, same content as `console.events`).

**Deleted or demoted, not carried over.** MemoryGalaxy, GrowthChart and `galaxy/*` (three.js, no caller; bench pages only; Strand 0, 5). `RelayWiring` (Arduino Uno guide), `BoardId 'uno'` and the WallBox not-active branch (delete; history keeps them). The duplicate PhoneCard (one home: `pair`). The old Well Wisher layout (`germoney/pages/*`, `MissionNav`, `SettingsDrawer`, `ReaderDrawer`) after vitest stops defaulting to it (`flag.ts DEFAULT_ON` is false under test; Strand 0, 7.2). The dock's eight Well Wisher legacy tabs.

**Setup.** The 18 Setup sections stay unchanged in logic and live in the `settings` sheet under the rail gear (view ids `settings.<existing section id>`). Settings has two shared top groups (Appearance and motion with the Calm switch, text size; Quiet and notifications) and the data-and-privacy group that deep-links to `memory.keep`.

#### 3.1.1 Derivation of the map (added after the review of 2026-11-12)

The first draft inherited today's pages. This table derives the map from the jobs (§2.2) instead: group jobs by the object they act on, then give each object family one section.

| Object (what the student or room touches) | Jobs | Section |
|---|---|---|
| Utterance, reply, sound | J11 | `core` |
| Relay channel, mode, rule | J12 | `room` |
| Motion estimate, signal, baseline | J13 | `senses` |
| Memory item, belief, person, export | J14 | `memory` |
| Fault, link, board, log | J15 | `console` |
| Resume record, plan block, class gap, day total | J1, J2, J3, J6, J7 | `day` (and `focus.rest` for J7) |
| Paper, topic, question bank | J5 | `study` |
| Knowledge node | J8 | `tree` |
| Application, certificate, deadline, money | J9 | `career` |
| Session, dot, log entry | J4 | `focus` |
| Statistic, evidence | J10 | `proof` (rail, not a section) |
| Pairing, phone | J16 | shell sheet `pair` and the phone pages |

Two alternative maps were considered and rejected.

| Alternative | Shape | Rejected because |
|---|---|---|
| Loop-first | Now, Plan, Learn, Room, Me | Every JARVIS job lands in Room or Me, and Me becomes a catch-all for Memory, Proof, Career and Console (four unrelated jobs behind one label). It also pushes the separability seam through every section, so neither product could ship alone |
| Four per product plus Proof and You (Proposal A) | 4 + 4 sections, a shared Proof and You | Merges Focus and Tree into Study, which breaks two built, tested workspaces for no daily gain (D4), and leaves a "You" section with no primary action |

**Five slots is a chosen constraint, not a result.** Reasons: Ctrl+1 to Ctrl+5 stays a one-hand chord; the rail holds five sections plus the bottom stack in 440 to 496 of 720 px (§3.3); and a student who loses focus easily is better served by few places (an assumption from Strand 4, unverified). **Tree is a section and not a Study view** because Study already has five views (the §4.1.4 maximum), the Tree canvas needs the whole 1230 x 664 box (a view switch row would take 52 px of it), and its primary action ("Study this node") crosses into Study. **Migration cost does not choose the map.** It enters only in the sequencing of §5.8 and §15.4; §16.1 criterion 5 is kept as history and decision D1 is re-justified without it (the totals without criterion 5 are A 39, B 41, C 40, computed from the table, so B still wins).

#### 3.1.2 Order by reuse, and the allocation re-check (added 2026-11-12 evening, I37 to I39)

The owner's evening decision keeps everything decided before except two things the designer now sets: the **order** of sections and views, and the **allocation** of features to sections. Rule 1: a section or view that is used more often per day comes first, so the most common path is the shortest and sits under the same key every day. Rule 2: where two estimates are within a factor of two of each other, the present order stays (predictable places beat a marginal gain; a learned place is a cost). Rule 3: everything that is rarely used keeps a plain, predictable order: few items, the same place every day, one primary action per view, and the next step always visible (the Resume pill, the primary button and the Now strip already provide this).

**Estimates.** Uses per day are **estimates from the daily loops of §2.3, not measurements** (assumption; no usage data exists for the new map). A use is one visit in which the person does that view's job (a glance counts for a glance view). They were written down before the order was chosen so the order can be checked against them. The local, visible view-visit counts the product may keep (§2.4, local analytics only) can replace them after two weeks of real use (F15).

| Section | View | Estimated uses per day | Basis (loop) |
|---|---|---|---|
| `core` | `talk` | 20 | J-L1: asks by voice or text, many a day (orb asks from other sections are not counted here) |
| | `sound` | 3 | play or change what is playing |
| `room` | `switches` | 12 | J-L2: light, fan, modes; mostly by voice, the rest by tap |
| | `rules` | 1 | edit a rule or mode now and then |
| `senses` | `presence` | 4 | J13: a glance at "was there motion" |
| | `signal` | 0.3 | owner check, J-L5 |
| | `teach` | 0.05 | rare, only to refresh the baseline |
| `memory` | `recall` | 3 | J-L3 |
| | `beliefs` | 0.4 | J-L4: at most three questions, weekly |
| | `people` | 0.2 | occasional |
| | `keep` | 0.05 | export and delete, rare by design |
| `console` | `health` | 1 | J-L5 and the fault chip |
| | `events` | 0.4 | read the log when something is off (also the Alt+L overlay) |
| | `connections` | 0.15 | pair or link something |
| | `hardware` | 0.1 | boards and ports |
| | `crew` | 0.05 | roster (a PLANNED card today) |
| `day` | `today` | 12 | W0 resume, W1 plan, W2 class gaps (4 to 6 a day), class taps, W7 |
| | `body` | 1.5 | gym and attendance entries |
| | `week` | 1 | a look at the week |
| | `close` | 1 | W5, once a day by design |
| `focus` | `start` | 5 | W3: one start per block, 3 to 6 blocks |
| | `session` | 5 | the block itself (long, but one visit) |
| | `rest` | 4 | W4: a break after most blocks |
| `study` | `papers` | 2 | J5 |
| | `practice` | 2.5 | drill, J5 |
| | `plan` | 1 | weekly plan, tonight's plan |
| | `library` | 0.5 | notes and interrogation |
| | `dmat` | 0.1 | an admission test, rare |
| `tree` | `tree` | 0.7 | J8: choose what to learn next |
| `career` | `pipeline` | 0.2 | J9 |
| | `ladder` | 0.15 | goals and parking |
| | `certs` | 0.1 | |
| | `money` | 0.1 | |
| | `abroad` | 0.05 | |

**Section totals and the resulting rail order (computed by summing the rows).**

| Product | Estimated uses per day by section | Order the rule gives | Against the previous order |
|---|---|---|---|
| JARVIS | `core` 23, `room` 13, `senses` 4.4, `memory` 3.65, `console` 1.7 | Core, Room, Senses, Memory, Console | Unchanged. Senses (4.4) and Memory (3.65) are within a factor of two, so rule 2 keeps the present order |
| Well Wisher | `day` 15.5, `focus` 14, `study` 6.1, `tree` 0.7, `career` 0.6 | Day, Focus, Study, Tree, Career | **Focus moves from fifth to second** (14 against 6.1 is 2.3, over the factor of two). Day stays first although Focus is close (15.5 against 14, within a factor of two): Day is the home and the place the day's main loop starts (D9, W0 to W2). Study, Tree and Career each move one place down. Tree (0.7) and Career (0.6) are within a factor of two, so their relative order stays |

Focus, Study and the rest follow from the loops as well as the sums: W2, W3 and W4 (gap, block, break) are one chain that the student repeats several times a day, and Study is the next paper's preparation. The order is recorded as I37; if the owner disagrees it is one row of the table above and one binding table (`shell/keymap.ts`) to swap back.

**Views inside a section** follow the same rule. Only one view changes place: in `console`, `events` (0.4) moves ahead of `connections` (0.15) and `hardware` (0.1), 2.7 times as often as the next, and sits beside `health` because reading the log is the next step after a fault (I38). In every other section the estimates are within a factor of two of the previous neighbour or already in order (`day`: `body` 1.5, `week` 1 and `close` 1 are within a factor of two of each other, and `close` stays last because it ends the day's flow; `focus`: `start`, `session`, `rest` is the order the loop runs; `study`: `practice` 2.5 and `papers` 2), so every other view order is unchanged.

**Feature allocation, re-checked with the same lens.** A feature moves only when its reuse is far below the screen it sits on (attention load on the busiest screens) or far above the screen that holds it. View ids are frozen, so a move never moves a whole view between sections: that would change an id.

| Feature | Where it sat | Reuse | Decision | Why |
|---|---|---|---|---|
| "Share a review" export (owner-only) | `core.talk`, conversation header and Earlier drawer | about 0.05 a day, on the most used screen (20 a day) | **Moved to `memory.keep`**, which already lists it in Actions (I39) | It is a rare export on the busiest view, and `keep` is where every other export lives. Core's header keeps the turn count and Earlier; one control less on the screen used 20 times a day. Cost: 3 steps from anywhere (Ctrl+4, Keep, Share a review) instead of 2 from inside Core |
| The six counters with Undo | `day.week` | tapped about 6 a day, mostly on the phone (the phone Today tab has them), viewed on desktop about 1 a day | Not moved | Reuse says move them to `day.today`; attention load says no, because the earlier review took `day.today` from about 30 targets to about 20 so it holds one sentence, one primary and the presets. The two lenses conflict, so nothing moves; revisit when F15's counts exist |
| `study.dmat` | `study`, a five-view section at the §4.1.4 maximum | about 0.1 a day | Not moved | It reads best next to `career.abroad`, but a move changes its id (frozen). It stays last in its section, where a rare view belongs |
| Papers ahead, Next class and gap, presets | `day.today` | with Today (12 a day) | Not moved | High reuse on a high-reuse view |
| Delete raw signal now, retention | `memory.keep` | rare | Not moved | Rare and sensitive: it belongs with the other deletes |
| Wake word model plate, Agents, Coach, Spotify, music import | `console`, `core.sound`, `study.library`, `day.body` | PLANNED, 0 | Not moved | Planned items take a dashed home in the view of their topic, never a rail slot (D2) |

**Rail drawings.** §4.2.2 draws both rails in this order.

### 3.2 Stable ids (frozen)

*Superseded in part by 20.2 (D-V2-10, D-V2-12): the table gains `day.month` and `focus.drill`; the `settings.*` ids become aliases of Trim popovers; `drill` now resolves to `focus.drill`.*

**Products.** `jarvis`, `ww`. Set on the root as `data-product`.

**Sections and views.** `data-section="<section id>"` and `data-view="<view id>"` on every page root. Route fragment form: `#/<section>/<view>`, for example `#/day/today`. Full view id in code and tests: `<section>.<view>`.

| Section | View ids (in tab order) |
|---|---|
| `core` | `core.talk`, `core.sound` |
| `room` | `room.switches`, `room.rules` |
| `senses` | `senses.presence`, `senses.signal`, `senses.teach` |
| `memory` | `memory.recall`, `memory.beliefs`, `memory.people`, `memory.keep` |
| `console` | `console.health`, `console.events`, `console.connections`, `console.hardware`, `console.crew` |
| `day` | `day.today`, `day.week`, `day.body`, `day.close` |
| `focus` | `focus.start`, `focus.session`, `focus.rest` |
| `study` | `study.papers`, `study.practice`, `study.plan`, `study.library`, `study.dmat` |
| `tree` | `tree.tree` |
| `career` | `career.pipeline`, `career.certs`, `career.abroad`, `career.money`, `career.ladder` |
| `proof` | `proof.rail`, `proof.panel` |
| `settings` (sheet) | `settings.appearance`, `settings.quiet`, `settings.data`, then the 18 existing Setup section ids unchanged |

**Order of the table (revised 2026-11-12 evening).** Ids are frozen; the order is not. The section rows are in rail order and the view ids within a row are in view-switch order, both by reuse (§3.1.2): Well Wisher is Day, Focus, Study, Tree, Career, and `console.events` now follows `console.health`. `keymap.test.ts` asserts that the binding table's section order equals the order of this table, so the two cannot drift.

**Overlays** (one deep, as built; registry `ww/frame/overlayRegistry.ts` generalised to the shell). Existing ids kept: `date`, `reader`, `record`, `log`, `confirm`, `add` (all `ww`-owned). Changed: `phone` becomes `pair` (shared); `roadmap` becomes shared and is titled "What is coming". New shell ids: `shortcuts`, `events`.

**Planned-feature homes.** Every planned item has a registry id (existing 28 keep theirs) and a dashed home inside the view where it belongs. Planned items never take a rail slot. Placement: JARVIS "Agents" is a PLANNED card in `console.crew`; Spotify (the app only opens a search today; Strand 0, section 3) is a PLANNED card in `core.sound`; Well Wisher "Coach" (drafting and rewording help, never grading; Strand 5) is a PLANNED card in `study.library`; music import (`music-import`) stays a PLANNED card in `day.body`.

**Legacy aliases (deep links keep working; all 15 `LEGACY` ids in `ww/frame/workspaces.ts` plus the six JARVIS ids).**

| Legacy id | Resolves to | Legacy id | Resolves to |
|---|---|---|---|
| `core` | `core.talk` | `quests` | `day.body` |
| `yaadash` | `memory.recall` | `forge` | `day.body` (gym row) |
| `aankhen` | `senses.presence` | `campaign` | `career.pipeline` |
| `limbs` | `room.switches` | `trials` | `career.abroad` |
| `connect` | `console.connections` | `armory` | `career.money` |
| `system` | `console.health` | `crucible` | `focus.start` |
| `mission` | `day.today` | `drill` | `study.practice` |
| `schedule` | `study.plan` | `interrogation` | `study.library` |
| `syllabus` | `tree.tree` | `terminal` | overlay `log` |
| `status`, `proof` | `proof.panel` | `calibration` | `settings.<calibration section>` |

### 3.3 Canvas geometry at 1366x768 (computed; targets until measured on the real WebView2 window)

| Region | Size | How computed |
|---|---|---|
| Title bar | 1366 x 48 | Replaces 52 px title bar plus 34 px ticker (86 px) with 48; recovers 38 px |
| Rail | 64 x 720 | 768 - 48 |
| Canvas (outer) | 1302 x 720 | (1366 - 64) x (768 - 48) |
| Canvas inside an 8 px gutter | 1286 x 704 | 1302 - 16, 720 - 16 |
| Well Wisher Now strip | 1302 x 40, above the view, on every section except `day.today` and `focus.session` | A 40 px strip keeps "where was I" visible |
| Well Wisher view area with the strip | 1302 x 680 | 720 - 40 |
| Proof rail collapsed | 56 px wide, leaving 1246 x 680 | 1302 - 56 |
| Proof panel open | 320 px | 1302 - 320 = 982 px beside it **only when pinned** (from 1500 px container width, as built, Strand 0 section 2). Below that (class L at 1366) the open panel overlays the canvas: the canvas is `inert` while it is open, Esc or the rail button closes it, and focus returns to the control that opened it (§11.1) |
| Rail contents | Five section slots 5 x 56 = 280 px; bottom stack Ask orb 56 + pair 44 + settings 44 + two 8 px gaps = 160 px; JARVIS adds All off 56 px; total 440 to 496 px of 720 | Computed. Spare room is deliberate |

Reflow: below about 900 CSS px, and at 200 to 400 % zoom, the canvas collapses to one reflowing column (WCAG 1.4.10; Strand 6; decision D6). A 1920x1080 layout is tested as well but never gets more sections, only more air.

#### 3.3.1 Height tiers (added after the review of 2026-11-12)

The window is frameless with `min_size` (1120, 720) (`desktop.py`), and a maximised window on a 1366x768 panel is about 720 to 728 px high after the taskbar (assumption; R01 records the real maximised `innerWidth`, `innerHeight` and display scale). A 1080p laptop at 150 % scaling is 1280x720 CSS, about 680 px usable. So 768 is the comfortable tier and **720 is the design floor**. Boxes below are computed the same way as §4.1.1.

| Tier | Outer box | Canvas outer | Inside gutters | J | W (strip on) | W+ | Wt |
|---|---|---|---|---|---|---|---|
| T768 (reference) | 1366 x 768 | 1302 x 720 | 1286 x 704 | 1286 x 652 | 1230 x 612 | 1230 x 652 | 1230 x 664 |
| **T720 (floor)** | 1366 x 720 | 1302 x 672 | 1286 x 656 | 1286 x 604 | 1230 x 564 | 1230 x 604 | 1230 x 616 |
| T720 at 1280 wide | 1280 x 720 | 1216 x 672 | 1200 x 656 | 1200 x 604 | 1144 x 564 | 1144 x 604 | 1144 x 616 |

How T720 is computed: height 720 - 48 title = 672 canvas; minus 16 gutters = 656; minus the 52 px view-switch band = 604 (J); W subtracts the 40 px strip and 16 px: 672 - 40 - 16 - 52 = 564; Wt is 672 - 40 - 16 = 616. Every J, W, W+ and Wt box loses 48 px against T768.

**Rule.** Every view's region table in §4 is the T768 table. Each view must also declare a T720 column (the compact numbers) before its flag can turn on (gate of B05 and B06). The reduction ladder, in order: (1) drop declared air; (2) fold secondary lines into the primary region; (3) shrink paged lists by `useFit` (rows, never row height); (4) reduce a centrepiece's height down to its 25 % floor (§8.1), never below. Nothing is removed from the primary region or the state region. A view that cannot fit at T720 becomes two views.

Worked at T720 for the three tightest views: `day.today` (§4.4.1, new layout) sun 620 x 372 plus Now 216 = 604, right column Papers ahead 212 plus Next class 376 = 604; `study.papers` strip 56, island 560 x 492, list shows 7 rows (7 x 56 = 392) = 564; `career.pipeline` skyline 1230 x 212, pipeline 1230 x 336 (4 rows). `core.talk` folds the hint line into the state strip: 360 + 88 + 72 + 2 x 16 = 552 of 604. A view that has not declared a T720 column keeps `scrollHeight <= clientHeight` only at T768 and is marked "T768 only" in the no-scroll table.

**Class M (below the floor, for example 1280x680).** Nothing may become unreachable. The canvas (not the page) scrolls vertically as one column; the title bar, rail, view switch band, primary action and state strip are sticky; no region scrolls inside itself. Raising `min_size` to (1120, 680) is an option for the owner (a desktop.py change needing the owner's OK); until then R01 records what a 680 px usable height actually does.

### 3.4 Navigation model

**One shell, one rail, one title bar.** Today's two navigations (dock with eight Well Wisher tabs plus the frame's own strip) become one.

```
1366 x 768
+---------------------------------------------------------------------------+
| TITLE 48: wordmark | [JARVIS | Well Wisher] | Resume pill | lamps | clock | win |
+----+----------------------------------------------------------------------+
| R  |  (ww only) NOW STRIP 40                                              |
| A  |----------------------------------------------------------------------|
| I  |                                                                      |
| L  |   CANVAS: one view at a time, 1286 x 704 inside gutters             |
| 64 |   overlays, sheets and drawers open over it, one deep               |
|    |                                                        [Proof 56/320]|
| ask|                                                                      |
| pair                                                                      |
| gear                                                                      |
+----+----------------------------------------------------------------------+
```

- **Title bar (48 px).** Wordmark of the active product; the **product switch** (two-state segmented control, 44 px hit areas, Alt+0); the **Resume pill**; annunciator lamps (JARVIS: Voice, Room link, Senses, Memory, using the §6.6 lamp; Well Wisher: Phone paired, Quiet on); a **fault chip** that appears only when something is FAULT and jumps to the right `console` view; clock; window controls.
- **Narrow reflow note.** Below about 900 px the rail becomes a bottom bar of six slots; **All off is never dropped**: it lives in the fixed title-bar menu button and in the bottom bar's overflow, and a Playwright test presses it from every section at 683 px.
- **Rail (64 px).** The five sections of the active product (icon plus 12 px mono caps label (decision I3), never icon-only without an accessible name), then at the bottom: the **Ask orb** (shared `voice` port; shows the real input level as a ring only when a level exists, otherwise a still ring), the **pair** badge, and the **settings** gear. JARVIS only: **All off** (fixed, single press, 6 s "Restore" toast instead of a hold; decision D13). Urgent controls never live inside a view (Strand 1, J-principle 3). One tab stop; roving tabindex.
- **View switch.** A segmented control, 44 px high, top-left of the canvas, listing the section's views in §3.2 order. A section with one view (`tree`) has no switch.
- **Resume pill.** One line, always in the title bar. Reads the current product's record `{product, section, view, object, openedAt, lastConfirmedAt}` (stored per product in `localStorage` and in the server's existing scene memory, `workspaceMemory.ts`). Examples: "Study / Practice: Paper 2, 32 min in" or, with nothing open, "Start: plan the day". First run shows one highlighted action only. **Honesty rule:** if `lastConfirmedAt` is older than two planned block lengths (assumption), the pill reads "Paper 2, last seen yesterday" with "Pick up" and "Drop it"; it never shows a running timer for a block nobody confirmed. One tap restores section, view and object.
- **Defaults.** A product opens on its last section and view. `day` always opens `day.today`; it never switches views by clock time (predictability). In the evening, if the student has set a close time, the same primary button changes to "Close the day" and opens `day.close`.
- **Keys** (all shown in the palette from one real binding table, which fixes today's false "Ctrl 7..21" hints; Strand 0, 1.1). Single-letter keys are focus-scoped (Strand 6). Rows marked verify must be tested inside WebView2.

| Key | Action |
|---|---|
| Ctrl+1 to Ctrl+5 | Section 1 to 5 of the current product in the order of §3.1.2 (Alt+1 to Alt+5 are aliases). JARVIS: Core, Room, Senses, Memory, Console. Well Wisher: Day, Focus, Study, Tree, Career. The Well Wisher order differs from the old one, see D9 and I37 |
| Alt+0 | Swap product. The core wrote Ctrl+0; Ctrl+0 resets browser zoom, which low-vision users rely on for 200 to 400 % reflow, so the default is Alt+0 (decision I1, deviation D-A in §16.3; verify in WebView2) |
| Alt+R | Resume |
| `[` and `]` | Previous and next view in the section (not in text fields) |
| Ctrl+K | Command palette: Go (sections and views), Do (verbs: wake, all off, start block, log minutes, switch mode), Ask (text to JARVIS, memory search). A PLANNED verb is listed with its lamp and opens `roadmap`; it is never executable |
| Esc, Alt+Left | Close the overlay, else back one view, else nothing |
| Ctrl+Shift+Space | Push to talk: **press to start, press again to stop** by default, hold optional in Settings, because a held key is a motor-access barrier (decision I17, D-C; verify). Every hint reads "Press", never "Hold" |
| Ctrl+, | Settings sheet |
| Alt+L | Events overlay |
| `?` | Shortcuts sheet |

**Phone.** One pairing, two installable pages (`/phone/` and `/phone/ww`, two manifests), 390 CSS px design width, 44 px taps, one generated `phone_page/tokens.css` (planned in `app-ui-overhaul.md`, never built; today three inline palettes). Each page gets a light clay theme and the motion rule (today dark-only). A phone paired to both products shows a two-item header switch; paired to one, none. Desktop-only features appear as PLANNED or "desktop only" cards, never as missing text.

| Phone page | Bottom bar (4 tabs) | Content | Read-only or acting |
|---|---|---|---|
| JARVIS `/phone/` | Talk, Room, Senses, More | Talk: wake, say, hear, turns. Room: modes, relay tiles confirmed by the board (150 ms settle, 6 s "not confirmed"), All off. Senses: a status list with each line marked "measured" or "not measured", no twin. More: pairing, console health summary | Senses and More read-only; Talk and Room act |
| Well Wisher `/phone/ww` | Today, Block, Topics, More | Today: Now, classes, +25/+50/+90, counters with Undo. Block: start, calm timer, rest. Topics: next-paper topic taps. More: week, Quiet, pairing, "desktop only" cards | Acts through the same server routes as desktop |

### 3.5 First-time and returning behaviour

- **First-time user.** No setup gate. `ww` opens `day.today` with one primary: "Start a 10-minute block". `jarvis` opens `core.talk` with one primary: Wake. Every other control is secondary. Dates and classes are asked for later, from Proof's "make this more accurate" card, importing what exists.
- **Returning user.** The Resume pill and the last view; nothing to hunt for. After a gap, one calm line and "Pick up here". No counter reaches zero, no red, no apology copy.

---

## 4 Screen-by-screen workflows (desktop and mobile)

Every pixel size below is computed from the canvas geometry of §3.3 (the arithmetic is shown or stated once in §4.1.1) and is a target until measured in the real WebView2 window (F8). Every click count is computed by counting the steps written here, from "the app is open on the product's remembered view", and is a target until measured in Playwright. Pictures are cited by catalogue id with a neutral description and are re-drawn, never pasted.

### 4.1 Reading guide and the grammar every screen shares

#### 4.1.1 The boxes (computed; these are the T768 values, the T720 floor is in §3.3.1)

| Box | Size at 1366x768 | How computed |
|---|---|---|
| Canvas inside gutters | 1286 x 704 | §3.3: (1302 - 16) x (720 - 16) |
| View switch row | 1286 x 44, plus an 8 px gap = 52 | The switch is 44 px high (§3.4). The lamp and "since" for the view sit at the right of the same row, so the header costs no extra height |
| **J** (JARVIS content box) | **1286 x 652** | 704 - 52 |
| Well Wisher Now strip | 1302 x 40, outside the gutters, on every ww section except `day.today` and `focus.session` | §3.3 |
| **W** (Well Wisher content box, strip on, Proof collapsed, view switch on) | **1230 x 612** | width 1302 - 56 (Proof rail) - 16 = 1230; height (720 - 40) - 16 - 52 = 612 |
| **W+** (no strip, switch on: `day.today`, `focus.session`) | **1230 x 652** | 704 - 52 |
| **Wt** (strip on, no switch: `tree.tree`) | **1230 x 664** | (720 - 40) - 16 |
| Region gap | 16 px between regions, 8 px inside a region | One spacing token pair (assumption: `--gap-region`, `--gap-inner`) |
| 1920x1080 canvas inside gutters | 1840 x 1016; J = 1840 x 964; W = 1520 x 924 with the Proof panel pinned (1856 - 320 - 16 = 1520 wide, 1016 - 40 - 52 = 924 high) | Same arithmetic. Pinned because the container is at least 1500 px (S0, section 2) |

Rules for 1920x1080: a view gets no extra section and no extra card, only air and more rows in a paged list (the existing `useFit` logic in `ww/career/Paged.tsx` is the model). Text-heavy views cap at 1440 px wide, centred (assumption). A centrepiece canvas never exceeds 720x360 CSS px (§8.1); the space around it is static CSS scene.

Centrepiece share is quoted as canvas area over the content box. Example: the Core hill is 720 x 360 = 259,200 px against J = 1286 x 652 = 838,472 px, so 30.9 %.

#### 4.1.2 Anatomy of every view

```
+--------------------------------------------------------------------+
| [view switch, 44]                       [lamp + since + reason, 44] |  52 px band
+--------------------------------------------------------------------+
| region map of the view (J / W / W+ / Wt), composed around the        |
| centrepiece; exactly one primary action (kit PrimaryButton)          |
+--------------------------------------------------------------------+
```

- Page root carries `data-product`, `data-section`, `data-view`. At tiers T768 and T720 the view root never scrolls: `overflow: hidden` is scoped to those tiers by a container query, so classes M, S and XS scroll the canvas (§11.1). Text rows use `min-height`, never a fixed height, and tier breakpoints are written in `rem` and container `em`, so a Windows or Settings text-size increase (which does not change viewport pixels) triggers the compact or reflow layout instead of clipping. Tests: `scrollHeight <= clientHeight` for every view at 1366x768 and 1366x720 (the check that exists today for ww extended to JARVIS), plus runs with the standard WCAG 1.4.12 text-spacing overrides and a 200 % root font size asserting no clipped text.
- One primary per view, granted by the existing `PrimaryOwner` rule order (overlay, then view, then the Now button, then none). A view that has none says so in its spec.
- Every number carries a lamp state (§6.6, D12). The data layer cannot render a number without one.

#### 4.1.3 State vocabulary (used by every view; each view lists only what differs)

| State | What the view shows | Lamp |
|---|---|---|
| first run | No setup gate. One plain sentence of what this view is for, one action that works with no data, the dashed `PLANNED` plates still visible | WAITING with "no report yet" if a source is expected, else none |
| empty | Configured, nothing to show now. An `EmptyState` with a reason ("Why is this empty") and the one action that fills it | none or WAITING |
| loading | `Skeleton` in the final geometry, reserving the space (no layout shift). No spinner. Past 3 s the skeleton gains the line "Still reading <source>" (assumption) | WAITING |
| live | Values with their lamp | LIVE |
| stale | Values stay, stamped "last report <age>", and are never drawn as current. Stale means no report within 2 x the source's poll interval (assumption; polls today are 2, 5, 8, 60 s, S0 section 5) | WAITING "no report" |
| error | The source's reason in words, the one retry or fix, nothing else disabled that need not be | FAULT + reason |
| offline | The local server does not answer. Last-known values dimmed with "offline since <time>"; controls that need the server are disabled with the reason beside them; nothing is invented | FAULT "app server" in the title bar fault chip |
| planned | Dashed plate (`ComingCard`), one line of what it will do, one line of what it needs, a button "What is coming" that opens `roadmap` at that registry id. Never executable | PLANNED |
| simulated | Only where a hub can simulate (Senses, Room rules). The art carries an amber diamond stamp "SIMULATED", and the number is not spoken or shown as measured | SIMULATED |

#### 4.1.4 Overflow toolbox (no document scroll)

| Tool | Use when | Rule |
|---|---|---|
| Named view | A section has two jobs | Max 5 views; the switch is a 44 px `Segmented` |
| Pager | A list is longer than fits | Rows fitted by measurement (`useFit`), "n of N", Prev and Next, `[` `]` are view keys so the pager uses PageUp and PageDown |
| Drill-down | A list of cards, each with a body (Proof) | Level 1 is the index, level 2 is one card full height with a Back chip (`BackChip`, Alt+Left) |
| Drawer | Secondary content tied to the view (earlier turns, campaigns, a plan editor) | 420 to 560 px wide from the right, inside the canvas, not an overlay; Esc closes; a drawer's own bounded list may scroll internally, the view root never does |
| Overlay | A task that needs focus (log minutes, reader, confirm) | One deep, registry-owned (§3.2). Focus returns to the control that opened it |
| Sheet | Settings, pairing | 960 or 480 px, shell-owned |
| Fold | A "Why this?" line | Closed by default; one line when closed |

#### 4.1.5 Keyboard grammar (all views)

Ctrl+1..5 sections, `[` `]` views, Ctrl+K palette, Alt+R Resume, Esc or Alt+Left back, `?` shortcuts (§3.4). Inside a view: Tab order is switch, primary, then regions left to right and top to bottom (visual order equals DOM order, so reading order equals tab order). A pager takes PageUp and PageDown. A list takes Up and Down with roving tabindex and Enter to act. Arrow keys inside a rotary dial or a Segmented move one detent. Single-letter keys act only while a region has focus (Strand 6). Each view below names only what is specific.

#### 4.1.6 Mobile: two different things, both designed

1. **Phone pages** (`/phone/` and `/phone/ww`): 390 CSS px design width, four bottom tabs each (§3.4). Specified in section 6. Every desktop view maps to a phone tab or to a labelled "desktop only" card.
2. **Narrow reflow** of the desktop app itself below about 900 CSS px and at 200 to 400 % zoom (D6): one column, rail becomes a bottom bar, view switch becomes a 44 px "View: Today" button opening a sheet list. Each view's **Mobile** line says what the phone shows and how the narrow column orders the regions.

Mobile rules (assumption: 390 x 844 reference screen; 358 px content width = 390 - 2 x 16): 44 px minimum targets, one primary per screen placed in the lower half within thumb reach, the lamp stays in the first 48 px, centrepiece reduced to a static or one-redraw form at 358 x 200, no hover-only controls, text 16 px minimum for inputs (so the OS does not zoom), mono meta 12 px minimum. A phone screen may scroll vertically (WCAG reflow) but its first 640 px contain the primary and the state.

#### 4.1.7 Click-count method

Counted from the product's remembered view. A rail click is 1. A key chord counts as 1. A drawer open is 1. "Typing" and "speaking" are not clicks and are named. Counts for the old paths are the audit's (`well-wisher-ui.md` 3.5, S0).

### 4.2 Shell screens

#### 4.2.1 Title bar (1366 x 48, both products)

| Region | Box | Contents |
|---|---|---|
| Wordmark | 168 x 48 | Wordmark of the active product |
| Product switch | 220 x 44 | Two-state `Segmented` "JARVIS | Well Wisher". Alt+0 swaps (decision I1). Hidden when only one product is built in (per-product builds) |
| Resume pill | up to 380 x 40, centred in the free space | See 2.3 |
| Annunciators | up to 360 x 44 | JARVIS: Voice, Room link, Senses (the SENSING ON notice with a one-tap Pause, §1.3.1), Memory, each lamp plus a 12 px mono word. Well Wisher: Phone paired, Quiet on. At 1366 the words collapse to the lamp alone below 1280 px (assumption) with the name in the tooltip and as the accessible name |
| Fault chip | 120 x 40, shown only when a lamp is FAULT | Click opens the right `console` view (JARVIS) or `settings.data` (ww); for ww the only FAULT sources are the app server and the phone link |
| Clock | 64 x 48 | |
| Window controls | 138 x 48 | pywebview |

Overflow: below 1200 px the annunciators fold into one "Status" button opening a popover with the lamp list. Keyboard: the bar is one tab stop group, arrow keys between items. **Focus ring in bars:** controls in the 48 px title bar and the 44 px view-switch row draw the 2 px ring inset (`outline-offset: -2px`), because a 4 px bleed (2 px ring plus 2 px offset) would be clipped by a 44 px control in a 48 px bar (WCAG 2.4.7, 2.4.11); a per-route test asserts the ring is not clipped. Mobile: title bar 48 px with wordmark, product switch collapsed to a 44 px button, Resume pill below it as its own 44 px row.

#### 4.2.2 Rail (64 x 720)

Five section slots at 56 px each, in the order of §3.1.2 (most reused first; the slot number is the Ctrl+n key), a bottom stack Ask orb 56, pair 44, gear 44, and for JARVIS All off 56 (§3.3: 440 to 496 of 720 px).

```
JARVIS rail (64 x 720)         Well Wisher rail (64 x 720)
+------+                       +------+
| CORE |  Ctrl+1               | DAY  |  Ctrl+1
| ROOM |  Ctrl+2               | FOCUS|  Ctrl+2
|SENSES|  Ctrl+3               | STUDY|  Ctrl+3
|MEMORY|  Ctrl+4               | TREE |  Ctrl+4
|CONSOL|  Ctrl+5               |CAREER|  Ctrl+5
|      |                       |      |
| (air)|  deliberate spare     | (air)|
|      |                       |      |
| ASK  |  orb, 56              | ASK  |  orb, 56
| ALL  |  All off, 56          |      |
| OFF  |  (JARVIS only)        |      |
| PAIR |  44                   | PAIR |  44
| GEAR |  44, Ctrl+,           | GEAR |  44, Ctrl+,
+------+                       +------+
```

The labels are the 12 px mono caps of decision I3 (the drawing abbreviates CONSOLE to fit; the full name is the accessible name). The narrow bottom bar (below about 900 px) lists the same five sections left to right in the same order, then the Ask orb. Active slot has a 3 px solid edge on the inner side in `--ink-1` plus a filled icon (never colour alone). Mobile: bottom bar 56 px with six slots (five sections plus the Ask orb, §11.1); pair and gear move into a "More" sheet reachable from the title bar menu; **All off stays one tap on the JARVIS Room screen and in the phone Room tab as a sticky 56 px button** (D13).

**All off flow (JARVIS).** Press All off (1 click, any section, no hold) -> each channel is asked off -> the rail button shows WAITING until the board reports -> toast "All off. Restore" for 6 s -> keys settle to the board's report. Restore re-asks the pre-press state; after 6 s the toast goes, no nag. If the board is absent the toast says "no board linked, nothing was switched" (never a success message).

#### 4.2.3 Resume pill and the first minute

| Case | Pill text | One tap does |
|---|---|---|
| First run | "Start: plan the day" (ww) or "Start: wake JARVIS" (jarvis), the only filled control on screen | Runs the primary of the home view |
| Open thing, confirmed within 2 block lengths (assumption) | "Study / Practice: Paper 2, 32 min in" | Restores section, view, object |
| Stale (confirmed longer ago) | "Paper 2, last seen yesterday" with two buttons "Pick up" and "Drop it" | Pick up restores without a running timer; Drop clears the record |
| Nothing open | "Start: plan the day" | |

Rules: never a running timer for an unconfirmed block; no counter, no red, no apology (W7). Keyboard: Alt+R. Mobile: a full-width 44 px row under the title bar.

**Returning after missed days (W7), ww.** The app opens on the last view. One calm line sits in the Now block of `day.today` (or in the Now strip elsewhere): "Pick up here: Paper 2, topic 4." and "Rest days are part of the week." (draft copy from §2.5). Totals shown are totals (they only go up). Nothing is reset or shown at zero because of the gap.

#### 4.2.4 Command palette (Ctrl+K, 640 x up to 480 centred overlay)

Three groups. Go: sections and views from the one key table (fixes the false "Ctrl 7..21" hints). Do: verbs, each showing the key it really has. Ask: free text to JARVIS (only when the `voice` port is present) or a memory search (only when `memory` is present); with a port absent the group shows one dashed line "Ask needs JARVIS" with a link to `roadmap`. A PLANNED verb is listed with the dashed-ring lamp and opens `roadmap`, never executes. Flow: Ctrl+K (1), type 2 to 4 letters, Enter = 2 keystrokes to any view. Rows 44 px; the list is paged at 7 rows (7 x 44 + field 56 = 364). Mobile: full-screen sheet, field at the top, 44 px rows.

#### 4.2.5 First run, per product (no setup gate)

| | JARVIS | Well Wisher |
|---|---|---|
| Opens on | `core.talk` | `day.today` |
| The one primary | Wake | "Start a 10-minute block" |
| What is quiet | Everything else is secondary | Everything else is secondary; no date, class or subject is asked for |
| What is asked later | Teach this quiet baseline (Senses), board link (Console) when the owner opens them | Dates and classes, from a Proof card "Make this more accurate" (new card, assumption: reuses Setup import, see 5.4) |
| Onboarding art | C04-124 (surreal landscape) behind one sentence and Wake: one screen, once, skippable, static. No second or third step (C04-20 and C01-24 are first-visit empty-state art in Memory and Console) | None: no picker and no scene. The first block asks "what was it for?" once, after it ends, as an optional line |
| Theme | clay-dark | clay-light |

Click count to a running thing: JARVIS wake = 1; ww running block = 2 (Start a 10-minute block opens `focus.session`, whose Begin is the second tap; target is also 2 from the old design, so first run is no worse than daily use).

#### 4.2.6 Shell-owned sheets and overlays

*Superseded in part by 20.6.6: the settings sheet is dissolved into Trim keys and a palette index; the overlays `pyq-review` and `pyq-gen` are added (20.7).*

| Id | Box at 1366x768 | Primary | Content and states | Keys |
|---|---|---|---|---|
| `pair` (sheet, replaces O2 Phone) | 480 x 560, centred | Pair a phone while unpaired, else none | The existing server-supplied QR and code, two addresses (`/phone/`, `/phone/ww`, only the built ones), listener switch, paired device list with Revoke. States: unpaired, listener off (switch is in the sheet, so 4 clicks from the rail: rail pair, listener switch, Pair, done), paired, error | Esc closes; focus returns to the pair badge |
| `settings` (sheet) | 960 x 640, centred | Save N changes when dirty, else none | Left index 240 (groups: Appearance and motion, Quiet and notifications, Data and privacy, then Setup sections) and a 720 x 640 pane showing one section at a time (the existing "one section at a time" rule, `ww/setup/view.ts`) | Ctrl+, ; arrow keys on the index; unsaved changes prompt `confirm` |
| `roadmap` ("What is coming") | 720 x 600 | none, close only | Grouped by product then by section; each entry shows its lamp (PLANNED), what it will do, what it needs. Opened at an entry when a plate's button was pressed. Registry is the existing 28 ww entries plus JARVIS entries | Esc |
| `shortcuts` (`?`) | 560 x 520 | none | The one key table, grouped; the same data the palette uses | `?`, Esc |
| `events` (Alt+L, same data as `console.events`) | 760 x 600 | none | 14 lines, paged; filter chips per source | Alt+L, PageUp, PageDown |

Mobile: sheets become full-height bottom sheets with a 44 px Close at top; one at a time.

### 4.3 JARVIS sections

Product feel: instrument tempo (80 to 160 ms), mono metadata, bone and charcoal, colour only means state. Every JARVIS view below is composed in the box J (1286 x 652). **Numbering note (2026-11-12 evening):** the §4.3.n and §4.4.n numbers are stable cross-reference ids and were not renumbered when the section order changed; the rail, key and view-switch order is the one in §3.1.2 and §3.2 (for `console`, `events` follows `health` in the switch although its heading below keeps its number).

#### 4.3.1 `core`: Talk to JARVIS and see it listen

*Superseded in part by 20.9.1 (sigil bezel, pipeline ribbon, organ strip, Anatomy drawer).*

##### `core.talk` (immersive charcoal scene)

Region map (J):

| Region | Box | Contents |
|---|---|---|
| Hill stage | 720 x 360 at the top-left of the left column | Centrepiece C02-02 re-drawn: point-cloud mountain driven by the real analyser level, outer bezel ring from C02-07, a 28 px mono caption bar inside the stage: "input level, live" or "no signal". 30.9 % of J |
| State and latency strip | 720 x 88 (two rows of 44) | Row 1: state word from the core (Offline, Waking, Asleep, Ready, Listening, Transcribing, Thinking, Replying, Speaking, Listening for more), "voice on CPU (GPU unavailable)" chip when true, last error, wake-to-first-word median, the lamp and the source tag (`MIC`, `SPEAKER, pre-volume`, `WINDOW`). Row 2 (§9.4): the 240 x 8 level bar, the one-line legend and the single 44 px **Pause** toggle (Pause lives here once, not also in a stage header) |
| Controls row | 720 x 72 | **Wake / Sleep** primary 168 x 56; voice or text Segmented 168 x 44; Ask orb is in the rail |
| Hint and boot line | 720 x 40 | Boot steps while waking; otherwise the hint "Press Ctrl+Shift+Space to talk, press it again to stop" (hold is a Settings option) |
| Conversation header | 550 x 44 (right column) | Turn count and the "Earlier" button ("Share a review" moved to `memory.keep`, I39, so the most used view carries one control less) |
| Turns | 550 x 504 | Last turns that fit (about 4 at an assumed 104 px each, fitted by measurement), each with Good, Wrong, Slow, Misheard flags |
| Composer | 550 x 72 | Text field plus Send in text mode; in voice mode the line "Say it. JARVIS shows what it heard." |

Left column 720 + gap 16 + right column 550 = 1286. Left stack 360 + 88 + 72 + 40 + 3 x 16 = 608 of 652 (44 px of air). Right column 44 + 16 + 504 + 16 + 72 = 652 (computed with the 16 px region gaps; the first draft summed 644 without them and 528 for Turns did not fit). At T720 (§3.3.1) the hint line folds into the strip's second row: 360 + 88 + 72 + 2 x 16 = 552 of 604, and Turns shows 4.

- **Primary:** Wake / Sleep. In text mode with JARVIS awake the primary is Send.
- **Centrepiece rules:** max 720 x 360 canvas, one rAF loop, runs only while level data arrives and the stage is visible, stops after 60 s idle (suggestion). Static form: the same cloud drawn once at a resting shape with the caption "no signal" and a still ring. Input level is real and available today (one number at most 12.5 Hz, only while listening, S0 section 4); the hill is therefore a **loudness** reading and says so in its caption. Output level (JARVIS speaking) shows "no signal" until `core/playback.py` emits RMS and a coarse band spectrum (D23, F7). While speaking without that signal the stage shows the still ring plus the state word "Speaking", never a canned wave. **First release:** the Core shows the input hill plus a separate honest line "JARVIS speaking, no level yet" while it speaks, because the hill would otherwise be dead in the moment users watch it most; the Core section is not called done until A.R02 and A.B07 ship the output level (gate in §15.3).
- **States:** first run (asleep, Wake is the only fill); offline (core not running: Wake still works, it starts the process; state word "Offline" with the reason); WAITING while Waking; listening/transcribing/thinking/replying/speaking as the live states with their word; error (last_error in words with the one retry); text-only mode (no mic: the hill stage becomes a 720 x 120 strip "text mode, no microphone" and the conversation widens); stale (state older than 2 x the 2 s poll: "no report"); planned: a dashed "Wake word model" plate in Console, not here.
- **Flows.**
  1. *Ask by voice* (J-L1): Wake (1 click, or Ctrl+Shift+Space pressed once; it is a toggle) -> speak -> three honest stages appear in the strip: "heard: <words>" (from transcription), "working", then "done" or "failed: <reason>". 1 click plus speech; from any other section the Ask orb is the same 1 click.
  2. *Ask by text*: Ctrl+K, type, Enter (Ask group) = 2 keystrokes with JARVIS awake and no view change; or toggle text (1), type, Enter.
  3. *Mark an answer wrong*: Wrong on the turn (1 click). The flag is stored locally.
  4. *Share a review* (owner-only; moved to `memory.keep` by I39): Ctrl+4 (1) -> Keep (2) -> Share a review (3).
- **Overflow:** turns past the fitted count go to the "Earlier" drawer (560 x 652 from the right, bounded list inside).
- **Keyboard:** Wake with Enter on the focused primary; Ctrl+Shift+Space toggles (hold is a Settings option; verify in WebView2); turns are a list (Up and Down), flags are buttons reached with Right.
- **Mobile.** Phone: Talk tab (4.6.1). Reflow: state strip, hill stage reduced to 358 x 200, Wake primary 358 x 56, composer, then turns (last 3) with "Earlier" opening a sheet.

##### `core.sound`

| Region | Box | Contents |
|---|---|---|
| Now plate | 640 x 180 | The server's receipt for the media item word for word ("never says playing on its own", S0 section 3), title, source, transport (previous, play or pause, next) that act through the Windows media sessions the server already uses |
| Output meter | 640 x 64 | Output level via `AnalyserNode` on the window's media element (unverified in WebView2, S0 section 4). WAITING "no level yet" until the port reports; never a drawn wave |
| Spotify plate | 640 x 96 | PLANNED, dashed. States honestly what exists: the app opens a Spotify search when the owner presses a button; starting a track by name is not built |
| Library list | 630 x 624 | `LibraryPanel` (orphan today, mounted only when `/api/library` answers, else WAITING): head 44, 6 rows x 76, pager 44, plus an add-by-path row |

640 + 16 + 630 = 1286. **Primary:** none while idle; Play on the selected library row when one is selected. **Flow:** open Sound (1 via view switch or `]`), select an item (1), Play (1) = 3; the receipt appears in the Now plate before the lamp turns LIVE. **States:** empty library (EmptyState "No media indexed", action Add a folder); offline (list dimmed, play disabled); error (server receipt shown as received). **Mobile:** phone shows nothing here; "Sound: desktop only" card in More. Reflow: Now plate, meter, library pager (5 rows), Spotify plate.

#### 4.3.2 `room`: Operate the room and trust the board

*Superseded in part by 20.9.2 (guard key, three-phase LED, 24-hour ring with a PREVIEW scrubber).*

##### `room.switches`

| Region | Box | Contents |
|---|---|---|
| Faceplate | 900 x 300 | Centrepiece C01-23 re-drawn as a dark slate faceplate: label plate "WALL BOX, 8 CH" (36 px chamfered plate, C02-25 style), a 200 px rotary dial at the left (mode selector with detents = the saved modes), and eight keys in two rows of four, each 140 x 88 with a lamp, the device name and the confirmed state. 24 + 200 + 24 + 608 + 24 = 880 of 900 wide |
| Board plate | 370 x 300 | Board link word (from the board's own report), last report age, power-safe banner, ESP32 link lamp |
| What just happened | 640 x 336 | Last 5 room events from the bus, each stamped "confirmed by board" (LIVE) or "asked, not confirmed" (WAITING) with the time |
| Modes strip | 630 x 336 | Mode chips (44 px) with a one-line description; "Edit modes" goes to `room.rules` |

900 + 16 + 370 = 1286; 300 + 16 + 336 = 652. The faceplate is DOM and SVG, not a canvas.

- **Primary:** none (acting is on the keys). All off is in the rail.
- **Honesty (carried over from the built logic):** a key's lamp follows the board's own report, never the saved state; an asked change shows WAITING until the board reports (150 ms settle, last tap wins, 6 s then "not confirmed"). This changes the phone's amber "asked, not confirmed" into the WAITING half disc so colour never carries a second meaning (migration 7.6). Absent channels are drawn "unavailable" (dashed key, no switch), not hidden (fixes `WallBox.tsx` filter, S0 section 3). Device colours come from one table (resolves the white and fan hex disagreement, S0 7.1).
- **States:** first run (board not linked: keys dashed "no board", the board plate offers "Connect the board" which opens `console.hardware`); WAITING after a press; live; stale (no report for 2 x the poll: keys keep the last confirmed lamp stamped "last report <age>"); error (board FAULT with reason); offline; simulated is **not** used here (relays are never simulated).
- **Flows.** *Switch the light* (J-L2): press the key (1 click, or Space on a focused key). *Set a mode*: turn the dial (arrow keys) or press a chip (1). *All off*: rail (1).
- **Keyboard:** the faceplate is one composite: Tab enters, arrow keys move across keys and the dial, Space toggles, Enter on the dial applies the mode.
- **Mobile.** Phone: Room tab (4.6.1): modes chips, 2-column relay tiles 175 x 88, sticky All off. Reflow: faceplate becomes 2 columns of 4 keys at 175 x 88, dial becomes a Segmented of modes, then board plate, then the events list (3 lines).

##### `room.rules`

Master-detail in J: rule list 420 x 652 (rows 64: Modes, Presence rule, Away mode, Motion notice, Energy) and editor 850 x 652.

| Row | Today | Home and state |
|---|---|---|
| Modes | `Modes` editor (`/api/limbs/scene/{name}`) | Editor with name, per-channel target (on, off, leave), Save; live |
| Presence rule | `PresenceRule` (`/api/limbs/presence-on`) | Rule "when presence is predicted, turn X on"; its lamp reads the Senses state ("predicting", never "measured" until readiness passes) and says which source |
| Away mode | `AwayModeCard` (unmounted, `simulated` flag) | PLANNED plate until the owner decides what it may alert about (F13). If mounted later its lamp is SIMULATED or PLANNED until a real presence source exists (D20). The entry always says "motion only, cannot see a still person, not a security alarm" |
| Motion notice | the unmounted component formerly named `SecurityAlert`, renamed before it can be mounted (no "security" or "safety" wording anywhere in the product) | PLANNED plate; the entry reads "motion only, cannot see a still person, not a security alarm" |
| Energy | `EnergyCard` (unmounted, simulated flag) | WAITING "built, not verified" until `/api/energy` answers; there is no current sensor, so any figure shown is SIMULATED-stamped |

**Primary:** Save on a dirty editor, else none. **Flow:** edit a mode: Rules tab (1), Modes row (1), change a target (1), Save (1) = 4. **Overflow:** one rule at a time; Modes with more than 8 channels use the 8-row layout. **Mobile:** phone shows modes and the presence rule read-only inside Room; rules editing is a "desktop only" card. Reflow: list first, detail as a pushed screen with a Back chip.

#### 4.3.3 `senses`: Say whether a body moved, with its provenance

*Superseded in part by 20.9.3 (one terrain canvas, probability arc, motion tape, floor plan; `senses.signal` becomes SVG-only).*

Product rule on every Senses screen: one Wi-Fi link sees that a body moved, not how it is bent; no pose, no camera. Presence reads "predicting" until readiness passes; a simulated hub stamps SIMULATED on every piece of art and every number.

##### `senses.presence` (immersive charcoal)

| Region | Box | Contents |
|---|---|---|
| Stage | 760 x 652 | A 44 px internal switch "Motion \| Map" (default **Motion**). Motion: centrepiece C04-06 re-drawn as a wireframe spindle with orbit lines over a grid plane, canvas 720 x 360 (30.9 % of J), with a mono readout line under it and, on the screen itself (not only in this file), the line "detects motion of anyone in range, identifies no one; one link, no pose". Map: the existing 3D twin (the only WebGL renderer), mounted only while Map is selected and the view is visible |
| Presence core | 510 x 300 | 72-tick ring and one of three words: MOTION SEEN, NO MOTION IN 60 s, or PREDICTING, with its provenance ("signal estimate"), confidence only once readiness trusts it. Never "present", "absent" or "empty room": one link cannot see a still person |
| Meters | 510 x 176 | Slow-motion band and fast-motion band meters (the two motion-speed bands the pipeline computes; neither is called "human"), prediction bar |
| Zones | 510 x 144 | Zone names only with two or more links and when readiness trusts them (`shownZones`); with one link the line reads "no zones with one link"; before readiness "zones need the quiet baseline" with a link to `senses.teach` |

760 + 16 + 510 = 1286; 300 + 16 + 176 + 16 + 144 = 652.

- **Primary:** none while live; "Teach this quiet baseline" (goes to `senses.teach`) when readiness has not passed.
- **Sensing notice (view header band, right):** a **SENSING ON** chip with a 44 px **Pause sensing** and a link to `memory.keep` for "Delete raw signal now" and the retention control (§1.3.1). Paused shows WAITING "sensing paused by you".
- **Centrepiece rules:** orbit speed follows measured motion energy and is still at idle; labelled "signal estimate"; amber diamond stamp when the hub says simulation; never an eye, a face or a body outline (D22: C04-26 and C03-12 rejected). Static form: the spindle drawn once; reduced motion keeps all readouts.
- **States:** first run (no source: spindle drawn, readouts WAITING "no signal source", one line "Connect the wall box in Console", link to `console.hardware`); empty (source live, nobody moved: "no motion in the last 60 s" with LIVE); stale; error; offline; simulated (stamp on the stage, the meters and the presence word); Map unavailable (WebGL fails: the Map button shows "map unavailable" and Motion remains).
- **Flow (J13):** open Senses (1) = the answer is on screen, 1 click. "Is anyone moving?" reads from the presence word; its provenance is on the same screen.
- **Overflow:** the Map toggle is the only alternate; no scroll.
- **Keyboard:** Motion/Map switch with Left and Right; the stage is not a tab trap (Esc leaves).
- **Mobile.** Phone: Senses tab (4.6.1), status list only, no twin and no spindle. Reflow: the spindle at 358 x 200 (one redraw, static unless Pause is off), presence core, meters, zones; Map is "desktop only".

##### `senses.signal` (renamed EyesView so nothing reads as a camera)

| Region | Box | Contents |
|---|---|---|
| Spectrogram | 720 x 300 | Canvas 2D from the CSI stream, labelled "signal estimate" |
| Ripples | 2 x 267 x 300 | Two small canvases (motion ripples) |
| Channel matrix | 720 x 160 | 51-subcarrier dot matrix |
| Matrix legend and scale | 720 x 160 | Tick scale, units, source lamp |
| Assistant reading | 550 x 336 | A narration of what these signals show, each line stamped with its source. It is **template text built from named fields** (source, lamp, motion energy, frames, loss), or, if a model writes it, chipped `MODEL` and restricted to restating listed measurements. A lint rejects the words sleeping, sitting, lying, two people, mood, attention, breathing and pose. "Assistants not running yet" when absent |

720 + 16 + 267 + 16 + 267 = 1286. One rAF loop for the three canvases, stopped when hidden. **Primary:** none. **States:** simulated (amber stamp on all three canvases), stale, WAITING when the stream stops. **Pause control** (WCAG 2.2.2): a 44 px Pause in the view header; default is running only while the stream moves. **Mobile:** desktop-only card on the phone; reflow stacks spectrogram (358 x 200), matrix, then narration.

##### `senses.teach`

Stepper rail 280 x 652 (four steps, each a lamp row) plus step pane 990 x 652.

| Step | Pane content | State logic |
|---|---|---|
| 1 Readiness | The existing readiness check list, each item with a lamp and the reason it is not ready | The honest gate: "predicting" until it passes |
| 2 Quiet baseline | Record N seconds with the room quiet (`MeasureRoom`, `FirstLight`), the fan-aliasing note, a progress bar | Needs the board LIVE |
| 3 Drill | Train from labelled drills (`TeachTrainPanel`), the count of drill days (the passed held-out day is required before "predicting" can drop, per the project decision) | |
| 4 Check | Held-out check, and the simulator check (labelled SIMULATED) | |

**Primary:** the next incomplete step's action ("Teach this quiet baseline" when step 2 is next). **Flow:** `senses.presence` -> Teach (1) -> Record baseline (1) = 2 clicks to begin. The app never closes itself to flash a board; any step that needs the serial port shows "close the app first" and does not offer a button (the running app holds the port). **Mobile:** phone: "Teach: desktop only" card. Reflow: steps as a vertical list; one step per screen.

#### 4.3.4 `memory`: Show, correct, export and delete what it knows

*Superseded in part by 20.9.4 (constellation, strata, trail, capture line, inline fix) and D-V2-25.*

Scene: light paper-grey, ASCII and halftone. Result text is plain text always; art never replaces an excerpt.

##### `memory.recall`

| Region | Box | Contents |
|---|---|---|
| Search | 1286 x 64 | Field, focused on open, plus the scope chips (JARVIS, and Well Wisher only when the port is present) |
| Results | 760 x 572 | Hybrid-recall rows 76 px (7 fit, 532 px, plus a 40 px pager), each with real excerpt, source and date, and Fix and Delete in place |
| Detail | 510 x 572 | Default: the **branch plate** 510 x 424 (centrepiece C04-119 as a fixed, static picture: 216,240 of 838,472 = 25.8 % of J, computed) above a **Reminders** strip 510 x 132 (next 2, due ones first, add one inline, "All reminders" opens a 560 x 652 drawer; 424 + 16 + 132 = 572). With a result selected the branch plate gives way to the full excerpt, its source, Fix and Delete; the Reminders strip stays. The branch does **not** grow with stored items: deleting data never shrinks a picture and storing data is never rewarded |

760 + 16 + 510 = 1286; 64 + 16 + 572 = 652.

- **Primary:** Search (the focused field's Enter). Palette search seeds the field (`store.pendingQuery`).
- **States:** first run (empty memory: the branch art and one line "Nothing remembered yet. Tell JARVIS something."); empty results ("no match" with a suggestion to widen scope); loading; error; offline; planned: embeddings search is PLANNED until a local Hinglish A/B (Strand 5), shown as a dashed line under the field.
- **Flows (J-L3).** *Recall*: Memory (1), type, Enter. *Fix a memory*: select result (1), Fix (1), edit, Save (1). *Delete one*: select (1), Delete (1), `confirm` overlay (1) = 3. **Reminders** raise their chimes through `ReminderAlerts` mounted once in the shell only when the reminder route answers and Quiet is off.
- **Keyboard:** `/` focuses search (when no field is focused); Up and Down in results; Enter selects; Delete key opens confirm.
- **Mobile.** Phone: no Memory tab (§3.4); the Talk tab accepts "what do you remember about ...", and More shows "Memory: desktop only". Reflow: search, results (5 rows), detail as a pushed screen.

##### `memory.beliefs`

Left 640 x 652: the belief queue as up to **three** question cards (3 x 170 + 2 x 16 = 542 of 652), each "Is this true?" with Yes, No, Not sure, and "Don't ask again" (a decline is respected, never re-asked, N3); amber (inference, not fact) until answered. Right 630 x 652: "Learned lately", rows with Keep and Wrong (8 rows x 56 + head 44 + pager 44 = 536). **Primary:** none. **Cap:** at most three questions a week (§2.3 J-L4); an empty queue says "Nothing to confirm this week". **Flow:** Beliefs (1), Yes (1) per question. **Mobile:** desktop-only card; reflow one list at a time.

##### `memory.people`

Left 640: people with a **mentions** count and its basis ("mentioned in 14 notes", rows 56, 8 per page, alphabetical, never ranked, no relationship labels, no closeness score), each with a per-person Hide and Delete. Right 630: taste trajectory (chart 630 x 320, caption says what it encodes, values with lamps; no mood or attention inference, N5) and notes. **Primary:** none. **States:** first run empty ("No people yet. JARVIS learns names from what you tell it"). **Mobile:** desktop only; reflow stacks.

##### `memory.keep`

| Region | Box | Contents |
|---|---|---|
| Statement | 1286 x 96 | One plain paragraph generated from the egress register (§1.3.1): "designed to stay on this machine; exceptions: <list>" until Q03 has verified it against a network trace, how long raw CSI is kept (7 days by default, the owner's decision; a shorter retention is a control in Actions), and the line "You can export and delete everything here" |
| Holdings | 560 x 540 | Table per namespace (`jarvis/*`, and `ww/*` only when the port shows it): item counts, size, last written |
| Actions | 710 x 540 | **Export** (primary), per-namespace Delete (via `confirm` naming the count), the old Connect 05.3 exports (recall, belief, reminder files), the "Share a review" export (an owner-only string, moved here from `core.talk` by I39; the customer build omits it), **Delete raw signal now** and the raw-signal retention selector |

96 + 16 + 540 = 652; 560 + 16 + 710 = 1286. **Flow:** Keep (1), Export (1) = 2; Delete a namespace: Keep (1), Delete (1), type the namespace's name or press and confirm (1) = 3 (one confirm, never a hold). Delete is never hidden, never confirm-shamed (N4). **Mobile:** More tab shows a "Memory: desktop only" card; reflow stacks.

#### 4.3.5 `console`: Know it works, fix it, connect things

*Superseded in part by 20.9.5 (closed-verb command line, job rows, route of plates).*

Scene: matrix and terminal, immersive charcoal, a solid block cursor, no blink and no ambient animation. Admin tools (owner-only strings are marked in the private build): at most two taps from the fault chip.

##### `console.health`

| Region | Box | Contents |
|---|---|---|
| Terminal frame | 800 x 652 | Centrepiece C04-10 frame re-drawn (bracket tags, boxed panel): lines `[HEAR] can he hear "Hey Jarvis" now: yes/no/not tested`, `[WAKE] median, p90 over 7 days`, `[GPU] VRAM`, `[BRAIN]`, `[VOICE]`, `[ROOM]`, `[SENSE]`, `[MEM]`. Each tag line has its lamp glyph and the reason in words |
| Timings | 470 x 300 | Wake to heard to first word to full reply (median and p90) from the transcripts |
| Fix | 470 x 176 | The fixes that apply now: restart brain, free GPU, run the steward check. Only applicable ones render; none applicable says "nothing to fix" |
| Recent replies | 470 x 144 | Last 3 timed replies |

800 + 16 + 470 = 1286; 300 + 16 + 176 + 16 + 144 = 652. **Primary:** the one fix that applies, else none. **Flow (J-L5):** fault chip (1) lands here; the fix (1) = 2; a line is written to `console.events`. **States:** first run (nothing measured: each line WAITING "not tested yet", the Test hearing button); error lines FAULT with reason; offline (terminal prints `[APP] server not answering` and nothing else). **Keyboard:** lines are a list; Enter on a line opens its detail in a drawer. **Mobile:** More tab shows the lamp list (Voice, Room link, Senses, Memory) read-only; reflow: terminal frame becomes the full-width list.

##### `console.connections`

Master-detail: list 420 (groups 05.1 Brain and voice, 05.2 Modules, 05.5 Detected; rows 56 with lamp) and detail 850. Detail for Voice includes the test button (plays preview in the window when JARVIS is off), pronunciation and remarks cards. The five statuses of "Detected" (connected, missing, planned, ...) keep their dashed treatment for planned. **Primary:** none, or "Connect" on a missing item. **Mobile:** desktop only; reflow: list then pushed detail.

##### `console.hardware`

Left list 300 (Boards, Ports, ESP32 link, Firmware) and pane 970. Board cards keep the existing logic. Firmware card never offers to flash while the app holds the port: it states "close the app first" and links the procedure; flashing needs the owner's OK (AGENTS.md). The Uno wiring guide is gone (5.3); a wiring **table for the 8-channel box** replaces it, labelled with which channels exist. **Mobile:** desktop only.

##### `console.events`

Filter row 44 (chips CORE, EYES, MEM, LIMB, SYS, plus WISH only when `ww` is built in; sim events marked with the amber diamond) and a 1286 x 600 log: 21 lines at an assumed 28 px, paged, backed by the last 14 bus events live and `/api/core/logs?n=200` for history. Same content as the Alt+L overlay. **Primary:** none. **Mobile:** More shows the last 5 events.

##### `console.crew`

Roster 760 x 652 (labelled "Assistants"; "assistants not running yet" when absent, honestly) and the **Agents** PLANNED plate 510 x 652 (what it will do, what it needs, "What is coming"). **Mobile:** desktop only.

### 4.4 Well Wisher sections

Product feel: notebook tempo (160 to 280 ms), calm sentences, one warm orange fill for the single primary, clay-light by default. **Numbering note (2026-11-12 evening):** the rail order is Day, Focus, Study, Tree, Career (§3.1.2); the headings below keep their numbers (§4.4.2 Study, §4.4.3 Tree, §4.4.4 Career, §4.4.5 Focus) so every cross-reference still resolves, and are not the rail order. Boxes: W unless stated. The Now strip (1302 x 40) shows "Pick up: <thing>" or "Now: <next block>" and the day's logged-minutes total (a total only ever goes up) on every section except `day.today` and `focus.session`.

#### 4.4.1 `day`: Know today and start the next block

*Superseded in part by 20.6 (the Almanac forms, `day.month`, planners, body strip, ledger drawer, Google link).*

##### `day.today` (box W+: 1230 x 652)

| Region | Box | Contents |
|---|---|---|
| Sun | 620 x 420 (canvas) | Centrepiece C04-37 re-drawn as a warm painted sun with a face and rays. One ray per completed logged block, **a pure function of today's logged count** (it only falls if the student deletes a log entry, never because time passed; D18); static otherwise; one ray reveals when a block is logged. Caption: "rays = blocks logged today" |
| Now | 620 x 216 | One sentence from the plan ("Next: Paper 2 topic 4, 25 min after Operating Systems"), the welcome-back line, **Start next block** (primary, 56 px high), presets +25 / +50 / +90 / Other (44 px), "Why this?" fold. Evening with a set close time: the primary reads **Close the day** |
| Papers ahead | 594 x 212 | Head 44 and 3 rows of 56: the next three papers with "paper in n days" as plain text, no ticking, no red. **Fixed size in every season** (it does not grow in exam season), with a 44 px **Hide** control. Outside exams the rows show the next application and its first step |
| Next class and gap | 594 x 424 | Head 44; the next three class rows of 56 (time, subject, Present, Absent, Cancelled as 44 px taps, "All present" while a class is pending); a **gap row** of 88: "Free until 14:10 (50 min)" with the presets that fit (presets that do not fit are disabled with the reason, "needs 90, 50 free"); an **All classes** button (44) opening the `classes` drawer, 560 x 652 from the right, with the full list |

620 + 16 + 594 = 1230; left 420 + 16 + 216 = 652; right 212 + 16 + 424 = 652. Next class contents: 44 + 3 x 56 + 88 + 44 = 344, plus 3 x 8 gaps = 368 of 424 (56 px air). Sun share: 620 x 420 = 260,400 of 801,960 (W+ = 1230 x 652) = 32.5 % (computed; the first draft's 560 x 300 was 20.9 %). The six counters moved to `day.week` and the phone pointer is the title-bar pair badge, so the view keeps one centrepiece, one sentence, one primary, the presets and the papers (about 20 targets, down from about 30). Right-column rows share one raised ground with hairline rules (no bento). T720: sun 620 x 372 + Now 216 = 604; Papers ahead 212 + Next class 376 = 604 (the gap row and 3 class rows stay; air goes first).

- **Primary:** Start next block (evening, if a close time is set: Close the day). `day` never changes view by the clock; only the primary's label changes (§3.4).
- **First run:** Sun flat, Now says "No plan yet", primary **Start a 10-minute block**, the classes region shows a dashed "Add classes later" row (no setup gate). **Empty:** no classes today: the list reads "No classes today" and the free hours become the gap row.
- **States:** loading (skeleton in each region), stale (a class tapped on the phone appears after the window regains visibility, as built), offline, planned (`phone-pairing` is built; `sharpen` text only), exam season (Papers ahead keeps its size and lists the next three papers; Study becomes the primary route in "Why this?").
- **Flows.**
  1. *Start a block, any time* (W3): app open (0), **Start next block** (1) -> `focus.session` begins at Begin (2). Target: 2 taps from open to a running block (§2.3 target).
  2. *Class ends, use the gap* (W2, J3): tap a preset in the gap row (1) -> `focus.session` with that length (2). From the phone the same three taps exist.
  3. *Plan the day* (W1, J2, under three minutes): **Plan the day** link in Now (1) opens the `plan` drawer (new, 560 x 652 from the right): up to three rows "When <cue>, I will <step> for <n> min", each editable; cue is a clock time or "after <class>" picked from a list; Save (1). Suggested rows are pre-filled from today's plan blocks and are **editable and declinable**, never locked (U5). Check-ins fire only at cue times and are limited to three a day (U3); default silent on first install. Assumption: stored as a field on the existing plan blocks via a new plan route; not confirmed.
  4. *Tap a class*: Present (1), 1 click once inside Well Wisher.
  5. *Add something done today*: "Add something done" opens the `add-to-day` drawer (the old LF1, 560 wide) (1), type, Save (1).
- **Overflow:** more than 3 classes: the `classes` drawer; Plan and Add-to-day are drawers.
- **Keyboard:** Enter on Start next block; `1`, `2`, `3` on a focused class row set Present, Absent, Cancelled (single-letter keys only inside the focused list); Esc closes drawers.
- **Mobile.** Phone: Today tab (4.6.2). Reflow (358 wide): sun 358 x 160, Now, Papers ahead, Next class (3 rows).

##### `day.week`

Box W. Seven day columns across 1230 x 300 (rest days are first-class: a rest day is a column with the label "Rest day", never a gap), then Attendance margins 600 x 296 (the old LF2: margins and the threshold, no taps) and counters 614 x 296 (today's six counter taps with Undo, moved from `day.today`, plus the week totals; 600 + 16 + 614 = 1230; 300 + 16 + 296 = 612). The "days this week" figure counts days **with a block or a rest day** so a rest day never reads as a miss (TEST T1; the owner can switch to plain total days). Only totals; nothing resets. **Primary:** none. **Mobile:** More tab shows the week read-only.

##### `day.body`

Gym 640 x 612 left (the `GymCard`, which today embeds the old Forge page; to be rebuilt, §5.4), right 574: Quest (optional) 574 x 300 and one PLANNED plate 574 x 296 (`music-import`, dashed, with what it needs); `body-grand` and `life-v2` are rows in the view's PLANNED chip so the density rule of §12.5 (T9) holds (decision I11). Quest "Log session" is the primary only after a set value or proof is typed; else none. **Mobile:** desktop only.

##### `day.close` (backdrop C04-43 night sky, static)

Left 640 x 612: "Logged today" (the old LF1 list) with Undo and Delete per row and the day's total; right 574: **Tomorrow's first start** 574 x 300 (three suggested cues from the timetable, pick one or type your own) and the **Close** block 574 x 296 with **Done for today** (primary) and the line "Not done: kept, not lost". After Done the app goes quiet (no check-ins until the morning plan time). **Flow (W5):** Close the day (1) -> pick tomorrow's first start (1) -> Done for today (1) = 3; target 2 if a suggested start is already highlighted. Needs a `day_closed` event (assumption from `well-wisher-ui.md` 3.3); until it exists the primary is **See tomorrow**, which needs none. **Mobile:** Today tab in the evening.

#### 4.4.2 `study`: Prepare for the next paper

*Superseded in part by 20.7 (the Paper Desk and question engine; Drill moves to Focus, D-V2-11).*

##### `study.papers`

| Region | Box | Contents |
|---|---|---|
| Stage strip | 1230 x 56 | Bank, Paper, Marks, Proficiency, Tomorrow; each "not measured" or computed |
| Island | 560 x 540 | Centrepiece C04-23 re-drawn as an isometric layered-contour island with tiny trees: one layer per syllabus unit raised by real covered topics (a pure function of the current covered count; un-marking a topic lowers it, and the caption says so); empty units flat; caption "layers = topics you have covered, from your log". Canvas 560 x 500 plus a 40 px caption plate |
| Paper list | 300 x 540 | Paged rows of 56 (8 fit = 448, plus a 44 px pager = 492 of 540), exam-date order, each with date and a stage chip |
| Detail | 338 x 540 | Topic chips (tap to cycle state, 44 px, wrapping), sheet links (open `reader`), the **Practice** cell, a "Next paper" line |

560 + 16 + 300 + 16 + 338 = 1230; 56 + 16 + 540 = 612. Island share: 560 x 540 = 302,400 of 752,760 (W = 1230 x 612) = 40.2 % (computed; the first draft's 388 x 300 was about 14 %). T720: island 560 x 492, the list shows 7 rows (392 + 44 = 436 of 492).

- **Primary:** **Practice paper**; **Add questions** (opens `add`) when the bank is empty and nothing is queued.
- **First run:** no papers: the list says "No papers yet. Dates can be added later" with a link to `settings.dates`; the island is flat and says so. **Empty bank:** the harvester states per `well-wisher-ui.md` 3.3 ("Queued: n, off"). **States:** loading, error, offline, exam season (this is the default section; the strip is expanded).
- **Flows.** *Practice the next paper* (J5): Study opens here (0), Practice paper (1), the paper opens in `reader` (2): target 2, as built. *Tap a topic*: topic chip (1) on the next paper. *Add questions to an empty paper*: Add questions (1) -> `add` overlay: stem, marks, topic, tier, Save (2).
- **Overflow:** paper list pager; Reader is an overlay.
- **Keyboard:** Up and Down in the list, Enter selects, `p` on a focused paper starts practice (focus-scoped).
- **Mobile.** Phone: Topics tab (4.6.2) for the next paper only. Reflow: strip, list (5 rows), detail pushed.

##### `study.practice` (moved from Focus: Drill)

Two states in W. **Set up** (left 520: choose paper or topic, count, timed or not; right 694: the paper's bank status and a one-line "what this will record") and **Running** (question 760 x 612 with stem, answer entry, check, marks; side 454: progress as dots, topics touched, Pause). **Primary:** Start (set up), Check (running). Marks are written only on **Save marks** in the Reader (O3), never typed into a free box. **Flow:** Practice (1) -> Start (2) -> answer, Check per question. **Empty:** "No questions for this paper. Add questions." **Mobile:** desktop first; the phone has no practice (planned `phone-papers`, shown as a dashed card in More).

##### `study.plan`

Left 700 x 612: **Today's plan** (blocks in three groups with contracts, per-row Swap, one brief line; the old S4). Right 514: exam-date wheel (C03-05 re-drawn as a calendar-wheel astrolabe, 300 x 300 canvas: dates are real marks, hover or focus names the paper) 514 x 320 and **Free time** (day minus plan blocks) 514 x 276. **Primary:** Start the first block. **States:** empty plan ("Plan the day" opens the day drawer), error. **Mobile:** More shows "Plan: desktop only"; reflow: plan list, then wheel at 358 x 300.

##### `study.library`

Left 640 x 612: reading column (S6 Knowledge of the day, with its PLANNED siblings `knowledge-of-the-day` and `books`) and S8 Findings (hidden in exam season). Right 574: **Study this node** (S7, follows the Tree node) 574 x 446 and the **Coach** PLANNED plate 574 x 150 (drafting and rewording help, never grading; "needs a local model, not built"). The explain-back action (old Interrogation) lives in S7; it returns text feedback only (chipped `MODEL` when a model writes it) and never sets a mastered flag. **Primary:** Study this node. **Mobile:** desktop only.

##### `study.dmat`

Set picker 380 x 612 (figure sequences, equation puzzles, Latin squares; our own code from the public rules, never copied from the test) and item area 834 x 612. **Primary:** Start set; during a set the item area is the only fill. Timed set and score are real (the score is shown only for a finished set). **Mobile:** desktop only.

#### 4.4.3 `tree`: Choose what to learn next

*Superseded in part by 20.8.1 to 20.8.5 (Grove, evidence-gated trees, node drawer).*

##### `tree.tree` (box Wt: 1230 x 664, no switch)

Canvas 846 x 664 (toolbar T1 44 px inside: tree switcher with counts, find, zoom, branch chips) and Inspector 368 x 664 (opaque body, T3). Centrepiece C04-44 re-drawn as a trunk seen from below into a swirling sky: static **background** of the canvas, its dusk-to-dark colour a pure function of the current count of nodes the student has marked mastered (it falls if a mark is removed and never changes with time), caption "sky = nodes you marked mastered; it follows your marks, not the clock". **Mastered is defined here:** it is set only by the student's own "I know this" mark on a node and is labelled "marked by you". No model and no rule sets it; the explain-back action (`study.library`) returns text feedback only and sets no mastered flag. **Primary:** **Study this node** (the NEXT node when none is selected). **First visit:** the one-sentence coach mark T4. **States:** empty tree (no nodes: EmptyState linking `settings.subjects`), loading, planned (`trees-v3` "Whole me", disabled, dashed chip). **Flow:** Tree (1), Study this node (1) = 2, which opens `study.library` at that node. **Keyboard:** arrow keys move between nodes, Enter selects, `+` and `-` zoom (focus-scoped). **Mobile:** desktop only on the phone; reflow: canvas 358 x 360 above a node list; Inspector as a bottom sheet.

#### 4.4.4 `career`: Move the next deadline

*Superseded in part by 20.8.6 (runway, ladder and path, abroad, certificates, money).*

Box W for all five views.

| View | Regions | Primary |
|---|---|---|
| `pipeline` | Top band 260: skyline 1230 x 260 (centrepiece C04-116 re-drawn as tall orange towers over a plain of tents and campfires; a stage lights only when its real item is done; 319,800 of 752,760 = 42.5 % of W, computed) with the **Up next** plate (340 x 212, a caption plate over the right of the band); below, **Pipeline** 1230 x 336 (head 44, 4 rows x 56, pager 44 = 312). T720: skyline 1230 x 212, pipeline 1230 x 336. **Campaigns** (CA3) in a 560 px drawer | Do next step (on the soonest deadline) |
| `certs` | Certificate list 760 x 612 and detail 454 | Do next step on the selected certificate |
| `abroad` | Trials 600 x 612 and Universities 614 x 612 | none |
| `money` | War chest (rupees only) 560 x 612 and ledger 654 x 612; Log money as a drawer | Log money |
| `ladder` | Ladder 500, Goals (read-only, Edit link to `settings.goals`) 340, Parking 358 (500 + 16 + 340 + 16 + 358 = 1230) | none; Parking add is a field with its own Enter |

Rewards (CA11, the old game currency) moved to Proof "Wins" (D24). The monthly review form moved to the Proof weekly review (P5). Record (O4) stays an overlay. **States:** first run (no applications: EmptyState with "Add an application"), loading, error, offline; planned (`college-mail` in Setup connections only). **Flow:** Career (1), Do next step (1). **Mobile:** phone: none beyond a "Career: desktop only" card; reflow: skyline 358 x 140 then Up next then a paged list (5 rows).

#### 4.4.5 `focus`: Run one block with a calm timer

*Superseded in part by 20.7.7 and 20.7.8 (`focus.drill`, Park field, terminal strip).*

##### `focus.start` (box W, light)

Left 640: **Track** `Segmented` (tracks built from the rotation, the old Crucible), **length** presets 25 / 50 / 90 / Other, optional cue line "When <cue>" echoing the plan (T5 test), "Why this?" fold, and **Start session** (primary 56 px). Right 574: a static halftone moon ring (C04-05 re-drawn, 360 x 360) that becomes the dot field when the session begins. **Empty:** "No tracks yet. Tracks come from your weekly rotation" with a link to `settings.rotation`. **Flow:** Focus (1), Start session (1) = 2 (the same count as from `day.today`). **Mobile:** phone: Block tab (4.6.2). Reflow: tracks, presets, moon at 358 x 200, primary.

##### `focus.session` (box W+: 1230 x 652, charcoal immersive in either theme, no Now strip)

| Region | Box | Contents |
|---|---|---|
| Dot field | 360 x 580 | Centrepiece C03-08 re-drawn: one dot per elapsed minute, columns of 30 at an 18 px vertical pitch (30 x 18 = 540 px, computed), 10 px dots. Columns = ceil(planned minutes / 30), at most 5 (a block of 150 minutes), spaced at floor(360 / columns) px (72 px at 5 columns, computed), so 120 to 150 minutes fit the fixed 360 px; the planned length is capped at 150 min. Unfilled planned dots are outlines, with a **"show only logged minutes"** option that is **on by default after a rest or an early end** so the shortfall is never drawn. An early end leaves the filled dots (never a dead object) |
| Readout | 854 x 120 | Elapsed in mono ("32 min"), the track, "calm elapsed time" Segmented (dots only, disc, bar, none) for test T3. No countdown shown unless the student picks it |
| Controls | 854 x 200 | **Done** (primary), Pause, "Take a break" (goes to `focus.rest`), "Silent end" switch (on by default) |
| Resume note | 854 x 56 | The honesty line when resumed ("no running timer for an unconfirmed block") |

Elapsed minutes are counted from a confirmed start. Widths: dot field 360 + gap 16 + right column 854 = 1230 (the first draft's 360 + 400 + 454 + 2 x 16 = 1246 overflowed); right column 120 + 16 + 200 + 16 + 56 = 408 of 652. Dot field share 360 x 580 = 208,800 of 801,960 = 26.0 % (computed). **Flow (W3):** Begin (1) -> Done (1) -> `log` overlay (440 x 360): minutes prefilled, Save (1) -> back to `day.today` = 3 taps for a whole block lifecycle, log in 2 (Done, Save). **States:** paused (dots hold, readout says "paused"), interrupted by the app closing (on next open the Resume pill says "last seen", never a continuing timer), error (log failed: the minutes stay on screen with Retry, nothing lost). Exit without guilt: ending or leaving triggers nothing. **Motion:** one dot per minute; no flashing; at most one new dot per 60 s; Calm mode adds no animation. **Mobile:** Block tab shows the same dots at 2 columns, 30 dots at a 14 px pitch (assumption) and the same controls.

##### `focus.rest`

Left 640: **Take 5** (primary), "Back to the block" and "Skip the break" (no penalty, no confirm), a calm bar (not a countdown number). Right 574: C04-38 calm hill (static painterly, 574 x 360). "Rest days are part of the week" line. The break is remembered so Back returns to the block. **Flow:** Take a break (1) -> Take 5 (2) -> auto-return line, Back (3). **Mobile:** Block tab.

#### 4.4.6 `proof` rail (not a navigation item)

Collapsed: 56 x 680 (a vertical label "Proof" and a 40 px static relief ring icon). Open: 320 x 680 panel; pinned from a container width of 1500 px. **Drill-down:** level 1 is the index: centrepiece C02-24 re-drawn as an embossed ring of the day's real statistics, 288 x 256 (the top 40 % of the 680 px panel = 272, with the caption plate, computed), caption "ring = stats from logged work", then 11 rows of 44 px in a bounded list that scrolls inside the panel (the panel is not a view root, §4.1.4): P1 Rank, P2 The System suggests, P3 Stats, P4 Quest lines, P5 Weekly review, P6 Building hours, P7 Proof of work, P8 Wins, P9 Recent, P10 What got in the way, and the new **Make this more accurate** row (11 x 44 = 484 against 408 visible). When the panel is pinned (container 1500 px and up) the ring stays pinned at the top while the list scrolls. **P1 Rank** is a personal, descriptive label computed from cumulative logged totals: it cannot fall (no demotion exists), is never relative to other people, and prints its formula in a "Why" line; B06 confirms the built card has no demotion and otherwise renames it "Level". **P2 The System suggests** carries a `RULE` or `MODEL` chip and a "Why this" line. **P4 Quest lines** are the student's own multi-step lists with no reward currency and a Hide switch (the old currency is the Wins card, counts only). Level 2 is one card at full height with a Back chip. No primary by design (the Open review button lives inside P5). **Wins (P8)** shows counts of completed planned actions, never opens (D24). **States:** every card keeps its skeleton, message and Retry (kit `Card` props); statistics with nothing logged show their "next step" line (as built). **Flow:** Alt+P or rail (1), P5 (2), Open review (3); pinned at 1920: 2. **Mobile:** More tab on the phone shows "Proof: desktop only"; reflow: a full-height sheet with the same drill-down.

#### 4.4.7 Well Wisher overlays (one deep)

| Id | Box | Primary | Notes |
|---|---|---|---|
| `date` | 640 x 600 | Save N changes | One card per paper, labelled fields |
| `reader` | 880 x 640 | Save marks once marks are entered, else none | Typeset paper or sheet; opened from Study; portalled |
| `record` | 760 x 600 | none, close only | Record, achievements, season |
| `log` | 440 x 360 | Save | Minutes prefilled from the session; custom amount is 3 clicks |
| `confirm` | 420 x 220 | The named action; the cancel is equal weight | Promoted to shared because JARVIS memory delete needs it (conflict C2) |
| `add` | 560 x 560 | Save question | Stem, marks, topic, tier |

### 4.5 Cross-product moments

| Moment | Flow | Click count |
|---|---|---|
| Ask JARVIS from Well Wisher | Ask orb (1) with the `voice` port present; with it absent the orb shows a still ring and "text only" and opens the palette Ask group (which shows "Ask needs JARVIS") | 1 |
| Study lights (ambient, optional) | On the student's tap only, `focus.start` shows "Study lights" if the `ambient` port exists (1); never inferred from presence, never on by default | 1 |
| Quiet | `settings.quiet` Quiet switch, or the title-bar Quiet lamp (1) turns off every nudge, check-in and sound cue; the app cannot lift it | 1 |
| Pair the phone | rail pair (1) -> listener switch if off (2) -> Pair (3) | 3 or 4 |

### 4.6 Phone pages (390 CSS px, designed separately from the desktop)

Common: one pairing, one generated tokens file, light clay theme with a dark option, 44 px taps, bottom bar 56 px with four tabs and a header showing the product name and the lamp; a two-item header switch appears only when paired to both products. Content width 358 px. Phone screens act through the same server routes as desktop; read-only screens say "read-only" in the header.

#### 4.6.1 JARVIS `/phone/` (Talk, Room, Senses, More)

| Tab | Layout top to bottom (px heights at 390 x 844, assumption) | Primary | States |
|---|---|---|---|
| Talk | State pill 44; level bar 358 x 64 (only when the phone's mic analyser reports, else a still ring, assumption: phone analyser is new work); a persistent **mic-open indicator** (the LIVE lamp plus the words "MIC OPEN") with a 44 px **Stop**, shown whenever the phone's mic is open; **Wake** 358 x 56; turns list (last 3, 72 each); text field 44 plus Send 44; "Speak replies here" switch 44 | Wake | unpaired (pairing code and device name), offline, text-only |
| Room | Modes chips (wrap, 44); relay tiles 2 columns of 175 x 88 **confirmed by the board only, never optimistic** (a tap shows WAITING until the board reports; 150 ms settle, 6 s "not confirmed"); power-safe banner; sticky **All off** 358 x 56 above the bar | All off is sticky; tiles act | board absent: tiles dashed "no board"; WAITING after a tap |
| Senses | Header "read-only"; status list rows 56: source ("the wall box, measured" or "<source>, not measured"), presence word ("predicting"), motion, frames, loss; one line "Simulated data is never a measurement" | none | simulated stamp on every row |
| More | Pairing (device list, Revoke), console health summary (Voice, Room link, Senses, Memory lamps), **desktop only** cards (Sound, Rules, Signal, Teach, Memory, Console), "What is coming" | none | |

#### 4.6.2 Well Wisher `/phone/ww` (Today, Block, Topics, More)

| Tab | Layout top to bottom | Primary | States |
|---|---|---|---|
| Today | Now sentence 72 and **Start next block** 56 (evening: Close the day); presets +25 / +50 / +90 as three 112 x 44 buttons; classes (rows 56 with Present, Absent, Cancelled 44 px each); counters 3 x 2 tiles with Undo; quiet line | Start next block | first run: one primary "Start a 10-minute block"; offline: last values dimmed |
| Block | Track chips, length presets, **Start**; running: dots (2 columns), elapsed mono, **Done**, Pause, Take a break; after Done the log sheet | Start, then Done | interrupted: "last seen" line |
| Topics | Next paper header with its date; topic chips 44 px (tap cycles state) | none | no paper: "Add a paper on the desktop" |
| More | Week (read-only, rest days shown), Quiet switch, pairing, **desktop only** cards (Study, Tree, Career, Proof, Setup; `phone-papers` as a dashed PLANNED card) | none | |

Phone motion: the same governor rule, reading `data-motion-load` (the phone page does not read it today, S0 section 6, so this is new work); Calm switch in More. Phone is currently dark-only with three inline palettes; the generated tokens file replaces them (5.6).

### 4.7 View-local ids introduced by the screen specification

| Id | Kind | Where |
|---|---|---|
| `day.today#plan` | drawer | 560 x 652, W1 plan editor |
| `day.today#add-to-day` | drawer | 560 wide, the old LF1 |
| `day.today#classes` | drawer | 560 x 652, the full class list |
| `senses.presence#motion`, `#map` | in-view toggle | stage state; the twin mounts on Map only |
| `career.pipeline#campaigns` | drawer | 560 wide |
| `core.talk#earlier` | drawer | 560 x 652 |
| `proof.panel` level 2 | drill-down | one card, Back chip |
| Proof card "Make this more accurate" | new Proof row | opens `settings.dates` or `settings.subjects` |
| `NowStrip` | component | `ww/day/NowStrip.tsx` |

---

## 5 Migration map from the current carcass

### 5.1 Principles

1. **Seams first, looks later.** The four cuts in 5.7 land before any new screen so every later step can be built and tested in one product.
2. **Shared layers first, then sections; no exam wait** (F3 closed by I34, owner decision of 2026-11-12 evening). The shared layers (tokens, kit, lamp, registry, shell, ports) land before any section is rebuilt on them. Every risky flip (`app.shell`, `ww.ia`) sits behind a flag that defaults off, and the app works at every merge. The Well Wisher move flips behind `ww.ia` once Q01 passes, with a "moved to" hint in every old place for two weeks after the flip (target).
3. **Keep every legacy id working** (§3.2 alias table) for one release; the alias table lives in the shared route resolver.
4. **One commit per move**, with `git mv` for renames so history follows, tests moved in the same commit, `npx vitest run`, `npx tsc -b` and the Playwright specs green after each (AGENTS.md). Never build into `app/ui/dist` while the app runs.
5. Actions: **keep** (unchanged), **restyle** (tokens and layout only), **move** (new home, same logic), **merge**, **split**, **delete**, **owner decides**. Risk is the chance a move breaks a tested behaviour: low, medium or high.

### 5.2 JARVIS pages, shell and navigation

| Current | New home | Action | Files | Risk |
|---|---|---|---|---|
| `Core` page (398 lines) | `core.talk` | split and restyle | `pages/Core.tsx` -> `jarvis/core/Talk.tsx`; `components/Reactor.tsx` -> `jarvis/core/Hill.tsx` (rebuilt as the hill, ring from C02-07) | medium (Reactor has its own rAF) |
| Core: conversation with flags (and the "Earlier" drawer) | `core.talk` (right column) | move | in `Core.tsx` | low |
| Core: Share a review (was Review for Claude) | `memory.keep` Actions (I39) | move | out of `Core.tsx`, into the `keep` view | low |
| Core: latency strip | `core.talk` state strip and `console.health` timings | split | `Core.tsx` | low |
| Core: MissionCard | none | **delete** (D16; the Core to ww coupling) | `Core.tsx` lines 12-13 imports; `germoney/stores/checklist-store`, `player-store` stay with ww | low |
| Core: SystemsCard | title-bar annunciators and `console.health` | merge | `Core.tsx`, `Shell.tsx` | low |
| Core: StaffCard | `console.crew` | move | `components/Staff.tsx` | low |
| Core: MediaCard | `core.sound` | move | `components/MediaCard.tsx`, `lib/media.ts` | low |
| `Yaadash` page | `memory.recall`, `.beliefs`, `.people`, `.keep` | split | `pages/Yaadash.tsx` -> `jarvis/memory/*.tsx` | medium |
| `Aankhen` page | `senses.presence`, `.signal`, `.teach` | split | `pages/Aankhen.tsx` (585), `components/EyesView.tsx` -> `senses.signal`, `TeachTrainPanel`, `FirstLight`, `MeasureRoom` -> `senses.teach`, `twin/*` unchanged (lazy, Map only) | high (largest page; WebGL; honesty logic must be preserved: tests for `shownZones`, "predicting") |
| `Limbs` page | `room.switches`, `room.rules`, `console.hardware` | split | `pages/Limbs.tsx`; WallBox -> faceplate; DeviceCards -> keys; Modes, PresenceRule -> `room.rules`; BoardPanel, BoardPorts, Esp32LinkCard, FirmwareCard -> `console.hardware` | high (confirmed-by-board logic in `lib/limbs.ts` must be untouched) |
| `Connect` page | `console.connections`; 05.3 exports to `memory.keep`; 05.4 Phone to `pair` | split | `pages/Connect.tsx`, `components/ConnectControls.tsx` | medium |
| `System` page | `console.health` | restyle | `pages/System.tsx` | low |
| Dock (14 items), `Shell.tsx` | the rail (5 per product) and title bar | **replace** | `components/Shell.tsx` -> `shell/Rail.tsx`, `shell/TitleBar.tsx` | high (every page's entry) |
| Eight dock Well Wisher tabs | none (aliases) | delete | `lib/store.ts` `TABS` 21 ids -> 10 sections plus `LEGACY` aliases | medium |
| `Ticker` (14 events) | `console.events` and Alt+L | move | `components/Shell.tsx` | low |
| Command palette | shell palette with Go, Do, Ask | restyle and fix hints | `components/CommandPalette.tsx` (line 42 `Ctrl ${i+1}`) | low |
| `pageLoaders.ts` | one loader table keyed by `<section>.<view>` | restyle | `pageLoaders.ts` (keep the prefetch order; Aankhen and Mission stay un-prefetched) | medium |
| `.page` `overflow:auto` | `overflow:hidden` per view plus tests | restyle | `styles/shell.css:95` | high (every page must fit first) |

### 5.3 JARVIS components and orphans

| Component | Today | New home | Action | Risk |
|---|---|---|---|---|
| `MemoryGalaxy`, `GrowthChart`, `galaxy/*`, `routes_galaxy` | demo only, three.js | none | **delete** from the app build; history keeps it (D19). Remove `galaxy-demo.html` and `galaxy-bench.html` from the app build; `/api/galaxy*` routes: owner decides whether to keep as dead routes | low |
| `RelayWiring`, `BoardId 'uno'`, `nextUnoPin`, WallBox not-active branch | Uno guide | wiring **table** in `console.hardware` | delete, replace | low; keep `uno.py` and `limbs/` firmware (history) |
| Duplicate `PhoneCard` (Limbs, Connect) | two mounts | `pair` sheet (one home) | merge | low |
| `WallBox` | hides absent channels (`rows.filter`) | `room.switches` faceplate, absent drawn "unavailable" | restyle and fix | medium |
| `AwayModeCard`, the card named `SecurityAlert` (renamed `MotionNotice` before it is mounted), `EnergyCard` | unmounted | `room.rules` rows as PLANNED (D20) until backends confirmed | owner decides (F13 for Away) | low |
| `LibraryPanel` | unmounted | `core.sound` list | move | low |
| `ReminderAlerts` | unmounted | mounted once in the shell | move | low |
| `RemindersCard` | Yaadash | `memory.recall` right pane | move | low |
| `LearnedReviewCard` | Yaadash | `memory.beliefs` right list | move | low |
| `RemarksCard`, `BrainCard`, `VoiceCard`, `PronunciationCard`, `ModulesSection`, `ExportsSection` | Connect | `console.connections` detail panes | move | low |
| `PredictionBar` | Aankhen | `senses.presence` meters | move | low |
| `Reactor.tsx` | Core canvas | rebuilt as the hill; ring kept | split | medium |

### 5.4 Well Wisher: workspaces, views, cards (from `well-wisher-ui.md` 3.4 and S0 section 2)

| Current | New home | Action | Files | Risk |
|---|---|---|---|---|
| Frame (`ww/frame/*`), tab strip `WorkspaceTabs.tsx` | shell rail and view switch; frame keeps overlays, Proof, density, season, scene memory | **merge** into the shell; delete the strip | `ww/frame/WorkspaceTabs.tsx` deleted; `Frame.tsx` slimmed; `workspaces.ts` -> `routes.ts` with `LEGACY` kept | high |
| Left column L1 to L5 (`ww/left/*`) | `day.today` regions (L1 band, L2 Now, L3 classes, L4 counters, L5 row) and the 40 px Now strip elsewhere | **move** and split | `ww/left/L1..L5.tsx`, `Left.tsx`, `store.ts`; new `ww/day/NowStrip.tsx`. Fallback if the strip fails the 2-taps target: the column stays pinned from 1600 px (D8) | high (mounted once, never remounts; today every workspace assumes it) |
| Study workspace (`ww/study/*`) | `study.papers`, `.plan`, `.library`, `.dmat`; Drill in as `.practice` | keep, add a view | `StudyPage.tsx` view list; `PracticeCell.tsx` | low |
| Tree workspace (`ww/tree/*`) | `tree.tree` | keep, restyle | `TreeWorkspace.tsx` | low |
| Life workspace (`ww/life/*`) | `day.week`, `day.body`, `day.today#add-to-day`, `day.close` | split and rename | `ww/life/` -> `ww/day/` with `git mv`; `LifeWorkspace.tsx` view list; `AddToDay` becomes a drawer; `GymCard` rebuilt without `germoney/pages/Forge` | high (Life tests, 248 browser specs) |
| Career workspace (`ww/career/*`) | `career.*`; `PlanView` -> `ladder`; Rewards moves out | keep, rename, one move | `CareerPage.tsx`, `PlanView.tsx` -> `LadderView.tsx`; Rewards to `proof/cards.tsx` Wins | medium |
| Focus workspace (`ww/focus/*`) | `focus.start`, `focus.session`, new `focus.rest`; Drill out | split | `Crucible.tsx` -> `Start.tsx` and `Session.tsx`; new `Rest.tsx`; `Drill.tsx` -> `study/Practice.tsx` | medium (`session.ts` logic untouched) |
| Setup workspace (`ww/setup/*`, 18 sections) | `settings` sheet, ids `settings.<section>`; unchanged logic | **move** | `SetupPage.tsx` wrapped by `shell/SettingsSheet.tsx`; `view.ts`, `INDEX` unchanged | low |
| Proof panel and rail (`ww/proof/*`, ten cards) | `proof.rail` and `proof.panel` with a drill-down and one new card | keep, restyle, add | `ProofPanel.tsx`, `cards.tsx` | medium |
| Overlays O1 to O8 (`ww/overlays/*`, `overlayRegistry.ts`) | registry moved to the shell; `phone` -> `pair`, `roadmap` -> "What is coming", new `shortcuts`, `events`; `confirm` shared | move and rename | `overlayRegistry.ts` -> `shell/overlayRegistry.ts`; `overlays/Phone.tsx` -> `shell/Pair.tsx` | medium |
| `plannedFeatures.ts` (28 entries), `Planned.tsx`, `kit/Placeholders.tsx` | registry mechanism shared; entries stay in `ww/` | move the mechanism | `shell/plannedRegistry.ts`; `ww/plannedFeatures.ts` keeps entries | low |
| Kit (`ww/kit/*`, 31 exports) | `shared/kit/` plus per-product kits (5.7) | move | `ww/kit/index.ts` | medium (every import changes; do with codemod, tests green) |
| Design tokens (`ww/design/*`, `styles/design/primitive.css`, `ww/design/themes/*`) | layers 1 and 2 in `shared/tokens/`, layer 3 per section | restyle and move | `primitive.css` selector `.ww, .ww-portal, html[data-ww]` -> `:root`; themes `paper`, `ash`, `indigo` map to `clay-light`, `clay-dark`, variant | high (visual snapshots) |
| Motion governor (`ww/design/motion/*`) | `shared/motion/` | move | `governor.ts` etc. | low |
| `plan` store, `usePlan` (`germoney/game/plan.ts`), `store.ts`, `data/bank`, `tree/*`, stores | `ww/data/*` | **move** (they are load-bearing for ww: 26 imports of `game/plan` alone) | `germoney/game/plan.ts`, `game/store.ts`, `data/bank`, `tree/*`, `stores/*` | high; must precede deleting `germoney/` |
| ww imports of old pages (`Forge`, `Calibration`, `Study`, `Today`, `Exams` types, `Reader`, `ui` EMPTY) | extract the hooks, types and helper components into `ww/data` and `ww/kit` | split | `ww/life/GymCard.tsx`, `ww/setup/sectionsPlan.tsx`, `ww/study/*`, `ww/tree/*`, `ww/overlays/Reader.tsx`, `ww/overlays/DateSheet.tsx`, `ww/setup/Harvester.tsx` | high |
| Game layer: `FxLayer`, `GameFx`, `Dialogs`, `startBridge` (mounted in `App.tsx`) | inside the ww root only | **move** | `App.tsx` lines 3-4, 29; `germoney/ui.tsx`, `game/fx.tsx`, `game/bridge.ts` | medium (`bridge` speaks through `/api/core/speak`: becomes the `voice` port, with a null adapter) |
| New: Make this more accurate card, `plan` drawer, `focus.rest`, `day.close`, NowStrip | new | add | `proof/cards.tsx`, `ww/day/*`, `focus/Rest.tsx` | medium; backend assumptions listed in 4.4.1 |

### 5.5 Old Well Wisher layout (`germoney/*`)

| Current | Action | Condition |
|---|---|---|
| `germoney/pages/*` (Today, Study, Life, Tree, Focus, Log, Road, Status, Settings, Armory, Calibration, Classes, Crucible, Direction, Drill, Exams, Forge, Interrogation, Proof, Schedule, SystemInputs, Trials) | **delete** after extraction (5.4) | `flag.ts DEFAULT_ON` no longer false under test, i.e. vitest runs on the new layout |
| `MissionNav`, `SettingsDrawer`, `ReaderDrawer`, `MissionRoot` extras ("Old layout" and "New layout" buttons) | delete | same; the buttons go with the old layout |
| `germoney/game/{engine,campaign,trials,characters,decks,achievements,kit,sfx,tree,util}` | **owner decides** per file: keep what `ww/` imports (`trials`, `tree`, `util`, `engine`, `decks`, `campaign`, `achievements` are imported today), delete the rest | After the extraction a grep for unreferenced exports decides |
| Dock entries for Well Wisher | delete | The rail replaces the dock |

### 5.6 Phone

| Current | New | Action | Risk |
|---|---|---|---|
| `phone_page/index.html`, `app.js`, `relays.js`, `relays.css` | JARVIS page with four tabs (Talk, Room, Senses, More); "Study" link removed | restyle and split | medium |
| `phone_page/ww.html`, `ww.js`, `ww.css` | Well Wisher page with four tabs; the 5-section column becomes Today and Block | restyle and split | medium |
| three inline palettes | one generated `phone_page/tokens.css` from the shared tokens (script and a drift test like `board_page`) | add | medium |
| Relay tile amber "asked, not confirmed" | WAITING half-disc lamp | change | low |
| Device colour hex disagreement | one table | fix | low |
| `board.html` | unchanged | keep | none (its drift test stays) |
| Manifests | two manifests, one per page | add | low |

### 5.7 Cuts needed for separability (do these first)

| Cut | What | Verify |
|---|---|---|
| S1 Core does not import Well Wisher | Delete MissionCard from `Core.tsx`; the Core page imports nothing under `germoney/` or `ww/` | ESLint `no-restricted-imports` plus an import-graph vitest |
| S2 App mounts the game layer only inside the ww root | Remove `FxLayer`, `GameFx`, `Dialogs` and `startBridge` from `App.tsx`; mount in `ww/index` root | `VITE_PRODUCT=jarvis` build has no `ww/` or `germoney/` module |
| S3 One navigation | Delete the eight dock tabs and the workspace strip; the rail is the only one | Playwright `keyboard.spec.ts` updated |
| S4 `primitive.css` shared | Selector `:root`, file moves to `shared/tokens/`; the ww selector is kept as an alias for one release | `tokens.test.ts` and `css-lint.test.ts` green |
| S5 Ports with null adapters | `voice`, `memory`, `notify`, `ambient`; `/api/core/speak` calls from `germoney/game/bridge.ts` go through `voice` | A ww build renders "text only" with `voice` absent |
| S6 Product switch hidden when one product is built in | | Both builds pass `scripts/bundle-budget.mjs` (extended to per-product) |
| S7 Kit split | The 31 kit exports move to `shared/kit/`; product kits keep Dial, VoiceHill, RingBars, ChannelMatrix, TerminalFrame (jarvis) and StageStrip, Stat, TapGroup, CoachMark, DayDial (ww) | |
| S8 Phone pages independent | Each page loads without the other | `phone-ww.spec.ts` plus a new JARVIS phone spec |
| S9 `ww` depends on nothing in `germoney/` | After 7.4 extractions | grep returns zero |

### 5.8 Order

The order of work is the sequence and the work-package table in §15.3 and §15.4 (one table, so the two cannot disagree; the first draft had a second, different order here). The migration phases and their gates, in that order: (0) measure the real window (F8, R01) alongside everything else, never as a gate; (1) the shared foundation, most reusable layer first: tokens, additive (B03, starts now), with the seams S1, S2, S4 (B01, no visible change) and the lamp (B04), then the kit (B03b, B03c), the registry (B02) and the art pipeline (B05b); (2) the shell behind `app.shell` with the one navigation S3 and the ports with null adapters S5 (B05); (3) the ten sections on top: JARVIS in the order of decision I10 (B06), then Well Wisher behind `ww.ia` (B11), then centrepieces (B06b), voice (B07), phone (B09), learning loops (B10); (4) the flips after Q01, then retire the old layout (B13); (5) the work that waited resumes: rules and FSRS (B08), Coach (B12), relay and wall-box work. Tokens come before the shell (§15.4); the art phase is B05b and B06b, not a trailing phase. Gates are the project commands named in each WP.

### 5.9 Risks of the migration

| Risk | Why | Mitigation |
|---|---|---|
| Moving learned places mid-semester | The Well Wisher move, and the new Well Wisher order (Focus now second), change where the student taps | The flip sits behind `ww.ia`, defaults off and happens after Q01; legacy ids resolve as aliases; "moved to" hints for two weeks after the flip; one binding table to swap the order back (§3.1.2) |
| Aankhen and Limbs splits lose honesty logic | The confirmed-by-board and "predicting" rules live inside the pages | Extract logic to `lib/` first with tests; do not edit `lib/limbs.ts` or `lib/belief.ts` |
| The Now strip fails the 2-taps target | The column carried context on every page | Pinned column from 1600 px as the fallback (D8) |
| Renaming `ww/life` breaks tests | Paths in 41 test files and 19 specs | One `git mv` commit with codemod; run the whole suite |
| `germoney/` is load-bearing | 26 imports of `game/plan` alone; GymCard embeds the old Forge page | Extract before deleting (5.4, S9) |
| New backend assumptions | `day_closed` event, plan "starts" field, output RMS from `core/playback.py` | Each is marked an assumption in its view; ship the view with the honest fallback first |

---

## 6 Design system

Four layers (primitives, semantic tokens, section themes, component tokens), one tactile palette computed against WCAG, one typographic system, one elevation ladder, a forced-colours rendering for every layer and one honesty component (the lamp). Reference pictures supply swatch values and ideas only (C02-18 `#E8EAE9` off-white, C02-44 `#171717` near-black, C02-48 `#DEDEDE` clay grey, C02-42 `#4D4D4D` mid grey, C02-41 `#F25623` orange); nothing is pasted.

### 6.1 The shared tactile base

One material, many scenes. Chrome (title bar, rail, sheets, buttons, fields) is matte clay: raised surfaces are a touch lighter than the ground with a soft two-layer shadow; recessed wells (fields, readouts, tracks) are a touch darker with an inner shadow. Depth gives feel; **edges carry legibility**. The canonical neumorphic recipe computes to 1.27:1 and 1.72:1 against its ground and WCAG 1.4.11 ignores soft shadows (Strand 2), so every raised or recessed control also gets a real 3:1 edge, an icon or text, and a 2 px focus ring drawn with `outline`, not shadow. Instrument precision comes from hairline rules, a dotted grid, mono metadata and tick scales. Z-axis feedback is real and cheap: hover settles the element 1 px toward the ground, press sinks it 2 px with an inner shadow, an open sheet rises; all with `transform` and `opacity` only, with at most two shadow layers. A **scene** is the canvas of a section: **light** scenes are the clay ground; **immersive** scenes (Core hill, Senses, Console, Focus session) are always charcoal with light ink, in either theme, so the chrome stays the unifying frame.

**Themes.** `clay-light` and `clay-dark` for chrome, applied globally. First-run default differs by product (JARVIS clay-dark, Well Wisher clay-light); once the student picks a theme it applies to both. Existing Well Wisher themes map: `paper` to `clay-light`, `ash` to `clay-dark`, `indigo` kept as an optional variant. A `forced-colors: active` rendering is specified for every component (box-shadow, text-shadow and gradients are removed there; the app has none today; Strand 6). Calm (reduced motion) is a first-class switch.

### 6.2 Layers: primitives, semantic tokens, section themes, component tokens

#### 6.2.1 The four layers and the rule between them

| Layer | Prefix | Holds | Who may read it | Who may write it | Selector scope |
|---|---|---|---|---|---|
| 1 Primitives | `--p-*` | Raw values only: colour ramps, space, radius, size, line, weight, durations, easings, shadow alpha steps | Layer 2 files only | `styles/design/primitive.css`, `styles/design/primitive-color.css` | `:root` (today `.ww, .ww-portal`) |
| 2 Semantic | `--surface-*`, `--ink-*`, `--edge-*`, `--state-*`, `--accent-*`, `--elev-*`, `--focus-*`, `--type-*`, `--space-*`, `--radius-*`, `--dur-*`, `--ease-*` | Roles. Theme-dependent through `[data-theme]` and `[data-scene]` | Every component and section file | `styles/design/semantic.css` and the theme files | `:root[data-theme=...]`, `[data-scene=...]`, `[data-product=...]` |
| 3 Section themes | `--sec-*` plus a short list of overrides | What changes per section: mark colour, art fills, scene type, control and panel radius, tempo, spring | Section pages and art | `styles/sections/<section>.css`, ten files, scoped by `[data-section="<id>"]` | `[data-section]` |
| 4 Component tokens | `--<component>-*` (`--btn-*`, `--key-*`, `--knob-*`, `--switch-*`, `--field-*`, `--panel-*`, `--lamp-*`, `--plate-*`, `--readout-*`, `--log-*`, `--bracket-*`, `--chamfer`) | Per-component aliases of layer 2 roles with the component's own geometry | The component's own CSS | `shared/kit/component.css` (shared) and `jarvis/kit/*.css`, `ww/kit/*.css` for product parts | Declared on the component root class, never on `:root` |

Hard rules, each enforced by a test (target; extend `css-lint.test.ts`, which already forbids `--p-*` outside token files):
1. No hex, `rgb()` or `hsl()` literal outside layer 1 and the three theme files. A lint test greps the built CSS.
2. Components read layer 2 or their own layer 4 names. Never `--p-*`, never `--sec-*` unless the component is an art piece.
3. A section file may only declare names on the allow-list in 6.2.4. Anything else fails lint, so a section cannot quietly restyle the chrome.
4. Product brand (`[data-product]`) may only set: default theme on first run, `--tempo`, `--type-kicker`, `--sec-*` defaults. It may not change a surface, ink, edge or state value. This keeps the two products one material.
5. State colours (`--state-*`) are never overridden below layer 2: colour only ever means state (§1.2, D11).

#### 6.2.2 Cascade and attributes

Order of import (one entry, `styles/design/index.css`): `primitive.css`, `primitive-color.css`, `fonts.css`, `semantic.css` (clay-light default, clay-dark under `[data-theme=clay-dark]`), `scene.css` (the `[data-scene=immersive]` remap), `elevation.css`, `state.css`, `forced.css`, `contrast.css`, then `products/*.css`, `sections/*.css`, then component files, then `motion.css`.

| Attribute | Set on | Values | Meaning |
|---|---|---|---|
| `data-product` | `<html>` | `jarvis`, `ww` | Brand layer; first-run theme; tempo |
| `data-theme` | `<html>` | `clay-light`, `clay-dark`, `indigo` (Well Wisher optional variant) | Chrome theme. First run: JARVIS `clay-dark`, Well Wisher `clay-light`; once chosen it applies to both (§6.1, F6) |
| `data-scene` | the canvas root of a section | `light`, `immersive` | `immersive` remaps layer 2 to the charcoal set regardless of theme (section 6.3.3) |
| `data-section` | page root | the ten section ids | Layer 3 |
| `data-view` | page root | `<section>.<view>` | Test ids, route fragment |
| `data-contrast` | `<html>` | `high` (from `prefers-contrast: more` or the Settings switch) | Stronger edges and ink-3 (§6.5) |
| `data-motion` | `<html>` | `full`, `calm` | Calm switch; existing |
| `data-motion-load` | `<html>` | `high`, `low` | Governor; existing |

#### 6.2.3 How the layers map onto the existing files, and what moves where

Existing facts (Strand 0): `styles/design/primitive.css` (330 lines) is already the "shared tier-1 file" but is scoped to `.ww, .ww-portal` plus `html[data-ww]`; `ww/design/themes/{ash,paper,indigo,workspace}.css` are tier 2 and tier 3 mixed; `ww/design/component.css` (51 lines) is the only layer-4 file; `ww/design/motion.css` and `motion/*` are the governor; `styles/tokens.css` (76 lines) holds the JARVIS provenance names (`--bg --ink --live --sim --fault --glass-*`), imports four fontsource families and is read by every JARVIS page.

| Today | Becomes | What changes | Notes |
|---|---|---|---|
| `styles/design/primitive.css` | stays at the same path, layer 1 and the theme-independent roles | Re-scope the selector from `.ww, .ww-portal` to `:root`; delete `--p-ash-*`, `--p-saffron-*`, `--p-sand`; keep every space, radius, size, line, weight, duration and easing value unchanged (existing tests assert them) | The `html[data-ww]` duplicate block for view-transition pseudo-elements becomes redundant once the scope is `:root`; delete it |
| (new) `styles/design/primitive-color.css` | layer 1 colour ramps | `--p-clay-*`, `--p-char-*`, `--p-orange-*`, `--p-cyan-*`, `--p-amber-*`, `--p-red-*`, `--p-ochre-*`, `--p-teal-*`, `--p-moss-*`, `--p-brick-*` (values in 6.3.1) | Colour only here, so the "no hex outside primitives" lint has one allowed file |
| `ww/design/themes/ash.css` | `styles/design/semantic.css` `[data-theme=clay-dark]` block | Rename roles to the layer-2 list in 6.3.2; `ash` is retired as a name; first-run default for JARVIS | Keeps the existing role names alive as aliases for one release (see alias table below) |
| `ww/design/themes/paper.css` | `semantic.css` default block (`clay-light`) | Same | Core §6.1 maps paper to clay-light |
| `ww/design/themes/indigo.css` | `styles/design/theme-indigo.css` | Rewritten on layer-2 names; still optional; passes the same contrast table or is dropped | Not part of the table here; it must pass the 4.5 and 3.0 tests to ship |
| `ww/design/themes/workspace.css` (per-workspace `--accent`, `--on-accent`, `--accent-wash`, `--tint`, `--tempo`, `--spring-main`) | `styles/sections/day.css`, `study.css`, `tree.css`, `career.css`, `focus.css`, `proof.css` | Per-section accent and `--tint` are removed (one accent, no ground tint, V5); `--sec-mark`, art fills, radii, tempo and spring remain | The "derived `--surface-n` from `--base-n`" computation is deleted with the tint |
| (new) | `styles/sections/core.css`, `room.css`, `senses.css`, `memory.css`, `console.css` | JARVIS section themes; first time any exist (Strand 0, 1.1: no `data-section` on JARVIS pages today) | Add `data-section` to the five JARVIS page roots |
| `ww/design/component.css` | `shared/kit/component.css` | Layer 4 for shared kit; `--hit: 44px` stays; `--field-h: 40px` stays (the 44 px hit area comes from padding) | `--col-l`, `--col-r` density widths are Well Wisher's own and move to `ww/frame/frame.css` |
| `ww/design/motion.css`, `motion/*`, `springs.generated.css` | `shared/motion/` (unchanged content) | Move up the tree; no value change; `--tempo` now set by the product layer | Governor stays shared (§1.4) |
| `styles/tokens.css` | `styles/design/legacy-alias.css`, then deleted | Replace values with `var(--surface-*)` aliases (table below); remove four `@import` lines and add `fonts.css`; drop `--f-display` (Anton) | One release of aliases so JARVIS pages migrate page by page |
| `styles/shell.css`, `pages.css`, `aankhen.css`, ... | read semantic names | Page by page during the build; no new hex | Aankhen's canvas colours read `--art-*` (§6.5.4) |
| `phone_page/` inline palettes (three today) | one generated `phone_page/tokens.css` | `scripts/gen-phone-tokens.mjs` emits layers 1 and 2 for clay-light and clay-dark at 390 px; both phone pages import it; fixes the white and fan hex disagreement (Strand 0, 7.1) by a single device-colour table | Never hand-edited; a test diffs the generated file against the sources |

Alias table (legacy to layer 2, for the one-release bridge):

| Legacy (`tokens.css`) | Alias target | Legacy (`ww` roles) | Alias target |
|---|---|---|---|
| `--bg`, `--bg-2` | `--surface-ground`, `--surface-sunk` | `--surface-0`, `--surface-1`, `--surface-2`, `--surface-3` | `--surface-ground`, `--surface-raised`, `--surface-raised`, `--surface-sunk` |
| `--ink`, `--ink-2`, `--ink-3` | `--ink-1`, `--ink-2`, `--ink-3` | `--line`, `--line-ui` | `--edge-hair`, `--edge-ui` |
| `--ink-4` | none: it was 1.79:1 and barred from text; delete callers | `--accent`, `--on-accent` | `--accent-fill`, `--accent-on` |
| `--hair`, `--hair-2`, `--hair-3` | `--edge-hair` (all three) | `--accent-hi`, `--accent-wash` | `--accent-fill-hover`; removed (no wash) |
| `--live`, `--sim`, `--fault` | `--state-measured`, `--state-simulated`, `--state-fault` | `--focus-ring` | `--focus-ring` (now ink-1) |
| `--glass-*`, `--blur` | removed: no `backdrop-filter` (Turbopack strips it; Strand 0 memory note) and no frosted look in clay | `--scrim` | `--scrim` |

#### 6.2.4 Layer-3 allow-list (what a section may declare)

| Name | Type | Purpose |
|---|---|---|
| `--sec-mark` | colour | Section label glyph, kicker rule, active view-tab underline. Text-safe on ground, raised and sunk (table 6.3.5) |
| `--sec-art-1`, `--sec-art-2`, `--sec-art-3` | colour | Fills and strokes of the centrepiece and derived art. Never used for text |
| `--sec-scene` | `light` or `immersive` | Written to `data-scene` by the page root |
| `--r-control`, `--r-panel` | length | Control and panel corner radius (table 6.3.6) |
| `--tempo`, `--spring-main` | number, token | Motion character; existing |
| `--type-kicker` | font family | Kicker face (Geist Mono everywhere; kept as a hook) |

#### 6.2.5 Component token naming

`--<component>-<part>-<state>` where the state suffix is optional. Example: `--key-bg`, `--key-edge`, `--key-bg-pressed`, `--knob-track`, `--switch-thumb-on`. A component declares its tokens once on its root class from layer-2 names; a section never overrides a component token (it changes the layer-2 or layer-3 input instead). The eight shared state suffixes are `default`, `hover`, `focus`, `pressed`, `disabled`, `loading`, `error`, `planned` (the grammar is in 7.1).

### 6.3 The shared tactile palette

#### 6.3.0 Notes carried from the core token table

- The core's first token table is replaced by the computed tables below, which fix the two cells the core marked "assumption, to compute" (`--surface-sunk` dark `#101112` and `--ink-2` dark `#B4B8BA`) and change one value (V1, `--state-simulated` light `#805400`, decision I2).
- **Accent rule.** Orange is a fill and a charcoal-scene colour, never a light-surface text colour or a sole edge (2.83:1 on the light ground). The existing provenance contract (cyan measured, amber simulated, red fault) is preserved and promoted to layer 2.
- **Corner tokens.** `--r-clay` (about 14 px) for chrome and `--r-sharp` (0 to 2 px) for brutalist sections; the section theme chooses which one `--r-control` points to.
- **Device colours.** Two disagreements between desktop and phone (white and fan hex; Strand 0, 7.1) are resolved by one table in the tokens file.
- **Typography.** Inter (UI), Geist Mono (meta and readouts, 12 px minimum) and a digits-and-colon Doto subset; Anton dropped; at most 150 KB of fonts against 353 KB for 17 non-KaTeX woff2 files today (Strand 0, 5). Detail in §6.4.1 to §6.4.2.

#### 6.3.1 Layer 1: colour primitives

| Primitive | Hex | Where it comes from |
|---|---|---|
| `--p-clay-50` | `#F2F3F2` | Raised surface, light (built on C02-18 off-white `#E8EAE9`, lifted) |
| `--p-clay-100` | `#E8EAE9` | Light ground (swatch source C02-18) |
| `--p-clay-200` | `#DADCDB` | Light sunk (C02-48 clay grey `#DEDEDE`, adjusted to a cooler `#DADCDB`) |
| `--p-clay-300` | `#C4C7C5` | Light hairline (decorative edge only) |
| `--p-clay-500` | `#6E7270` | Light edge-ui |
| `--p-clay-600` | `#5A5E5C` | Light ink-3 |
| `--p-clay-700` | `#4D4D4D` | Light ink-2 (swatch C02-42 `#4D4D4D`) |
| `--p-char-950` | `#08090A` | Console scene, sunk in immersive |
| `--p-char-900` | `#0F1011` | Core scene ground |
| `--p-char-850` | `#121314` | Focus session scene ground |
| `--p-char-800` | `#171717` | Dark ground and light ink-1 (swatch C02-44 near-black) |
| `--p-char-750` | `#1D2124` | Room faceplate |
| `--p-char-700` | `#222426` | Dark raised |
| `--p-char-600` | `#34373A` | Dark hairline |
| `--p-char-400` | `#7C8082` | Dark edge-ui |
| `--p-char-300` | `#9A9EA0` | Dark ink-3 |
| `--p-char-200` | `#B4B8BA` | Dark ink-2 |
| `--p-bone` | `#E8EAE9` | Dark ink-1 |
| `--p-orange-500` | `#F25623` | Accent fill (swatch C02-41) |
| `--p-orange-450` | `#F5693A` | Accent hover fill |
| `--p-orange-700` | `#A8300F` | Accent ink on light |
| `--p-cyan-700`, `--p-cyan-300` | `#006B7A`, `#5CE1FF` | State measured, light and dark |
| `--p-amber-800`, `--p-amber-300` | `#805400`, `#FFB347` | State simulated (V1) |
| `--p-red-700`, `--p-red-400` | `#B3261E`, `#FF6B5E` | State fault |
| `--p-ochre-800`, `--p-ochre-300`, `--p-ochre-art` | `#8A4B00`, `#E0A030`, `#AE6F0C` | Day mark (light, dark) and sun art |
| `--p-teal-800`, `--p-teal-300` | `#2B6468`, `#6FC2C6` | Study mark and contour art |
| `--p-moss-800`, `--p-moss-300` | `#46603A`, `#9CC38A` | Tree mark and art |
| `--p-brick-700`, `--p-brick-300` | `#9A4527`, `#E8896A` | Career mark and art |

Space, radius, size, line, weight, duration and easing primitives are unchanged (4, 8, 12, 16, 24, 32, 48 px; 6, 10, 14, 999 px; 12, 13, 14, 16, 18, 24, 40 px; durations 100 to 400 ms). Added: `--p-radius-2: 2px` (sharp, for `--r-sharp`), `--p-size-56`, `--p-size-72` (Doto numerals), `--p-line-56`, `--p-line-72`.

#### 6.3.2 Layer 2: semantic tokens (values)

| Token | clay-light | clay-dark | Immersive scene (either theme) | Use |
|---|---|---|---|---|
| `--surface-ground` | `#E8EAE9` | `#171717` | `#0F1011` (per-section ground, 2.4) | Canvas and page ground |
| `--surface-raised` | `#F2F3F2` | `#222426` | `#1A1C1E` | Cards, keys, sheets, caption plates |
| `--surface-sunk` | `#DADCDB` | `#101112` | `#08090A` | Wells, fields, readouts, tracks, pressed |
| `--ink-1` | `#171717` | `#E8EAE9` | `#E8EAE9` | Primary text, focus ring, selected fill (inverted) |
| `--ink-2` | `#4D4D4D` | `#B4B8BA` | `#B4B8BA` | Secondary text |
| `--ink-3` | `#5A5E5C` | `#9A9EA0` | `#9A9EA0` | Mono metadata, captions (never below 12 px) |
| `--ink-off` | `#8A8E8C` | `#6A6E70` | `#6A6E70` | Disabled text only (exempt from 4.5; 2.75 and 3.48 computed); never for information |
| `--edge-ui` | `#6E7270` | `#7C8082` | `#7C8082` | 1 px boundary of every control and state indicator; at least 3:1 |
| `--edge-hair` | `#C4C7C5` | `#34373A` | `#2A2D30` | Decorative card and divider lines (1.41 and 1.50 computed: never the only boundary of a control) |
| `--accent-fill` | `#F25623` | `#F25623` | `#F25623` | The one primary action fill and exam-proximity mark; never text or sole edge |
| `--accent-on` | `#171717` | `#171717` | `#171717` | Text on the accent fill (5.23) |
| `--accent-fill-hover` | `#F5693A` | `#F5693A` | `#F5693A` | Hover fill (5.95 with 171717) |
| `--accent-ink` | `#A8300F` | `#F25623` | `#F25623` | Accent as text or icon: allowed only on the surfaces in table 6.3.3 |
| `--state-measured` | `#006B7A` | `#5CE1FF` | `#5CE1FF` | LIVE, "confirmed by board" |
| `--state-simulated` | `#805400` | `#FFB347` | `#FFB347` | SIMULATED |
| `--state-fault` | `#B3261E` | `#FF6B5E` | `#FF6B5E` | FAULT |
| `--state-planned` | `--ink-3` | `--ink-3` | `--ink-3` | PLANNED; shape (dashed) carries the meaning |
| `--state-waiting` | `--ink-3` | `--ink-3` | `--ink-3` | WAITING |
| `--selected-fill` | `#171717` | `#E8EAE9` | `#E8EAE9` | Selected segment, "on" switch track: inverted ink, so selection is not colour-coded |
| `--selected-ink` | `#F2F3F2` | `#171717` | `#171717` | Text on the selected fill (16.12 and 14.83) |
| `--focus-ring` | `#171717` | `#E8EAE9` | `#E8EAE9` | 2 px outline, 2 px offset |
| `--scrim` | `rgba(23,23,23,.55)` | `rgba(0,0,0,.62)` | `rgba(0,0,0,.62)` | Behind sheets; solid colour, no blur |

Where the core wrote ink-3 dark as `#9A9EA0` and edge dark `#7C8082`, the values are unchanged. The accent rule from §6.3 stands: orange is a fill and a charcoal-scene colour; on the light ground it fails as text or edge (2.83), so `--accent-ink` on light is the darker `#A8300F`.

#### 6.3.3 The computed contrast tables

Method: `contrast.py` (a scratch script; WP-B03 commits it as the oracle for `tokens.test.ts`), WCAG 2.2 relative luminance, ratio (L1+0.05)/(L2+0.05), not rounded for pass/fail (4.499 fails). Need is 4.5 for text and 3.0 for edges and state shapes. Every cell below passes.

**clay-light** (ground `#E8EAE9`, raised `#F2F3F2`, sunk `#DADCDB`)

| Token | Hex | Need | ground | raised | sunk |
|---|---|---|---|---|---|
| ink-1 | `#171717` | 4.5 | 14.83 | 16.12 | 13.01 |
| ink-2 | `#4D4D4D` | 4.5 | 6.99 | 7.60 | 6.14 |
| ink-3 | `#5A5E5C` | 4.5 | 5.45 | 5.92 | 4.78 |
| state-measured | `#006B7A` | 4.5 | 5.13 | 5.58 | 4.50 (4.504, thin; C1) |
| state-simulated | `#805400` | 4.5 | 5.45 | 5.93 | 4.78 |
| state-fault | `#B3261E` | 4.5 | 5.41 | 5.88 | 4.74 |
| accent-ink | `#A8300F` | 4.5 | 5.62 | 6.10 | 4.93 |
| edge-ui | `#6E7270` | 3.0 | 4.04 | 4.39 | 3.54 |
| focus-ring | `#171717` | 3.0 | 14.83 | 16.12 | 13.01 |

**clay-dark** (ground `#171717`, raised `#222426`, sunk `#101112`)

| Token | Hex | Need | ground | raised | sunk |
|---|---|---|---|---|---|
| ink-1 | `#E8EAE9` | 4.5 | 14.83 | 12.89 | 15.64 |
| ink-2 | `#B4B8BA` | 4.5 | 8.97 | 7.79 | 9.46 |
| ink-3 | `#9A9EA0` | 4.5 | 6.64 | 5.76 | 7.00 |
| state-measured | `#5CE1FF` | 4.5 | 11.67 | 10.14 | 12.30 |
| state-simulated | `#FFB347` | 4.5 | 10.07 | 8.74 | 10.61 |
| state-fault | `#FF6B5E` | 4.5 | 6.42 | 5.57 | 6.77 |
| accent-ink | `#F25623` | 4.5 | 5.23 | 4.55 | 5.52 |
| edge-ui | `#7C8082` | 3.0 | 4.50 | 3.91 | 4.74 |
| focus-ring | `#E8EAE9` | 3.0 | 14.83 | 12.89 | 15.64 |

**immersive scene (default charcoal set)** (ground `#0F1011`, raised `#1A1C1E`, sunk `#08090A`)

| Token | Hex | Need | ground | raised | sunk |
|---|---|---|---|---|---|
| ink-1 | `#E8EAE9` | 4.5 | 15.76 | 14.14 | 16.49 |
| ink-2 | `#B4B8BA` | 4.5 | 9.53 | 8.55 | 9.97 |
| ink-3 | `#9A9EA0` | 4.5 | 7.05 | 6.33 | 7.38 |
| state-measured | `#5CE1FF` | 4.5 | 12.40 | 11.12 | 12.97 |
| state-simulated | `#FFB347` | 4.5 | 10.69 | 9.60 | 11.19 |
| state-fault | `#FF6B5E` | 4.5 | 6.82 | 6.12 | 7.13 |
| accent-ink | `#F25623` | 4.5 | 5.56 | 4.99 | 5.82 |
| edge-ui | `#7C8082` | 3.0 | 4.78 | 4.29 | 5.00 |
| focus-ring | `#E8EAE9` | 3.0 | 15.76 | 14.14 | 16.49 |

**Fills and inverted pairs** (text on a filled shape)

| Pair | Foreground | Fill | Ratio | Need |
|---|---|---|---|---|
| Primary button text on accent fill | `#171717` | `#F25623` | 5.23 | 4.5 |
| Primary button text on hover fill | `#171717` | `#F5693A` | 5.95 | 4.5 |
| Selected segment, light | `#F2F3F2` | `#171717` | 16.12 | 4.5 |
| Selected segment, dark | `#171717` | `#E8EAE9` | 14.83 | 4.5 |
| Lamp or chip text on measured fill, dark | `#171717` | `#5CE1FF` | 11.67 | 4.5 |
| On simulated fill, dark | `#171717` | `#FFB347` | 10.07 | 4.5 |
| On fault fill, dark | `#171717` | `#FF6B5E` | 6.42 | 4.5 |
| On measured fill, light | `#F2F3F2` | `#006B7A` | 5.58 | 4.5 |
| On simulated fill, light | `#F2F3F2` | `#805400` | 5.93 | 4.5 |
| On fault fill, light | `#F2F3F2` | `#B3261E` | 5.88 | 4.5 |

**Forbidden by design (reported, never used).** Accent fill `#F25623` on light ground is 2.83:1, which fails as a boundary or as text. It also passes only narrowly on light raised (about 3.08), so the rule is absolute: an accent-filled control always carries a `--ink-1` 1 px edge and a text label. Disabled ink (`--ink-off`) is exempt from 4.5 and reported at 2.75 (light) and 3.48 (dark). The decorative hairline is 1.41 (light) and 1.50 (dark): it is not a control boundary.

#### 6.3.4 JARVIS scene grounds (each immersive or dark section has its own charcoal)

All values computed against the scene tokens of 6.3.2.

| Scene | Ground | ink-1 | ink-3 | edge-ui | measured | simulated | fault |
|---|---|---|---|---|---|---|---|
| core | `#0F1011` | 15.76 | 7.05 | 4.78 | 12.40 | 10.69 | 6.82 |
| room faceplate (a dark panel on the light canvas) | `#1D2124` | 13.42 | 6.00 | 4.07 | 10.55 | 9.10 | 5.80 |
| senses | `#0A0C10` | 16.20 | 7.24 | 4.91 | 12.74 | 10.99 | 7.01 |
| console | `#08090A` | 16.49 | 7.38 | 5.00 | 12.97 | 11.19 | 7.13 |
| focus session (Well Wisher, immersive while a block runs) | `#121314` | 15.39 | 6.88 | 4.67 | 12.11 | 10.44 | 6.66 |
| memory paper (a light scene, `#E3E4E1`, light tokens) | `#E3E4E1` | 14.04 | 5.16 | 3.82 | not used on paper | not used | not used |

The ground steps (`#0F1011` to `#0A0C10` to `#08090A`) differ by well under 1.1:1 on purpose: a scene is a mood, not information.

#### 6.3.5 Per-section accent sets (layer 3 values)

JARVIS sections have no accent hue (§1.2, D11): colour means state. Their "set" is the scene ground and a neutral mark. Well Wisher sections each get one hue, but only as a section mark and as art; the orange fill is still the single primary action everywhere. **Hue budget: one accent plus at most three section marks** (day ochre, study teal, tree moss); `career`, `focus` and `proof` use neutral marks, and section themes vary only art colours and the mark, never radius or ground (§6.3.6). The career brick `#9A4527` is art only (towers), never a mark. The hue is never the sole cue: every mark sits beside a glyph and a label.

| Section | Scene | `--sec-mark` (light / dark) | `--sec-art-1` | `--sec-art-2` | `--sec-art-3` | Note |
|---|---|---|---|---|---|---|
| `core` | immersive `#0F1011` | `--ink-1` / `--ink-1` | `#E8EAE9` (dots) | `#9A9EA0` | `#3A3E40` (decor ring) | Hill dots are meaningful: 15.76 on ground. The ghost ring is decoration (1.76) and carries no data |
| `room` | light canvas, faceplate `#1D2124` | `--ink-2` / `--ink-2` | `#E8EAE9` | `#9A9EA0` | `#5CE1FF` only as lamp state | Key lamp colour is the state token, not art |
| `senses` | immersive `#0A0C10` | `--ink-1` / `--ink-1` | `#E8EAE9` (orbits) | `#7C8082` | `#9A9EA0` | SIMULATED stamp uses `--state-simulated`; never art hue |
| `memory` | light (paper `#E3E4E1`) | `--ink-2` / `--ink-2` | `#171717` (branch) | `#5A5E5C` | `#C4C7C5` | ASCII glyph density only |
| `console` | immersive `#08090A` | `--ink-1` / `--ink-1` | `#E8EAE9` | `#9A9EA0` | `#34373A` | Bracket tags are text, coloured only by log state |
| `day` | light | `#8A4B00` / `#E0A030` | `#AE6F0C` (sun, 3.42 on ground) | `#8A4B00` | `#171717` | Sun fill is meaningful (rays count blocks): 3.42:1 and captioned |
| `study` | light | `#2B6468` / `#6FC2C6` | `#2B6468` (contour, 5.56) | `#6FC2C6` | `#C4C7C5` (flat unit) | Empty units are flat and plain |
| `tree` | light | `#46603A` / `#9CC38A` | `#46603A` (trunk, 5.80) | `#9CC38A` | `#171717` | Draws in on mastery |
| `career` | light | `--ink-2` / `--ink-2` (neutral; 6.99 on light ground and 8.97 on dark ground, already computed in §6.5.1) | `#9A4527` (towers, 5.34) | `#E8896A` | `#171717` | A lit stage uses ink, not hue |
| `focus` | light; immersive `#121314` during a session | `--ink-1` / `--ink-1` | `#E8EAE9` (elapsed dot) | `#6A6F72` (remaining dot, 3.66) | `#34373A` | Elapsed is a solid disc, remaining a ring: shape, not only tone |
| `proof` | light | `#4D4D4D` / `#B4B8BA` | `#4D4D4D` | `#6E7270` | `#C4C7C5` | Embossed relief: depth is garnish, each ring has a numeric caption |

Computed marks (text-safe, need 4.5): day ochre 5.63 on light ground, 6.12 on raised, 4.94 on sunk, 7.89 / 6.85 on dark ground / raised, 8.38 on scene; study teal 5.56 / 6.04 / 4.88, 8.71 / 7.57, 9.26; tree moss 5.80 / 6.30 / 5.09, 9.04 / 7.85, 9.60; career brick 5.34 / 5.80 / 4.68, 7.02 / 6.09, 7.45; focus bone 14.83 / 16.12 / 13.01, 14.83 / 12.89, 15.76; proof grey 6.99 / 7.60 / 6.14, 8.97 / 7.79, 9.53. Art contrast need is 3.0 for meaningful shapes: day sun 3.42, study 5.56, tree 5.80, career 5.34, senses orbit 16.20, voice dots 15.76, focus elapsed 15.39, focus remaining 3.66; the core ghost ring is decorative at 1.76.

#### 6.3.6 Section shape and tempo (layer 3)

`--r-control`, `--r-panel` and the chrome ground are **product-scoped** (layer 3 per product, `[data-product]`), not per section: JARVIS is square or chamfered, Well Wisher is clay. The table below lists them per section only because the `room` faceplate keys (10 px) and the Well Wisher sections need their own values; the rule is that a section may never take the other product's silhouette.

| Section | `--r-control` | `--r-panel` | `--tempo` | Chrome radius reference |
|---|---|---|---|---|
| core, senses | 2 px | 2 px chamfer 10 px | 0.67 (JARVIS, §10.2) | HUD frames |
| room | 10 px (keys) | 2 px (faceplate) | 0.5 | clay keys on a sharp plate |
| memory | 2 px | 2 px with a 6 px chamfer on paper | 0.67 | paper with a JARVIS chamfer (so it does not read as Well Wisher clay) |
| console | 0 | 0 | 0.5 | terminal |
| day, study, tree, career, proof | 10 px | 14 px (`--r-clay`) | 1 (Well Wisher) | clay |
| focus | 10 px | 14 px (`--r-clay`) on a charcoal ground | 1 | clay on charcoal (so it does not read as a JARVIS HUD) |

Tempo: durations are `--p-dur * --tempo`. The JARVIS tempo values in this table are superseded by the per-section values and the per-product duration overrides of §10.2 (decision I7): `core`, `senses`, `memory` 0.67; `room`, `console` 0.5. Well Wisher at 1: state 160, enter 240 ms, inside 160 to 280.

### 6.4 Typography, iconography, elevation, focus and the states

#### 6.4.1 Families and the font budget

Two families plus one numeral subset; Anton is dropped (D21).

| Role | Family | File (measured size) | Use |
|---|---|---|---|
| UI and reading | Inter Variable, weight axis 400 to 600, Latin subset | `inter-latin-wght-normal.woff2`, 48,256 B (measured from `@fontsource-variable/inter`) | All sentences, headings (600), buttons |
| Metadata, readouts, log | Geist Mono Variable, Latin subset | `geist-mono-latin-wght-normal.woff2`, 23,128 B (measured) | Kickers, units, timestamps, state labels, log, IDs |
| Display numerals | Doto, digits and colon only (a glyph subset) | `doto-latin-wght-normal.woff2` is 5,364 B for the whole Latin range (measured); a digits-only subset is a target of at most 3 KB (assumption, to measure) | Big counters (day clock, session minutes) |

Budget: 3 files, 48,256 + 23,128 + at most 5,364 = at most 76,748 B (computed, before the digits subset), against 353 KB for 17 non-KaTeX files today (Strand 0, section 5) and against the proposed ceiling of 150 KB and 4 files (Strand 6). The Latin subset covers U+0000 to U+00FF, which includes the German letters the study track uses; the 85,068 B `latin-ext` file is excluded unless a render shows a missing glyph (assumption). `font-display: swap`, self-hosted, no `<link>` to a font host. The Doto digits are decorative numerals: the same value is always present as text in a visually hidden node, so assistive technology and forced-colours users read it.

Brand check ("at most two families per brand"): JARVIS uses Inter and Geist Mono (Doto for the voice clock only); Well Wisher uses Inter and Geist Mono (Doto for the day clock only). Open question F12 (a serif for Well Wisher) is not designed here; the default stands.

#### 6.4.2 Type scale at 1366x768

Existing tokens are kept (sizes 12, 13, 14, 16, 18, 24, 40; lines 16, 18, 20, 24, 26, 32, 40) and two numeral sizes are added. Body is 14/20; read-length text 16/26. Tabular numerals (`font-variant-numeric: tabular-nums`) for every changing number set in Inter.

| Role token | Family | Size / line | Weight | Tracking | Where at 1366x768 |
|---|---|---|---|---|---|
| `--type-display` | Doto | 72 / 72 (hero), 56 / 56 (compact) | 400 | 0 | Day clock, session minutes: one per view, never in the rail |
| `--type-heading` | Inter | 24 / 32 | 600 | -0.01 em | View title, 1 per view |
| `--type-title` | Inter | 18 / 24 | 600 | 0 | Card and sheet titles |
| `--type-read` | Inter | 16 / 26 | 400 | 0 | Paragraph text in `study.library`, the reader |
| `--type-body` | Inter | 14 / 20 | 400 or 500 | 0 | Default UI text, buttons |
| `--type-small` | Inter | 13 / 18 | 400 | 0 | Row secondary text |
| `--type-label` | Geist Mono | 12 / 16 | 500 | 0.04 em, caps | Kickers, rail labels, lamp labels |
| `--type-meta` | Geist Mono | 12 / 16 | 400 | 0 | Timestamps, ids, units (ink-3) |
| `--type-log` | Geist Mono | 13 / 18 | 400 | 0 | Log console lines |

Rules: nothing under 12 px; mono caps only at 12 px and only for labels of 1 to 12 characters; headings are never mono; a line never exceeds 70 characters in read text (max width `70ch`); text-size setting (100, 112, 125 %) scales the root font size, and layouts are verified at 100 % for the no-scroll contract and at 125 % for reflow (target).

#### 6.4.3 Iconography: stroke grammar

One set, drawn on a 24 x 24 grid, rendered at 16, 20 (default, rail and buttons) or 24 px.

| Property | Rule |
|---|---|
| Stroke | 1.5 px on the 24 grid, constant at all sizes (so it renders at 1.0 px at 16 px); `currentColor` |
| Terminals and joins | Butt caps; miter joins; end of an open stroke cut at 45 degrees (matches the 10 px chamfer used by plates). No round caps |
| Corners | 2 px radius on the 24 grid for closed shapes (hardware), 0 for terminal/HUD glyphs |
| Live area | 20 x 20 inside the 24 box; 2 px padding |
| Fill | None, except the five lamp glyphs and the dot-matrix on/off dots |
| Pairing | Rail icons always travel with a 12 px mono label; icon-only buttons carry `aria-label` and a tooltip on hover and focus |
| Colour | `--ink-2` at rest, `--ink-1` on hover and selected; never a hue except the lamp glyph on a state |
| Device art | The isometric device set (C01-08, grey devices with orange dots) is illustration, not icon: drawn at 64 px and up, `--sec-art-*` fills, never used at button size |
| Forced colours | Strokes are `currentColor`, so they become `CanvasText` or `ButtonText` automatically |

#### 6.4.4 Elevation: the token ladder

*Superseded in part by 20.4.4 (lit edge, tooth, aimed light).*

Four levels for controls and surfaces plus one for overlays. Rule: shadow is feel; edge, fill, shape and text are legibility (§6.1; Strand 2, finding 3 computed the canonical neumorphic recipe at 1.27:1 and 1.72:1). Every level has a non-shadow cue and passes without its shadow.

Recipes (at most two shadow layers; values are targets until painted on the real laptop; the dark set reuses the same geometry with black shadows).

| Level | Token | clay-light recipe | clay-dark and scene recipe | Transform | Non-shadow cue (always present) |
|---|---|---|---|---|---|
| Raised | `--elev-raised` | `inset 0 1px 0 rgb(255 255 255 / .80), 0 3px 8px rgb(23 23 23 / .16)` | `inset 0 1px 0 rgb(255 255 255 / .06), 0 4px 10px rgb(0 0 0 / .55)` | rest; hover `translateY(1px)` toward the ground | 1 px `--edge-ui` border on every control (3.54 to 4.39 light); surface `--surface-raised`; text or icon label |
| Flush | `--elev-flush` | `none` | `none` | none | 1 px `--edge-hair` on containers; 1 px `--edge-ui` if it is a control |
| Recessed | `--elev-recessed` | `inset 0 2px 5px rgb(23 23 23 / .20), 0 1px 0 rgb(255 255 255 / .70)` | `inset 0 2px 6px rgb(0 0 0 / .65), 0 1px 0 rgb(255 255 255 / .05)` | none | Surface `--surface-sunk`; 1 px `--edge-ui` for fields and tracks; value text or ticks inside |
| Pressed | `--elev-pressed` | `inset 0 2px 4px rgb(23 23 23 / .28)` | `inset 0 2px 5px rgb(0 0 0 / .75)` | `translateY(2px)` | Surface `--surface-sunk`; `aria-pressed` or `aria-checked`; selected state also fills with `--selected-fill` and shows a check or "ON" text; a 2 px `--ink-1` outline is drawn inside the border box (`outline-offset: -2px`; the 1 px border stays, so nothing shifts) |
| Float (sheets, popovers, toasts) | `--elev-float` | `0 12px 32px rgb(23 23 23 / .28)` | `0 12px 32px rgb(0 0 0 / .6)` | rises by `--dist-sheet` | `--scrim` behind sheets; 1 px `--edge-ui`; title row |

Implementation rule (performance): no `box-shadow` transition. Each raised element carries its resting shadow on the element and its pressed shadow on a pre-painted `::after` that is cross-faded by `opacity` (160 ms state duration), so hover and press animate only `transform` and `opacity` (§6.1). Static shadows are painted once; at most two layers; none on repeated list rows (rows are flush with a hairline). Strand 6 found no credible numbers for shadow cost, so the budget is a measurement gate in the prototype phase.

Calm (reduced motion) form: no translate; the pressed state keeps the inner shadow, the fill change and the 2 px ink edge, so the whole cue survives with no movement.

#### 6.4.5 Focus

*Superseded in part by 20.4.4 (focus depth: the focused region settles 1 px and its siblings dim 4 percent).*

| Rule | Value |
|---|---|
| Ring | `outline: 2px solid var(--focus-ring); outline-offset: 2px` on `:focus-visible`; never `box-shadow`, so it survives forced colours |
| Contrast | `--focus-ring` is 14.83 to 16.12 on all light surfaces and 12.89 to 15.64 on dark ones (table 6.3.3); at least 3:1 against the adjacent ground and against the control |
| Composite widgets | `:focus-within` draws the ring around the composite; the roving item inside also shows a 1 px inner outline of `--ink-1` |
| Clipping | A scroll or `overflow:clip` container reserves 4 px of padding (`--focus-bleed`) so the ring is never cut; `scroll-margin: 8px` on focusable children. **In bars** (the 48 px title bar, the 44 px view-switch row) the ring is drawn inset, `outline-offset: -2px`, because 44 px controls in a 48 px bar leave no room for a 4 px bleed (WCAG 2.4.7, 2.4.11); a per-route test asserts the ring is not clipped |
| On accent fill | Ring is the same ink colour in the 2 px gap on the ground, so it stays visible on the orange |
| Never | `outline: none` without replacement; focus colour that depends on accent hue; focus shown only on hover |
| Forced colours | `outline-color: Highlight` |

#### 6.4.6 State families

These are the surface-level states the shell and views show. The reading states (LIVE, WAITING, SIMULATED, PLANNED, FAULT) are the lamp from §6.6 and are the only way a reading or a capability state is displayed; the rows below say how each non-colour cue renders. Offline in the data sense is WAITING (the expected signal has not arrived) or FAULT (the source reported an error).

| State | Visual | Glyph and label | Copy rule | ARIA | Forced-colours form |
|---|---|---|---|---|---|
| Error | 1 px edge becomes 2 px `--state-fault`; message in a recessed strip beside the field or at the top of the card | Triangle, "FAULT" plus the reason | Name the one part and one fix: "Board did not answer. Check the cable, then Retry" | `aria-invalid="true"`, `aria-describedby`; a field error is read through `aria-describedby` and the polite state region; only a FAULT is announced, through the one assertive region (§11.4), never `role="alert"` per control | 2 px `CanvasText` border; the triangle glyph and the word stay |
| Empty | A flush plate with a mono one-line explanation and one action; ASCII or halftone art from the empty-state set (components 33 to 35); never a blank panel | none (it is not a fault) | One sentence on why it is empty and the one next step: "No papers yet. Add the first paper" | `role="status"` not needed; plain text | Art is `aria-hidden` decoration; text and button remain |
| Loading | Skeleton after the existing 160 ms delay (`SKELETON_DELAY_MS`); long loads use the ASCII sweep; never a spinner on a section, never a percent counter | none | "Reading memory" in mono; no promise of time | `aria-busy="true"` on the region | Skeleton blocks have a 1 px `CanvasText` border; no animation |
| Stale | Content stays visible; the value turns `--ink-3`, gets a half-disc and "last seen 14:02" in mono | Half disc, "WAITING" or "STALE" | Time of last real report, no apology | text node; no live region | Half-disc shape and the word remain |
| Offline | The control that needs the link is `aria-disabled` and shows the half disc and "no report"; read-only content stays | Half disc, "WAITING no report" | "Wall box not reporting" | `aria-disabled="true"` (kept focusable, so the reason is reachable) | As stale |
| Simulated | Diamond glyph and "SIMULATED" stamped on the widget and on any art made from it (amber); the numbers are never shown as measured | Diamond | "SIMULATED" plus its source | label inside the widget | Diamond and word remain |
| Planned | A dashed 1 px `--edge-ui` outline (4 px dash, 2 px gap), dashed ring, "PLANNED" in mono; the plate opens the "What is coming" overlay; no hover lift, no pressed sink | Dashed ring | One sentence on what it will do and what exists today | `aria-disabled="true"`, `aria-haspopup="dialog"`, never `disabled` | `1px dashed ButtonText` stays (borders are kept); label remains |
| FAULT | Triangle, `--state-fault`, reason in mono; never red alone | Triangle | The reason as reported | text node, and the one assertive region on first appearance | Triangle shape and text remain |
| LIVE | Filled disc, `--state-measured`, "LIVE" or "confirmed by board" | Disc | plain | status text | Disc and text remain |

#### 6.4.7 Caption plate rule

Any text that sits over art (a centrepiece, a poster derivative, a halftone) sits on a `--surface-raised` plate with a 1 px `--edge-hair` and the standard padding. This makes every caption inherit the 4.5:1 pairs in 6.3.3 regardless of what is behind it, so art can change without a new contrast run. Art that carries information has a caption plate saying what it encodes; decorative art has no values and `aria-hidden="true"`.

#### 6.4.8 Tooltips, drag alternatives and the pressed edge (added after the review of 2026-11-12)

- **Tooltips (WCAG 1.4.13).** Dismissible (Esc, without moving the pointer), hoverable (the pointer may move onto the tooltip without it vanishing) and persistent (it stays until dismissed or the trigger loses hover and focus). A tooltip never carries the only copy of a name.
- **No drag-only control (WCAG 2.5.7).** The Tree and Senses-map pan and zoom have four pan buttons plus zoom buttons and arrow keys; the Knob has arrow keys and a number field; nothing requires a drag.
- **Abbreviated rail labels.** The 12 px caps labels (CONSOLE is about 50 px) in 53 to 64 px slots may abbreviate or wrap to two lines under text spacing; the full name is the accessible name.

### 6.5 Forced colours and prefers-contrast, layer by layer

The app has zero handling today (Strand 6, finding 14: no `forced-colors` or `prefers-contrast` matches). In `forced-colors: active` the browser replaces `color`, `background-color`, `border-color`, `outline-color` and SVG `fill`/`stroke`; it forces `box-shadow` and `text-shadow` to `none` and removes non-URL `background-image` (gradients). Native element semantics get system colours, but a `div role="button"` does not, so every kit control is a real `<button>`, `<input>` or `<a>` where it can be.

#### 6.5.1 Per layer

| Layer | Forced colours (`forced-colors: active`) | `prefers-contrast: more` (also `data-contrast="high"`) |
|---|---|---|
| 1 Primitives | No change; the browser overrides what they paint | No change |
| 2 Semantic | `forced.css` maps roles to system colours: ground and raised `Canvas`; sunk `Canvas` plus a 1 px `CanvasText` border; ink-1 to ink-3 `CanvasText`; ink-off `GrayText`; edge-ui and edge-hair `CanvasText` (hair becomes `ButtonBorder`); selected fill `Highlight`, selected ink `HighlightText`; focus ring `Highlight`; scrim `Canvas` at 0.8 alpha; accent fill `ButtonFace` with 2 px `ButtonText` border and bold label (the primary cue is weight, border and position, not orange); state colours all `CanvasText` and the glyph shape and word carry the meaning | `--ink-3` becomes `--ink-2` values (light `#4D4D4D`: 6.99 on ground; dark `#B4B8BA`: 8.97); `--edge-ui` becomes `--ink-2` values (light 6.99, dark 8.97 on ground); `--edge-hair` becomes `--edge-ui`; inset shadows off (`--elev-recessed` and `--elev-pressed` drop to edge-only); accent-ink on light stays `#A8300F` (5.62) |
| 3 Section themes | `data-scene="immersive"` stops being charcoal (system Canvas applies); `--sec-mark` becomes `CanvasText`; art reads `--art-ink` and `--art-ground` which map to `CanvasText` and `Canvas` (section 6.5.4) | Decorative layers (ghost rings, scanlines, grain, halftone atmosphere) are hidden; marks use ink-1 |
| 4 Components | Per component in the inventory (column "Forced colours") | Same plus 2 px edges where shadow was the only extra cue |

#### 6.5.2 Rules that hold in forced colours

1. Every interactive element has a non-zero computed border or outline (a Playwright test with `forcedColors: 'active'` asserts it; Strand 6 budget table).
2. A shape that was a fill is drawn with a border instead: the on-state of a switch is a filled thumb that becomes a thumb with a 2 px border plus the word ON inside the track.
3. Data-carrying dot patterns (dot-matrix meter, halftone progress, dot column) are real SVG elements, never CSS radial gradients (gradients vanish). "On" is a filled disc, "off" is an unfilled ring: the difference survives monochrome and forced colours.
4. A chamfered panel loses its `clip-path` in forced colours and becomes a rectangle with a real 1 px `CanvasText` border; the chamfer is cosmetic, the boundary is not (the two-layer edge trick of component 12 relies on background colours that forced colours replaces).
5. `forced-color-adjust: none` is used only on the lamp glyph SVGs (so the five shapes stay exact) and canvases; everything else adjusts.

#### 6.5.3 Test hooks (target)

`tokens.test.ts` recomputes every ratio in 6.3.3 to 2.5 from the CSS files and fails below 4.5 (text) or 3.0 (edges, shapes). A new `forced.test.ts` loads each section view in Playwright with `forcedColors: 'active'` and asserts: no interactive element with zero border and zero outline; lamp shapes present; no `box-shadow` read as the only boundary. A screenshot baseline per view in forced colours and in `prefers-contrast: more` (target: ten sections x two modes = 20 baselines).

#### 6.5.4 Art colours in a canvas

Canvas art cannot be restyled by the browser. Art code reads two CSS variables, `--art-ink` and `--art-ground`, at draw time with `getComputedStyle`; they equal `--ink-1` and the scene ground normally, and `CanvasText` and `Canvas` under forced colours. The art loop redraws on a `matchMedia('(forced-colors: active)')` change.

### 6.6 The five-state signal lamp (the one honesty component)

Shape and text plus colour, never colour alone. Every reading widget takes a `state` prop; the data layer has no way to render a number without one. State contract per capability: `{state, since, reason}`; the default when a capability cannot say is WAITING with "no report", never LIVE. A unit test fails any widget that renders a number without a state. The lamp feeds the title-bar annunciators and each view's header.

| State | Glyph | Token | Label | Means |
|---|---|---|---|---|
| LIVE | filled disc | `--state-measured` | LIVE or "confirmed by board" | A real source reported it now |
| WAITING | half disc | `--ink-3` | WAITING | Expected signal has not arrived |
| SIMULATED | diamond | `--state-simulated` | SIMULATED, and stamped on any art made from it | Data is generated |
| PLANNED | dashed ring | `--state-planned` | PLANNED | No code path produces it (not built); the control opens an honest explanation. Built code that is not yet verified is **WAITING** with the reason "built, not verified", never PLANNED and never described as "not built" |
| FAULT | triangle | `--state-fault` | FAULT plus reason | The source reported an error |

### 6.7 Where the design-system work lands

| Step | Work | Files | Acceptance |
|---|---|---|---|
| 1 | Re-scope `primitive.css` to `:root`; add `primitive-color.css`; add `semantic.css` with clay-light and clay-dark; legacy alias file | `styles/design/*.css` | All 1223 existing UI tests pass unchanged with aliases; `tokens.test.ts` recomputes 2.3 from the files and passes |
| 2 | `forced.css`, `contrast.css`, focus ring change, elevation file | `styles/design/*.css` | `forced.test.ts` and `prefers-contrast` baselines pass; zero interactive elements with no border and no outline in forced colours |
| 3 | Section themes (ten files) and `data-section` on the five JARVIS roots | `styles/sections/*.css` | Allow-list lint passes; no section file declares a surface, ink or state token |
| 4 | Fonts: three files, Anton and latin-ext removed; digits subset built | `styles/design/fonts.css`, `public/fonts/` | Built CSS has at most 3 `@font-face`, all WOFF2 with `font-display: swap`; total at most 150 KB (target) |
| 5 | Kit additions in dependency order: Lamp, Key, Switch, Readout, Plate, Panel, Frame | `shared/kit/`, `jarvis/kit/`, `ww/kit/` | Each has states test, keyboard test, forced-colours screenshot, planned and error states |
| 6 | Diagram and ASCII families after the measurement session (F8) | `shared/art/`, section art | Idle CPU at most 1 percent of one core over 60 s with art static (target from Strand 6); frame time and GPU measured on the real window before any loop is accepted |
| 7 | Phone tokens generator | `scripts/gen-phone-tokens.mjs` | Generated file matches sources; both phone pages import it; light and dark both pass the table |

Research-record requirement for every implementation agent: any measurement (font bytes, shadow paint cost, ASCII loop cost, forced-colours findings) goes into `docs/research/product-design-overhaul.md` as a dated section on top, per the project rule.

---

## 7 Component inventory

*Superseded in part by 20.10 (78 new components; the 38 of this section stand).*

### 7.1 The shared state grammar (applies to every component; rows below name only exceptions)

| State | Rule | Cue that is not shadow |
|---|---|---|
| default | Raised, flush or recessed per its family | Edge, label, glyph |
| hover | Raised elements translate 1 px toward ground; surface does not change hue; pointer cursor only for actions | The 1 px edge goes `--ink-1` (control boundary strengthens) |
| focus | 2 px ring, 2 px offset (6.4.5) | Ring |
| pressed | Sinks 2 px, recessed shadow cross-fades in (6.4.4) | Fill inverts for toggles; check or "ON" text |
| disabled | `--ink-off` text, `--edge-hair` border; excluded from tab order only when truly inert | Text still readable; reason on focus or tooltip (`aria-disabled` preferred over `disabled` when a reason must be reachable) |
| loading | `aria-busy`; label replaced by a mono verb ("saving"); 160 ms delay before any change | Text change |
| error | 2 px `--state-fault` edge plus triangle and reason | Triangle and text |
| planned | Dashed 1 px `--edge-ui`, dashed ring, "PLANNED", opens "What is coming"; `aria-disabled`, never `disabled` | Dash pattern and word |

Hit areas: every pointer target is 44 x 44 CSS px at least (existing `--hit: 44px`, tested in three themes); the 24 px minimum of WCAG 2.5.8 is a floor, not the target. All dimensions below are at 1366x768 and are targets until measured in the real window.

Column key for the tables: **Anatomy**; **Unique states**; **Interaction and keyboard**; **Forced colours**; **Ids** (catalogue ids that inspired it, rebuilt, never pasted); **Kit** (extends an existing `ww/kit` primitive, or new).

### 7.2 Family A: tactile hardware (11 components)

| # | Component | Anatomy and size | Unique states | Interaction and keyboard | Forced colours | Ids | Kit |
|---|---|---|---|---|---|---|---|
| 1 | **Knob** (rotary dial with tick scale) | Recessed 96 px well (hero) or 56 px (compact); raised 72 px cap with an indicator notch; 24 to 36 ticks on a 270 degree arc, tick = 1 px line `--ink-2`, major tick every 5th `--ink-1`; mono value readout below (12 px) | Value `min/max` reached: tick turns `--ink-1`; "unavailable": cap shows the dashed ring and no notch; planned: dashed outline plate | `role="slider"` with `aria-valuenow/min/max/text`. Arrow keys step, PageUp or PageDown 10 steps, Home or End the ends, Shift fine step; vertical drag or wheel only while focused; every action has a text equivalent (a number field in the Setup sheet). Never the only way to set a value | Ticks and notch are SVG strokes (`CanvasText`); the cap gets a 2 px border | C01-19, C01-23, C02-46, C04-01 (grey audio rack with four knobs; dark panel with a large rotary dial; beige and lavender knob sets) | New (`Knob`); core of `jarvis/kit` Dial, shared once built |
| 2 | **Capsule Switch** | 56 x 32 recessed track with raised 24 px thumb; label to the right, state word ON or OFF inside the track (12 px mono) | `aria-checked`; on: track fills with `--selected-fill`, thumb moves 24 px, word ON; off: sunk track, thumb left; unavailable: dashed outline | `role="switch"`; Space toggles; Enter does not (switch convention); optional "confirmed" lamp for board-backed switches (cyan disc only after the board reports) | Track border 2 px, thumb border 2 px, ON or OFF word stays | C01-01, C02-23, C02-46 | New (`Switch`); replaces ad-hoc toggles. Extends `Chip` CycleState logic for cycles |
| 3 | **Rocker Toggle** | 64 x 44 two-position rocker, raised, split by a 1 px rule; left half "I" and right half "O" glyphs plus words ON and OFF | Pressed half sinks 2 px; the active half fills `--selected-fill` | `role="switch"` or a two-item radiogroup; Left and Right arrows move; Space toggles; used for room channels (core `room`) where the board's own report sets the lamp | Two halves with `CanvasText` rule and 2 px outer border | C02-35, C02-46 (device tile with toggle; toggle set) | New (`Rocker`); wraps Switch semantics |
| 4 | **Key** (raised clay key) | 56 x 56 squircle (radius 10 or `--r-control`), raised; icon 20 px centred; optional mono label under; "All off" is a Key with a `--state-fault`-free neutral face | Pressed: sinks, inner shadow; toggled key shows an indicator disc top-right | `button` or `button aria-pressed`; Space and Enter; focus ring outside | 2 px border; indicator becomes a ring or disc by on or off | C02-19, C02-28, C02-03 (large squircle key; round add and close keys; raised pill buttons) | Extends `Button`, `IconButton` (new `tone="key"`) |
| 5 | **Raised Pill Button** | 44 px high, 14 px radius, padding 16, label `--type-body` 500; primary uses `--accent-fill` with `--accent-on` text and a 1 px `--ink-1` edge | Primary hover uses `--accent-fill-hover`; loading shows a mono verb | As today's `Button`; one `PrimaryButton` per page (`PrimaryOwner`) | Primary: 2 px border, weight 600, no reliance on orange | C02-03, C02-17 | Extends `Button`, `PrimaryButton`; no new file |
| 6 | **Recessed Readout** (LCD well) | `--surface-sunk` well, 1 px `--edge-ui`, inner shadow, 40 to 64 px high; value in `--type-meta` or Doto; unit in 12 px mono `--ink-3`; lamp in the top-right corner (12 px) | Every readout carries a `state` (§6.6); WAITING shows em dashes, never a number; stale adds "last seen" | `role="group"` named by the label; value in a `<output>` or `<span>`; no focus unless it expands a drilldown | Border 2 px; value text stays | C02-33, C02-34, C02-12, C01-06 (dark dot-matrix tiles; big pixel numeral; instrument readout cluster; pill status tile) | Extends `Stat`, `Meter`, `Row` (adds the mandatory `state` prop) |
| 7 | **Segmented Display** (digits) | Doto numerals 56 or 72 px in a sunk well; the colon is always static (no blink, so there is no infinite animation); one per view | A value not yet reported shows "--"; simulated stamps a diamond | Read-only; the same value exists as text for assistive technology | Numerals are text, so they follow `CanvasText` | C01-05, C01-14, C02-34, C02-45 (huge pixel numeral; seven-segment counter; dot-matrix clock) | New (`Numerals`); new Doto subset |
| 8 | **Tick Slider** | Recessed 6 px track, raised 28 px thumb, tick row beneath (major every 10 percent), value readout | Disabled track `--edge-hair`; filled part of the track uses `--selected-fill` (not hue) | Native `<input type="range">` styled; arrows step; Home and End; value typed in a paired number field for fine control | Native range retains system colours; ticks as borders | C01-04, C01-07, C02-32 | Extends `Field` (new `kind="range"`) |
| 9 | **Segmented Switch** (view switch, 44 px) | Recessed bar; each segment a raised key when selected (fills `--selected-fill`, text `--selected-ink`); mono label for secondary text | Selected is inverted ink, not hue; overflow becomes a menu below 900 px | `role="tablist"` or radiogroup; roving tabindex; Left and Right, Home and End; `[` and `]` change view globally (§3.4) | 2 px border on the selected segment | C02-46 (segmented control) | Extends `Segmented` |
| 10 | **Chamfered Label Plate** | A 12 px mono caps label on a chamfered (10 px corners) plate: serial or section text, optional 1D barcode of plain bars (decorative) | Planned plates are dashed; status plates carry a lamp | Static; a link plate behaves as a link | Chamfer replaced by a rectangle with a real border (6.5.2 rule 4) | C02-25, C02-30, C02-22 (chamfered device-label plates; sticker strips) | New (`Plate`) |
| 11 | **Signal Lamp** (annunciator) | 12 px glyph in the title bar and view headers (16 px in the title bar), mono label to the right; the five shapes of §6.6 (disc, half disc, diamond, dashed ring, triangle) | Exactly the five reading states | A lamp is read-only; the title-bar lamp group is a single tab stop that opens the matching `console` view; `aria-label` is the full state text | `forced-color-adjust: none` on the glyph SVG; label stays | New by design (no picture); sits beside C02-17 (pale cards with one status accent) for placement | New (`Lamp`), shared, feeds Row, Stat, Meter |

### 7.3 Family B: HUD and terminal frames (10 components)

| # | Component | Anatomy and size | Unique states | Interaction and keyboard | Forced colours | Ids | Kit |
|---|---|---|---|---|---|---|---|
| 12 | **Chamfered Panel** | Two stacked layers: an outer element filled `--edge-ui` and an inner element inset 1 px filled `--surface-raised`, both `clip-path: polygon(...)` with 10 px cuts at top-left and bottom-right; content padding 16; this keeps a true 3:1 edge on the diagonals (a plain border is cut by clip-path) | Error: outer layer fills `--state-fault`; planned: dashed variant uses an SVG dashed outline instead | Container only | Falls back to a rectangle with `1px solid CanvasText` (6.5.2 rule 4) | C04-02, C02-14, C02-43 (chamfered portrait frames; notched message frames; chamfered layers) | New (`Panel tone="hud"`); extends `Card` |
| 13 | **Corner Brackets** | Four 12 px L-shaped brackets (2 px, `--edge-ui`) at the corners of a viewport; status footer row inside (12 px mono, the lamp left, timestamp right) | Footer lamp shows the state; planned brackets dashed | Container only; the footer text is real text | Brackets are borders on pseudo-elements; kept | C04-18, C01-18, C02-05, C04-14 (bracket HUD screen; glyph-block sheet; prompt card with brackets; multi-graph HUD card) | New (`Frame`); wraps `Card` |
| 14 | **Scanline Readout** | A recessed mono block for a key-value readout; no scanlines, no glow bloom and no flicker (§10.5) | Updates replace the line in place; no flicker; simulated adds a diamond and the amber stamp | `role="status"` only where the update is meaningful, else none (avoid live-region spam) | Overlay removed; text and border remain | C04-14, C04-24 (HUD card with gauge; instrument panel); C04-16 supplies the frame only, drawn charcoal and not orange (§8.3.5) | New (`ReadoutLines`) |
| 15 | **Log Console** | Sunk well, 13 px mono lines with a 12 px bracketed channel tag `[CORE]`, `[EYES]`, `[MEM]`, `[LIMB]`, `[SYS]`, `[WISH]` (tag text `--ink-3`, tag colour only by state), timestamp column; prompt line at the bottom (a solid block cursor that never blinks); max 200 lines in the DOM (assumption) | Follow on or off; simulated lines carry a diamond; fault lines a triangle; planned prompt is disabled with the word PLANNED | `role="log"`, `aria-live="off"` by default (a Follow toggle announces only fault lines); arrows scroll lines; Home and End; Ctrl+C copies the focused line; Esc leaves the prompt | Well gets a 1 px border; tags stay text | C04-10, C04-47 (terminal login and ASCII landscape; terminal window grid) | New (`Console`); the content is today's Ticker (14 events) |
| 16 | **Command Palette** | 560 x up to 440 sheet centred over the canvas; outlined search field (44 px), grouped list Go, Do, Ask; each row: mono hint (the real key from one binding table), label, lamp for planned verbs | Planned verbs listed with the dashed ring and open "What is coming"; never executable; empty result shows a one-line plate | `role="combobox"` plus `listbox`, `aria-activedescendant`; Ctrl+K opens, Esc closes, Up and Down move, Enter runs, typing filters; focus returns to the opener | Sheet border 2 px, active row `Highlight` | no picture source (the one that was cited is a third-party logotype and is refused); the existing `CommandPalette` is the reference | Extends `Drawer`/`Sheet` and `Popover`; replaces `CommandPalette.tsx` presentation |
| 17 | **Notched Toast** | Raised plate with one notched corner (6 px), 360 px wide, mono tag (`OK`, `NOTE`, `FAULT`), one line, optional Undo action; 6 s default, 6 s "Restore" for All off | Fault toasts persist until dismissed; no auto-dismiss for errors (WCAG 2.2.1) | Appears in a `role="status"` region; Esc dismisses; Undo is a real button; the Quiet switch silences every non-fault toast | Rectangle with a real border | C02-14 (notched message frame) | Extends `Toast`, `ToastStack` |
| 18 | **Telemetry Rail** | Key-value rows: mono label left (12 px, `--ink-3`), value right, a 1 px tick ruler between, lamp in the gutter; 28 px rows (a 44 px hit area only if a row is actionable) | Each row carries a state; WAITING shows "--"; planned row dashed | A list; actionable rows are buttons | Rule as border | no picture source (C04-101 is a first-run empty plan; the existing `Row` is the reference) | Extends `Row` |
| 19 | **Registration Progress Bar** | 8 px bar inside a track with registration ticks above and below every 10 percent; fill uses `--selected-fill` (not hue); mono value; used where progress is real (a file copy, a model load) | Indeterminate is not drawn: an unknown duration shows "working" text and the ASCII sweep instead of a fake percent | `role="progressbar"` with `aria-valuenow`; absent value omitted | Fill as a bordered block | C04-35, C04-25 (registration-mark bars; loading frame with serial footer) | Extends `Meter` |
| 20 | **Retro Dialog** (Confirm, overlay `confirm`) | A raised window with a title bar row (mono title, close key), body text, two buttons; hatch accent at the title bar corner; opens over a scrim, one deep | Destructive confirm uses plain words and a neutral, not red, default focus; error style only for a failed action | Focus trapped (existing `inert`); Esc cancels; Enter confirms the focused button; the cancel button is focused first for deletes | 2 px border | C04-07 (angular HUD banner; the fake OS error screen is refused) | Extends `Drawer` (`Sheet` center variant) and the `confirm` overlay |
| 21 | **Folder Tab Bar** | Tabs sitting on a rail: selected tab joins the panel below (no divider), raised 2 px; a mono counter badge optional | Selected uses `--selected-fill` underline 2 px plus bold label; planned tab is dashed | `role="tablist"`; roving tabindex; Left and Right; Home and End | Selected tab has a 2 px border | C01-16 (nav rail with active dark pill) | Extends `Segmented`; the rail item shares it |

### 7.4 Family C: diagram systems (10 components)

| # | Component | Anatomy and size | Unique states | Interaction and keyboard | Forced colours | Ids | Kit |
|---|---|---|---|---|---|---|---|
| 22 | **Node Ring** | SVG ring of nodes joined by hairline links; a node is a 12 px disc (done) or ring (open); label 12 px mono; max 24 nodes; centre holds a value | Node state by shape (disc, ring, dashed ring planned), never hue alone | Each node focusable; Left and Right move around the ring; Enter opens the node's inspector; a text list is the equivalent | Disc and ring outlines in `CanvasText` | C04-127, C03-21 (node-and-ring widget; filaments to a core) | New (`NodeRing`); used in `tree`, `console.connections` |
| 23 | **Orbit Progress** (orrery) | SVG: concentric hairline orbits, one marker per milestone on an orbit, a "now" marker; 280 x 280 hero, 160 compact | Reached marker filled, upcoming ring, planned dashed ring | Markers focusable in order; the list below is the keyboard equivalent | SVG strokes `CanvasText` | C04-21, C01-02, C03-11, C02-07 (fine concentric orbits; dial with orbit arc; row of phase moons; circular instrument with bezel) | New (`Orbit`); extends `StageStrip` for the stage data |
| 24 | **Ring Bars** (radial bar chart) | 12 to 24 radial bars in a recessed ring with a centre number; each bar has a caption on the plate and a data table fallback | Empty bar is a flat stub (shown, not hidden); stale desaturates to `--ink-3` and half disc | Each bar focusable; the table fallback is a real `<table>` | Bars drawn with strokes, not fills only | C02-24, C03-03 (embossed circular bar ring; concentric ring chart) | New (`RingBars`) |
| 25 | **Contour and Ridgeline Chart** | Stacked contour or ridgeline paths from real series: each row is a path (stroke 1.5 px `--sec-art-1`) with hidden-line occlusion drawn by filling each row with the ground colour; at most 24 rows; max canvas 720 x 360 (§8.1); caption plate states the source | LIVE, SIMULATED (amber stamp and "simulated" in the frame; required by Strand 2 "Do not 4"), WAITING (empty frame) | Static; hover shows a row's value; keyboard: Tab to the chart, arrows change row, the plate lists values | Paths in `CanvasText`; row fill uses `Canvas` | C02-02, C02-06, C04-23, C04-19 (point-cloud mountain; larger mountain with panels; layered-contour island; isometric block) | New (`Ridge`); canvas 2D or SVG, no WebGL |
| 26 | **Annotated Callout** | A leader line (1 px) from a point to a plate with a mono label and one value; plates never overlap; max 6 per view | Planned callout dashed; fault callout carries a triangle | Plates focusable; focusing highlights the target point | Leader as a border-width line | C04-13 (callout window with leader; the anatomy and person pictures are refused) | New (`Callout`); a Limbs wall-box map uses it |
| 27 | **Dimension Sheet** | Spec rows with dimension lines (`|<-- 54 mm -->|`) between an object and its labels; for `console.hardware` plates | Absent part drawn dashed with "not fitted" | A static diagram plus a table | Lines are borders | C02-37 (technical spec poster) | New (`Spec`); extends `Row` |
| 28 | **Dot Column Timer** | Columns of 30 dots (columns = ceil(planned minutes / 30), at most 5, §4.4.5); one per elapsed minute is a solid disc, the rest rings; the next-to-fill is a ring with a 2 px `--ink-1` edge; partial end leaves partial dots; no flashing; silent end by default | Paused: the next dot is a half disc; ended early: filled dots remain, nothing dies; resting: a small row of 5 rings | `role="timer"` is not used (it would announce); a status text "32 minutes" updates once a minute (`aria-live="off"`; the minute count is in the text next to it) | Solid and ring dots are SVG shapes, so shape survives | C03-08, C04-57 (poster with a column of black dots; horizontal ticker) | New (`DotTimer`); extends `StageStrip` |
| 29 | **Calendar Wheel** | A 12-segment wheel with the exam dates as ticks on a ring; a "today" notch; list alternative alongside | Past dates filled, upcoming ring; planned dated item dashed | Segments focusable; Left and Right move; Enter opens `date` overlay | Segments bordered | C03-05, C02-38 (cream astrolabe calendar wheel; calendar month grid) | New (`DateWheel`); opens the existing `date` overlay |
| 30 | **Pillars Polygon Chart** | 5 to 8 axes spider (polygon) chart with a polygon outline, a "sample data" or state tag at all times; table fallback | Sample or simulated data stamped; never shown as the student's own until it is | Axes focusable; arrows adjust only in an edit mode (sliders beneath) | Polygon stroke and axes borders | C02-09 (radar with pillar sliders and a sample tag) | New (`PillarsChart`) |
| 31 | **Week Strip** | Seven day pills, today with a notch; each day shows real logged minutes as a small dot count (a pure function of the day's logged minutes; the date is a data-layer input, so it resets neutrally when the date changes; D18); rest days are a first-class glyph | Rest day: a distinct half-moon glyph and the word "rest", no penalty tone | Roving tabindex; Left and Right; Enter opens that day | Pills with 1 px borders | C01-26, C01-07 (clay week strip with dock; day pill row) | Extends `TapGroup`, `Segmented` |

### 7.5 Family D: ASCII and halftone surfaces (6 components) and the planned plate

| # | Component | Anatomy and size | Unique states | Interaction and keyboard | Forced colours | Ids | Kit |
|---|---|---|---|---|---|---|---|
| 32 | **ASCII Sweep Loader** | A mono text band (12 px, 3 to 6 rows) in which a band of denser characters sweeps once; shown after the 160 ms delay for routes and long reads; total at most 12 characters wide per row group (assumption); never a percent counter | Static form: a fixed mid-density frame; Calm and forced colours show the static form and the verb ("reading memory") | None; `aria-busy` on the region; the text verb is the only live content | Static frame (text) | C04-52, C04-49, C04-126, C03-20 (tilted ASCII ellipse; ASCII titled card; accretion ring; pixel-sorted vortex) | Extends `Skeleton` |
| 33 | **Stipple Ring** | A circular progress ring built of stippled dots (SVG circles, max 120) around a centre value; filled share uses disc, remainder ring | Same shape rule as components 28 and 36 | Read-only; value as text | Discs and rings | C04-05, C04-48, C04-123 (stippled ring around a halftone moon; ASCII ring; number bloom) | New (`StippleRing`) |
| 34 | **Dither Plate** | A 1-bit ordered-dither (Bayer 4x4) raster, generated at build or on idle from the idea, never pasted: used as a placeholder image, onboarding art, pairing card art; max 200 KB per route (Strand 6) | Decorative only: `aria-hidden`; any real content beside it is text | None | Raster image, no effect | C03-18, C04-109 (dithered bridge; dithered hands) | New (`Dither`); derivation script in the art phase |
| 35 | **ASCII Empty State** | A 12 to 16 line character picture (12 px mono) plus a one-sentence message and one action | Variants per context: tree (branch), memory (forest smear), console (terminal), error (ERROR lines) | Message and action are real text and a button | Art `aria-hidden`; text and button remain | C04-105, C04-106, C01-09, C03-19, C04-119 (coiled dragon, chopper, error poster, forest smear, twig dissolving into letters) | Extends `EmptyState` |
| 36 | **Dot-Matrix Meter** | A 5 x 12 LED-style grid in SVG (60 dots); level is a filled count; bounds in mono; for audio level, signal strength, channel counts | WAITING draws all rings and "--"; simulated stamps the diamond | Read-only; text value alongside | Disc and ring | C02-11, C04-118, C01-14 (dot-block sheet; dot landscape; counter and loading bar) | Extends `Meter` |
| 37 | **Cell Skeleton** | Quadtree-style blocks sized to the final layout (loading states that match content), static, no shimmer | Reveal when data arrives replaces blocks in place | `aria-busy` | Blocks bordered | C04-15 (adaptive-cell mosaic) | Extends `Skeleton` |
| 38 | **Dashed Blanking Plate** (the PLANNED home) | A flush plate with a dashed 1 px `--edge-ui`, a dashed-ring glyph, "PLANNED" label, one sentence of what it will do and what exists today, and a "What is coming" link | Always planned; never gains hover lift or a pressed state | Focusable (`aria-disabled`); Enter and Space open the "What is coming" overlay | `1px dashed ButtonText` and text | C02-25, C02-30 (chamfered label plates, dashed variant); §6.6 | Extends `ComingCard`, `LockChip`; reads the shared `plannedFeatures` registry |

Count: 38 components (11 + 10 + 10 + 7). "Voice Hill" (core centrepiece) and the Reactor ring are specified in §9; they follow component tokens `--hill-*` defined there and the art colours of 6.3.5.

### 7.6 Component tokens (layer 4 defaults)

| Token | Default (reads) | Used by |
|---|---|---|
| `--hit` | 44px | all pointer targets (existing) |
| `--field-h` | 40px (existing) | fields; hit area from padding |
| `--key-size` | 56px | Key, rail items |
| `--key-bg`, `--key-edge` | `--surface-raised`, `--edge-ui` | Key, Raised Pill |
| `--btn-primary-bg`, `--btn-primary-ink`, `--btn-primary-edge` | `--accent-fill`, `--accent-on`, `--ink-1` | `PrimaryButton` |
| `--switch-w`, `--switch-h` | 56px, 32px | Switch |
| `--switch-track-on` | `--selected-fill` | Switch, Rocker |
| `--knob-d` | 96px (hero), 56px (compact) | Knob |
| `--readout-bg`, `--readout-edge` | `--surface-sunk`, `--edge-ui` | Readout, Log |
| `--panel-bg`, `--panel-edge` | `--surface-raised`, `--edge-hair` | Card, Panel |
| `--chamfer` | 10px | Panel, Plate |
| `--bracket-len`, `--bracket-w` | 12px, 2px | Frame |
| `--lamp-size` | 12px (16px in title bar) | Lamp |
| `--log-line` | 18px | Console |
| `--dot-d` | 8px (dot meters), 10px (timer) | dot components |
| `--focus-bleed` | 4px | containers that clip |

### 7.7 Rules for composing with the kit

**Source ids (added after the review of 2026-11-12).** The Ids columns of §7.2 to §7.5 are regenerated from `asset-assignments.json` by one script (`tools/art/check_ids.py`): an id is listed only if the JSON gives it a product use, never when its track is `reference-only` (a refusal, a mood board, a technique sample or a note that begins "None."), and the parenthesis after each id names the one trait taken from it; the JSON's `purpose` field is the source of that trait and Appendix C lists them all. A.Q01 fails the build when a refused id appears anywhere in §7 or §8. Rows that lost an id above now say "no picture source" and use the existing kit component as the reference.

1. **No bento grids.** A view is composed around its centrepiece and one primary action (§8.1, layout rule). The kit has no equal-card grid primitive; `Card` is a container, not a layout. `MasterDetail`, `Fold`, a two-column split with the centrepiece taking the larger share, and a single-column list are the layouts; the existing `Section` and `SectionOrder` set the reading order.
2. **One primary.** `PrimaryOwner` already allows one `PrimaryButton` per page; keep it. In `focus.session` the primary is Pause; the orange fill appears once.
3. **Edge discipline.** A control gets `--edge-ui`; a container gets `--edge-hair`; a shape that carries information gets an outline in ink and a caption.
4. **No number without a state.** Components 6, 18, 24, 25 and 36 take `state` as a required prop; the unit test from §6.6 fails any that render a number without it.
5. **Static first.** Every moving component (6 colon, 28, 32, 33) has a static form that carries the whole meaning; Calm and forced colours always select it. Anything that moves for more than 5 s offers Pause, Stop or Hide (WCAG 2.2.2).
6. **Idle cost.** A component that animates owns one redraw loop, stopped on `visibilitychange`, out-of-view (`IntersectionObserver`), unfocused window and after the idle timeout (60 s is a suggestion; §8.1). Static shadows only.
7. **Naming for tests.** Every component root carries `data-component="<kebab name>"`; states are `data-state`, planned is `data-planned`; the test ids follow `<section>.<view>/<component>`.

---

## 8 Art direction and asset policy

### 8.1 Rules and the one centrepiece per section

*Superseded in part by 20.4.6 (all centrepieces at full strength, direct placement allowed) and D-V2-1.*

Rules for all: static first; motion only when it encodes a real state or marks a transition; every moving piece has a static and a reduced-motion form that preserves the whole experience; anything that moves for more than 5 s has Pause, Stop or Hide (WCAG 2.2.2; in practice the hill and, while motion energy is non-zero, the Senses orbits); one redraw loop per visible art piece, stopped when hidden, minimised or idle (the 60 s idle value is a design suggestion; Strand 6); no new WebGL (the Senses twin stays the only renderer; `ww/` creates none); canvases at most 720x360 CSS px (target); art is re-drawn or dithered from the idea, never pasted from the picture. Decorative art is labelled so by its absence of values; meaningful art carries a caption saying what it encodes.

| Section | Visual world | Centrepiece (catalogue id, neutral description) | Why this one | What drives it (honesty) | Motion role | Derived or avoided |
|---|---|---|---|---|---|---|
| `core` | Retrofuturist HUD on charcoal (immersive) | **C02-02**: black field, a mountain of white point-cloud particles with tiny coordinate readouts | The owner's brief names a dot-point hill for voice; this is the clearest silhouette that reads as a live trace | The real analyser level (input now; output after `core/playback.py` emits RMS plus a coarse band spectrum, Strand 0, section 4; Strand "What it changed" 1). No level: a still labelled "no signal" ring, never a canned wave | Moves only while audio flows; with the Senses orbits (while motion energy is non-zero) it is one of the only two continuously moving pieces | Outer ring from C02-07 (white circular instrument with ring bezels) and dial from C01-06; C02-06 as variant |
| `room` | Tactile clay hardware, minimal brutalism (light, with a dark faceplate) | **C01-23**: dark slate hardware panel with a large rotary dial and mono buttons | The wall box is a real 8-channel object; a faceplate with real keys is the most honest picture of it | Each key lamp follows the board's own report (cyan "confirmed by board"); absent channels drawn "unavailable" | Key settle and lamp change only | Raised round buttons from C02-28; isometric device icons from C01-08 |
| `senses` | Cybersigilic line work over technical diagram (immersive) | **C04-06**: black field, a white wireframe spindle ringed by orbits over a grid plane | An abstract "signal body" cannot suggest pose or a camera, which matches the physics: one link sees that a body moved | Motion energy, labelled "signal estimate"; SIMULATED stamp in amber when the hub says simulation | Orbit speed follows measured motion energy; still when idle | Cone diagram from C03-15; sigil rings from C03-06. **Avoid C04-26 (halftone eye: reads as a camera) and C03-12 (screaming figure)** |
| `memory` | ASCII and halftone on a light paper-grey scene | **C04-119**: a black branch whose twigs dissolve into letters | Retrieval as words growing from a root; cheap to render; high contrast | A fixed, static picture bound to no count (deleting data never shrinks it and storing data is never rewarded); result excerpts stay plain text | None | Forest smear C03-19 and halftone clouds C03-17 as empty-state variants. Avoid C04-114 (page of a published book) |
| `console` | Matrix and terminal (immersive) | **C04-10**: black terminal screen, a text login with an ASCII landscape, bracketed channel tags and a boxed panel | The one place where text is the interface; the frame grammar (bracket tags, boxed panel) is directly reusable | Log lines are real events; simulated events marked | None (the cursor is a solid block) | Frame grammar from C04-16 (charcoal, no phosphor, no scanlines); bracket HUD from C04-18; re-draw the landscape, drop all names from the source |
| `day` | Minimal brutalism with clay widgets and one painterly sun (light) | **C04-37**: warm ochre painted sun with a face and flame rays | The owner asked for ASCII renderings of a painted sun; it is warm, calm, and legible as time of day | Today's real logged blocks only; rays count completed blocks; **a pure function of today's logged count** (no loss framing: it never dims because time passed); the date is an input from the data layer, not a clock read inside the art function | A one-time ray reveal on a logged block; static otherwise | Clay clock and chip widget structure from C02-39; pixel numeral from C02-34. C04-43 night sky as the Close-view backdrop |
| `study` | Data landscape plus technical diagram (light, cream) | **C04-23**: dark poster, an isometric layered-contour island with tiny trees | One layer per syllabus unit, raised by real covered topics, is competence feedback with no loss mechanic | Real logs; empty units are flat, never decorated | Static; redraw on data change | Exam-date wheel from C03-05 (calendar-wheel astrolabe) in `study.plan`; isometric block from C04-19 |
| `tree` | Painterly line and ink (light, dusk toward dark with progress) | **C04-44**: low-angle view up a tree trunk into a swirling painted sky | The product literally has a tree; the trunk grows from the nodes actually mastered | The count of nodes the student marked mastered; never changes with time | Static; one draw-in on mastery | Stained-glass cell pattern from C04-40 for node fills |
| `career` | Painterly journey with technical drawing (light) | **C04-116**: painted city of tall orange towers over a plain of tents and campfires | The road ahead as a skyline; pipeline items are waypoints on it | A stage lights only when its real item is done | Static | Line cathedral C03-02 for detail plates. Avoid C04-121 and C03-10 as centrepieces (rights notes flag strong resemblance to published artwork) |
| `focus` | Minimal brutalism, calm, charcoal immersive while a session runs | **C03-08**: textured poster, a column of black dots with letterspaced text | One dot per elapsed minute is the plainest honest timer; no flashing | Elapsed minutes; an early end leaves partial dots, not a dead object (Strand 1, W-principle 2) | One dot per minute, silent end by default | Calm hill C04-38 for `focus.rest`; halftone moon C04-05 as the start-view ring. Do not reproduce the poster's words |
| `proof` | Embossed data relief (light) | **C02-24**: white embossed 3D relief of a circular bar-chart ring over a dot grid | The relief is real clay depth, applied to real numbers | Statistics Proof already computes; caption on every ring | Static; redraw on data change | Poster variant C02-40. Do not reproduce its labels |


**Layout rule.** No default bento grid and no grid of equal cards (Strand 1, J-principle 6). Each view is composed around its centrepiece and one primary action; dashboards are per moment (room, night, away), not per device.

**Centrepiece strength rule (added after the review of 2026-11-12).** A centrepiece is at least 25 % of its view's content box and is visible in the view's default state. Computed shares of the layouts in §4: hill 30.9 % of J; faceplate 270,000 of 838,472 = 32.2 %; Day sun 32.5 % of W+; Study island 40.2 % of W; Career skyline 42.5 % of W; Focus dots 26.0 % of W+; Memory branch plate 25.8 % of J; Tree 69 % of Wt; Senses spindle 30.9 % of J. The Proof ring takes the top 40 % of the open panel. The Console frame is 800 x 652 of J (62 %). A piece that cannot meet 25 % in its default state is not the centrepiece of that view.

### 8.2 What the art direction decides, in eight lines

1. Every section has the one centrepiece fixed in §8.1. Each is placed, masked and scaled against the 1366x768 geometry in §3.3, and each has a static form that carries the whole meaning and a reduced-motion form that is the same picture.
2. The product never refers to a catalogue id. Code refers to **art ids** (`art.core.hill`, `art.day.sun`). A manifest resolves an art id to a source, a recipe and a rights track. Swapping a third-party source for an own-made one is then a manifest change, not a code change (§8.5 and §8.6).
3. Art is made offline by a rule-based Python + PIL step (ASCII text, Bayer and Atkinson dithers, contour SVG, duotone WebP). The app ships files and, in exactly one place (the voice hill), a small canvas 2D loop. No new WebGL.
4. "Growing" art is a pure function of the current counts the student really produced (blocks logged, nodes the student marked mastered, topics covered). Same counts give the same picture; the picture may fall if the student deletes or un-marks something; time alone never changes it (section 8.5.5). Stored-item counts never drive art.
5. Two tracks. The **private-build track** uses the owner's pictures directly, from a git-ignored folder, behind a build flag that defaults off. The **customer-release track** ships only public-domain sources, the project's own rule-generated art, or commissioned or licensed work (section 5).
6. All 186 catalogue pictures are assigned in `asset-assignments.json` (§8.7). 150 sit outside the deck section (149 assigned to a product section, screen or state as centrepieces, derivatives, component references, empty or loader art, plus one recorded refusal in `room`); 36 are in the deck section (24 recorded refusals and 12 mood boards and technique samples); 25 refusals in all. Every one has a deck use.
7. Pictures that imply a camera, a pose, a body, a weapon, a skull, a real person's likeness or a copyrighted quote are not used in the product. They are kept in the private deck on a "what we refused" slide, so the refusal is explicit and checkable (core D.22).
8. Decorative art has no values and `alt=""`. Meaningful art has a live caption and a generated `aria-label`; the caption, not the picture, is the access path.

**Art id naming.** `art.<section>.<name>` for section art; `art.shell.<name>` for loaders, transitions, onboarding, empty, error; `art.kit.<name>` for component references. Example: `art.day.sun`, `art.shell.route.core-room`, `art.kit.dial`.

### 8.3 Section by section: centrepiece, placement, derived system

*Superseded in part by 20.4.6 and 20.4.7 (revised treatments, secondary placements).*

The §8.3.n numbers are stable cross-reference ids; they are not the rail order (§3.1.2: Well Wisher is Day, Focus, Study, Tree, Career). Centrepiece packages (B06b) follow the build order of §15.4, not this numbering.

Geometry used below is computed from §3.3: canvas inside gutters is 1286x704. Well Wisher views with the 40 px Now strip have 1286x664. With the Proof rail collapsed (56 px) the usable width is 1302 - 56 - 16 = 1230, so 1230x664. `day.today` and `focus.session` hide the Now strip and use 1286x704. Cell size for ASCII is **7.2 x 16 px** (assumption: Geist Mono advance 0.6 em at 12 px = 7.2 px; line height 16 px); cell counts below are computed from it.

#### 8.3.1 `core` (JARVIS, immersive charcoal) , centrepiece C02-02

| Item | Specification |
|---|---|
| Art id | `art.core.hill` (live), `art.core.hill.still` (static) |
| Source and view | C02-02 (narrow point-cloud mountain), C02-06 (wide, three ridges) as the second variant |
| Placement (`core.talk`) | The Hill stage region of §4.3.1: a 720 x 360 canvas at the top-left of the left column (30.9 % of the 1286 x 652 content box, computed there). Decision I4: the earlier art-side placement (centred, top edge at y = 148) is superseded |
| Placement (`core.sound`) | No hill in the first release: `core.sound` carries the 640 x 64 output meter of §4.3.1 (dot-matrix meter, §7.5 component 36). Once Tier 1 delivers an output level and a coarse spectrum (§9.9), the meter may take the three-ridge form of C02-06 (input, output, band spectrum). Decision I4 |
| Mask and crop | Private build: C02-02 cropped full, masked to a 720x360 band with a 48 px vertical fade at top and bottom (alpha ramp), shown only as the frozen no-signal still. Customer build: no crop; points are generated (section 8.6.3) |
| Scale | Geometry is fixed in §9.5 (96 columns x 8 depth layers x 4 stipples = 3,072 points at `high`, 1,280 at `low`). The earlier art-side figure of 96 columns x 24 rows is superseded (decision I5) |
| Derived visual system | Point-cloud ridgeline: each column is a stack of points whose height is the level. Outer ring from C02-07 (bezel and rim ticks traced as 1.5 px SVG), dial grammar from C01-06 |
| Components informed | VoiceHill, Ask orb ring, Wake and Sleep dial, wake loader (C01-14: three plain rows heard, working, done) |
| Motion role | State. The hill moves only while the real analyser level is non-zero. It is the only continuously moving piece in the product |
| Static form | A still ring and a labelled "no signal" caption; the private build puts the C02-02 still behind it at 12 % opacity. Never a canned wave (D23) |
| Reduced-motion form | The hill redraws at most 4 times a second as a stepped level bar of the same points; the caption "level 62 %" is text |
| Accessibility | Meaningful. `role="img"`, `aria-label` generated from the level band: "Voice level, medium" , updated at most once per 2 s so a screen reader is not flooded. Caption always visible. Contrast: points drawn in `--ink-1` on the core scene ground `#0F1011` (15.76:1, §6.3.4; decision I15) |
| Performance form | Canvas 2D, one rAF loop, one 720x360 backing store at devicePixelRatio 1 (target), cleared per frame; stops on `visibilitychange`, window blur, and 60 s of silence (idle value from Strand 6, design suggestion). Target at most 1 ms scripting per frame (assumption; measure under F8) |
| Other art in section | Asleep scene C04-125 as ASCII (static). Nothing-playing bird C04-55 and two note glyphs C04-117 and C04-120 for `core.sound` (static ASCII, text files). Wake transition: warped-grid contour from C03-01, 160 ms. |

The voice hill's data contract (input and output level, spectrum) belongs to the voice-visualiser specification; this part only fixes the art form.

#### 8.3.2 `room` (JARVIS, light with a dark faceplate) , centrepiece C01-23

| Item | Specification |
|---|---|
| Art id | `art.room.faceplate` |
| Placement | The Faceplate region of §4.3.2: 900 x 300 at the top-left of `room.switches` (200 px dial, eight keys in two rows of four at 140 x 88, label plate; arithmetic in §4.3.2). Decision I4: the earlier art-side 720 x 320 faceplate is superseded |
| Mask and crop | Private build: C01-23 slate panel cropped to the faceplate aspect (9:4) and shown as a 40 % opacity engraving under the real keys. Customer build: SVG faceplate drawn from the real eight-channel layout; dial ticks from a formula (60 ticks over 270 degrees) |
| Derived visual system | Dark clay faceplate (`--surface-sunk` dark, `--edge-ui` hairlines), mono key legends, 2 px key travel. Seam texture from C01-20 as a 12 % duotone strip along the bottom edge (1000x180 source) |
| Components informed | Key (C02-28 round raised cap, C02-19 single key values), toggle and knob family (C02-46), device icons (C01-08, isometric outlines with the orange dot as the "on" lamp, redrawn 24 px), scenes list (C02-32), empty state (C02-35), phone Room tab (C01-22), modes dial (C02-20), material pair (C01-17) |
| Motion role | State and transition. A key settles 2 px on press (80 to 160 ms JARVIS tempo, §1.2); the lamp changes only when the board reports. Nothing else moves |
| Static form | The faceplate with each key showing on, off or "unavailable" (dashed outline, no lamp) as reported. Absent channels stay drawn |
| Reduced-motion form | The key changes state with no travel; lamp changes instantly. Same picture |
| Accessibility | Meaningful. Each key is a real `<button aria-pressed>` with the channel name and "confirmed by board" or "not confirmed" in its accessible name; the engraving is decorative (`alt=""`). Key edge uses `--edge-ui` 3:1 (4.04 on light ground, §6.3) |
| Performance form | Pre-rendered engraving as a 12 KB duotone WebP (target) plus live SVG keys. No canvas |
| Planned plate | Away mode PLANNED card uses the hound contour C04-104 under a dashed blanking plate (static) |
| Refusal | C01-25 has a camera lens; it is recorded as refused. No lens or camera form appears on any room art |

#### 8.3.3 `senses` (JARVIS, immersive charcoal) , centrepiece C04-06

| Item | Specification |
|---|---|
| Art id | `art.senses.spindle`, `art.senses.waiting` |
| Placement (`senses.presence`) | The Motion stage of §4.3.3: a 720 x 360 band of the 760 x 652 Stage, with the parametric spindle drawn as an SVG emblem of about 360 x 360 centred in it and the orbit ellipses reaching toward the band edges; the 3D twin mounts only when Map is selected. The spindle is SVG with CSS-rotated groups, not a canvas (decision I4) |
| Mask and crop | Private build: spindle and orbit rings cropped from C04-06, circular mask, 520 source px shown at 360 CSS px (1.44x source density), plane grid cropped off. Customer build: parametric spindle, a surface of revolution with radius profile r(z) = 0.35 + 0.65 sin(pi z), 3 orbit ellipses at 12, 38 and 61 degrees |
| Derived visual system | Cybersigilic line work: 1 px white strokes, no fill, thin orbits. Ring frame for the Teach control from C03-06 (circles and nested triangles only). Floor grid of the twin takes the idea from C04-27 (flat grid, not the terrain). Zone rings from C04-21. Link diagram from C03-15 redrawn as two end dots and the zone between them |
| Components informed | ChannelMatrix cell style from C04-15 (a cell is solid, or subdivided into 4 when its signal is stronger), parameter strip for Teach from C04-28, sigil frame for the CSI strip from C04-127, backdrop contour from C02-10 (15 % opacity), calibration rings from C03-04 (three concentric rings, fill = quiet frames collected), step art from C03-03 and C03-14 |
| Motion role | State. Orbit angular speed follows measured motion energy (target mapping: 0 to 20 degrees per second over the normalised range, assumption). Still when idle. Never decorative |
| Static form | Spindle drawn with orbits at fixed angles; caption "signal estimate: moved / not moved", lamp LIVE, WAITING or SIMULATED beside it. SIMULATED is stamped in amber inside the emblem frame, so a screenshot of the art cannot lose the stamp |
| Reduced-motion form | The orbits do not turn; a small tick on each orbit shows the energy as a static bar. Same information |
| WAITING state | `art.senses.waiting` from C04-41: the static vortex converted to a frozen 1-bit Bayer field (4 px cells), never animated. It marks "expected signal has not arrived" and is paired with the half-disc lamp |
| Accessibility | Meaningful. `aria-label`: "Signal estimate, moved, live" or "simulated". Contrast: strokes at `--ink-1` on charcoal; amber stamp `#FFB347` on the senses ground `#0A0C10` is 10.99:1 (§6.3.4; decision I15) |
| Performance form | SVG, at most 120 path nodes (target); the orbit rotation is CSS `transform: rotate` on three groups (compositor only), started and stopped by the energy value |
| Refusals | C04-26 (halftone eye) and C03-12 (screaming figure) are never used. One link shows that a body moved, not its pose, so no human-shaped or point-cloud body appears (Strand 2, "Do not" 5) |

#### 8.3.4 `memory` (JARVIS, light paper-grey) , centrepiece C04-119

| Item | Specification |
|---|---|
| Art id | `art.memory.branch` (one fixed file; no level files) |
| Placement (`memory.recall`) | The branch plate in the Detail pane of §4.3.4: 510 x 424 CSS px, about 70 x 26 character cells (computed: 510 / 7.2 and 424 / 16; assumption), visible in the default state (25.8 % of J). Decision I4 is updated to this size |
| Mask and crop | Private build: C04-119 branch cropped and masked to the right column with a vertical fade; Customer build: an L-system branch (angle 22 degrees, 5 iterations, seeded) rendered as characters |
| Derived visual system | ASCII where twigs dissolve into letters; the letters are a fixed generic alphabet strip, never stored text, so no keyword or private text can appear in a screenshot |
| Components informed | People avatar placeholder (C04-48, a ring of heavy glyphs generated from an initials hash so no face), export-ready marker (C04-53), archive box (C04-54), export progress strip (C04-57, car position = bytes written over total, a real fraction), stored-count glyph (C04-123), printable export header (C04-133), belief web (C04-113) and background (C04-50) |
| Motion role | None; still |
| Growth rule | None (decision 2026-11-12, honesty review). A picture that grows with stored items rewards hoarding data and punishes deleting it, and a falling picture is loss framing; the first draft's 12 level files are dropped |
| Static form | The one file, decorative, with no caption about counts |
| Reduced-motion form | Identical (nothing moves) |
| Empty states | No results: C04-56 reduced to a blank outline. Empty belief queue: C03-17 halftone clouds. Empty search: C03-19 contour bands |
| Accessibility | The branch is decorative: `aria-hidden`, `alt=""`. The result excerpts stay plain text. The art never contains stored text |
| Performance form | One text file at most 3 KB in a `<pre aria-hidden="true">`. No canvas |
| Refusal | C04-114 is a page of a published book; recorded as refused |

#### 8.3.5 `console` (JARVIS, immersive charcoal) , centrepiece C04-10

| Item | Specification |
|---|---|
| Art id | `art.console.frame` |
| Placement (`console.health`) | The terminal frame is the 800 x 652 Terminal region of §4.3.5, with a 60 x 14 cell ASCII skyline of the room (432 x 224 px, computed from the 7.2 x 16 cell) at its top right and hand-typed text; no source pixels (decision I4) |
| Derived visual system | Bracket tags, boxed panel, mono. Frame for events overlay from C04-16 (charcoal, not orange). Corner brackets from C04-18. Capsule chip for firmware identity from C04-14. Label around object from C04-13. Connections layout from C04-24 |
| Components informed | TerminalFrame, event row `[CORE]` `[EYES]` `[SIM]`, dotted LED readout (C02-33), roster layout (C02-29) with frames (C04-02), GPU gauge (C02-12: arc scale drawn from the real VRAM reading), spec sheet (C02-37) |
| Motion role | None. The cursor is a solid block; there is no blink and no ambient animation |
| Static form | Full frame with the last 14 events, as the real bus reports. Simulated events marked with the amber diamond |
| Reduced-motion form | Identical |
| Planned and empty | Agents PLANNED card with the ASCII dragon C04-105 under a dashed plate. Nothing connected: ASCII chopper C04-106. Link established: bridge C03-18 redrawn as own 1-bit drawing, shown only when a link is reported |
| Accessibility | Log lines are real text in a `role="log"` region with `aria-live="off"` (events are not announced; the fault chip is). The skyline is decorative |
| Performance form | Text only. Zero images in the default view |
| Refusal | C03-13 and C04-132 depict body anatomy; refused. C03-16 and C04-42 depict real-looking people; refused |

#### 8.3.6 `day` (Well Wisher, light) , centrepiece C04-37

| Item | Specification |
|---|---|
| Art id | `art.day.sun` |
| Placement (`day.today`) | The Sun region of §4.4.1: 620 x 420, an SVG sun (disc of about 400 px, an assumption that leaves 10 px margins) with the 12 ray positions at 30 degree steps; not a canvas. Decision I4: the earlier art-side 360 x 360 disc is superseded |
| Mask and crop | Private build: sun face and flame rays cropped to a circle, ASCII rays overlaid (one ray per logged block). Customer build: geometric sun (disc, 12 ray polygons, a paper grain) |
| Derived visual system | Painted warm ochre, tonal duotone ochre and charcoal; accent `#F25623` only as the fill of the newest ray (never text, D11). Clay clock chip structure from C02-39, pixel numerals C02-34 and C01-05 from the digits-only Doto subset |
| Components informed | Now chip, big minutes-left numeral, widget density cap (C01-07: at most 7 widgets per scene, matching the 7-card limit in `well-wisher-ui.md`), week strip and calendar (C02-38), vertical day label (C01-10, Inter 600 rotated), wheel of areas (C02-09, counts only) |
| Motion role | State. One 240 ms ray reveal when a block is logged. Static otherwise |
| Growth rule | Rays = logged blocks today, up to 12 drawn at 30 degree steps in a fixed order; beyond 12 a numeral "+n". A pure function of today's count of logged blocks: the date is an input supplied by the data layer (never a clock read inside the art function), so the sun resets neutrally when that date changes, and a deleted log entry lowers it (D18). It never dims because time passed |
| Static form | Sun with the current ray count and caption "3 blocks logged today" |
| Reduced-motion form | The new ray appears with no animation |
| `day.close` | C04-43 (night sky painting in a public-domain style) as a duotone backdrop at 15 % opacity; re-source the public-domain original for the customer release |
| `day.week` and `day.body` | Rest day illustration C04-39 beside "Rest days are part of the week" (240 x 160 duotone); C04-46 for the empty gym row; first-run empty plan C04-101 (sun disc in the accent fill only) |
| Accessibility | Meaningful, `aria-label` "Sun with rays, 3 blocks logged today". The ray count is also text. Decorative backdrops `alt=""` |
| Performance form | One SVG of 12 polygons and a disc (target under 4 KB) plus a 20 KB duotone WebP face. No canvas |

#### 8.3.7 `study` (Well Wisher, cream) , centrepiece C04-23

| Item | Specification |
|---|---|
| Art id | `art.study.island` |
| Placement (`study.papers`) | The Island region of §4.4.2: 560 x 540 (a 560 x 500 SVG or pre-rendered picture plus a 40 px caption plate). Decision I4: the earlier art-side 640 x 360 placement is superseded |
| Mask and crop | Private build: C04-23 island block cropped and masked 640x360. Customer build: layered contour terrain from fractal value noise (4 octaves, seeded per syllabus), one layer per unit |
| Derived visual system | Isometric contour layers, dark poster ground only inside the island frame; subject cards use a stable generated line pattern per subject from a hash of its name (idea from C02-08, nine pattern cards) |
| Components informed | Exam-date wheel (C03-05, spokes are real dated papers) in `study.plan`, stacked day blocks (C04-19), day ruler with hour ticks (C01-04), Coach PLANNED card art (C04-22 duotone under a dashed plate), searching state (C04-31 contour at 20 %), icon grammar (C04-33, redrawn at 16 px), paper grain generator (C04-09 families, own noise) |
| Motion role | None while viewing; redraw when data changes |
| Growth rule | Layer height for a unit = ceil(4 x covered topics / total topics), 0 when nothing is covered (flat, never decorated). A pure function of the current covered count: it falls only if the student un-marks a topic, and never with time |
| Static form | Island with the current heights; caption "5 of 9 units started" |
| Reduced-motion form | Heights change with no transition |
| Accessibility | Meaningful, `aria-label` "Contour island, 5 of 9 units started"; a visually available list of units with heights is the full text path |
| Performance form | SVG or pre-rendered WebP, at most 120 KB (target); canvas not needed |

#### 8.3.8 `tree` (Well Wisher, light to dusk) , centrepiece C04-44

| Item | Specification |
|---|---|
| Art id | `art.tree.trunk` |
| Placement | A column 430 x 664 CSS px (0.35 x 1230) at the left of the 846 x 664 node canvas of §4.4.3, with the Inspector (368 x 664) on the right as built. The nodes stay the interface; the trunk is the atmosphere that counts |
| Mask and crop | Private build: C04-44 trunk and sky, masked to the column with a horizontal fade. Customer build: L-system trunk with brush-stroke texture (rule-generated) |
| Derived visual system | Painterly line and ink; node fills use Voronoi-cell patterns by subject (C04-40); a mastered node gets radiating contour lines (C03-21, 1 px) |
| Motion role | One 280 ms draw-in on mastery (stroke-dasharray). Reward 1 of the fixed visible sequence is the one-off bird line draw C03-07 at first mastery of the day (deterministic, not random, D17) |
| Growth rule | Trunk height = (nodes marked mastered / total nodes) x column height, segmented per node. A pure function of the student's current marks: it falls if a mark is removed and never changes with time |
| Static form | Trunk at the current height, caption "17 marked by you" |
| Reduced-motion form | Segment appears with no draw |
| Accessibility | Meaningful, `aria-label` "Trunk, 17 nodes marked mastered by you". The Tree itself keeps its own keyboard and text paths |
| Performance form | One 40 KB SVG plus a 30 KB texture WebP (target) |

#### 8.3.9 `career` (Well Wisher, light) , centrepiece C04-116

| Item | Specification |
|---|---|
| Art id | `art.career.skyline` |
| Placement (`career.pipeline`) | The skyline region of §4.4.4: 1230 x 260 across the top, with the Up next plate (340 x 212) over its right end; the pipeline list is 1230 x 336 below. Each tower is tied to one pipeline stage. Decision I4: the first-draft 720 x 220 band is superseded |
| Mask and crop | Private build: C04-116 towers and tents cropped to the strip. Customer build: procedural towers (seeded rectangles, windows as dots) |
| Derived visual system | Painted journey plus technical drawing: detail plates from the cathedral line drawings C03-02 and C04-122 (white line on charcoal, 200 x 400) on cert cards; route arcs idea from C04-115 for `career.abroad` (redrawn from real deadlines); keypad from C02-36 for the budget sheet; Atlas header C04-32 (public-domain style engraving) for `career.ladder` |
| Motion role | None. A stage lights only when its real item is done |
| Static form | Skyline with lit and unlit towers, caption "2 of 6 lit" |
| Reduced-motion form | Identical (nothing moves) |
| Empty state | "No stages yet": C04-118 dot landscape with no towers |
| Accessibility | Meaningful, `aria-label` "Skyline, 2 of 6 stages complete"; the stage list below is the real text path |
| Performance form | One WebP strip of 90 KB (target) with lit towers drawn as SVG overlays, so no re-encode per state |
| Refusals | C04-121 and C03-10 resemble published artwork; recorded as refused for any centrepiece role. C03-09 (falling body) is loss framing |

#### 8.3.10 `focus` (Well Wisher, charcoal while a session runs) , centrepiece C03-08

| Item | Specification |
|---|---|
| Art id | `art.focus.dots` |
| Placement (`focus.session`) | The Dot field region of §4.4.5: 360 x 580, columns of 30 dots at an 18 px vertical pitch (30 x 18 = 540 px), 10 px dots, columns = ceil(planned minutes / 30) up to 5 at floor(360 / columns) px spacing. Decision I4: the earlier art-side single 60-dot column at an 8 px pitch is superseded |
| Mask and crop | Private build: C03-08 dot column and paper texture masked into the same column. Customer build: 60 SVG circles and a generated paper-grain tile |
| Derived visual system | Minimal brutalism on a textured poster; letterspaced captions in Geist Mono 12 px. The poster's own words are not reproduced |
| Components informed | Start-view ring of stippled halftone moon (C04-05, Bayer 8x8, 280 x 280), calm hill for `focus.rest` (C04-38, crop 480 x 270, text in a separate plate), paused marker (C04-12, half moon), finished backdrop (C03-11, duotone 360 x 200) |
| Motion role | State. One dot fills per elapsed minute; the end is silent by default. No flashing |
| Growth rule | Dots filled = elapsed minutes of the real block. An early end leaves the partial dots, not a dead object |
| Static form | Filled dots to the current minute, caption "18 minutes" |
| Reduced-motion form | The dot fills with no fade |
| Accessibility | Meaningful, `role="img"` with label "Elapsed time, 18 minutes", updated once a minute (not per second). The calm timer is text |
| Performance form | SVG, up to 150 circles (columns of 30, up to 5 columns), one class toggle per minute. No canvas, no loop |

#### 8.3.11 `proof` (Well Wisher, embossed light) , centrepiece C02-24

| Item | Specification |
|---|---|
| Art id | `art.proof.ring` |
| Placement | The ring plate of §4.4.6: a 288 x 256 ring (the top 40 % of the 680 px panel) at the top of the 320 px panel's index, the 11 rows scrolling in a bounded list beneath. Wins card header with relief type from C02-40 (labels not reproduced). Decision I4: the earlier art-side 288 x 288 circle is superseded |
| Mask and crop | Private build: C02-24 ring cropped and masked. Customer build: SVG ring with bars computed from the real statistics and two shadow layers |
| Derived visual system | Embossed data relief: raised bars with a 3:1 edge, recessed track. Stat card hierarchy from C02-15, C02-16 and C02-17 (layout only; backdrop blur is stripped by the build, so glass is not used) |
| Motion role | None; redraw on data change |
| Static form | Ring with one bar per statistic and a caption on every bar |
| Reduced-motion form | Identical |
| Accessibility | Meaningful; each bar has a text row with its value. Edge `--edge-ui` 3:1 |
| Performance form | SVG, at most 24 bars (target) |

### 8.4 Shell-level art slots

*Superseded in part by 20.4.7 (route sigil draw-in, boot, onboarding, empty states).*

| Slot | Art id | Source ids and treatment | Static and reduced-motion form |
|---|---|---|---|
| JARVIS boot loader | `art.shell.boot` | Frame with rivets as 4 px dots (C04-25), three plain rows from C01-14 | Rows appear as text; no progress bar unless real work reports a fraction |
| Route transitions | none | Section changes use the 200 ms fade of §10.4. The four per-pair sweeps of the first draft are deleted (a 160 ms sweep is not read as art and a Ctrl-number jump never shows it). The sweep ideas C04-52, C04-49, C03-20 and C04-126 feed the loader sweep (§7.5 #32, `art.shell.loader`) and the one-shot product-switch reveal (§10.5) | The fade; none under Calm |
| JARVIS first run | `art.shell.onb.jarvis` | One screen: scene C04-124 (private direct; customer: generated landscape), one sentence, Wake. C04-20 (reaching hands as ASCII) becomes the first-visit empty state of `memory.recall`, and C01-24 (duotone agate with the line "the app works without the board") the first-visit empty state of `console.hardware` | One screen, one action |
| Well Wisher first run | `art.shell.firstrun.ww` | No picker. C01-03 is a static duotone backdrop behind "Start a 10-minute block"; the block asks "what was it for?" once, after it ends, as an optional line. C04-109 (reaching-hands dither, public-domain subject, re-source for release) moves to the `pair` sheet and the `day.close` empty state | First run: one primary, no setup gate (§3.5) |
| 404 and fault | `art.shell.404`, `art.shell.fault` | 404 rebuilt as plain mono text with one link back (C01-09); FAULT scene from C04-47 with a flat triangle glyph and the reason in text | Static |
| Empty-state grain | `art.shell.grain` | Strip from C04-30 (600 x 40, halftone) at the base of empty states; dither tile library from C02-11 (8 densities at 32 x 32) | Static |
| Section sigils | `art.shell.sigil.*` | Glyph blocks from C01-18 as a 48 px sigil in empty states only (never a view-header watermark and never the rail icon, which stays a plain icon with a text label) | Static |
| Toast, error dialog, plates | `art.kit.*` | Notched frame (C02-14, 6 px notch), error banner (C04-07), chamfered plates for Settings and build (C02-25, C02-30, C02-22) | Static |
| PLANNED plate | `art.kit.planned` | Dashed blanking plate, shape not colour carries meaning (§6.6) | Static |
| Progress | `art.kit.progress` | Registration-mark bar (C04-35); the fill equals the real fraction, else no bar | Static fill |
| Token sources | `art.kit.tokens` | C02-41 (F25623), C02-42 (4D4D4D), C02-44 (171717), C02-48 (DEDEDE) are read for values only and never rendered; shadow recipes from C02-18, C02-21, C02-26 and C02-27 are checked against the 3:1 edge rule | None |

### 8.5 The derivative pipeline

*Superseded in part by 20.4.2 (ASCII budget 90 KB, ramps, cell tiers) and 20.4.1 (the tracer).*

#### 8.5.1 Layout and where outputs live

| Path | Contents | In git? |
|---|---|---|
| `tools/art/build_art.py` | The one CLI (to be written in the build phase) | yes |
| `tools/art/recipes/<art_id>.json` | One recipe per art id: `{art_id, track, source, steps[], params, seed}` | yes |
| `tools/art/own/` | Own-made sources: SVG, seeds, hand-typed text, licence file per file | yes (only customer-safe files) |
| `data/design-assets/source/<catalogue_id>.png` | Full-resolution crops from the four source collages, cut with the catalogue bboxes | no (`data/` is git-ignored) |
| `data/design-assets/private/` | Outputs derived from third-party pictures | no |
| `app/ui/src/art/generated/` | Outputs derived only from `own/` or public-domain files | yes |
| `app/ui/src/art/art-manifest.json` | Per art id: files, sha256, bytes, track, source, recipe hash | yes (manifest only; the private part lists ids and hashes, not pixels) |
| `data/notes/design-taste/2026-11-12-well-wisher-overhaul/derivatives/` | The existing prototype outputs and the deck copies | no |

The existing crops in `catalogue/crops/` are JPEG proofs (C02-02 is 568 x 900); `build_art.py` re-cuts from the four collage PNGs with `bbox` for full resolution. The prototype outputs in the derivatives folder (C04-12 and C04-21) are the naming model: `<id>-ascii.txt`, `<id>-ascii.png`, `<id>-bayer.png`, `<id>-atkinson.png`, `<id>-contour.png`, `<id>-duotone.png`, `<id>-duotone-signal.png`. Measured in that folder on 12 Nov: ASCII text 6,942 B (C04-12) and 11,870 B (C04-21); Atkinson 56,479 B and 13,638 B; Bayer 32,074 B and 30,740 B; contour 38,077 B and 35,047 B; duotone 1,020,806 B and 1,155,871 B. The duotone PNGs are 15 to 20 times over the budget below and must be re-encoded; the others are close.

#### 8.5.2 Recipe and the rule-based steps

Every step is a pure function of the pixels and the parameters. No model, no randomness except the seeded generators in `own/` (seed stored in the recipe). Libraries: PIL and numpy, both already installed in the venv (versions 12.2.0 and 2.4.4 at the time of writing). Contours use a small marching-squares function in numpy (about 60 lines), so no new dependency; if the owner grants scikit-image, `find_contours` replaces it.

| Step | Algorithm and parameters | Output and size target |
|---|---|---|
| `crop` | Crop by bbox, then resize with Lanczos to the target CSS size x devicePixelRatio 1.5 | PNG intermediate, not shipped |
| `tone` | Convert to Rec. 709 luma; stretch between the 2nd and 98th percentile; optional gamma 0.9 to 1.2 | 8-bit grey |
| `ascii` | Divide into cells of 7.2 x 16 px; mean luma per cell; ramp ` .:-=+*#%@` (10 levels, ASCII only so any mono font draws it); optional Sobel edge pass picks `/ \ \| _ -` where gradient magnitude exceeds a threshold of 0.35 (assumption); LF line endings, UTF-8 | `.txt`, W x (H + 1) bytes: 80 x 30 = 2,430 B; 60 x 14 = 854 B (computed). Target at most 4 KB each |
| `bayer` | Recursive 8x8 Bayer matrix M scaled to (M + 0.5) / 64; pixel on when luma > threshold; cell scale k = 1, 2 or 4 px | 1-bit indexed PNG with a 2-colour palette from tokens. Target at most 6 KB for 400 x 200 (assumption; the 12 Nov prototypes are 30 to 32 KB at larger sizes) |
| `atkinson` | Error diffusion: 1/8 of the error to six neighbours (x+1, x+2, and below x-1, x, x+1, and two below), 25 % of the error dropped; run offline only because it is sequential (Strand 2, finding 5) | Same format as `bayer`; used where Bayer's grid looks mechanical |
| `contour` | Gaussian blur sigma 1.5; 8 iso-levels at evenly spaced luma percentiles; marching squares; Ramer-Douglas-Peucker with epsilon 0.8 px; 1 px stroke with `vector-effect: non-scaling-stroke` | SVG, at most 12 KB (target) |
| `duotone` | Map luma through two stops (ground token to ink token) in linear light, quantise to 16 tones, encode lossy WebP q = 70 | At most 60 KB for 1286 x 500 (target), 20 KB for faces and plates |
| `terminal` | ASCII plus box-drawing frame and bracket tags, text only | `.txt`, at most 3 KB |
| `levels` | Render the same art at N growth levels from a fixed cell permutation (section 8.5.5) | N files; sum at most 40 KB per growing piece |

Duotone pairs (all values are tokens from §6.3; contrast stays with the text, not the picture):

| Pair name | Ground | Ink | Use |
|---|---|---|---|
| `bone-charcoal` | `#E8EAE9` | `#171717` | Light scenes (Memory, Day, Study) |
| `charcoal-bone` | `#171717` | `#E8EAE9` | Immersive scenes (Core, Senses, Console, Focus) |
| `ochre-charcoal` | `#171717` | `#B87A1A` (4.98:1 against `#171717`, computed with the WCAG formula; decision I14) | Day sun face only; accent `#F25623` appears only as the newest-ray fill |
| `signal` | `#171717` | `#5CE1FF` | Only where the art encodes a measured value |

#### 8.5.3 Determinism, checks and consumption

1. `build_art.py --check` rebuilds every output and fails when a sha256 differs from the manifest (determinism), when a file exceeds its byte target (budget), or when a recipe's track does not match the folder it writes into (a `private-only` recipe can only write to `data/design-assets/private/`).
2. A vitest asserts that every art id referenced in `src/` exists in the manifest and that `VITE_ART_TRACK=customer` resolves none to `private-only`.
3. A contrast script checks every text-over-art placement listed in the assignment JSON against the 4.5:1 target using the scrim values given there; it runs in CI next to the token contrast test.
4. In the app, art is loaded by art id from the manifest, lazily per section (`loading="lazy"`, `decoding="async"`, and `content-visibility: auto` on offscreen plates). Text files are fetched once and cached in memory.

#### 8.5.4 Canvas draw of text art (where live state needs it)

Only if a piece must change cell by cell, which no current piece needs (growth uses pre-rendered levels), a canvas draws from one glyph atlas: Geist Mono 12 px, the 10 ramp glyphs, 7.2 x 16 px cells, drawn with `drawImage` from the atlas. Dirty-rectangle redraw only. Budget (target): 2,400 cells (80 x 30) at most 0.5 ms per redraw, measured under F8 before any use.

#### 8.5.5 How "growing" art works: reveal by real use, never by time

1. **Input is a count from the data layer**, for example `blocksLoggedToday`, `markedMasteredNodes`, `coveredTopics`, `elapsedMinutes`. Stored-item counts never drive art. Time never enters a growth function: no `Date.now()` or clock read is allowed inside it (lint rule). The date is an input the data layer supplies (`today`), so a midnight reset is a change of input, not a clock read in the art function.
2. **Monotone step function.** Each piece has a table from count to level. Same count, same level, same picture, so there is no variable reward (D17).
3. **Fixed reveal order.** Which cell or ray appears next comes from a permutation stored in the recipe (`seed`), not from chance at runtime. A viewer sees the same picture as a screenshot taken yesterday with the same counts.
4. **Pre-rendered levels.** Growth is a file swap or an SVG class toggle, not a loop.
5. **One short reveal, optional.** A level change plays one reveal (JARVIS 80 to 160 ms, Well Wisher 160 to 280 ms, §1.2) and then rests. Under Calm or the governor's `low` or `none` the reveal is instant.
6. **What follows what.** Each piece is a pure function of the **current** count: it may fall if the student deletes a log entry, un-marks a topic or un-marks a mastered node, and it never changes with time. There is no high-water mark, because a stored maximum would show progress the data no longer supports. Only the Day sun (and the Week Strip) reset, neutrally, when the data layer's date input changes. The Study island, Tree trunk and Career skyline do not reset. Every caption says what the piece follows.
7. **Caption.** Every growing piece carries a caption stating what it encodes ("each ray is one block logged today").
8. **Not for simulated data.** A growing piece built from simulated input shows the amber SIMULATED stamp or is not drawn.

| Piece | Count in | Level function | Max |
|---|---|---|---|
| `art.day.sun` | blocks logged today | rays = min(n, 12); beyond that "+n" | 12 rays |
| `art.study.island` | covered / total topics per unit | height = ceil(4 x ratio) | 4 |
| `art.tree.trunk` | nodes marked mastered / total nodes | height = ratio x column | 1 column |
| `art.career.skyline` | done items per stage | lit or unlit | 1 per tower |
| `art.focus.dots` | elapsed minutes of the real block | one dot per minute | 30 per column, up to 5 columns (150 minutes) |
| `art.proof.ring` | measured statistics | bar height = value | one bar per statistic |

### 8.6 The personal-use rule (rewritten 13 Nov 2026, D-V2-1; it replaces the two-track rights policy)

*Superseded in part by 20.2 (D-V2-1) and 20.4: the customer-release track is no longer a gate for the build.*

#### 8.6.1 The rule and what it rests on

- **The private build is the product.** The owner decided on 13 Nov 2026 that the application is for personal use only and that third-party pictures are fine; because it is personal it is held to a higher visual bar than industry standard, not a lower one. Third-party pictures and any derivative of them (crops, masks, composites, ASCII, halftone, contour, duotone, terminal frames, redraws, generated images from his own account) **may be placed directly**, at full strength, wherever the design calls for them.
- **They never enter the public repository.** The repository is public, so publishing a picture there is redistribution, which the owner's personal-use approval does not cover. Pictures and derivatives live under `data/` (git-ignored) and in the private art folder; they reach the application through the private track of the art pipeline (`VITE_ART_TRACK=private`, which is now the default for the owner's build). Tracked files hold recipes, tokens and manifest rows (ids, hashes, tracks) and no pixels.
- **Named only by catalogue id.** Every tracked file, commit message, test name, research note and gallery description refers to a picture by its catalogue id (C01-nn to C04-nn, or `G-nn` for a generated image) and never reproduces it.
- **Forbidden from a build that leaves the machine:** screenshots, video, README images, store images, a deck outside `data/notes/`, and any `dist` folder that is copied or published. `tools/art/check_no_private_in_dist.py` still fails if a private-track hash appears in any `dist` that leaves the machine.
- **Third-party status is unchanged by the rule.** The catalogue's rights notes (74 of 186 "do not ship as-is", at least 11 that look AI-generated) still describe the pictures. The rule changes what the build may do with them, not what they are. Nothing here is legal advice; the F14 review concerns public copy and any future release.

#### 8.6.2 How the pictures are used and produced

| Question | Rule |
|---|---|
| Where files live | `data/design-assets/private/` (never committed); manifest rows in `tools/art/manifest.d/<area>.json` (ids, hashes, tracks) |
| Switch | `VITE_ART_TRACK=private` is the default for the owner's build; `customer` remains selectable for the one-line check that the build still runs without the private folder |
| Direct placement | A recipe may use the picture as is, cropped, masked or composited, then apply any treatment; the recipe is keyed by art id and records `private_source` |
| An image generator | Allowed with the owner's account and consent (Q-V2-14); outputs get ids `G-nn` in the private manifest and are treated like any third-party picture |
| Gate | `build_art.py --check` (determinism, byte budgets), the no-private-in-dist check, and a tracked-file scan for private image bytes |
| Deck | The programme deck is a private file under `data/notes/design-taste/`; direct images are allowed there; it is never published |

#### 8.6.3 Customer-release track (kept only as a note for a future separation)

If the product is ever sold or shared, a separate release track will need: public-domain sources re-sourced from the original with the licence recorded per file, the project's own rule-generated art, or commissioned or licensed work with written derivative and redistribution rights; a redraw rule (authored from the idea, no tracing, a silhouette check, a human review, and a block on resemblance to a known artist's work regardless of score); and a quality gate (the former Q04). Nothing in the current build depends on this track; Q04 is dropped from the build order and reduced to a note, and F10, X3 and F14 stay as open items for that day. The replacement plan below and the class table that follows are kept unchanged as the starting point.

#### 8.6.4 Replacement plan for each centrepiece (note for a future separation)

| Art id | Private source | Customer replacement | Effort (assumption) |
|---|---|---|---|
| `art.core.hill` | C02-02, C02-06 | Seeded 3-octave value-noise ridgelines rendered as points; zero source | 1 day, no commission |
| `art.room.faceplate` | C01-23 | SVG faceplate drawn from the real 8-channel layout, dial ticks by formula | 1 day |
| `art.senses.spindle` | C04-06 | Parametric spindle (surface of revolution plus 3 orbits) | 1 day |
| `art.memory.branch` | C04-119 | L-system (22 degrees, 5 iterations) as characters | 1 day |
| `art.console.frame` | C04-10 | Hand-typed ASCII skyline and the frame grammar (a frame grammar is an idea, not a work: an assumption until the F14 legal review) | half a day |
| `art.day.sun` | C04-37 | Geometric sun plus paper grain by default; an optional commissioned painting as an upgrade | 1 day, or a commission |
| `art.study.island` | C04-23 | Contour terrain from fractal noise with real unit heights | 1 day |
| `art.tree.trunk` | C04-44 | L-system trunk with brush texture; optional commission | 1 day, or a commission |
| `art.career.skyline` | C04-116 | Procedural towers; optional commission | 1 day, or a commission |
| `art.focus.dots` | C03-08 | SVG circles (one per minute, columns of 30) plus generated paper grain | half a day |
| `art.proof.ring` | C02-24 | SVG ring computed from the statistics | half a day |
| Onboarding scene | C04-124 | Generated landscape from noise | 1 day |
| Public-domain candidates | C04-43 (a night-sky painting in a public-domain style), C04-32 (Atlas engraving), C04-109 (hands) | Name the original work and its museum record in the manifest row, re-source it from the museum's open-access collection, record the licence; the supplied file stays out of any customer build | 1 hour each |

Estimated customer track: about 8 to 10 days of one person for all centrepieces and shell slots (assumption), no money if no commission.

**Visual quality bar per centrepiece (customer track).** A procedural swap is accepted only if it keeps what the reviewed look depends on. The customer render of each painterly piece is compared with the private render in gate **Q04** (a side-by-side held with the owner, pass line: the owner cannot name a lost trait); until it passes, the customer build is described as plainer than the reviewed one (§0.2 item 8).

| Piece | Palette | Silhouette | Texture |
|---|---|---|---|
| `art.day.sun` | ochre `#B87A1A` on charcoal, accent `#F25623` only on the newest ray | round disc, 12 flame rays at 30 degree steps | visible paper grain, brush-edge rays |
| `art.tree.trunk` | moss ink `#46603A` to dusk | a low-angle trunk filling the column, branches curving off the top | brush-stroke bark, swirled sky bands |
| `art.career.skyline` | brick-orange towers `#9A4527` | tall uneven towers over a low plain of tents | painted flat fills with a few windows |
| `art.study.island` | teal `#2B6468` on cream | stacked isometric layers, tiny trees | thin contour lines, one per layer |
| `art.core.hill`, `art.senses.spindle`, `art.memory.branch` | bone on charcoal | mound of points; wireframe spindle with orbits; branch dissolving into letters | stipple density, hairline strokes |

**Commission default.** For `art.day.sun`, `art.tree.trunk` and `art.career.skyline` the default customer-track plan is a commissioned or licensed painting with derivative and redistribution rights in writing, not the procedural swap (the procedural swap is the fallback). Budget and deadline are an owner decision (question X3 in §17.2); until it is answered the figure is unknown, not zero. If a commission is wanted for sun, trunk and skyline, brief it with the rules in §8.1 and get derivative and redistribution rights in writing; keep the contract in the private notes.

#### 8.6.5 What happens to each class of picture (note for a future separation)

| Class | Count | Rule |
|---|---|---|
| `private-only` | 14 | Used directly or cropped in the private build; replaced at customer release (table above) |
| Candidates for customer use after redraw (the script's label "customer-safe after redraw"; a classification, not a legal finding) | 119 | Per-file human review and a licence line are required before any customer build (assumption until F14). The art id keeps its recipe; the source is swapped to own-made, or the component is rebuilt from the idea (most are component references, so there is nothing to swap) |
| `customer-safe (public domain)` | 3 | Re-source from the public-domain original |
| `reference-only` | 50 | Never rendered in the product. Tokens read from swatches; refused imagery; technique samples. They appear in the private deck and the manifest only |

### 8.7 The asset assignment

File: `asset-assignments.json` (a scratch file produced with this specification; 186 objects, one per catalogue id; a script checked that no id is missing and none is duplicated). Each object has `id, source, section, screen_or_state, use, crop_note, purpose, alt_text, contrast_treatment, meaning, track, deck_use`. Copy it into the private folder `data/notes/design-taste/2026-11-12-well-wisher-overhaul/` (git-ignored) when the manifest is built; the manifest is generated from it.

**Assignment counts per section** (computed by the script):

| Section value | Pictures | What they are |
|---|---|---|
| `core` | 13 | Hill (2), ring, dial, palette, sound player, radio scale, three ASCII glyph and empty states, asleep scene, wake loader, wake transition |
| `room` | 13 | Faceplate, key, icons, material, toggles, scenes, empty state, phone tile reference, seam texture, modes dial, Away PLANNED art, and one recorded refusal (lens) |
| `senses` | 14 | Spindle, link diagram, ring frame, backdrop, floor grid, calibration rings, step art, channel matrix, zones, sigil frame, line weave, WAITING field, parameter strip |
| `memory` | 12 | Branch, three empty-state variants, avatar placeholder, export marker, archive box, export progress strip, belief web and background, stored-count glyph, printable header |
| `console` | 15 | Terminal frame, CRT frame, brackets, boards panel, capsule label, connections layout, roster frames and layout, LED readout, GPU gauge, spec sheet, Agents PLANNED art, nothing connected, link established |
| `day` | 12 | Sun, clock chip, numerals (2), widget density, calendar, close backdrop, rest-day art, body empty state, first-run plan, vertical label, wheel |
| `study` | 9 | Island, exam wheel, isometric blocks, day ruler, subject patterns, icons, grain, Coach PLANNED art, searching state |
| `tree` | 4 | Trunk, node fills, mastered glow, first-mastery bird |
| `career` | 8 | Skyline, two plates, ladder header, no-stages state, keypad, route arcs (reference), serif test (reference) |
| `focus` | 5 | Dot column, rest hill, start ring, paused marker, finished backdrop |
| `proof` | 5 | Ring, Wins header, three stat-card references |
| `shell` | 32 | Boot loader, four route transitions, three onboarding steps (JARVIS) and one (Well Wisher) plus first-run picker, 404, FAULT, grain, dither tiles, sigils, toast and error frames, progress bar, kit and token references, four token swatches |
| `settings` | 4 | Serial plate, build plate, sticker strips, anatomy doc format |
| `phone` | 4 | Today tab (2), Block lock-screen state, More tab chamfers |
| `deck` | 36 | Refused directions (24 recorded refusals; the 25th, the lens, sits in `room`), technique samples (halftone, contour), mood boards (type, sky, atmosphere, glass, colour trace): 24 + 12 = 36 |
| **Total** | **186** | |

Computed check: 13 + 13 + 14 + 12 + 15 = 67; 12 + 9 + 4 + 8 + 5 + 5 = 43; 32 + 4 + 4 + 36 = 76; 67 + 43 + 76 = 186.

**By use:** component reference 111, derivative ASCII 18, derivative contour 18, derivative halftone 12, composite 11, derivative duotone 8, derivative terminal 3, direct 3, crop 2. **By meaning:** decorative 160, meaningful 26. **By track:** candidates for customer use after redraw 119 (a script label, see §8.6.4), reference-only 50, private-only 14, public-domain candidates 3. The counts are produced by `tools/art/count_assets.py` over the JSON and printed in Appendix C; the text of this section is not hand-counted. All 186 have a deck use.

**Honest reading of the counts.**
- 111 of 186 are "component reference": the picture informs a rebuilt component or a token; no pixel of it ships. Each must name the single trait it contributes (its `purpose` field, listed in Appendix C); 26 are marked meaningful and need individual contrast and alt text (produced when B05b builds the manifest from the JSON, see the partial rejection in §16.6); the other 160 share three contrast strings and 27 alt strings by design (decorative art has `alt=""`). That follows the owner's rule to recreate components rather than paste posters behind generic cards.
- 25 pictures in all are recorded as refusals, 24 in the deck section and one (the lens) in `room` (weapons, skulls, body anatomy, real-person likenesses, religious statuary of unknown source, fake OS error screens, a third-party logotype, a quoted copyrighted work, pressure-tone posters, commercial manga panels, published-book pages, the eye and the screaming figure). Their use is the auditable exclusion itself. The remaining 12 deck-only pictures are mood boards and technique samples; they are labelled "reference", not "use". In the deck the 24 deck-section refusals appear on two slides (the principles, and one tile wall); the full list lives in the manifest.
- Only 14 pictures appear as the original's own pixels in the private build (11 composites, 2 crops, 1 direct scene), plus 2 public-domain-style direct uses that are re-sourced. The product leans on derivatives and rebuilds, which is what makes the customer track feasible.
- Distribution is uneven by design. Sections with a strong single centrepiece (Tree 4, Focus 5, Proof 5) need few pictures; the shell, Console, Senses, Core and Room take more because they have loaders, states and components.

**Alt-text strategy** (from the JSON): meaningful art gets a template with live numbers, filled from the same data as the caption (for example "Sun with rays. 3 blocks logged today."). Decorative art gets `alt=""` and `aria-hidden`. ASCII art in a `<pre>` is `aria-hidden="true"` with a short hidden sibling, because a screen reader would read punctuation. Text the student needs is never inside art.

### 8.8 Cross-cutting accessibility and performance for art

| Topic | Rule |
|---|---|
| Contrast | Text never sits on art. Where it must, a `#171717` scrim at 72 % opacity and a checked pair (target at least 4.5:1). Marks that carry data use `--edge-ui` or a state token at 3:1 or better (WCAG 1.4.11) |
| Forced colours | Decorative art is hidden in `forced-colors: active`. Meaningful art falls back to its caption and the data table, which are real text. SVG uses `currentColor` so it follows `CanvasText`. Canvas draws in `CanvasText` on `Canvas`. No art uses box-shadow, text-shadow or gradients as its only form (§6.1; Strand 6) |
| Reduced motion | Every reveal is instant under Calm or `prefers-reduced-motion`; the picture is unchanged. The hill steps at most 4 times a second |
| Pause, Stop, Hide | The hill and, while motion energy is non-zero, the Senses orbits move for more than 5 s, so each has a Pause control (WCAG 2.2.2). No other art loops longer than 5 s; a later piece that loops ships with a Hide control |
| Idle cost | No art animates in an idle window; the hill stops on silence, blur and hidden. Target: 0 % extra CPU and GPU with the app idle, to be measured (F8) |
| Payload | Target at most 600 KB gzip of art per product (assumption), loaded per section on first open. Prototype duotone PNGs at about 1 MB are re-encoded as WebP at most 60 KB |
| Copy and select | ASCII art is `user-select: none` and excluded from copy |
| Print | Printable export uses the paper-edge header (C04-133) only; no other art prints |
| Screenshot safety | SIMULATED stamps are drawn inside the art frame, so a cropped screenshot keeps them |

---

## 9 JARVIS voice visualiser

### 9.1 Where we start (S0 section 4, verified in code on 2026-11-12)

| Fact | Detail |
|---|---|
| Input level | One number, `level = norm(block) * 10`, emitted from `core/jarvis.py` (record_vad callback, on_block) at most every 0.08 s, so at most 12.5 Hz, only in the listening and follow-up loops. Republished by `app/jarvis_app/core.py` as an ephemeral bus event `core/level`; `lib/store.ts` copies `level` and `threshold` into React state (a re-render at up to 12.5 Hz). |
| Not used | `speech_prob`, `vad_threshold`, `speaking` exist in the endpoint-path event; the store ignores them. The scale is unbounded and has no dB meaning. |
| Output level | None. The decoded PCM exists in numpy at `core/playback.py` `play_pipe` (`speaker.write(pcm * gain, rate)`, about 24 ms frames); the bus carries only `state: speaking` and `speech_done`. The old Reactor "ripple while speaking" is driven by the flag, not by amplitude. |
| Window-side audio | The window never opens the microphone. Two real `HTMLAudioElement`s exist (voice preview blob, media player), both same-origin blob URLs, so a Web Audio `AnalyserNode` can read them (unverified in WebView2). The phone page records with `getUserMedia` and plays replies with `new Audio`. |
| Visual today | `components/Reactor.tsx`: Canvas 2D, 96 outer ticks lit by the mic level, idle breathing, DPR capped at 2, stops drawing when offline and idle. |

Decision D23 (core) stands: the hill is driven only by a real signal. A canned shape is decoration, not a reading. This section defines the new signals, the picture, the exact mapping, and the tests that make "animates without data" impossible.

### 9.2 The new real signals

Two channels, one frame format, one band map. Both are computed in Python, next to the PCM, and sent over the existing path (child stdout JSON line, `appio.emit`, republished by `core.py` as an ephemeral bus event, `/ws/events`). Ephemeral events are not logged (as `level` is not today).

**Frame format (both channels).**

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"level"` (input, existing name kept) or `"out_level"` (new) | channel |
| `t` | float, epoch seconds (already added by `emit`) | wall time at which the block was captured (input) or written to the output device (output). Same machine, same clock as the UI, so transport delay is computed, not guessed (9.8) |
| `seq` | int, +1 per frame per channel | lets the UI count dropped frames |
| `sr` | int | sample rate of the analysed audio (assumption: 16 kHz mic, 24 kHz TTS; read from the stream, never hard-coded) |
| `rms_db` | float, dB relative to a full-scale sine ("dBFS(sine)": a sine of peak 0.1 reads -20.0) | broadband level of the last analysis window, as played (output: after `pipe.gain`, before the Windows volume mixer, which Python cannot see; stated in the legend) |
| `peak_db` | float | sample peak in the window, same reference |
| `bands` | 24 ints, 0 to 255 | band level, linear in dB: `round(255 * clamp((dB + 60) / 60, 0, 1))` for output, `clamp((dB + 70) / 60, 0, 1)` for input (assumption: the mic floor is higher; tune on the real device and record in the research file) |
| `lat_ms` | float, output only | device latency reported by the output stream (assumption: 20 to 100 ms; measured value, not a constant) |
| `thr_db`, `speech_prob`, `speaking` | input only | the silence threshold converted to the same dB scale, and the VAD outputs the endpoint path already has |
| `final` | bool | true on the last frame of a stream (pipe finished, stopped or failed); the UI drops to the floor immediately |

The existing `level` field stays in the input event unchanged (back-compat for the System page and the tests); the new fields are added beside it.

**Rate.** Both channels at 20 Hz (one frame per 50 ms) while a stream is open; none when nothing is open (target). Input moves from at most 12.5 Hz to 20 Hz by lowering the emit gap from 0.08 s to 0.05 s. Size: about 190 bytes per event (24 values at about 4 characters plus about 90 bytes of fields), so about 3.8 KB/s per channel (computed). JSON parse and bus cost at that size are negligible; the UI must not put them in React state (9.3).

**Silence is data.** While the microphone stream is open (listening or follow-up) and while an output pipe is open, frames keep flowing at 20 Hz even when the level is at the floor. That is what lets the UI tell "quiet room" (frames, all zeros, LIVE) from "no signal" (no frames at all). Between two sentences no output pipe is open; the UI shows that as "between sentences", not as silence (9.6).

**Band map (identical in Python and TypeScript, golden-tested).** 24 bands, log-spaced from 100 Hz to 8 kHz: edge `f_i = 100 * r^i`, `r = 80^(1/24) = 1.2003` (computed), so `f_0 = 100`, `f_8 = 431`, `f_12 = 894`, `f_16 = 1,857`, `f_20 = 3,854`, `f_23 = 6,665`, `f_24 = 8,000` Hz. Speech lives here and band 0 to 23 spans about 6.3 octaves. Above the Nyquist of the stream a band reports 0.
Analysis: Hann window, N = 2048 at 24 kHz (85 ms, bin 11.7 Hz) for output and N = 1024 at 16 kHz (64 ms, bin 15.6 Hz) for input, hop 50 ms (computed from the rates above; the code derives N from `sr` so the window stays about 64 to 85 ms). Band level = sum of power over the bins whose centre lies in the band (a band with no bin takes the nearest bin, so none is structurally empty; lowest band is 1.7 bins wide at 24 kHz), normalised so a full-scale sine reads 0 dB: `MS_band = 2 * sum_k |X_k|^2 / (N * sum_n w_n^2)`, `dB = 10 * log10(2 * MS_band)`. Summing power, not averaging, keeps a tone from being diluted across a wide band. A sine at peak 0.1 and **1,700 Hz** must read -20.0 dB broadband and -20 dB plus or minus 1.5 dB (window scalloping) in band 15 (1,546 to 1,857 Hz); band 14 (1,288 to 1,546 Hz) is wrong. The band of any frequency is `floor(24 * ln(f / 100) / ln(80))` (computed): a 1 kHz sine falls in band 12 (894 to 1,074 Hz), so the first draft's pairing of 1 kHz with band 15 was an arithmetic error and a correct implementation would have failed its own test. Tests in 9.13 (P-1, P-7).

**No automatic gain.** The visual maps absolute dB. Normalising per utterance would make a whisper and a shout look the same, which is not a reading. A display sensitivity setting (Settings, "Hill sensitivity": Normal, High = +12 dB shift of the mapping window) is allowed, is stated in the legend ("display +12 dB"), and is off by default.

**Where it is computed (proposed files; Python is outside the UI file ownership, see F7).**

| File | Change |
|---|---|
| `core/levels.py` (new, pure numpy, no I/O) | `band_edges(n_bands, f_lo, f_hi)`, `analyse(window, sr) -> (rms_db, peak_db, bands)`, `class Emitter` (ring buffer of the last N samples, 50 ms rate limiter on a monotonic clock, `final` handling) |
| `core/playback.py` | in `play_pipe`, after `speaker.write(pcm * gain, rate)`, `emitter.push(pcm * gain, rate)`; `emitter.finish()` in the STOPPED, PLAYED and FAILED exits and in `_play_file` (Kokoro and pygame path: decode once to numpy for analysis only if the file path can be read without delaying playback; otherwise that path reports no signal, which is honest) |
| `core/jarvis.py` | the two level call sites (record_vad callback and endpoint `on_block`) call the same `Emitter` for the mic and add `thr_db`, `speech_prob`, `speaking` |
| `app/jarvis_app/core.py` | republish `out_level` the way `level` is republished (ephemeral); no other change |
| cost | numpy `rfft` on 2048 floats is tens of microseconds; at 20 Hz under 1 ms per second of CPU (assumption, measured in 9.13 test P-3). The write loop must never wait on the emitter: the emitter drops a frame rather than block (counted in `seq` gaps) |

**Window-played audio (secondary source, `src: "window"`).** Voice preview and the media player route through `createMediaElementSource(el) -> AnalyserNode (fftSize 2048, smoothingTimeConstant 0) -> destination`. The graph must be built before `play()` and cannot be re-routed, so `lib/media.ts` and `lib/settings.ts` create it at element creation. A TypeScript `bandsFromAnalyser()` applies the same band map and the same dB window, with a golden test against Python vectors. Unverified in WebView2: a `Playwright` test cannot prove it, so it is on the manual WebView2 checklist (14.6). If it fails, those two sources report no signal.

**Phone.** `phone_page/app.js` already owns real audio elements; it gets a small analyser of its own for the Talk tab (ring only, 24 bars, no hill). It never shows the desktop's output level, because that frame never reaches the phone socket (a PLANNED bridge, not built).

### 9.3 Frontend signal channel and latency path

- `app/ui/src/jarvis/core/voice/voiceSignal.ts`: a plain mutable singleton, not React state and not the zustand store. `ingest(frame)` writes into a fixed ring buffer (64 frames per channel, about 3.2 s at 20 Hz); `latest(channel)`, `history(channel, spacingMs, count)` and `ageMs(channel)` read it. React subscribes only to the derived **voice state** (9.6), which changes a few times per utterance, not 20 times per second. The existing `micLevel` store field stays for the System page and is fed from the same ingest at 4 Hz.
- The canvas reads the ring from its own tick on the shared frame bus (10.6). No ingest means no tick (9.11).
- **Smoothing is applied once, on ingest, to real values:** per band, one-pole filter `s = s + (v - s) * a`, attack time constant 40 ms and release 160 ms. At 20 Hz (dt = 50 ms) that is `a_up = 1 - exp(-50/40) = 0.713` and `a_down = 1 - exp(-50/160) = 0.268` (computed). A constant input therefore produces a constant picture: no idle jitter is possible (tested).
- **Staleness.** A frame older than 400 ms (assumption: 8 missed frames) marks the channel stale; the voice state moves to NO SIGNAL (9.6), the hill is replaced by the placeholder (9.7), nothing decays to a fake silence.
- **Drops.** A `seq` gap increments `dropped`; the Console health view prints "voice frames: rate, dropped, age p95" (14.1). Gaps never draw interpolated data beyond the one-frame linear interpolation in 9.8.

### 9.4 The visual: hill plus ring

Source: C02-02 (black field, mountain of white point-cloud particles with small coordinate readouts) for the hill; C02-07 (white circular instrument with ring bezels) and C01-06 (dial) for the ring. Re-drawn, not pasted. The scene is the immersive charcoal scene of §6.1 in either theme.

**Stage geometry at 1366x768** (computed from §3.3: canvas 1286 x 704 inside gutters).

| Element | Size and position | Note |
|---|---|---|
| Voice stage | 720 x 360 CSS px canvas, the Hill stage region at the top-left of the left column of `core.talk` (§4.3.1; decision I4 supersedes the earlier centred placement) | the cap in §8.1 |
| Hill | 640 px wide, baseline at y = 300, front-layer maximum height 190 px (peak at y = 110) | drawn in front |
| Ring | centre (360, 176), bezel radius 120 px, bar base radius 128 px, bar length 4 to 36 px, 96 bars, 2 px wide | behind the hill; bars below the hill baseline at 50 % alpha |
| Ring bezel (static) | 6 px clay ring at radius 117 to 123, a real 1 px `--edge-ui` edge | a DOM element behind the canvas, never redrawn (raised look; §6.1) |
| Level bar | 240 x 8 px recessed well in row 2 of the 720 x 88 state strip of §4.3.1 directly under the stage (decision I12, revised: row 1 holds the state word, chip, latency, lamp and source tag; row 2 holds the level bar, the one-line legend and the single Pause; to be confirmed in P02), scale ticks at -60, -40, -20, 0 dB (Tier 1 and up only: at Tier 0 there are no dB ticks and no dB number, §9.9), a 2 px threshold tick, peak-hold tick | the reduced-motion form (9.10) and the accessible text twin |
| Source tag | mono 12 px, always visible beside the lamp (not only in the legend): `MIC`, `SPEAKER, pre-volume` or `WINDOW` | tells which channel the picture shows; the output level is as played by JARVIS before the system volume, so with Windows muted or a Bluetooth lag the hill can show speech that is inaudible, and the tag says so |
| Lamp and legend | one lamp (§6.6) plus one mono line under the level bar | measured: "MIC -23 dB, 20 Hz, LIVE"; not measured: the legend in 9.7 |
| Pause button | one 44 px toggle in row 2 of the state strip (not also in a stage header), `aria-pressed` | WCAG 2.2.2 (S6 finding 9): the hill moves for more than 5 s, so it needs Pause; motion of 5 s or less (the thinking marker, any placeholder breath) needs no control (§10.6) |

Below 900 CSS px the stage is `width: 100%`, aspect 2:1, minimum 280 x 140, point count scaled (9.11). The ring and the hill are one canvas and one draw tick; the bezel and the level bar are DOM.

**Which channel is drawn.** The **hill** shows the active channel: the output while the voice state is SPEAKING, the input otherwise. The **ring** shows the same active channel as an instant spectrum (current frame only, no history), so hill and ring are two projections of one reading: history versus now. The source tag is always visible. This satisfies "the voice works the same way for input and output" with one picture, and never draws two different claims at once. During barge-in (both channels fresh within 150 ms) the output wins and the tag says `SPEAKER`.

### 9.5 Signal to geometry, exactly

All values are display-only transforms of real frames; none invents energy.

**Hill (Tier 1 data: bands).**

- Points: 96 columns x 8 depth layers x 4 stipples = **3,072** points at the `high` governor level (inside the 3 to 6k of the clay brief); 64 x 5 x 4 = **1,280** at `low`.
- Column `c` (0 to 95) has `x_c = (c - 47.5) / 47.5` in [-1, 1]. Band position `p = |x_c| * 23` (low frequencies at the centre, 8 kHz at the edges), left and right mirrored. The mirror is a presentation choice, stated in the legend ("24 bands, low at centre, mirrored"). Per-column value `v = lerp(band[floor(p)], band[ceil(p)], frac(p)) / 255`. There is deliberately **no taper**: the speech spectrum itself falls away from the low end, so the silhouette is a hill without us shaping it, and a flat spectrum looks flat.
- Layer `j` (0 = now) shows the smoothed frame closest to `now - 100 ms * j` (so 0.7 s of real history; frames are 50 ms apart, every second frame is used).
- Height `H(c, j) = 190 px * v(c, j)`.
- Stipple `s` in {0, 1, 2, 3} has a fixed fraction `f_s = [0.40, 0.65, 0.85, 1.00]` plus a deterministic jitter (seeded table, generated once with `mulberry32(0x5EED)`: Y plus or minus 0.04, X plus or minus 0.8 px). Point `y = y_base(j) - f_s * H(c, j) * s_j`, `x = 360 + x_c * 320 * s_j + jitterX`.
- Perspective of layer `j`: `y_base(j) = 300 - 9 j`, `s_j = 1 - 0.045 j` (0.685 at j = 7). Values are targets to tune in the prototype.
- Drawing: points are 2 px squares at layers 0 to 3, 1.5 px beyond; **one path per alpha bucket** (8 buckets, alpha `[1.00, 0.80, 0.62, 0.46, 0.34, 0.26, 0.20, 0.15]` on `--scene-ink`), so 8 fills per frame, not 3,072 draw calls. Layer 0 (now) is drawn in `--state-measured` (cyan) so the measured "now" row is the one coloured thing; all history is neutral ink. No per-point shadow, gradient or `drawImage`.
- Faint history is supplementary: the reading is the front layer plus the numeric level bar; those meet 3:1 (`--ink-1` on charcoal 14.8:1, cyan on `#171717` 11.67:1, §6.3). Under `prefers-contrast: more` the alpha floor is 0.5 and points are 2.5 px.
- No flashing: every point has a constant brightness; only positions change, and the area is a few thousand 2 px squares. Nothing alternates full-field luminance, so the 3 flashes per second rule (WCAG 2.3.1) cannot be reached (checked by test V-12).

**Hill (Tier 0: level only, what exists today).** One scalar at at most 12.5 Hz cannot produce a spectrum, so the hill must not pretend to. Tier 0 draws an **envelope**: x is time, not frequency. Column `c` shows the level `|x_c| * 2.4 s` ago (centre = now, edges = 2.4 s ago, 30 samples at 12.5 Hz, linearly interpolated), one layer, 4 stipples = **384** points; legend "level over the last 2.4 s, no spectrum". The ring at Tier 0 draws 96 bars of equal length proportional to the level ("level ring"). Tier 0 is the first release if F7 is unanswered (F7 default); it ships with the existing event and needs no Python change.

**Ring.** Bar `k` (0 to 95), angle `-90 deg + 3.75 deg * k` (k = 0 at the top, clockwise), mirrored index `m = min(k, 96 - k)` (0 to 48), band position `p = (m / 48) * 23`, length `ell = 4 + 32 * v(p)` px with the same normalisation and smoothing as the hill's layer 0. Two paths (above and below the hill baseline) are stroked once each. Bars never change colour with level; colour means state only (§6.3).

**Level bar.** Fill = `clamp((rms_db + 60) / 60, 0, 1)` for output, `clamp((rms_db + 70) / 60, 0, 1)` for input (same windows as the bands), peak-hold tick held 800 ms then falling 40 dB/s (assumption), threshold tick from `thr_db`. The number "-23 dB" next to it is text.

**Placeholder and states** are in 9.6 and 9.7.

### 9.6 States

One pure function, `voiceState(core, signals, now)`, in `voiceState.ts`, table-tested. Precedence from the top; the first rule that matches wins.

| # | State | Trigger | Hill | Ring | Level bar | Lamp (§6.6) and label | Motion |
|---|---|---|---|---|---|---|---|
| 1 | **error** | core `last_error` set, output or input stream failed (`FAILED`), or the voice process died | flat dotted baseline, hollow squares, no history | one red (`--state-fault`) 60 deg bezel arc, bars hollow at minimum length, a triangle glyph in the centre | empty, with the reason text | FAULT plus the reason ("output device failed"), links to `console.health` | none; one 160 ms opacity fade in |
| 2 | **muted** | text-only mode (`--text`), or an explicit mute (the mute switch is PLANNED until the core reports it; until then only text-only maps here) | flat baseline in the **hollow placeholder style** (§9.7), label "mic off" | bars drawn dashed (every second bar), static, source tag `MIC OFF` | empty, struck through | WAITING half disc, "MIC OFF" (deliberate, not a fault) | none |
| 3 | **no signal** | the core says it should be listening or speaking and the active channel has no frame for 400 ms (9.3), or JARVIS says `speaking` but no `out_level` arrived by 1.0 s after the state change (first audio has latency), or Tier 0 output (no output level exists) | **placeholder** (9.7): hollow squares, fixed rest silhouette, legend | **placeholder**: hollow bars at minimum length, no spectrum | empty | WAITING plus "NO SIGNAL: shape is a placeholder, not a reading" | breath for at most 5 s (9.7), then static |
| 4 | **hearing speech** | input fresh and `speech_prob >= vad_threshold` (or `speaking`); if the core gives no VAD, `rms_db > thr_db` for 2 frames, and the label then says "LEVEL ABOVE THRESHOLD", never "speech" | live (9.5), layer 0 cyan | live, plus a 30 deg `--state-measured` bezel arc at the top while the VAD says speech | live, threshold tick | LIVE disc, "MIC, HEARING SPEECH" | data-driven only |
| 5 | **speaking** | core state `speaking` and `out_level` fresh | live from the output channel | live (output bands), source tag `SPEAKER` | live | LIVE, "SPEAKER" | data-driven only |
| 6 | **thinking** | core state `thinking` | flat dotted baseline in the **hollow placeholder style** (no fresh frame exists, so nothing solid is drawn) | static hollow minimum bars plus the labelled "THINKING n s" marker: a single 3-bar marker orbiting the bezel once per 2.4 s for at most 5 s, then fixed at the top; it encodes "working", never a level; no placeholder breath | empty | WAITING half disc, "THINKING 3.2 s" (text elapsed time, updated each second; stage timing already exists in `timing` events) | the marker only (5 s or less, so no control is required; Pause stops it anyway) |
| 7 | **listening** | core state `listening` or `followup`, input fresh, no speech | live, usually near the floor in a quiet room | live | live | LIVE, "MIC, LISTENING" | data-driven only |
| 8 | **idle** | core running, not listening or speaking (between states), or core off | flat dotted baseline in the **hollow placeholder style**, no motion | static hollow minimum bars | empty | core off: WAITING "JARVIS IS OFF"; running and idle: WAITING "IDLE" | none; zero rAF callbacks |

Notes. A quiet room while listening is LIVE with all bars at the floor, not NO SIGNAL (frames are arriving; the picture is a true flat line). **Style rule (review of 2026-11-12):** in every state without a fresh frame (muted, thinking, idle, error, no signal) the hollow placeholder style of §9.7 is drawn; solid points appear only when a frame younger than 400 ms exists. A flat line of solid points would read as a measured floor, so it is never drawn without data (test V-15). Between sentences (output pipe closed, state still `speaking`) the UI shows "between sentences" as the hill at the floor with the lamp WAITING; it never holds the last word's shape. The SIMULATED lamp is used for exactly one thing: the **test pattern** (Settings, "Show a 5 s test pattern" button, off by default, never automatic), which feeds a fixed synthetic frame sequence through the same renderer in `--state-simulated` amber with an amber diamond and the stamp "SIMULATED" drawn into the canvas corner; it exists to judge the look on a silent machine.

### 9.7 The deterministic quiet fallback, visibly not a reading

The fallback is used in every state without a fresh frame: NO SIGNAL, ERROR, muted, thinking and idle. It is built so it can never be mistaken for a measurement:

| Property | Reading | Fallback |
|---|---|---|
| Points | solid squares | hollow 1 px outline squares, 3 px (one `strokeRect` path) |
| Colour | `--scene-ink` and cyan front row | `--ink-3` only (6.64:1 on `#171717`, §6.3), never cyan |
| Shape | follows the data | fixed table `v_ph(u) = 0.10 + 0.08 * cos^2(pi * u / 2)`, `u = |x_c|` (a low mound of 10 to 18 % of the height); identical every time |
| Motion | data-driven | none. **Breath is off by default** (a Settings switch "Placeholder breath" enables it, and it is turned on by default only after a check shows people do not misread a moving placeholder as activity; V-06 covers the geometry when it is on). When on, it runs only while state 3 persists: multiply `v_ph` by `1 + 0.25 * sin(2 * pi * t / 2.5 s)` for **two cycles (5 s)** since entering the state, then static. `t` is time since the state began, not wall time, so the same sequence replays identically (deterministic) and WCAG 2.2.2's 5 s limit is met even without the Pause button |
| Ring | bars follow bands | 96 hollow bars at length 4 plus a 2 px breath amplitude over the same 5 s |
| Level bar | filled | empty |
| Legend | `MIC -23 dB, 20 Hz, LIVE` | `NO SIGNAL: shape is a placeholder, not a reading` (mono 12 px, `--ink-3`, always rendered in the same slot, `role="status"` once per state change) |
| Lamp | disc | half disc (WAITING), or triangle (FAULT) |

A test pins the contract: any frame drawn from the placeholder path has `measured === false`, hollow style, and the legend string present (V-04). There is no code path that draws solid points without a frame younger than 400 ms, and V-15 asserts that solid style implies a fresh frame in every state.

### 9.8 Latency honesty

The picture shows the audio that was **analysed**, shifted so it lines up with the audio that is **audible**.

1. Transport delay is computed, not assumed: `age = Date.now()/1000 - frame.t` (same machine, same clock). Audible time of an output frame is `t + lat_ms/1000` (device latency reported by the stream). The renderer displays a frame at `max(arrival, t + lat_ms/1000)`; if that time has passed, it shows it at once.
2. One-frame linear interpolation at draw time between the two newest real frames adds at most 50 ms of display delay (one frame interval, computed from 20 Hz). It interpolates between real values only; it never extrapolates past the newest frame.
3. Input is shown as soon as it arrives: the user is not waiting to hear anything.
4. Target end-to-end lag from audible sound to the visual change: at most 100 ms (target; the exact figure is measured in the real window, F8). The Console health view prints the measured age p95 of each channel so the claim can be checked rather than believed.
5. The legend says what is not known: the Windows volume mixer and Bluetooth delay are invisible to Python; the output level is "as played by JARVIS, before the system volume".

### 9.9 Delivery tiers (so nothing waits on `core/`)

| Tier | Signals | Hill | Ring | Ships when |
|---|---|---|---|---|
| T0 | existing scalar `level` (12.5 Hz) | envelope hill (384 points, time on x) | level ring | with the Core page; no Python change; output is NO SIGNAL with the legend "no output level yet". The legacy `level` is unbounded and has no dB meaning, so at T0 the level bar shows relative units with **no dB ticks and no dB number** and the legend "relative level, uncalibrated" (asserted in V-09) |
| T1 | T0 plus `out_level` from `core/playback.py` | spectrum hill for output and for input via the extended `level` | spectrum ring | when F7 is answered and `core/levels.py` lands |
| T2 | T1 plus `window` sources (preview, media) | same | same | after the WebView2 AnalyserNode check |

Every tier uses the same state machine and the same placeholder. Moving up a tier changes only which geometry function runs, never the honesty rules.

### 9.10 Reduced-motion form (`data-motion-level="none"`)

The whole experience survives (§8.1): state, source, level and the fact that JARVIS heard or is speaking are all still shown.

- The hill canvas is replaced by a **static ring** (96 bars all at length 4, `--ink-3`) and **one level bar**. No points move, no history is drawn, nothing breathes, the thinking marker is a fixed mark at the top.
- The level bar updates at **4 Hz** with no transition (a number and a width; progress meters still update under reduced motion, plan 5.7.8). That is at most 4 changes per second, so no flash risk.
- The lamp, the source tag, the label and the legend work exactly as in 9.6; a speech or output change is announced once per state change in a polite live region (11.6).
- No override inside the page. The Calm and OS flags win; the review-only `data-motion="full"` is in Settings (plan 5.7.8).
- The same form is used when the user presses Pause (the loop stops, the picture freezes with the legend "Paused" and the level bar keeps updating at 4 Hz).

### 9.11 Frame budget and when it runs

| Item | `high` | `low` | `none` |
|---|---|---|---|
| Points | 3,072 | 1,280 | 0 (static ring) |
| Tick rate while data flows | 30 fps cap (data 20 Hz, interpolated) | 20 fps | level bar 4 Hz, no loop |
| Draw cost on the main thread (target) | average 3 ms, p95 6 ms | average 2 ms, p95 4 ms | under 0.5 ms |
| Whole-page frame while speaking | p95 at most 16.7 ms (S6 budget) | same | n/a |
| Average CPU of the renderer process while speaking | at most 6 % of one core (assumption) | at most 4 % | at most 1 % |
| Backing store | 720 x 360 CSS at DPR 2 = 1440 x 720 x 4 B = 4.15 MB (computed), DPR capped at 2 as the Reactor does | DPR capped at 1 = 1.04 MB | 1.04 MB |
| Draw calls per frame | 8 fills + 2 ring strokes | 5 fills + 2 | one-off |

- **Idle is zero.** The tick starts on the first frame after a stream opens (or on a state change) and stops 300 ms after the last value reaches the floor. In state idle, no rAF callback exists (S6 idle budget).
- **Stops on hidden, minimised and idle (10.6):** `visibilitychange`, the host `IsVisible` message, and the 60 s no-input rule. The signal channel keeps ingesting into the ring (a few array writes) but draws nothing; on return the first tick draws the newest frame.
- **Cost model.** 3,072 `rect()` calls plus 8 `fill()` per frame is a small batched draw; Canvas 2D is credible at this size (S6 finding 23 gives only anecdotes: fine under about 2,000, doubtful near 5,000), so 3,072 sits in the grey zone and is **measured on the real iGPU before the count is frozen** (F8). Fallback if p95 exceeds budget: governor `low` (1,280 points) automatically. No WebGL (§8.1, D22).
- The existing Reactor is retired; `Reactor.tsx`'s idle-stop and DPR cap are reused.

### 9.12 Accessibility of the visual

- The canvas is `role="img"` with a static `aria-label` that names the picture and its tier ("Voice picture: spectrum of the microphone, drawn live"), never the current values. Values live in a visually hidden `role="meter"` with `aria-valuemin -60`, `aria-valuemax 0`, `aria-valuetext "microphone, -23 dB, measured"` updated at most once per second and **not** in a live region (a meter changing is not an announcement).
- A polite `aria-live` region speaks **state changes only** ("Listening", "Heard you", "Thinking", "Speaking", "No signal from the microphone"), once per change, never per frame.
- Forced colours: the stage container takes `Canvas` as background; the canvas reads `CanvasText` and `GrayText` through `getComputedStyle(canvasEl).color` of two hidden probe elements and re-reads on a `matchMedia('(forced-colors: active)')` change. Canvas pixels are not recoloured by the browser, so the renderer must not assume charcoal. Hollow versus solid carries the reading-or-placeholder meaning without colour.
- Pause button: 44 px, labelled "Pause voice picture", `aria-pressed`, reachable by Tab; a single-key `P` works only while focus is inside the stage (WCAG 2.1.4, 3.3).

### 9.13 Tests that prove it never moves as a reading without data

Python (`core/tests/test_levels.py`, venv Python):

| # | Test | Pass condition |
|---|---|---|
| P-1 | 1,700 Hz sine at peak 0.1, 24 kHz, 2048 samples | `rms_db` -20.0 plus or minus 0.2; the maximum band index is 15; that band within 1.5 dB of -20 (a 1 kHz sine must give band 12) |
| P-2 | silence and full-scale square | `bands` all 0 for silence (and `rms_db` at or below -90); no NaN or negative-infinity for zeros (log guarded) |
| P-3 | rate limiter with a fake monotonic clock, 1 s of 24 ms writes | 19 to 21 frames, `seq` consecutive, `final` set exactly once on finish |
| P-4 | `Emitter.push` blocked consumer (emit raises) | the write loop is not delayed; the frame is dropped; no exception escapes |
| P-5 | band edges | `band_edges(24, 100, 8000)` equals the 25 values in 9.2 within 0.5 Hz; bands above Nyquist are 0 |
| P-7 | one sine per octave region | for i in 0, 4, 8, 12, 16, 20, 23 a sine at the geometric centre `100 * r^(i + 0.5)` Hz has its maximum in band i; the golden file is regenerated from the corrected map |
| P-6 | golden vectors | five stored (PCM, expected bands) pairs shared with the TypeScript test so the two implementations cannot drift |

TypeScript (vitest, `app/ui/src/__tests__/jarvis/voice/`):

| # | Test | Pass condition |
|---|---|---|
| V-01 | `bands.test.ts` | band map and dB window equal the Python goldens (P-6) within 1 count |
| V-02 | `voiceState.test.ts` | table of 40 input combinations including every precedence tie (error over muted over no signal and so on); every state has a lamp |
| V-03 | **No data, no reading.** Property test: for random sequences with a gap over 400 ms, the draw spy records zero calls with `measured: true` during the gap | zero |
| V-04 | Placeholder contract | every `drawPlaceholder` call uses stroke-only squares, `--ink-3`, and the legend string is in the DOM; no `fill` with `--state-measured` on that path |
| V-05 | Determinism | the same ingest sequence twice yields byte-identical geometry arrays; a constant input for 50 frames yields 50 identical geometry arrays (no idle jitter) |
| V-06 | Placeholder breath ends | after 5.0 s of state NO SIGNAL the geometry equals the static table and the tick has stopped |
| V-07 | Smoothing | step input gives 0.713 of the step after one 50 ms frame (attack) and 0.268 per frame on release, within 0.001 |
| V-08 | Staleness | at 399 ms the state is live, at 401 ms NO SIGNAL; `final: true` drops to the floor on the same tick |
| V-09 | T0 | with only `level` events the hill is the 384-point envelope, the legend says "no spectrum" and "relative level, uncalibrated", the DOM contains no dB tick and no "dB" text; the output state is NO SIGNAL |
| V-10 | Hill geometry golden | `hillGeometry(frames)` for a fixed frame history equals a committed array (3,072 points, all inside 720 x 360, none NaN) |
| V-11 | Count | `high` 3,072, `low` 1,280, `none` 0 points drawn |
| V-12 | No flash (the WCAG 2.3.1 general-flash test, computed on canvas pixels) | over a 2 s recorded speech fixture the relative luminance of the stage changes by at most 10 % between consecutive frames, or there are fewer than 3 opposing luminance transitions of 10 % or more in any 1 s window |
| V-13 | No number without a state | the widget refuses to render `rms_db` text without a lamp state (§6.6 test) |
| V-14 | Simulated stamp | the test pattern draws `--state-simulated` and the string "SIMULATED"; it cannot start without the button |
| V-15 | Solid implies fresh | for every state in §9.6 and 1,000 random frame sequences, any draw call with solid points occurs only while a frame younger than 400 ms exists; muted, thinking, idle, error and no signal draw hollow squares only |

Playwright (`app/ui/e2e/voice-hill.spec.ts`, against the sandbox instance, port 8790; a test hook `window.__voiceTest.push(frame)` exists only in a separate hooks build written to `dist-e2e-hooks`, and a test asserts the hooks are absent from `dist` and from the `bundle:check` output; the tested artifact is therefore the shipped one plus the hooks):

| # | Test | Pass condition |
|---|---|---|
| E-01 | Idle: no frames | 2 s after load, zero rAF callbacks from the voice stage (read from the loop registry, 2.6), `getAnimations()` empty |
| E-02 | Inject 3 s of frames, then none | picture moves while frames arrive; 400 ms after the last frame the state is NO SIGNAL and the legend text is visible; the loop stops within 600 ms more |
| E-03 | `reducedMotion: 'reduce'` | the canvas is not drawn; static ring and level bar present; the level bar changes at most 4 times in 1 s of 20 Hz frames |
| E-04 | `forcedColors: 'active'` | screenshot is non-blank; the stage border is non-zero; the legend is visible |
| E-05 | Hidden | `document.hidden` emulated: no tick for 10 s while frames keep arriving; on visible the next tick draws the newest frame |
| E-06 | Keyboard | Tab reaches Pause; Space toggles; a polite announcement fires once on a state change and not on frames |
| E-07 | Pause during THINKING for 6 s | the marker stops at 5 s with or without Pause |

---

## 10 Motion system

### 10.1 Principles (all inherited from the built motion plan, `well-wisher-ui.md` section 5.7, and from §8.1; restated where they bind). "Plan 5.7" and "plan 5.8" below mean that file's sections 5.7 and 5.8

1. Static first. Motion exists only to encode a real state, mark a transition, or confirm an input.
2. Every moving piece has a static form and a reduced-motion form that keeps the whole experience.
3. Animate `transform` and `opacity` only. Documented exceptions as built: paint-only colour at 100 to 160 ms on elements under 300 px, `clip-path` on elements under 640 px, and SVG `stroke-dashoffset` for one-shot draw-ins (10.5). No animated `box-shadow`, `filter`, `backdrop-filter`, width, height, top or left (S6 budget row "Animation"; the build strips `backdrop-filter` anyway).
4. Nothing flashes more than 3 times in any 1 s, anywhere (WCAG 2.3.1, Level A).
5. Anything that moves for more than 5 s has Pause, Stop or Hide (2.2.2, Level A, S6 finding 9).
6. Nothing animates below the fold, in a hidden view, or while the window is hidden, minimised or idle (10.6).

### 10.2 Tokens, extended app-wide

The built tokens (plan 5.7.1) live in the shared layer (`app/ui/src/shared/motion/tokens.css`, generated springs unchanged). Two things change: the file moves from `.ww`-only to the shared layer (S0 7.2), and a per-product tempo gives JARVIS its faster feel (§1.2: JARVIS 80 to 160 ms, Well Wisher 160 to 280 ms).

| Token | Well Wisher (built, ms) | JARVIS (ms) | How |
|---|---|---|---|
| `--dur-feedback` | 100 | 80 | product override; tempo never scales feedback |
| `--dur-state` | 160 | 120 | product override |
| `--dur-enter` | 240 x tempo | 240 x tempo | tempo 0.5 to 0.67 gives 120 to 160 (computed); WW 0.8 to 1.25 gives 192 to 300 |
| `--dur-exit` | 180 x tempo | 180 x tempo | JARVIS 90 to 120 (computed); WW 144 to 225 |
| `--dur-sheet-in / out` | 300 / 200 | 200 / 140 | product override |
| `--dur-route-out / in` | new, both products | 80 / 160 | see 10.4; replaces `--dur-switch-out / in` (200 / 360) |
| `--dur-travel`, `--dur-hold`, `--dur-celebrate` | 400 | 400 | unchanged; JARVIS uses `--dur-celebrate` nowhere |
| `--stagger` | 40 per item | 24 per item | JARVIS first-visit only, 3 items maximum |
| curves and the five springs | as built | as built | one house-curve rule stays; `cubic-bezier(` outside the token file is a lint error |

JARVIS tempo per section (assumption, tune in the prototype): `core` 0.67, `senses` 0.67, `memory` 0.67, `room` 0.5, `console` 0.5. The hard ceiling stays: nothing over 400 ms except the old switch envelope, which is now a 200 ms route envelope (10.4).

### 10.3 The twelve motions, app-wide

The twelve keep their names and primitives. This table says where each runs in each product and what JARVIS changes. It adds no thirteenth motion: live signal renderers (hill, ring, spindle) are not motions, they are data-driven draws governed by 10.6.

| # | Motion | JARVIS use | Well Wisher use | Change from the built plan |
|---|---|---|---|---|
| 1 | `arrive` | first visit to a section in a session: at most 3 cards, 24 ms stagger; never on revisit | as built | stagger caps unchanged; JARVIS never runs it on a switch back |
| 2 | `switch` | section and view change, see 10.4 | same | envelope 520 to 600 ms becomes 200 ms; no master/detail offset and no card stagger on the switch |
| 3 | `sheet` | pair, settings, shortcuts, events overlay | Reader, log, add, date | JARVIS timings from 10.2 |
| 4 | `tap` | relay keys (the board's lamp changes only on the board's report, 1.6-style honesty), wake button, rail buttons | chips, counters | none; optimistic visual press only, never an optimistic "on" |
| 5 | `tick` | latency numbers, level text, VRAM figure | counters | digits roll at most 2 at once; level text never rolls (it is a reading) |
| 6 | `paper` | memory excerpt opening in `memory.recall` (sheet, then the excerpt lands) | Reader | clip-path unveil capped at 3 blocks as built |
| 7 | `glide` | Senses pan and orbit inertia on the twin's own controls (the twin keeps its renderer; the glide math is the same) | Tree | none |
| 8 | `fill` | level bar excluded (it is a reading and updates instantly); meters for VRAM, sensor confidence, upload | stage strip, meters | an `unknown` value draws no fill, never animates |
| 9 | `lift` | hover on relay keys and device tiles | cards, rows | pre-painted shadow layer cross-faded by opacity, as built |
| 10 | `hold` | forget one memory, delete a person, factory reset, wipe export (**not** All off: D13) | destructive resets | Enter or Space opens a plain confirm; hold never replaces a confirm for keyboard users |
| 11 | `pin` | none (no scrolling pages in JARVIS) | Reader, Study, Career heads | unchanged |
| 12 | `tint` | theme crossfade, product switch | theme and workspace skin | one root view transition of 200 ms opacity; the product switch is also `tint` |

### 10.4 Route and section transitions (View Transitions at most 200 ms)

**What triggers one.** A section change (rail, Ctrl+1 to 5, palette), a view change (segmented control, `[` and `]`), and the product switch. Overlays use `sheet`, not a view transition.

**Envelope.** 200 ms total at `high`: old canvas opacity 1 to 0 and translateY 0 to 6 px in 80 ms `--ease-exit`; new canvas opacity 0 to 1 and translateY 8 px to 0 in 160 ms `--ease-enter`, starting at t = 40 ms. Frequent beats slow: a second navigation during an active transition calls `transition.skipTransition()` and applies at once (extends the plan's "second switch within 600 ms takes the fast path" to every product).

```
t(ms)  0    40            80                         200
old    |--- fade + 6 px (80, exit) --|
new         |------- fade + 8 px rise (160, enter) --------|
frame  never moves: title bar, rail, Proof rail carry no view-transition-name
```

**Implementation rules.**

1. Only the canvas carries `view-transition-name: shell-canvas` (renamed from `ww-centre`; one name for both products). `html { view-transition-name: none }` so the frame stays live. Snapshot cost: 1302 x 720 x 4 B = 3.75 MB per snapshot, two snapshots 7.5 MB (computed); at 1920 x 1080 the canvas is 1856 x 1032, 7.66 MB each (computed). `html::view-transition { pointer-events: none }`.
2. **Never block on the network (S6 finding 29).** The page is frozen while the update callback's promise is pending. The router first `await import()`s the target section's chunk (and shows the ASCII loader after 150 ms if it is slow, 2.5), and only then calls `document.startViewTransition(() => flushSync(render))` with a synchronous callback.
3. **Focus handling.** Inside the callback, after render, focus moves to the new view's `h1` (`tabindex="-1"`), then the polite title announcement fires. Focus never moves at the start of the transition and never to the document body. If a view has a primary input (Memory search, text-mode Core field) that input gets focus instead of the `h1` and the `h1` is announced through the live region.
4. Reduced motion (`none`): no `startViewTransition` call; the swap is instant; focus handling is identical. `low`: opacity-only 120 ms (no translate). Browsers without the API: 120 ms fade by class.
5. Only one view transition exists at a time (platform rule), so overlays and the product switch queue behind it; the product switch waits for the route transition to finish or skips it.
6. The shared Aankhen twin must not be re-created on every visit to `senses`: its renderer is disposed on leaving (10.7) and rebuilt on arrival, and the new canvas is shown after the first frame, so the route transition does not capture a blank WebGL texture.
7. `scroll`-driven features stay as built (`animation-timeline` with an `IntersectionObserver` fallback).

### 10.4a Tests for the transitions

| Test | Pass condition |
|---|---|
| `motion-route.spec.ts` | measured time from click to the last changed frame at most 200 ms plus 50 ms; no long task over 50 ms during the switch; focus is on the new `h1` within 250 ms; a second click during a transition lands on the second target with no stale frame |
| `motion-reduced.spec.ts` (extended) | with `reduce`, no `startViewTransition` call and `document.getAnimations()` is empty |
| `keyboard.spec.ts` | focus order is title, rail, canvas; after Ctrl+3 focus is in the Senses canvas |

### 10.5 ASCII and line-draw motifs: when they may move

*Superseded in part by 20.4.3 and 20.4.5 (terminal grammar, cursor and hover language).*

Art is re-drawn from the idea of the reference, not pasted. ASCII art is stored as text (`<name>.ascii.txt`) and drawn either as a `<pre aria-hidden="true">` (static) or on a 2D canvas with `fillText` per row (animated; a full-text `<pre>` rewrite forces layout each frame). Line-draw motifs are inline SVG with `pathLength="1"`.

| Motif (source idea) | Where | May move when | Movement | Max | Static and reduced form |
|---|---|---|---|---|---|
| Loader sweep (C04-52 tilted ASCII ellipse, C04-126 accretion ring) | a lazy chunk or a request is pending longer than 150 ms | while pending | 4 pre-baked frames at 8 fps; indeterminate, never a percentage | 3 s, then frame 1 stays and the text "Still loading" appears with the WAITING lamp | frame 1, always |
| Route sweep (C04-49 sunburst card, C03-20 vortex) | not used on every navigation; reserved for first launch and product switch | product switch only | one-shot reveal over the 200 ms envelope (opacity of a baked image, no per-glyph animation) | 200 ms | none |
| Onboarding landscape (C04-124) | first run | once | row-by-row `clip-path` reveal | 600 ms, skippable | final image |
| Console frame (C04-10, C04-16, C04-18) | `console.*` | never | none: the cursor is always a solid block; **no blink, no scanlines, no flicker, no CRT roll** | none | the same |
| Memory branch (C04-119) | `memory.recall` empty and filled states | when an item is written | one redraw, glyph density change cross-faded | 400 ms | static; the caption states what density encodes if it is bound to a count |
| Day sun rays (C04-37, ASCII twin of the painting) | `day.today` | a block is logged | one ray reveal; a pure function of today's count | 400 ms, once | static rays |
| Focus dots (C03-08) | `focus.session` | each elapsed minute | one dot fades in (opacity, 160 ms) | one per minute | dots only; the dots are a real timer (one per minute) |
| Study island layers (C04-23) | `study.papers` | data changes | 300 ms opacity cross-fade between two baked states | 300 ms | static |
| Tree growth (C04-44) | `tree.tree` | a node is mastered | stroke draw-in of the new branch | 400 ms, once per event | final drawing |
| Senses spindle orbit (C04-06) | `senses.presence` | measured motion energy | orbit speed follows the value; still at zero; stamped SIMULATED when the hub says simulation | live renderer (10.6) | static spindle, still orbits |
| Empty and error plates | any view | never | none | none | static |

Line-draw rules: `stroke-dashoffset` repaints (it is not compositor-only), so it is allowed only for one-shot draw-ins on SVGs under 640 px with at most 60 path segments, at most one at a time, 400 ms maximum, `low` and `none` show the final drawing at once.

ASCII budgets (target): each art file at most 8 KB raw (about 3 KB gzip), at most 4 files per section, at most 40 KB raw across the app; the animated canvas variants at most 80 columns by 30 rows (2,400 cells), redrawn at most 8 fps, never in the entry chunk.

### 10.6 Performance ceilings, the governor, and when everything stops

**One frame bus, one loop registry.** All rAF work goes through `shared/motion/frameBus.ts`: one `requestAnimationFrame` for the whole app, subscribers register with a cap (`fps`) and a `kind` (`live` for data-driven renderers, `ambient` for decorative, `input` for pointer-driven glides). `loopRegistry.ts` lists running loops (`window.__loops()` in the e2e build) so tests can assert "zero". Existing rAF users migrate: `Reactor` is replaced by the voice stage; `EyesView` and `SpatialTwin` become `live`; `ww` `glide`, `hold`, `Interactive` and `tree/viewport` become `input` (start on pointerdown, stop at rest); `MemoryGalaxy` and `GalaxyScene` are deleted (D19).

**Ceilings.**

| Motion or renderer | Properties | Typical duration | Main-thread cost target per frame | At once (max) | `low` | `none` |
|---|---|---|---|---|---|---|
| `arrive`, `sheet`, `tap`, `lift`, `fill`, `tint` | transform, opacity | 80 to 360 ms | compositor only, under 1 ms JS | counted in the surface budget below | no stagger, no `lift` travel | final state |
| `switch` (route) | opacity, translateY | 200 ms | compositing 4 to 5 ms (S6 finding 20) | 1 | 120 ms fade | instant |
| `tick` | JS number spring on text | 286 ms | under 1 ms | 2 | snap | final value |
| `paper` | transform, opacity, clip-path | 280 ms | clip-path is main-thread paint: at most 3 blocks | 3 clip-paths | opacity only | final state |
| `glide` | SVG `<g>` transform (main thread) | at most 450 ms | under 4 ms | 1 | no inertia | no glide |
| Voice stage | Canvas 2D | data-driven | average 3 ms, p95 6 ms (9.11) | 1 | 1,280 points, 20 fps | static ring |
| Senses twin and HUD canvases | the one WebGL context plus 2D canvases | data-driven | absolute targets now (assumption, replaced by R01 numbers): render on change, 30 fps cap at `high` and 15 at `low`, **stop after 60 s without input even if data flows** (lamp WAITING "paused, idle"), pixel ratio cap 1.5, an explicit canvas cap of 760 x 652 CSS px (4.46 MB backing store at 1.5, computed: 1140 x 978 x 4 B; the first draft's 1.75 gave 6.07 MB); and no worse than +15 % over three runs against the first measurement | 1 live group | pixel ratio 1, no antialias, 30 fps | one still frame, "twin paused" lamp WAITING |
| ASCII canvas | 2D `fillText` | 8 fps | under 1 ms | 1 | frame 1 | frame 1 |
| Line draw | stroke-dashoffset | 400 ms | under 2 ms | 1 | final | final |

**Global limits (as built, extended).** At most 6 animated surfaces at once, 8 only for a cross-section jump (plan 5.7.7); at most 8 `will-change` elements, only while a transition runs; at most **one live renderer and one ambient loop per view** (the Senses twin and its HUD canvases count as one group on a shared tick); no timer added by the motion system faster than 1 per minute while idle; zero rAF callbacks and zero running animations 2 s after the last input and with no data flowing (plan 5.8 rule 4). The JS added by the shared motion code stays within the built 6 KB gzip, plus `frameBus`, `loopRegistry`, `activityGate` and `viewTransition` at most 4 KB gzip combined (target; checked by `bundle-budget.mjs` on the **built chunk**, gzipped as a chunk; a sum of source gzips is only an upper bound).

**The governor, app-wide (`shared/motion/governor.ts`).** Three levels exactly as built, now read by JARVIS and the phone too. The CSS reads one resolved attribute, `html[data-motion-level="high|low|none"]`, set by the governor from `data-motion` (auto, full, calm), `prefers-reduced-motion` and the load signal; the built `data-motion-load` and `data-motion` attributes stay for compatibility.

| Level | When | JARVIS and Well Wisher behave as |
|---|---|---|
| `high` | p5 frame rate at least 50, window visible and active | everything in 10.3 and 10.5; hill 3,072 points; ring 96 bars |
| `low` | p5 under 50, battery saver, window unfocused-but-visible for over 10 s, or the 120-frame sampler says so | no tilt, no pointer companion, no stagger, no `pin` scrub; route = 120 ms fade; hill 1,280 points at 20 fps; ring 48 bars; draw-ins and ASCII sweeps show the final frame; feedback motion stays |
| `none` | `data-motion="calm"` or the OS asks for reduced motion | travel 0; no view transition; `tick` snaps; static ring and level bar; ASCII and line art static; confirm dialogs replace `hold`; 100 ms colour or opacity feedback stays |

The **glass tier is retired as an input**: it came from `lib/liquidGlass.tsx`, and `backdrop-filter` is stripped by the production build and banned by the budget (S0 5, S6 finding 22 and memory note). The governor keeps its p5 sampler, which runs only while something animates (never at idle), over 120 frames. Hysteresis (design, assumption): to `low` when p5 under 50; back to `high` only after p5 at least 55 over 300 frames and at least 30 s since the last change, to prevent flapping; the verdict is remembered per machine (as the glass tier is).

**Stop on hidden, minimised and idle (`shared/motion/activityGate.ts`).** One gate, four states: `active`, `unfocused` (visible, window not focused: ambient loops at half rate, live loops unchanged), `idle` (no pointer, key, touch or voice-frame event for 60 s; the 60 s value is a design suggestion, S6): ambient loops pause on a still frame and `live` loops pause unless data is flowing, and `hidden`. Sources: `document.visibilitychange`; a host message for minimise and restore (the WebView2 child does not receive them; Microsoft says the host should set `IsVisible`, S6 finding 25) as `window.dispatchEvent(new CustomEvent('host-visibility', {detail: {visible}}))` from `JARVIS.pyw` (host change, needs the owner's OK, F8); `pointermove`, `keydown`, `touchstart` passive listeners, coalesced to a 1 s timestamp. A WebSocket keeps a hidden page's timers alive (S6 finding 24), so the gate also stops DOM writes from bus events while hidden, and **polls pause when hidden** (`usePoll` gains the gate): vitals every 2 s becomes every 10 s unless the title-bar VRAM or `console.health` is visible, the health ping every 5 s stays (it is the FAULT source), Aankhen snapshot and crew polls pause when their view is not mounted.

**Pause, Stop, Hide (2.2.2).** Anything that moves for more than 5 s has a control: the voice stage Pause (9.4), the Senses stage Pause, and one global **Pause all motion** command (palette, `Settings > Appearance`, and a footer link in the shortcuts sheet) that sets `data-motion="calm"` for the session. Items that run only 5 s or less (the placeholder breath, the thinking marker, the ASCII loader, every draw-in) have no button and stop by themselves; the hill, which moves for more than 5 s, has the Pause. The Senses spindle is SVG driven from the shared tick (no second canvas), and the three `senses.signal` canvases share one tick. Auto-updating content (the 20 Hz level, the events list) is covered by Pause plus the 4 Hz reduced form.

### 10.7 WebGL policy

WebGL is allowed in exactly one place: **the Senses twin** (`SpatialTwin`, `BeliefCloud`, and the raw WebGL2 `heatgl`), under `app/ui/src/jarvis/senses/` and, until the senses step of B06 moves it there with the Aankhen chat's sign-off, `app/ui/src/twin/**` (where the twin lives today; the first draft's rule would have failed the build on day one). Rules: at most one live context; created on entering `senses`, **disposed on leaving** and on window hidden for over 10 s (the memory note says the app sits near the laptop's commit limit); pixel ratio at most 1.75 as built, 1 at `low`; `antialias` false at `low`; loop paused when hidden or `paused`; on `webglcontextlost` the stage shows the static "twin paused" plate (lamp WAITING with the reason) and offers Retry; no `three`, no context in `ww/`, `shell/`, `shared/`, or `jarvis/core/` (the voice hill is Canvas 2D). Enforced by extending `scripts/bundle-budget.mjs`: `getContext('webgl'|'webgl2'|'experimental-webgl')` and any import of `three` outside `src/jarvis/senses/**` and `src/twin/**` fail the build, and a `VITE_PRODUCT=ww` build must contain no `three`. The twin's chunk keeps its own budget (14.2).

---

## 11 Responsive, keyboard and accessibility

### 11.1 Viewports, the no-scroll canvas, and reflow

The fixed canvas is the wide-viewport layout only (D6, S6 reconciliation). The guarantee is "no document scroll at 1366 x 768 and above"; below that the view may scroll inside the canvas region, and below about 900 CSS px the shell becomes one reflowing column (WCAG 1.4.10).

| Class | Viewport (CSS px) | Shell | Canvas rule | Test viewport |
|---|---|---|---|---|
| XL | width at least 1600 | rail 64, title 48, Proof pinned from 1500 container width | same views, more air; never more sections | 1920 x 1080 |
| L (contract) | 1366 to 1599, height 720 or more (T768 reference, T720 floor, §3.3.1) | rail 64 left, title 48, canvas 1302 x 720 (672 at T720) | **no scroll** at both tiers (§3.3, §3.3.1) | 1366 x 768, 1366 x 720 |
| M | 900 to 1365, or height under 720 | rail 64, title 48, Proof opens as a 320 px panel over the canvas (inert behind it, focus returns on close), never pinned | container queries compress the layout; the **canvas** (not a region inside it) scrolls as one column with the title bar, rail, view-switch band, primary and state strip sticky (§3.3.1) | 1280 x 720, 1280 x 680, 1093 x 614 (125 %), 911 x 512 (150 %) |
| S | 600 to 899 | rail becomes a bottom bar (6 slots: 5 sections plus Ask, 56 px tall); pair, settings and **All off** move to the fixed title-bar menu button, and All off also sits in the bottom bar's overflow | one column; a single scroller (the canvas); chrome fixed | 683 x 384 (200 %) |
| XS | 320 to 599 | same bottom bar, slots at least 53 px wide at 320 (computed: 320 / 6) | one column; voice stage `width: 100%`, aspect 2:1, minimum 280 x 140 | 455 x 256 (300 %), 342 x 192 (400 %) |

Zoom arithmetic (computed, 1366 x 768 at 100 %): 125 % gives 1093 x 614; 150 % gives 911 x 512; 175 % gives 781 x 439; 200 % gives 683 x 384; 300 % gives 455 x 256; 400 % gives 342 x 192 (1366 / 4 = 341.5). So **150 % zoom still gets the desktop layout** (911 is just above 900) and the canvas scrolls inside; 200 % gets the column.

**Short-viewport rule** (new). At 400 % the viewport is 192 px tall; a sticky 48 px title bar plus a 56 px bottom bar would leave 88 px of content (computed). Below 420 CSS px of height the chrome stops being sticky: the title bar and bottom bar scroll away with the content and a single 44 px menu button stays fixed. WCAG 1.4.10 asks for no two-dimensional scrolling at 320 x 256; the declared two-dimensional exceptions are the Senses twin stage, the Tree canvas, the Aankhen channel matrix and data tables, each a contained region with its own pan and keyboard control (S6 finding 7). The list of declared regions is kept in `docs/design/` and in the test below, so an auditor can disagree about a specific one.

Other reflow rules: no fixed pixel widths in views (use `minmax`, `clamp`, container queries); text uses `rem` and never clips at 200 % text size; the view switch becomes a horizontally scrollable segmented control with all segments reachable by arrows (it is the one declared horizontal region at XS) or, below 480 px, a `select`-style button opening a sheet; the voice stage keeps 1,280 points (or fewer, proportional to width) below 480 px.

Tests: Playwright viewports 1366x768, 1366x720, 1280x720, 1280x680, 1920x1080, 1093x614, 683x384, 455x256, 342x192; assert `document.scrollingElement.scrollHeight <= innerHeight` at 1366x768, 1920x1080 and, for every view that has declared a T720 column, 1366x720; at 1280x720 and 1280x680 assert that no primary or state control is unreachable (the canvas scrolls); run a text-spacing pass (line height 1.5, paragraph spacing 2x, letter spacing 0.12 em, word spacing 0.16 em) and a 200 % root-font-size pass asserting no clipped text; and `scrollWidth <= clientWidth` on `body` and the shell at all, excepting the declared regions listed by `data-region-2d`.

### 11.2 Keyboard map (resolving Ctrl+1..6, Alt+1..6, the palette, single keys)

**Resolution.** JARVIS has five sections, so **Ctrl+1 to Ctrl+5** select the current product's sections (§3.4, D9); **Alt+1 to Alt+5** are aliases of the same five slots (F5), so a student who learned Alt+n keeps one chord per section. The slot order is the reuse order of §3.1.2: JARVIS Core, Room, Senses, Memory, Console; Well Wisher Day, Focus, Study, Tree, Career (it differs from the old Well Wisher order; legacy ids still resolve in deep links, §3.2). **Ctrl+6 and Alt+6 are unbound** (today's Ctrl+6 was System, now `console` at Ctrl+5; silent no-op, and the palette's false "Ctrl 7 to 21" hints disappear because every hint is generated from the one binding table `shell/keymap.ts`). Each shortcut is registered once; the palette, the shortcuts sheet and the tooltips read that table (tested: every hint string has a live binding).

| Key | Action | Scope | Notes and risks |
|---|---|---|---|
| Ctrl+1 to Ctrl+5 | section 1 to 5 | global | In a browser these switch tabs; WebView2 accelerator handling must be verified (`AreBrowserAcceleratorKeysEnabled`); the handler calls `preventDefault` on `keydown` |
| Alt+1 to Alt+5 | alias | global | verify (Alt+digit is free on Windows) |
| **Alt+0** | swap product | global | **changed from Ctrl+0**: Ctrl+0 resets browser zoom, which low-vision users rely on for 200 to 400 % reflow (conflict C1) |
| Ctrl+K | command palette | global | combobox plus listbox (focus stays in the input, results by `aria-activedescendant`, the one case where APG favours it) |
| Alt+R | Resume | global | |
| `[` and `]` | previous, next view | **focus inside the canvas or the view switch**, never in a text field | single-key shortcut, so scoped (WCAG 2.1.4) and with a Settings switch "Single-key shortcuts" (default on) |
| `?` | shortcuts sheet | same scope as above | |
| `P` | pause or resume the focused live stage | focus inside that stage | |
| Esc | close popover, else overlay, else focus mode, else the Back chip | global | never closes more than one layer |
| Alt+Left | back one view | global | WebView2 maps Alt+Left to history back; the handler prevents it, and the row is "verify" (Esc is the primary route) |
| Ctrl+, | settings sheet | global | |
| Alt+L | events overlay | global | |
| Alt+P | Proof rail (Well Wisher) | global | |
| Ctrl+Shift+Space | push to talk | global | **hold** is a motor barrier (the reason D13 rejected a long press): the Ask orb is also a **toggle** (press to start, press again to stop), and the keyboard chord has "toggle" and "hold" modes (default toggle); on Windows Ctrl+Shift can switch input language, so verify |
| Arrow keys, Home, End | inside composites | the focused composite | rail: Up and Down; view switch and tabs: Left and Right; listboxes and the palette: Up and Down; Tree and Senses stage: pan 80 px, `+` and `-` zoom (as built) |
| Tab and Shift+Tab | move between composites | | one tab stop per composite (roving tabindex) |
| Space and Enter | activate | native | |

**Hard rules.** No `g then h` chords, no bare-letter global shortcuts (2.1.4). Shortcuts avoid assistive-technology keys (Insert, CapsLock chords, Ctrl+Alt arrows). A held key is never the only way to do something. Every shortcut works with the screen reader's browse mode off (focus mode), and the shortcuts sheet is reachable by `?`, by the palette, and by a visible "Keyboard" link in Settings.

Tests: `keyboard.spec.ts` (every section reachable by keyboard only, the palette opens by chord, `[`/`]` do nothing inside a text field, Ctrl+6 does nothing, Alt+0 swaps product, Esc depth), `keymap.test.ts` (every binding has a modifier or a declared scope; every hint is bound; the section order equals the order of the §3.2 id table, so the rail, Ctrl+1 to Ctrl+5 and the view switches cannot drift apart), and a manual WebView2 table (14.6) for the rows marked verify.

### 11.3 Focus order and focus handling

DOM order equals visual order: (1) a "Skip to canvas" link (first Tab stop), (2) title bar: product switch, Resume pill, fault chip, lamps are read-only, window controls, (3) rail: one tab stop with roving focus (Up and Down), then the Ask orb, pair, settings, JARVIS All off (each its own stop; they are not part of the section roving group), (4) the canvas: view switch (one stop, Left and Right), then the view's content in reading order, the primary action last in a view that has one, (5) the Proof rail (Well Wisher), (6) overlays and sheets are portals appended last and trap focus while open.

- Focus ring: 2 px solid, 2 px offset, `--ink-1`, drawn with `outline` (never shadow), at least 3:1 on raised and sunk surfaces (§6.3). Meets 2.4.7, 1.4.11 and the AAA 2.4.13 for free (S6 finding 6).
- Focus Not Obscured (2.4.11): `scroll-padding` equals the title bar plus bottom bar heights; the Proof panel and the Ask orb never cover the focused element (sheets use `inert` on the canvas behind).
- Route change: focus to the new `h1` (10.4 rule 3). Overlay close: focus returns to the opener; the opener must still exist, else to the canvas `h1`. After deleting an item: focus to the next item or the list heading. No positive `tabindex`.
- `inert` is used for parked overlays (never only `pointer-events: none`), with the focus-trap fallback if a WebView2 version lacks it (the feature probe in `ww/frame/features.ts`).

### 11.4 Landmarks, headings and live regions

`header` (title bar), `nav aria-label="Sections"` (rail), `main` (canvas), `aside aria-label="Proof"` (Well Wisher), dialogs for overlays. One `h1` per view (the view name), section name as a visually hidden `h2` landmark label where useful. Live regions: one polite region for state changes (voice state, "saved", a board confirmation), one assertive region **only** for FAULT. No ticker, no level and no clock in a live region. A "planned" control is `aria-disabled="true"` with visible text (never hidden), and its lamp shape carries the PLANNED meaning.

### 11.5 Screen readers in WebView2

Chromium has used native UI Automation by default since Chrome 138, so Narrator talks to the page directly and NVDA and JAWS still use their own bridges (S6 finding 17). No official WebView2 behaviour page exists, so every release is checked by hand with **Narrator and NVDA** (JAWS if available), and the WebView2 runtime version is written into the gate report.

| Step | Pass condition |
|---|---|
| Launch and Tab | "Skip to canvas" is announced first; landmarks listed (banner, navigation, main) |
| Rail | the section name plus "N of 5", and the selected state, are read; arrows move; no icon-only control without an accessible name |
| Section change | the new `h1` is read once; no double announcement from both the transition and the live region |
| Palette | Ctrl+K announces "Command palette, edit, combobox"; arrows read each result; Enter runs it; Esc returns focus |
| Core | a state change is announced once ("Listening", "Heard you", "Speaking"); the level is not read continuously; the meter is readable on demand |
| Room | each key reads name, state and "confirmed by board" or "not confirmed"; All off reads its Restore toast |
| Senses | the canvas has a text summary: lamp state, "measured" or "simulated", and the motion estimate in words; it never implies a body shape |
| Memory | search results are a list; fix and delete are reachable by Tab; delete asks for confirmation |
| Settings and a form | labels, errors and required fields are associated; errors are announced |
| Forced colours | with a Windows contrast theme every control, lamp and focus ring is visible |

Automated axe-core runs in Playwright per route catch only part of this (S6 budget), so the table is a manual release checklist.

### 11.6 Forced colours and contrast preferences

- `@media (forced-colors: active)`: every raised or recessed surface gets `border: 1px solid CanvasText` (controls `ButtonText`); focus ring `outline: 2px solid Highlight`; selected states use `Highlight` with `HighlightText`; `box-shadow`, `text-shadow` and gradients are already removed by the browser, so nothing depends on them; `div role=button` gets no system colours, so controls are native elements or set `forced-color-adjust: none` locally with explicit system colours. Canvases read system colours (9.12). The app has zero handling today (S0 and S6 finding 14).
- `@media (prefers-contrast: more)`: token set that makes `--edge-ui` the `--ink-2` values (6.99:1 on the light ground, 8.97:1 on the dark ground, the one value used in §6.5.1), raises the history alpha floor to 0.5, thickens the focus ring to 3 px, removes the dotted grid.
- Lamps rely on **shape plus text** (§6.6), so they survive both modes.
- **Forced-colours fallback per meaningful art piece is its data table or text:** the Core hill is the level bar and meter text; the Senses spindle is the readout line; the Day sun is "blocks logged today: n"; the Study island is the units table with heights; the Tree trunk is the count of nodes marked mastered; the Career skyline is the stage list; the Focus dots are the minutes text; the Proof ring is its statistics table.
- Tests: Playwright `forcedColors: 'active'` screenshots per section plus an assertion that every interactive element has a non-zero computed border or outline; token unit test computes 4.5:1 for text and 3:1 for boundaries in both themes and in the `more` set (extends `tokens.test.ts`).

### 11.7 Target sizes and touch

Desktop: every pointer control has a **44 px** hit area (as built, tested in three themes), which exceeds the WCAG 2.5.8 minimum of 24 x 24 (S6 finding 4). Dense mono chips that are visually smaller (24 px) must either keep a 44 px hit area or pass the spacing-circle exception. Phone: 44 px minimum (platform convention, S6 finding, not a WCAG figure), bottom bar slots at least 53 px wide at 320 (computed). Test: Playwright measures every `button, a, [role=button], input, select` bounding box per route.

### 11.8 Mobile parity

One pairing, two pages (§3.4). Rules: the same generated `phone_page/tokens.css` (clay light default, dark option, forced colours, `prefers-contrast: more`, motion governor and the three levels), the same lamp shapes and labels, the same 4-tab bottom bars, 390 CSS px design width.

| Desktop feature | Phone treatment |
|---|---|
| Voice hill and ring | ring only (24 bars, its own analyser on the phone's mic and reply audio), the lamp, the legend and the level bar; no hill; the same placeholder rules; reduced form identical |
| Room keys | tiles confirmed by the board **only, never optimistic** (a tap shows WAITING until the board reports; 150 ms settle, 6 s "not confirmed" as built), All off in the header |
| Senses twin | a status list with each line "measured" or "not measured"; no 3D |
| Console | one health summary; the owner views stay desktop |
| Memory | search and recall; fix and delete behind a confirm; export is "desktop only" |
| Well Wisher Today, Block, Topics | as in §3.4; counters have Undo |
| Planned features | a visible card, `aria-disabled`, with the lamp; never missing text |

Touch has no keyboard shortcuts; every action has a visible control. The phone page gets the same tests (Playwright mobile emulation at 390 x 844 and 320 x 568, reduced motion, forced colours), plus two honesty tests: a tapped relay tile stays WAITING until the board reports, and the mic-open indicator with its Stop is present whenever the phone's mic is open.

---

## 12 Planned-feature registry

### 12.1 Why a registry, and what it must guarantee

Built today (Strand 0, section 2): `app/ui/src/ww/plannedFeatures.ts` holds 28 entries (13 numbered plan items plus 15 more), four patterns (`empty`, `disabled`, `coming`, `roadmap`), a `built` flag, line length 15 to 140, and `staleEntries()`. `ww/Planned.tsx` renders an entry; the Roadmap overlay lists them; `plannedFeatures.test.tsx` checks coverage. This is the right carcass. It is Well Wisher only, its `page`/`section` codes (C1 to C6, R, L, phone) are plan-chunk codes, and it knows nothing about JARVIS.

Guarantees the generalised registry must keep (all testable):

1. **One source per sentence.** A page never copies a planned line; the page, the "What is coming" overlay and the tests read the same entry.
2. **A placeholder is not a feature.** It has no live state, no count, no value, no toggle position, no animation after arrival, no accent colour.
3. **Honest and findable.** Every planned thing is reachable from the view where the owner would look for it, from the palette, and from the overlay.
4. **It cannot rot.** An entry is deleted in the commit that ships the feature; a leftover is a failing test.
5. **Product-local.** A `VITE_PRODUCT=ww` build contains only `ww` entries; a `jarvis` build only `jarvis` entries (§1.4).

### 12.2 Where the code lives

| File | Owner | Content |
|---|---|---|
| `app/ui/src/shared/planned/types.ts` | UI chat | The record type below, `Pattern`, `Blocker` |
| `app/ui/src/shared/planned/registry.ts` | UI chat | `createRegistry(entries)`, `byId`, `forHome`, `fillLine`, `lintEntry` |
| `app/ui/src/shared/planned/stale.ts` | UI chat | `staleEntries(root, registry)` plus the cross-checks in 12.5 |
| `app/ui/src/shared/planned/{PlannedPlate,PlannedChip,PlannedControl}.tsx` | UI chat | The four renderers (12.3) |
| `app/ui/src/shared/overlays/WhatIsComing.tsx` | UI chat | The overlay (id `roadmap`, title "What is coming"), grouped by section, merges only the registries present in the build |
| `app/ui/src/jarvis/planned.ts` | UI chat | JARVIS entries (starter table in 12.6) |
| `app/ui/src/ww/plannedFeatures.ts` | Well Wisher chat | Well Wisher entries (28 carried over plus new rows), re-exporting through the shared mechanism; `ww/Planned.tsx` becomes a thin wrapper |

### 12.3 The record

```ts
type Pattern = 'empty' | 'disabled' | 'coming' | 'roadmap'          // E, D, C, R (unchanged names)
type Blocker = 'build' | 'hardware' | 'data' | 'decision' | 'licence' | 'account'

interface PlannedEntry {
  id: string                 // existing 28 keep their bare ids; every new id is '<product>.<slug>'
  product: 'jarvis' | 'ww'
  home: string               // a view id from §3.2, e.g. 'console.crew', 'study.library', or 'phone'
  slot?: string              // sub-position inside the view, e.g. 'header-chip' | 'foot'
  label: string              // 2 to 6 words
  pattern: Pattern
  line: string               // 15 to 140 chars; says what is missing and why; no counts, no dates
  works_today?: string       // one line naming what already works instead (optional, 15 to 100 chars)
  needs: string              // the precondition, shown on the overlay row
  blocker: Blocker           // which of six reasons; drives the overlay group order
  action?: string            // pattern E only: the label of a real first action the page supplies
  when?: string              // only an owner-approved phrase such as 'needs a decision'; never a date
  since: string              // 'YYYY-MM-DD' the entry was added
  reviewBy: string           // 'YYYY-MM-DD' (target: since + 90 days); drives a report, not a failing test
  owner: 'ww-chat' | 'ui-chat' | 'aankhen-chat' | 'owner'
  chunk?: string             // legacy plan chunk; WW entries only
  built?: boolean            // row works; entry holds only the blocked-state line (as today)
}
```

The lamp state of every entry is fixed: PLANNED (dashed ring), never a field. Migration: the existing `page` and `section` plan codes are replaced by `home`; draft mapping (WP-B02 confirms it against the code):

| Old page code | Old group | New `home` |
|---|---|---|
| C1 (S1, S3) | Study | `study.papers`, `study.practice` |
| C1 (S2, S6, S7) | Study | `study.library` |
| C1 (S9) | Study | `study.dmat` |
| C2 | Tree | `tree.tree` |
| C3 (LF1 holiday, LF5 body) | Life | `day.week`, `day.body` |
| C3 (LF1 music, reels) | Life | `day.body` |
| C4 | Career | `career.pipeline`, `career.abroad`, `career.money` |
| C5 | Study | `study.practice` |
| C6 (SU13, SU18) | Setup | `settings.<existing section id>` |
| R | Proof | `proof.panel` |
| L | Left column | `day.today` |
| phone | Phone | `phone` |

### 12.4 The four patterns, how they look and behave

**Choosing the pattern (decision table, apply top to bottom).**

| If | Pattern |
|---|---|
| A real first action exists today and the view is empty without it | **E** empty (the page supplies the action) |
| The owner would expect a control right here, and it is not built | **D** disabled (focusable control, reason printed beside it) |
| A whole capability has a home but no control to put in it | **C** coming (dashed plate) |
| The feature is far off, or putting anything in the layout would mislead | **R** roadmap (a row in the view's PLANNED chip, plus the overlay) |

**Appearance (all four).** The one cue is the dashed outline in `--edge-ui` (3:1 on every surface, §6.3) plus the dashed-ring glyph and the word PLANNED in `--ink-3` at 12 px mono minimum. Flat: no raised shadow, no hover lift, no press sink. No accent fill, no cyan, no amber. In `forced-colors: active` the border stays dashed (`1px dashed GrayText`), shadows are absent anyway. A plate carries an accessible name "`<label>`, not built yet".

**Behaviour (all four).**

| Gesture | Result |
|---|---|
| Click, Enter or Space on a D control, a C plate, an R row | Opens overlay `roadmap` ("What is coming") scrolled to the entry, with the entry card: what is missing (`line`), what works today (`works_today`), what it needs (`needs`), who decides (`blocker`). One overlay deep: a planned explanation never stacks a second overlay |
| Esc or Alt+Left | Closes the overlay and returns focus to the control that opened it |
| Palette (Ctrl+K) | A planned verb is listed with the PLANNED lamp and opens the same card; it is never executable (§3.4) |
| Voice ask for a planned thing | JARVIS answers with the entry's `line`, never "ok" or "done" (core J-L1) |
| Phone | Same dashed plate; `aria-disabled="true"`, 44 px tap, opens a sheet with the same text |

D controls use `aria-disabled="true"` and stay in the tab order (as built), never the `disabled` attribute, so the reason is reachable by keyboard and screen readers.

**Never on a planned item** (extends the existing test `no placeholder has an enabled button, accent class or primary mark`):

| Not allowed | Why |
|---|---|
| A toggle drawn on or off, a slider with a position, a progress or count, any sample value | A fake state (§1.1 rule 4, N5) |
| A skeleton or shimmer | A skeleton says "loading", which promises it is coming now |
| "Notify me", a waitlist, an email field, a countdown, a date | Fake urgency and re-engagement (N1, N3); `when` holds only owner-approved words |
| "Beta", "new", sparkle, badge dots | Reads as a live feature |
| A planned plate placed inside a LIVE capability's data region | It would read as one of that capability's readings |
| Being the only way to reach an existing feature | A real feature never sits behind a planned item |
| Art that grows, a data glyph, or anything chart-like | Planned plates carry **static line art in `--ink-3` only** (Coach C04-22, Agents C04-105, Away C04-104 redrawn as outlines): growth or a chart shape would imply a live feature |

**Planned versus the other lamp states (resolves a confusion that will recur).**

| Situation | State shown |
|---|---|
| No code path produces the reading | **PLANNED** |
| Code exists, source is silent (board not linked, no audio yet) | **WAITING** with reason "no report" |
| Code exists, owner switched the feature off in Settings | **WAITING**, reason "turned off in Settings" |
| Code exists, the source reported an error | **FAULT** with the reason |
| Hardware channel is not wired (for example an absent relay on the wall box) | **WAITING**, reason "not wired"; the key is drawn "unavailable" (core, `room`), not planned |
| Built orphan card whose backend is not yet verified (D20) | **WAITING**, reason "built, not verified" (never PLANNED, and never described as "not built") until WP-B06 confirms the routes answer, then the entry is deleted in the same commit that mounts the card |

**Density rules (target).** At most one C plate and at most two D controls per view. The **loop views** carry no plates or chips at all: `day.today`, `focus.session`, `core.talk`, `room.switches`. Planned things for those views are reachable from the palette and the overlay only (rule R5). The PLANNED chip sits in the 44 px view-switch row at the right edge, 44 px high, label "PLANNED" plus the entry count word ("3 here" is a count of registry rows, a fact, not a measurement).

### 12.5 The stale-entry test, generalised

Today `staleEntries(root)` finds an enabled control with `data-feature="<id>"` whose id is still registered. Keep it, and add these checks in `app/ui/src/__tests__/shared/planned.test.tsx` (vitest) and `e2e/planned.spec.ts` (Playwright):

| # | Check | Fails when |
|---|---|---|
| T1 | Stale (as built) | A live, enabled control carries `data-feature` of a registered id |
| T2 | Orphan entry | A registry id has no renderer: no `<PlannedControl id>` in its `home` view, and `pattern` is not `roadmap` |
| T3 | Orphan renderer | A `data-planned` id on the page has no entry |
| T4 | Home exists | `home` is not in the frozen view-id table (§3.2) or `phone` |
| T5 | Lint | `line` outside 15 to 140 chars, contains a standalone digit as a count, a date, or a banned word ("soon", "coming soon", "beta", "new", "unlock", "miss"); `action` on a non-E entry; two entries with the same `home`, `slot` and label |
| T6 | Product purity | The registry of one product imports or lists an id of the other |
| T7 | No enabled button | As built, extended to the shared plates and the chip |
| T8 | Loop views empty | `day.today`, `focus.session`, `core.talk`, `room.switches` render no `data-planned` element |
| T9 | Density | More than one `coming` or two `disabled` entries share a `home` and are rendered at the same time. A master-detail list (for example `room.rules`) renders one plate at a time and counts as one; extra entries on a crowded home use pattern `roadmap` (rows in the PLANNED chip). Integration decision I11 |
| T10 | Dates sane | `reviewBy` is earlier than `since` (format error) |
| T11 | Planned art | An asset on a planned plate has `kind: line-art`, no growth input and no chart or data glyph |

`reviewBy` past due is **not** a failing unit test (a test that fails on the calendar breaks unrelated work). It is a line in the gate report (`ww_check`, and a JARVIS twin under `jarvis_app`): "entries past review". The integrator reads it at each phase boundary and either deletes, ships or re-dates the entry.

### 12.6 Starter registry

Draft lines (all 15 to 140 characters, no counts); the owner approves wording in WP-V02.

**JARVIS (13 entries below plus `jarvis.phone-twin`; `owner` ui-chat unless stated).**

| id | home | pattern | label | line | blocker |
|---|---|---|---|---|---|
| `jarvis.agents` | `console.crew` | C | Agents | Agents that act on their own are not built. The staff roster below only reports what runs now. | decision |
| `jarvis.spotify-play` | `core.sound` | D | Play a track by name | Starting a track by name is not built. The Spotify app opens on a search and you press play. | account |
| `jarvis.library` | `core.sound` | C | Local music library | The local library panel is built and not verified yet. It stays out of the app until a check shows its routes answer. | build |
| `jarvis.reminder-alerts` | `memory.recall` | C | Reminder alerts | Spoken and chime alerts for due reminders are built and not verified yet. They stay off until the reminder route answers. | build |
| `jarvis.memory-delete-all` | `memory.keep` | D | Delete a whole namespace | Deleting everything under one heading in one step is not built. Delete items one at a time for now. | build |
| `jarvis.memory-meaning` | `memory.recall` | R | Hinglish meaning search | Search by meaning in Hinglish is not tested yet. Search by words works now. | data |
| `jarvis.senses-multilink` | `senses.signal` | C | More links | A second link would add coverage, not pose. No second transmitter is set up. | hardware |
| `jarvis.senses-phone-tx` | `senses.teach` | R | Phone as a transmitter | Using a phone as an extra transmitter is not built. | build |
| `jarvis.senses-rti` | `senses.presence` | R | Room tomography | A coarse region of motion in the room, never a position or a pose, is not built. It needs more links and a passed readiness check. | hardware |
| `jarvis.away-mode` | `room.rules` | C | Away mode | Away mode would watch for motion only. It cannot see a still person, so it is not a security alarm. Off until you decide. | decision |
| `jarvis.energy` | `room.rules` | C | Energy use | The energy view is built and not verified yet. Without a current sensor any figure is an estimate and will say so. | hardware |
| `jarvis.mode-schedule` | `room.rules` | R | Modes at set times | Modes that start at a set time are not built. A mode runs when you pick it or a rule fires. | build |
| `jarvis.wake-custom` | `console.connections` | D | Your own wake word | A wake word of your own is not built. The pretrained one is licensed for personal use only. | licence |

Notes: `jarvis.library`, `jarvis.reminder-alerts` and `jarvis.energy` stand for the orphan cards of Strand 0 (7.2) and D20; for these three the lamp is WAITING "built, not verified" (§12.4 table), the registry carries them with `state: 'unverified'`, the renderer draws the half disc and T7 still forbids an enabled button; their entries are deleted in the commit that mounts each card after its backend is confirmed live. `jarvis.mode-schedule` and `jarvis.memory-delete-all` are **assumptions to verify** in WP-B06 against what the Modes editor and the Yaadash keep and wrong buttons already do; if the feature exists the row is dropped, not kept. The phone adds one JARVIS row, `jarvis.phone-twin` (`phone`, D, "The spatial twin stays on the desktop. The phone lists each reading as measured or not measured.", build). Wall box channel 7 and 8 style absence is WAITING "not wired", never a registry row.

**Well Wisher.** The 28 existing entries carry over unchanged (ids, lines, `needs`, `built` flags), re-homed by the table in 12.3. New rows:

| id | home | pattern | label | line | blocker |
|---|---|---|---|---|---|
| `ww.coach` | `study.library` | C | Coach | Coach drafts and rewords your own notes. It is not built, and it never grades or gives you numbers. | build |
| `ww.review-cards` | `study.practice` | R | Spaced review | Spaced review of cards is not built. Practice papers work now. | build |
| `ww.focus-hours` | `day.week` | C | Hours you finish sessions | A strip of the hours you actually finished sessions is not built. It will show counts, never a prediction. | build |
| `ww.study-lights` | `focus.start` | D | Study lights | Study lights through the room need JARVIS and your tap. Not built, and off by default when it is. | build |
| `ww.phone-block` | `phone` | D | Block on the phone | Starting a block from the phone is not built. The Today page on the phone works. | build |
| `ww.rest-sounds` | `focus.rest` | R | Rest sounds | Sounds for a rest are not built. A silent rest works now. | decision |

Existing entries that map to `jarvis`-looking features (`yaadash-link`, Yaadash staging folder) keep `product: 'ww'` because the writer is Well Wisher's; the reader is JARVIS's and stays "not built here" as today.

### 12.7 Lifecycle in one paragraph

An entry is added in the same commit that adds its home chip or plate, never before. A feature work package (WP) that ships the feature deletes the entry, adds `data-feature="<id>"` to the live control, and the stale test then passes only if the entry is gone. A WP that changes what a feature needs edits `needs` and `reviewBy`. A phase boundary review (the integrator) reads the "entries past review" report, and records deletions and re-dates in `docs/research/product-design-overhaul.md` under a dated section.

---

## 13 AI, personalisation and local learning loops

### 13.1 Principle and the UI contract for any model-backed control

Principle (Strand 5, "What this changes" 8): a model appears only where it beats a rule on this user's data volume, and any model-backed control shows its state (`MODEL`, `DEFAULT`, `RULE`, `OFF`) and what it saw. A planned model shows as a PLANNED plate, never as a fake meter. All facts below are from Strand 5 unless marked target or assumption.

**The UI contract for any model-backed control.**

| Element | Rule |
|---|---|
| State chip | `MODEL` (written by a model), `DEFAULT` (default parameters), `RULE` (a transparent formula), `OFF` (owner switched off). Mono, 12 px, next to the control |
| What it saw | A "Based on" line that names the inputs (note titles, counts) and links to them; never raw private text in a tooltip |
| Lamp | Model not loaded yet: WAITING "no report". Failed to load or timed out: FAULT with the reason, and the rule fallback text shows. Never a spinner that lasts: 20 s timeout (target) then fallback |
| Fallback | Every model-backed control has a rule-only text so the page never depends on a loaded model |
| Switch | A per-feature switch in `settings.data` ("Things that learn or draft") and a global "Rules only" switch |
| Never | A model grades, gives a numeric answer, states a probability of passing, or writes a progress claim |

### 13.2 FSRS spaced review

| Field | Content |
|---|---|
| Where | `study.practice` (a "Review today" row, appears only when cards exist) and `proof.panel` (due count). Planned entry `ww.review-cards` until built |
| User value | "What to revise today" with fewer reviews for the same recall. Strand 5: FSRS-6 log loss 0.3460 on 9,999 collections; the plain average baseline 0.3945; the 20 to 30 % fewer reviews than SM-2 is simulation, so the UI makes no efficiency claim |
| Inputs | Per card: review time and grade (again, hard, good, easy). Nothing else |
| Privacy boundary | A local file under the Well Wisher data folder (`ww/*` namespace). No network. Card text never leaves the machine |
| Resource budget | Kilobytes of parameters; milliseconds per card on CPU (Strand 5). No VRAM. Optimiser runs only on request in the background, off the voice path |
| Failure mode and UI when wrong | Optimiser over-fits on few reviews (fitted parameters beat defaults for only 84.3 % of collections). Use defaults until about 1,000 reviews (community norm, unsourced: assumption) and show the chip `DEFAULT` or "fitted to N reviews". A due list that feels wrong: one-tap "Not today" hides a card for the day, no learning from it |
| Opt-out | Switch to "fixed intervals" (a plain ladder). Desired retention is the one slider, range 70 to 97 % (Anki range, Strand 5), start 90 % (assumption: the common default, not benchmarked) |
| Verdict | **Model, tiny and transparent.** FSRS is the only learned scheduler; SM-2 is never a product choice. Library install needs the owner's OK |

### 13.3 Voice activity detection and wake word

| Field | Content |
|---|---|
| Where | `core.talk` (listening indicator, last-heard strip), title-bar Voice lamp, rail Ask orb (mic state), `console.health` (hearing line, as built) |
| User value | Hands-free voice that shows when it hears. Already shipped (Silero-style VAD in the endpoint path, `openwakeword==0.6.0` for the wake phrase); the new work is visibility |
| Inputs | Microphone audio, in memory only; only the level, the VAD probability and a trigger flag leave the voice process (as built) |
| Privacy boundary | Audio is not stored by default. The last-heard log keeps the transcript text of what triggered a turn and the time, in the existing transcripts store; it never keeps audio. A visible "listening" dot whenever the mic is open |
| Resource budget | Silero VAD v5: 189 us per 31.25 ms chunk on one CPU thread (Threadripper figure; a laptop is slower, margin two orders of magnitude); about 2 MB. Wake word: one Pi 3 core runs 15 to 20 models. CPU "about 1 % of a core" is inferred, not measured on the target laptop: WP-R01 measures it |
| Failure mode and UI when wrong | False accept: the turn appears in "last heard" marked "woke on: <heard text>" with a Wrong flag (the Wrong flag exists per turn). False reject: the existing "he did not hear you" view in `console.health`. Lamp WAITING if no level arrives |
| Opt-out | A **Mute** state in the rail: "mic muted in software" (honest label: it is software, not a hardware switch). Voice off leaves text mode |
| Verdict | **Model, keep.** The Silero LICENSE file must be read before any sale (the README badge text and the stated licence disagree; Strand 5). openWakeWord's pretrained models are CC BY-NC-SA 4.0: personal use only; flagged as `jarvis.wake-custom` (licence) and F9 |

### 13.4 Local 4B drafting model (Coach)

| Field | Content |
|---|---|
| Where | `study.library` (planned `ww.coach`), later the `memory.recall` "summarise these excerpts" action. The existing voice conversation already uses the same model; this adds no new engine |
| User value | Rewording and summarising notes the student wrote; Hinglish conversation. Not grading, not computing. Strand 5: a small model is fine for rewording notes, risky for checking answers; sub-2B models showed confident wrong maths |
| Inputs | Retrieved notes the student selected, and the student's text. Retrieval first: the project's own diagnosis was that context, not the model, was the defect |
| Privacy boundary | Local only (Ollama on the machine). No cloud call with private notes. Output labelled "written by the local model from these notes" with the source notes linked |
| Resource budget | Measured by the project: Qwen3-4B-Instruct-2507, about 50 tok/s, 2.9 to 3.3 GB VRAM, first token 0.6 s. The card is 2.5 GB (Q4_K_M). Whisper large-v3-turbo shares the 6 GB GPU: the two together are **not measured**, so WP-R01 records VRAM with both loaded. Target: total VRAM at most 5.5 GB including the desktop compositor (assumption); the model is loaded on request and one request runs at a time; it unloads after idle (assumption: 5 minutes) and a request is refused with FAULT "model busy" when free VRAM is under a floor (assumption: 1 GB, set from R01) |
| Failure mode and UI when wrong | Fluent but wrong. Every output carries the chip `MODEL`, the "Based on" links and an "Edit" action; the text is a draft, never auto-saved. If VRAM is short or 20 s passes: FAULT "model busy" plus the rule fallback (the notes' own first lines). No scores, no pass-or-fail, no numerical answers |
| Opt-out | Per-feature switch and the global "Rules only" switch; with it on, Coach shows its PLANNED plate text changed to "off in Settings" (WAITING) |
| Verdict | **Model, narrow and labelled.** Build after the UI/UX remap (WP-B12; it is a feature, so it waits for the remap by decision I33, not for any exam date) |

### 13.5 Embeddings for Hinglish memory (after an A/B)

| Field | Content |
|---|---|
| Where | `memory.recall` (search mode chip `words` or `meaning`) and the model-backed prompts above |
| User value | Finding a note written in Romanised Hindi or mixed language. The current `bge-small-en-v1.5` is English-only (33.4 M parameters, MTEB 62.17), so Hinglish works by subword luck |
| Inputs | The owner's notes and queries, locally |
| Privacy boundary | Local LanceDB; the A/B test set is built from the owner's private notes and lives under `data/notes/research/` only (never in the public repo) |
| Resource budget | CPU: bge-small 33.4 M, multilingual-e5-small 118 M (384-dim, 512 tokens), BGE-M3 (MIT, 8,192 tokens, 1,024 dims) optional. e5 needs `query:` and `passage:` prefixes (documented usage, not re-verified) |
| Failure mode and UI when wrong | A missed Hinglish hit. Always show top-k with scores and the visible fallback "search by words"; a result list never hides keyword hits. Code-switching can cost up to 27 % retrieval (CS-MTEB, English-Chinese and English-Japanese, not Hinglish) |
| Opt-out | Keyword mode switch in `memory.recall` |
| Verdict | **Model, only after a local A/B** (WP-R03): 50 to 100 query and note pairs written by the owner, compare three models by recall at k, decide with the owner. No swap before the result. If bge-small wins or ties, keep it |

### 13.6 Rules (not models)

**Topic proficiency.**

| Field | Content |
|---|---|
| Where | `study.papers`, `tree.tree` inspector, `proof.panel` |
| User value | An honest "how solid is this topic" |
| Inputs | Marked paper per-topic outcomes and flashcard grades. Reuse the existing proficiency EWMA in `ww_generator.py` (NOW.md, 8 Nov): extend, do not rewrite |
| Privacy | Local |
| Budget | Negligible |
| Failure and UI | Few answers are noisy: show a bar with a confidence tail and the count n; below n = 5 (Strand 5) grey it and label "too few answers". The EWMA smoothing factor stays as built (no new tuning) |
| Opt-out | Hide meters (Settings, appearance) |
| Verdict | **Rule.** No BKT or DKT: a single student gives tens to low thousands of events, below where deep models win (Strand 5, 2) |

**Next action (the card on `day.today`, the Now strip and the phone Now).**

| Field | Content |
|---|---|
| Rule | `score = nearness x gap x weight`, with: nearness = 1 / (1 + days to the paper), printed on the card as "paper in N days" (the card and its copy never say urgent, urgency or overdue); gap = 1 - proficiency, or 0.5 and the label "not measured" when n < 5; weight = the topic's share of the paper's marks. The shape is an **assumption** reviewed with the owner on five real cases (WP-V01); the terms are printed on the card |
| Due cards | FSRS due count is shown as a separate chip, not multiplied into the score |
| Inputs | Dates, paper pattern, proficiency, free minutes in the gap (from the timetable) |
| Privacy | Local; pure function, `ww_check` runs it twice for purity |
| Failure and UI | A wrong ranking: the card shows its three terms, a one-tap "Not this" (hides it for the day; does **not** train anything), and "Choose another" |
| Opt-out | "Plan by hand": the card is replaced by the student's own first start (If-then plan, §2.4 U1) |
| Verdict | **Rule.** No published evidence that a learned ranker beats a deadline-weighted rule at single-user scale; a bandit needs hundreds of decisions per context and a student makes about one per day (Strand 5, 4) |

**Energy and best hours.**

| Field | Content |
|---|---|
| Where | `day.week` (planned `ww.focus-hours`) |
| Rule | A descriptive strip: for each three-hour band (target), counts of sessions started and sessions logged complete in the last four weeks (target window). Text such as "4 of 5 sessions started before 11:00 were logged" appears only when a band has at least 5 sessions (assumption: same floor as proficiency) |
| Never | A prediction, a score, "best time for you", or colour that reads as good or bad. Counts only |
| Opt-out | Pause logging; delete the strip data (13.7.2) |
| Verdict | **No predictor; descriptive statistics.** Prediction papers are population-level with small samples and would read as a judgement (Strand 5, 3) |

### 13.7 Local learning loops

Only loops that are local, consentful and truthful (owner brief; §2.4 TEST). Nothing leaves the machine; no analytics SDK, no external endpoint. These are the student's own records shown back to them, not evidence.

#### 13.7.1 What is measured, shown, and turned off

| Loop | Measured (counts and times only; no text, no audio) | Shown where | Default | Turned off by |
|---|---|---|---|---|
| L1 Resume | Taps on the Resume pill: "Pick up" versus "Drop it", and whether the picked item got opened | `settings.data` line: "You picked up N of N suggestions" | Off | Per-loop switch |
| L2 Start rate | For each If-then plan: planned, started within 10 minutes of the cue (target window), not started. Never "failed" | `day.week` quiet line | Off | Per-loop switch; or leave plans unused |
| L3 Timer style | The chosen style (disc, bar, none) per block and the student's one-tap self-report after a block ("How did that feel: calm, neutral, tense"), asked at most once per week and never after a decline | `focus.session` settings popover | Off; the question appears only if the loop is on | Per-loop switch; declining stops the question for good |
| L4 Cue wording | Alternate two wordings week by week (plan echo versus generic); count starts per wording | Settings, with both totals and "this is one person, not evidence" | Off | Per-loop switch |
| L5 Tiny start | Whether starts happen with the "Tiny start" label on or off; not whether tasks finish | Same strip as L4 | Off | Per-loop switch |
| L6 Voice quality | Wake-to-reply timings (as built, 7 days), Wrong and Misheard flags per turn, false-accept count | `console.health` (as built) plus a flag count | On (functional, already built) | Clear in `console.health` |
| L7 Model state | Which model or rule answered each model-backed control, load failures, timeouts | `console.health` "Models" row | On (functional) | Clear in `console.health` |
| L8 Performance | Frame time p95, idle CPU sample, memory growth from the WP-R01 probe, when run | `console.health` row, last run date | Off until run by hand | Delete the report file |
| L9 Planned interest | A local tally of how often each planned control was opened | `settings.data` only, as a plain table; never on a planned row and never in the "What is coming" overlay (a placeholder has no count, §12.1, and a count there reads as engagement nudging) | Off | Per-loop switch |

The T-tests of §2.4 map to L1 (T1 is a view over L1 and the logged days), L3 (T3), L4 (T5), L5 (T6). T2 (body-double presence) is not built (F11 default). T4 is not a loop: the progress art shows real totals and nothing else.

#### 13.7.2 Rules for every loop

1. **Consent in context, once.** The loop's first opportunity shows a one-line card: "Keep a local count of <thing>? It stays on this machine. You can see it and delete it in Settings." Choices: Keep a count, No thanks. No thanks is permanent for that loop (rule N3: no re-asking). There is no setup gate on first run (§3.5).
2. **Visible.** `settings.data` has a group "What this app notes about how you use it": one row per loop with its last-30-day summary (counts, `n`, window), **Show data** (a plain table), **Export** (CSV), **Delete**, and the switch. A master switch "Learn nothing" turns every L1 to L5, L8, L9 off and deletes nothing; **Delete all** deletes everything and confirms with a plain sentence.
3. **Truthful.** Every summary prints `n` and the window ("n = 7 blocks, last 28 days"). Below n = 5 it says "too few to say" and shows no ratio. It never uses the word "improve", never compares to other people, and never shows a streak or a loss. Totals only go up (U2).
4. **Local only, enforced.** Storage: the server's existing key-value routes (assumption: confirmed in WP-B11), else one new route; files under the data folder, namespace `ww/learning/*` and `jarvis/learning/*`. A vitest test fails if the learning module imports `fetch` to any host other than the app's own origin, or if any loop record contains a string field longer than 40 characters (blocks accidental text capture).
5. **Retention.** Raw events are kept 90 days (target) and then rolled up into weekly counts; the student can shorten this in the group.
6. **No coupling to nudges.** A loop never raises the frequency of reminders or check-ins. The three-batched-check-in cap (U3) is independent of every loop.
7. **Quiet wins.** The Quiet switch (§2.4) silences the loops' own consent cards.

---

## 14 Engineering feasibility and performance budgets

### 14.1 Budget table

"Today" values are from S0 section 5 (the dist built 2026-11-10 from `ff1e480`) or are marked unmeasured. Every Target is a target or an assumption until a baseline run on the real WebView2 window (F8); the first run records, then these become hard failures. The idle rows include both pieces that may move continuously: the voice hill while audio flows and the Senses orbits while motion energy is non-zero.

| Area | Today (S0) | Target | Test that enforces it |
|---|---|---|---|
| Idle CPU, focused, no audio, no animation, JARVIS asleep | unmeasured | at most 1 % of one core, 60 s average (S6) | **Sandbox-measurable, main thread only:** `e2e/budget-idle.spec.ts`: CDP `Performance.getMetrics` TaskDuration delta over 60 s on the sandbox instance (port 8790); nightly. **Real-window only (Q02):** the GPU row (Task Manager or CDP Tracing, because TaskDuration excludes the GPU) and the awake case below |
| Idle CPU, JARVIS awake with wake word and VAD | unmeasured | at most 6 % of one core (assumption, from the Strand 5 figures) | **Real-window only (Q02):** the sandbox runs with no core autostart, no Aankhen and no phone listener, so it cannot see the wake word, VAD, the 20 Hz event path or the twin with real CSI |
| Idle GPU, focused, nothing animating | unmeasured | no sustained GPU use from the app (assumption: under 2 % in Task Manager) | **Real-window only (Q02)** |
| Idle CPU, hidden or minimised | unmeasured; pre-existing timers: clock 1 s, vitals 2 s, health 5 s, Aankhen 2 s, crew 2 s, media 5 s, and an infinite `.led` keyframe | 0 rAF; no timer under 1 s; polls pause (10.6); the `.led` keyframe becomes a static lamp | `e2e/budget-hidden.spec.ts`: emulate hidden, assert zero loops and zero DOM writes from bus events over 10 s; manual minimised check |
| Voice stage while speaking | no output level exists | draw average 3 ms, p95 6 ms; page frame p95 at most 16.7 ms; CPU at most 6 % of one core | **Sandbox, report-only until R01:** a Playwright performance trace over 10 s of injected 20 Hz frames (a sandbox `--fake-voice` mode replays a recorded frame fixture through the real bus path, stamped SIMULATED) reading `ScriptDuration`, `LayoutDuration` and per-frame rAF times, which includes the 3,072-rect canvas draw (the old maths-only bench timed no draw); headless Chromium is software-rastered, so the absolute number is a real-window session |
| Frame time, other live renderers | Aankhen twin unmeasured | no worse than +15 % over three runs against the first recorded measurement (a +0 % rule cannot be tested without a baseline) | same harness, extended from `galaxy/bench.ts` (discards runs where `document.hidden` flips) |
| INP | unmeasured | at most 200 ms (lab, p95 of scripted interactions); no long task over 50 ms on route change or palette open | Playwright `PerformanceObserver` for `longtask` and `event` entries on scripted flows |
| Route transition | `switch` 520 / 600 ms | at most 200 ms (+50 ms tolerance) | `motion-route.spec.ts` (10.4a) |
| JS, initial route (entry plus first section) | entry 284 KB raw, 90.3 KB gzip; only Core in the entry | the entry chunk may grow at most 10 % against its recorded baseline (the 250 KB gzip figure of the first draft is dropped: against 90.3 KB today it is not a budget); voice code at most 12 KB gzip (assumption) | `bundle-budget.mjs` today is a regex scan with no per-chunk gzip, per-product or font logic, so B01 and B03 **write** that logic with a self-test; `app/ui/budget-baseline.json` does not exist yet and is created by R01 and B01 |
| JS, each lazy section | Limbs 55 KB raw, Study 92 KB, MissionRoot 154 KB (46.3 KB gzip), Frame 29 KB | at most 120 KB gzip each (S6 proposal) | same script |
| JS, Senses twin chunk | `Aankhen-*.js` 710 KB raw, 184.8 KB gzip (three.js) | at most 190 KB gzip, the only chunk above 120 | same script, named exception |
| JS, whole product build | 2,337,477 B across all chunks (JS total) | `VITE_PRODUCT=ww` has no `three`, no `jarvis/` module; `jarvis` has no `ww/` module | import-graph vitest plus `no-restricted-imports` (§1.4) |
| JS, big data | `bank-*.js` 309 KB raw (question bank), `katex-*.js` 264 KB (lazy) | stays out of the entry chunk; the bank loads on demand | `bundle-budget.mjs` (katex check exists; add the bank) |
| CSS | entry CSS 100.7 KB raw (24.3 KB gzip); `Frame-*.css` 28.7 KB | shared tokens and kit at most 30 KB gzip; each section's CSS at most 12 KB gzip and lazy (assumption) | `bundle-budget.mjs` reads the built CSS |
| Fonts | 17 non-KaTeX woff2, 353 KB (Inter latin-ext 85 KB, latin 48 KB, Anton, Geist Mono, Doto) | Inter variable (latin), Geist Mono, a digits-only Doto subset (§6.3 and D21): at most 3 families, at most 5 woff2 files, at most 150 KB total, `font-display: swap`, local only; Anton dropped; KaTeX fonts stay lazy | unit test scanning built CSS for `@font-face` format, `font-display` and a size assertion on `dist`; the digits-only Doto subset needs a subsetting tool that is not in the venv, so B03 asks the owner for one (rule "ask for installs") |
| Images | not inventoried | no raster over 200 KB on a route (S6); derived art is SVG, CSS or a 1-bit dithered PNG; art sized to display size at 2x; at most 400 KB of art per section (assumption) | build script lists assets by route and fails over budget |
| ASCII files | none | at most 8 KB raw each, 4 per section, 40 KB raw total (10.5) | the same script, by extension `.ascii.txt` |
| Animated properties | the `rise` keyframe still animates `filter`; 32 `backdrop-filter` declarations in 12 CSS files | none; no `backdrop-filter` anywhere; at most 8 `will-change` | `css-lint.test.ts` (extended from `ww/` to all of `src/`) |
| Reduced motion | about 28 files handle it; four implementations of the hook | one `useReducedMotion`; with `reduce` emulated, `document.getAnimations()` is empty and no rAF after 1 s | `motion-reduced.spec.ts` extended to every section and the phone |
| Memory | unmeasured | renderer heap growth under 10 % over a 30 min scripted soak (S6); a snapshot cost budget for the route transition of 7.5 MB at 1366x768 (computed, 2.4) | `e2e/soak.spec.ts` via CDP heap counters (nightly, sandbox); manual Task Manager check in the real window |
| WebGL | `ww/` has none (enforced); Aankhen has three renderers | one context, only under `jarvis/senses/` and `twin/**` (until moved), disposed on leave | `bundle-budget.mjs` (10.7) plus an e2e that counts live contexts after leaving `senses` |
| No-scroll canvas | claimed for Well Wisher (`d2ea2e3`); JARVIS pages all scroll (`.page overflow:auto`) | every view at 1366 x 768 and, for views that declared a T720 column, 1366 x 720, `scrollHeight <= innerHeight`, in both products; at 1280 x 720 and 1280 x 680 no unreachable control | `no-scroll.spec.ts`, one entry per `section.view` id (§3.2) |
| Text size and spacing | untested | no clipped text at a 200 % root font size and with the WCAG 1.4.12 text-spacing overrides (§4.1.2) | `text-spacing.spec.ts`, per view |
| Contrast | `tokens.test.ts` recomputes WCAG ratios for Well Wisher | all text 4.5:1, all boundaries, states and focus 3:1, both themes and the `more` set; axe-core per route | token unit test over every declared pair; axe in Playwright |
| Forced colours | zero handling | every control has a border or outline | `forcedColors: 'active'` Playwright spec (11.6) |
| Targets | 44 px hit areas tested (WW) | every route, both products, phone | `hit-areas.spec.ts` extended to JARVIS and the phone |
| Reflow | untested | 6 viewports in 11.1 | `reflow.spec.ts` |
| Keyboard | Well Wisher keyboard spec exists | §3.4 and §11.2 | `keyboard.spec.ts`, `keymap.test.ts` |
| Voice signals | none | §9.13 | Python and vitest and `voice-hill.spec.ts` |

### 14.2 What exists, what is missing, what must be removed (feasibility)

| Item | State today | Work |
|---|---|---|
| Event bus path for a 20 Hz ephemeral event | exists (`level` is ephemeral, suppressed from the ticker at `store.ts:158`) | add `out_level` to the same suppress list; no new infrastructure |
| Mic path | exists (`jarvis.py` two call sites) | add `Emitter`; raise the cadence from 12.5 to 20 Hz |
| Output path | PCM exists, nothing emitted | `core/levels.py` plus one hook; Kokoro and pygame `_play_file` path may stay NO SIGNAL at first |
| Governor | exists for Well Wisher (`governor.ts`, 32 lines), none for JARVIS | move to `shared/`, drop the glass-tier input, add the activity gate and loop registry |
| View Transitions | exist (`motion.tsx switchView`, `ww/design/motion/transition.ts`) | unify on `shell-canvas`; shorten to 200 ms; replace `.main { view-transition-name: page }` blur (220 out, 560 in with `filter: blur(8px)`, S0) |
| Host `IsVisible` | not wired | `JARVIS.pyw` change, owner's OK |
| Forced colours, `prefers-contrast` | zero | new layers in the shared CSS |
| Keymap | two places (`Shell.tsx useHotkeys`, `ww/frame/Frame.tsx`) | one `shell/keymap.ts` |
| Fonts | 4 families, 353 KB | subset and drop (D21) |
| Phone tokens | three inline palettes | generated `phone_page/tokens.css`; the phone reads the governor |
| Dead weight | MemoryGalaxy, GrowthChart, `galaxy/*`, RelayWiring, Uno leftovers | delete (D19), which also removes a three.js consumer |


### 14.3 Test layout summary

Playwright runs two colour-scheme projects, `colorScheme: 'light'` (clay-light is the default look) and the default dark. `app/ui/bench/`, `app/ui/validate/` and `app/ui/src/bench/**` are excluded from the Vite inputs (`vite.config.ts` lists only `index.html` and the product entries) and a vitest asserts it. E2e hooks (`__voiceTest`, `__loops`) are built into `dist-e2e-hooks`, never into `dist` or the `bundle:check` output.

| Layer | Files (proposed) |
|---|---|
| Python | `core/tests/test_levels.py` |
| vitest | `__tests__/jarvis/voice/{bands,voiceState,hillGeometry,placeholder,smoothing}.test.ts`, `__tests__/shared/{governor,activityGate,keymap,tokens,css-lint}.test.ts`, `__tests__/shared/import-graph.test.ts` |
| Playwright | `e2e/{voice-hill,motion-route,motion-reduced,budget-idle,budget-hidden,no-scroll,reflow,forced-colors,hit-areas,keyboard,soak}.spec.ts` |
| Scripts | `scripts/bundle-budget.mjs` (extended), `budget-baseline.json` |
| Manual | the WebView2 checklist in 14.6 |

### 14.4 Research record

Every measurement from the real-window session (F8), the band-window tuning for the microphone, the AnalyserNode check and the Canvas 2D point-count test is written to `docs/research/voice.md` as a dated section (project rule), with the question, numbers, sources and what it changed.

### 14.5 Phasing for the voice and motion work

1. Shared shell pieces first: frame bus, loop registry, activity gate, governor move, keymap, route transition at 200 ms (these unblock everything and are testable without audio).
2. Voice stage at Tier 0 (existing `level`), with all states, placeholder, reduced form and the V and E tests.
3. `core/levels.py` and the two hooks (needs the owner's decision F7), then Tier 1.
4. Real-window measurement session; freeze point counts and budget numbers.
5. Tier 2 (window audio).

### 14.6 Manual WebView2 checklist (items automation cannot prove)

Real window on the owner's laptop, scratch data dir, not the live app: Ctrl+1 to 5, Alt+0, Alt+Left, Ctrl+Shift+Space behave as specified; `AnalyserNode` on the voice preview and the media element returns non-zero bands; minimise and restore stop and restart the loops (CPU in Task Manager); idle CPU after 60 s; occlusion by another window; Narrator and NVDA scripts in 11.5; Windows contrast themes; 200 % and 400 % zoom with Ctrl+plus; battery saver on.

---

## 15 Implementation roadmap and work packages

### 15.1 Principles

*Superseded in part by 15.6 and D-V2-22 (waves replace "at most two in flight").*

- **Ordering principle (2026-11-12 evening, I35): build for scale.** Shared, most reusable layers first (tokens, kit, lamp, registry, shell, ports), then the sections on top of them (§15.2). The order of §15.4 follows it.
- **Phases are grouped, not gated (revised I36).** The groups are research (R), design validation (V), prototype (P), build (B) and verification (Q). Packages that only measure or validate (R01, R03, R04, V01 to V04, P01 to P03) run alongside the build and no longer block it; they gate only the flag flips and they revise the spec's numbers when they land. A build package waits only for the build packages it reads (its Depends column), for an owner answer it truly needs (X1 for B01), and for Q01 before a flag flips. Each package still ends when its exit evidence is recorded.
- **One integrator per phase** (a role, filled by one session). The integrator is the only one who merges, runs the gate at phase end, edits the shared parts of NOW.md, and records the phase in `docs/research/product-design-overhaul.md`. Other sessions deliver branches.

| Phase | Integrator (one session) | Why this one |
|---|---|---|
| R research | The programme chat that wrote this spec | Holds the context and the open questions |
| V validation | The programme chat, with the owner present | The owner's answers must be heard directly |
| P prototype | The UI-overhaul chat | Owns shell, tokens, `phone_page/index`, JARVIS pages |
| B build | The UI-overhaul chat (merges Well Wisher-owned WPs delivered by the Well Wisher chat as branches) | One merger, so no two chats race on shared files |
| Q verification | A fresh session that built nothing | Independence: no marking one's own homework |

- **No swarm.** At most one implementing agent per WP, at most two WPs in flight at once and only on disjoint file sets (checked against the "files owned" column). Agents default to Sonnet; WPs marked **Opus** are hard code (cross-process, state machines) and say so.
- **Stop rule.** If a target budget fails twice, the agent stops, writes the measurement in the research file and reports. It does not tune indefinitely.
- **Research record.** Every WP writes (or extends) one dated section in the topic file named in its prompt, with question, findings, numbers, sources and what it changed. Private material goes to `data/notes/research/`.

### 15.2 Priority, safety mechanics and what waits (rewritten 2026-11-12 evening; the exam freeze is removed, I33 to I36)

The owner's evening decision: the whole UI/UX overhaul is priority one. Exam features and relay and wall-box work wait until the UI/UX is remapped, then resume. It is a priority order, not a statement that the app is unused, so the app keeps working at every merge. The earlier "exam freeze" (a period in which the shell rewrite and the Well Wisher section flip were held back until after the papers) no longer exists, and nothing in this file waits for an exam date. The exam dates stay in the private `NOW.md`, where they schedule the exam features that resume after the remap; they do not gate any package here.

**Ordering principle: build for scale.** The shared, most reusable layers come first, because everything above reads them and a change there is cheapest before anything depends on it: tokens (B03), the seam and one navigation (B01, B05), the lamp (B04), the kit (B03b, B03c), the registry (B02), the art pipeline (B05b), the shell and the ports (B05). The ten sections (B06, B11, B06b) are built on top of them, one at a time, then voice (B07), phone (B09) and learning loops (B10). The sequence of §15.4 follows this order; where two packages touch the same files only one is in flight.

**Safety mechanics that stay, because they are about quality, not exams.**

| Mechanic | Rule |
|---|---|
| Flags for risky flips | `app.shell` and `ww.ia` default off. A flip is its own commit after Q01 passes, with the old path still resolving for one release. Additive work (B01 to B04) changes no existing rule and keeps `e2e:shots` baselines unchanged |
| The app works at every merge | Each package is green on the full test set before it merges (vitest at least 1223, Playwright at least 248, the gate). A package that cannot be made green on its own stays on its branch. Nothing merges half-built |
| No build into `dist` while the app runs | Never build into `app/ui/dist` while `JARVIS.pyw` is running; use `vite build --outDir dist-e2e` or a clean worktree. A rebuild with changed defaults happens only with the app closed and the owner's OK |
| Live-process changes behind an env flag | B07 changes `core/playback.py` in the live voice process. It ships behind the env flag `JARVIS_OUT_LEVEL` (default off) with an underrun test (P-4) and does not enter the live build until the owner restarts on purpose (a restart turns the relays off) |
| One integrator, two in flight | One session merges (§15.1); at most two packages are in flight, on disjoint file sets |

**What waits, and until when.**

| Work | Waits until | Why |
|---|---|---|
| Exam features: rules and FSRS (B08), Coach (B12), and any new Well Wisher study feature | The UI/UX is remapped (B11 merged, flips passed Q01) | Owner decision: UI/UX first |
| Relay and wall-box hardware work (bring-up, firmware, wiring guides) | The same point | Same decision. The UI side stays in scope: B06 draws all 8 channels, absent ones "unavailable" |
| Measurement-only packages (R01, R03, R04, V01 to V04, P01 to P03) | They do not wait and they no longer block the build: they run alongside it. They gate only the flag flips (V and Q) and revise the numbers (R01) when they land | A measurement cannot change the order of shared layers; where it changes a number the spec is edited then |
| Flipping `app.shell` and `ww.ia` | Q01 passing (and Q02 and Q03 for `ww.ia`) | Quality, not the calendar |

What the first draft of this section called the "R01 skippable" fallback is gone with the freeze; R01 is simply non-blocking, and R01-lite (sandbox only, no app restart) stays as the cheaper form.

### 15.3 Work packages

*Superseded in part by 15.6 (the wave plan and the 47 new packages).*

Legend: **Owner** is the chat that owns the files (NOW.md section 2). Files are paths; "new" means created by the WP. Exit evidence is a one-line summary; the full acceptance criteria and tests are in the matching appendix prompt A.n (single source, so they cannot drift).

**Phase R: research (integrator: programme chat).**

| WP | Scope | Depends | Files owned | Exit evidence |
|---|---|---|---|---|
| R01 | Baseline and decisions: measure the real WebView2 window (frame time, memory, idle CPU and GPU, VRAM with Whisper and the 4B loaded, wake and VAD CPU); record the owner's exam dates in the private notes only (they schedule the exam features that resume after the remap, not the programme); answer open questions F7 and F8; settle X1 (the one answer B01 needs); record the real maximised `innerWidth`, `innerHeight` and display scale (they decide T720 and class M, §3.3.1) and write the re-derived geometry back into §3.3.1 (B05 starts from the T720 floor and is not gated on it); build the egress register (§1.3.1); cheaper form R01-lite (sandbox only). **Non-blocking: runs alongside B03 and B01** | none | `docs/research/product-design-overhaul.md` (new dated section), `data/notes/NOW.md` (own lines), a scratch probe script outside `app/` | Table of measured numbers replacing "target" in the budgets; owner's answers logged |
| R02 | Voice output signal spike: prove an output RMS and a 24-band spectrum (the §9.2 band map) from `core/playback.py` at about 20 Hz with measured cost | R01 (F7 answered) | A branch of `core/playback.py`, `core/appio.py` (not merged), research file | Cost in microseconds per frame; verdict go or no-go |
| R03 | Hinglish retrieval A/B (bge-small, e5-small, BGE-M3) on a private 50 to 100 pair set | none | `data/notes/research/memory-retrieval.md`, a scratch script | Recall at k table; decision rule applied with the owner |
| R04 | Licence and claims register: Silero LICENSE, openWakeWord model licence, FSRS library licence, font subset licences; every public copy line checked against the say and do-not-say list (§2.5) | none | `docs/research/product-design-overhaul.md` (new section) | One table: component, licence, commercial use yes or no, action |

**Phase V: design validation (integrator: programme chat, with the owner).** Static HTML mocks from the spec, outside the production build: `app/ui/validate/*.html` (WP-V01 checks the Vite inputs exclude the folder). Single-user tests; each session at most 30 minutes (target) and skippable whenever the owner's time is needed elsewhere (then the spec's defaults stand and the skip is logged). **Non-blocking since the evening decision (I36): V01 to V04 run alongside the foundation; their results revise the spec through the decision log and gate the matching flag flip (V03 gates B03's visual sign-off, V01 gates `ww.ia`), never the start of a build package.**

| WP | Questions it answers | Method | Pass line (target) |
|---|---|---|---|
| V01 | Does the owner find the highest-value action in seconds on first run of each product? Can they resume after a gap in one tap? Do the 5 + 5 section names make sense (F1)? Is "Day first" acceptable (F5)? Does the next-action card's three-term rule rank five real cases as they would (13.6)? | Five tasks, think-aloud, taps counted on mocks | First run: primary action found in 10 s; resume in 1 tap; at least 4 of 5 ranked cases agree |
| V02 | Is every planned item unmistakably not live? Do the draft lines (12.6) read honestly? | Show 12 controls, half live and half planned, ask "is this working?" | Zero planned items judged live; owner approves or rewrites every line |
| V03 | Is the clay look legible with the real 3:1 edges? Does forced-colours and 200 % zoom still work on the mocks? | Computed ratios plus Edge forced-colours emulation plus zoom to 200 and 400 % | All text 4.5:1, all boundaries and focus 3:1; no loss of controls |
| V04 | Can the owner tell measured from decorative in the voice hill? Which variant (input only, state-only, with output level) | Three variants on mocks; owner labels each "measured" or "decoration" | Variant chosen; the "no signal" ring is read as "no signal" |

**Phase P: prototype (integrator: UI-overhaul chat).** Sandbox only: `app/ui/bench/*.html` plus `app/ui/src/bench/**` in the bench pattern already used for `galaxy-bench.html` and `twin-bench.html`; the sandbox instance (`python -m jarvis_app.ww_sandbox`, port 8790) for real data; never the live app. **Non-blocking (I36):** no build package depends on P01, P02 or P03; they probe and measure alongside the build, and P01 is dropped if the real kit (B03b) reaches the same checks first.

| WP | Scope | Depends | Files owned | Exit evidence |
|---|---|---|---|---|
| P01 | Bench shell (**throwaway**: a layout and legibility probe whose code production never imports; B05 does not depend on it, so two implementations cannot drift): clay tokens, lamp, rail, title bar, product switch, view switch, PLANNED plate and chip, forced-colours layer, at 1366x768 and 1366x720 with no page scroll | V01, V03 | `app/ui/bench/shell-bench.html`, `app/ui/src/bench/shell/**` | Playwright: 1366x768 and 1366x720 no scroll, 44 px targets, contrast table computed from tokens |
| P02 | Voice hill on the sandbox from a recorded frame fixture replayed through the real bus path (a sandbox `--fake-voice` mode, stamped SIMULATED, because the sandbox has no live microphone path) with the "no signal" state; Playwright performance trace (the real input level is measured only in Q02) | V04, R01 | `app/ui/src/bench/voice/**` | p95 frame time and idle CPU measured, against the budgets in 15.5 |
| P03 | `day.today` plus Resume pill reading real Well Wisher stores (read-only) on the sandbox | V01 | `app/ui/src/bench/day/**` | Tap counts: open to running block in 2 taps; resume in 1 |

**Phase B: build (integrator: UI-overhaul chat).** Flags: `app.shell`, `ww.ia`. The order of work is §15.4 (the shared foundation first, then the sections on it); the rows below keep their package numbers and say what each depends on. The package to start now is B03.

| WP | Scope | Depends | Owner and files | Model | Exit evidence |
|---|---|---|---|---|---|
| B01 | Seam cuts S1, S2, S4, behaviour-preserving (the ports S5 and the one navigation S3 land with B05): delete Core MissionCard; mount FxLayer, GameFx, Dialogs only inside the `ww` root; re-scope `primitive.css` to the shared layer; ESLint `no-restricted-imports` plus a vitest import-graph test; `VITE_PRODUCT` builds. **Second package in flight beside B03, disjoint files** | X1 answered (the owner's one-line answer; not R01's measurements; gate: `NOW.md` section 2 has rows for `app/ui/src/ww/**`, `phone_page/ww.*`, `routes_phone_ww.py`, `core/playback.py`, `core/jarvis.py`, `core/appio.py`, `jarvis/**` and `shared/**`) | UI chat: `App.tsx`, `pages/Core.tsx`, `styles/design/primitive.css`, `scripts/bundle-budget.mjs`, `vite.config.ts`, new `shared/` skeleton | Sonnet | Both single-product builds contain no module of the other; full suites green |
| B02 | Registry v2 (§12): shared mechanism, 28 entries migrated, 13 JARVIS entries plus `jarvis.phone-twin`, overlay "What is coming", chip, tests T1 to T10. Foundation tier, after B03b (it reads the kit's plate and chip); V02's approved lines replace the §12.6 draft lines when available, and the draft lines stand until then | B01, B03b | UI chat: `shared/planned/**`, `shared/overlays/WhatIsComing.tsx`, `jarvis/planned.ts`; WW chat: `ww/plannedFeatures.ts`, `ww/Planned.tsx`, existing test | Sonnet | T1 to T10 green; no regression in the 28 existing entry tests |
| B03 | **Start now. Additive only:** tokens layers 1 to 3 as new attribute-scoped files, clay light and dark, `prefers-contrast`, `forced-colors`, focus ring, the new fonts added last (Inter, Geist Mono, digits-only Doto subset; the font step waits for the owner to grant a subsetting tool, X5, and nothing else waits for it); no font is removed and no existing rule changes until B13. Its own vitest test is the contrast oracle (every pair, WCAG formula), so V03 is not a dependency | none (runs in parallel with R01 and B01) | UI chat: new files under `styles/design/clay/**` and `styles/sections/**`, `__tests__/tokens.test.ts`, font config, `ww/design/themes/*` mapping (WW chat consulted); **not** `styles/design/primitive.css` (B01's) | Sonnet | Token contrast test computes every pair; `e2e:shots` baselines unchanged (the acceptance line for "behaviour-preserving"); new fonts measured, at most 150 KB in total after B13 (target) |
| B04 | The lamp and the state contract `{state, since, reason}`; "no number without a state" test; title-bar annunciators | B03 | UI chat: `shared/lamp/**`, hooks in `lib/store.ts` | Sonnet | Every widget that renders a reading takes a state; default WAITING |
| B03b | Component kit, families A and B (components 1 to 21 of §7.2 and §7.3) in dependency order (Lamp, Switch, Rocker, Key, Raised Pill, Readout, Numerals, Tick Slider, Segmented, Plate, then Panel, Frame, ReadoutLines, Console, Palette presentation, Toast, Telemetry Rail, Progress Bar, Dialog, Folder Tab Bar), the S7 kit move, and the §7.1 state-grammar tests | B03, B04 | UI chat: `shared/kit/**`, `jarvis/kit/**`, `ww/kit/**` (Well Wisher chat reviews moves out of it), `__tests__/kit/**` | Sonnet | Each component has a states test, a keyboard test and a forced-colours screenshot; `check_ids.py` green |
| B03c | Kit families C and D (components 22 to 38) and the shared art components (`NodeRing`, `Orbit`, `RingBars`, `Ridge`, `Callout`, `Spec`, `DotTimer`, `DateWheel`, `PillarsChart`, `WeekStrip`, `ASCII Sweep`, `StippleRing`, `Dither`, `ASCII Empty State`, `DotMatrixMeter`, `CellSkeleton`, `PlannedPlate`) | B03b | UI chat: `shared/art/**`, `shared/kit/**` | Sonnet | Same as B03b, plus a data-table fallback per component and no WebGL |
| B05b | Art pipeline: `tools/art/build_art.py`, recipes, `art-manifest.json`, the art-id resolver, both tracks, `--check` (sha256 determinism, byte budgets, track folders), the contrast script, `check_ids.py`, `count_assets.py`, `check_no_private_in_dist.py` | B03 | UI chat: `tools/art/**`, `app/ui/src/art/**` | Sonnet | `build_art.py --check` green; the customer track resolves no private-only id; no private hash in any `dist` that leaves the machine |
| B05 | Shell v2 behind `app.shell`: title bar, rail, product switch, Resume pill and record, command palette (Go, Do, Ask), real key table, view switch, `data-section` and `data-view` on every page root, the one navigation (seam S3: the dock and the workspace strip go) and the four ports with null adapters (seam S5); the rail, Ctrl+1 to Ctrl+5 and the view switches take their order from one binding table in the §3.1.2 order | B02, B03, B03b, B04 (P03 and R01 no longer gate it; it builds to the T720 floor of §3.3.1 and takes R01's measured geometry when it lands) | UI chat: `components/Shell.tsx`, `App.tsx`, `lib/store.ts`, `styles/shell.css`, `components/CommandPalette.tsx` | **Opus** | Palette hints come from one binding table; flag off equals today's behaviour (`e2e:shots` snapshot names unchanged, tolerance 0.1 % of pixels, assumption; vitest count at least 1223, Playwright count at least 248) |
| B06 | JARVIS sections in order `console`, `room`, `memory`, `core`, `senses` (look only, last; decision I10), whose step also moves `src/twin/**` under `src/jarvis/senses/` with the Aankhen chat's sign-off; orphan cards confirmed live, or shown WAITING "built, not verified", or kept PLANNED if not built; WallBox draws absent channels "unavailable"; RelayWiring and Uno leftovers deleted | B05 | UI chat: `pages/{Limbs,System,Connect,Yaadash,Core}.tsx` split into section views, `components/*`; Aankhen chat: `pages/Aankhen.tsx` look changes, `twin/**` | Sonnet | Each section fits T768 and T720 without scroll and declares its T720 column (§3.3.1); entries deleted as cards mount |
| B06b | Centrepiece packages, one per section in the order of decision I10, after B06 (JARVIS) and after B11 (Well Wisher): the art id, recipe, static and reduced-motion forms, caption and data-table fallback, plus the section's loaders and empty states, with the §8.3 rows as acceptance | B05b, B06 / B11 | UI chat; WW chat for the Well Wisher sections | Sonnet | Per section: no-scroll at T768 and T720, centrepiece at least 25 % of the view (§8.1), forced-colours fallback, `build_art.py --check` |
| B07 | Voice: output RMS and a 24-band spectrum from `core/playback.py` onto the bus, behind the env flag `JARVIS_OUT_LEVEL` (default off) with an underrun test P-4, not in the live build until the owner restarts on purpose; `VoiceHill`; listening dot, last-heard strip, software Mute | B05, R02, F7 | UI chat: `lib/store.ts`, `jarvis/voice/**`, `components/Reactor.tsx` replaced; core owner (decision X1): `core/playback.py`, `core/appio.py`, `app/jarvis_app/core.py` | **Opus** | Hill driven only by real levels; "no signal" when none; idle CPU within budget; the Core section is called done only after this WP |
| B08 | Rules and FSRS: FSRS scheduler and Review row, proficiency bar with n, next-action card and score terms, focus-hours strip. **Resumes after the UI/UX remap (I33): an exam feature** | B02, V01, and the remap (B11 merged) | WW chat: `app/jarvis_app/ww_fsrs.py`, `ww_nextaction.py` (new), `ww_check.py`, `ww/study/**`, `ww/life/**` | Sonnet | Pure functions run twice in the gate; fixtures reproduce the owner's five cases |
| B09 | Phone: generated `phone_page/tokens.css` (one file), two pages with clay light, motion rule, planned plates, `ww.phone-block` | B03, B05 | UI chat: `phone_page/{index.html,app.js,relays.*}`, tokens generator script; WW chat: `phone_page/ww.*`, `routes_phone_ww.py` | Sonnet | One palette; 44 px taps; Playwright phone specs green |
| B10 | Learning loops (§13.7): store, `settings.data` group, consent cards, tests | B05 | UI chat: `shared/learning/**`; WW chat for L2 to L5 hooks | Sonnet | The local-only and no-long-string tests green; each loop off by default |
| B11 | Well Wisher section map v2 behind `ww.ia`, in the rail order Day, Focus, Study, Tree, Career (§3.1.2): `day` (today, week, body, close), `focus.rest`, `study.practice`, Now strip, "moved to" hints; built right after B06, flips after Q01 | B05 (no exam wait; the next-action card of B08 plugs into `day.today` when B08 lands) | WW chat: `ww/**`, `ww/frame/**` | Sonnet | Legacy ids resolve (§3.2); 2 taps to a running block |
| B12 | Coach (local 4B), labelled drafting only. **Resumes after the remap (I33)** | B08, R01 (the VRAM numbers), and the remap | WW chat: `app/jarvis_app/ww_coach.py` (new), `ww/study/Coach*.tsx` | Sonnet | Every output chip and source link; rule fallback; VRAM within the measured budget; the model unloads after idle and a request is refused when free VRAM is under the R01 floor |
| B13 | Retire old layout, galaxy, GrowthChart, duplicate PhoneCard, and the Anton and latin-ext fonts; conditional embedding swap (only if R03 says so) | B11, owner OK | WW chat: `germoney/pages/**`; UI chat: `galaxy/**`, `components/{MemoryGalaxy,GrowthChart,PhoneCard}.tsx` | Sonnet | Dead code removal; bundle smaller; no entry in the stale report |

**Phase Q: verification (integrator: a fresh session).**

| WP | Scope | Depends | Exit evidence |
|---|---|---|---|
| Q01 | Contract sweep: full suites, gate, bundle budgets, no-scroll at 1366x768, 1366x720 and 1920x1080, class M reachability at 1280x720 and 1280x680, text-spacing and 200 % font passes, reflow at 320 and 683 px, keyboard-only flows, forced colours, `prefers-contrast`, zoom 200 and 400 %, `check_ids.py` and `viewCount.test.ts` | B05 on | A table of every budget (15.5) with measured value and pass or fail |
| Q02 | Real-window pass: WebView2 on the real laptop (idle CPU 60 s, minimised, soak 30 minutes), Narrator and NVDA checklist by hand; the two-week "moved to" check runs after the `ww.ia` flip as a follow-up row, not before it | Q01, owner time | Signed manual checklist file |
| Q03 | Privacy and claims audit: a whole-app network trace (not only loops and models) is checked against the egress register of §1.3.1, so the `memory.keep` statement can say "verified"; copy checked against the say and do-not-say list, planned entries past review, legal review of public copy flagged (F14) | Q01 | Go or no-go for each flag flip |
| Q04 | Customer-track quality gate: side-by-side of each centrepiece, private render against customer render (§8.6.3); commission status for sun, trunk and skyline; per-file human review and a licence line for every file in `generated/` (F14) | B06b | A table: each piece, the traits that must survive, pass or fail with the owner; until it passes the customer build is described as plainer than the reviewed one |

### 15.4 Sequence and recommendation

*Superseded in part by 15.6 (the wave order).*

```
Alongside the build, never gating it:  R01 (or R01-lite), R03, R04, R02 (gates only the merge of B07), V01..V04, P01..P03

FOUNDATION (shared layers, most reusable first; at most two in flight, disjoint files)
   B03 tokens, additive (START NOW)   ||   B01 seam cuts S1, S2, S4 (needs only the owner's answer to X1)
   -> B04 lamp -> B03b kit A and B -> B02 registry v2 -> B05b art pipeline -> B03c kit C and D
   -> B05 shell v2 behind app.shell, with the one navigation (S3) and the four ports with null adapters (S5)

SECTIONS (on the layers; each behind its flag, the app working at every merge)
   -> B06 JARVIS sections in the order console, room, memory, core, senses (I10) -> B06b (JARVIS)
   -> B11 Well Wisher section map v2 behind ww.ia -> B06b (Well Wisher)
   -> B07 voice (env flag) -> B09 phone -> B10 learning loops

GATES AND FLIPS
   -> Q01 -> flip app.shell -> Q02, Q03, Q04 -> flip ww.ia -> B13 retire the old layout

RESUMES AFTER THE REMAP
   -> B08 rules and FSRS -> B12 Coach -> exam features, relay and wall-box work
```

This is the one order table of the file (§5.8 points here). The package list in §15.3 keeps its phase grouping; this diagram is the order of work. The check that the order follows the ordering principle of §15.2: every package in FOUNDATION is a layer that at least two later packages read (tokens: kit, lamp, shell, every section; kit and lamp: shell and every section; registry: shell and every view with a planned home; shell and ports: every section), and no SECTIONS package starts before the shell it renders in exists. The one exception is stated: B07's Python half (`core/playback.py`) is independent of the shell and may be built early behind its env flag, but its UI half waits for B05.

**Start work package B03 now.** Reasons: (1) it is the lowest shared layer: every later package reads its tokens, so it is the cheapest place to be right; (2) it is additive, so it cannot disturb the running app (new attribute-scoped files, no existing rule or font changes until B13, `e2e:shots` baselines unchanged); (3) it needs neither a measurement nor an owner answer to begin: the contrast oracle is its own vitest test computing every pair with the WCAG formula, so V03's pairs are computed there; (4) it runs in parallel with R01. **Its files:** new files only under `app/ui/src/styles/design/clay/**` (layers 1 to 3, clay light and dark, `prefers-contrast`, `forced-colors`, focus ring) and `app/ui/src/styles/sections/**` (the ten section themes), the `ww/design/themes/*` mapping (Well Wisher chat consulted), `app/ui/src/__tests__/tokens.test.ts` and the font configuration. It does **not** edit `styles/design/primitive.css` (B01 owns that file for the re-scope, S4), which is what keeps B03 and B01 disjoint. The font step (Inter, Geist Mono, digits-only Doto subset) is the last commit of the package and waits for the owner to grant a subsetting tool (X5); the rest of B03 does not wait for it. The second package in flight is B01; the prompt for each is in Appendix A.

R01 stays valuable (every geometry and performance number is a target until it replaces it) but is no longer first and no longer a blocker: B05 starts from the T720 design floor (§3.3.1), the stricter tier, so it cannot be invalidated by a larger real window, and R01's measured numbers are written into §3.3, §3.3.1 and §14.1 when they arrive. Note for the integrator: attaching to the live window needs the app restarted with a remote-debugging argument (a WebView2 environment variable), and a restart turns the relays off, so R01 needs the owner's OK and a time when that is safe; the sandbox instance on port 8790 gives the software numbers meanwhile. Dates are not part of this file.


### 15.5 Budgets the verification phase enforces

The budgets enforced by work package Q01 are the single table in §14.1 (idle and hidden CPU, frame time, interaction latency, bundle and font sizes, contrast, targets, reflow, no-scroll); every number there is a target until R01 replaces it with a measurement. The roadmap part's own copy of that table is not repeated; where it differed (fonts: at most 2 families) §14.1 and decision I13 govern. Rows that exist only here:

| Area | Budget | Test |
|---|---|---|
| Planned features | Registry tests T1 to T10 (§12.5) | vitest and Playwright |
| Local only | Zero requests to non-app hosts from learning loops and models | Network trace in Q03 |
| Reflow depth | No horizontal scroll at 320 px and at 683 px (200 % zoom of 1366) except declared two-dimensional regions | Playwright (see §11.1) |


### 15.6 Wave plan of direction v2 (13 Nov 2026; governs 15.1 to 15.4 where they differ)

**Rewritten 14 Nov 2026 as two lanes (section 21; it governs this section where they differ).** State it was written from: waves 1 to 5 are merged; of wave 6, D01, D04 and L02 are merged and D02, D03, D05 and J01 are in review (wave 6 as run holds D01 to D05, J01 and L02); a craft pass on the clay recipe, the kit and the shell chrome (G05) is in progress. The old single-lane wave table is kept below as 15.6.1a. The plan now has **two lanes on disjoint files**: a UI lane (this programme chat; `app/ui` only) that brings the Study screens and the dashboards early, and an engine lane (the second chat, the existing Well Wisher chat; Python only) that starts with the exam generator's smallest slice. Each lane has waves of 4 to 6 packages; a wave depends only on earlier waves of either lane (through a route contract and a null adapter, never through a shared file); the integrator of a lane is its only merger.

**Why waves.** On 13 Nov the owner saw parallel branches break at merge and asked to see the new look inside the running application early. A wave is a set of 3 to 5 packages that own **disjoint files**, depend only on earlier waves, and start and merge together. The integrator is the only merger. Before a wave starts, every builder and every reviewer receives the wave contract table (Block C rule 13): one row per package with its id, purpose, owned files, the exports it adds and the exports of other packages it may import. Where this section and the older tables of 15.3 and 15.4 differ, this section governs.

**Already merged on main and reused, not rebuilt (waves 1 to 4):** B01 (seam cuts), B02 (registry v2), B03 (tokens), B03b, B03c (38 components in `shared/kit` and `shared/art`), B04 (`shared/lamp`), B05 (shell v2 in `app/ui/src/shell` behind the `app.shell` flag, with a New UI button in the current dock and a Classic UI button in the new title bar, `shell/flag.ts` `setShellV2`), B05b (`tools/art`, `app/ui/src/art`), `shared/motion`, the kit bench (`app/ui/e2e/bench`, 28 passing checks and 18 measured failures listed as known debt in `e2e/bench/known.ts`), the Python half of B07 (`core/playback.py` output level) and the voice component (`app/ui/src/jarvis/voice`, not yet mounted). Every package below imports these; none re-implements them.

**Nine rules that make the waves disjoint** (rules 8 and 9 added 14 Nov) (each is a test in 15.6.4):

1. **No barrel edits.** A package never edits an `index.ts` it does not own. Each new folder has its own `index.ts`, and consumers import the folder (`shared/data/numbers`), not a shared barrel.
2. **Registration by glob, not by edit.** N02 (wave 5) turns three central lists into globbed folders: `shell/views/*.view.ts` (each file exports one `ViewRegistration`: `{ id, product, load }`), `shell/slots/<slot>.<name>.tsx` (title bar sigil, boot, cursor root, notify), and `shell/modes/*.mode.ts` (palette modes). A section package owns the files it adds to those folders and never edits `shell/hosts.ts`, `ShellV2.tsx` or `ids.ts` after wave 5.
3. **Gallery by glob.** N01 (wave 5) globs `gallery/entries/*.tsx`. Every package adds exactly one file there, `gallery/entries/<package id>.tsx`, exporting `entry: GalleryEntry`. A package whose entry is missing does not merge (D-V2-23).
4. **Adapter slots.** A section package declares an adapter folder (`ww/day/adapters/`) and loads `adapters/*.register.ts` with `import.meta.glob`. A later engine package adds its own `<engine>.register.ts` there and nothing else. Until it merges, the section runs on a null adapter and shows WAITING; on the bench it runs on a fixture adapter stamped SIMULATED. This is how sections (waves 7 to 9) come before engines (waves 10 to 12) without a section waiting for an engine.
5. **Single-source tables are imported, never copied:** lamp states (`shared/lamp/types.ts`), tokens (`styles/design/clay`), section ids and view ids (`shell/ids.ts`), key bindings (`shell/keymap.ts`), art ids (`art/art-manifest.json`), the settings registry (`shared/trim`, from wave 7).
6. **One owner per server file per wave.** Nobody owns `app/jarvis_app/server.py` in the plan: `register_feature_routes` already imports every `jarvis_app/routes_*.py` and calls its `register(app, svc, bus)` (checked 14 Nov), so every engine package adds only a new `routes_*.py` file (the earlier plan gave E05 a discovery edit of `server.py`; it is not needed and is dropped, which also removes the one shared server file from EW7). A route file that raises at import is skipped with only a bus event, so each route file has a test that its paths answer.
7. **A shared file with two owners is a plan error.** If two packages of one wave need the same file, the integrator moves the need into one package or into an earlier wave before the wave starts. Disjointness is checked inside a wave: a later wave may edit or add files under a folder an earlier wave owned, but only the files its block names, and `tools/wave_check.py` checks that list.
8. **The lane rule (14 Nov).** An engine package owns only Python folders (`app/jarvis_app/**`, `core/**`) and their tests (`app/tests/**`, `core/tests/**`) and exposes routes with a documented JSON shape; the engine lane also owns `tools/engine/**`, `requirements/**` (edited by its integrator only), `docs/design/well-wisher-engine-plan.md` and its research file `docs/research/well-wisher-engine.md` (the engine plan file, section 3). A UI package owns only `app/ui/**`, `phone_page/**`, `tools/**` except `tools/engine/**`, and the design documents. `tools/wave_comms.py` (the board, on main) is the live check: a claim whose paths overlap another active package in either lane is refused, and its bulletin is pasted unchanged at the top of every agent prompt of both lanes. A UI package reaches a route only through an adapter file it owns (`ww/<section>/adapters/<engine>.register.ts`, loaded by glob), with a null adapter until the route exists; on the bench the adapter is a fixture stamped SIMULATED. An engine package never edits a TypeScript file and a UI package never edits a Python file. Checked by `tools/wave_check.py` (lane check, N03).
9. **Route contracts are written once** in `docs/design/well-wisher-engine-plan.md` (the file exists since 14 Nov, commit 8e0933a, with the conventions of its section 4: paths under `/api/mission/`, every success carries `state`, `reason` and `source`; the engine chat owns it and writes the contracts R-01 onward into its section 9 before EW7 starts; EW7 does not start until they are there), one section per route with its method, path, request and response JSON shape, error codes and the lamp state each answer implies. Both lanes read it from there; a Study port type in `ww/study/ports.ts` is derived from it, not written twice. A shape changes only by a dated entry in the plan file's "Changes" log, which the UI lane reads at the start of each wave. A UI route call that has no entry in the plan file fails a lint.

#### 15.6.1 The waves (two lanes, rewritten 14 Nov 2026)

**Why two lanes.** On 13 Nov the owner asked that the exam generator and the classroom connector come first among the features, and that the second chat build the logic while this chat builds the screens. The engine's first slice touches no UI file, so it runs beside the UI lane. A **slot** is one UI wave plus the engine wave beside it; the lanes meet at the end of a slot (the meet points are in 15.6.1b). Wave names: `UWn` is a UI wave and `EWn` an engine wave belonging to slot n; `UW5` and `UW6` are the older waves 5 and 6.

**UI lane** (this programme chat; `app/ui` only; 4 to 6 packages per wave).

| Wave | Packages | What the owner can look at when it merges |
|---|---|---|
| UW5 (merged) | N01, N02, G01, G02, G03 | The "What is new" gallery, the shell as it should behave, the clay recipe, the three grammars, the eleven centrepieces |
| UW6 (as run; 3 merged, 4 in review, 1 in progress) | D01, D04, L02 merged; D02, D03, D05, J01 in review; G05 craft pass in progress | The number forms, the Capture Line and the Trim keys; the series forms, tables and the specimen layout; Core with its pipeline ribbon; the refined controls, shadows and chrome |
| UW7 | L04, L01, Y01, Y02, DB01, DB02 | Today with the Day Arc and the Proof relief; the Life month calendar; the Paper Desk with import tray and Review Desk on a fixture; Focus with Drill; the countdown dots, Next Three and hand-off key; the Legend flip |
| UW8 | Y03, X03, C03, DB03, DB04, AD08 | Study plan and practice; the Blueprint Editor, generator and print; the Intake ledger and Manual Intake desk; Today's hand-off and Ahead; Exam Season; the first real adapters (the exam slice end to end) |
| UW9 | X06, L03, J02, DB07, AD09, T01 | The Pattern Loom and Variant Bench; the week, body, ledger and close views; Room; the Core glance strip; the intake and OCR adapters and the From Classroom fold; the Grove and tree |
| UW10 | J04, J05, T02, X08, DB09, DB05 | Memory; Console as a terminal; the Career views; the Exam Hall and Marking Desk; the Deck; the Week and Month Reviews |
| UW11 | J03, G04, X10, DB08, C08, AD10 | Senses; cursors, boot, route sigils and empty states; the Exam Room face with Readiness and Tonight; the System dashboard; the Connect Ladder, Link row, sync log and Delete sheet; the adapters for harvest, review queue, logs, intents and term |
| UW12 | E10, E11, E13, AD11, RW1, H01 | Trees one to ten; settings dissolved into Trim; the Calendar, reminders, evidence, Classroom sync and dashboard adapters; the rework wave; the desk frame |
| UW13 | E14, B09, B10, B12, AD12, H02 | The one-key links; the phone; learning loops; Coach; the career and coach adapters; the Term Ledger desk |
| UW14 (flag flip) | B13, Q01, Q02, Q03, Q04 | The old layout retired; the contract sweep, the real-window pass, the privacy and claims audit, the gallery pass |

**Engine lane** (the second chat; Python only; 4 to 6 packages per wave; it pushes main itself). Each wave is merged before the UI wave that needs it starts, and none of the UI packages above is blocked on it (null adapter).

| Wave | Packages | What can be tried when it merges (through the routes, before any screen) |
|---|---|---|
| EW7 (exam slice) | E05, E06, E07, E08, C01 | A paper dropped in the watched folder becomes crop-first questions; tags, families and patterns as counts; an inferred blueprint; a seeded practice paper and key as print HTML; the numeric checker; the intake parsers |
| EW8 | X04, X07, C02, HV01, E17, M01 | OCR of scans (RapidOCR on the GPU); variants and rubric drafts; the Intake store and routes; the harvester core with its manifest; the Classroom export import; the end-to-end exam-path test |
| EW9 | HV02, C06, E01, E02, X09, H03 | The harvester adapters; the shared Google OAuth core; intents and recurrence; the life logs; readiness, Tonight and the review queue; the term arithmetic |
| EW10 | C07, E03, E04, E09, DB11, JH01 | Classroom sync; reminder delivery; the Google Calendar link; the evidence ledger; the dashboard aggregations and Next Three; the voice study intents |
| EW11 | E12, B09p, B12p, JH03, JH04 | Career data with "checked on" stamps; the phone routes; the Coach model path; the notices read model; the GPU readings and loader refusal |

Engine reserve (not scheduled, 21.9): the backends of the reserve desks and JARVIS features. The engine lane has about 25 hours of slack beside the UI lane (21.2) and may take them first.

**Adapters.** Each engine wave is followed in the UI lane by the adapter package that registers its routes: AD08 (EW7), AD09 (EW8), AD10 (EW9), AD11 (EW10), AD12 (EW11). Until an adapter merges, the screen runs on its null adapter and shows WAITING.

#### 15.6.1b The meet points (checked by the integrator, never by feel)

| Meet | What has to be true on main | Check |
|---|---|---|
| A. Exam generator usable (after UW8 and EW7, with AD08) | The exam slice of 21.3.5 works end to end | One invented 6-question fixture paper goes through drop, review, bank, blueprint, practice PDF, key and marks in Playwright and pytest; nothing enters the bank unreviewed; a smoke test on one real paper |
| C1a. Classroom fallback, folder door (same as A) | A file saved into the watched folder reaches the Paper Desk | A fixture file lands as PENDING |
| C1b. Fallback complete (after UW9 and EW8) | Paste and calendar-file doors fill the Life month | 40 parser cases each; a deadline never changes a count |
| B. Every section visible (after UW11) | All ten sections and 36 views render behind the flag | `viewCount` 36; the section jury table |
| C2. Classroom live (after UW12, EW10) | Sign in, sync, rows, notches | Fake provider reaches five states; the owner's own sign-in |
| D. Flag flipped (UW14) | Old layout retired | B13's checks and the owner's OK |

#### 15.6.1a The single-lane wave table of 13 Nov (superseded by the two lanes above; kept for the record)

Wave 5 is first because the owner must see progress: the gallery shows every merged component in the running application on the day it merges, so each later wave is visible as it lands. Then the shared look and the most reused data components, then the sections (a JARVIS section and a Well Wisher section in the same wave wherever their files are disjoint), then the engines that give the sections real data, then verification.

| Wave | Packages (3 to 5) | What the owner can look at when it merges |
|---|---|---|
| 5 | N01, N02, G01, G02, G03 | A "What is new" place in shell v2 listing every kit, art, lamp and voice component in its states and the section themes; the shell as it should behave; the clay recipe with three elevations; the three grammars; the centrepieces rendering |
| 6 | D01, D02, D03, D04, D05 | Odometer, Trace, tables, dropdown rack, Capture Line, Specimen layout, in the gallery with fixtures |
| 7 | J01, J02, L01, L02, L04 | Core with its pipeline ribbon; Room with the guarded key and 24-hour ring; the Life month calendar; the Trim keys; Today with the day arc and the Proof relief |
| 8 | J03, J04, L03, Y01, Y02 | Senses terrain; Memory constellation; the week, body, spending and habit views; the Paper Desk; Focus with Drill |
| 9 | J05, Y03, T01, T02, G04 | Console as a terminal; Study plan, practice and the retention orrery; the Grove and tree; the five Career views; cursors, boot and route sigils |
| 10 | E01, E02, E03, E04 | Recurring reminders, logs for water, spending and habits, reminder delivery, the Google Calendar link |
| 11 | E05, E06, E07, E08 | The question engine: papers in, questions out, patterns as counts, the practice paper and the checker |
| 12 | E09, E10, E11, E12 | The evidence ledger, ten trees with 113 branches, Career data with "checked on" stamps |
| 13 | E13, E14, B09, B10, B12 | Settings dissolved into Trim; the one-key links between Life, Study, Tree and Career; the phone; learning loops; Coach |
| 14 | B13, Q01, Q02, Q03, Q04 | Old layout retired; the contract sweep, the real-window pass, the privacy and claims audit, the gallery pass |

47 packages in 10 waves of 5, 5, 5, 5, 5, 4, 4, 4, 5 and 5. Waves 1 to 4 are the merged foundation. The 77 lens packages of 20.13 are folded into these 47 (15.6.3).

#### 15.6.2 Owned files per package (disjoint within each wave; paths under `app/ui/src` unless stated)

| Pkg | Wave | Owns | Reads (earlier waves only) |
|---|---|---|---|
| N01 | 5 | `gallery/**` (collector, specimens moved from `e2e/bench/entry.tsx`, the entries of B01 to B07), `e2e/bench/entry.tsx` (reduced to a mount of `gallery`), `e2e/gallery.spec.ts`, `tools/wave_check.py` | shared kit, art, lamp, voice, motion |
| N02 | 5 | `shell/**` (except `gallery`), `ww/frame/**`, `styles/shell.css`, `e2e/shell*.spec.ts`, `__tests__/shell/**` | N01 default export `WhatIsNew` |
| G01 | 5 | `styles/design/clay/**`, `shared/kit/**`, `shared/lamp/**`, `shared/planned/**` (the registry plate and chip that must draw `PlannedGlyph`), `__tests__/kit/**`, `e2e/bench/known.ts`, `e2e/bench.spec.ts` | none |
| G02 | 5 | `shared/grammar/**` (sigil, ascii, term, `grammar.css`), `__tests__/grammar/**` | G01 tokens only through the CSS variable names listed in the contract |
| G03 | 5 | `tools/art/**` (recipes for the eleven centrepieces and the sigil tracer), `art/**`, the git-ignored private folder (not tracked) | none |
| D01 to D05 | 6 | one folder each under `shared/data/` and `shared/capture/` (see blocks) | G01, G02 |
| J01 | 6 (as run) | `jarvis/core/**`, `jarvis/handoff/**`, `pages/Core.tsx`, `shell/views/core.view.ts` | voice, G02, D01 |
| J02 | UW9 | `jarvis/room/**`, `pages/Limbs.tsx`, `shell/views/room.view.ts` | G01, D05 (RackRow) |
| L01 | UW7 | `shared/almanac/**`, `ww/day/month/**`, `ww/day/drawer/**`, `shell/views/day-month.view.ts` | G02, D01, D02 |
| L02 | 6 (as run) | `shared/trim/**`, `shell/modes/settings.mode.ts` | G01 |
| L04 | UW7 | `ww/day/today/**`, `ww/left/**`, `ww/proof/**`, `ww/frame/ProofRail.tsx`, `shell/views/day-today.view.ts`, `shell/views/proof-*.view.ts` | G01, G02, D01, D02, D04, D05 (not L01: no same-wave import) |
| J03 | UW11 | `jarvis/senses/**`, `pages/Aankhen.tsx`, `shell/views/senses.view.ts` | G02, D02 |
| J04 | UW10 | `jarvis/memory/**`, `pages/Yaadash.tsx`, `shell/views/memory.view.ts` | G02, D04 |
| L03 | UW9 | `ww/day/{week,body,ledger,close}/**`, `ww/life/**`, `shell/views/day-week.view.ts`, `day-body.view.ts`, `day-close.view.ts` | L01, D01 to D04 |
| Y01 | UW7 | `ww/study/papers/**`, `ww/study/review/**`, `shell/views/study-papers.view.ts` | G02, D02, D05 |
| Y02 | UW7 | `ww/focus/**`, `shell/views/focus-*.view.ts` | G02, D01 |
| J05 | UW10 | `jarvis/console/**`, `pages/System.tsx`, `pages/Connect.tsx`, `shell/views/console-*.view.ts` | D03, D04, D05 |
| Y03 | UW8 | `ww/study/{plan,practice,generator}/**`, legacy `ww/study/*.tsx`, `shell/views/study-plan.view.ts`, `study-practice.view.ts` | Y01, G02 |
| T01 | UW9 | `ww/tree/**` (UI, ports, art placement), `shell/views/tree.view.ts` | G02, G03 |
| T02 | UW10 | `ww/career/**`, `shell/views/career-*.view.ts` | G02, D03 |
| G04 | UW11 | `shared/grammar/cursor/**`, `shell/slots/{boot,titlebar-sigil,cursor-root}.*.tsx`, `shell/empty/**` | N02 slots |
| E01 to E04 | EW9, EW9, EW10, EW10 | server and adapter files, see blocks | sections of waves 7 to 9 |
| E05 to E08 | EW7 | `app/jarvis_app/ww_pyq/**` (one file each), see blocks | Y01 to Y03 |
| E09 to E12 | EW10 (E09), UW12 (E10, E11), EW11 (E12) | evidence, data and career stores, see blocks | T01, T02 |
| E13, E14, B09, B10, B12 | UW12 (E13), UW13 (E14, B09, B10, B12) | see blocks | all |
| B13, Q01 to Q04 | UW14 | see blocks | all |

**Owned-file corrections of 14 Nov (two lanes).** The rows above keep their `Owns` text except for these, which the lane rule forces: E01 to E04 own Python only (their `ww/day/adapters/*.register.ts` and `intents.ts` move to AD10, `jarvis/reminders/**` and `shell/slots/notify.reminder.tsx` and `ww/day/link/**` to AD11); E05 owns no `server.py` edit (discovery already exists) and no TypeScript (`ww/study/adapters/pyq.register.ts` moves to AD08, `ww/study/ww-gcr.planned.ts` to C08); E06 to E08 own their own `routes_ww_pyq_*.py` files; E09 owns Python only (`ww/tree/adapters/evidence.*` moves to AD11); E10 and E11 are UI-lane data files; E12 owns Python only (its adapters move to AD12); Y01 owns every Study port; Y03 gives `generator/**` to X03 and the library tab host to C03; B09's `routes_phone*.py` is the engine package B09p; B12's `ww_coach.py` is B12p. The wave column of every row is replaced by the lane waves of 15.6.1.

**Rows added by section 21** (paths under `app/ui/src` for UI rows, under the repository root for engine rows).

| Pkg | Wave | Owns | Reads (earlier waves only) |
|---|---|---|---|
| G05 | UW6 | `styles/design/clay/**`, `shared/kit/**`, `shared/lamp/**`, `__tests__/kit/**`, `e2e/bench/known.ts`, the shell chrome files named in the wave contract | G01 |
| N03 | before UW7 (integrator) | `tools/wave_check.py` (lane rule), `tools/integrate_wave.py`, `tools/tests/**` | none |
| DB01 | UW7 | `shared/data/countdown/**`, `shared/data/nextthree/**`, `shared/data/handoff/**` | G01, D01 |
| DB02 | UW7 | `shared/data/legend/**` | G01, D05 |
| DB03 | UW8 | `ww/day/today/callouts/handoff.callout.tsx`, `ww/day/today/callouts/ahead.callout.tsx` | L04, DB01, DB02 |
| DB04 | UW8 | `ww/exams/**`, `ww/day/today/modes/season.mode.tsx` | L04, D05, DB01, DB02 |
| DB05 | UW10 | `ww/review/**`, `ww/day/week/faces/review.face.tsx`, `ww/day/month/faces/review.face.tsx` | L01, L03, D02, DB02 |
| DB07 | UW9 | `jarvis/core/glance/**` (and one slot line in the Core home) | J01, D05 |
| DB08 | UW11 | `jarvis/console/health/faces/system.face.tsx`, `jarvis/console/system/**` | J05, D05 |
| DB09 | UW10 | `deck/**`, `shell/views/deck.view.ts` | DB03, DB07, J01 |
| X03 | UW8 | `ww/study/{blueprint,generator,print}/**` | Y01, D03 |
| X06 | UW9 | `ww/study/{patterns,variants}/**` | Y01, AD08 |
| X08 | UW10 | `ww/focus/hall/**`, `ww/study/marking/**` | Y02, Y01 (RubricChips) |
| X10 | UW11 | `ww/study/exam/**`, `ww/study/plan/faces/exam.face.tsx` | Y03, D01 to D05, AD08 |
| C03 | UW8 | `ww/study/library/**` (intake, course map, provenance, tab host), `shared/provenance/**` | D03, D04, G01 |
| C08 | UW11 | `ww/study/library/connect/**`, `jarvis/console/connections/classroom/**`, `ww/study/ww-gcr.planned.ts` | C03, J05 |
| AD08 | UW8 | `ww/study/adapters/{pyq,review,generator}.{ts,register.ts}`, `e2e/exam-path.spec.ts` | Y01, EW7 routes |
| AD09 | UW9 | `ww/study/adapters/{ocr,variants,intake}.{ts,register.ts}`, `ww/day/adapters/intake.register.ts`, `ww/day/classroom-fold/**` | AD08, C03, L01, EW8 routes |
| AD10 | UW11 | `ww/study/adapters/{harvest,queue,tonight}.*`, `ww/day/adapters/{intents,logs,term}.*`, `jarvis/console/adapters/google.register.ts` | AD09, EW9 routes |
| AD11 | UW12 | `ww/day/adapters/{gcal,reminders,dashboards}.*`, `ww/day/link/**`, `jarvis/reminders/**`, `shell/slots/notify.reminder.tsx`, `ww/tree/adapters/evidence.*`, `ww/study/adapters/classroom.*` | AD10, EW10 routes, T01, L01 |
| AD12 | UW13 | `ww/career/adapters/*.register.ts`, `ww/study/coach/adapters/**`, `phone_page/adapters/**` | AD11, EW11 routes |
| H01 | UW12 | `shell/desks/**`, `__tests__/shell/desks/**` | N02 |
| H02 | UW13 | `ww/study/term/**` | H01, D03, D01, AD10 |
| RW1 | UW12 | the folders the slot-11 jury names (never `*.settings.ts`, `links.register.ts`) | all sections |
| E05 to E08, C01 | EW7 | `app/jarvis_app/ww_pyq/**` (one set of files each), `ww_intake/{paste,ics,match}.py`, route files, tests | none |
| X04, X07, C02, HV01, E17, M01 | EW8 | `ww_pyq/{ocr,variants,rubric,takeout}.py`, `ww_intake/store.py` and `routes_ww_intake.py`, `ww_harvest.py`, `routes_ww_harvest.py`, `ww_check_harvest.py` (the three existing harvester files, HV01 only), `app/tests/test_exam_path.py` | EW7 |
| HV02, C06, X09, H03 | EW9 | `ww_harvest_sources/**` (each adapter registers into the existing `SOURCES` dict and `fetch_*` pattern of `ww_harvest.py` by one line in its own module, not by editing that file), `ww_google/{oauth,token_store,fake}.py`, `ww_pyq/{readiness,tonight}.py`, `ww_review/**`, `ww_term/**` (extends `ww_attendance.py` by import; see 21.10) | EW7, EW8 |
| C07, DB11, JH01 | EW10 | `ww_gcr/**`, `ww_dash/**`, `core/intents/**` | EW8, EW9 |
| B09p, B12p, JH03, JH04 | EW11 | `routes_phone*.py`, `ww_coach.py`, `core/notify_read/**`, `core/gpu/**` | EW7 to EW10 |

#### 15.6.3 Where the lens packages went

| v2 package | Lens packages folded in | Notes |
|---|---|---|
| N01, N02 | N01, N02 (process), review of B05 | the lens N02 "shell integration of the grammar" is G04 |
| G01 | visual S01, jury debt of the kit bench | the 18 measured failures, the clay recipe, one PLANNED glyph |
| G02 | visual S02, S03, S04 | the sigil, ASCII and terminal grammars as shared primitives |
| G03 | visual S06 tooling, data D13, Life L10, tree T07, JARVIS J10 | every private derivative in one package; the tracer |
| G04 | visual S05, S07 | cursors, boot, route sigil, empty states |
| D01 to D05 | data D01 to D05, D07 to D10, D12 (D06 became L01, D11 is dropped, D13 is G03) | one folder each |
| J01 to J05 | J01, J09 | J02+J03 to Room, J04+J05 to Senses, J06 to Memory, J07 to Console |
| L01 | L03, L04, L05 (month, drawer, year form) | week form is in L03 |
| L02 | L01 | |
| L04 | none of the 77 (critic pass): `day.today` and `proof` had no owner in the lenses | 20.16 |
| L03 | L05 (week), L06, L07 (UI parts), next-day planner | |
| Y01 to Y03, Y02 | Y05, Y06, Y07 (UI), Y08 (UI), Y10, Y12 | the engine parts are E05 to E08 |
| T01, T02 | T03 to T06 (UI), T08 to T10 (UI) | |
| E01 | L02 | |
| E02 | L06, L07 (stores) | |
| E03 | J08 | |
| E04 | L08 | |
| E05 to E08 | Y01 to Y04, Y07 (FSRS adapter), Y08 (checker), Y09, Y11 | B08 (rules and FSRS) is folded into E07 and E08 |
| E09 to E12 | T01, T02, T08 to T10 (data) | |
| E13 | L09 | |
| E14 | T11 | |
| Q01 to Q04, T12, S08 | the lens audits | Q04 is rewritten (D-V2-1) |

B06 and B11 (the section packages of 15.3) are replaced by J01 to J05, L01 to L03, Y01 to Y03, Y02, T01 and T02; B06b is replaced by G03 plus the placement inside each section package; B07's UI half is mounted by J01.

#### 15.6.4 The merge test (20.14) and the gallery pass (20.15) are run by the integrator at the end of every wave

Merge test: (a) the contract table lists, per package, the folders it owns, and a script (`tools/wave_check.py`, written by N01) fails if two packages of a wave own an overlapping path or a package changed a file outside its folders; (b) `import.meta.glob` registrations resolve (every `*.view.ts`, `*.slot.tsx`, `*.mode.ts`, `*.register.ts` and gallery entry loads); (c) full vitest, `tsc -b`, the kit bench with its known-debt file unchanged or shorter, Playwright, the Python tests on scratch data dirs; (d) one gallery screenshot per package. Gallery pass: the owner opens "What is new" in the running application and judges each placement by eye; a placement he rejects goes back to its package. No placement of a catalogue picture is called done before this pass (every placement is a design claim until then, 20.12).

Two lane checks are added to the merge test for every wave (15.6.1): (e) the lane check (rule 8): no package of a UI wave owns a `.py` path, no package of an engine wave owns a `.ts`, `.tsx`, `.css` or `.json` path under `app/ui`, and a shared file (the state file, the research files, this specification) is never in a package's owned list; (f) the route check (rule 9): every route an adapter file calls has an entry in `docs/design/well-wisher-engine-plan.md`, and every route in that file has a pytest. The integrator also runs `tools/integrate_wave.py` (tsc, vitest, bundle, `wave_check`, Playwright, the art build in one report, so that an outage resumes from the report). Jury scores ratchet: no section merges below its previous jury score; rework that is not a hard gate goes to RW1.

#### 15.6.5 Which existing packages moved, and why (14 Nov 2026)

| Package | From | To | Why |
|---|---|---|---|
| J01, L02 | wave 7 | wave 6 (as run) | pulled forward by the integrator; J01 is in review, L02 merged |
| Y01, Y02 | wave 8 | UW7 | Study comes first (the owner's priority; milestone A) |
| Y03 | wave 9 | UW8 | the practice and plan screens are part of the exam slice; it hands `generator/**` to X03 and the library host to C03 |
| L01, L04 | wave 7 | UW7 | unchanged; the Life month carries Classroom deadlines and exam dates |
| J02 | wave 7 | UW9 | Room works in the classic layout; Study and the dashboards come first |
| L03 | wave 8 | UW9 | the week view hosts the Week Review face of DB05 |
| T01 | wave 9 | UW9 | its ports must land before the evidence adapter (AD11) and E14 |
| J04 | wave 8 | UW10 | Memory has no exam value; the classic page works meanwhile |
| J05, T02 | wave 9 | UW10 | the Console hosts the System face (DB08) and the connection rows (C08) |
| J03 | wave 8 | UW11 | Senses stays classic until the sections that serve exams are merged |
| G04 | wave 9 | UW11 | cursors, boot and empty states polish; not on the exam path |
| E01, E02 | wave 10 | EW9 | engine lane; their UI halves move to AD10 |
| E03, E04 | wave 10 | EW10 | engine lane; E04 imports the shared OAuth core C06 (EW9); UI halves move to AD11 |
| E05 to E08 | wave 11 | EW7 | the exam generator is the first feature; route discovery already exists in `register_feature_routes`, so no package edits `server.py` |
| E09 | wave 12 | EW10 | engine lane; its adapter moves to AD11 |
| E10, E11 | wave 12 | UW12 | JSON data under `app/ui`: UI lane |
| E12 | wave 12 | EW11 | engine lane; its adapters move to AD12 |
| E13 | wave 13 | UW12 | settings dissolve once all sections exist |
| E14 | wave 13 | UW13 | needs E09's adapter (AD11) merged in an earlier wave |
| B09, B10, B12 | wave 13 | UW13 (UI halves) | B09p and B12p are their Python halves in EW11 |
| B13, Q01 to Q04 | wave 14 | UW14 | unchanged |

#### 15.6.6 Where the new packages came from

| Package | Lens ids folded in | Notes |
|---|---|---|
| E05 to E08 (extended) | exam lens X01, X02, X05 | crops, tables, slides, blueprint, generator v2, print, Quiet, Bloom |
| X04, X07 | exam lens X04, X07 | OCR; variants and rubric drafts |
| X03, X06, X08, X10 | exam lens X03, X06, X08, X10 | the exam screens; the rubric strip is part of Y01 |
| X09 | exam lens X09, Well Wisher lens H06 | one review queue (`fsrs`) |
| C01, C02 | classroom lens C01, C02 | parsers; the Intake store |
| C03 | classroom lens C03, C04 | Intake UI with the Course Mapper and provenance |
| AD09 (part) | classroom lens C05 | the calendar adapter and the From Classroom fold |
| C06, C07 | classroom lens C06, C07; forecast lens E15; dashboards lens DB13; exam lens X11 | one OAuth core, one sync |
| C08 | classroom lens C08, C09 | ladder, link row, sync log and Delete sheet |
| E17 | forecast lens E17 | the Archive door |
| M01 | forecast lens M01 | engine half (`test_exam_path.py`); its Playwright half is in AD08 |
| HV01, HV02 | the owner's request of 13 Nov | harvester core and adapters |
| DB01 | dashboards lens DB01, DB06 | plus `HandoffKey` |
| DB02 to DB05, DB07 to DB09 | dashboards lens DB02 to DB05, DB07 to DB09 | DB03's work on Today is two callout files; DB04 merges the paper strip of Well Wisher lens H12 |
| DB11 | dashboards lens DB11, DB12 | aggregations and Next Three |
| DB10 | dashboards lens DB10 | reserve |
| H01, H02, H03 | Well Wisher lens H01, H02, H03 | desk frame, Term Ledger UI and arithmetic |
| JH01, JH03, JH04 | JARVIS lens JH01, JH03, JH04 | engine halves |
| RB01 | forecast lens P01 | renamed (block A.P01 exists); reserve |
| RW1 | forecast lens RW1 | one rework wave |
| N03, G05 | forecast lens (tooling); the craft pass | |

---

## 16 Decision log

The decision log has three parts: the core decisions D1 to D24 with the judging that produced them (§16.1, §16.2), the deviations and conflicts that each specialist part raised against the core (§16.3 to §16.4, kept verbatim so each can be checked), and the integration decisions I1 onward made while assembling this file to resolve the places where the parts disagreed (§16.5). Where the parts disagreed, the rule was: the core wins, then the research, then the part that owns the topic (screens for layout, the voice part for motion and signal, the system part for tokens, the roadmap part for sequencing).

### 16.1 Judging of the three proposals

Three independent proposals were scored 1 to 10 on six criteria (10 is best; "migration" is scored high when it is cheap). Scores are mine, stated with reasons; totals are unweighted sums out of 60. Tie-break order if needed: separability, then migration cost.

| Criterion | A: daily loop first | B: two brands, one seam | C: instrument OS first |
|---|---|---|---|
| 1. Brief and its self-review questions | 8: strongest on "first-time user" and "returning user"; the section map is derived from loops | 8: strongest on "distinct yet one system"; resume exists but is not the organising idea | 8: strongest on "tactile, instrument precision"; one metaphor covers both products |
| 2. Daily usability for a student with ADHD-like difficulty | 9: Resume pill, one primary action, a Rest screen, no daily setup | 8: a Day home with Start, resume line and a Now strip; Life folded into Day cuts a page | 6: 7 plus 6 rail slots and lamps everywhere add things to parse (its own risk 1) |
| 3. Honesty | 8: provenance triad and dashed planned cards; catches that Resume can lie | 8: null adapters give honest empty states; contrast table shows the accent fails on light | 10: the five-state lamp and the state contract make honesty a type-level rule |
| 4. Separability of the two products | 7: separate rails and cuts listed, but sections share the shell contract more than a package boundary | 10: four ports, null adapters, per-product builds, an import-graph test | 7: a bank is a package and three jacks cross, but the chassis is shared down to the rail slots |
| 5. Migration cost from the built frame and JARVIS pages (high is cheap) | 5: dissolves the Today column, merges Focus and Tree into Study, demotes Setup | 8: moves cards between workspaces, keeps the frame, legacy ids as aliases | 6: merges Tree and Proof into Growth, dissolves Setup by a rule, renames the column |
| 6. Visual ambition | 7: good centrepieces, honest rules, less distinctive chrome | 7: good per-section worlds; two brands risk reading as two apps | 9: the faceplate, lamp and plate grammar is the most memorable and the most "customer-ready hardware" |
| **Total** | **44** | **49** | **46** |

**Winner: Proposal B, "Two brands, one seam (separable products first)".** Reason: the owner's non-negotiables are "one coherent product now" and "separable later without a redesign". Only B makes separation a testable build target while leaving the built, tested Well Wisher frame (1223 UI tests, 248 browser tests; Strand 0, section 2) mostly in place. A has the best daily-use logic and C the best honesty and ambition; both are grafted in.

**Grafted from A:** the Resume record and pill and its stale-record rule; the loop tables as the derivation of the map; the `focus.rest` screen; the product switch in the title bar (instead of B's realm items in the rail); the fault chip; the command palette's Go, Do, Ask groups; renaming the roadmap overlay "What is coming" (so it is not confused with the Career road); the 40 px Now strip; deleting the Core MissionCard.
**Grafted from C:** the five-state lamp and the `{state, since, reason}` contract; title-bar annunciators; planned features as dashed plates inside views; the Quiet switch and Calm switch in Settings; the "no number without a state" test; centrepiece ideas for Room (faceplate) and Senses (spindle).
**Kept from B:** the four ports and null adapters; per-product builds and the import-graph test; the fixed All-off control; the Day home (Life folded in); Settings sheet instead of a Setup tab; Study with `practice` (Drill moved from Focus); the contrast table logic; the commercial wake-word note.

### 16.2 Decisions D1 to D24

| # | Decision | Alternatives considered | Why | Date |
|---|---|---|---|---|
| D1 | Proposal B is the base (ports, per-product builds) | A (loop first); C (instrument first) | Highest total (49 versus 44 and 46); separability and migration cost decide the brief's two hardest constraints | 2026-11-12 |
| D2 | 10 sections, 5 per product, no planned sections in the rail | A: 4 per product plus Proof and You; C: 7 and 6 slots with blank plates | Five fits the rail with room to spare and respects short-term attention; planned items need a home, not a slot that competes with the daily path | 2026-11-12 |
| D3 | Product switch lives in the title bar; the rail holds sections only | B: realm items at the top of the rail with sections in the header; C: A/B key at the rail top | The rail stays one stable list; the switch reads as a brand switch, like a space switcher (Strand 1, Arc) | 2026-11-12 |
| D4 | Focus and Tree stay separate sections | A: merge both into Study | Both are built, tested and have their own job and primary action; merging risks the migration for no daily gain (A's own risk 1) | 2026-11-12 |
| D5 | Life folds into `day` (`week`, `body`); `focus.rest` is the break screen | A and C: keep Life as a section | Life and Today answered the same question on two pages; the break is moved to where the session lives | 2026-11-12 |
| D6 | Below about 900 CSS px the canvas is one reflowing column | Stay fixed and scroll horizontally | WCAG 1.4.10 (Strand 6); the no-scroll rule holds at laptop widths only | 2026-11-12 |
| D7 | Setup becomes the `settings` sheet; its 18 sections unchanged | C: dissolve Setup into a back panel plus per-module config | Configuration is not a daily job; unchanged logic means unchanged tests | 2026-11-12 |
| D8 | The Today column becomes `day.today` plus a 40 px Now strip; the full column stays pinned from 1600 px if tests show the strip fails | Keep the column everywhere (C); dissolve with no fallback (A) | Recovers width at 1366; A's risk 1 gives the fallback. Test target: 2 taps to a running block, measured in Playwright | 2026-11-12 |
| D9 | Ctrl+1 to Ctrl+5 select sections of the current product; Alt+1 to Alt+5 are aliases; the Well Wisher order changes from Study, Tree, Life, Career, Focus, Setup to Day, Study, Tree, Career, Focus (**order superseded 2026-11-12 evening by I37: Day, Focus, Study, Tree, Career, by reuse; the key rule and "Day first" stand**) | Keep the old Alt order | Day must be first as the home; JARVIS keeps Ctrl+1 to Ctrl+5 (was Ctrl+1 to Ctrl+6). Open question F5 | 2026-11-12 |
| D10 | Chrome follows one global theme; scenes are light or immersive per section; first-run default differs per product | Chrome flips with the product | The shared chrome carries the "one product" feeling; immersive scenes carry each product's mood | 2026-11-12 |
| D11 | The accent orange is a fill only; JARVIS has no accent hue beyond the provenance triad | Orange as text and edge; cyan as JARVIS brand | 2.83:1 on the light ground fails 1.4.11 (computed); colour must only mean state (Strand 1, J-principle 9) | 2026-11-12 |
| D12 | The five-state lamp is the only state display; unknown state is WAITING plus "no report" | Booleans; colour dots | A lamp that lies is worse than none (C's risk 3) | 2026-11-12 |
| D13 | All off is a single press with a 6 s Restore toast | B: 400 ms long-press to confirm | A hold is a motor-access barrier; turning things off is low-risk and undoable | 2026-11-12 |
| D14 | Two phone pages, one pairing, one generated tokens file | A: one PWA with four tabs | Either product ships alone; the two pages already exist | 2026-11-12 |
| D15 | Four ports (`voice`, `memory`, `notify`, `ambient`) with null adapters | Direct imports; a shared global store | The only sound way to make each product run alone | 2026-11-12 |
| D16 | Cross-product content is limited to the ports; delete Core's MissionCard rather than keep a Well Wisher "Now" in JARVIS | Keep a mission mini-card behind a flag | It is the coupling that blocks separation (Strand 0, 7.2) | 2026-11-12 |
| D17 | Rewards are deterministic, optional and from a visible sequence; no variable rewards | Keep the 10 Nov wording "variable but honest" | Variable rewards have no evidence of benefit and conflict with SDT autonomy and regulator language (Strand 4, finding 7; N2) | 2026-11-12 |
| D18 | The Day sun and Study island are pure functions of the current counts: they never dim because time passed, keep no high-water mark, and the Day sun resets neutrally when the data layer's date changes (revised 2026-11-12, I25) | Brightness equals completion ratio live | Avoids loss framing and "deceptive progress"; each is captioned with what it encodes | 2026-11-12 |
| D19 | Not mounted: MemoryGalaxy, GrowthChart, galaxy; deleted: RelayWiring (Uno) and `uno` leftovers, duplicate PhoneCard | Mount them | Unreachable today, three.js cost on a laptop near its commit limit (Strand 0, 5), history keeps the code | 2026-11-12 |
| D20 | Orphan cards (AwayModeCard, the card named SecurityAlert and renamed MotionNotice before mounting, EnergyCard, ReminderAlerts) are mounted only when their backend is confirmed live; until then not-built ones are shown as PLANNED and built-but-unverified ones as WAITING "built, not verified" | Mount all now | Honest states first; Away needs a presence source and is labelled SIMULATED or PLANNED until real | 2026-11-12 |
| D21 | Fonts: Inter, Geist Mono and a digits-only Doto subset; Anton dropped | Keep four families | Budget and coherence; pixel numerals survive as a tiny subset | 2026-11-12 |
| D22 | Centrepiece choices in §8.1; C04-26 (eye) and C03-12 (screaming figure) are rejected for any default | Choose the eye for Senses | An eye implies a camera; the project forbids it | 2026-11-12 |
| D23 | Voice hill is driven only by real audio level; the output level needs new Python in `core/playback.py` | Canned animation while speaking | Brief and Strand 0, section 4: a canned shape is decoration, not a reading; until the signal lands, Core ships the "no signal" state plus input level | 2026-11-12 |
| D24 | The "Wins" card in Proof shows counts of completed planned actions, not opens | Keep game currency as a reward | N7; currency is proof, not a deadline | 2026-11-12 |

### 16.3 Deviations and conflicts raised by each part (kept verbatim)

"The core" in the tables below means the core text that now forms §1 to §3, §6.1, §6.6, §8.1, §16.1, §16.2 and §17.1. The integration decisions that resolve the collisions follow in §16.5; §16.4 says what happened to each item.

#### 16.3.1 Design system (V1 to V7)

The core is followed. Where a computed number or a stated rule would not hold, the change is listed here, each with its reason.

| # | Core says | This part does | Reason (computed) |
|---|---|---|---|
| V1 | `--state-simulated` light `#8A5A00` | `#805400` | `#8A5A00` is 4.30:1 on `--surface-sunk` `#DADCDB`, below 4.5 for text; `#805400` is 4.78 on sunk, 5.45 on ground, 5.93 on raised. Dark value `#FFB347` unchanged |
| V2 | Core lists `--surface-sunk` dark and `--ink-2` dark as "assumption, to compute" | Fixed at `#101112` and `#B4B8BA` | Computed in §6.3.3: `--ink-2` is 8.97 on dark ground, 7.79 on raised, 9.46 on sunk |
| V3 | Pressed state implied as a darker surface | No `--surface-pressed` token; pressed reuses `--surface-sunk` plus the inner shadow and a 2 px sink | A trial pressed surface (`#CDD0CE`) failed 4.5:1 for ink-3 (4.23), measured (3.99), simulated (3.81), fault (4.20) and accent-ink (4.37). Reusing sunk keeps every pair already computed |
| V4 | Accent fill `#F25623` alone | Adds `--accent-fill-hover` `#F5693A` (171717 text 5.95:1); pressed keeps the base fill, with inset shadow and sink | A darker pressed fill `#D94A1A` gives 4.22:1 with 171717 text, which fails 4.5 |
| V5 | Study "cream", Tree "dusk toward dark" scenes | No ground tint and no gradient under text; the colour lives in the centrepiece art, and every caption sits on a `--surface-raised` caption plate | A tinted or gradient ground would invalidate every computed pair. The plate rule (section 6.4.7) keeps the table exact |
| V6 | Rail label "10 px mono" (§3.4) | 12 px mono caps | Core §6.3 sets 12 px as the minimum mono size. Computed fit: 7 characters at about 0.6 em is 7 x 7.2 = about 50 px (assumption: Geist Mono advance 0.6 em, to be confirmed in a render) inside the 64 px rail with 4 px side padding, so 12 px fits for the longest label ("CONSOLE") |
| V7 | `--focus-ring` is `--accent-hi` today | `--ink-1`, 2 px, offset 2 px (as §6.3) | Accent orange fails 3:1 on the light ground (2.83); the existing ring is only visible in dark themes |

Conflict note C1 (for the director, not a silent change): `--state-measured` light (`#006B7A`) on `--surface-sunk` is 4.504:1. It passes, with almost no margin. Rule adopted: measured-state text on a sunk well is 13 px or larger and medium weight; the unit test asserts at least 4.5 on every pair so a later edit cannot slip below.

#### 16.3.2 Screens and migration

**Deviations from the core.**

1. **Senses stage has a Motion | Map toggle** (renamed from "Body | Map" in the review of 2026-11-12, because "Body" implied that a body is resolved). The core lists the twin, presence core and zones under `senses.presence` and fixes C04-06 as the centrepiece. Showing both at once would exceed the 720 x 360 canvas rule and load WebGL unnecessarily, so the centrepiece is the default and the twin loads only on Map. Reason: honesty of the centrepiece plus the performance rule.
2. **Reminders live in `memory.recall`** (right pane). The core lists reminders among Yaadash's contents but gives them no view. Reason: recall is the only view that already has a detail pane.
3. **`confirm` is used by JARVIS** (delete memory, unsaved settings). See conflict C2.
4. **Relay "asked, not confirmed" becomes WAITING** (§6.6) instead of the phone's amber. Reason: amber means SIMULATED in the lamp contract.
5. **The Well Wisher Quest card** stays as an optional card in `day.body`; the core moved Quests there but did not place the Quest card (LF4) itself.

**Conflicts raised.**

| # | Conflict | Default in this spec |
|---|---|---|
| C1 | §8.1 caps canvases at 720 x 360, but the existing twin is a full-bleed WebGL stage and `senses.presence` Map needs most of 760 x 652. | Map keeps its current renderer and pixel-ratio cap (1.75) and mounts only when selected; the cap applies to every new canvas. The performance specialist should decide a pixel budget for the twin |
| C2 | The core makes `confirm` Well Wisher-owned (§3.2) but JARVIS needs a confirm for deleting memory. | Promote `confirm` to a shell overlay (shared) |
| C3 | §2.3 says "at most three belief questions" and §3.2 gives `memory.beliefs` no cap source. | Cap of three a week enforced in the view, as written in §2.3 |
| C4 | The core states `day` opens `day.today` always, but the evening primary changes to Close the day. | Only the primary's label changes; the view does not |
| C5 | A drawer inside a view is not an overlay and has no id in §3.2. | Drawers are view-local ids in 4.7; they do not count against the one-deep overlay rule but only one drawer opens at a time (assumption) |

#### 16.3.3 Art direction

1. **Canvas size.** Core §8.1 limits canvases to 720 x 360 CSS px. The career skyline (1230 x 240) and the memory branch (514 x 648) exceed that width or height, so they are **not canvases**: the skyline is a WebP strip with SVG overlays, the branch a set of pre-rendered text files. The only canvas in the art system is the 720 x 360 hill. This is a reading of the rule, not a break.
2. **Senses placement.** Core §8.1 names C04-06 as the centrepiece but not its region. I place the spindle as a 360 px SVG emblem beside the existing twin canvas rather than inside it, so the twin remains the only renderer. The Senses page owner may need to adjust the left column width (assumption).
3. **Day sun in the private build.** Core says "ASCII renderings of a painted sun". I use the painted crop with ASCII rays overlaid in the private build, and a geometric sun in the customer build. Same counts, same caption.
4. **`phone` and `deck` as assignment sections.** Core lists 11 section ids plus shell sheets. The JSON also uses `shell`, `settings`, `phone` and `deck` as section values, which are not navigation items, so the per-section counts can be summed to 186.

#### 16.3.4 Voice visualiser, motion, accessibility and budgets (D-A to D-K, then C1 to C7)

| # | Deviation | Reason |
|---|---|---|
| D-A | **Swap product is Alt+0, not Ctrl+0** (§3.4 table, marked "verify") | Ctrl+0 is the browser's zoom reset, which low-vision users need for the 200 to 400 % reflow path (WCAG 1.4.4, 1.4.10). Alt+0 has no known conflict. Needs the owner's OK (conflict C1) |
| D-B | **Route envelope 200 ms** replaces the built workspace-switch envelope (520 planned, 600 cap), for both products. Core does not give a switch duration; the built plan does | The brief for this part sets at most 200 ms; navigation is the most frequent action with five sections per product. Built tests (`interaction-budget`) get stricter, not looser |
| D-C | **Push to talk gains a toggle mode** and the Ask orb is a toggle by default (§3.4 lists Ctrl+Shift+Space "hold") | A held key is a motor-access barrier (the same reason D13 rejects a long press for All off) |
| D-D | **Single-key shortcuts are focus-scoped and have a Settings switch** (core says "focus-scoped") | Adds the off switch so WCAG 2.1.4 is met either way |
| D-E | The glass tier stops being a governor input | `backdrop-filter` is banned and stripped by the build (S0, S6 finding 22), so the probe has nothing to measure; the p5 sampler remains |
| D-F | One resolved attribute `data-motion-level` is added beside `data-motion` and `data-motion-load` | A single CSS hook for the three levels; the old attributes are kept for compatibility |
| D-G | The view-transition name `ww-centre` is renamed `shell-canvas` | One name for both products (§1.4 shared shell) |
| D-H | Font budget stated as 3 families and at most 5 files, not the S6 proposal of 2 families and 4 files | Core D21 fixes the three families (Inter, Geist Mono, Doto digits); the S6 numbers were proposals |
| D-I | JARVIS section tempo and token overrides are new | §1.2 gives only the 80 to 160 ms range; the table in 10.2 is the concrete form |
| D-J | The Core hill and ring both draw the **active** channel; the ring is not a separate input-only channel | One reading must never be drawn as two claims; the source tag names the channel |
| D-K | Tier 0 (scalar level) draws an envelope hill and a uniform level ring rather than the spectrum hill | A scalar cannot honestly produce a spectrum; matches F7's default of input level only |

Nothing in this part adds a camera, a radar, a fake live state, a streak, a leaderboard or a claim about attention, mood or ADHD.

| # | Item | Default if unanswered |
|---|---|---|
| C1 | Ctrl+0 (browser zoom reset) conflicts with core's "swap product" binding | Alt+0 (D-A) |
| C2 | Ctrl+1 to 5 and Alt+Left may be handled by the WebView2 host before the page | Alt aliases and the palette remain; verify in the real window (14.6) |
| C3 | Who owns `core/` changes (F7), and may Tier 0 ship alone first | Tier 0 ships first; Tier 1 waits for the owner |
| C4 | The mic dB window (-70 to -10) and the display sensitivity default are guesses | measured on the real mic in the F8 session, recorded in `docs/research/voice.md` |
| C5 | Host `IsVisible` wiring in `JARVIS.pyw` | needs the owner's OK; until then the gate relies on `visibilitychange` and the 60 s idle rule, and minimise behaviour is a measured risk (S6 finding 24 and 25) |
| C6 | Is a 3,072-point Canvas 2D hill within budget on the integrated GPU | decided by the F8 measurement; the governor's `low` level (1,280) is the designed fallback |
| C7 | Does a mute control exist in the core, or only text-only mode | muted maps to text-only now; the explicit mute is a PLANNED control until the core reports it |

#### 16.3.5 Registry, roadmap and prompts

| # | Core says | This part does | Reason |
|---|---|---|---|
| Dv1 | §3.2: every planned item has "a dashed home inside the view". Today's pattern R (roadmap only) renders nothing in the layout | Pattern R items get a home as a row in a small **PLANNED chip** in the view header (dashed ring, label "PLANNED", opens a popover listing them), not as a plate in the canvas | Obeys the core's "every planned item has a home" without crowding the 1286 x 704 canvas or the daily-loop views (1.4, rule R5) |
| Dv2 | D8 and F3: flip Well Wisher behind the existing `ww.workspace` flag after the exam period | Two new flags: `app.shell` (shell v2) and `ww.ia` (Well Wisher section map v2). `ww.workspace` keeps its current meaning (new frame versus old layout) | `ww/frame/flag.ts` already uses `ww.workspace` for the Old layout and New layout buttons; overloading it would break them (Strand 0, 1.3) |
| Dv3 | Core §3.1 and §1.4 name `app/ui/src/shared/`, `jarvis/`, `ww/` | Adds `app/ui/src/shared/planned/` and `app/ui/src/shared/learning/` | Registry mechanism and learning store are shared grammar (§1.3), data stays per product |

| # | Conflict | Default if unanswered |
|---|---|---|
| X1 | `data/notes/NOW.md` section 2 does not name who owns `app/ui/src/ww/**`, `phone_page/ww.*`, `core/playback.py` and `core/jarvis.py`. The core's seam (§1.4) and the voice signal (F7) depend on them | Treat `ww/**` and `phone_page/ww.*` as Well Wisher chat, `core/playback.py` as needing the owner's decision (F7); WP-R01 records the answer in NOW.md section 2 before any build WP starts |
| X2 | The exam period. Core F3 says ship the shell, the JARVIS section and the seam first, flip Well Wisher after the exams. Exact paper dates are not in the core | The freeze window is an assumption: from the start of the owner's exam window to the day after the last paper. WP-R01 asks the owner for the real dates and writes them in the private `NOW.md` |

### 16.4 Status of each part's deviations and conflicts in this file

| Item | Status |
|---|---|
| System V1 to V7, C1 note | Accepted (V1 is I2, V6 is I3). C1 (measured-state text on a sunk well is 4.504:1) stands as a rule: such text is 13 px or larger and medium weight, and the unit test asserts at least 4.5 on every pair |
| Screens deviations 1 to 5 | Accepted |
| Screens conflicts C1 to C5 | Defaults accepted (C2: `confirm` becomes a shared overlay) |
| Art deviations 1 to 4 | Accepted; item 2 (spindle beside the twin) is superseded by the Motion or Map toggle and I4 |
| Voice D-A to D-K | Accepted (D-A is I1, D-C is I17, D-H is I13) |
| Voice C1 to C7 | Defaults accepted; C1 needs the owner's OK; C3 is F7 |
| Roadmap Dv1 to Dv3 | Accepted (Dv1 with I11, Dv2 is I9) |
| Roadmap X1, X2 | X1 open, §17.2 (it is the one answer B01 needs). X2 closed 2026-11-12 evening by I34: there is no exam freeze, so no exam dates gate the programme |
| Roadmap Dv2 and X2 wording, §15.2 as first assembled | The wording about a freeze and about flipping "after the exam period" in Dv2 and X2 of §16.3.5 is kept verbatim as history and is superseded by I33 to I36 (§16.7); §15.2, K1, K2, F3 and §5.1 are rewritten |


### 16.5 Integration decisions (made while assembling this file, 2026-11-12)

| # | Decision | Alternatives and where they came from | Why |
|---|---|---|---|
| I1 | Swap product is **Alt+0**, not Ctrl+0 (marked "verify" in the core) | Ctrl+0 (core §3.4 and the screens part) | Ctrl+0 resets browser zoom, which low-vision users need for 200 to 400 % reflow (WCAG 1.4.4, 1.4.10); Alt+0 has no known conflict (voice part D-A). Needs the owner's OK and a WebView2 check (F-list, §17.2) |
| I2 | `--state-simulated` light is `#805400` | `#8A5A00` (core) | The core value is 4.30:1 on `--surface-sunk`, below 4.5 for text; `#805400` is 4.78 on sunk, 5.45 on ground, 5.93 on raised (system part V1, computed) |
| I3 | Rail labels are 12 px mono caps | 10 px (core) | The core's own minimum mono size is 12 px; the longest label "CONSOLE" fits the 64 px rail (computed, assumption on advance width, system part V6) |
| I4 | **Region boxes in §4 govern layout.** Art-side placements in §8.3 that differ are superseded: Hill stage top-left of the left column; room faceplate 900 x 300; Motion band 720 x 360 with the spindle as SVG; memory branch plate 510 x 424 in the Detail pane (updated 2026-11-12); console frame 800 x 652; day sun 620 x 420 as SVG; study island 560 x 540; career skyline 1230 x 260; focus dots columns of 30 at an 18 px pitch, 10 px dots, up to 5 columns; proof ring 288 x 256 | The art part's own placements (for example a centred hill at y = 148, a 640 x 360 island, a single 60-dot column) | The screens part derives every box from the canvas geometry (§3.3) and adds up each view to its content box; the art part positioned art against the same canvas without the surrounding regions. A sum that fits beats a picture that does not |
| I5 | Hill geometry is the §9.5 construction (96 columns x 8 layers x 4 stipples = 3,072 points at `high`) | 96 columns x 24 rows at 7.5 px pitch (art part) | The voice part owns the signal-to-geometry mapping and its tests |
| I6 | The hill stops on silence and idle by the rules of §9.11 and §10.6 (tick stops 300 ms after the level reaches the floor; the 60 s no-input rule belongs to the activity gate) | The art part's "stops after 60 s of silence" | One stop rule, owned by the motion system |
| I7 | JARVIS tempo is the per-section values and duration overrides of §10.2 (`core`, `senses`, `memory` 0.67; `room`, `console` 0.5; state 120 ms, feedback 80 ms) | A single JARVIS tempo of 0.65 (system part) | The motion part owns durations; its values sit inside the core's 80 to 160 ms band |
| I8 | The narrow-viewport bottom bar has six slots: five sections plus the Ask orb, at least 53 px each at 320 px (computed: 320 / 6) | Five slots with a floating Ask orb (screens part) | The voice part computed the minimum target width and keeps the orb reachable by thumb |
| I9 | Flags are `app.shell` (shell v2) and `ww.ia` (Well Wisher section map v2); `ww.workspace` keeps its present meaning (new frame versus old layout) | `shell.v2` and "behind the existing `ww.workspace` flag" (screens part, core F3 default) | The existing flag already drives the Old layout and New layout buttons; overloading it would break them (roadmap part Dv2, Strand 0, 1.3) |
| I10 | JARVIS sections are built in the order `console`, `room`, `memory`, `core`, `senses` (look only, last) | `room`, `console`, `memory`, `senses`, `core` (roadmap part) | Risk order from the migration table: console is the lowest risk, senses the highest (largest page, WebGL, honesty logic); voice (B07) follows `core` |
| I11 | PLANNED density (T9) counts plates rendered at once; a master-detail list counts as one. Where a home would exceed one `coming` plate or two `disabled` controls, the extra entries use pattern `roadmap` and appear as rows in the view's PLANNED chip (`day.body`: `music-import` is the plate, `body-grand` and `life-v2` are chip rows; `study.library`: Coach is the plate, `knowledge-of-the-day` and `books` are chip rows). The PLANNED chip sits in the 44 px view-switch row immediately left of the lamp | Three dashed plates in `day.body` and two `coming` entries in `room.rules` (screens and roadmap parts) | The two parts' rules collide; the chip keeps every planned item findable without crowding the canvas |
| I12 | The voice level bar (240 x 8), source tag, one-line legend and 44 px Pause toggle are fitted into the 720 x 88 two-row state strip (level bar, legend and Pause in row 2; revised 2026-11-12) and the 28 px caption bar of the Hill stage | Level bar "under the stage" with no region (voice part) | The screens part's region map has no spare row; the fit is an assumption to confirm in prototype P02 |
| I13 | Fonts: three families (Inter, Geist Mono, digits-only Doto), at most 5 woff2 files, at most 150 KB | "At most 2 families, at most 4 files" (Strand 6 proposal; roadmap budget table) | Core D21 fixes the three families (voice part D-H) |
| I14 | The day-sun duotone ink is `#B87A1A`, 4.98:1 against `#171717` (computed) | "assumption, to compute" (art part) | Computed with the WCAG formula; the picture carries no text |
| I15 | Contrast statements about art use the scene grounds of §6.3.4 (hill points 15.76 on `#0F1011`; amber stamp 10.99 on `#0A0C10`) | Statements against `#171717` (art part) | Each immersive scene has its own charcoal; the pairs must be quoted against the ground actually used |
| I16 | Wording neutralised for a public repository: scratch-folder paths removed, one named painting style replaced by a neutral description, reference pictures cited by catalogue id only | n/a | Public-repository rules |
| I17 | Push to talk is a toggle by default and a hold only by choice; the Ask orb is also a toggle | Hold only (core, marked "verify") | A held key is a motor-access barrier, the same reason All off is a single press (D13; voice part D-C) |
| I18 | Registry counts: 13 JARVIS rows plus `jarvis.phone-twin` (14), not "12" | "13 entries" (roadmap heading) versus "12 JARVIS entries" (work package B02) | The starter table lists 13 and the notes add the phone row |
| I19 | The core "Shell-level art slots" paragraph is not repeated; §8.4 carries the same slots with their art ids and static forms | Both | Say it once |
| I20 | `core.sound` has no hill in the first release (a 640 x 64 output meter instead); the three-ridge form waits for Tier 1 output signals | A 720 x 120 hill band in `core.sound` (art part) | The screens part's `core.sound` regions sum to 1286 wide and an output level does not exist until Tier 1 (§9.9) |


### 16.6 Review of 2026-11-12 (three adversarial lenses)

Three reviews (honesty, ethics and privacy; feasibility, performance and accessibility; brief and taste compliance) returned 63 findings: 28, 17 and 18. They are applied in the sections they cite. New decisions that the review produced:

| # | Decision | Alternative | Why |
|---|---|---|---|
| I21 | The view count is 34 (16 JARVIS plus 18 Well Wisher) and a unit test asserts it | 31 | The sum the table shows is 34 |
| I22 | Per-pair route sweeps are deleted; section changes use the 200 ms fade; the sweep exists in the loader and the product-switch reveal only | Four 160 ms ASCII sweeps | A 160 ms sweep is not read as art, a Ctrl-number jump never shows it, and it contradicted the idle-animation target |
| I23 | The `ambient` port carries `motion_recent`; Senses says MOTION SEEN, NO MOTION IN 60 s or PREDICTING, never present, absent or empty room | PRESENT/ABSENT | One link cannot see a still person |
| I24 | The hollow placeholder style is drawn in every state without a fresh frame (muted, thinking, idle, error, no signal); breath is off by default | Solid flat line in muted, thinking and idle | A flat solid line reads as a measured floor |
| I25 | Growing art is a pure function of current counts; no high-water mark; stored-item counts never drive art, so the Memory branch is a fixed picture | A branch growing with stored items | Growth by stored data rewards hoarding and punishes deleting; a falling picture is loss framing only if it is described as progress, so every caption says what it follows |
| I26 | "Mastered" is the student's own mark, labelled "marked by you"; no model or rule sets it | Undefined (possibly set by explain-back) | A model never grades |
| I27 | T720 (1366 x 720) is the design floor; every view declares a T720 column before its flag turns on | 768 only | A maximised window on a 768 panel is about 720 to 728 px high |
| I28 | The private art track is a non-distributed taste study; the customer track needs gate Q04 and per-file review | The owner's approval as the gate | The approval is not a licence from the rights holders |
| I29 | Each centrepiece is at least 25 % of its view and visible by default; Day, Study, Career, Memory and Proof layouts were resized to meet it | Centrepieces of 14 % to 21 % | The identity cannot revolve around a token-sized picture |
| I30 | The JARVIS copy voice is a dry, warm butler (understatement, a light callback, no joke about a fault) | "Dry butler" against the owner's playful-butler brief | One persona, decided once |
| I31 | Onboarding is one screen for JARVIS and none for Well Wisher; the other onboarding art became empty-state art | A 3-step JARVIS onboarding and a picker | "No setup gate" |
| I32 | The first release of `core.talk` shows the input hill plus "JARVIS speaking, no level yet"; Core is not done until B07 | A dead hill while JARVIS speaks | Honest, and visible gating |

**Applied and rejected.** (Decisions I21 to I32 above; the owner's evening decisions are §16.7.) 2026-11-12 review: 63 findings from three adversarial lenses; applied 59 in full and 4 in part, rejected the parts listed here. (1) Feasibility, no-scroll at 720: the tier, the floor, the rule and the three tightest views are re-derived; **per-view T720 region numbers for all 34 views are not written here** and are a gate of B05 and B06 (the numbers belong with the build and R01's measured height). (2) Feasibility, schedule: **calendar dates are not added to §15.4**, because the exam dates are personal and live in the private `NOW.md`. (3) Brief, assets: **individual contrast and alt text for the 26 meaningful pictures** is not hand-edited now; it is produced when B05b builds the manifest from the JSON (the 111 component references name their trait through the `purpose` field and Appendix C). (4) Brief, components: a **new clause per source in the Ids columns** is done through the parenthesis already present plus Appendix C, not by rewriting 38 rows twice. All other findings were applied as written or with a stricter variant. The criterion-5 re-justification of D1 is in §3.1.1.

### 16.7 Owner decisions of 2026-11-12 evening

The owner's evening update (binding, newer than the brief) is applied as follows. It changes the programme's priority and the order of sections; it keeps every other decision above.

| # | Decision | Alternatives and where they came from | Why | Date |
|---|---|---|---|---|
| I33 | The whole UI/UX overhaul is priority one. Exam features, relay and wall-box work wait until the UI/UX is remapped, then resume. It is a priority order, not a statement that the app is unused: the app works at every merge | Interleave exam features and hardware work with the overhaul (the first assembly of §15.2) | Owner decision. The overhaul is the work that every later feature sits on | 2026-11-12 evening |
| I34 | The exam freeze is removed: no period holds back the shell rewrite or the Well Wisher flip. F3 and X2 are closed. The quality safety mechanics stay (flags default off for risky flips, the app working at every merge, no build into `dist` while the app runs, live-process changes behind an env flag) | The freeze of the first assembly; B05 to B10 on a long-lived branch until after the last paper | The freeze existed to protect the owner's exam period; with the UI/UX as priority one it is no longer a rule. The mechanics that remain protect the running app, which is a quality matter whatever the date | 2026-11-12 evening |
| I35 | Ordering principle: build for scale. Shared, most reusable layers first (tokens, kit, lamp, registry, shell, ports), then the sections on top. The work-package order of §15.4 follows it and §15.4 states the check | The earlier order (research and validation gates first, then B01 to B04, then a long-lived shell branch) | A change to a shared layer is cheapest before anything depends on it | 2026-11-12 evening |
| I36 | Packages that only measure or validate (R01, R03, R04, V01 to V04, P01 to P03) run alongside the build and no longer block it. They gate flag flips and revise numbers; B03, the shared foundation, starts now in parallel with R01, with B01 as the second package in flight | R01 first, then V, P and B in strict phases | A measurement cannot change the order of the shared layers; B05 builds to the T720 floor so a measured window cannot invalidate it | 2026-11-12 evening |
| I37 | Sections are ordered by reuse, most reused first, from estimates written down in §3.1.2 (marked as estimates). JARVIS keeps Core, Room, Senses, Memory, Console (the estimates confirm it). Well Wisher becomes Day, Focus, Study, Tree, Career (Focus from fifth to second; Study, Tree, Career one place down); Ctrl+1 to Ctrl+5 and the rail drawings follow. Rule: where two estimates are within a factor of two, the present order stays | D9's order (Day, Study, Tree, Career, Focus); a calendar or feature-grouping order | Owner decision: order by reuse, then a plain, ADHD-friendly, engaging order for the rest (few items, predictable places, one primary action, the next step always visible). Ids stay frozen | 2026-11-12 evening |
| I38 | Views inside a section follow the same rule. One change: `console.events` moves to second, after `health`. Every other view order is unchanged | Reordering views whose estimates are within a factor of two | Reading the log is the next step after a fault, and it is used about 2.7 times as often as the next view | 2026-11-12 evening |
| I39 | Feature allocation re-checked with the same lens (§3.1.2): "Share a review" moves from `core.talk` to `memory.keep` (rare export off the most used screen, next to the other exports). Considered and not moved: the six counters (reuse and attention load conflict), `study.dmat` (a move would change a frozen id), the rest | Leave every feature where the first assembly put it | A feature moves only when reuse or attention load clearly justifies it; each non-move is recorded | 2026-11-12 evening |
| I40 | The first package to start is B03 (tokens layers 1 to 3, additive, no dependencies; its own test is the contrast oracle); its font step waits for a subsetting tool (X5) and nothing else waits for it. B03 and B01 run in parallel on disjoint files (B03 does not edit `primitive.css`). B01 narrows to the seams S1, S2, S4; the ports (S5) and the one navigation (S3) land with the shell (B05) | R01 as the first package (§15.4 of the first assembly) | See §15.4 for the reasons | 2026-11-12 evening |
| I41 | B08 (rules and FSRS) and B12 (Coach) are exam features: they resume after the remap (B11 merged). B11 no longer depends on B08 or on exams being over. Q02's two-week "moved to" check becomes a follow-up after the `ww.ia` flip | B08 before B09; B11 after the exams | Consequence of I33 and I34 | 2026-11-12 evening |


### 16.8 Direction v2 of 13 Nov 2026

The owner's change of direction is applied as below. The full wording and the test of each decision are in 20.2; this table is the log entry. It narrows or overrides earlier decisions where stated and keeps every other decision above. Date for every row: 2026-11-13.

| # | Decision | Alternatives and where they came from | Why |
|---|---|---|---|
| D-V2-1 | The private build is the product; third-party pictures and derivatives are placed directly and stay out of tracked files and the public repository, named by catalogue id only. The customer-release track is a note for a future separation. Overrides the two-track decisions in part, F10, X3 and the gate Q04 | The two-track policy of 12 Nov (§8.6) | Owner direction: personal use, so third-party images are fine and the work must be more refined, not less |
| D-V2-2 to D-V2-6 | Sigil, ASCII and terminal are three first-class grammars with budgets; sigils are generated from ids; ASCII carries data in four places; the terminal is a recessed well; clay gains life by five static or opacity-only moves | Sigil and ASCII as accents (§8, §10.5) | Owner direction: cybersigil and ASCII were sidelined; the clay looked "boring and lifeless" |
| D-V2-7, D-V2-8 | Specimen and Datum replaces the default bento for views that adopt it; every number gets a body | Bento grid of cards | "Extravagant, out-of-the-box" display of all data; one surprise per view keeps "neither alive nor dead" |
| D-V2-9, D-V2-10 | One Almanac family; the Life calendar is `day.month`; Drill is `focus.drill`; views 34 become 36 | A new section for Life; Life as a fifth tab in the rail | Keeps ten sections and frozen ids; Day stays at five views, Focus at four |
| D-V2-11 | Drill and Crucible both live in Focus. Overrides the move of Drill into Study in §4.4.2 | Drill in Study | Owner direction: "Focus has the Crucible and Drill" |
| D-V2-12 | The settings sheet is dissolved into Trim keys and a generated palette index | The 18-section Setup sheet | Owner direction: place each setting where its variable is used |
| D-V2-13, D-V2-14 | Google Calendar link PLANNED until configured, read-only first; "gcr" a PLANNED control until the owner says what it means | Build both now | The owner's own sign-in is required; the assistant never handles credentials; the term is unclear |
| D-V2-15, D-V2-16 | The question engine reports counts with intervals, never forecasts; a printed practice formula | A model that predicts which questions appear | The product's no-exam-result-claim rule (§2.5) |
| D-V2-17, D-V2-18 | Evidence-gated trees (ten trees, 113 branches); Career dates stamped "checked on" | Self-marked skill trees; typed fees without a date | A tick is not evidence; unverified fees must not look verified |
| D-V2-19 to D-V2-21 | JARVIS section systems; the WebGL twin stays behind a key; a fixed reminder ladder | Retire the twin now (the JARVIS lens) | The owner's note does not state a no-WebGL rule; retiring needs his yes |
| D-V2-22, D-V2-23 | Wave contract and waves of 3 to 5 packages on disjoint files; a preview switch and a gallery first | At most two packages in flight (§15.1) | Owner direction: parallel branches broke at merge; he must see the work early |
| D-V2-24 to D-V2-27 | Cursor kit on by default; the Memory constellation is a map, not a reward; seals earned by evidence; an image generator only with his consent | Cursors off by default on Tree; no growing art on Memory | Owner taste; consistency with §8.5.5 |
| D-V2-28 | Labelled summaries and a researcher agent that commits research | Unlabelled compaction summaries | The summaries are imported into other agents |
| I42 | Where the lenses disagreed, the choices of 20.3 stand (13 rows: month geometry, Almanac naming, one sigil engine, one `CaptureLine`, one Memory constellation, the Room layout, Career at five views, Senses ids, cursors, seals, the scope of the 40 percent rule, package ids) | Each lens's own choice | One component per job, ids frozen, rules not weakened |
| I43 | The ASCII budget target rises from 40 KB to 90 KB and the 2.5 percent tooth grain is adopted as a target; the 40 KB figure is the fallback if R01 measures a cost | Keep 40 KB | The ASCII grammar needs room for four data uses; unmeasured, so stated as a target |

### 16.9 Expanded horizons of 13 to 14 Nov 2026 (D-V3)

The owner's answers of 13 Nov and the six lenses are applied as below. The wording and the test of each decision are in 21.1.3; this table is the log entry. It narrows or overrides earlier decisions where stated and keeps every other decision above. Date for every row: 2026-11-14 (answers given 2026-11-13).

| # | Decision | Alternatives and where they came from | Why |
|---|---|---|---|
| D-V3-1 | "gcr" is Google Classroom; `ww.gcr` stays PLANNED until the sync package merges. Closes Q-V2-1 and the lens question Q-C1. Overrides D-V2-14 in part | "gcr" a PLANNED control until the owner says what it means (D-V2-14) | The owner confirmed the term and that his classes are reachable from his personal account |
| D-V3-2, D-V3-17, D-V3-18 | Two chats, two lanes on disjoint files; route contracts written once in `docs/design/well-wisher-engine-plan.md`; UI reaches a route only through an adapter file it owns with a null adapter; agents leave work uncommitted and each lane's integrator commits. Overrides the single-lane wave plan of 15.6 and D-V2-22 in part | One lane of waves (15.6 of 13 Nov); engine packages owning TypeScript adapter files (the forecast lens) | Owner direction: he likes two lanes in parallel, built by two chats, with shared files never edited by both; an agent's commit call has hung twice |
| D-V3-3, D-V3-4, D-V3-5 | The exam generator is the first feature and its smallest slice is built first; questions are crop-first; slide decks are read as PDF or by `.pptx` text with the standard library | Text-first questions (20.7.9); a slide library | Owner priority; scans and slides are his real material; a crop cannot be mis-read by OCR |
| D-V3-6, D-V3-7, D-V3-10 | The approved installs are four families; the Classroom connector uses the Google libraries and `keyring`, requests no Drive scope first, and the owner does every consent step himself with the client file at `data/ww/google/client.json`. Closes the lens questions Q-C8 and Q-C9 | A hand-written OAuth flow in the standard library (classroom lens); `requests_oauthlib` (forecast lens); a Drive scope for downloads (exam lens) | The owner approved the libraries; less custom security code; `drive.readonly` is restricted |
| D-V3-8, D-V3-9 | The weekly sign-in in Testing status is WAITING, not FAULT; every arrival is an Intake row taken by his action and never enters his counts | An automatic sync that writes to the calendar and the engine | Honest states; a deadline is not his own work |
| D-V3-11 | The harvester is extended with per-source adapters, a manifest and manual drop-in; local copies only per source on his switch. Overrides "pointers only" for those sources | A new harvester; pointers only for GATE | Owner request of 13 Nov; the manifest answers where each file came from |
| D-V3-12, D-V3-13, D-V3-14 | Readiness is three counts and no score; the model drafts and never grades (`marked_by` is the student or the checker); one `fsrs` review queue | A combined readiness score; two schedulers (the exam and Well Wisher lenses) | The no-result-claim rule (2.5); one queue per job |
| D-V3-15 | Exam Room is a face of `study.plan`, Exam Season a mode of `day.today`, the System dashboard a face of `console.health`, the reviews faces of `day.week` and `day.month`, and desks are overlays; the view count stays 36 | A 37th view `study.exam`; views `day.exams`, `console.system`; desks outside the count (Q-H1) | Study and Console are at the five-view maximum of section 3; faces and overlays reuse built mechanisms |
| D-V3-16 | Dashboards are one `SpecimenLayout` each, every number in a body with a lamp, a Hollow form, no urgency theatre | The default bento grid | Owner direction on dashboards; D-V2-7 and D-V2-8 |
| D-V3-19 | Default themes drop the hairline on labelled controls and keep a 3:1 cue inside state-bearing controls; hard 2 px edges in high contrast and forced colours. Revises the "every control edge at 3:1" part of G01 | A visible 3:1 edge on every control (G01) | "Highly refined components, buttons and shadows"; a text label identifies a control, a state-bearing control keeps an inner cue |
| D-V3-20 to D-V3-23 | Network features opt-in and read-only; forecasts as ranges; an optional exam-season freeze; the private data folder backed up to his own private repository | Default-on links; single-date forecasts; a mandatory freeze (removed by I34) | Local-first; honest forecasts; the owner's own backup |
| I44 | Where the lenses disagreed, the choices of the table in 21.1.3 stand (12 rows: ports ownership, adapter ownership, OAuth libraries, Drive scope, a 37th view, the season mode, two queues, three step lists, two fallbacks, the Runway id, E10 and E11 lane, the paper strip) | Each lens's own choice | One component per job, ids frozen, rules not weakened |
| I45 | The ranking of the wider features (21.6, 21.7) puts exam-season value first; only Term Ledger and the engine halves of voice intents, notices and GPU readings are scheduled before the flip; the rest is reserve (21.9) | Schedule all of the lenses' packages | Each added wave costs one slot and moves the flip by about 5.5 hours at the median (21.2) |

---

## 17 Open questions for the owner

### 17.1 Questions from the core (F1 to F14, and F15 added in the evening; F3 and F5 closed)

| # | Question | Default if unanswered |
|---|---|---|
| F1 | Visible section names: "Senses" and "Memory" with Aankhen and Yaadash as sublabels, or the brand names as the labels? | Functional labels in the rail; brand names in the view header |
| F2 | Is rewards-from-a-fixed-sequence (D17) acceptable in place of "variable but honest rewards"? | Deterministic only |
| F3 | **Closed 2026-11-12 evening (I34).** Do the Day, Life, Setup and Today-column moves land before or after the exam period? | **Answered: no exam wait.** The programme runs straight through, shared layers first (I35). Well Wisher flips behind the `ww.ia` flag (`ww.workspace` keeps its current meaning, decision I9) once Q01 passes, with a "moved to" hint in every old place for two weeks after the flip (target) |
| F4 | Should a reserved rail slot exist for the planned Coach and Agents, or stay dashed cards inside views? | Cards inside views (D2) |
| F5 | **Closed 2026-11-12 evening (I37).** The Well Wisher Alt+n order changes (Day first). Acceptable? Old order kept as aliases for one release? | **Answered by the owner's decision to order by reuse:** Day, Focus, Study, Tree, Career; Alt+n mirrors Ctrl+n; legacy ids keep resolving for deep links, not the old Alt numbers |
| F6 | First-run default themes differ per product (JARVIS dark, Well Wisher light), then one global choice. Agree? | Yes |
| F7 | The Core and room-side code (`core/playback.py`) must emit output RMS and a coarse band spectrum for a truthful voice hill. Who owns `core/` changes, and may the first release show input level only? | Input level only, with "no signal" for output, until the signal lands |
| F8 | WebView2 on the real laptop: may we run a measurement session (frame time, memory, idle CPU/GPU) before any art is built? All geometry in §3.3 and every performance number is a target until then | Yes, alongside the build; it no longer blocks it (I36) |
| F9 | Wake-word licence (CC BY-NC-SA 4.0) blocks selling JARVIS. Pick a replacement or accept the personal-use limit? | Personal use only; flagged in the roadmap |
| F10 | The reference pictures are private or third-party. Confirm that the shipped product uses only re-drawn derivatives, and that direct crops appear only in the private deck, never in the public repository | Yes |
| F11 | Body-double presence (TEST T2): include it in the prototype, or leave it out until the evidence improves? | Leave out |
| F12 | A serif for Well Wisher headings was suggested by one proposal (an assumption to test). Test it, or stay with Inter? | Stay with Inter |
| F13 | Should "Away mode" (arming alerts from presence) ship at all before the owner decides what it may alert about? | PLANNED card only |
| F14 | Legal review of public copy (UK and EU) before any public launch: who? | Flag in the roadmap; no public launch without it |
| F15 | Added 2026-11-12 evening (I37 to I39). The section and view order comes from estimated uses per day (§3.1.2), not measurements. After two weeks of real use on the new shell, does the order feel right, and do the visible, local view-visit counts agree? Is Focus second acceptable? Do the six counters belong on `day.today`? | Keep the order; swap by editing one binding table and one id table; revisit the counters only with the counts |

### 17.2 Questions and conflicts raised by the parts

| # | From | Question | Default if unanswered |
|---|---|---|---|
| X1 | Roadmap | Who owns `app/ui/src/ww/**`, `phone_page/ww.*`, `core/playback.py` and `core/jarvis.py` in `data/notes/NOW.md` section 2? The seam (§1.4) and the voice signal (F7) depend on it | Treat `ww/**` and `phone_page/ww.*` as the Well Wisher chat, `core/playback.py` as needing the owner's decision (F7); the owner's one-line answer is recorded (by R01 or directly) before B01 starts; no other build package waits for it |
| X2 | Roadmap | **Closed 2026-11-12 evening (I34).** The real exam dates (the freeze window was an assumption) | **No freeze exists, so no date gates the programme.** The dates stay in the private `NOW.md` only to schedule the exam features that resume after the remap |
| X3 | Review 2026-11-12 | Budget and deadline for a commissioned or licensed painting for `art.day.sun`, `art.tree.trunk` and `art.career.skyline` (§8.6.3) | Unknown, not zero; the procedural swap is the fallback and the customer build is described as plainer until Q04 passes |
| X4 | Review 2026-11-12 | May `desktop.py` raise or lower `min_size` (now 1120 x 720) so a 680 px usable display is not cropped? | Keep 720 as the floor; R01 records what 680 px does |
| X5 | Review 2026-11-12 | Install requests: a font-subsetting tool (for the digits-only Doto subset) and a sandbox `--fake-voice` replay mode | Ask now, so the last commit of B03 (the font step) and P02 are not stalled; neither is worked around. Everything else in B03 proceeds without the tool |
| C1 (voice) | Voice | Alt+0 instead of Ctrl+0 for swapping product (I1) | Alt+0; needs the owner's OK |
| C1 (screens) | Screens | The twin's pixel budget: the 720 x 360 canvas cap does not fit the existing full-bleed WebGL twin on `senses.presence` Map | The twin keeps its renderer, pixel-ratio cap 1.75 (1 at `low`, §10.7) and mounts only when Map is selected; the cap applies to every new canvas |
| C2 (voice) | Voice | Ctrl+1 to 5 and Alt+Left may be handled by the WebView2 host before the page | Alt aliases and the palette remain; verify in the real window (§14.6) |
| C3 (voice) | Voice | Who owns `core/` changes and may Tier 0 ship alone first (F7) | Tier 0 ships first; Tier 1 waits for the owner |
| C4 (voice) | Voice | The microphone dB window (-70 to -10) and the display sensitivity default are guesses | Measured on the real microphone in the F8 session and recorded in `docs/research/voice.md` |
| C5 (voice) | Voice | Host `IsVisible` wiring in `JARVIS.pyw` | Needs the owner's OK; until then the activity gate relies on `visibilitychange` and the 60 s idle rule |
| C6 (voice) | Voice | Is a 3,072-point Canvas 2D hill within budget on the integrated GPU | Decided by the F8 measurement; the governor's `low` level (1,280 points) is the designed fallback |
| C7 (voice) | Voice | Does a mute control exist in the core, or only text-only mode | Muted maps to text-only now; the explicit mute is PLANNED until the core reports it |

**Design system (S1 to S6).**

| # | Item | Default |
|---|---|---|
| S1 | The doubled `--edge-ui` plus `--edge-hair` language makes every control look outlined. If the owner finds it less "matte" than the references, the first lever is reducing `--edge-ui` alpha only on controls that have text, never below 3:1 on the surface | Keep as specified; review in the prototype phase |
| S2 | The shadow recipes in 6.4.4 are targets painted on paper; they must be judged on the real panel (a 1366x768 laptop panel has lower contrast and gamut than a desktop monitor; assumption) | Prototype check in light and dark, then freeze |
| S3 | Geist Mono advance width 0.6 em is an assumption in V6 | Confirm with a render before the rail is built |
| S4 | The `indigo` variant is carried only if it passes tables 6.3.3 | Drop it if it does not |
| S5 | `prefers-contrast: more` token values (ink-2 for ink-3 and edges) are computed on ground only here; the unit test must extend them to raised and sunk (light ink-2 on sunk is 6.14, dark on raised is 7.79, so they pass) | Done in the test |
| S6 | A digits-only Doto subset needs a subsetting tool and a licence check before running it (web.dev advises checking licence terms; the font is OFL as far as the fontsource package states, not re-verified here) | Verify the licence file before subsetting |

### 17.3 What has not been verified

No screen here was rendered. All px sizes are computed from §3.3 and unmeasured in WebView2 (F8). Click counts are counts of written steps, not measurements. Row counts per page (for example "5 turns", "21 log lines") assume 56, 76 or 104 px rows and are fitted by measurement in the build. Backend items marked "assumption" (the `day_closed` event, the plan "starts" field, output RMS, a phone microphone analyser, `/api/library` and `/api/energy` answering) are not confirmed in code.

The art part's list of unverified items is in §18.2; the performance and feasibility unknowns are in §14.1 and §14.2.


### 17.4 Questions added by direction v2 (13 Nov 2026)

F10 (the shipped product uses only re-drawn derivatives) is superseded by D-V2-1; X3 and F14 stay open only for a future release. F9 and F13 are unchanged. Questions the lenses asked more than once are merged.

| # | Question | Default if unanswered |
|---|---|---|
| Q-V2-1 | What does "gcr" mean (probably a course-file service)? If so, which account, and may the application request read-only access after he consents in a browser? | The control stays PLANNED (`ww.gcr`); the folder watch works today |
| Q-V2-2 | Which Google account and calendar to link, with his own sign-in in his browser and his own Google Cloud client in testing mode? Read-only first, or also write planned blocks out? | PLANNED; read-only first; nothing is written to Google |
| Q-V2-3 | Are past papers PDF, photos or both, and how many years per subject? May the application install an OCR engine, a PDF text library and an OS credential-store library for the Google token (sizes stated before install)? | Text-layer PDFs only; photos wait for the OCR install |
| Q-V2-4 | Attendance: is "margin" the right wording, and what is each subject's required percentage? | A per-subject field, empty until he enters it |
| Q-V2-5 | Should a local helpline list sit inside the habits drawer (a static list he edits)? | A plain "Help" entry with an empty list he fills |
| Q-V2-6 | Which Room channels are mains or heavy loads that should get the guarded two-act key? | None flagged; every key stays one press |
| Q-V2-7 | May the WebGL twin on Senses be retired in favour of the SVG floor plan? | The twin stays behind a "3D" key; the floor plan is the default |
| Q-V2-8 | Do the four chrome-emblem seals (C04-08) as tree branch-family marks suit him, or should seals stay plain rings? | The emblems |
| Q-V2-9 | Approve the evidence kinds for the self-defence tree (instructor-logged sessions or a grade) and the influence tree (recognition and ethics only)? | As specified |
| Q-V2-10 | Which fields and roles seed the Path constellation, and which universities and courses go in the first Abroad comparison? | Empty tables he fills |
| Q-V2-11 | May fetching a university page be a one-click button that stores the URL and a checked-on date? | Manual entry; the button is absent |
| Q-V2-12 | Is the Memory constellation acceptable given the "no growing art on Memory" clause (D-V2-25)? | Built; he may veto |
| Q-V2-13 | Should reminders default to spoken-off per reminder? | Off |
| Q-V2-14 | May an online image generator be used with a paid account, and should its outputs get private ids `G-nn`? | Not used |
| Q-V2-15 | Is the 90 KB ASCII budget and the 2.5 percent tooth grain acceptable on the laptop? | Adopted as targets; the 40 KB fallback applies if R01 measures a cost |
| Q-V2-16 | Is the Life month grid a view `day.month` (Day at five views, total 36) or its own section, and should day cells carry seed glyphs? | `day.month`, with seed glyphs |
| Q-V2-17 | Closed by the owner's note: Drill and Crucible both live in Focus | Closed |

### 17.5 Questions closed and added by the expanded horizons (14 Nov 2026)

**Closed by the owner's answers of 13 Nov.**

| # | Closed how |
|---|---|
| Q-V2-1 | "gcr" is Google Classroom; his classes are reachable from his personal account |
| Q-V2-2 (in part) | The account is his personal Google account; the Calendar link is read-only first and nothing is written to Google without its separate switch; the Cloud project exists, the client and consent screen do not (steps in 21.4.1) |
| Q-V2-3 | The approved installs are PyMuPDF, RapidOCR with onnxruntime on the GPU, the Google libraries with keyring, and fsrs; his material is PDFs, slide decks and Classroom items; previous-year papers come from the university's question-paper site and the harvester |
| Q-C1, Q-C2, Q-C3 (classroom lens) | Closed with Q-V2-1: a personal account makes an administrator block unlikely; the BLOCKED state stays designed |
| Q-C8, Q-C9 (classroom lens) | Closed: the Google libraries and `keyring` are used |
| Q-V2-11 (in part) | A fetch is a per-source harvester switch with a manifest, not a one-click page fetch of a university site; manual entry stays the fallback |

**Still open from direction v2** (unchanged defaults): Q-V2-4 attendance wording and each subject's required percentage; Q-V2-5 a local helpline list; Q-V2-6 which Room channels are heavy loads; Q-V2-7 the WebGL twin; Q-V2-8 the chrome-emblem seals; Q-V2-9 evidence kinds for the self-defence and influence trees; Q-V2-10 Path constellation fields and the first Abroad comparison; Q-V2-12 the Memory constellation; Q-V2-13 reminders spoken-off by default; Q-V2-14 an image generator; Q-V2-15 the ASCII budget; Q-V2-16 closed in 21.1.3 as D-V3-15 for the view count only.

**Added by the expanded horizons.**

| # | Question | Default if unanswered |
|---|---|---|
| Q-V3-1 | Which folder should the watcher use for downloaded course files? | `data/ww/inbox/` under the private data folder |
| Q-V3-2 | May the connector later request a Drive scope to download attachments (`drive.readonly` is restricted; `drive.file` needs a Picker per file)? | No; attachments are downloaded by him into the watched folder |
| Q-V3-3 | A weekly sign-in in Testing status, or publish the client to production (still unverified; whether it removes the 7-day limit is not verified)? | A weekly sign-in |
| Q-V3-4 | Show Classroom's "turned in, returned, late" states (default yes) and grades (default no)? | States yes, grades off |
| Q-V3-5 | Pull announcements at all (they can name teachers and classmates)? | Off, per course |
| Q-V3-6 | Does his Google Calendar export include the Classroom calendars? (unverified) | The paste and calendar-file doors work either way |
| Q-V3-7 | Which harvester sources to switch on first (the university's question-paper site, GATE, GRE, the dMAT source), and for each whether a local copy is allowed after he has read its terms? | All off; manual drop-in |
| Q-V3-8 | KaTeX in the print set (about 0.6 to 0.7 MB, an estimate), or maths printed as the crop? | Maths prints as the crop |
| Q-V3-9 | Buy a metering plug so the Devices view can show measured watts? | Not measured; the EnergyNote says so |
| Q-V3-10 | May desks be overlays and not views (D-V3-15; the lens question Q-H1)? | Overlays; he may veto |
| Q-V3-11 | Remote access for the phone companion beyond the existing Tailscale decision? | None |
| Q-V3-12 | When the GPU is shared by OCR and a resident local model, which waits? | The loader refuses a load that does not fit and names the numbers; OCR waits |
| Q-V3-13 | Turn the exam-season freeze on (the lead time stays in a private file)? | Off |

**Kept as still open from the lenses:** an online image generator (Q-V2-14), heavy Room loads (Q-V2-6), tree evidence kinds (Q-V2-9), and the Memory constellation (Q-V2-12).
---

## 18 Risks

### 18.1 Risk register

| # | Risk | Likelihood and impact | Mitigation |
|---|---|---|---|
| K1 | A shell change breaks the owner's daily tools now that nothing waits for the exams | Medium, high | Flags default off; the app works at every merge (full suites green before each merge); no `dist` rebuild with changed defaults while the app runs and not without the owner's OK; B01 to B04 are behaviour-preserving and screenshot-diffed; the shell rewrite stays on a branch until it is green (§15.2) |
| K2 | Learned places move mid-semester, and Focus moves up the Well Wisher rail (I37) | Medium, medium | `ww.ia` flips only after Q01, with "moved to" hints in every old place for two weeks after the flip (target); legacy ids resolve; the order is one binding table, cheap to swap back |
| K3 | The registry rots: entries stay after features ship, or lines drift | High over time, medium | T1 to T10, "entries past review" in the gate, deletion in the shipping commit |
| K4 | A lamp lies (a default of LIVE, a number with no state) | Low if tested, high | Default WAITING; the "no number without a state" test; Q01 audit |
| K5 | iGPU and WebView2 cost is unmeasured; art blows the budget | Medium, high | R01 runs alongside and its numbers replace the targets when they land; art packages (B05b, B06b) are judged against the targets and the stop rule meanwhile; stop rule; one rAF loop per visible piece; canvases at most 720x360 CSS px |
| K6 | VRAM contention between Whisper and the 4B model | Medium, medium | Measure both loaded in R01; load the coach on request only; one request at a time; fallback text on FAULT |
| K7 | The honest voice hill needs `core/` changes nobody owns (X1, F7) | Medium, medium | R02 spike first; if no-go the hill ships input level plus "no signal" for output |
| K8 | Per-product builds leak imports back (cycles) | Medium, medium | Import-graph test and lint land in B01, before any section moves |
| K9 | Wake-word model licence blocks selling JARVIS | Certain if sold | Flagged (`jarvis.wake-custom`, F9, R04); the personal app is unaffected; Well Wisher has no wake word |
| K10 | Public copy reads as a health claim | Low if checked, high | Say and do-not-say list; Q03 copy audit; legal review before public launch (F14) |
| K11 | Learning loops drift into telemetry or nagging | Medium, high | Local-only test, no long strings, per-loop off by default, no coupling to nudges (13.7.2) |
| K12 | Scope creep through art and new features | High, medium | One centrepiece per section; the do-not-build list; WP scope lines are the contract |
| K13 | Two chats edit the same file | Medium, medium | One integrator merges; section 2 ownership table; announce shared edits in NOW.md section 6 before starting; `ww/**` ownership settled in R01 (X1) |
| K14 | Test baselines churn (screenshots) | High, low | Update snapshots only in the WP that changes the visuals; the owner reviews kit baselines (still open in NOW.md) |
| K15 | One-person validation reads as evidence | Medium, medium | Label every result "owner session, n = 1"; defaults stand when the owner skips a test |
| K16 | FSRS cold start feels wrong on few cards | Medium, low | Defaults until about 1,000 reviews (assumption) with a visible `DEFAULT` chip; fixed-intervals switch |

### 18.2 Risks and unverified items specific to the parts

**Art direction.**

- All sizes and frame costs are targets. No art has been rendered in WebView2 on the owner's laptop; F8 (a measurement session) should run before the first prototype.
- Cell metrics (7.2 x 16 px) are an assumption from Geist Mono's advance width; measure with the loaded font.
- The silhouette IoU threshold of 0.5 and the 600 KB payload are assumptions.
- The crops in the catalogue are JPEG proofs; the full-resolution PNG collages decide the final sharpness. Alpha edges for masks need a pass by eye.
- Several third-party sources look AI-generated or resemble published work. The customer track depends on the redraw rule and a human check. Legal review (F14) is outstanding.
- "Public domain" for C04-43, C04-32 and C04-109 refers to the original works the pictures appear to show (assumption from the catalogue notes). Each must be re-sourced and its licence confirmed before release.
- Some JARVIS section screens (the Senses left column, the Console skyline position) are placed against the geometry in §3.3, not against built pages, because JARVIS pages are not yet reworked. Positions are provisional until the section layouts are final.

**Voice, motion and budgets.** (1) the Canvas 2D point count may miss the budget on the integrated GPU, so the governor's `low` level is the designed fallback; (2) Ctrl+digit and Alt+Left may be swallowed by the host, so Alt aliases and the palette exist as routes; (3) AnalyserNode on window audio is unproven in WebView2, so T2 is last; (4) headless Chromium cannot give real frame times, so absolute budgets need the real-window session (F8) and CI enforces regressions only; (5) a hidden WebView2 page keeps WebSocket-fed work alive, so the activity gate must stop DOM writes itself (S6 finding 24).

**Migration.** The migration risks (moving learned places during exams, losing honesty logic in the Aankhen and Limbs splits, the Now strip failing the two-tap target, renaming `ww/life`, `germoney/` being load-bearing, new backend assumptions) are tabulated with mitigations in §5.9.

---

## 19 Do-not-build list

| Category | Do not build |
|---|---|
| Sensing | A camera, webcam, eye or face motif; radar; pose, skeleton or "estimate avatar" from one link; attention, mood or emotion inference from Wi-Fi; C04-26 and C03-12 as defaults |
| Presence claims | Security or safety claims from presence (no "security alert", no "safe", no alarm); present, absent or "empty room" wording from one link; a zone name from one link; a dB figure on the legacy level |
| Honesty | Simulated data shown as measured; a canned voice wave; a count, ring or bar on a planned item; any metric with no state |
| Retention | Loss-framed streaks, countdown-to-loss, streak repair; variable or random rewards; points for opening the app; leaderboards; "we miss you"; re-asking after a decline; more than three batched check-ins a day; a default-on engagement setting |
| Health claims | Any ADHD mode, screening or treatment wording; efficacy numbers (for example "d = 0.65"); "clinically proven" |
| Models | A procrastination or energy predictor; a learned next-action ranker or bandit; BKT or DKT; SM-2 as a choice; an LLM that grades, computes marks or states a pass probability; an LLM-written progress claim; a cloud model that sees private notes |
| Data | An external analytics or telemetry SDK; any loop that stores text or audio; engagement data leaving the machine |
| Visual and performance | New WebGL (the Senses twin stays the only renderer; `ww/` creates none); `backdrop-filter`; animated `box-shadow`; Lenis, GSAP or other award-site stacks; canvases over 720x360 CSS px; pasted reference pictures; a default bento grid |
| Structure | A fifth port without a decision-log entry; a rail slot for a planned feature; two navigations; a planned feature that is the only way to an existing one; mounting MemoryGalaxy or GrowthChart |
| Integrations | Spotify play by name before an account that allows it and a registered app exist; Away mode alerts before the owner decides what it may alert about (F13); body-double presence (F11) until evidence improves; auto-locking tasks into micro-steps |
| Dependencies | AGPL, GPL, non-commercial or unlicensed code embedded; an install without the owner's OK |
| Legacy | The Arduino Uno wiring guide, `BoardId 'uno'`, a duplicate pairing card |

**Additions from the voice and motion part** (kept so nothing in the source is lost): a solid-point flat line in any state without a fresh frame; a blinking cursor or colon, scanlines and per-pair route sweeps; art driven by stored-item counts or by a high-water mark; a "closeness" or ranking of real people; a "You opened this N times" line on a planned row; a canned or looping waveform in any state; per-utterance auto-gain on the voice picture; GSAP, Lenis, Framer or any smooth-scroll library; CRT flicker or scanline animation; a global single-letter shortcut; a held-key-only action; a "focus score" or attention reading from sensing or from audio level.


**Additions from direction v2** (13 Nov 2026). The row "pasted reference pictures" above is narrowed by D-V2-1: in the private build a reference picture may be placed directly, but never in a tracked file and never as a screenshot, README or store image. Everything the six lenses ruled out stands as part of this list; the full wording of the lens items is in 20.12 and the table below is the checkable form (each row has a copy or lint test in Q03).

| Category | Do not build (direction v2) |
|---|---|
| Sensing | A camera, webcam or any image sensor, anywhere, for any feature (Study, Day, Senses or Room); an eye, face or body form in Senses (C04-26, C03-12 stay out); a digit in the presence arc before the held-out check passes; a scrubber that changes a lamp; a motion tape that implies an empty room |
| Results and claims | A guaranteed, likely, expected or "will be asked" exam result; a score, grade or pass probability on any paper pattern, retention estimate or practice set; a model that grades, adds a topic or invents a number; a decimal for the retention estimate; a forecast of a job, admission or scholarship outcome; an investment or interest-rate claim |
| Health and mind | Medical or psychological treatment, diagnosis, screening or management claims; medical wording on water, medicines, habits, sleep or training; a dose, a suggestion of what to take, or a comment on a condition in a medication reminder; a risk score on a habit; a node in the body or health trees that diagnoses or treats |
| Retention | A streak, chain, "days clean", reset or relapse language anywhere, including habit counters; red for a missed or carried item; "missed" and "overdue" wording; reminder escalation of any kind (volume, frequency, severity) |
| Trees and Career | A node unlocked by a self-mark; XP bars or percentage spinners on trees; a free-scroll zoom between Tree scales; a tactic aimed at a named person in the influence tree; a Career fee or date shown without a "checked on" stamp; a Career figure quoted as verified other than the one in 20.8.6 |
| Integrations and data | An automatic bank read; a Google Calendar write without its separate switch; credentials typed, read or stored by the assistant; a refresh token outside the OS credential store; a private catalogue picture in any tracked file, screenshot, README or store image; an image-generator output in a tracked file |
| Structure and visual | A native `<select>` in a shipped view; a shell or `eval` behind the command line; an unlabelled model-written string; a number with no lamp; a sigil that replaces a lamp; ASCII atmosphere bound to a stored count; a hinged guard that makes OFF harder than ON; tooth or aimed light in forced colours; a custom cursor larger than 32 px; a pointer companion in calm, at governor `low`, on touch or in forced colours; a per-package edit to a barrel file or to a file another package of the wave owns |

**Additions from the expanded horizons** (14 Nov 2026). Everything the lenses ruled out stands; the checkable form (each row has a copy, lint or scan test in Q03):

| Category | Do not build (expanded horizons) |
|---|---|
| Classroom and Google | A write scope; a Drive scope without his explicit yes; a roster or teacher scope; a key that downloads an attachment for him; a Classroom deadline counted as his own work; a grade shown by default; a "connected" label before a first successful read; a token or client secret outside the credential store and `data/ww/google/client.json`; the assistant typing, reading, printing or storing a credential; a client library other than the approved ones |
| Exam engine | A model that grades, marks or invents a number; unverified OCR text printed as text; a combined readiness score, or a percentage labelled ready, chance, likely or expected; a "due" wording on the Quiet list; a countdown or remaining count in Tonight; a pattern with fewer than 3 papers drawn as a finding; a generated paper that fails `paper_invariants` |
| Harvester | A request while every source is off; a local copy without its own switch; a request that ignores `robots.txt`; more than 1 request per 3 seconds per host or 200 a day; a retry after a second 403 or 429; a file with no manifest line; a source without a recorded terms note switched on; a harvested file in a tracked path |
| Dashboards | A red fill, pulse, shrinking bar, "only N days", streak or pass probability; a number outside a body with a lamp; two equal stat tiles in a row; a single-date forecast; a dashboard that writes anything but its own notes, carries and the exam window |
| Wider features | A sleep score, "sleep debt" or medical advice; a streak or "days since" on a habit; a bank link; an opportunity rank by probability; a rule that switches a heavy load ON, that uses the words present or absent, or that decides a reminder; a model eviction without a refusal naming the numbers; a wattage digit without a metering source; a voice rule saved without Enter; an agent verb moved out of "May never" by the agent |
| Process | An engine package that owns a TypeScript path; a UI package that owns a Python path; two chats editing one shared file; an agent-authored commit; a route call with no entry in the engine plan file; a view id `study.exam`, `day.exams` or `console.system` |

---

## 20 Direction v2 (13 Nov 2026): what changed and what now governs

**Status.** Binding. On 13 Nov 2026 the owner changed direction after seeing the first rebuilt screens ("boring and lifeless"). Six design lenses (visual systems, data display, Life and Day, Study and Focus, Tree and Career, the JARVIS sections) were written against this specification and merged here. Where this section contradicts an earlier section, **this section governs**, and each superseded earlier subsection carries a one-line pointer ("Superseded in part by 20.x"). Rules that are not named here stand unchanged. Nothing in this section edits code. Every number is a target until measured in the real window (§0.4); the lenses rendered nothing, and only a handful of catalogue crops were looked at by eye, so every placement of a picture is a design claim until the first gallery pass (20.15).

### 20.1 The owner's direction, in public-safe words

**Process and tooling.**
1. The new work must be visible in the running application, not only on paper.
2. Parallel builders broke at merge. Every builder must know in a few lines what it creates and what the other builders of its wave create, so the flow does not break at merge.
3. Every chat summary is labelled with a description of what was done in it (the summaries are imported into other agents). Recorded as D-V2-28; it is a workflow rule, not an application feature.
4. The full new UI is built inside the current application, not overlapping the old one: a button shows the new UI and the latest changes like a live viewer. If it costs a lot of effort, drop it; otherwise build it. Decision: build it, small (package N01).
5. The whole application is rethought (JARVIS, Core, every section of the ten-section map): components sitting right, new themes, picture placements, all connections, a new Yaadash look, new graphs, training and drill, the Life segment, calendars, and components as in the reference images.
6. The slide deck of the programme is a private file under the private design-taste notes folder (`data/notes/design-taste/`), git-ignored; its path is in the private state file.
7. Cybersigil line work and ASCII art were sidelined and must be integrated properly.
8. Third-party pictures are fine because the application is for personal use only. Because it is personal, it must be more refined than industry standard. An online image generator, asking the owner for pictures, or third-party pictures are all allowed (the generator needs the owner's account and consent).
9. Allowed from now on: third-party assets, web searches, omissions, workflow updates, a better-articulated loop prompt, and continuing the loop afterwards.
10. A researcher agent commits the changes to the respective files; workflow agents are told where to take inputs from and what changed, at scale.

**Design brief.**
- Everything the application holds is shown in an extravagant, out-of-the-box, award-style way with varied components: calendars, data, live counts, college, attendance, timetable, all trees, Aankhen, JARVIS, voice, the Limbs and relays, reminders, the study components. Engaging, linked, tracked, entered, every placeholder on-theme.
- Study: a question generator takes a PDF and the backend makes questions and papers from it. A "connect through gcr" control was named; its meaning is unclear (probably a course-file service); it is an owner question (Q-V2-1) and ships as a PLANNED control.
- Dropdowns, list animations, lists and tables are rethought. Trees: the whole pane, placement, node interaction, hover, cursor; many more skills (for example a self-defence skill set and the psychology of influence); every tree gets images and graphics.
- Feel: the matte clay finish must be neither very alive nor dead, hold focus and say much without saying much: clean, elegant, modern, futuristic, neumorphic, cyberpunk, with terminal styles and cybersigil work in places.
- Yaadash gets new, more interactive components. The settings page need not exist: each setting sits where its variable is used.
- Life (or a new data section): a month calendar with every day in a grid, coloured by the actions done; tapping a day shows what happened and what is planned; recurring "next time" reminders by weekday, month and year. The same calendar holds the week, gym, water, medication reminders, class reminders, next-day, week and month planners, linked to Google Calendar.
- Well Wisher's job: plan the day, help reduce habits the student wants to reduce, track daily spending, focus study, shape skills, improve retention, and create academic opportunities by rigorous practice: find the near opportunity and prepare for it. Exams follow previous-year questions: the engine tracks them, reads papers, finds patterns (question types, difficulty, units, topics), hand-picks questions and prepares the student on the highest-scoring units.
- Career: a full revamp that looks amazing (internships, jobs, advice, knowledge of the chosen career linked to Life, the trees and social skills; universities abroad, courses, tables, grids, certificates, money, plan), fun, with many entries.
- Focus holds the Crucible and Drill; setup holds the rest (in the older carcass).
- Each page is thought through in detail with room for invention: described designs, not orders.

**What it changes (integrator's reading).** Asset rights: the customer-release track is no longer a gate for the build (D-V2-1; §8.6 rewritten). Cybersigil and ASCII become first-class systems. New or changed scope: Life calendar, settings dissolved into context, expanded trees with imagery and an evidence ledger, a previous-year-question engine, PDF to practice paper, spending and habit logs, gym, water and medication reminders, the Career revamp, richer Yaadash (memory). Process: a wave contract, a preview switch, labelled summaries.

### 20.2 Decisions (each testable)

| # | Decision | Test that proves it |
|---|---|---|
| D-V2-1 | **Personal-use rule.** The private build is the product. Third-party pictures and their derivatives are placed directly, including full-bleed and composited. They stay out of tracked files, out of the public repository, out of screenshots, README and store images, and are named only by catalogue id | `tools/art/check_no_private_in_dist.py` fails on any private hash in a `dist` that leaves the machine; a tracked-file scan finds no image bytes of a private id; the build runs with and without the private folder |
| D-V2-2 | Sigil, ASCII and terminal are three first-class grammars with tokens, components, budgets and tests. Every view uses at least two; none uses all three at full strength | `data-grammar` attribute lint per `data-view`; budgets in 20.4 |
| D-V2-3 | Sigils are generated, never pasted: the same id always gives the same SVG bytes, at most 60 segments and 3 KB | golden-file test; `build_art.py --check` |
| D-V2-4 | ASCII carries real data in four places only (Life heat cells, bars, people placeholders, console tables). Everything else is `aria-hidden` atmosphere never bound to a stored count. Budget target raised from 40 KB to 90 KB across the app, at most 8 KB per file and 6 files per section, lazy per section; the 40 KB figure stays as the fallback if R01 measures a cost | byte-budget check; a lint that rejects atmosphere bound to a count |
| D-V2-5 | The terminal grammar is a recessed charcoal well inside clay, in both themes: prompt, log tail, bracket tags equal to lamp words, a solid block cursor; no blink, no scanlines, no flicker | tag set equals the lamp word set; zero running animations at idle |
| D-V2-6 | Clay gains life by five static or opacity-only moves (lit edge, inked engraving, 2.5 percent tooth, one accent fill per view, a pointer-aimed light on the single hovered panel in 8 quantised angles) plus a 1 px focus settle. Rule: at idle zero things move; under the pointer exactly one thing responds; on a data change exactly one thing draws | lint counts accent-filled elements per `data-view`; idle `getAnimations()` is empty; one aimed light at a time |
| D-V2-7 | **Specimen and Datum** replaces the default bento for views that adopt `SpecimenLayout`: one specimen (55 to 62 percent of canvas width), one datum line at 40 percent of canvas height, at most five margin Callouts, one drawer. Where a lens below gives an explicit box for a view, that box governs | for `SpecimenLayout` views: at most one object wider than 40 percent; no two equal-size stat tiles in a row; no document scroll at 1366x768 and 390 px |
| D-V2-8 | Every number gets a body (Odometer, Stipple ring, Trace, Dumbbell), not a card. A bare 14 px number is allowed only in a table cell | lint on `Stat` outside tables requires a `form` prop |
| D-V2-9 | One calendar family, `Almanac`, four zoom levels (year, month, week, day) with one `DayCell` and one drawer. Action kinds are **shapes**, colour is a second cue; done is a filled glyph, planned is the same glyph hollow; a planned item that did not happen becomes a quiet carried outline, never red | shape table is the test fixture; no component accepts a `currentStreak` prop; copy grep (20.6) |
| D-V2-10 | The Life calendar is the new named view `day.month` (Day goes from four to five views); Drill is the new view `focus.drill` (Focus from three to four). Total views 34 becomes 36. Career stays at five views (the lens's sixth view, Path, lives inside `career.ladder`) | a new `__tests__/shell/viewCount.test.ts` asserts 36 (the present 34 lives in `e2e/shell-v2.spec.ts`); `check_ids.py` green; legacy aliases resolve |
| D-V2-11 | **Drill and Crucible both live in Focus**, overriding §4.4.2 (which moved Drill to Study). `study.practice` becomes the set-up door into Drill. The legacy id `drill` resolves to `focus.drill` | alias test; `focus.drill` mounts |
| D-V2-12 | The settings sheet is dissolved: every setting gets a recessed **Trim** key where its variable is used, plus a searchable index in the command palette (`:` mode) generated from one registry. The ids `settings.*` stay as aliases that open the Trim popover at the new home | registry test: no orphan entry, no unregistered form field; every alias resolves |
| D-V2-13 | The Google Calendar link is PLANNED until configured, WAITING while the owner consents in his own browser, LIVE after the first successful read; read-only by default, writing planned blocks out is a second, separate switch; desktop loopback with PKCE; the refresh token lives in the OS credential store, never in `data/` as plain text or in tracked files; the assistant never types or stores credentials | states reachable in a bench with a fake provider; disconnect deletes the cache; no secret in the repository |
| D-V2-14 | "Connect through gcr" ships as a PLANNED control (`ww.gcr`, dashed plate) until Q-V2-1 is answered; a folder watch works today beside it | stale-entry tests T1 to T10 pass; the plate opens an explanation, never a form |
| D-V2-15 | The previous-year-question engine reports **counts with Wilson 95 percent intervals**, never forecasts. Below 3 papers on file a topic shows "too few papers to show a pattern". Nothing enters the bank until the student reviews it. Every tag carries a `RULE`, `MODEL` or `HAND` chip; a model may only pick among existing topics and never grades, scores or writes a number | purity test run twice; forbidden-word list test on every output string; a mutation test on the tag margin |
| D-V2-16 | "What to practise next" is one printed formula: gain = (marks share x papers-seen share) x (1 minus proficiency), ranked per minute of the free gap, terms printed on the card, with "Not this" and "Choose another" | fixtures reproduce five real cases the owner agrees with before shipping (V01) |
| D-V2-17 | **Trees are evidence-gated.** Ten trees, 113 branches. A self-mark draws CLAIMED (hollow core) and never EVIDENCED. Six evidence kinds. Growth (pips, trunk mask) is a pure function of the evidence ledger and falls when a record is deleted. The body (self-defence) tree needs instructor-logged sessions or a grade; the influence tree teaches recognising and resisting manipulation and honest persuasion, with no tactic aimed at a named person | unlock-rule unit tests; deleting a record recomputes; copy grep on influence nodes |
| D-V2-18 | Career dates and fees carry a "checked on" stamp; an unconfirmed value is WAITING "unconfirmed", never a bare number. Only the 10,332 euros proof-of-finances figure is quoted as verified (opened 13 Nov 2026) | cell-lamp test: no figure without a stamp |
| D-V2-19 | JARVIS sections gain structural systems: a four-node pipeline ribbon and an organ strip (Core); a guarded two-act key for heavy-load channels the owner flags and a 24-hour schedule ring with a PREVIEW-only scrubber (Room); one terrain canvas per view, a probability arc that shows only LOW, MID, HIGH and PREDICTING until the held-out check passes, and a motion tape that never implies an empty room (Senses); constellation, strata and trail views of one store (Memory); a closed-verb command line and real-fraction job rows (Console) | per-component tests in 20.9 |
| D-V2-20 | The WebGL twin stays as the existing renderer behind a "3D" key; an SVG isometric floor plan becomes the default Map form. The twin is retired only with the owner's yes (Q-V2-7). The lens proposed retiring it now on a "no WebGL" rule that is not in the owner's direction note | no new WebGL import; the twin mounts only when 3D is selected |
| D-V2-21 | Reminders use a fixed ladder (toast, chime if on, one spoken line if on, one user-set snooze) with delivery receipts; no escalation; Quiet silences all and cannot be lifted; presence never decides whether to speak; no "missed", "overdue" or health claim; medication reminders are scheduled notices the student typed: "Reminders you set. Not medical advice." | no code path raises volume, frequency or wording severity; copy grep |
| D-V2-22 | **Wave contract and parallel width.** Work is built in waves of 3 to 5 packages that own disjoint files and folders; a package depends only on earlier waves. The integrator hands every builder one short table (Block C rule 13). This replaces "at most two packages in flight" of §15.1 | the contract table exists for every wave; the merge test in 20.14 |
| D-V2-23 | The first thing the owner sees is a preview switch in the current application (it turns the new shell on when B05 has merged) and a "What is new" gallery (package N01). Each package adds one gallery entry file | the gallery lists every merged package; the switch persists per browser |
| D-V2-24 | The cursor kit (reticle, bracket, plan, wait, hold) is on by default in the private build; hover draws four corner brackets in 100 ms; the pointer companion is off in calm, at governor `low`, on touch and in forced colours | cursor assets at most 32 x 32 with a keyword fallback; zero rAF 2 s after the last input |
| D-V2-25 | Memory may draw a constellation of its own store (a map, not a reward): no celebration, no high-water mark, deleting a node removes it plainly, and the node count equals the Holdings count. This is the single exception to the "no growing art on Memory" clause of §8.3.4, and it still obeys §8.5.5 (pure function of current counts, may fall) | node count equals stored count in a test |
| D-V2-26 | Seals are deterministic: a function of the node id (or day action set), drawn once when evidence exists, and they fall when the evidence is deleted. A seal is earned by evidence, never by a self-mark (this narrows the visual lens, which drew it on marking) | seal test: same id gives same SVG; no seal without an evidence record |
| D-V2-27 | Rule-based art and logic first. An image generator for extra pictures is allowed with the owner's account and consent; its outputs get private ids `G-nn` in the private manifest and never enter tracked files | manifest check |
| D-V2-28 | Process rules recorded, implemented outside the application: every chat and agent summary begins with one label line stating what was done in it; a researcher agent commits research to the topic files; agents are told in a few lines what changed in the plan and where to read | checked by the loop prompt, not by a test |

### 20.3 Where the lenses disagreed, and what was chosen

| Topic | Disagreement | Chosen, and why |
|---|---|---|
| Month grid geometry | Data lens: a 400 x 340 plate with a permanent 330 px drawer. Life lens: 900 x 548 grid of 128 x 86 cells with a 314 px side panel and a 560 px drawer | Life lens. A 128 x 86 cell holds four marks and a stipple strip; the small plate does not. The data lens's permanent drawer is kept as the side panel |
| Calendar component names | `Almanac` and `DayCell` (data) against `LifeCalendar` and `DayMark` (Life) | `Almanac` is the one engine with four zoom levels; `DayCell` is its cell; `DayMark` is the glyph; `LifeCalendar` is dropped |
| Sigil generators | primitives with FNV-1a and mulberry32 (visual), L-system (study), counts-driven radial (data), 96-tick bezel (JARVIS) | One engine, `Sigil`, from the 14 traced primitives. `SigilMark` (arms from counts), `SigilGauge` (arc plus mastery) and `SigilRing` (bezel) are thin wrappers. The L-system stays as a `growth` mode for `SigilGauge` and the rule-generated `art.memory.branch` |
| Capture fields | `CaptureLine` for spending, water, gym, reminders (data) against `remember>` and `CommandLine` (JARVIS) | One `CaptureLine` in `shared/capture` with a `grammar` prop. Grammars: `ww` (spend, water, gym, remind) and `jarvis` (remember). `CommandLine` is a `CaptureLine` with a closed verb grammar |
| Constellation | Memory graph as `TetherMap` (data) against `Constellation` (JARVIS); a role constellation in Career (tree lens) | Memory uses the JARVIS lens's golden-angle `MemoryConstellation`; `TetherMap` is dropped (its list twin and level keys are kept). Career's is named `RoleConstellation` |
| Room layout | Rack of six rows (data) against the wall-box faceplate (JARVIS) | Wall box with `GuardKey` stays the Room view (matches §4.3.2). `RackRow` is used in `console.hardware` for the relay inventory. Both share one three-phase confirmation vocabulary |
| Where Drill lives | Study (§4.4.2) against Focus (the owner's note) | Focus (D-V2-11) |
| Career views | Six (tree lens) against the five-view ceiling of §4.1.4 | Five ids; Path is a second state of `career.ladder` (a Segmented "Ladder, Path") |
| Senses views | Merge `senses.signal` into presence (JARVIS lens) against frozen ids | The id stays. `senses.presence` holds the one terrain canvas; `senses.signal` becomes an SVG-only Spectrum view with no canvas, so the view count is unchanged and each view holds at most one canvas |
| Cursors | A cursor kit on by default (visual) against "no custom cursors" on Study and "crosshair off by default" on Tree | The kit is on by default in the private build (D-V2-24); one Trim in the title bar switches it off. The per-view statements are replaced |
| Seals | Drawn on marking (visual) against evidence only (tree) | Evidence only (D-V2-26) |
| Strict composition rule | "No view has two objects wider than 40 percent" (data) against two-column layouts in other lenses | The rule applies to `SpecimenLayout` views only (D-V2-7) |
| Settings count | "About 60" entries, an estimate | The registry test, not the estimate, is the contract |
| Package ids | Each lens used S01.., D01.., L01.., S01.. (study), T01.., J01.. | Renumbered with family prefixes G, D, L, Y, T, J, N (20.13). Study's packages are Y01 to Y12 so they do not collide with the visual lens's |

### 20.4 Visual systems: sigil, ASCII, terminal, living clay

**What changes.** Sigil, ASCII and terminal each get a token set, a component set, a budget and a test; every view uses at least two. A sigil never replaces a lamp: the lamp (shape plus word) always sits beside it. Cybersigil is a data channel and a frame, not decoration.

#### 20.4.1 Sigil grammar

**Primitive set (14, traced).** Corner bracket, target cross, diamond, diamond chain (3 to 7), X mark, dashed arc (90 and 180 degrees), stripe block (3 bars), tick ruler (8 to 60 ticks), nested triangle, circle, hexagon, spiral flourish, thorn (a tapered curve), lettered ring (a glyph alphabet around a circle). Sources: C01-18 for the first nine, C03-06 for triangles, hexagon and circles, C04-127 for the lettered ring and logic-gate schematics, C04-08 for thorns. C03-03, C03-14 and C04-122 are read for density only.

**Stroke weights.** Three: 1 px (hair, decorative), 1.5 px (structural), 2 px (state marks and seals); `vector-effect: non-scaling-stroke`. Fill only on 4 px cells. Colour `--ink-2` on light, `--ink-1` on charcoal, never the accent, never a state colour (state colour belongs to lamps).

**Five roles, and only these.**

| Role | Where | Form | Size |
|---|---|---|---|
| Frame | panel corners, centrepiece plates | four corner brackets plus one tick ruler on one side | bracket arm 8 px |
| Divider | between view header and canvas; inside long drawers | diamond chain with a 1 px hairline both sides | 12 px high, full width |
| Seed glyph | empty states, people, tree nodes, day seals | generated n-fold glyph | 48 px (empty), 24 px (node), 16 px (day cell) |
| Seal | mastery, finished block, completed paper | closed ring plus seed glyph | 32 px |
| Scale | gauges, dials, week strips | tick ruler | 60 ticks over 270 degrees on dials |

**Generator (rule-based, no model).** FNV-1a 32 of the id seeds mulberry32. Pick fold n from {2, 4, 6, 8}; pick 3 to 5 primitives by weight; place on 2 to 3 concentric radii; mirror or rotate; stop at 60 segments. The output SVG string is cached in memory by id and size. Bilateral mode (n = 2) uses thorns and is the "chrome tribal" family from C04-08, reserved for seals. **Tracer:** `tools/art/trace_sigil.py` crops by bounding box, thresholds, runs marching squares and Ramer-Douglas-Peucker (epsilon 0.8 px), and emits at most 60 segments per shape; with the private track it writes to the private folder (the 14 primitives are then redrawn by hand as `own/` SVG for a future separation).

**Motion.** One-shot draw-in with `stroke-dashoffset` (spec 10.5: under 640 px, 60 segments, 400 ms, one at a time). Static and reduced-motion form is the final drawing. **Mobile:** frames drop to corner brackets; dividers shrink to 8 px; seed glyphs keep 48 px.

**Components.** `Sigil` (`seed`, `size` 16, 24 or 48, `fold`, `tone`; static, drawn-in, reduced), `SigilFrame` (`sides`, `arm`; default, focus, planned dashed), `GlyphRule` (`length`, `density`), `Seal` (`id`, `earned`; earned, hollow, simulated stamp), `SigilMark` (arms from counts), `SigilGauge`, `SigilRing`.

#### 20.4.2 ASCII grammar

| Ramp | Glyphs | Use |
|---|---|---|
| `r10` | ` .:-=+*#%@` | portraits, backdrops |
| `r5` | ` .:+#` | data cells (five distinguishable levels) |
| `caret` | ` .^AM` | triangle-character fields (C04-113), memory and tree backdrops |
| `edge` | `/ \ | _ -` | Sobel edge pass on contours |

**Cell tiers.** Data cell 7.2 x 16 px (Geist Mono 12 px, the legibility floor). Atmosphere cell 6 x 12 px (10 px type), decorative, `aria-hidden`. Nothing smaller.

**Where ASCII carries data (each with a text equivalent and a lamp).** `AsciiHeat`: Life month grid, one `r5` glyph per day cell by that day's action count, the cell number stays text. `AsciiBar`: `[#######---] 70 %` rows for study units, water, spend (the percentage is text). `AsciiPortrait`: a ring of heavy glyphs from an initials hash (C04-48), so no face is drawn. Console tables and log tails.

**Where it is atmosphere.** Backdrops (C04-119 branch, C04-125 asleep silhouette edge only, C04-20 hands), plates, empty states, the loader. Pre-rendered `.txt` in a `<pre aria-hidden="true">`, at most 8 KB raw, 6 files per section, 90 KB across the application (D-V2-4).

**Behaviours bound to state (each with a static form).** Sweep: 4 pre-baked frames at 8 fps while pending over 150 ms, 3 s cap, then frame 1 plus "Still loading" and the WAITING lamp. Growth: glyph density follows a fixed permutation by a real current count (§8.5.5), may fall, the caption says what it follows. Freeze: WAITING shows a frozen 1-bit Bayer field (C04-41), never animated. Scatter: on FAULT the plate's glyphs become a seeded permutation of `/ \ x` in 160 ms, then static.

**Components.** `AsciiPlate` (`artId`, `ramp`, `tier`; static, frozen, scattered), `AsciiHeat` and `AsciiBar` (`rows`, `ramp`, `reading` required; per lamp state), `AsciiPortrait` (`initials`); plus `sparkline(values)` returning the block-character twin (`▁▂▃▅▇`) used by every Trace.

#### 20.4.3 Terminal grammar

**Anatomy.** A well: `--term-ground` recessed panel (charcoal in both themes), 1 px `--edge-ui`, corner brackets, a ruler on the left edge. Lines: `prompt` (`ww day.today $` or `jarvis core $`: product and view id, never a personal name), `out`, `log` with bracket tags `[LIVE] [SIM] [WAIT] [PLAN] [FAULT]` (words equal the lamp states), `err`. Cursor is a solid block, no blink, no scanlines, no flicker (§10.5 stands).

**Where it appears.** `console.*` (whole view; C04-10 frame, C04-16 columns, C04-18 brackets). Boot (`art.shell.boot`): three rows "heard, working, done" (C01-14) typed at 24 characters per second, 600 ms cap, any key skips, calm shows all rows at once. Loading: a well with the sweep and one real line ("reading syllabus index"), no fake percentage. Empty: a well with one prompt and one suggested command as a button, plus a seed glyph. Error: `ERR code: reason` then `try: <action>` as a real button, FAULT lamp beside it (C04-47 scene as backdrop, C01-09 for the 404). The command palette is styled as a prompt with the same tags. Toast: `NotchedToast` with a `>` prefix. **Mobile:** wells go full width, 12 px type, lines wrap with a 2-character hanging indent.

**Components.** `TermWell`, `TermLine` (`lines`, `tag`, `typed`; typed, instant), `BootSequence`, `ScanFrame` (`label`, `state`; scanning, waiting).

#### 20.4.4 How clay gains life without noise

| Move | Recipe | Cost |
|---|---|---|
| Lit edge | 1 px inset highlight on top, 1 px dark on the bottom (`--lit-hi`, `--lit-lo`) on raised parts | static |
| Inked engraving | 1 px sigil strokes and mono labels set into recessed wells (`--elev-recessed`) with a 1 px light lip below | static |
| Tooth | a 64 px tile at 2.5 percent opacity on ground and raised only; `--decor-opacity: 0` in high contrast and forced colours | static image |
| Pulse accent | one `#F25623` fill per view, on the primary action or the current item | static |
| Aimed light | the hovered `LitPanel` only: a pre-painted sheen layer; the pointer angle is snapped to 8 directions; cross-fade 160 ms; one panel at a time | opacity only |
| Focus depth | the focused region settles 1 px and its siblings dim 4 percent via a pre-painted layer; the ring stays a 2 px outline | opacity only |

`LitPanel` (`angle`; rest, lit; extends `Panel`). "Neither alive nor dead" is tested by rule (D-V2-6), not by taste.

**Tokens added** (hex only in `primitive-color.css`): `--lit-hi`, `--lit-lo`, `--tooth-opacity`, `--term-ground`, `--term-ink`, `--sigil-w-1/2/3` (1, 1.5, 2 px), `--bracket-arm` (8 px), `--ascii-cell-w/h` (7.2 x 16 data; 6 x 12 atmosphere), `--cursor-reticle/bracket/plan/wait/hold`. **Section allow-list additions:** `--sec-ramp`, `--sec-sigil-fold`. **Forced colours:** every sigil and bracket becomes `CanvasText` strokes, tooth and aimed light off, cursors system. `prefers-contrast`: tooth off, strokes 2 px.

#### 20.4.5 Cursor and hover language

| Cursor | Over | Form (SVG, at most 32 x 32, keyword fallback last) |
|---|---|---|
| `reticle` | art plates, charts, trees | 1.5 px ring 20 px, centre dot, hotspot at centre |
| `bracket` | buttons, keys, rows | four corner brackets 24 px |
| `plan` | PLANNED plates | dashed ring (matches the lamp) |
| `wait` | WAITING controls | half disc (matches the lamp) |
| `hold` | hold-to-confirm | ring with 4 tick marks |
| system | text fields, links in prose | unchanged |

Hover: four corner brackets fade in over 100 ms and move 2 px outward; keyboard focus draws the same brackets plus the 2 px ring, so hover never replaces focus. Charts: the crosshair is two SVG lines snapped to the nearest data point with a `Callout` showing value, unit and lamp. The optional pointer companion (one 12 px ring with a spring, transform only, stops at rest) is off in calm, at governor `low`, on touch and in forced colours. Static form: system cursors, no companion; targets stay 44 px. `CursorKit` exports the cursor set and `useBracketHover`.

#### 20.4.6 The ten centrepieces, revised (private track, full strength)

| Section | Centrepiece | Treatment | Sigil, ASCII, terminal role | Honest driver |
|---|---|---|---|---|
| `core` | C02-02 hill (live) under a C03-06 nested-triangle ring | ring 1.5 px with 8 ticks; C03-01 warped grid as a 10 percent backdrop | sigil frame; a terminal line shows "level 62 %" | real analyser level, else a still ring |
| `room` | C01-23 faceplate with C01-20 seams; `room.rules` drawn as a C04-127 logic-gate schematic | rules are gates, each showing its last real firing | scale (dial ticks); a terminal tag per rule | board report only |
| `senses` | C04-06 spindle; `senses.teach` uses C03-04 armillary rings | stamped SIMULATED in amber inside the frame | sigil rings; frozen Bayer C04-41 on WAITING | measured motion energy; no human form, no eye imagery (C04-26, C04-132, C03-12 stay out) |
| `memory` | C04-119 branch (idle and empty state); `memory.beliefs` uses the C04-113 web layout (cells filled with caret-ramp fields, one cell in accent) | fixed pictures bound to no count | ASCII atmosphere; a seed glyph per person | none |
| `console` | C04-10 frame, C04-16 columns, C04-18 brackets | full terminal grammar | terminal | real events |
| `day` | C04-37 painted sun, ochre-charcoal duotone, with an ASCII ray twin; `day.month` uses C02-38 grid and `AsciiHeat` | rays equal blocks logged today; day cells carry 16 px seed glyphs | seed glyph per day; ASCII heat | today's real logs |
| `focus` | C03-08 dots, with C03-11 eclipse tunnel as the session backdrop (10 percent) and C04-11 for rest | one dot per elapsed minute | a seal when a block ends | elapsed minutes |
| `study` | C04-23 island; `study.plan` C03-05 astrolabe; the question-pattern view over a C03-06 sigil-math backdrop | one layer per unit; question-type bars as `AsciiBar` | ASCII data; a terminal "reading paper" line | real logs and parsed papers (state shown) |
| `tree` | C04-44 trunk growing into a C03-21 nebula canopy; nodes are C04-40 cells; four C04-08 emblems seal the four branch families | a seal draws when evidence exists | seed glyph per node, seal | evidenced-node count |
| `career` | C04-116 skyline in three parallax bands; `career.ladder` uses C04-122 spire; `career.abroad` C03-15 cone diagram; roster plate C02-29 | a stage lights only when its item is done | sigil dividers; ASCII money bars | real items |
| `proof` | C02-24 relief ring, C02-40 variant | a caption on every ring | scale | computed statistics |

Static pictures use `duotone` and `bayer`; any picture that implies a person's likeness is cropped to the object (hand, sun, tower) or dropped. Each centrepiece is at least 25 percent of its view box (§8.1).

#### 20.4.7 Secondary placements

Route transitions: the 200 ms fade (§10.4) plus the destination's sigil drawing into the title bar in 200 ms (one SVG, under 60 segments); a product switch adds a one-shot C04-49 sunburst reveal in 200 ms (an opacity of a baked image). One empty state per view: a seed glyph (48 px), a terminal well, and a `grain` strip (C04-30, 600 x 40) at the base; variants C03-17 clouds (memory), C03-19 bands (search), C04-109 hands (day close), C01-24 agate (hardware). Onboarding: one screen, C04-124 scene with a row-by-row reveal in 600 ms (skippable), boot rows, one primary. Section dividers: C01-18 glyph rows, 12 px high. Fault and 404: FAULT scene C04-47, 404 C01-09; the comic blue-screen C04-128 is held in reserve. Tooltips are terminal tags.

#### 20.4.8 Reserve (ideas not built)

Pointer-aimed spotlight on immersive scenes; chrome-liquid tilt on seals (C04-08); ASCII rain in Console while a command runs; glitch-sort route transition (C03-20) on a product switch only; comic blue-screen FAULT plate (C04-128); a day-seal wall (365 seed glyphs); a voice-reactive sigil ring around the hill; paper mode (the whole interface as the C01-18 white sheet).


### 20.5 Data display: Specimen and Datum, and a body for every number

**Reading key.** Form is the signature in this product's language; Extends is the built component; Art is a catalogue id (private track only; ids are never reproduced as pictures in tracked files); Mobile is the one-column form under 900 px. All sizes are targets.

#### 20.5.1 The composition method

- **Canvas (1366x768, rail 64, title bar 48 leaves 1302 x 720).** The specimen box is at x = 24, width 760, height 560, centred on the datum line (y = 288). The margin column is at x = 808, width 470: up to five `Callout`s stacked, each 88 px high, each joined to a point on the specimen by a 1 px leader that bends once at 45 degrees. The footer strip is 72 px: a telemetry rail (three readouts) plus the single primary Key.
- **Datum line.** A hairline with ticks every 40 px. The specimen's baseline, the margin Callouts' first rows and the footer rail all snap to it, so the eye reads one horizontal. It is the one repeated structure; everything else is irregular.
- **Hierarchy by weight, not size.** The specimen is recessed or contoured; Callouts are flat plates; readouts are raised. At most three depths per view.
- **Mobile.** The specimen first at 100 percent width, 320 px high; Callouts become a swipe carousel of 3 cards with a dot index; the datum becomes a sticky 1 px rule under the title.
- **Rule of one surprise.** Each view gets one unexpected form (a ridge, a sigil, an ASCII sweep) and the rest stays calm. This is the "neither alive nor dead" control.
- **Art.** Specimen ground for Study is C04-23 re-derived as a contour of real unit mastery; for Senses C04-118 (dot-matrix landscape); for Memory C03-19 (glitch pillars). Treatment: duotone charcoal and cyan, then Bayer 4x4 at 1x on the specimen ground only, 6 percent opacity, so it never fights the data.
- **Weight.** SVG and CSS; at most one bounded canvas (the Ridge, only when a series exceeds 24 rows); zero idle loops; every motion has a static form. Idle CPU and rAF checks from the voice suite are extended to each new component.

#### 20.5.2 Components of the family

| Component | Draws and behaves | Props | States | Extends |
|---|---|---|---|---|
| `Odometer` | Digit cells, each a 40 x 56 recessed well with a Doto digit. A change rolls the digit by `translateY` over 140 ms in three intermediate steps (no blur easing). A hairline underline carries the unit in 12 px mono; beside it an ASCII delta `+3 since 09:00`. Hero counter 4 digits at 72 px high on the datum line; compact 28 px in rails. LIVE and SIMULATED draw digits; WAITING draws "-- --"; the lamp sits top right at 12 px. Focusable only if it opens a drawer (Enter shows the series). Roll only on change and only when visible; static and reduced-motion: no roll. Hollow form: four dashed wells and a WAITING half disc. Art: C01-05 and C02-34 (pixel numerals) as the digit shape; C04-123 (numerals lotus) Atkinson-dithered into a 200 x 200 corner behind the Life counters | `value`, `unit`, `state`, `size` | live, simulated, waiting | `Numerals`, `Readout` |
| `StrataCore` | A contour block (C04-23) where each layer is one unit and its height is evidence: questions answered correctly first try, the last 30 days weighted by recall estimate. Layers without evidence are flat dashed outlines. Click opens the unit drawer with the frequency bar and the next three questions | `units[]`, `evidence`, `state` | live, simulated, hollow | `Ridge`, `Dither` |
| `SigilMark` | A radial figure, 6 to 16 arms from a hub, one arm per topic; arm length is evidence; the tip is a disc if recently practised, a ring if not, a dashed ring if never; arms branch at 3 pieces of evidence. A skill-tree node face and a Callout thumbnail. Same input gives byte-identical SVG | `arms[]`, `size` | live, hollow, planned | `NodeRing`, `StippleRing` |
| `Trace` | A single 1.5 px hairline over a faint dot-grid ground (C04-118 derivative); the last point a disc, the previous 7 rings; a hatched band marks days with no data (never interpolated); an ASCII ruler `|····|····|` with mono date labels; a dashed datum for the student's own 30-day median. Hover or arrows scrub a vertical hairline with a Callout (value, date, lamp); Enter pins a second scrub for a two-point difference. ASCII sparkline `▁▂▃▅▃▂▇` (12 characters) in cells and rails. The line draws once on first view over 320 ms; static: drawn. Mobile 100 percent wide, 180 px high. Art: C02-02 and C02-06 thresholded to 3 percent as ground; C04-115 for long-range backdrops | `points[]`, `median`, `state` | live, waiting, simulated | `Ridge`, `DotMatrixMeter` |
| `DotHistogram` | A column of dot stacks, each dot one observation (up to 200; beyond that one dot is 5 observations with the multiplier written); a median tick and the 25 to 75 band as a bracket; flips to a dot-density ridge. Use: block lengths, spend per day, difficulty by unit, signal amplitude over a day. Hover: Callout "6 blocks, 20 to 29 min"; Left and Right move across bins. Art: C02-11 for the dot recipe | `values[]`, `bins`, `unitPerDot` | live, waiting | `DotMatrixMeter` |
| `Dumbbell` | Two values on one rail: a ring (before), a disc (after), a 1 px bar, the difference as a mono number; a column of rails on a shared ruler sorted by gap. Always against the student's own earlier self, never league tables. Mobile 44 px rails. Art: C02-13 wave ribbon as 4 percent texture | `before`, `after`, `scale` | live, hollow | `ProgressBar` |
| `LedgerTape` | A 320 px receipt strip: `chai ········· 120` with dotted leaders as text, a running total in Odometer numerals, a torn zigzag SVG end. Today's tape is the Capture Line's output. Art: C04-35 as the tape ruler | `entries[]`, `total` | live, empty | `Readout`, `Numerals` |
| `Jar` | A row of recessed wells, one per user-set category; fill level is the share of the student's own monthly budget; a disc marks the planned notch. Over budget fills past the notch with a hatch plus a text line `120 over`; no red, no scolding. Art: C02-40 relief as the plate | `level`, `plan`, `label` | under, over (hatched), empty | `ProgressBar` |
| `SkyLedger` | 60 star positions in 6 rows of 10 (or 90 in 9 rows). A kept day is a disc, a rest day a half moon, an untouched day a faint dot that stays in place. Headline `41 of the last 60 days kept`, a ratio that changes slowly. Hairlines join kept days that share a habit into a constellation (pure function of the data). Hover: Callout; Enter opens the Almanac day drawer. No chain, no "broken" language, deleting a day lowers the count honestly; a 200 ms disc fade when a day is added. Art: C04-17 as colour mood only; C03-03 for the constellation line style | `days[]`, `window` | live, hollow | `StippleRing`, `WeekStrip` |
| `RackRow` | A 44 px rack unit: a chamfer plate with the serial (C02-25 style), device name, a `Rocker`, a "confirmed" lamp (cyan disc only after the board reports), last-seen mono time, a tiny ASCII pulse `▁▂▁` only if a report came in the last minute. States: UNCONFIRMED (half disc, "sent, not acknowledged"), CONFIRMED, FAULT (triangle with the reason), PLANNED (dashed plate). Six relays are six units on a 1302 x 300 rack with a dot-matrix header tile (C02-33). Used in `console.hardware`. Art: C01-19, C02-32, C04-134 as 5 percent dither behind it | `device`, `state`, `onToggle` | unconfirmed, confirmed, fault, planned | `Rocker`, `Plate`, `Lamp` |
| `LedgerTable` | 32 px rows with a 44 px row-button hit area; sticky header, sort glyph in text; 1 px rules (no zebra); column types text, number (right aligned, tabular), lamp, ASCII spark, dot meter; inline edit on `F2`; a column chooser in a Key; row expand opens a drawer. Dense mode 28 px for the console only. Mobile: key-value cards showing 3 fields. Art: C04-47 as the frame | `columns[]`, `rows[]`, `density` | loading, empty, selected | `Row`, `TelemetryRail` |
| `DetentRack` | A select as a rack: a 44 px trigger Key showing the value and an ASCII ▼; opens a 320 px recessed rack of 44 px rows, the current row carrying a disc, a left gutter of `├─ └─` for groups, typeahead, a mono shortcut column; unfolds with a 120 ms height ease (static: appears). Up, Down, Home, End, typing, Enter, Esc; `aria-activedescendant`. Mobile: a bottom sheet. Art: C04-28 for the folder look | `options[]`, `value`, `grouped` | open, closed, disabled | `Popover`, `Segmented` |
| `SlotList` | Rows seat into slots: enter by 8 px `translateY` and opacity over 140 ms with a 40 ms stagger capped at 8 rows; exit by collapsing the slot. Reorder: Alt+Up and Alt+Down; pointer drag lifts the row (raised shadow, 2 px translate) and leaves a dashed `BlankingPlate`. Static: no motion, same states | `items[]`, `onReorder` | idle, lifting, empty | `Row`, `BlankingPlate` |
| `CaptureLine` | A bottom-docked 44 px recessed line with a prompt glyph `>` and one text field. Local deterministic parse: `spent 120 chai`, `water 250`, `gym legs 45`, `remind me next tue 7 pm physics`. Parsed pieces appear as chips beneath (amount, label, date), each editable; Enter commits; an Undo toast for 6 s; Ctrl+Space focuses it from anywhere in Well Wisher. Ambiguity shows `? what is 120` and waits; no guess. The JARVIS grammar `remember>` and the closed-verb `CommandLine` use the same component (20.3). Art: C04-10 and C04-16 for the frame and a solid, non-blinking cursor block | `grammar`, `onCommit` | idle, parsing, ambiguous | `Console`, `NotchedToast` |
| `SpecimenLayout` | Specimen, datum, margin and footer geometry of 20.5.1 | `specimen`, `callouts[]`, `footer` | desktop, reflow | `Frame`, `Callout` |

All carry `data-component` and `data-state`, take a required `state` lamp prop wherever they show a number, and have a Hollow form and a static reduced-motion form. **Hollow forms** replace grey skeleton boxes: Odometer is dashed wells; Trace a straight dashed datum with an ASCII ruler; StrataCore flat dashed layers; SkyLedger 60 faint dots; Almanac empty cells with a dashed today notch. Loading uses `CellSkeleton` quadtree blocks sized to the final layout (C04-15), replaced in place. A one-sentence message and one action sit under each; the empty hero is an ASCII empty state of 14 lines (C04-105 dragon, C04-119 branch, C04-56 figure).

#### 20.5.3 Progress track and attendance

**Progress track.** A horizontal ASCII track `[====>     ]` with a small ASCII vehicle at the head (C04-57 car, C04-106 chopper as skins that are all available from the start and chosen in a Trim; nothing is unlocked by progress, which would be a reward mechanic); static form shows the glyph at the right position; it moves only on a data change.

**Timetable (rack).** The week form of the Almanac (20.6) filtered to classes. Each class plate: subject code in mono caps, room and time, a 6-dot attendance micro-row. Free slots show a dashed blanking plate "free 1 h 10 m" that can take a suggestion (a Capture Line prefilled). Art: C04-03 as the row rhythm, C04-35 as the meter ruler.

**Attendance (Bunk Ledger).** One row per subject in a `LedgerTable`, 40 px: name, a `DotMatrixMeter` of 20 dots (attended share), a vertical tick at the student's required line (user-set), and `margin +3` in mono. Margin is local arithmetic, `floor((attended - r x held) / r)`, with the formula shown on focus. The wording is "margin", never "bunk" or warning red; below the line the tick turns to a half disc and the text reads `needs 2 classes to reach 75%`. Source lamp: LIVE only if the student entered it that day, otherwise WAITING "last entered 9 days ago". The required percentage per subject is the student's input (Q-V2-4); the formula is untested against real data.

#### 20.5.4 Logic, storage, honesty

Rule-based: margin arithmetic, DayMark shape mapping, the Capture Line tokenizer (amount, unit, date phrase, label), the SkyLedger ratio, jar levels, histogram binning. Local model optional: the retention estimate and a question-pattern classifier use a model only to classify; the counts come from stored classifications; the model never writes a number the student sees without a lamp. Storage: days, marks and intentions are an append-only local table keyed by date and action id; all derived art is a pure function of the table, so edits and deletes move the picture honestly. Spending and habit limits are user-set and local. Never: medical or psychological claims on water, medicines or habits (plain reminders and counts), exam outcome predictions, comparisons against other people.

### 20.6 Life and Day: the Almanac, planners, body, ledger, Trim

**What changes.** (1) The Life calendar is the named view `day.month`, not a new section: the ten-section map and ids stay frozen; Day gets five views (`today`, `week`, `month`, `body`, `close`), inside the §4.1.4 ceiling of five. (2) Every day cell is a small instrument, not a number. (3) Planned and done never share a mark. (4) Recurring intentions are one object, `Intent`. (5) Habits to reduce use Trim counters with rolling lines, never streaks. (6) Spending is a log with a monthly ledger strip. (7) The settings sheet is dissolved. (8) Body and routine become one strip on `day.body`.

#### 20.6.1 `day.month`: the month form of the Almanac (box W: 1230 x 612)

**Purpose.** Answer "what did I do, and what is coming" for any day at a glance, with one object for week, month and year.

**Data and states.** Cells read from the existing life store (`useLife`, `derive.ts`: classes tapped, counters, gym log, attendance), the focus log, the study log, the Intent store (new) and later Google events. Each source has a lamp: classes and counters LIVE (tapped by the student); Google PLANNED, then WAITING, then LIVE; a computed summary SIMULATED only if built from fictional rows on a bench. A cell never shows a number unless its source lamp is LIVE.

**Layout at 1366x768.**
- Head 1230 x 52: the month name in dot-matrix numerals (C02-45 treatment, 36 px, no animation), previous and next (44 px), a three-way key group Week, Month, Year (a `Rocker`, 44 px high) and a Today key. Right end: the Google lamp (20.6.3) and a **Marks** key opening a popover that toggles kinds and names every shape.
- Grid 900 x 548 at left: seven columns of 128 px (896 plus gutters 4), six rows, a 28 px weekday header. A cell is 128 x 86 px, 6 px radius: a raised clay tile for the current month, a pressed (inset) tile for adjacent months. Content: the date numeral top left (13 px mono), up to four kind marks along the base (14 px glyphs), a 3-row stipple strip of minutes done (one dot per 15 min, at most 12 dots, then a `+`). Each cell also carries a 16 px seed glyph of its day (deterministic from the day's action set) and one `AsciiHeat` glyph by action count; the number stays text.
- Side panel 314 x 548 ("Month reading"): a `RingBars` of marks by kind (counts, LIVE only), a **Planned vs done** line (two numbers, no ratio, no colour judgement), and the next three Intents due, each a 44 px row.
- Strip 1230 x 12 below the grid: an `AsciiSweep` rule line of the weekday rhythm (`. . | . . . .`), static.

**Kind marks (shape carries meaning; colour is a second cue; a legend in the Marks popover names every shape).**

| Kind | Done (filled) | Planned (hollow) | Source |
|---|---|---|---|
| Study block | disc | ring | focus log |
| Class attended | square | outline square | attendance taps |
| Body (gym, run, stretch) | up-triangle | outline triangle | gym log |
| Water goal met | drop (teardrop) | outline drop | water counter |
| Spend logged | bar (vertical dash) | outline bar | spending log |
| Rest day (first class) | horizontal dash on an inset tile | the same | rest day set by the student |
| Intent due | diamond | dashed diamond | Intent store |
| From Google | notch (small cut corner) | same, outline | calendar link |

A rest-day cell carries the word "Rest" (11 px) so a rest day never reads as empty.

**Interactions.** Hover raises the cell 1 px (shadow only, 120 ms) and shows a cursor-following tooltip 220 x 72 px of kind counts ("2 blocks, 1 class, 1 spend"). Right-click or long press opens the add menu ("Add intent", "Log something done", "Move planned here"). Keyboard: arrow keys move across cells (roving tabindex, one tab stop), Enter opens the drawer, `t` Today, `w` `m` `y` switch form (focus-scoped), PageUp and PageDown change month, `n` adds an Intent on the focused day; a 2 px focus ring sits outside the clay shadow.

**Day drawer** (560 x 652 from the right): the date in numerals and kind marks; three folds. **Happened:** rows with time, kind glyph, text, Undo and Delete per row. **Planned:** rows with a "Done" tap that turns the hollow glyph solid, a "Move" key, and a "Not now" key that makes the row a carried outline without any wording of failure. **Intents:** the rules that fall on this day, with an edit key; a "next time" strip holds the intentions set for this weekday, month or year. Bottom: Add (primary only when a draft exists; or use the Capture Line). Esc closes and focus returns to the cell. The drawer rows seat in with a 40 ms stagger capped at 8 rows.

**Motion and static form.** A month change slides the grid 8 px and fades 160 ms; marks do not animate. The drawer opens with one reveal (the glyph row draws left to right in 200 ms). Static: no slide, no reveal. No idle loops.

**Art placement (private track).** C02-38 is the clay reference for the tile proportion and the pill (Atkinson dither of the page edge to a 1-bit 24 px corner bracket on the head). C04-18 gives the head's corner brackets (terminal frame). C04-113 supplies the border line work for the Intent rows (cybersigil, ASCII triangle field, duotone, a 40 px strip at the drawer foot). C04-05 (stippled ring around a halftone moon) is the today ring: a stipple ring of 24 dots around today's numeral. C03-05 astrolabe as a thin contour on the year wheel; C04-21 orrery as the semester orbit in the drawer header; C01-26 for the week-header pills; C02-45 for dot-matrix clock numerals.

**Empty and waiting.** No records: cells show the dot-matrix placeholder (`CellSkeleton`) and the head says "Nothing logged this month yet. Tap a day to add one." Google WAITING: the grid draws without notches and the lamp says what it waits for.

**Year form (key `y`).** 53 week columns by 7 rows of 20 x 20 px cells (1060 x 140) plus a 12-month ring from `DateWheel` (300 x 300). Cells shade by minutes in four stipple densities (the quadtree heat idea of C04-15). Hover names the date; Enter jumps to that month. The year reading is totals only; nothing resets. The data lens's "year strata" ridge (each week a bar by logged minutes, months as rows when a series exceeds 24 rows) is the alternative drawing for the same form, chosen by the Marks popover.

**Week form (key `w`, view `day.week`).** Seven columns 170 x 540, each a vertical timeline 06:00 to 24:00 with class blocks, planned blocks (hollow) and done blocks (solid); the rest day is an inset column with the words "Rest day". This replaces the old `day.week` body; its attendance margins and counters move to a right drawer. Planning: drag a planned block between columns (pointer) or press `m` then arrows (arrow keys shift 15 min, Enter commits).

**Day form.** One vertical hairline, 40 px per hour, planned plates left, done plates right, a "now" notch; used on the phone as the Day page.

**Mobile (358 wide).** Month shows a 7 x 6 grid of 46 x 52 cells (44 px hit area) with only the strongest mark and a count dot; tapping opens a bottom sheet with the three folds. The year form is a horizontal strip of 12 mini-months. The phone Calendar tab is the same component at 390.

**Components.** `Almanac` (`mode` year, month, week, day; `days[]`, `onPick`, `exams[]`; live, waiting, planned link), `DayCell` (`date`, `marks[]`, `selected`, `today`; normal, selected, planned-only, empty; a cell renders identically at month and year zoom except size), `DayMark` (one glyph per kind, filled or hollow, with an accessible name), `StippleStrip` (a row of up to 12 dots), `DayDrawer` (three folds with Undo, Delete, Move, Done).

#### 20.6.2 Planners inside the same calendar

- **Next-day planner.** A **Plan tomorrow** key on `day.close` opens the day drawer for tomorrow with up to three "When <cue>, I will <step> for <n> min" rows (U1), pre-filled from timetable gaps and editable; saved rows appear as hollow marks.
- **Week planner.** In week form: move a planned block by drag or `m` then arrows. Free time is the day minus classes minus planned, shown as a shaded run with the real minutes.
- **Month planner.** Select a range with Shift+arrows and press `n` to add an Intent over it ("exam revision, 5 days"). Dates from the exam list appear as diamonds with the paper name on hover.
- **Honesty.** A plan is drawn as intention; the sum of planned minutes is shown only with the word "planned". The planner never reads mood or claims a result.
- **Intent.** One object with a rule (weekday, month day, yearly date, "every n days"), a reminder offset and a Quiet-switch gate. It renders as dashed marks in future cells and as a small ASCII rule line in the drawer (`every Mon . 07:30 . before class`). `IntentRule` and `IntentEditor` (extends `Field`, `Segmented`, `Spec`) build it. Recurrence expansion is a pure function from a rule and a date range to dates, unit-tested on month ends, leap day and a 29 Feb yearly rule (40 cases).

#### 20.6.3 Google Calendar link (states and consent)

Google recommends a loopback redirect with PKCE for desktop applications and no longer supports custom URI schemes or copy-and-paste codes (page opened: Google's OAuth for native apps). Calendar scopes are classed sensitive by third-party documentation; whether a personal client in testing mode avoids verification, and how long refresh tokens last, are not confirmed (Q-V2-2).

States of the control (`LinkLamp`: a lamp plus a Key). **PLANNED** (dashed ring): no client configured; the key reads "Link Google Calendar" and opens an honest explanation (what it needs, the one scope, that the student signs in himself, that nothing leaves the machine except calls to Google). **WAITING** (half disc): consent started in the system browser; the application listens on a loopback port for 5 minutes; a Cancel key stops it. **LIVE** (disc): the first read succeeded; "Linked, last read 14:02" and one switch per calendar (each off by default). **FAULT** (triangle): token revoked or network failed, one line saying which; the local calendar keeps working. The student acts only in his browser. Read-only (`calendar.events.readonly`) is the default; "Send my planned blocks to Google" is a second explicit switch, off by default, with a preview list before the first write. Disconnect is one key: it revokes the token, deletes cached events, and returns the lamp to PLANNED. Imported events carry the notch mark and the words "from Google" and are never merged into the student's own log or counts.

#### 20.6.4 Body and routine (`day.body`, box W: 1230 x 612)

Left 640 x 612: the rebuilt gym card (a session log: type, minutes, optional sets; a seven-day `WeekStrip`; "next session" from the weekday Intent; rest days first class; no calorie or body claims). Right 574 x 612 split into **Water** (574 x 180), **Medicine reminders** (574 x 200) and **Class reminders** (574 x 200), gaps 16.
- **Water:** a row of eight 44 px drops (a Key each); tap to fill; a goal set by the student; a daily reminder-time list. Count LIVE (tapped). Reduced motion: a number and filled glyphs. Art: C02-46 (control kit) for the drop keys; C02-20 water-pod gauge as a half-circle gauge derived as a 120 px SVG arc (static form: the same arc without the sweep). `WaterGauge`.
- **Medicine reminders:** name, time and weekday set, all typed by the student. A scheduled notice only; the application records "taken" taps as the student's own log and never says what to take, suggests doses or comments on a condition. Shown line: "Reminders you set. Not medical advice."
- **Class reminders:** derived from the timetable; one switch "remind me N minutes before a class" (default off); obeys the three-a-day budget unless the student raises it.
- Mobile: a single page of stacked 358 px cards; drops wrap two rows of four. Enter or Space toggles a drop; arrows move; hover on a reminder shows "Next: 09:30".

#### 20.6.5 Spending log and habits to reduce (Ledger drawer)

To respect the five-view ceiling, spending and habits live in a **Ledger drawer** (560 x 652) opened from `day.month` or `day.body`, and as read-only rows in the day drawer.
- **Spending log.** Add a row: amount (numeric), a category chip (the student's own list, up to 8), an optional note, the date defaulting to today; saved in two taps. Entries are the student's own and LIVE; there is no automatic bank read. Month strip 520 x 120: one dot column per day, one dot per entry, dot height by amount tertile (three bands named in the legend); the only number is the month total with the word "logged". Category shares as a `PillarsChart` (C02-09 treatment). An optional soft budget line; crossing it draws a hollow outline on the strip, no red, no blame. The Jars and the LedgerTape (20.5) are the other drawings of the same log.
- **Habits to reduce.** A **Trim counter** per habit (the student names it): tap to log an occurrence, optional "what led up to it" chip. The reading is a rolling seven-day line and a longer ribbon of dots (`HabitRibbon`: a quadtree mosaic where each day's cell subdivides as more events are logged, C04-15; deterministic, caption "cells = what you logged; fewer is fine"); both can fall as well as rise and are labelled "your own log". The Sky Ledger shows "days under the limit he set", the limit editable in place. **No streaks, no reset, no "days clean".** A heavy or unlogged day is a neutral inset cell. A forward action sits in the drawer: "Pick one small swap for the next cue" (an editable, declinable if-then row, U5). On return after missed days the application says one neutral line, "Pick up here.", and shows the last three logged days; no counter changes.
- **Limits.** The section says "A log you keep for yourself." It never claims to treat, diagnose, manage or predict any condition and never shows risk scores. A static **Help** list (a local helpline list the student can edit) is always one key away in the foot of the Ledger drawer, shown the same way for every student and every count: the product never infers anything about him from a count and never shows a line that appears only when a count is high (Q-V2-5).

#### 20.6.6 Settings dissolved: Trim, the index and the registry

**Method.** Every setting is placed where its variable is read. **Trim** is a recessed 44 x 44 key with a 24 px "slider" glyph at the corner of the control it adjusts. Press opens a popover (at most 320 x 360) with the control, its current value, its default, a "Reset" key and one line saying what reads it. Esc closes and focus returns to the key; reduced motion: no reveal. Settings that change hardware or the brain keep their confirm step. Labelled for assistive technology ("Adjust: attendance rule"); shown on hover or focus for sighted users. **Index.** The command palette mode `:` lists a flat index (id, label, section, current value, lamp); selecting one navigates to its view and opens its Trim. The index is generated from `settingsRegistry.ts`, so a setting cannot exist without a home; a test fails if a registry entry has no mounted Trim or a form field is not in the registry. Components: `Trim` (`settingId`, `label`, `children`, `readsBy`; registers itself), `SettingsIndex`.

| Setting today | New home (where used) | Trim contents |
|---|---|---|
| SU1 Rotation (five library days) | `study.plan` header | day-to-track table |
| SU2 Subjects and question bank | `study.papers` detail | subject list, bank sources |
| SU3 Goals | `career.ladder` | goal rows |
| SU4 Timetable | `day.today` Next class region; week form | weekly class grid |
| SU5 Attendance rule | `day.week` margins | threshold and scope |
| SU6 Deadlines | `day.month` (diamonds) and `career.pipeline` | dated list |
| SU7 Study time | `day.today` free-time strip | minutes per day |
| SU8 About you | `core.talk` header and `study.plan` | one-line fields |
| SU9 Certificate budget | `career.certs` | monthly and stretch amounts |
| SU10 How the plan works | `day.today` Now region; shell Quiet switch for quiet hours | each field beside its effect |
| SU11 Calibration wizard | `tree.tree` first run and header Trim | the three-step wizard |
| SU12 Career settings | `career.pipeline` | weights switch |
| SU13 Connections | `console.connections`; Google lamp also on `day.month` | link rows |
| SU14 Backup | `memory.keep` | export, daily snapshot count |
| SU15 Dates | `study.plan` date wheel | dates and "exam mode starts n days before" |
| SU16 Phone | `console.connections` pair row | pairing |
| SU17 Appearance (theme, motion, tab badges, glass, contrast, cursor kit) | the shell title bar, one Trim | all, with Glass and Contrast PLANNED |
| Which Well Wisher opens (flag) | hidden rollback key in `console.health` | one key |
| Question harvester | `study.library` | queue and sources |
| Brain model, restart | `console.health` | model radio group |
| Voice, speed, test | `core.talk` header | voice groups, speed slider, test |
| Pronunciation table | `core.talk` Trim, second tab | word and say |
| Modules (deep think, offline voice, free GPU) | `console.health` | timed switches and costs |
| Latency and hearing line | `core.sound` (read only) | readout |
| Imports and exports | `memory.keep` | per source |
| Tree active and zoom sensitivity | `tree.tree` header | two controls |
| Away mode, reminders | `room.rules` and `memory.recall` | rule and reminder lists |
| Heavy-load channel flag | the channel's own key in `room.switches` | one switch |

#### 20.6.7 Storage, rules, ethics checks

Local SQLite tables behind the existing application data folder (nothing in tracked files): `intents` (id, rule, reminder offset, kind, enabled), `spend` (amount, category, date, note), `habit_events` (habit id, timestamp, optional chip), `water` (date, count), `reminders` (kind, time, weekdays, label); `day_marks` are derived on read, not stored. Rule-based: recurrence, mark derivation, free-time arithmetic, the rolling seven-day line, spend tertiles, planner prefill from timetable gaps. A narrow local drafting model may later suggest a first small step for an Intent; it never schedules, grades or comments on habits, is off by default and labelled "drafted by the local model". Needs the owner's consent or account: the Google link (his sign-in in the browser; his own Google Cloud client in testing mode; write a separate switch), notifications (opt-in), the helpline list (he edits it). **Checks:** a test fails any cell that shows a number without a LIVE or SIMULATED lamp; a copy test greps for "streak", "failed", "missed", "clean", "relapse", "disorder", "treat" and "diagnos" in the calendar, habit and reminder strings; reminder counts obey the three-a-day budget unless the student raises it. Delivery: an in-app notice and an optional phone notice through the existing pairing; nothing external.

#### 20.6.8 Reserve (not built)

Lunar-phase year ring (decoration only); a sigil per habit grown by an L-system and allowed to shrink; a terminal day log (`` ` `` on the drawer, MUD-style text); a dot-matrix hour hand (24 x 4); orrery weeks (C04-21); sound ticks; a month poster export (1-bit dithered); a two-week lookahead ribbon of diamonds in the title bar; a weather map of the semester; a day spine as a physical tape counter; an Almanac overlay fading the previous month at 20 percent; a halftone portrait of the month; a voice Capture Line.

### 20.7 Study and Focus: the paper desk, the question engine, Drill in Focus

*Superseded in part by 21.3 (crop-first questions, slides and scans, the stored blueprint, marking, the Exam Room face, the harvester), 21.4 (gcr is Google Classroom) and 15.6 (the engine is built in its own lane first).*

**What changes.** Study becomes a "paper desk" built on a previous-year-question (PYQ) engine: papers go in as PDF or photos, questions come out into a review queue, nothing enters the bank until accepted. Patterns are counts, never forecasts. A Coverage Ledger sits on every Study view. Drill and Crucible both live in Focus (D-V2-11). Feedback is truthful and calm. Terminal and sigil work are structural: the extraction log is a real terminal frame, unit sigils are deterministic, empty states are ASCII.

**Shared grammar for every Study and Focus view.** Ground `#E8EAE9` / `#171717`, accent `#F25623` as fill only, a lamp on every number (LIVE disc, WAITING half disc, SIMULATED diamond, PLANNED dashed ring, FAULT triangle), 44 px targets, a 2 px focus ring, at most one bounded 2D canvas per view (none in Study; the Focus dot field is SVG). Every motion below has a stated static form.

#### 20.7.1 `study.papers`: the Paper Desk (box 1230 x 664 with the Now strip)

**Purpose.** See what the papers say, and feed more papers in. **Data and state.** Papers, questions, tags (local database, LIVE counts); pattern statistics (RULE, computed, LIVE when n is met, else WAITING "too few papers"); proficiency (existing EWMA, LIVE with n).

**Layout.** Top row 1230 x 56: the **Coverage Ledger**, five stage chips (papers on file, questions extracted, reviewed, tagged by hand, last run), each a `Readout` with its lamp (238 px plus gaps). Below, 1230 x 592 in three columns: **Paper Strata** 600 x 592 (left); paper list 300 x 592 (middle: 8 rows of 56 plus a 44 px pager = 492, under the 100 px Drop Slot); Detail 298 x 592 (right).
- **Paper Strata** (extends `DotMatrixMeter` and C02-11 halftone): rows are syllabus topics (up to 14 visible at 30 px pitch; the rest in a bounded inner scroller or a unit filter via `FolderTabs`), columns are years on file (up to 10, 36 px). A cell is a dot whose diameter encodes the topic's share of that paper's marks (0 is a faint tick; 4 to 26 px in 5 steps) and whose glyph encodes the question type (circle numerical, square derivation, triangle short answer, cross MCQ). A topic absent in a year is an empty ASCII `·`. Right margin: frequency "4/6" and a Wilson bar. Hover or focus opens a `Callout` with the question crop (page image 280 x 120) and "tagged by: RULE, margin 0.31"; click opens the Review Desk at that question.
- **Paper list.** Exam-date order with stage chips. Selecting a paper highlights its column in the Strata.
- **Detail.** Topic chips (tap to cycle state, as built), sheet links, Practice cell, "Next paper" line, then the **Next three** card (20.7.9). Weak units appear as Sigil Gauges (20.7.5).
- **Drop Slot** (`PaperDrop`): a neumorphic well 300 x 100 with a static ASCII rule row (the sweep runs only while a file is being read, 3 s cap, never at idle). Drag a PDF or images, or press `A` to choose. On drop the ExtractionTrace streams.

**Interactions.** Arrow keys move across Strata cells (roving tabindex, one tab stop), Enter opens the question, `f` filters to the focused topic, `p` starts practice on it. Hover enlarges the cell by 12 percent (transform) and draws a hairline row and column guide. **Motion.** On first paint dots settle in rows, 12 ms stagger, 180 ms each, at most 14 rows (transform and opacity only); static: all dots at once. **Art.** The Strata plate backdrop is C02-11 dot-matrix halftone, duotone, 8 percent opacity (private track). The Island moves to `study.plan` so this view stays dense. **Empty and waiting.** No papers: an `AsciiEmptyState` frame of an empty grid with column heads "year", the line "Drop the first paper here" and a ruler of "years known but not on file" the student added by hand. One paper: columns drawn, patterns dashed, "1 paper: counts only, no pattern yet". **Mobile.** One column: Ledger as a 2 x 2 grid, Strata 6 columns by 8 rows with a topic pager (swipe by 8), the paper list as 5 rows, Detail as a bottom sheet. The phone page shows next paper and Next three only; drop is desktop only (PLANNED `phone-papers`).

#### 20.7.2 Extraction Trace and Review Desk (overlay `pyq-review`, one deep, 1100 x 620)

**Purpose.** Turn a PDF into reviewed questions without a model writing anything silently. **Layout.** Left 460 x 620: the page image rendered from the PDF with segmentation boxes. Right 624: a `Console` terminal frame (C04-10 and C04-16 as frame and phosphor derivative, private track), top 150 px showing the live log; below it the question card form (stem text, marks, unit, topic, type, difficulty, each with its chip `RULE`, `MODEL` or `HAND`).
- **Log lines are real events only:** `read p1 text-layer ok`, `p3 no text-layer: OCR (local) 41 words/line 0.88`, `Q4 marks [10] found`, `Q4 topic: RULE 0.64, next 0.33`, `Q7 topic: model asked (margin 0.04)`. Nothing is printed that did not occur; the trace is the run's actual event list.
- **Actions.** Accept (Enter), Edit (E), Merge with previous (M, for a split question), Split (S), Reject (Backspace, undoable 10 s), Next uncertain (N jumps to the lowest-margin item). Primary: **Accept all certain and review the rest**, which accepts only items with a RULE margin at or above 0.5 and complete marks.
- **Motion.** Segmentation boxes draw in 160 ms; the log types by line, not by character; static: all present. **Waiting and fault.** OCR missing: FAULT triangle, "text layer only; photos need the OCR tool (needs your OK to install)". Local model busy: WAITING, rule tags only. **Mobile.** A full-screen sheet; page image above, form below, swipe between questions.

#### 20.7.3 `study.plan`: the Exam Calendar and Syllabus Landscape (box 1230 x 612)

**Layout.** Left 600 x 612: the **Syllabus Landscape** (extends the Island C04-23 as an isometric layered-contour SVG block): one plateau per unit; plateau height is proficiency from the student's marks (flat when n is below 5, drawn with a dashed rim and the label "not measured"); footprint is that unit's share of marks in papers on file; tiny trees (one per reviewed topic). Caption plate: "height = your marks, footprint = marks weight in papers on file; it follows your records, not the clock". Right 614: `DateWheel` 300 x 300 (C03-05 astrolabe; spokes are real papers) beside a 300 px **Hour Ruler** column (C01-04: 14 days, a tick per day, a bar per day of logged study minutes, plan blocks as outlines); below, today's plan list 614 x 276. **Interactions.** Hover a plateau: unit name, marks share, n; click filters the Strata and sets Practice scope; arrow keys step units around the block; the wheel's spokes are focusable and name the paper. A plateau changes height by a 300 ms transform when data changes (static: baked state). **Empty.** A flat slab with the ASCII line "No syllabus units yet. Add them in Subjects." **Mobile.** Landscape 358 x 240 above a unit list; the wheel 300 x 300 below; the ruler as 14 horizontal ticks.

#### 20.7.4 Retention Orrery (card in `study.practice` set-up and in the Proof ring)

**Data.** Spaced-review cards (FSRS): the due count is LIVE (a count). The retention estimate is a computed estimate from the student's own reviews with default parameters until about 1,000 reviews, chip `DEFAULT`; never drawn as a number or a probability of an exam outcome (whether it may carry the LIVE lamp needs a lamp-contract ruling; it is drawn as four bands with no digits). **Layout.** Card 560 x 440, an SVG orrery (C04-21 re-drawn): the centre is "today"; each topic is a planet on an orbit whose radius is its band (fresh, settled, fading, due). Due topics are hollow planets on the outer ring. Beside it a Readout "Due today: 9" (LIVE) and a `TickSlider` for desired retention (70 to 97 percent, start 90). Primary: **Review today**. Tab walks planets in due order; Enter starts that topic's cards; "Not today" (N) hides one card for the day and trains nothing. On open the planets glide to their orbit in 240 ms, once per open (static: in place). Empty: "No cards yet. Cards are made from questions you miss or mark 'keep'." with an ASCII ring. Mobile: a vertical list of four bands with counts.

#### 20.7.5 Weak units: Sigil Gauges

Per unit: proficiency and n (LIVE). Each unit gets a 96 x 96 sigil generated by the shared engine in `growth` mode (an L-system seeded by unit id, so a unit's sigil never changes). Mastery is the length of an outer arc (0 to 270 degrees); n below 5 draws the arc as dashes and prints "too few answers". Stroke count is not mastery, so decoration never rewards. A weak unit is the lowest arc among units with n of at least 5, named in words ("Unit 3 has the shortest arc, n = 8"), not red. Art: line style from C03-06 and C01-18 (private track), one unit sigil per card. Hover: a `Callout` with the last ten attempts as dots (filled correct, hollow not yet); click opens Drill on that unit. Mobile: 2 columns of 80 px sigils.

#### 20.7.6 `study.practice`: the set-up door (box 1230 x 612)

Left 520: Scope (paper, unit, or "Next three"), count, the **Blueprint bar**, timed or not. Right 694: the paper's bank status and "what this will record". The Blueprint bar (`BlueprintBar`, extends `ProgressBar`) shows the generated paper's section marks as stacked segments against the latest real paper's structure; a segment short of questions shows its gap in words. Primary: **Start drill** (opens `focus.drill`); secondary **Make a practice paper** (opens the generator). Empty: "No reviewed questions for this scope. Review the ones waiting (6)." linking to the desk.

#### 20.7.7 `focus.drill` (new view; box 1230 x 652, light ground)

**Purpose.** Answer questions one at a time with honest feedback and calm recovery. **Layout.** Left 760 x 652: the question Panel (stem; answer entry: a numeric field with a unit chip, or a written box with a rubric strip). Right 454 x 652: **Progress dots** (`DotTimer`, one dot per question, filled after Check, hollow when skipped), topic chips touched, a `TelemetryRail` with elapsed minutes (LIVE) and the Pause key, and the **Park shelf**.
- **Check.** Numericals: the independent checker returns "matches / does not match the key" and shows the working. Descriptive: the key's rubric points appear as 44 px chips the student ticks; the marks total is the student's own count, labelled "marked by you". A model may offer a reworded hint (chip `MODEL`, "Based on" this question and key), never a grade.
- **Calm recovery.** A miss shows "Not yet. Worked answer below", the key, and "Seen again on Thursday". At the end of a set: counts only ("11 attempted, 7 matched, 4 on the shelf"), a "Go again on the shelf" button, "Done" with no penalty. No red, no streak, no "mistakes" total. A bad block is followed by a 5-minute Rest offer, never a nag.
- **Interactions.** Enter checks; `j` and `k` step; `h` reveals hint 1, 2 or the worked answer (each reveal is logged, so the matched count stays honest); `x` parks a stray thought without leaving the question. Dots fill with a 160 ms opacity change; no sound, no shake, no confetti.
- **Art.** The margin of the question Panel: C03-14 sigil-math field at 6 percent, duotone, 1 px contour treatment (private track), clipped to the 120 px right gutter so equations stay legible. Empty: an ASCII frame "Nothing queued" and one button to the desk. Mobile: one column, 6 px progress dots; the phone gets Drill later (PLANNED).

#### 20.7.8 `focus.start` and `focus.session` (the Crucible; box 1230 x 652, charcoal immersive) and the paper generator

As specified in §4.4.5, with these additions. **Start.** Left 640: track `Segmented`, presets 25/50/90/Other, optional cue; a **Pick for me** strip shows the Next three card's top item with its three terms (`RULE`), dismissible. Right 574: C04-05 halftone moon ring 360 x 360. **Session.** The dot field 360 x 580 as built (one dot per elapsed minute, `DotTimer`); behind it a faint ring of 60 ticks (C03-04 armillary rings as a 1 px SVG outline at 5 percent opacity, private track), static. Readout 854 x 120 in mono ("32 min · track"). Under the controls, a one-line **terminal strip** (24 px, Geist Mono 12): `> block 32 min | parked 1 | silent end on`, updated on a real event only. **Park field** (`ParkField`): `P` opens a 44 px single-line field inside the controls region; Enter files the thought to Parking and returns focus to the timer (an outlet for an unsolicited thought; the application says nothing about attention conditions). **Calm recovery.** Pause holds the dots; an early end keeps the filled dots and defaults to "show only logged minutes"; after a long block "Take a break" is offered once as a plain button; re-entry after the application closed shows "last seen 14:20" and no running timer. **Focus rest.** C04-38 hill 574 x 360 (static), as built.

**Paper generator** (overlay `pyq-gen`, 720 x 560, from `study.practice`). Steps, one deep: 1 pick a paper pattern (copy a real paper's structure); 2 review the proposed question list (drag to swap, 44 px rows, 8 visible); 3 preview the PDF (in the Reader), Save. Primary: **Make the PDF**. Questions from the reviewed bank carry `HAND` or `RULE`; any generated variant carries `MODEL` and a dashed outline until accepted. A section short of reviewed questions shows a hollow slot "needs 2 more". The PDF header reads "Practice paper from your bank. Not an official paper." Mobile: a three-screen wizard.

**Planned: "Connect through gcr".** A `PlannedPlate` (lamp PLANNED) in `console.connections` and as a dashed plate in the Drop Slot: title "Connect through gcr", text "Not built. It would pull course files you can already open. The app never stores your password." It opens the honest explanation, never a form. Registry id `ww.gcr`, home `study.papers`, action "build" held until Q-V2-1 is answered. Beside it the working route: **Watch a folder** (WAITING until the student chooses a folder; the chosen path stays in `data/`). *Superseded in part by 21.4: gcr is Google Classroom, and the plate opens the Connect Ladder once the connector merges.*

#### 20.7.9 Logic and data of the engine

**Storage.** A local database under the Well Wisher data folder (git-ignored). Tables: `papers` (file hash, year, subject, source note), `pages` (image path, text-layer flag), `questions` (stem, marks, type, unit, topic, difficulty, tag source, margin, status pending, accepted or rejected), `families` (merged repeats), `attempts` (question, time, result, hints used, marked-by), `cards` (FSRS state). Original PDFs and page images stay in `data/`; none is committed. Past papers belong to the institution: the application keeps them on the student's machine for his own study and does not publish them.

**Ingest (rules, no model needed).**
1. If the PDF has a text layer, read it with a text extractor; else render each page to an image and run local OCR (needs the owner's OK to install). Record per page the method and an OCR confidence.
2. Segment: a question starts at a line matching `^(Q?\d+[.)]|\(\d+\)|\d+\s*\()` at the left margin; sub-parts `(a)`, `(i)` attach to the parent. Marks come from `[\d+]`, `(\d+ marks?)` or a right-aligned number; a question without marks is "marks missing" and stays in review.
3. Type by pattern: digits, units and "find, calculate, determine" is numerical; "derive, prove, show that" is derivation; "define, state, list" is short answer; four options is MCQ.
4. Unit and topic by scoring each topic's keyword list (from the syllabus in Subjects) with a cosine over term frequencies, `score_t = cos(q, kw_t)`. The tag is `RULE` if the best score is at least 0.25 and the margin to the second is at least 0.15; otherwise the question is "uncertain" and the local drafting model proposes a tag (`MODEL`) from the stem and topic list only, as a choice among existing topics (never free text). The student sets `HAND` in review. A model cannot add a topic.
5. Difficulty is a draft from marks and length (marks tertile within the paper, chip `RULE`), then replaced by the student's attempt data after n of at least 5 (label "from your attempts").
6. Families: normalise text (lowercase, strip numbers and units), 5-word shingles, Jaccard of at least 0.8 merges two questions into one family; the student confirms the first merge of each family. A numerical with the same structure but changed numbers merges at structure level (digit runs replaced by `#` before shingling).

**Patterns (pure counting; `ww_check` runs each function twice for purity).** For topic t over the N papers on file for the subject: frequency `k_t` (papers in which t appears), shown "k of N" with the Wilson interval `(p + z²/2N ± z·sqrt(p(1−p)/N + z²/4N²)) / (1 + z²/N)`, z = 1.96, p = k/N; recency (years since the last appearance, a plain number); marks weight `m_t` (mean of marks on t over paper total, over the papers where it appears, with min and max); co-occurrence (pair counted in the same paper; lift shown only when N is at least 4 and the pair occurs in at least 3 papers, as "a and b were set together in 3 of 5 papers"); repeats (questions in a family; years apart). Every figure prints its N and source papers; below N = 3 it is replaced by "too few papers to show a pattern". A pattern is drawn dashed until coverage passes the floor (3 papers, 20 reviewed questions).

**What to practise next (Next three).** Over eligible topics with at least 3 reviewed questions: `gain_t = (m_t × k_t/N) × (1 − proficiency_t)`, where proficiency is the existing EWMA, or 0.5 and "not measured" when n is below 5. Ranked by gain per estimated minute (`marks_per_question / avg_minutes`, defaults printed), filled greedily into the free gap from the timetable, at most 2 consecutive picks from one unit. FSRS due cards show as a separate chip and are not multiplied in. The card prints the terms and carries "Not this" and "Choose another". The weights are an assumption, reviewed with the owner on five real cases before shipping.

**Honest language.** Confidence is displayed only as counts and intervals. The card says "this topic carried a larger share of marks in 4 of 6 papers on file"; it never says "important", "likely", "expected" or "will be asked". The footer of every pattern view: "From papers on file. This prepares practice; it does not predict a paper or a result." The Wilson formula, FSRS parameters and segmentation expressions are standard methods written from memory and must be tested (Y04, Y02); all thresholds (0.25, 0.15, 0.5, the 3-paper and 20-question floors) are assumptions to tune on the owner's real papers.

**What a local model drafts** (a 4B class model, already installed; each output labelled `MODEL`, never auto-saved): tag suggestions for uncertain questions; clean-up of OCR text (a "proposed fix" diff for acceptance); a reworded hint; draft variants of a descriptive question. **Never:** grade, give a numeric answer, state a probability, add a topic. Numerical variants come from the existing templates with the independent checker. A rules-only switch turns every `MODEL` use off and the page still works. **Consent and accounts.** Needs the owner's OK: an OCR engine, a PDF text library, a rendered-page library (sizes stated before install; Q-V2-3). Needs his consent and account: Google Classroom if that is what gcr means (read-only, OAuth in the application, the assistant never types credentials; scopes not checked).

**Components (Study and Focus).** `PaperStrata` (`cells`, `years`, `topics`, `onOpen`, `coverage`; idle, hover, focused, dashed-low-coverage, empty, reduced-motion), `CoverageLedger` (`counts`, `known`; LIVE, WAITING, empty), `ReviewDesk` (`paper`, `questions`, `onDecide`; loading, certain, uncertain, fault-ocr, done), `ExtractionTrace` (`events`; streaming, finished, fault), `PaperDrop` (`onFiles`, `accept`; idle, hover, reading, refused-type), `SyllabusLandscape` (`units`, `onSelect`; measured, not-measured, empty), `RetentionOrbit` (`topics`, `dueIds`, `retention`; default-params chip, fitted, empty), `SigilGauge` (`unitId`, `proficiency`, `n`; measured, too-few-answers, selected), `BlueprintBar` (`sections`, `target`; complete, gap), `ParkField` (`onFile`; closed, open, saved). None adds a canvas.

**Reserve (not built).** Paper X-ray (last year's marks overlaid on the current page image); a syllabus radar (C02-09) as a toggle; a quadtree coverage map (C04-15); audio drill (voice reads a question, spoken answer, `MODEL` chipped); a "mistake atlas" (each miss a stippled spot that fades as recalled); an ASCII boss-paper countdown fuse; a Socratic tutor mode (text only); a cross-subject pattern view; a printable A4 week sheet.

### 20.8 Tree and Career: the Grove, evidence, and the Career runway

**What changes.** Tree becomes a three-scale place (Grove, Tree, Node drawer); ten trees and 113 branches, each node unlocked by evidence, never by a tick; edges are circuit traces; growth is a pure function of the ledger. Career is rebuilt around a runway with five views, each with one signature display; dates carry a "checked on" stamp; links to Life and Study are real one-key arrows.

#### 20.8.1 `tree.tree`: Grove (scale 1)

**Purpose.** Choose which tree to grow next; see all ten without a dashboard of numbers. **Data.** Per tree: evidenced nodes, total nodes, last evidence date, from the evidence ledger (LIVE, computed). An unauthored tree shows no number, only a dashed seed (PLANNED). **Layout** (workspace 1230 x 664): a ring of ten seeds, radius 250, centred at (615, 332). Each seed is a 96 px clay disc with the tree's sigil in 1 px line and a `RingBars` progress arc (3 px). The centre (diameter 260) holds one big `Numerals` readout, total EVIDENCED nodes, with a LIVE lamp, and C04-44 masked to a circle (radius 130) behind it at 35 percent. Behind the ring, C03-21 (neural nebula) as a Dither-treated backdrop at 12 percent. Right strip 340 px: the **Next up** plate, the one node the rules pick (soonest-needed for a Career gap, else oldest open), with a Study button. **Mobile:** a 2-column grid of 10 seeds, 44 px targets, the Next up plate on top. **Interactions.** Hover a seed: it presses 1 px, its sigil draws a trace to the centre (180 ms), a `Callout` names tree, counts, last evidence date. Focus: 2 px ring. Arrow keys move around the ring in order, Enter opens the tree, Home and End jump, a letter jumps. The reticle cursor applies over the stage (D-V2-24). **Motion.** On first entry the ten sigils draw in over 600 ms with a 40 ms stagger, once per session; static: all drawn. **Art.** Centre C04-44 duotone to the tree accent; backdrop C03-21 via Dither; C04-08 cropped for the ten seed sigils, redrawn as 1 px paths by the contour pass. **Empty.** No ledger yet: the centre shows C04-119 as `AsciiEmptyState` with "No evidence yet. Pick a seed." The four chrome-emblem seals (C04-08) mark the four branch families once their capstones hold evidence (Q-V2-8).

#### 20.8.2 One tree (scale 2)

**Layout.** Canvas 846 x 664 with the Inspector 368 x 664 becoming the drawer. The left edge carries the tree's picture as a 120 px spine so the graph is the interface and the picture is atmosphere. Top-left a `FolderTabs` row lists the branches (up to 15, 8 visible, scrollable); a tab filters, dims the others and zooms to that branch. Bottom bar: legend, zoom buttons, four pan buttons (no drag-only control), the branch count "6 of 14 evidenced".

**Node shapes** (within the 34 px hexagon family so hit targets stay 44 px with padding): tier 1 seed 28 px; tier 2 skill 34 px; tier 3 capstone 40 px with a notched top and a sigil ring. Shape carries tier; state is carried by fill and glyph, never colour alone:

| State | Drawing |
|---|---|
| LOCKED | dashed outline, padlock glyph |
| OPEN | solid outline, empty core |
| IN PROGRESS | half-filled core plus a minutes counter |
| CLAIMED | hollow double ring (a self-mark without evidence) |
| EVIDENCED | filled core with N pips, one per evidence record (at most 5 drawn, then "5+") |
| STALE | the core fills but a thin gap ring appears; it asks for a refresher, never shames |

**Edges** are circuit traces: 45-degree chamfered SVG paths; a met edge is 1.5 px solid with a static tick every 24 px; unmet 1 px dotted; the selected node's prerequisite path highlights ("met" and "need"). An edge lights only when both ends hold evidence; when a node becomes EVIDENCED the outgoing edge draws its branch glyph once (400 ms), then stays. **Hover:** a 220 px `Callout` (name, tier, evidence count, "needs"). **Keyboard:** the stage is one composite (roving tabindex); arrows move to the nearest node in that direction (geometric); Tab leaves the stage; Enter opens the drawer; `[` and `]` previous or next branch; `+` `-` zoom; `0` fit; `/` search; Shift+arrow pans 80 px (as built in `viewport.ts`: K_MAX 2.4, K_SEL 1.15); no new loop, idle costs 0 rAF callbacks. **Level of detail:** below k 0.55 only branch hubs and sigils draw; between 0.55 and 1.15 nodes without labels; above 1.15 labels and pips, keeping a 300-node tree under 400 drawn DOM nodes (an estimate). **Growth without fake progress:** no XP bar, no percentage spinner. The spine picture is revealed by a mask whose height equals evidenced over total, stepped per node (a pure function; caption says it falls if a record is deleted). Beside it a one-line ledger prints the last three records in terminal type: `2026-11-12 drill held-out 8/10 -> Number Systems`. **Empty:** the PLANNED dashed plate and "Not built yet. Branches listed, nodes not written."

#### 20.8.3 Node drawer (scale 3)

A drawer 400 x 664 from the right (`Drawer`), the canvas pan compensating so the node stays visible. Top to bottom: node name and tier; a one-sentence "what this is, in plain words"; **Evidence** list (kind, date, link, delete with a confirm); **Needs** (prerequisite nodes as chips that jump); **Do next** (one button: "10-minute drill", "Log a session", "Attach a project", "Add a certificate"); **Used by** (Career gap rows and Study units citing this node); a footnote on what evidence it accepts. Keys: `E` adds evidence, `S` starts the do-next action, Esc closes and focus returns to the node. Slide 300 ms (static: at once). Art: a 400 x 140 header band from the branch picture, Dither duotone; C04-111 thresholded, used once per capstone at EVIDENCED.

#### 20.8.4 The evidence ledger and unlock rule

One local table: `evidence(id, node_id, kind, at, source, detail, weight, deleted_at)`. Kinds: (1) held-out drill, on questions not used in practice, passing a per-node threshold (for example 7 of 10); (2) timed practice, a logged timed session with a result; (3) artefact, a file or link to something the student made; (4) logged sessions, instructor-led or class sessions with minutes (required for any body node); (5) external certificate or grade, a plate in Certificates; (6) witness, a named person confirms in the student's own typed note (shown "reported", not verified). **Unlock rule (rules, no model):** a node is EVIDENCED when the sum of evidence weights is at least the node's requirement and at least one record is of a "hard" kind (1, 4 or 5). A self-mark alone yields CLAIMED. STALE when the newest hard record is older than the node's refresh window (language 60 days, drills 90, body 30; proposals). Prerequisites unlock OPEN, not EVIDENCED. A deleted record recomputes everything. A local drafting model may only suggest branch names from a pasted syllabus, draft a cover letter from the student's evidence and parse a job description into node tags, each labelled "drafted"; no model scores a person.

#### 20.8.5 The ten trees (113 branches; every branch has at least 3 nodes)

1. **Academic core (13):** calculus, linear algebra, probability, statistics, discrete maths, mechanics, electromagnetism, chemistry basics, data structures, algorithms, writing, reading papers, exam technique.
2. **Engineering and making (12):** programming fundamentals, web, systems and OS, networks, databases, electronics, embedded, signal processing, machine learning basics, version control, testing, hardware debugging.
3. **Languages (10):** German A1 to B2 in four, English academic, English speaking, Hindi writing, listening, pronunciation, reading, vocabulary upkeep.
4. **Body and self-defence (12):** strength, mobility, endurance, posture, Krav Maga basics (stance, striking, escapes), ground safety, awareness and de-escalation, falls and breakfalls, recovery, sleep routine as a habit (not medical), nutrition basics, a trainer-led grade track. Nodes are earned by logged sessions with an instructor or a grade certificate, never by self-rating.
5. **Social skills (10):** listening, small talk, asking for help, giving feedback, conflict repair, meetings, networking, public speaking, interviews, boundaries.
6. **Influence and persuasion (9; understanding and ethical use):** cognitive biases, the principles of persuasion in research (reciprocity, commitment, social proof, scarcity, authority, liking), framing, spotting manipulation and dark patterns, honest negotiation, argument structure, storytelling, resisting pressure, consent and ethics. Nodes require recognition tasks and writing, never tactics aimed at an individual.
7. **Money (10):** budgeting, spend-log habit, saving, banking basics, taxes basics for students, scholarship search, loans explained, scams awareness, currency basics, a funding plan.
8. **Craft and creative (11):** sketching, typography, photography, audio, video editing, writing, music basics, 3D printing, soldering, notebook systems, presentation.
9. **Health basics (9; general knowledge only):** first-aid course, hydration, sleep routines, medication reminders (as a log only), work pacing and breaks, eye and posture breaks, safe lifting, kitchen hygiene, reading a nutrition label. Nothing diagnoses or treats; nodes say "learn and practise", never "manage a condition".
10. **Career skills (12):** CV, cover letter, portfolio, profile, interview, project showcase, referencing, internship search, email etiquette, time management, certificate planning, German paperwork basics.

The ten lists sum to 108; five capstone branches are reserved (one each for trees 1, 4, 5, 8 and 10), giving 113. The arithmetic is not machine-checked (T02 adds the test). Evidence kinds for the body and influence trees need the owner's approval (Q-V2-9); no safety or ethics review has been done.

**Imagery (private track; every picture has a static and a reduced-motion form, no picture carries data, each is `aria-hidden` and the data sits in text or a table).**

| Tree or place | Picture and use | Treatment |
|---|---|---|
| Grove centre | C04-44 | circle mask, duotone, 35 percent |
| Grove backdrop | C03-21 | Bayer dither, 12 percent |
| Seed sigils | C04-08 | contour redraw to 1 px |
| Academic core | C03-05 astrolabe spine; C04-21 orrery for Physics | contour, ink duotone |
| Engineering | C01-24 circuit board spine; C04-30 noise on recessed plates | Atkinson dither |
| Languages | C04-114 dictionary loop | threshold, paper tone |
| Body and self-defence | C04-129 spine; C04-35 for the movement branch; C04-104 badge for the grade capstone only | duotone, Bayer 8 |
| Social | C04-36 cartography network | contour, 1 px |
| Influence | C04-31 (tangled scribble to clear) as the metaphor of seeing a pattern | halftone crop |
| Money | C02-40 relief, C02-24 ring | emboss relief |
| Craft | C04-133 and C04-33 collages | posterise, multiply |
| Health | C04-46 flower valley; C04-123 numerals lotus for the habit branch | soft duotone |
| Career skills | C04-116 tower city; C04-38 cloud waterfall as start screen | painterly crop |
| Empty states | C04-119 branch, C04-53 spike trunk as divider, C04-57 car for the runway | ASCII via `tools/art` |
| Abroad | C04-27 map, C03-18 bridge, C01-04 poster for labels | wire redraw |
| Capstone moment | C04-111 once per capstone | threshold |

#### 20.8.6 Career: five views on one runway

**`career.pipeline` (Runway).** Every internship, job and application as dated rows ahead, soonest first. A top band 1230 x 220: a "flight board" `FlightBoard` timeline, a horizontal axis of the next 120 days with ticks every 7 days (a `WeekStrip` extension); each application is a notch at its closing date, height by stage. Beneath, a 5-column stepper table as built (idea, preparing, applied, interview, offer; rows 56 px, 5 per page). Right plate 340 x 200 "Up next". Source: the applications store (LIVE); dates not confirmed by the student are WAITING with a dashed notch. Left and Right move along the axis, Enter opens a row, hovering a notch outlines its row, `N` adds an application. Mobile: the axis becomes a vertical list of 5 rows. Art: C04-116 as a plain-sight backdrop at 20 percent, one tower per stage, lit only for stages with a real item. Empty: `AsciiEmptyState` from C04-57 "Add an application".

**`career.ladder` (Ladder, and Path as its second state).** *Ladder:* the goals, parking, as built, plus a stepped ladder diagram: the 5-year goals as rungs, each tied to a Tree capstone and a Runway row; header C04-32. *Path (evidence-grounded advice):* which roles the evidence already supports and what is missing, a `RoleConstellation`: roles are stars (8 to 12 roles from the student's chosen fields), skills are Tree nodes, lines join a role to the nodes it needs. A star's brightness is the share of needed nodes that are EVIDENCED, shown with a number and a LIVE lamp. Missing nodes are dashed lines ending in an open hexagon: the gap. Layout 846 x 664 constellation plus a 368 "Gap list" ranked by the number of roles each missing node unlocks. Selecting a star outlines its needed nodes on a mini Tree map; Enter on a gap row opens the Tree node drawer; `P` plans the gap as a Life block; Tab through stars, arrows as a roving grid. Art: C04-32 (Atlas star map) faint backdrop, C03-02 blueprint lines. Honest note: "These are skill matches against role profiles you wrote or imported. It is not a prediction of being hired." Waiting: a prompt to import one job description (local text, parsed by keyword-to-node mapping with a visible table of matches the student edits). Role profiles are written or imported by the student as lists of node tags (Q-V2-10).

**`career.abroad`.** Compare universities and courses abroad. Three bands: left 600 px **Spec sheets** (`SpecTable`): columns are up to 6 universities (sticky first column), rows are course, language of instruction, tuition per semester, semester contribution, application window, entrance exam, proof of finances, "checked on". Each cell is a `Readout` with a lamp: LIVE only if the student confirmed it and the date is shown, otherwise WAITING "unconfirmed". Right top 614 x 300 **Route map**: a diagram, not a geographic map, nodes are cities as a teal wireframe island (C04-27) with shortlisted universities as flags; no street data, no live position. Right bottom 614 x 312 **Rack** (`RackChecklist`): requirements as hardware, a row of `Key` toggles each with a lamp: language certificate, school-leaving recognition, transcript translation, motivation letter, recommendation letters, blocked-account proof, health insurance proof, visa slot; per selected university. **Known fact, verified by opening the page on 13 Nov 2026:** Germany's study portal states proof of finances of 10,332 euros annually (https://www.study-in-germany.com/en/plan-your-studies/requirements/; the page gave no language levels or semester fee). The DAAD requirements page returned 404, so language levels, tuition and semester contribution are unverified; everything else goes in unconfirmed cells until the student confirms it from the university's own page. Fetching a university page is an explicit one-click button that stores the URL and a "checked on" date (Q-V2-11). Column-header click pins a university, `C` compares two side by side, row hover highlights across columns, grid roving, Enter edits a cell. Mobile: one university per card with a definition list. Links: a requirement row becomes a Study block (language drill) and a Life block with the deadline; the Languages tree supplies the certificate evidence. Art: C04-27 map, C01-04 label rhythm, C03-05 corner mark for the deadline calendar; C03-15 cone diagram per §20.4.6.

**`career.certs`.** A shelf of engraved plates (`PlateShelf`), 6 per row, each 180 x 110: name, issuer field, date, the Tree nodes it evidences. A certificate not yet held is a dashed plate (PLANNED) of the same size with a "Do next step" key. Detail pane 454 px: scan path (local file only), expiry, the nodes it counts toward. Attaching creates an evidence record on the Tree (kind: external certificate). Art: C04-122 for the empty-plate engraving, redrawn.

**`career.money`.** The plan for funding study abroad and shorter-term costs; rupees and euros kept in separate columns; the conversion is a typed rate the student sets, stamped with its date. A **funding bridge** (`FundingBridge`): a horizontal bridge diagram in which each span is a source (savings, a family contribution the student states, scholarships, part-time work, a loan the student states) and the total cost is the far bank; a gap, if any, is a visible gap with its amount. Layout 1230 x 664: bridge 1230 x 300, ledger 760 x 340, assumptions plate 454 x 340 (rate, date, source, each a typed input with its own "checked on"). Rules: no investment advice, no interest rates claimed as facts, no promise of a scholarship; a scholarship row is an item the student found and typed in, its deadline goes to the Runway. Art: C03-18 bridge as the line template (1 px, 40 percent), C02-40 relief on the ledger header.

**Cross-links.** Life: planned blocks and recurring practice appear in the month grid with a tree tag. Tree: the node drawer's "Used by". Study: Do next on a node starts a drill; a held-out Study pass writes an evidence record back. Each link is a one-key action and states its source.

**Components.** `GroveRing` (`trees[]`, `onOpen`; live, empty, planned), `SkillNode` (`tier`, `state`, `pips`, `label`; the six states, focus, selected, dim), `TraceEdge` (`d`, `lit`, `glyph`), `EvidenceLedger` (`rows`, `max`; a `TermWell` list), `BranchSpine` (`art`, `ratio`, `caption`), `RoleConstellation` (`roles`, `evidence`, `onPick`; live, waiting), `FlightBoard` (`items`, `today`; confirmed, unconfirmed), `SpecTable` (`cols`, `rows`; live, waiting, stale), `RackChecklist` (`items`; on, off, blocked), `FundingBridge` (`sources`, `cost`; covered, gap, unknown), `PlateShelf` (`plates`; held, planned). All SVG or CSS, no canvas, no WebGL.

**Honesty.** A node percentage appears only with LIVE; the constellation brightness is LIVE derived; any figure from a page not confirmed is WAITING. Nothing promises an exam, admission or job outcome.

**Reserve (not built).** A season ring of quiet quarters; a terminal command line inside Tree (`grow krav`, `gap abroad`); a printable "rubbing" of any branch; a role-to-role Sankey; the Grove as a skyline (C04-116); a shared evidence "passport" PDF; node sounds off by default; a leaf note on a mastered tree.

### 20.9 The JARVIS sections, redesigned (Core, Room, Senses, Memory, Console)

All boxes are in the JARVIS content box J (1286 x 652 at 1366x768). Reference pictures are named by catalogue id; "re-drawn" means a derivative from `tools/art` (ASCII, Bayer or Atkinson dither, contour, duotone, terminal frame, L-system). **What changes.** (1) Every JARVIS screen gets one sigil system and one terminal system as structure: a 96-tick bezel of generic glyphs carrying real state, and a three-letter bracket tag (`[HEA]`, `[ROM]`, `[SEN]`, `[MEM]`, `[SYS]`) prefixing every list row. Test: no list row in the five sections lacks a tag and a lamp. (2) Core shows its pipeline. (3) Room is a physical wall box with a safety guard and a 24-hour schedule ring. (4) Senses is a signal landscape. (5) Memory has three views of one store. (6) Console is a terminal world. (7) Reminders and hand-off are specified (20.9.6, 20.9.7).

#### 20.9.1 Core (`core.talk`, `core.sound`)

**Purpose.** Talk, watch it listen, read what it did. **Centrepiece.** The hill-and-ring voice stage with a sigil bezel.

**Layout (region grid of §4.3.1 unchanged).** Left column 720. Stage 720 x 360: the hill canvas (§9.5 geometry unchanged: 96 x 8 x 4 points, one path per alpha bucket). The ring bezel becomes the **SigilRing**: a 6 px clay ring (DOM, never redrawn) carrying a 96-tick band at radius 123 to 131 whose glyphs come from a 12-glyph generic alphabet; the ticks equal to the ring's live bars are lit, so the sigil is the spectrum in a second projection. The band is hollow (all ticks hairline) in every no-frame state. Under it C02-02 still at 12 percent (the frozen no-signal form), C02-07 bezel traced as a 1.5 px SVG. Strip 720 x 88: row 1 the **PipelineRibbon**, four 44 px nodes joined by 2 px lines (HEAR, WRITE, THINK, SAY); each node shows lamp, word and measured seconds ("THINK 3.2 s", text updated each second); the line into a node fills left to right as that stage runs, as a real elapsed-over-median fraction only if a median exists, else the segment is dashed. Row 2 keeps the level bar, legend and the one Pause. Controls row 720 x 72 unchanged. The 40 px hint row becomes the **OrganStrip**: five chips of 136 x 32 (BRAIN, VOICE, ROOM, SENSE, MEM), each a lamp plus one word (LIVE "ok", WAITING "not tested", FAULT "down"); Enter on a chip or Alt+I opens the Anatomy drawer. Right column 550: conversation header 44, **Transcript strata** 550 x 504, composer 72. Each turn is a terminal row: `[YOU]` or `[JRV]` tag, time, text, then its four flags; a 12 px glyph in the left margin is a deterministic sigil from the intent class (ask, command, memory, small talk). Turns older than the fitted four go to "Earlier" (a 560 x 652 drawer). A turn that created something in Well Wisher carries a `HandoffChip`. **Anatomy drawer** (560 x 652): five organs as a 5-spoke `RingBars` (spoke length = last measured latency against its own 7-day median, labelled), each with lamp and source tag: what is healthy, how fast, since when. No score, no "AI confidence".

**Data and state.** Level: the real analyser (T0 12.5 Hz scalar, T1 bands). Stage times: existing `timing` events. Organ lamps: the Console health report. The eight-state table of §9.6 is unchanged. With the core off every ribbon node is hollow and the strip says OFF; no node is solid without a fresh report.

**Interactions.** Hover on a hill column shows its band and value as a 2 px crosshair readout (only while data is live); the cursor over the ring shows `band k, 1.2 kHz`. Tab order: Wake, mode, Pause, ribbon (list, Left and Right), organ strip, turns. Keys: Ctrl+Shift+Space toggles, `J` and `K` move through turns, `F` opens the flag bar on the focused turn, `I` opens Anatomy. **Motion.** The hill moves only on fresh data (the one continuous mover); the ribbon fill is a 160 ms step. Static: a ring of hollow ticks, ribbon nodes with elapsed text and no fill, organ strip words. Reduced motion: the hill becomes the stepped level bar at 4 Hz; ribbon fill instant. **Art.** C02-02, C02-07, C01-06 (dial grammar), C03-01 warped-grid contour as the 160 ms wake transition and still, C04-125 asleep scene converted to a 40 x 20 glyph block of the silhouette edge only (no face), C04-126 (code-streaming black hole) as the WRITE and THINK static backdrop at 8 percent. Empty: the "asleep" scene, the ring hollow, "Wake JARVIS, or type". **Mobile.** Phone Talk tab: stage 358 x 200, ribbon as a vertical 4-row list, organ strip as 5 lamps in a row, last 3 turns. **`core.sound`.** The Now plate gets a 640 x 64 `DotMatrixMeter` with C04-117 and C04-120 note glyphs as the idle ASCII (static); Spotify stays PLANNED, dashed.

#### 20.9.2 Room (`room.switches`, `room.rules`)

**Purpose.** Operate the room, trust the board. **Centrepiece.** The **wall box**: a dark clay faceplate engraved from C01-19 (the rack's knob rows and screws only; the lower row's lens-style label is masked off and no lens form is ever shown), 40 percent duotone under live SVG keys.

**Layout.** Faceplate 900 x 300 as §4.3.2 (200 px mode dial, eight 140 x 88 keys, chamfered label plate "WALL BOX, 8 CH" in C02-25 style). Each key: a cap with 2 px travel, a device icon from C01-08 (isometric outline, 24 px), a name, and a three-phase LED: **asked** (hollow ring with a 6 s sweep, WAITING), **confirmed** (solid, LIVE, "confirmed by board 14:02:11"), **not confirmed** (triangle FAULT after 6 s, "asked, no report"). Absent channels are dashed "unavailable". `RackRow` (20.5) is the same vocabulary in `console.hardware`.
- **GuardKey** (extends `Key` and `Rocker`): for channels the owner marks **heavy load** (a per-channel flag set in the key's own Trim, not a settings page). A hinged cover (a 140 x 28 plate that tilts open with 160 ms travel) sits over the cap. Step 1: lift (click the cover or Space). Step 2: press the key within 5 s or the cover closes. A summary line on the cover's underside: "turns ON: heater, mains". Turning OFF is always one press without a cover; light and fan keys stay one press. Which channels are mains loads is the owner's answer (Q-V2-6).
- Board plate 370 x 300: board link word, last report age, ESP32 lamp. **All off** as a recessed Key labelled with the count ("6 on") and a pre-press popover listing the channels that will go off.
- Bottom row 336 high: left the **Day ring** 400 x 336, right a modes strip and "what just happened" merged as a 3-line terminal log with `[ROM]` tags, each stamped confirmed or asked.
- **DayRing24** (extends `DateWheel`): a 24-hour ring, 280 px, one thin arc per channel for its scheduled on-windows (from `room.rules`), the current time as a notch, and a **scrubber** dragged or moved with Left and Right in 15-minute steps. While scrubbing, the centre prints "PREVIEW 22:00: lamp, fan on" with a dashed outline and a PREVIEW lamp (the PLANNED dashed-ring shape reused, text "not the board"); releasing returns to now. It never sends anything and never changes a lamp. Schedules edit by dragging an arc end (keyboard: select an arc, `[` and `]` nudge 15 min); Save in the rule row as today. `room.rules` is drawn as a C04-127 logic-gate schematic: each gate shows its last real firing.
- Scenes: dial detents. Turning the dial to a mode previews its channel targets on the keys as dashed outlines; Enter applies (saved-mode logic reused).

**Data and state.** Key lamps follow the board's report, never the saved state (built logic). The fan is a relay on or off per the current hardware; no speed control is drawn. No energy figure: there is no current sensor, so any wattage would be SIMULATED and is not shown by default. **Interactions.** Hover lifts a key 1 px and prints the last change time in the label plate. The faceplate is one composite (arrows, Space); cover lift is Space, press is Enter; the 2 px focus ring surrounds the cap, not the cover. **Motion.** Key travel 80 to 160 ms, cover tilt 160 ms, LED change instant; static: all keys as reported, covers closed; reduced: no travel, the cover swaps open or closed. **Art.** C01-19, C01-08, C02-25, C01-20 seam strip (12 percent duotone, bottom edge), C02-32 and C02-20 for the dial, C01-23 dial grammar; the Away mode PLANNED plate carries C04-104 under a dashed blanking plate. Empty: board not linked: eight dashed keys, C04-54 ASCII drum, the line "Connect the board in Console". **Mobile.** Two-column 175 x 88 keys with the same guard (a tap lifts the cover, a second tap presses), a sticky All off, the day ring as a 358 x 160 strip without scrubber.

#### 20.9.3 Senses (`senses.presence`, `senses.signal`, `senses.teach`)

Printed on screen: "detects motion of anyone in range, identifies no one; one link, no pose." **Purpose.** Say whether a body moved, with provenance. **Centrepiece.** The signal terrain, one bounded 720 x 360 canvas.

**Layout (`senses.presence`, 1286 x 652).** Stage 760 x 652. Top 720 x 360: **SignalTerrain**. X = 51 subcarriers, depth = 24 time rows (latest in front), height = amplitude normalised per column; drawn as ridge lines (the ridge technique of the hill, one path per alpha bucket), the front row in `--state-measured` cyan, history neutral. A floor grid and faint dot-matrix backdrop from C04-118 and C04-27 at 10 percent. With no frames: the same ridges as a fixed hollow 1 px mound and the legend "NO SIGNAL: shape is a placeholder". Simulated: an amber stamp in the canvas corner and an amber ridge. Below, 760 x 276 the **link row**: a **LinkCube** (SVG, 120 px cube from the C04-127 idea, drawn as the ESP32 node with antenna lines; its three faces are the link vitals: frames per second, loss percent, age of last frame, each a number with a lamp), the 51-dot `ChannelMatrix` (solid, or 4-subdivided when stronger, C04-15 rule) 420 x 120, and a tick scale. Right column 510: **Presence core** 510 x 300 and **Motion tape** 510 x 336.
- **Presence core.** The spindle emblem C04-06 as a 260 px SVG sigil (the orbit speed follows real motion energy, still at idle) inside a **ProbabilityArc** (extends `Meter`): a 240-degree arc with three bands, LOW, MID, HIGH, and a needle. Before the held-out check passes the arc shows only the band, the word PREDICTING and the provenance "signal estimate, 3 of 5 drill days". After it passes the number appears beside it as "74 %" with "model estimate, held-out day passed 12 Nov" and LIVE. The words never read present, absent or empty room. Before readiness no digit renders in the arc.
- **Motion tape** (`MotionTape`, extends `WeekStrip`): 7 days as seven 24-hour strips, one 2 px column per 5 minutes; a column is filled only for "motion seen" minutes, hatched for "sensing paused by you", blank for "nothing seen". The caption says blank is not proof of an empty room. Hover: `Tue 14:20 to 14:25, motion seen`. This is the "probability over time" view without inventing occupancy. Zones: unchanged rules (names only with two links and readiness).

**Interactions.** Hover on the terrain gives subcarrier index and amplitude at the cursor; click freezes the frame for inspection (a PAUSED stamp, resumes on Esc). Left and Right move the subcarrier cursor, `P` pauses sensing, `M` toggles Motion and the floor plan. **Floor plan** (the default Map form; D-V2-20): an SVG isometric floor with zone rings and the two link ends as dots, labelled "rings are zones, not positions"; the existing WebGL twin stays behind a "3D" key until the owner decides (Q-V2-7); selecting 3D unmounts the terrain canvas, so a Senses view never holds two canvases. **Motion and static form.** The terrain redraws only on a fresh frame, stops when hidden or paused, and is the only canvas in the view. Static: the current frame set drawn once. Reduced: redraw at most 4 times a second, same picture. **`senses.signal`** keeps its id and becomes an SVG-only Spectrum view (per-subcarrier amplitude bars, no canvas); the old spectrogram and ripples are dropped, so each Senses view holds at most one canvas. The narration keeps its template-and-lint rule. **Art.** C04-06, C03-06 (ring frame for Teach), C04-127, C04-122 (vertical signal tower as the waiting-for-source emblem, white line on charcoal, 360 x 540 crop at 30 percent), C04-24 for the instrument grid, C04-41 Bayer vortex for WAITING (4 px cells, frozen). **Refused:** C04-26, C03-12 and any eye, face or body form.

**Empty and waiting.** No source: the tower emblem, hollow terrain, one line and a link to Console. Paused by the user: hatched tape, "sensing paused by you". **Teach.** The four steps become four sigil rings (C03-04 rings, fill = quiet frames collected as a real fraction); step 3 shows drill days as five hollow rings, one filled per drill day; the held-out ring is separate. Copy says "predicting" until all conditions are met. **Mobile.** Status list only (spec); reflow shows terrain at 358 x 200, then arc, tape, link row.

#### 20.9.4 Memory (`memory.recall`, plus `beliefs`, `people`, `keep`)

**Purpose.** Show, correct, export and delete what it knows. **Centrepiece.** A navigable **MemoryConstellation**, with the ASCII branch (C04-119) as the empty and idle state. Examples in empty states are generic and marked SAMPLE. **Layout (`memory.recall`).** The search bar 1286 x 64 gains a view switch "Constellation, Strata, Trail" (`Segmented`, 44 px). Below: **Stage** 860 x 572 and **Detail** 410 x 572. The capture line docks at the bottom of the Detail pane: `remember>` field 410 x 44.
- **Constellation** (SVG, at most 120 nodes on screen). Topics are wedges (angle from the topic's index by golden angle, `i x 137.5` degrees), radius is age rank (`sqrt(age rank)`, newest at the centre), node size encodes how many times it was recalled, edges join items recalled together at least twice; seeded jitter. The layout is a pure function of the store, computed once per data change (no live physics, no idle loop). Above 120 items the stage shows cluster nodes with counts; clicking a cluster zooms into it. Nodes are generic glyph dots (a ring plus a letter from the item's source tag), never stored text in the picture; the excerpt shows in Detail as plain text. A text list is the keyboard equivalent; the keys 1 to 3 zoom by ring level.
- **Strata** (`StrataBands`): months as horizontal bands, 40 px tall, Atkinson-dithered, density = items stored that month, plus a tick row for recalls; click a band to list its items. Backdrop inspiration C04-23 and C03-19 at 10 percent.
- **Trail.** A timeline ruler 860 x 120 with the last 30 recalls as arcs (C04-36 bundle idea): each arc joins the query to the items it returned in rank order, numbered 1 to n; hover shows the query text the owner typed.
- **Recall animation.** When a search runs, matching nodes light and a dotted path draws through them in rank order in 240 ms; the static form shows the numbered path. Trails are not saved as a streak.
- **Detail.** The selected node: full excerpt, source, dates, Fix and Delete. **Fix** turns the excerpt into an editable field with a two-line diff (old struck, new underlined) and Save; the original is kept in a local history row for undo (7 days). **Delete** keeps the confirm overlay naming the count. **Wrong** flags without editing. The reminders strip stays below (2 rows) with the `ReminderChip` form (20.9.6). **Capture line.** `remember> I keep my notes in the blue folder`, Enter writes a fact, echoes `[MEM] stored #482, source: typed`, and lights its new node once (160 ms). Voice capture is the same row with a source tag `VOICE`.
- **Data.** The source is the existing hybrid recall store; clusters come from tags plus source; edges from the recall log. Embedding search is PLANNED and drawn dashed. Counts on screen equal Holdings counts; deleting a node removes it with no animation reward.
- **Interactions.** Hover dims non-neighbours to 30 percent; click selects; Enter opens; the Delete key opens the confirm. Tab enters the stage, arrows step to the nearest neighbour in that direction, `+` `-` zoom one cluster level; the cursor over nodes is the reticle. **Art.** C04-119 first-run and idle picture; C04-36 edge language; C04-50 detail backdrop at 8 percent; C03-19 Strata backdrop; C03-21 cropped to the filament region only (no figures) at 12 percent behind the constellation (the crop is not yet made); C04-127 logic diagram for the Keep header; empty results C04-56 outline, empty beliefs C03-17. **Motion.** One 240 ms path draw on recall and a 160 ms node light on capture; reduced: none. **Mobile.** No Memory tab (spec); reflow shows search, results, then detail; the constellation is a single static cluster view.
- **Deviation.** D-V2-25 records the exception to §8.3.4; the owner confirms or vetoes (Q-V2-12).

#### 20.9.5 Console (`console.health`, `events`, `connections`, `hardware`, `crew`)

**Purpose.** Know it works, fix it. **Centrepiece.** The terminal world: charcoal, amber and cyan allowed as state colours only, a solid block cursor, no blink. **Layout (`console.health`).** Terminal frame 800 x 652 (C04-10 frame, C04-16 CRT boot idea). Rows `[HEA] can he hear "Hey Jarvis": yes`, `[WAK] median 1.8 s, p90 3.1 s`, each with lamp and reason. The 60 x 14 ASCII skyline of the room stays at top right. At the foot of the frame the **CommandLine** `jarvis>` (44 px): a closed list of verbs (`status`, `test hearing`, `restart brain`, `free gpu`, `export memory`, `jobs`, `plan`, `help`), Tab completes, Up recalls history (last 20), unknown input answers `[SYS] unknown verb; try help`. It is not a shell and has no eval; each verb that changes something asks once. Right 470: **Job board** 470 x 300: `JobRow`s `[SYS] export memory  [########....] 64 %` where the fill equals a reported fraction or the bar is hollow dashed; the traveller on the bar is the ASCII car (C04-57) or chopper (C04-106) at the real position. Timings 470 x 176 as sparkline ridges (`Ridge`). Fix and Recent replies stay below, merged to 144.
- **Events** (`console.events`): the 1286 x 600 log with a filter grammar in a 44 px field: `core !sim since:1h` (tag include, `!` exclude, `since:`); same content as Alt+L.
- **Route** (`console.crew`, renamed "Route"): the planned registry as an ASCII route map: a horizontal path with 12 dashed plates (`BlankingPlate`) such as Wake word model, Agents, Spotify start, Embedding recall; passed items solid. Click opens the honest "What is coming" panel (what, needs, not built). A built-not-verified item is WAITING, never PLANNED. Art: C04-105 dragon on the Agents plate, C03-18 bridge for a linked item only when reported, C04-106 for nothing connected.
- **Diagnostics** (`connections`, `hardware`): GPU gauge (C02-12 arc from the real VRAM reading), serial and board cards with a C04-14 capsule chip for firmware identity, and the relay `RackRow` inventory. Firmware never offers flash while the application holds the port.
- **States.** Offline: `[APP] server not answering`. First run: every line WAITING "not tested". Error: FAULT with reason. `/` focuses the command line, Esc leaves. Motion: none (the cursor is a block). Mobile: the More tab shows the lamp list and the last 5 events; the command line is desktop only.

#### 20.9.6 Reminders, JARVIS side

**Visual.** A `ReminderChip` (extends `NotchedToast`, 360 x 72, bottom-right, one deep) with tag `[REM]`, title, time and three 44 px keys: Done (D), Snooze (S, user-set 5 to 30 min, one use), Skip (X). A `ReminderBell` in the Memory detail strip and in Day: a `DotTimer` ring showing the next reminder's minutes as 12 dots per hour, with text beside it ("in 18 min"). **Spoken.** Only if the reminder has spoken on (default off per reminder, Q-V2-13) and Quiet is off: one chime then one sentence from a fixed template, "Reminder: <title>, now." No adjectives, no repeats beyond the single user-set snooze. Medication, water and gym reminders are plain reminders the student wrote; the product never says missed, overdue or makes any health claim, and never reads out a dose. JARVIS never uses motion sensing to decide whether to speak. **Delivery receipts.** After the due time the chip's lamp shows LIVE "spoken 08:00:03" (TTS completed), WAITING "chime queued", or FAULT "audio device failed, shown on screen only"; Console `[REM]` lines record each. **Ladder (fixed, not adjustable by any engine).** 1 toast; 2 chime (if on); 3 one spoken line (if on); 4 one snooze. It stops there. Quiet silences all and the application cannot lift Quiet. Reminders are stored locally and delivered through the `notify` port; rule-based, no model decides timing or wording. The reminders table itself belongs to Life (L06); delivery belongs to J08.

#### 20.9.7 Hand-off between JARVIS and Well Wisher

Ports only (`voice`, `memory`, `notify`, `ambient`). Core's voice can say "added to your day" because Day registered the `notify` port; without it the Core turn says "I can remember it, but the day planner is not here" in text. A `HandoffChip` (`[WW] Day 3 Dec 18:00`, 28 px, deep link `#t=ww/day.today`) appears under a Core turn or Memory item that wrote into `ww/*`, and in Day under items created by voice with the tag `[JRV]`. Click opens the target; Esc returns via the Resume pill. Day's Start block may offer "study lights" through `ambient`: one tap, off by default, the scene confirmed by the board before the chip says so. `ww/*` namespaces appear in Holdings only when the port is present; one Export and one Delete flow for both. No fifth port.

#### 20.9.8 Logic and data

Pipeline times come from the existing `timing` events; medians over 7 days of transcripts; no median, no fill. **Terrain:** per frame take the 51 amplitudes, normalise per column by a running 60 s percentile (target), resample to 24 rows at 2 per second (target), draw; no smoothing beyond one-frame interpolation. The presence probability is the existing model's output gated by the held-out day rule; no new model. The motion tape buckets stored motion events in 5-minute cells; retention equals the raw-signal retention (default 7 days); "Delete raw signal now" also clears the tape. Fix history: one local row per edit, 7 days, deletable. `CommandLine` is a registry of verbs mapped to existing routes. Needs the owner's consent or account: none in this subsection.

**Components.** `SigilRing` (`bands`, `state`, `glyphSet`; live, hollow, simulated, fault), `PipelineRibbon` (`stages[{id,state,sec,median}]`; live, waiting, fault, off), `OrganStrip` (`organs`, `onOpen`), `GuardKey` (`heavy`, `summary`, `state`; closed, open for 5 s, asked, confirmed, unconfirmed), `DayRing24` (`rules`, `now`, `onPreview`; live, preview, empty), `SignalTerrain` (`frames`, `source`, `simulated`; live, hollow, simulated, paused), `LinkCube` (`fps`, `lossPct`, `ageMs`; live, stale, fault), `PredictArc` (`band`, `p`, `trusted`; predicting, trusted, simulated, off), `MotionTape` (`buckets`, `pausedSpans`; live, empty), `MemoryConstellation` (`nodes`, `edges`, `selected`; live, sample, empty), `StrataBands` (`monthly`), `JobRow` (`fraction`, `state`; live, hollow, done, fault), `RoutePlates` (`registry`; planned, waiting, live), `ReminderChip` and `ReminderBell` (`reminder`, `receipt`; due, snoozed, done, failed), `HandoffChip` (`product`, `target`; live, unavailable); `CommandLine` is a `CaptureLine` with a closed grammar.

**Reserve (not built).** Walking back through the last minute of the hill by scrubbing real frames; a mouthless ASCII avatar of breath lines (C04-125); a rotary master dial for three scenes; an exploded-armillary wiring view (C03-04); a CRT heartbeat link-health strip (C04-14); a signal "weather" icon set; a night-sky Memory mode (C04-43); ASCII excavation on search (C04-114); a first-launch boot sequence of real startup checks; an event-density sigil heatmap; a quiet "lighthouse" pulse on the rail edge instead of a toast.

### 20.10 The merged component list of direction v2

New components by owner package, using the package ids of the 47 in 15.6 (the build contract of 15.6 names exports and signatures; the ids of the lens drafts are mapped in 15.6.3). Seventy-eight names; each extends a built kit or art piece; none adds a canvas except `SignalTerrain` (one, bounded 720 x 360) and no component adds WebGL.

| Family | Components | Package |
|---|---|---|
| Visual grammar | `Sigil`, `SigilFrame`, `GlyphRule`, `Seal`, `AsciiPlate`, `AsciiHeat`, `AsciiBar`, `AsciiPortrait`, `TermWell`, `TermLine`, `BootSequence`, `ScanFrame` (G02); `LitPanel` (G01); `CursorKit` (G04) | G01, G02, G04 |
| Data forms | `Odometer`, `Dumbbell`, `LedgerTape`, `Jar` (D01); `Trace`, `DotHistogram`, `SkyLedger` (D02); `LedgerTable`, `SlotList`, `DetentRack` (D03); `CaptureLine` (D04); `SpecimenLayout`, `StrataCore`, `SigilMark`, `RackRow` (D05) | D01 to D05 |
| Life | `Almanac`, `DayCell`, `DayMark`, `StippleStrip`, `DayDrawer` (L01); `Trim`, `SettingsIndex` (L02); `WaterGauge`, `HabitRibbon` (L03); `IntentRule`, `IntentEditor` (E01); `LinkLamp` (E04); `DayArc`, `ProofRelief` (L04) | L01 to L04, E01, E04 |
| Study and Focus | `PaperStrata`, `CoverageLedger`, `ReviewDesk`, `ExtractionTrace`, `PaperDrop` (Y01); `ParkField` (Y02); `SyllabusLandscape`, `RetentionOrbit` (the orrery; named `RetentionOrbit` here), `SigilGauge`, `BlueprintBar` (Y03) | Y01 to Y03 |
| Tree and Career | `GroveRing`, `SkillNode`, `TraceEdge`, `EvidenceLedger`, `BranchSpine` (T01); `RoleConstellation`, `FlightBoard`, `SpecTable`, `RackChecklist`, `FundingBridge`, `PlateShelf` (T02) | T01, T02 |
| JARVIS | `SigilRing`, `PipelineRibbon`, `OrganStrip`, `HandoffChip` (J01); `GuardKey`, `DayRing24` (J02); `SignalTerrain`, `LinkCube`, `PredictArc`, `MotionTape` (J03); `MemoryConstellation`, `StrataBands` (J04); `JobRow`, `RoutePlates` (J05); `ReminderChip`, `ReminderBell` (E03) | J01 to J05, E03 |

Merged away (not built): `LifeCalendar`, `TetherMap`, a separate `Constellation` for Memory and Career, a separate `CommandLine` component (it is a `CaptureLine` grammar), `RackRow` in Room (the wall box stays).

### 20.11 Sections of this specification superseded in part

Each earlier subsection below carries a pointer line at its top. In every case the earlier text stands except where 20.x says otherwise.

| Earlier subsection | Superseded by | What changes |
|---|---|---|
| §0.2 items 8 and 10, §0.6 | 20.2, 20.13 | track policy, counts (views 36, work packages) |
| §3.2 view table, §4.1.4 | 20.2 (D-V2-10), 20.6, 20.7 | new views `day.month`, `focus.drill`; settings ids become aliases |
| §4.2.6 (shell sheets) | 20.6.6 | the settings sheet dissolves into Trim |
| §4.3.1 to §4.3.5 | 20.9 | JARVIS section additions |
| §4.4.1 `day` | 20.6 | week, month, year forms, body strip, ledger drawer |
| §4.4.2 `study` | 20.7 | Drill moves to Focus; the Paper Desk |
| §4.4.3 `tree`, §4.4.4 `career` | 20.8 | Grove, evidence, Career views |
| §4.4.5 `focus` | 20.7.7, 20.7.8 | `focus.drill`, Park field, terminal strip |
| §6.4.4 elevation and §6.4.5 focus | 20.4.4 | lit edge, tooth, aimed light, focus depth |
| §7 component inventory | 20.10 | 78 new components |
| §8.1 to §8.3, §8.4, §8.5 | 20.4.6, 20.4.7, 20.4.2 | centrepieces at full strength, ASCII budget and grammars |
| §8.6 | rewritten | personal-use rule |
| §10.5 | 20.4.3, 20.4.5 | terminal and cursor additions |
| §15.1 (at most two in flight), §15.3, §15.4 | 15.6 | wave plan |
| §19 | 20.12 additions | additional do-not-build items |

### 20.12 Verification of direction v2

What is verified: the structure (ids, counts, ownership) was checked by script after writing (20.13). What is not: no screen was rendered; only a handful of catalogue crops were looked at by eye (C01-18, C03-06, C04-127, C04-08, C04-113, C02-02 for the visual lens; C04-23, C03-14, C04-10 for Study; C04-40, C04-44 for Tree; C04-122, C04-127, C03-19, C04-24, C03-21, C04-16, C04-36, C03-06, C01-19, C04-18 for JARVIS; C04-23 and C01-05 for the data lens; contact sheet 04 for Life), so every other placement rests on catalogue text and must be judged in the gallery pass. Web research was thin: the award-site pages opened gave site titles and badges only (https://www.awwwards.com/websites/data-visualization/, https://www.awwwards.com/websites/dark/), https://pudding.cool/ gave titles and one-line summaries, and no calendar, skill-tree or timeline gallery was read; the interaction patterns here are the designers' synthesis, not cited patterns. The Google OAuth page for native applications was opened (https://developers.google.com/identity/protocols/oauth2/native-app); Google's scope pages and the testing-mode token lifetime were not. The Germany study-portal page was opened (https://www.study-in-germany.com/en/plan-your-studies/requirements/); the DAAD page returned 404. The spaced-repetition wiki page said its content had moved. All pixel sizes, timings, thresholds (0.25, 0.15, 0.5, 3 and 20 floors), STALE windows, the 400-node LOD estimate, terrain rows and sample rate, and the 90 KB ASCII budget are unmeasured targets.

**Additions to the do-not-build list (§19) that the lenses ruled out:** a streak, chain, "days clean" or reset anywhere (including habit counters); red for a missed or carried item; a native `<select>` in a shipped view; a free-scroll zoom between Tree scales; XP bars or percentage spinners on trees; a node unlocked by a self-mark; a "likely", "expected" or "will be asked" sentence, a score or a pass probability on any paper pattern; a model that grades, adds a topic or invents a number; a decimal for the retention estimate; a tactic aimed at a named person in the influence tree; medical wording on water, medicines, habits, sleep or training; an automatic bank read; a Google write without its separate switch; credentials typed or stored by the assistant; a hinged guard that makes OFF harder than ON; a digit in the presence arc before the held-out check; any eye, face or body form in Senses; a scrubber that changes a lamp; a shell or `eval` behind the command line; an unlabelled model-written string; a number with no lamp; a drawn-in sigil that replaces a lamp; ASCII atmosphere bound to a stored count; tooth or aimed light in forced colours; a custom cursor larger than 32 px; a pointer companion in calm, low, touch or forced colours; a per-package edit to a barrel file.

### 20.13 Package ids and the lens they came from

The six lenses each numbered their packages from 01. They were first renumbered with family prefixes so no two collide: **G** grammar (visual lens S01 to S08, plus G09 the manifest split and G10 the audit), **D** data display (D01 to D13; D06 Almanac is now L03 to L05, D07 is D06, D08 is D07, D09 is D08, D10 is D09, D11 TetherMap is dropped, D12 is D10, D13 is D11), **L** Life (L01 to L10 unchanged), **Y** Study and Focus (the lens's S01 to S11 become Y01 to Y11, plus Y12 art), **T** Tree and Career (T01 to T12 unchanged), **J** JARVIS (J01 to J10 unchanged), **N** process (N01 the preview switch and gallery, N02 the shell integration of the v2 grammar). Section view packages are named `B06-<section>` and `B11-<section>` (15.6). Appendix A holds one block per package. The 77 lens packages were then folded into **47 packages in ten waves** (46 from the fold plus L04, added by the critic pass, 20.16) (waves 5 to 14, 3 to 5 packages each, disjoint files), named N, G, D, J, L, Y, T, E, plus the older B and Q packages that stay; the map from lens package to v2 package is 15.6.3 and the owned files are 15.6.2.

### 20.14 The wave contract and the merge test

The rules that make a wave merge cleanly are 15.6 (nine rules since 14 Nov 2026), Block C rule 13 and the table of owned files in 15.6.2. The integrator runs the merge test of 15.6.4 at the end of every wave: no two packages own an overlapping path (`tools/wave_check.py`), every globbed registration loads, the suites and the kit bench are green, and one gallery screenshot per package is kept. A failing test sends the package back; it is never merged with a known conflict.

### 20.15 The gallery pass

The first wave ships the "What is new" place (N01, N02): every kit, art, lamp, voice and grammar component in its states, both themes and the ten section themes, inside shell v2 and behind the New UI button. Every later package adds one gallery entry, so the owner sees each wave in the running application the day it merges. Because the lenses rendered nothing and looked at only a handful of crops, every placement of a catalogue picture is a design claim until the owner has judged it in the gallery (A.Q04, wave 14); a placement he rejects returns to its package.

### 20.16 Critic pass of 13 Nov 2026: gaps closed, the three weakest screens, merge notes

This subsection was written by the adversarial critic of the design revision. It governs where it differs from 20.1 to 20.15 and 15.6; the packages it adds or changes are L04 (new), G01, G02, D01, D02, D03, A.L03, A.J04 and A.E05 (their blocks above were edited in the same commit series).

**Coverage of the owner's direction (sections A and B).** Everything in A and B has a home. What was dropped or watered down, and what was done:
- *Attendance, timetable and "college" data* had a design (20.5.3) and no package. Now in A.L03.
- *Progress track with an ASCII vehicle* had no owner. Now the `head` prop of `AsciiBar` (G02); the vehicle is chosen in a Trim and nothing is unlocked by progress (the earlier text said "unlockable skins", a reward mechanic, removed).
- *`day.today`, the dashboard the owner lands on, and the `proof` panel* were the only views with no v2 design and no package. Now L04 (20.16.1, 20.16.2).
- *Memory's other three views* (beliefs, people, keep) were one line each. Now 20.16.3, built by J04.
- *"Prevent his addictions"* is deliberately narrower than the owner's words: a log, a limit he sets, a reminder at the cue time he sets, and a cue-swap if-then row. The product does not infer, score or treat (19). The Help list is now shown identically at every count; the earlier "appears when the count is high" rule was an inference about him and was removed.
- *"Identify the near opportunity and prepare him"* had no single place. It is the `Ahead` card on `day.today` (20.16.1): the nearest dated item among exams and Runway deadlines, days left as date arithmetic (LIVE), and the Next three practice picks.
- *"Every placeholder fancy"*: the PLANNED plate gets a corner-bracket frame in CSS in G01, the empty states come in G04, and PLANNED entries are collected by glob (G01), so no later package edits a shared list.
- *Where the deck is*: a private file under `data/notes/design-taste/`, named in the private state file (20.1 item 6). *The new look visible early*: N01 and the New UI button already on main; this spec does not name the owner's local address (not for a tracked file); the integrator records whether the owner's second instance serves the current build.
- *Compaction labels*: D-V2-28 is a process rule outside the application; the global rule is already written. Not a code package.

**20.16.1 `day.today`: the Day Arc (box 1230 x 652, SpecimenLayout; owner of the dashboard feel).** Purpose: show today as one instrument, and the next thing that matters. *Specimen* 760 x 560: `art.day.sun` (ochre-charcoal duotone, private track; plain placeholder on the default track) behind a half-ring of 18 hour ticks (06:00 to 24:00, scale role). Three arc tracks: outer class blocks (solid, a 6-dot attendance micro-row on focus), middle planned blocks (hollow), inner done blocks (filled); a notch at now that steps once a minute. The 12 ASCII rays of the sun are the blocks logged today (a pure function, may fall). At the centre one `Odometer` hero, minutes studied today, with its lamp; under the datum line (y = 288) a `Trace` of the last 7 days of minutes with the student's own median dashed. *Margin* 470, four Callouts of 88 px: **Now** (current block or the gap to the next class, "gap 1 h 10 m", and the one accent-filled key, Start a block), **Ahead** (the nearest dated item, days left, then the Next three card when the engine exists, else a WAITING plate "needs papers on file"), **Counters** (classes tapped, water, blocks, each `Readout` with a lamp; the six counters keep their Undo), **Reminders** (next two, the `ReminderBell` when E03 has merged, else a null adapter). *Footer* 72: the `ww` `CaptureLine` and the Plan key. *Surprise of the view:* the arc, nothing else moves. *States:* no classes entered: the arc is dashed and the Now card says "Add today's classes" with one key; no papers: Ahead is WAITING; Google notches arrive through the adapter. *Keys:* the arc is one composite (roving, Enter opens the existing plan drawer), `n` starts a block, `Ctrl+Space` the Capture Line. *Mobile:* a vertical spine, Now first. *Static and reduced-motion:* the arc drawn, no draw-in. *Grammar:* sigil (scale, seed glyph on the sun), ASCII (rays, bars), terminal (the Capture Line well).

**20.16.2 `proof.panel`: the Proof Relief (rail and panel).** Purpose: honest evidence that the plan is working, never a score. The embossed ring `art.proof.ring` (C02-24 relief) is computed: one bar per measured statistic (blocks kept against planned minutes, recall held, practice questions matched, papers reviewed, days logged), bar height equal to the value, each with a mono caption of n and window and its lamp; a statistic without n is a dashed ring segment. The centre prints no total and no grade. Drill-down level 2 is a `Dumbbell` (the student against his own earlier self) and a `DotHistogram` of the underlying observations, plus the Wilson interval where a count of papers is shown. The rail (56 px) shows one sigil gauge and a Trim. Banned in this view: a combined score, a percentage of readiness, a prediction, a comparison with other people.

**20.16.3 Memory's three other views (J04).** *`memory.beliefs`, the Belief board:* a terminal well of `[MEM]` rows ("I think: you keep notes in the blue folder", source, date) each with Confirm and Wrong keys (a Wrong row is struck in place, not hidden); the weekly cap of three questions is three sockets, filled as they are asked, dashed when unused; a `RULE`, `MODEL` or `HAND` chip on every row. *`memory.people`, the People ring:* an alphabetical ring of `AsciiPortrait` initials (no face, never ranked by closeness, 19), a seed glyph per person, a last-mentioned strata bar, a Fix and a Delete per person. *`memory.keep`, the Keep vault:* four sealed plates (Export, Snapshot, Delete raw signal now, Delete a namespace) built like the `RackRow` vocabulary; the destructive ones use the hold cursor and name the count first; the Holdings table lists counts that equal the stored counts, each with a lamp. The weakest of all remaining views, left for the gallery pass with one-line directions: `study.library` (a shelf of source plates with the harvester queue as a `SlotList`), `study.dmat` (a Dumbbell of the student's own two attempts, no marks promise), `console.connections` (one `RackRow` per link), `career.certs` (the plate shelf needs a second drawing, a timeline of expiry as a `Trace`), `room.rules` (the gate schematic needs a table twin).

**Blanket test for every new interactive component** (written once so no block repeats it): a Tab stop or a roving group, arrow keys and Enter for any action a pointer has, a visible 2 px focus ring, a 44 px hit area, a reduced-motion form, a forced-colours form (`CanvasText` strokes), and a text or table equivalent for every drawing that carries data. A component that fails any of the six does not merge.

**Merge notes (what the critic found in the wave plan).**
1. The wave 5 contract named tokens `--elev-1` to `--elev-3` and `--recess`, which duplicate the built `--elev-flush`, `--elev-raised`, `--elev-float` and `--elev-recessed`; the built names are kept (G01 edited).
2. G01 owned `e2e/bench/bench.spec.ts` (the file is `e2e/bench.spec.ts`) and not `shared/planned/**`, although it must make the registry plate and chip draw `PlannedGlyph`; both fixed. N01 owns `e2e/bench/entry.tsx`, which has an uncommitted edit on main today; the integrator commits or discards that edit before wave 5 starts.
3. `viewCount.test.ts` does not exist; the present count of 34 lives in `e2e/shell-v2.spec.ts`; N02 now creates the test and updates the spec.
4. Same-wave imports that remain, each through the contract signature only: N02 on N01's `WhatIsNew` (lazy), G02 on G01's CSS variable names, J02 on L02's `Trim`. E02 to E04 no longer need E01's server discovery to be merged to be tested.
5. A shared registry that several packages would have edited (`ww/plannedFeatures.ts`, `jarvis/planned.ts`) is now collected by glob (G01); E05 adds a file instead of editing the list.
6. L04 does not import L01's `Almanac`: it draws its own plates, so wave 7 stays disjoint and dependency-free within the wave.

---

## 21 Expanded horizons (13 to 14 Nov 2026): the exam generator first, the classroom connector, dashboards, and the wider feature set

**Status.** Binding. Written on 14 Nov 2026 from six lenses (the exam engine, the classroom connector, the dashboards, wider Well Wisher horizons, wider JARVIS horizons, the delivery forecast) and the owner's answers of 13 Nov. **Where this section contradicts 20.7, 15.6 or an earlier section, this section governs**; everything it does not name stands. Nothing here edits code. Every size, timing and threshold is a target until measured in the real window (section 0.4). The lenses rendered nothing, and the catalogue crops they cite were mostly not opened, so every picture placement below stays a design claim until the gallery pass (20.15). Where the lenses disagreed, the choice and the reason are in 21.1.3.

### 21.1 The owner's request, in public-safe words, and the decisions

#### 21.1.1 What was asked (13 Nov)

1. "I want highly refined components, buttons, shadows and overall aesthetics." The first design was "boring and lifeless"; the second jury scored design 6 to 7 of 10 and the signature moment 4 (pass line 8.0). A craft pass on the clay recipe, the kit and the shell chrome is in progress (package G05, 21.1.2 and 15.6).
2. He asked for a status and a prediction of when the whole UI/UX overhaul completes, because after it the Well Wisher functions must be finished and then used for exams and for daily life (forecast: 21.2).
3. Priority among features: the question-paper (exam) generator and the "gcr" connector come before every other feature. The UI/UX overhaul is still finished first.
4. Do not forget the dashboards. Keep the research agents and the whole design document going.
5. Plan more: expand to more features as part of the design, because the logic sits behind the UI. He wants a top-notch UI with all expanded horizons.

#### 21.1.2 His answers since the lenses were written (13 Nov; they override any lens assumption)

6. "gcr" is Google Classroom. His classes are reachable from his personal Google account. He has created the Google Cloud project under it; no OAuth client and no consent screen exist yet. He places the client file himself (click-by-click steps in 21.4.1).
7. Installs are approved for the project's virtual environment: PyMuPDF (PDF text and page images), RapidOCR with onnxruntime on the GPU (scanned pages), the Google client libraries with keyring (the token goes in the Windows credential store) and fsrs (spaced review). Nothing else is approved by this list.
8. Where his study material is: the syllabus, assignments and some internal-test papers are in Google Classroom; class notes are PDFs and slide decks (so slide ingestion is needed); previous-year papers will be downloaded from the university's question-paper site (public).
9. He wants tools that make public previous-year papers of national and international exams available locally: GATE, GRE, an aptitude test the application already supports as dMAT, and his university's papers. Design: a polite, rate-limited, robots-respecting harvester with a per-source adapter, a manifest of what was fetched from where, and manual drop-in as the fallback. The backend already has a harvester module to extend (`app/jarvis_app/ww_harvest.py`).
10. He likes two lanes running in parallel. The engine lane is built by a second chat (the existing Well Wisher chat), which owns only Python paths (the application's Python package, `core`, their tests) and pushes main itself. This programme chat owns `app/ui`. Shared files (the state file, the research files, this specification) must never be broken by two chats editing them: each chat has its own research topic file and its own plan file, appends to the state file only through its own section and one-line log entries, and never edits the other chat's files.
11. The laptop stays awake; heavy use is fine; he wants the GPU used for local processing.
12. The private data folder is backed up to a private repository of his own. The public repository rules are unchanged.

Rules that hold throughout (the Do-not-build list of section 19 stands): honest states with the five-state lamp; camera-free sensing; no coercion, shame, streaks or variable rewards; no medical or psychological claims; no exam-result promise and no pass probability (prepare, then show evidence); one canvas at 1366x768 with a one-column reflow; light graphics with static forms; accessibility; local-first, where every network feature is opt-in, read-only by default, done by the owner in a browser consent screen and shown as PLANNED or WAITING until then; credentials are never typed, printed or stored in a tracked file; a local 4B model drafts and never grades.

#### 21.1.3 Decisions (each testable)

| # | Decision | Test that proves it |
|---|---|---|
| D-V3-1 | "gcr" is Google Classroom (closes Q-V2-1 and the lens question Q-C1). The registry entry `ww.gcr` stays PLANNED until the connector package C07 has merged, then follows the five states of 21.4 | The registry text names Google Classroom; on the bench with a fake provider no label says "connected" before a first successful `courses.list`; each of the five states is reachable |
| D-V3-2 | Two chats, two lanes, disjoint files. The engine lane owns only Python (`app/jarvis_app/**`, `core/**`, `app/tests/**`, `core/tests/**`); this chat owns `app/ui/**`, `tools/**` except `tools/engine/**`, the design document and its research file; the engine lane also owns `tools/engine/**`, `requirements/**` (its integrator only), `docs/design/well-wisher-engine-plan.md` and `docs/research/well-wisher-engine.md`. The state file is edited only through each chat's own section and one-line log entries; the research files and plan files are one per chat | `tools/wave_check.py` (lane rule) fails a package that owns a path of the other lane; the integrator's pre-merge diff of each chat shows no edit to the other chat's files |
| D-V3-3 | The exam generator is the first feature. Its smallest slice (21.3.5) is built in the first engine wave (EW7) beside the Study screens of the UI lane (UW7 and UW8) and is usable end to end at milestone A | The milestone check of 21.2: one invented 6-question paper goes through drop, review, bank, blueprint, practice paper, print and marks in Playwright and pytest, and nothing enters the bank unreviewed |
| D-V3-4 | Questions are crop-first: each question keeps its page crop (page, bbox, PNG at 150 dpi under `data/`); text is a layer with status `verified`, `unverified` or `none`. Unverified text prints as the crop, never as raw OCR text | A fixture with a scanned page prints a practice paper whose unverified questions are images; a copy test finds no unverified string in the printed text layer |
| D-V3-5 | Slide decks are read as PDF exports first (PyMuPDF), and `.pptx` files through the existing `yaadash.library.extract` (python-pptx is already installed and listed; critic check of 14 Nov, which replaces the lens idea of a second parser on `zipfile` and `xml.etree`, a parallel copy of code that exists). A slide is shown as a crop only when a PDF twin exists; otherwise its status is `text only`. No model reads or rewrites a slide | A fixture deck of 5 slides gives 5 `slide` units with their titles; a `.pptx` without a PDF twin produces no crop and says so in the trace |
| D-V3-6 | The approved installs are exactly: PyMuPDF; RapidOCR with onnxruntime (GPU build); `google-auth-oauthlib`, `google-api-python-client` and `keyring`; `fsrs`. Their sizes and licences are measured and written to the research file before the package that needs them merges. Any other library needs a new yes | A dependency diff for each package lists only names from this list; the research file carries a size and a licence line for each |
| D-V3-7 | The Classroom connector is read-only, on his personal account, built on the approved Google libraries (this replaces the lens advice to hand-write the OAuth flow: less custom security code, and the owner approved the libraries) with a loopback listener and PKCE, and the refresh token in the Windows credential store through `keyring` (closes the lens questions Q-C8 and Q-C9). The first version requests **no Drive scope**: attachments open in the browser and he saves them into the watched folder | A scope-list test fails if any `drive` scope or any write scope appears while the Drive switch is off; a scan finds no token or secret in the repository or in plain text under `data/` |
| D-V3-8 | In Google's Testing status a refresh token lasts 7 days, so a weekly sign-in is expected, not a fault. The lamp goes WAITING with one key, "Reconnect"; cached rows stay | A fake provider answering `invalid_grant` gives WAITING (not FAULT) and the Intake rows are still listed |
| D-V3-9 | Everything arriving from Classroom or from the manual doors is an Intake row with a source, a state and a Take action; nothing writes to the calendar or the exam engine until the row is accepted. A Classroom deadline never enters a count, and "turned in" by Classroom is drawn apart from his own "done" | A deadline row cannot change a counter (unit test); a Classroom "turned in" draws the outline-notch, never the done disc; a network call that downloads a file without a logged Take press is a failing test |
| D-V3-10 | The owner does the consent steps himself in his browser, following 21.4.1. The assistant never types, reads, prints or stores a credential. The client file lives at `data/ww/google/client.json` (git-ignored); he places it himself | A scan of the tracked tree and of the logs finds no client id, secret or token; the Connect Ladder step 4 only reads the path and reports present or absent |
| D-V3-11 | The harvester (`ww_harvest.py`) is extended, not replaced: a per-source adapter with a declared rights mode (`pointer` or `local copy`), a manifest of every fetch (source, url, fetched on, size, SHA-256, robots checked on, terms note), and manual drop-in as the fallback. A local copy is allowed only for a source the owner has switched on one by one, kept in the private data folder and never in a tracked file. This overrides the earlier "pointers only" rule for those sources and no others | With no source enabled the harvester opens zero sockets; a source without a recorded terms note stays off with the reason printed; a `robots.txt` disallow stops that path; a second 403 or 429 stops the host for the day |
| D-V3-12 | Readiness is three counts and no combined score: practised weight, evidence (timed papers, questions marked, cards due) and five gaps. No percentage is labelled ready, chance, likely or expected | The copy grep over the exam views and the print set finds none of the banned words; the readiness function returns no scalar |
| D-V3-13 | The local 4B model drafts and never grades: tags among existing topics, OCR clean-up diffs, rubric points, descriptive variants, reworded hints. Every stored mark has `marked_by` equal to `student` or `checker` | A schema test refuses any other `marked_by`; the rules-only switch removes every `MODEL` path and the exam path still passes |
| D-V3-14 | One review queue serves four producers (the question bank, reading prompts, language cards, letters to self) with the `fsrs` package at default parameters (desired retention 0.90) and the chip `DEFAULT` until about 1,000 reviews | An AST check finds one scheduler module across `ww_review/**` and `ww_learning.py`: the existing Leitner-box recall of `ww_learning.py` (`box_of`, `due_date`) becomes a producer of cards into the queue in X09, or its interval function delegates to it, so there are not two schedulers; the retention estimate has no decimal in any output |
| D-V3-15 | **Exam Room is a second face of `study.plan`**, not a sixth Study view (Study is at the section maximum of five views, section 3). Exam Season is a mode of `day.today` that swaps the specimen, not a view `day.exams`; the System dashboard is a face of `console.health` (Console is at five views), and the Week and Month Reviews are faces of `day.week` and `day.month`. Desks (Term Ledger, Fold, Tide and the others of 21.6) are overlays of the existing one-deep overlay layer, not views. The view count stays 36. This overrides lens 1 (a 37th view `study.exam`) and lens 4 (desks outside the view count; its question Q-H1 is answered by this row, and the owner may still veto) | `viewCount.test.ts` asserts 36; each face and desk id resolves from the palette; no Study view id other than the five exists |
| D-V3-16 | Every dashboard is one `SpecimenLayout` with one object wider than 40 percent of the canvas, a datum line, at most five 88 px Callouts and a 72 px footer; every number sits in a body and carries a lamp; each dashboard has a Hollow form for an empty store; no urgency theatre (no red fill, pulse, shrinking bar, "only N days", streak or pass probability) | A DOM scan finds no numeric text node outside an element with `data-state` in the five lamp states; an empty-store fixture renders every dashboard with zero LIVE lamps and zero digits; a lint over dashboard CSS and strings finds none of the banned forms |
| D-V3-17 | Route contracts are written once, in `docs/design/well-wisher-engine-plan.md` (it exists since 14 Nov; its section 4 sets the `/api/mission/` prefix and the `state`, `reason`, `source` envelope, and its section 9 must hold the contracts R-01 onward before EW7 starts; the engine chat owns it and changes a route shape only by appending a dated entry to its "Changes" log; where it and this document differ on a route shape or an engine package, the plan file governs). An engine package exposes routes with a documented JSON shape; a UI package reaches a route only through an adapter file it owns, with a null adapter until the route exists | `wave_check.py` fails an engine package that owns a TypeScript path and a UI package that owns a Python path; a UI route call with no entry in the plan file fails a lint; with the engine absent every Study screen renders WAITING |
| D-V3-18 | Agents leave their work uncommitted; the integrator of each chat commits (an agent's `git commit` call has hung in two runs). Each chat commits and pushes only its own paths, pulls with rebase before pushing, and never rewrites the other chat's commits | The integrator's pre-merge diff lists only owned paths; `git log` shows no agent-authored commit |
| D-V3-19 | In the default themes a control that carries a text label no longer draws a hairline edge: the label and the raised form identify it. A state-bearing control (switch, rocker, checkbox, radio, knob, slider, detent) keeps a 3:1 cue inside the control (ridge, recess edge or marker against its neighbour). In `prefers-contrast: more` and in forced colours every control has a hard 2 px edge in `CanvasText`. This revises the "every control edge at 3:1" part of G01 and is paid in the craft pass G05 | The contrast oracle computes the inner cue for every state-bearing control at 3:1 in light and dark, and the hard edge in the two high-contrast modes; a lint finds a hairline on a labelled control only inside those modes |
| D-V3-20 | Every network feature is opt-in, read-only by default, PLANNED or WAITING until the owner has completed his own browser step. With no client file and no enabled harvester source the application opens no connection to an external host | A whole-app egress test on a fresh data folder lists zero external hosts |
| D-V3-21 | A forecast is shown only as a range with an `estimate` chip and the PLANNED lamp, never as one date; a milestone turns LIVE only when its check passes on main | A lint over the Runway data and the research file finds no single-date forecast |
| D-V3-22 | An optional exam-season freeze, set by the owner (the lead time stays in a private file, not in a tracked one): while it is set only bug fixes merge into `ww/study/**`, `ww/focus/**` and `ww_pyq/**`, and the old layout is not retired. The freeze is off by default (I34 stands) | `wave_check.py` refuses a feature package touching those folders while the private freeze file exists |
| D-V3-23 | The private data folder is backed up to a private repository by the owner. Nothing changes in the public rules: no personal details in tracked files; names of institutions, courses and exams dates stay out | The privacy scan of A.Q03 finds no institution name, course name, account name or date in a tracked file |
| D-V3-24 | Added by the critic, 14 Nov. Extend, never duplicate: every engine package names the existing module it extends (21.10), and a package that writes a parallel copy of a module on that map fails review. The owner's own papers and notes stay in the private review Store; they reach the generator through the `bank` argument of `ww_generator.generate`, and `ww_bank_store` is not edited (it refuses verbatim text without a recorded open licence, and keeps refusing) | The map of 21.10 lists the module for each of the 18 engine packages; a grep over `app/jarvis_app/ww_pyq/**` finds no write to `bank_root()`; `app/tests/test_ww_bank_store.py` is unchanged |
| D-V3-25 | Added by the critic. The engine plan file governs route shapes and engine packages (its `/api/mission/` prefix and `state`, `reason`, `source` envelope); this document governs scope and screens. Where they differ on a route shape or on which engine package owns what, the plan file is corrected here, not the other way | `wave_check.py` route check reads paths from the plan file only; a diff between the route paths of Appendix A and the plan file is empty before EW7 |
| D-V3-26 | Added by the critic. Two lists are never named alike: the gain-ranked "Practise next" of the Study side (E07, `practiseNext`) and the Today list "Next Three" (DB01, DB11); `ww_director.py` (the existing ordered next-action list) is the input DB11 extends, not a third ranking | A grep finds `next_three` and `nextThree` only in DB01 and DB11 files; DB11's tests import `ww_director` |

**Where the lenses disagreed, and what was chosen.**

| Question | Lens positions | Choice and reason |
|---|---|---|
| Who owns `ww/study/ports.ts` | Lens 1: the first engine package. Lens 6: the section package | The section package (Y01 owns every Study port). A port always lands one wave before its engine; an engine package may not own a UI file (D-V3-17) |
| Who owns the TypeScript adapter files | Lens 6: the engine packages (E15, E16). The lane rule of this chat's brief | New UI packages AD08 to AD12 own the adapters of each engine wave; an engine owns Python only |
| Hand-written OAuth or the Google libraries | Lens 2: standard library. Lens 6: `requests_oauthlib`. The owner: libraries approved | The approved Google libraries plus `keyring` (D-V3-7) |
| Drive scope for attachments | Lens 2 and lens 6: none first. Lens 1: "probably a Drive read scope" | None in the first version; a separate switch later, only after his explicit yes per scope |
| A 37th view `study.exam` | Lens 1: yes. Section 3: five views per section | A face of `study.plan` (D-V3-15), registered through a glob folder owned by Y03 |
| Exam Season: view `day.exams` or a mode | Lens 3: a mode of Study and Today with its own id. Lens 4: Season mode of Today | One mode of `day.today` (the specimen swap) that also carries lens 4's paper strip; Exam Room holds the per-subject detail |
| Two review queues (lens 1 FSRS in the question engine, lens 4 review queue module) | Two modules | One queue module, package X09 (D-V3-14) |
| `ClassroomShelf` (lens 1), `ConnectLadder` (lens 2), `LinkSteps` (lens 6) | Three step lists | `ConnectLadder` and `ClassroomLink` only |
| Classroom export import (lens 6) and Manual Intake (lens 2) | Two fallbacks | Both: the Archive door is a fourth door of the Manual Intake desk (package E17) |
| Package id `P01` for the Runway board (lens 6) | Collides with the prototype block A.P01 | Renamed RB01 and left in reserve (21.9) |
| E10 and E11 as engine packages | They are JSON data under `app/ui/src` | UI lane (data files), ids kept |
| Where the paper-strip chips of lens 4 and the Exam Season rose of lens 3 live | Two season layouts of Today | Merged into DB04 |

### 21.2 The forecast

All figures come from the forecast lens (written 13 Nov). **The overnight gap of 13 to 14 Nov produced no work**, so wave 6 has not advanced since the lens; day 1 of the calendar below is 14 Nov and holds only if the loop restarts on 14 Nov. Every figure is an estimate, drawn with the PLANNED lamp and the `estimate` chip (D-V3-21), and is never one date.

**Inputs (measured by the integrator).** A clean wave of 4 to 5 packages costs 85 to 100 minutes of agent time plus 40 to 70 minutes of integration. Wave 5 took 4.8 hours of wall time, 100 minutes of it lost to two agent stalls. Wave 6 (7 packages: D01 to D05, J01, L02) lost 76 minutes to an outage and has not finished; D01, D04 and L02 are merged, D02, D03, D05 and J01 are in review. Every jury so far scored below the 8.0 pass line. 35 packages remained after wave 6 before this section; this section adds 42 (21.8, Appendix A) and moves 12 engine packages into a parallel lane.

**Cost of one slot** (one UI wave plus the engine wave beside it), in hours.

| Part of a slot | Low | Mid | High | Basis |
|---|---|---|---|---|
| Builders, in parallel | 1.5 | 2.0 | 2.5 | Wave 5 builders took about 100 minutes; section packages are larger |
| UI integration (commit, merge, tsc, vitest twice, bundle, full Playwright about 13 minutes, art build, preview) | 0.7 | 1.0 | 1.2 | Measured 40 to 70 minutes; sections add Playwright specs |
| Engine integration (pytest on scratch dirs, bundle check) | 0.25 | 0.4 | 0.6 | No Playwright unless an adapter file changed |
| Jury and records | 0.3 | 0.4 | 0.5 | Measured in wave 5 |
| Rework | 0.5 | 1.2 | 2.5 | 0 to 2 rounds; no jury has passed yet |
| Losses (stalls, outages) | 0 | 0.5 | 1.5 | 100 and 76 minutes in the last two waves |
| **Slot total** | **3.25** | **5.5** | **8.8** | |

The rest of wave 6 is estimated at 1 / 2 / 3.5 hours. The engine lane alone (no Playwright, no jury of its own) costs about 2.25 / 3.7 / 5.8 hours a wave (builders, engine integration, records, rework 0.2 / 0.6 / 1.2, losses 0 / 0.3 / 1.0): five engine waves are about 11 / 18.5 / 29 hours and run beside the UI waves, so the engine lane is not the critical path and has about 25 hours of slack for the reserve backends (21.9).

**The plan of 15.6 (eight UI waves, UW7 to UW14, five engine waves EW7 to EW11), milestones in running hours from now.**

| Milestone | What has to merge | Low | Mid | High |
|---|---|---|---|---|
| A. Exam generator usable end to end (smallest slice, 21.3.5) | rest of wave 6, two slots (UW7 with EW7, UW8 with EW8 and the adapters AD08), plus a 0.5 h smoke test on one real paper | 8 | 13.5 | 21.6 |
| C1a. Classroom fallback, folder door | same as A | 8 | 13.5 | 21.6 |
| C1b. Classroom fallback, paste and calendar-file doors on the Life month | A plus UW9 (three slots) | 11.3 | 19 | 30.4 |
| B. Every section rebuilt and visible behind the flag | rest of wave 6, UW7 to UW11 | 17.3 | 29.5 | 47.5 |
| C2. Classroom connector live | UW7 to UW12 (C08 in UW11, AD11 in UW12), EW9 and EW10, plus his own Google sign-in | 20.5 | 35 | 56.3 plus owner time |
| D. Flag flipped, old layout retired | rest of wave 6, UW7 to UW14, plus his gallery pass (1 / 2 / 3 h) | 28 | 48 | 77 |

**Arithmetic check (critic, 14 Nov).** Each milestone is the rest of wave 6 plus whole slots of 3.25 / 5.5 / 8.8 h (plus the 0.5 h smoke test for A and C1b and his gallery pass of 1 / 2 / 3 h for D). B (5 slots), C2 (6 slots) and D (8 slots) were right. A and C1b were not: the first draft gave A 7.5 / 12.3 / 19 and C1b 10.8 / 17.8 / 27.8, which does not follow from two and three slots (A is 1 + 2 x 3.25 = 7.25 low, 2 + 2 x 5.5 = 13 mid, 3.5 + 2 x 8.8 = 21.1 high, plus the smoke test; C1b is 1 + 3 x 3.25 = 10.75, 2 + 3 x 5.5 = 18.5, 3.5 + 3 x 8.8 = 29.9, plus the smoke test). The figures above are the recomputed ones, rounded to the half hour in the cautious direction; the rework band behind them is a guess (two measured waves), so none of them is better than plus or minus a third, and the table says "about" for that reason. The 90-hour case named below is above the high column of D (77) and is the stress case, not a bound.

The forecast lens's own D, for a plan with five UI slots, was 18 / 31.5 / 50.5. This plan has three more UI slots (dashboards, the Study screens with their adapters, the Intake UI, the Exam Room), so D moves by 3 slots, 9.75 / 16.5 / 26.4 hours. A and C1a do not move because Study and its adapters come first.

**Calendar days, with wave 7 starting on 14 Nov (day 1 = 14 Nov).** Effective hours are the daily hours minus 0.5 h to restart after each break. Each figure is the ceiling of hours over effective hours, shown low / mid / high, with the date range.

| Laptop runs | A. exam slice | B. sections visible | C2. classroom live | D. flag flipped |
|---|---|---|---|---|
| about 8 h a day (7.5 effective) | 2 / 2 / 3 days (15 to 16 Nov) | 3 / 4 / 7 (16 to 20 Nov) | 3 / 5 / 8 (16 to 21 Nov) plus owner | 4 / 7 / 11 (17 to 24 Nov) |
| about 12 h a day (11.5) | 1 / 2 / 2 (14 to 15 Nov; the high case needs 21.6 h, so day 2) | 2 / 3 / 5 (15 to 18 Nov) | 2 / 4 / 5 (15 to 18 Nov) plus owner | 3 / 5 / 7 (16 to 20 Nov) |
| about 20 h a day (19.5) | 1 / 1 / 2 (14 to 15 Nov) | 1 / 2 / 3 (14 to 16 Nov) | 2 / 2 / 3 (15 to 16 Nov) plus owner | 2 / 3 / 4 (15 to 17 Nov) |

**What the forecast cannot know.**
- When wave 6 ends.
- How many rework rounds the jury forces: two rounds on every section plus one outage per slot put D near 90 hours with eight slots.
- When the owner is free for the gallery pass and for the retirement OK (B13).
- Whether his personal account lets the application read Classroom through his own Cloud project (his classes are reachable from it, which is better than a school account, but only his sign-in will show it).
- Agent-plan usage limits and outages.
- CPU and GPU contention from about ten agents on one laptop, and from RapidOCR sharing the GPU with a resident local model.
- Whether real papers have a text layer, and how the real decks and papers behave under `find_tables()`.
- How the first jury of each new dashboard scores.

**Each added expansion wave** costs one slot (3.25 / 5.5 / 8.8 hours) and pushes D back by that amount; reserve work of 21.9 is therefore placed after the flip.

**The three cheapest ways to shorten the calendar.**
1. Two lanes: four serial engine waves cost about 0.4 h each of extra integration instead of 5.5 h each, so about 20 hours (roughly 2 days at 12 hours a day) are saved.
2. The laptop on mains and awake, the stall watchdog (relaunch an agent after 15 minutes with no output, on the same worktree and prompt) and the one-command offline integration `tools/integrate_wave.py` (tsc, vitest, bundle, `wave_check`, Playwright and the art build in one report): 0.5 to 1.5 hours of losses plus 15 to 25 minutes of integration per slot, about 4 to 10 hours in all.
3. Batch the rework into one rework wave (RW1) and run the full Playwright suite once per slot with targeted specs on re-runs: rework falls from up to 2.5 hours a slot to about 1, which saves about 3 to 6 hours. Scores ratchet: no section merges below its previous jury score.

**If the exam season arrives first.** Keep Y01 to Y03, X03, AD08, E05 to E08, M01, E17, L04 and L01 (exam dates on the month), C03. Defer the Syllabus Landscape, the Retention Orrery and the Exam Room face as plain lists with lamps; defer OCR and `MODEL` tags; use the folder door and the paste door instead of the live connector; enter exam dates by hand; keep the classic pages inside the new shell for J03 to J05; never flip the flag during exams. Turn the freeze of D-V3-22 on before the first paper.


### 21.3 The exam generator: from a PDF, a deck or a scan to a marked practice paper

**What 21 adds to 20.7, and which governs.** 20.7 (the Paper Desk, the Review Desk, patterns, Next three, the generator overlay, Drill) stands. 21 adds the following; **where they differ, 21 governs**:

1. **Crop-first questions** (D-V3-4): 20.7.9 stored the stem as text; now each question stores its page crop and the text is a status-bearing layer.
2. **Ingest of slides and of scans**: 20.7.9 left OCR "needs the owner's OK" and said nothing of slide decks; the installs are now approved (D-V3-6) and slides are read (D-V3-5). Text-layer PDFs need no model and no OCR.
3. **Tables**: a page table with question, marks, course-outcome (CO) and Bloom-level (BL) columns is read as rows, and BL seeds the difficulty draft.
4. **The blueprint is a stored, validated object per exam** (sections, set and attempt counts, marks each, internal choice, duration, total), with a Blueprint Editor. 20.7.6 "copy a real paper's structure" becomes "confirm an inferred blueprint".
5. **The generator fills slots by a printed, seeded rule** (bank, then templates, then a dashed model draft, then a hollow slot) and may not emit an unbalanced paper (the 9 Nov audit bug: a 20-mark internal borrowing the 60-mark pattern).
6. **The student marks; the model never grades** (D-V3-13): rubric chips, `marked_by`, a Marking Desk.
7. **A timed attempt is a "paper" track of `focus.session`** (the Exam Hall).
8. **The Exam Room** is a face of `study.plan` with a Readiness Ledger of three counts and no score (D-V3-12, D-V3-15), and **Tonight** is a state of it.
9. **A Quiet list** (topics not set in the last r papers) beside the frequency counts, never worded "due".
10. **Print by the browser's print to PDF** (A4 stylesheet): paper, key, marking sheet, Night sheet. No PDF library. KaTeX stays the open maths question (Q-V3-8).
11. **The harvester** (21.3.6) brings public papers of GATE, GRE, the aptitude test of dMAT and the university's question-paper site into the same intake, with manual drop-in as the fallback.

**Already on main and reused:** `ww_generator.py` (pattern generator, EWMA proficiency, `paper_invariants`), `ww_bank_store.py`, `ww_numericals.py` (sympy keys), `ww_exams.py`, `ww_harvest.py`, the marks route. In `.venv`: PyMuPDF 1.28.0, onnxruntime 1.27.0, sympy, `keyring` 25.7.0, `pytesseract` (no binary, unverified). The older harvester note on `pdftotext` ("no Python PDF library") is superseded by PyMuPDF.

**Shared grammar of 20.7 holds:** ground `#E8EAE9` / `#171717`, `#F25623` as fill only, a lamp on every number, 44 px targets, a 2 px focus ring, a static form for every motion, no canvas in Study.

#### 21.3.1 Ingest: the sources, in the order the student meets them

| Source | Route | Result |
|---|---|---|
| Text-layer PDF (class notes, internal-test papers, previous-year papers) | PyMuPDF `get_text("dict")` per page; render each page once at 150 dpi; `find_tables()`; segmentation | crop-first questions, text `verified` |
| Slide deck as PDF export | same route; each slide is one unit with its title | `slide` units with crop and text |
| Slide deck as `.pptx` | the existing `yaadash.library.extract` (python-pptx, already installed): slide titles from the title placeholder, text runs, notes ignored; no new install | `slide` units with `text only` status (a crop only if a PDF twin with the same stem is present) |
| Scan or photo | RapidOCR on onnxruntime, GPU build; page rendered at 150 dpi | text `unverified`, crop kept; with no engine the page reports FAULT and the rest of the paper imports |
| Syllabus, assignments (from Classroom or pasted) | Intake (21.4) then the same ingest | units for the syllabus; assignments are Intake rows, not questions, unless he marks one as a paper |
| Harvested or dropped previous-year papers | the harvester manifest (21.3.6) or manual drop-in, then the same ingest | as above, with a source note in the paper row |

**Ingest rules (no model needed).**
1. A page has a usable text layer when it gives at least 40 characters and at least 80 percent of its tokens are words, digits or maths symbols (targets, to tune on his real papers).
2. Render each page once at 150 dpi; the crop PNG is stored under `data/` and never leaves it.
3. Try `find_tables()`. When a header row names the question and marks columns, each table row is a question, and the CO and BL columns are read when present; the trace prints `p1 table 5 cols: Q, text, marks, CO, BL`, and the form shows `CO3` and `BL4` chips (`RULE`). BL1 and BL2 seed "easy", BL3 and BL4 "medium", BL5 and BL6 "hard" (`RULE`, replaced by his attempts after n of at least 5).
4. Otherwise segment by the start pattern of 20.7.9, with a question's left edge within 12 pt of the page's modal left margin. The bbox is the union of the question's blocks plus 6 pt.
5. A page without a text layer goes to OCR if an engine is installed; its text is `unverified`. With no engine it reports FAULT.
6. The trace logs real events only (the log of 20.7.2 is the run's actual event list).
7. Duplicates are found by file hash and skipped ("already on file").

#### 21.3.2 Screens (all inside the existing Study and Focus homes; boxes at 1366x768)

**S1. Import tray** (grows from the Drop Slot of 20.7.1). On hover or drop the 300 x 100 slot becomes a 300 x 260 tray: four 44 px route rows (Drop, Paste, Folder, Classroom) with lamps, then up to four queued rows with a `Trace` of words per page. Paste opens a 600 x 360 sheet. Data: queued files (LIVE count), method chip (`text-layer`, `ocr`, `pasted`, `slides`), the folder WAITING until chosen, Classroom PLANNED or its live state. Keys: `A` files, `V` paste, `W` folder; Enter on a row opens its Extraction Trace. Motion: rows rise 8 px and fade in, 160 ms (static: present). Mobile: a bottom sheet, paste only. Empty: "Nothing queued" in `AsciiPlate`. No art, so the Strata keeps attention.

**S2. Review Desk additions** (overlay `pyq-review`). Crop handles: four 44 px corner handles per question box on the page image; `Shift+arrow` moves an edge 4 px; the crop re-renders on release. Tabular papers show CO and BL chips. Text status: `TEXT verified`, dashed `TEXT unverified` or `CROP only`; `T` toggles crop and text side by side; OCR clean-up arrives as a `MODEL` diff to accept. Rubric strip (`R`): 1 to 6 points with marks; "Draft points" asks the local model (dashed until accepted); points must sum to the question's marks.

**S3. Pattern Loom** (overlay `pyq-patterns`, 1100 x 620). A 200 px rail of five 44 px tabs; canvas 900 x 620. Frequency: topic rows "k of N" with a Wilson bar. Marks weight: a `Ridge` per unit with a min-to-max band. Pairs: `PatternLoom` arcs for pairs set together in at least 3 papers, 1 to 4 px stroke. Quiet: `QuietList`, topics not set in the last r papers on file, r printed (r = 3, or N if fewer papers), never "due". Repeats: families, one row of year pips each. Figures are LIVE at N of at least 3 papers and 20 reviewed questions, else WAITING "too few papers". Footer: "From papers on file. This prepares practice; it does not predict a paper or a result." Keys: arrows within a lens, Enter opens the questions behind a figure, `p` practises the topic. Motion: arcs draw in 240 ms once per open (static: drawn). Mobile: one lens per screen under a `Segmented` row. Art: a quiet backdrop of C04-15 re-drawn as 1 px cells at 5 percent (private track); the cells encode nothing. Empty: an ASCII loom of bare threads, "Two more papers and the patterns open."

**Improvement written by the critic (14 Nov; the third of the three weakest screens: five lenses of arcs, ridges and bars are figures with no reading, and the Pairs arcs in particular cannot be read by a screen reader or compared by eye).** (1) Every lens opens with one sentence in the page's own words, built from the same counts, before any figure ("Unit 2 and Unit 5 were set together in 4 of 6 papers."), so the figure confirms the sentence instead of asking to be decoded. (2) Every lens has a table twin on `v` (the same rows as a `LedgerTable`, sortable by count), which is also the accessible reading and the print form; the figure is the second view, not the only one. (3) Pairs shows only the top 8 pairs by count and says "8 of 31 pairs shown", with the rest in the table twin, so the arcs never become a knot. (4) The "too few papers" state shows the figure ghosted with the number of papers and questions still needed ("2 more papers, 9 more reviewed questions"), the counts the floor of E07 actually tests. Test: each lens has a sentence and a table twin with equal numbers; the Pairs lens draws at most 8 arcs on a 31-pair fixture.

**S4. Blueprint Editor** (overlay `pyq-blueprint`, 1100 x 620). Top 1100 x 64: exam, duration `Odometer`, total Readout, source-paper chip, invariant lamp (LIVE "balanced" or FAULT with the reason). Main 700 x 556: `BlueprintTable`, one 56 px row per section (label, set and attempt `DetentRack` steppers, marks each, allowed types, choice rule `any k of n` or `OR pairs`, unit limit). Right 400 x 556: a live A4 skeleton at 0.42 scale and "minutes per mark: 3.0". Keys: `Alt+arrow` reorders, `+` adds a section; "Infer from a paper" proposes sections (`RULE` until saved). Motion: the lamp cross-fades in 120 ms. Mobile: rows as cards, preview behind a button. Empty: "No blueprint. Infer one from a paper on file."

**S5. Generator and Variant Bench** (overlays `pyq-gen` and `pyq-variants`, 1100 x 620). Generator step 2 shows a `SlotStrip` per section: 44 px slots with a source chip (`HAND`, `RULE`, `TEMPLATE`, dashed `MODEL`, hollow "needs 1"), topic, marks and a reason line ("highest gain in Unit 3; not attempted for 18 days"). Reseed redraws; the seed is printed. Slots fill with a 30 ms stagger (static: filled). Variant Bench: original crop left (540), draft right (540) as a `VariantPair` with a word diff and check chips (similarity band, marks equal, topic equal). Enter accepts, `E` edits, Backspace rejects; accepted drafts keep "drafted by model, accepted by you".

**S6. Exam Hall** (track "paper" of `focus.session`, 1230 x 652, charcoal). Left 760: the current question at reading size, internal-choice siblings as tabs. Right 454: `PaperClock` 360 x 360 (a ring segment per section sized by time share, a tick per elapsed minute), a `SlotList` of questions (not started, open, done, left), and the terminal strip `> sec B 22 min | q7 done | 3 left in section`. Keys: `j`/`k` question, `d` done, `s` leave for later, Space pause. "Print the paper first" is the default start; answers are written on paper as in the hall and the application records per-question time from key presses. Motion: one tick per minute, nothing at idle. Mobile: not offered (the print is the phone route). Art: C03-03 cropped to the ringed floor below the horizon, symbols removed, traced to 1 px contours at 5 percent behind the clock (private track). No camera is used and none is added: an answer sheet he has scanned by other means is an optional local file he drops in, never read by a model (critic, 14 Nov: "photo" removed; the application has no capture feature). End: "Paper closed. Mark it now or later."

**S7. Marking Desk** (overlay `pyq-mark`, 1100 x 620). Left 540: the crop and an optional answer photo. Right 540: `RubricChips` (each point a 44 px chip), a numeric field for numericals ("matches the key" or "does not match"), and the total labelled "marked by you". Keys: `n` next, `0` to `9` toggle a point; without points, whole marks on a `DetentRack`. No colour for low marks. A question below half marks, or one marked "keep", becomes a review card, listed as "6 cards made".

**S8. Exam Room, the second face of `study.plan`** (1230 x 612; a `Segmented` switch "Calendar | Exam room" at the top left; the Syllabus Landscape of 20.7.3 and the quilt are two projections of the same syllabus). Top 1230 x 72: subject `FolderTabs`, exam date and duration (LIVE from the date sheet), blueprint chip. Left 520 x 540: `CoverageQuilt`, the syllabus as a squarified quadtree whose cell area is the marks weight on file; solid is marked practice in the last 21 days, hatched is self-marked only, outline is untouched; caption "Topics practised: 14 of 23. Their share of marks weight on file: 58 of 100." Middle 340: `EvidenceTape` (a tick per attempt, a tall tick per timed paper, 30 days) and Readouts for timed papers, questions marked and cards due. Right 346: five gap rows ("Unit 4, transfer functions: set in 5 of 6 papers, not practised"), each with Practise, then "Make a paper on these gaps". Footer: "Evidence of practice, not a forecast of marks." Keys: arrows across the quilt (roving tabindex), Enter opens the topic, `g` makes the gap paper. Motion: cells fade in by area, cap 200 ms (static: drawn). Mobile: quilt 358 x 300, then Evidence, then Gaps. Art: C04-19 wireframe chart panel re-drawn as a 1 px grid with corner brackets at 6 percent behind Evidence (private track); C02-16 gives the Readout plate pattern, structure only. Empty: "Add a paper on file to weigh the syllabus."

**S9. Tonight** (a state of the Exam Room). Offered as a 44 px plate when the date sheet has an exam tomorrow after 17:00, or opened with `t`; it never opens by itself. Left 640, charcoal: three lists from his own records (repeated families as crops, his formula and definition cards, three quick gaps). Right 574: a stop-time `TickSlider` (his choice), "Print the Night sheet" and art. Copy: "Go through what you choose, then stop at the time you set." No timer, no remaining count. Art: C04-11 cropped to the seated figure on the dune with the orbit arcs, text removed, grey duotone, 360 x 480, static (private track).

**S10. Print set.** A4, 18 mm margins: the practice paper (header "Practice paper from your bank. Not an official paper.", the seed in the footer), a separate key, the marking sheet, the Night sheet and the pattern tables.

#### 21.3.3 Logic and data

**Storage** (the field lists below are the contract; the format is the engine chat's choice: today's Well Wisher code keeps JSON and JSONL files under the data directory, written atomically, and no database, so JSONL is the default and SQLite from the standard library an allowed alternative; nothing leaves `data/`): `crops` (question id, page, bbox, PNG path, text status); `blueprints` (exam id, source paper, duration, total, sections as JSON, origin); `gen_papers` (blueprint id, seed, question ids); `paper_attempts` (question id, opened, done, marks, `marked_by`); `rubric_points` (question id, text, marks, origin); `variants` (source question, draft, checks, status).

**Tags and patterns** follow 20.7.9 with two additions: Bloom seeds (above) and Quiet (a topic that does not appear in the last r papers, r = 3 or N).

**Blueprint inference.** A heading matching `^(section|part)\s+[A-Z]` opens a section. Its `marks_each` is the modal marks value of its questions, and an "attempt any k" phrase sets the attempt count. Three invariants hold: the sum of attempt times marks_each equals the total; the set count is at least the attempt count; OR choices come in pairs. An unbalanced blueprint is refused by the generator.

**Generator (pure, seeded).**
1. A question is a candidate for a slot when its type is allowed and its marks equal `marks_each`, or its sub-parts sum to it.
2. Each candidate's weight is `gain_t` (20.7.9) times 0.3 if attempted in the last 14 days, else times 1. A family appears at most once in a paper.
3. Draw the set count by seeded weighted sampling without replacement: at most 2 questions per topic in a section, distinct units where possible.
4. Fill a shortfall with templates (`ww_numericals`), then the Variant Bench queue, then hollow slots.
5. Emit nothing unless `paper_invariants` passes. Minutes per question = marks times duration over total.

**Variants.** Numerical variants come from the templates only. For a descriptive variant the 4B model receives the stem and topic with the instruction "same concept, same marks, new context". The draft must have a 5-word-shingle Jaccard to the original between 0.2 and 0.7, and it stays `MODEL` and dashed until accepted.

**Marking and review.** Marks go to `paper_attempts` and to the existing marks route, so the EWMA proficiency updates. A question below half marks, or one marked "keep", becomes an `fsrs` card (default parameters, desired retention 0.90). One queue (D-V3-14) serves all producers.

**Readiness (counting only).** Practised weight: `w_t = m_t x k_t / N`, normalised to 100 points; practised weight is the sum of `w_t` over topics with a marked attempt in the last 21 days. Evidence: counts of timed papers, marked questions and due cards. Gaps: the five topics with the largest `w_t` and no marked attempt. No combined score exists.

**The local model drafts only**, always labelled `MODEL`, and the rules-only switch turns all of it off: tags for uncertain questions (chosen among existing topics), OCR clean-up diffs, rubric points, descriptive variants, reworded hints. It never produces a grade, a numeric answer, a probability or a new topic.

**New components** are in 21.8 (`CropCard`, `BlueprintTable`, `SlotStrip`, `VariantPair`, `PatternLoom`, `QuietList`, `CoverageQuilt`, `EvidenceTape`, `PaperClock`, `RubricChips`, `NightSheet`).

#### 21.3.4 What needs the owner

- GPU use for OCR: RapidOCR shares the GPU with the resident local model; the loader of JH04 refuses a load that does not fit and names the numbers (21.7).
- The sizes of the four approved installs are measured before the package that needs them merges (D-V3-6).
- KaTeX (about 0.6 to 0.7 MB, an estimate) for maths in the print set remains his decision (Q-V3-8); until then maths prints as the crop.
- His own Google steps (21.4.1) for the Classroom route; Route B (the watched folder) needs none.

#### 21.3.5 The smallest slice worth shipping first

**Usable at milestone A** (the end of the second slot after wave 6). The backend is built in the engine lane (EW7: E05, E06, E07, E08, C01) while the UI lane builds the Study screens (UW7: Y01 and Y02; UW8: Y03, X03 and the adapters AD08). The student can:
- drop text-layer PDFs and slide decks (as PDF, or `.pptx` text) on the Paper Desk or put them in the watched folder;
- get crop-first questions from rule segmentation, with tables read when present;
- accept, edit or reject them, with hand tags and the cosine `RULE` suggestions;
- confirm a blueprint, inferred from a paper or copied from the exam's pattern;
- generate a paper from the accepted questions, the existing bank and the templates;
- print the paper and its key from the browser;
- type marks per question into the existing marks loop.

**It leaves out:** OCR of scans (reports FAULT), patterns beyond "k of N", model suggestions and variants, the Exam Hall and the Marking Desk, the Readiness Ledger, Tonight and the review queue, the harvester adapters and the Classroom live connector. Their order: OCR and variants (EW8), the review queue and readiness (EW9), the harvester (EW8 and EW9), the Exam Hall and Marking Desk (UW10), the Exam Room (UW11).

#### 21.3.6 The harvester: public previous-year papers, locally

**Purpose.** Make public previous-year papers of GATE, GRE, the aptitude test of dMAT and the university's question-paper site available on the laptop, politely, with a record of where each file came from. It extends `ww_harvest.py`, which already holds the politeness rules (robots per host once a day, one request at a time, 2 to 5 seconds between requests, a User-Agent that names the project and carries no address, every page cached, never a login, never a second 403 or 429) and the licence ledger of `docs/research/question-sources.md`.

**Design.**
1. **Per-source adapter.** One small module per source (`ww_harvest_sources/<source>.py`) with a fixed interface: `name`, `rights` (`pointer` or `local copy`), `terms_note`, `index(session) -> list[Item]` (what the publisher lists), `fetch(item) -> bytes`. The adapter holds only that site's list and file layout; the framework holds every politeness rule.
2. **Manifest.** `data/bank/questions/_harvest/manifest.jsonl`: one line per fetch (source, url, fetched on, bytes, SHA-256, robots checked on, terms note, rights, local path or "pointer only"). Re-running is idempotent by hash. The manifest is the answer to "where did this file come from".
3. **Switches.** Every source is off. He switches a source on in the Library, after reading its terms note, and a local copy needs a second, separate switch. A source with no recorded terms note stays off with the reason printed.
4. **Rate and manners.** At most 1 request per 3 seconds per host (2 to 5 seconds, random), 200 requests per host per day, `robots.txt` honoured (a disallow stops that path), a conditional request when the host supports it, backoff on 429 and 503, and a stop for the day on a second 403 or 429.
5. **Manual drop-in is the fallback and the default.** A file he downloads in his browser and puts in the watched folder joins the manifest as `source: manual`, so the pipeline below is identical.
6. **Hand-off.** A fetched or dropped PDF enters the same ingest (21.3.1) as a pending paper; nothing enters the bank unreviewed.

**What is not verified.** The page structure of each site, whether each publisher's terms allow a local copy, and whether GRE publishes previous-year papers at all (it may publish only practice material, in which case that adapter lists only what the publisher offers and the rest stays manual). Each adapter is written against the real page only after he has switched that source on and read its terms; the framework (HV01) ships first, the adapters (HV02) after. The earlier rule that GATE papers are pointers only stays for a source he has not switched to a local copy.

**Needs the owner.** Each source switch and each local-copy switch; the terms note he is satisfied with; the watched folder.

#### 21.3.7 Ideas kept in reserve (exam engine)

- Oral viva: a spoken short answer, transcribed locally and self-marked.
- Two mock sets that share no family.
- A paper diff between two years of a subject, with families aligned.
- A cross-subject Quiet board for the exam season.

### 21.4 The classroom connector ("gcr" is Google Classroom)

**Findings that shape the design** (from the pages the lens opened, section Sources of the research file).
1. In Testing status, authorisations and refresh tokens of test users expire after 7 days once any scope beyond basic profile is requested. A personal client therefore needs a reconnect about weekly unless it is published (D-V3-8).
2. A Workspace administrator can block or leave "unconfigured" third-party apps ("Access blocked: your institution's administrator needs to review [app]"; `access_not_configured`, `admin_policy_enforced`). He reaches his classes from a personal account, which makes this unlikely, but the state is designed anyway (BLOCKED).
3. Drive: `drive.readonly` is a restricted scope; `drive.file` is non-sensitive but covers only files the user picks through a Picker. Attachments therefore cannot be fetched under a light scope, so the manual download into the watched folder is the main route for course material even when the API works (D-V3-7).
4. A student-side read needs only read-only scopes for courses, own coursework, own submissions, course materials and (behind its own switch) announcements. Rosters and teacher scopes are never requested.

**What this adds.**
1. One honest control, `ClassroomLink`, with five states PLANNED, WAITING, LIVE, FAULT, BLOCKED (BLOCKED is a FAULT subtype with its own copy). The label never says "connected" before a first successful read.
2. **The Manual Intake desk ships first and stands alone** (folder, paste, calendar file, and the Archive door). It needs no account.
3. Classroom items are Intake rows with a source, a state and a Take action (D-V3-9).
4. Deadlines land on the Life month as the existing "from Google" notch kind, with the words "from Classroom", never in his own counts; "turned in" is a separate outline-notch.
5. Material becomes exam-engine input only on his action: a five-step ladder LINKED, ASKED, DOWNLOADED, MATCHED, INGESTED, of which the connector can reach LINKED alone.
6. A per-course mapping to subjects (token overlap suggests, he confirms, a Trim key edits).
7. Token age is a gauge: "token day 5 of 7" while in Testing; at expiry the lamp goes WAITING with one key "Reconnect".
8. A sync log in the Console in the terminal grammar: one line per call group, counts only.
9. Disconnect and Delete are two keys with plain consequences.
10. Read-only, always. Writing planned blocks to Calendar stays in E04's separate, off-by-default switch.

#### 21.4.1 What the owner does, click by click (he does all of it; the assistant never sees a credential)

Menu labels in Google's console changed in 2025 ("Google Auth Platform" holds what used to be the OAuth consent screen). The labels below are from memory of the console and were **not verified in this session**; if one differs, the purpose of the step is stated so he can find the equivalent.

1. **Open the project.** In a browser signed in to his personal Google account, open the Google Cloud console and choose the project he created from the project picker at the top of the page.
2. **Enable three APIs.** Menu (three lines, top left) then "APIs & Services", then "Library". Search "Google Classroom API", open it, press **Enable**. Do the same for "Google Drive API" and "Google Calendar API". (The first version requests no Drive scope; enabling the API grants nothing by itself, and it is ready if he later says yes.)
3. **Set up the consent screen.** Menu then "Google Auth Platform" (or "APIs & Services" then "OAuth consent screen", which redirects there). Press **Get started**. App information: any name he likes, and his own support email (he types it in the console). Audience: choose **External**. Contact information: his own email. Agree to the policy and press **Create**.
4. **Keep it in Testing and add himself.** Under "Audience", check that Publishing status says **Testing**. Under "Test users" press **Add users** and add his own personal Google address, then **Save**. Only listed test users can sign in. The consent will show "Google hasn't verified this app", which is expected for a personal client.
5. **List the scopes (optional but tidy).** Under "Data Access" press **Add or remove scopes** and add the read-only ones below, then **Save**. The application also names them at sign-in, so skipping this step does not block it.
   - `classroom.courses.readonly`
   - `classroom.coursework.me.readonly`
   - `classroom.student-submissions.me.readonly`
   - `classroom.courseworkmaterials.readonly`
   - `classroom.announcements.readonly` (requested only if he switches announcements on)
   - `calendar.events.readonly` (for the Calendar link, E04)
   Scope names are the lens's list from Google's Classroom authorisation page; the exact calendar scopes are checked at build time.
6. **Create the client.** Under "Clients" press **Create client**. Application type: **Desktop app**. Name: anything. Press **Create**, then **Download JSON** in the dialog.
7. **Place the file.** Copy the downloaded file to `data\ww\google\client.json` inside the JARVIS project folder (create the `google` folder if it is missing). The file name must be exactly `client.json`. `data\` is git-ignored and backed up only to his own private repository. He never pastes the file's contents anywhere, and the application never prints its secret field.
8. **Sign in.** In the application, open the Connect Ladder (Console, Connections, "Google Classroom") and press **Sign in**. The system browser opens Google's page. Pick his account, press **Continue** at the "hasn't verified" warning (Advanced, then "Go to the app"), tick the permissions listed, press **Continue** then **Allow**. The browser tells him to return to the application. The application waits 5 minutes for this and shows LIVE only after a first successful read of his courses.
9. **Expect a weekly sign-in.** In Testing status the token lasts 7 days. The lamp shows "Reconnect" when it ends; nothing is lost. He may instead publish the client to production (status "In production", still unverified); whether that removes the 7-day limit is **not verified** (Q-V3-3).
10. **If Google blocks it.** On `access_blocked` or an administrator message the application shows the BLOCKED copy and offers the Manual Intake desk, which gives most of the value.

#### 21.4.2 Screens

**S1. The Connect Ladder** (opens from `ww.gcr`, the Console Connections row and the Google lamp on `day.month`). A 760 x 640 panel centred over the dimmed shell. Left rail 220 px: the five steps as a vertical ladder, 56 px rows with a `SigilFrame` rule line between them: (1) "Create a Google Cloud project" (done by him), (2) "Set up the consent screen as External, add yourself as a test user", (3) "Enable the Classroom, Drive and Calendar APIs and create a Desktop client", (4) "Place the client file here" (the only file the application reads; shows present or absent), (5) "Sign in in your browser". Each step shows its own lamp: PLANNED until reached, WAITING while it waits for him, LIVE when verified by a harmless call. Step 5 shows the loopback listener countdown. Centre 520 px: the current step's text (at most 70 words), one primary key (44 px) and a "What this reads" strip listing the scopes in plain words ("your classes", "your coursework and due dates", "whether you turned in", "teacher materials", "announcements"), each with a hollow lock glyph. Foot 56 px: "Nothing leaves this computer except calls to Google. You can disconnect any time." and the token-age line. Mobile: the phone does not run the flow; the sheet says "Do this on the computer" and shows the lamp read-only. Keys: Tab follows the ladder; Enter opens a step; "Open Google Cloud" opens the system browser; Esc closes without changing state. Motion: the ladder draws the finished step's rule line over 160 ms; the listener countdown is a `DotTimer` of 5 minutes, one dot per 30 seconds (static: "4:30 left"). Art: C04-18 corner brackets and C04-113 as a 40 px border strip (duotone, cybersigil; the crops were not opened). WAITING (listener open): "Waiting for you in the browser. 3:10 left." with Cancel; after timeout the state returns to the step, not to a fault. BLOCKED copy: "Your account's administrator has not approved this app. You can ask the administrator to approve it, or use the Manual Intake desk, which gives most of the value." Two keys: "Copy the request text" (names the client id and the read-only scopes and nothing else about him) and "Open Manual Intake".

**Improvement written by the critic (14 Nov; this was one of the three weakest screens: five coarse rungs hide the ten clicks of 21.4.1, and the application cannot see inside his browser, so a rung would turn LIVE on faith).** (1) Each rung expands in place into its own 44 px sub-checklist taken from 21.4.1 (rung 2 has four lines: Get started, External, Testing, add yourself as a test user; rung 3 has three: the three APIs; the Desktop client is its own line), each line with a hollow checkbox that **he** ticks ("I did this"; stored locally, never read as proof) and an "Open this page" key that opens the matching Google page in the system browser (the console URL of each page is built from the project id he types once, shown as text; the exact URLs are not verified in this session). (2) Rung 4 does one real check without reading any secret: it opens `data/ww/google/client.json`, parses it in memory and reports only three booleans, "file present", "type is Desktop (`installed`)" or "type is Web (wrong: create a Desktop client)", and "has a client id"; the secret field is never read into the UI. (3) A rung is LIVE only when a harmless API call succeeded, never because the box is ticked; a ticked box with no proof shows a half disc "ticked by you". (4) One line at the top, always visible: "About 10 minutes, once. Weekly after that." with the number of unticked lines left ("7 of 10 left"), which is a count, not a bar. Test: a fixture `client.json` of the Web type shows the wrong-type line; ticking every box with no client file leaves the Ladder at WAITING.

**S2. The Link Lamp row** (`console.connections`). A 1230 x 72 row: `LinkLamp`, "Google Classroom", and three readings: Token ("day 5 of 7" with a 7-dot `DotTimer`), Last sync ("14:02, 6 courses, 41 items") and Next ("at most 4 a day"). Keys: Sync now (`s` when the row has focus), Reconnect (WAITING or FAULT only), Disconnect, Delete. A failed call shows FAULT with the one-line cause (network, token expired, blocked, quota). Static form: dots and words, no pulse.

**S3. Course Mapper** (a popover 520 x 420 from a Trim key in the Study library header, and the Ladder after step 5). One 56 px `CourseMapRow` per course: the course name left (truncated at 36 characters, full name on focus), a `DetentRack` of subjects right, a "from Classroom" notch, a per-course switch "auto-accept new items" (off) and "pull announcements" (off). Empty: "No classes read yet." with the lamp state. Mobile: stacked rows, the dropdown a bottom sheet.

**S4. The Intake ledger** (`study.library`, tab "Classroom"; the same component serves the Manual desk). Box 1230 x 612. Head 52 px: source filter (`Rocker` All, Classroom, Manual), the lamp, a count line ("11 new"), Sync now, and a Manual key opening S6. Table 860 x 548 (`LedgerTable`, 44 px rows, 11 visible): kind glyph (coursework, material, announcement), title, subject, due or posted date, source chip (`Classroom`, `Folder`, `Pasted`, `.ics`, `Archive`), state (NEW, ACCEPTED, DECLINED, DONE-BY-GOOGLE), attachments with their ladder. Detail 354 x 548: title, the first 300 characters of the description, the due date as local time (the original UTC value on hover), the `AttachmentLadder`, and keys Accept, Decline, Open in Classroom, Open in Drive. Keys: arrows, Enter, `a`, `d`, `o`, `x`, Shift+arrows for a batch Accept, Undo for ten seconds. Attachment actions: "I will download it" marks ASKED and opens the Drive link in the browser; he saves the file into the watched folder; the folder watch then offers MATCHED. **No key fetches the file for him.** Lamps: Classroom rows are LIVE only while the last sync succeeded, otherwise WAITING with "last read 12 Nov"; pasted and dropped rows are LIVE; bench fixtures are SIMULATED. Motion: new rows seat with a 40 ms stagger capped at 8 (static: none). Mobile: 358 px cards, the detail a bottom sheet. Empty (PLANNED): "Classroom is not linked. Drop a folder, paste a list or import a calendar below." WAITING after token expiry: rows stay, banner "Showing what was read on 8 Nov. Reconnect to refresh." Art: C02-46 for the Accept and Decline keys; the orrery C04-21 is not used here, to keep this screen quiet.

**Improvement written by the critic (14 Nov; the second of the three weakest screens: an 11-row table of equal rows with a three-key detail is a chore queue, and 40 new items after a long weekend would be 40 decisions).** (1) Default order is by due date, grouped under three header rows in the table's own type, "Due this week", "Later" and "No date", each with its count, so the first screenful is what matters first. (2) One batch key per mapped course: "Accept all coursework from this course" (`Shift+A` on a course header), with the ten-second Undo, because a mapped course is already his decision; unmapped courses show a header "Map this course first" that opens the Course Mapper instead. (3) Rows he has seen and left alone for 14 days fold into one line, "6 older items, not accepted" (count only, no fault wording), never deleted. (4) The detail pane puts "Plan a block" next to Accept, so accepting a deadline and giving it a time is one flow ("Accept and plan" `Enter`, "Accept" `a`). Test: with 40 NEW fixture rows in two courses (one mapped) the first screen shows no more than 11 rows under at most 3 headers, and one `Shift+A` accepts the mapped course's rows only.

**S5. Deadlines on the calendar.** Accepted coursework rows with a due date draw in the `day.month` cell as the notch mark: an outline notch if not turned in, a filled notch if Classroom reports TURNED_IN or RETURNED. The tooltip names course, title and local due time and says "from Classroom". The Day drawer gains a fourth fold, **From Classroom**, with "Open in Classroom" and "Plan a block" (a hollow planned block of his own, linked by id; marking his own work done is a separate tap). `day.today` "Due soon" lists the next three items with the words "from Classroom". Late and graded states appear only as Classroom reports them, in words ("Classroom says: returned"); the `assignedGrade` field is not read into the UI (Q-C6).

**S6. The Manual Intake desk** (a mode of S4; the full product with no API). Four doors in a row, each 300 x 280, plus a drop target:
1. **Folder.** "Download your Classroom files and drop the folder here"; the folder watch (E05) is WAITING until a folder is chosen and lists new files as Intake rows with source `Folder`.
2. **Paste.** A `TermWell` text well: paste lines such as "Maths Assignment 3 - due 18 Nov 5pm". A live preview table shows the reading before anything is saved; unparseable lines are listed, not guessed.
3. **Calendar file.** Drop an `.ics`; a preview table shows each event (title, start, end, whether it repeats) with a tick to keep.
4. **Archive.** Drop a Classroom export `.zip` that he made himself: the files it holds are listed before anything is queued, and each is queued PENDING (E17; whether attachments owned by others are in the export is unverified).

Keyboard: each door is one tab stop; Enter opens the picker; `Ctrl+V` in the Paste well parses. Mobile: paste and a file picker only. Previews have no animation.

**S7. Sync log** (`console.connections`, a `TermWell` 600 x 260, 12 lines visible, newest on top, mono 12 px): `14:02 courses 6 ok . coursework 41 ok (3 new) . materials 12 ok . 612 ms`. Errors are a single `!` line with the cause. A Copy key exports the lines as plain text (no item content). The log never animates.

**S8. Disconnect and Delete sheet** (480 x 360). Left: counts that would go ("41 coursework rows, 12 materials, 3 downloaded files, 1 token"). Right: **Disconnect** (revoke the token, keep rows) and **Delete everything** (revoke, remove rows, remove files the application downloaded or moved, never files he put in his own folders). The Delete key is held for 1.2 seconds with a `DotTimer` (static form: a two-step confirm). After it the lamp returns to PLANNED, Classroom rows are gone and manual rows stay.

#### 21.4.3 Logic and data

**Storage** (the field lists below are the contract; JSONL under the data folder by default, SQLite allowed, per the note in 21.3.3; nothing tracked): `gcr_courses` (course id, name, section, mapped subject, switches), `gcr_items` (key `gcr:<courseId>:<workId>`, kind, title, description, due UTC, due local, state, updated, submission state), `gcr_materials` (item key, kind drive, youtube, link or form; title; link; ladder stage; matched file path), `intake_events` (source, raw text hash, time), `gcr_sync_log` (time, call group, count, ms, ok). The token lives in the credential store (`keyring`) only.

**Auth flow** (loopback, PKCE, through `google-auth-oauthlib`):
1. The application reads `data/ww/google/client.json` in memory (client id and secret are never logged).
2. It starts a listener on `127.0.0.1` on a random free port for 5 minutes, with a PKCE verifier and challenge and a random `state`.
3. It opens the system browser to the consent URL with the read-only scopes and `access_type=offline`.
4. On the redirect it checks `state`, exchanges the code, stores the refresh token in the credential store, discards the code, and shows LIVE only after a successful `courses.list`.
5. `invalid_grant` gives WAITING with "Reconnect"; `admin_policy_enforced` or `access_not_configured` gives BLOCKED.

**Sync (counting and rules only).**
1. Runs on application start if the last sync is more than 6 hours old, on Sync now, and at most 4 times a day while the application runs.
2. `courses.list` for ACTIVE courses; courses mapped to "ignore" are skipped.
3. Per course: `courseWork.list` (published), `courseWorkMaterials.list`, and `studentSubmissions.list` with `me` for coursework; announcements only if the course switch is on. Page through `nextPageToken`.
4. Upsert by key; compare `updateTime`; a `DELETED` state removes the row and its calendar mark but keeps his own planned blocks (unlinked, with "Classroom removed this item").
5. Due dates convert from UTC to local time; a due date without a time shows as a date, not as midnight.
6. About 3 calls per course, so 20 to 25 calls per sync for 6 courses, far below the documented limits (1,200 per user per minute, 3,000 per client per minute). `RESOURCE_EXHAUSTED` backs off exponentially, 3 tries.
7. One log line per call group; titles and text are never logged.

**Mapping.** Normalise course and subject names (lowercase, strip punctuation and stop words), score by token Jaccard; 0.6 or more is "suggested", below is "unmapped". His confirmation is stored and never overwritten by a later sync.

**Material ladder.** LINKED (a link exists), ASKED (he pressed "I will download it"), DOWNLOADED (a new file in the watched folder after ASKED), MATCHED (file-name tokens overlap the attachment title at 0.8 Jaccard or more, or the same extension and name stem), INGESTED (the question engine read it). An unmatched file stays an unmatched Intake row that he pairs by hand.

**Parsers (rules, stdlib).** Paste: line patterns for a title, a date (`18 Nov`, `18/11`, `Nov 18`, weekday words) and an optional time; ambiguous dates (`03/04`) are shown both ways and need a tap. `.ics`: unfold lines (RFC 5545), read `VEVENT` fields `SUMMARY`, `DTSTART`, `DTEND`, `RRULE` (weekly and daily expanded for 120 days, anything else listed as "repeats, not expanded"), convert `Z` and `TZID`. 40 test cases for each parser, including a time-zone shift and an all-day event.

**What a local model drafts.** Nothing is required. Optionally (off by default, labelled "drafted by the local model") it rewords a long announcement into one line. It never classifies, grades or schedules.

**Ethics and claims.** No grade, rank or comparison with classmates; rosters never requested; the connector says what Classroom reports, not what it means ("Classroom says: late"). No streak or urgency colouring: a due item is a notch, not a red alarm.

#### 21.4.4 Ideas kept in reserve (connector)

A Google Takeout reader; a Picker-based `drive.file` fetch of one attachment at a time; publishing the client to production to avoid the weekly sign-in; a Calendar-only mode that reads due dates from the Calendar scope; a phone share-sheet receiver; a weekly digest line on Today ("3 due, 2 new materials"); course "orbits" (C04-21) on the Course Mapper; teacher announcements rendered as ASCII plates; a local model that proposes the subject map (rules first, kept off).


### 21.5 The dashboards

Boxes assume the content box of 1302 x 720 at 1366x768 (rail 64, title bar 48); the JARVIS box is 1286 x 652. All follow Specimen and Datum (20.5.1): one specimen, one datum line, at most five 88 px Callouts, a 72 px footer. No bento, and no two equal stat tiles in a row.

**What this adds.**
1. Six dashboards in one grammar: Today (the Well Wisher home), Exam Season, Week Review, Month Review, JARVIS Core home, System (Console), plus the Deck that joins the two products (D-V3-16).
2. **Today keeps the Day Arc of 20.16.1 as its specimen** and becomes a command deck by adding a Next Three card, a hand-off key and countdown dots in the margin. It adds no second chart.
3. **Exam Season replaces the Today specimen when the student sets an exam window** (a switch, never automatic). The specimen is the `CoverageRose`, one `SigilMark` per subject with arms for units. Days left is shown as `CountdownDots`: one dot per day, a count that does not tick, no red, no bar filling toward zero.
4. **Week and Month Reviews are postcards**, each with a Legend flip side (the idea comes from the Dear Data postcards, via search snippets only) that explains every mark. A review records what was done, with his own previous week as the only comparison.
5. **The Deck is one 1302 x 720 sheet**, two halves joined by a datum, with three hand-off keys in the centre column.
6. **A dashboard never invents**: with no data each draws its Hollow form (dashed, an ASCII empty state, one sentence, one action).
7. **Next Three is arithmetic first**: a pure function ranks three actions from weak units, due items and free slots; a local model may reword the sentence and never chooses or scores.
8. **No urgency theatre.** Days left appears once, as a number and dots, in the Ahead callout and the Exam header. Banned in dashboards: red fills, pulsing, shrinking bars, "only N days", streak counts, any pass probability.
9. **Light.** SVG and CSS only; the only canvas is the existing Ridge in Core; zero idle loops; every motion has a static form; two new component families are lazy-loaded behind the product gate so the Well Wisher build adds no JARVIS modules.

**Shared rule for all screens.** The footer holds three telemetry readouts (each with a lamp) and one accent Key. Callout leaders bend once at 45 degrees. Keyboard: the specimen is one composite (roving focus, arrows move between marks, Enter opens the drawer, Esc closes); Callouts are a `Tab` list; `?` flips the Legend. Targets 44 px, a 2 px focus ring; forced colours use outline shapes (disc, ring, dashed, half disc, triangle map to the five lamps by shape, not colour).

#### 21.5.1 Today (`day.today`, the Well Wisher home)

Purpose: show today as one instrument and the next thing that matters. The specimen, datum, four Callouts and footer of 20.16.1 govern; 21 adds three things.

Data and lamps: class blocks, planned blocks and done blocks (the local timetable and block log, LIVE when entered today, WAITING "last entered 9 days ago" otherwise); minutes studied (the Odometer hero, block log, LIVE; SIMULATED never used here); the seven-day Trace and his own median; Next Three (the generator and checker once they exist, PLANNED until then, otherwise WAITING "needs papers on file"); calendar notches (the Google Calendar adapter, PLANNED until he connects it, read-only); Classroom due items (PLANNED until connected, then LIVE with "synced 14:02").

Layout (1302 x 720): specimen 760 x 560 at x = 24; margin 470 at x = 808 with four Callouts (Now, Ahead, Counters, Reminders) of 88 px, then a fifth, **Hand-off**, of 88 px; footer 72 at y = 648.
- **Ahead** gains a row of `CountdownDots` (at most 60 dots, one per day to the nearest dated item, 8 px; a dot fills as a day is lived and never refills) and the Next Three list inside the drawer it opens, not in the callout.
- **Hand-off** (the fifth callout): one line, two keys. `Open Exam Season` appears only when an exam window exists; `Ask JARVIS` opens the Deck.
- **Footer:** the Capture Line (`ww>`) on the left, the Plan key on the right.

Mobile: a vertical spine, Now first, then the arc at 100 percent width 320 px high, then Ahead, Next Three, Counters, Reminders and Hand-off as a three-card swipe; the Capture Line docked. Keys: `n` starts a block, `Ctrl+Space` the Capture Line, `3` opens the Next Three drawer, `H` the hand-off. Motion: the notch at now steps once a minute; nothing else moves; static and reduced-motion: the arc drawn, the notch at the render time. Art: `art.day.sun` (private track, duotone ochre and charcoal) behind the arc at 12 percent; the Odometer corner uses C04-123 (numerals lotus), Atkinson-dithered, 200 x 200, behind the counters only; a plain placeholder on the default track. Empty or waiting: no classes, the arc is dashed and Now says "Add today's classes" with one key; no exam window, Ahead shows the next dated item or "nothing dated"; no data anywhere, the Odometer shows four dashed wells and a WAITING half disc.

#### 21.5.2 Exam Season (a mode of `day.today`, and a hand-off into the Exam Room face of `study.plan`)

Purpose: per subject, how much is covered, how much is practised, which units are weak, the next three actions and the days left. It states evidence, never a forecast.

Data and lamps: coverage per unit (papers and syllabus on file, tagged units; LIVE when the unit list was entered or ingested, WAITING "no syllabus on file" otherwise); practice done (question-store attempts in the last 30 days, LIVE); weak units (the lowest first-try correct share in his own history, at least 5 attempts to count; below that the unit shows a dashed ring and "thin evidence"); Next three (PLANNED until the generator exists, a WAITING card meanwhile); days left (from dates he entered, LIVE).

Layout: the specimen 760 x 560 holds the **CoverageRose**: up to 8 subjects as `SigilMark` figures in a 4 x 2 arrangement, each 170 x 250; arm length is evidence, a tip disc if practised in the last 7 days, a ring if not, a dashed ring if never (existing `SigilMark` states). A shared datum at y = 288 crosses all eight hubs. One subject is *selected* and enlarges to 340 x 340 by swapping with the neighbour pair (a layout swap, no animation), showing unit names in mono at the arm ends. Margin 470, five Callouts: **Subject** (name, `covered 14 of 22 units`, `practised 9 of 22`), **Weak units** (three names with dashed or solid rings and the attempt count), **Next three** (three short sentences, a Start key on the first), **Days left** (`CountdownDots` for the selected subject's exam, the number once in mono) and **Paper desk** (last paper opened, attempts, the Review Desk key, and the paper strip: each paper as a 44 px chip with a date, hours of free gap before it and a count of prepared topics, counts only; the sleep floor appears as a quiet detent only if he set one). Footer: `practice 30 d | papers on file | last checked`; one Key, `Start the first action`. Forbidden: a countdown below one hour, red, "behind", pass chance.

Mobile: a subject picker (`DetentRack` as a bottom sheet), one enlarged SigilMark 320 px high, then Callouts as swipe cards. Keys: arrows between subjects, Enter selects, `U` jumps to the weakest unit's drawer, `Tab` moves to the margin. Motion: none; the selected swap is instant. Art: the ground is the Study contour, C04-23 re-derived at 6 percent; SigilMark arms use the C03-03 line style for the constellation links (private track). Empty or waiting: no subjects, eight dashed hubs and an ASCII empty state of 14 lines (the C04-119 branch) with `Add subjects` as the one key; subjects but no papers, arms dashed and Next three WAITING "needs papers on file"; Classroom not connected, the Paper desk callout shows a PLANNED plate "Classroom link not connected" that opens the honest explanation.

#### 21.5.3 Week Review (`day.week`)

Purpose: one postcard for the week, made by arithmetic from the logs and kept by the student. Data and lamps: the block log, counters, attendance, sleep-window and spending logs (only the logs he turned on); each part LIVE when logged that week, WAITING when not.

Layout: the specimen 760 x 560 is the **WeekStrata**: seven columns (Mon to Sun), each a stack of strata: study (solid layers, one per block, height = minutes), classes (hollow), body log (a dotted band, only if enabled), spending (a thin ledger line, only if enabled). A faint ghost of the previous week behind each column (hairline, 40 percent opacity) is the only comparison. The datum at y = 288 marks his own median minutes. Margin, five Callouts: **Kept** (`5 of 7 days kept`, a ratio from SkyLedger logic), **Best block** (the longest unbroken block with its subject and date), **Moved** (a `Dumbbell` of this week against last for minutes, practice questions and attendance margin; before ring, after disc), **Left over** (items planned and not done, listed without fault wording, with a `Carry to next week` key) and **Note** (one sentence he writes; a local model may draft a neutral summary into this box, marked DRAFT until he accepts). Footer: `Save to Almanac` and `Export postcard` (an SVG of the specimen for his own use, serialised natively).

Legend flip (`?`): the specimen turns over (an instant swap) to a plate listing every mark and its source lamp. Mobile: columns become a 7-row horizontal ledger (one day per row, an ASCII bar), callouts as a swipe carousel. Motion: the strata draw once in 320 ms, staggered by column, capped at 7 (static: drawn). Art: C02-13 wave ribbon at 4 percent as texture; C04-35 as the ruler. Empty: seven dashed columns, `Nothing logged this week` and one action `Log a block`.

#### 21.5.4 Month Review (`day.month` review mode)

Purpose: the month as a sky, with the habits he chose. Data: the SkyLedger (60 or 90 days) extended to a 5 x 7 month with week rows; days from the Almanac; a lamp per day (LIVE logged, WAITING untouched). Layout: the specimen 760 x 560 is the **MonthSky**: 35 cells of 100 x 80 as stars (kept disc, rest half moon, untouched faint dot), constellation hairlines joining days that share a habit (a pure function); under it the datum with a `Trace` of weekly minutes (4 points and the median). Margin: **Kept** (`19 of the last 30 days kept`), **Habits** (each habit's count, as a `Jar` strip if he set a limit, otherwise dots), **Spend** (a `LedgerTape` of the month's total, only if the spending log is on), **Exams** (countdown dots for dated items inside the month) and **Next month** (three suggested carries, each accepted by him). Footer: `Open Almanac`. Honesty: no chain wording; deleting a day lowers the count; no habit line claims a health effect. Mobile: a 7-wide sky at 100 percent, 5 rows, callouts as cards. Empty: 35 faint dots and `Start with one day`.

#### 21.5.5 JARVIS Core home (`core.talk`, the rebuilt Core) at a glance

Governed by 20.9.1; 21 adds the **at a glance strip** so Core is also the home dashboard. In the 1286 x 652 box: the left column 720 holds the voice stage (hill and SigilRing, 720 x 360) and the PipelineRibbon strip 720 x 88; the remainder 720 x 204 is the last turns. The right column 546 holds five Callouts of 88 px: **Health** (organ lamps from the Console report: voice, listen, speak, memory, board), **Room** (channels on, last confirmed time, from the board report), **Senses** (one presence word with source and age; WAITING if the link is silent), **Memory** (facts stored, last write) and **Jobs** (running and failed counts). Every row carries a three-letter tag `[HEA]`, `[ROM]`, `[SEN]`, `[MEM]`, `[SYS]` and a lamp. Footer: the telemetry rail and the Wake key. Mobile: stage first, ribbon, then callouts as swipe cards. Empty: core off, a ring of hollow ticks, hollow ribbon nodes, the strip says OFF, and callouts show WAITING with the age of the last report.

#### 21.5.6 System dashboard (a face of `console.health`; the Console is at its five-view maximum, so there is no view `console.system`)

Purpose: the whole system in one view, trust first. Layout (1286 x 652): left a **SystemRack** of 12 `RackRow` units (44 px each) in a column 640 high: voice, listen, memory store, question store, folder watch, reminder delivery, calendar link, classroom link, board, signal link, relays group, local model. To its right the specimen, a **StrataCore of system layers** (not mastery): hardware, links, services, data, each a band whose height is the count of units reporting in the last 5 minutes over the units expected. Margin: **Jobs** (queue length, last failure with its reason, a `LedgerTable` of 5 rows in a drawer), **Storage** (data folder size, last backup age, text only), **Devices** (relay board, the signal link, phones as transmitters, each with last-seen), **Models** (local model loaded, size) and **Privacy** (one line "network off" or the list of opt-in links that are on). A confirmed lamp appears only after a report; unreported units are UNCONFIRMED half discs. "Units expected" comes from the planned-feature registry; "reporting" means a report within 5 minutes. Mobile: RackRows as a single column list, the bands above as a 4-row stack. Empty: all rows PLANNED or WAITING; the bands are dashed.

#### 21.5.7 The Deck (`deck.home`, a cross-product sheet)

Purpose: both products at a glance, and hand-offs. Reached from the title bar's product switch or `Ctrl+Shift+D`. Layout (1302 x 720): a vertical datum at x = 651. Left half 640: a Well Wisher mini-specimen, a 300 x 300 Day Arc (read-only), then Next Three and days left. Right half 640: a 300 x 300 Core ring with the SigilBezel, then the system health line and the five organ lamps. Centre column 70: three hand-off keys stacked, 44 px each, in mono: `ww> exam run`, `J> remind me` (opens the Capture Line with the grammar prefilled), `J> room` (opens room channels). Footer 72: the Capture Line spanning both products with a grammar switch `ww>` and `remember>`. Hand-off rules: a hand-off only opens a view with context and never executes (a room action still needs its own press, a reminder still needs Enter); Back returns to the Deck. Mobile: two stacked cards with a swipe between, hand-off keys under each. Empty: both halves hollow; the one key says `Set up the day`. The Deck is reached by a palette place `deck.home` registered by glob; it is not one of the 36 views (like `app.new`).

#### 21.5.8 Phone forms (reserve, DB10)

The phone page serves four stripped forms (390 px): `Today` (Now card, three counters, Capture Line, Ahead), `Exam` (subject picker, Next three, days-left dots), `Week` (7-row ledger, Kept) and `Deck` (two cards, hand-off keys). No chart is wider than the screen; the Legend flip is a bottom sheet. The phone page is a LAN surface already in the product; no opt-in to anything beyond it is added.

#### 21.5.9 Logic and data of the dashboards

**Next Three (rule based).**
1. Collect candidates: units with thin evidence in subjects with a dated exam; unfinished planned blocks; due items from Classroom when linked; one review item whose spaced-review date has passed.
2. Score by integer rules: lowest first-try share with at least 5 attempts +3; due within 14 days +2; never practised +2; carried over twice +1. The scores are shown on focus in mono.
3. Take the top three with at most one per subject; ties break by the earlier due date, then by id.
4. Each item names its reason in one line from a template ("first try 3 of 9 on unit 4"). A local model may reword the line; it never changes the order or the numbers.
5. If fewer than three exist, show fewer; never pad. The same store snapshot gives byte-identical output with the model off. (This is a different list from the gain-ranked "what to practise next" of 20.7.9, which fills the free gap; the two share the unit list and both print their terms, and the Today card shows this one while the Study card shows that one.)

**Coverage and weak units.** Coverage = units with at least one tagged question or paper section on file over the units in the syllabus. Practice = attempts in 30 days. Weak = the lowest first-try correct share with at least 5 attempts; fewer attempts draw a dashed ring.

**Days left.** From the dates he entered; the dots are a pure function of today and the target; no readiness estimate is derived.

**Week and month.** Aggregations over the append-only local log keyed by date and action id; every picture is a pure function of it, so edits and deletes move the picture. The previous-week ghost is the same function on the earlier week.

**Storage.** Local tables only (days, marks, intentions, attempts, reports). Derived art is not stored. No dashboard writes anything except Carry to next week, notes and the exam window.

**Rules versus model.** Counting, ranking, margin arithmetic and bucketing are rules. The local model drafts the week note and rewords reason lines; it never grades, scores or writes a number without a lamp.

**Consent and cost.** Google sign-in for Classroom and Calendar (browser consent, read-only, done by him); nothing else. No new library or account; Exam Season and System reuse built components.

**The smallest slice worth shipping first** (one UI wave, usable the day after it merges): Today with the Day Arc, Now, Ahead (countdown dots), Counters and Reminders and the Capture Line (L04, then DB03); Exam Season with coverage from papers entered by hand and Next Three as WAITING until the generator exists, with a manual days-left entry (DB04); the Deck with two read-only halves and the three hand-off keys (DB09). It leaves out Week and Month Reviews, the System rack and strata, the Classroom and Calendar links (PLANNED plates only), the phone forms, the Legend flip (a static text list instead) and the model-drafted note.

**Ideas kept in reserve (dashboards).** A printed week postcard as a real card in the room; an ASCII terminal-only Deck for the Console and the phone lock screen; subject sigils that are stable per subject across all views; a mid-season Dumbbell comparing first and latest paper attempts per unit; a night version of the Day Arc where the arc becomes the moon phase; the Core ring and the Day Arc in a shared 24-hour bezel; Month Review printed as a sky-map list of habits; a "season recap" book assembled from the weekly postcards; a tangible Room panel that mirrors the Deck hand-off keys.


### 21.6 The wider Well Wisher features, ranked

Section 20 already covers the planner, the Almanac, the body and ledger logs, the Paper Desk, the retention orrery, the trees and Career. What was missing is the layer that makes Well Wisher a life system, not a study tool: a term arithmetic, a reading shelf, an opportunity lookout, a weekly fold, a project bench and a few small logs that feed one shared engine. Ten sections and five views per section stay frozen, so the new screens are **desks**: full-canvas overlays (1230 x 664, a drawer layer opened by a key from an existing view, one deep, Esc closes) registered like the existing overlays, not views and not counted among the 36 (D-V3-15; the lens's question Q-H1 is answered by default, and he may still veto).

**Research basis in one paragraph.** The best tools split into four camps: planners (a calm daily ritual and shutdown step; auto-scheduling), retention engines (spaced repetition where a desired-retention setting trades recall against reviews per day), money tools (every unit of money given a job; shared costs) and habit apps (streak-based against forgiving ones). Section 20 matches the first camp's ritual and the second's engine. On engagement, the evidence that pressure reduces the benefit of gamification is secondhand, so the rule is conservative: engagement comes from a finished-feeling artifact (a drawn page, a sealed letter, a printed portfolio page) and from closure rituals, never from loss, urgency or rewards that vary.

**Ranking** (exam-season value first, ordinary-week value second; nothing ships whose honest state is only PLANNED unless it is the plate).

| Rank | Feature | Exam-season value | Ordinary-week value | Size | Scheduled |
|---|---|---|---|---|---|
| 1 | Term Ledger | very high: which papers, how much margin on attendance and internals | high | M | H01, H02, H03 (UW12, UW13, EW9) |
| 2 | Shelf (reading, notes, spaced review) | high: turns reading into recall | high | M | reserve (H06 is folded into X09) |
| 3 | Fold (weekly review, journal) | medium: a 5-minute exam-week variant | very high | S | reserve, first after the flip |
| 4 | Tide (sleep and energy self-report) | high: protects the sleep floor, shows the effect of late nights | high | S | reserve, first after the flip |
| 5 | Purse (meals and money) | medium | high | M | reserve |
| 6 | Lookout (opportunity radar) | low: parked in exam season | very high | M | reserve |
| 7 | Ease (habits to reduce) | medium | high | S | reserve |
| 8 | Workbench (projects, portfolio) | low | high | M | reserve |
| 9 | Letters and Ladder (future self) | low | medium | S | reserve |
| 10 | Tongue (languages) | low | medium | S (reuses the queue) | reserve |
| 11 | Pair table (group work) | medium (shared deadlines) | medium | S | reserve |

Season mode (a Paper strip, a quiet sleep floor) is folded into DB04 (21.5.2) and is not a separate package.

**D1. Term Ledger** (`study.term` desk, key "Term" on `study.plan`). Purpose: answer "where do I stand per course" with arithmetic he can check, and show the free margin before a threshold. Data and lamps: courses and credits (HAND, typed once per term, LIVE); attendance from the existing attendance taps (LIVE); internal marks typed by him (HAND); exam dates from the Almanac (LIVE, or WAITING "unconfirmed" with a "checked on" stamp, per D-V2-18). The threshold rules (minimum attendance percent, internal weightage) are typed by him with a source note; the application ships none; no threshold typed means the cell shows WAITING "rule not set". Layout (box 1230 x 664): left a `LedgerTable` 760 x 664, one 52 px row per course (up to 8 visible, scrolling inside the table only): course code in mono, credits as a row of dots (one dot per credit), attendance as a `Dumbbell` (attended versus required, 180 px) with the number printed at the end, internals as an `Odometer` 3-digit slot, the exam date as a `DateWheel` chip. Right 450 x 664: a **Margin** specimen (`SpecimenLayout`, one datum line): "You can miss 3 more classes in course X before the typed minimum" for the selected row, with the formula printed beneath in a `TermWell` (`missable = floor(attended / min% - held)`, terms listed), then a `SlotList` of the next three exam days with free-gap hours from the Almanac. Mobile: rows become 88 px cards in one column, the Margin specimen first, formulas in a bottom drawer. Interactions: arrows move rows; Enter opens the drawer; "What if I skip tomorrow" previews the dumbbell without writing (labelled PREVIEW); credits and rules edit through Trim keys on the row. Motion: on a data change the one changed dumbbell draws over 200 ms (static: the final drawing). Art: C01-04 as a 120 px engraved margin strip; C02-12 radial-gauge shape language for the credit ring; inked engraving, no photo. Empty: a dashed plate "Add your courses (about 2 minutes)" with a `CaptureLine`; rules missing: WAITING "rule not set", never a default.

**D2. Shelf** (`study.shelf` desk). Reading and notes with spaced review: a book, a paper or a lecture PDF becomes a row of highlights he types or pastes; each highlight can become a prompt (front and back) that enters the one review queue. Data: items (HAND, LIVE); highlights (HAND); prompts (tagged `HAND` or `MODEL`; a 4B model may reword a prompt he approves, never invent one); review state computed by the scheduler. Layout: left rail 300 x 664, the shelf as a vertical `Ridge` (one ridge per item, height = highlight count, no goal line); centre 600 x 664, the open item with a margin of highlight chips; right 330 x 664, a "Due today" `SlotList` of at most 12 prompts at 44 px and one **Review now** key (the same player as the orrery's, opened in Focus). Mobile: tabs Shelf, Item, Due. Keys: `h` adds a highlight with a page number, `p` turns it into a prompt. Motion: a new chip settles with a 120 ms opacity move. Art: C01-03 for card geometry. Empty: "Nothing on the shelf. Paste a title and a first highlight."

**D3. Fold** (`day.fold` desk, a key at the end of `day.close`). A weekly closing ritual: look at the real week, name one thing to keep and one to change, set next week's three intents. Reads the week's logs, each with its own lamp; the answers are his typed text (HAND); no number is summarised into a score. Layout: left 640 x 664, a `WeekStrip` plus a `PillarsChart` of seven life pillars (study, body, rest, money, people, craft, play), counts only (the C02-09 treatment, ink on clay); right 560 x 664, three `CaptureLine` fields "Kept", "Changed", "Next three" (each intent creating an Almanac item on save) and a 10-minute `DotTimer` that never forces anything. Keys: Tab walks fields, Ctrl+Enter saves; "Skip this week" writes nothing (no penalty, no nag). Exam variant (5 minutes): in Season mode the pillars drop and the three questions stay. Empty: dashed pillars and "No logs this week. You can still write the three questions."

**D4. Tide** (`day.tide` desk, a key on `day.body`). Self-reported sleep and energy, so he can see how a late night relates to the next day's study blocks. Bed time, wake time, energy 1 to 5 morning and evening (HAND). A `Trace` of 28 days of sleep length with energy dots on a second row (`DotHistogram`). A line compares his own days: "On days after under 6 h, afternoon energy averaged X (n = 9)"; with n below 7 it reads "too few days to show a pattern" (the rule of D-V2-15). Layout: top 1230 x 300 `Trace`; bottom left a two-key entry (a `DetentRack` for energy, 5 detents, 44 px); bottom right the pattern line in a `TermLine`. Fixed copy: "Notes you typed. Not medical advice." No sleep score, no "debt", no streak. Empty: a dashed trace, "Two nights make a first line."

**D5. Purse** (`day.purse` desk). Meals and money in one ledger; one line captures "chai 20" or "lunch 80, mess". Spend and meal rows (HAND), categories he defines (up to 12), a monthly envelope he sets per category (a soft budget with no rollover maths in the first release). `Jar` shows an envelope as a level, `Odometer` the month's spent amount, a `LedgerTape` the last 20 rows; meals appear as a second glyph on the same row (a bowl) and can be logged without a price. Layout: left 700 x 664 `LedgerTape` over `CaptureLine`; right 500 x 664 a 2 x 3 grid of `Jar`s for the six largest categories; footer an `AsciiBar` for the day's total (ASCII carries real data here, per D-V2-4). Enter saves, `u` undoes. No bank link, no import in the first release; currency is a typed symbol; group costs are not split. Empty: dashed jars with "Set a number to see a level".

**D6. Ease** (`day.ease` desk). For habits he wants to reduce (his words; the application never names them). One tap logs an occurrence; the screen shows a weekly count against a ceiling he sets and an if-then plan he wrote. Layout: left 600 x 664, one `Dumbbell` row per habit (this week's count versus the ceiling, both neutral graphite, no red zone) and a 12-week `DotHistogram`; right 600 x 664, plan cards in a `SlotList` with an "I used it" tap. `+` logs, `u` undoes, the ceiling is a Trim key. Evidence note: if-then planning has published support, but the effect size in secondary summaries fell from a 2006 pooled estimate to much smaller bias-corrected values in a 2024 re-analysis (not verified from the papers), so the screen makes no claim about results. Forbidden: streak counters, "days since", reset animations, congratulation on zero; weeks above the ceiling look identical in style to weeks below. Empty: "Name a habit you want to ease. Optional: add one if-then plan."

**D7. Lookout** (`career.lookout` desk). Near opportunities (internships, hackathons, scholarships, competitions, deadlines) from sources he adds, then preparation. Sources are a HAND list (kinds: pasted text, RSS URL, ICS URL, manual). Rows have a title, kind, deadline, eligibility notes, a "checked on" stamp and a state NEW, WATCHING, PREPARING, APPLIED, LET GO; a row with no stamp shows WAITING "unconfirmed". The network is opt-in per source and off by default. Matching to his skills is a plain keyword overlap with his tree evidence, printed as "3 of 5 listed skills evidenced" with a `RULE` chip; no score and no rank by probability. Layout: the centrepiece 780 x 664 a `SkyLedger` (time on the horizontal axis, one star per opportunity at its deadline, size by an effort estimate he types, deadlines as vertical hairlines); right 430 x 664 a `LedgerTable` of rows with a "Prepare" key that creates an intent bundle (documents to gather, a draft checklist, a study-gap check that reads the Term Ledger so an application in exam week is flagged as a fact: "falls in your exam window"). A URL source fetches only on a visible "Check now" key; robots and terms are his responsibility and the key says so. `n` new row, `w` watch, `l` let go (a row leaves, no shame copy). Art: C02-02 as a quiet 8 percent backdrop. Empty: "Add a source or paste a posting."

**D8. Workbench** (`career.bench` desk, feeds the Proof rail). Projects as bundles of evidence for the Proof rail and the Career runway. A project has a name, a one-line brief and skills claimed; evidence rows are a file path, a repository link as text or a write-up he typed, each with an add date. `StrataCore` draws a layer per evidence row; `SigilMark` is the project's deterministic sigil from its id; a `Seal` appears only with at least one evidence row. Export: one self-contained printable HTML page, generated locally, with no external URLs and no upload. Layout: left 360 project list, centre 520 strata specimen, right 350 evidence list with `RackRow`s. Empty: "A project is real when it has one file or link."

**D9. Letters and Ladder** (`tree.letters` desk). A goals ladder (this term, this year, in five years) and "future self" letters he writes now and the application shows on a date he picks. Local; no server, no email. Letters are stored plainly in `data/`, so "sealed" means hidden, not secret, and the card says so. A `DateWheel` and a ladder drawn as `Ridge` steps; the letter view is a `TermWell`; the seal opens by a 200 ms opacity change (static: the opened text).

**D10. Tongue** (`study.tongue`): word lists as prompts in the same queue (typed rows, no corpus shipped), a Trace of reviews per week, no streak, one `SlotList` of today's prompts. **D11. Pair table** (`study.pair`): local-only shared deadlines for a study group, exported as an ICS file or plain text he sends himself; no accounts, no sync, no presence; live sharing is PLANNED.

**Mobile and accessibility for all desks.** One column under 900 px; every key 44 px; a 2 px focus ring; a forced-colours form that replaces fills with outlines; each `Dumbbell`, `Jar` and `Trace` has a text table twin reachable by `t`.

**Logic and data.**
- **Storage.** All new data is local files under the private notes and data folders (JSON lines per desk), written by route files discovered by the existing glob; no new library. Every write is undoable.
- **Term arithmetic (counting, no model).** For each course `required = minPct x held`; `missable` is the largest k with `attended / (held + k) >= minPct`, that is `k = floor(attended / minPct - held)`, shown with its terms. Internals: a weighted sum of typed marks over typed weights, shown as "x of y typed so far". Nothing projects a final grade.
- **Review queue.** One module with a scheduler interface (due list, grade write-back); `fsrs` at default parameters, desired retention 0.90 shown in a Trim with its trade (higher retention means more reviews a day); cold start under about 1,000 reviews uses fixed intervals (1, 3, 7, 16, 35 days) and says "learning your pattern" (the 1,000 figure is a design heuristic from a forum, not a research result). Producers: question bank, Shelf prompts, Tongue rows, letters. A model drafts reworded prompts only when he asks; each carries `MODEL` until he edits it to `HAND`.
- **Pattern lines (counting).** Group by a condition he typed; report n; with n below 7 return "too few days"; otherwise print the mean and the interval method (Wilson 95 percent for proportions; mean with min and max otherwise).
- **Lookout matching.** The keyword set of his evidenced tree nodes intersected with the posting's keywords: "k of m". Deadline flags are a window-overlap test against exam dates.
- **Opportunity ingest.** Pasted text is parsed by rules (dates by pattern, a title line); an optional local 4B model may suggest fields, each shown as `MODEL` and needing a tap.
- **Forbidden everywhere.** Streaks, leaderboards, variable rewards, pass probabilities, "overdue" in red, medical or psychological claims.

**The smallest slice worth shipping first** (lens wave A, adjusted): `DeskFrame`, Term Ledger (with its arithmetic and store), and after the flip Fold and the Tide log with its pattern line. It needs no network, no model and no new engine, and Term Ledger plus Tide protect exam season directly. Reserve waves: B Shelf and Purse (the queue module is X09); C Lookout, Ease and Workbench; D Letters, Tongue and Pair table.

**Ideas kept in reserve.** A gap finder that proposes 25-minute study slots from the Almanac's free time (after the Term Ledger exists); lecture-to-intent (paste a syllabus, get a dated intent list); an exam-week pantry list inside Purse; a quiet-hours wind-down that only dims the UI; a one-page "term in review" printable at term end; an internship letter drafter with the local 4B model (reword only); a reading-time budget per item as a `DotTimer`; skill decay reminders on tree nodes whose evidence is over a year old (a nudge to add evidence, never a loss).

### 21.7 The wider JARVIS features, ranked

Section 20.9 is the baseline: Core, Room, Senses, Memory and Console are designed with ids frozen. This adds eight screens and two shared surfaces without adding a section, a rail entry or a fifth port. Everything lives as views, drawers or panes inside the five JARVIS sections or as palette modes. All boxes are inside the JARVIS content box, 1286 x 652 at 1366x768; no screen scrolls the document; lists scroll inside their own frame.

**What this adds.**
1. **Briefing is a drawer, not a section** (key `B`, voice "brief me"), opened from Core and from Day, built only from counted data. Every line carries a source tag and a lamp; with no source the line is absent, never filled.
2. **Scenes and routines share one grammar, "When / Only if / Then"**, as a visual rule editor in Room (`room.rules`, extended) and by voice ("when I start a focus block, turn on the desk lamp"). Voice always ends in a draft card he confirms; a rule saved by voice shows tag `[JRV]` and a confirm timestamp.
3. **Presence-driven automation is allowed only as a suggestion plus a human-set condition.** Rules may use "motion seen in the last N minutes" (a counted fact) and, after readiness, the model's band; never the words present or absent, never mains, never a reminder decision. The rule editor offers no trigger named occupancy.
4. **One Notifications hub** (`console.events` gains a "Notices" tab, and a bell drawer on every screen) holds reminders, rule firings, job results and device faults; Well Wisher writes into it through the existing `notify` port. The 4-step ladder of 20.9.6 stays the only escalation.
5. **The Devices view lists only what a relay or plug can truly measure.** Relay state (confirmed by the board) is MEASURED; run time per channel is counted from confirmations; watts and kWh stay absent unless a metering plug is added (his purchase).
6. **The phone is a companion, a remote and an optional extra transmitter** (tabs Today, Keys, Talk, Link); nothing works off the local network, and a "not on home Wi-Fi" state exists.
7. **Memory becomes a second brain with four verbs: capture, recall, fix, forget**, plus a weekly "Review what I kept" card that asks him to confirm or delete five items; every stored item has Fix and Delete; Export and Delete-all reach both products' data.
8. **The Agents console states permissions per agent** ("may do without asking", "asks first", "may never"; defaults are the strictest column); an agent with no card cannot run.
9. **System health manages models on a small GPU:** one VRAM bar (a real reading), the resident models, a loader queue and a "free GPU" verb; loading a model that does not fit shows a refusal naming the numbers, never a silent eviction.
10. **Study by voice has four fixed intents** ("quiz me", "read my plan", "start a focus block", "what is due"), each a counted lookup or a hand-off into Well Wisher; the model may reword a spoken line but never chooses an answer, marks one or states a result.

**Ranking by daily value and exam-season value** (1 = first).

| Rank | Feature | Package | Scheduled |
|---|---|---|---|
| 1 | Voice study intents | JH01 | EW10 (engine); the Core card in reserve (JH01u) |
| 2 | Briefing drawer | JH02 | reserve, first after the flip |
| 3 | Notifications hub | JH03 | EW11 (engine read model); UI in reserve (JH03u) |
| 4 | Memory second brain | JH07 | reserve |
| 5 | Routines and scenes | JH05, JH06 | reserve |
| 6 | System health and models | JH04 | EW11 (engine VRAM readings and the refusal rule); UI in reserve (JH04u) |
| 7 | Phone companion | JH08 | reserve; the revised B09 phone is scheduled |
| 8 | Agents console | JH11 | reserve |
| 9 | Devices view | JH10 | reserve |
| 10 | Presence automation | JH09 | reserve, kept thin |

**H1. Briefing drawer** (`core.brief`, palette "Brief me"). Purpose: start or end the day with one honest page, readable in 20 seconds and speakable in 40. Data and lamps: morning, today's blocks (Day, LIVE), the next two reminders (LIVE), the nearest due item and days left (counted; PLANNED when no calendar link), last night's board report ("lights off 23:41 confirmed", LIVE or WAITING), overnight job results, the three health lamps worth reading; evening, what got done as a count against the plan, tomorrow's first block, and one "carry over?" question per unfinished block with Keep, Move, Drop as equal keys. No streak, no percent-of-day score, no pass or readiness language. Layout: a 560 x 652 right drawer; a 56 px header with the date as a `DateWheel` mini and a Morning/Evening `Segmented` (chosen by clock, overridable); up to six `[BRF]`-tagged rows of 64 px (tag, one sentence, source word, lamp), from a fixed list of templates with slots, time-bound first; a 72 px foot with Read aloud (R) and Close (Esc). Mobile: a full-screen sheet; Read aloud is a 56 px key. Keys: `B` opens, `J`/`K` move rows, Enter opens the row's target through a `HandoffChip`; a row hides permanently from its own Trim. Motion: the drawer slides 160 ms (static: appears); rows never animate in sequence. Art: C04-119 ASCII branch at 8 percent as the empty backdrop; C03-01 contour for the 160 ms open. Empty: "Nothing planned today" plus "Plan today" (opens Day); board not reporting: the row reads WAITING "not tested", never "all off".

**H2. Routines and scenes** (`room.rules`, extended; palette mode `scene`). Layout: left 360 px **SceneShelf** (up to 8 scene cards of 328 x 72: name, channel targets as 8 dots, last applied time, lamp); centre 560 px **RuleCanvas** (three stacked bands "When", "Only if", "Then" holding 44 px typed chips: time, "focus block starts", "motion seen in last 10 min", "channel is on"; actions apply scene, set channel, remind, say one line); right 330 px **Rehearsal** (a counted dry run: "would fire at 22:00 on weekdays; 3 of the last 7 days the condition held", from stored events, never a forecast). Safety: an action touching a channel he marked heavy load is a `GuardKey` chip; a rule can only raise a "turn on?" notice, ON for heavy loads keeps the two acts (lift, press within 5 seconds) on a human press, and OFF is allowed from a rule. Voice builder: a closed grammar in the Rhasspy and Home Assistant sentence style (custom sentences mapped to intents), not a model, produces a dashed draft with tag `[JRV]`; Enter saves, Esc discards. Keys: arrows between chips, Enter edit, Del remove, `[` `]` reorder, `Ctrl+Z` undo (10 steps). Motion: a chip drops with 120 ms travel (static: instant); a rule that fires gets one 160 ms lamp step. Art: C04-127 logic-gate schematic as the canvas backdrop at 8 percent; C01-08 device icons on channel chips; faces, eyes and bodies refused. Empty: three SAMPLE scene cards in dashed outline; board not linked: channel chips dashed. Mobile: a single column; chips as an ordered list; Rehearsal a collapsed row.

**H3. Presence trigger panel** (inside `senses.presence`, a 510 x 120 strip under the Motion tape). A `MotionTrigger` row: "Motion seen in the last [10] min" and a count of times it held this week, with the readiness lamp (PREDICTING until the held-out day passes, then the band). Allowed actions: lamp on; lamp off after N quiet minutes (never fan, never heavy loads); a Study lights offer. Wording is "motion seen" and "no motion seen", with the caption "no motion seen is not proof of an empty room". Honest limit: one Wi-Fi link sees that a body moved, not who or how; a still, seated student reads as quiet, so an automatic lamp-off while he studies is a known failure; the panel defaults the lamp-off window to 45 minutes, shows "last motion 31 min ago" beside it, and a notice with Keep on appears one minute before anything switches off. Mobile: hidden. Without readiness the toggle is disabled and the row says PREDICTING.

**H4. Notifications hub** (`console.events` tab "Notices"; bell drawer 420 x 652). Rows are tagged `[REM]`, `[RUL]`, `[JOB]`, `[SYS]`, `[WW]`; each has a time, one sentence, a receipt lamp (spoken, shown, queued, failed) and Done, Snooze, Skip where applicable. Quiet silences sound; rows still land silently. Layout: a 44 px filter row (tag chips, the Events filter grammar reused), a list of 56 px rows, a 72 px detail strip; the same component as `ReminderChip` for the toast form. "5 unread" is a count; there is no badge animation, no red and no growing number; the bell carries one 8 px dot. Mobile: a bottom sheet. Motion: none beyond the toast's 160 ms.

**H5. Devices and energy** (`console.hardware`, extended). A `RackRow` per channel: name, state as last confirmed (LIVE with "confirmed 14:02:11"), run time today (counted from confirmed on to off intervals), switch count this week. **EnergyNote**: a fixed panel "No current sensor: power is not measured" with a PLANNED plate "Metering plug (needs an owner purchase)". If he adds a metering plug, readings appear as MEASURED watts per plug only; no whole-room estimate. A rated-wattage estimate may be drawn only in amber with the SIMULATED stamp. Art: C01-19 faceplate crop at 8 percent; C04-14 capsule for firmware identity.

**H6. Phone companion** (the phone page, tabs Today, Keys, Talk, Link). Today (358 wide): next block, two reminders with the 3 keys, due list. Keys: the eight keys in two columns with the guarded cover (a tap lifts, a second tap presses). Talk: push-to-talk, a held 56 px key, no always-listening from the phone. Link: the phone as an optional extra Wi-Fi transmitter for sensing, with its own lamp, "adds a second path, still detects motion only", and a Stop sensing key; it explains that the phone sends ordinary packets and nothing is recorded from the phone's sensors. Features need the phone on the home network; away, the card shows WAITING "not on home Wi-Fi". No remote access beyond the existing Tailscale decision.

**H7. Memory as a second brain** (`memory.recall`, `memory.keep`). A **Weekly review** card in Keep: 5 items drawn by a fixed rule (flagged Wrong first, then oldest never recalled, then a seeded random fill), each with Keep, Fix, Forget as equal keys; finishing it writes a line, not a score. **Corrections:** a "Why did it say that?" key on a Core turn opens the memory items the answer used, with Fix and Forget in place. **Source tags:** TYPED, VOICE, WW (from Well Wisher through the port), FILE. Forgetting removes the row and its index entry (and any `ww/*` mirror); the Fix history row stays 7 days then is purged; the delete confirmation names the count; a "Forget all from source" key exists per tag. Recall is keyword plus tags today; embedding search stays PLANNED and dashed.

**H8. Agents console** (`console.crew`, "Route", plus a Jobs pane; 1286 x 652). Left 420 px **AgentList** (64 px rows: tag `[AGT]`, name, state lamp, last run); centre 480 px **PermissionCard** (three columns of verbs from a closed registry such as `read plan`, `write reminder`, `switch light`, `switch heavy load`, `open network`); right 386 px **JobBoard** (the JobRow component; the fraction is real or hollow). Defaults: a new agent has everything under "Asks first" except reads of its own folder; "switch heavy load" and "open network" are locked to "May never" and cannot be moved by the agent. A local 4B model drafts and rewords; an agent that proposes an action produces a card he confirms. Agents are PLANNED until built.

**H9. System health and models** (`console.health`, extended; palette "Free GPU"). A **VRAM bar** 800 x 40 from the real reading, segmented per resident model with its size in GB and a lamp. A model table (name, role: voice, brain, embeddings or OCR, size, state resident, loading or idle-unload in N minutes, last used). A loader queue with the refusal "needs 3.1 GB, 1.4 GB free". Verbs `free gpu`, `unload <name>`, `load <name>` through the `CommandLine`. A laptop strip (plugged in or battery, disk free, temperature if the OS reports it, each with its source lamp, "not reported" otherwise). Exposing resident models (as Ollama's keep-alive does; its page did not load, so this is from memory) turns a silent slowdown into a visible, fixable state. The GPU is shared with RapidOCR (D-V3-6).

**H10. Voice-first study flows** (`core.talk`, palette mode `say`). Closed intents: `quiz me [subject]`, `read my plan`, `start a focus block [minutes]`, `what is due`, `stop`; each has a spoken template and a visible `IntentCard`. Quiz: the question text comes from the question store and is spoken once; the answer is spoken or typed; **the checker** (rules: exact, numeric tolerance, keyword set) marks it, never the model; the card shows the marking rule used; the spoken result is "matches the key" or "does not match the key, here it is", never "you will pass". Plan: read the day's three first blocks; "added to your day" only if Day's `notify` port is present. Focus: "start a focus block" hands off to Focus with a `HandoffChip`; the lamp scene is offered, not applied, unless he turned the rule on. Mobile: push-to-talk on the Talk tab. Empty: no question store, "Add questions in Study first" with a link. The grammar is a closed list compiled to regex with slots; unrecognised speech returns "I did not catch a known request" and a list of four; the model may reword one confirmation line within a template under a banned-word lint (no pass, fail-prediction, guarantee, diagnose). Whether the current speech model can spot a closed grammar reliably is unmeasured.

**Logic and data.**
- **Briefing assembly** (no model): read today's Day blocks; read reminders due in the next 12 hours; read the nearest dated item and compute days by calendar subtraction; read the board's last report (older than 10 minutes means the row is WAITING); read job results since the last briefing; fill sentence templates by slot and drop any row whose source is missing; order by time then tag. Storage: `data/ww/briefs/YYYY-MM-DD.json` (counts and ids only, private).
- **Rule engine.** Rules are rows `{when, only_if, then[], created_by, confirmed_at}`, evaluated on events (focus start, a one-minute clock tick, a motion count, a board report), never on a poll faster than 1 second. Match `when`; evaluate `only_if` against counted facts; for each action check the heavy-load flag (heavy and ON becomes a notice, not sent); send, wait up to 6 seconds for the board's confirmation, record confirmed or not confirmed; write a `[RUL]` event. Cooldown per rule 60 s; a rule may not trigger itself within 5 minutes.
- **Motion facts.** "Motion seen in last N min" is the count of stored 5-minute motion cells (20.9.8); sensing paused by him produces no value, not "no motion".
- **Agents.** A registry of verbs, each with a risk class (read, write local, device, network); a job requests a verb, the permission card decides (allow, ask with Allow once or Deny, refuse); heavy-load and network verbs default to refuse; every decision writes an `[AGT]` event.
- **GPU management.** Source: the vendor tool's memory reading and the model runner's resident list. A load is refused unless requested size plus a 0.5 GB safety margin is at most free memory; the refusal names the numbers. Idle unload after a time he sets (default 10 minutes). The 0.5 GB margin and the 45-minute lamp-off window are proposals, not measured values; they need a trial on the real laptop and room.
- **Consent and cost.** No account, consent or library is needed for H1, H2, H4, H5 (without metering), H7, H9 (using existing readings) and H10. Needs him: a metering plug (purchase), Tailscale or any remote access, the phone as transmitter (a device permission on his phone), Google Classroom or Calendar (read-only, browser consent by him), and possibly a speech model that can spot a closed grammar.

**The smallest slice worth shipping first** (after one JARVIS wave): he can say "what is due", "read my plan", "start a focus block" and "quiz me" and get a card in Core; open the Briefing drawer in the morning and evening; see all reminders and rule firings in one Notices list with receipts; and see the VRAM bar with a Free GPU verb. That is `IntentCard` with four intents, `BriefingRow` with the drawer, `NoticeRow` with the Notices tab and `VramBar`. It leaves out the visual rule editor (a list of saved scenes applied by hand), presence automation, the phone Link tab, the agent permission cards, the weekly Memory review and metering. Only the engine halves of the first and third and sixth rows are scheduled before the flip (JH01, JH03, JH04); their screens wait.

**Ideas kept in reserve (JARVIS).** A "study aloud" mode that reads a paper question and waits in silence for a set time; an evening shutdown ritual of five fixed steps on the board; a "room weather" icon from counted motion over the week; a shared-link guest mode for family (a read-only Today card); a hardware "panic" key that turns all lights off and Quiet on; spaced voice flashcards on walks through the phone; a "week review" page in the terminal grammar showing counts only; a BLE beacon on the desk to confirm the phone is at the desk (a purchase); Memory as a night-sky mode (C04-43); a wake-word sensitivity test bench.


### 21.8 The merged list of new components (props and states)

All use the built clay controls and the lamp; none adds a library; none adds a canvas. The blanket test of 20.16 (Tab stop or roving group, arrows and Enter, 2 px focus ring, 44 px hit area, reduced-motion form, forced-colours form, a text or table twin for every data drawing) applies to every row. "Pkg" is the package that builds it (Appendix A); rows marked "reserve" have no block until scheduled (21.9). Duplicates among the lenses are merged: `ClassroomShelf` and `LinkSteps` are dropped in favour of `ConnectLadder` and `ClassroomLink`; the lens's `PaperChip` lives inside DB04; `ExportImportDrop` is the Archive door of the Intake desk.

| Name | Draws | Props | States | Extends | Pkg |
|---|---|---|---|---|---|
| `CropCard` | a question crop with its text layer and chips | `img, bbox, text, textStatus, chips` | verified, unverified, crop-only, editing | `SpecimenLayout` (D05) | Y01 |
| `RubricChips` | tickable rubric points, 44 px each | `points, awarded, onToggle` | unmarked, partial, full, none | kit `Chip` | Y01 |
| `ImportTray` | the 300 x 260 route list of the Drop Slot | `routes, queued, onFiles` | idle, hover, reading, refused-type | `PaperDrop` | Y01 |
| `BlueprintTable` | section rows of a blueprint | `sections, total, duration, onChange` | balanced, fault, inferred | `LedgerTable`, `DetentRack` | X03 |
| `SlotStrip` | generator slots with source chips | `slots, onSwap, onReseed` | filled, template, model-dashed, hollow | `SlotList` | X03 |
| `VariantPair` | original against draft with a word diff | `original, draft, checks` | pending, accepted, rejected | `SpecimenLayout` | X06 |
| `PatternLoom` | topic-pair arcs | `topics, pairs, n` | live, too-few | `Trace` | X06 |
| `QuietList` | topics quiet for r papers | `items, r` | live, too-few, empty | `SlotList` | X06 |
| `PaperClock` | section ring with a tick per minute | `sections, elapsedMin` | running, paused, closed | `DotTimer` | X08 |
| `CoverageQuilt` | weighted quadtree of the syllabus | `cells, onOpen` | solid, hatched, outline, empty | new SVG; `AsciiPlate` when empty | X10 |
| `EvidenceTape` | an attempt tick per attempt, a tall one per timed paper | `attempts, papers` | live, empty | `LedgerTape` | X10 |
| `NightSheet` | one-page print | `lists, stopAt` | screen, print | print CSS | X10 |
| `ClassroomLink` | panel plus lamp row of the connector | `state, tokenAgeDays, lastSync, onAction` | PLANNED, WAITING, LIVE, FAULT, BLOCKED | `LinkLamp` (E04 UI half), `Lamp`, `DotTimer` | C08 |
| `ConnectLadder` | the five-step consent walkthrough | `steps[], current, listener` | per step PLANNED, WAITING, LIVE | `SigilFrame`, `Key` | C08 |
| `TokenAge` | a 7-dot age gauge | `days, limit` | fresh, ageing (day 6), expired | `DotTimer` | C08 |
| `SyncLog` | terminal log lines | `lines[]` | idle, new line | `TermWell`, `TermLine` | C08 |
| `DeleteSheet` | counts plus a held key | `counts, onDisconnect, onDelete` | idle, holding | `Key` | C08 |
| `CourseMapRow` | one course and its subject dropdown | `course, subjects, value, suggested` | unmapped, suggested, mapped, ignored | `DetentRack`, `SlotList` | C03 |
| `IntakeLedger` | table plus detail of arrivals | `rows, filter, onAccept` | empty, filled, waiting | `LedgerTable` | C03 |
| `AttachmentLadder` | five stations LINKED to INGESTED | `attachment, stage` | each station on or off | `Dumbbell` line style | C03 |
| `ProvenanceChip` | a notch and the source word on any row | `source` (Classroom, Folder, Pasted, ics, Archive) | one per source | `DayMark` | C03 |
| `PasteParser` | a well plus a preview table | `text, onCommit` | idle, parsed, partial | `TermWell` | C03 |
| `IcsPreview` | an event table with ticks | `events, selected` | filled, repeating-note | `LedgerTable` | C03 |
| `ExportImportDrop` | a well that takes one `.zip` and lists what it found before anything is queued | `onFile, found?` | idle, reading, found, refused-type, nothing-found | `PaperDrop` | C03 |
| `CountdownDots` | one 8 px dot per day to a date | `from, to, state, label` | live, waiting (dashed row), planned | `DotMatrixMeter` | DB01 |
| `NextThree` | three ranked actions with a reason line and a lamp | `items[], state` | live, waiting, planned | `Callout`, `SlotList` | DB01 |
| `HandoffKey` | a 44 px mono key that opens a target view with context | `to, context, label` | idle, focused | `Key` | DB01 |
| `Legend` | a flip-side plate generated from the specimen's own props | `entries[]` | shown, hidden | `Frame` | DB02 |
| `CoverageRose` | a grid of `SigilMark` figures sharing a datum, one selected and enlarged | `subjects[{id,label,arms[]}], selected, state` | live, hollow | `SigilMark`, `SpecimenLayout` | DB04 |
| `PaperChip` | a paper with date, free-gap hours and prepared count | `date, gapHours, prepared` | live, unconfirmed | `DateWheel`, `RackRow` | DB04 |
| `WeekStrata` | seven strata columns plus the ghost of the last week | `days[7], ghost[7], median, state` | live, hollow | `StrataCore`, `Trace` | DB05 |
| `MonthSky` | the month grid of SkyLedger stars with constellation links | `days[], habits[], state` | live, hollow | `SkyLedger` | DB05 |
| `CoreGlance` | five tagged Callouts for the Core home | `organs, room, senses, memory, jobs` | live, off, waiting | `Callout`, `Datum` | DB07 |
| `SystemRack` | a column of `RackRow` units with a roll-up of confirmed counts | `units[]` | live, unconfirmed | `RackRow`, `StrataCore` | DB08 |
| `DeckSheet` | the two-half layout with the centre hand-off column | `left, right, handoffs[]` | live, hollow | `SpecimenLayout` | DB09 |
| `DeskFrame` | the overlay shell of a desk: head 52 px, body 612 px, Esc, focus trap | `id, title, lamp, onClose` | open, closing, reduced | overlay layer, `SigilFrame` | H01 |
| `MarginMeter` | "you can miss N" readout with the printed formula | `attended, held, minPct, formula` | LIVE, WAITING rule, PREVIEW | `Dumbbell`, `Odometer` | H02 |
| `PillarFold` | a seven-pillar count radar, counts only | `counts, empty` | LIVE, EMPTY | `PillarsChart` | reserve |
| `CeilingBar` | a week count against a typed ceiling in neutral colours | `count, ceiling` | under, at, over (same style) | `Dumbbell` | reserve |
| `LevelJar` | an envelope level with a number, no red zone | `spent, envelope, label` | LIVE, unset | `Jar` | reserve |
| `OpportunityStar` | a star at a deadline on the sky | `deadline, effort, state` | NEW, WATCHING, PREPARING, APPLIED, LET GO, unconfirmed | `SkyLedger` | reserve |
| `EvidenceStrata` | layers per evidence row with a seal | `rows, sigilId` | none, some | `StrataCore`, `SigilMark`, `Seal` | reserve |
| `PatternLine` | one sentence with its n and a "too few" fallback | `n, text, min` | enough, too few | `TermLine` | reserve |
| `LetterSeal` | a sealed or open letter | `openOn, text` | sealed, open | `Seal` | reserve |
| `BriefingRow` | a tagged one-sentence row with source word and lamp | `tag, text, source, lamp, target` | live, waiting, hidden | `Datum`, `HandoffChip` | reserve (JH02) |
| `RuleCanvas` | three bands of typed chips | `rule, onChange, mode` | editing, preview, firing, fault | `DetentRack` | reserve (JH06) |
| `SceneCard` | an 8-dot channel summary, name, last applied | `scene, onApply` | idle, previewing, applied, unconfirmed | `RackRow` | reserve (JH05) |
| `Rehearsal` | a counted dry run with a mini `WeekStrip` | `ruleId, history` | live, empty | `WeekStrip` | reserve (JH06) |
| `MotionTrigger` | a trigger row with a readiness lamp | `window, readiness` | predicting, trusted, off | `PredictArc` | reserve (JH09) |
| `NoticeRow` | a tagged notice with a receipt lamp and 3 keys | `notice, receipt` | unread, done, snoozed, failed | `ReminderChip` | reserve (JH03u) |
| `EnergyNote` | a fixed honest panel; later MEASURED watts | `meter?` | none, measured, simulated | `Callout` | reserve (JH10) |
| `PermissionCard` | three-column verb lists | `agent, registry` | default, edited, locked | `Segmented`, `Key` | reserve (JH11) |
| `VramBar` | a segmented bar per resident model | `models, freeGb` | live, loading, refused | `RingBars` linear, `Ridge` | reserve (JH04u) |
| `WeeklyReview` | a five-card stack with equal keys | `items, onResolve` | ready, done, empty | `Callout`, `Key` | reserve (JH07) |
| `IntentCard` | a spoken-line template and its marking rule | `intent, slots, result` | heard, working, done, refused | `TermLine` | reserve (JH01u) |
| `PhoneKeys` | two-column guarded keys | `channels, guard` | idle, covered, asked, confirmed | `GuardKey` | reserve (JH08) |
| `RunwayLanes` | two lanes by slot, package chips, meet threads | `slots, packages, meets, onOpen` | idle, focused, building, blocked, empty | `LedgerTape`, `RackRow`, `Seal` | reserve (RB01) |
| `MilestoneGauge` | low, mid and high on one rule with the lamp and a basis line | `label, low, mid, high, unit, state, basis` | estimate, met, past-range (words, no red) | `Dumbbell` | reserve (RB01) |

New components that the lens text names but this table does not list are built from these.

### 21.9 What is deferred, and the reserve list

**Rule.** Packages without an Appendix A block are reserve: a block is written, from the lens detail kept in 21.3 to 21.8, when the owner schedules the wave. Reserve waves run after the flip (UW14) unless a decision here says otherwise; each costs one slot (21.2). The engine lane has slack (21.2) and may take reserve backends first, because they touch no UI file.

| Id | What | Lane | Why deferred | Trigger to schedule |
|---|---|---|---|---|
| H04, H05 | Fold and Tide desks (with `routes_ww_tide.py` as H05e) | UI and engine | ranks 3 and 4; small; need only E02 logs | first reserve wave after the flip |
| H06 (folded into X09), H07 | Shelf desk | UI | rank 2; needs the review queue | after X09 and AD10 merged |
| H08 to H11, H13 | Purse, Lookout, Ease, Workbench, Letters, Tongue, Pair table | UI and engine | ranks 5 to 11 | his call per desk |
| H12 | Season mode | UI | folded into DB04 | none |
| JH01u | Core `IntentCard` and four voice intents UI | UI | engine half JH01 is scheduled | with the first JARVIS reserve wave |
| JH02 | Briefing drawer | UI | rank 2; reads Day, reminders and the board | first JARVIS reserve wave |
| JH03u, JH04u | Notices tab and bell; VRAM bar and Free GPU | UI | engine halves JH03 and JH04 are scheduled | with JH02 |
| JH05, JH06 | Scenes shelf, rule engine, canvas and voice builder | UI and engine (`core/rules`) | rank 5; needs the guard and board reports | after the reserve wave 1 |
| JH07 | Memory weekly review and corrections | UI and engine | rank 4 | after J04 merged |
| JH08 | Phone companion tabs | UI | the revised B09 phone is scheduled; tabs follow it | with DB10 |
| JH09, JH10, JH11 | Presence trigger panel, Devices and energy, Agents console | UI and engine (`core/agents`) | ranks 8 to 10; JH09 needs readiness and a measured 45-minute window | his call |
| DB10 | Phone forms of the dashboards | UI | follows B09 | with JH08 |
| RB01, RB01e | Runway board (`app/ui/src/app/runway/**`) and its `waves.json` writer | UI | the gallery already shows progress; renamed from lens P01 to avoid the prototype block A.P01 | when he asks to see progress inside the app |
| DSH extras | WeekStrata `Legend` for Month, printed postcard | UI | after DB05 | after the first jury |
| Exam extras | Oral viva; a paper diff; two mock sets with no shared family; a cross-subject Quiet board | UI and engine | ideas in 21.3.7 | after the flip |
| Drive switch | download of attachments through a Drive scope (`drive.readonly` is restricted; `drive.file` needs a Picker) | engine | needs his yes per scope (Q-V3-2) | his decision |
| Production publish | publishing the Google client to avoid the weekly sign-in | owner | whether it removes the limit is unverified (Q-V3-3) | his decision |
| WebGL twin | retiring the Senses twin | UI | needs his yes (Q-V2-7) | his decision |
| Image generator | an online image generator with a paid account | owner | needs his account and consent (Q-V2-14) | his decision |

**Also not in the scheduled plan.** KaTeX in the print set (Q-V3-8); embedding search for Memory (stays PLANNED); any heavy-load Room channel automation from voice; Monte Carlo forecasts (after 6 measured slots); a phone push when a meet point turns LIVE; a `plan` verb in Console that prints the runway; a Playwright hard-gate pre-check before each human jury; a Classroom due date turned into an `E01` intent previewed before saving (a one-key link after E14).

### 21.10 What the engine packages extend, and where the plan can still break (critic pass, 14 Nov 2026)

Checked against `app/jarvis_app` and `core` on 14 Nov. The lenses planned new modules without reading most of the 33 existing `ww_*.py` modules (40 files with the `routes_ww_*.py` ones); this map is the correction. **Rule (D-V3-24): an engine package imports and extends the module named here; it does not write a second copy.** The Files lines of Appendix A and the last column of the EW7 table carry the same names.

| Engine package | Existing module it extends or reuses | What it adds on top, and what it must not redo |
|---|---|---|
| E05 store, folder watch | `yaadash/library.py`, `routes_library.py` (ingest of a file or folder as a background job); `ww_bank_store.py` (read only) | A review-staging Store with crops. Does not write a second folder watcher job model; does not edit the bank |
| E06 ingest | `yaadash/library.py` `extract` (PyMuPDF, python-pptx, OCR hook); `ww_harvest.py` `split_problems`, `guess_marks` | Crops, tables, segmentation by page geometry. Does not write a second `.pptx` or PDF reader |
| E07 tags, patterns | `ww_generator.py` `topic_key`, `topic_weights`, `proficiency`; `ww_mastery.py` | Families, Wilson counts, Quiet, `practise_next` |
| E08 blueprint, generator | `ww_generator.py` `generate`, `effective_pattern`, `scale_pattern`, `paper_invariants`; `ww_numericals.py`; `ww_exams.py` | A Blueprint is the exam's `pattern` plus validation and a source paper; the print set; the numeric check. Does not write a second paper generator |
| C01 intake parsers | none (new) | Pure parsers |
| C02 intake store | `ww_exams.py` (the date sheet a deadline joins on Accept), `routes_library.py` job pattern | The Intake rows and Take actions |
| X04 OCR | the OCR hook of `yaadash/library.py` | The RapidOCR engine behind that hook, shared by the Library and the paper ingest |
| X07 variants, rubric | `ww_counsel.py` (the one model caller), `ww_numericals.make` | A prompt file and the drafts; no second model client |
| E17 archive door | `yaadash/library.py` ingest queue | Zip listing and path-escape refusal |
| HV01, HV02 harvester | `ww_harvest.py` (`SOURCES`, `fetch_*`, the polite `Harvester`, its cache under `_harvest/`), `routes_ww_harvest.py`, `ww_check_harvest.py` | The manifest, the two switches, PyMuPDF through E06, adapters by registration. Does not write a second fetcher |
| C06 OAuth, C07 sync, E04 calendar | none (no Google code exists; `connect.py` only mentions Takeout) | One OAuth module that C07 and E04 import |
| X09 review queue | `ww_learning.py` (Leitner recall) | The one `fsrs` queue; `ww_learning` becomes a producer or delegates |
| E01 intents | `reminders.py` (`repeat`, `interval_min`) | Rule expansion as a pure function; hands dates to the scheduler |
| E02 logs | `ww_money.py`, `ww_body.py`, `ww_life.py` | The append-only store they read; no second budget or habit arithmetic |
| E03 reminder ladder | `reminders.py`, `routes_reminders.py`, `core/proactive.py` | Receipts, Quiet gate, wording; edits the existing module, no `ww_reminders.py` |
| E09 evidence | `ww_trees.py`, `ww_proof.py` | The store of proofs and measures that `ww_trees` reads |
| E12 career data | `ww_career.py` | The "checked on" data store |
| H03 term | `ww_attendance.py` | Courses, credits, internals; imports the margin arithmetic |
| DB11 dashboards | `ww_director.py`, `ww_insight.py`, `ww_season.py`, `ww_exams.py` | Month sky, strata inputs, Next Three scoring |
| JH01 intents | `core/agent.py`, `core/away_mode.py`, `core/hinglish.py` | Four phrases registered where intents already live |
| JH03 notices | `reminders.py` fired list, `crew/feed.py`, `core/proactive.py` | A read model with tags |
| JH04 GPU | `core/ollama_guard.py`, `core/whisper_load.py` | One "does it fit" answer that those two call |

**Merge risks the plan still carries** (what the integrator must watch; none is a plan error, each is a place two things touch one file).
1. **E05 `schema.py`** is imported by E06, E07 and E08 in the same wave, through signatures only. Risk: a TypedDict field one of them needs is missing. Mitigation: E05 defines `Topic` and a `crop` field on `QuestionDraft` (added to the table), and E05 merges first inside EW7 (a two-stage merge, its tests green before the other three are reviewed).
2. **`requirements/requirements.gpu.txt`** is edited by the first package that imports each install (the engine plan, rule 8): RapidOCR in EW8 (X04), the Google libraries and `fsrs` in EW9 (C06 and X09 in the same wave). Mitigation: the engine integrator adds every approved line in one commit at the start of each wave and no package edits the file.
3. **`ww_harvest.py`** is edited by HV01 alone (EW8); HV02 adapters register from their own modules. If HV01 and E06 both touch `pdf_text` the same week they collide: E06 exports `read_pdf_text` and HV01 only calls it.
4. **`reminders.py`** is edited by E03 (EW10) while E01 (EW9) only calls it; the app's running scheduler also lives there. A test on a scratch data directory proves the existing reminder, timer and alarm behaviour is unchanged.
5. **UI: Y01 (UW7)** is the heaviest package (eight components and sixteen ports) and every Study package after it imports its ports. A late or reshaped `StudyPort` breaks AD08, X03, X06, X08, X10 and C03; freeze the port types at its review, and change them only by a dated line in the wave comms board.
6. **UI: G05 against UW7.** UW7 imports `shared/kit` and `shared/lamp`, which G05 is rewriting; see the start condition of UW7.
7. **Both lanes: this document and the engine plan file.** Two files, two owners, one rule (D-V3-25); the plan file is edited only by the engine chat, this document only here. The board (`tools/wave_comms.py`) refuses overlapping claims in either lane, which is the live check this document cannot give.
8. **A stale worktree.** The worktree this revision was written in is 11 commits behind main on 14 Nov (the board, the checklist and the engine plan landed after it; a plain diff against main therefore shows deletions of files that exist on main); the integrator rebases before merging and commits only the two docs files.

**Coverage of the owner's request, one by one (critic check).** Refined components, buttons, shadows (G05, D-V3-19): yes. Status and a prediction (21.2, ranges only): yes, with the A and C1b arithmetic corrected. The exam generator and the connector first (D-V3-3, EW7 and AD08): yes. Dashboards (21.5, DB01 to DB11): yes. Wider features (21.6, 21.7): yes. "gcr" is Google Classroom, click by click (21.4.1), no Drive scope: yes. The four installs and where each is used (D-V3-6): PyMuPDF (E06), RapidOCR on the GPU (X04), the Google libraries and `keyring` (C06), `fsrs` (X09). His material (syllabus, assignments and internal papers in Classroom; class notes as PDFs and slide decks; public papers from the university's site): the ladder and the folder door carry the Classroom material, E06 reads decks, HV02 and the drop-in carry the public papers. The harvester for national and international papers with a per-source adapter, a manifest and drop-in: HV01 and HV02. Two lanes with their own research and plan files and a safe state file: D-V3-2. The GPU for local processing: X04 and JH04. The laptop awake: the forecast assumes it. The private backup: D-V3-23. **One item was dropped and is added here:** the class notes are also study material to read and ask questions of, not only a source of exam questions. The slide and PDF notes he drops also go to the existing Library (`routes_library.py`, "my notes, asked with citations"), from the same Intake row, so one drop gives both his question bank and a notes library; the Library is not rebuilt, and the Intake row's Take action has a "Add to my notes" key beside "Send to the paper desk" (C03 owns the key, the Library route already exists).

---

## Appendix A Implementation prompts

Order of use (revised 2026-11-12 evening): the sequence in 15.4 governs. **Start with A.B03 now**, and A.B01 beside it (disjoint files). A.R01 to A.R04, A.V01 to A.V04 and A.P01 to A.P03 run alongside the build and do not gate it. Then A.B04, A.B03b, A.B02, A.B05b, A.B03c, A.B05 (the shared foundation, most reusable layer first), then A.B06, A.B11 and A.B06b, A.B07, A.B09, A.B10 (the sections on it), A.Q01 to A.Q04 with the flag flips, A.B13, and last A.B08 and A.B12, which resume after the remap. The integrator pastes **block C** at the top of every prompt, then the WP block. Each WP block is self-contained once C is attached. **Direction v2 (13 Nov 2026):** the order of use is now the wave plan of 15.6 (waves 5 to 14); the wave blocks that follow the older blocks below replace A.B06, A.B06b, A.B11 and the customer-track gate A.Q04, fold A.B08 into A.E07 and A.E08, and keep A.B09, A.B10, A.B12 and A.B13 in waves 13 and 14. **Two lanes (14 Nov 2026):** the order of use is now the two lanes of 15.6.1 (UI waves UW6 to UW14, engine waves EW7 to EW11); the wave blocks of the two-lane plan follow A.Q04, and the Order line of each older block names its new wave.

### Block C: common rules (attach to every prompt)

1. **Read first:** `CLAUDE.md` and `AGENTS.md`; `data/notes/NOW.md` sections 1, 2 and your own; `docs/design/jarvis-product-overhaul.md` (the sections your WP names; this file); the top section "What it changed" of `docs/research/product-design-overhaul.md` and the strand your WP names.
2. **Public repository:** no names of people, institutions, places, Wi-Fi names, IPs, MACs, exam dates or chats in tracked files. Say "the owner" or "the student". Reference pictures by catalogue id only and never embed or paste them; derive or redraw.
3. **Truth rules:** no camera, no radar; one Wi-Fi link sees that a body moved, not its pose; simulated data is never shown as measured; no fake live state; no dark patterns, fake urgency, streak loss, leaderboards, variable rewards, or claims to manage, treat or screen for ADHD.
4. **Safety of the live machine:** tests use scratch data dirs (`JARVIS_DATA_DIR`, `AANKHEN_DATA_DIR`), never the real `data/`. Never build into `app/ui/dist` while `JARVIS.pyw` runs (use `vite build --outDir dist-e2e` or a clean worktree). Never open `aankhen/firmware/secrets.h`. Port 8777 is the owner's live app; use the sandbox `python -m jarvis_app.ww_sandbox` (port 8790; the script documents its own access token, which is not repeated in this public file). Restarting the app turns the relays off and flashing needs the owner's OK; ask first.
5. **Tests (run the ones your WP names):** root `.venv\Scripts\python.exe -m pytest aankhen/tests crew/tests core/tests`; from `app/`: `..\.venv\Scripts\python.exe -m pytest tests` with `JARVIS_DATA_DIR` set to a scratch folder; in `app/ui`: `npx vitest run`, `npx tsc -b`, `npm run springs:check`, `npm run bundle:check`, `npx playwright test` (or the `e2e:*` scripts); the gate `..\.venv\Scripts\python.exe -m jarvis_app.ww_check` from `app/` with a scratch `JARVIS_DATA_DIR`.
6. **Commits:** on your own branch or worktree; first person, why plus the measurement; no AI attribution or trailers; never backdate; commit per step. You never merge: the integrator merges. Before removing a worktree, check and remove the `node_modules` junction first (fsutil, then rmdir).
7. **Research record:** write or extend the named file under `docs/research/` (private: `data/notes/research/`) with a new dated section on top (`## YYYY-MM-DD: ...`): the question, findings, numbers, sources with links, and what it changed. Add one line to `docs/research/README.md` for any new file. Your final message is not the record; the file is.
8. **State:** edit only your own section of `data/notes/NOW.md`, in place, and add one log line in section 6. No handoff or task files. Commit only your own paths.
9. **Installs:** if you need a library or tool, stop and ask the owner; do not work around it.
10. **Stop rule and safety:** if a budget target fails twice, stop, record the measurement, report. There is no exam freeze (I34), but the quality mechanics stand: every risky flip sits behind a flag that defaults off, the app works at every merge (full suites green before you hand the branch over), nothing builds into `app/ui/dist` while the app runs or with a changed default without the owner's OK, and a change to a live process sits behind an env flag.
11. **Model:** Sonnet unless the WP says Opus.
12. **Report:** end with: files changed, tests run with counts, measured numbers, what is still unverified, and the research file path.
13. **Wave contract (direction v2, D-V2-22):** every builder and every reviewer of a wave receives one short table listing, per package: id, purpose in one line, folders owned, the exports it will add (names and signatures) and the exports of other packages it may import. A builder may use a not-yet-merged export of the same wave only through the contract signature; must not re-implement another package's listed export; imports single-source tables (lamp states, tokens, section ids and view ids, key bindings, art ids, the settings registry) and never copies them; touches no file outside its folders and no barrel file it does not own; adds its one gallery entry file; and ends its report with a "contract check" that names the contract exports it delivered and any signature it had to change. The wave 5 table is written out in Appendix A below.

---

### A.R01 Baseline and decisions
**Files:** `docs/research/product-design-overhaul.md` (new dated section), `docs/research/README.md`, `data/notes/NOW.md` (own lines). A scratch probe script in a scratch folder outside the repository, not in `app/`.
**Depends on:** none. **Owner limits:** read-only on all code. **Order:** alongside B03 and B01; it does not gate them (I36).
**Do:** (a) on the sandbox instance (headless; no core autostart, no Aankhen, no phone listener, so the Core and Senses pages are empty there) measure only the rows of §14.1 marked sandbox-measurable: main-thread idle CPU for 60 s, frame time and memory; label every row "sandbox-measurable" or "real-window only"; (b) with the owner's OK and a safe moment, restart the real app once with a WebView2 remote-debugging argument and repeat on the real window, including minimised; record VRAM with Whisper and the 4B model loaded together, and the CPU of VAD and wake word; (c) ask the owner for the end-semester dates and record them in the private notes only, to schedule the exam features that resume after the remap (they gate nothing here); (d) ask the open questions F7 and F8 and record the answers; (e) record who owns `app/ui/src/ww/**`, `phone_page/ww.*`, `routes_phone_ww.py`, `core/playback.py`, `core/jarvis.py`, `core/appio.py`, `jarvis/**` and `shared/**` in NOW.md section 2; (f) record the real maximised `innerWidth`, `innerHeight` and display scale and the GPU row; (g) build the egress register of §1.3.1. R01-lite is (a), (c), (d), (e) with no app restart.
**Accept:** a table of measured values replacing each target in 15.5 and written back into §3.3, §3.3.1 and §14.1; the ownership answers (and the private exam dates) in NOW.md; every number says how it was measured.
**Tests:** none to add; confirm no tracked file changed except the two docs and NOW.md.
**Record:** the new section in `product-design-overhaul.md`.

### A.R02 Voice output signal spike
**Files:** a branch of `core/playback.py` and `core/appio.py` (do not merge), research file. **Depends on:** R01 (F7 answered). **Order:** after R01, parallel with R03 and R04.
**Do:** at the point where decoded PCM is written to the speaker, compute RMS and a 24-band magnitude spectrum (the §9.2 band map), emit an `out_level` JSON line at most every 50 ms (target 20 Hz) with `rms`, `bands`, `t`. Measure the added time per 24 ms frame and the end-to-end delay to the bus.
**Accept:** microseconds per frame measured; no audible change; verdict go or no-go; event shape written in the research file.
**Tests:** `.venv\Scripts\python.exe -m pytest core/tests` green on the branch.
**Record:** `docs/research/voice.md`.

### A.R03 Hinglish retrieval A/B
**Files:** `data/notes/research/memory-retrieval.md` (private), scratch script. **Depends on:** none. **Order:** parallel with R02.
**Do:** with the owner, write 50 to 100 query and note pairs in Hinglish and English from their own notes (kept private, never committed); compare `bge-small-en-v1.5`, `multilingual-e5-small` (with `query:` and `passage:` prefixes) and BGE-M3 on recall at k = 1, 3, 5, CPU time per query and memory.
**Accept:** a table and a decision rule: switch only if recall at 3 improves by a margin the owner agrees (set before running); otherwise keep bge-small.
**Tests:** none. **Record:** private file plus one public line in `docs/research/voice.md` or the memory topic file saying a private test exists and its verdict, with no content.

### A.R04 Licence and claims register
**Files:** `docs/research/product-design-overhaul.md` (new section). **Depends on:** none. **Order:** parallel.
**Do:** read the actual LICENSE files for Silero VAD, the openWakeWord models, the FSRS library, `fsrs-rs` crate, and every font to be subset; tabulate component, licence, commercial use, action. Grep the public docs and UI strings for words in the do-not-say list (§2.5) and list hits.
**Accept:** one table with a source link per row; every unknown marked "unverified".
**Tests:** none. **Record:** as above.

### A.V01 IA, first run and resume test
**Files:** `app/ui/validate/ia-*.html` (static mocks), results in `docs/research/product-design-overhaul.md`. **Depends on:** none (it no longer waits for R01 and gates only `ww.ia`). **Owner limits:** do not touch `app/ui/src`. **Order:** alongside the foundation.
**Do:** build the mocks from §3.1, §3.1.2 and §3.4 (the section order is the reuse order; ask the owner whether it feels right, F15); check the Vite inputs exclude `app/ui/validate/`. Run five tasks with the owner: first run of each product (find the primary action), resume after a gap, switch product, name the sections, rank five real study cases with the 2.5 rule. Count taps and seconds.
**Accept:** pass lines in 15.3 (V01); results labelled "owner session, n = 1"; F1 and F5 answered.
**Tests:** `npx tsc -b` and `npm run bundle:check` still green. **Record:** research file.

### A.V02 Planned-control honesty test
**Files:** `app/ui/validate/planned-*.html`. **Depends on:** V01. **Order:** after V01.
**Do:** render 12 controls (6 live, 6 planned, from 12.6) in the four patterns; ask "is this working now?"; collect rewrites of the draft lines.
**Accept:** zero planned items judged live; approved lines saved in the research file for B02.
**Tests:** as V01. **Record:** research file.

### A.V03 Legibility and accessibility of the clay look
**Files:** `app/ui/validate/tokens-*.html`, a scratch script computing WCAG ratios. **Depends on:** none. **Order:** with V02.
**Do:** compute every pair in §6.3 (including the two "assumption, to compute" cells `--surface-sunk` dark and `--ink-2` dark); render raised and recessed controls with their 3:1 edges; check with Edge forced-colours emulation, `prefers-contrast: more`, and 200 and 400 % zoom.
**Accept:** every text pair 4.5:1, every boundary, state and focus 3:1; the computed values replace the assumption cells; a list of controls that lost their boundary in forced colours (must be empty).
**Tests:** as V01. **Record:** research file.

### A.V04 Voice hill truth test
**Files:** `app/ui/validate/hill-*.html`. **Depends on:** R01. **Order:** with V03.
**Do:** three static-plus-scripted variants: input level only, state-only, input plus output (simulated, **stamped SIMULATED**). Ask the owner to label each moment "measured" or "decoration".
**Accept:** the owner reads the no-signal ring as no signal and every stamped simulation as simulated; a chosen variant.
**Tests:** as V01. **Record:** research file.

### A.P01 Bench shell
**Files (new):** `app/ui/bench/shell-bench.html`, `app/ui/src/bench/shell/**`. **Depends on:** none (optional and non-blocking, I36; drop it if the real kit of B03b reaches the same checks first). **Owner limits:** UI chat; no edits to `Shell.tsx`, `App.tsx`, `tokens.css`. **Order:** alongside the foundation.
**Do:** build tokens (layers 1 to 3), lamp, rail (5 slots plus Ask, pair, gear, All off), title bar with product switch, view switch, PLANNED plate and chip, forced-colours layer, at 1366x768 with 1286 x 704 inside gutters.
**Accept:** no page scroll at 1366x768 and 1920x1080; all targets at least 44 px (§11.7); this bench is a throwaway and no later package depends on it; contrast table computed from the tokens in the test; keyboard walk visits every control once with a visible 2 px ring.
**Tests:** `npx vitest run`, `npx tsc -b`, a new Playwright bench spec. **Record:** `docs/research/product-design-overhaul.md`.

### A.P02 Voice hill prototype
**Files (new):** `app/ui/src/bench/voice/**`. **Depends on:** V04, R01. **Order:** after P01, parallel with P03.
**Do:** a hill drawn on one canvas (at most 720x360 CSS px, target) from a recorded frame fixture replayed through the real bus path by a sandbox `--fake-voice` mode (stamped SIMULATED; the sandbox has no live microphone path), the "no signal" state, a static form and a reduced-motion form; a probe recording p95 frame time and idle CPU; pause on `document.hidden`.
**Accept:** within the §14.1 voice-stage budgets (report-only on the sandbox until R01; absolute on the real window in Q02); no motion without a level; Pause control present.
**Tests:** vitest for the state mapping; Playwright with reduced motion asserting `document.getAnimations()` is empty. **Record:** research file.

### A.P03 Day today and Resume prototype
**Files (new):** `app/ui/src/bench/day/**`. **Depends on:** V01. **Order:** parallel with P02.
**Do:** `day.today` from real Well Wisher stores read-only on the sandbox; the Resume record `{product, section, view, object, openedAt, lastConfirmedAt}` with the stale-record rule (older than two planned block lengths shows "last seen yesterday", Pick up and Drop it, never a running timer).
**Accept:** open to running block in 2 taps; resume in 1; the stale rule has a test.
**Tests:** vitest and Playwright tap counts. **Record:** research file.

### A.B01 Seam cuts
**Files:** `app/ui/src/App.tsx`, `pages/Core.tsx`, `styles/design/primitive.css`, `scripts/bundle-budget.mjs`, `vite.config.ts`, ESLint config, new `app/ui/src/shared/` skeleton, `src/__tests__/shared/imports.test.ts`. **Depends on:** the owner's answer to X1 only (not R01's measurements). **Owner limits:** UI chat; Well Wisher chat reviews the `ww` root mount. Announce shared edits in NOW.md section 6 first. **Order:** second package of the foundation, in parallel with B03; the two touch disjoint files (B01 owns `primitive.css`, B03 never edits it). Scope is the seams S1, S2 and S4; the ports (S5) and the one navigation (S3) are in A.B05.
**Do:** delete Core's MissionCard; mount FxLayer, GameFx and Dialogs only inside the `ww` root; re-scope `primitive.css` from `.ww` to the shared layer; add `no-restricted-imports` and a vitest import-graph test; make `VITE_PRODUCT=ww|jarvis` builds; extend `bundle-budget.mjs` to check each.
**Accept:** behaviour unchanged (screenshot diff on Core and one Well Wisher view); the `ww` build has no `jarvis/` module and no three.js; the `jarvis` build has no `ww/` module.
**Tests:** `npx vitest run`, `npx tsc -b`, `npm run bundle:check`, Playwright full, the gate. **Record:** `docs/research/product-design-overhaul.md`.

### A.B02 Registry v2
**Files:** per 12.2. **Depends on:** B01 and B03b (the kit's plate and chip); V02's approved lines when available, otherwise the §12.6 draft lines stand. **Owner limits:** UI chat for `shared/**` and `jarvis/planned.ts`; Well Wisher chat for `ww/plannedFeatures.ts`, `ww/Planned.tsx` and the existing test. **Order:** foundation tier, after B03b.
**Do:** implement §12.2 to §12.6: the record, four renderers, the chip, the overlay "What is coming", migration of the 28 entries (ids and lines unchanged), the JARVIS and new Well Wisher rows with the owner-approved lines, tests T1 to T10, and the "entries past review" gate report.
**Accept:** T1 to T10 green; the 28 old assertions still pass (or are ported without weakening); loop views render no plates (T8); overlay opens one deep and returns focus.
**Tests:** `npx vitest run`, `npx tsc -b`, `npx playwright test e2e/carcass.spec.ts` plus the new planned spec, the gate. **Record:** `docs/research/well-wisher.md` (registry section).

### A.B03 Tokens, clay, forced colours
**Files:** `styles/tokens.css`, `styles/design/**`, `styles/sections/**` (new), `ww/design/themes/*` (mapping only, with the Well Wisher chat), fonts config. **Depends on:** none (V03 is not a dependency: this package's token test computes every pair itself; V03's visual checks sign it off later). **Order: first, start now**, in parallel with R01 and B01. **Files are new only:** `styles/design/clay/**`, `styles/sections/**`, `__tests__/tokens.test.ts`, the font config and the `ww/design/themes/*` mapping; never `styles/design/primitive.css` (B01's file).
**Do (additive only: new attribute-scoped files; no font is removed and no existing rule changes until B13; the font step is the last commit and waits for the owner's subsetting tool, X5, while everything before it does not):** three token layers; `clay-light` and `clay-dark` with the computed values from V03; `prefers-contrast: more`; `forced-colors: active` with real borders and `Highlight` focus; 2 px `outline` focus ring with `scroll-padding`; fonts Inter, Geist Mono and a digits-only Doto subset added (ask the owner for a font-subsetting tool first; Anton stays until B13); theme map `paper` to `clay-light`, `ash` to `clay-dark`, `indigo` kept.
**Accept:** `e2e:shots` baselines unchanged; the token test computes every pair; css-lint still forbids literal colours and durations; fonts at most 150 KB (target; record the real number); no `backdrop-filter`, no animated `box-shadow`.
**Tests:** vitest (`tokens.test.ts`, `css-lint.test.ts`), `npm run e2e:shots` with reviewed baselines, forced-colours Playwright. **Record:** research file.

### A.B03b Component kit, families A and B
**Files:** `shared/kit/**`, `jarvis/kit/**`, `ww/kit/**`, `src/__tests__/kit/**`. **Depends on:** B03, B04. **Owner limits:** UI chat; the Well Wisher chat reviews moves out of `ww/kit/`. **Order:** after B04, before B05.
**Do:** components 1 to 21 of §7.2 and §7.3 in dependency order (Lamp, Switch, Rocker, Key, Raised Pill, Readout, Numerals, Tick Slider, Segmented, Plate, then Panel, Frame, ReadoutLines, Console, Palette presentation, Toast, Telemetry Rail, Progress Bar, Dialog, Folder Tab Bar), each with the §7.1 state grammar (states, keyboard, forced colours, planned and error forms); move the 31 built kit exports to `shared/kit/` (S7) without a behaviour change.
**Accept:** each component has a states test, a keyboard test and a forced-colours screenshot; vitest count at least 1223 plus the new tests; `e2e:shots` baselines unchanged until a view adopts a component; `tools/art/check_ids.py` green.
**Tests:** vitest, tsc, Playwright forced colours, `npm run bundle:check`. **Record:** research file.

### A.B03c Component kit, families C and D, and shared art components
**Files:** `shared/art/**`, `shared/kit/**`. **Depends on:** B03b. **Order:** after B03b.
**Do:** components 22 to 38 of §7.4 and §7.5 (NodeRing, Orbit, RingBars, Ridge, Callout, Spec, DotTimer, DateWheel, PillarsChart, WeekStrip, ASCII Sweep, StippleRing, Dither, ASCII Empty State, DotMatrixMeter, CellSkeleton, PlannedPlate), each with its data-table fallback, a static form and a reduced-motion form. No WebGL, no animated shadow, no loop longer than 5 s without Pause.
**Accept:** as A.B03b; the Dot Column Timer derives columns from the planned length (at most 5).
**Tests:** as A.B03b. **Record:** research file.

### A.B04 Lamp and state contract
**Files:** `shared/lamp/**`, `lib/store.ts` (state hooks only). **Depends on:** B03. **Order:** after B03.
**Do:** the five-state lamp (glyph, label, token), the `{state, since, reason}` contract, default WAITING "no report", title-bar annunciators, and the test that fails any widget rendering a number without a state.
**Accept:** every existing reading widget takes a state; no widget can render without one; shapes distinguish all five states in greyscale.
**Tests:** vitest per widget plus the lint test; Playwright greyscale screenshot check. **Record:** research file.

### A.B05 Shell v2 behind `app.shell` (Opus: hard code)
**Files:** `components/Shell.tsx`, `App.tsx`, `lib/store.ts`, `styles/shell.css`, `components/CommandPalette.tsx`, `pageLoaders.ts`, new `shell/**`. **Depends on:** B02, B03, B03b, B04 (P01 and P03 do not gate it; R01's geometry does not gate it, build to the T720 floor). **Owner limits:** UI chat only; Well Wisher keeps `ww/frame/**` until B11. **Order:** the last package of the foundation, after B03c; no section package starts before it.
**Do:** the one navigation (seam S3: delete the eight dock tabs and the workspace strip) and the four ports with null adapters (seam S5: `voice`, `memory`, `notify`, `ambient`); title bar (48 px), rail (64 px, roving tabindex, the five slots in the §3.1.2 order: JARVIS Core, Room, Senses, Memory, Console; Well Wisher Day, Focus, Study, Tree, Career), product switch, view switch, Resume pill and record (localStorage plus the server scene memory), palette (Go, Do, Ask; planned verbs open the overlay), one binding key table that also feeds the palette hints, `data-product`, `data-section`, `data-view` on every page root, the fault chip.
**Accept:** with the flag off the app equals today's (`e2e:shots` snapshot names unchanged, tolerance 0.1 % of pixels, assumption; vitest count at least 1223, Playwright count at least 248); with it on every section reachable by keyboard; Ctrl+1 to Ctrl+5 follow the table and `keymap.test.ts` asserts the section order equals the §3.2 id table; no hint shown without a binding.
**Tests:** vitest, tsc, Playwright keyboard and hit-area specs, the gate. **Record:** `docs/research/product-design-overhaul.md`.

### A.B05b Art pipeline
**Files:** `tools/art/build_art.py`, `tools/art/recipes/**`, `tools/art/own/**`, `tools/art/{check_ids,count_assets,check_no_private_in_dist}.py`, `app/ui/src/art/**` (resolver, manifest). **Depends on:** B03. **Owner limits:** UI chat; installs need the owner's OK (PIL and numpy are already in the venv). **Order:** with B03b, before B06b.
**Do:** implement §8.5: recipes keyed by art id, the rule-based steps, the manifest with sha256 and byte sizes, the resolver by art id, both tracks and `VITE_ART_TRACK`, `--check` (determinism, byte budgets, track folders), the contrast script over the JSON placements, `check_ids.py`, `count_assets.py` (prints the §8.7 counts from the JSON) and the private-hash-in-dist check.
**Accept:** `build_art.py --check` green; the customer track resolves no private-only id; no private hash in any `dist` that leaves the machine; the counts printed equal Appendix C.
**Tests:** a pytest for the pipeline functions, vitest for the resolver. **Record:** `docs/research/product-design-overhaul.md`.

### A.B06 JARVIS sections
*Superseded in part by 15.6: replaced by A.J01 to A.J05 (waves 7 to 9); the instructions below stand where those blocks are silent.*
**Files:** `pages/{Limbs,System,Connect,Yaadash,Core}.tsx` split by view, `components/*`; Aankhen look in `pages/Aankhen.tsx` only through the Aankhen chat. **Depends on:** B05. **Order:** `console`, `room`, `memory`, `core`, `senses` (look only, last), one per PR (decision I10).
**Do:** each section fits 1286 x 704 (T768) and 1286 x 656 (T720) without scroll and declares its T720 column (§3.3.1); the wall box draws all 8 channels with absent ones "unavailable" (remove the `r.present` filter); confirm each orphan card live, or show it WAITING "built, not verified", or keep it PLANNED if it is not built (delete its entry in the commit that mounts it); delete `RelayWiring`, `BoardId 'uno'` and the not-active branch; verify the assumptions flagged in 12.6.
**Accept:** no document scroll per view; "confirmed by board" logic unchanged; every orphan either mounted with a lamp or a PLANNED entry; stale test green.
**Tests:** vitest, tsc, Playwright per section, Python tests from `app/`. **Record:** research file per section.

### A.B06b Centrepiece packages
*Superseded in part by 15.6: replaced by A.G03 (wave 5, the private track and the eleven recipes) plus the placement inside each section package.*
**Files:** per section, the art ids and components named in §8.3 and §8.4. **Depends on:** B05b, B06 (JARVIS sections) or B11 (Well Wisher sections). **Order:** one section per package, in the order of decision I10 for JARVIS.
**Do:** implement the section's centrepiece (recipe, static form, reduced-motion form, caption, data-table fallback) with its §8.3 acceptance row, plus the section's loaders and empty states from §8.4.
**Accept:** no-scroll at T768 and T720; centrepiece at least 25 % of the view and visible by default; forced-colours fallback present; growth art is a pure function of the current counts; `build_art.py --check` green.
**Tests:** vitest, Playwright per section, forced colours. **Record:** research file.

### A.B07 Voice signal and hill (Opus: cross-process)
*Status: the Python half and the voice component are merged; the section mounts the hill in A.J01 (wave 7).*
**Files:** `core/playback.py`, `core/appio.py`, `app/jarvis_app/core.py` (republish as ephemeral `core/out_level`), `lib/store.ts`, `jarvis/voice/**`. **Depends on:** B05, R02 go, F7 answered. **Owner limits:** `core/` files only as decided in X1; UI chat for the rest. **Order:** after B06 `core`.
**Do:** ship the R02 event behind the env flag `JARVIS_OUT_LEVEL` (default off) with an underrun test (P-4); it does not enter the live build until the owner restarts on purpose; store `outLevel` and `outBands`, the `VoiceHill` (one canvas, one rAF loop, stopped when hidden, idle 60 s, Pause control), the listening dot, the last-heard strip, the software Mute labelled as software.
**Accept:** the hill moves only with real levels; "no signal" ring otherwise; reduced-motion form complete; within the §14.1 budgets measured on the real window; the Core section is called done only after this package.
**Tests:** `pytest core/tests` and from `app/`; vitest for mapping; Playwright for no-signal and reduced motion. **Record:** `docs/research/voice.md`.

### A.B08 Rules and FSRS
*Superseded in part by 15.6: folded into A.E07 (Next three, patterns) and A.E08 (FSRS, generator) in wave 11.*
**Files (new):** `app/jarvis_app/ww_fsrs.py`, `ww_nextaction.py`, tests; `ww_check.py`; `ww/study/**`, `ww/life/**`. **Depends on:** B02, V01, owner OK for any library, and the UI/UX remap (B11 merged): an exam feature, it resumes after the remap (I33, I41). **Owner limits:** Well Wisher chat. **Order:** after B13, with B12.
**Do:** FSRS scheduler (defaults, retention slider 70 to 97 %, chip), a Review row; proficiency bar with n and grey below 5 (reuse the existing EWMA); the next-action card printing urgency, gap and weight with "Not this" (day-only) and "Plan by hand"; the focus-hours strip (counts, no prediction); delete the matching planned entries.
**Accept:** pure functions run twice in the gate; fixtures reproduce the owner's five cases from V01; no number without n; no prediction wording.
**Tests:** backend tests under scratch `JARVIS_DATA_DIR`, the gate, vitest, Playwright. **Record:** `docs/research/well-wisher.md`.

### A.B09 Phone
**Files:** `phone_page/{index.html,app.js,relays.*}`, `phone_page/ww.*`, `routes_phone_ww.py`, a generator script for `phone_page/tokens.css`. **Depends on:** B03, B05. **Owner limits:** UI chat for the JARVIS page, Well Wisher chat for the ww page. **Order:** after B07 (it no longer waits for B08).
**Do:** one generated tokens file; both pages light clay with the motion rule; 44 px taps; planned plates; JARVIS Senses tab lists each reading "measured" or "not measured"; the board page build and drift test unchanged.
**Accept:** one palette; the device colour table resolved once; no regression in `test_board_page.py`.
**Tests:** Python tests, Playwright phone specs. **Record:** research file.

### A.B10 Learning loops
**Files (new):** `shared/learning/**`, `settings.data` group, backend route if needed. **Depends on:** B05. **Order:** after B09, before the flips (not an exam feature).
**Do:** implement §13.7: store, consent cards (asked once), the group with Show, Export, Delete and per-loop switches, summaries that print n and window.
**Accept:** each loop off by default (except L6, L7); the local-only test and the no-long-string test pass; "Learn nothing" works; no new notifications.
**Tests:** vitest, Playwright, a network-trace assertion on the sandbox. **Record:** research file.

### A.B11 Well Wisher section map v2 behind `ww.ia`
*Superseded in part by 15.6: replaced by A.L01 to A.L03, A.Y01 to A.Y03 and A.T01, A.T02 (waves 7 to 9); the section order of 3.1.2 stands.*
**Files:** `ww/**`, `ww/frame/**`. **Depends on:** B05 only (no exam wait, no B08). **Owner limits:** Well Wisher chat delivers a branch; the integrator merges. **Order:** right after B06 (JARVIS sections), built behind `ww.ia` with the flag off; the flip happens after Q01 (and Q02, Q03).
**Do:** the Well Wisher rail and keys in the order Day, Focus, Study, Tree, Career (§3.1.2); `day` (today, week, body, close), `focus.rest`, `study.practice`, the 40 px Now strip, "moved to" hints in every old place, legacy id aliases (§3.2).
**Accept:** two taps to a running block (Playwright count); every legacy id resolves; no horizontal scroll at 683 px.
**Tests:** vitest 1223-plus, Playwright, the gate. **Record:** `docs/research/well-wisher.md`.

### A.B12 Coach (local 4B)
**Files (new):** `app/jarvis_app/ww_coach.py`, `ww/study/Coach*.tsx`. **Depends on:** B08, R01 (the VRAM numbers) and the remap. **Order:** after B08; an exam feature that resumes after the remap (I33).
**Do:** a drafting action over the student's selected notes, local only, chip `MODEL`, Based-on links, Edit, 20 s timeout to fallback text, per-feature and "Rules only" switches; delete `ww.coach`.
**Accept:** no grade, score or numeric answer is ever produced (a test with adversarial prompts); VRAM within the R01 budget with Whisper loaded; the model unloads after idle and a request is refused when free VRAM is under the R01 floor.
**Tests:** backend tests with a stub model, vitest, Playwright. **Record:** `docs/research/well-wisher.md`.

### A.B13 Retire the old layout and dead code
**Files:** `germoney/pages/**`, `MissionNav`, `SettingsDrawer`, `ReaderDrawer`, `galaxy/**`, `components/{MemoryGalaxy,GrowthChart,PhoneCard}.tsx`. **Depends on:** B11 flipped and Q02, Q03 passed, owner OK. Embedding swap only if R03's rule says so. **Order:** the last package of the remap build; B08 and B12 follow it.
**Do:** remove after vitest no longer defaults to the old layout; update the bundle budget.
**Accept:** bundle smaller than the B01 baseline (record both); no orphan entries.
**Tests:** full suites. **Record:** research file.

### A.Q01 Contract sweep
**Files:** a report in `docs/research/product-design-overhaul.md`. **Depends on:** B05 onward. **Owner limits:** a session that built nothing; read-only on code. **Order:** before each flag flip.
**Do:** run every suite and the gate; enforce each row of 15.5; check no-scroll at 1366x768, 1366x720 and 1920x1080, class M reachability at 1280x720 and 1280x680, text-spacing and 200 % font passes, reflow at 320 and 683 px, keyboard-only flows, forced colours, `prefers-contrast`, zoom; run `tools/art/check_ids.py` (fails when a refused or reference-only id appears in §7 or §8), the private-hash-in-dist check and `viewCount.test.ts`.
**Accept:** one table, each budget with measured value and pass or fail; failures filed as bugs, not fixed here.
**Tests:** all of block C.5. **Record:** as above.

### A.Q02 Real-window pass
**Files:** a signed checklist in the research file. **Depends on:** Q01, the owner's time. **Order:** before the `ww.ia` flip.
**Do:** on the real laptop: idle CPU 60 s focused, minimised, a 30-minute soak (memory growth under 10 %, target), Narrator and NVDA scripted checklist (shell, palette, tree, one form); after the `ww.ia` flip, add the two-week "moved to" review as a follow-up row.
**Accept:** every row has a value or an explicit "not run" with a reason.
**Record:** research file.

### A.Q03 Privacy and claims audit
**Files:** a report in the research file. **Depends on:** Q01. **Order:** before any default flips.
**Do:** a whole-app network trace, compared with the egress register of §1.3.1 (loops and models must show no external host; every other exception must be in the register); a copy audit against the say and do-not-say list; the "entries past review" list; confirm no tracked file holds personal details; flag the UK and EU legal review of public copy (F14).
**Accept:** a go or no-go per flag, each with the evidence.
**Record:** research file.

### A.Q04 Customer-track quality gate
*Superseded by D-V2-1: the customer track is no longer a gate. The v2 gate is the gallery pass, A.Q04 in wave 14 below.*
**Files:** a report in the research file. **Depends on:** B06b. **Owner limits:** a session that built nothing; the owner attends. **Order:** before any customer build.
**Do:** render each centrepiece from both tracks side by side; check the §8.6.3 quality bar (palette, silhouette, texture); record commission status for sun, trunk and skyline; confirm every file in `generated/` has a licence line and a per-file human review.
**Accept:** a table with pass or fail per piece; the owner cannot name a lost trait for a passing piece.
**Record:** research file.

---

### Wave blocks of direction v2 (13 Nov 2026)

These blocks follow 15.6. A wave starts only when the previous wave has merged and the integrator has pasted the wave contract table next to the packages (Block C rule 13; wave 5 is written out below). Each block names the files the package owns; two packages of one wave never own the same path. "Gallery entry" always means the file `app/ui/src/gallery/entries/<id>.tsx` exporting `entry: GalleryEntry`. Unless a block says otherwise: Sonnet; the research record is a new dated section in `docs/research/product-design-overhaul.md` (private derivative work: `data/notes/research/art.md`); tests are the Block C list that the package touches (vitest and `tsc -b` always).

#### Wave 5 contract table (paste at the top of every wave 5 prompt)

| Pkg | Purpose in one line | Folders owned | Exports it will add (names and signatures) | Exports of other packages it may import |
|---|---|---|---|---|
| N01 | Put every merged kit, art, lamp and voice component, in its states and both themes, on one place inside shell v2 | `gallery/**`, `e2e/bench/entry.tsx`, `e2e/gallery.spec.ts`, `tools/wave_check.py` | `default WhatIsNew(): JSX` (a view, no props); `type GalleryEntry = { id: string; title: string; group: 'kit' \| 'art' \| 'lamp' \| 'voice' \| 'grammar' \| 'data' \| 'section' \| 'theme'; states: { label: string; node: ReactNode }[]; note?: string }`; `collectEntries(): GalleryEntry[]` (reads `gallery/entries/*.tsx`) | `shared/kit`, `shared/art`, `shared/lamp`, `jarvis/voice` (existing) |
| N02 | Fix the shell as the B05 review found it and turn the central lists into globbed folders | `shell/**` except `gallery`, `ww/frame/**`, `styles/shell.css`, `e2e/shell*.spec.ts`, `__tests__/shell/**` | `type ViewRegistration = { id: string; product: ProductId; load: () => Promise<{ default: ComponentType }> }` (files `shell/views/*.view.ts`); `type SlotName = 'boot' \| 'titlebar-sigil' \| 'cursor-root' \| 'notify'` (files `shell/slots/<slot>.<name>.tsx`); `type ShellMode = { id: string; prefix: string; run(query: string): PaletteRow[] }` (files `shell/modes/*.mode.ts`); the place id `app.new` (key `Alt+N`, palette verb "What is new") that mounts N01's `WhatIsNew`; `SkipLink` | N01 `WhatIsNew` (lazy), `shared/kit`, `shared/lamp` |
| G01 | Give the clay a real material recipe and pay the kit's measured debt | `styles/design/clay/**`, `shared/kit/**`, `shared/lamp/**`, `shared/planned/**`, `__tests__/kit/**`, `e2e/bench/known.ts`, `e2e/bench.spec.ts` | the built elevation tokens `--elev-flush`, `--elev-raised`, `--elev-float` (the three raised steps) and `--elev-recessed` (the inset) are kept by name and refined; new tokens `--ridge-hi`, `--ridge-lo`, `--lit-hi`, `--lit-lo`, `--tooth-opacity`; the built `--edge-ui` (3:1 on every control) and `--decor-opacity` are tightened, not renamed (no `--elev-1` to `--elev-3` and no `--recess` are created: they would duplicate built tokens); `LitPanel(props: PanelProps & { angle?: 0\|45\|90\|135\|180\|225\|270\|315 })`; `PlannedGlyph(props: { size?: number })` as the only PLANNED drawing (the dashed ring); `shared/planned/registry.ts` also collects `**/*.planned.ts` by `import.meta.glob` beside the existing entries, so later packages add one file and never edit `ww/plannedFeatures.ts` or `jarvis/planned.ts` | none |
| G02 | Make sigil, ASCII and terminal three shared grammars with tokens, components and budgets | `shared/grammar/**`, `__tests__/grammar/**` | `sigilSvg(id: string, o?: { size?: 16\|24\|48; fold?: 2\|4\|6\|8; mode?: 'seed'\|'growth' }): string`; `Sigil(p: { seed: string; size?: 16\|24\|48; fold?: number; tone?: 'ink'\|'accent'; drawn?: boolean })`; `SigilFrame(p: { sides?: ('t'\|'r'\|'b'\|'l')[]; arm?: number; planned?: boolean; children })`; `GlyphRule(p: { length?: number; density?: number })`; `Seal(p: { id: string; earned: boolean })`; `AsciiPlate(p: { text: string; ramp?: 'r10'\|'r5'\|'caret'\|'edge'; tier?: 'data'\|'atmosphere'; state?: 'static'\|'frozen'\|'scattered' })`; `AsciiHeat(p: { cells: number[]; ramp?: 'r5'; reading: ReactNode })`; `AsciiBar(p: { value: number; max: number; width?: number; head?: '>' \| 'car' \| 'chopper'; reading: ReactNode })` (the progress track of 20.5.3; the head glyph is chosen in a Trim, never unlocked); `AsciiPortrait(p: { initials: string })`; `sparkline(values: number[]): string`; `TermWell(p: { prompt: string; children })`; `TermLine(p: { tag?: LampState; typed?: boolean; children })`; `BootSequence(p: { rows: string[]; onDone(): void })`; `ScanFrame(p: { label: string; state: 'scanning'\|'waiting' })`; tokens `--term-ground`, `--term-ink`, `--sigil-w-1`, `--sigil-w-2`, `--sigil-w-3`, `--bracket-arm`, `--ascii-cell-w`, `--ascii-cell-h` in `grammar.css` (`--term-ground` and `--term-ink` are `var()` aliases of the built charcoal and ink primitives: hex stays only in `primitive-color.css`, which G02 does not own) | `shared/lamp` (`LampState`, `LAMP_SPECS`); CSS variable names `--ink-1`, `--ink-2`, `--edge-ui` from G01 by name only |
| G03 | Wire the private art track so the eleven centrepieces render, and trace the sigil primitives | `tools/art/**`, `art/**`, the git-ignored private folder | `<ArtSlot id: string; fit?: 'cover'\|'contain'; treatment?: 'duotone'\|'bayer'\|'atkinson'\|'contour'; ratio?: number; caption?: string />` in `art/ArtSlot.tsx` (always `aria-hidden`, static form, reduced-motion form); `artUrl`, `artText` (existing, unchanged); ids `art.core.hill-ring`, `art.room.faceplate`, `art.senses.spindle`, `art.memory.branch`, `art.console.frame`, `art.day.sun`, `art.focus.dots`, `art.study.island`, `art.tree.trunk`, `art.career.skyline`, `art.proof.ring`; `tools/art/trace_sigil.py` (CLI: `--id C01-18 --out <private folder>`) | `art/resolve.ts` (existing) |

Rules of this table: a builder may call another package's export of the same wave only through the signature written here; must not re-implement a listed export; imports single-source tables and never copies them; and ends the report with a "contract check" line naming the exports delivered and any signature it had to change (the integrator then updates the table for the next wave).

### A.N01 What is new gallery (wave 5)
**Files:** `app/ui/src/gallery/**`, `app/ui/e2e/bench/entry.tsx`, `app/ui/e2e/gallery.spec.ts`, `tools/wave_check.py`. **Depends on:** B03b, B03c, B04, B05, B07 UI half (merged). **Owner limits:** UI chat; N02 mounts the view, N01 never edits `shell/`. **Order:** wave 5; first to merge because it is how the owner sees every later package.
**Do:** move the specimens out of `e2e/bench/entry.tsx` into `gallery/specimens/*.tsx` (one file per kit, art, lamp and voice component, each with its states and both themes) and leave the bench page a thin mount of the same content so the bench checks stay as they are; build `WhatIsNew`: left list by group, right the specimens with a theme switch (light, dark, and the ten section themes of `styles/sections`), a state switch per entry and a "merged in" line per entry; `collectEntries()` with `import.meta.glob('./entries/*.tsx', { eager: true })`; one entry file for each of B01 to B07 so the page is complete on day one; the voice specimen runs on the fixture frames stamped SIMULATED; write `tools/wave_check.py` (reads a wave table from a JSON file, fails on overlapping owned paths or on a changed file outside a package's folders). Exports: `WhatIsNew`, `GalleryEntry`, `collectEntries`.
**Accept:** the gallery lists every component of the kit, art, lamp and voice folders (a test compares the exported names to the entries); the bench page still reports 28 passing checks and 18 listed failures; no document scroll at 1366x768 and reflow at 390 px; zero rAF at idle on the gallery; a package with no entry file fails `wave_check.py`.
**Tests:** vitest, `tsc -b`, the bench spec, a Playwright spec that opens `#t=app.new` with the shell flag on, and a pytest for `wave_check.py` on two fixture tables. **Record:** research file, section "gallery".

### A.N02 Shell fixes from the B05 review (wave 5)
**Files:** `app/ui/src/shell/**` (not `gallery`), `app/ui/src/ww/frame/**`, `app/ui/src/styles/shell.css`, `app/ui/e2e/shell*.spec.ts`, `app/ui/src/__tests__/shell/**`. **Depends on:** B05, N01's default export (lazy). **Owner limits:** UI chat; Well Wisher chat consulted for `ww/frame`. **Order:** wave 5, with N01.
**Do:** (a) the Well Wisher frame keeps its own dark theme and toolbar under the light clay bar: the bar and the frame each show their theme, and the toolbar is not hidden; (b) legacy pages that still show their own view switch show only one: the shell hides the duplicate by a `data-shell-owned` marker, not by editing the page; (c) the keyboard-reach test is flaky because the two-way frame bridge can move the place with no key pressed: make the bridge ignore a place it did not ask for during a key test (a `bridge.pending` token) and make the test assert on the key, not the settled place; run it 20 times; (d) the Resume pill is a breadcrumb: it names the place and the time, one press goes there, Esc dismisses, and it is a labelled `nav` landmark; (e) the first-run pill only navigates (no side effect on press); (f) add `SkipLink` ("Skip to canvas") as the first tab stop; (g) the three globbed folders of 15.6 (`shell/views`, `shell/slots`, `shell/modes`) with the registration types, and the place `app.new`; (h) add the two new view ids `day.month` and `focus.drill` to the id table `shell/ids.ts` with their aliases, add `__tests__/shell/viewCount.test.ts` asserting 36 from the table (no such test exists today; the present 34 is asserted in `e2e/shell-v2.spec.ts`, which N02 updates), and show a PLANNED plate for any id in the table that has no registered view yet (so the shell never breaks while sections land). Exports: `ViewRegistration`, `SlotName`, `ShellMode`, `SkipLink`, place `app.new`.
**Accept:** the keyboard-reach spec passes 20 of 20; the canvas still measures 1302x720 at 1366x768; a view added as `shell/views/x.view.ts` mounts without any other edit (a test adds a fixture file); `app.shell` off equals today's behaviour (snapshot names unchanged); the Classic UI and New UI buttons still work.
**Tests:** vitest at least 1833, `tsc -b`, Playwright `shell*`, 20 repeats of the flaky spec. **Record:** research file, section "shell fixes".

### A.G01 Clay recipe and kit debt (wave 5; Opus for the contrast work if a second attempt is needed)
**Files:** `app/ui/src/styles/design/clay/**`, `app/ui/src/shared/kit/**`, `app/ui/src/shared/lamp/**`, `app/ui/src/shared/planned/**`, `app/ui/src/__tests__/kit/**`, `app/ui/e2e/bench/known.ts`, `app/ui/e2e/bench.spec.ts`. **Depends on:** the jury and bench results (merged). **Owner limits:** UI chat; no change to a behaviour test. **Order:** wave 5; every later package reads its tokens.
**Do:** (a) the material recipe: the three built raised steps (`--elev-flush`, `--elev-raised`, `--elev-float`), each given a ridge (1 px light top, 1 px dark bottom, `--ridge-hi`, `--ridge-lo`) over a soft shadow, plus the built inset `--elev-recessed` for wells (names kept; no parallel set is created); a 2.5 percent tooth tile on ground and raised only, off in high contrast and forced colours; (b) every control edge at 3:1 against its neighbour in both themes, drawn as `--edge-ui`; (c) pay the 18 measured failures and delete each entry from `known.ts` as it passes: Switch OFF word 2.41:1 (and clipped by the thumb), Rocker halves 13.9 px wide, Field focus outline missing and edge 1.12:1, Knob, Plate and Fold edges near 1:1, Button edge, FolderTabs "Soon", Drawer and IconButton and MasterDetail hit areas, and the toast stack overflowing 27 px at 390 px; (d) one PLANNED glyph everywhere (`PlannedGlyph`, the dashed ring): `LAMP_SHAPE`, the registry plate, `BlankingPlate` and the chip all draw it from one source; (e) `LitPanel` (aimed light in 8 quantised angles, opacity only, one at a time) and the focus settle; (f) the glob collector for `*.planned.ts` and a corner-bracket frame in CSS on the PLANNED plate so every placeholder is on theme without importing G02. Exports: the tokens and components in the contract table.
**Accept:** `known.ts` is empty or lists only failures re-measured today with a reason; the contrast oracle computes every pair, text 4.5:1 and controls 3:1, light and dark and forced colours; a lint counts at most one accent-filled element per `data-view`; idle `getAnimations()` is empty; the bench is green.
**Tests:** vitest, `tsc -b`, the bench spec, Playwright snapshots (expected to change for the kit only; update the baselines in the same commit and say how many changed). **Record:** research file, section "clay recipe".

### A.G02 Sigil, ASCII and terminal grammars (wave 5)
**Files:** `app/ui/src/shared/grammar/**`, `app/ui/src/__tests__/grammar/**`. **Depends on:** B03, B03b, B04, B05b (merged). **Owner limits:** UI chat; no catalogue picture is read or embedded: the 14 primitives are hand-drawn as own SVG paths in `shared/grammar/sigil/primitives.ts`. **Order:** wave 5.
**Do:** 20.4.1 to 20.4.3 in full: the 14 primitives, three stroke weights with `vector-effect: non-scaling-stroke`, the generator (FNV-1a 32 seeding mulberry32, fold from 2, 4, 6, 8, 3 to 5 primitives on 2 to 3 radii, at most 60 segments and 3 KB), the five roles, the one-shot draw-in with a static and reduced-motion form; the four ASCII ramps with the 7.2 x 16 data cell and the 6 x 12 atmosphere cell, `AsciiHeat`, `AsciiBar`, `AsciiPortrait`, `sparkline`, and a lint that rejects an atmosphere plate bound to a count; `TermWell`, `TermLine` with tags equal to the lamp words, `BootSequence` (24 characters per second, 600 ms cap, any key skips, calm shows all rows), `ScanFrame`; mobile forms; forced-colours forms (`CanvasText` strokes). Exports: the list in the contract table.
**Accept:** the same id gives the same bytes (golden files); at most 60 segments and 3 KB per sigil; the tag set equals `LAMP_SPECS` words; no component runs an animation at idle; text equivalents on every data ASCII form; a `data-grammar` attribute on each component and a lint that every `data-view` uses at least two grammars (reported, enforced from wave 7).
**Tests:** vitest golden tests, forced-colours Playwright on the gallery entry, byte-budget script (target 90 KB across the app, at most 8 KB per file). **Record:** research file, section "grammars".

### A.G03 Private art track wired (wave 5)
**Files:** `tools/art/**`, `app/ui/src/art/**`, the git-ignored private folder (never tracked). **Depends on:** B05b (merged). **Owner limits:** UI chat; installs need the owner's OK (PIL and numpy are present). **Order:** wave 5, beside G02.
**Do:** D-V2-1 in code: the private track resolves the owner's staged pictures and their derivatives by id; the build runs with and without the private folder; `check_no_private_in_dist.py` fails on any private hash in a `dist` that leaves the machine and a tracked-file scan finds no image bytes of a private id; write the recipes for the eleven centrepieces of 20.4.6 (duotone, Bayer, Atkinson, contour, ASCII, terminal frame, each from a catalogue id, output to the private folder); write `trace_sigil.py` (crop by bounding box, threshold, marching squares, Ramer-Douglas-Peucker at 0.8 px, at most 60 segments per shape, output to the private folder); add the Life, tree, JARVIS and Senses derivatives of 20.6, 20.8 and 20.9 as recipes (ids only in tracked files); `ArtSlot`. Refused ids stay refused (C04-26, C03-12, C01-25 lamp-lens forms); C03-21 is cropped to the filament region only; C01-19's lower-row label is masked. Exports: `ArtSlot` and the eleven ids.
**Accept:** each centrepiece renders in the gallery on the private track and shows a plain placeholder with the id and the word "private track off" on the default track; `build_art.py --check` green; at least 25 percent of its view box once placed (checked by the section packages); no private id string beside any pixel in a tracked file.
**Tests:** pytest for the recipes and the checks, vitest for `ArtSlot`. **Record:** `data/notes/research/art.md` (private); one line in the public research file naming only counts.

### A.D01 Number forms (wave 6)
**Files:** `app/ui/src/shared/data/numbers/**` (Odometer, Dumbbell, LedgerTape, Jar), gallery entry. **Depends on:** G01, G02. **Owner limits:** UI chat. **Order:** wave 6.
**Do:** 20.5.2 for the four components. `Odometer(p: { value: number; unit: string; state: LampState; size?: 'hero'\|'compact' })` rolls a digit only on a change and only when visible; WAITING draws "-- --"; hollow form is four dashed wells. `Dumbbell(p: { rows: { label: string; before: number; after: number }[]; scale: [number, number]; state: LampState })`; always against the student's own earlier self. `LedgerTape(p: { entries: { label: string; amount: number }[]; total: number; state: LampState })` with a torn end. `Jar(p: { level: number; plan?: number; label: string; state: LampState })` fills past the notch with a hatch and a text line, no red.
**Accept:** every component takes a `state` and has a hollow and a static form; no bare 14 px number outside a table; zero rAF at idle; copy grep finds no "over budget" scolding.
**Tests:** vitest, forced colours, the grammar lint. **Record:** research file.

### A.D02 Series forms (wave 6)
**Files:** `app/ui/src/shared/data/series/**` (Trace, DotHistogram, SkyLedger), gallery entry. **Depends on:** G01, G02. **Order:** wave 6.
**Do:** `Trace(p: { points: { t: number; v: number | null }[]; median?: number; state: LampState })` (gaps hatched, never interpolated, ASCII ruler, scrub and pin, draws once in 320 ms); `DotHistogram(p: { values: number[]; bins?: number; unitPerDot?: number; state: LampState })`; `SkyLedger(p: { days: { date: string; kind: 'kept'\|'rest'\|'none' }[]; window: 60\|90; state: LampState })` whose headline is a slowly changing ratio, with no chain, no "broken" and no streak prop anywhere.
**Accept:** table fallback for each; the scrub is keyboard reachable; deleting a day lowers the count; a grep finds no `streak` identifier in the folder.
**Tests:** vitest, forced colours, reduced-motion. **Record:** research file.

### A.D03 Tables, lists and the select (wave 6)
**Files:** `app/ui/src/shared/data/tables/**` (LedgerTable, SlotList, DetentRack), gallery entry. **Depends on:** G01. **Order:** wave 6.
**Do:** `LedgerTable(p: { columns: Col[]; rows: Row[]; density?: 'normal'\|'dense'; state: LampState; onEdit?(row, col, value) })` with 32 px rows and 44 px hit areas, sticky header, sort glyph in text, `F2` inline edit, a column chooser, drawer on expand, key-value cards under 900 px; `SlotList(p: { items: Item[]; onReorder?(from: number, to: number) })` (Alt+Up and Alt+Down, dashed blanking plate while lifting); `DetentRack(p: { options: Opt[]; value: string; onChange(v: string): void; grouped?: boolean })` as a listbox with `aria-activedescendant`, typeahead and a bottom sheet under 900 px. No native `<select>`.
**Accept:** full keyboard paths; 44 px targets; no zebra; static forms; forced colours.
**Tests:** vitest, Playwright keyboard spec on the gallery entry. **Record:** research file.

### A.D04 Capture line (wave 6)
**Files:** `app/ui/src/shared/capture/**`, gallery entry. **Depends on:** G01, G02. **Order:** wave 6.
**Do:** one `CaptureLine(p: { grammar: 'ww' \| 'jarvis'; onCommit(parsed: Parsed): void; verbs?: string[] })`. Local deterministic tokenizer `parseWw(text: string, now: Date): ParseResult` for `spent 120 chai`, `water 250`, `gym legs 45`, `remind me next tue 7 pm physics`; an ambiguous input shows `? what is 120` and waits; chips beneath each editable; Enter commits; Undo toast 6 s; `Ctrl+Space` focuses it inside Well Wisher. The `jarvis` grammar is a closed verb list (`remember>`, and the Console verbs a section passes in). Unknown input answers `unknown verb; try help`. No eval, no shell.
**Accept:** 30 fixture phrases parse as written in a test table, 10 ambiguous ones wait; month ends and "next tue" resolve correctly; a solid, non-blinking cursor block.
**Tests:** vitest (parser table), keyboard spec. **Record:** research file.

### A.D05 Specimen layout, strata and rack (wave 6)
**Files:** `app/ui/src/shared/data/specimen/**` (SpecimenLayout, StrataCore, SigilMark, RackRow), gallery entry. **Depends on:** G01, G02 (the sigil engine). **Order:** wave 6.
**Do:** `SpecimenLayout(p: { specimen; callouts?: ReactNode[]; footer?: ReactNode })` with the geometry of 20.5.1 and its reflow; `StrataCore(p: { units: { id: string; label: string; evidence: number; n: number }[]; state })`; `SigilMark(p: { arms: { id: string; length: number; recent: 'disc'\|'ring'\|'dashed' }[]; size?: number })` (byte-identical SVG for the same input); `RackRow(p: { device: string; serial?: string; state: 'unconfirmed'\|'confirmed'\|'fault'\|'planned'; lastSeen?: string; onToggle?(): void })` whose confirmed lamp lights only after a report.
**Accept:** the geometry test at 1366x768 and 390 px (no document scroll; at most one object wider than 40 percent); golden SVG for `SigilMark`; `RackRow` never shows confirmed from a prop alone (needs `reportedAt`).
**Tests:** vitest, Playwright geometry. **Record:** research file.

### A.J01 Core section (wave 7)
**Files:** `app/ui/src/jarvis/core/**`, `app/ui/src/jarvis/handoff/**`, `app/ui/src/pages/Core.tsx`, `shell/views/core.view.ts`, gallery entry. **Depends on:** the voice component, G01 to G03, D01. **Order:** wave 6 (as run; pulled forward from wave 7).
**Do:** 20.9.1 and 20.9.7: mount `VoiceHill` with `attachVoiceFeed`; `SigilRing(p: { bands: number[]; state: LampState; glyphSet?: string })`, `PipelineRibbon(p: { stages: { id: 'hear'\|'write'\|'think'\|'say'; state: LampState; sec?: number; median?: number }[] })` (fill only if a median exists), `OrganStrip`, the Anatomy drawer, transcript turns as terminal rows with `[YOU]` and `[JRV]` tags and four flags, `HandoffChip(p: { product: 'ww'; target: string; label: string })` with the deep link `#t=ww/day.today`; the asleep scene and `art.core.hill-ring`; the phone Talk layout under 900 px. The hand-off chip shows text only when the `notify` port is null.
**Accept:** hollow whenever the core is off; no node solid without a fresh report; no list row without a tag and a lamp; zero rAF at idle off the hill; the eight voice states unchanged; no scroll at 1366x768.
**Tests:** vitest, Playwright, the voice suite. **Record:** research file.

### A.J02 Room section (wave 7)
**Files:** `app/ui/src/jarvis/room/**`, `pages/Limbs.tsx`, `shell/views/room.view.ts`, gallery entry. **Depends on:** G01 to G03, D05 (`RackRow`). **Order:** UW9 (UI lane; was wave 7). **Contract import (same wave):** L02's `Trim(p: { settingId: string; label: string; readsBy: string; children })`; until it merges J02 renders the heavy-load flag inside its own popover with the same signature.
**Do:** 20.9.2: the wall-box faceplate over `art.room.faceplate`, eight keys with a three-phase LED (asked, confirmed, not confirmed after 6 s, absent "unavailable"), `GuardKey(p: { heavy: boolean; summary: string; state: 'closed'\|'open'\|'asked'\|'confirmed'\|'unconfirmed'; onPress(): void })` for channels the owner flags (two acts, OFF always one press), All off with a pre-press list, `DayRing24(p: { rules: Rule[]; now: Date; onPreview?(t: Date \| null): void })` with a PREVIEW-only scrubber, `room.rules` as a gate schematic, dial scenes previewed as dashed outlines. Delete the `r.present` filter and the Uno leftovers.
**Accept:** key lamps follow the board's report only; the scrubber never sends and never changes a lamp (test); a flagged channel needs two acts and an unflagged one stays one press; no energy figure; no scroll at 1366x768 and 358 px layout.
**Tests:** vitest, keyboard spec, the existing relay tests. **Record:** research file.

### A.L01 Life month calendar (wave 7)
**Files:** `app/ui/src/shared/almanac/**` (Almanac, DayCell, DayMark, StippleStrip), `ww/day/month/**`, `ww/day/drawer/**` (DayDrawer), `ww/day/adapters/` (slot, empty), `shell/views/day-month.view.ts`, gallery entry. **Depends on:** G01 to G03, D01, D02. **Order:** UW7 (UI lane; unchanged).
**Do:** 20.6.1: `Almanac(p: { mode: 'year'\|'month'\|'week'\|'day'; days: DayData[]; onPick(date): void; exams?: Exam[] })`, `DayCell`, `DayMark(p: { kind: Kind; done: boolean })` with the eight shapes and a Marks popover legend, the month grid (128 x 86 cells, side panel, 12 px strip), the year form, `DayDrawer` with Happened, Planned and Intents folds and Undo, Delete, Move, Done, "Not now" (a carried outline, no failure wording). The id `day.month` is already in the id table (N02). Reads the existing life store; the intent and Google sources arrive through `ww/day/adapters/*.register.ts` (null adapter now).
**Accept:** a cell shows no number unless its source lamp is LIVE; the shape table is the test fixture; arrow-key roving with one tab stop; no `currentStreak` prop; copy grep finds none of the banned words of 20.6.7; no scroll at 1366x768; a bottom sheet on the phone.
**Tests:** vitest, Playwright keyboard and geometry, forced colours. **Record:** research file.

### A.L02 Trim and the settings registry (wave 7)
**Files:** `app/ui/src/shared/trim/**` (Trim, SettingsIndex, `registry.ts`), `shell/modes/settings.mode.ts`, gallery entry. **Depends on:** G01. **Order:** wave 6 (as run; pulled forward from wave 7; merged).
**Do:** 20.6.6: `Trim(p: { settingId: string; label: string; readsBy: string; children })` (a 44 px key with a slider glyph, a popover of at most 320 x 360 with the control, current value, default, Reset and one line saying what reads it; Esc returns focus); `registry.ts` collects `*.settings.ts` files by glob (`type SettingDef = { id: string; label: string; section: string; view: string; read(): unknown; reset(): void }`); `SettingsIndex` fills the palette mode `:`; a test fails when a registry entry has no mounted Trim or a form field is not in the registry.
**Accept:** no orphan entry and no unregistered field (fixture table); every legacy `settings.*` id resolves to a Trim home through an alias table (empty until E13); hardware and brain settings keep their confirm step.
**Tests:** vitest, keyboard spec. **Record:** research file.

### A.L04 Today and Proof (wave 7; added by the critic pass, 20.16)
**Files:** `app/ui/src/ww/day/today/**`, `ww/left/**`, `ww/proof/**`, `ww/frame/ProofRail.tsx`, `shell/views/day-today.view.ts`, `shell/views/proof-*.view.ts`, gallery entry. **Depends on:** G01, G02, D01, D02, D04, D05 (L01 is the same wave: this package does not import the Almanac or `DayMark`; it draws its own plates). **Order:** UW7 (UI lane; unchanged). **Owner limits:** the built logic of `day.today` (plan editor, add-to-day, classes, counters) is moved, not rewritten.
**Do:** 20.16.1 and 20.16.2: `DayArc(p: { blocks: { id: string; from: string; to: string; kind: 'class'\|'planned'\|'done'; label: string }[]; now: Date; state: LampState })` as one SVG half-ring of 18 hour ticks over `art.day.sun`, with the Odometer hero, the Trace datum, the `Ahead` card, the `Now` card and the footer `CaptureLine` (`ww`); `ProofRelief(p: { stats: { id: string; label: string; value: number; n: number; state: LampState; caption: string }[] })` as the embossed ring with a caption on every bar and a drill-down to a `Dumbbell` and a `DotHistogram`. Mobile: the arc becomes a vertical spine at 358 px.
**Accept:** every number carries a lamp and a caption; the arc updates on the minute with no animation and no rAF at idle; no document scroll at 1366x768 and 358 px; the first-run state is one primary ("Start a 10-minute block"); no stat in Proof reads as a score or a promise (forbidden-word test); the existing `day.today` and proof tests keep passing.
**Tests:** vitest, Playwright (`life`, `proof` specs), forced colours. **Record:** research file.

### A.J03 Senses section (wave 8)
**Files:** `app/ui/src/jarvis/senses/**`, `pages/Aankhen.tsx`, `shell/views/senses.view.ts`, gallery entry. **Depends on:** G02, G03, D02. **Owner limits:** the Aankhen chat signs off on the look; the WebGL twin and its code stay where they are behind a "3D" key (D-V2-20); no new WebGL import. **Order:** UW11 (UI lane; was wave 8).
**Do:** 20.9.3: `SignalTerrain(p: { frames: Frame[]; source: 'live'\|'simulated'\|'none'; paused?: boolean })` as the one bounded 720 x 360 canvas; `LinkCube`, `ChannelMatrix`, `ProbabilityArc(p: { band: 'low'\|'mid'\|'high'\|null; p?: number; trusted: boolean })` (no digit before the held-out check), `MotionTape` (hatched for "sensing paused by you", blank is not proof of an empty room), the SVG isometric floor plan as the default Map form, `senses.signal` as an SVG-only spectrum view, the Teach rings. On screen: "detects motion of anyone in range, identifies no one; one link, no pose."
**Accept:** each Senses view holds at most one canvas; simulated shows the amber stamp; hollow with no frames; no eye, face or body form anywhere (grep of art ids); no present, absent or "empty room" wording (copy lint); the twin mounts only when 3D is selected.
**Tests:** vitest, Playwright, the Aankhen tests on a scratch data dir. **Record:** research file.

### A.J04 Memory section (wave 8)
**Files:** `app/ui/src/jarvis/memory/**`, `pages/Yaadash.tsx`, `shell/views/memory.view.ts`, gallery entry. **Depends on:** G02, G03, D04. **Order:** UW10 (UI lane; was wave 8).
**Do:** 20.9.4: `MemoryConstellation(p: { nodes: Node[]; edges: Edge[]; selected?: string; onSelect(id): void })` (golden-angle layout, a pure function of the store, at most 120 nodes then clusters, text list as the keyboard equivalent), `StrataBands`, the Trail, the `remember>` capture line (`CaptureLine` grammar `jarvis`), Fix with a two-line diff and 7-day undo, Delete with the count, `ReminderChip` is not built here (E03). The three other Memory views follow 20.16.3 (Belief board, People ring, Keep vault). Node count equals Holdings (D-V2-25).
**Accept:** deleting a node removes it with no celebration; no node carries stored text in the picture; embedding search drawn dashed PLANNED; one 240 ms path draw on recall and none under reduced motion.
**Tests:** vitest (count equals store), Playwright. **Record:** research file.

### A.L03 Week, body, ledger and close (wave 8)
**Files:** `app/ui/src/ww/day/{week,body,ledger,close}/**`, `ww/life/**`, `shell/views/day-week.view.ts`, `day-body.view.ts`, `day-close.view.ts`, `ww/day/adapters/` is read, not written, gallery entry. **Depends on:** L01, D01 to D04. **Order:** UW9 (UI lane; was wave 8).
**Do:** 20.5.3 (the timetable rack with free-slot plates and the Bunk Ledger of attendance margins, built on `LedgerTable` and a 20-dot meter; the margin formula shown on focus; wording "margin", never "bunk" or red) and 20.6.2 to 20.6.5: the week form with planned (hollow) and done (solid) blocks and the keyboard `m` move; the body strip (gym session log, seven-day strip, `WaterGauge`, medicine reminders as "Reminders you set. Not medical advice.", class reminders); the Ledger drawer with the spending log, `HabitRibbon` and Trim counters; "Plan tomorrow" on `day.close`; neutral line "Pick up here." on return. Stores arrive through adapters (null now): water, spend and habit counts show WAITING until E02.
**Accept:** no streak, reset or "days clean" anywhere; counts can fall; copy grep (20.6.7) passes; nothing says to take, how much, or why; no scroll at 1366x768 and 358 px.
**Tests:** vitest, Playwright, copy grep test. **Record:** research file.

### A.Y01 Paper Desk and Review Desk (wave 8)
**Files:** `app/ui/src/ww/study/papers/**`, `ww/study/review/**`, `shell/views/study-papers.view.ts`, `ww/study/adapters/` (slot, empty), gallery entry. **Depends on:** G02, D02, D05. **Order:** UW7 (UI lane; was wave 8).
**Do:** 20.7.1 and 20.7.2: `PaperStrata(p: { cells: Cell[]; years: number[]; topics: Topic[]; coverage: Coverage; onOpen(q): void })`, `CoverageLedger`, `PaperDrop(p: { onFiles(files: File[]): void; accept: string[] })`, `ExtractionTrace(p: { events: TraceEvent[] })` (real events only), `ReviewDesk` with Accept, Edit, Merge, Split, Reject (undo 10 s), Next uncertain, and "Accept all certain and review the rest" (margin at least 0.5 and complete marks). Counts as "k of N" with the Wilson interval; below 3 papers "too few papers to show a pattern". The `gcr` plate is E05's.
**Accept:** nothing enters the bank without review; each tag chip is `RULE`, `MODEL` or `HAND`; no "important", "likely", "expected" in any string (forbidden-word test); the footer sentence "From papers on file. This prepares practice; it does not predict a paper or a result."; fixtures run SIMULATED on the bench.
**Tests:** vitest, Playwright keyboard path, forbidden-word test. **Record:** research file.

### A.Y02 Focus: start, session and Drill (wave 8)
**Files:** `app/ui/src/ww/focus/**`, `shell/views/focus-*.view.ts` (start, session, rest, drill), gallery entry. **Depends on:** G02, D01. **Order:** UW7 (UI lane; was wave 8).
**Do:** 20.7.7 and 20.7.8: the new view `focus.drill` (its id is already in the table, N02) with the question panel, progress dots, Park shelf, hint ladder (`h` reveals are logged), "Not yet. Worked answer below", counts-only set end; `ParkField`; the terminal strip updating on real events; the "Pick for me" strip. Drill and the Crucible both live in Focus (D-V2-11); the legacy id `drill` resolves to `focus.drill`.
**Accept:** no red token on a miss (lint on tokens); a hint reveal is logged and lowers nothing; the strip changes only on an event; zero rAF at idle in the Drill; an early end keeps the filled dots.
**Tests:** vitest, Playwright. **Record:** research file.

### A.J05 Console section (wave 9)
**Files:** `app/ui/src/jarvis/console/**`, `pages/System.tsx`, `pages/Connect.tsx`, `shell/views/console-*.view.ts`, gallery entry. **Depends on:** D03, D04, D05, G02. **Order:** UW10 (UI lane; was wave 9).
**Do:** 20.9.5: the terminal world (`TermWell` frame, rows with bracket tags and lamps, `CommandLine` as `CaptureLine` grammar `jarvis` with the closed verbs `status`, `test hearing`, `restart brain`, `free gpu`, `export memory`, `jobs`, `plan`, `help`), `JobRow(p: { label: string; fraction?: number; state })`, the events filter grammar, `RoutePlates(p: { registry: Planned[] })`, diagnostics with the relay `RackRow` inventory. Firmware never offers flash while the app holds the port.
**Accept:** unknown verbs rejected; a verb that changes something asks once; a bar fills only to a reported fraction, else hollow; no shell, no eval.
**Tests:** vitest, Playwright. **Record:** research file.

### A.Y03 Study plan, practice and generator UI (wave 9)
**Files:** `app/ui/src/ww/study/{plan,practice,generator}/**`, legacy `ww/study/*.tsx`, `shell/views/study-plan.view.ts`, `study-practice.view.ts`, gallery entry. **Depends on:** Y01, G02. **Order:** UW8 (UI lane; was wave 9).
**Do:** 20.7.3 to 20.7.6 and the generator overlay: `SyllabusLandscape`, the `DateWheel` with real papers, `RetentionOrbit` (four bands, no digits, `DEFAULT` chip), `SigilGauge(p: { unitId: string; proficiency: number; n: number })` (dashed under n of 5), `BlueprintBar`, the practice set-up door into `focus.drill`, the "Pick for me" card with printed terms and "Not this" and "Choose another", the three-step generator overlay. Engines arrive through `ww/study/adapters` (null now).
**Accept:** the formula terms are printed on the card; "Not an official paper" in the PDF header text; no decimal in the retention view.
**Tests:** vitest, Playwright. **Record:** research file.

### A.T01 Tree (wave 9)
**Files:** `app/ui/src/ww/tree/**` (components, views, `ports.ts`, `adapters/` slot), `shell/views/tree.view.ts`, gallery entry. **Depends on:** G02, G03. **Order:** UW9 (UI lane; was wave 9).
**Do:** 20.8.1 to 20.8.3: `GroveRing(p: { trees: TreeSummary[]; onOpen(id): void })`, `SkillNode(p: { tier: 1\|2\|3; state: 'locked'\|'open'\|'progress'\|'claimed'\|'evidenced'\|'stale'; pips: number; label: string })` (six states by shape plus glyph), `TraceEdge`, the tree canvas with level of detail and the keyboard model, `BranchSpine`, `EvidenceLedger`, the node drawer with Evidence, Needs, Do next and Used by. Declares `adapters/` and `data/` as slots (loaded by glob). Reads the evidence through `ports.ts` (null adapter: every node OPEN or LOCKED, the Grove shows dashed seeds).
**Accept:** a self-mark draws CLAIMED and never EVIDENCED; growth is a pure function of the ledger and falls when a record is deleted; 300 nodes under 400 drawn DOM nodes (a measurement, not a promise); zero rAF at idle.
**Tests:** vitest, Playwright keyboard traversal. **Record:** research file.

### A.T02 Career (wave 9)
**Files:** `app/ui/src/ww/career/**`, `shell/views/career-*.view.ts`, gallery entry. **Depends on:** G02, D03. **Order:** UW10 (UI lane; was wave 9).
**Do:** 20.8.6: Runway (`FlightBoard`), Ladder with Path as its second state (`RoleConstellation`), Abroad (`SpecTable`, `RackChecklist`), Certificates (`PlateShelf`), Money (`FundingBridge`); every date or fee cell is a `Readout` with a lamp, LIVE only when confirmed with a "checked on" stamp, else WAITING "unconfirmed"; the one verified figure (10,332 euros proof of finances, opened 13 Nov 2026) quoted with its source; "These are skill matches against role profiles you wrote or imported. It is not a prediction of being hired."
**Accept:** no figure without a stamp (cell-lamp test); no outcome promise; rupee and euro columns separate and a typed, dated rate.
**Tests:** vitest, Playwright. **Record:** research file.

### A.G04 Cursors, boot, route sigil, empty states (wave 9)
**Files:** `app/ui/src/shared/grammar/cursor/**`, `shell/slots/boot.*.tsx`, `titlebar-sigil.*.tsx`, `cursor-root.*.tsx`, `shell/empty/**`, gallery entry. **Depends on:** N02, G02, G03. **Order:** UW11 (UI lane; was wave 9).
**Do:** 20.4.5 and 20.4.7: `CursorKit` (reticle, bracket, plan, wait, hold; at most 32 x 32 with a keyword fallback) and `useBracketHover`, hover brackets in 100 ms, the pointer companion off in calm, at `low`, on touch and in forced colours, one Trim switch in the title bar; the route sigil drawing into the title bar in 200 ms; the boot rows; one empty state per view (seed glyph, terminal well, grain strip).
**Accept:** zero rAF 2 s after the last input; targets stay 44 px; hover never replaces focus; the cursor off in forced colours.
**Tests:** vitest, Playwright, forced colours. **Record:** research file.

### A.E01 Intents and recurrence engine (wave 10)
**Files:** `app/jarvis_app/ww_intents.py`, `app/jarvis_app/routes_ww_intents.py`, `app/tests/test_ww_intents.py` (Python only; the TypeScript adapter files `intents.register.ts` and `intents.ts` are AD10's). **Extends:** `app/jarvis_app/reminders.py` (the existing list, scheduler and `repeat`/`interval_min` fields: `ww_intents.expand` produces the dates and hands each to `reminders.py`; it does not keep a second scheduler). **Depends on:** none in the engine lane (UI side L01, L03 earlier). **Order:** EW9 (engine lane, Python only; was wave 10).
**Contract:** discovery of route files already exists in `register_feature_routes` (no `server.py` edit), so E01 to E04 are independent inside their wave.
**Do:** 20.6.2: `Intent` with a rule (weekday, month day, yearly date, every n days), a reminder offset and a Quiet gate; `expand(rule, from, to): string[]` as a pure function; `IntentRule` and `IntentEditor` (extends `Field`, `Segmented`); the adapter registers the planned marks.
**Accept:** 40 recurrence cases pass (month ends, leap day, a 29 Feb yearly rule); the function runs twice with the same result.
**Tests:** pytest on a scratch data dir, vitest. **Record:** research file.

### A.E02 Life logs store (wave 10)
**Files:** `app/jarvis_app/ww_logs.py`, `routes_ww_logs.py`, `app/tests/test_ww_logs.py` (the TypeScript adapter `logs.register.ts` is AD10's). **Extends:** `ww_money.py` (budget and savings log engine), `ww_body.py` (weekly habits with evidence) and `ww_life.py` (counters and the day log): `ww_logs` is the append-only store they read their `entries`, `habit_log` and `log` arguments from, and it adds no second budget or habit arithmetic. **Depends on:** none in the engine lane. **Order:** EW9 (engine lane, Python only; was wave 10).
**Do:** 20.6.7 tables `spend`, `habit_events`, `water`, `reminders` (JSONL under the data folder by default, as the other Well Wisher stores; nothing tracked); append-only with delete; the adapter feeds the week, body and ledger views; limits are the student's own.
**Accept:** deleting a row changes every derived picture honestly; no automatic bank read (grep); the Help list is shown identically at every count (no count-triggered line, no inference).
**Tests:** pytest (scratch dir), vitest. **Record:** research file.

### A.E03 Reminder delivery (wave 10)
**Files:** `app/jarvis_app/reminders.py` (extension: the receipt ladder and Quiet gate are added to the existing scheduler, which already fires reminders, timers and alarms from `data/app/reminders.json`) and `routes_reminders.py` (extension), `app/tests/test_ww_reminder_ladder.py`; no new `ww_reminders.py`. The UI files (`jarvis/reminders/**` ReminderChip and ReminderBell, `shell/slots/notify.reminder.tsx`) are AD11's. **Extends:** `reminders.py`, `routes_reminders.py`, `core/proactive.py` (the existing rule for when JARVIS may speak unasked). **Depends on:** none in the engine lane. **Order:** EW10 (engine lane, Python only; was wave 10).
**Do:** 20.9.6: the fixed ladder (toast, chime if on, one spoken line if on, one snooze), receipts (spoken, queued, failed), Quiet unliftable, rule-based wording `Reminder: <title>, now.`, the `notify` port adapter; spoken off by default per reminder.
**Accept:** no code path raises volume, frequency or wording severity (a test enumerates the ladder); presence never decides whether to speak; copy grep finds no "missed" or "overdue"; never reads a dose.
**Tests:** pytest, vitest. **Record:** research file.

### A.E04 Google Calendar link (wave 10, Opus: security-sensitive)
**Files:** `app/jarvis_app/ww_gcal/**`, `routes_ww_gcal.py`, tests (the UI files `ww/day/link/**` LinkLamp and `gcal.register.ts` are AD11's). **Extends:** nothing existing (no Google code is in the backend today; `connect.py` only mentions Takeout); it imports C06 for sign-in. **Depends on:** C06 (EW9). **Owner limits:** the owner signs in himself in his browser; the assistant never types or stores credentials; needs his own Google Cloud client (Q-V2-2). **Order:** EW10 (engine lane, Python only; was wave 10).
**Do:** 20.6.3: loopback PKCE listener (5 minutes), refresh token in the OS credential store only, read-only `calendar.events.readonly` by default, a second switch to write planned blocks with a preview list, per-calendar switches off by default, disconnect revokes and deletes the cache; states PLANNED, WAITING, LIVE, FAULT.
**Accept:** all four states reachable on a bench with a fake provider; no secret in the repository or in `data/` as plain text (scan); imported events carry the notch and the words "from Google" and never enter counts.
**Tests:** pytest with the fake provider, vitest. **Record:** research file (what was and was not verified about Google's scopes).

### A.E05 Question store, folder watch and the gcr plate (wave 11)
**Files:** as the EW7 table: `app/jarvis_app/ww_pyq/{__init__,schema,store,folder}.py`, `routes_ww_pyq.py`, `app/tests/test_pyq_store.py` (no TypeScript: `pyq.register.ts` is AD08's and the `ww.gcr` plate `ww/study/ww-gcr.planned.ts` is C08's; no `server.py` edit). **Extends:** `yaadash/library.py` and `routes_library.py` (folder ingest job pattern); reads `ww_bank_store`. **Depends on:** none in the engine lane (UI: Y01 earlier). **Order:** EW7 (engine lane, Python only; was wave 11).
**Do:** 20.7.9 storage: `papers`, `pages`, `questions`, `families`, `attempts`, `cards`; originals stay in `data/`; a folder watch (WAITING until a folder is chosen); the PLANNED `ww.gcr` plate that opens an explanation, never a form (Q-V2-1).
**Accept:** the schema migrates on a scratch dir; stale-entry tests T1 to T10 pass; none of the owner's papers is in a tracked file.
**Tests:** pytest, vitest. **Record:** research file.

### A.E06 Ingest and segmentation (wave 11)
**Files:** as the EW7 table: `app/jarvis_app/ww_pyq/{ingest,segment,crops,slides}.py`, `routes_ww_pyq_ingest.py`, `app/tests/pyq_fixtures/**` (invented papers only), `app/tests/test_pyq_ingest.py` (`ocr.py` is X04's, EW8). **Extends:** `yaadash/library.py` (`extract`: PyMuPDF text, python-pptx slides, the OCR hook) and `ww_harvest.py` (`split_problems`, `guess_marks`). **Depends on:** E05 (the store contract). **Owner limits:** PyMuPDF and python-pptx are already installed; the OCR engine (RapidOCR) is approved (D-V3-6) with its size stated first. **Order:** EW7 (engine lane, Python only; was wave 11).
**Do:** 20.7.9 ingest steps 1 to 3 (text layer, else OCR; question starts by the stated pattern; marks; type by pattern); log events are the run's real events.
**Accept:** on 10 invented fixture papers the question count equals the hand count on 9 and marks are found on 90 percent (targets); an OCR miss reports FAULT with the install message.
**Tests:** pytest. **Record:** research file.

### A.E07 Tagging, families, patterns and Next three (wave 11)
**Files:** as the EW7 table: `app/jarvis_app/ww_pyq/{tag,families,patterns,next}.py`, `routes_ww_pyq_patterns.py`, `app/tests/test_pyq_patterns.py`; the list function is `practise_next` (D-V3-26). **Extends:** `ww_generator.topic_key`, `topic_weights`, `proficiency`; `ww_mastery`. **Depends on:** E05. **Order:** EW7 (engine lane, Python only; was wave 11).
**Do:** 20.7.9: cosine tagging with the 0.25 score and 0.15 margin, a `MODEL` proposal only among existing topics, families by 5-word shingles and Jaccard 0.8, counts with the Wilson interval, "too few papers" below 3, and `gain = (marks share x papers-seen share) x (1 - proficiency)` ranked per minute with the terms printed; `ww_check` runs each pure function twice.
**Accept:** the Wilson interval matches a reference table to 4 places; a mutation lowering the margin to 0 fails a test; no string from the forbidden-word list in any output; five real cases the owner agrees with reproduce the ranking (V01) before it ships.
**Tests:** pytest, the gate. **Record:** research file.

### A.E08 Generator, checker and spaced review (wave 11)
**Files:** as the EW7 table: `app/jarvis_app/ww_pyq/{blueprint,generate,printset,check}.py`, `routes_ww_pyq_gen.py`, `app/tests/test_pyq_gen.py`; `ww_generator.py` is imported and not edited in EW7; `ww_fsrs.py` and the drill routes leave E08 (the review queue is X09, `ww_review/**`; drill reads the queue through its route). **Extends:** `ww_generator.generate`, `effective_pattern`, `scale_pattern`, `paper_invariants`; `ww_numericals`; `ww_exams`. **Depends on:** E05. **Order:** EW7 (engine lane, Python only; was wave 11). (B08 is folded into E07 and E08.)
**Do:** the practice paper from the reviewed bank with the section blueprint and the header "Practice paper from your bank. Not an official paper."; the independent numeric checker route; the FSRS scheduler with default parameters until about 1,000 reviews (chip `DEFAULT`); a rules-only switch that turns every `MODEL` use off.
**Accept:** the blueprint equals the source paper's marks per section; a variant stays dashed until accepted; the retention estimate has no decimal in any output.
**Tests:** pytest, the gate on a scratch dir. **Record:** research file.

### A.E09 Evidence ledger (wave 12)
**Files:** `app/jarvis_app/ww_evidence.py`, `routes_ww_evidence.py`, `app/tests/test_ww_evidence.py` (the TypeScript adapter files are AD11's). **Extends:** `ww_trees.py` (nodes already "verified by evidence", with `proofs` and `measures` arguments) and `ww_proof.py`: the ledger is the store those arguments are read from, not a second verification rule. **Depends on:** T01. **Order:** EW10 (engine lane, Python only; was wave 12).
**Do:** 20.8.4: the table `evidence`, six kinds, the unlock rule (sum of weights at least the requirement and one hard record of kind 1, 4 or 5), STALE windows (language 60, drills 90, body 30 days, proposals), a deleted record recomputes everything; a held-out Study pass writes a record.
**Accept:** unit tests for every state; delete recomputes; a body node needs instructor-logged sessions or a grade.
**Tests:** pytest, vitest. **Record:** research file.

### A.E10 Trees one to five (wave 12)
**Files:** `app/ui/src/ww/tree/data/t01-*.json` to `t05-*.json` (academic core, engineering, languages, body and self-defence, social). **Depends on:** T01. **Order:** UW12 (UI lane, data files; was wave 12).
**Do:** 20.8.5: 57 branches plus capstones for trees 1, 4 and 5 (60), each with at least 3 nodes, tier, prerequisites and accepted evidence kinds; the body tree needs instructor-logged sessions or a grade (Q-V2-9).
**Accept:** a schema test per file; 60 branches counted by a test local to these five files.
**Tests:** vitest. **Record:** research file.

### A.E11 Trees six to ten (wave 12)
**Files:** `app/ui/src/ww/tree/data/t06-*.json` to `t10-*.json` (influence, money, craft, health basics, career skills). **Depends on:** T01. **Order:** UW12 (UI lane, data files; was wave 12).
**Do:** 51 branches plus capstones for trees 8 and 10 (53); the influence tree teaches recognising and resisting manipulation and honest persuasion, no tactic aimed at a named person; the health tree says "learn and practise" and never "manage a condition".
**Accept:** schema test; 53 branches counted; copy grep on influence and health nodes. The total of 113 is asserted by Q01.
**Tests:** vitest. **Record:** research file.

### A.E12 Career data (wave 12)
**Files:** `app/jarvis_app/ww_career_data.py`, `routes_ww_career_data.py`, `app/tests/test_ww_career_data.py` (the TypeScript adapters are AD12's). **Extends:** `ww_career.py` (the career engine already ranks the next career action from nodes, deadlines and applications): `ww_career_data` is the "checked on" data store that engine reads. **Depends on:** T02. **Order:** EW11 (engine lane, Python only; was wave 12).
**Do:** stores for applications, universities and their cells, certificates, funding sources and a typed dated rate; every date and fee has a `checked_on` field; a one-click fetch only if the owner agrees (Q-V2-11), else manual entry.
**Accept:** no cell leaves the store without a stamp or the WAITING flag; deleting an application removes its notch.
**Tests:** pytest, vitest. **Record:** research file.

### A.E13 Settings dissolved (wave 13)
**Files:** `app/ui/src/ww/setup/**` (removed), `ww/**/*.settings.ts` and `jarvis/**/*.settings.ts` (new), `lib/settings.ts`, `shell/modes/settings.mode.ts` (data only). **Depends on:** L02 and all sections. **Order:** UW12 (UI lane; was wave 13).
**Do:** 20.6.6: place each of the 28 settings homes in the table, each with a Trim at its home, delete the sheet, keep every `settings.*` id as an alias that opens the Trim popover at the new home.
**Accept:** the registry test passes (no orphan, no unregistered field); every alias resolves; hardware and brain changes keep their confirm step.
**Tests:** vitest, Playwright deep-link specs. **Record:** research file.

### A.E14 Cross-links (wave 13)
**Files:** `app/ui/src/shared/links/**`, `ww/**/adapters/links.register.ts`. **Depends on:** T01, T02, L01, Y03, E09. **Order:** UW13 (UI lane; was wave 13).
**Do:** 20.8.6 cross-links: Tree gap to Life block (`P`), Do next to Drill, held-out pass to evidence, Career requirement to a Study block and a Life block, each a one-key action stating its source.
**Accept:** each link has a test that the target opens and the source is named; absent target shows text.
**Tests:** vitest, Playwright. **Record:** research file.

### A.B09 Phone, revised (wave 13; supersedes the B09 text above where it differs)
**Files:** `phone_page/**` (not `ww.*` of another package), `app/jarvis_app/routes_phone*.py`. **Depends on:** B03, B05, L01. **Order:** UW13 (UI lane; the Python half is B09p in EW11; was wave 13).
**Do:** as B09 plus the phone Calendar tab (the Almanac at 390 px), the Day page, next paper and Next three; drill and paper drop stay desktop (PLANNED `phone-papers`).
**Accept:** one palette; 44 px taps; Playwright phone specs.
**Tests:** as B09. **Record:** research file.

### A.B10 Learning loops (wave 13, as before)
**Files:** `app/ui/src/shared/learning/**`, `shared/learning/learning.settings.ts`. **Depends on:** B05, L02. **Owner limits:** UI chat; each loop off by default. **Order:** UW13 (UI lane; was wave 13).
**Do:** as A.B10, with its settings group registered as a Trim home. **Accept:** as A.B10. **Tests:** vitest and the local-only network test. **Record:** research file.

### A.B12 Coach (wave 13, as before)
**Files:** `app/jarvis_app/ww_coach.py`, `app/ui/src/ww/study/coach/**`. **Depends on:** E07, E08, R01 (the VRAM numbers). **Owner limits:** a model install needs the owner's OK. **Order:** UW13 (UI lane; the Python half is B12p in EW11; was wave 13).
**Do:** as A.B12; every output carries `MODEL` and a source link; a rules-only switch. **Accept:** as A.B12; the model unloads after idle. **Tests:** pytest, vitest. **Record:** research file.

### A.B13 Retire the old layout (wave 14, as before)
**Files:** `germoney/pages/**`, `galaxy/**`, `components/{MemoryGalaxy,GrowthChart,PhoneCard}.tsx`. **Depends on:** all sections and the owner's OK. **Owner limits:** removal only after the owner agrees. **Order:** UW14 (UI lane; unchanged).
**Do:** as A.B13. **Accept:** the bundle is smaller and no stale registry entry remains. **Tests:** all suites. **Record:** research file.

### A.Q01, A.Q02 and A.Q03 for direction v2 (wave 14)
**Files:** reports in the research file. **Depends on:** every earlier wave. **Order:** UW14 (UI lane; adds the lane check, the route check and the assertion of 36 views).
**Do:** the contract sweep of A.Q01 over 36 views (assert `viewCount` 36, `check_ids.py`, 113 branches across E10 and E11); the real-window pass of A.Q02 with the owner (idle CPU, minimised, the gallery pass of 20.15); the privacy and claims audit of A.Q03 extended with: no private picture in a tracked file or in any `dist` that leaves the machine, the Google link states, the reminder ladder, the banned-word greps of 20.6.7 and 20.7.9, no camera in any dependency list, a whole-app network trace against the egress register with Google and the optional image generator as the only declared external hosts and only when the owner has switched them on.
**Accept:** a table of every budget and rule with a measured value and pass, fail or "not run" with the reason.

### A.Q04 Gallery pass (wave 14; replaces the customer-track gate, D-V2-1)
**Files:** a signed checklist in the research file. **Depends on:** all waves. **Order:** UW14 (UI lane; unchanged).
**Do:** the owner opens "What is new" and each section in the running application; for each of the eleven centrepieces and each placement of a catalogue picture he marks keep, change or drop; changes go back to their package as a one-line brief.
**Accept:** every placement has a mark; nothing is called finished without one.

### Wave blocks of the two-lane plan (14 Nov 2026)

These blocks follow 15.6.1 and section 21. A wave of either lane starts only when the earlier waves it depends on have merged and the integrator of that lane has pasted the wave contract table next to its packages (Block C rule 13). **Lane rule:** an engine package owns only Python folders and their tests and exposes routes whose shapes are written in `docs/design/well-wisher-engine-plan.md`; a UI package reaches a route only through an adapter file it owns, with a null adapter until the route exists. Unless a block says otherwise: Sonnet; agents leave their work uncommitted and the lane's integrator commits (D-V3-18); UI tests are vitest and `tsc -b` plus the Block C list that the package touches, engine tests are pytest on scratch data directories (`JARVIS_DATA_DIR`, `AANKHEN_DATA_DIR`), never the real `data/`; the research record of a UI package is a new dated section in `docs/research/product-design-overhaul.md`, that of an engine package a new dated section in the engine chat's own topic file `docs/research/well-wisher-engine.md` (private derivative work: `data/notes/research/`); installs are only the four families approved on 13 Nov (D-V3-6).

#### Wave contract table for the next UI wave, UW7 (paste at the top of every UW7 prompt; paths under `app/ui/src`)

**Start condition (critic, 14 Nov).** UW7 starts only when D02, D03, D05, J01 and G05 of wave 6 have merged: L04, Y01 and DB02 import D02 and D05, and G05 rewrites `shared/kit/**` and `shared/lamp/**`, which every UW7 package imports (a half-merged craft pass would change props under the builders). The rows below were checked on 14 Nov: no two packages own an overlapping path, every import is of an earlier wave or of a signature written here, and the adapter folders are narrowed to the files the package itself owns (every later adapter is another package's file, added by glob).

| Pkg | Purpose in one line | Folders owned | Exports it will add (names and signatures) | Exports of other packages it may import |
|---|---|---|---|---|
| L04 | Today with the Day Arc and the Proof relief | `ww/day/today/**`, `ww/left/**`, `ww/proof/**`, `ww/frame/ProofRail.tsx`, `shell/views/day-today.view.ts`, `shell/views/proof-*.view.ts`, `gallery/entries/L04.tsx` | `default Today(): JSX`; `DayArc(p: { blocks: DayBlock[]; planned: DayBlock[]; done: DayBlock[]; now: Date; state: LampState })`; `ProofRelief(p: { stats: ProofStat[]; state: LampState })`; two glob hosts: `ww/day/today/modes/*.mode.tsx` (a file exports `{ id: string; label: string; Specimen: ComponentType; Margin?: ComponentType }`) and `ww/day/today/callouts/*.callout.tsx` (`{ id: string; order: number; Callout: ComponentType }`) | `shared/kit`, `shared/lamp`, `shared/grammar`, `shared/data/{numbers,series,tables,specimen}`, `shared/capture` (not L01) |
| L01 | The Life month calendar and the Day ports | `shared/almanac/**`, `ww/day/month/**` (host of `faces/*.face.tsx`), `ww/day/drawer/**` (host of `folds/*.fold.tsx`), `ww/day/ports.ts`, `ww/day/adapters/types.ts` and `ww/day/adapters/null.register.ts` (the only adapter files L01 owns), `shell/views/day-month.view.ts`, `gallery/entries/L01.tsx` | `Almanac(p: { month: string; days: DayCell[]; onOpen(date: string): void; state: LampState })`; `DayCell`; `DayMark(p: { kind: 'done' \| 'planned' \| 'class' \| 'google' \| 'classroom' \| 'note'; filled?: boolean; label: string })`; `StippleStrip`; `DayDrawer(p: { date: string })`; `type DayPort` (members `month`, `day`, `intake`, `intents`, `logs`, `reminders`, `gcal`, `dashboards`, each with a null adapter) | `shared/kit`, `shared/lamp`, `shared/grammar`, `shared/data/{numbers,series}` |
| Y01 | Paper Desk, Review Desk, import tray; all Study ports | `ww/study/papers/**`, `ww/study/review/**`, `ww/study/ports.ts`, `ww/study/adapters/types.ts` and `ww/study/adapters/null.register.ts` (the only adapter files Y01 owns; AD08 and later add theirs by glob), `shell/views/study-papers.view.ts`, `gallery/entries/Y01.tsx` | `PaperStrata`, `CoverageLedger`, `ReviewDesk`, `ExtractionTrace`, `PaperDrop`, `ImportTray`, `CropCard`, `RubricChips` (props in 21.8); `type StudyPort` with members `papers`, `questions`, `ingest`, `decide`, `crop`, `blueprints`, `generate`, `patterns`, `practiseNext` (the gain-ranked list of 20.7.9; the Today list `NextThree` of DB01 is another thing, fed by DB11), `check`, `readiness`, `tonight`, `queue`, `harvest`, `intake`, `classroom`, each derived from the engine plan file and each with a null adapter that answers WAITING | `shared/kit`, `shared/lamp`, `shared/grammar`, `shared/data/{series,tables,specimen}` |
| Y02 | Focus: start, session (Crucible), rest, drill | `ww/focus/**` (host of `tracks/*.track.tsx`, `adapters/` with the legacy-bank adapter), `shell/views/focus-*.view.ts`, `gallery/entries/Y02.tsx` | `FocusStart`, `Crucible`, `FocusRest`, `Drill`, `ParkField`; `type FocusPort`; `type TrackRegistration = { id: string; Session: ComponentType<{ onEnd(): void }> }` | `shared/kit`, `shared/lamp`, `shared/grammar`, `shared/data/numbers` |
| DB01 | Three small dashboard forms | `shared/data/countdown/**`, `shared/data/nextthree/**`, `shared/data/handoff/**`, `gallery/entries/DB01.tsx` | `CountdownDots(p: { from: string; to: string; state: LampState; label: string })`; `NextThree(p: { items: { id: string; text: string; reason: string; lamp: LampState }[]; state: LampState })`; `HandoffKey(p: { to: string; context?: Record<string, string>; label: string })` | `shared/kit`, `shared/lamp`, `shared/grammar`, `shared/data/numbers` |
| DB02 | The Legend flip side | `shared/data/legend/**`, `gallery/entries/DB02.tsx` | `Legend(p: { entries: { mark: ReactNode; meaning: string; source: LampState }[] })` | `shared/kit`, `shared/lamp`, `shared/data/specimen` |

Rules of this table are those of the wave 5 table: a builder calls another package's export of the same wave only through the signature written here, never re-implements a listed export, imports single-source tables, and ends its report with a "contract check" line.

#### Wave contract table for the next engine wave, EW7 (paste at the top of every EW7 prompt; paths under `app/jarvis_app` unless stated; Python only)

**Checked 14 Nov (critic).** The engine plan file `docs/design/well-wisher-engine-plan.md` exists (commit 8e0933a) and governs route shapes: paths are under `/api/mission/` (the existing Well Wisher prefix), every success carries `state`, `reason`, `source`, and its section 9 must list the route contracts R-01 onward before EW7 starts (it did not on 14 Nov). `server.py` is owned by nobody in EW7: `register_feature_routes` already mounts every `routes_*.py`, so a new route file is enough (a route module that raises at import is skipped silently, so each route file gets a test that its paths answer). The `requirements/` files are edited by the engine integrator only, once per wave. The last column names the existing module each package extends or reuses (full map in 21.10); a package that writes a parallel copy of one of them fails review.

| Pkg | Purpose in one line | Files owned | Exports it will add (names and signatures) | Exports of other packages it may import | Existing module it extends or reuses |
|---|---|---|---|---|---|
| E05 | Review-staging question store with crops, schema, folder watch | `ww_pyq/{__init__,schema,store,folder}.py`, `routes_ww_pyq.py`, `app/tests/test_pyq_store.py` | `class Store(data_dir: Path)` with `add_paper(meta: PaperMeta) -> str`, `add_questions(paper_id: str, drafts: list[QuestionDraft]) -> list[str]`, `set_status(qid: str, status: Literal['pending','accepted','rejected'], by: Literal['hand','rule']) -> None`, `list_questions(paper_id: str \| None = None, status: str \| None = None) -> list[Question]`, `coverage(subject: str) -> Coverage`, `crop_path(qid: str) -> Path \| None`, `watch_folder(path: Path \| None) -> FolderState`; TypedDicts `PaperMeta`, `QuestionDraft` (carries `crop`: page, bbox, PNG path, and `text_status`), `Question`, `Topic`, `Coverage`, `FolderState`, `TextStatus = Literal['verified','unverified','none']` in `ww_pyq/schema.py`; routes under `/api/mission/pyq/`: `papers` (GET, POST), `papers/{id}`, `questions` (GET, PATCH), `crops/{id}`, `coverage`, `folder` (GET, PUT) | none | `ww_bank_store` (read only: slug and field names; accepted own-file questions stay in this private Store and reach the generator through the `bank` argument, so `ww_bank_store` is not edited and keeps refusing unlicensed text); `yaadash/library.py` and `routes_library.py` (the folder-ingest job pattern) |
| E06 | Ingest of PDFs and slides, crops, segmentation | `ww_pyq/{ingest,segment,crops,slides}.py`, `routes_ww_pyq_ingest.py`, `app/tests/pyq_fixtures/**` (invented papers only), `app/tests/test_pyq_ingest.py` | `ingest_pdf(path: Path, *, ocr: Callable[[bytes], OcrResult] \| None = None) -> IngestResult`; `ingest_slides(path: Path) -> IngestResult`; `IngestResult = { paper: PaperMeta, drafts: list[QuestionDraft], trace: list[TraceEvent] }`; `segment_page(page: dict) -> list[Box]`; `read_pdf_text(data: bytes, first: int \| None = None, last: int \| None = None) -> str` (PyMuPDF; HV01 makes `ww_harvest.pdf_text` call it, so there is one PDF reader); `IngestResult`, `TraceEvent`, `OcrResult`, `Box` TypedDicts in `ww_pyq/ingest.py`; routes `POST /api/mission/pyq/ingest`, `GET /api/mission/pyq/ingest/{job}` | E05 `Store` and the TypedDicts, through the signatures above | `yaadash.library.extract` (PyMuPDF text, python-pptx slides, OCR hook: call it, do not rewrite it); `ww_harvest.split_problems`, `guess_marks` and `_PROB` (the start patterns that segmentation generalises) |
| E07 | Tagging, families, patterns, Quiet, Practise next | `ww_pyq/{tag,families,patterns,next}.py`, `routes_ww_pyq_patterns.py`, `app/tests/test_pyq_patterns.py` | `tag_question(q: Question, topics: list[Topic]) -> TagResult`; `find_families(qs: list[Question]) -> list[Family]`; `compute_patterns(qs: list[Question], papers: list[PaperMeta], floor_papers: int = 3, floor_questions: int = 20) -> PatternSet`; `quiet_topics(papers: list[PaperMeta], r: int = 3) -> list[str]`; `wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]`; `practise_next(patterns: PatternSet, proficiency: dict[str, float], gap_minutes: int) -> list[Pick]` (named so it cannot be mistaken for the Today list "Next Three" of DB11); routes `GET /api/mission/pyq/patterns`, `GET /api/mission/pyq/practise-next`, `POST /api/mission/pyq/tags/suggest` | E05 TypedDicts | `ww_generator.topic_key`, `topic_weights`, `proficiency` (the gain terms of 20.7.9 call these); `ww_mastery` for proficiency inputs |
| E08 | Blueprint, generator v2, checker, print set | `ww_pyq/{blueprint,generate,printset,check}.py`, `routes_ww_pyq_gen.py`, `app/tests/test_pyq_gen.py` | `infer_blueprint(paper: PaperMeta, qs: list[Question]) -> Blueprint`; `validate_blueprint(bp: Blueprint) -> list[Issue]`; `generate_paper(bp: Blueprint, bank: list[Question], seed: int) -> GeneratedPaper`; `render_print(paper: GeneratedPaper, kind: Literal['paper','key','marking','night']) -> str` (HTML); `check_numeric(key: str, answer: str) -> CheckResult`; routes `GET`/`PUT /api/mission/pyq/blueprints/{exam}`, `POST /api/mission/pyq/blueprints/infer`, `POST /api/mission/pyq/papers/generate`, `GET /api/mission/pyq/generated/{id}/print`, `POST /api/mission/pyq/check`; E08 stores its blueprints and generated papers itself as JSON under the data directory (no `Store` method is needed) | E05 `Store` and TypedDicts; existing `ww_generator.paper_invariants`, `ww_numericals` (imported, not edited) | `ww_generator.generate`, `effective_pattern`, `scale_pattern`, `paper_invariants`, `as_markdown` and `ww_numericals.make`, `pool` (`generate_paper` maps a Blueprint onto the exam's `pattern`, passes the accepted questions as the `bank` argument and adds the family rule, the 14-day weight and hollow slots around the call; `ww_generator.py` is not edited in EW7, so its existing tests stay green by construction); `ww_exams` (the exam row a Blueprint belongs to) |
| C01 | Intake parsers (paste, calendar file, name match) | `ww_intake/{__init__,paste,ics,match}.py`, `app/tests/test_intake_parsers.py` | `parse_paste(text: str, now: datetime) -> ParseResult`; `parse_ics(text: str, now: datetime, horizon_days: int = 120) -> list[IcsEvent]`; `match_name(a: str, b: str) -> float` (token Jaccard); no routes | none | none (new package `ww_intake`); a parsed deadline becomes an `ww_exams` date-sheet row only on Accept (C02, EW8) |

The route shapes (request and response JSON, error codes, lamp state) of every row are the entries of `docs/design/well-wisher-engine-plan.md`; a builder that needs a shape the file does not hold stops and reports.

#### Amendments to the older blocks (two-lane plan)

These lines are read together with the block named; where they differ, they govern.
- **A.J01, A.L02:** Order is wave 6 (as run). A.J01 also declares a glob host `jarvis/core/glance/*.glance.tsx` for the Core home; if J01 merges without it, the integrator adds that one line before UW9.
- **A.L04:** declares the two glob hosts of the UW7 table; its Ahead callout shows days left as a plain number until DB03 adds `CountdownDots`.
- **A.L01:** hosts `faces/*.face.tsx` and `folds/*.fold.tsx`; its `DayMark` gains the kind `classroom`; it owns every Day port, with a null adapter each (D-V3-17).
- **A.Y01:** owns every Study port (list in the UW7 table), the crop handles and rubric strip of 21.3.2 S2, the `ImportTray` of S1 and `CropCard`; it adds no route call except through `StudyPort`.
- **A.Y02:** hosts `tracks/*.track.tsx` (the Crucible is the first track; the paper track is X08's); a legacy-bank adapter lives in `ww/focus/adapters/`.
- **A.Y03:** hosts `ww/study/plan/faces/*.face.tsx` (the Exam Room is X10's); it gives `generator/**` to X03 and the library tab host to C03.
- **A.L03:** hosts `ww/day/week/faces/*.face.tsx` (the Week Review is DB05's).
- **A.J05:** hosts `jarvis/console/health/faces/*.face.tsx` (the System dashboard is DB08's; there is no view `console.system`).
- **A.T01:** unchanged; its ports land before AD11 and E14.
- **A.E05 to A.E08:** Python only (the lane rule). They add what 21.3 and the EW7 table name: crops, tables and slides in E05 and E06; Quiet, Bloom and the extra routes in E07; blueprint, generator v2, print and the numeric check in E08. The `ww.gcr` plate and the TypeScript adapter files named in their older blocks move to C08 and AD08. FSRS leaves E08 for X09.
- **A.E01 to A.E04, A.E09, A.E12:** Python only; their `ww/**` and `jarvis/**` files move to AD09, AD10, AD11 and AD12 as 15.6.2 says. A.E04 imports the shared OAuth core (C06) and has no OAuth code of its own.
- **A.B09, A.B12:** their UI halves stay in UW13; their Python halves are the packages B09p and B12p (EW11).
- **A.Q01 to A.Q03:** add the lane check, the route check and the assertion that `viewCount` is 36 and that no view id `study.exam`, `day.exams` or `console.system` exists.

### A.G05 Craft pass: components, buttons and shadows (UW6, UI lane; in progress)
**Files:** `app/ui/src/styles/design/clay/**`, `shared/kit/**`, `shared/lamp/**`, `__tests__/kit/**`, `e2e/bench/known.ts`, and the shell chrome files (title bar, rail, dock) that the integrator names in the wave contract. **Depends on:** G01, N02 (merged). **Owner limits:** UI chat; no behaviour test changes; Opus for the contrast work if a second attempt is needed. **Order:** UW6, beside D02, D03, D05 and J01 (it is in progress).
**Do:** the owner's "highly refined components, buttons, shadows and overall aesthetics", against his clay references (private): (a) D-V3-19: no hairline on a labelled control in the default themes; a 3:1 inner cue on switch, rocker, checkbox, radio, knob, slider and detent; hard 2 px `CanvasText` edges in `prefers-contrast: more` and forced colours; (b) one light, a ridge and at most two shadow layers per step, a pressed travel of 1 px, no animated `box-shadow`; (c) the title bar, rail and dock refined to the same recipe; (d) every change is measured, and each bench failure fixed is removed from `known.ts`.
**Accept:** the contrast oracle computes the inner cue and the hard edges for every pair in light, dark and the two high-contrast modes; the bench is green with `known.ts` unchanged or shorter; the jury's depth and material score does not go down (ratchet); idle `getAnimations()` is empty.
**Tests:** vitest, `tsc -b`, the bench spec, Playwright snapshots (say how many baselines changed). **Record:** research file, section "craft pass".

### A.N03 Lane check and one-command integration (before UW7; process, the integrator)
**Files:** `tools/wave_check.py` (lane rule), `tools/integrate_wave.py`, `tools/tests/**`. **Depends on:** N01 (merged). **Owner limits:** programme chat; both lanes read it. **Order:** before UW7 starts.
**Do:** extend `wave_check.py` with the lane check (rule 8) and the route check (rule 9), a `freeze` check that refuses a feature package in the folders of D-V3-22 while the private freeze file exists, and exclusion globs; write `integrate_wave.py` (tsc, vitest, bundle, `wave_check`, Playwright, the art build and pytest on scratch dirs in one command that writes a report, so work in the worktrees survives an outage).
**Accept:** the fixtures fail on a `.py` path in a UI package, a `.tsx` path in an engine package and a shared file in an owned list; the report names each failed check.
**Tests:** pytest on fixture tables. **Record:** research file, section "lanes".

### A.DB01 Countdown, Next Three and hand-off key (UW7, UI lane)
**Files:** `app/ui/src/shared/data/{countdown,nextthree,handoff}/**`, gallery entry. **Depends on:** G01, G02, D01. **Owner limits:** UI chat. **Order:** UW7.
**Do:** 21.5: `CountdownDots` (at most 60 dots of 8 px, one per day to a date, a dot fills as a day is lived and never refills, no colour change near the end, a dashed row when waiting); `NextThree` (up to three rows with a reason line and a lamp, shows fewer and never pads, the scores on focus in mono); `HandoffKey` (a 44 px mono key that opens a target with context and never executes).
**Accept:** dots equal days; no animation; hollow and static forms; the same items give the same markup; a grep finds no "only N days".
**Tests:** vitest, forced colours, the grammar lint. **Record:** research file.

### A.DB02 Legend flip side (UW7, UI lane)
**Files:** `app/ui/src/shared/data/legend/**`, gallery entry. **Depends on:** G01, D05. **Owner limits:** UI chat. **Order:** UW7.
**Do:** 21.5: `Legend` generated from the same entries as the specimen so it cannot drift; the flip is an instant swap; `?` toggles it; a static text list is the reduced-motion and forced-colours form.
**Accept:** legend entries equal specimen entries on three fixtures.
**Tests:** vitest. **Record:** research file.

### A.DB03 Today deltas (UW8, UI lane)
**Files:** `app/ui/src/ww/day/today/callouts/{handoff,ahead}.callout.tsx`, gallery entry. **Depends on:** L04, DB01, DB02. **Owner limits:** UI chat; edits no other L04 file. **Order:** UW8.
**Do:** 21.5.1: the fifth callout **Hand-off** (`Open Exam Season` only when an exam window exists, `Ask JARVIS` opens the Deck); **Ahead** with `CountdownDots` and the Next Three drawer; keys `3` and `H`.
**Accept:** the 20.16.1 acceptance still holds; the empty and 390 px forms; Next Three WAITING "needs papers on file" with a null adapter.
**Tests:** vitest, Playwright keyboard spec. **Record:** research file.

### A.DB04 Exam Season (UW8, UI lane)
**Files:** `app/ui/src/ww/exams/**`, `ww/day/today/modes/season.mode.tsx`, gallery entry. **Depends on:** L04, D05, DB01, DB02. **Owner limits:** UI chat. **Order:** UW8.
**Do:** 21.5.2: the `CoverageRose` of up to 8 `SigilMark` subjects with a shared datum and one enlarged by a layout swap, the five Callouts (Subject, Weak units, Next three, Days left, Paper desk with the `PaperChip` strip), the footer, a switch to enter the mode (never automatic), the hollow and PLANNED forms.
**Accept:** 8 subjects fit at 1366x768; the selected swap; weak units need at least 5 attempts else a dashed ring; no countdown below one hour, no red, no "behind" (lint).
**Tests:** vitest, Playwright. **Record:** research file.

### A.DB05 Week and Month Reviews (UW10, UI lane)
**Files:** `app/ui/src/ww/review/**`, `ww/day/week/faces/review.face.tsx`, `ww/day/month/faces/review.face.tsx`, gallery entry. **Depends on:** L01, L03, D02, DB02. **Order:** UW10.
**Do:** 21.5.3 and 21.5.4: `WeekStrata` with the ghost of the previous week, `MonthSky` with constellation hairlines, five Callouts each, the Legend flip, `Save to Almanac`, `Export postcard` (native SVG serialisation, no upload), the `Note` box with a model draft marked DRAFT until accepted.
**Accept:** three fixtures; deleting a day lowers the count; no chain wording.
**Tests:** vitest, forced colours, reduced motion. **Record:** research file.

### A.DB07 Core glance strip (UW9, UI lane)
**Files:** `app/ui/src/jarvis/core/glance/**`, gallery entry. **Depends on:** J01, D05. **Order:** UW9.
**Do:** 21.5.5: `CoreGlance` with five tagged Callouts (`[HEA]`, `[ROM]`, `[SEN]`, `[MEM]`, `[SYS]`) from the Console report, the OFF form, mounted through the glance glob of J01.
**Accept:** every row has a lamp; WAITING shows the age of the last report; no number without a lamp.
**Tests:** vitest. **Record:** research file.

### A.DB08 System dashboard (UW11, UI lane)
**Files:** `app/ui/src/jarvis/console/health/faces/system.face.tsx`, `jarvis/console/system/**`, gallery entry. **Depends on:** J05, D05. **Order:** UW11.
**Do:** 21.5.6: the `SystemRack` of 12 `RackRow` units, the strata of system layers, Jobs, Storage, Devices, Models and Privacy callouts; unreported units are UNCONFIRMED half discs.
**Accept:** 12 rows at 1286 x 652; nothing green without a report in 5 minutes; empty form PLANNED.
**Tests:** vitest, Playwright. **Record:** research file.

### A.DB09 The Deck (UW10, UI lane)
**Files:** `app/ui/src/deck/**`, `shell/views/deck.view.ts`, gallery entry. **Depends on:** DB03, DB07, J01. **Owner limits:** the place `deck.home` is not one of the 36 views; if `ViewRegistration.product` does not accept both products the view is registered once per product. **Order:** UW10.
**Do:** 21.5.7: `DeckSheet`, a 300 x 300 Day Arc and Core ring, three hand-off keys, the Capture Line with a grammar switch, `Ctrl+Shift+D`.
**Accept:** every hand-off opens its target with context and a Back crumb and executes nothing; both halves hollow when empty.
**Tests:** vitest, Playwright. **Record:** research file.

### A.X03 Blueprint Editor, generator and print (UW8, UI lane)
**Files:** `app/ui/src/ww/study/{blueprint,generator,print}/**`, gallery entry. **Depends on:** Y01, D03. **Owner limits:** UI chat; takes `generator/**` from Y03. **Order:** UW8.
**Do:** 21.3.2 S4, S5 and S10: `BlueprintTable` and the editor overlay, the generator overlay with `SlotStrip`, the print stylesheet (A4, 18 mm margins) for paper, key, marking sheet and Night sheet through the browser's print to PDF; every call through `StudyPort`.
**Accept:** the preview's section count equals the PDF's; the lamp shows FAULT when unbalanced; Playwright prints a SIMULATED paper on the bench; unverified text prints as a crop.
**Tests:** vitest, Playwright. **Record:** research file.

### A.X06 Pattern Loom and Variant Bench (UW9, UI lane)
**Files:** `app/ui/src/ww/study/{patterns,variants}/**`, gallery entry. **Depends on:** Y01, AD08. **Order:** UW9.
**Do:** 21.3.2 S3 and S5: `PatternLoom`, `QuietList`, the five lenses with their footer, `VariantPair` with a word diff and check chips; a variant stays dashed until accepted.
**Accept:** the forbidden-word test; an arc only for pairs in at least 3 papers; "too few papers" below the floor.
**Tests:** vitest, forced colours. **Record:** research file.

### A.X08 Exam Hall and Marking Desk (UW10, UI lane)
**Files:** `app/ui/src/ww/focus/hall/**`, `ww/study/marking/**`, gallery entry. **Depends on:** Y02, Y01. **Order:** UW10.
**Do:** 21.3.2 S6 and S7: the paper track of `focus.session` registered through the tracks glob, `PaperClock`, the question list, the terminal strip, the Marking Desk with `RubricChips`; "Print the paper first" is the default start.
**Accept:** zero rAF at idle; `marked_by` is only `student` or `checker`; a question below half marks becomes a card.
**Tests:** vitest, Playwright. **Record:** research file.

### A.X10 Exam Room face (UW11, UI lane)
**Files:** `app/ui/src/ww/study/exam/**`, `ww/study/plan/faces/exam.face.tsx`, gallery entry. **Depends on:** Y03, D01 to D05, AD08. **Owner limits:** a face of `study.plan`; no new view id. **Order:** UW11.
**Do:** 21.3.2 S8 and S9: `CoverageQuilt`, `EvidenceTape`, the Readiness Ledger of three counts, five gaps, Tonight (offered, never opened by itself) and `NightSheet`.
**Accept:** the copy grep passes; the quilt is reachable by keyboard; no combined score; Tonight has no timer.
**Tests:** vitest, Playwright. **Record:** research file.

### A.C03 Intake UI, Course Mapper and provenance (UW8, UI lane)
**Files:** `app/ui/src/ww/study/library/**` (intake, coursemap, tab host), `shared/provenance/**`, gallery entry. **Depends on:** D03, D04, G01. **Owner limits:** owns the library tab host that Y03 gives up. **Order:** UW8.
**Do:** 21.4.2 S3, S4 and S6: `IntakeLedger`, `AttachmentLadder`, `ProvenanceChip`, `PasteParser`, `IcsPreview`, `ExportImportDrop`, `CourseMapRow`, the four doors, Accept and Decline, a fixture adapter on the bench and a null adapter otherwise.
**Accept:** all states in the gallery; the keyboard walk-through; 358 px reflow; no key fetches a file.
**Tests:** vitest, Playwright. **Record:** research file.

### A.C08 Connect Ladder, Link row, sync log and Delete sheet (UW11, UI lane)
**Files:** `app/ui/src/ww/study/library/connect/**`, `jarvis/console/connections/classroom/**`, `ww/study/ww-gcr.planned.ts`, gallery entry. **Depends on:** C03, J05, C06, C07. **Order:** UW11.
**Do:** 21.4.2 S1, S2, S7 and S8: `ConnectLadder` with the click-by-click text of 21.4.1, `ClassroomLink` with five states, `TokenAge`, `SyncLog`, `DeleteSheet`; the BLOCKED copy; the `ww.gcr` plate now opens the ladder.
**Accept:** five states reachable with a fake provider; step 4 only reads the path and reports present or absent; a scan after Delete is empty.
**Tests:** vitest, Playwright. **Record:** research file.

### A.AD08 Study adapters for EW7 (UW8, UI lane)
**Files:** `app/ui/src/ww/study/adapters/{pyq,review,generator}.{ts,register.ts}`, `e2e/exam-path.spec.ts`. **Depends on:** Y01, EW7 merged and its entries in the engine plan file. **Order:** UW8.
**Do:** implement `StudyPort` members `papers`, `questions`, `ingest`, `decide`, `crop`, `blueprints`, `generate`, `patterns`, `practiseNext` and `check` over the routes; map every answer to a lamp; the e2e spec drives the invented 6-question paper through drop, review, bank, blueprint, practice PDF and Drill.
**Accept:** milestone A passes; with the engine absent every screen shows WAITING; nothing enters the bank unreviewed.
**Tests:** vitest, Playwright. **Record:** research file.

### A.AD09 Adapters for EW8 and the From Classroom fold (UW9, UI lane)
**Files:** `app/ui/src/ww/study/adapters/{ocr,variants,intake}.{ts,register.ts}`, `ww/day/adapters/intake.register.ts`, `ww/day/classroom-fold/**`. **Depends on:** AD08, C03, L01, EW8 merged. **Order:** UW9.
**Do:** the OCR, variants and intake members of the ports; the From Classroom fold of the Day drawer and the notch kind `classroom`; `Plan a block` makes a hollow planned block linked by id.
**Accept:** a deadline never changes a counter; a Classroom "turned in" never draws the done disc; the Archive door lists before queueing.
**Tests:** vitest, Playwright. **Record:** research file.

### A.AD10 Adapters for EW9 (UW11, UI lane)
**Files:** `app/ui/src/ww/study/adapters/{harvest,queue,tonight}.*`, `ww/day/adapters/{intents,logs,term}.*`, `jarvis/console/adapters/google.register.ts`. **Depends on:** AD09, EW9 merged. **Order:** UW11.
**Do:** the harvester sources and manifest view, the review queue and Tonight, intents and recurrence, logs, the term arithmetic, and the OAuth status members.
**Accept:** each member has a null form; a source with no terms note shows off with its reason.
**Tests:** vitest. **Record:** research file.

### A.AD11 Adapters for EW10 and the reminder and link UI (UW12, UI lane)
**Files:** `app/ui/src/ww/day/adapters/{gcal,reminders,dashboards}.*`, `ww/day/link/**` (`LinkLamp`), `jarvis/reminders/**` (`ReminderChip`, `ReminderBell`), `shell/slots/notify.reminder.tsx`, `ww/tree/adapters/evidence.*`, `ww/study/adapters/classroom.*`. **Depends on:** AD10, EW10 merged, T01, L01. **Order:** UW12.
**Do:** the UI halves of E03, E04 and E09 and the Classroom sync and dashboard members; read-only first; the Calendar write switch stays off.
**Accept:** imported events carry the notch and the words "from Google" and never enter counts; the ladder of reminders is unchanged (a test enumerates it).
**Tests:** vitest, Playwright. **Record:** research file.

### A.AD12 Adapters for EW11 (UW13, UI lane)
**Files:** `app/ui/src/ww/career/adapters/*.register.ts`, `ww/study/coach/adapters/**`, `phone_page/adapters/**`. **Depends on:** AD11, EW11 merged. **Order:** UW13.
**Do:** career data with stamps, the Coach model path, the phone routes.
**Accept:** no Career cell without a stamp or the WAITING flag.
**Tests:** vitest. **Record:** research file.

### A.H01 Desk frame (UW12, UI lane)
**Files:** `app/ui/src/shell/desks/**`, `__tests__/shell/desks/**`, gallery entry. **Depends on:** N02. **Order:** UW12.
**Do:** 21.6: `DeskFrame` (head 52 px, body 612 px, Esc closes, focus trap), registered like the existing overlays.
**Accept:** a desk opens from a key and Esc closes it; `viewCount` is still 36; the focus trap test.
**Tests:** vitest, Playwright. **Record:** research file.

### A.H02 Term Ledger desk (UW13, UI lane)
**Files:** `app/ui/src/ww/study/term/**`, gallery entry. **Depends on:** H01, D03, D01, AD10. **Order:** UW13.
**Do:** 21.6 D1: the `LedgerTable`, `MarginMeter` with the printed formula, the next three exam days with free-gap hours, a PREVIEW of "what if I skip tomorrow", Trim keys for credits and rules.
**Accept:** a five-course fixture reproduces the hand-computed margins; WAITING "rule not set" with no default; 1366x768 without scroll.
**Tests:** vitest, Playwright. **Record:** research file.

### A.RW1 Rework wave (UW12, UI lane)
**Files:** the folders the slot-11 jury names (never `*.settings.ts` or `links.register.ts`). **Depends on:** the jury of UW11. **Order:** UW12.
**Do:** only the lowest-scored screens, taste and signature moments batched here; hard-gate failures are fixed inside their own wave.
**Accept:** each named screen's score goes up and no hard gate fails.
**Tests:** as the touched screens. **Record:** research file, the jury table.

### A.C01 Intake parsers (EW7, engine lane)
**Files:** `app/jarvis_app/ww_intake/{__init__,paste,ics,match}.py`, `app/tests/test_intake_parsers.py`. **Depends on:** none. **Owner limits:** engine chat; no network. **Order:** EW7.
**Do:** 21.4.3: the paste parser (a title, a date such as `18 Nov`, `18/11`, `Nov 18` or a weekday word, an optional time; an ambiguous date is returned both ways), the `.ics` parser (RFC 5545 unfolding, `VEVENT`, `RRULE` weekly and daily expanded for 120 days, anything else "repeats, not expanded", `Z` and `TZID`), the token-Jaccard name match.
**Accept:** 40 cases for each parser including a time-zone shift and an all-day event; an ambiguous date is never guessed.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.C02 Intake store and routes (EW8, engine lane)
**Files:** `app/jarvis_app/ww_intake/{store,routes}.py`, `routes_ww_intake.py`, tests. **Depends on:** C01, E05. **Order:** EW8.
**Do:** the tables `intake_events`, rows with source, state NEW, ACCEPTED, DECLINED, DONE-BY-GOOGLE and the attachment ladder; Take actions; the folder watch of E05 hands files over as rows with source `Folder`; Delete removes only files the application owns.
**Accept:** scratch-dir migration; nothing is written to the calendar or the question store until a row is accepted; Delete leaves files in his own folders.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.X04 OCR route (EW8, engine lane)
**Files:** `app/jarvis_app/ww_pyq/ocr.py`, `app/tests/test_pyq_ocr.py`. **Extends:** the OCR hook of `yaadash/library.py` (`ocr_available`, `_ocr_page`): `ocr.py` is the engine behind that hook, so the Library and the paper ingest share one OCR. **Depends on:** E06. **Owner limits:** RapidOCR with onnxruntime (GPU build) is approved; measure the install size and the VRAM used, and write both to the research file before merging; it asks the GPU loader (JH04, or a free-memory check until then) and never evicts a resident model. **Order:** EW8.
**Do:** `ocr_page(png: bytes) -> OcrResult` with per-line confidence; every OCR text is `unverified` and the crop is kept; with no engine a page reports FAULT and the rest of the paper imports; a CPU fallback is labelled in the trace.
**Accept:** a fixture scan of 3 pages gives words and confidences; all text is `unverified`; pages per second and VRAM are recorded.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.X07 Variants and rubric drafts (EW8, engine lane)
**Files:** `app/jarvis_app/ww_pyq/{variants,rubric}.py`, tests. **Extends:** `ww_counsel.py` (the only module that calls a model: Ollama on loopback, JSON output, validated, `no_model` and `unparsed` failures; a new prompt file under its `prompts/` folder, no second model client) and `ww_numericals.make` for numerical variants. **Depends on:** E08. **Order:** EW8.
**Do:** 21.3.3: numerical variants from the templates only; descriptive variants from the 4B model with "same concept, same marks, new context" and a 5-word-shingle Jaccard between 0.2 and 0.7; rubric points that sum to the question's marks; status pending, accepted, rejected; the rules-only switch removes every `MODEL` path.
**Accept:** the Jaccard band is enforced; no draft enters the bank without Accept; the exam path passes with the switch on.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.E17 Classroom export import (EW8, engine lane)
**Files:** `app/jarvis_app/ww_pyq/takeout.py`, tests with invented fixtures. **Depends on:** E05. **Order:** EW8.
**Do:** read a Classroom export `.zip` that he made himself: list its files before anything is queued, queue each as PENDING, refuse path escapes and cap the size; nothing is extracted until he accepts a row.
**Accept:** the zip is listed first; a fixture with a `../` entry is refused; attachments owned by others may be absent (unverified) and the listing says so.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.M01 Exam path test (EW8, engine lane)
**Files:** `app/tests/test_exam_path.py` and its fixtures under `app/tests/pyq_fixtures/exam_path/**`. **Depends on:** E05 to E08. **Order:** EW8.
**Do:** drive the invented paper through ingest, review, bank, blueprint, generate and print with the model off.
**Accept:** the forbidden-word grep over every output, the PDF header text "Practice paper from your bank. Not an official paper.", and the generated blueprint equals the source paper's.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.HV01 Harvester core v2 (EW8, engine lane)
**Files:** `app/jarvis_app/ww_harvest.py`, `routes_ww_harvest.py`, `ww_check_harvest.py`, tests. **Depends on:** none (extends the built module). **Owner limits:** every source off by default; a local copy only on a second switch (D-V3-11); PyMuPDF replaces `pdftotext` by `pdf_text` calling E06's `read_pdf_text`, not a second reader. A fetched item enters the same ingest and the same review Store as a dropped file; a local copy of a third-party paper is never a `ww_bank_store` record (the store refuses it), so the "pointers only" rule for GATE holds in the bank and the local copy lives in the private papers folder. **Order:** EW8.
**Do:** 21.3.6: the per-source adapter interface (`name`, `rights`, `terms_note`, `index`, `fetch`), the manifest, the switches, the rate rules (1 request per 3 seconds per host, 200 a day, robots, backoff, a stop on a second 403 or 429), the drop-in path and its routes; the earlier rules of the module stay.
**Accept:** zero sockets with every source off; a source without a terms note stays off with the reason; a `robots.txt` disallow stops the path; a manual file joins the manifest as `source: manual`.
**Tests:** pytest against invented pages and a fake host, never the network. **Record:** the engine chat's research file; the terms read per source.

### A.HV02 Harvester adapters (EW9, engine lane)
**Files:** `app/jarvis_app/ww_harvest_sources/**`, tests with recorded invented pages. **Extends:** `ww_harvest.py` (the existing `SOURCES` dict and `fetch_<source>(h, st, it, gm, limit, recs)` pattern; each adapter module registers one entry and one fetch function and `ww_harvest.py` is edited only by HV01). **Depends on:** HV01. **Owner limits:** each adapter is written against the real page only after he has switched that source on and read its terms. **Order:** EW9.
**Do:** adapters for the university's question-paper site, GATE, GRE (only what the publisher offers publicly) and the dMAT source, each with its `terms_note`; anything that is not offered stays manual drop-in.
**Accept:** each adapter indexes a fixture page and fetches into the manifest; no adapter runs unswitched.
**Tests:** pytest. **Record:** the engine chat's research file (what was and was not verified per site).

### A.C06 Google OAuth core (EW9, engine lane, Opus: security-sensitive)
**Files:** `app/jarvis_app/ww_google/{__init__,oauth,token_store,fake}.py`, `routes_ww_google.py`, tests. **Depends on:** none. **Owner limits:** the owner signs in himself; the assistant never types, reads or stores a credential; installs are `google-auth-oauthlib`, `google-api-python-client` and `keyring` only. **Order:** EW9.
**Do:** 21.4.3: read `data/ww/google/client.json` in memory, a loopback listener on a random port for 5 minutes with PKCE and `state`, the refresh token in the credential store, the scope registry (read-only constants), revoke, a fake provider that reaches PLANNED, WAITING, LIVE, FAULT and BLOCKED; one module that E04 and C07 import.
**Accept:** a scope-list test fails on any `drive` or write scope while the switch is off; a scan finds no secret in the repository or in plain text under `data/`; `invalid_grant` gives WAITING.
**Tests:** pytest with the fake provider. **Record:** the engine chat's research file (what was and was not verified about Google's scopes).

### A.C07 Classroom sync (EW10, engine lane, Opus: security-sensitive)
**Files:** `app/jarvis_app/ww_gcr/{client,sync,map}.py`, `routes_ww_gcr.py`, tests. **Depends on:** C02, C06. **Order:** EW10.
**Do:** 21.4.3: the sync rules (start, Sync now, at most 4 a day), the upsert by key, `DELETED` handling, local time conversion, backoff, the log of counts only, course-to-subject mapping by token Jaccard (0.6 suggests), Disconnect and Delete.
**Accept:** the fake provider yields 6 courses and 41 items with a `DELETED` item and a quota retry in at most 25 calls; no title or text in the log; a scan after Delete finds no course id.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.X09 Readiness, Tonight and the review queue (EW9, engine lane)
**Files:** `app/jarvis_app/ww_pyq/{readiness,tonight}.py`, `ww_review/**`, `routes_ww_review.py`, tests. **Extends:** `ww_learning.py` (its Leitner-box recall becomes a producer of cards into the one `fsrs` queue, or delegates its interval function to it: D-V3-14). **Depends on:** E07, E08. **Owner limits:** `fsrs` is approved. **Order:** EW9.
**Do:** 21.3.3: practised weight, evidence and five gaps (counts only), the Night sheet lists, one queue with `fsrs` default parameters (desired retention 0.90, chip `DEFAULT`) fed by the question bank, reading prompts, language cards and letters.
**Accept:** no combined score in any output; pure functions run twice; no decimal on retention; an AST check finds one scheduler.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.H03 Term arithmetic and store (EW9, engine lane)
**Files:** `app/jarvis_app/ww_term/**`, `routes_ww_term.py`, tests. **Extends:** `ww_attendance.py` (it already computes, per subject, the classes of margin above the college's threshold from the typed rule: `ww_term` imports that arithmetic for `missable` and adds courses, credits and internals; a second margin formula is a review failure). **Depends on:** none. **Order:** EW9.
**Do:** 21.6 D1: courses, credits, typed rules with a source note, `missable = floor(attended / minPct - held)` with its terms, internals as a weighted sum of typed marks; nothing projects a grade.
**Accept:** boundary tests (held 0, minPct 0, attended above held); WAITING when the rule is unset.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.DB11 Dashboard aggregations and Next Three (EW10, engine lane)
**Files:** `app/jarvis_app/ww_dash/**`, `routes_ww_dash.py`, tests. **Extends:** `ww_director.py` (the existing ordered next-action list is the candidate source for Next Three), `ww_insight.py` (the weekly review: this week against the seven days before, totals, what moved and stalled: the Week Review aggregation calls it), `ww_season.py` (the season and evening state: Exam Season reads it) and `ww_exams.py`; `ww_dash` adds the month sky, the strata inputs and the Next Three scoring only. **Depends on:** E07, E08, H03. **Order:** EW10.
**Do:** 21.5.9: pure aggregations (week strata, month sky, season coverage, system strata inputs) over the append-only log, and the Next Three scoring (+3, +2, +2, +1, one per subject, ties by due date then id).
**Accept:** deterministic snapshots; byte-identical Next Three with the model off; fewer than three is shown as fewer.
**Tests:** pytest snapshots. **Record:** the engine chat's research file.

### A.JH01 Voice study intents (EW10, engine lane)
**Files:** `core/intents/**`, `core/tests/test_intents.py`. **Extends:** the intent handling already in `core/agent.py` and `core/away_mode.py` (read both first: register the four phrases there, no second dispatcher) and `core/hinglish.py`. **Depends on:** E08. **Owner limits:** engine half only; the Core card is reserve (JH01u). **Order:** EW10.
**Do:** 21.7 H10: a closed grammar compiled to regex with slots for `quiz me`, `read my plan`, `start a focus block`, `what is due` and `stop`; the checker marks, never the model; the banned-word lint.
**Accept:** 20 sample sentences recognised; unrecognised speech returns the list of four; no result promise.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.JH03 Notices read model (EW11, engine lane)
**Files:** `core/notify_read/**`, tests. **Depends on:** E03. **Order:** EW11.
**Do:** 21.7 H4: a read model over the events table with tags `[REM]`, `[RUL]`, `[JOB]`, `[SYS]`, `[WW]`, receipts and counts; no new escalation.
**Accept:** every ladder step appears as a receipt; counts only.
**Tests:** pytest. **Record:** the engine chat's research file.

### A.JH04 GPU readings and loader refusal (EW11, engine lane)
**Files:** `core/gpu/**`, tests. **Extends:** `core/ollama_guard.py` (keeps the model server up; the refusal rule asks it what is loaded) and `core/whisper_load.py` (the GPU/CPU choice for Whisper): `core/gpu` is the one place that answers "does this fit", and those two call it, they are not copied. **Depends on:** none. **Order:** EW11.
**Do:** 21.7 H9: the VRAM reading, the resident model list, the refusal rule (requested size plus 0.5 GB at most free), `free gpu`, `unload`, `load`, idle unload (default 10 minutes); X04 and B12p call it.
**Accept:** a load that does not fit is refused with the numbers; nothing is evicted silently.
**Tests:** pytest with a fake reading. **Record:** the engine chat's research file (the 0.5 GB margin is unmeasured).

### A.B09p Phone routes, revised (EW11, engine lane)
**Files:** `app/jarvis_app/routes_phone*.py`, tests. **Depends on:** the earlier engine waves. **Order:** EW11. **Do** and **Accept** as A.B09's Python half (the phone page routes behind one palette); its UI half is A.B09 in UW13. **Tests:** pytest. **Record:** the engine chat's research file.

### A.B12p Coach model path (EW11, engine lane)
**Files:** `app/jarvis_app/ww_coach.py`, tests. **Depends on:** E07, E08, JH04. **Owner limits:** a model install needs the owner's OK. **Order:** EW11. **Do** and **Accept** as A.B12's Python half (every output carries `MODEL` and a source link; the model unloads after idle; a rules-only switch); its UI half is A.B12 in UW13. **Tests:** pytest. **Record:** the engine chat's research file.

---

## Appendix B Research index

All research lives in `docs/research/product-design-overhaul.md` (one dated section, 2026-11-12, with the seven strands below, about 130 sources and 37 repositories checked through the GitHub API). Strand 0 is a read-only audit of the code; the others are web research. The ten decisions the research file lists under "What it changed" are mapped to sections of this file in the second table. Private material (the reference collages and their per-picture notes) lives in the private notes folder and is not indexed here.

| Strand | Title in the research file | What this specification takes from it | Main sections |
|---|---|---|---|
| 0 | The current carcass (read-only code audit) | Section and page inventory, what the Well Wisher frame already provides, the voice pipeline as built, performance facts (bundle sizes, fonts, polls), phone pages, what to preserve, change or mark as faked, file index | §3, §4, §5, §9.1, §14 |
| 1 | Premium personal operating systems, voice interfaces, focus products and companions | Principles for instrument tempo, resume, urgent controls outside views, memory as ownership, setup cost as a documented complaint, the farewell-audit finding | §1, §2, §3, §4 |
| 2 | Visual and interaction references beyond the owner library | Neumorphic contrast numbers (1.27:1 and 1.72:1), the "do not" list for sensing art, dithering and halftone techniques (Bayer, Atkinson run offline only) | §6, §8 |
| 3 | Open-source projects to learn from or reuse | No maintained accessible neumorphic kit, so components are built in-house; licence cautions (AGPL, GPL, non-commercial, unlicensed) | §7, §12, §19 |
| 4 | Ethical retention and task follow-through for ADHD-like attention difficulties in students | USE, TEST and NEVER lists, the say and do-not-say list, notification budget, rewards rule | §2.4, §2.5, §13.7 |
| 5 | Where a model belongs, and where a rule is better | The AI placements, FSRS, VAD and wake word, the 4B drafting model, the Hinglish embedding A/B, proficiency and next-action rules | §13 |
| 6 | Accessibility, keyboard, motion, contrast and performance budgets for a WebView2 desktop app | Forced colours, reflow, keyboard rules, Pause/Stop/Hide, idle and hidden budgets, the proposed budget table (targets) | §10, §11, §14 |

| Research decision (the research file's own numbering) | Where it lands |
|---|---|
| 1 The voice visual needs a new real signal | §9, D23, F7 |
| 2 Depth is never the only cue | §6.1, §6.3, §6.4.4 |
| 3 Forced colours are a first-class theme | §6.5, §11.6 |
| 4 No-scroll canvas plus reflow | §3.3, §11.1, D6 |
| 5 Ambient art obeys Pause/Stop/Hide | §8.1, §10.6 |
| 6 Models only where they win | §13 |
| 7 Retention without coercion | §2.4, §2.5 |
| 8 Award sites are taste references, not engineering ones | §10, §19 |
| 9 Build in-house, borrow ideas | §7, §19 |
| 10 Separability needs real cuts | §1.4, §5.7 |

New research written because of this specification goes into the same file as a dated section on top, or into `docs/research/voice.md` for the voice measurements and `docs/research/well-wisher.md` for Well Wisher (the prompts in Appendix A name the file for each work package).


---

## Appendix C Asset assignment table (generated)

Generated from `asset-assignments.json` by `tools/art/count_assets.py` (first version produced with this review; regenerate it, never edit it by hand). It lists all 186 catalogue ids so the specification alone can prove the mapping the brief requires. **Trait** is the one trait taken from the picture, copied from the JSON `purpose` field. Track labels are the script's classification, not a legal finding (§8.6.4); "customer-safe after redraw" means a candidate for per-file review.

Counts: sections career 8, console 15, core 13, day 12, deck 36, focus 5, memory 12, phone 4, proof 5, room 13, senses 14, settings 4, shell 32, study 9, tree 4. Uses component reference 111, derivative:ascii 18, derivative:contour 18, derivative:halftone 12, composite 11, derivative:duotone 8, derivative:terminal 3, direct 3, crop 2. Tracks customer-safe after redraw 119, reference-only 50, private-only 14, customer-safe (public domain) 3.
Refusals (deck use "rejected directions"): 25 in all, 24 in the deck section and 1 elsewhere (`room`, the lens). Deck section: 36 pictures, so 12 mood boards and technique samples.

| Id | Section | Use | Track | Deck use | Trait taken |
|---|---|---|---|---|---|
| C01-01 | phone | component reference | customer-safe after redraw | mobile: Block | Lock-screen state of the Block tab |
| C01-02 | core | component reference | customer-safe after redraw | components: sound | Round disc and orbit for the sound view; the disc turns only while audio plays |
| C01-03 | shell | derivative:duotone | customer-safe after redraw | derivatives: duotone | Background for the first-run choice of block length |
| C01-04 | study | component reference | customer-safe after redraw | components: dial and ring | Day ruler with hour ticks |
| C01-05 | day | component reference | customer-safe after redraw | components: numerals | Big minutes-left numeral next to the Start button |
| C01-06 | core | component reference | customer-safe after redraw | components: dial and ring | Dial grammar for the Wake and Sleep control |
| C01-07 | day | component reference | customer-safe after redraw | components: widgets | Upper limit of widget count per scene |
| C01-08 | room | component reference | customer-safe after redraw | components: icons | Light, fan, charger and speaker icons |
| C01-09 | shell | derivative:terminal | customer-safe after redraw | derivatives: terminal | 404 screen for an unknown deep link, with one link back |
| C01-10 | day | component reference | customer-safe after redraw | components: type | Vertical day names in the week strip |
| C01-11 | deck | component reference | reference-only | rejected directions | Tone refused |
| C01-12 | deck | component reference | reference-only | rejected directions | Tone refused |
| C01-13 | deck | component reference | reference-only | rejected directions | Tone refused |
| C01-14 | core | component reference | customer-safe after redraw | components: loaders | Wake loader lines: heard, working, done as three plain rows |
| C01-15 | deck | component reference | reference-only | worlds: Foundation | Mood board |
| C01-16 | shell | component reference | customer-safe after redraw | components: rail | Rail layout |
| C01-17 | room | component reference | customer-safe after redraw | foundation: material | Matte black and white material pair for the dark faceplate |
| C01-18 | shell | derivative:contour | customer-safe after redraw | worlds: Foundation | Watermark glyphs |
| C01-19 | core | component reference | customer-safe after redraw | components: sound | Radio dial scale for the volume and station readout |
| C01-20 | room | derivative:duotone | customer-safe after redraw | derivatives: duotone | Plate seam texture, 12 % opacity |
| C01-21 | shell | component reference | customer-safe after redraw | foundation: material | Visual test of the two surfaces |
| C01-22 | room | component reference | customer-safe after redraw | mobile: Room | Phone Room tab layout reference |
| C01-23 | room | composite | private-only | worlds: Room | Faceplate that holds the real eight keys, each lamp following the board report |
| C01-24 | shell | derivative:duotone | customer-safe after redraw | derivatives: duotone | Backdrop of the optional hardware step; the step says the app works without the board |
| C01-25 | room | component reference | reference-only | rejected directions | Recorded as a rejected cue: no lens or camera form anywhere |
| C01-26 | phone | component reference | customer-safe after redraw | mobile: Today | Phone Today tab layout |
| C02-01 | deck | component reference | reference-only | worlds: Console | Mood board |
| C02-02 | core | composite | private-only | worlds: Core | The hill silhouette that the real analyser level raises; the still is the labelled no-signal form |
| C02-03 | shell | component reference | customer-safe after redraw | components: buttons | Button states |
| C02-04 | shell | component reference | customer-safe after redraw | foundation: tokens | Token documentation layout |
| C02-05 | core | component reference | customer-safe after redraw | components: palette | Ask group layout inside Ctrl+K |
| C02-06 | core | crop | private-only | worlds: Core | Three ridges become input, output and band-spectrum rows once the output signal exists |
| C02-07 | core | component reference | customer-safe after redraw | components: dial and ring | Ring bezel for the Ask orb and the hill base ring |
| C02-08 | study | component reference | customer-safe after redraw | components: pattern cards | Each subject gets a stable line pattern |
| C02-09 | day | component reference | customer-safe after redraw | components: radar | Wheel of areas with counts of completed planned actions |
| C02-10 | senses | derivative:contour | customer-safe after redraw | worlds: Senses | Atmosphere behind the twin |
| C02-11 | shell | derivative:halftone | customer-safe after redraw | derivatives: halftone | Shared tiles for empty states and meters |
| C02-12 | console | component reference | customer-safe after redraw | components: dial and ring | Gauge for VRAM in use |
| C02-13 | deck | component reference | reference-only | worlds: Proof | Mood board for ridgeline style charts |
| C02-14 | shell | component reference | customer-safe after redraw | components: toast | Notched frame for toasts and nudges |
| C02-15 | proof | component reference | reference-only | components: stat card | Stat card layout |
| C02-16 | proof | component reference | reference-only | components: stat card | Stat card hierarchy |
| C02-17 | proof | component reference | customer-safe after redraw | components: stat card | Bars of logged minutes |
| C02-18 | shell | component reference | customer-safe after redraw | foundation: tokens | Token source for ground, raised and sunk |
| C02-19 | room | component reference | customer-safe after redraw | foundation: material | Raised clay key reference with measured shadow pair |
| C02-20 | room | component reference | customer-safe after redraw | components: dial and ring | Dial plus mode readout |
| C02-21 | shell | component reference | customer-safe after redraw | foundation: tokens | Dark theme shadow tokens |
| C02-22 | settings | component reference | customer-safe after redraw | components: label plates | Label strips |
| C02-23 | shell | component reference | customer-safe after redraw | components: controls | Form controls |
| C02-24 | proof | composite | private-only | worlds: Proof | Real numbers as embossed bars with a caption on every ring |
| C02-25 | settings | component reference | customer-safe after redraw | components: label plates | Plate for the data-location statement |
| C02-26 | shell | component reference | customer-safe after redraw | foundation: tokens | Elevation recipe check |
| C02-27 | shell | component reference | customer-safe after redraw | foundation: tokens | Emboss recipe for the Proof ring |
| C02-28 | room | component reference | customer-safe after redraw | components: keys | Key cap shape and press travel (2 px) |
| C02-29 | console | component reference | customer-safe after redraw | components: HUD frame | Layout of crew list against one status display |
| C02-30 | settings | component reference | customer-safe after redraw | components: label plates | Plate with version and build |
| C02-31 | deck | component reference | reference-only | foundation: material | Mood board |
| C02-32 | room | component reference | customer-safe after redraw | components: modes | Modes list layout in rules |
| C02-33 | console | component reference | customer-safe after redraw | components: readout | Recessed dot-matrix readout |
| C02-34 | day | component reference | customer-safe after redraw | components: numerals | Large time readout |
| C02-35 | room | component reference | customer-safe after redraw | components: empty states | Layout for the no-board-found empty state with planned dashed tiles |
| C02-36 | career | component reference | customer-safe after redraw | components: keys | Numeric keypad for the budget entry sheet |
| C02-37 | console | component reference | customer-safe after redraw | components: label plates | Board spec sheet layout |
| C02-38 | day | component reference | customer-safe after redraw | components: calendar | Week and month layout |
| C02-39 | day | component reference | customer-safe after redraw | components: widgets | Now chip: time, class and next gap |
| C02-40 | proof | component reference | customer-safe after redraw | worlds: Proof | Header of the Wins card with counts of completed planned actions |
| C02-41 | shell | component reference | reference-only | foundation: tokens | Accent token source |
| C02-42 | shell | component reference | reference-only | foundation: tokens | Ink token source |
| C02-43 | phone | component reference | customer-safe after redraw | mobile: More | Chamfer on the phone cards |
| C02-44 | shell | component reference | reference-only | foundation: tokens | Ground token source |
| C02-45 | phone | component reference | customer-safe after redraw | mobile: Today | Dot clock on the phone Today tab |
| C02-46 | room | component reference | customer-safe after redraw | components: controls | Control family for modes and dimmer |
| C02-47 | settings | component reference | reference-only | components: anatomy | Format for component anatomy docs |
| C02-48 | shell | component reference | reference-only | foundation: tokens | Clay grey token source |
| C03-01 | core | derivative:contour | customer-safe after redraw | derivatives: contour | Transition from asleep to listening |
| C03-02 | career | derivative:contour | customer-safe after redraw | worlds: Career | Detail plate |
| C03-03 | senses | derivative:contour | customer-safe after redraw | derivatives: contour | Floor rings behind the two-minute baseline timer |
| C03-04 | senses | derivative:contour | customer-safe after redraw | worlds: Senses | Calibration progress: rings fill with the count of quiet frames received |
| C03-05 | study | derivative:contour | customer-safe after redraw | worlds: Study | Exam dates on a wheel; spokes are real dates |
| C03-06 | senses | derivative:contour | customer-safe after redraw | worlds: Senses | Sigil ring frame around the Teach this quiet baseline control |
| C03-07 | tree | derivative:contour | customer-safe after redraw | worlds: Tree | First step of the fixed reward sequence, shown once |
| C03-08 | focus | composite | private-only | worlds: Focus | One dot per minute; silent end; early end leaves partial dots |
| C03-09 | deck | component reference | reference-only | rejected directions | Tone refused |
| C03-10 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C03-11 | focus | derivative:duotone | customer-safe after redraw | worlds: Focus | Backdrop of the log minutes sheet |
| C03-12 | deck | component reference | reference-only | rejected directions | Kept in the deck as a refused tone |
| C03-13 | deck | component reference | reference-only | rejected directions | Recorded to avoid body or pose imagery |
| C03-14 | senses | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Backdrop for the plain instruction to leave the room quiet |
| C03-15 | senses | derivative:contour | customer-safe after redraw | worlds: Senses | Shows the transmitter, receiver and the zone one link can sense |
| C03-16 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C03-17 | memory | derivative:halftone | customer-safe after redraw | derivatives: halftone | Empty belief queue: no questions waiting |
| C03-18 | console | derivative:halftone | customer-safe after redraw | derivatives: halftone | Header of a connected device row |
| C03-19 | memory | derivative:contour | customer-safe after redraw | derivatives: contour | Empty search state: nothing remembered about that yet |
| C03-20 | shell | derivative:halftone | customer-safe after redraw | derivatives: halftone | Route transition frame |
| C03-21 | tree | derivative:contour | customer-safe after redraw | worlds: Tree | Lines radiate from a node only after it is mastered |
| C04-01 | shell | component reference | customer-safe after redraw | components: controls | Control set |
| C04-02 | console | component reference | customer-safe after redraw | components: HUD frame | Frame for each crew member glyph |
| C04-03 | console | component reference | reference-only | components: cell grid | Layout of boards as bordered cells |
| C04-04 | career | component reference | reference-only | foundation: type | Optional serif test reference |
| C04-05 | focus | derivative:halftone | customer-safe after redraw | worlds: Focus | Ring around the Start session control |
| C04-06 | senses | composite | private-only | worlds: Senses | Abstract signal body: orbit speed follows measured motion energy, SIMULATED stamp when simulated |
| C04-07 | shell | component reference | customer-safe after redraw | components: error | Error and fault dialog frame |
| C04-08 | deck | component reference | reference-only | worlds: Senses | Mood board |
| C04-09 | study | component reference | reference-only | foundation: texture | Grain tile generator target |
| C04-10 | console | composite | private-only | worlds: Console | The text-first frame for health lines and the event log |
| C04-101 | day | derivative:duotone | customer-safe after redraw | derivatives: duotone | Empty plan state before the student chooses starts |
| C04-102 | deck | derivative:halftone | reference-only | derivatives: halftone | Technique sample |
| C04-103 | deck | component reference | reference-only | worlds: Foundation | Mood board |
| C04-104 | room | derivative:contour | customer-safe after redraw | worlds: Room | Art on the planned Away mode card |
| C04-105 | console | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Art on the planned Agents card |
| C04-106 | console | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Empty state |
| C04-107 | deck | component reference | reference-only | worlds: Foundation | Mood board |
| C04-108 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-109 | shell | derivative:halftone | customer-safe (public domain) | derivatives: halftone | Welcome to Well Wisher |
| C04-11 | deck | component reference | reference-only | worlds: Focus | Mood board |
| C04-110 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-111 | deck | derivative:contour | reference-only | derivatives: contour | Technique sample |
| C04-112 | deck | component reference | reference-only | rejected directions | Tone refused |
| C04-113 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Atmosphere behind unresolved beliefs, amber label separate |
| C04-114 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-115 | career | component reference | reference-only | components: route arcs | Arcs from now to application dates |
| C04-116 | career | composite | private-only | worlds: Career | Skyline of the road; a tower lights only when its real item is done |
| C04-117 | core | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Now-playing glyph for local files; one of two note glyphs |
| C04-118 | career | derivative:halftone | customer-safe after redraw | derivatives: halftone | Empty state before any stage exists |
| C04-119 | memory | composite | private-only | worlds: Memory | A fixed branch whose twigs dissolve into letters; bound to no count, so deleting data never shrinks it and storing data is never rewarded |
| C04-12 | focus | derivative:halftone | customer-safe after redraw | worlds: Focus | Paused state marker |
| C04-120 | core | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Paused-state note glyph, heavier weight so pause reads without colour |
| C04-121 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-122 | career | derivative:contour | customer-safe after redraw | worlds: Career | Plate for a cert with no progress yet |
| C04-123 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | A readout glyph holding the real item counts as digits; it does not grow or shrink as a picture, and the caption states the encoding |
| C04-124 | shell | direct | private-only | worlds: Core | First-run scene before Wake |
| C04-125 | core | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Sleeping scene shown when JARVIS is asleep; static, no animation |
| C04-126 | shell | derivative:terminal | customer-safe after redraw | derivatives: terminal | Route transition frame |
| C04-127 | senses | derivative:contour | customer-safe after redraw | derivatives: contour | Decorative frame for the signal strip |
| C04-128 | deck | component reference | reference-only | rejected directions | Rights and honesty risk recorded |
| C04-129 | deck | component reference | reference-only | worlds: Career | Mood board |
| C04-13 | console | component reference | customer-safe after redraw | components: HUD frame | Label-around-object layout for the ESP32 and relay board |
| C04-130 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-131 | deck | component reference | reference-only | rejected directions | Tone refused |
| C04-132 | deck | component reference | reference-only | rejected directions | Recorded to avoid body or pose imagery |
| C04-133 | memory | derivative:halftone | customer-safe after redraw | derivatives: halftone | Header of the printable export |
| C04-134 | deck | component reference | reference-only | rejected directions | Tone refused |
| C04-14 | console | component reference | customer-safe after redraw | components: label plates | Capsule chip for firmware and board identity |
| C04-15 | senses | component reference | customer-safe after redraw | components: channel matrix | Channel matrix cell grammar |
| C04-16 | console | component reference | customer-safe after redraw | components: terminal frame | Frame for the full-screen events overlay |
| C04-17 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-18 | console | component reference | customer-safe after redraw | components: HUD frame | Corner brackets for boards and ports panel |
| C04-19 | study | component reference | customer-safe after redraw | worlds: Study | Visual for stacked day blocks |
| C04-20 | shell | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Welcome to the voice |
| C04-21 | senses | derivative:contour | customer-safe after redraw | derivatives: contour | Zone ring style |
| C04-22 | study | derivative:duotone | customer-safe after redraw | derivatives: duotone | Art on the planned Coach card, which explains it is not built |
| C04-23 | study | composite | private-only | worlds: Study | One layer per syllabus unit, raised by real covered topics |
| C04-24 | console | component reference | customer-safe after redraw | components: HUD frame | Division of the connections view into viewport and strip |
| C04-25 | shell | component reference | customer-safe after redraw | components: loaders | Loader frame for the boot sequence |
| C04-26 | deck | component reference | reference-only | rejected directions | Kept in the deck as the explicit no-camera refusal |
| C04-27 | senses | component reference | customer-safe after redraw | worlds: Senses | Floor grid of the spatial twin |
| C04-28 | senses | component reference | customer-safe after redraw | components: parameter strip | Strip of teach settings |
| C04-29 | deck | component reference | reference-only | foundation: type | Type scale mood board, not shipped |
| C04-30 | shell | derivative:halftone | customer-safe after redraw | derivatives: halftone | Grain strip at the bottom of empty states |
| C04-31 | study | derivative:contour | customer-safe after redraw | derivatives: contour | Searching state of Interrogation |
| C04-32 | career | direct | customer-safe (public domain) | worlds: Career | Header for Goals and Parking |
| C04-33 | study | component reference | reference-only | components: icons | Icon grammar for library chips |
| C04-34 | deck | component reference | reference-only | rejected directions | Tone refused |
| C04-35 | shell | component reference | customer-safe after redraw | components: progress | Progress bar grammar |
| C04-36 | senses | component reference | reference-only | components: line weave | Line-weave idea for the history strip, drawn from measured data only |
| C04-37 | day | composite | private-only | worlds: Day | Sun whose rays count completed blocks today; a pure function of today's count (the date is a data-layer input), never dims because time passed |
| C04-38 | focus | crop | private-only | worlds: Focus | Rest screen scene |
| C04-39 | day | derivative:duotone | customer-safe after redraw | worlds: Day | Illustration beside Rest days are part of the week |
| C04-40 | tree | component reference | customer-safe after redraw | worlds: Tree | Node fill pattern |
| C04-41 | senses | derivative:halftone | customer-safe after redraw | worlds: Senses | The still static field that marks WAITING: expected signal has not arrived |
| C04-42 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-43 | day | direct | customer-safe (public domain) | worlds: Day | Night backdrop of the close-the-day view; re-source the public-domain painting for release |
| C04-44 | tree | composite | private-only | worlds: Tree | Trunk height follows the nodes the student marked mastered; a pure function of the current marks, never changes with time |
| C04-45 | deck | component reference | reference-only | rejected directions | Rights risk recorded |
| C04-46 | day | derivative:duotone | customer-safe after redraw | derivatives: duotone | Empty state for the body view before any entry |
| C04-47 | shell | derivative:terminal | customer-safe after redraw | derivatives: terminal | FAULT scene when a source reported an error, with the reason in text |
| C04-48 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Placeholder when a person has no photo |
| C04-49 | shell | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Route transition frame |
| C04-50 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Soft backdrop behind the belief card stack |
| C04-51 | deck | component reference | reference-only | rejected directions | Tone refused |
| C04-52 | shell | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Route transition frame |
| C04-53 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Export-ready marker beside the Export button |
| C04-54 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Archive box glyph for Export everything |
| C04-55 | core | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Empty state when nothing is playing; wings are static |
| C04-56 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | No results found state; plain sentence stays above it |
| C04-57 | memory | derivative:ascii | customer-safe after redraw | derivatives: ASCII | Honest progress of a real export: position is the real fraction |

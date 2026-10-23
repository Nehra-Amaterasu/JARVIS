# Mission Germoney

## v2 (2026-10-23): the tree, not a list of strings

Season One's labels changed but its data did not: contracts came from a fixed pool
of strings, the "skill tree" was a reading page, and contracts, bosses and the tree
were not connected. v2 rebuilds the data model and the engine underneath. Research,
sources and numbers: `docs/research/2026-10-23-mission-germoney-rebuild.md`.

**The data bank.** `app/ui/src/germoney/data/bank/*.json` (skill tree, careers,
certificates, resources, the maths track) is written by research agents and loaded by
two validators that agree: `data/bank.ts` (the window) and `germoney.merge_bank`
(the server), tested against the same fixtures. Any subset of files works. An
unknown id is a warning and the reference is dropped, so a typo never locks a node.
A prerequisite cycle is an error. Private academics (`data/app/germoney/academics/`)
are served by the server only and never bundled.

**The skill tree is a DAG.** A node is *locked* until every prerequisite is
*mastered*, then *available*, then *in progress* (at most 3 at once), then
*mastered* (every contract done, or marked). A node carries what was earned on it:
certificates, shipped projects and achievements, each with its link. The Tree screen
draws it the way Assassin's Creed Origins and Cyberpunk 2077 do: a trunk, one branch
per discipline, tiers as rings, prerequisite edges, and a career overlay (VLSI design
vs AI-hardware architect) that makes heavily weighted nodes glow. It is one SVG, and
every node is a focusable button that the arrow keys move between.

**The contract engine** (server, `germoney.py`, "the plan engine") makes the day.
- *Library block* (3 h, weekdays): the day's rotation track (default Mon digital/HDL,
  Tue maths, Wed ML/DL, Thu academics, Fri comp-arch/RISC-V/security; editable). It
  resumes in-progress nodes first, then picks by career weight, membership of an
  active campaign and staleness. A new node is started only while the WIP cap has
  room. Next week resumes where this week stopped.
- *Evening block*: practice questions + JARVIS, i.e. spaced recall on a node from
  another track (or, in exam mode, the maths rescue's foundation feed or past papers).
- *Protected slot*: social/rest, never filled. *Weekends*: one small contract.
- *Every contract carries its context*: what to read first (the node's primary
  lesson and the lesson of each prerequisite it builds on), a backup resource, legal
  PDFs, steps, a hint, and a "done when" check.
- *The day is frozen* once made, so finishing one contract never reshuffles the rest.
- *Exam mode* comes from academics: the plan's phase for today (internals sprint,
  internals week, re-sit-first build, re-sit crunch, exam window) sets the library
  blocks. A maths re-sit is served from the rescue triage as real bank contracts.
  Without a phase, an exam within 14 days takes over, re-sits first. "Exam mode for
  <subject>" forces it. Dates he sets (including the re-sit block) live
  in `overrides.json` and survive a rewrite of academics.json.
- *Campaigns* are multi-week arcs to a career milestone: a node with a project plus
  everything it needs, a finish line (the deliverable), and a ship step (GitHub, the
  LinkedIn line, its certificate). At most 3 run at once, and an active campaign
  pulls its nodes to the front of the contracts.
- *Certificates* show their cost against the budget (₹3,000/month; up to ₹5,000 for
  credibility 4/5 or more).

**Shaped by how he works** (strong starter, weaker finisher, tires of routine): a
hard cap of three nodes and three campaigns in progress, an explicit finish line and
ship step on every campaign, a parking lot for new ideas (Today and voice: "park an
idea: …"), a different track each library day, the day's small wins counted on Today,
and encouraging copy everywhere. Rule 1 became a nudge: two weeks without a commit
shows "ship one small commit", with no rank drop and no Purgatory.

**One XP system, one to-do system, one log.** XP is one total, owned by the
server (`@mission_v2`); it started from the save's XP. Everything the window pays
(the Floor, Drill, the Crucible) is sent as a delta, and `player.xp` is the window's
mirror. Rank is retired. The only to-do system is contracts. The only log is the
plan's log (Log screen, voice, the gym), and its events tick the Floor in the window
once each.

**Five screens.** Today (contracts + the day's blocks + the Floor + findings), Tree,
Focus (Crucible + Drill), Log (one form + gym + "what got in the way" + GitHub), Road
(campaigns, certificates, the parking lot, Trials, the War Chest, rewards, the Season
One record). Settings live in a drawer.

**Voice, window or no window** (`/api/mission/voice`): "what's today's contract",
"explain this contract", "I finished it", "what's next on the tree", "exam mode for
<subject>", "how many days to <exam>", "park an idea: …", "log 2 hours of German".
Marks, buying and the Crucible still need the window.

**Latest findings.** A small daily digest per active node from arXiv (cs.AR, cs.LG,
eess.SP, math.HO/math.PR by branch), fetched at most once a day, cached, and shown as
stale when offline.

**The internship campaign.** Summer 2027 is a pipeline of dated applications: idea →
preparing → applied → interview → offer / rejected, plus *not eligible* with a reason.
Research writes the calendar (`internships.json`), his progress lives in
`applications.json`, and both are private under `data/app/germoney/`. Each application
shows its countdown. A deadline within 14 days, or a prep task due this week, shows on
Today. A long-term goal (the ₹1 crore career) has milestones that fill in as their
linked tree nodes are mastered.

**Real papers.** The academics file now carries the real past papers: a question bank
per subject, the paper pattern, and the pass rule. Exam contracts ask real questions
("Solve Jun 2026 SEE Q4a: false position on x − e^−x = 0"), never the same one twice,
and each re-sit shows the SEE marks still needed (with the internal marks carried
over). Notes and papers open through a route that serves only files inside the
academics folder or the OneDrive COLLEGE folder.

**The goal ladder.** Vision (ten years, fixed) → year milestones → quarter → month →
week → today's contracts. The short-term rungs are re-derived from progress every time.
Every contract says which milestone it serves ("why this today"). A monthly review
records what went well and what slipped, and can move milestones; the vision stays.

**Gaps are expected.** After 4 idle days Today opens with "welcome back": no lost-streak
drama, a plain line on what slipped, the next deadline, and refreshers. Mastered
nodes untouched for 30 days get a short spaced-review refresher. When he drifts for
more than 3 days, JARVIS nudges once a day at most, never in quiet hours.

**The profile** (`profile.json`, private, editable, no test scores) sets the style:
the puzzle before the theory, two or three contracts to choose from, short sprints with
a finish line, the in-progress cap, quiet hours. JARVIS reads its rules when he talks
about the mission.

**The learning log.** Anything productive (free text, voice "log: …", files) is saved
under `learning/YYYY/MM/<date>_<slug>/`, with the files renamed from his explanation and
a `meta.json`. It is matched to tree nodes (he can correct the match) and paid in XP.

What follows is the Season One design. The Floor, Marks, the Armory, Drill, Trials and
the War Chest still work as described. Contracts, weekly operations, Boot Camp and
monthly bosses were replaced as above; the bosses' deliverables live on as tree projects.

---

# Season One: Year Zero

The phone app was never played. Before redesigning it I read why, in my own
planning notes (`mission_germoney/docs/09, 11, 13` and the ideation chat):

- I fade after ~14 days ("the 2-week wall").
- Vague tasks produce nothing; hyper-specific ones get done ("decision paralysis").
- I work under visible pressure and consequences, not on good intentions.
- I am provoked by comparison.
- I will not type long logs.
- Every system I was handed was "text all over the place" — I wanted a GAME.
- I over-plan and under-start; the system itself must not become the distraction.

The old build also had a structural fault: **XP did nothing.** Rank only changed by a
manual `levelUp()` that no button called, so the only rank change possible was the
Purgatory *drop*. Bosses were checkboxes on a 24-month clock I no longer have.

Everything below exists to answer one of those lines. If a mechanic cannot say which
one, it does not ship.

## The year

Season One runs **October 2026 → September 2027** (12 monthly bosses). Season Two
(October 2027 → summer 2028) is the application season and is shown on the map as the
horizon, so the year always points somewhere.

Facts the season is built on (checked 2026-10-09; every one is shown in-game with its
source and "verify before paying"):

| Fact | Value | Source |
|---|---|---|
| Blocked account (visa) | €11,904/yr = €992/month | study.eu, Expatrio |
| APS India fee | ₹18,000, non-refundable | APS India leaflet, June 2026 |
| APS processing | ~3–6 weeks, much longer in peak months | third-party guides |
| dMAT | required in the APS file for **engineering** master's applicants, summer 2027 intake onwards; €150; English; reasoning test | aps-india.de/dmat, Expatrio |
| uni-assist | €75 first application, €30 each additional | third-party, 2026 |
| IELTS Academic (India) | ₹19,000 from April 2026 | third-party report |
| Goethe A1 (India) | ~₹8,500 | third-party, April 2026 |
| NPTEL exam | ₹1,000 per course exam | NPTEL announcements |
| TUM MSc EE & IT | taught mainly in **German**, German proof required | tum.de program page |
| TUM MSc Microelectronics & Chip Design | English, tape-out, **€4–6k/semester tuition for non-EU** | tum.de, DAAD |
| RWTH MSc EE & IT (Micro- & Nanoelectronics major) | English, no tuition, **non-EU deadline 1 March** | DAAD / myGUIDE |
| TU Dresden MSc Nanoelectronic Systems | English, no tuition, 1 Apr – 31 May | tu-dresden.de |

Two of those change the plan, not just the game: TUM's EE master is German-taught, and
TUM now charges non-EU tuition. On a student budget, the zero-tuition English programmes
(RWTH, TU Dresden) are the realistic core of the shortlist, and **APS + dMAT** is a
real, dated boss — not paperwork for later.

## The loop, from the smallest unit up

### 1. The Floor (daily, ~45 minutes) — answers *the 2-week wall*
Three non-negotiable reps: **Silicon** (25 min of VLSI), **Deutsch** (15 min), **Body**
(the workout I already do). All three = the day is *secured* and the streak grows.

- Reason: the habit research on streaks is clear that the streak must be protected by
  a *small* minimum, or one bad day ends it. A 6-hour plan breaks on day 9; a 45-minute
  floor survives exams and illness.
- The floor fills itself where it can: a Crucible block, a German drill session, a
  logged workout or a finished contract ticks the matching rep (cyan = verified by the
  app). A manual tick is allowed and drawn amber (claimed). Honest provenance.
- **Never miss twice.** A missed day burns a **Shield** if I have one (earned every 7
  secured days, max 3, or bought). No shield: the streak breaks — and the next three
  secured days pay double Marks (**Phoenix**), because the danger after a break is not
  restarting at all.
- One **rest day** a week (Sunday by default) is secured automatically. Doc 09 mandates
  it; burnout is the other way the wall arrives.

### 2. Contracts (daily) — answers *decision paralysis*
Three contracts a day, each from a person with a face and a voice:

| Giver | Track | Why this person |
|---|---|---|
| **Prof. Krüger** | Silicon | the TU9 standard I'm measured against; precise, unimpressed |
| **Frau Weiss** | Deutsch | German is both an admission lever and a life skill |
| **Rhea Kapoor** | Capital | a recruiter: jobs, internships, certifications, money |
| **The Chancellor** | Paperwork | APS, dMAT, IELTS, SOP, deadlines — bureaucracy as a character |
| **Coach Brandt** | Body | the discipline I already have, used as proof I can have it |
| **JARVIS** | Handler | the narrator, the brief, the nudges |

Every contract is hyper-specific (*"Build a 4-bit ripple-carry adder from full-adder
instances; testbench with 8 cases; screenshot the waveform"*), says how long it takes,
and carries an **Intel** card: why it matters for the admit or the job, the concept,
one free resource, and a check question. Reason: specific instructions are what I
execute; knowing *why* is what makes the work feel like progress instead of chores.

- **The month's boss shapes the dailies**: contracts tagged for the current boss are
  three times as likely, and every one of them damages it. Daily work visibly moves
  the monthly fight.
- **Combo**: the 2nd, 3rd, 4th contract in a day pay ×1.1, ×1.25, ×1.5. Momentum is
  rewarded once I've started — starting is the hard part.
- **Critical**: one of today's contracts secretly pays double, revealed on completion.
  Variable reward (doc 09 §2.2), seeded by the date so it can't be rerolled.
- **Reroll** (40 Marks): swap a contract that doesn't fit today. Paralysis relief that
  costs something, so it isn't free avoidance.
- Proof stays mandatory (link, photo or note). Voice completions through JARVIS are
  accepted as a note and drawn amber.

### 3. Operations (weekly) — answers *weekly goals were weak*
Every Monday JARVIS offers three operations (one Silicon build, one Deutsch volume, one
Capital/Paperwork) and I **commit to one**, staking 50 Marks. Complete it by Sunday:
stake back plus the reward. Miss it: the stake is gone. Reason: choosing raises
ownership; a stake makes the week cost something. Completed weeks build a second
streak, **Momentum**, so a bad Tuesday doesn't erase a good week.

The Sunday debrief compares the week against my **ghost** (my own best week, and last
week). Comparison works on me; comparing against my own record is the version that
can't lie or demoralise.

### 4. Bosses (monthly) — answers *pressure dependency*
Twelve bosses, one per month, each a **real deliverable** with a deadline:

| Month | Boss | Deliverable (the kill) | Unlocks |
|---|---|---|---|
| Oct 26 | The Boolean Sentinel | toolchain + 4-bit RCA with self-checking testbench on GitHub | Rank 1 |
| Nov 26 | The Combinational Demon | parameterised ALU, exhaustive self-checking TB | Rank 2 |
| Dec 26 | The Sequential Wraith | FSM suite: traffic light, 1011 detector, universal shift reg | Rank 3 |
| Jan 27 | The RTL Architect | UART TX+RX with loopback testbench | Rank 4 |
| Feb 27 | The Recruiter | CV v2 + 15 targeted summer-internship applications | title |
| Mar 27 | Der Prüfer | Goethe A1 (exam, or a full mock ≥60% in every part) | title |
| Apr 27 | The Verification Reaper | SystemVerilog class-based TB with constrained random + coverage | Rank 5 |
| May 27 | The FIFO Sentinel | async FIFO with gray-code pointers and 2-FF synchronisers | title |
| Jun 27 | The Pipeline Guardian | single-cycle RV32I core running a test program | Rank 6 |
| Jul 27 | The Quant Sentinel | IELTS ≥7.0 (or mock) + dMAT practice set | Rank 8 |
| Aug 27 | The Open-Source Forge | flagship repo with CI, docs and waveforms | Rank 7 |
| Sep 27 | The Application Gauntlet | APS + dMAT registered, SOP v1, LORs asked, shortlist locked | Rank 9 |

The names are mine, from the original plan. A boss has **HP**: every contract on its
track, every Crucible hour and every secured day chips it. HP is the *preparation*
gauge; the kill is always the deliverable's proof. Killing it with HP left is an
**Ambush** (+20%). If the month ends first the boss **escapes**: −10% XP for a week,
and it returns next month with +25% HP alongside the new one. Exam weeks freeze the
clock (Exam Mode), so the game never punishes me for my own semester.

**Rank** finally moves: defeating a boss sets the rank it unlocks. Rule 1 (14 days
without a commit → rank −1 and Purgatory) is unchanged.

### 5. Level, Marks and the Armory — answers *XP did nothing*
- **Level** comes from XP (100 XP for level 2, +20 per level after that). Early levels
  come in hours, so the first week is full of level-ups. LEVEL = how much I've worked;
  RANK = what I've proven.
- **Marks (DM — the Deutsche Mark)** are the currency, earned with XP. They buy things in the **Armory**:
  - **real-life rewards I set** (an anime episode, an hour of gaming, a movie night,
    a sleep-in), so leisure is *earned* instead of stolen from the plan (Premack);
  - **game items**: Shields, Rerolls, a Crucible booster.
- **Supply drop**: securing the floor opens a crate (Marks, sometimes a Shield or a
  booster, always one Intel card). The variable reward sits on the one behaviour that
  matters most, every day.

### 6. Trials — certifications, exams and the paperwork
A board of every certificate and document on the path, each with stages (scout →
enrolled → preparing → booked → passed), cost with its source, when to take it, and
what it is worth for **the admit** and for **a job**:
NPTEL (Verilog; a CMOS/VLSI course), Goethe A1 → A2, IELTS, dMAT, APS, uni-assist/VPD,
the summer internship. Certificates open interview doors; projects and fundamentals
win the interview — the board says so.

### 7. The War Chest — answers *where does the money come from*
An itemised list of what the path costs and **when** each payment falls (APS, dMAT,
IELTS, Goethe, uni-assist, visa, blocked account), the total, what I've saved, and the
monthly amount that closes the gap by each date. Funding paths are listed as things
to research, not advice: an education loan, DAAD, the
Deutschlandstipendium (after enrolment), part-time work. Money stops being a fog.

### 8. Drill — answers *make it more knowledgeable*
Spaced repetition (Leitner boxes: 1, 3, 7, 16, 35 days): VLSI interview questions,
German A1 core, and Germany operations (APS, dMAT, ECTS, blocked account). A session
of 20 cards ticks the matching floor rep. Reason: spaced recall is the best-supported
method for retention we have, and interview questions are exactly what a fresher job
hunt tests.

### 9. Boot Camp (days 1–7) — answers *over-planning, never starting*
The first seven days each add one JARVIS contract that teaches one mechanic by using it
(the Floor, the Crucible, Drill, a contract with proof, the Armory, the boss, the weekly
operation). Day 1 takes ten minutes. Nothing to configure before the first win.

## JARVIS is the handler

The game is one half; JARVIS is the other.

- **Voice**: "Jarvis, brief me" · "log 2 hours of German" · "maine 45 minute verilog
  kiya" · "start a 50 minute focus on silicon" · "contract done: ripple carry adder" ·
  "how many marks do I have" · "redeem an anime episode". Parsed deterministically
  (no model in the loop, so it can't be misheard into the wrong action), executed by
  the game, answered in one spoken line.
- **Context**: when I ask JARVIS anything about study, German, bosses or the plan, the
  live mission state is in his prompt, so "should I do German or Verilog now?" is
  answered from my actual floor and boss, not in general.
- **Nudges**: at 21:30 an unsecured floor gets a spoken warning naming the cheapest
  rep that saves the streak. Provocation, not encouragement (doc 11 §6).
- **The room**: a Crucible can switch the room to the focus scene, and Aankhen's
  presence (with the real sensor) keeps it honest.

## What is deliberately NOT here
- No public shaming, no leaderboard against strangers: there is no honest data for it.
- No fake "847 applicants" statistics. Every number in the game is either mine or
  sourced.
- No XP for planning the system. Building JARVIS earns nothing in Mission Germoney.

# Mission Germoney — Season One: Year Zero

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

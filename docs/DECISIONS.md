# Engineering Log

A running record of the decisions behind JARVIS — what I changed, why, and the
measurement that justified it. Newest first.

**Rule I hold myself to:** no claim without evidence. Every entry cites a benchmark,
a command output, or a reproducible test. If I couldn't measure it, I say so.

Format per entry: **Context → Decision → Evidence → Consequences / open items.**

---

## 2026-10-09 — Aankhen: Wi-Fi may hold a room, never fill it; sleepers stay; fans don't count

**Context.** A multi-seed audit of Aankhen on the simulator found the single-seed bench
had hidden its worst cases. Evening seed 3 ran duplicate tracks: 53% false "occupied"
and 14 ID switches. Five situations it had never been tested on all failed:
- a sleeper: 69% false "empty";
- someone pacing the hallway outside the wall: 100% false "occupied";
- a ceiling fan: 99% false "occupied";
- two people sitting together: they stayed "in the room" after leaving;
- a Wi-Fi channel drifting through a subcarrier null: 74% false "occupied".
The common cause was that Wi-Fi motion could create occupancy on its own. The router
link runs 3 m outside the wall, so the hallway moves it more than the room does.

**Decision.**
- The bench runs many seeds in parallel and reports a median and a worst row.
  - Motion false alarms are split into stop-lag and steady-state; count accuracy is
    a new metric.
  - Five new scenarios: sleep, hallway, fan, pair, drift.
  - Thresholds are tuned on dev seeds 101–110 and reported on seeds 1–5.
  - The simulator's AGC walk is capped at ±4.5 dB. Uncapped, it clipped and faked
    breathing in an empty room.
- Fusion: while the radar is live and sees nobody, Wi-Fi motion adds no evidence.
  - It can hold an already-occupied belief for up to 60 s (someone in the radar's
    blind corner).
  - Without a radar, Wi-Fi keeps its full weight.
  - A doorway entry lifts the belief to "unsure" at once, and the empty clamp is −4
    (was −8), so the next entry is quick.
- Breathing (Wi-Fi, `RespirationDetector`) can only hold a room that is already
  occupied. It is ignored for 2 min after a walk-out and while the fan is detected, and
  it keeps the sleeper's radar track alive.
- Fan: the fan relay state from STATUS selects a fan-on Wi-Fi baseline
  (`calibrate --fan`, or learned when the radar sees the room empty with the fan on).
  Wi-Fi is ignored for 30 s after a relay switch, the fan's spectral lines are removed
  (`fan.py`), and blade-like radar targets are rejected by their Doppler.
- Tracker: duplicate tracks are merged, still holds are protected against ghosts, and
  a person standing up at the desk is no longer re-projected onto the wall.
- A Wi-Fi channel change drops the signal history and ignores Wi-Fi for 10 s.
  Down-weighting deep-null subcarriers was tried and removed: on dev seeds it raised
  drift false alarms from 51% to 59%.

**Evidence** (simulator only, median / worst of 5 seeds, same bytes before and after):

| scenario | presence accuracy | false "empty" | false "occupied" | ID switches |
|---|---|---|---|---|
| evening | 98.5/80.9 → 98.9/98.7 | 0.8/0.8 → 0.2/0.3 | 2.7/53.4 → 2.7/3.4 | 4/14 → 2/3 |
| sleep | 33.9/20.3 → 99.8/99.8 | 69.4/85.3 → 0.0/0.0 | 1.9/100 → 1.9/2.1 | 2/5 → 0/1 |
| hallway | 0/0 → 100/100 | — | 100/100 → 0/0 | 0 |
| fan | 26.3/26.2 → 99.5/99.4 | 0.0/0.0 → 0.4/0.4 | 98.6/98.8 → 0.5/0.6 | 0/4 → 0/0 |
| pair | 64.5/64.5 → 99.3/99.3 | 0 → 0 | 100/100 → 1.9/1.9 | 25/35 → 3/3 |
| drift | 26.4/23.2 → 99.6/99.6 | 0.0/0.0 → 2.2/3.7 | 74.5/77.3 → 0.3/0.3 | 0 → 0 |
| walk, still, empty | unchanged (≈91, 100, 100) | | | |

The fixes hold across 3 simulated rooms × 5 seeds (135 runs): worst sleep false-empty
0%, worst fan/hallway false-occupied ≤ 0.6%. Tests: 133 → 167. The 45-run suite takes
71–88 s on 10 workers (135 s before; `binascii.crc_hqx` replaced a Python CRC loop that
cost a fifth of every run, with identical output).

**Consequences / open items.**
- Trade-offs:
  - Drift false-empty rose 0 → 2–4%; it was 0 only because the drift kept the room
    falsely occupied.
  - Pair count accuracy fell 81.5 → 58%: one LD2450 cannot separate two people 0.45 m
    apart, and the old number came from leftover tracks.
  - Someone moving in the radar's blind corner (~20% of the floor) is called empty
    after ~2 min.
- Not fixed:
  - In 2 of 3 rooms, a seated person's breathing still trips the Wi-Fi motion detector
    (18–86% false "moving").
  - Under drift, Wi-Fi motion false-alarms 40–62% of the time; presence is unaffected.
- Real-world unknowns:
  - The fan's radar signature and the breathing threshold (6× the empty level) are
    assumptions until the real room is recorded.
  - The existing `baseline.json` has no breathing floor, so breathing stays off until
    I recalibrate.

---

## 2026-10-09 — Yaadash: every fact always, "remember that", corrections, follow-ups

**Context.** An audit of the memory against the live model found five defects:
- only the 4 confirmed facts most similar to the question reached the prompt, so a
  question worded unlike its fact missed it;
- nothing said by voice ever became a fact. Turns are stored as `voice_interaction`, which
  retrieval skips on purpose, so "remember that…" was answered "noted" and lost;
- a wrong answer flagged in the app went into a review file and nowhere else;
- follow-ups ("aur uske baare mein?") were searched alone and found nothing;
- everyday words resolved to people: 8 of 60 ordinary sentences ("padhai ho rahi hai",
  "mood off hai") attached a stranger's person card.

Found on the way: the brain opened LanceDB once and never re-read it, so a belief
confirmed in the app reached JARVIS only after a restart.

**Decision.**
- All confirmed facts (~950 tokens) go into the static system message
  (`yaadash_v2.authored_block`). They are grouped as current, past, "he told you" and
  corrections, with one rule: anything not there, he does not know, and he never guesses
  a number, date or name. The block is rebuilt only when a fact changes, so Ollama's
  cached prefix holds turn to turn.
- `brain/remember.py` parses "remember that…", "don't forget…", "yaad rakhna ki…" and
  "…, yaad rakhna" without the model. Questions ("do you remember…?", "yaad hai…?") and
  reminders ("remember to…") are refused. His words are stored verbatim with the date. He
  confirms in English, echoing English facts in the second person.
- In Core, a reply flagged Wrong with the right answer and **Teach him** ticked becomes a
  correction (`POST /api/memory/teach`).
- Follow-ups: when a short message leans on the last one (a personal or Hindi pronoun, or
  "and/aur/what about…"), memory is searched with the previous question too.
- People: an everyday word (the embedder's English vocabulary or a common Hindi word)
  names someone only if they are among his 100 closest.
- LanceDB is opened with `read_consistency_interval=5 s`.
- Belief hedges are now English ("I believe…"); the Hinglish ones pulled replies back
  into romanised Hindi.

**Evidence.**

| memory audit, 33 questions, live model | correct | Hindi/Hinglish | integrity (no fact exists) |
|---|---|---|---|
| before: top-4 facts per turn (3 seeds) | 81/99 (82%) | 42/60 | 6/6 |
| every fact in the system message, audit prototype (3 seeds) | 96/99 | 57/60 | 6/6 |
| `authored_block` after the LENGTH rule (6 seeds) | 191/198 | 113/120 | 12/12 |
| **shipped: `authored_block` before the LENGTH rule (6 seeds)** | **193/198 (97%)** | **115/120** | 12/12 |

The two placements are level on accuracy; the shipped one keeps spoken replies short
(below). Prefill median stays ~0.05–0.11 s: the facts are part of the cached prefix.

| follow-ups and people (probes on the local archive, counts only) | before | after |
|---|---|---|
| 11 follow-ups grounded (notes or person card) | 2/11 | 7/11 |
| 6 topic switches that inherited the old topic | — | 0/6 (3/6 while "it/this" counted as follow-up words, so they don't) |
| 60 everyday sentences resolving to a person | 8/60 | 0/60 |
| closest 20 / 100 people found by first name | 20/20, 88/96 | 20/20, 88/96 |

Another process's write, read through a long-lived handle: invisible with the default
connection, visible with the consistency interval (tested on a scratch table).

Does a prompt full of facts make him talk about Aman unasked? 12 questions that are not
about him × 2 seeds:

| | replies mentioning a fact word | mean words | technical answers: mean (max) |
|---|---|---|---|
| no facts in the prompt | 7/24 | 34 | 46 (51) |
| facts after the LENGTH rule | 10/24 | 44 | 62 (81) |
| **facts before the LENGTH rule (shipped)** | 11/24 | **39** | **53 (65)** |

The mentions are topical (VLSI in a metastability answer, his artists when he says he
is low); nothing private came up unasked. Length was the real regression, and moving the
facts above the length rule recovers most of it. A per-turn length reminder on top
gained little (technical 53 → 49 words), so it was left out. Romanised Hindi: 2/24 with
facts, a single "bhai" echoing his own "bhai…" opener (0/24 without).

**Consequences / open items.**
- The prompt grows with every "remember that", so the newest 40 told facts and 30
  corrections are kept in it. Past that, the old ones need a review screen; there is no
  voice "forget that" yet.
- Multilingual embeddings (`multilingual-e5-small`) for Hinglish fragment search are
  the next memory step. Not measured yet.

---

## 2026-10-09 — JARVIS speaks one language, in the accent he chooses

**Context.** JARVIS's Hindi pronunciation and his grammar in both languages were wrong
"all the time". The cause was two decisions stacked on each other: the persona told the
model to speak "natural Hinglish ('Bhai', 'Haanji')", and the voice was an Indian-English
voice (en-IN-PrabhatNeural) reading the romanised Hindi — an English voice guessing at
Hindi words spelled in Latin letters. I want British English by default, Hindi
understood but answered in English, and accents on demand (American, British, real Hindi).

**Decision.**
- Persona rewritten: British English only; Hinglish understood, never written; Hindi
  only when asked, in Devanagari. A short "what you can and cannot do" (no internet, no
  music, never claim an action a tool did not confirm), a NOW line, and a length budget
  (voice: ~40 words; text: under 80).
- `brain/voice.py`: accent tags `[us] [uk] [hi] [in]` per line; an explicit request
  ("in an American accent", "Hindi mein") sets the reply's voice; any Devanagari is
  routed to a native Hindi voice whatever the tag. Microsoft neural voices online,
  Kokoro-82M offline on the CPU (no VRAM). Synthesis on its own thread; punctuation-only
  text skipped; a failing cloud is retried after 60 s, not per sentence; per-voice gain.
- The persona became static per mode and per-turn context moved into the user message, so
  Ollama reuses its cached prefix. Room commands and VLSI facts got deterministic paths
  (below), and transcription got guards (`brain/stt.py`).

**Evidence** (round trip: synthesise → Whisper → error vs the intended text).

| Hindi | character error |
|---|---|
| today: Indian-English voice reading romanised Hindi | 5.9% |
| a British voice reading romanised Hindi | 35.5% |
| native Hindi voice (Madhur) reading Devanagari | **2.6%** |
| offline Kokoro hm_psi | 2.2% |

English voices are all equally clear (4.0–4.8% WER; Kokoro bm_george 4.1%), so the
choice is character: Ryan (British) for JARVIS, Andrew (American).

Persona A/B on the live model, 12 inputs × 2: replies containing romanised Hindi
**88% → 0%**; accent/Hindi requests honoured **0/6 → 6/6**; median length 123 → 30 words.
Reading the replies found what the numbers missed — invented weather, invented "news",
offers to play music — fixed by the capability rule and re-checked.

Speech-path faults the conversation audit measured and this removes: a stray "..." raised
NoAudioReceived and aborted the turn (one real turn lost that day); no network killed
the voice loop; the token loop stalled ~1–1.8 s per sentence on synthesis; "Thinking."
and "Transcribing." cost ~2.2 s per turn; a second hum played under the voice. Loudness:
Madhur measured ~4 dB louder than Ryan, so switching into Hindi jumped — now levelled.

**Verified notes.** Asked to explain setup time, the model said it is "how long a
circuit takes to prepare itself" — wrong. Grounding on the drill-deck cards: 8 interview
questions × 3, correct **15/24 → 21/24** (one remaining "miss" was a right answer my
scorer did not recognise). A memory audit caught the danger: "mera CGPA kya hai?" pulled
in a card with a sample CGPA. Questions about him now never get the Germany cards.

**Found on the way.** Two regexes in the brain contained a literal backspace where `\b`
was meant (a shell heredoc collapses `\\`); one of them, in `yaadash_recall.py`, had
silently disabled the "boost his own messages" rule for first-person memory questions
since that file was written. A test now fails if a backspace ever appears again.

**Limits.** Accents are voices, not impressions: no cloning of real artists' voices, and
the engines speak rather than sing. JARVIS has no reliable lyrics and is told not to
invent them. Offline synthesis speed still has to be measured on an idle CPU.

---

## 2026-10-09 — Mission Germoney becomes a game, and JARVIS runs it

**Context.** I built the Mission Germoney phone app and never used it. Reading my own
planning notes for why: I fade after ~14 days, freeze on vague tasks, work under
visible stakes, and every system I was handed was "text all over the place". The port
inside JARVIS also had a structural fault: XP did nothing. Rank only moved through a
`levelUp()` no button called, so the only rank change possible was the Purgatory drop.
The 10 bosses sat on a 24-month clock I no longer have.

**Decision.** A real game loop, every mechanic tied to one of those failure modes
(`docs/design/mission-game.md`): a 45-minute daily Floor that keeps a streak alive
(shields, "never miss twice", Phoenix after a break), three hyper-specific contracts a
day from characters with faces and Intel cards, a weekly operation with a stake, twelve
monthly bosses that are real deliverables (HP as preparation, the kill needs proof),
levels from XP and rank from bosses, Marks (DM) spent on rewards I set, Trials for
certificates and paperwork, a War Chest for real money, Drill (Leitner spaced
repetition), Boot Camp days 1–7. JARVIS is the handler: voice commands are parsed
deterministically (no model in the loop) and run by the game; questions about study
get the live mission state in his prompt.

**Evidence.**

- Research changed the plan, not just the game (checked today, sources in the game):
  TUM's EE & IT master is mainly German-taught and requires German proof; TUM's
  English chip-design master charges non-EU students €4–6k per semester; RWTH
  (Micro- & Nanoelectronics, English, no tuition) closes 1 March for non-EU; APS now
  includes the dMAT for engineering master's applicants; APS ₹18,000; blocked account
  €11,904/year.
- Tests found real exploits before I did: stepping a Trial back and forward re-paid
  its stages (free Marks on demand); the voice parser read the interjection "ah" as
  "a h" = one hour and "7 am" as one minute; "buy me some time" became a purchase.
  All fixed, all regression-tested. A link check found a dead resource URL (404).
- End to end with the real brain in text mode: "maine aadha ghanta verilog kiya" →
  30 min of Silicon logged, floor ticked, boss −3 HP, spoken answer in 0.5 s (an LLM
  reply takes ~2.5 s). Given the mission state, "what should I study to hurt the
  boss?" was first answered literally ("don't hurt anyone"); with the game's
  vocabulary and the next unfinished step in context it named the exact step.
- 54 UI tests (engine, store, voice actions), 81 app tests, 133 Aankhen tests.

**Open items.** The 4B model still makes small factual slips in free answers (it
listed 4 input cases for a full adder, which has 8). Fees and dates in the game carry
their source and "checked" date; they must be re-verified before paying.

---

## 2026-10-09 — Phase 2: transcripts, real relays, Mission inside JARVIS

**Context.** I had no record of what JARVIS got wrong, the relay code had never
switched a real relay, and Mission Germoney lived in a phone app I didn't open.

**Decision.** Every turn is kept with its timings; any turn can be flagged (wrong /
slow / misheard) with what it should have said; one button exports a review file
ordered for a reviewer. Relays: a COMMAND frame on the existing USB protocol, the app
as the single owner of room state, "confirmed" only when the board's own STATUS agrees.
Mission Germoney's stores ported verbatim behind two shims (storage → the server's
key-value store with a per-key write queue; alerts → the app's dialogs).

**Evidence.** Writing the limbs tests caught the scene buttons crashing (`int("sleep")`).
The desktop shortcut failed under `pythonw` because uvicorn's log formatter called
`isatty()` on a `None` stdout — reproduced and fixed. Re-running the identity sync
would have wiped every confirmed belief (`LIKE 'authored%'` matched them too) — fixed
before any existed.

---

## 2026-10-09 — JARVIS becomes an app

**Context.** JARVIS started from a command prompt and lived in a scrolling console:
no way to see what memory knows, what the room sensors see, or what the GPU is doing,
and no way to talk to him without the microphone.

**Decision.** A desktop app (`app/`): FastAPI on 127.0.0.1 behind a native WebView2
window, six tabs (Core, Yaadash, Aankhen, Limbs, Connect, System). The voice loop
stays a child process (`jarvis.py --app`) so a crash there can't take the window
down and "sleep" really frees the GPU. Design rules in `docs/design/jarvis-app.md`;
the main one is that colour means provenance (cyan measured, amber simulated or
unconfirmed, red fault) on every tab.

**Evidence.**

- Typed conversation through the app: first token 0.6 s, full reply 2.5 s.
  Text-only start 44 s → 26 s once it stopped importing TensorFlow, Whisper and the
  wake-word engine it never uses.
- Memory stats 16 s → 2 s by reading LanceDB directly instead of importing the
  module that loads the embedding model.
- Initial UI bundle 905 kB → 284 kB by lazy-loading the 3D twin.

**What building it exposed (each would have been invisible in the console):**

1. *A frozen JARVIS.* A keyword clash killed the thread reading his stdout; the
   pipe filled and he blocked mid-reply. The reader now survives a bad event.
2. *Untrustworthy GPU sensors.* NVML on this Optimus laptop returns Unknown (999)
   while the dGPU sleeps, and its power sensor read 590 W against a 43 W limit.
   Readings now fail individually, and an impossible value shows as "—".
3. *Memory polluted by JARVIS himself.* Old replies are stored back as memories,
   and some were hallucinated ("maine One Piece 2019 mein complete kiya tha"). The
   app labels them "JARVIS's own words · unverified"; pruning them is open.
4. *~14 GB of unused models on disk* (llama3.1, dolphin-llama3, a duplicate qwen3,
   old Whisper sizes) — the System tab flags them; deleting is the user's call.
5. *A 4B model can't carry a provenance label.* Given a simulated person marked
   "SIMULATION", it answered "nobody's here… P2 is at the desk". So in simulation
   the brain gets no people at all, only the verdict "sensors not connected"; it
   now answers "Room sensors are in simulation mode, I can't see your room".

**Consequences.** Firmware v3 (CSI on, binary protocol, authenticated relays, no
open AP) compiles for the S3 but has not run on the board — the next real test.

---

## 2026-10-09 — Aankhen v3: a simulator with an answer key, and what it caught

**Context.** The v3 pipeline (protocol, CSI conditioning, motion detector, tracker,
occupancy) had unit tests, but nothing tested the parts *together*, and the ESP32
isn't connected yet. "It works" was a claim with no number behind it.

**Decision.** Built three things:

- `simulator.py` generates the exact bytes an ESP32 + LD2450 would send — ESP-IDF
  CSI buffers (imaginary first, FFT order, garbage invalid word), byte-exact LD2450
  frames, CRC-framed with sequence numbers, 3 % loss, burst gaps, AGC steps and
  corrupted frames — from a small physical model: line-of-sight with Fresnel-zone
  shadowing, static reflections, one moving reflection per body, breathing, radar
  slant range, still bodies detected less often, one-frame ghosts. It knows where
  everyone really is.
- `fusion.py`: presence as a log-odds belief with evidence *rates* per sensor, a
  slow absence term, and an exit-through-the-door event.
- `bench.py`: replays any stream through the real decoder and `engine.py` and scores
  it every 100 ms — presence accuracy, false-empty, false-occupied, motion recall /
  false alarm / latency, position error, ID switches. The same harness scores real
  recordings once they're labelled.

**Evidence.** The first benchmark run was the useful kind — it failed:

| metric (simulated evening, 220 s) | first run | after fixes |
|---|---|---|
| presence accuracy | 64.7 % | **98.5 %** |
| false "occupied" while empty | 98.7 % | **2.7 %** |
| false "empty" while occupied | 0 % | 0.8 % |
| position error median / p90 | 0.31 / 0.38 m | **0.05 / 0.16 m** |
| ID switches | 10 | **2** (both: walking out of the radar's ±60° FOV) |
| still person: false "moving" / ID switches | 13 % / 17 | **0 % / 0** |
| empty room, 10 min: Wi-Fi false alarms | — | **0** |

Each fix came from a trace, not a guess:

1. **Resampler invented 20 % of samples.** Slot edges sat exactly on nominal packet
   times, so ±0.4 ms jitter flipped packets into the next slot. Centred the slots:
   fill fell to 3.5 % (= the real loss). A real-hardware bug, found without hardware.
2. **"Recent motion" counted as evidence** for 90 s and outvoted an empty radar and
   a walk-out. It's memory, not evidence — removed.
3. **Exit detection used the coasting prediction**, which drifts out of the doorway.
   Now uses the last *measured* position, with 0.35 m tolerance; an exit with nobody
   else tracked lands the belief on "empty".
4. **Stillness from instantaneous speed** flickered (Kalman velocity jitter ≈ 0.16
   m/s ≈ the 0.15 m/s threshold). Now net displacement over 2 s with hysteresis.
5. **Seated people projected 0.34 m too far** — the slant-range formula assumed a
   standing torso. Zones now carry a posture (desk → seated, bed → lying), and a
   detection near a still track is re-projected with that torso height.
6. **Lying person vanished** (radar sees ~20 % of frames). Desk/bed are "sticky":
   a coasting track there stops at its last measurement, and sparse-but-consistent
   detections there can confirm.
7. **Duplicate tracks** stole a still person's detections (17 switches). No births
   within 0.7 m of a confirmed track.
8. **Standing up left a ghost at the chair**; a ghost hit dragged a still track
   0.8 m. Still tracks ignore one far detection but wake on two within 0.6 s.

One honest limit, now modelled: a still person is invisible to Wi-Fi through a wall
(seated score 1.28× vs 1.82× threshold). I first set the body reflection too strong
(breathing scored 23×, far beyond published results) and turned it *down* — a
simulator that flatters the detector is worse than none.

**Consequences.** `test_end_to_end.py` pins these numbers (thresholds just inside the
measurements). All of it is synthetic and labelled so; real accuracy comes from
labelled recordings of the real room through the same `bench.py`. 127 tests passing.

---

## 2026-10-09 — Yaadash memory v3: archive, people, recall, taste, beliefs

**Context.** Memory could answer "what's my name" but not "when did I finish One
Piece?" or "how close am I with X?". It had facts, but no episodic memory, no model
of the people in my life, and no way to learn.

**Decision.** Built the memory out in ten ordered steps, each tested on my real data
before moving on.

| Step | Module | What it does |
|---|---|---|
| 1 | `agent.py` | Short-term memory: last 6 turns, cleared after 10 idle minutes |
| 2 | `yaadash_archive.py` | Every message, both sides, unfiltered + embedded windows |
| 3 | `yaadash_people.py` | Thread → person, fuzzy name resolution |
| 4 | `yaadash_recall.py` | Hybrid BM25 + vector search, Reciprocal Rank Fusion |
| 5 | `yaadash_recall.py` | Episodic recall as dated, two-sided excerpts |
| 6 | `yaadash_people.py` | Tie strength (who I'm actually close to) |
| 7 | `yaadash_taste.py` | Topic model over 21k liked/saved post captions |
| 8–9 | `yaadash_beliefs.py` | Distillation into claims + active learning |
| 10 | `refresh_memory.py` | One command rebuilds every layer in order |

**Evidence and findings, step by step:**

- **Short-term memory.** Three-turn test: "favourite anime?" → "*uska* main
  character?" → "aur *woh* kya banna chahta hai?" correctly resolved to One Piece →
  Luffy → Pirate King. Warm turns 3.3–3.5 s.

- **Archive.** 109,819 messages across two accounts, 541 threads, 14,013
  conversation windows (12 messages, stride 6, split at 3-hour silences so a window
  never stitches two different days together). Embedded on CPU in 399 s.

- **Two stores, not one.** The identity store filters out anything under 60
  characters, because short chatter drowns facts. But that same filter would delete
  a 48-character punchline. So episodic recall gets its own unfiltered archive.

- **Name handling.** Styled display names are Unicode math glyphs, not letters —
  `𝙏𝙤𝙣𝙮` can never match a search for "Tony". NFKC folds those; small-capital
  letters (`ᴊᴀʀᴠɪꜱ`) need an explicit map because NFKC skips them; Gurmukhi names
  needed their own transliteration path.

- **No automatic cross-account merging.** The thread folder prefix looked like a
  username, but it is derived from the display name: five different threads were all
  "abhay", three inside the same account. Merging on that key would invent people.
  Name collisions are surfaced as candidates instead of guessed.

- **Tie strength.** My working hypothesis: *forwarding someone lots of reels does not
  make them close; being in touch for years does.* Encoded as longevity (25%),
  sustained contact (20%), reciprocity (15%), calls + voice notes (15%), depth (10%),
  recency (10%), mutual initiation (5%), with a penalty when more than half a thread
  is reels. First version used percentile ranks and saturated — fifteen people
  between 86 and 95 with ties, and a seven-year friend with 44 calls ranked below a
  one-year one. Switched to robust scaling (divide by the 97th percentile).

- **Validating tie strength.** My Instagram Close Friends list (140 names) is the
  only labelled data I have, so I scored the model against it:

  | Signal | ROC AUC | Precision@20 | Precision@50 |
  |---|---|---|---|
  | **Closeness model** | **0.772** | **95%** | **84%** |
  | Raw message volume | 0.760 | 75% | 74% |
  | Longevity alone | 0.733 | 60% | 58% |
  | Logistic regression on the labels (5-fold CV) | 0.675 | 90% | 70% |

  The model wins clearly at the top of the list and only marginally overall. Two
  honest caveats. First, **my hypothesis did not fully survive**: in the supervised
  fit, reel-sharing was the strongest *positive* predictor of being on Close Friends.
  Either reels do signal closeness, or Close Friends — a story-sharing list —
  measures the same casual engagement reels do. I can't separate those without
  better labels. Second, learning from the labels did *worse* than the hand weights,
  which says the labels are noisy, not that the features are wrong.

- **Hybrid recall, and the bugs it took to get right.**
  - A topic word ("anime") matched a stranger's styled display name, and the person
    filter then confined the search to the wrong thread. Fix: match first + last
    name only, and treat a person match as a preference with a full-search fallback.
  - BM25 matches whole tokens, so "complete" never found "completed". Added light,
    *symmetric* English stemming — the first version stripped "-ed" but not "-e", so
    the two sides still never met.
  - Summing every hit inside a cluster rewarded threads where a topic came up often
    over the one message that answered the question. Fixed with proper RRF: each
    retrieval system contributes only its best rank per moment.
  - A precise answer is often one line inside a window about something else, which
    vectors can't see. BM25's single best hit is now always included.
  - Result: "maine kab one piece complete kiya tha?" returns **24 Feb 2021 — "I
    completed one piece"**; "kiss anime" returns the exact message from Aug 2020.

- **Knowing when not to answer.** Recall always returns *something*, so "what did
  we fight about?" returned an unrelated, sensitive conversation. Measured cosine
  distance of the best match: real memories at 0.254–0.304, forced matches at
  0.307–0.343. **The groups overlap**, so no threshold is clean. Layer one: a gate at
  0.32 drops the clear misses. Layer two: the model is told the excerpts are
  closest matches and must say "not found" rather than stretch one to fit.
  Verified end-to-end: it now declines the fight question and admits it has no
  record of a joke that genuinely isn't in the archive (my 2017–2022 messages are
  thin — ~10k of the 110k).

- **Perspective bugs.** Hinglish questions in the first person ("*mera* naam kya
  hai?") were echoed back in the first person ("*mera* naam Amreesh hai"), and
  excerpts labelled "Me:" were read as the assistant's own memories. Fixes: label my
  lines by name, an explicit perspective rule in the prompt, and a low-temperature
  model for memory-grounded turns. Mostly fixed; a 4B model still occasionally slips
  on long episodic answers. That's a model-size limit I'm noting rather than hiding.

- **Taste.** TF-IDF + NMF over 21,330 captions (saves weighted 3×), tracked per year.
  It contradicted my own fact file: I had anime down as a current favourite, but
  Naruto fell from 7.4% to 0.8%, One Piece 5.7% → 1.0%, Black Clover 4.0% → 0.5%,
  while comedy and relatable memes rose 6.8% → 16%. Anime looks like who I *was*.
  Rather than silently rewrite the fact, it becomes a belief to confirm.

- **Beliefs + active learning.** Claims carry confidence, era and evidence; a
  near-duplicate claim (cosine distance ≤ 0.12) merges and raises confidence — that
  is the "growing" mechanism. Questions are ranked by uncertainty × importance.
  Confirming a claim promotes it to a fact; "used to" keeps it as history.
  22 claims seeded from the taste profile and closeness model.

- **Runaway generation.** A test hung for 30+ minutes with the GPU pinned: with no
  output cap, a small model at low temperature fell into a repetition loop until it
  filled the 8,192-token context — and because Ollama serves one request at a time,
  another job queued behind it forever. Every model call now has `num_predict` and
  `repeat_penalty`.

**Open items.** LLM distillation over my messages (written, not yet run at scale);
reviewing the seeded beliefs; Instagram is my only episodic source before 2023.

---

## 2026-10-09 — Repository hygiene and privacy

- Moved 18 unreachable v1 modules to `brain/legacy/`, verified by tracing the import
  graph from every entry point. `graphrag_engine` stayed: `memory_server` imports it.
- Docs reorganised into `docs/` (engineering, design, research, vision).
- Personal planning notes moved to a local, gitignored `notes/` folder.
- The ESP32 firmware had Wi-Fi credentials hardcoded in three places. Moved to a
  gitignored `secrets.h`; `secrets.example.h` is the committed template.
- Personal memory data (`identity/`, `brain/yaadash_data/`, `lancedb/`) is gitignored.
  It contains my messages and my friends' words and never leaves this machine.

---

## 2026-10-08 (night) — Brain: Qwen3-4B → Qwen3-4B-Instruct-2507

**Context.** Every reply took at least 22 s, and answers about me were wrong.

**Measurement 1 — where the time goes.** Prefill: 264 prompt tokens in 0.5 s.
Generation: 50 tok/s. Neither explained 22 s. But with `think=False`, Qwen3-4B
replied *"We are in a roleplay where I am JARVIS…"* — its reasoning had moved into
the answer instead of stopping. It is a hybrid reasoning model, and in this Ollama
build nothing switches the reasoning off. Hidden in `<think>` tags in the live loop,
that is ~1,000 tokens of silence before every reply.

**Measurement 2 — what the model was shown.** For "tell me my name", the correct
fact was retrieved — buried under a placeholder, a truncated fact, a style rule
stored as a memory, and an unrelated personal message. The model reported that
faithfully. **The context was the defect, not the model.**

**Decision.** Swap to the non-reasoning Instruct-2507 (same size, same VRAM), and fix
retrieval: a re-runnable fact loader that joins wrapped bullets and skips
placeholders and style rules; a measured relevance cutoff for chat fragments
(relevant ≤ 0.31, junk ≥ 0.349); and dev-session logs and the assistant's own past
replies excluded from retrieval, because they were being read as current orders.

**Evidence (A/B through the real agent, identical memory and prompt):**

| Question | Qwen3-4B first token | Instruct-2507 first token |
|---|---|---|
| "tell me my name" | 52.6 s | **0.6 s** (1.6 s total) |
| anime + music, 2 questions | 30.8 s | **0.6 s** (3.3 s total) |
| Aadhaar number (must refuse) | 97.6 s | **0.7 s** (4.9 s total) |

After the retrieval fixes **both** models answered all three correctly. Correctness
came from retrieval; speed came from the model swap.

Also: a speech sanitiser strips Markdown and emoji before TTS (it was reading
"asterisk asterisk" aloud), and the embedder now loads at boot instead of adding
6.8 s to the first reply.

---

## 2026-10-08 — Voice: truncation, transcription, script

**Sentences cut off.** `SILENCE_DURATION = 2.0` ended the recording after two seconds
of silence. I think out loud with 2–3 s pauses, so long questions arrived as
fragments — while the UI printed "pausing for 4s". Now 4.0 s, VAD 1000 → 1500 ms.

**Transcription.** Benchmarked on synthesized Hinglish with known ground truth:

| Config | Transcribe | Accuracy |
|---|---|---|
| Whisper small / CPU / int8 | 10.7 s | badly garbled |
| **Whisper large-v3-turbo / CUDA / int8_float16** | **2.7 s** | every word correct |

Turbo fits in the ~2.6 GB left beside the LLM. I deliberately did **not** pin the
language to Hindi: it was faster, but it renders English in Devanagari, and room
control matches literal English phrases — it would have silently broken the lights.

**One script.** Whisper writes Hindi in Devanagari and English in Latin. `hinglish.py`
romanizes only the Devanagari runs (ITRANS, long vowels collapsed, inherent schwa
stripped only when the word really ends in a consonant, anusvara → n). English passes
through untouched, so "turn off the lights" still matches.

**Other fixes.** TTS at `+15%` rate garbled Hinglish — now `+0%`. The prompt forced
"1–3 sentences" even for six questions — length now matches the question. The
Windows console (cp1252) crashed on Devanagari; fixed in code because `python -I`
ignores `PYTHONIOENCODING`.

---

## 2026-10-08 — First end-to-end boot; authored facts

Asked what I study and want to do in Germany, JARVIS mocked me with a line it had
retrieved from an old group chat. It hadn't hallucinated — retrieval matched the
*words* "college / study / time waste", not the meaning, and the real facts had been
lost when the dev-session log tool's 30-day retention deleted old transcripts.

Lesson: social chat is **texture, not identity**. It shows how I talk, not who I am.
Added an authored fact file retrieved on its own channel and labelled as ground
truth, with everything else labelled as old, possibly-other-people's messages. The
label is the fix. Also rewrote a persona prompt that encouraged insulting the user.

---

## 2026-08-31 — Instagram ingest, and a regression I caused

First pass used `MIN_CHARS = 15`: 12,799 chunks, median length **27 characters**,
10,144 of 13,538 rows under 40 characters. Retrieval got worse — short fragments
match questions semantically while carrying no information. Measured the length
distribution (≥60: 928 rows), set `MIN_CHARS = 60`, re-ingested: 1,668 rows, median
128 characters, 5 under 40.

**Lesson: row count is not progress.** Judge every ingest by retrieval quality on
control questions, never by volume. Identity documents deliberately excluded.

---

## 2026-08-31 — Aankhen v2: honest eyes

The v1 spatial engine was a simulator reporting invented heart rate and 17-keypoint
pose in the same shape as real data. Kept `ruview_parser.py` (its LD2450 Bit-15 decode
and CSI phase unwrapping are genuinely correct). Dropped what the hardware cannot do:
skeleton pose from one antenna, vitals from a position radar. Every frame now carries
`source = hardware | simulation`. Found by testing: the parser already returns
metres, not millimetres — the first version detected zero targets.

---

## 2026-08-31 — Yaadash v2 memory engine

Replaced a stack that (1) depended on a module that didn't exist, so ingestion never
ran, (2) called an 8B model to extract facts on every save, and (3) needed a separate
server and a ~95%-noise graph on the voice hot path. Now: LanceDB embedded on disk,
bge-small on CPU (keeps VRAM for the LLM), drop-in API.

**Data-loss finding.** 148 dev-session transcripts in July became 57 by end of
August — the tool's default 30-day retention deletes them. A question that answered
correctly in July answered wrongly in August. Raised retention; memory must be
refreshed on a schedule, not occasionally.

---

## 2026-07-24 — Brain: Llama-3.1-8B → Qwen3-4B

The 8B model plus KV cache exceeded 6 GB VRAM and spilled to CPU — the cause of the
long lag. Measured on the RTX 4050: Qwen3-4B at 50 tok/s, 2.9–3.3 GB, 100% GPU vs
Llama-3.1-8B at 20 tok/s, 5.4 GB, 22% on CPU.

---

## 2026-07-24 — Git, and disk triage

Initialised the repository. An audit recommended deleting both Python virtualenvs to
free ~8.5 GB; I didn't — git stores code, not installed libraries, and without them
nothing runs. Removed only genuinely dead weight (a failed 8B download and a dropped
model, 6.1 GB). An audit's recommendation is not automatically right.

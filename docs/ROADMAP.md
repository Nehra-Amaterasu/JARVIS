# JARVIS roadmap — the living plan

Written 2026-10-12 from an audit of everything asked for since July against what the
code, data and git history actually show. The plan is the work list for me and for
the build loop; `docs/DECISIONS.md` records what was done and why.

**How an item is "done":** the code exists, a test proves it, the suite is green, the
change is in DECISIONS.md, and the item is ticked here with its commit. Anything only
proven in simulation says *simulation* next to the tick. "Works" means measured.

**Rules every item follows** (the user's, not negotiable):
- Personal data lives only in `data/` (git-ignored). The repo is public: scan every
  diff for names, the home's layout, credentials and private facts before a push.
- No download or install without the user's explicit OK (file, source, size). Items
  that need one sit under *Waiting on you* until approved. Use what is installed.
- Tests run on scratch data (`JARVIS_DATA_DIR`, `AANKHEN_DATA_DIR`), never real progress.
- Mains safety is enforced in code where code can: the AC and geyser never go on a
  relay; relay loads have a rated-current check; auto-off needs a long hold and a
  spoken check first.
- Commits: first person, why + measurement, no AI attribution.
- Never claim an action that no tool or board confirmed — in the UI, in JARVIS's
  speech, or in these docs.

---

## Where things really stand (2026-10-12)

| Part | Real | Simulation / design only |
|---|---|---|
| Voice loop + brain | runs on the laptop; first LLM token 0.6 s | first audio 2–11 s in real use; end-pointing is a fixed energy threshold; wake word unreliable unless stretched |
| Memory (Yaadash) | 110k messages, people model (P@20 95 %), hybrid recall with abstention | belief distillation never run; "remember that" never used on real data; no forget/edit |
| Aankhen | — | everything; firmware never flashed, no calibration, no recordings |
| Relays / IR | — | firmware drives 2 pins; Uno firmware does not exist; no relay has switched |
| App | all tabs work against the server | Aankhen tab on simulated data |
| Remote access | — | not started (Tailscale chosen) |

---

## Track 0 — Foundations (what the audit found half-done)

- [ ] **F1 Reproducible install.** `requirements/requirements.gpu.txt` lacks pywebview,
  psutil, nvidia-ml-py, kokoro-onnx, soundfile, phonemizer and pins dead stacks
  (exllamav2, mem0ai, chromadb, qdrant-client, tensorflow-cpu) plus both pygame and
  pygame-ce. *Done when* a curated file lists exactly what the code imports (checked
  by a test that walks the imports) and the README install works on a clean venv.
- [ ] **F2 Connect page tells the truth.** TTS shows "connected" unconditionally; the
  LD2450 shows connected whenever the hub is in hardware mode; any CH340/CP210x is
  called "ESP32-S3". *Done when* each status comes from a real check (Edge reachable,
  radar frames seen in the last 5 s, the board's HELLO frame), with tests.
- [ ] **F3 The right board on the right port.** `transport.py` treats a CH340 as an
  ESP32, so an Uno clone would be auto-picked. *Done when* boards are identified by a
  handshake frame, not by USB vendor id, and the Uno never receives Aankhen frames.
- [ ] **F4 Hot-plug.** A board plugged in after launch is never used. *Done when* the
  hub switches from simulation to hardware within 5 s of the board's handshake (test
  with a fake serial source).
- [ ] **F5 One writer per relay.** The firmware switches mains relays on any
  `jarvis/room/+` MQTT message, `room.py` publishes *retained* state, and `limbs.py`
  drives the same relays over USB. *Done when* `limbs.py` is the only writer, MQTT
  state is non-retained and informational, and a stale message cannot switch a load.
- [ ] **F6 Regression harness in the repo.** The memory evaluation (193/198) lives in a
  scratch folder. *Done when* `yaadash/tests/` holds the control-query harness and runs
  against a fixture store, so a change that breaks recall fails a test.
- [ ] **F7 TESTING.md matches today's JARVIS** (British English persona, accents, the
  app). *Done when* the protocol has been re-run and a result sheet is in `data/notes`.
- [x] Launcher logs to `data/app`; README claims corrected; fake-vitals MCP server
  retired (abcc88e).

## Track 1 — The agent (Core)

- [ ] **A1 Real end-pointing.** Replace the 0.04 RMS / 4 s silence rule with the Silero
  VAD that already ships inside faster-whisper (`silero_vad_v6.onnx`, no download).
  *Done when* the 10-10 failure ("I was still speaking") is reproduced from a recorded
  clip and fixed, and median time-to-first-audio is measured before/after.
- [ ] **A2 Tool registry with permission tiers.** Today the agent has two tools bound
  on 16 exact phrases. Build one registry: T0 read (time, date, room state, memory
  search, Aankhen presence), T1 reversible home actions (lights, fan, music), T2 speaks
  for me (messages — off until the user enables), T3 money/irreversible (never).
  *Done when* every tool returns a receipt and JARVIS's reply is built from receipts:
  a claim with no receipt is a test failure.
- [ ] **A3 Timers, reminders, schedules.** "Remind me at 9 to call…", "medicine at 8
  am daily" — persisted in `data/app`, spoken by JARVIS, shown in the app. (Also the
  base for SIH-3.)
- [ ] **A4 Skills.** `skills/<name>/SKILL.md` (Agent Skills format: name ≤64 chars,
  description ≤1024). Each turn retrieves the top 3 skill descriptions from LanceDB
  (~300 tokens) and offers an `activate_skill` tool limited to those names; bodies ≤1.5k
  tokens. Frequent intents (lights, music) stay on the direct path. *Done when* a
  4B-model eval shows skills chosen correctly on ≥ 20 phrasings.
- [ ] **A5 MCP endpoint.** FastMCP over HTTP inside the app (127.0.0.1, bearer token)
  exposing the T0/T1 tools, so external agents (OpenClaw, Hermes Agent) can use JARVIS
  and JARVIS can hand work to them. JARVIS side only; installing either agent needs the
  user's OK, and OpenClaw's security history (CVE-2026-25253, malicious ClawHub skills)
  means only vetted local skills.
- [ ] **A6 Honesty guard.** The 10-10 session invented self-claims and promised actions
  it cannot do. *Done when* the persona's capability list is generated from the tool
  registry, and 20 red-team prompts ("track my steps", "upload this to Claude") are
  refused or answered with what it can really do.

## Track 2 — Spatial intelligence (Aankhen)

- [ ] **S1 First light, guided.** An in-app wizard for the first hardware session:
  flash check → `doctor` → empty-room calibration (which now records the model's
  reference) → `validate` with the metronome → 10 min of Teach labels → `bench`. Each
  step shows pass/fail from real frames. *Blocked by:* the user's hardware session.
- [ ] **S2 Wi-Fi-only fusion that does not over-claim.** Without a radar, fusion lets
  Wi-Fi motion create occupancy (100 % false "occupied" in the house scenario). *Done
  when* router-side motion (passer-by signature: a 2–4 s burst with nothing after) is
  scored "outside", and the learned model gets a vote behind a flag that stays off
  until its held-out score on real recordings beats the engine.
- [ ] **S3 Free labels.** Keyboard/mouse activity → "at my desk"; the HC-SR04 over the
  bed → "in bed"; app use → awake. Labels accrue without tapping. *Done when* a day
  of use produces labelled windows and the Teach totals grow on their own.
- [ ] **S4 Room editor.** Draw the room, zones, furniture and the house in the app
  instead of hand-editing `room.json` — the step that makes Aankhen replicable in
  someone else's home. Includes a "measured" toggle and a tape-measure checklist.
- [ ] **S5 Phone layout + AR.** Narrow layout done for Aankhen; AR needs a secure
  origin, which Tailscale HTTPS provides (R1).
- [ ] **S6 Gain library.** Simulated results assume Espressif's `esp_csi_gain_ctrl`;
  without it still-breathing visibility drops to ~1 %. *Blocked by:* download OK.

## Track 3 — The brain (Yaadash), growable

- [ ] **Y1 Memory galaxy.** Every memory, person, belief and topic as a point in 3D
  (embeddings projected server-side, cached), coloured by kind, sized by importance,
  top-k edges only; a time scrubber shows the brain growing month by month. One
  `THREE.Points` draw call (three.js handles 500k points). *Done when* 5k+ real nodes
  render at 60 fps and clicking one opens its source.
- [ ] **Y2 Growth ledger.** Rows per source per day, new people, new beliefs, recall
  hit-rate over time — the "is it actually growing" chart.
- [ ] **Y3 Source registry + "Add a source".** One place listing every source with
  status, row counts and last refresh: Instagram (done), Claude chats (done), ChatGPT
  export, Antigravity, Obsidian vault, Spotify Extended Streaming History, documents
  (Y5). Adding one is a guided flow, never a code change.
- [ ] **Y4 Review and forget.** Distillation run on real messages, a review queue
  (confirm / outdated / reject), and the missing forget/edit for told facts and
  corrections. The ~25 hallucinated `voice_interaction` rows get pruned through it.
- [ ] **Y5 Study library (SIH-4).** PDFs/DOCX/notes with page-level citations; see
  SIH-4 below.
- [ ] **Y6 Obsidian, both ways.** Read a vault (markdown, `[[links]]`, YAML) as a source;
  write JARVIS's notes only into a `JARVIS/` folder with atomic writes and a stable
  `jarvis_id`, never touching `.obsidian/` or renaming notes.
- [ ] **Y7 Music memory.** Taste from the Spotify Extended Streaming History export
  (lifetime plays, skips, `ms_played`) — the user requests it from Spotify (up to 30
  days). Spotify's developer terms forbid training on API data, so API data is never
  used for the model.

## Track 4 — Functional abilities (Limbs)

- [ ] **L1 Twelve channels, nine circuits.** `limbs.py` and `room.py` model one light
  and one fan with fake levels. *Done when* the model matches the real switchboard
  (L1–L8, fan speed steps), each with rated watts and a "safe on a 7 A relay" flag.
- [ ] **L2 Uno firmware.** Relays + optional wall-switch inputs over a framed serial
  protocol with a handshake (see F3). *Blocked by:* the user's wiring choice
  (switches as Uno inputs vs relays across the switches).
- [ ] **L3 Music player.** Local files through the app (`<audio>` + Range requests,
  media keys) and voice ("play something calm"). Spotify control later via PKCE
  (`http://127.0.0.1:<port>` redirect); control needs Premium and the user's own
  developer app.
- [ ] **L4 Samsung TV over the LAN.** The TV's local WebSocket API (power, volume,
  inputs, apps). *Blocked by:* OK for the `samsungtvws` package, and "Power On with
  Mobile" enabled on the TV.
- [ ] **L5 AC by IR.** One 940 nm IR LED; protocol detection by beep sweep. *Blocked
  by:* the user's OK for the LED (~₹10).
- [ ] **L6 Phone reach.** Notifications from JARVIS to the phone through the app over
  Tailscale (no third-party push service without the user's OK).

## Track 5 — Reach and replicability

- [ ] **R1 Remote over Tailscale.** `tailscale serve` gives HTTPS on the tailnet while
  the app stays on 127.0.0.1. App side: an allowlisted `*.ts.net` host, device pairing
  by QR code (long-lived device tokens, stored hashed), roles (owner / family), and a
  phone-ready layout for every tab. *Blocked by:* the user installing Tailscale and
  signing in.
- [ ] **R2 Every tab works on a phone** (Core, Yaadash, Limbs, Mission).
- [ ] **R3 "Build your own JARVIS" guide** — hardware list, flashing, first light, room
  editor, sources — tested by following it on a clean folder.

## Track 6 — The interface

- [x] Motion system and the Aankhen tab (abcc88e).
- [ ] **U1** Bring Core, Yaadash, Limbs, Connect and System up to the same standard:
  every value a `<Ticker>`, every list `rise`, every state flip `pop`, every wait
  `scan`, page changes morph. Keep the current look.
- [ ] **U2** Empty, loading and error states for every card (no blank boxes).

---

## Household problems from Smart India Hackathon statements

Picked from ~1,580 real SIH statements (2022–2026) for fit with a normal Indian home and
with what this hardware can honestly do. IDs are year-scoped (SIH reuses them).
Sources and full sketches: `data/notes/research/sih_report.md`.

**SIH-1 · Security without cameras — 2022 DR729 "Security Management System" (AICTE).**
Arms itself when every family phone has been off the home network for 15+ minutes
(phone presence from the LAN, last-seen based), or by voice/app. While armed, confirmed
Wi-Fi motion switches lights on, speaks a warning, and alerts the phone over Tailscale;
an ESP32 that goes silent for 30 s raises a tamper alert; a daily self-test checks the
empty-room baseline. *Test:* 30 armed walk-ins (normal / creeping / standing); 48 h
empty with and without the fan (≤ 1 false alarm/day); a coverage map per room.
*Limits:* motion only (a still intruder is caught ~38 % of the time); no identity;
arm only when everyone is out.

**SIH-2 · Occupancy-aware energy saving — 2022 DR704 "Energy Conservation with modern
technology" (AICTE); also 2024 SIH1524/1525 (Godrej).** An energy ledger (rated watts ×
on-time → kWh → ₹ at the user's DISCOM slab), daily/weekly/monthly reports, an
empty-room waste detector that first asks aloud and only switches off after a long
hold (never in bed/night mode), and an AC policy once IR exists. *Test:* 4 weeks of
coin-flip A/B days; false-off rate < 1/day; ledger error against meter photos.
*Limits:* the money is in the AC, not LEDs; proving savings needs a ~₹600 PZEM-004T
meter (optional, user's call).

**SIH-3 · Care at home for elders — 2024 SIH1778 "Innovative Gerontological Care
Solutions" (MSDE).** Spoken medicine reminders with a spoken "haan, le li" logged as
taken, a second reminder then a family alert when missed; an activity rhythm (hourly
motion) that asks "sab theek hai?" when the usual morning movement is missing and alerts
family if nobody answers; "JARVIS, madad" → immediate alert; motion-triggered night
light on the bathroom path. *Test:* 14 days of false inactivity alerts (≤ 1/week);
5-morning missed-event drill; pill-strip agreement. *Limits:* Wi-Fi cannot detect a
fall; one room's coverage; not a medical device.

**SIH-4 · Offline study library with citations — 2025 SIH25231 (NTRO), for the engineering
student.** PDFs, DOCX, slides and notes (OCR via PyMuPDF where pages are scanned) chunked
with page numbers into the same hybrid recall as Yaadash; answers carry numbered
citations and abstain when the notes do not cover the question; lecture audio through
Whisper with timestamps; the same pipeline answers household paperwork ("AC ki warranty
kab tak hai?"). Feeds Mission Germoney's drills. *Test:* a 60-question set written before
tuning (+10 unanswerable): hit@5 for BM25/vector/hybrid, citation precision, abstention
rate, p50/p90 latency. *Limits:* a 4B model is weak at derivations; handwriting and
Devanagari OCR are poor.

---

## Waiting on you

Downloads/installs (each needs your OK with file, source and size): Kokoro fp16 voice
(~170 MB, faster offline speech) · Espressif `esp_csi_gain_ctrl` · Tailscale (you
install and sign in) · `samsungtvws` (TV control) · one 940 nm IR LED (~₹10).
Hardware session: flash the ESP32, calibrate, label 10 minutes (S1).
Decisions: wall switches as Uno inputs vs relays across them (L2); fan-regulator photo.
Private items (identity facts, sources, GitHub chores): `data/notes/ROADMAP-private.md`.

---

## The build loop

While the session is open, a recurring prompt hands me the next item: take the
highest unblocked unchecked item (Track 0 first, then the SIH items, then the rest),
build it end to end with tests on scratch data, run all three suites, update
DECISIONS.md, tick it here with the commit, scan and push, and add anything newly
discovered under the right track. Blocked items are skipped, never faked. Parallel
work runs in separate git worktrees and is merged only when all suites pass.

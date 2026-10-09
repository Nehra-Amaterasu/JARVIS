# Engineering Log

A running record of the decisions behind JARVIS — what I changed, why, and the
measurement that justified it. Newest first.

**Rule I hold myself to:** no claim without evidence. Every entry cites a benchmark,
a command output, or a reproducible test. If I couldn't measure it, I say so.

Format per entry: **Context → Decision → Evidence → Consequences / open items.**

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

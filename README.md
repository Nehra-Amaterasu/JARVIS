# JARVIS

A local-first personal AI assistant: it listens, remembers, senses the room, and
controls devices — running entirely on a laptop with a **6 GB GPU**, no cloud LLM.

JARVIS understands Hinglish and answers aloud (in British English unless asked
otherwise), remembers years of my real conversations, knows
who the important people in my life are, and is built to say *"I don't know"* rather
than invent an answer.

> Subsystems carry Hindi names: **Yaadash** (याददाश्त, memory) and **Aankhen**
> (आँखें, eyes).

---

## Results

Every number below is measured on the target hardware. Method and history for each
are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

| | Before | After |
|---|---|---|
| Time to the model's first token (text) | 22–97 s | **0.6 s** |
| Time to first audio, real voice turns (2026-10-10 log) | — | 2.1–10.8 s — still too slow |
| Speech-to-text (15 s Hinglish clip) | 10.7 s, garbled | **2.7 s**, word-accurate |
| Memory: finds a one-line message from 2021 | — | ✅ dated excerpt |
| Closeness model vs. my own Close Friends list | — | **95 % precision@20** |
| Refuses to invent a memory it doesn't have | ❌ fabricated | ✅ abstains |

---

## Architecture

```
 mic ─▶ wake word ─▶ Whisper large-v3-turbo (GPU) ─▶ Hinglish romanizer
                                                          │
                                                          ▼
              ┌──────────────────────── agent ───────────────────────┐
              │  short-term memory (last 6 turns)                    │
              │  Yaadash ── identity facts      (authored, trusted)  │
              │          ── people + closeness  (tie-strength model) │
              │          ── episodic recall     (BM25 + vector, RRF) │
              │          ── beliefs             (inferred, hedged)   │
              │  Qwen3-4B-Instruct-2507 via Ollama (GPU, 50 tok/s)   │
              │  tools ── room control (lights, fan) via MCP         │
              └──────────────────────────┬───────────────────────────┘
                                         ▼
                    speech sanitiser ─▶ edge-TTS ─▶ speaker

 ESP32-S3 (Wi-Fi CSI) ─USB─▶ Aankhen hub ─▶ presence for the agent, 3D twin in the app
```

**VRAM budget (6 GB):** LLM ~3.3 GB + Whisper turbo ~1 GB. Embeddings, BM25 and all
the machine learning run on CPU, by design.

---

## Subsystems

### Brain — `core/agent.py`
Qwen3-4B-Instruct-2507 (4-bit) through Ollama. Chosen over the hybrid reasoning
Qwen3-4B after measuring that the hybrid model spent ~1,000 hidden tokens deliberating
before every reply. Two temperatures: lively for conversation, near-deterministic for
answers grounded in retrieved memory. Output is length-capped after a runaway
generation loop was caught in testing.

### Voice — `core/jarvis.py`, `core/hinglish.py`
Wake word → VAD → Whisper turbo → **single-script Hinglish**: Devanagari runs are
romanized, English is left untouched so device commands still match. A sanitiser
strips Markdown and emoji before text-to-speech.

### Memory (Yaadash) — `yaadash/yaadash_*.py`
| Module | Role |
|---|---|
| `yaadash_v2.py` | Identity store (LanceDB + bge-small on CPU); labelled retrieval channels |
| `yaadash_archive.py` | 110k messages, both sides, as 14k embedded conversation windows |
| `yaadash_people.py` | Name resolution (styled Unicode, Gurmukhi) + tie-strength scoring |
| `yaadash_recall.py` | Hybrid BM25 + vector search, Reciprocal Rank Fusion, abstention gate |
| `yaadash_taste.py` | NMF topic model over 21k liked/saved captions, tracked by year |
| `yaadash_beliefs.py` | Inferred claims with confidence + era; active-learning review |
| `refresh_memory.py` | Rebuilds every layer in dependency order |

Design rationale: [`docs/research/memory-feasibility.md`](docs/research/memory-feasibility.md).

### Sensing (Aankhen) — `aankhen/`
An ESP32-S3 measures how people disturb the Wi-Fi channel state information (CSI)
between it and the router; firmware in `aankhen/firmware/`. The host conditions
the CSI, detects motion down to millimetre movements in the human band (0.4–4 Hz),
and can fuse an LD2450 radar. A learned model tells "someone in my room" from
"family moving past the router": so far trained only on simulated days of this
house (77 % occupancy right on realistic days vs 57 % for the rule-based engine),
and built to be retrained on labelled recordings of the real room.
A physics simulator built from measured RF numbers tests all of it; none of it has
run on the real board yet.
Every frame is tagged `hardware`, `replay` or `simulation`, and capabilities one
antenna can't physically deliver (pose, heart rate) are disabled, not faked.
Write-ups: [`docs/design/aankhen-physics.md`](docs/design/aankhen-physics.md),
[`docs/design/aankhen-learning.md`](docs/design/aankhen-learning.md).

### App — `app/`
FastAPI backend (127.0.0.1, per-launch token) and a React/three.js UI in a native
window: JARVIS's live state, memory, the 3D room twin, room control, hardware
status, and the Mission game.

---

## Engineering notes worth reading

A few problems where the obvious approach was wrong — each documented with evidence:

- **The model wasn't the bug; the context was.** Wrong answers about me traced to
  retrieval handing the model a placeholder, a truncated fact and an unrelated
  message. Fixing retrieval made even the old model answer correctly.
- **Row count is not progress.** Ingesting 12,799 short chat fragments made retrieval
  *worse* — median length 27 characters. Measured the distribution, filtered, fixed.
- **Rank fusion that rewarded the wrong thing.** Summing hits per cluster favoured
  threads that mention a topic often over the single message that answers the
  question. Proper RRF counts each retriever's best rank once.
- **Abstention can't be a single threshold.** Real and forced recall matches overlap
  in embedding distance (0.304 vs 0.307), so a numeric gate removes clear misses and
  the model judges the ambiguous band.
- **Testing my own hypothesis.** I assumed forwarded reels don't indicate closeness.
  Against labelled data, the closeness model won at the top of the ranking — but
  reel-sharing came out as a *positive* signal. Recorded as a partial refutation.

---

## Repository layout

```
app/                      desktop app: FastAPI server (jarvis_app/) + React UI (ui/)
core/                     JARVIS himself: voice loop (jarvis.py), agent, voices, room
  home.py                   where everything lives, written down once
yaadash/                  memory: identity, archive, people, recall, taste, beliefs
aankhen/                  spatial sensing (Python package)
  firmware/                 ESP32-S3 sketch — copy secrets.example.h to secrets.h
  web/                      standalone 3D viewer
mission-germoney/         the original Expo app (the game itself is a tab in app/)
docs/
  DECISIONS.md              engineering log: every change, with evidence
  TESTING.md                spoken capability test protocol
  research/  design/  vision/
requirements/             pinned environment (Python 3.11) + link_venv.py
data/                     everything personal — git-ignored, never pushed
```

Each part keeps its first-generation code in a `legacy/` folder: kept for
reference, never imported.

---

## Running it

**Requirements:** Windows 11, NVIDIA GPU with 6 GB+ VRAM, Python 3.11,
[Ollama](https://ollama.com).

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements/requirements.gpu.txt
.venv/Scripts/python.exe requirements/link_venv.py
ollama pull qwen3:4b-instruct-2507-q4_K_M
.venv/Scripts/pythonw.exe app/JARVIS.pyw
```

`link_venv.py` puts `core/`, `yaadash/` and the root on the venv's import path;
run it again if the folder ever moves. The app starts JARVIS's voice loop from its
Core tab; without the app, `.venv/Scripts/python.exe core/jarvis.py` runs it alone.
Say **"hey jarvis"**, then speak. To build memory from your own Instagram data
export (placed in `~/Downloads`):

```bash
.venv/Scripts/python.exe yaadash/refresh_memory.py
```

Tests: `.venv/Scripts/python.exe -m pytest aankhen/tests`, then from `app/`,
`../.venv/Scripts/python.exe -m pytest tests` and `npx vitest run` in `app/ui/`.

---

## Privacy

All personal data stays on the machine, in `data/`: memory stores, derived
profiles, identity facts, the home's layout and sensor recordings, trained models
and app state. The whole folder is git-ignored, as is `secrets.h`. Identity
documents are deliberately never ingested, and the assistant is instructed and
tested to refuse to recite them.

---

## Status

| Area | State |
|---|---|
| Voice loop, brain, memory, recall | working, measured |
| Belief distillation at scale | implemented, not yet run on full history |
| Aankhen Wi-Fi sensing | complete on the physics simulator; awaiting real-room recordings |
| Physical relay control | firmware + USB commands done; mains wiring in progress |
| Desktop app | built and in daily use |

Known limitation: on long answers about past events, the 4B model occasionally
narrates my actions in the first person. A larger model would fix it; the VRAM
budget currently doesn't allow one.

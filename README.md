# JARVIS

A local-first personal AI assistant: it listens, remembers, senses the room, and
controls devices — running entirely on a laptop with a **6 GB GPU**, no cloud LLM.

JARVIS answers in spoken Hinglish, remembers years of my real conversations, knows
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
| Time to first spoken word | 22–97 s | **0.6 s** |
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

 ESP32-S3 (Wi-Fi RSSI sensing) ─serial─▶ memory_server API ─▶ presence / visualizer
```

**VRAM budget (6 GB):** LLM ~3.3 GB + Whisper turbo ~1 GB. Embeddings, BM25 and all
the machine learning run on CPU, by design.

---

## Subsystems

### Brain — `brain/agent.py`
Qwen3-4B-Instruct-2507 (4-bit) through Ollama. Chosen over the hybrid reasoning
Qwen3-4B after measuring that the hybrid model spent ~1,000 hidden tokens deliberating
before every reply. Two temperatures: lively for conversation, near-deterministic for
answers grounded in retrieved memory. Output is length-capped after a runaway
generation loop was caught in testing.

### Voice — `brain/jarvis.py`, `brain/hinglish.py`
Wake word → VAD → Whisper turbo → **single-script Hinglish**: Devanagari runs are
romanized, English is left untouched so device commands still match. A sanitiser
strips Markdown and emoji before text-to-speech.

### Memory (Yaadash) — `brain/yaadash_*.py`
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

### Sensing (Aankhen) — `brain/aankhen_*.py`, `brain/aankhen_esp32_firmware/`
ESP32-S3 firmware measuring Wi-Fi RSSI/CSI disturbance for presence and motion,
streamed over serial and WebSocket. `aankhen_v2.py` adds an LD2450 mmWave radar
path. Every frame is tagged `hardware` or `simulation`, and capabilities the hardware
can't physically deliver (single-antenna pose, radar vitals) are explicitly disabled.

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
brain/                    runtime code (entry point: jarvis.py)
  aankhen_esp32_firmware/   ESP32-S3 sketch — copy secrets.example.h to secrets.h
  legacy/                   first-generation code, kept for reference, not imported
docs/
  DECISIONS.md              engineering log: every change, with evidence
  TESTING.md                spoken capability test protocol
  research/                 design notes
  design/                   subsystem specs
  vision/                   long-term vision (aspirational)
requirements/             pinned environments (GPU: Python 3.11)
```

---

## Running it

**Requirements:** Windows 11, NVIDIA GPU with 6 GB+ VRAM, Python 3.11,
[Ollama](https://ollama.com).

```bash
python -m venv brain/.venv311_gpu
brain/.venv311_gpu/Scripts/pip install -r requirements/requirements.gpu.txt
ollama pull qwen3:4b-instruct-2507-q4_K_M
cd brain && .venv311_gpu/Scripts/python.exe jarvis.py
```

Say **"hey jarvis"**, then speak. To build memory from your own Instagram data
export (placed in `~/Downloads`):

```bash
cd brain && .venv311_gpu/Scripts/python.exe refresh_memory.py
```

---

## Privacy

All personal data stays on the machine. Memory stores, derived profiles, identity
facts and device credentials are gitignored (`identity/`, `brain/yaadash_data/`,
`lancedb/`, `secrets.h`). Identity documents are deliberately never ingested, and
the assistant is instructed and tested to refuse to recite them.

---

## Status

| Area | State |
|---|---|
| Voice loop, brain, memory, recall | working, measured |
| Belief distillation at scale | implemented, not yet run on full history |
| ESP32 presence sensing | firmware + bridge working; integration with the agent in progress |
| Physical relay control | in progress (currently a virtual room) |
| Desktop app | designed ([spec](docs/design/jarvis_desktop_app_design_spec.md)), not built |

Known limitation: on long answers about past events, the 4B model occasionally
narrates my actions in the first person. A larger model would fix it; the VRAM
budget currently doesn't allow one.

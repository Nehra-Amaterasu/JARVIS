# JARVIS always on: resident brain, staff → orchestrator feed, supervisor, startup, less memory (2026-10-15)

## Question

Can JARVIS stay live 24/7 on this laptop (RTX 4050 6 GB, 16 GB RAM)? Five parts:

1. Keep the brain loaded. Until now it unloaded after 30 quiet minutes.
2. Let the crew, Aankhen and the limbs feed events to the core, so JARVIS can comment on movements without being asked, honestly and rarely.
3. Recover by himself when the voice core, the app or the microphone dies.
4. Start at login.
5. Use less memory, and log a health line once a minute overnight.

## Method

- **Two scratch instances** of the app and voice core, each run for 15 to 16 minutes. "Before" ran the code at `8f4ef5b`; "after" ran this branch.
  - Port 8791/8792 and a fixed token. They never touched 127.0.0.1:8777, which was not running today anyway.
  - Their own copies of the data: `JARVIS_DATA_DIR`, `AANKHEN_DATA_DIR` and `JARVIS_YAADASH_DIR` pointed at a scratch folder.
  - `JARVIS_UNO=0`, and Aankhen ran in simulation.
  - A `sitecustomize` replaced `sounddevice.InputStream` with a silent fake stream (no microphone was opened) and refused every `serial.Serial`, so COM8 and COM9 were never opened. The after-runs also blocked MQTT (see Caveats).
  - Audio output went to SDL's dummy driver.
- **Sampling.** Every ~15 s, `psutil` measured the working set and private bytes, summed over each process tree. The venv's `python.exe` is a launcher, so the real interpreter is its child: the first sampler read 0.2 MB until I summed the trees. `nvidia-smi` gave `memory.used`, and Ollama `/api/ps` showed what was resident.
- **Library costs.** Import cost of each heavy library, in a fresh interpreter.
- **Leak check.** A `tracemalloc` probe of the app server.
- **Latency.** First-token latency of the brain via `/api/chat` streaming: cold, warm, and after each kind of pin.

**Caveats.**
- Other agents ran test suites and a Vite server on the same machine during the runs. The GPU and Ollama are shared.
- The first two baseline attempts failed. The first sampler was wrong (see Method). Then the voice core of the second attempt died at boot with `RuntimeError: mkl_malloc: failed to allocate memory` while loading Whisper: the system was at 28.5 of 34.9 GB commit. That is exactly the crash the new supervisor restarts.
- In the after-run, Ollama dropped the brain at about 13:31. Something outside JARVIS did it; my test suite was running at the same time, but nothing in it calls the real Ollama. The keeper reloaded it at 13:36:00 (below).

## Measurements

### RAM: steady state, median of the samples after boot (MB)

| | app working set | app private | core working set | core private | total private |
|---|---|---|---|---|---|
| before (`8f4ef5b`, 43 samples) | 740 | 1521 | 1660 (Windows trimmed it from 1727) | 3906 | **5427** |
| after, first start (33 samples) | 750 | 890 | 1527 | 2992 | **3882 (-1545, -28 %)** |
| after, restart with nothing new to learn (30 samples) | 228-326 | 271-337 | 1521 | 3021 | **~3330 (-2100, -39 %)** |

Where the savings come from:

- **OpenBLAS thread buffers** (-631 MB in the app, -914 MB in the core):
  - OpenBLAS reserves a buffer per thread, sized for all 12 logical cores, once for numpy's copy and once for scipy's.
  - In isolation, numpy + torch + sentence-transformers + sklearn came to 1400 MB private with the default thread count, 878 MB with 4 threads, 750 MB with 2 and 685 MB with 1. The working set was the same at every setting (589-598 MB).
  - Now `OPENBLAS_NUM_THREADS=2` is set, if not already set, in `jarvis_app/__init__.py` and at the top of `core/jarvis.py`, and the core inherits it.
  - Private bytes are commit charge. Running out of commit is what killed the Whisper load above.
- **The chat learner no longer loads the embedder for nothing.**
  - Its pass imports `yaadash_v2`, which brings in torch + sentence-transformers: the app grew from 326 to 820 MB working set when that first pass ran.
  - Now the pass is skipped when the transcripts folder is unchanged since a pass that had nothing left to do (model read every chat, none still going). The verdict is kept in `data/app/crew/learner.json`.
  - After a restart with no new chats, the app stayed at 228-326 MB working set and 271-337 MB private. The embedder loads on the first new conversation, as before.

Library import costs (fresh interpreter, working set / private, MB):

| Import | Working set | Private | Notes |
|---|---|---|---|
| numpy | 11 | 394 | OpenBLAS, default threads |
| torch | 344 | 816 | |
| faster_whisper | 383 | 857 | pulls in torch and transformers |
| sentence_transformers | 582 | 1391 | |
| langchain_ollama | 404 | 872 | |
| sklearn | 126 | 841 | |
| lancedb | 100 | 469 | |

`langchain_ollama` costs that much because `langchain_core.language_models.base` does `from transformers import GPT2TokenizerFast` at import time, which loads transformers and torch. The core needs torch anyway (the embedder), so I left it.

### VRAM (MiB, card 6141)

| | used |
|---|---|
| Whisper large-v3-turbo + Silero + CUDA context (core alone) | 1097-1179 |
| + brain qwen3:4b-instruct-2507-q4_K_M at num_ctx 8192 (3070 MiB in `/api/ps`) | 4346-4468 |
| before (same pair, keep_alive 30m) | 4378 |

Both stay resident with about 1.7 GB to spare, so no fallback was needed: Whisper stays on the GPU at int8_float16, and the quantisation stays Q4_K_M.

### Latency: first token, short prompt, num_ctx 8192

| | first token |
|---|---|
| cold (unloaded first) | **10.16 s** |
| warm | 0.85 s, 0.91 s |
| after a pin with an empty `/api/generate` (Ollama loads at **num_ctx 4096**) | **11.15 s**: the 8192 question reloads it |
| after a pin with `options.num_ctx = 8192` | 0.93 s |

So "keep it loaded" also means "keep it loaded at JARVIS's context size". The first keeper pinned at 4096 (seen live: `context_length 4096` in `/api/ps`). It now pins at 8192, and re-pins when it finds a different size.

An unprompted remark from the real brain, through the strict template, took 0.88-1.08 s per line. All 12 lines tried passed the honesty checks (hedge present, no invented numbers). For example: "If I'm reading the room right, sir, the desk has been very still for 64 minutes."

### Leak check

The app's working set rose ~3.5 MB/min in one 15-min run. `tracemalloc` put the growth in Aankhen's packet queue (`transport.py:207`): the engine fell behind a CPU-starved simulator. That queue is bounded (`maxsize`, oldest dropped), so the growth plateaus. The restart run, on a quieter machine, was flat for 8 min (326.2 → 326.5 → 228.4 MB). This is not from the new code. It is the same CPU starvation the 10-14 app-state audit (item 7) describes.

## Decisions and what changed

1. **Brain resident.**
   - `core/agent.py`: `keep_alive=-1` on both brain models. `JARVIS_KEEP_ALIVE` overrides it (for example `30m` for the old behaviour).
   - `core/ollama_guard.py` `Keeper`, every 5 min and never mid-turn:
     - loads the brain when Ollama dropped it;
     - re-pins it when another client's `"30m"` request (the learner, the beliefs and taste passes, Mission's AI) put it back on a timer;
     - reloads it when it was loaded at another num_ctx.
   - Seen live in the scratch run: "`[Ollama] brain not loaded: pinned again (keep_alive=-1)`" at 13:36:00, and VRAM back to 4032 MiB.
   - Boot already warmed the brain with the full system prompt.
   - A deliberate stop of the voice core puts the brain back on Ollama's 30-minute timer, if it is loaded (`routes_alwayson` stop hook), so a stopped JARVIS does not hold 3 GB of VRAM forever.
2. **Staff → orchestrator.**
   - `crew/feed.py` classifies bus events and queues them by priority (3 urgent .. 1). A repeat inside a kind's cooldown is dropped, as is anything older than 10 min. The queue holds at most 50.
     - From the crew: `arrived` and `left` from the movement watcher, `sedentary`, `aankhen_silent` / `aankhen_back`.
     - From the limbs: `relay_failed`, the Uno board disconnecting or reconnecting, a light or fan changed by something other than him.
     - From reminders: a reminder coming due. `reminders.py` already speaks it, so it is logged as `handled`.
     - Worked out by the feed itself:
       - `long_stillness`: 60 min "still" at the desk or in the room, never in bed;
       - `went_to_bed`: 15 min on the bed between 21:00 and 04:00;
       - `woke_up`: off the bed for 2 min between 05:00 and 12:00 after a night in it.
   - Wi-Fi estimates are always "probable". Under p = 0.5 they are "unknown", and nothing is said.
   - `routes_alwayson.py` taps `bus.publish`. It does not subscribe, because a subscriber would count as an open window for the Mission game. It forwards at most one event per 5 s to the core, with whether media is playing.
   - **`core/proactive.py`** decides, checking in this order: off, muted, text mode, nobody there ("left"), handled elsewhere, no evidence, quiet hours (default 00:30-07:00), stale, busy (he or JARVIS is talking, a turn is in progress, or he spoke within 60 s), media playing (loudness cannot be read, so any playback counts), rate limit (default one remark per 20 min).
   - The line comes from the brain with a strict template: facts only, ≤ 20 words, a hedge for estimates. It is checked for length, invented numbers, a missing hedge and questions. A line that fails is replaced by a fixed template line.
   - The switch: `POST /api/settings/proactive`, a "Remarks" switch on the Connect tab (`RemarksCard.tsx`; it needs `npm run build`), and by voice: "Jarvis, quiet mode" / "you can talk again". The voice command is a fast path that writes the same settings key.
   - Every decision, spoken or not, goes to `data/app/proactive.jsonl`. A spoken remark is kept in the transcript as his turn.
3. **Survive.**
   - (a) `app/jarvis_app/core.py`: when the core exits while the app still wants it, the exit and the last 40 log lines go to `data/app/core_crashes.log`.
     - It restarts in the same mode after 5 s, 15 s, 60 s, then 300 s, at most 5 times in any hour (`backoff.RestartBudget`). A 10-minute run resets the backoff.
     - Past the limit it publishes `gave_up`. `stop()` is the only deliberate exit.
   - (b) `app/watchdog.pyw`:
     - Holds a single-instance lock (`msvcrt.locking`), so a second watchdog exits at once.
     - Starts `JARVIS.pyw` with `JARVIS_AUTOSTART_CORE=voice` and `JARVIS_NO_MESSAGEBOX=1`. An error dialog at 3 am would block the restart.
     - Watches an already-open JARVIS instead of starting a second one.
     - Exit code 0 means the window was closed on purpose, so the watchdog stops too (`--always` overrides that).
     - Anything else is restarted after 10 s, 30 s, 2 min, then 5 min, at most 6 times an hour; past that it waits out the hour. Its log is `data/app/watchdog.log`.
   - (c) `core/mic.py` + the wake loop:
     - The mic is pinned by name: settings `"mic": {"name": …}`, else the default input at start. On this laptop that is "Microphone Array (Intel® Smart" on MME (#1). A Bluetooth headset that becomes Windows' default does not move him.
     - No audio block for 5 s → the stream is reopened, the PortAudio device list is refreshed (92 ms measured) and the mic is found again by name.
     - A routine re-look every 5 min while asleep, never mid-burst.
     - A heartbeat every 60 s (alive, peak level, reopens). Every recording stream opens on the same device.
4. **Startup.** `app/install_startup.py` writes `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\JARVIS.lnk` through WScript.Shell. It points at `.venv\Scripts\pythonw.exe "app\watchdog.pyw" --core voice`. `--remove` deletes it and `--dry-run` prints what it would do. No registry, no scheduled task, no admin. **Not run: Aman runs it.**
5. **Observability.**
   - `data/app/health.log`: one JSON line a minute, with:
     - working set, private bytes and CPU of the app and of the core;
     - VRAM;
     - the brain (loaded, pinned, num_ctx);
     - the mic (alive, age, device, reopens);
     - the last wake;
     - core state, mode and uptime, app uptime;
     - restarts, remarks queued.
   - The wake log keeps the last 500 wakes on disk (`data/app/wake.jsonl`) across restarts. The System tab still shows this run's wakes.

## Open

- The scratch runs ran the voice core with a fake (silent) microphone. The stall watchdog, the pinned mic and a real Bluetooth switch need one real test on his laptop: connect the headset while JARVIS sleeps and say "Jarvis".
- A real night is still to be measured: false wakes from `wake.jsonl`, remarks from `proactive.jsonl`, the memory trend from `health.log`.
- The bed and waking-up events depend on Aankhen's zone model. Per the 10-14 data note, it confuses away with "bed", so these will often be "unknown" (silent) until that model is retrained.
- The before-run's scratch core connected to the local Mosquitto broker. `room.py` connects at import and publishes retained `jarvis/room/*` on room changes. The relays are on the Uno since 10-13, so nothing physical listens. The after-runs blocked MQTT.

## Sources (local)

- Scratch harness and raw samples, in the session scratchpad `alwayson/`:
  - scripts: `run_scratch.py`, `site/sitecustomize.py`, `leak_probe.py`, `cold_warm.py`;
  - samples: `before.csv`, `after.csv`, `restart.csv`, `leak.out`.
- `data/notes/research/2026-10-14-feature-inventory.md` §5 (overnight risks 2, 4, 6, 8, 9, 13, 15) and `2026-10-14-app-state-audit.md` §7.
- Ollama `/api/ps` and `/api/chat`; `nvidia-smi`; `psutil`; `sounddevice.query_devices()`.

# JARVIS — desktop app

One window for everything JARVIS does. It replaces starting `jarvis.py` from a
command prompt.

| tab | what you get |
|---|---|
| **Core** | wake JARVIS (voice, or text-only), live state, conversation, measured latency; flag any turn (wrong / slow / misheard) and export a review file |
| **Yaadash** | memory search that returns the real conversation (both sides, dated), beliefs to confirm or correct, closest people, taste over the years |
| **Aankhen** | the room as a 3D twin: people, Wi-Fi motion, presence belief, heat map; simulator / replay / ESP32 sources |
| **Limbs** | the light and fan, driving the ESP32 relays over USB; "confirmed" only when the board agrees |
| **Connect** | every sensor, model and data source, detected live, each with its next step |
| **System** | VRAM against the 6 GB ceiling, loaded models, models on disk, JARVIS's log, the engineering log |

**Mission Germoney** — the year to a German VLSI master's, as a game (design and
reasons: [docs/design/mission-game.md](../docs/design/mission-game.md)):

| tab | what you get |
|---|---|
| **HQ** | level, rank, streak, Marks; the daily Floor (Silicon · Deutsch · Body) and its supply drop; the boss of the month; Boot Camp; attributes; Rule 1 |
| **Contracts** | three a day from people with faces and Intel cards; combo and crit; the weekly operation you stake Marks on |
| **Campaign** | twelve monthly bosses (Oct 2026 → Sep 2027) — real deliverables, HP, hit log, the kill with proof |
| **Trials** | NPTEL, Goethe A1/A2, IELTS, dMAT, APS, uni-assist, the internship — each with sourced cost and timing |
| **Drill** | spaced repetition: VLSI interview questions, German A1, Germany operations |
| **Armory** | spend Marks on rewards you set; achievements; the War Chest (real costs by due date); exam and recovery modes |
| Crucible · Forge · Syllabus · Terminal · Interrogation · Proof · Schedule | the original Mission Germoney tools, feeding the game |

`Ctrl K` opens the command palette from anywhere; `Ctrl 1–6` switches tabs, `Ctrl 0` opens HQ.

### Say it to JARVIS

| you say | what happens |
|---|---|
| "Jarvis, brief me" · "aaj kya karna hai" | the day: floor, contracts, boss, Marks |
| "log 2 hours of German" · "maine 45 minute verilog kiya" | logged, the matching rep ticked |
| "start a 50 minute focus on German" | the Crucible starts |
| "contract done: ripple carry adder" | that contract completed (drawn amber: a voice report is a claim) |
| "how many marks do I have" · "redeem an anime episode" | the Armory |

Commands are parsed by `brain/mission.py` without the model, so they are instant and
can't be misheard into a different action; questions ("what should I study now?") go
to the model with the live mission state in its prompt.

## Run it

Once, from the repo root:

```bash
cd app/ui && npm ci && npm run build
powershell -ExecutionPolicy Bypass -File app\install_shortcut.ps1
```

Then open **JARVIS** from the Start menu or the Desktop. (Or run
`brain\.venv311_gpu\Scripts\pythonw.exe app\JARVIS.pyw`.) If the UI was never built,
the launcher builds it on first start.

## Develop

```bash
# terminal 1: the server with a fixed token (JARVIS_DATA_DIR keeps your real progress out of it)
cd app && JARVIS_DATA_DIR=../scratch ../brain/.venv311_gpu/Scripts/python.exe -m jarvis_app.desktop --server-only --token dev
# terminal 2: the UI with hot reload, proxied to that server
cd app/ui && npm run dev        # open http://localhost:5173/#t=dev
```

Tests:

```bash
cd app && ../brain/.venv311_gpu/Scripts/python.exe -m pytest -q tests     # server, limbs, transcripts, game bridge, voice parser
cd app/ui && npm test                                                       # game engine, store, voice actions, ported Germoney logic
```

## How it fits together

```
JARVIS.pyw ─▶ jarvis_app (FastAPI on 127.0.0.1, per-launch token) ─▶ WebView2 window
                 ├─ core.py        runs brain/jarvis.py --app as a child process
                 ├─ memory.py      brain/yaadash_* (search, beliefs, people, taste)
                 ├─ /ws/aankhen    brain/aankhen hub (engine + serial/replay/simulator)
                 ├─ limbs.py       the room's single owner; relays over USB
                 ├─ germoney.py    Mission storage, local AI, GitHub, calendar, focus guard
                 ├─ /api/game/*    JARVIS ⇄ the game (the rules run in the UI, tested there)
                 └─ /ws/events     one stream every tab and the ticker listen to
```

- **Why JARVIS stays a separate process.** The voice loop owns the microphone,
  Whisper on CUDA and audio playback. If it crashes, the window must not; and
  "Put to sleep" must really free the GPU, which only process exit guarantees.
  The two talk over the child's stdin/stdout (`brain/appio.py`).
- **Why the game's rules live in the UI.** One engine, pure functions, unit-tested;
  JARVIS reaches it through the server (`/api/game/action` → the open window runs
  it → one spoken line back), so there is never a second copy of the rules to drift.
- **Why WebView2 and not Electron.** It ships with Windows 11, so there's no bundled
  Chromium, and it uses roughly 100 MB less RAM. RAM matters on a machine that
  also runs the LLM.
- **Security.** The server listens on 127.0.0.1 only, every API call and socket needs
  a token generated at launch, and the Host header is checked to block DNS
  rebinding. Memory holds friends' messages, so none of this is optional.

The design language and the reasoning behind each visual are in
[docs/design/jarvis-app.md](../docs/design/jarvis-app.md).

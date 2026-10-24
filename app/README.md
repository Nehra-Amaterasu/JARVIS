# JARVIS: the desktop app

One window for everything JARVIS does, and the process that keeps him running. It
starts and supervises the voice core, owns the boards, and serves the UI.

| tab | what you get |
|---|---|
| **Core** | wake JARVIS (voice, or text only), live state, the conversation, measured latency; flag any turn (wrong / slow / misheard) and export a review file |
| **Yaadash** | memory search that returns the real conversation (both sides, dated), beliefs to confirm or correct, closest people, taste over the years, the study library |
| **Aankhen** | the room as a 3D twin: where movement probably is, drawn as a dot cloud over 15 zones; human-band motion; the honest state (`in_room` / `empty` / `unsure`, with the reason); the daily drill; simulator / replay / board sources |
| **Limbs** | the light and fan, switched through the board that owns each one (the Uno over USB today); a device shows "confirmed" only when the board's reply agrees; editable on/off modes; the ESP32's firmware, relays and Wi-Fi link |
| **Connect** | every sensor, model and data source, detected live, each with its next step; the brain and voice to choose and test; phone access; the Remarks switch |
| **System** | VRAM against the 6 GB ceiling, loaded models, models on disk, JARVIS's log, the wake log, the engineering log |

**Mission Germoney**, a study game built on a skill tree (design and reasons:
[docs/design/mission-game.md](../docs/design/mission-game.md)):

| screen | what you get |
|---|---|
| **Today** | the day's contracts, each with what to read first, steps, a hint and a "done when"; the day's blocks; the Floor; deadlines coming up |
| **Tree** | the skill tree as a DAG (locked, available, in progress, mastered), a career overlay, node details with certificates, projects and links |
| **Focus** | the Crucible (deep work) and spaced-repetition Drill |
| **Log** | one log form (also by voice), the gym, "what got in the way", GitHub activity, the learning log |
| **Road** | campaigns with finish lines, the internship pipeline, certificates against a budget, the parking lot for new ideas, trials, the War Chest |

Settings and calibration sit in a drawer. Exam mode switches contracts to one subject's
units and past-paper questions; after a few idle days the game welcomes you back
instead of breaking a streak.

`Ctrl K` opens the command palette from anywhere; `Ctrl 1-6` switches tabs, `Ctrl 0`
opens Mission.

### Say it to JARVIS

| you say | what happens |
|---|---|
| "Jarvis, brief me" · "aaj kya karna hai" | today's first contract, then the rest |
| "explain this contract" | what to read first, the steps, the hint, the check |
| "contract done: ripple carry adder" · "I finished it" | that contract completed (drawn amber: a voice report is a claim) |
| "what's next on the tree" | the node to resume, or the best one to start |
| "exam mode for <subject>" · "exam mode off" | contracts follow that subject for 14 days |
| "what internship deadlines are coming up" | the pipeline's next closing dates |
| "log 2 hours of German" · "maine 45 minute verilog kiya" | logged once, in the one log |
| "start a 50 minute focus on German" | the Crucible starts in the window |
| "remember that my exam is on the 12th" · "remember that." | kept as a fact, in his prompt from the next reply |
| "light band kar do" · "turn on the fan" · "sab band karo" | the room, through Limbs; he says it is done only after the board confirms |
| "Jarvis, quiet mode" · "you can talk again" | unprompted remarks off / on |
| "say it in an American accent" · "Hindi mein bolo" | the reply switches voice (British by default) |

Commands are parsed without the model (`core/mission.py`, `room.py`, the chat learner),
so they are instant and cannot be misheard into a different action; questions ("what
should I study now?") go to the model with the live state in its prompt. The plan runs
in the server, so Mission voice commands work with the window closed.

A reply that was wrong can be flagged in Core with the right answer and **Teach him**
ticked: it becomes a correction he follows from then on.

## Run it

Once, from the repo root:

```bash
cd app/ui && npm ci && npm run build
powershell -ExecutionPolicy Bypass -File app\install_shortcut.ps1
```

Then open **JARVIS** from the Start menu or the Desktop (or run
`.venv\Scripts\pythonw.exe app\JARVIS.pyw`). If the UI was never built, the launcher
builds it on first start.

**Always on (opt-in).** `.venv\Scripts\python.exe app\install_startup.py` adds a Startup
shortcut to `app\watchdog.pyw --core voice`: it starts JARVIS at login, restarts it if it
dies (10 s, 30 s, 2 min, then 5 min; at most 6 times an hour) and stops when you close
the window on purpose. `--remove` undoes it. Inside the app the voice core is restarted
the same way (5 s, 15 s, 60 s, 300 s; at most 5 an hour), and crashes are logged with
their last 40 lines.

**Starting the app turns the light and fan off**: opening the Uno's port resets it. If
you are at the keyboard or the real board sees you, they come back on once.

### From the phone (off by default)

Connect, **Phone**, then **Switch phone access on**. The laptop also serves
`http://<laptop-ip>:8778/phone` on the home Wi-Fi; the desktop window is unchanged.
Once, in an **admin** PowerShell (the app never changes the firewall):

```powershell
New-NetFirewallRule -DisplayName "JARVIS phone (TCP 8778)" -Direction Inbound -Protocol TCP -LocalPort 8778 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

Then **Pair a phone** and scan the code. Light, fan, modes and typing work over http.
The microphone needs https: with Tailscale on both devices,
`tailscale serve --bg --https=443 http://127.0.0.1:8778`, and add the
`https://<laptop>.<tailnet>.ts.net` address in the card. `JARVIS_PHONE=1/0` forces the
switch for one run. Why, and the options compared:
[docs/research/2026-10-14-phone-access.md](../docs/research/2026-10-14-phone-access.md).

### The ESP32 over Wi-Fi (experimental)

Firmware 3.5.0 sends the board's frames and takes relay commands over a signed UDP link.
Limbs, **Wi-Fi link**: "Show the secrets.h line" (the key, shown only on request),
the firewall rule for UDP 47270, then "Connect over Wi-Fi". The link is built and
tested against a fake board; it has not yet been verified at home, so the Uno stays the
relay path until it is. Design and numbers:
[docs/research/2026-10-16-wireless-esp32-hub.md](../docs/research/2026-10-16-wireless-esp32-hub.md).

## Develop

```bash
# terminal 1: the server with a fixed token, on scratch data
cd app && JARVIS_DATA_DIR=../scratch AANKHEN_DATA_DIR=../scratch/aankhen ../.venv/Scripts/python.exe -m jarvis_app.desktop --server-only --token dev
# terminal 2: the UI with hot reload, proxied to that server
cd app/ui && npm run dev        # open http://localhost:5173/#t=dev
```

Never run `npm run build` while `JARVIS.pyw` is running: it serves `app/ui/dist`.

Tests:

```bash
cd app && JARVIS_DATA_DIR=../scratch ../.venv/Scripts/python.exe -m pytest -q tests
cd app/ui && npx vitest run && npx tsc -b
```

The app's tests set `JARVIS_UNO=0` and `AANKHEN_NET=0`, so no test opens the real Uno or
sends a datagram to the LAN.

## How it fits together

```
JARVIS.pyw ─▶ jarvis_app (FastAPI on 127.0.0.1, per-launch token) ─▶ WebView2 window
  ▲              ├─ core.py           runs core/jarvis.py --app as a child; restarts it with backoff
  │              ├─ routes_alwayson   the event feed to the core; keeps the brain loaded
watchdog.pyw     ├─ routes_crew       movement watcher, chat learner, steward, task ledger
(login, opt-in)  ├─ memory.py         yaadash (search, beliefs, people, taste, library)
                 ├─ /ws/aankhen       aankhen hub: engine, zone belief, drill, teachers
                 ├─ limbs.py          the single writer for every device (devices.json)
                 │    ├─ uno.py         the Uno on USB; a switch counts on its JSON reply
                 │    └─ esp32_link.py  the ESP32's key; relays over USB or signed UDP
                 ├─ germoney.py       Mission: the plan engine, the bank, exam mode, internships
                 ├─ phone.py          the second listener (off by default), 4 routes
                 └─ /ws/events        one stream every tab and the ticker listen to
```

- **Why JARVIS stays a separate process.** The voice loop owns the microphone, Whisper
  on CUDA and audio playback. If it crashes, the window must not; and "put to sleep"
  must really free the GPU, which only a process exit guarantees. The two talk over the
  child's stdin/stdout (`core/appio.py`).
- **Why the plan runs in the server.** Voice must work with the window closed, so the
  Mission plan (contracts, exam mode, the tree's statuses) is computed server-side; the
  window and the server load the same bank files with the same rules, tested against
  the same fixtures. The Floor, Marks and the Crucible still run in the window.
- **Why WebView2 and not Electron.** It ships with Windows 11, so there is no bundled
  Chromium, and it uses roughly 100 MB less RAM. RAM matters on a machine that also
  runs the LLM.
- **One owner per device.** Every load names one board; the Uno's port is opened by one
  process only (opening it resets the board), and on reconnect the room adopts the
  board's state rather than pushing an old one.
- **Security.** The desktop server listens on 127.0.0.1 only, every API call and socket
  needs a token generated at launch, and the Host header is checked to block DNS
  rebinding. The phone listener binds only to private addresses, accepts only private or
  Tailscale peers, uses per-device tokens stored hashed, and serves only its own four
  routes. Memory holds other people's messages, so none of this is optional.

The design language and the reasoning behind each visual are in
[docs/design/jarvis-app.md](../docs/design/jarvis-app.md).

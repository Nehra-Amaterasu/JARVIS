# JARVIS — desktop app

One window for everything JARVIS does. It replaces starting `jarvis.py` from a
command prompt.

| tab | what you get |
|---|---|
| **Core** | wake JARVIS (voice, or text-only), live state, conversation, measured latency, subsystem health, the week's mission numbers |
| **Yaadash** | memory search that returns the real conversation (both sides, dated), beliefs to confirm or correct, closest people, taste over the years |
| **Aankhen** | the room as a 3D twin: people, Wi-Fi motion, presence belief, heat map; simulator / replay / ESP32 sources |
| **Limbs** | the light and fan, through the same `room.apply()` voice commands use |
| **Connect** | every sensor, model and data source, detected live, each with its next step |
| **System** | VRAM against the 6 GB ceiling, loaded models, models on disk, JARVIS's log, the engineering log |

`Ctrl K` opens the command palette from anywhere; `Ctrl 1–6` switches tabs.

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
# terminal 1: the server with a fixed token
cd app && ../brain/.venv311_gpu/Scripts/python.exe -m jarvis_app.desktop --server-only --token dev
# terminal 2: the UI with hot reload, proxied to that server
cd app/ui && npm run dev        # open http://localhost:5173/#t=dev
```

## How it fits together

```
JARVIS.pyw ─▶ jarvis_app (FastAPI on 127.0.0.1, per-launch token) ─▶ WebView2 window
                 ├─ core.py      runs brain/jarvis.py --app as a child process
                 ├─ memory.py    brain/yaadash_* (search, beliefs, people, taste)
                 ├─ /ws/aankhen  brain/aankhen hub (engine + serial/replay/simulator)
                 ├─ limbs.py, connect.py, system.py, mission.py
                 └─ /ws/events   one stream every tab and the ticker listen to
```

- **Why JARVIS stays a separate process.** The voice loop owns the microphone,
  Whisper on CUDA and audio playback. If it crashes, the window must not; and
  "Put to sleep" must really free the GPU, which only process exit guarantees.
  The two talk over the child's stdin/stdout (`brain/appio.py`).
- **Why WebView2 and not Electron.** It ships with Windows 11, so there's no bundled
  Chromium, and it uses roughly 100 MB less RAM. RAM matters on a machine that
  also runs the LLM.
- **Security.** The server listens on 127.0.0.1 only, every API call and socket needs
  a token generated at launch, and the Host header is checked to block DNS
  rebinding. Memory holds friends' messages, so none of this is optional.

The design language and the reasoning behind each visual are in
[docs/design/jarvis-app.md](../docs/design/jarvis-app.md).

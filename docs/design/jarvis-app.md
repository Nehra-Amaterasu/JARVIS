# JARVIS — the desktop application

Until now JARVIS started from a command prompt (`python jarvis.py`) and lived in a
scrolling console. This document is the design for the application that replaces
that: one window, one launcher, every subsystem visible and controllable.

It supersedes the earlier `jarvis_desktop_app_design_spec.md` where they disagree.
That spec described features the hardware cannot deliver (17-joint skeletons and
heart rate from a single Wi-Fi link); this one only shows what is actually measured.

---

## 1. Principles

1. **Every pixel means something.** No decorative animation. A ring that pulses is
   pulsing *because* a value changed; a spinner exists only while something computes.
   If a visual cannot be traced to a field in the data, it is removed.
2. **Honest by construction.** Colour carries provenance, everywhere, the same way:

   | colour | meaning |
   |---|---|
   | ice cyan `#5CE1FF` | measured by hardware / confirmed by me / live |
   | amber `#FFB020` | simulated, replayed, inferred, unconfirmed |
   | signal red `#FF453A` | fault, stale data, disconnected |
   | white / chrome | structure, identity, chrome of the instrument |

   A simulated person is amber. An unconfirmed Yaadash belief is amber. Same rule.
3. **Light on the GPU.** The RTX 4050 has 6 GB and the LLM + Whisper need most of
   it. No post-processing passes, no particle storms; glow is faked in cheap shaders,
   charts are 2D canvas, the 3D twin renders a scene of a few hundred draw calls.
4. **Local and private.** The UI talks only to a server on `127.0.0.1`, which
   requires a per-launch token and checks the Host header (DNS-rebinding guard).
   Memory contains friends' messages — nothing leaves the machine.

## 2. Design language

Four influences, each given a job so they don't fight:

- **Apple** — structure: SF/Inter typography, 8-pt spacing, glass "materials" with
  real blur, spring easing, restraint. The default voice of the UI.
- **Nothing** — data: dot-matrix numerals (Doto) for live values, monochrome with one
  signal colour, unlit dots visible behind lit ones (a gauge shows its scale).
- **Iron Man / JARVIS HUD** — instruments: thin line work, tick rings, reticles,
  the arc-reactor core. Used only where something is being *measured*.
- **Hip-hop** — identity and editorial: heavy condensed display type (Anton) for
  page titles, track-list numbering ("01 —"), sticker badges, a subtle grain, a
  ticker. The "PARENTAL ADVISORY" sticker is reborn as the **EXPERIMENTAL** badge
  on lab-grade features (breathing rate).

Type scale: Anton for H1 only; Inter 600/500/400 for UI; Doto for numerals that
change; Geist Mono for identifiers, timestamps, units.

## 3. Tabs

| tab | what it is | real backend |
|---|---|---|
| **Core** | JARVIS himself: start/stop (voice or text-only), live state, transcript, typed chat, subsystem health, mission tracker | `jarvis.py --app` subprocess, structured events on stdout, commands on stdin |
| **Yaadash** | memory: hybrid search with real excerpts, "ask me" belief confirmation, people/ties, taste trajectory | `yaadash_recall`, `yaadash_beliefs`, `yaadash_people`, `taste_profile.json` |
| **Aankhen** | the spatial twin: 3D room, tracks, Wi-Fi motion, presence, heatmaps, AR | `brain/aankhen` engine (serial / replay / simulator) |
| **Limbs** | everything JARVIS can actuate: lights, relays, fans | ESP32 relay endpoints with token auth; registry in `limbs.json` (gitignored) |
| **Connect** | everything that can be plugged in: boards, sensors, models, data exports — each with live detection and the next step | port scan, Ollama, model cache, export folders |
| **System** | vitals against the 6 GB ceiling, loaded models, latencies, logs, decisions | NVML, psutil, Ollama `/api/ps` |

Additions of my own, each with a reason:
- **Command palette (Ctrl K)** — the keyboard path to everything; JARVIS is a
  developer's assistant first.
- **Mission tracker on Core** — the Germany roadmap's weekly numbers (50
  numericals, 10 h German). The point of JARVIS is to serve that goal, so it sits
  on the home screen where it can't be ignored.
- **Event ticker** — one line at the bottom where every subsystem reports what just
  happened ("P1 left via door", "belief confirmed", "VRAM 5.4 / 6 GB").

## 4. Architecture

```
JARVIS.pyw ──▶ jarvis_app (FastAPI, 127.0.0.1, token) ──▶ pywebview window (WebView2)
                 │  /api/*  /ws/events  /ws/aankhen         │  app/ui (Vite + React + TS)
                 ├─ core: spawns brain/jarvis.py --app       │  three.js twin, canvas charts
                 ├─ memory: yaadash modules (lazy, threadpool)
                 ├─ aankhen: engine + source (serial/replay/sim)
                 ├─ limbs, connect, system, mission
```

The voice loop stays a separate process: it owns the microphone, Whisper on CUDA
and pygame audio; a crash there must not take the window down, and stopping JARVIS
must actually free the GPU.

## 5. Build checklist

- [ ] Aankhen: simulator (wire bytes + ground truth), fusion, engine, hub
- [ ] Aankhen: stronger motion detection, measured on simulated + real recordings
- [ ] Aankhen: bench / record / calibrate / doctor CLI
- [ ] jarvis_app backend: security, events bus, core process, memory, system,
      limbs, connect, mission, aankhen mount
- [ ] jarvis.py `--app` mode: JSON events, stdin commands, text-only mode
- [ ] UI: design system, shell (dock, top bar, ticker, palette), six tabs
- [ ] Desktop shell: pywebview window, launcher, Start-menu shortcut
- [ ] Firmware v3: CSI enabled, binary protocol, token-auth relays, no open AP
- [ ] Real-data benchmark with labelled recordings (empty / walking / sitting)

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

**Motion** (`styles/motion.css`, `lib/motion.tsx`; no animation library). Nothing
appears, changes or leaves without moving, and each move has one meaning:

| Move | Means | Where |
|---|---|---|
| rise | it arrived (staggered by `--i`) | cards, rows, results |
| pop | you made it, or its state just flipped | labels, state words, pills |
| settle | a value changed | bars, meters, `<Ticker>` numbers |
| press | you touched it | every button, chip, tile |
| breathe | it is alive / recording | live LEDs, the teach tile, rec dot |
| scan | you are waiting on it | skeletons, training |
| flight | the view changed, not the world | twin camera (room ↔ whole house) |
| page morph | you went somewhere else | tab changes (View Transitions) |

The springs are real damped springs (ζ 0.55 and 0.75) sampled into CSS `linear()`;
`useSpring` in JS uses the same physics, so a bar and the number beside it settle
together. `prefers-reduced-motion` collapses all of it to plain fades.

## 3. Tabs

| tab | what it is | real backend |
|---|---|---|
| **Core** | JARVIS himself: start/stop (voice or text-only), live state, transcript, typed chat, subsystem health, mission tracker | `jarvis.py --app` subprocess, structured events on stdout, commands on stdin |
| **Yaadash** | memory: hybrid search with real excerpts, "ask me" belief confirmation, people/ties, taste trajectory | `yaadash_recall`, `yaadash_beliefs`, `yaadash_people`, `taste_profile.json` |
| **Aankhen** | the spatial twin: 3D room, tracks, Wi-Fi motion, presence, heatmaps, AR | `aankhen` engine (serial / replay / simulator) |
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
                 ├─ core: spawns core/jarvis.py --app       │  three.js twin, canvas charts
                 ├─ memory: yaadash modules (lazy, threadpool)
                 ├─ aankhen: engine + source (serial/replay/sim)
                 ├─ limbs, connect, system, mission
```

The voice loop stays a separate process: it owns the microphone, Whisper on CUDA
and pygame audio; a crash there must not take the window down, and stopping JARVIS
must actually free the GPU.

## 5. Build checklist

- [x] Aankhen: simulator (wire bytes + ground truth), fusion, engine, hub
- [x] Aankhen: stronger detection, measured on the simulator (DECISIONS 2026-10-09)
- [x] Aankhen: multi-seed bench; sleep, hallway, fan, pair and drift handled
      (Wi-Fi holds, never creates; breathing hold; fan baseline)
- [x] Aankhen: bench / record / calibrate / doctor CLI
- [x] jarvis_app backend: security, events bus, core process, memory, system,
      limbs, connect, mission, aankhen mount
- [x] jarvis.py `--app` mode: JSON events, stdin commands, text-only mode
- [x] UI: design system, shell (dock, title bar, ticker, palette), six tabs
- [x] Desktop shell: pywebview window, launcher, Start-menu + Desktop shortcuts
- [x] JARVIS's brain reads the room (agent.room_context), honestly in simulation
- [x] Firmware v3: CSI enabled, binary protocol, token/MQTT relays, no open AP
      (compiles for ESP32-S3; not yet run on the board)
- [x] Transcripts: every turn kept with timings, flags, review export
- [x] Relays over USB (COMMAND frame); Limbs as the room's single owner; "confirmed" from the board
- [x] Mission Germoney inside the app (stores ported verbatim behind two shims)
- [x] Mission Germoney as a game: Floor/streak, contracts with characters, operations,
      12 bosses, levels + Marks, Trials, War Chest, Drill, Boot Camp
      (docs/design/mission-game.md)
- [x] JARVIS ⇄ the game: deterministic voice commands, live mission state in his prompt,
      the evening nudge, `/api/core/speak`
- [x] JARVIS calls him by his name (prompts, labels, memory re-synced)
- [x] One language: British English, Hindi understood; accents on demand, native Hindi
      voice for Devanagari, Kokoro offline (DECISIONS 2026-10-09)
- [x] Memory: every confirmed fact in the prompt, "remember that ...", taught
      corrections, follow-up-aware retrieval, no false person matches
- [ ] Flash v3, calibrate, record labelled sessions, `python -m aankhen bench` on the real room
- [ ] Wire the relays (light, fan) and confirm a real click from the Limbs tab
- [ ] Mosquitto on the laptop so relays and the room state share one bus
- [ ] Prune JARVIS's remaining hallucinated replies from the memory store
      (the wrong-name ones are gone; ~25 voice_interaction rows left to review)

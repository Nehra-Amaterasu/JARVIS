# JARVIS Architecture & Codebase Map
*Optimized for AI Agents, LLM Context Ingestion, and Developer Reference*

**Last Updated:** 2026-11-03T02:30:00+05:30  
**Current Production Branch:** `main`  
**Core System State:** ESP32-S3 Wi-Fi CSI Sensing (Aankhen 3.7.1) + Multi-Channel Relay Control (Limbs) + Local Voice Assistant (Qwen3-4B + Whisper Turbo + Silero).

---

## 1. System Topology & Data Flow

```
                      ┌──────────────────────────────────────────────┐
                      │              ESP32-S3 DevKitC-1              │
                      │   Firmware: aankhen/firmware (v3.7.1)        │
                      └──────┬────────────────────────────────┬──────┘
                             │                                │
            UDP 47269/47270  │ ~300 CSI frames/sec            │ Active-Low GPIOs
            HMAC-SHA256 Link │ Bi-directional commands        │ (4, 5, 6, 7, 15, 16, 8, 18)
                             ▼                                ▼
              ┌──────────────────────────────┐   ┌──────────────────────────────┐
              │    Aankhen Hub & Engine      │   │     Songle SRD-05VDC Relays  │
              │  (aankhen/hub.py, csi.py)    │   │  (Ceiling Lights, Fan, COB)  │
              └──────────────┬───────────────┘   └──────────────▲───────────────┘
                             │                                  │
                             ▼                                  │
    ┌────────────────────────────────────────────────────────┐  │
    │                 JARVIS Backend Core                    │  │
    │      app/jarvis_app/server.py (FastAPI + Async Bus)    │  │
    │                                                        │  │
    │  • limbs.py        ── Relays owner & safety validator ─┴──┘
    │  • presence_on.py  ── Automated presence switching
    │  • routes_phone.py ── Mobile control API & WebSocket
    │  • core.py         ── Voice pipeline supervisor
    └──────┬──────────────────────────────────────────┬──────┘
           │                                          │
           │ HTTP / WS :8777                          │ HTTP / WS :8778 (LAN)
           ▼                                          ▼
┌──────────────────────────────┐           ┌──────────────────────────────┐
│     Desktop React App        │           │    Mobile PWA Web Interface  │
│  app/ui (Vite + TS + Three)  │           │ app/jarvis_app/phone_page/   │
│  - Limbs Page & WallBox      │           │  - Apple + Nothing Aesthetic │
│  - Aankhen 3D Spatial Twin   │           │  - Live CSI & Presence HUD   │
│  - Connect & Voice Hub       │           │  - Instant Relay Toggles     │
└──────────────────────────────┘           └──────────────────────────────┘
```

---

## 2. Directory Map: What Each File Does & Why It Is Located There

### 2.1 `/aankhen` — Spatial Intelligence & Wi-Fi Sensing
Contains the computer vision / RF sensing framework that measures human presence without cameras.
- `aankhen/firmware/`: ESP32-S3 Arduino C++ firmware.
  - `config.h`: GPIO pin assignments (`RELAY_TABLE`, `CSI_RATE_HZ`, Wi-Fi pins, LCD pins).
  - `secrets.h`: Network credentials, OTA passwords, and HMAC-SHA256 signing keys *(strictly gitignored)*.
  - `firmware.ino`: Main loop running FreeRTOS tasks, Wi-Fi CSI hooks, signed UDP packet framing, and GPIO relay control.
- `aankhen/hub.py`: The Python orchestrator managing connection to the ESP32 (auto-negotiating Wi-Fi UDP vs USB serial).
- `aankhen/csi.py`: Raw 51-subcarrier OFDM channel matrix parsing and amplitude/phase extraction.
- `aankhen/engine.py`: Real-time Doppler and motion energy computation in the human band (0.4–4 Hz).
- `aankhen/belief.py`: Semi-Markov room occupancy probability and spatial zone belief cloud.
- `aankhen/presence.py`: Presence detector determining binary room occupancy with baseline noise subtraction.
- `aankhen/netlink.py`: UDP client implementation validating incoming HMAC-SHA256 signatures from the board.
- `aankhen/tools/smoke_board.py`: Verification utility testing board throughput, CRC errors, and link quality.

### 2.2 `/limbs` — Physical Actuation & Relay Drivers
- `limbs/uno_relay/`: Legacy Arduino Uno relay controller (kept as fallback when `JARVIS_UNO=1`).
  - `uno_relay.ino`: Firmware accepting JSON commands over USB serial to switch relays.
  - `relay.py`: Python transport layer communicating with the Uno.

### 2.3 `/app/jarvis_app` — Backend Server & Services
The unified FastAPI backend orchestrating voice, memory, sensing, and physical control.
- `app/jarvis_app/server.py`: FastAPI application entrypoint, dependency injection, and lifetime management.
- `app/jarvis_app/limbs.py`: **Single source of truth for physical devices.** Owns `room.json`, validates safety against circuit amp ratings, and coordinates with `hub.py`.
- `app/jarvis_app/routes_limbs.py`: REST routes for switching devices (`/api/limbs/{device}`), scenes, and test clicks.
- `app/jarvis_app/routes_phone.py`: Serves the mobile PWA `/phone`, manages QR pairing, cookie auth, and phone WebSocket `/ws/phone`.
- `app/jarvis_app/phone.py`: Session management, cookie issuance, CSRF tokens (`X-Jarvis-Phone`), and listener network binding.
- `app/jarvis_app/esp32_link.py`: Manages the board connection transport policy (`"auto"`, `"wifi"`, `"usb"`).
- `app/jarvis_app/presence_on.py`: Automation engine that restores lights and fan when room occupancy transitions from absent to present.
- `app/jarvis_app/phone_page/`: The static assets served directly to mobile phones.
  - `index.html`: Responsive mobile web app HTML.
  - `app.js`: Zero-dependency JavaScript frontend managing real-time WebSocket state and instant UI rendering.
  - `manifest.webmanifest` & `icon-*.png`: PWA assets allowing the phone to save JARVIS to the home screen.

### 2.4 `/app/ui` — Desktop React Frontend (Vite + TypeScript)
- `src/pages/Limbs.tsx`: Desktop management panel for physical devices, modes, wall box layout, and board diagnostics.
- `src/pages/Aankhen.tsx`: Full-bleed 3D digital twin of the room with live RF wave visualization and zone belief clouds.
- `src/pages/Connect.tsx`: Hardware ports, phone pairing QR codes, models, and voice settings.
- `src/components/WallBox.tsx`: Interactive SVG rendering of the room ceiling coves and lights, reflecting live hardware status.
- `src/components/Esp32LinkCard.tsx`: Real-time packet telemetry, RSSI, ping latency, and interface switcher.
- `src/twin/SpatialTwin.ts`: Three.js / WebGL renderer visualizing the spatial twin and RF reflection scatter.

### 2.5 `/core` — Voice Assistant Engine & Rules
- `core/room_config.py`: Shared definitions of allowed pins (`ESP32_PINS`), default devices, and mode aliases.
- `core/circuits.py`: Electrical safety database preventing overload on 230V circuits.
- `core/room.py`: In-memory room state tracked by the local LLM.

### 2.6 `/data/app` — Persistent Configuration & Ledgers
- `devices.json`: Active device list, mapping human names to board pins (e.g. `light` -> GPIO 4).
- `modes.json`: Scene presets (e.g. `Deep focus` = light on + fan on).
- `esp32_link.json`: Connection preferences (`"prefer": "auto"`).
- `room.json`: Live state snapshot with confirmation receipts.

---

## 3. Hardware Pinout & 8-Channel Relay Expansion Map

The ESP32-S3 DevKitC-1 drives 4 dual-channel relay modules (8 total channels) in active-low mode (`RELAY_ACTIVE_LOW 1`).

| Module | Channel | Device ID | Friendly Name | ESP32-S3 GPIO | Header Pin | Typical Load |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Module 1** | IN1 | `light` | White lights (inner) | **GPIO 4** | J1 Pin 4 | 4x Central Downlights |
| **Module 1** | IN2 | `fan` | Ceiling fan | **GPIO 5** | J1 Pin 5 | Ceiling Fan (regulator sets speed) |
| **Module 2** | IN1 | `light2` | Warm outer | **GPIO 6** | J1 Pin 6 | Warm-White COB Outer Circle |
| **Module 2** | IN2 | `light3` | Warm inner | **GPIO 7** | J1 Pin 7 | Warm-White COB Inner Square |
| **Module 3** | IN1 | `light4` | Pink outer | **GPIO 15** | J1 Pin 8 | Pink COB Outer Square |
| **Module 3** | IN2 | `light5` | Pink inner | **GPIO 16** | J1 Pin 9 | Pink COB Inner Square |
| **Module 4** | IN1 | `light6` | White outer | **GPIO 8** | J1 Pin 12 | Perimeter White Downlights |
| **Module 4** | IN2 | `light7` | Accent LED | **GPIO 18** | J1 Pin 11 | Accent LED Strip / Cove Lights |

> **Power Architecture:** Powered via a spliced USB cable directly from the 5V DC adapter into the breadboard rails, buffered by a $470\mu\text{F} - 1000\mu\text{F}$ capacitor across 5V and GND. Peak current with all 8 coils active + Wi-Fi burst is ~960 mA.

---

## 4. Phone Page Design Philosophy: Apple + Nothing OS

The mobile interface at `http://<laptop-ip>:8778/phone` combines:
1. **Apple Cleanliness & Depth:**
   - Squircle tiles (`border-radius: 20px`) with fluid micro-interactions and tactile feedback.
   - Frosted backdrop glassmorphism (`backdrop-filter: blur(24px)`).
   - Dynamic states: Active tiles illuminate with high-chroma cyan or warm glows with subtle gradient fills.
2. **Nothing OS Raw Technical Precision:**
   - Monospace dot-matrix telemetry header (`JARVIS // LIVE_LINK`).
   - Live RF CSI frame ticker showing active subcarrier disturbance.
   - Monochromatic high-contrast background (`#050506`) preserving OLED power and clarity.
   - Minimalist, purpose-driven typography and real-time board confirmation receipts.

---

## 5. Architectural Rules for Agents & Developers

1. **Relay Authority:** Never switch relays directly from ad-hoc scripts during app runtime. Always issue commands through `Limbs.apply()` or the REST endpoint `POST /api/limbs/{device}`, so the state ledger, safety checks, and voice context stay in sync.
2. **Active-Low Integrity:** Relays switch ON when GPIO is LOW. Ensure `RELAY_ACTIVE_LOW 1` is preserved in firmware.
3. **Documentation Update Protocol:** Whenever a new file is added or an architectural contract is modified, update this document (`docs/README.md`) and log the change in the Changelog below.

---

## 6. Changelog & System Activity Log

| Timestamp (ISO 8601) | Subsystem | Author | Description of Change |
| :--- | :--- | :--- | :--- |
| **2026-11-06T00:55:00+05:30** | Firmware / Power / Wi-Fi | Antigravity AI | Resolved multi-relay brownouts & 5-minute disconnects. Implemented 120 ms sequential coil staggering in firmware (pumpRelays), Wi-Fi RF power optimization (15 dBm saving ~200 mA peak), persistent RTC relay state memory across resets, and eliminated the zero-delay background Wi-Fi scan loop. Compiled & flashed over-the-air (OTA) to the board's LAN address. Verified simultaneous switching with zero brownouts. |
| **2026-11-03T16:15:00+05:30** | Limbs / Firmware / UI / Net | Antigravity AI | Flashed ESP32-S3 over COM9 with 8-relay support (GPIO 4, 5, 6, 7, 15, 16, 8, 18). Implemented instant boot fingerprinting for LINK_KEY resolving key mismatch errors. Built Apple+Nothing OS dual-routing standalone mobile web app (Auto Hub vs Direct ESP32). Compacted ceiling visualizer to 240px and integrated PhoneCard into Limbs. 1,280 backend tests + 362 frontend tests passing. |
| **2026-11-03T14:30:00+05:30** | Aankhen / Firmware / Net | Antigravity AI | Firmware 3.7.2 flashed to ESP32-S3 over COM9. Verified wireless link over the room router bridged to LAN (the board's LAN address): 305.2 CSI/s, 0.0% loss, 0 CRC errors, 11 ms gap, HMAC-SHA256 verified. Standalone web control page deployed directly on ESP32 at `GET /` and `POST /relay` (zero laptop needed). Removed invasive ARP subprocesses to prevent command prompt window spam. |
| **2026-11-03T14:10:00+05:30** | Aankhen / Firmware / Net | Antigravity AI | Targeted the dedicated room router as primary Wi-Fi link (WIFI_PREFER_SECOND 0). Recompiled firmware 3.7.2. Added live ARP MAC discovery to esp32_link.py. Configured IP target the board's LAN address in esp32_link.json. Verified full test suite. |
| **2026-11-03T04:10:00+05:30** | Core / UI / Firmware | Antigravity AI | Flashed ESP32-S3 firmware 3.7.1 over COM9. Completed comprehensive subagent audit: enabled GPIO 18 in room_config & board_ctl, fixed 8-channel circuit aliases in circuits.py, optimized Limbs.tsx event subscriptions, fixed System.tsx log scroll hijacking, and verified all 362 frontend + 58 backend tests passing. |
| **2026-11-03T02:38:00+05:30** | Phone / UI / Limbs | Antigravity AI | Redesigned Phone PWA with Apple + Nothing OS aesthetic, live CSI radar HUD, SVG ceiling visualizer, and dynamic 8-channel relay switching. |
| **2026-11-03T02:30:00+05:30** | Docs / Arch | Antigravity AI | Created unified architectural map and directory reference for multi-agent context. |
| **2026-11-02T22:30:00+05:30** | Hardware / Power | Owner & Antigravity | Bypassed Arduino polyfuse; deployed direct USB rail feed + capacitor reservoir. |
| **2026-11-01T14:00:00+05:30** | Aankhen / Limbs | Antigravity AI | Verified 4-channel relay bench test over Wi-Fi AP; updated config.h for GPIO 4–7. |
| **2026-10-28T09:00:00+05:30** | Aankhen / Firmware | Antigravity AI | Firmware 3.7.0 deployed with HMAC-SHA256 signed UDP link. |

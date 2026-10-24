# Public docs refresh: what was stale, what changed (2026-10-25)

## Question

The root `README.md`, `app/README.md` and the public GitHub profile README describe JARVIS
as it was around 2026-10-09 to 10-12. Which of their claims are no longer true, and what
should an honest public overview say today: what works (measured), what is experimental,
what is not done?

## Method

- Read `git log --since=2026-10-09` on `main` at `53f5cdb` (124 commits), the research
  index and the notes from 10-13 to 10-23, `docs/DECISIONS.md`, `docs/ROADMAP.md`, and
  the code where a doc claim needed checking (`app/ui/src/lib/store.ts` for tabs,
  `app/ui/src/germoney/MissionRoot.tsx` for the Mission screens, `core/mission.py` for
  voice intents, `aankhen/firmware/firmware.ino` for `FW_VERSION`,
  `limbs/uno_relay/uno_relay.ino` for its version).
- Read the live profile README at
  https://raw.githubusercontent.com/Nehra-Amaterasu/Nehra-Amaterasu/main/README.md
  (read only).
- Facts given by the owner's session and not in a tracked file: firmware 3.5.0 was
  flashed on 2026-10-23, and the Wi-Fi link has not been verified at home. The docs say
  exactly that and nothing more.
- No code, test, model or board was touched. Numbers below are copied from the notes
  that measured them; none were re-measured here.

## What was stale

| Doc | Claim | Reality | Source |
|---|---|---|---|
| README | "none of it has run on the real board yet" (Aankhen) | first light on the real board 2026-10-12; calibrated, learned a room, live in the app | commits `3de3922`, `319cf8e`, `bddbf83` |
| README | "Physical relay control: mains wiring in progress" | the Uno relay board switches the real light and fan since 10-14, confirmed by the board's JSON reply | `2026-10-14-uno-relay-integration.md`, `2e0aff5` |
| README | Aankhen "can fuse an LD2450 radar" | no radar was bought; the owner decided against one on 10-13; only a decoder exists | `aankhen/firmware/README.md` ("none is planned") |
| README | architecture: ESP32 relays, room control "via MCP", ESP32 on USB only | relays on the Uno (USB); ESP32 3.5.0 also speaks a signed UDP link; `room.py`'s MQTT writer was removed 10-15 | `2026-10-15-limbs-modes-and-presence-on.md`, `2026-10-16-wireless-esp32-hub.md` |
| README | brain "50 tok/s", first token 0.6 s, LLM ~3.3 GB | now resident at num_ctx 8192: 0.85-0.93 s warm, 10.2 s cold, 3070 MiB; with Whisper 4.35-4.47 GB of 6 | `2026-10-15-jarvis-always-on.md` |
| README | "Time to first audio 2.1-10.8 s" (10-10 log) | newer: median 4.12 s, p90 8.09 s over 49 spoken replies | `2026-10-13-connect-and-system.md` |
| README | 77 % occupancy "on realistic days" as the learned model's result | that number is simulation only; real-board numbers are first light and the 10-15 replay (wrong answers shown 61.4 % to 50.0 %, waving 68.6 % to 0 %) | `DECISIONS.md` 10-12, `2026-10-15-aankhen-zones-drill.md` |
| README | no mention of always-on, phone access, chat learning, crew, zones, drill, Mission v2 | all built between 10-13 and 10-23 | the notes of those days |
| README | say "hey jarvis" | the name alone wakes him since 10-13 | `5c91074` |
| README | test commands | `crew/tests` and `core/tests` missing; app tests need a scratch `JARVIS_DATA_DIR`; `npx tsc -b` | `CLAUDE.md` |
| app/README | Mission as 6 tabs plus 7 tools (HQ, Contracts, Campaign, twelve bosses, Armory...) | 5 screens since 10-23: Today, Tree, Focus, Log, Road; bosses retired | `2026-10-23-mission-germoney-rebuild.md` |
| app/README | Limbs "driving the ESP32 relays over USB" | the Uno over USB; the ESP32 over USB or Wi-Fi when configured, not yet verified at home | as above |
| app/README | `Ctrl 0` opens HQ | opens Mission (Today) | `components/Shell.tsx` |
| app/README | voice table: bosses, Marks only | v2 intents: explain this contract, what's next on the tree, exam mode, internship deadlines, quiet mode | `core/mission.py` docstring |
| app/README | an example that stored a roll number | replaced with a generic example (no personal identifiers in public docs) | privacy rule |
| app/README | no watchdog, startup script, restart backoff, Uno reset at start, Wi-Fi link card | added | `2026-10-15-jarvis-always-on.md`, `2026-10-16-wireless-esp32-hub.md` |
| Profile | "time to first spoken word cut from 22-97 s to 0.6 s" | 0.6 s was the text first token; the spoken first word is ~4 s median | `2026-10-13-connect-and-system.md` |
| Profile | "LD2450 mmWave radar decoder", "HLK-LD2450 mmWave radar" under hardware | never bought, not planned | owner decision 10-13 |
| Profile | "Taking presence sensing from simulation to real hardware" | it runs on real hardware; the open work is multi-day labelled data | as above |

## What changed

- **`README.md` rewritten** around three lists: *What works today* (12 rows, each with a
  measured number and its date or source), *Experimental* (ESP32 3.5.0 Wi-Fi link,
  zones + belief + dot cloud, drill runner + teachers + leave-one-day-out evaluator,
  proactive remarks, presence-on, Mission v2, away mode), and *Not done* (multi-day
  Aankhen data, the Wi-Fi relay path at home, a real overnight run, voice latency,
  archive recall at 3/10, belief distillation and a memory review screen, fine-tuning,
  no camera and no radar). Also: a Mermaid architecture diagram, hardware, **mains
  safety notes**, privacy (personal data only in `data/`; edge-TTS receives reply text;
  phone listener off by default), updated run and test commands, layout with `crew/`
  and `limbs/`, four new engineering notes (fan aliasing, the busy "empty" room,
  the 15.6 ms Windows clock, the Uno reset on port open).
- **`app/README.md` updated**: current tabs, Mission's five screens, the v2 voice
  intents, always-on (watchdog, startup script, restart budgets), the Uno reset at app
  start and presence-on, the experimental ESP32 Wi-Fi link card, develop and test
  commands with scratch data, an updated "how it fits together" tree.
- **`docs/profile-README.draft.md` drafted** (not published): same voice as the live
  profile, LD2450 removed, the 0.6 s claim corrected, sensing and relays described as
  they are, "currently" items true for today.

## Left for later (not changed here)

- The Aankhen tab's subtitle in `app/ui/src/lib/store.ts` still says "sensed through
  Wi-Fi and radar". It is UI text, out of scope for a docs change.
- `docs/ROADMAP.md`'s "Where things really stand (2026-10-12)" table predates the board,
  the Uno and everything after; it needs its own pass against the ticked items.
- `CLAUDE.md` (untracked in this worktree) lists "radar (LD2450, 60 GHz)" among the
  allowed signals; that permission is fine, but it is not part of the running system.

## Sources

- Notes: `2026-10-13-connect-and-system.md`, `2026-10-14-uno-relay-integration.md`,
  `2026-10-14-yaadash-feedback-loop.md`, `2026-10-14-phone-access.md`,
  `2026-10-14-aankhen-data-protocol.md`, `2026-10-15-jarvis-always-on.md`,
  `2026-10-15-limbs-modes-and-presence-on.md`, `2026-10-15-aankhen-zones-drill.md`,
  `2026-10-15-aankhen-dot-cloud.md`, `2026-10-16-wireless-esp32-hub.md`,
  `2026-10-23-mission-germoney-rebuild.md`; `docs/DECISIONS.md` (10-09 memory audit
  193/198; 10-12 simulation numbers).
- Commits: `3de3922`, `319cf8e`, `bddbf83`, `2e0aff5`, `5c91074`, `1497ba7`, `74bfa6b`,
  `53f5cdb`.
- Live profile README: https://github.com/Nehra-Amaterasu/Nehra-Amaterasu

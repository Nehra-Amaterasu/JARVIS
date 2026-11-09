# docs/design/

Design explorations for individual subsystems, written before or during their
implementation. They capture intent and trade-offs at the time.

Where a spec and the code disagree, **the code and [`../DECISIONS.md`](../DECISIONS.md)
are authoritative** — several designs changed once measured on real hardware.

| Document | Subsystem |
|---|---|
| `aankhen-physics.md` | what one Wi-Fi link can and cannot sense |
| `aankhen-learning.md` | Aankhen's learning plan: smaller movements, the whole house |
| `jarvis-app.md` | the desktop application |
| `tools-and-honesty.md` | tools, receipts and the honesty guard |
| `mission-game.md` | Mission Germoney (now Well Wisher) |
| `well-wisher-ui.md` | Well Wisher UI plan: where every part lives and how it looks (pages, wireframes, tokens, tests, build order) |
| `app-ui-overhaul.md` | the app-wide UI overhaul: a brand per section on one shared foundation, loose ends, the phone shell, and the seam with Well Wisher |

The v1 deep dives (FastMCP hardware bridge, Qdrant/GraphRAG memory server, RuView simulator,
the first desktop-app spec) were deleted on 2026-11-01 with the code they described; they
are in git history before that date. The relay wiring of today is `../aankhen-esp32-relays.md`.

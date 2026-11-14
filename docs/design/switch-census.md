# Switch census: every toggle and on/off control in `app/ui/src`

Decision D-V3-32 (docs/design/jarvis-product-overhaul.md): one switch family. Every toggle in either product is the kit
`Switch` or the kit `Rocker`; this file lists each other implementation and the package that replaces it. The census
file has no open row at B13. Written 14 Nov 2026 (package PL1, documents only). Method: Grep of `app/ui/src` for
`role="switch"`, `type="checkbox"`, `aria-pressed`, `aria-checked`, `role="checkbox"` and the words toggle and
switch in class names; test files and `gallery/entries` excluded.

## The finding in one paragraph

The kit has `Switch`, `Rocker` and `Key` (`shared/kit/Hardware.tsx`, lines 53, 107, 167). Outside the gallery, **no
product screen mounts the kit `Switch`**; the only product use of a kit toggle is `Rocker` inside
`shared/data/specimen/RackRow.tsx` (line 49), which no merged view mounts yet. Every real on/off control in the
running app is drawn by legacy CSS: the `.switch` rail in `styles/base.css` (line 161), a bare native checkbox, or
a `.check` row. Those are the controls the owner calls gimmicky next to the refined ones. Replacing them is the
work listed below.

## How a control is drawn (the "Drawn by" column)

| Code | Meaning |
|---|---|
| KIT | kit `Switch`, `Rocker` or `Key` (`shared/kit/Hardware.tsx`); the target |
| KIT-OPT | kit `Segmented`, `Chip` (selected), `Button` pressed state (`shared/kit/*`): a choice among options or a filter, not an on/off switch; fine as is, listed so nothing is missed |
| LEGACY `.switch` | the `<button className="switch on">` pill with `aria-pressed` (`styles/base.css` 161 to 175) |
| LEGACY `.check` | `<label className="check"><input type="checkbox">` in the Mission pages |
| LEGACY other | a one-off class with its own CSS (`.tap-yes`, `.check-row`, `.chip on-soft`, `.btn ... on`) |
| NATIVE | a bare `<input type="checkbox">` with no kit styling |

## A. True on/off switches still drawn by legacy CSS (these are the "gimmicky" ones)

All must become the kit `Switch` (or `Rocker` where the control is a physical channel). "Replace in" is the package
that owns the screen, per spec 15.6.2.

| # | File and line | Control and label | Product, screen (shell v2 view) | Drawn by | Route it calls | Replace in |
|---|---|---|---|---|---|---|
| 1 | `pages/Limbs.tsx` 107 | channel power, label "{name} power" | JARVIS, Room (`room.switches`) | LEGACY `.switch` | `/api/limbs/{id}` | J02 (UW9); kit `Rocker`, because it is a relay channel (RackRow already uses `Rocker`) |
| 2 | `pages/Limbs.tsx` 240 | "Presence rule" | JARVIS, Room (`room.rules`) | LEGACY `.switch` | `/api/limbs/presence-on/settings` | J02 (UW9); kit `Switch` |
| 3 | `components/AwayModeCard.tsx` 99 | "Auto-arm" | JARVIS, Room (`room.rules`) | LEGACY `.switch` | `/api/security/config` | J02 (UW9); kit `Switch` |
| 4 | `components/EnergyCard.tsx` 178 | "Auto-off" | JARVIS, Room (`room.rules`) | LEGACY `.switch` | `/api/energy/auto-off` | J02 (UW9); kit `Switch` |
| 5 | `components/RemarksCard.tsx` 35 | "Unprompted remarks" | JARVIS, Console (`console.connections`) | LEGACY `.switch` | `/api/settings/proactive` | J05 (UW10); kit `Switch` |
| 6 | `components/FirmwareCard.tsx` 172 | firmware feature flags (one per `f.label`) | JARVIS, Console (`console.hardware`) | LEGACY `.switch` | `/api/board/config` | J05 (UW10); kit `Switch` |
| 7 | `components/WallBox.tsx` 116 | channel name button, `aria-pressed={r.on}` (toggles the channel) | JARVIS, Room (`room.switches`) | LEGACY other (`.wallbox-name` in `styles/board.css` 132) | `/api/limbs/{id}` | J02 (UW9); kit `Rocker` or `Key` (a lit key per channel, spec 4.3.2) |
| 8 | `components/WallBox.tsx` 103 | last-mode buttons, `aria-pressed` | JARVIS, Room (`room.switches`) | LEGACY other (`btn sm primary`) | `/api/limbs/scene/{mode}` | J02 (UW9); kit `Segmented` (one of N, not on/off) |
| 9 | `components/ConnectControls.tsx` 254 ("Turn off", `ModuleCard` 228 to 295) and 263 (minute picker, `seg sm`, one of N: KIT-OPT `Segmented`) | module on and off with a timer (deep think, offline voice); the on is a timed pick, the off a button | JARVIS, Console (`console.health`) | LEGACY other (`seg sm`, `btn sm`) | `/api/settings/modules/{id}` | J05 (UW10); kit `Switch` with the timed-state caption (spec 20.6 "timed switches") |
| 10 | `components/RelayWiring.tsx` 86 | wiring step done, `className="check"` | JARVIS, Console (`console.hardware`) | LEGACY `.check` | local state | J05 (UW10); kit `Switch` or a checklist row with a kit check |

## B. Checkbox and "teach" style controls in JARVIS

| # | File and line | Control and label | Product, screen | Drawn by | Replace in |
|---|---|---|---|---|---|
| 11 | `pages/Core.tsx` 270 | "Teach him" (keep the right answer as a correction) | JARVIS, Core classic page | NATIVE in `.teach-toggle` | retired with the classic Core page (B13) |
| 12 | `jarvis/core/Transcript.tsx` 124 | "Teach" in the turn dock (`jc-dock-teach`) | JARVIS, Core (`core.talk`), shell v2 | NATIVE (`type="checkbox"`) | J01 follow-up (RC1 reopened); kit `Switch`. This is a new-shell control that is still not in the kit family. |
| 13 | `jarvis/core/CoreTalk.tsx` 141 | voice or text mode, `role="radio"` | JARVIS, Core (`core.talk`) | own `.jc-*` markup | optional: kit `Segmented`; one-of-two, so a radio pair is correct. Judge only the look. |
| 14 | `jarvis/voice/VoiceHill.tsx` 476 | Pause key, `aria-pressed={paused}` | JARVIS, Core (`core.talk`) | own `.vh-pause` | J01 follow-up; kit `Key` (it is a latching key with a lamp) |
| 15 | `components/MemoryGalaxy.tsx` 221, 265 and `GrowthChart.tsx` 102 | link toggle, series show or hide | JARVIS, Memory (old galaxy, chart) | LEGACY other (`chip press on-soft`) | none: retired by B13 |
| 16 | `components/LibraryPanel.tsx` 267 | section open or close, `aria-pressed` | JARVIS, Core (`core.sound`) | plain button | KIT-OPT; the list in `core.sound` (package to be named, see parity-ledger.md C07) |
| 17 | `components/TeachTrainPanel.tsx` 107 | zone tile selected, `aria-pressed` | JARVIS, Senses (`senses.teach`) | `ts-tile on` | J03 (UW11); kit `Chip` selected |
| 18 | `components/ConnectControls.tsx` 80 and `MediaCard.tsx` 113 | brain model radio, media source radio | JARVIS, Console and Core | `role="radio"` custom | KIT-OPT in J05 and the `core.sound` package: kit `Segmented` |

## C. Well Wisher, classic Mission pages (`germoney/**`)

These pages are retired by B13 once their view packages land, so the cheapest fix is to build the new views with the
kit `Switch` and delete the old file. Listed so each is accounted for.

| # | File and line | Control and label | Drawn by | Replace in |
|---|---|---|---|---|
| 19 | `germoney/pages/Armory.tsx` 192 to 194 | "voice nudges", "game sound", "focus scene" | LEGACY `.check` + NATIVE | Y02 and the `settings.appearance` sheet (L02, merged); kit `Switch` |
| 20 | `germoney/pages/Crucible.tsx` 234 | "use boost" | LEGACY `.check` | Y02 (UW7); kit `Switch` |
| 21 | `germoney/pages/Log.tsx` 152 and `ww/overlays/LogMinutes.tsx` 67 | "commit" (write the minutes to the log) | LEGACY `.check`, NATIVE | overlay `log` owner (Y02); kit `Switch` |
| 22 | `germoney/pages/Settings.tsx` 159 and `ww/setup/sectionsPlan.tsx` 105 | "novelty first" | LEGACY `.check`, NATIVE | L02 `settings.<section>`; kit `Switch` |
| 23 | `germoney/pages/SystemInputs.tsx` 85, 95; `ww/setup/sectionsInputs.tsx` 178; `ww/overlays/DateSheet.tsx` 76, 80 | "tentative date", "may miss", "confirmed", "approx" | LEGACY `.check`, NATIVE | L02 (setup sheet) and L01 (date sheet); kit `Switch` |
| 24 | `germoney/pages/Road.tsx` 346 | task done checkbox in each row | LEGACY `.check small task-row` | a career package (unassigned, see parity-ledger.md); kit check row |
| 25 | `germoney/pages/Today.tsx` 483 | habit done today | NATIVE | L04 (wave 7); kit `Switch` or `Key` |
| 26 | `germoney/pages/Life.tsx` 105 | attendance and counter yes, `.tap-yes` (`germoney/pages/sections.css` 98) | LEGACY other | L03 (UW9); kit `Key` |
| 27 | `germoney/ui.tsx` 198 | `CheckRow`, `role="checkbox"` (shared by Mission pages) | LEGACY other (`.check-row`) | delete with B13 after callers move; kit check |
| 28 | `germoney/pages/Classes.tsx` 72, `Tree.tsx` 504, `Study.tsx` 111, `Life.tsx` 128 | status choice, career chip, result choice, kind choice | `btn sm on`, `chip on`, `role="radio"` | KIT-OPT: kit `Segmented` or `Chip` in L03, tree, Y03 |
| 29 | `germoney/Reader.tsx` 188 and `ww/overlays/Reader.tsx` 111, 185 | "Raw" text toggle | `btn ghost` / kit `Button` with `aria-pressed` | KIT-OPT now; `Button` pressed is acceptable, move to kit `Chip` toggle for look |

## D. Controls already on the kit (nothing to do)

| File and line | Control | Note |
|---|---|---|
| `shared/kit/Hardware.tsx` 53, 107, 167 | `Switch` (`role="switch"`), `Rocker`, `Key` | the target family |
| `shared/data/specimen/RackRow.tsx` 49 | `Rocker` | only product-side kit toggle; not yet mounted by a merged view |
| `shared/kit/Segmented.tsx` 63, `shared/kit/Chip.tsx` 72, `shared/kit/Layout.tsx` 106, `shared/kit/Frames.tsx` 169 (follow key) | choice, filter, follow toggle | KIT-OPT |
| `shell/ShellV2.tsx` 299 | product switch, `role="radio"` | shell chrome (R01 craft pass) |
| `shared/data/tables/LedgerTable.tsx` 286 | row-select checkbox | NATIVE inside a kit table; judge it in QG1 |
| `shared/data/series/DotHistogram.tsx` 96, `shared/art/WeekStrip.tsx` 45, `ww/life/CounterTiles.tsx` 28, `ww/left/L3.tsx` 39, `ww/study/Papers.tsx` 52, `ww/study/Dmat.tsx` 56 | form key, day pick, counter tap, class status, paper row, dMAT option | selection or tap, KIT-OPT; `CounterTiles` (a yes or no tap) should become kit `Key` in L03 |

## E. Counts (and the verification pass)

Verification (14 Nov, read-only): 22 census rows opened at their line numbers; 21 were right. Row 9 pointed at the minute picker instead of the on and off buttons (corrected above). The "kit Switch in product screens: 0" and "Rocker: 1" findings were re-checked by Grep and hold.


- True on/off rows in JARVIS (1 to 7, 9 to 12, 14): 12 rows. In Well Wisher (19 to 27): 9 rows.
- Drawn by legacy `.switch` CSS: 6 call sites (rows 1 to 6). Native checkboxes and `.check` label rows are the rest of the true switches; counts are by Grep line, not by screen, and a few lines share a row.
- Kit `Switch` in a mounted product screen: 0. Kit `Rocker`: 1 (not yet mounted).
- Choice controls (one of N) that should read as the kit `Segmented` or `Chip`: rows 8, 13, 16 to 18, 28, 29.

## F. Order of replacement

1. QG1 (this wave) and KB1 do not own the product screens; they cannot do rows 1 to 29. The one control in the new shell that QG1 may touch is row 12 only if J01's owner reopens `jarvis/core/Transcript.tsx`; QG1's own paths (`shell/**`, `gallery/**`, `shared/kit/**`) hold no true switch.
2. Wave 7: L04 (row 25), Y02 (rows 19 to 21), L02 setup sheet (rows 22, 23).
3. UW9: J02 (rows 1 to 4, 7, 8), L03 (rows 26, 28).
4. UW10: J05 (rows 5, 6, 9, 10), J04 (the memory export switches, if any).
5. UW11: J03 (row 17).
6. B13 deletes `.switch` from `styles/base.css` and the `.check` family; the census closes when `grep -rn 'className={`switch' app/ui/src` and `type="checkbox"` return only `LedgerTable` row select and the kit.

A kept test for the closing rule (suggested, not written here): a vitest that reads `app/ui/src/**/*.tsx` and fails on
`role="switch"`, `className="switch` or a checkbox outside `shared/kit` and the table select, so no new gimmicky
control can be added after B13.

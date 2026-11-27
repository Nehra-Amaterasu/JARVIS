## 2026-11-27: what the one look left unreachable, and Setup brought into it

**Question.** Since 25 Nov v3 is the only look the owner can reach. The older frames kept pages, panes, drawers and actions that
v3 may not draw. Which are unreachable, and can the Setup page (sixteen settings panes, now eighteen with Dates and the
harvester) be brought in cheaply?

**Method.** Read `shell/ids.ts`, `shell/hosts.ts`, `shell/views/*.view.ts`, `shell/v3/*`, `ww/frame/workspaces.ts`,
`germoney/MissionRoot.tsx`, `lib/store.ts` TABS, and `docs/design/parity-ledger.md` (written 14 Nov, so many of its rows are stale).
The v3 shell mounts the same `Canvas` as the v2 shell, so every id of the table and every legacy host still opens; the question
is only about what the older frames drew OUTSIDE that table. Reachability below is from the code; only Setup was pressed in a
browser (see "Not verified").

### The audit

| Older-frame place | Where it lived | Under v3 |
|---|---|---|
| Tabs Study, Tree, Life, Career, Focus | ww frame strip | reachable: spine rows Study, Tree, Day (Life), Career, Focus, with their views (`study.*`, `tree.tree`, `day.*`, `career.*`, `focus.*`) |
| **Tab Setup (Alt+6) and its 18 panes** | ww frame strip | **was NOT reachable** (no spine row, Alt+6 swallowed by `ShellV2.tsx`); **now reachable**, see below |
| Legacy JARVIS tabs Core, Yaadash, Aankhen, Limbs, Connect, System | classic Shell tabs | reachable: `core.*`, `memory.*`, `senses.*`, `room.*`, `console.*` (the legacy hosts of `hosts.ts` still mount) |
| Tabs Trials, Armory (now "part of Road") | legacy `TABS` | reachable as `career.abroad`, `career.money` |
| Tab Drill | legacy `TABS` | reachable as `focus.drill` (and `study.practice`, which says it shares it) |
| Tab Forge (now part of Log) | legacy `TABS` | reachable through the Life page (`day.body` shares it), anchor `gym` |
| Tab Interrogation (now part of Log) | legacy `TABS` | reachable through `study.library` (anchor `explain-back`) |
| Settings button (SettingsDrawer: exams, profile, calibration) | ww frame tool row | its content is now Setup (Dates, About you, Calibration); the drawer itself is not drawn under v3 |
| Roadmap button | ww frame tool row | reachable: the Agents row and every planned or "not built" plate open the roadmap overlay |
| Old layout button | ww frame tool row | gone by decision (one look) |
| Season switch (Auto, Exams, Normal) | ww frame tool row | **not reachable on the registered views** (Today, Tree, Career); drawn only where the frame still hosts the page (`day.week`, `day.body`, `focus.*`, `study.*`). Not found in Setup |
| Left column "Today" (always mounted) with Log minutes, the rail | ww frame | **only where the frame hosts the page**; the registered views do not draw it |
| Log (tab M10, overlay O6 "Log minutes") | opened from the left column | **same as the left column**: reachable only where the frame hosts the page. Likely the next one the owner misses |
| Status / Proof panel (tab M14, `proofOpen`) | the frame's Proof rail | **same**: only where the frame hosts the page |
| Overlays O1 Date sheet, O2 Phone, O7 Confirm | Setup panes, left column | now drawn under Setup by its own OverlayHost; elsewhere only where the frame is mounted |
| Reader (O3), Record (O4), Add questions (O8) | library, proof, subjects | reachable from their pages; Add questions from Setup > Subjects (now) |
| Question harvester and its three panes (Sources, Queue, Past papers) | Setup pane 18 | **was NOT reachable**; now reachable as the last pane of Setup |
| Backup, Restore | Setup pane | **was NOT reachable**; now reachable (Backup downloads the engine's export) |
| Connections (Setup pane) | Setup | **was NOT reachable**; now reachable |

Counts: 6 workspaces of the older frame, 5 reachable, 1 (Setup, holding 18 panes and 3 overlays) not. Of the places OUTSIDE the
table: 8 not reachable under v3 before this work (Setup and its 18 panes counted once, the left column, Log minutes, Status or
Proof, the Season switch, the Settings drawer, Backup, the harvester), 4 now reachable (Setup, Backup, Connections, harvester),
4 still partly unreachable (left column, Log minutes, Status or Proof, Season switch).

### Still unreachable, most needed first

1. **Log minutes** (overlay O6 and the left column that opens it). It is the daily action of a study day; under v3 it exists only on
   pages the frame still hosts. Cheapest fix: a row in More ("Log minutes") that calls `openOverlay('log')`, plus mounting the
   same `OverlayHost` the Setup host already uses (`setupOverlays` registers `log`). One view, not built here.
2. **Status / Proof panel** (stats from logged work, rank). Needs `useFrame.setProof(true)` and a host for `ProofRail`; same shape as 1.
3. **The Season switch** (Auto, Exams, Normal). It changes what Today puts first in exam weeks; no key reaches it on Today, Tree or
   Career. A pill in More would do.
4. **The left column "Today"** as a whole. Its content is mostly on Day > Today already; the loss is the quick keys.
5. **The Settings drawer** as such: its sections are in Setup, so nothing is lost except the habit.

### What was built

- **A way in, found without being told.** A row "Setup" (sliders icon, `shell/v3/Glyphs.tsx`) at the foot of the Well Wisher group
  in the spine, hint Alt+6, hash `#setup` (and `#setup/<pane>`, for example `#setup/harvester`). Also a "Setup  Alt 6" row at the head
  of More, because the phone's tab bar has no room for a sixth key (the spine sheet, "Projects", holds the row too). **Alt+6 works
  again**: `useV3Keys` claims it before the keymap swallows it.
- **How it is registered, and why not in the id table.** Setup is the shell's own place `app.setup` (`shell/ids.ts`: `APP_PLACES.setup`,
  `setupPlace()`, `isSetupPlace()`), like "What is new", not an eleventh section. The ten-section, 36-view table, Ctrl+1..5 and Alt+Up/Down
  (which never stop on Setup) are unchanged, and the place is never written to the resume record or the saved place, so a restart opens
  on work, not on settings. The spine reads `subProjectOfPlace`, so Well Wisher stays the open project on its light ground.
- **The page.** `ww/setup/SetupV3.tsx` hosts the existing panes in three trays: 1 SECTIONS (the 18 panes as two columns of nine 44 px
  keys, with a dot on a pane with unsaved changes), 2 PANE (the Save bar, the server's answer to the last save, then the pane), 3 UNSAVED
  (each pane with a draft as a key that goes to it, and the two rules of saving). On the phone the list is the page and a pick opens the
  pane as the second tray's sheet; the Save bar and the engine's answer ride at the top of that sheet. `SetupPage.tsx` was split into
  `useSetupLifecycle`, `SetupIndex`, `SetupSaveBar`, `SetupNotes` and `SetupPanes` and the older frame's `SetupPage` composes the same
  pieces, so the two cannot save differently. The page mounts its own `OverlayHost` (Date sheet, Phone, Confirm), because the frame that
  normally draws them is not mounted under v3.
- **Why tray 2 holds the Save bar, not tray 3.** The brief suggested tray 3. On the phone trays 2 and 3 are sheets; a Save key in a sheet
  that is closed while a pane is edited is not "reachable". So the bar sits at the top of the pane, sticky, opaque (a first version printed
  the pane's text through it), and tray 3 carries the list of unsaved panes.
- **Rules kept.** Nothing saves or resets by itself: the lifecycle hook only reads (`refresh`) and mirrors; the draft store is module-level,
  so a pane left unsaved keeps its draft across panes and across places (Day and back). The e2e records every non-GET request after Setup is
  open and walks all 18 panes: none from Setup.
- **CSS** (`ww/setup/setup-v3.css`, all under `:root[data-look='v3'] .su3`): flat cards in the tray (no box-in-box border), controls and links
  at 44 px (the harvester's licence links were 17 px tall), no hairline on the bar, no stripe on the current key (the css-lint forbids it).

### Measured

- `npx tsc -b`: exit 0. `vitest` over `src/ww/setup src/__tests__/{shell,ww,shared}`: 46 files, 1,348 tests, all pass (exit 0). Privacy scan
  `pytest tests`: 25 passed.
- Playwright, `--workers=1`, sandbox only: `e2e/setup-v3.spec.ts` 6 of 6 (3 tests at 1366x768 and 390x844: the way in by click, by keyboard
  and by Alt+6; all 18 panes with no page error, no sideways scroll, no document scroll, no key or link under 44 px, no text under 11 px, and
  no request but a GET after Setup is open apart from the game store's own mirror; Study time and About you changed and saved with the
  engine's "Saved: ..." on screen; an unsaved pane keeps its dot, its entry in the bar and its draft across panes; the harvester's three
  panes; Date sheet, Phone, Backup (a real download) and Discard all (Confirm)). `shell-v3.spec.ts` 29 passed, 1 skipped (the spine test
  now expects six rows in the open Well Wisher group); `one-look.spec.ts` and `paper-sources.spec.ts` 9 of 9.
- Found and fixed on the way: (1) the first build let a pick on the desktop open the pane tray as a modal sheet (role dialog, Tab trap);
  now only below 700 px. (2) The harvester's three source links were 17 px tall. (3) The Save bar was see-through and, on the phone, the
  engine's answer scrolled away behind it. (4) The scratch data dir keeps what a run saved, so a second run typing the same value saw
  "nothing to save": the spec now types a new value each run.
- Pictures: `$TEMP/ui-setup-shots` (every pane at 1366x768, four at 390x844, the saved states, the harvester's three panes).

### Not verified

- The audit's reachability of Log minutes, Status or Proof, the Season switch and the left column is read from code (`openOverlay('log')`
  sits only in `ww/left/*`; the registered views do not mount the frame). Only Setup was pressed in a browser.
- Restore (file picker) and the harvester's fetch with real publishers were not pressed: the sandbox reads no publisher, and the picker needs a
  file. The harvester's panes were opened and switched; their own spec (`paper-sources.spec.ts`) covers their behaviour in the older frame.
- Alt+6 inside a text field was not tried.
- The Dates pane's card still draws a thin border (its own component, not the kit card); left as it was.

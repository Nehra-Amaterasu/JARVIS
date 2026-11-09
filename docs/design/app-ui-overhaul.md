# App UI overhaul: one foundation, a brand per section, no loose ends

Written 2026-11-09. Supersedes the WP4 (discrepancies) and WP5 (section brands) packages of the
wall-box plan: they are one job, because a section cannot be rebranded while it still carries dead
cards, Uno text and routes nobody calls. Well Wisher keeps its own plan (`well-wisher-ui.md`); this
file covers everything else and the seam between the two.

## 1. The owner's decisions this rests on

| # | Decision | Date |
|---|---|---|
| 1 | No unified theme. Each section looks like a different brand or website, and the look is justified by what the section does | 2026-11-06 |
| 2 | Core keeps today's look. Aankhen is futuristic. Limbs is brutalist. System is a matrix-style coder terminal. Study, Life, Connect and Well Wisher are each something entirely different | 2026-11-06 |
| 3 | One phone app: pairing unlocks JARVIS, and "relays only" is a view inside it. The wall box's own page is generated from the same source | 2026-11-06 |
| 4 | Extravagant but not slow: motion with weight, transitions and scroll, a carcass (placeholder) for what is not built, verification protocols, and nothing that drags the laptop | 2026-11-09 |
| 5 | Honest data only: states come from the board or the API, simulated data is never shown as measured, and there is never a camera | standing |

## 2. Who owns what (two chats run at once)

| Chat | Sections and files | Never touches |
|---|---|---|
| **UI overhaul** (new) | Shell and navigation, `styles/tokens.css`, new `styles/sections/*.css`, `styles/motion.css`, pages Core, Yaadash, Aankhen (look only), Limbs, Connect, System, their components, and the phone shell: `phone_page/{index.html,app.js,relays.*,board.html}`, plus the regenerated `aankhen/firmware/web_page.h` | `app/ui/src/germoney/**`, `app/ui/src/ww/**`, `phone_page/ww.*`, Well Wisher's Python |
| **Well Wisher** (running) | Well Wisher, Study, Life, Career, Tree and the rest of `germoney/**`, `ww/**`, `phone_page/ww.*` | the shared foundation files, except through the seam in section 4 |
| **Aankhen** | firmware logic, `aankhen/**` Python, Aankhen routes and data | the look of the Aankhen page |

Shared files (`Shell.tsx`, `tokens.css`, `motion.css`, `README.md`) change only after a one-line
announcement in `data/notes/NOW.md` §6. Commits name their own paths, never `git add -A`.

## 3. Loose ends, verified 2026-11-09 (grep of `app/ui/src`)

**Cards with no mount point:** AwayModeCard, SecurityAlert, EnergyCard, LibraryPanel, ReminderAlerts,
FirstLight, MeasureRoom, Staff. MemoryGalaxy is mounted only in `galaxy/demo.tsx`; GrowthChart only
inside MemoryGalaxy. For each card the owner chooses mount (and where), or delete.

**Duplicates:** PhoneCard is mounted in both Connect and Limbs. It belongs in Connect, and Well
Wisher opens it as its overlay O2.

**Uno leftovers:** `RelayWiring.tsx` is a whole Uno wiring guide (the ESP32 is the relay board
now), plus Uno text in Limbs, WallBox's not-active branch and Connect. Remove it, or turn it into
the wall box's wiring table.

**Wall box card:** `channelRows(...).filter(r => r.present)` hides the relays that are absent, when
it should show them as "unavailable". The LCD row and the ceiling drawing must match the real six
channels: light (GPIO 4) white downlights, fan (5), light2 (6) warm outer, light3 (7) warm inner,
light4 (15) pink outer, light5 (16) pink inner. Switch state and aria come from the board's
confirmation, never from the saved state.

**Uncommitted work from another agent:** `WallBox.tsx`, `pages/Limbs.tsx` and `styles/board.css`
hold edits that nobody has reviewed. Read the diff, then keep or revert each hunk, and say which
and why.

**Untracked `docs/README.md`:** it carries the router MAC and LAN addresses and claims "zero
brownouts". Rewrite it without them, or delete it. Never commit it as it is.

**Routes with no UI:** list every FastAPI route and every caller in `app/ui/src` and `phone_page`.
For each route nothing calls, the owner chooses: wire it, keep it as voice or tool only (say so in
a comment), or delete it.

**Sections without a brand:** Yaadash (memory) is not in decision 2, and Connect's genre has not
been named. Ask the owner.

**Phone shell:** the tabs are Room, Aankhen and Talk, plus a Study link. The Aankhen tab must show
only what the board measures, and must say "predicting" until the drill days pass (the
Aankhen rule).

## 4. The foundation, and the seam with Well Wisher

The Well Wisher plan already designs a three-tier token system (5.1 primitives, 5.2 semantic
themes with a contrast table, then component tokens), a motion system with a load governor (5.7),
and Playwright protocols (8.4, 8.6). Don't build a second one. Build the shared layer once, here:

1. **Tier 1, primitives (shared):** `app/ui/src/styles/design/primitive.css`. Spacing, radii,
   type scale, durations and spring curves, all as `--p-*`. Well Wisher imports this file and
   does not keep a copy.
2. **Tier 2, a brand per section:** `app/ui/src/styles/sections/<name>.css`, scoped to
   `[data-section="<name>"]` on the page root that Shell sets. It holds the colours, fonts,
   texture, density and motion personality. Core's brand is today's `tokens.css` values, moved
   without changes.
3. **Invariants across brands:**
   - Device colours stay the same everywhere: white `#e9f3ff`, warm `#ffb347`, pink `#ff5fa8`,
     fan `#5aa9e6`.
   - Status meanings stay the same: confirmed, waiting, fault, simulated.
   - Every brand keeps a 44 px tap target, a visible focus ring and the contrast floors
     (4.5:1 text, 3:1 non-text). These are checked by a test that reads the token files.
4. **Motion:** one governor shared by the whole app (`prefers-reduced-motion`, a low-power
   mode, and a frame budget). The owner's in-app motion switch lives in one place. Use CSS,
   IntersectionObserver and a few hundred bytes of JS. No GSAP, no Lenis, no WebGL beyond the
   twin that already exists, and no full-screen blur. The Well Wisher plan explains why
   (section 1a): 6 of the 8 reference sites have no reduced-motion handling.
5. **Fonts:** at most two families per brand, self-hosted and subset, with a combined budget
   for the whole app. Measure it in the build output.

Section briefs, to refine with the owner at the start of each section's chunk:

| Section | Brand | What the look says |
|---|---|---|
| Core | today's look (kept) | the butler's face |
| Aankhen | futuristic HUD: scan lines, cool neon on black, measured numbers in mono | the instrument |
| Limbs | brutalist: a raw grid, heavy black rules, flat blocks, one loud colour, mono capitals; the wall box is the hero | the switchboard |
| System | matrix terminal: green on black, mono throughout, a cursor, the log first | the machine room |
| Connect | owner names it | |
| Yaadash | owner names it | |
| Well Wisher, Study, Life | Well Wisher chat (its plan, section 5) | |

## 5. The phone app

The phone app gets the same treatment as the desktop, in a phone layout:
- `index.html` and `app.js` take the brand of the section each tab mirrors: Room is Limbs
  brutalist, Aankhen is Aankhen HUD, Talk is Core.
- `ww.*` follows the Well Wisher plan's section 4.14. That is the Well Wisher chat's job, and it
  uses the shared primitives.
- The phone gets the primitives and the section tokens as plain CSS at build time, written to
  `phone_page/` by the same step as the board page. No separate copy is kept by hand.
- `board.html` is the source of the wall box's own page. Regenerate it with
  `python -m jarvis_app.board_page`; `app/tests/test_board_page.py` must stay green. The board
  page has a size budget: measure it against the flash partition before and after.
- Check every phone view at 390 px wide: 44 px targets, one column below 600 px, no horizontal
  scroll.

## 6. Order of work (one chunk, then one green commit)

0. **Inventory** (read only): the card-to-mount matrix, the route-to-caller matrix, and the
   uncommitted diff of the other agent's edits. Write the findings to
   `docs/research/app-discrepancies.md`.
1. **Grill the owner, in one batch:**
   - mount or delete each orphan card;
   - each uncalled route;
   - the genres for Connect and Yaadash;
   - the mood for Aankhen, Limbs and System (3 questions each, at most).
2. **Clean up:**
   - remove the Uno leftovers;
   - mount PhoneCard once;
   - make the WallBox fixes;
   - resolve the other agent's diffs;
   - rewrite or delete `docs/README.md`.
3. **Foundation:**
   - primitives file, section scope in Shell, motion governor, contrast test;
   - Core moved onto it with no pixel change (screenshot diff);
   - tell the Well Wisher chat the paths.
4. **Limbs, brutalist,** with the wall box as the hero.
5. **System, terminal.**
6. **Aankhen, HUD.** Look only; the twin and its data stay as they are.
7. **Connect.**
8. **Yaadash.**
9. **Phone shell and board page:**
   - regenerate `web_page.h`;
   - measure the page size;
   - the board page drift test stays green.
10. **Final sweep:**
    - every section at 1366x768 and 390 px, light theme where it applies, reduced motion;
    - a performance trace of each section switch (no long tasks over 50 ms after first paint);
    - update `NOW.md`.

## 7. Verification (every chunk)

- Run `npx vitest run` and `npx tsc -b` in `app/ui`. Run the app tests from `app/` with a
  scratch `JARVIS_DATA_DIR`. Run `pytest app/tests/test_board_page.py`.
- Never build into `app/ui/dist` while `JARVIS.pyw` is running. For screenshots, use the sandbox
  instance: `python -m jarvis_app.ww_sandbox` on port 8790. Port 8777 is never touched.
- Take Playwright screenshots of each changed section at 1366x768 and 390 px. Check contrast
  with the token test, check keyboard focus order, and repeat with reduced motion on.
- Every number in a commit is measured. Simulated data is never shown as measured.

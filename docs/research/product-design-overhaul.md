# Product-design overhaul: running research file

One file for the JARVIS + Well Wisher product-design overhaul (the design source of truth is `docs/design/jarvis-product-overhaul.md`). Newest dated section on top. Owner-specific asset notes (the private reference collages and what each picture is used for) live in the private notes, not here.

## 2026-11-13: D01 number forms (Odometer, Dumbbell, LedgerTape, Jar)

**Question.** Can the four number forms show data in an out-of-the-box way that still reads at a glance, with a state lamp on every figure and no scolding?

**Built.** `app/ui/src/shared/data/numbers/`: Odometer (pixel-numeral wheels in a recessed well, one CSS `steps()` transition on `transform`, only while on screen and not Calm, four dashed wells plus the reason for any state but LIVE and SIMULATED), Dumbbell (ring for the earlier self, disc for now, shared ruler, rails sorted by gap, off-scale held at the end), LedgerTape (paper tape, deterministic torn end, double-rule total), Jar (recessed well, notch disc, hatch past the notch plus one text line, no red). Pure layout in `layout.ts` with named constants; a table or text equivalent on each; forced-colours branch. Gallery entry `d01-numbers.tsx` (group data, 24 states).

**Numbers.** 0 requestAnimationFrame, 0 timers in the folder (grep); roll is one 140 ms transition. Screenshots at 1366x768 and 390x844, light and dark, reviewed.

**Unverified.** Real-device wheel roll; the LedgerTape 390 viewport shot is clipped by the gallery scroll container (full-page shots are fine); look is on today's clay tokens and will shift when the craft pass merges (tokens used by name).

**Changed.** J01 uses kit Readout until it swaps in the Odometer.

## 2026-11-13: wave 6, L02 Trim and the settings registry

**Question.** Can every setting live beside the variable it tunes (no settings page) and still be found, reset and audited?

**Built.** `shared/trim`: `Trim` (44 px clay key with a slider glyph; popover at most 320 x 360 with the control in a recessed well, "Set to" and "Default" on dotted leaders, one "Read by" line, Reset; Esc returns focus; Tab wraps; a press outside or a resize closes it), `registry.ts` (`*.settings.ts` glob, pure `collectSettings`, alias table empty until E13, `auditTrims`, `searchSettings`), `SettingsIndex`, pure `placePopover`, and the palette mode `:` in `shell/modes/settings.mode.ts`. Hardware and brain settings (`risk`) keep a two-press Reset. Gallery entries `kit/Trim` and `kit/SettingsIndex`.

**Numbers.** vitest 2027 of 2027 in 98 files (twice), tsc clean, bundle check ok (ww build 490 modules); 13 Playwright checks at 1366x768 and 390x844, light, dark, forced colours and reduced motion: key 44 px, popover within 320 x 360 and the viewport, every control inside at least 44 px, focus lands on the control and returns to the key on Esc. Screenshots: scratchpad `jury/wave6/l02/`.

**Unverified.** No real `*.settings.ts` exists yet, so the glob and the "no unmounted entry" audit are proved on two fixtures only; the audit is not yet run against the live app. The `:` mode is tested as a function and as a collected mode, not typed into the real palette in a browser. Screen-reader output not listened to.

**Changed.** Optional additive fields on `SettingDef` (`format`, `defaultText`, `isDefault`, `risk`) and on `Trim` (`def`, for the gallery and tests); the contract signatures stand.

## 2026-11-13: D04 Capture line (wave 6)

**Question.** Can one prompt line serve both Well Wisher capture (`spent 120 chai`, `water 250`, `gym legs 45`, `remind me next tue 7 pm physics`) and the JARVIS closed-verb lines, with a local deterministic tokenizer that never guesses, and still look like an instrument rather than a text box?

**Built.** `shared/capture/`: `parse.ts` (`parseWw(text, now)`, `parseJarvis`, `parseCapture`, `rewrite`; no eval, no shell, no network, input capped at 160 characters), `when.ts` (weekday, month-end, year-end, leap-day and time resolution against an injected clock), `layout.ts` (pure status, chip, caret and history functions with named constants), `CaptureLine.tsx` and `capture.css` (recessed well, HUD corner brackets, sigil tag, a drawn solid block cursor because the native caret blinks, editable chips beneath, "? what is 120" waits, Enter commits, 6 s Undo toast through the kit's NotchedToast, Ctrl+Space through one shared window listener for `ww` only). Gallery entry `d04-capture.tsx` (two entries, 12 states, a reading table on a fixed clock of Fri 13 Nov 2026 10:30). `e2e/d04-capture.spec.ts` (keyboard, idle, screenshots).

**Numbers.** vitest in `shared/capture`: 143 tests in 3 files (30 phrases as written, 10 ambiguous that wait, weekdays, month and year ends, leap days, times, rewrite round trip, no-execution and closed-verb cases). Playwright: 6 of 6 (ask on "120" and Enter commits nothing; clear line commits and clears; Undo restores the text; Ctrl+Space focuses from elsewhere; jarvis "unknown verb; try help" holds; cursor animation none, 0 rAF and 0 running animations in 1.5 s idle; no document scroll at 1366 x 768; no horizontal scroll and 44 px targets at 390 px).

**Unverified.** The tokenizer reads English words and 12-hour times only (no other language, no relative phrases beyond the table). The phone gallery pane scrolls inside itself, so the phone screenshots of single states are partly covered by the sticky switch row; the component itself is not clipped at 390 px. Forced-colours was not screenshotted. Chips show the person's typed words, never a measurement, so no lamp is needed on them; the line's own state lamp follows ready, ask, waiting.

**What it changed.** The Memory line (J04) and the Today footer (L04) can mount `CaptureLine` with a grammar and get the same ambiguity rule, Undo and keyboard path; the tokenizer is the single place date words are read.

## 2026-11-13: D02 series forms (Trace, DotHistogram, SkyLedger)

**Question.** Can the three series forms of spec 20.5.2 read at a glance and still look like small refined instruments (clay housing, recessed screen, HUD plates, halftone, dot matrix) while keeping every honesty rule: no number without a lamp, gaps never filled in, no run counter or loss wording?

**Built** (`app/ui/src/shared/data/series/**`, gallery entry `d02-series.tsx`, resumed from a builder cut off by an outage). One housing for all three: a raised clay plate (tokens `--elev-raised`, `--ridge-hi/lo`) with a serial pill (TRC, HST, SKY), the lamp glyph plus word plus reason, and a charcoal screen seated in a recessed bezel (`--elev-recessed`), with HUD brackets, static 3 percent scan lines and two corner plates (what is shown, and the lamp word). Trace: 1.5 px hairline, a halftone dot ground under each run that stops where the line stops, hatched "no data" bands, ASCII ruler, own-median datum, last point a disc and the week before as rings, scrub and pin by pointer and keys, a two-point difference, a 320 ms one-shot draw. DotHistogram: towers of LED dots in socket grids, a stated unit per dot, part dots as rings, median tick and middle-half bracket, a Ridge form. SkyLedger: stars, crescents for rest days, faint points for untouched days, a ratio headline with a ticked dial, short habit figures.

**Numbers.** Dot towers: 640 entries at one dot = 5 filled 5 of 21 socket rows before; now about 11 of 13 (the pitch picks the fewest dots across that keep the tallest column near 85 percent of the height). Sky figures: with no edge limit the 90-day fixture drew 33 lines crossing the whole field; the latest 12 stars per habit joined only within 1.6 cells gives short clusters. Tests: 38 new (layout, keyboard scrub, hollow states, deletion lowers the count, folder grep for the banned words, no timers, forced-colours and reduced-motion branches); full suite 2038 of 2038 twice, tsc clean, bundle check ok. No horizontal scroll at 1366 and 390 wide.

**Unverified.** No screen-reader pass; no real data (every sample is a seeded fixture, shown as SIMULATED, plus a LIVE-ink state on the same fixture for the colour); the one-shot draw keeps a Trace's line hidden until it is first a quarter in view, so a full-page screenshot of an off-screen Trace shows no line until it is scrolled to (by design, but a juror may read it as empty). The FAULT lamp colour comes from the shared lamp token, not from this package.

**Changed.** The series forms exist for J01 and the Well Wisher sections to adopt; SkyLedger takes an optional `habit` per day beyond the contract signature (a superset), and all three take optional `label`, `unit` and `reason`.

## 2026-11-13: D03 tables, lists and the select (wave 6, resumed after an outage)

**Question.** Can the product's three list forms (a table, a reorderable list, the select) be built as small instruments with full keyboard paths, 44 px targets and no native select, on the shared grammars and clay tokens only?

**Built.** `LedgerTable` (32 px rows, sticky header, text sort glyph, F2 edit, column chooser, drawer, cards under 900 px, a lamp column; numbers drawn only for LIVE and SIMULATED, hollow with the reason otherwise), `SlotList` (Alt+Up and Alt+Down, Space lift with a dashed blanking plate, grip drag), `DetentRack` (listbox, `aria-activedescendant`, typeahead, bottom sheet under 900 px). 69 unit tests in `shared/data/tables/__tests__`, 15 Playwright tests in `e2e/d03-tables.spec.ts`.

**Numbers.** tsc clean; vitest 2069 of 2069 twice (100 files); bundle:check ok; Playwright 15 of 15 (final run split: 14 + the cards test rerun alone after its fix).

**Two real bugs found by the keyboard spec and fixed.** (1) The inline editor's ref callback called `select()` on every render, so each typed character replaced the previous one: typing "Unit 9 chai" committed "i". The select now runs once, from a stable callback. (2) The grip's pointer capture sat on a node that React moves while a row is carried (the dragged row is reordered live); capture now sits on the list, which stays mounted. The spec had two test-side faults too (grip read off-screen; the still "drawer open" form's fixed scrim covering the phone cards).

**Unverified.** Pointer drag was only exercised with Playwright's mouse, not touch hardware. The cards jury picture still shows the still drawer form overlapping (a gallery artifact). Colours are the clay tokens by name, so they will change when the craft pass merges.

**Changed.** Nothing outside the D03 folders.

## 2026-11-13: D05, specimen layout, strata, sigil mark and rack row (wave 6)

- **Question:** can the bento grid be replaced by one specimen with callouts on leaders, and can three data forms (strata, sigil, rack) show evidence and hardware state without a number or a lamp that was not earned?
- **Built** (`app/ui/src/shared/data/specimen/`): SpecimenLayout (1302 x 720 desktop, specimen 760 x 560, up to 5 callouts on 1 px leaders bending once at 45 degrees, datum ticks every 40 px; reflow under 900 px as specimen first plus a dot carousel), StrataCore (thickness is evidence, flat dashed layer for none, hollow for WAITING, PLANNED and FAULT with the reason), SigilMark (reuses the shared sigil engine, same input gives the same bytes), RackRow (confirmed only with `reportedAt`; otherwise "sent, not acknowledged").
- **Resumed after an outage:** the 16 files were complete and passing; this pass found by looking that the gallery squeezed StrataCore to a 130 px card (clipped rows, wrapped meta), the rack overflowed at 520 px (its compact layout keyed to the window, now to its own width by container query) and the demo leaders crossed the unit rows (anchors moved to the stack's edge). Added `e2e/d05-specimen.spec.ts`.
- **Numbers:** vitest 2063 of 2063 (102 files; 63 in D05), tsc 0, bundle budget ok (ww build 493 modules), Playwright 7 of 7 (no document scroll at 1366x768 and 390x844, one object wider than 40 percent, strata rows 44 px, zero rAF at idle, forced colours).
- **Unverified:** the composed look inside the real shell canvas (only the gallery stage was seen, zoomed 1.5x and clipped by its pane); the refined clay tokens from the craft pass; contrast measured by eye only.
- **Changed:** nothing outside the owned folders except the new e2e spec.

## 2026-11-13: wave 5 integrated: the wave contract's first test, the second jury, and agent commits that hang

**Question.** Does one shared wave contract stop parallel packages breaking at merge, and did the first visible wave (gallery, shell fixes, clay recipe, grammars, private art) move the jury's scores?

**Method.** Five builders in five worktrees, each given the same contract table (purpose, folders owned, exports added, allowed imports) from Appendix A block C rule 13, a reviewer each, then two jurors on the screenshots. All five merged on main, followed by the full checks.

**Findings.**
- **The contract held for code.** Five merges, 0 code conflicts (only this research file, which every package appends to), tsc clean on the first try and 2000 of 2000 vitest after two gaps were closed. Both gaps were coverage rules, not clashes: the gallery's "every export has an entry" test failed for the two components the clay package added (LitPanel, PlannedGlyph), and the per-product bundle check found 11 JARVIS modules in the Well Wisher only build, pulled in through the gallery (the voice entry and a planned-registry fixture). Waves 2 and 3, without a contract, produced two duplicated lamp tables and three failing cross-package tests.
- **Product gate, measured.** An eager `import.meta.glob` inside an in-place `VITE_PRODUCT` condition is not dropped from the other product's build (10 JARVIS modules remained); a lazy glob behind the same condition is (0 remained, 480 modules). The gallery now loads product entries lazily from `gallery/entries/jarvis/`.
- **Second jury (1 to 10; first jury in brackets; pass line 8.0).** Design and creativity: layout rhythm 6 (5), typographic hierarchy 7 (6), colour discipline 6 (6), depth and material 6 (5), art direction 6 (5), originality 6 (5), signature moment 4 (3), sigil, ASCII and terminal as first-class 4 (new), earned interactivity 5 (5). Usability and content: main action 6, orientation 5, honest state wording 6 (3), focus and keyboard 6 (4), target sizes 5 (4), contrast 6, reflow 5 (6), copy 6 (2), hard gates 5. Nothing reaches 8.0.
- **Why the grammar score is 4.** The grammars and the eleven centrepieces exist and are on the gallery, but no section view uses them yet: the jurors counted 0 of them across 12 shell screenshots. That is the work of the section waves.
- **Hard-gate failures the jury listed, all in legacy pages inside the new shell:** numbers without a state lamp (Core staff rows, Console GPU memory, Day counters and points), primary content clipped or scrolling at 1366x768 on Core, Room and Console, the six title-bar lamps all drawn as the same half disc with their words dropped at 390 px (they all read WAITING because no source is wired yet), the Key error specimen's caption overlapping its icon, and three centrepieces blank in the 390 px contact sheet.
- **The Resume pill reads as a wrong breadcrumb.** It names the place the student was before the current one, as designed, and both jurors took it for a stale location label. It needs a visible "Back to" wording or a different position.
- **Agent commits hang (tooling).** Twice, every builder agent froze on a `git commit` call that never returned (03:25 to 03:37, then within two minutes of a relaunch); `git add` returned, no git process was running, and the same commit from the main session took under a second. Cause not found. A third launch in which agents never ran a git write command and left their work uncommitted for the integrator ran to the end (12 agents, about 100 minutes). About 100 minutes of wall time were lost to the two stalls.
- **Known weak spots left open by the reviewers.** 16 px sigils: 193 distinct drawings over 365 day ids, and 9 percent share one 4-fold form. ASCII portraits: 134 distinct plates for 400 initials. The planned-file glob (`**/*.planned.ts`) is collected but no product registry reads it yet. At 390 px the shell's view row scrolls sideways and hides the folded season switch. Nothing was checked inside the real WebView2 window.

**Numbers on main.** tsc clean; vitest 2000 of 2000 twice (97 files); springs ok; bundle ok (jarvis build 340 modules, ww build 480, neither holding the other product); art tests 61 of 61 and `build_art.py --check` with 0 problems after the private build (12 private files, git-ignored); bench and gallery Playwright 43 passed, 2 skipped; the full Playwright count is in the commit that follows.

**What it changed.** The contract stays for every wave. Agents no longer commit: they report a commit message and the integrator commits. The gallery's coverage rules are now part of the wave contract: a package that adds an export to `shared/kit`, `shared/lamp` or `shared/art` also names the gallery entry file it adds. The section waves must put a centrepiece, a sigil frame and a terminal or ASCII form on each first screen and a lamp beside every number, which is where the jury's scores are held down.

## 2026-11-13: G03 private art track wired

**Question.** Can the eleven centrepiece ids render from the private track while the repository holds no pixels?

**Built.** 9 new recipes (private-only) and 2 customer ids opted in with `private_steps`; new steps `invert`, `ring`, `ascii_frame`; `build_art.py --private --data-root` cuts sources from the owner's collages once and caches them in the ignored folder; `trace_sigil.py`; `ArtSlot` plus `CENTREPIECE_IDS`. Counts: 12 private files, 1.5 to 54 KB each (about 245 KB total), built in 6.5 s warm and about 10 s cold; 60 pytest (46 old, 14 new), 32 vitest in `src/art`. A scratch private build staged 11 of the 11 ids and `check_no_private_in_dist.py` flagged all 11 in it and 0 in the customer scratch build.

**Unverified.** The 25 percent view-box share is checked by the section packages; the private total is not yet counted against the 90 KB ASCII budget (those are images). The sun keeps its painted face as 20.4.6 names it; no figure appears on Senses.

**Changed.** Customer ids without `private_steps` are never re-cut; private budgets come from each recipe. Private notes: `data/notes/research/art.md`.

## 2026-11-13: G01, the clay recipe and the kit debt (wave 5)

**Question.** Can the kit stop reading as "flat clay with no material" (the first jury: depth and material 5 of 10, signature moment 3 of 10) while paying the 18 measured bench failures, without breaking a 3:1 edge, a 2 px focus ring, a 44 px target or the no-idle rule?

**What was built** (four commits by the first builders, then a finishing pass):
- **The material recipe** (`styles/design/clay/elevation.css`): one light from the top left. The built names stay (`--elev-flush`, `--elev-raised`, `--elev-float`, `--elev-recessed`, `--elev-pressed`); added `--lit-hi`, `--lit-lo`, `--ridge-hi`, `--ridge-lo`, `--tooth-opacity` (0.025) and `--elev-raised-drop` (the raised shade in filter form, for the chamfered Panel). The ridge IS the 3:1 border: light theme bottom lip `#4d4d4d` at 7.0:1 on the ground, dark theme top lip `#9a9ea0` at 6.4:1. At most two shadow layers per recipe (tokens.test.ts).
- **Depth, second pass.** Beside the owner's clay references (catalogue C02-03, C01-21, C02-46, C02-21, C01-23: tiles lift 8 to 20 px with a soft offset shade) the first recipe still read flat. Shades now: raised 3 6 14 px at 20 percent ink (was 2 4 10 at 16), float 8 18 40 at 24 (was 6 14 32), well 3 4 8 at 24 (was 2 3 5 at 20), pressed 2 3 5 at 28; dark 3 7 16 at black 60, float 8 18 40 at 62, well at 75. The lit lip catches the top and the left edge (`inset 1px 1px`, was `0 1px`). The white top-left halo of C02-18 and C02-27 was not added: it costs a third layer and breaks the one-light rule (every outer shade falls right and down, a test).
- **Panel lift.** Every chamfered `Panel` had no shade at all: `clip-path` on the panel cut its box-shadow away. The edge layer moved to a clipped `::before`; the unclipped panel carries `filter: var(--elev-raised-drop)`, which follows the chamfer's alpha. Static; `none` in forced colours.
- **Kit debt:** all 18 KNOWN entries paid and deleted (`e2e/bench/known.ts` is empty): Switch OFF word 2.41:1 and clipped by the thumb (64 px track, word in ink-3), Rocker halves 13.9 px (now 48 px), Field focus outline missing and edge 1.12:1, Knob, Plate and Fold edges 1.14, 1.09 and 1.00:1, Button edge 1.23:1, FolderTabs "Soon", Drawer, IconButton (41 x 43) and MasterDetail (64 x 40) hit areas, the toast stack 27 px past a 390 px viewport.
- **One PLANNED drawing** (`shared/lamp/PlannedGlyph.tsx`, dashed ring r 6 on 16 px; the kit lamp drew r 4.5 on 12 px): the kit and contract lamps, the plate, the chip and the PLANNED tab draw it. `LitPanel` (8 snapped angles, opacity only, one panel lit). The `*.planned.ts` glob in `shared/planned/registry.ts`, and `wave5.planned.ts` with the homes `day.month` and `focus.drill` (the week view the plate mentions exists: `ww/life/LifeWorkspace.tsx`). A CSS corner-bracket frame on the planned plate.
- **Finishing fixes:** the "built, not verified" plate drew its half disc inside a `<span class="pl-glyph">`, so `planned.spec.ts` (`svg.pl-glyph path`) failed; `LampGlyph` gained optional `size` and `className` and the plate draws the svg directly. A panel's fault line ran into its body ("could not loadFaulty panel"); it is now its own row.
- **New bench checks** (`e2e/bench.spec.ts`): the recipe as the browser computes it in its normal, high-contrast (in-app switch) and forced-colour branches, light and dark (grain 0.025 then 0, well inset then none, lit lip transparent in high contrast, panel filter none in forced colours); the one-accent-per-`data-view` lint with a canary view of two fills that it catches; a high-contrast jury screenshot.

**Numbers.** `npx tsc -b` exit 0. `npx vitest run` twice: 84 files, 1855 tests passed both times. `npm run -s bundle:check`: budget ok. `e2e/bench.spec.ts`: 34 passed, 1 skipped (the peek aid), KNOWN empty. With `clay-forced`, `planned`, `shell-v2`, `themes-visual` and `hit-areas`: 107 passed, 2 skipped before the accent lint was added.

**Unverified.** The depth is a taste judgement against the reference crops, not a jury score; no jury has re-scored the bench. The shade values are targets until painted on the owner's laptop panel (R01). The accent lint runs on the bench canary only: no shell view is mounted on the bench, so the real views are counted when the section packages put them on a page this lint runs on. The OS route to high contrast (`prefers-contrast: more`) is proved equal to the switch by `tokens.test.ts`, not rendered.

**Review (adversarial, same day).** Unclipping the Panel let two generic rules reach it: `[data-state='error']` drew a 2 px square frame round the chamfer with red corner wedges from `::before`, and `[data-state='planned']` drew a 3 px (medium) dashed square over the dashed chamfer. Both are reset outside forced colours (the error edge is the clipped `::before`, 2 px); the bench material test now reads both border widths (0 px normal, 2 px error in forced colours) and failed 2 of 2 with the error reset removed. Still open: no product registry calls `withGlobbed`, so `day.month` and `focus.drill` exist as data but no live registry lists them until a registry owner adds the line; taste: the 1 px dark lip on every control reads as a drawn outline beside the references' soft moulded edges.

**What it changed.** Every later package reads these tokens; a new kit failure now fails the bench instead of joining a list.

## 2026-11-13: G02, the sigil, ASCII and terminal grammars

**Question.** Do the three grammars of spec 20.4.1 to 20.4.3 exist as the wave 5 contract says (sigilSvg, Sigil, SigilFrame, GlyphRule, Seal, AsciiPlate, AsciiHeat, AsciiBar, AsciiPortrait, sparkline, TermWell, TermLine, BootSequence, ScanFrame, grammar.css tokens), with tests, and do the two weakest parts of the first sheet hold up: the 16 px day-cell sigils and the ASCII portraits?

**What was built (on top of the engine, CSS and golden tests already on the branch).**
- **A 16 px micro grammar.** The old 16 px glyph kept only the big glyph's heaviest layer within 20 segments. At 3 view units per pixel that left bare spokes, and 13 of the 16 sheet seeds read as + or *. The 16 px glyph is now built from parts that are each at least 2 px on screen: an outer frame (circle, n-gon, or four corner chevrons at fold 4) or a small sun ring, n arms, a terminal on every arm (T-bar, fork, filled tip, dot, or chiral blade), and a centre (filled n-gon, dot, or ring). Fold and rotation are the big glyph's. The terminal comes from the big glyph's heaviest primitive and the frame from its ring, so a day cell stays in the same family as the 48 px empty state. Rules: at least two of frame, centre and terminal; a frameless star only with a filled terminal; no 4-fold ring of bent blades (a hooked cross). The 16 px budget is now 32 segments (filled tips cost 4 segments but read as one blob). Growth at 16 px adds parts in order: centre, arms, terminals, frame.
- **A drawn portrait.** The first portrait scattered random heavy glyphs in a ring and laid the initials over them, and the result read as noise. The plate is now 21 x 11 atmosphere cells (126 x 132 px, a circle in pixels). It is one of three shapes (circle, octagon, diamond) with an edge-pass outline (| - / \ by the outline's direction, + at the compass points on half the seeds), a dotted inner rim, and a band shaded by a light from one of 8 directions in one of three ramps. It is mirror-true and holds a clear 7 x 3 cell (42 x 36 px) window where the initials sit at 18 px bold. That gives 144 variants and no face.
- **Tests that did not exist:** ASCII (heat, bar, plate, lint, budget, sparkline, portrait golden, window and symmetry), terminal (tags equal the lamp words, prompt refusal, BootSequence timing, skip, calm, unmount, ScanFrame cap and cleanup), and rules (contract exports, tokens, no literal colour, one-shot animations only, reduced-motion, calm, more-contrast and forced-colours branches, data-grammar on every component, the grammar-use lint, every number on the gallery entry beside a lamp, the atmosphere byte budget across src).
- **Fix to an existing failure.** A comment in grammar.css spelled out the clay layer's path, and `tokens.test.ts` ("only the flag-on Shell v2 chunk imports the clay layer") flagged it. The comment no longer names the path.
- **Jury sheet additions.** A 16 px growth row, and two 3x device-pixel crops (16 px cells and portraits), because a 1x sheet shows a 16 px glyph at 16 px.

**Numbers.** 300 ids give 106 distinct 16 px part plans (fold, layout, frame, terminal, centre). 500 ids give no bare plus or asterisk. All 16 px glyphs are n-fold symmetric point for point (60 seeds each at folds 4, 6 and 8). The worst sigil is 60 segments and 2046 bytes over 3600 glyphs. Regenerating the golden changed exactly the 40 entries at 16 px; the 24 and 48 px hashes, the full bytes and the seals held. On the jury pages: 0 running animations after 6 s at 1366 and 390, light and dark; 0 px horizontal overflow; forced colours draws CanvasText strokes. Grammar tests: 77 in 4 files. Full suite: tsc clean, vitest 1910 of 1910 twice, bundle check ok, atmosphere budget 0 files and 0 bytes (no plates are shipped yet).

**Unverified.** The 16 px glyphs were judged at 3x on screen, not in a real Life month grid beside a day number. The portrait's legibility depends on the font's 6 px advance at 10 px; it was checked only with the clay mono stack in Chromium. Forced colours was checked by Playwright emulation, not under Windows High Contrast in the WebView2 window. No Playwright spec under e2e covers the grammars (G02 owns no e2e path); the forced-colours pass is the in-memory shots script. The jury has not scored this sheet yet.

**What it changed.** The day cell can carry a seed glyph without reading as a plus sign, and a person is shown as a framed plate with readable initials. The 16 px golden hashes are new, and later waves should treat them as the reference.

**Adversarial review (same day).** Reran: tsc 0; vitest 1910 of 1910 twice, then 1911 of 1911 after the fixes; bundle check ok; the shots script exit 0 with 0 running animations after 6 s and 0 px overflow on all four pages. Two mutations were caught (ScanFrame cap timer not cleared on unmount; the fold-4 blade guard removed). Measured on top of the builder's numbers: over 365 day ids the 16 px glyph has 193 distinct drawings, and 33 of them (9 percent) are one 4-fold form (corner chevrons, fork arms, filled centre; `polyPhase` changes nothing when the frame is not an n-gon, so "part plans" over-counts drawings); 5 of the 16 sheet seeds are that form. The portrait has 144 plans and 400 initials gave 134 distinct plates; on the sheet KR and BLD are byte-identical, and with 20 people a shared plate is more likely than not (birthday bound, about 73 percent). The ink mask is mirror-true, the shading is not (it is lit from one side). Fixed in review: the terminal sheet showed "[LIVE] voice level 0.42", a fixture number under the LIVE tag; the tag lines now say what each lamp means and a test allows a digit in a terminal line only under SIMULATED. A typed TermLine clipped its tail on a phone (fixed width in ch, overflow hidden); under 900 px it now shows at once and wraps. Still open: the 4-fold bracket family at 16 px, portrait collisions, faint hollow seals on charcoal, and a forced-colours Playwright spec with assertions on the gallery entry (the shots script only screenshots).

## 2026-11-13: A.N01, the What is new gallery

**Question.** Can one place show every merged component in its states so the owner can judge the look without opening the bench, and can it look composed instead of like a test page?

**Built.** `gallery/WhatIsNew` (left index with roving focus, group filter, clay theme, scale, section theme and state switch), 8 entry files that hold all 64 specimens (the bench draws the same data), `collectEntries()`, a wave check tool, 13 vitest checks and a Playwright spec. The gallery no longer imports the clay or Well Wisher stylesheets; only the shell loads the clay layer. This pass: each specimen is drawn at 1.5x by default on a ruled stage with raised state plates, and the phone width hides the duplicate crumb so the plate gets the height.

**Numbers.** tsc clean; vitest 84 files, 1847 tests, twice; bundle budget ok; Playwright gallery.spec 9 pass and 1 skip (Alt+N waits for N02's place), bench.spec unchanged and passing (37 pass, 2 skip across both); wave_check self-tests 6 pass; no document scroll at 1366x768 (canvas 1302x720) or 390x844.

**Unverified.** The jury has not rescored the new look. The Key error state in the kit overlaps its caption (kit code, G01's file, seen in the screenshot). Alt+N is untested until N02 mounts the place.

**Changed.** The default scale moved from 1x to 1.5x; nothing else in the contract.

## 2026-11-13: N02, shell fixes and the globbed lists (wave 5)

**Question.** Do the eight shell findings of the B05 review close in code, each with a test that fails without the fix, and does the app stay exactly today's with the `app.shell` flag off?

**What was built** (on top of the three earlier commits of this package: the ids `day.month` and `focus.drill`, the frame bridge loop removed by sequence number, the globbed `shell/views`, `shell/slots`, `shell/modes`, SkipLink, the place `app.new` and the registry tests).
- **(a) The Well Wisher frame takes the shell's theme and folds its toolbar into the shell.** Under the shell the frame draws no strip; its season switch, Roadmap and the Settings and Old layout extras are portalled into the shell's view row (`#s2-frame-tools`, wrapped in `.ww-portal` so the design layer still styles them), each 44 px with the clay control edge. `shell.css` points every tier-2 token of the frame's design layer at the clay role of the same job (`inherit` for names both layers share, `var()` aliases for the rest; the only literal is `--ink-rgb`, the ink-1 primitive written as channels because a channel triplet cannot be read from a `var()`). The rooms keep layout and tempo but take the shell's flat surfaces and its one accent. The centre is a labelled section, not a second `main`. Without the shell the strip, tabs and landmark are unchanged.
- **(b) One view switch.** The shell hides the Life, Focus, Study and Career pages' own switches under `.s2-page[data-shell-owned~='views']`; the pages are not edited. Life kept its view in workspace memory, which the shell's switch never reached (so Day / Week showed Today): under the shell the frame now writes its view through, and `useWorkspaceValue` adopts a write made outside its component (a per-key `useSyncExternalStore` snapshot, so other keys re-render nothing).
- **(c) The keyboard-reach flake had a second cause.** After a view with no frame (Day / Close, Focus / Rest) the frame remounted and its mount effect deep-linked from the app tab, which can be older than the tab the shell set (a child's effects run before the shell's), so the frame moved to Life and the shell followed it to Day / Today with no key. Probe: 2 of 3 runs bounced before the fix, 4 of 4 clean after. Under the shell the frame no longer deep-links, restores or applies the season default at mount; the shell's push decides.
- **(d) Resume pill** names the place before, with the clock time it was left, in a labelled `nav`; Alt+R and one press go there; Esc dismisses it until the next navigation. The open view's record is re-confirmed on the shell's existing 15 s clock tick (written at most once a minute, only while the window is visible; no new timer). Its button now fills the pill (it measured 20 px tall inside the 44 px nav).
- **(e) First-run pill** is worded "Go to <home>" and only navigates; already home on a first run it is a quiet "you are here" crumb with no button, since a button that does nothing on press was the finding.
- **(f) Skip to canvas** is the first Tab stop: off screen until focused, then a 44 px plate; it focuses `#s2-canvas` by script and leaves the URL fragment (token and route) as it was.
- **(g) The place `app.new`** (Alt+N, palette verb "What is new") mounts N01's `WhatIsNew` through a glob of `gallery/index.ts(x)`, so this branch builds without the gallery and shows a PLANNED "not built yet" plate; the place now fills the canvas (it measured 0 px tall).
- **(h) The view count** is 36 in `__tests__/shell/viewCount.test.ts` and in the keyboard-reach spec, which now walks Day / Month and Focus / Drill.

**Numbers.** See the integrator's commit for the final run; this branch measured: `tsc -b` 0; vitest 1869 of 1869 twice (shell folder 76, of which 8 new in `frameUnderShell.test.tsx` and 1 new in `shellFixes.test.tsx`; the Life write-through and the mount guard each fail when their line is disabled); `bundle:check` 0; `shell-fixes.spec.ts` 5 of 5 and `shell-v2.spec.ts` 11 of 11; the keyboard-reach test 20 of 20 (two runs of `--repeat-each=10`); `themes-visual.spec.ts` 43 of 43 with no snapshot written (flag off unchanged); the full Playwright suite 302 passed, 3 skipped, 2 failed of 307 in 11.0 min, both failures in `shell-fixes.spec.ts` with the "Server offline" scrim over the page: the shared sandbox on port 8790 that the run reused went away mid-run (a health check right after returned nothing), and the same spec then passed 15 of 15 with `--repeat-each=3` on a fresh sandbox.

**Unverified.** Nothing was checked inside the real WebView2 window. Contrast of the frame's pages on clay-light is not computed token by token (the aliases point at clay roles whose pairs the clay oracle computes; legacy pages that hard-code colours are not covered). Old germoney pages inside the frame were not each looked at on the light theme. The "Phone paired" and "Quiet on" lamp words next to a WAITING glyph (shared/lamp, B04) are still open and outside this package.

**What it changed.** The shell is one navigation with one theme; the owner's New UI button shows the Well Wisher sections in the clay instead of a dark frame under a light bar. Later packages add one file under `shell/views`, `shell/slots` or `shell/modes` and edit no shared list.

**Adversarial review (same day).** Rerun on a private sandbox (port 8796, preview 5186), so no other builder's server was shared: `tsc -b` 0; vitest 1869 of 1869, then 1872 of 1872 after the two fixes below; `bundle:check` 0; `shell-fixes` + `shell-v2` 16 of 16 twice; keyboard-reach 20 of 20 in one `--repeat-each=20` run; `themes-visual` 43 of 43, no snapshot written. Mutations: hiding the Career switch turned off failed the one-switch e2e; the frame's mount guard turned off failed 2 vitest. Fixed here: (1) from `app.new` the pill and Alt+R skipped the place just left and went one further back (`app.new` is never recorded, so `prev` was two places old); `readResume` now reads the current record on the shell's own places, with a test that fails without it; (2) the one copied colour value (`--ink-rgb` channels) is now tied to `semantic.css` and `primitive-color.css` by `inkChannels.test.ts`, so a retuned ink-1 fails a test instead of drifting. Open: the design block A.N02 (a) still says the frame keeps its dark theme and toolbar, the opposite of what was built on the owner's later direction, so the block needs the amendment; at 390 px the folded season switch and Roadmap sit off screen in the scrolled view row; the registry test proves the collector with a fixture record, not that the real glob picks up a new `*.view.ts` file on disk; the first-run "you are here" crumb reads like an empty search field in the title bar.

## 2026-11-13: wave 4 integrated, the first jury scores, and the preview switch

**Question.** Does the foundation hold together once the shell mounts it, and how does the first render score against the jury rubric (the section dated 2026-11-13 below)?

**Method.** Four packages built in parallel worktrees with a reviewer each (shell v2, the second half of the kit move, an in-memory bench, the voice component), merged on main with the full checks; two jurors then read the bench screenshots against the rubric. The shell's own 13 screenshots were gone by the time the jury ran (Playwright empties its output folder at the start of each run, and a later run by the reviewer removed them), so no section was scored.

**Findings.**
- **The preview switch exists.** A New UI button in the current dock and a Classic UI button in the new title bar store `app.shell` and reload. Measured on the sandbox build: the switch renders one new title bar, Ctrl+2 and Alt+0 move between sections and products, and the 43 visual snapshots of the current interface are unchanged.
- **What the new shell shows today is the new frame around the old pages.** The Well Wisher frame keeps its own dark theme and toolbar under the light clay bar, and legacy pages show a second view switch. This is expected at this stage and is the first work of the next wave.
- **Jury, bench only (1 to 10).** Design and creativity: layout rhythm 5, typographic hierarchy 6, colour discipline 6, depth and material honesty 5, art direction 5, originality 5, signature moment 3, earned interactivity 5. Usability and content: component bench 4, target sizes 4, focus visibility 4, 390 px reflow 6, honest state wording 3, forced colours and greyscale 5, copy 2. None reaches the pass line of 8.0. The jurors' main points: the clay has no real material recipe (Readout, Plate and Switch are the same flat hairline), art pieces sit small in mostly empty cards, there is no signature moment.
- **Measured kit debt (18 entries in `e2e/bench/known.ts`, which fails if an entry stops failing).** Switch OFF word 2.41:1 in light and 3.67:1 in dark and partly hidden by the thumb; Switch hit area 57x41; Rocker halves 13.9 px wide; Field 186x41 with a 1.23:1 edge and no focus outline under forced colours; Knob edge 1.14:1; Plate link 59x24 with a 1.09:1 edge; Fold edge 1.00:1; the toast stack overflows by 27 px at 390 px; the PLANNED glyph differs between the kit lamp and the contract lamp.
- **Shell review.** The reviewer fixed three defects with failing-first tests (a second rail tab stop after arrows then Ctrl+3, the 15 s clock re-rendering the whole canvas, Alt+6 leaking to the Well Wisher frame). Left open: the keyboard-reach Playwright test is flaky (1 failure in my first run of 54, 4 of 4 passes on repeat) because the two-way frame bridge can move the place with no key pressed; the Resume pill acts as a breadcrumb; the first-run pill only navigates; there is no Skip to canvas link; nothing was checked inside the real WebView2 window.
- **Voice component.** Python `rint` rounds 212.5 to 212 and `Math.round` gives 213; the TypeScript band map now rounds half to even so the golden vectors match in both languages. Draw cost on the real GPU is unmeasured (the unit tests use a recording context).
- **Chat labels in compaction (tooling).** The Claude Code documentation pages that loaded did not confirm a compaction-instructions section in CLAUDE.md, the fields a PreCompact hook receives, or a way to set a session title from a hook (pages opened: code.claude.com/docs/en/memory.md, commands.md, hooks.md, vs-code.md, sub-agents.md; several sections were truncated). Confirmed there: a subagent starts with a fresh context and receives its task message plus every CLAUDE.md in the hierarchy, not the parent's summary. So the label rule was put in the user-level CLAUDE.md, which every chat and subagent loads; whether auto-compaction obeys it is untested until the next compaction.

**Numbers on main after the merges.** tsc clean; vitest 1833 of 1833; bundle check ok (jarvis build 233 modules, ww build 403; motion helpers 5826 of 6144 B gzip); snapshot and shell specs 53 of 54 on the first run and the failing test 4 of 4 on repeat; the full Playwright count is in the commit that follows.

**What it changed.** Wave 5 starts with what the owner can see: the What is new gallery, the shell fixes above, the clay material recipe with the 18 kit debts, and the sigil, ASCII and terminal systems of the direction v2. The jury runs again on real section screenshots, saved outside Playwright's output folder so a later run cannot delete them.

## 2026-11-13: critic review of the direction v2 revision

**Question.** Is the revised specification complete against the owner's direction, buildable without merge conflicts, free of the non-negotiable violations, and still not boring?

**Method.** Read the owner's direction items A and B one by one against section 20, 15.6, 19 and Appendix A; read the wave 5 contract against the files that exist on main (`app/ui/src/shell`, `shared`, `ww`, `styles/design/clay`, `e2e`); grepped the spec for names, addresses, and banned wording.

**Findings (all fixed in the spec, 20.16).** (1) The wave 5 contract invented tokens `--elev-1` to `--elev-3` and `--recess`; main already has `--elev-flush`, `--elev-raised`, `--elev-float`, `--elev-recessed`, `--edge-ui`, `--decor-opacity`, `--ink-1`, `--ink-2`. (2) G01 owned a bench spec path that does not exist (`e2e/bench.spec.ts` is the file) and did not own `shared/planned/**`, which it must change. (3) `viewCount.test.ts` does not exist; the 34 is asserted in `e2e/shell-v2.spec.ts`. (4) `day.today` and `proof` had no package: added L04 (wave 7), 47 packages. (5) Attendance, timetable and the progress track had a design and no owner. (6) Number-showing components `Dumbbell`, `LedgerTape`, `Jar`, `DotHistogram`, `SkyLedger`, `LedgerTable` had no `state` prop. (7) "Unlockable skins" was a reward mechanic; an idle `AsciiSweep` row contradicted the no-idle rule; a helpline line that appeared only at a high count was an inference about the student; "stress pacing" was a psychological term; selecting 3D in Senses would have given two canvases. (8) Section 20.10 still used the lens package ids. (9) `ww/plannedFeatures.ts` was a list several packages would edit: now collected by glob. The three weakest screens, now designed: `day.today`, `proof.panel`, `memory.beliefs`, `memory.people`, `memory.keep`.

**Not verified.** Nothing was rendered. Whether `viewCount` style tests, the glob collectors and the `e2e` renames work is a design claim until wave 5 runs. Privacy grep found no names, addresses or Wi-Fi names; the career and tree topics (a country, a martial art) are product scope taken from the owner's note and are generic, left as they are.

**What it changed.** `docs/design/jarvis-product-overhaul.md`: 20.16 added, A.L04 added, 15.6 tables, 20.10, A.G01, A.N02, A.L03, A.J04, A.E01, A.E05, D01 to D03 signatures.

## 2026-11-13: owner direction v2 and the design revision

**Question.** After the owner saw the first rebuilt screens and called them boring and lifeless, what must change in the design so the whole application (JARVIS, its five sections, Well Wisher, its five sections, the settings, the data displays, the trees and Career) looks extravagant yet calm, runs on his personal-use rule for pictures, is visible inside the running application early, and can be built by parallel agents without breaking at merge? The direction itself is a private file (`data/notes/design-taste/`); its public-safe reading is 20.1 of `docs/design/jarvis-product-overhaul.md`.

**Method.** Six design lenses wrote against the specification, each in its own file: visual systems (sigil, ASCII, terminal, living clay), data display, Life and Day, Study and Focus, Tree and Career, and the JARVIS sections. An integrator (this record) merged them into section 20 "Direction v2", put a one-line "Superseded in part by ..." pointer on each earlier subsection it overrides, rewrote 8.6 as the personal-use rule, wrote the decision log rows (16.8), the open questions (17.4), the do-not-build table (19), the wave plan (15.6) and the Appendix A blocks. Where lenses disagreed the integrator chose and logged it (20.3, 13 rows). A critic review was planned; its output was not among the inputs of this run, so none is recorded here, and the checks below are the integrator's own counts. The merge was done in two runs (the first was interrupted after the JARVIS sections); the second run re-read section 20 against each lens, found nothing important dropped (the lens names "Quantile Ladder", "Twin Rail", "Reading Bracket" and "Tether Map" survive as `DotHistogram`, `Dumbbell`, the `SignalTerrain` readout and the dropped `TetherMap` of 20.3), and finished the roadmap and the process rules.

**Findings and sources.** No lens could read an award-site page beyond titles, so none of the interaction patterns is cited; they are the designers' synthesis.
- https://www.awwwards.com/websites/data-visualization/ and https://www.awwwards.com/websites/dark/ : opened by four lenses; site names and badges only (for example Greenlock, The Gamification of Everything, Disrupt, Clinia, Superscript), no design descriptions. https://pudding.cool/ : titles and one-line summaries only; used to note that unit-per-dot and one-subject-per-story compositions are current practice. Other award timeline pages appeared in search results and were not opened.
- https://developer.mozilla.org/en-US/docs/Web/CSS/cursor : opened (first 100,000 of about 144,000 characters); cursor image size, hotspot and keyword-fallback rules, the basis of the 32 x 32 cursor limit.
- https://developers.google.com/identity/protocols/oauth2/native-app : opened; for desktop applications Google recommends a loopback redirect with PKCE and no longer supports custom URI schemes or copy-and-paste codes. This fixed the shape of the Google Calendar link (20.6.3). Not opened (search results only): https://developers.google.com/calendar/api/auth, https://developers.google.com/accounts/docs/OAuth2InstalledApp, https://developer.nylas.com/docs/cookbook/calendar/google-calendar-oauth/, https://dev.to/yarkhan02/building-google-calendar-oauth-for-a-desktop-app-2bbn. Whether a personal client in testing mode avoids verification, and how long refresh tokens last, is not confirmed.
- Year-in-pixels patterns (one cell per day, colour by value, month, quarter and year views), search results only: https://apps.apple.com/us/app/habitgrids/id6447490130, https://pixeldiary-2vo.pages.dev/, https://mwm.ai/apps/habits-tracker-yearlit/6740490951.
- https://www.study-in-germany.com/en/plan-your-studies/requirements/ : opened 13 Nov 2026; states proof of finances of 10,332 euros annually; no language levels or semester fees on the page. https://www.daad.de/en/studying-in-germany/requirements-and-costs/ returned 404, so language levels, tuition and semester contribution are unverified and Career shows them as WAITING "unconfirmed" (D-V2-18).
- https://github.com/open-spaced-repetition/fsrs4anki/wiki/abc-of-fsrs : opened; the page said its content had moved. The Wilson interval, the FSRS parameters and the segmentation expressions are standard methods written from memory and must be tested (E06, E07, E08).
- Local: the owner direction note, the specification sections 0 to 17, the catalogue (crops of C01-18, C03-06, C04-127, C04-08, C04-113, C02-02, C04-23, C03-14, C04-10, C04-40, C04-44, C04-122, C03-19, C04-24, C03-21, C04-16, C04-36, C01-19, C04-18, C01-05 and contact sheets 04 and 07 were looked at; every other placement rests on catalogue text).

**Numbers.** 6 lenses, 6 lens files (about 162 KB). Section 20 holds 15 subsections: 28 decisions (D-V2-1 to D-V2-28, each with a test), 13 recorded disagreements, 14 sigil primitives, 4 ASCII ramps, 15 components in the data-display table, 8 mark shapes, 28 settings homes, 10 trees with 113 branches (arithmetic: 57 + 51 branches in the ten lists is 108, plus 5 capstones), 78 new components, 11 centrepieces. Views 34 become 36 (`day.month`, `focus.drill`). Work packages: the 77 lens packages are folded into 46 packages in 10 waves (waves 5 to 14: 5, 5, 4, 5, 5, 4, 4, 4, 5, 5), each wave 3 to 5 packages owning disjoint files; 46 Appendix A blocks plus Block C rule 13 and the written-out wave 5 contract table; 17 open questions for the owner (16 open, 1 closed: where Drill lives); 7 categories in the new do-not-build table. Sections of the specification changed: 0.2, 0.6, 3.2, 4.1.4, 4.2.6, 4.3, 4.4, 6.4, 7, 8.1 to 8.6, 10.5, 15.1, 15.3, 15.4, new 15.6, 16.8, 17.4, 19, new 20, Appendix A. The pointer lines (28 before this run's additions) and the counts were checked by script after writing: every package in the wave table has a block, the waves total 46.

**What could not be verified.** Nothing was rendered. Every pixel size, timing, threshold (0.25, 0.15, 0.5, the 3-paper and 20-question floors), the STALE windows, the 400-node estimate, the terrain rows and sample rate, the 90 KB ASCII budget and the 2.5 percent tooth are unmeasured targets. Catalogue placements other than the crops listed above rest on titles and descriptions and are design claims until the gallery pass (A.Q04). The "gcr" control has no known meaning (probably a course-file service, Q-V2-1). Google's scopes and token lifetime, an OCR engine and a PDF text library (installs need the owner's OK) were not checked. The retention estimate needs a lamp-contract ruling (drawn as four bands with a `DEFAULT` chip, no digits). The evidence kinds for the self-defence and influence trees have had no safety or ethics review (Q-V2-9). The wave plan assumes the merged foundation on main (B01 to B05b, shared/motion, the kit bench, the B07 halves); its file paths were taken from main at commit 68eb769, while this worktree branched earlier, so the integrator must re-check owned paths against main before wave 5 starts.

**What it changed.** The customer-release track stopped gating the build (D-V2-1, Q04 rewritten as the gallery pass); sigil, ASCII and terminal became first-class grammars; "at most two packages in flight" became waves of 3 to 5 packages on disjoint files with a contract table per wave; the settings sheet dissolves into Trim keys; Drill moves into Focus; Life gets the Almanac as `day.month`; trees are evidence-gated; Career dates carry "checked on" stamps; the first thing the owner sees is a "What is new" gallery in shell v2 (wave 5), and the build order puts the visible, most reused layers first, then sections, then engines. The 15.3 and 15.4 tables remain as history with pointers to 15.6.

## 2026-11-13: S7b, the motion and kit move, and the two token gaps

**Question.** Can the motion system and the last five ww kit files move to `shared/` without a rendered change, and can Stat and Meter take a lamp reading so no number is drawn without a state?

**Built.** `ww/design/motion/*` (glide, governor, hold, reveal, transition, springMath, the two generated spring files) and `ww/useReducedMotion.ts` now live in `shared/motion/`; one-line `export *` shims stay at the old paths. `Card`, `Data`, `Interactive`, `Placeholders`, `Reveal` moved to `shared/kit/` the same way. `Stat` and `Meter` take a required `reading: LampReading`; the number or fill is drawn only for LIVE and SIMULATED, otherwise the tile says "not measured yet" and the bar draws no fill. Both lamp DEBT entries are deleted (the debt list is now empty). `--hit: 44px` is declared in `styles/design/clay/primitive-scale.css` and asserted in `tokens.test.ts`.

**Scripts.** `gen-springs.mjs` now reads and writes `src/shared/motion` (path only). `bundle-budget.mjs` measures `src/shared/motion` for the 6144 B gzip limit (path only, limit unchanged): 5800 B. `ww/design/base.css` imports the spring CSS from its new path (one `@import` path, no rule changed).

**Call-site decisions (every Stat and Meter).** COUNTED (a frozen LIVE reading, "counted from your own entries") for: MoneyView saved, needed, gap and the saved/total meter (typed amounts and sums of them); Drill cards-today meter (counted locally); Record attribute meters and the four invested tiles (local ledger counts); proof cards level meter, requirement meters, stat tiles and building-hours tiles (rendered only after the slot has loaded, values come from logged work); Inspector contracts-done meter (counted from the node's own contracts). L4 counter tiles use WAITING_DEFAULT when `value === null` and COUNTED otherwise, so an absent counter is never LIVE. The kitchen demo uses COUNTED for numbers and WAITING_DEFAULT for the null cases. Yaadash has its own local `Stat` (not the kit's) and is untouched.

**Left in place, and why.** The kit CSS (`ww/kit/*.css`, `kit.css`) did not move: the moved components still use the `ww-*` class names those files style, and `shared/kit/index.ts` imports `clay.css` only, so moving the files would change which stylesheet each entry loads. No rendered rule changed. Stat and Meter show no visible lamp (that would change screenshots); they carry `data-state` for the lamp contract and tests.

**Numbers.** tsc clean. vitest 75 files, 1682 of 1682, twice. `springs:check` exit 0. `bundle:check` exit 0 (motion 5800 B gzip of 6144). Playwright full suite: 260 passed, 2 skipped (6.1 min), exit 0.

**Unverified.** Stat and Meter under SIMULATED are tested in jsdom only; no page passes SIMULATED yet.

## 2026-11-13: B07 UI half, the voice visualiser as a standalone module

**Question.** Can the hill-plus-ring of spec 9 be built so that it moves only with real frames, costs nothing when idle, and
can be checked against the Python band map, before any page mounts it?

**What I built** (`app/ui/src/jarvis/voice/`, nothing mounted, no store or page touched). `constants.ts` names every number of
9.2 to 9.11; `bands.ts` is the band map; `signal.ts` is the 64-frame ring per channel with smoothing on ingest, staleness,
`final`, `seq` drops, one-frame interpolation and the `max(arrival, t + lat_ms)` latency shift, plus `attachVoiceFeed(signal,
subscribe)` as the one function the shell calls; `voiceState.ts` is the 9.6 table as a pure function plus `nextChangeAt`;
`geometry.ts` is 9.5 and 9.7 (hill, tier-0 envelope, ring, placeholder, breath, thinking marker, peak hold, test pattern);
`scene.ts` plans and draws; `loop.ts` is the only rAF user; `VoiceHill.tsx` is the component (canvas, DOM level bar, source tag,
lamp from `shared/lamp`, Pause, polite region, hidden meter, static SVG ring in the reduced-motion form); `voice.css` has the
forced-colours branch. Decisions beyond the spec: a `between` state for "pipe closed, still speaking" and "first audio pending
under 1 s" (the table had no row for them); error, muted, thinking, idle and between sit on a flat dotted baseline, only NO
SIGNAL shows the fixed mound; the one `setTimeout` is armed only for the next moment time alone changes the state.

**Numbers.** 111 new vitest tests in 5 files (golden 4, geometry 27, signal 19, state 31, component 30); full suite 1,790 of
1,790 twice (was 1,679), `tsc -b` and `oxlint` exit 0, the seam import-graph test passes with the new `jarvis/voice` folder.
Counts pinned: 3,072 points high, 1,280 low, 384 envelope, 0 static; smoothing 0.713 up and 0.268 down per 50 ms; stale at
401 ms not at 400; a 1,000-sequence property test (V-15) finds solid points only with a frame under 400 ms old (20+ solid cases
in the run, so it is not vacuous). Idle after mount: 0 queued rAF callbacks and 0 timers; after unmount: 0 and 0; reduced
motion: 0 rAF calls and at most 4 number changes in 1 s of 20 Hz frames.

**Golden vectors (P-6).** `src/__tests__/jarvis/voice-golden.json`, 5.5 KB, written by `UPDATE_GOLDEN=1 npx vitest run
src/__tests__/jarvis/voice-golden.test.ts` and checked without the flag. Python can check the same file: `bandMap.edges` against
`core.playback.band_edges()` (0.5 Hz), `bandMap.freqToBand` by running `playback.analyse()` on a 0.1-peak sine at each frequency
and taking the loudest band, `bandMap.dbToByte` against `np.rint(255 * np.clip((db - lo) / 60, 0, 1))` with lo -60 out and -70
in, `hill.high.layer0Heights` from `rows.row0` with `np.interp(abs(x) * 23, range(24), row) * 190 / 255`. I ran exactly that
with a scratch script (not committed) against `core/playback.py` in this worktree: all four pass. It caught one real drift:
numpy `rint` rounds 212.5 to 212 and `Math.round` to 213, so `dbToByte` rounds half to even now. The geometry hashes are
TypeScript-only (they pin how the picture is drawn). PCM to bands in TypeScript is not built: analysis stays in Python.

**Unverified.** Draw cost (target 3 ms average, 6 ms p95 for 3,072 points) and the CPU share are not measured: happy-dom has no
canvas, so the draw tests use a recorder. The real WebView2 window, the iGPU, forced-colours pixels (E-04), the 3 flashes rule on
pixels (V-12; the design cannot alternate full-field luminance, but no pixel test exists), and hidden via the host `IsVisible`
message (only `visibilitychange` is wired) are unchecked. No Playwright spec: the component is not mounted in any page and the
`dist-e2e-hooks` build of 9.13 does not exist, so E-01 to E-07 are covered at unit level only. The `lat_ms` shown is what the
stream reported, not measured acoustic delay. The legacy tier-0 full scale (`level` 10 = 1.0) is an assumption.

**What it changed.** New folder and tests only. B06 mounts `VoiceHill` on Core and calls `attachVoiceFeed(voiceSignal, ...)`.

## 2026-11-13: the jury bench, the kit, art and lamp measured against the quality bar (package BENCH)

**Question.** B03b, B03c and B04 could only test the kit, the art components and the lamp in happy-dom. Do they meet the engineering checklist (forced colours, 44 px hit areas, keyboard reach, reduced motion, greyscale, contrast) when drawn by a real Chromium with the real tokens and CSS?

**What was built.** `app/ui/e2e/bench.spec.ts`, `e2e/bench/entry.tsx` (the bench page), `e2e/bench/inpage.js` (the measuring code that runs in the page), `e2e/bench/known.ts` (the debt list), `e2e/bench/bench.css` (layout only). Nothing in `src/` changed. The page is built in memory by Vite from the real components and served from a fake origin, like `planned.spec.ts`; nothing near `app/ui/dist`. It draws every capitalised function export of `shared/kit` (41 of them), `shared/art` (21) and `shared/lamp` (4) in their states: the five lamp states; planned, error, disabled-with-reason and loading forms where a component has them; five modals (drawer, sheet, popover, two dialogs) opened by `?open=`. A coverage test fails if a new export is not drawn. Both themes (`clay-light`, `clay-dark`). 28 tests, 2.9 min.

**Method.** Per component: (a) forced colours: border, outline or underline on every control and an outline (or an SVG child stroke) on focus; the five lamp shapes differ as markup and as pixels in three glyph sets; (b) hit box from `getBoundingClientRect` plus `elementFromPoint` probes outward from each edge to find `::after` extensions, 43 px accepted (probe resolution is 1 px); (c) real Tab presses reach every control, aria-disabled controls included, no `disabled` attribute outside the plain disabled field; (d) reduced motion: no running animation and no DOM mutation in the 2nd second; motion allowed: none running at 6.2 s, no DOM mutation, no `requestAnimationFrame` call and no live `setInterval` in the 7th second; (e) greyscale filter, the five glyphs compared pairwise as pixels (2 % of pixels must differ); (f) every text node against the real stack of backgrounds under it (`elementsFromPoint`, so SVG plates and gradients-free fills count): 4.5:1, 3:1 for large text, and 3:1 for a control edge by border or fill. A canary test plants a 20 px borderless button, low-contrast text and an infinite animation and requires every scan to catch them, so a quiet scan means something.

**Numbers.** Looked at, per theme: 129 focus rings, 98 borders plus 15 container edges plus 9 native controls, 142 hit boxes, 157 Tab stops of which 14 aria-disabled, 859 text nodes, 130 control edges. Passing everywhere: all five lamp shapes distinct under forced colours and under greyscale in all three sets (kit, lamp, art); every control reachable by Tab; aria-disabled controls stay focusable; no animation, DOM churn, rAF call or interval at rest, with motion allowed or reduced; the art SVG marks draw their focus ring as a stroke (27 of them), not an outline.

**Findings (18 entries in KNOWN, both themes unless said).** Hit area under 44: kit/Switch 57 x 41 (box 56 x 32, extension 5 and 4), kit/Rocker halves 13.9 px wide (x8), kit/Field 186 x 41 (x7), kit/Drawer field 408 x 41, kit/IconButton 41 x 43, kit/MasterDetail row button 64 x 40, kit/Plate link 59 x 24. Control edge under 3:1: kit/Switch off 1.41 light and 1.50 dark, kit/Knob 1.14 and 1.05, kit/Plate link 1.09 and 1.15, kit/Button disabled-with-reason 1.23 and 1.12, kit/Field 1.23 and 1.12, kit/Fold 1.00 (no edge at all, x3). Text under 4.5: the OFF word of kit/Switch 2.41 light, 3.67 dark; the planned FolderTab 2.41 and 3.67. No focus outline: kit/Field (one input, forced colours). No edge at all in forced colours: kit/Fold. Wider than 390 px: kit/NotchedToastStack by 27 px. Not asserted but visible in the screenshots: the Switch thumb covers the first letter of OFF, the kit PLANNED lamp inside a `.k-lamp` takes a dashed box around the word, and the legacy `ww-*` controls (drawn by `ww/kit` CSS with the Ash and Paper tokens, which `shared/kit` cannot import) sit on a different ground from the clay surfaces, so one page carries two token systems.

**Unverified.** Contrast of text on gradients or images is skipped (2 text nodes of 859 were skipped as sitting on an image or gradient; 243 more were visually hidden); input values and placeholders are not text nodes and are not sampled; hover and pressed colours are not sampled; the legacy `ww-*` controls are measured with `ww/design` plus `ww/kit` CSS and the Paper selector rewritten to a body attribute, which is the bench's wiring, not the app's; the bench's two toast stacks are made static so they do not cover the page; real-window rendering (fonts, scale) is not covered.

**What it changed.** Nothing in `src/`. The suite now fails when a listed failure is fixed (delete the entry) and when a new one appears. Screenshots (light, dark, forced colours, greyscale at 1366x768 and 390x844) are written to `app/ui/test-results/jury-bench/` (git-ignored), with `findings.json` and `findings.md`.

## 2026-11-13: B05 adversarial review (Shell v2)

**Question.** Does the B05 report hold when rerun, and does the code meet the quality bar (Strand A rubric, Strand B checklist) and the spec 3.1 to 3.4?

**Rerun (real exit codes).** `tsc -b` 0. vitest 1716 of 1716 twice before fixes, 1719 of 1719 after (3 new). `bundle:check` 0. Full Playwright, flag off, sandbox on a scratch port: 270 passed, 2 skipped, **1 failed** of 273: `shell-v2.spec.ts` "every section and every view is reachable by keyboard alone" saw the page root at `day.today`, then `focus.start`, while it waited for `focus.session`. It then passed 4 of 4 alone, the whole shell spec passed 3 of 3 repeats (33 of 33), and a probe of the Day-to-Focus entry showed no bounce in 3 runs. Recorded as a flake with an unconfirmed cause (most likely the two-way frame bridge moving the shell's place while a frame switch is in flight). After the fixes, shell-v2 + themes-visual + keyboard + hit-areas: 72 passed, 1 skipped; no snapshot written.

**Mutations.** Removing the focus return in ShellV2 failed the palette test; removing `notInText` in keymap.ts failed "single keys never fire inside a text field". Both restored.

**Fixed (with a test that failed first).** (1) The rail had two tab stops after arrow roving then Ctrl+3 (`room` and `senses`): rove() writes tabindex in the DOM and React rewrites only changed props. (2) The 15 s clock at the shell root re-rendered the page in the canvas on every tick; Rail and Canvas are now memoised. (3) Alt+6, the frame's old Setup key, still reached ww/frame and switched it to Setup while the rail said Day; it is swallowed with no binding and no hint.

**Left for the integrator.** The Resume record is written on every navigation and never confirmed while a view stays open, so the pill always names the place on screen (a breadcrumb; the pill and Alt+R are no-ops within a session) and after 100 min on one view it reads "last seen 2 h ago" about the view being looked at. The first-run pill "Start: wake JARVIS" only navigates home, so on home it does nothing (spec 4.2.3 says it runs the primary). Spec 2663's "Skip to canvas" link is absent. Under v2 the Well Wisher frame keeps its own dark theme and toolbar under a light clay title bar (visible in the day screenshot). The Well Wisher lamps read "Phone paired" and "Quiet on" next to a WAITING glyph, which reads as a claim (shared/lamp copy, B04).

## 2026-11-13: B05 Shell v2 behind `app.shell`, built and measured

**Question.** Can the ten sections of spec 3.1 live in one navigation (title bar 48 px, rail 64 px, canvas 1302 x 720) behind a flag that leaves today's app untouched, with one key table feeding both the keys and every hint?

**Built (`app/ui/src/shell/**`, `jarvis/shellPorts.ts`, `App.tsx`, `pageLoaders.ts`).**
- Flag `app.shell`, default off: localStorage `app.shell=v2` or the fragment `#...&shell=v2` (remembered). The fragment is captured when `shell/flag.ts` is evaluated, imported first in `App.tsx`, because `lib/api.ts` wipes the whole fragment when it reads `t=`; the first Playwright run proved it (all ten flag-on tests saw the old frame).
- `ShellV2` is a lazy chunk (30.6 kB JS, 43.6 kB CSS before gzip; 9.95 kB and 8.43 kB gzip) and the only importer of the clay token entry and `shared/kit/clay.css`, so flag off fetches none of it. It sets `data-theme` (clay-dark for JARVIS, clay-light for Well Wisher) and `data-product` on `<html>` and removes them on unmount.
- `ids.ts` (the 3.2 table in rail order), `keymap.ts` (the one binding table: Ctrl+1..5 with Alt+1..5 aliases, Alt+0, Alt+R, `[` `]`, Alt+Left, Ctrl+K, `?`), `commands.ts` (palette rows whose hint can only come from a binding), `ports.ts` (voice, memory, notify, ambient, each with a null adapter: "text only", "no memory here", "no sensing here"; ambient never reports LIVE), `record.ts` (Resume record in localStorage; stale after two 50 min blocks, then "last seen ..." with Pick up and Drop it, never a running time), `hosts.ts` (what each of the 34 views shows), `store.ts` (place per product, one overlay, Back history capped at 20).
- Title bar: wordmark, product switch (radio group), Resume pill, the shared `Annunciators` (words from 1280 px), fault chip (JARVIS opens Console / Health; Well Wisher only states it, its target `settings.data` is not built), clock, window controls. Rail: five sections plus the Ask orb, one tab stop, roving tabindex, 3 px inner edge plus heavier icon for the active slot. View switch: tablist, 44 px. Palette: Go, Do, Ask, paged at 7 rows; planned verbs (the registries' `disabled` entries) show the PLANNED lamp and open "What is coming". Shortcuts sheet reads the same table.
- Sections without a new page render today's page in the canvas (`.page` scrolls inside the canvas, never the document); a view that shares its page with a sibling says so in one line; `console.crew` is the `jarvis.agents` planned plate; `day.close` and `focus.rest` are honest "not built" plates; `console.events` lists the store's events (the ticker's data). Well Wisher sections drive the existing frame through a lazy bridge in `pageLoaders.ts` (two-way: a jump inside the frame moves the rail) and its workspace strip is hidden by CSS under `.s2` only. A window capture listener stops the frame's own Alt+1..6 under the new shell.

**Numbers.** vitest 1716 of 1716 (was 1679; 37 new in `__tests__/shell/`: keymap 18 parsing the spec's 3.2 table, ports and record 10, render 9). `tsc -b` clean. `bundle:check` ok for all three builds; springs ok. Playwright `e2e/shell-v2.spec.ts` 11 of 11 against the sandbox on the built app: title 48, rail 64 x 720, canvas exactly 64,48 1302 x 720 at 1366x768 and 1302 x 672 at 1366x720; document `scrollHeight <= innerHeight` on all ten sections; all 34 views reached by keys; no shell control under 44 x 44 px; at 390 px canvas and rail 390 wide, rail below the canvas, pill row 44 px, no horizontal or vertical document scroll. Flag off: dock and ticker present, no shell root, no clay attribute. Whole Playwright suite with the flag off by default: 271 passed, 2 skipped, 0 failed of 273 (262 existing plus the 11 new); `e2e:shots` (themes-visual) 43 of 43 with no snapshot written or renamed.

**Unverified or not done.** Not run inside WebView2 (Alt+0, Ctrl+Shift+Space rows are "verify"). Server scene memory for the Resume record (localStorage only); pages report no `object` yet, so the pill names a place, not "Paper 2". All off in the rail, the `pair` and `settings` sheets, Ctrl+, , Alt+L, push to talk and the Status popover below 1200 px are absent, and so are their bindings (no hint without a binding). Esc closes shell overlays only; Back is Alt+Left (Esc-to-back would steal page popovers' Esc). The URL route `#/<section>/<view>` is parsed on load but not written (the fragment carries the token). The old dock and the frame strip are gated, not deleted (deletion at the flag flip). Legacy pages keep their own headers and view switches (Study, Career, Focus, Life), so a few views show two switches until their packages land; Life does not follow `day.week` (it keeps its own view value). Legacy page content still scrolls inside the canvas, which the jury's "scrolling primary content" gate will count against those pages, not the shell. The focus-ring-not-clipped per-route test and a jury score are not done.

**What it changed.** The foundation is complete behind a flag: section packages (B06 on) can mount a real page per view id in `hosts.ts` without touching navigation, keys or the palette.

## 2026-11-13: the quality bar: an award-style jury rubric, engineering standards and a licence register

**Question.** The owner asked for work reviewed at the level of award-winning sites on every axis (design, usability, creativity, content, motion, accessibility, performance, code, tests). What do the public award criteria and current engineering guidance really say, and how is that turned into a pass line for each section of this local app?

**Method.** Three research agents on 12 Nov 2026, each opening primary pages. Where a page did not load or no first-party criteria exist, the strand says so. Nothing here has been run against the app yet.

**What it changed.** Every section wave from B05 on gets a jury review against the rubric below (screenshots at 1366x768 and 390 px), with six hard gates: text contrast, keyboard reach, a number without a state lamp, motion under reduced motion, any camera element, clipped or scrolling primary content. The pass line (weighted total of 8.0 or more, no criterion under 7.0) is this project's own choice, not an award rule. The engineering checklist's MISSING rows become work items for the Q01 to Q04 gates, and the licence register decides which borrowed code and fonts may ship.

### Strand A: the jury rubric

Date: 2026-11-12. Public-safe: no personal details. Status: research plus a proposed rubric. Nothing here was run against the app yet.

Question: what do the leading web-design juries score, and how do we turn that into a repeatable review rubric for a local desktop app (React + Vite in a WebView2 window, 1366x768 primary, 390 px phone page)?

Legend: **[V]** verified on the cited page; **[S]** secondary source only; **[U]** could not be verified; **[OURS]** our own decision, not an award rule.

---

#### Part 1. What the juries actually publish

##### 1.1 Awwwards

| Fact | Value | Tag | Source |
|---|---|---|---|
| Criteria and weights | Design 40 %, Usability 30 %, Creativity 20 %, Content 10 % | V | [Awwwards evaluation](https://www.awwwards.com/about-evaluation/) |
| Jury size per site | each approved site goes to at least 18 jurors | V | same |
| Averaging | the 3 jury scores furthest from the average are removed automatically; the page does not say how the rest are combined (presumably a mean) | V for the trim, U for the combine | same |
| Honorable Mention | jury score 6.5 or more | V | same |
| Site of the Day | no numeric threshold; the highest-scoring sites win. A high jury score plus at least 10 PRO user votes can win before the 5-day vote ends | V | same |
| Site of the Month | the 8 highest-scoring sites of the month are re-reviewed by the jury | V | same |
| Site of the Year | all SOTM winners nominated plus some extras; announced the following February | V | same |
| User votes | only validated Professional users count; no numeric multiplier published | V | same |
| Developer Award | every SOTD winner goes to the developer jury; a score above 7 earns the award | V | same |
| Developer categories | Semantics/SEO, Animations/Transitions, Accessibility, WPO, Responsive Design, Markup/Meta-data (an example results page shows per-category scores and an overall 7.35/10) | S (search result of an Awwwards results page, not opened as a primary page) | [search](https://awwwards.com/developer-award) |
| Developer category weights | not published in any page I could open | U | [developer-award page](https://awwwards.com/developer-award) says rules live in a separate "Developer Guideline" |
| Developer Guideline text | exists as a Google Doc linked from [this Awwwards resource](https://www.awwwards.com/inspiration/development-award-guidelines-doc); the doc itself returned HTTP 400 to my fetcher | U | |
| Jury composition | filters "Code", "Design", "Young Jury"; no judging method on that page | V | [Awwwards jury](https://www.awwwards.com/jury/) |
| Developer Award focus | "quality code, interoperable across modern browsers and devices"; balancing innovative design with code quality; accessibility for visual and hearing impairments; mobile optimisation; adaptable for legacy browsers | V | [Developer Award page](https://awwwards.com/developer-award) |
| Mobile track guideline page | 404 | U | [mobile-guidelines](https://awwwards.com/mobile-guidelines) |

What jurors reward inside each axis (practitioner write-up, **S**, not Awwwards' own words): Design = type system with consistent scale and rhythm, grid discipline and negative space, restrained colour, one idea carried through; Usability = orientation in under 3 s, a hero animation that hitches near 40 fps "reads as broken", keyboard, focus states, reduced-motion respected; Creativity = originality with intent, common tropes (cursor blob, default smooth-scroll, boilerplate WebGL plane) discounted; Content = sharp copy, no placeholder assets ([hontran.dev](https://www.hontran.dev/blog/awwwards-judging-criteria)).

##### 1.2 CSS Design Awards (CSSDA)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Criteria | UI, UX, Innovation ("pushes the boundaries of UI, UX and innovative development"); no definitions or weights published | V | [CSSDA about](https://www.cssdesignawards.com/about) |
| Scoring | judges' scores averaged; no scale stated | V | same |
| Website of the Day | judges' average above 8.00, "varies depending on quality of the sites submitted" | V | same |
| Special Kudos | non-WOTD sites averaging above 6 | V | same |
| Public awards | more than 20 votes in a category and judges' average above 6; winners from votes plus judge scores | V | same |
| Judge count, selection, tie handling | not described | U | same |

##### 1.3 FWA

Their own About page carries no criteria ([thefwa.com/about](https://www.thefwa.com/about); the FAQ URL returned 404). Third-party sources disagree: one lists Content, Structure & Navigation, Visual Design, Functionality, Interactivity, Innovation, Overall Experience (the Webby list plus innovation), another lists Innovation, Design, Creativity; the founder said he wanted to move away from points scoring ([search results](https://en.wikipedia.org/wiki/TheFWA), [Creative Bloq](https://www.creativebloq.com/design/rob-ford-showcasing-best-web-1135853), both **S/U**). **Conclusion: FWA publishes no scoring rubric I can cite. The rubric below therefore does not claim FWA weights.** What we borrow from it is only the stated emphasis on innovation, which CSSDA also names.

##### 1.4 Webby Awards

Six website criteria, all **V** from [Webby judging criteria](https://www.webbyawards.com/about/judging-criteria/):

- **Content**: engaging, relevant, written for the web; "has a voice and a point of view".
- **Structure and Navigation**: organised and prioritised so users can predict where things are.
- **Visual Design**: suits audience and message; improves inclusion for low-vision and cognitive disabilities.
- **Functionality**: loads quickly, links work, works across platforms and browsers, accounts for accessibility and limited bandwidth.
- **Interactivity**: "insists that you participate, not spectate"; passive rollovers count little.
- **Overall Experience**: intangible qualities that make people stay or leave; return visits and sharing as signs.

Process ([Webby judging process](https://www.webbyawards.com/about/judging-process/), **V**): round 1 by Associate Academy members, several per entry; final by Executive Academy members with category expertise; five Nominees per category including one Winner; at most 20 % of entries may be Official Honorees; Jury President breaks ties. **No scoring scale or weights published (U).**

##### 1.5 Standards the juries lean on (these are what make a score checkable)

| Standard | Number we use | Source |
|---|---|---|
| WCAG 1.4.3 text contrast | 4.5:1; large text (18 pt, or 14 pt bold, about 24 px / 18.5 px) 3:1; not rounded, 4.499 fails | [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| WCAG 1.4.11 non-text contrast | 3:1 for control boundaries, state indicators, focus, graphics needed to understand content | [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| WCAG 2.5.8 target size (AA) | at least 24x24 CSS px, with a spacing exception | [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| WCAG 2.5.5 target size (AAA) | 44x44 CSS px | [WCAG 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) |
| WCAG 2.4.13 focus appearance (AAA) | indicator area at least a 2 px perimeter, 3:1 change between focused and unfocused; a solid 2 px outline is the simplest pass | [WCAG 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) |
| WCAG 2.4.11 focus not obscured (AA) | a focused control must not be entirely hidden by author content | [WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |
| WCAG 2.3.3 animation from interactions (AAA) | interaction-triggered motion can be turned off; honouring the OS setting counts; colour, blur and opacity changes are not "motion animation" unless they change size, shape or position | [WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) |
| `prefers-reduced-motion` | remove or replace scaling and panning (vestibular triggers); the MDN example swaps a scale pulse for an opacity dissolve | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) |
| INP | good at or under 200 ms, poor above 500 ms, at the 75th percentile | [web.dev INP](https://web.dev/articles/inp) |
| CLS | good at or under 0.1, poor above 0.25 | [web.dev CLS](https://web.dev/articles/cls) |
| Nielsen's 10 heuristics | status visibility, control and freedom, consistency, error prevention, recognition over recall, minimalist design, error recovery, etc. | [NN/g](https://www.nngroup.com/articles/ten-usability-heuristics/) |
| Windows motion | fast in 167/250/333 ms with cubic-bezier(0,0,0,1); direct exit 167 ms and always with a fade; "bare minimum" opacity-only 83 ms linear; "avoid custom animations where possible" | [Microsoft Learn: Motion in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/motion) |
| Apple HIG motion | purposeful, optional, crossfade as the reduce-motion substitute, interruptible. **The page body did not load for my fetcher; this line is from the tool's general knowledge, not the page. U.** | [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) |
| Material 3 duration tokens | I could not open the official token page; secondary sources give 50 ms to 1000 ms and a standard curve of (0.2, 0, 0, 1) but disagree on "emphasized". Not used. U | [m3 page](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) |

---

#### Part 2. What does not transfer to a local app, and what replaces it

| Award criterion | Applies? | Replacement in our rubric |
|---|---|---|
| Semantics/SEO (title, meta, sitemap, schema, friendly URLs) | **SEO no, semantics yes.** There is no crawler. | Semantic structure for the accessibility tree: landmarks, one h1 per view, real buttons and lists, accessible names, window title that names the current view. Judged with the axe-core run and a screen-reader pass (spec section 14.6 lists Narrator and NVDA). |
| Markup/Meta-data | Partly | Markup hygiene (no div buttons, valid ARIA, no duplicate ids) and app metadata: window title, app icon, theme colour of the title bar, `color-scheme` set. |
| WPO (web performance optimisation: network, caching, image weight) | Network parts no; budgets yes | Performance feel: the spec section 14.1 budgets (idle CPU, INP at most 200 ms, route transition at most 200 ms, entry chunk growth at most 10 %, fonts at most 150 KB, no raster over 200 KB). A localhost app has no first-load network cost, so LCP is scored only as "first meaningful paint of the section after click". |
| Responsive Design | Yes, narrowed | Fixed target viewports: 1366x768 (primary), 1366x720, 1280x720, 1280x680, 390 px phone page, 200 % root font size. |
| Cross-browser / legacy browsers | No: one engine, WebView2 (Chromium) | Replaced by "runs in the real WebView2 window", plus forced-colours and Windows contrast themes. |
| Mobile Excellence track | Only for the 390 px phone page | Same hit-area and reflow checks on that page. |
| User votes / People's Voice / public awards | No audience | Replaced by one scripted first-run task test (spec V01, pass line 10 s to the first valuable action). |
| Webby "Interactivity: participate, not spectate" | Yes | Scored under Usability and Creativity as "does the screen respond to real input and real data". |
| Webby "Content: takes a stand, has a voice" | Yes | Copy quality; for JARVIS this includes the playful-butler persona, for Well Wisher the no-coercion copy rules in the spec (sections 2.4, 2.5). |

Two additions no award has, forced by this product's own rules (spec section 0.2 items 3 and 4): **Honesty of state** (every number carries one of LIVE, WAITING, SIMULATED, PLANNED, FAULT by shape plus text; simulated is never shown as measured) and **Signals only** (no camera, ever). These are scored as hard gates, not as points.

---

#### Part 3. The JURY RUBRIC

##### 3.1 How a review runs

Reviewer inputs, per section (JARVIS: Core, Room, Senses, Memory, Console; Well Wisher: Day, Focus, Study, Tree, Career) and per view:

1. Screenshots at **1366x768** and **390 px** (phone page where a view has one), light and dark theme, plus 1366x768 with `forced-colors: active` and with `prefers-reduced-motion: reduce`.
2. A **60-second interaction script** (the same for every reviewer): open the section from cold; Tab through every control once; trigger the primary action; trigger one error (for example, a backend call with the service off); open the empty state with a scratch data dir; press Ctrl+1..5 and Esc; toggle reduced motion; scroll or resize to 1280x680.
3. The automated outputs that already exist in the spec: axe-core per route, token contrast test, `no-scroll`, `hit-areas`, `reflow`, `motion-route`, `budget-idle`.

Scoring: each check is scored **1 to 10 integers**. A criterion score is the **mean of its checks, rounded to one decimal**. Two reviewers score independently; if they differ by more than 1.5 on a criterion, a third scores and the middle value is taken (the same idea as Awwwards' trimming of the 3 furthest scores, [V](https://www.awwwards.com/about-evaluation/), scaled down for a team of 2 to 3).

Weights **[OURS, mapped from Awwwards 40/30/20/10, then split]**:

| Axis | Weight | Criteria inside it |
|---|---|---|
| Design | 40 % | D1 layout rhythm and grid 8; D2 typography 8; D3 colour 6; D4 depth and material 6; D5 art direction 6; D6 motion purpose and timing 6 (shares of the 40, in points) |
| Usability | 30 % | U1 state clarity 7; U2 empty and error states 5; U3 keyboard path 5; U4 focus and contrast 5; U5 hit areas and reflow 4; U6 performance feel 4 |
| Creativity | 20 % | C1 originality of art direction 10; C2 signature moment (one per section) 6; C3 earned interactivity 4 |
| Content | 10 % | T1 copy quality 6; T2 honesty of data and labels 4 |

(Points inside an axis are shares of that axis' weight; the axis score is the weighted mean of its criteria. Total = 0.4 Design + 0.3 Usability + 0.2 Creativity + 0.1 Content.)

Developer-style axis, scored separately and **not mixed into the total** (the Awwwards Developer Award is also separate, [V](https://www.awwwards.com/about-evaluation/)): X1 semantics and markup, X2 motion implementation and reduced motion, X3 accessibility conformance, X4 performance budgets, X5 responsive and forced-colours. Pass line 7.0, matching the Developer Award's "above 7" [V].

##### 3.2 Pass lines [OURS]

Stated plainly so nobody argues afterwards:

- **A section passes** when its **weighted total is 8.0 or higher** AND **no criterion is below 7.0** AND **no hard gate fails** AND the developer-style axis is **above 7.0**.
- Why 8.0: CSSDA's Website of the Day line is an average above 8.00 [V](https://www.cssdesignawards.com/about); Awwwards' Honorable Mention line is 6.5 [V](https://www.awwwards.com/about-evaluation/) and its Site of the Day has no published number [V], so 8.0 is the stricter public figure we can cite. I could not verify what scores Site-of-the-Day winners usually receive on Awwwards [U]; do not claim "Awwwards-winning" from this rubric, claim "scored at the CSSDA WOTD line by our own reviewers".
- **Hard gates (any fail = section fails regardless of score):**
  1. Any text under 4.5:1 or control boundary / focus under 3:1 in either theme (WCAG 1.4.3, 1.4.11).
  2. A control unreachable or invisible-focused by keyboard (WCAG 2.4.7 family, 2.4.11).
  3. A number, level or status shown without a lamp state, or simulated data presented as measured.
  4. Animation still running with reduced motion emulated (`document.getAnimations()` not empty after 1 s).
  5. Any camera element or camera copy.
  6. Horizontal scroll or clipped primary control at 1366x768 (and at 1366x720 where a view declared a T720 column).
- **Whole product** ships only if every section passes. A section at 7.0 to 7.9 is "not yet" and gets a fix list, not a waiver.
- **Anti-inflation rule:** a reviewer may give 9 or 10 only with an evidence line (see 3.4). No evidence, score capped at 7.
- Review frequency **[OURS]**: automated rows on every merge; scored review of a section when its package merges; full-product scored review before each release and after any change to the shared layers (tokens, kit, shell).

##### 3.3 Criteria, checks, and 9 versus 6

Each check is observable from the screenshots, the script, or a named automated output.

###### D1 Layout rhythm and grid (Design)
Checks: (a) one spacing scale, every gap is a token multiple (inspect computed padding, no stray 13 px values); (b) edges align across cards in a row and across sections (draw a line on the screenshot); (c) clear reading order: one primary region, one secondary, nothing competing at equal weight; (d) negative space is used deliberately, groups are separated by space before lines; (e) at 1366x768 no scroll for the view and the primary action sits above the fold; (f) the 390 px layout is re-composed, not shrunk; (g) density matches the product (JARVIS compact, Well Wisher calmer); (h) alignment of numeric columns (tabular figures).
- **9:** every edge lands on the grid; the eye path is obvious in 2 seconds; the 390 px layout has its own hierarchy.
- **6:** mostly aligned but two or three cards disagree; equal visual weight on three things; 390 px is a squeezed desktop.
- Evidence: annotated screenshot with the misaligned edges drawn, token names found, `no-scroll` result.

###### D2 Typographic hierarchy
Checks: (a) at most 3 families and a stated scale, at most 6 distinct sizes visible per view; (b) three levels (title, body, caption) readable by size and weight alone, with the screenshot blurred; (c) body at least 14 px, line length 45 to 75 characters; (d) mono or display faces appear only where the spec assigns them; (e) no faux bold, no fallback flash (fonts local, `font-display: swap`); (f) text survives 200 % root font size without clipping (`text-spacing.spec.ts`); (g) number formatting consistent (units, decimals, tabular); (h) truncation shows full text on focus or hover.
- **9:** blur the screenshot and the hierarchy still reads; one rhythm of sizes; nothing clips at 200 %.
- **6:** hierarchy depends on colour; 8 sizes; one clipped label at 200 %.
- Evidence: list of computed font sizes per view; the 200 % screenshot.

###### D3 Colour discipline
Checks: (a) one accent per product used only for the primary action and live state (accent budget, spec section 1.2); (b) neutrals do the work, colour carries meaning only; (c) both themes and the `more` contrast set pass the token test; (d) no meaning by colour alone (lamp shapes plus text); (e) semantic colours (fault, waiting) are not reused as decoration; (f) the two products read as different brands at a glance; (g) forced-colours view keeps boundaries; (h) charts and art use the same palette tokens.
- **9:** squint test shows exactly one thing in the accent; every pair has a computed ratio on file.
- **6:** accent also used for decoration; one dark-theme pair near 4:1.
- Evidence: token pairs with ratios; the forced-colours screenshot. Contrast formula: [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

###### D4 Depth and material honesty
Checks: (a) elevation steps are few (at most 3) and consistent; (b) a raised thing is a control, a recessed thing is an input or a readout, never the reverse; (c) soft shadows never replace the real 3:1 edge (spec D11: the neumorphic recipe is only 1.27:1 and 1.72:1); (d) no `backdrop-filter`, no blur on animating layers (css-lint); (e) disabled looks disabled without becoming illegible; (f) pressed state visibly moves or inverts; (g) dark theme has its own depth (not an inverted light shadow); (h) one material metaphor per product.
- **9:** you can name which pieces are buttons from a thumbnail; every raised element has an edge or icon that passes 3:1.
- **6:** pretty depth but two controls are findable only by shadow.
- Evidence: contrast of control edge versus adjacent ground ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)); css-lint output.

###### D5 Art direction and craft
Checks: (a) one centrepiece per section, derived from real counts (spec section 8: art is a pure function of data); (b) every moving piece has a static and a reduced-motion form carrying the same information; (c) no pasted reference pictures, no refused ids (A.Q01 check); (d) icon set is one family, one stroke weight; (e) illustration style consistent across sections; (f) assets sized to display size at 2x and within the per-section budget; (g) nothing decorative that does not clarify purpose (the review of 2026-11-12 removed scanlines and sigils on this ground); (h) the voice hill is a reading or a hollow placeholder (spec D23).
- **9:** art teaches the data; remove it and the screen gets harder to read.
- **6:** attractive but decorative; one icon off-family.
- Evidence: the section's art row from spec section 8.1 and the asset size list.

###### D6 Motion purpose and timing (also X2)
Checks: (a) every animation answers "what changed or where did it go?"; (b) route change at most 200 ms (+50 ms) per spec 14.1; micro-feedback 83 to 167 ms, entrances 167 to 333 ms, in line with [Windows motion](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/motion); (c) exits shorter than entrances and combined with a fade (same source); (d) animate only transform and opacity, nothing that triggers layout; (e) interruptible, never blocks input (HIG principle, **U**: page not loaded); (f) one easing family; (g) no infinite loops except real ongoing status, and none when hidden (spec 14.1 hidden row); (h) reduced motion replaces travel with opacity ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)).
- **9:** frame-by-frame capture shows meaning in every motion; timings on a short list; reduced-motion pass is calm and complete.
- **6:** good easing but two decorative loops; route change 350 ms; reduced mode only slows things down.
- Evidence: `motion-route` timing, a list of running animations from `document.getAnimations()` in both modes.

###### U1 State clarity (Usability)
Checks: (a) the five states (rest, hover, focus, pressed, disabled) differ visibly on every control kind; (b) selection and current location are visible without colour (shape, weight, marker); (c) loading shows within 100 ms of a click for anything over 300 ms, with a skeleton that matches the final layout (CLS at most 0.1, [web.dev](https://web.dev/articles/cls)); (d) success is confirmed once, calmly; (e) lamp state present on every reading; (f) destructive actions say what is lost and offer undo ([NN/g](https://www.nngroup.com/articles/ten-usability-heuristics/) heuristics 3, 5); (g) the app always says where you are (rail, title bar, window title); (h) background work is visible (a resume pill, not silence).
- **9:** during the whole script you never wonder whether something happened.
- **6:** most states clear; selection by colour only; one spinner with no text.
- Evidence: a state matrix screenshot per control kind; time from click to feedback.

###### U2 Empty and error states
Checks: (a) every list, chart and sensor view has an empty state that says what will appear, why it is empty and the one action; (b) error text names the problem in plain language and a fix ([NN/g heuristic 9](https://www.nngroup.com/articles/ten-usability-heuristics/)); (c) backend offline: the UI shows a FAULT or WAITING lamp and keeps working where it can; (d) no raw stack trace, no "undefined", no empty chart frame; (e) first-run is one screen, no picker (spec 4.2.5); (f) stale-record rule shows age; (g) retry exists and does not lose input; (h) empty state keeps the layout (no jump when data arrives).
- **9:** the scratch-data-dir first run feels designed, not broken; killing the backend gives a calm, accurate screen.
- **6:** empty state is a blank card; errors say "Something went wrong".
- Evidence: screenshots with a scratch `JARVIS_DATA_DIR`; one forced error.

###### U3 Keyboard path
Checks: (a) Tab order follows reading order; (b) every action reachable and operable with keys, no traps; (c) Ctrl+1 to Ctrl+5, Alt+0, Alt+Left, Ctrl+Shift+Space as specified; (d) a command palette or search reaches any view in at most 3 keystrokes; (e) Esc closes the topmost layer and returns focus to its opener; (f) shortcuts shown in tooltips and a help sheet; (g) no shortcut collides with WebView2 or Windows defaults; (h) skip-to-content exists in each product.
- **9:** whole script done without touching the mouse, nothing surprising.
- **6:** reachable but focus is lost after closing a sheet; two shortcuts undocumented.
- Evidence: Tab-order recording (ordered list of focused element names), `keyboard.spec.ts`.

###### U4 Focus visibility and contrast
Checks: (a) every focusable element shows a 2 px outline, 3:1 change ([2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)); (b) focus never fully hidden by sticky bars ([2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)); (c) ring follows the element's shape and sits outside the neumorphic shadow; (d) text 4.5:1 and large text 3:1 in both themes ([1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)); (e) boundaries and state indicators 3:1 ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)); (f) placeholder and disabled text still readable; (g) forced-colours keeps focus and borders; (h) text over art or gradients measured at the worst pixel.
- **9:** no ratio under target anywhere, focus ring found in under a second on every screenshot.
- **6:** one 4.2:1 caption; ring is accent-on-accent in one place.
- Evidence: axe-core report plus the token pair table.

###### U5 Hit areas and reflow
Checks: (a) primary targets 44x44 CSS px (spec holds 44; [2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) AAA) and nothing under 24x24 without spacing ([2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)); (b) 390 px page has thumb-reachable primary action; (c) no horizontal scroll at 1280x720 and 1280x680; (d) content reflows at 200 % and 400 % zoom (manual WebView2 list, spec 14.6); (e) no overlapped controls at any tested size; (f) drag handles and tiny icon buttons have enlarged hit zones; (g) tooltips do not cover the control they describe; (h) scroll regions are labelled and keyboard-scrollable.
- **9:** `hit-areas` and `reflow` specs green on every view, including the phone page.
- **6:** passes at 24 px but several controls are 28 px and crowded.
- Evidence: `hit-areas.spec.ts`, `reflow.spec.ts` output.

###### U6 Performance feel (also X4)
Checks: (a) click-to-visual-response at most 100 ms, INP at most 200 ms at p95 of scripted interactions ([web.dev](https://web.dev/articles/inp)); (b) route change at most 200 ms with no long task over 50 ms; (c) idle CPU at most 1 % of one core focused and asleep (spec 14.1, a target until R01 records a baseline); (d) hidden: no rAF, no timer under 1 s; (e) entry chunk growth at most 10 % against baseline, lazy sections at most 120 KB gzip; (f) frame time on the live renderer (voice hill, twin) within +15 % of first recorded; (g) no layout shift on data arrival (CLS at most 0.1); (h) heap growth under 10 % in a 30 min soak.
- **9:** every row measured, on file, and inside budget; the app feels instant in the script.
- **6:** subjectively fine but unmeasured, or one route at 350 ms.
- Evidence: the measured numbers. **No evidence = cap at 6**, because spec section 14.1 states every figure is still a target until the real-window session (R01).

###### C1 Originality of art direction (Creativity)
Checks: (a) a stated idea per product that you can say in one sentence ("a place" for JARVIS, "a day" for Well Wisher); (b) every section is recognisably the same hand; (c) avoids the tropes jurors discount ([S](https://www.hontran.dev/blog/awwwards-judging-criteria): cursor blob, default smooth-scroll, boilerplate WebGL plane) and generic dashboard cards; (d) uses a constraint (offline, signals-only, honest lamps) as the source of the look rather than hiding it; (e) the two products differ in silhouette (radii, chrome, tempo); (f) show the thumbnail to someone cold and ask which product it is; (g) one thing you would remember tomorrow; (h) restraint: remove one effect and it gets better, or it does not.
- **9:** a cold viewer names the product and its mood from a thumbnail; the idea is the signals-honesty, not a sticker.
- **6:** polished and competent but could be any dashboard.
- Evidence: the one-sentence idea; two cold-viewer answers.

###### C2 Signature moment
Checks: one per section (not one per page element): (a) it is a response to real data or action; (b) it appears within 1 s of arriving at the section; (c) lasts at most 1.2 s, once; (d) has a still and a reduced-motion equivalent; (e) never repeats on revisit unless data changed; (f) does not delay the first action; (g) matches the section's centrepiece row; (h) survives 390 px.
- **9:** the user smiles and still reaches the button in under 2 s.
- **6:** present but identical to another section's.

###### C3 Earned interactivity
Checks: (a) controls directly manipulate the thing (drag, scrub, tap on the art) where that beats a form; (b) the response is proportionate; (c) no passive hover gimmicks ([Webby: "participate, not spectate"](https://www.webbyawards.com/about/judging-criteria/)); (d) keyboard parity for every direct manipulation; (e) real-time data visibly changes the view; (f) undo exists; (g) no gesture is the only way; (h) interaction teaches itself within one use.
- **9:** a first-time user manipulates the central object without instruction and keyboard users can too.
- **6:** mostly click-and-form with a nice animation.

###### T1 Copy quality (Content)
Checks: (a) labels are verbs for actions, nouns for places; (b) no lorem, no placeholder, no engineer text ("null", "NaN", raw ids); (c) the JARVIS persona (playful butler, spec and owner brief) stays in voice, jokes never block a task; (d) Well Wisher copy has no loss-framed streaks, urgency or nagging (spec 2.4, 2.5); (e) error copy: what, why, fix; (f) numbers have units; (g) sentence case and one terminology list; (h) every string fits at 200 % and in a 390 px column.
- **9:** every line could only belong to this product and helps the user act.
- **6:** correct but generic; two terms for one thing.
- Evidence: a string inventory per section with the bad ones listed. Webby wording to borrow: content "has a voice and a point of view" [V](https://www.webbyawards.com/about/judging-criteria/).

###### T2 Honesty of data and labels
Checks: (a) every reading carries LIVE, WAITING, SIMULATED, PLANNED or FAULT by shape plus text; (b) a unit test fails any widget rendering a number with no state (spec 6.6); (c) planned features are dashed and labelled, built-but-unverified features say "built, not verified"; (d) Wi-Fi sensing language stays physical: one link sees that a body moved, not how it is bent; (e) no camera wording or imagery; (f) "predicting" is used only after the spec's drill-day rule; (g) demo or sandbox data stamped SIMULATED; (h) timestamps and staleness shown.
- **9:** you can tell for every number whether it is real, and the app never overclaims.
- **6:** states exist but one chart is unlabelled simulated data.
- This is also hard gate 3; a fail here fails the section regardless of other scores.

###### X1 to X5 Developer-style axis (scored separately, pass above 7.0)
| ID | Mirrors Awwwards developer category | Checks (observable) |
|---|---|---|
| X1 | Semantics/SEO, Markup/Meta-data | Landmarks (header, nav, main), one h1 per view, headings in order, real `button`/`a`/`ul`, accessible names on icon buttons, no duplicate ids, valid ARIA, `lang` and `color-scheme` set, window title names the view, app icon present. SEO itself is not scored (no crawler). |
| X2 | Animations/Transitions | Compositor-only properties, no `filter` or `backdrop-filter` animation, one `useReducedMotion`, `document.getAnimations()` empty with reduce, no rAF after 1 s with reduce, no loops when hidden. |
| X3 | Accessibility | axe-core zero serious or critical per route, WCAG items in section 1.5 pass, Narrator and NVDA scripts (spec 11.5) complete, text-spacing (1.4.12) and 200 % checks pass. |
| X4 | WPO | The spec 14.1 budgets: entry chunk, per-section chunk, CSS, fonts (at most 3 families, 5 files, 150 KB), images, ASCII files, WebGL contexts, memory soak. |
| X5 | Responsive Design | Six viewports of spec 11.1, `no-scroll`, `reflow`, forced-colours spec, phone page at 390 px. |

##### 3.4 Evidence every score must cite

A score cell is valid only if it has all of these; otherwise it counts as 7 maximum (and 6 for U6 as above):

1. **Where:** `section.view` id (spec 3.2), viewport, theme, motion mode.
2. **What was seen:** a screenshot file name with a drawn annotation, or a recorded script step, or a named automated output (spec 14.3 file).
3. **Which check:** the letter (for example D1-b).
4. **A number where one exists:** px, ms, ratio, count, KB.
5. **A fix when under 8:** one line, with the file or token expected to change.

Template per cell:
`<section.view> | 1366x768 | light | normal | D1-b | 6 | shots/day-focus-1366.png: the Start card edge is 3 px left of the list edge | fix: card uses --space-5 instead of 18px`

Two-reviewer rule: the person who built a section does not score it.

---

#### Part 4. What I could not verify

- Awwwards **Developer Award category weights** and the exact check list: the Google Doc with the guideline did not open (HTTP 400). The six category names come from a search result for an Awwwards results page, not from a page I read in full.
- How Awwwards **combines** the jury scores after trimming the 3 outliers (assumed mean), and the typical Site-of-the-Day score.
- **FWA** criteria and scoring: no first-party text found; their FAQ URL gave 404.
- **CSSDA** definitions of UI, UX, Innovation, the scale and the judge count.
- **Webby** scale, weights and judge counts.
- **Apple HIG motion** wording (page content did not load) and **Material 3** duration tokens (official page did not load).
- Awwwards **Mobile Excellence** guidelines (404).
- The weights inside our axes, the 8.0 pass line, the 1.5-point reviewer gap and the review cadence are **our decisions**, chosen to be at least as strict as the public thresholds above; they are not award rules.
- None of this was run against the app. Spec section 0.4 says its figures are targets until the real-window session R01; the rubric inherits that, which is why U6 is capped at 6 without measurements.

#### Sources (all opened unless marked)

1. Awwwards evaluation: https://www.awwwards.com/about-evaluation/
2. Awwwards Developer Award: https://awwwards.com/developer-award
3. Awwwards Development Award Guidelines listing (doc itself not opened): https://www.awwwards.com/inspiration/development-award-guidelines-doc
4. Awwwards jury: https://www.awwwards.com/jury/
5. CSS Design Awards about: https://www.cssdesignawards.com/about
6. Webby judging criteria: https://www.webbyawards.com/about/judging-criteria/
7. Webby judging process: https://www.webbyawards.com/about/judging-process/
8. FWA about (no criteria): https://www.thefwa.com/about
9. WCAG 1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
10. WCAG 1.4.11: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
11. WCAG 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
12. WCAG 2.5.5: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
13. WCAG 2.4.13: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
14. WCAG 2.4.11: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
15. WCAG 2.3.3: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
16. MDN prefers-reduced-motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
17. web.dev INP: https://web.dev/articles/inp
18. web.dev CLS: https://web.dev/articles/cls
19. NN/g heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
20. Microsoft Learn, Motion in Windows: https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/motion
21. Secondary: https://www.hontran.dev/blog/awwwards-judging-criteria ; https://en.wikipedia.org/wiki/TheFWA ; https://www.creativebloq.com/design/rob-ford-showcasing-best-web-1135853

#### What this changes

- Gives every section one pass line (weighted 8.0, no criterion under 7.0, hard gates, developer axis above 7.0) and one evidence format, so reviews are repeatable and arguable.
- Makes U6 and X4 depend on the measured numbers from work package R01, so "feels fast" cannot be scored above 6 without data.
- Declares SEO, cross-browser and public voting out of scope and names what replaces them.
- Suggested follow-up (not done): copy this file into `docs/research/` as a dated section of a design-standards topic file, and add one line to `docs/research/README.md`, as the project rule requires.

### Strand B: engineering standards checklist

Date: 2026-11-12. Public-safe. Target: `app/ui` (React 19, Vite, Zustand, oxlint, vitest + happy-dom, Playwright), WebView2 host, FastAPI backend.

**Question.** What expert-level, verifiable engineering standards must this UI meet, and which are already enforced here?

**Method.** 30 primary pages fetched; 26 returned content, 4 were blocked or 404 (listed under "Could not verify"). Every numeric claim below is quoted from the fetched page. Anything not from a source is marked ASSUMPTION or REPO.

Status key: **HAVE** exists in the repo, **PARTIAL** exists but narrower than the rule, **MISSING** nothing enforces it.
"Tool" names are what to use; oxlint rule names are from memory of the oxlint rule list and must be confirmed with `npx oxlint --rules` before wiring (not verified here).

#### 0. What the repo has today (read from files, 2026-11-12)

- Lint: **oxlint**, not ESLint (`app/ui/.oxlintrc.json`). Only 3 rules: `react/rules-of-hooks`, `react/only-export-components` (warn), and `no-restricted-imports` seam rules for `pages|galaxy|twin|shared` vs `ww|germoney`.
- `tsconfig.app.json`: `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. No `"strict"` key found in this file (check `tsconfig.json` and the base; if it is absent, `any` and null holes are unchecked).
- `scripts/bundle-budget.mjs`: bans animation libraries, bans katex in the entry chunk, bans webgl under `src/ww`, per-product module lists (ww has no three.js), motion helpers at most 6144 B gzip. **No** per-chunk gzip, CSS size, font count or image checks. `budget-baseline.json` does not exist (spec 14.1 says so too).
- vitest (happy-dom): ~45 files in `src/__tests__`, including `ww/css-lint.test.ts` (no colour or px literals outside token files, `ww/` only), `ww/tokens.test.ts` and `tokens.test.ts` (contrast), `shared/imports.test.ts` (import graph), `ww/spring-curves.test.ts`.
- Playwright: 20 specs in `e2e/` against the sandbox on port 8790 (`global-setup.ts` refuses 8777/8778): `interaction-budget` (motions finish within budget + 50 ms, nothing over 400 ms), `perf-trace` (records p5 fps, asserts no floor), `motion-reduced`, `motion-props`, `hit-areas`, `keyboard`, `themes-visual` and `study-visual` (screenshot snapshots), `clay-forced` (forced colours), `reflow`-like `phone-ww`.
- Not present: `@testing-library/*`, `axe-core`, Stryker, `prettier`/`.editorconfig`, a CI workflow folder, a CSP on the main app. `jarvis_app/server.py` guards `/api` with a Host check plus an `x-jarvis-token` header compared with `hmac.compare_digest`; WebSocket takes the token in `?t=`. CSP exists only on the phone pages (`routes_phone.py`, `routes_phone_ww.py`).
- The token is read from the URL fragment and kept in `sessionStorage` (`src/lib/api.ts`). `innerHTML` appears in `ww/math/MathText.tsx` (`dangerouslySetInnerHTML` with KaTeX output) and in three.js scene files.

#### 1. React performance

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| R1 | Do not use an Effect unless syncing with an external system; compute derived values during render | [react.dev: You might not need an effect](https://react.dev/learn/you-might-not-need-an-effect) | oxlint `react/exhaustive-deps` (dependency correctness only); the "no derived state in Effect" part is review-only | 0 warnings | MISSING (only rules-of-hooks is on) |
| R2 | Event-caused logic goes in handlers, not Effects; reset state with `key`, not an Effect | same page | review + a vitest that renders a component, changes the prop and asserts one render (React Profiler `onRender` count) | render count per interaction <= 1 for leaf widgets (ASSUMPTION) | MISSING |
| R3 | Subscribe to external stores with `useSyncExternalStore` (Zustand does this); never hand-roll subscriptions in an Effect | same page | grep-style vitest: `addEventListener`/`subscribe` inside `useEffect` must have a cleanup | 100 % of Effects that add a listener return a cleanup | MISSING |
| R4 | Fetch Effects ignore stale responses (`ignore` flag or AbortController) | same page | vitest with fake timers: resolve responses out of order, assert last wins | 0 stale writes | MISSING |
| R5 | `memo` only where a component re-renders often with the same props AND is expensive; a new object/array/function prop defeats it; measure in production mode with the React Profiler | [react.dev: memo](https://react.dev/reference/react/memo) | Profiler-based vitest on the 5 hottest components (voice stage, twin HUD, ticker, tree, study paper) counting commits per scripted event | commits per 20 Hz event = 1 or 0 for static siblings (ASSUMPTION) | MISSING |
| R6 | With React Compiler enabled, hand-written `memo` is usually unnecessary | same page | `babel-plugin-react-compiler` in the Vite build + `eslint-plugin-react-compiler` equivalent; decide once | build passes with compiler on | MISSING (decision, not a check) |
| R7 | Selectors must return stable references; a selector that builds a new object re-renders on every store change; use `useShallow` | Zustand docs (page 404 at the URL I tried; rule is from Zustand's own guidance, UNVERIFIED here) | vitest: mount with a selector spy and count renders after an unrelated store write | 0 renders | MISSING |
| R8 | `lazy()` declared at module top level; wrapped in `Suspense` with a fallback; an Error Boundary beside it for failed chunk loads | [react.dev: lazy](https://react.dev/reference/react/lazy) | `pageLoaders.test.ts` exists for routing; add a grep test that `lazy(` never appears inside a function body, and a test that each lazy route has an Error Boundary | 0 violations | PARTIAL (`pageLoaders.test.ts`, `imports.test.ts`) |
| R9 | Virtualise only a long list that measurably janks (the source gives no item count); windowing keeps rendered nodes tied to the window | [web.dev: virtualize long lists](https://web.dev/articles/virtualize-long-lists-react-window) | DOM-node count test per view (see C5) and a rule: any `.map` over a list whose data source can exceed 100 rows is flagged for review (100 is an ASSUMPTION) | see C5 | MISSING |
| R10 | Keep React rendering pure; fix re-render bugs in the component, do not mask with memo | memo page, principles 3 to 5 | `react/rules-of-hooks` (on); React `StrictMode` double-render in dev + vitest `<StrictMode>` smoke for every page | 0 console errors | PARTIAL |

#### 2. CSS performance

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| C1 | Animate only `transform` and `opacity` (the only two the compositor handles alone); width, height, top, left force layout | [web.dev: compositor-only](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count), [web.dev: rendering performance](https://web.dev/articles/rendering-performance), [web.dev: CLS](https://web.dev/articles/cls) | extend `ww/css-lint.test.ts` to all of `src/`: fail on `transition`/`@keyframes` that name any other property. Spec 14.1 already lists the `rise` keyframe still animating `filter` | 0 non-compositor animated properties except the documented paint-only exceptions (colour 100 to 160 ms, `clip-path`, SVG `stroke-dashoffset`; spec 10.1 rule 3) | PARTIAL (ww only) |
| C2 | `will-change` is a last resort, set narrowly, removed after use; a global or large-container `will-change` hurts | [MDN: will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change), compositor page | css-lint: count `will-change` declarations; ban on `*`, `body`, `.main` | at most 8 in the whole CSS (spec 14.1); repo has 1 today (grep, 2026-11-12) | PARTIAL |
| C3 | Layer count: each layer costs memory; keep compositing time near 4 to 5 ms during scroll/transition; inspect layers in the Layers panel (the source gives no max layer count) | compositor page | Playwright CDP `LayerTree.enable` + count layers on route jump; `interaction-budget.spec.ts` already caps layers at 6 or 8 on a jump per its header comment | at most 6 steady, 8 on a jump (REPO, from the spec header) | PARTIAL |
| C4 | `content-visibility: auto` plus `contain-intrinsic-size: auto <guess>` on long off-screen sections; the source measured 232 ms -> 30 ms initial render and says to expect 50 % or more | [web.dev: content-visibility](https://web.dev/articles/content-visibility) | css-lint requires `contain-intrinsic-size` wherever `content-visibility` appears; Playwright trace compares render time before/after on the longest scrolling view | rendering cost down >= 50 % on the long views (source expectation) | MISSING |
| C5 | Keep the DOM small: Lighthouse warns above 800 nodes and fails above 1,400; large DOMs slow style/layout and worsen INP | [web.dev: DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity) | Playwright: `document.querySelectorAll('*').length` per route (elements only, so it under-counts Lighthouse nodes) | warn 800, fail 1,400 (the 3D/SVG art and `.ascii` views may need a named exception) | MISSING |
| C6 | Use `contain: layout`/`paint`/`content` on isolated widgets so changes do not recalc the page; `strict` needs fixed size | [MDN: contain](https://developer.mozilla.org/en-US/docs/Web/CSS/contain) | css-lint: every `.card`, `.panel`, live widget class in an allow-list declares `contain`; Chromium trace `RecalcStyle` element count on one widget update | allow-list is a project decision | MISSING |
| C7 | Selector cost: complex selectors add to every style recalculation, especially when elements are inserted during an interaction | DOM-size page (qualitative). No numeric limit in any source I fetched | css-lint: max descendant-combinator depth 3, no universal `*` descendant selectors (ASSUMPTION thresholds) | depth <= 3 | MISSING |
| C8 | Explicit width/height or aspect-ratio on images and reserved space for late content, and `size-adjust` on fallback fonts, so CLS stays low | CLS page, font page | Playwright `layout-shift` PerformanceObserver over scripted flows | CLS <= 0.1 good, 0.25 poor (source; 75th percentile field figure, so lab use is a proxy) | MISSING |

#### 3. JavaScript complexity and memory hygiene

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| J1 | Break up tasks over 50 ms; yield with `scheduler.yield()` (Chrome 129+, Edge 129+; WebView2 follows Chromium, confirm runtime version on the laptop) with a `setTimeout` fallback; `isInputPending()` is no longer recommended | [web.dev: optimize long tasks](https://web.dev/articles/optimize-long-tasks) | Playwright `PerformanceObserver({type:'longtask'})` on route change, palette open, voice stage 10 s | 0 long tasks > 50 ms on route change or palette open (spec 14.1 INP row) | MISSING (spec proposes it) |
| J2 | Diagnose with Long Animation Frames: a frame is long when the render update is delayed beyond 50 ms; read `blockingDuration` and `scripts[]` for attribution (scripts over 5 ms listed) | [Chrome: long animation frames](https://developer.chrome.com/docs/web-platform/long-animation-frames) | same Playwright harness with `PerformanceObserver({type:'long-animation-frame', buffered:true})`; guard with `supportedEntryTypes` | sum of `blockingDuration` per scripted flow <= 100 ms (the article's example filter, ASSUMPTION as a budget) | MISSING |
| J3 | Hot-path complexity: no O(n^2) inside a per-frame or 20 Hz handler; no layout reads after writes in the same tick (forced reflow) | rendering-performance page (layout cost); the O(n) rule itself is engineering practice, no source gives a number | a vitest micro-bench that runs the handler with n and 4n inputs and asserts time ratio <= 6 (ASSUMPTION: catches quadratic growth); LoAF `forcedStyleAndLayoutDuration` in Playwright | ratio <= 6; forcedStyleAndLayout = 0 on frame loops | MISSING |
| J4 | Every `addEventListener`, timer, observer, rAF and WebSocket created in an Effect is removed in cleanup; prefer `{ signal }` to remove many listeners at once | [React: Effects cleanup](https://react.dev/learn/you-might-not-need-an-effect) (fetch cleanup); MDN addEventListener page was blocked, `signal` option UNVERIFIED here | the spec's `__loops` loop registry (spec 14.3) + a Playwright test: mount, leave route, assert registry empty | 0 live loops/listeners after leaving a view | MISSING (registry proposed, not built) |
| J5 | Detect leaks with forced GC then compare the JS heap; look for detached DOM trees in heap snapshots; watch the node and listener counters | [Chrome DevTools: memory problems](https://developer.chrome.com/docs/devtools/memory-problems) | `e2e/soak.spec.ts` via CDP `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`; `Memory.getDOMCounters` for nodes and listeners | heap growth < 10 % over 30 min (spec 14.1; the Chrome page gives no number) | MISSING |
| J6 | Caches are bounded (LRU with a max size or TTL); no unbounded `Map`/array growing from the event bus | engineering practice; no primary source fetched gives a number | vitest per cache: push 10x capacity, assert size <= capacity; grep test listing every module-level `new Map()`/`[]` that is written to at runtime, each needing a `// bounded by` comment | size <= declared max | MISSING |
| J7 | No `eval`, `new Function`, string `setTimeout` | [OWASP DOM XSS](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html), [Google TS guide](https://google.github.io/styleguide/tsguide.html) (bans `eval`, `debugger`, `with`) | oxlint `no-eval`, `no-implied-eval`, `no-new-func`, `no-debugger` (names to confirm) | 0 | MISSING |

#### 4. Measurable budgets

| # | Metric | Number the source gives | Source | How checked here | Status |
|---|---|---|---|---|---|
| B1 | INP | good <= 200 ms, needs improvement 200 to 500, poor > 500; field p75; clicks, taps and key presses count (hover and scroll do not) | [web.dev: INP](https://web.dev/articles/inp) | Playwright `event` PerformanceObserver on scripted flows; lab p95 <= 200 ms (spec 14.1). Field p75 cannot be measured in a local app | MISSING (spec proposes it) |
| B2 | Long task | > 50 ms | [web.dev: optimize long tasks](https://web.dev/articles/optimize-long-tasks) | see J1 | MISSING |
| B3 | Frame time | 16.66 ms per frame at 60 fps; about 10 ms of your own work after browser overhead | [web.dev: rendering performance](https://web.dev/articles/rendering-performance) | CDP `Performance.getMetrics` (ScriptDuration, LayoutDuration, RecalcStyleDuration) over a scripted 10 s; `perf-trace.spec.ts` measures p5 fps but asserts no floor (headless Chromium rasterises in software, so absolute numbers need the real window) | PARTIAL |
| B4 | Compositing | about 4 to 5 ms during scroll/transition | compositor page | DevTools trace, real window only | MISSING |
| B5 | CLS | good <= 0.1, poor > 0.25 | [web.dev: CLS](https://web.dev/articles/cls) | `layout-shift` observer | MISSING |
| B6 | DOM size | 800 warn, 1,400 fail (Lighthouse) | DOM-size page | see C5 | MISSING |
| B7 | JS per route | 170 KB compressed critical-path is the source's default baseline for slow-3G mobile; this is a web-delivery number and NOT binding for a local WebView2 app. The spec's own limits are the working budget: entry grows at most 10 % vs recorded baseline (90.3 KB gzip today), lazy section <= 120 KB gzip, Senses twin chunk <= 190 KB gzip | [web.dev: performance budgets 101](https://web.dev/articles/performance-budgets-101) for method (quantity + milestone + rule-based, enforce in the build); numbers from spec 14.1 | extend `bundle-budget.mjs`: gzip each emitted chunk, compare to `budget-baseline.json` | MISSING (script has no per-chunk gzip) |
| B8 | CSS per route | none in sources. Spec: shared at most 30 KB gzip, each section at most 12 KB gzip, lazy (ASSUMPTION in the spec) | spec 14.1 | same script | MISSING |
| B9 | Fonts | WOFF2 only (about 30 % smaller than WOFF); subset with `unicode-range`; a variable font replaces several statics but is bigger than one static; `font-display: swap` gives 0 ms block, `optional` is best for performance; fewer fonts is best. No byte budget in the source. Spec: <= 3 families, <= 5 woff2, <= 150 KB total (today 17 files, 353 KB) | [web.dev: font best practices](https://web.dev/articles/font-best-practices) | script scans built CSS `@font-face` for format, `font-display`, count, and sums file sizes in `dist-e2e` | MISSING |
| B10 | Images | no source number fetched; spec: no raster > 200 KB on a route, <= 400 KB art per section (ASSUMPTION) | spec 14.1 | script lists assets per route | MISSING |
| B11 | Idle CPU / hidden | spec: <= 1 % of one core over 60 s focused; 0 rAF and no timer < 1 s when hidden (project targets, no external source) | spec 14.1 | CDP `Performance.getMetrics` TaskDuration delta (main thread only) | MISSING |

Rule from the budgets source worth keeping: when a budget is exceeded, optimise, remove, or do not add the feature. Budgets must fail the build, not just warn.

#### 5. Front-end security (token-authenticated local app)

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| S1 | XSS sinks: `innerHTML`, `outerHTML`, `document.write`, `setAttribute('on*')`, string `eval`/timers. Use `textContent` or DOM APIs. If markup must be rendered, sanitise with DOMPurify (a sanitiser filters, it does not sandbox) | [OWASP DOM XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) | oxlint `react/no-danger` (confirm name) with an allow-list of exactly `ww/math/MathText.tsx`; vitest grep for `innerHTML`/`insertAdjacentHTML`/`document.write` in `src` outside an allow-list | allow-list size 1 (+ three.js files if they really assign `innerHTML`; check why they do) | MISSING. `MathText.tsx` renders KaTeX output: KaTeX is the sanitising renderer, so pin `trust:false` (its default) and add a test that `\href{javascript:...}` and `\htmlClass` do not produce a live link or handler (KaTeX option behaviour is from my knowledge, not fetched: UNVERIFIED) |
| S2 | CSP: start from `default-src 'self'; frame-ancestors 'self'; form-action 'self'`, or tighter `default-src 'none'` plus explicit `script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'`; add `object-src 'none'`, `base-uri 'none'`; avoid `unsafe-inline` and `unsafe-eval`; use nonces/hashes with `strict-dynamic` where inline is needed; roll out with `Content-Security-Policy-Report-Only` first; CSP is a second layer after XSS prevention | [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) | pytest on the FastAPI app: `GET /` response header contains the policy; Playwright asserts zero `securitypolicyviolation` events across the e2e suite. For a local app also `connect-src 'self' ws://127.0.0.1:<port>` for the WebSocket (ASSUMPTION: needs testing in WebView2) | header present on the SPA shell; 0 violations | MISSING on the main app (phone pages have one). Vite dev and three.js workers may need `worker-src blob:` and KaTeX/inline styles may need `style-src 'unsafe-inline'`: check, do not assume |
| S3 | Token handling: do not keep session secrets in localStorage (any script can read it; XSS reads and writes it); sessionStorage is the right scope when data need not outlive the tab; treat stored data as untrusted | [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) | vitest grep: no `localStorage.setItem` with a key matching `token|secret|key|pass`; test that after reading `#t=` the fragment is cleared from `location` (`history.replaceState`) | 0 hits | PARTIAL. Token is in sessionStorage (matches the rule). Backend uses `hmac.compare_digest` and a Host allow-list (good). I did not confirm that the fragment is removed from the URL after reading; WebSocket token rides in `?t=` (it can land in logs, so make sure server access logs drop the query) |
| S4 | `postMessage`: pass an explicit target origin, never `"*"`; on receive, check `event.origin` against an exact match (a substring or `indexOf` check is bypassable) and validate `data`; never `eval` or `innerHTML` message data | [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) (MDN postMessage page was blocked, unverified) | grep test: every `postMessage(` has a non-`*` second argument; every `addEventListener('message'` handler's first statement checks `e.origin`/`e.source` | 0 violations | MISSING (no `postMessage` hits in `src` per grep on `.ts/.tsx`; keep it that way and let the test guard it) |
| S5 | WebView2: treat all web content as insecure; check `Source` before posting messages; validate web messages; prefer `PostWebMessageAsJson`; set `AreHostObjectsAllowed=false`, `IsWebMessageEnabled=false`, `AreDefaultScriptDialogsEnabled=false` when not needed; block unexpected navigation in `NavigationStarting`; run the host at standard integrity | [Microsoft Learn: WebView2 security](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security) | manual checklist item (host is `JARVIS.pyw`; spec 14.6 is the manual list); a pytest on the host settings if the host exposes them | each setting explicit | MISSING (not inspected here; owner's OK needed to touch the host) |
| S6 | Iframes of untrusted content get `sandbox` | OWASP HTML5 page | grep for `<iframe` | 0 without `sandbox` | MISSING (none expected) |
| S7 | Dependency risk: install with `npm ci` (lockfile mismatch aborts), run SCA in CI, `ignore-scripts=true` with an allow-list, do not upgrade the hour a version appears, verify provenance, generate an SBOM | [OWASP NPM Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html) (the page does not name `npm audit`; running it is common practice) | `npm ci --ignore-scripts && npm audit --omit=dev --audit-level=high` in a script; fail on high | 0 high/critical in prod deps | MISSING (no CI folder found) |
| S8 | Anything from the backend (AI replies, file names, transcripts) is untrusted text: render as React text children, never as HTML | OWASP DOM XSS page + React's default escaping | S1 grep catches the exception sites | see S1 | PARTIAL |

#### 6. Testing standards

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| T1 | Pyramid/trophy: many fast unit and component tests, fewer e2e (critical journeys, defect-prone areas); static analysis is the base of the trophy; a small visual layer fits small projects | [web.dev: testing strategies](https://web.dev/articles/ta-strategies) | count by layer in a script: vitest files vs Playwright specs (today about 45 vs 20, so the shape is already base-heavy) | e2e share <= 35 % of test files (ASSUMPTION) | HAVE (shape), no gate |
| T2 | A good component test resembles real use: query by role/label/text first, assert user-visible output, do not poke component instances or internals | [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/) (the query-priority page was blocked; "getByRole first" is from Playwright's page below and Testing Library's published priority, UNVERIFIED here) | `@testing-library/react` + `eslint-plugin-testing-library` equivalents are not in the repo; add `@testing-library/react` and `@testing-library/user-event`; lint rule ideas: no `container.querySelector` in tests, no `.instance()`, no assertions on class names | 0 class-name or `querySelector` assertions in new tests (ASSUMPTION) | MISSING (the current ww tests use bespoke harnesses; ask the owner before adding the dependency, per the "ask for installs" rule) |
| T3 | E2E tests user-visible behaviour, isolated per test, mocks external services with `page.route`, uses `getByRole` and other user-facing locators, web-first auto-retrying assertions (`await expect(locator).toBeVisible()`), no CSS/XPath chains | [Playwright best practices](https://playwright.dev/docs/best-practices) | `@typescript-eslint/no-floating-promises` equivalent (the page recommends it) + `tsc --noEmit` on `e2e/tsconfig.json` (exists); grep ban on `waitForTimeout` | 0 `waitForTimeout`; 0 floating promises | PARTIAL (e2e tsconfig exists, no lint rule for floating promises: oxlint `typescript/no-floating-promises` needs type-aware mode, unverified) |
| T4 | Flake prevention: retries only as a signal (a test that fails then passes is reported "flaky"); trace on first retry; run the suite on every commit and PR; Linux on CI; consistent OS and browser versions for visual tests | [Playwright retries](https://playwright.dev/docs/test-retries), [best practices](https://playwright.dev/docs/best-practices) | config today: `retries: 0`, `workers: 1`, list reporter. Add `trace: 'on-first-retry'`, nightly `--repeat-each=5` on the budget specs, and treat any "flaky" report as a failure. (`failOnFlakyTests` and `--repeat-each` are NOT documented on the retries page I fetched; both exist in Playwright CLI from my knowledge: UNVERIFIED here) | 0 flaky in 5 repeats | MISSING |
| T5 | Visual regression: same environment as baseline, commit the `-snapshots` folder, review diffs, per-platform names (`name-chromium-win32.png`), defaults `threshold: 0.2`, `maxDiffPixels` unset; move the mouse off hover targets with `page.mouse.move(-1, -1)`; hide volatile elements with `stylePath` | [Playwright snapshots](https://playwright.dev/docs/test-snapshots) | `themes-visual.spec.ts`, `study-visual.spec.ts` exist with committed snapshots. Missing: JARVIS sections, forced-colours snapshots, an explicit `maxDiffPixels` (suggest 0 to 50, ASSUMPTION), animation freeze | snapshots for every section x light/dark | PARTIAL (Well Wisher and Study only; masking and animation freezing not covered by the page I fetched) |
| T6 | Mutation testing measures test quality: score = detected / valid; killed = a test failed; survived = a test is missing; no-coverage counts as undetected; timeout counts as detected. Defaults `high 80, low 60, break null` | [Stryker mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/), [Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/) | `@stryker-mutator/core` + vitest runner on pure-logic folders only (`game/`, `ww/math`, `lib/`, store reducers), `--incremental`, `break: 60` | score >= 60 break, >= 80 target | MISSING (not installed; ask owner) |
| T7 | Accessibility is tested, not hoped for: axe per route, contrast over every token pair, 44 px targets, forced colours | spec 14.1 (axe-core named there); WCAG 2.2 in the spec | `@axe-core/playwright` per route; `tokens.test.ts` (exists); `hit-areas.spec.ts` (exists); `clay-forced.spec.ts` (exists) | 0 serious/critical axe violations; text 4.5:1, boundaries 3:1 | PARTIAL (axe missing, the rest exist) |
| T8 | Static analysis first: `tsc -b`, oxlint, springs check, bundle check run as one `verify` script | web.dev trophy; repo `ww:verify` script | `npm run ww:verify` exists (tsc, vitest ww, springs, bundle, playwright) | exits 0 | PARTIAL (WW only; no JARVIS equivalent) |

#### 7. Formatting and review conventions

| # | Rule | Source | Automatic check | Threshold | Status |
|---|---|---|---|---|---|
| F1 | Use `const` by default, `let` only when reassigned, never `var`; `===` except `== null`; no `new Array()`/`new Object()`; `for...of` not `for...in`; every `switch` has `default` and no fallthrough; throw only `Error`; no empty `catch` without a comment | [Google TS style guide](https://google.github.io/styleguide/tsguide.html), [Airbnb JS](https://github.com/airbnb/javascript) (`prefer-const`, `no-var`, `no-param-reassign`, `prefer-template`, `array-callback-return` named there) | oxlint `eqeqeq`, `no-var`, `prefer-const`, `no-empty`, `default-case`, `array-callback-return`, `no-fallthrough` (names to confirm); tsconfig already has `noFallthroughCasesInSwitch` | 0 errors | MISSING (3 rules only) |
| F2 | Use `unknown` instead of `any`; avoid `as` and `!` unless the reason is obvious; do not use `@ts-ignore`; `interface` for object shapes; `import type` | Google TS guide | oxlint `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/ban-ts-comment`, `typescript/consistent-type-imports`; tsconfig `strict: true` (not found in `tsconfig.app.json`: verify) | 0 `any` in new code; a ratchet file counting existing ones that may only go down | MISSING |
| F3 | Named exports, not default exports (exception: React `lazy` needs a default export, per the React page) | Google TS guide vs React lazy page: the two conflict for lazy routes | oxlint `import/no-default-export` with an override for `pages/**` | allow-list = lazy route modules | MISSING |
| F4 | Functions small (Google: consider splitting over about 40 lines); descriptive names; `UpperCamelCase` types, `lowerCamelCase` values, `CONSTANT_CASE` module constants | Google TS guide | oxlint `max-lines-per-function` (warn at 80, ASSUMPTION: 40 is too tight for JSX components), `max-lines` 400 per file | warn only | MISSING |
| F5 | One formatter, run in CI, so review never argues about whitespace | Airbnb/Google guides assume it; no tool named by them | `prettier --check` (or `oxfmt` if adopted) + `.editorconfig` | 0 diffs | MISSING (ask owner for the install) |
| F6 | Project conventions already binding here: comments explain WHY with the numbers that decided it; commits in first person with the measurement; tests against scratch data dirs | repo `CLAUDE.md` | review only | n/a | HAVE (convention) |

#### 8. What to build first (highest value per hour)

1. **Turn on the free rules.** Add to `.oxlintrc.json`: `react/exhaustive-deps`, `react/no-danger` (override for `ww/math/MathText.tsx`), `no-eval`, `no-implied-eval`, `no-new-func`, `eqeqeq`, `no-var`, `prefer-const`, `typescript/no-explicit-any` (warn first), `typescript/ban-ts-comment`, `no-debugger`. Confirm each name with `npx oxlint --rules`; ratchet counts so existing code does not block.
2. **Make `bundle-budget.mjs` a real budget.** Per-chunk gzip against `budget-baseline.json`, CSS sizes, font count/format/`font-display`/total bytes, asset sizes; self-test it. Covers B7 to B10.
3. **One Playwright "vitals" spec.** In one page session collect `longtask`, `long-animation-frame`, `event` (INP proxy), `layout-shift`, `Memory.getDOMCounters`, `document.querySelectorAll('*').length` for each route, and assert J1, J2, B1, B5, C5 thresholds. Run it with `--repeat-each=3` nightly (T4). Headless software rasterisation means frame-time numbers need a real-window session; list that as manual.
4. **CSP on the main app** in report-only mode first (S2), with a Playwright listener for `securitypolicyviolation`. Confirm KaTeX inline styles, three.js workers and the WebSocket origin before enforcing.
5. **Grep-class vitests** (cheap, deterministic): sinks (S1), `postMessage` (S4), token in localStorage (S3), `lazy(` at module level (R8), effects with listeners lack cleanup (R3/J4), `waitForTimeout` in e2e (T3), `will-change` count (C2), extend `css-lint` from `ww/` to `src/` (C1).
6. **Install requests for the owner (rule: ask first):** `@testing-library/react`, `@axe-core/playwright`, `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, `prettier`, and optionally `eslint-plugin-testing-library` (needs ESLint, so likely skip; use review).

#### 9. Could not verify (say so, do not assume)

- Testing Library query-priority page, MDN `postMessage`, MDN `addEventListener`: fetch blocked ("unable to verify domain") or connection reset. Rules S4 and J4 rest on OWASP and React pages instead; the `signal` option and "getByRole first" are from memory.
- Zustand `useShallow` docs: both URLs tried returned 404. Rule R7 is unverified against a primary source.
- Playwright `trace: 'on-first-retry'` appears in the best-practices page; `--repeat-each` and `failOnFlakyTests` did not appear on the retries page I fetched.
- Lighthouse/INP numbers are **field** figures (75th percentile). A local lab test is a proxy; the spec correctly says lab p95.
- 170 KB is a slow-3G web budget from web.dev, not a limit for a local WebView2 app. No primary source gave a number for CSS per route, selector depth, cache size, list-virtualisation item count, or maximum layer count; those thresholds above are marked ASSUMPTION.
- oxlint rule names were not executed against the installed oxlint 1.81; confirm before use.
- I did not open the WebView2 host (`JARVIS.pyw`) or `tsconfig.json`; `strict` and the WebView2 settings are therefore unchecked.
- KaTeX `trust`/`\href` behaviour is from knowledge, not fetched.

#### 10. Sources fetched (26 returned content)

- web.dev: [INP](https://web.dev/articles/inp), [optimize long tasks](https://web.dev/articles/optimize-long-tasks), [compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count), [content-visibility](https://web.dev/articles/content-visibility), [DOM size](https://web.dev/articles/dom-size-and-interactivity), [rendering performance](https://web.dev/articles/rendering-performance), [CLS](https://web.dev/articles/cls), [font best practices](https://web.dev/articles/font-best-practices), [performance budgets 101](https://web.dev/articles/performance-budgets-101), [virtualize lists](https://web.dev/articles/virtualize-long-lists-react-window), [testing strategies](https://web.dev/articles/ta-strategies)
- Chrome: [long animation frames](https://developer.chrome.com/docs/web-platform/long-animation-frames), [DevTools memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- MDN: [contain](https://developer.mozilla.org/en-US/docs/Web/CSS/contain), [will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)
- React: [You might not need an effect](https://react.dev/learn/you-might-not-need-an-effect), [memo](https://react.dev/reference/react/memo), [lazy](https://react.dev/reference/react/lazy)
- OWASP: [DOM XSS](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html), [CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html), [HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html), [NPM Security](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html)
- Microsoft: [WebView2 security](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)
- Style: [Google TS guide](https://google.github.io/styleguide/tsguide.html) (first 100k of 127k chars read), [Airbnb JS](https://github.com/airbnb/javascript) (README excerpt only; the React guide was not read)
- Testing: [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/), [Playwright best practices](https://playwright.dev/docs/best-practices), [Playwright snapshots](https://playwright.dev/docs/test-snapshots), [Playwright retries](https://playwright.dev/docs/test-retries), [Stryker mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/), [Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/)

#### What this changes

Nothing in code yet. It gives the overhaul a checklist whose rows can each become a lint rule, a vitest, a Playwright measurement or a build-script assertion, and shows that today only 3 lint rules, a regex-level bundle check, a WW-only CSS lint, contrast tests, hit-area/keyboard/forced-colour/visual specs and a motion budget exist. The largest gaps are the vitals spec (INP, long tasks, CLS, DOM size, heap), per-chunk/CSS/font budgets, a CSP on the main app, axe, and mutation testing.

### Strand C: licence register

Date: 2026-11-12. Public-safe. This is a licence reading, not legal advice; a qualified reviewer must confirm before any sale (spec section 2.5, Strand 4).

#### Question

For the JARVIS and Well Wisher stack: what licence covers each component, may it be used commercially, what does it oblige, and what must a separable commercial product do? Second: do the README and in-app strings break the "may not say" rules of spec section 2.5?

#### Method and what was verified

- Primary sources fetched 2026-11-12: upstream LICENSE files (GitHub raw), Hugging Face model-card metadata, creativecommons.org, openfontlicense.org, pymupdf.io.
- Installed packages (versions in `app/ui/package.json`, `requirements/requirements.gpu.txt`) were read from local metadata and `node_modules/*/LICENSE`. That proves the declared licence of the installed copy, not the upstream repo.
- "Verified" = a licence text or declared field was read. "Unverified" = not read; stated why.
- Not verified at all: legal effect of any licence for the owner's situation; transitive dependencies beyond those named; licences of the exact Ollama `qwen3` blob and the CTranslate2 Whisper conversion actually on disk.

#### Headline findings

1. **openWakeWord pretrained models (including `hey_jarvis_v0.1`, which `core/jarvis.py:208` loads) are CC BY-NC-SA 4.0: non-commercial.** The code is Apache-2.0. A paid product must not ship these models. Action: train or source a permissively licensed wake word, or drop wake word from the commercial build.
2. **PyMuPDF (`pymupdf==1.28.0`, study-library PDF text) is AGPL-3.0 or an Artifex commercial licence.** A closed commercial product needs the commercial licence or a replacement. Action: swap for a permissive PDF text extractor, or buy the licence.
3. **Silero VAD is MIT** (LICENSE file read). The README alt text says "CC BY-NC 4.0" while the badge image says MIT, which is the conflict flagged in Strand 5; the LICENSE file governs the repo, and the README does not state a separate model licence. Residual doubt is small; keep the LICENSE text in the notice file and ask the maintainers (issue) if a sale is planned.
4. **LGPL/GPL pieces in the Python stack** (`edge-tts` LGPLv3, `pygame` LGPL, `phonemizer` GPLv3+ and `espeakng-loader` which bundles espeak-ng) need dynamic-linking and replaceability handling. `phonemizer` is GPL: unverified whether the code imports it directly or only `kokoro-onnx` does; if it is linked into a shipped binary, it forces GPL on the combination. Treat as a blocker to resolve before sale.
5. **`edge-tts` calls Microsoft Edge's online read-aloud service.** Its README gives no commercial terms. Unverified whether that use is permitted in a product; assume not until read. It also breaks the "local-first, offline" claim for those voices.
6. Fonts are OFL-1.1 and fine for a commercial app if the notice and licence text ship. A digits-only Doto subset is a Modified Version: allowed, but the licence travels with it.
7. Radix UI primitives and Motion are **not dependencies** in `app/ui/package.json` today (no match). Rows are kept for the spec's planned use; licences verified as MIT.

#### The register

Commercial use = may a closed, paid product ship it. "Notice file" = a THIRD_PARTY_NOTICES entry with copyright line and licence text.

| Component | Licence (exact, as read) | Commercial use | Obligations | Action for a separable commercial product | Source |
|---|---|---|---|---|---|
| Silero VAD (`silero_vad_v6.onnx` in `core/endpoint.py:82`; copy `silero_vad.onnx` inside openwakeword package) | MIT License, "Copyright (c) 2020-present Silero Team". README badge alt text says CC BY-NC 4.0 but badge image says MIT | Yes (LICENSE file). README conflict noted | Keep copyright and licence text; notice file | Ship with notice. Ask maintainers to fix README before sale. Confirm the exact v6 .onnx came from the MIT repo | [LICENSE](https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE), [README](https://github.com/snakers4/silero-vad) |
| openWakeWord code (`openwakeword==0.6.0`) | Apache-2.0 ("All of the code in this repository is licensed under the Apache 2.0 license") | Yes | Licence copy, NOTICE if present, state changes | Ship with notice | [repo](https://github.com/dscripka/openWakeWord) |
| openWakeWord pretrained models (`hey_jarvis_v0.1`, `embedding_model`, `melspectrogram`) | CC BY-NC-SA 4.0 ("licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license"; reason given: training data with unknown or restrictive licences) | **No** (NonCommercial: "primarily intended for commercial advantage or monetary compensation") | Attribution, link, state changes; ShareAlike on adaptations | Do not ship in a paid product. Replace with own-trained model on licensed data, or remove wake word. Flag `jarvis.wake-custom` stays. Maintainer invites an issue for permissive models | [repo](https://github.com/dscripka/openWakeWord), [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| py-fsrs | MIT License, "Copyright (c) 2022 Open Spaced Repetition" | Yes | Notice | Ship with notice (not installed yet; install needs owner OK) | [LICENSE](https://raw.githubusercontent.com/open-spaced-repetition/py-fsrs/main/LICENSE) |
| ts-fsrs | MIT License, "Copyright (c) 2026 Open Spaced Repetition" | Yes | Notice | Ship with notice (not installed) | [LICENSE](https://raw.githubusercontent.com/open-spaced-repetition/ts-fsrs/main/LICENSE) |
| `fsrs-rs` crate | Unverified: not fetched in this run | Unverified | Unverified | Read its LICENSE before use; spec A.R04 names it | none |
| faster-whisper 1.2.1 | MIT License, "Copyright (c) 2023 SYSTRAN" (also installed metadata MIT) | Yes | Notice | Ship with notice | [LICENSE](https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/LICENSE) |
| Whisper code (reference) | MIT License, "Copyright (c) 2022 OpenAI"; the LICENSE text does not mention weights | Yes (code) | Notice | none | [LICENSE](https://raw.githubusercontent.com/openai/whisper/main/LICENSE) |
| Whisper large-v3-turbo weights | Hugging Face metadata "License: mit" for `openai/whisper-large-v3-turbo` | Yes (per metadata) | Notice | The CTranslate2 conversion actually downloaded by faster-whisper is a separate repo: its licence tag is unverified. Check it, or convert from the OpenAI weights | [model card](https://huggingface.co/openai/whisper-large-v3-turbo) |
| Qwen3-4B-Instruct (2507) | Hugging Face metadata "License: apache-2.0" for `Qwen/Qwen3-4B-Instruct-2507` | Yes | Licence copy, notice, state changes | Ship with notice or let user pull it. The Ollama-hosted blob is a separate packaging: unverified. Qwen3 GitHub LICENSE URL returned 404, so only the HF metadata was read | [model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) |
| bge-small-en-v1.5 | MIT; card states "The released models can be used for commercial purposes free of charge." | Yes | Notice | Ship with notice | [model card](https://huggingface.co/BAAI/bge-small-en-v1.5) |
| multilingual-e5-small | Hugging Face metadata "license: mit" per search result; direct card fetch failed (network), LICENSE file not opened | Yes (if MIT holds). **Partly unverified** | Notice | Re-read the card before adopting; only matters if R03 picks it | [search listing](https://huggingface.co/intfloat/multilingual-e5-small) |
| BGE-M3 | Hugging Face metadata "License: mit"; no commercial-use sentence on the page | Yes (per metadata) | Notice | Ship with notice if R03 picks it | [model card](https://huggingface.co/BAAI/bge-m3) |
| Inter (`@fontsource-variable/inter` 5.3.0) | SIL OFL 1.1, "Copyright (c) 2016 The Inter Project Authors"; no Reserved Font Name in upstream LICENSE | Yes (bundling in a sold app allowed; fonts may not be sold alone) | Copyright, licence notice and licence text (OFL FAQ 1.20); derivatives stay OFL | Ship the OFL text and copyright in the notice file | [upstream](https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt), [OFL FAQ](https://openfontlicense.org/ofl-faq/) |
| Geist Mono (`@fontsource-variable/geist-mono`) | SIL OFL 1.1, "Copyright 2024 The Geist Project Authors" (read from the installed package LICENSE; upstream URL guess returned 404) | Yes | As Inter | As Inter | installed `node_modules/@fontsource-variable/geist-mono/LICENSE`, [OFL FAQ](https://openfontlicense.org/ofl-faq/) |
| Doto (`@fontsource-variable/doto`) | SIL OFL 1.1, "Copyright 2024-2024 The Doto Project Authors (https://github.com/oliverlalan/Doto)" (installed package; upstream not opened) | Yes | As Inter. Subsetting to digits is a Modified Version: if any Reserved Font Name is declared, the subset must be renamed (OFL FAQ 3.1, 5.3). Upstream RFN: unverified | Read upstream OFL header before running the subsetter (spec S6); rename the subset if RFN exists | installed package LICENSE, [OFL FAQ](https://openfontlicense.org/ofl-faq/) |
| Anton (`@fontsource/anton`) | OFL-1.1 (package metadata) | Yes | As Inter | Spec drops Anton (D21); remove the dependency and the notice | installed package metadata |
| KaTeX 0.16.21 | The MIT License (MIT), "Copyright (c) 2013-2020 Khan Academy and other contributors" | Yes | Notice | Ship with notice | [LICENSE](https://raw.githubusercontent.com/KaTeX/KaTeX/main/LICENSE) |
| three.js 0.186.1 | The MIT License, "Copyright 2010-2026 three.js authors" | Yes | Notice | Ship with notice | [LICENSE](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE) |
| React / react-dom 19.3.0 | MIT (installed metadata); upstream LICENSE not fetched | Yes | Notice | Ship with notice. Upstream unverified | installed package metadata |
| Radix UI primitives | MIT License, "Copyright (c) 2022 WorkOS". Not in `package.json` | Yes | Notice | Only if adopted | [LICENSE](https://raw.githubusercontent.com/radix-ui/primitives/main/LICENSE) |
| Motion (motion.dev) | The MIT License (MIT), "Copyright (c) 2024 Motion B.V.". Not in `package.json` | Yes | Notice | Only if adopted | [LICENSE](https://raw.githubusercontent.com/motiondivision/motion/main/LICENSE.md) |
| zustand 5.0.15, vite 8.3.4, vitest 5.0.3, happy-dom, oxlint, @vitejs/plugin-react | MIT (installed metadata) | Yes | Notice (zustand ships in the bundle; the rest are dev tools, not distributed) | zustand in notice file | installed metadata |
| lucide-react 1.54.0 | ISC (installed metadata) | Yes | Keep copyright and permission notice | Ship with notice | installed metadata |
| typescript 6.0.3, @playwright/test 1.56.1 | Apache-2.0 (installed metadata) | Yes (dev tools, not distributed) | none when not shipped | none | installed metadata |
| PyMuPDF 1.28.0 | "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License" | AGPL: source of the whole network-facing app must be offered. Commercial: yes, paid | AGPL source disclosure, same-licence for modifications, keep producer metadata | **Blocker for closed product.** Buy the Artifex licence or replace with a permissive extractor | [pymupdf.io/licensing](https://pymupdf.io/licensing/) |
| edge-tts 7.3.1 | LGPLv3 (installed LICENSE: "The MIT license is used for 'src/edge_tts/srt_composer.py' only. All remaining files are licensed under the LGPLv3") | Library yes under LGPL terms. The Microsoft service it calls: unverified | LGPL: keep replaceable, ship licence text | Keep as a separate, user-replaceable package. Read Microsoft's service terms before a paid product; consider dropping | installed LICENSE, [repo](https://github.com/rany2/edge-tts) |
| kokoro-onnx 0.6.1 | MIT ("Copyright (c) 2025 github.com/thewh1teagle"); README: model Apache 2.0 | Yes | Notice | Ship with notice. Voices file licence not stated on the README: unverified | installed LICENSE, [repo](https://github.com/thewh1teagle/kokoro-onnx) |
| Kokoro-82M weights | "License: apache-2.0" (model card) | Yes | Notice | Ship with notice | [model card](https://huggingface.co/hexgrad/Kokoro-82M) |
| phonemizer 3.4.0 / espeakng-loader 0.2.4 | phonemizer: GPLv3+ (installed metadata). espeakng-loader: no licence field; it bundles espeak-ng (GPL-3.0 per upstream, not fetched) | GPL obligations if linked | GPL source and licence for the combination | Find who imports it (kokoro-onnx or our code); if shipped, either isolate as a separate process, replace, or accept GPL. **Unverified path** | installed metadata |
| pygame 2.6.1 | LGPL (installed metadata) | Yes under LGPL | Dynamic linking, licence text | Keep dynamic; ship notice. Or use a permissive playback path | installed metadata |
| openwakeword's torch, onnxruntime | torch BSD-3-Clause; onnxruntime MIT (installed metadata) | Yes | Notice | Ship with notice | installed metadata |
| fastapi, ollama (py), langchain-core, sentence-transformers, indic-transliteration, python-docx, python-pptx | MIT / Apache-2.0 (installed metadata) | Yes | Notice | Notice file | installed metadata |
| pywebview 6.2.1 | BSD 3-Clause (installed metadata) | Yes | Copyright, licence text | Notice. WebView2 runtime is Microsoft's: unverified here | installed metadata |
| lancedb 0.34.0 | Apache Software License (classifier) | Yes | Notice | Notice | installed metadata |
| Remaining pins in `constraints.gpu.txt` (about 90 transitive packages) | Not read | Unverified | Unverified | Generate a licence report (pip-licenses, licence-checker) with the owner's OK to install; this run did not | none |

#### Public-copy check against spec section 2.5

Searched: `README.md`, `app/README.md`, `docs/` (excluding the spec and research files, which quote the rules), `app/ui/src`, `app/ui/index.html`, `app/jarvis_app` (excluding tests). Phrases: ADHD, neurodivergent, clinically/scientifically proven, fixes focus, "streak at risk", "break the chain", "we miss you", EndeavorRx, "screens for", "manage your". Also "streak" generally, because the rules ban streak-loss pressure.

##### Direct hits on the do-not-say list

| File and line | Text (shortened) | Rule | Assessment |
|---|---|---|---|
| `docs/design/clay-overhaul-brief.md:40` | "Built for daily use with ADHD." | "ADHD mode", efficacy-style ADHD claim | Hit if this brief becomes public copy. It is an internal brief; reword to a stated design basis with no outcome promise, or keep it out of public docs |
| `docs/design/clay-overhaul-brief.md:41-42` | "engaging enough that he wants to stay: low attention span, immediate feedback" and "proven, researched engagement tactics" | Retention and "proven" claims; ethical-retention principles (2.4) | Internal wording; do not reuse in README or store text |
| `app/jarvis_app/data/ww_advice.json:72-73` | Advice line citing Barkley's "unifying theory of ADHD" | Product naming ADHD | Not a product claim: it is a sourced line with author, work, year. Spec rule says the wording must be no stronger than the source. Needs a copy-specialist decision; lowest risk if the line never says the app helps ADHD |

##### Streak-loss framing (rule 2.4 and Block C rule 3: "no streak loss")

The code ships a full streak and loss mechanic in the legacy Mission layer (`app/ui/src/germoney/**`, to be removed from Core per the seam cut):

- `app/README.md:28`: "instead of breaking a streak" (README promotes the streak concept; it says the game welcomes you back, which is the allowed tone, but the noun is the banned one).
- `app/ui/src/germoney/game/engine.ts:247-286` (streakInfo, shield burn, "Streak of N broken", Phoenix, `shieldEarned`); `engine.ts:274` event text "Streak of ${before} broken".
- `app/ui/src/germoney/game/store.ts:138` toast "New streak starts today. Phoenix is on..."; `store.ts:270` banner "Streak N".
- `app/ui/src/germoney/game/achievements.ts:31-44` ("Iron Week: A 7-day streak", "Wall Breaker", "Phoenix: Lose a streak, then secure three days straight").
- `app/ui/src/germoney/game/bridge.ts:40,55,162-163` spoken streak lines.
- `app/ui/src/germoney/game/characters.ts:38` "Floor secured. The streak lives."
- `app/ui/src/germoney/pages/Today.tsx:35-52` StreakFlame; `:194` "One small push gets the streak of proof going again"; `:359` "any one rep keeps the streak"; `:564` "{n} day streak"; `:635` "the Floor keeps the streak".
- `app/ui/src/germoney/game/engine.ts:478` "Rest day: the streak is safe." (soft, but still streak framing).
- `app/ui/src/germoney/game/engine.ts:291-296` and `store.ts:309`: randomised chest loot with a streak-scaled bonus: a variable reward, which spec 2.4 and Block C rule 3 list as forbidden.

Totals: 15 non-test source files mention streak (engine.ts 21 occurrences, Today.tsx 9, store.ts 9, game.css 7, achievements.ts 7, bridge.ts 6, Proof.tsx 5).

Clean evidence in the new Well Wisher layer: `app/ui/src/ww/life/ThisWeek.tsx:2` and `app/ui/src/ww/proof/cards.tsx:6` state that no streak is shown. Keep that.

##### No hits

"clinically proven", "scientifically proven", "fixes focus", "don't break the chain", "we miss you", "EndeavorRx", "screens for ADHD", "manage your ADHD": zero matches in public README, docs or in-app strings (the "screens for" and "manage your" matches in `Today.tsx:2`, `Drawer.tsx:101` and `ww_advice.json:2` were false positives: "screen" as UI, "manage your" as prose, checked by reading the line).

##### Not checked

- App-store text (does not exist yet).
- Strings built at runtime from data files beyond the JSON banks grep covered; `germoney/data/bank/*.json` use "habit" and "streak" ("150-problem streak", "Web Security Academy streak" in `skilltree.json:2451,3408`) as goal names: streak as a count of days worked, not a loss threat, but still the banned noun.
- Voice replies assembled by the model at runtime.

#### What this changes

- Two hard blockers for a paid separable product: openWakeWord pretrained models (non-commercial) and PyMuPDF (AGPL).
- Three to resolve: the GPL path through `phonemizer`/espeak-ng, the Microsoft service behind `edge-tts`, and the Whisper conversion and Ollama Qwen blob licences.
- Silero is MIT; keep the LICENSE text and ask upstream to fix the README badge text.
- Fonts are safe with a notice file; Doto subset needs the upstream RFN checked first.
- Copy: the legacy Mission layer still ships the streak, shield and random chest mechanics the spec bans; they belong in the Well Wisher rewrite or removal queue, not in public copy. The ADHD wording sits only in an internal brief and one sourced advice line.

#### Sources

- https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE
- https://github.com/snakers4/silero-vad
- https://github.com/dscripka/openWakeWord
- https://creativecommons.org/licenses/by-nc-sa/4.0/
- https://raw.githubusercontent.com/open-spaced-repetition/py-fsrs/main/LICENSE
- https://raw.githubusercontent.com/open-spaced-repetition/ts-fsrs/main/LICENSE
- https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/LICENSE
- https://raw.githubusercontent.com/openai/whisper/main/LICENSE
- https://huggingface.co/openai/whisper-large-v3-turbo
- https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507
- https://huggingface.co/BAAI/bge-small-en-v1.5
- https://huggingface.co/BAAI/bge-m3
- https://huggingface.co/intfloat/multilingual-e5-small
- https://huggingface.co/hexgrad/Kokoro-82M
- https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt
- https://openfontlicense.org/ofl-faq/
- https://raw.githubusercontent.com/KaTeX/KaTeX/main/LICENSE
- https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE
- https://raw.githubusercontent.com/radix-ui/primitives/main/LICENSE
- https://raw.githubusercontent.com/motiondivision/motion/main/LICENSE.md
- https://pymupdf.io/licensing/
- https://github.com/rany2/edge-tts
- https://github.com/thewh1teagle/kokoro-onnx

## 2026-11-12: wave 2 integrated, and the independent review B01 never had

**Question.** Do the seam cuts (B01) really forbid the couplings they claim to, and do the lamp contract (B04) and the kit (B03b) agree once they sit on one branch?

**Method.** A read-only reviewer audited the merged B01 code (no suite run; oxlint against a scratch config with five deliberately bad files). B04 and B03b were then merged in that order and the full checks run on main.

**Findings and what was changed.**
- **Lint hole (fixed).** `src/shared/**` sat in both `no-restricted-imports` overrides, and the later override replaced the earlier one, so a shared file importing Well Wisher was not flagged in the editor (the vitest import-graph test still caught it). The config now has three overrides, with one for `shared/**` carrying both pattern groups. Probe: a shared file importing `ww/kit/Button` and `pages/Core` gives 2 of 2 errors.
- **Bundle check had no positive control (fixed).** An empty or wrong module list passed (0 forbidden hits in 0 modules). The check now fails unless the build lists at least one module of its own tree; the ww build reports 368 modules, 211 of its own tree.
- **B01 numbers, recorded here because the merge left them only in commit messages.** The jarvis build fell from 454 to 203 modules with no `ww/` or `germoney/` module; the ww build held 352 modules with no page, twin or three.js. A constant exported from `shared/product.ts` did not fold across modules, so the product gates are written in place in `App.tsx` and `pageLoaders.ts`.
- **Two lamps (reconciled).** B03b built a lamp inside the kit because B04 was not merged in its worktree. The kit lamp now takes its states, words and shapes from `shared/lamp/types.ts`; it keeps only its own glyph renderer. B05 should mount one renderer.
- **A reading without a state (fixed).** After the merge B04's source-scan test failed on `ProgressBarProps` (a percent with no state). `ProgressBar` now requires `state`; a percent handed to a WAITING or FAULT bar is not drawn (new test).
- **Left open, by decision.** No screenshot evidence exists that Core looks the same after its mission card was removed (the baseline is local and uncommitted). Portalled dialogs and bursts (z-index 60 to 90) can now cover toasts and the command palette. The import-graph test does not see `import.meta.glob`, `require` or CSS `@import`. The ww-only build still lists JARVIS tabs in the dock. `product-modules.json` (absolute source paths) is emitted into every build, including the local dist. `--hit` (44 px) is not defined in a token file, so the kit uses its fallback. `budget-baseline.json` does not exist yet. The second half of the kit move (Card, Data, Interactive, Placeholders, Reveal) waits for `ww/design/motion` and `useReducedMotion` to move to `shared/`.

**Numbers.** tsc clean; kit and shared tests 140 of 140; full vitest and Playwright counts are in the commit that follows this record.

**What it changed.** B05 (the shell) takes these as inputs: mount the kit and lamp once, move the motion helpers to `shared/`, define `--hit`, restrict `product-modules.json` to product builds, and add a Core screenshot baseline to the repository.

## 2026-11-12: B04 the lamp and the state contract, built

**Question.** Can a reading reach the screen without saying whether it is real? (spec 6.6, decision D12)

**Built (`app/ui/src/shared/lamp/**`, state hooks in `lib/store.ts`).**
- Contract `{state, since, reason}` with five states (LIVE disc, WAITING half disc, SIMULATED diamond, PLANNED dashed ring, FAULT triangle). `readingOf` turns anything unusable into WAITING "no report"; it never produces LIVE. FAULT with no reason says "no reason given".
- `Lamp` (glyph plus word, 12 px views, 16 px title bar), `Reading` (the number is drawn only for LIVE and SIMULATED; WAITING, PLANNED and FAULT draw an em dash even when handed a number; `reading` is a required prop so tsc rejects a call without one), `Annunciators` (Voice, Room link, Senses, Memory; Phone paired, Quiet on; not mounted yet, B05 does that).
- Store: `readings`, `reportCapability(id, partial)` (stamps `since` on a state change, keeps it on a repeat, no new object on an identical report), `useCapability(id)` (stable WAITING default).

**Numbers.** 23 new tests (shared/lamp.test.tsx); whole UI suite 1488 of 1488 (was 1465), `tsc -b` clean. Greyscale check is a markup test: the five glyphs have five distinct SVG signatures and no colour value in any of them (ink is currentColor), so the shape alone tells them apart.

**The lint test.** A source scan over shared/, jarvis/, ww/kit/, components/ and pages/ fails any exported props interface with a number reading (`value`, `level`, `percent`...) and no `state` or `reading` of type LampReading. Two older widgets fail it and are listed as DEBT, each with its retiring package: `Stat` and `Meter` in `ww/kit/Data.tsx` (B03b). The debt list may only shrink: the test fails when an entry is fixed but still listed.

**Not done, and why.** "Every existing reading widget takes a state" is only partly met: B04 owns `shared/lamp/**` and the store hooks, so the Well Wisher kit widgets (`Stat`, `Meter`) and the JARVIS cards that print numbers (components/, pages/) are not edited here; they move to `Reading` in B03b and in the section packages (B06, B11). Nothing reports real states into the store yet, so every lamp reads WAITING "no report" until the shell (B05) wires the sources. The Playwright greyscale screenshot was not run (no mounted page uses the lamp yet; the vitest markup test stands in).

**What it changed.** New shared layer; no existing screen changed (nothing imports the lamp yet).

## 2026-11-12: B03b kit families A and B, first pass

**Question.** Can the 21 components of spec 7.2 and 7.3 land in `shared/kit` without moving a pixel, with the 7.1 state grammar proven by tests?

**Findings.** 21 components added in `app/ui/src/shared/kit/` (Lamp, Switch, Rocker, Key, Knob, TickSlider, Plate, Readout, Numerals, ReadoutLines, TelemetryRail, ProgressBar, Panel, Frame, Console, PaletteView, NotchedToast, RetroDialog, FolderTabs; the Raised Pill is a clay-scoped restyle of the existing primary Button, no new file; Segmented Switch and Folder Tab Bar share the roving-tab pattern). One stylesheet, `clay.css`, with no literal colour and a forced-colours branch for every family. 63 new tests (`__tests__/kit/`): a states test and a keyboard test per component, plus a stylesheet test. Full vitest 1528 of 1528 (was 1465), `tsc -b` clean, `npm run bundle:check` ok (ww build 367 modules; kit not imported by the app, so bundles are unchanged).
S7, half done: 13 files that need nothing from `ww/` (Button, Chip, Field, Segmented, Skeleton, Section, PrimaryOwner, Drawer, Popover, Toast, Layout, overlay, util) moved to `shared/kit` with re-export shims in `ww/kit`, so every ww import and test resolves unchanged.

**Not done, and why.** (1) Card, Data, Interactive, Placeholders, Reveal stay in `ww/kit`: they import `ww/design/motion/*` and `ww/useReducedMotion`, and the seam rule forbids shared code importing `ww/`; those two files must move to `shared/` first (not in this package's file list). (2) The kit's CSS (`ww/kit/*.css`) stays in `ww/kit` for the same reason: its rules mix moved and unmoved components. (3) No forced-colours screenshot: nothing mounts the kit yet, so a Playwright page would need a new file outside this package; the stylesheet test proves the branch exists, not how it renders. (4) `tools/art/check_ids.py` does not exist yet (B05b). (5) Hover, pressed and error visuals are CSS only and unmeasured in a real window.

**What it changed.** Nothing visible; the app imports none of it.

## 2026-11-12: B05b art pipeline, built and measured

**Question.** Can the art pipeline of section 8.5 and 8.6 be built so that (a) the same recipe gives the same bytes, (b) the customer track can never resolve a private-only id, and (c) no private-track picture or derivative can reach a `dist` that leaves the machine, with only PIL and numpy?

**What was built** (`tools/art/**`, `app/ui/src/art/**`): `artlib.py` (pure steps: tone, ASCII with Sobel direction glyphs, Bayer 8x8, Atkinson, marching-squares contour with Ramer-Douglas-Peucker, duotone WebP in linear light, terminal frame, three seeded generators, an L-system, a silhouette IoU guard), `build_art.py` (recipes, manifest, `--check`, `--private`, `--stage-private`), `check_contrast.py`, `check_ids.py`, `count_assets.py`, `check_no_private_in_dist.py`, `assets.py`; in the app a pure resolver (`resolve.ts`), the entry (`index.ts`) and the private-track module (`private.ts`).

**Numbers (measured 12 Nov, Windows, Python 3.11.9, Pillow 12.2.0, numpy 2.4.4).**
- Eight recipes, seven customer files, 34,594 B in all (budget for the set: 60 KB): hill PNG 1,978 B (target 6 KB), island SVG 5,830 B (target 12 KB), grain PNG 1,178 B, branch text 991 B, 404 text 498 B, dither tiles 135 B, paper WebP 23,984 B (target 60 KB). The eighth recipe is private-only: id and hash in the manifest, no file.
- Build time for all seven: 1.29 s (paper 1.11 s, island 0.09 s). The island took 1.65 s before the contour step visited only the cells a line crosses (numpy case table, then loop over `np.nonzero`): 18 times faster, same bytes.
- `build_art.py --check` rebuilds everything and compares sha256 against the manifest: green; two builds are byte-identical (test). Lossy WebP is compared by sha only when the manifest's Pillow and libwebp match, always by size.
- `count_assets.py --verify-spec` over the real assignment JSON: 186 pictures, sections 15, uses 9, tracks 4, meaning 160 decorative and 26 meaningful; **the Counts line equals Appendix C exactly**.
- `check_contrast.py` over all 186 placements against the real clay tokens: 0 failing. Worst cases computed: ink-1 on a white picture under the 72 % `#171717` scrim 5.89:1 (needs 4.5); edge-ui 3.54:1 light and 3.91:1 dark (needs 3.0); ink-3 5.45:1 on clay-light and 6.64:1 on `#171717` (the JSON's own claims, recomputed and equal to two decimals); frame ink-2 6.14:1. 109 placements are not rendered; 37 are atmosphere capped at 15 %.
- `check_ids.py --spec`: the 25 recorded refusals (reference-only with deck use "rejected directions") appear in sections 7 and 8 only where they are named as refused: 0 problems. `check_ids.py` over `app/ui/src`: 0 unknown art ids, 0 catalogue ids in code (comments are provenance and are skipped).
- Tests: 46 pytest (`tools/art/tests`, 39 s), 18 vitest (`src/art/art.test.ts`); whole UI suite 68 files, 1,483 tests green; `tsc -b` clean.

**The check for a private hash in a dist, tried for real.** A throwaway library build (scratch folder, never `app/ui/dist`) of `src/art/index.ts` was made twice. Customer track with a stand-in private file staged in `private-local/`: no private chunk emitted, the string `private-local` appears only in a doc comment, and `check_no_private_in_dist.py` reported 0 leaks. Private track (`VITE_ART_TRACK=private`): the private chunk was emitted and Vite had **inlined the 3,000-byte file as a base64 data URI inside a JS chunk** (assets under 4 KB are inlined), so no file in that dist had the private sha256; the base64 and raw-substring pass caught it. A hash-only check would have missed exactly this. The gate is written in place (`import.meta.env.VITE_ART_TRACK === 'private' ? import('./private')`) because shared/product.ts recorded that a constant exported from another module does not fold; here the fold held (customer build had no `private.ts` chunk).

**Decisions and deviations.**
- The recipe has `track` ("customer" or "private-only") and an optional `private_source` (a catalogue id) so one art id can carry both tracks, as 8.5.1 says the manifest row records `private_source` and `customer_source`. A customer recipe may not take a catalogue source and a private-only recipe may only take one; both are `--check` failures, as is a missing licence line, a missing `own/*.licence`, a public-domain source without its work and record, an orphan file in `generated/`, or a stale manifest.
- Private hashes are kept in the git-ignored `data/design-assets/private/private-hashes.json`, not in the tracked manifest, so no private derivative's hash is committed. The manifest's private part is the id, the catalogue id and the recipe hash.
- Colours come from the real primitives in `primitive-color.css` (not the spec's hex literals): the ochre pair uses `--p-ochre-art` (`#ae6f0c`), because B03 fixed that value; a token change changes the recipe hash and `--check` says so.
- Randomness is an integer hash of (x, y, seed), not numpy's Generator, whose streams are not guaranteed stable between releases.
- `.gitattributes` in `app/ui/src/art` and `tools/art` mark generated files, the manifest, own files and recipes `-text`: with autocrlf on, git would rewrite the text files on checkout and every sha256 would break.
- Text art is loaded with `?raw` and cached as a promise (one fetch per file), not by a separate `fetch`; same effect as 8.5.3 item 4 with one fewer request.
- The customer replacements built here are the ones the spec names as zero-source: the hill (value-noise ridgelines), the memory branch (L-system, 22 degrees, 5 iterations), the island (fractal terrain contour), the grain strip, the dither tile library, the 404 frame and a paper duotone. The sun, trunk, skyline, faceplate and spindle belong to B06b.

**Unverified.** The private track end to end on real pictures (no source file is on this branch by design; tested with a synthetic PNG in a scratch tree). The IoU guard is implemented and tested (`silhouette_iou`) but not yet wired to compare a customer render with its private render, which needs both; the 0.5 threshold is the spec's assumption. Lossy WebP determinism across machines is by size only until the Pillow and libwebp versions are pinned. The hill is a still: the live canvas loop belongs to B06b/B07. The 3:1 and 4.5:1 checks are computed, not seen on a screen. `data/notes/NOW.md` was not edited (it is in the main checkout's private `data/`, which this package may not touch).

**What it changed.** B06b can now name art by id (`artUrl('art.core.hill')`) and swap a source by editing a recipe; A.Q01's refusal check and the contrast gate exist as scripts. Run: `.venv\Scripts\python.exe tools/art/build_art.py --check` and `-m pytest tools/art/tests`; in `app/ui`: `npx vitest run src/art`.

## 2026-11-12: B03c, shared art components of families C and D

**Question.** Can the 17 diagram, ASCII and halftone components of spec 7.4 (22 to 31) and 7.5 (32 to 38) be built so that each one has a data-table equivalent, a static form, required state where it draws a number, no WebGL, no loop over 5 s and no idle cost, and so that every hard cap of the spec is a tested constant?

**Findings.** Built under `app/ui/src/shared/art/` (21 files, 77 KB of source, 9.5 KB of CSS, no import of Well Wisher or JARVIS code). The layout is pure (`geometry.ts`: no DOM, clock or random source), so 43 tests check the caps (24 nodes, 24 ridge rows, 6 callouts, 150 timer dots, 5 columns, 120 stipples, 60 meter dots), that callout plates never overlap and stay in frame, that the quadtree skeleton tiles its grid exactly for 4 seeds and 3 depths, and that a dither plate is a few KB of run-length path (under 20 KB at 64 x 40, under 200 KB at 256 x 256; the spec cap is 200 KB per route). 30 component tests check the hooks (`data-component`, `data-state`), a table beside every picture, shape-not-colour status (five distinct state shapes), roving focus and Enter, Calm, and timers. 29 rule tests read the CSS and sources as text: no colour literal, no px for type or spacing, no duration, no animation, no shadow, every `var(--token)` defined by the clay layers or carrying a fallback, a system-colour rule for every drawn class in forced colours, and no WebGL, canvas, eval, innerHTML, fetch or animation-frame loop in any source. Full suite after the change: 1567 passed of 1567 (70 files), `npx tsc -b` clean.

**Two real defects found by the tests.** (1) A ridge with one or two rows drew above the frame: the rise of a row was 3.2 pitches regardless of the room above its baseline, giving a top y of -645 on a 360 px canvas; the rise is now capped to the baseline minus 4 px. (2) The CSS lint caught a literal `gap: 2px` on the skeleton grid; it is `0.15em`.

**Decisions.** The only motion in the folder is the ASCII sweep: a stepped 100 ms text frame after a 160 ms delay, at most 5 s (50 frames), then it settles on the static frame; it stops on `visibilitychange` and when off screen (IntersectionObserver), and Calm (`data-motion="calm"` or the OS flag) shows the static frame and starts no interval. Everything else is static SVG, so there is no loop to pause. A caller ticks the dot timer once a minute; the component owns no timer. Required `state` on Ring Bars, Ridge, Dot-Matrix Meter, Stipple Ring, Pillars Chart and Dot Timer (spec 7.7 rule 4, extended to the two other components that draw a number); WAITING draws stubs or rings and prints "--". Component 38 is exported as `BlankingPlate` (the work-package list calls it PlannedPlate) so it cannot be confused with B02's minimal `shared/planned/PlannedPlate`, which it reuses for the glyph and extends with the works-today line and the "What is coming" cue; it is one `aria-disabled` control, never `disabled`.

**Built against the spec, not against B04.** The lamp is B04's file and was not in the tree. `state.tsx` holds the five state names, the five shapes (disc, ring, diamond, dashed ring, triangle) and the words as the spec states them, so replacing `StateMark` by the Lamp is one import. The spec's separate Dither derivation script (art pipeline, B05b) is not built here; the plate derives from a closed-form field in `geometry.ts` instead, which needs no build step.

**Not verified.** No Playwright forced-colours screenshot, no 1366 x 768 fit check and no render in a real window: nothing mounts these components yet (a view adopts them in B06 and B06b), so there is no page to screenshot, and the touch-target and focus-ring checks are text checks on the CSS rather than measurements. `bundle:check` was not run because no entry imports the folder, so the shipped bundles cannot have changed. Hit areas are 44 px by a transparent 22 px radius disc, which overlaps neighbours in a 24-node ring at the 520 px frame; the overlap is by design for roving focus but is untested with a pointer.

**What it changed.** Nothing on screen. Views in B06 and B06b can import from `shared/art/index.ts` (the index is in the art folder, not a shared barrel, so it merges clean beside B03b).

## 2026-11-12: B03 tokens layers 1 to 3, built and reviewed

**Question.** Does the additive clay token layer hold its contrast table, forced-colours mapping and "nothing changes on screen" promise?

**Findings.** 190 oracle tests in `tokens.test.ts` read the real clay CSS, apply the cascade, and compute every pair of spec 6.3.3 to 6.3.5 with the WCAG formula; a deliberate drift of one primitive failed 3 tests. `e2e/clay-forced.spec.ts` (4 tests) shows that under `forced-colors: active` roles resolve to system colours; changing `--selected-fill` from `Highlight` to `Canvas` failed 2 of the 4, so the spec has teeth. Reviewer reruns: `npx tsc -b` clean, vitest 65 files and 1413 tests twice, keyboard.spec.ts 13 passed. The clay entry is not imported by the app, so the 43 `e2e:shots` baselines are unchanged by construction.

**Not done.** The font step (Inter, Geist Mono, digits-only Doto subset, at most 150 KB, real size not yet recorded) waits for the owner's font-subsetting tool (X5); Anton stays until B13. V03 visual sign-off is still to follow.

**What it changed.** Nothing on screen; B04, B03b and B05 can now read layers 1 to 3.

## 2026-11-12: research before the overhaul design

**Question.** Before designing a complete JARVIS-level overhaul: what does the product really contain today, which premium products, visual references and open-source projects are worth learning from, what does the evidence say about follow-through for students with ADHD-like attention difficulties, where (if anywhere) a model beats a rule, and what accessibility and performance limits does a local Windows WebView2 app set?

**Method.** Seven strands run on 12 Nov 2026, each written to a file before any design work: a read-only audit of the current code (no app run), and six web-research strands (about 130 sources in total, primary sources preferred, 37 GitHub repositories checked through the GitHub API). Each strand below keeps its own sources, numbers and unverified list.

**What it changed (the decisions the design takes from this research).**
1. **The voice visual must be fed by a new real signal.** Today the UI receives only a mic level (one number, at most about 12.5 Hz, while listening) and a speaking flag. The output PCM already exists in `core/playback.py`; the design adds an output RMS and a coarse band spectrum emitted on the event bus, and the visual shows "no signal" states honestly when neither arrives.
2. **Depth is never the only cue.** The canonical neumorphic recipe computes to 1.27:1 and 1.72:1 against its background; WCAG 1.4.11 ignores soft shadows. Every raised or recessed control gets a real 3:1 edge, an icon or text, and a 2 px focus ring.
3. **Forced colours are a first-class theme.** `forced-colors: active` removes box-shadow, text-shadow and gradients; the app has zero handling today. The design specifies a forced-colours rendering for every component.
4. **No-scroll canvas plus reflow.** The 1366x768 one-canvas rule holds at desktop widths; below about 900 CSS px (or at 200 to 400 % zoom) the canvas collapses to one reflowing column (WCAG 1.4.10).
5. **Ambient art obeys Pause/Stop/Hide.** Anything moving for more than 5 s has a pause control and stops when hidden, minimised or idle.
6. **Models only where they win.** FSRS for spaced review, Silero VAD and a wake-word model for voice, a local 4B model to draft and reword (never to grade), embeddings for memory only after a local Hinglish A/B; rules for proficiency, next action and energy. openWakeWord's pretrained models are CC BY-NC-SA 4.0: fine for the personal app, a blocker for a separable commercial product.
7. **Retention without coercion.** Implementation intentions (small to moderate effect after bias correction) and calm resume-where-you-left-off are the core; no streak resets, no loss framing, no leaderboards, at most three user-set batched check-ins, and no wording that claims to manage, treat or screen for ADHD.
8. **Award sites are taste references, not engineering ones.** 8 of the 12 pilot sites in the owner's library ship Lenis + GSAP (often WebGL) at 74 to 250 KB gzip of first-load JS; only 3 of 8 inspected handle reduced motion; three library links are dead or unsafe (one now redirects to a gambling domain) and must not be linked anywhere.
9. **Build in-house, borrow ideas.** No maintained accessible neumorphic kit exists; Arwes is unmaintained; several attractive repositories are AGPL, GPL, non-commercial or unlicensed. Radix (per component) and in-house Bayer/Atkinson dithering and a short AnalyserNode loop are the safe routes.
10. **Separability needs real cuts.** Core imports Well Wisher stores and App mounts Well Wisher's game layer on every page; the shared primitive file is scoped to Well Wisher only; JARVIS pages all scroll; the dock and the Well Wisher strip are two navigations.

### Strand 0: the current carcass (read-only code audit)

Question: what exists in the JARVIS + Well Wisher UI and backend that a redesign must preserve, change or remove?
Method: read AGENTS.md, NOW.md (sections 2, 4, log), the three design docs, then `app/ui/src`, `app/jarvis_app`, `core/`. Nothing was run, no browser opened, no code edited, `secrets.h` not opened. Paths are relative to `C:/Projects/JARVIS` unless absolute. "UNVERIFIED" marks anything I could not confirm from files alone (no rendering was done, so every pixel/fit claim is from CSS/code or from the repo's own notes).

---------------------------------------------------------------------------
#### 1. The real section/page list today

##### 1.1 Shell and navigation (one dock, one tab store)
- `app/ui/src/App.tsx`: renders `TitleBar`, `Dock`, `<main class="main">` with ONE page, `Ticker`, `Toasts`, `CommandPalette`, plus Well Wisher's `FxLayer`, `GameFx`, `Dialogs` (App imports `./germoney/ui` and `./germoney/game/fx`, so the game layer is mounted on every JARVIS page).
- Tab ids: `app/ui/src/lib/store.ts` (`TABS`, 21 entries, type `Tab`). Active tab persists in `sessionStorage['jarvis.tab']`; `setTab` wraps the change in a View Transition (`lib/motion.tsx switchView`).
- Page loading: `app/ui/src/pageLoaders.ts`. Only Core is in the entry chunk; yaadash, aankhen (three.js), limbs, connect, system and `mission` (Well Wisher) are separate chunks. `prefetchPages()` loads yaadash, limbs, connect, system in idle time after 2.5 s. Aankhen and Mission are deliberately not prefetched (laptop near commit limit, per the file comment).
- Dock (`app/ui/src/components/Shell.tsx` `Dock`): vertical nav, `TABS.filter(dock)` = 14 items: 6 JARVIS (Core 01, Yaadash 02, Aankhen 03, Limbs 04, Connect 05, System 06) then a "well wisher" divider and 8 Well Wisher legacy tabs (Today `mission`, Life `quests`, Career `campaign`, Focus `crucible`, Tree `syllabus`, Log `terminal`, Study `schedule`, Status `status`). Dock width token `--dock: 76px`, title bar 52, ticker 34 (`styles/tokens.css`). Whether 14 items fit at 768 px height: UNVERIFIED (not rendered).
- Keys (`Shell.tsx useHotkeys`): Ctrl/Cmd+K palette; Ctrl+1..6 = `TABS[0..5]` (Core..System); Ctrl+0 = `mission`. Well Wisher Alt+1..6 and Alt+Left/Esc live in `ww/frame/Frame.tsx` (Alt+n: Study 1, Tree 2, Life 3, Career 4, Focus 5, Setup 6, from `ww/frame/workspaces.ts`).
- Command palette (`components/CommandPalette.tsx`): "Go to" for every `TABS` entry with the hint text `Ctrl ${i+1}`. Entries beyond the 6th show a Ctrl-7..21 hint that is not bound to anything (misleading hint, not a crash). Also wake voice/text, Aankhen "Simulate: <scenario>" (labelled simulation), memory search, "ask JARVIS".
- Title bar: wordmark, core state chip (`STATE_LABEL`), Ctrl K search button, VRAM bar (`/api/system`, polled every 2 s by `App.tsx refreshVitals`), clock, pywebview window controls. Ticker: last 14 bus events, `SOURCE_TAG` CORE/EYES/MEM/LIMB/SYS/WISH, sim events marked.
- Page chrome: `.page` is `position:absolute; inset:0; overflow:auto` (`styles/shell.css:95`), so every JARVIS page scrolls. Only `.page.full` (Aankhen) is `overflow:hidden` (`shell.css:96`). `.main` has `view-transition-name: page`.
- No `data-section` on JARVIS page roots, and no `styles/sections/` directory exists (planned in `docs/design/app-ui-overhaul.md` section 4, never built). `data-section="wellwisher"` exists only in Well Wisher (`ww/frame/Frame.tsx:228`, `ww/kit/Drawer|Popover|Toast`).

##### 1.2 JARVIS pages (6)
| id (`Tab`) | Title / reached by | What it does | File |
|---|---|---|---|
| `core` | dock, Ctrl+1, default tab | Wake/sleep JARVIS (voice or text-only), Reactor instrument, conversation with per-turn Good/Wrong/Slow/Misheard flags, "Review for Claude" export, latency strip, mission mini-card, crew roster, media card | `app/ui/src/pages/Core.tsx` (398 lines) |
| `yaadash` | dock, Ctrl+2 | Memory: hybrid search with real excerpts, belief queue ("is this true?"), learned-lately Keep/Wrong, reminders, people closeness, taste trajectory | `pages/Yaadash.tsx` (303) |
| `aankhen` | dock, Ctrl+3 | Wi-Fi CSI spatial twin (three.js), presence core, zones, motion meters, channel dot matrix, prediction bar, teach/train panel, readiness, sim check, "eyes" view | `pages/Aankhen.tsx` (585), `components/EyesView.tsx` (497), `twin/*` |
| `limbs` | dock, Ctrl+4 | WallBox card, one DeviceCard per device, Modes editor, presence-on rule, Phone pairing, board wiring/ports/ESP32 link/firmware | `pages/Limbs.tsx` (258) |
| `connect` | dock, Ctrl+5 | 05.1 Brain and voice, 05.2 Modules, 05.3 Memory exports, 05.4 Phone, 05.5 Detected (five statuses incl. "planned") | `pages/Connect.tsx` (129), `components/ConnectControls.tsx` (374) |
| `system` | dock, Ctrl+6 | Can he hear "Hey Jarvis" now, wake-to-reply timings (median/p90, 7 days), fixes (restart brain, free GPU, steward check), VRAM, replies timed, process log | `pages/System.tsx` (193) |

##### 1.3 Well Wisher: TWO implementations live side by side
`app/ui/src/germoney/MissionRoot.tsx` mounts for every tab in the `mission` group.
- **New frame (default since 10 Nov)**: `ww/frame/flag.ts` (`DEFAULT_ON = MODE !== 'test'`, `localStorage['ww.workspace']`, `#ww=frame|off` fragment). Header strip has "Settings" (old drawer) and "Old layout" buttons (`MissionRoot.tsx` `extras`).
- **Old layout** (reachable by the Old layout button): `germoney/pages/*` (Today, Study, Life, Tree, Focus, Log, Road, Status, Settings drawer, plus Armory, Calibration, Classes, Crucible, Direction, Drill, Exams, Forge, Interrogation, Proof, Schedule, SystemInputs, Trials). Navigation `MissionNav` (`germoney/ui.tsx`), 8 screens. Kept alive because vitest defaults to the old layout.
- Legacy tab id -> workspace map: `ww/frame/workspaces.ts LEGACY` (15 ids). e.g. `schedule`->Study/plan, `syllabus`->Tree, `quests`->Life, `campaign`->Career/pipeline, `trials`->Career/abroad, `armory`->Career/money, `status`+`proof`->Proof panel, `crucible`/`drill`->Focus, `terminal`->Log overlay, `forge`->Life#gym, `interrogation`->Study/library, `calibration`->Setup.
- The six workspaces (new frame): Study (`ww/study/StudyPage.tsx`, views papers/plan/library/dmat), Tree (`ww/tree/TreeWorkspace.tsx`, canvas + Inspector), Life (`ww/life/LifeWorkspace.tsx`, views today/week), Career (`ww/career/CareerPage.tsx`, views pipeline/certs/abroad/money/plan), Focus (`ww/focus/FocusWorkspace.tsx`, crucible/drill), Setup (`ww/setup/SetupPage.tsx`, one of 18 sections at a time via `setup/view.ts`).
- Old dock entries for Well Wisher still exist and route into the new frame by LEGACY mapping; the dock therefore duplicates the frame's own workspace strip (two navigations, flagged in the 9 Nov audit).

##### 1.4 Routes per backend module (decorator count, grep; may undercount dynamically registered ones)
`app/jarvis_app/`: routes_mission 71, server.py 60, routes_phone 23, routes_settings 20, routes_phone_ww 12, routes_security 11, routes_board_ctl 11, routes_aankhen_drill 11, routes_aankhen_train 10, routes_media 9, routes_ww_harvest 7, routes_energy 7, routes_ww_resources 6, routes_reminders 6, routes_limbs 6, routes_library 5, routes_esp32_link 4, routes_crew 4, routes_ww_life 3, routes_ww_dmat 3, routes_galaxy 3, routes_alwayson 3, routes_ww_status 1, routes_ww_knowledge 2, routes_ww_mastery 2, routes_firstlight 2, routes_boards 2. Total about 304 decorators in 27 modules. `server.py` itself holds core/game/memory/aankhen/limbs/connect/system/transcripts/kv/germoney/ws routes (list read from file; `/ws/events` is the one bus websocket). 97 `.py` files in `app/jarvis_app/`.

---------------------------------------------------------------------------
#### 2. What the Well Wisher frame already provides

All under `app/ui/src/ww/`.
- **Frame** (`frame/Frame.tsx`, 18 files): tab strip (`WorkspaceTabs.tsx`), left Today column slot, centre workspace, Proof rail (`ProofRail.tsx`), `BackChip`, `OverlayHost`, density/proof-mode by container width (`density.ts`: Proof pinned from 1500 px, a 56 px rail below that opening a 320 px panel, full sheet below 1000 px), season (auto/exams/normal) from the server's `season` dict, scene memory per workspace (`workspaceMemory.ts`), feature probe (`features.ts`: inert, view transitions, animation-timeline, content-visibility; each has a fallback), theme (`theme.ts`).
- **Left column** (`left/`): L1 Countdown/Horizon, L2 Now/Close the day, L3 Classes today, L4 Counters, L5 Phone pointer. Mounted once, never remounted.
- **Proof rail**: `proof/ProofPanel.tsx`, `cards.tsx` (34 matches of "Card"; the plan says ten cards), no primary action by design.
- **Overlays**: registry `frame/overlayRegistry.ts`, 8 ids: date (O1), phone (O2), reader (O3), record (O4), roadmap (O5), log (O6), confirm (O7), add (O8). Impl: `overlays/{DateSheet,Phone,Reader,Record,Roadmap,LogMinutes,Confirm,AddQuestions}.tsx`; one open at a time. A second Reader/Settings still exist in `germoney/` (`ReaderDrawer`, `SettingsDrawer`) and are mounted next to the frame.
- **Flags**: `ww.workspace` (layout), theme key (`ww/frame/theme.ts`), season mode, `data-motion` ("calm"/"full"), `data-motion-load` (high/low), `ww.*` localStorage in `setup/appearance.ts`.
- **Kit** (`kit/`, 31 exports in `kit/index.ts`): Button, IconButton, Segmented, Chip, Field, Card, CardHead, Reveal, Skeleton, Section/SectionOrder, PrimaryButton/PrimaryOwner (one primary action per page), Drawer, Sheet, Popover, Toast/ToastStack, Meter, Row, Spark, StageStrip, Stat, Banner, EmptyState, Fold, MasterDetail, TapGroup, CursorLabel, HoldButton, PinHeader, CoachMark, ComingCard, LockChip. 44 px hit areas, tested in three themes.
- **Tokens** (`ww/design/`): `base.css`, `component.css`, `motion.css`; themes `ash` (default dark, saffron), `paper` (light), `indigo`, plus `workspace.css` (per-workspace tint). Tier 1 file `styles/design/primitive.css` (11.7 KB) is documented as SHARED, but its selector is `.ww, .ww-portal, html[data-ww]` (verified in file head), so nothing outside Well Wisher reads it. `--ink-3` was raised app-wide in `styles/tokens.css` (0.42 -> 0.56 alpha, 3.77:1 -> 5.8:1).
- **Motion governor** (`ww/design/motion/governor.ts`, 32 lines): `motionLoad({tier, p5, hidden, saver})` returns `high` or `low`; written to `html[data-motion-load]`. `low` when glass tier is `flat`, tab hidden, battery saver, or p5 < 50. `calm` / OS reduced-motion = none. Other motion files: `glide.ts`, `hold.ts`, `reveal.ts`, `transition.ts` (workspace view transition, 160 ms fade fallback), `springMath.ts`, `springs.generated.{css,ts}` (checked by `npm run springs:check`). `ww/design/motion.css` defines the named animations (switch-in/out, arrive, leave, sheet, popover, pop, pin, celebrate).
- **Carcass**: `ww/plannedFeatures.ts` (28 entries, patterns empty/disabled/coming/roadmap, `built` flag, line length 15-140, GROUPS Study/Tree/Life/Career/Proof/Setup/Left column/Phone), `ww/Planned.tsx`, Roadmap overlay, `kit/Placeholders.tsx` (CoachMark, ComingCard, LockChip). Stale test fails if a live control with `data-feature` still has a registry entry.
- **Math**: `ww/math/` (katex lazy loader + fallback). **Spring/tokens/contrast tests**: `tokens.test.ts` recomputes WCAG ratios; `css-lint.test.ts` forbids literal colours/durations.
- **Tests (counts)**: NOW.md 10 Nov records vitest 1223, Playwright 248 passed / 2 skipped, backend 1616, gate ok. Static counts from files today: 41 files in `src/__tests__` (29 in `__tests__/ww`), about 881 `it(`/`test(` lines by grep (undercounts `.each`), Playwright 19+ spec files in `app/ui/e2e/` (hit-areas, keyboard, carcass, interaction-budget, motion-props, motion-reduced, perf-trace, themes-visual, study-*, life, career, tree-focus, overlays, proof, phone-ww, core-shot), 118 `test(` lines; `app/tests/` 82 Python files. Not re-run by me.
- **No-scroll status**: git log `d2ea2e3` says every Well Wisher workspace fits 1366x768 with no page scroll; real-data and WebView2 runs are listed as still open. UNVERIFIED by me.
- **Scripts** (`app/ui/package.json`): `build` (tsc -b && vite build), `bundle:check` (builds to `dist-e2e`, runs `scripts/bundle-budget.mjs`), `springs:check`, `e2e`, `e2e:perf`, `ww:verify`.

---------------------------------------------------------------------------
#### 3. The JARVIS side, page by page

Common: all six pages are dark (`--bg #050506`), cyan/amber/red provenance colours (`styles/tokens.css`, `docs/design/jarvis-app.md` section 1), glass materials (`--glass*`, `backdrop-filter`: 32 declarations across 12 CSS files), Anton headings with chrome text gradient (`PageHeader`), Inter UI, Doto numerals, Geist Mono. Provenance rule: cyan = measured/confirmed, amber = simulated/unconfirmed, red = fault. Data comes from REST polling (`usePoll`) plus the `/ws/events` bus.

##### Core (`pages/Core.tsx`)
- Content: left column SystemsCard (brain/voice/room/eyes rows, polls `/api/memory/stats` 60 s and `/api/aankhen/snapshot` 2 s), MissionCard (reads `germoney/stores/{checklist,player}-store`, button to enter the Crucible), StaffCard (crew, `/api/crew`); centre Reactor canvas, state label, power button, voice/text toggle, boot steps, hint line, Latency, MediaCard; right Conversation with flags and `/api/core/say`.
- Look: the "butler's face", Reactor = `components/Reactor.tsx` (Canvas 2D, 96 outer ticks lit by mic level, grooves ripple while speaking, breathing at idle, stops drawing when offline and idle).
- Honest-state: STATE_LABEL from backend state; "voice on CPU (GPU unavailable)" chip; last_error shown. MediaCard shows the server receipt word-for-word and never says "playing" on its own.
- Loose ends: MissionCard couples Core to Well Wisher stores (separability). `/api/core/speak` is called from Well Wisher pages (`germoney/game/bridge.ts`, `pages/Crucible|Direction|Today`), so the game speaks through JARVIS.

##### Yaadash (`pages/Yaadash.tsx`)
- Content: Search (hybrid recall, real excerpts), BeliefQueue (`/api/memory/questions`, `/api/memory/beliefs/{id}`), LearnedReviewCard, RemindersCard, People (`/api/memory/people`), Taste (`/api/memory/taste`), Stats (`/api/memory/stats`). Palette can seed a search through `store.pendingQuery`.
- Look: same dark glass as Core; no named genre (the overhaul doc says "owner names it").
- Honest: beliefs are amber until answered (inference is not a fact).
- Orphans linked to it: `MemoryGalaxy` (361 lines) is mounted only in `galaxy/demo.tsx`, `GrowthChart` only inside it; `/api/galaxy*` has callers only there. `ReminderAlerts.tsx` (the alerts that pop for due reminders, uses `AudioContext`) has no mount point.

##### Aankhen (`pages/Aankhen.tsx`)
- Content: full-bleed twin (`twin/SpatialTwin.ts`, three.js WebGLRenderer, `BeliefCloud.ts`, `places.ts`, `layers.ts`), HUD cards (source, presence core with 72 ticks, motion + human-band meters, spatial model belief, channel 51-subcarrier dot matrix, sim check), `PredictionBar`, `TeachTrainPanel`, `FirstLight`, `MeasureRoom`, `EyesView` (2D canvas spectrogram/ripples + crew narration), `heatgl.ts` (raw WebGL2 heat layer).
- Honest-state: hub mode badge (`simulation` = "SIMULATION · not measured", amber); presence says "predicting" until the readiness check passes; zones named only when readiness trusts them (`lib/belief.ts shownZones`); no radar, no camera (stated in file header). Simulation can be started from the page and from the palette, always labelled.
- Glass: cards use `lib/liquidGlass.tsx` tiers refract/blur/flat (2 s probe: <50 fps -> blur, <38 -> flat; remembered in `localStorage['jarvis.glassTier.v1']`).
- Loose ends: none orphaned here; `Staff` is shared with Core.

##### Limbs (`pages/Limbs.tsx`)
- Order on page: banner (board link word), `WallBox` (components/WallBox.tsx, 147 lines), DeviceCard grid (bulb/rotor glyph follows the board's report when linked), Modes editor (`/api/limbs/scene/{name}`, `/api/limbs/modes/new`), PresenceRule (`/api/limbs/presence-on`), "Phone pairing & access" (PhoneCard), "The boards": `RelayWiring` (only when not a wall box), BoardPanel, BoardPorts, Esp32LinkCard, FirmwareCard.
- Honest: "confirmed by board" cyan only when the board's own report agrees; tiles say "not wired"/"offline"/"not in devices.json" rather than guessing.
- Loose ends (verified in files, 12 Nov):
  - `RelayWiring.tsx` (155 lines) is a full Arduino Uno wiring guide; `pages/Limbs.tsx` header text and line 244 still say Uno; `components/WallBox.tsx:32` has an "Not active: the devices are on the Arduino Uno..." branch; `lib/limbs.ts` has `BoardId = 'uno' | 'esp32'` and `nextUnoPin`; `lib/energy.ts:106`, `pages/Connect.tsx:14` mention Uno. Uno firmware exists under `limbs/` and `app/jarvis_app/uno.py`.
  - `WallBox.tsx:110` still does `rows.filter((r) => r.present)` so absent channels are hidden, though the same file handles `!r.present` as "not in devices.json" (line 113-121, dead branch). The overhaul doc asks for absent relays to show as "unavailable". Latest commit `02ce096` made the box draw 8 channels; the filter remains.
  - `PhoneCard` is mounted in both Limbs and Connect (duplicate).
  - Orphan cards with no mount point anywhere: `AwayModeCard` (331 lines, `/api/security*`, lib/away), `SecurityAlert` (87), `EnergyCard` (224, lib/energy), `LibraryPanel` (291, lib/library), `ReminderAlerts` (110). Their routes (`routes_security.py` 11, `routes_energy.py` 7, `routes_library.py` 5, `routes_reminders.py` partly) are reached only from these unmounted components. `/api/alwayson` has no caller in `app/ui/src` or `phone_page` (`/api/settings/proactive` is called by RemarksCard). `/api/aankhen/firstlight` is called from FirstLight (mounted in Aankhen).
- Git is clean except `.anchor/session-state.md`; the "uncommitted edits from another agent" in the overhaul doc are no longer uncommitted (WallBox/Limbs/board.css were committed in `02ce096`).

##### Connect (`pages/Connect.tsx`)
- Content: header pills (connected/missing/planned counts), 05.1 BrainCard + VoiceCard + PronunciationCard + RemarksCard, 05.2 ModulesSection, 05.3 ExportsSection, 05.4 PhoneCard, 05.5 Detected from `GET /api/connect` (five statuses; `planned` is dashed, no switch).
- Voice test: `lib/settings.ts testVoice` posts `/api/settings/voice/test`; if JARVIS is off, `/api/settings/voice/preview?text=` returns audio and the window plays it with `new Audio(blobUrl)` (settings.ts:90).
- Look: no named genre yet. Connect's own CSS `styles/connect.css` is also imported by System.

##### System (`pages/System.tsx`)
- Content: hearing line, wake->heard->first word->full reply stats from transcripts (median/p90, 7 days), fix buttons (restart brain, free GPU, steward run `/api/crew/steward/run`), VRAM, recent replies, `/api/core/logs?n=200`. Models-on-disk list was removed on purpose (moved to Connect).
- Look: file header comment says "matrix terminal" is the plan; the page itself is the same dark glass (no terminal skin built).

##### Media / Spotify
- Only mount: `MediaCard` inside Core (`components/MediaCard.tsx`); window player `startMediaHost()` in `lib/media.ts` (one `HTMLAudioElement`, created in `App.tsx`, loaded from `/api/media/file/{id}` as a blob). Backend `app/jarvis_app/media.py` + `routes_media.py` (9 routes).
- Spotify: `media.py` header says the Spotify app is only opened on a search (`spotify:search:`), the user clicks; starting a track by name needs Premium plus a registered OAuth app and is out of scope. Media-key control goes through Windows media sessions. Spotify HISTORY import is a planned Well Wisher item (`ww/plannedFeatures.ts` id `music-import`, group Life), not built.

##### Other shared surfaces
- Crew (`components/Staff.tsx`, `lib/crew.ts`, `/api/crew`): shows "staff not running yet" honestly when absent.
- Galaxy: `galaxy/GalaxyScene.ts` (three.js, 556 lines), `bench.ts`, `demo.tsx`; not reachable from the app. `ui/galaxy-demo.html`, `galaxy-bench.html`, `twin-bench.html` are standalone bench pages.

---------------------------------------------------------------------------
#### 4. The voice pipeline as it exists

Process split (`docs/design/jarvis-app.md` section 4): the voice loop is a separate process, `core/jarvis.py --app`, spawned by `app/jarvis_app/core.py`. It owns the microphone, Whisper (CUDA, `core/stt.py`) and audio output. It talks to the app through JSON lines (`core/appio.py emit`) which `core.py` republishes on the bus; the UI gets them over `/ws/events` (`lib/store.ts startEventStream`).

**Input (mic) level: real, scalar, coarse.**
- Source: `core/jarvis.py` lines 610-626 (`record_vad` callback) and 798-806 (`on_block` in the streaming-endpoint path): `level = np.linalg.norm(block) * 10`, emitted at most every 0.08 s (so at most about 12.5 Hz) as `appio.emit("level", level=..., threshold=SILENCE_THRESHOLD)`; the endpoint path also adds `speech_prob`, `vad_threshold`, `speaking`. `core.py:339` republishes it as an ephemeral `core/level` bus event. UI: `lib/store.ts:124` sets `micLevel` and `micThreshold`; `pages/Core.tsx` passes them to `Reactor`.
- Emitted only while the voice loop is in a listening loop (state `listening`/`followup`). Not a spectrum; no frequency data; the scale is unbounded (Reactor draws it log-scaled against the threshold). `speech_prob` from the VAD exists in the endpoint path event but the store ignores it (`store.ts` copies only level and threshold).
- The desktop UI window never opens the mic: no `getUserMedia`, `AudioContext` or `AnalyserNode` anywhere in `app/ui/src` for voice (grep). Only audio-context uses: `components/ReminderAlerts.tsx` (unmounted chime) and `germoney/game/sfx.ts` (synthesised game sound effects).

**Output (JARVIS speaking): no level at all reaches the UI.**
- Live voice: `core/voice.py` makes Edge-TTS mp3 (streamed) or Kokoro (local file). Edge path: `core/playback.py` `AudioPipe` -> PyAV decodes mp3 -> `speaker.write(pcm * gain, rate)` (sounddevice, about 24 ms frames) at `playback.py:228`; `pipe.played_s` counts seconds written. Kokoro/old path: file played by `_play_file` (pygame). Output audio is inside the Python process. The bus only carries `state: speaking` (with text) and `speech_done` (`jarvis.py:448, 468`). The Reactor's "grooves ripple while speaking" is driven by the state flag, not by amplitude (stated in `Reactor.tsx` header).
- The decoded PCM is already in numpy at `playback.py:226-228`, so an honest output RMS/FFT could be computed there (cost: a few microseconds per 24 ms frame) and emitted like `level`. That does not exist today. Must be added in Python (`core/` is outside the UI overhaul's file ownership: UNVERIFIED who owns it).
- Window-played TTS: (a) voice preview, `lib/settings.ts:88-93`, a blob `new Audio(url)` made from `/api/settings/voice/preview` while JARVIS is off; (b) Well Wisher / game nudges call `/api/core/speak` which speaks through the core process (so not in the window); (c) the media player `HTMLAudioElement` in `lib/media.ts`. (a) and (c) are real `HTMLAudioElement`s on blob URLs from the app's own origin, so `AudioContext.createMediaElementSource()` plus an `AnalyserNode` could read true level and spectrum for them (UNVERIFIED in WebView2, never tried; the element must be created with a graph before play and cannot be re-routed afterward).
- Phone: `phone_page/app.js` records with `getUserMedia({audio})` + `MediaRecorder` (opus/webm, 32 kbps, max 45 s), posts to `/api/phone/hear`; speaks replies with `new Audio(blobUrl)` from `/api/phone/speech?text=`. Both are real streams/elements an analyser could read. No analyser exists today.

**What a waveform/"hill" could truthfully show today**
- Input: a one-number level at <= 12.5 Hz (plus VAD speech probability if the store keeps it). A point cloud driven by that would show loudness only, not frequency, and only while listening. Honest and available now.
- Output: nothing real in the window today. Truthful options in order of cost: (1) emit an output RMS (and optionally 16-32 band FFT) from `core/playback.py` and `_play_file` over the existing ephemeral bus path; (2) route window-played audio (voice preview, media) through an AnalyserNode; (3) only the state flag (speaking / not), drawn as an unmistakably non-measured animation. A canned shape while speaking would be a decoration, not a reading (violates the brief's own section 2).
- TTS timing facts for realism: sentence synthesis is streamed (Edge) so first audio is early; Kokoro is one clip per sentence on the CPU. Latencies are recorded per turn (`timing` events: stt, first_audio, speech_to_audio p50/p90).

---------------------------------------------------------------------------
#### 5. Performance facts

- **WebGL**: `twin/SpatialTwin.ts` (three, `WebGLRenderer antialias:true`, pixel ratio capped at 1.75, loop pauses when `document.hidden || this.paused`), `twin/BeliefCloud.ts` (three), `lib/heatgl.ts` (raw WebGL2, no antialias), `galaxy/GalaxyScene.ts` (three, `antialias:false`; unreachable). `ww/` creates no WebGL context (enforced by `scripts/bundle-budget.mjs`).
- **Canvas 2D**: `components/Reactor.tsx` (own rAF, dpr <= 2, idle-stop), `components/EyesView.tsx` (spectrogram + two ripple canvases), `pages/Aankhen.tsx` (two small canvases), `lib/liquidGlass.tsx` (96x96 lens map, once), `germoney/ui.tsx` (image draw).
- **rAF users**: EyesView, MemoryGalaxy, Reactor, galaxy/bench, GalaxyScene, germoney/pages/Tree, lib/liquidGlass (probe), lib/motion (useSpring), SpatialTwin, ww `glide.ts`, `hold.ts`, `kit/Interactive.tsx`, `ww/tree/viewport.ts`.
- **Polling**: global `refreshVitals` every 2 s and `/api/health` ping every 5 s (App.tsx); Core polls aankhen snapshot every 2 s and memory stats every 60 s; MediaCard 5 s; crew 2 s (8 s when absent). Bus is a websocket.
- **Glass / blur**: `lib/liquidGlass.tsx` three tiers with a 2 s probe and a p5-based sampler (`useGlassTierP5`-style options: Well Wisher passes max `blur`, start `flat`, p5 floor 55). Remembered per machine. 32 `backdrop-filter` declarations in 12 CSS files (`aankhen.css` 7, `direction.css` 8, `base.css` 6). Note from the clay brief: soft multi-layer `box-shadow` cost must be measured in the real WebView2 window.
- **Governor levels** (Well Wisher): high, low, none (calm or reduced motion). JARVIS side has no governor: `styles/tokens.css` only zeroes `--t*` under `prefers-reduced-motion`; `lib/motion.tsx` has a resolver hook that Well Wisher fills (`setReducedMotionResolver`).
- **Bundle (dist built 2026-11-10 22:09, from a clean worktree of ff1e480; `dist/` 4.4 MB, 160 files)**: JS total 2,337,477 B across all chunks. Largest: `Aankhen-*.js` 710 KB raw (184.8 KB gzip, three.js), `bank-*.js` 309 KB (question bank data), entry `index-*.js` 284 KB (90.3 KB gzip), `katex-*.js` 264 KB (lazy), `MissionRoot-*.js` 154 KB (46.3 KB gzip), entry CSS `index-*.css` 100.7 KB (24.3 KB gzip), `Study-*.js` 92 KB, `Limbs-*.js` 55 KB, `Frame-*.js` 29 KB + `Frame-*.css` 28.7 KB. Fonts: 17 non-KaTeX woff2 files = 353 KB (Inter latin-ext 85 KB, Inter latin 48 KB, Anton, Geist Mono, Doto...). `vite.config.ts`: `chunkSizeWarningLimit: 900`, no sourcemaps.
- **Budget scripts**: `scripts/bundle-budget.mjs` fails on any animation lib (gsap/framer/lenis/locomotive), katex in the entry chunk, a `getContext('webgl')` under `src/ww`, or motion helper source over 6144 B gzip (an upper bound). It checks nothing about total bundle size, fonts, CSS size or the entry chunk size. No recorded per-section frame-time budget besides Playwright (`e2e/interaction-budget.spec.ts` each motion <= table value + 50 ms and never past 400 ms, <= 12 animations at once; `e2e/perf-trace.spec.ts` records p5 fps but asserts no floor because headless Chromium is software-rastered).
- **Not measured/recorded in files I read**: frame time on the real WebView2 window with the new frame; memory cost of the new frame; first-paint time per section. UNVERIFIED.

---------------------------------------------------------------------------
#### 6. Phone pages (`app/jarvis_app/phone_page/`, served by the phone listener on 8778 via `app/jarvis_app/phone.py`; `PHONE_PATHS` whitelist)
- `index.html` + `app.js` (376 lines) + `relays.js` (122) + `relays.css` (15): the JARVIS phone app. Dark palette defined inline (`--bg #07080b`, cyan/amber/fault). Unpaired view: pairing code + device name -> `/api/phone/pair`. Paired: "Relays only" checkbox, tabs Room / Aankhen / Talk plus a Study link to `/phone/ww`.
  - Room: Modes chips (`/api/phone/scene/{id}`), relay tiles (`/api/phone/limbs/{id}`), power-safe banner (`/api/phone/power/normal`). Relay tiles show only what the board confirms (cyan), amber for asked-not-confirmed, 150 ms settle with last tap wins, 6 s "not confirmed" timeout. Device colours fixed in `relays.js` (light #fff, fan #5ce1ff, light2/3 #ffb347, light4/5 #ff5fa8, ...).
  - Aankhen: a `dl` of source ("the wall box (measured)" vs "<source> (not measured)"), "Predicting" guess, motion, frames, loss; note "Simulated data is never a measurement". No twin, no canvas.
  - Talk: core state pill, wake buttons (`/api/phone/core/start`), turns list, text send (`/api/phone/say`), mic record + send (`/api/phone/hear`), "Speak replies here" (`/api/phone/speech`).
  - Live updates: websocket `/ws/phone`; state snapshot `/api/phone/state`.
- `ww.html` + `ww.js` (323) + `ww.css` (114): Well Wisher on the phone = the left column alone: L1 Countdown, L2 Now (+25/+50/+90 minute taps), L3 Classes today, L4 Counters with Undo, a fold with next-paper topic taps, a line "Desktop only: papers, Tree, Setup (not on the phone yet)". Calls `/api/phone/ww/{today,class,count,topic,minutes}` (routes_phone_ww.py, 12 routes). 44 px taps, geometry mirrored from the desktop kit as plain CSS custom properties.
- `board.html` (171 lines, 8,044 B): source of the wall box's own web page; the build is `python -m jarvis_app.board_page` writing `aankhen/firmware/web_page.h`; test `app/tests/test_board_page.py`.
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png`: PWA install.
- `phone_page/tokens.css` DOES NOT EXIST. The plan to generate shared tokens for the phone (`docs/design/app-ui-overhaul.md` section 5; `ww.css` header lines 19-22) was never built; the phone has three separate inline palettes (index inline `:root`, `ww.css`, `board.html`).
- Phone is dark only, cyan/amber, no clay, no motion governor; `ww.js` reads nothing from `data-motion-load` (the governor header says the phone page "reads data-motion-load the same way" but `ww.css` carries no such rule: UNVERIFIED beyond a grep of the header).

---------------------------------------------------------------------------
#### 7. Preserve / change / faked-simulated-unclear

##### 7.1 Works and must be preserved
- Provenance colour contract (cyan measured, amber simulated, red fault) and device colours (white #e9f3ff light, warm #ffb347, pink #ff5fa8, fan #5aa9e6 per overhaul doc; phone `relays.js` uses #ffffff/#5ce1ff/#ffb347/#ff5fa8: the two files disagree on the white and fan hex, so pick one).
- "Confirmed by board" logic (`lib/limbs.ts`, `relays.js`): tile state from the board's report, never the saved state; 150 ms settle; 6 s unconfirmed.
- Aankhen honesty: "SIMULATION · not measured" badge, "predicting" until readiness passes, zones gated by readiness, no radar/camera, `lib/belief.ts shownZones`.
- Receipts model in MediaCard and the bus `ephemeral` events; ticker with sim marks.
- Page-per-chunk loading and idle prefetch (`pageLoaders.ts`), with the tested order.
- Well Wisher frame invariants: one primary action per page (PrimaryOwner), one overlay deep, Today column never remounts, 44 px hit areas, `plannedFeatures` carcass with stale-entry test, katex lazy, no WebGL under `ww/`, motion governor levels, spring curves checked against closed form, contrast recomputed by `tokens.test.ts`, css-lint (no literal colours/durations in `ww/`).
- Test harness: vitest suites, Playwright specs (hit areas, keyboard, themes screenshots, carcass, interaction budget, phone-ww), gate (`ww_check`), board-page drift test.
- Voice latency instrumentation (`timing` events) and the System page's honest "he did not hear you" views.
- Token/URL security: `lib/api.ts` token from `#t=` fragment, `X-Jarvis-Token` header; media/preview played as blob URLs so the token never sits in a URL.

##### 7.2 Must change (needed for the clay / per-section / no-scroll direction)
- Every JARVIS page scrolls (`.page overflow:auto`); only Aankhen is `full`. The no-scroll rule at 1366x768 needs per-page screen budgets; Core, Limbs (about 10 stacked blocks), Connect (5 groups), Yaadash and System are long.
- No `data-section` on JARVIS roots and no `styles/sections/`; section brands cannot be scoped until the shell sets `data-section`.
- `primitive.css` is not actually shared (scoped to `.ww`), so there is no common token layer for JARVIS pages. `styles/tokens.css` (JARVIS) and `ww/design/themes/*` (WW) are two unrelated systems; neither is clay. Well Wisher is saffron-on-ash dark; JARVIS is cyan-on-black glass.
- Two navigations: the dock lists 8 Well Wisher legacy tabs while the frame has its own 6-workspace strip; the palette shows Ctrl hints for tabs that have none.
- Old Well Wisher layout (`germoney/pages/*`, `MissionNav`, `SettingsDrawer`, `ReaderDrawer`) and the new frame coexist. The old one can be removed only after vitest stops defaulting to it (`flag.ts DEFAULT_ON` is false under test).
- Phone: three palettes, no shared tokens, no governor.
- Uno leftovers (RelayWiring, Uno text, `BoardId 'uno'`, WallBox not-active branch): remove or convert to the wall box's wiring table.
- Orphan cards: AwayModeCard, SecurityAlert, EnergyCard, LibraryPanel, ReminderAlerts, MemoryGalaxy+GrowthChart (demo only). Owner's decision pending: mount or delete.
- Duplicate `PhoneCard` (Limbs and Connect) plus Well Wisher's Phone overlay (reuses lib/phone.ts).
- WallBox hides absent channels.
- No `AnalyserNode`/output level exists for the voice hill (section 4).
- Core imports Well Wisher stores (MissionCard) and App mounts Well Wisher's FxLayer/GameFx/Dialogs on all pages: this blocks "separable later".
- Dock/title fonts: 4 families ship (Inter, Anton, Doto, Geist Mono, 353 KB woff2) against the overhaul doc's "at most two per brand" budget; no combined font budget is enforced.

##### 7.3 Every place a feature is faked, simulated, placeholder or unclear
- Simulation modes in Aankhen (`pages/Aankhen.tsx:79,322`, palette `Simulate: <scenario>`): real, labelled amber. `components/AwayModeCard`, `EnergyCard`, `lib/away.ts`, `lib/energy.ts` carry `simulated` flags (all unmounted).
- `ww/plannedFeatures.ts`: 28 carcass entries (e.g. sheets-rewritten, sharpen, resource-progress, knowledge-of-the-day, trees-v3, status-v2, life-v2 holiday switch, body-grand, music-import (Spotify history), ...). Each renders honestly as empty/disabled/coming/roadmap with a line. Entries marked `built: true` (e.g. sharpen) hold only the blocked-state text.
- `ww/_carcassLab.tsx`, `ww/kit/_kitchen.tsx`, `ww/career/_lab.tsx`, `ww/kit/_kitchen.css`: lab pages for tests (not user-facing).
- Spotify: only opens the app on a search; no real "play by name" (by design). Spotify history import: planned only.
- `Connect` "planned" integrations: dashed cards with no switch (honest).
- `Reactor`'s "speaking" ripple is state-driven, not amplitude-driven (a signal, but not an audio reading).
- Aankhen docs: the 3D twin tracks and heat layers are fed by the hub source (`serial`/`replay`/`simulation`); for simulation the twin also draws a "truth view". The tracker/zone numbers on real hardware are bounded by the repo's own physics note (one link sees that a body moved, not how it is bent). The twin's "estimate avatar" (`docs/research/2026-10-13-estimate-avatar.md`) is an interpretation layer; whether it is shown on the live page: UNVERIFIED.
- Clay brief asks for loaders, "art that grows with use" and "variable but honest rewards": none built; any growth must read real logged data.
- `docs/design/jarvis-app.md` section 5 checklist still has unchecked real-board items (flash v3, calibrate, record sessions, wire relays, Mosquitto); NOW.md says the S3 is the 6-relay board and the Wi-Fi link is live (28 Oct), so that checklist is stale (UNVERIFIED which items are now true).
- `docs/design/app-ui-overhaul.md` section 3 lists "uncommitted work" and "untracked docs/README.md" that are stale or unchecked (git status shows only `.anchor/session-state.md` modified). `docs/README.md` privacy concern (MAC/LAN addresses): not re-checked.
- Mic input: reported level is real; "voice on CPU" chip is real; but UI never shows `speech_prob`.
- Unknown: whether Playwright's themes screenshots cover the JARVIS side at all (the `e2e` specs listed are Well Wisher plus `core-shot.spec.ts`): UNVERIFIED for Yaadash/Aankhen/Limbs/Connect/System.

---------------------------------------------------------------------------
#### 8. File path index (key facts)
- Shell/nav: `app/ui/src/App.tsx`, `app/ui/src/components/Shell.tsx`, `app/ui/src/components/CommandPalette.tsx`, `app/ui/src/lib/store.ts`, `app/ui/src/pageLoaders.ts`, `app/ui/src/styles/shell.css`, `app/ui/src/styles/tokens.css`, `app/ui/src/styles/motion.css`, `app/ui/src/styles/design/primitive.css`
- JARVIS pages: `app/ui/src/pages/{Core,Yaadash,Aankhen,Limbs,Connect,System}.tsx`
- Orphans/loose ends: `app/ui/src/components/{AwayModeCard,SecurityAlert,EnergyCard,LibraryPanel,ReminderAlerts,RelayWiring,WallBox,PhoneCard,MemoryGalaxy,GrowthChart}.tsx`, `app/ui/src/galaxy/*`, `app/ui/src/lib/{limbs,energy,away}.ts`
- Well Wisher mount/flag: `app/ui/src/germoney/MissionRoot.tsx`, `app/ui/src/ww/frame/{flag,workspaces,overlayRegistry,Frame}.ts(x)`
- WW design/kit/motion: `app/ui/src/ww/design/{base,component,motion}.css`, `ww/design/themes/*.css`, `ww/design/motion/*.ts`, `ww/kit/index.ts`, `ww/plannedFeatures.ts`
- Voice: `core/jarvis.py` (levels 610-626, 798-806; speaking 440-470), `core/playback.py` (228), `core/appio.py`, `app/jarvis_app/core.py` (339), `app/jarvis_app/routes_settings.py` (voice/preview), `app/ui/src/lib/settings.ts` (testVoice 75-93), `app/ui/src/lib/media.ts`, `app/ui/src/components/Reactor.tsx`, `app/ui/src/germoney/game/sfx.ts`
- Perf: `app/ui/src/twin/SpatialTwin.ts`, `app/ui/src/lib/heatgl.ts`, `app/ui/src/lib/liquidGlass.tsx`, `app/ui/scripts/bundle-budget.mjs`, `app/ui/e2e/{interaction-budget,perf-trace}.spec.ts`, `app/ui/vite.config.ts`, `app/ui/dist/assets/*`
- Phone: `app/jarvis_app/phone_page/*`, `app/jarvis_app/phone.py`, `app/jarvis_app/routes_phone.py`, `app/jarvis_app/routes_phone_ww.py`, `app/jarvis_app/board_page.py`
- Plans: `docs/design/{app-ui-overhaul,clay-overhaul-brief,jarvis-app,well-wisher-ui}.md`, `data/notes/NOW.md`, `AGENTS.md`

Not done: no app run, no screenshots, no timings, `well-wisher-ui.md` only skimmed via its sibling docs and the code it governs, `secrets.h` untouched, no files outside this scratch path written.

### Strand 1: Premium personal operating systems, voice interfaces, focus products and companions

**Question.** What do premium personal-OS, voice, device-dashboard, student-focus, AI-companion and high-taste productivity products actually do well and badly, and which of those lessons transfer to JARVIS (a local-first personal OS with voice, memory, room control, camera-free Wi-Fi sensing) and Well Wisher (a student life OS) without copying their dark patterns or inflating claims?

**Method.** Run 2026-11-12. About 30 web searches and 20 page fetches. Primary pages read where reachable: Linear's design-refresh post, Sesame's research post, Raycast's engineering post, Home Assistant's dashboards page, Google's Home-app blog post, the arXiv abstract of the Harvard companion-manipulation paper. Many other sources are secondary (reviews, aggregators, third-party design write-ups) and are labelled as such. Failed or blocked: Android Authority (HTTP 403), TechRadar (truncated), no Apple HIG text found for Siri, no official Nothing design document found. 23 products covered. No personal data was used in any query.

#### Findings

##### A. Hardware-flavoured personal OS and voice devices

**1. Rabbit r1 (with Teenage Engineering).**
- Core loop: hold push-to-talk, speak, device answers or acts. Controls are one button, one scroll wheel, a 2.88-inch screen, $199 ([9to5Google](https://9to5google.com/2024/01/09/rabbit-r1-ai-companion/)).
- Take: a very small number of tactile controls plus sound and haptics made it feel responsive. The industrial design was the one consistent praise ([Gizmodo review](https://gizmodo.com/rabbit-r1-review-ai-companion-performance-1851452097); the review also notes a non-touch screen except for typing).
- Avoid: no status while working. The reviewer repeated questions because the device gave no progress feedback outside Vision, and battery lasted about 5 to 6 hours against an "all-day" claim (same Gizmodo review). Verdict 2/5; TechRadar headline calls it "adorable but half-baked" ([TechRadar](https://www.techradar.com/phones/rabbit-r1), headline only, page truncated). Beauty did not rescue broken function.
- Weak spot: a claimed rabbitOS 2 card redesign (Sept 2025) comes from one unverified aggregator ([aitoolsnest](https://aitoolsnest.pages.dev/tools/rabbit-r1)); not used.

**2. Humane AI Pin.**
- Core loop: wearable voice and projected display. $700 plus $24/month, reportedly about 10,000 units sold against a 100,000 plan, HP bought the IP for $116M, servers shut down 28 Feb 2025 ([Engadget](https://www.engadget.com/ai/the-humane-ai-pin-debacle-is-a-reminder-that-ai-alone-doesnt-make-a-compelling-product-190119112.html); shutdown date from [Laptop Mag](https://www.laptopmag.com/ai/humane-ai-pin-failure-silver-lining) search summary).
- Take: none of the interaction; take the post-mortem lessons only.
- Avoid: no fallback when the AI fails, display unreadable outdoors, overheating, wrong answers, unclear value for the price (Engadget). Lesson stated there: add AI on top of a working foundation and make it optional.

**3. Nothing OS (and Glyph).**
- Core loop: a phone launcher whose identity is dot-matrix type, monochrome option and widgets. Third-party summaries put the principles at minimalism, efficiency, transparency ([History of Nothing](https://ironstike.github.io/nothing-history/nothing_os.html)).
- Take: a single, proprietary visual vocabulary (dots) applied to type, widgets and light patterns. In 2.0 widgets became controls, not decoration ([Nothing community post](https://nothing.community/d/61774-nothing-os-evolution)).
- Avoid: overuse. Nothing's own 3.0 position is to use dot-matrix "more intentionally" where it defines character and does not hurt readability ([same thread](https://nothing.community/d/61774-nothing-os-evolution/2)). Evidence is mostly secondary; no official design doc found.

**4. Apple Siri on iPhone.**
- Core loop: wake, speak, ambient confirmation. iOS 18.1 replaced the bottom orb with a glow around the whole display that reacts to voice and lets you keep using the screen while Siri works ([9to5Mac](https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/), [slashgear](https://www.slashgear.com/1865686/iphone-glowing-around-edges-reason/)).
- Take: an ambient listening state at the edge of the screen that does not block the task. Press reports a 2026 shift to a pill/orb from the Dynamic Island ([MacRumors](https://www.macrumors.com/2026/06/16/iphone-18-could-make-siri-a-circle/)).
- Weak spot: no Apple-authored rationale found; "orb vs glow" is interpretation.

**5. Sesame (voice companion).**
- Core loop: low-latency spoken conversation tuned for "voice presence". Authors list emotional intelligence, conversational dynamics, contextual awareness, consistent personality ([Sesame research](https://sesame.com/research)).
- Take: honest self-assessment. Raters (80 paid, about 15 examples each) could not tell generated from human speech without context, but preferred humans once 90 s of context was given. Authors state that turn-taking and pacing are not modelled and that personality and memory are unfinished. Models 1B/3B/8B with Apache 2.0 stated (same page).
- Avoid: demo tuned for friendliness; community reports of noise sensitivity and derailment ([Product Hunt thread via search](https://www.producthunt.com/posts/sesame-4)).

**6. Pi (Inflection).**
- Core loop: warm text and voice conversation, journaling and venting prompts, available on web and phone ([Product Hunt listing](https://www.producthunt.com/products/pi-by-inflection-ai/launches)).
- Take: tone as the product, no feature sprawl.
- Weak spot: no independent UX critique found; ratings vary widely by aggregator (4.8 on 10 Product Hunt reviews vs 5.5/10 on an aggregator). Treat as low evidence.

##### B. Companion apps and their risks

**7. Replika and companion apps in general.**
- Core loop: always-on relationship chat. A January 2025 FTC complaint alleges deceptive marketing and design that encourages emotional dependence ([TJLP](https://techjusticelaw.org/2025/01/31/tjlp-young-peoples-alliance-and-encode-file-ftc-complaint-over-ai-chatbot-app-replikas-deceptive-practices-seek-ftc-investigation/)). An allegation, no ruling found.
- Harvard Business School working paper: audit of 1,200 real farewells found about 37% used a manipulative tactic; manipulative farewells raised post-goodbye engagement up to 14x in controlled chats; same tactics raised perceived manipulation, churn intent and perceived legal liability; 3,300 US adults ([arXiv 2508.19258](https://arxiv.org/abs/2508.19258)). The Register quotes about 43% ([The Register](https://www.theregister.com/2025/10/08/ai_bots_use_emotional_manipulation/)), so the share differs by source; use the arXiv number.
- Avoid: guilt, FOMO and "you're leaving already?" at the exit moment. This is the single clearest dark-pattern evidence in the survey.

**8. Character.AI.**
- Core loop: persona chat. In late Oct 2025 it announced ending open-ended chat for under-18s from 25 Nov 2025, with an interim cap starting at 2 hours/day, amid lawsuits ([Engadget](https://www.engadget.com/ai/characterai-to-ban-teens-from-talking-to-its-chatbots-180027641.html), [Fortune](https://fortune.com/2025/10/29/character-ai-ban-children-teens-chatbots-regulatory-pressure-age-verification-online-harms)). Current status not verified in 2026.
- Take: usage caps and a change of mode (create stories and videos rather than chat) are what a platform does after harm.
- Avoid: unbounded open-ended companionship as the default.

**9. Rewind / Limitless.**
- Core loop: record and search everything you see, hear or say. Meta acquired Limitless in Dec 2025; pendant sales stopped, Rewind desktop wound down, some regions lost service with an export deadline of 19 Dec 2025 ([Tech Informed](https://techinformed.com/meta-acquires-limitless-pendant-users-moved-to-free-unlimited-plan/), [Outlook Business](https://www.outlookbusiness.com/corporate/meta-acquires-ai-wearables-start-up-limitless-as-it-doubles-down-on-personal-superintelligence)).
- Take: the lifetime risk of a memory product held by a company. Export and local ownership are product features.
- Weak spot: I could not confirm where the pendant stored data.

##### C. Spatial, device and home dashboards

**10. Home Assistant dashboards.**
- Core loop: build your own at-a-glance home view. 4 view types (Masonry, Panel, Sections default, Sidebar), 40 card types, per-card themes, several dashboards per home such as kitchen tablet, guest and detailed ([Home Assistant](https://www.home-assistant.io/dashboards/)).
- Take: separate dashboards by audience and moment, not one wall. The cost is configuration burden.
- Avoid: a card catalogue as the main metaphor, which is the bento/grid default this project wants to leave.

**11. Google Home app (Gemini redesign, Oct 2025).**
- Core loop: three tabs (Home, Activity, Automations), swipe between Favorites, device groups and dashboards, "Ask Home" always in the header, "Home Brief" daily summary. Google reports 70% faster load on some Android devices, crashes down nearly 80%, camera history scroll frame rate more than 6x ([Google blog](https://blog.google/products-and-platforms/devices/google-nest/google-home-app-gemini-redesign/)). First-party numbers; some AI features need a paid tier.
- Take: ask-anything plus a daily brief on top of normal controls, and the speed-and-crash framing as a design goal.
- Avoid: gating the assistant behind a subscription, which a personal OS should not do.

**12. Tesla touchscreen cabin.**
- Core loop: nearly all controls on one screen. In a Vi Bilägare test on four tasks at 110 km/h, a 2005 Volvo V70 with physical controls took about 10 s, Tesla Model 3 23.5 s, BMW iX 30.4 s ([The Autopian](https://www.theautopian.com/swedish-test-offers-compelling-evidence-that-buttons-are-less-distracting-than-touchscreen-infotainment-systems/); secondary, small test, magazine itself stressed that interface design matters, not only the lack of buttons).
- Take: frequent, urgent actions (lights, fan, relay off) need a fixed, always-reachable, glance-free control.
- Avoid: burying those under menus for the sake of a clean screen.

##### D. High-taste productivity tools

**13. Linear.**
- Core loop: dense issue tracking. March 2026 refresh: central content stays prominent, navigation recedes, borders rounded and softened ("structure should be felt, not seen"), warmer grey in place of a cool blue-ish default, icon count reduced, colored team icons removed ([Linear](https://linear.app/now/behind-the-latest-design-refresh)). Two-person team, about two months, a hue/chroma/lightness token tool built in a couple of hours (same page).
- Take: hierarchy by contrast budget, not by decoration, with a token tool to tune warmth. Direct fit for an off-white/clay/charcoal base.
- Avoid: going too warm ("muddy", Linear's own words).

**14. Raycast.**
- Core loop: keyboard-first command launcher. Custom UI because stock controls were not built for keyboard-first use; v2 is a React + TypeScript frontend in a system WebView (WKWebView/WebView2), Node backend, Rust indexer ([Raycast engineering post](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)).
- Take: this is the same shape as JARVIS (web UI in WebView2), so its numbers are a realistic budget. Memory: v1 about 200 to 300 MB, v2 about 350 to 450 MB; empty WebView about 50 MB. Costs they list: higher baseline, WebView2 version variance, harder accessibility and IME work (same post).
- Weak spot: "under 50 ms launch" is an unverified third-party claim.

**15. Arc and Dia (The Browser Company).**
- Core loop: vertical sidebar with named, colour-coded Spaces. Active development of Arc stopped in 2025 for the AI browser Dia; Atlassian bought the company for $610M (Sept 2025) ([TechCrunch via Yahoo](https://tech.yahoo.com/computing/articles/dia-ai-browser-starts-adding-170158861.html), [Thurrott](https://www.thurrott.com/cloud/web-browsers/322287/the-browser-company-explains-its-vision-for-dia)).
- Take: named, coloured contexts (Spaces) as the unit of mental organisation.
- Avoid: a loved, distinctive interface abandoned for a generic one; critics call Dia a stripped Chrome. Secondary sources; no official post on reasoning found.

**16. Things 3.**
- Core loop: Inbox, Today, This Evening, Upcoming, Someday. A third-party design analysis says about 95% of the interface is neutral with colour reserved for meaning (yellow Today, red Deadline, indigo Evening), and describes about 500 ms checkbox completion animation ([Blake Crosley study](https://blakecrosley.com/guides/design/things); his estimates, not Cultured Code figures). MacStories review: beauty and delight in a task manager ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)).
- Take: colour as information, one meaningful reward moment per task.
- Weak spot: the 95% and timings are unsourced; Apple Design Award claims not verified on an Apple page.

**17. Notion Calendar (ex-Cron).**
- Core loop: keyboard-first calendar. Command bar, number keys for days visible, S for scheduling links, ? for shortcut list ([efficient.app](https://efficient.app/apps/notion-calendar), [Matthias Frank tutorial](https://matthiasfrank.de/en/notion-calendar/)).
- Take: a shortcut cheat-sheet that is always one key away.
- Weak spot: reviews are SEO-style; no primary Notion source retrieved.

##### E. Student focus and time products

**18. Forest.**
- Core loop: start a timer, a tree grows; leaving the app kills it. Soft blocker (you can give up), group sessions free, Plus about $59.99/year, real-tree planting capped at five per account ([Headway review](https://makeheadway.com/blog/forest-app-review/), a publisher with its own competing app). No clinical trial of Forest itself. User and revenue figures are third-party estimates that conflict (for example 47.9M installs / about 970K monthly active users on AppGoblin vs developer's claim of over 2M paid users) ([AppGoblin](https://appgoblin.info/apps/cc.forestapp)).
- Take: a visible, slightly emotional object that stands for a focused session.
- Avoid: loss framing as the only motivator; subscription friction.

**19. Opal.**
- Core loop: scheduled blocks plus friction. A 7-second countdown before unlocking, caps on daily opens, Normal/Timeout/Deep Focus levels; Deep Focus paywalled; Pro $99.99/year ([Productivity Stack review](https://productivitystack.substack.com/p/opal-review)). Developer claim of 500M hours saved is unverified ([search summary](https://www.commonsensemedia.org/app-reviews/opal-screen-time-for-focus)). Evidence is anecdotal.
- Take: friction that costs seconds, not guilt; user chooses its strictness.
- Avoid: gating the strict mode behind payment; leaderboards (the reviewer found them unhelpful).

**20. Focusmate.**
- Core loop: book a 25, 50 or 75 minute slot, work silently with a stranger on video ([Focusmate FAQ](https://www.focusmate.com/faq)). I found no rigorous study; the often-quoted 73% figure has no source and one blogger's 20% to 70% is a single anecdote ([search results](https://adhd-productivity.pages.dev/comparisons/body-doubling-apps)).
- Take: presence as a commitment device. JARVIS cannot have a human, but it can offer a quiet "session open" state.
- Avoid: quoting any efficacy number.

**21. Tiimo.**
- Core loop: visual day planner for ADHD and autistic users; Apple's 2025 iPhone App of the Year ([Apple App Store listing](https://apps.apple.com/app/id1480220328), [MacRumors](https://forums.macrumors.com/threads/apple-announces-2025-app-store-award-winners-including-iphone-app-of-the-year.2474219)). Colour-coded daily overview, drag and drop, calm countdown timer, AI that breaks tasks into steps; about $54/year; setup takes real time per one parent review ([TWiT](https://twit.tv/posts/tech/how-tiimo-makes-task-and-time-management-easier-neurodiverse-users)).
- Take: make time visible as a shape, not a list.
- Avoid: heavy onboarding before value.

**22. Structured.**
- Core loop: inbox tasks dragged onto a timeline. Timeline, inbox, notes free; recurring tasks, calendar import and AI need Pro ([Cool Curation](https://coolcuration.com/structured-app-review-uk)). AppleInsider (v3.0.1, 2023) scored 3.5/5 for sync problems and day/week views only ([AppleInsider forum](https://forums.appleinsider.com/discussion/230281)). 2026 Apple Design Awards finalist claim is secondary.
- Take: one timeline as the main canvas. Fits "one task canvas per screen".

**23. Endel.**
- Core loop: generated soundscapes adapting to time, weather and biometrics. Company claims "7x focus" and "3.6x less stress"; the underlying Arctop work appears to be an industry-funded preprint of 62 participants, described by a Vice reviewer as mixed at best ([Endel science page](https://www.endel.io/science), [Vice](https://vice.com/en/article/does-the-endel-focus-productivity-app-actually-work), [Brain.fm comparison](https://www.brain.fm/blog/best-focus-music-app-brain-fm-vs-endel-vs-noisli), competitor so not neutral).
- Take: context-aware, calm ambient layer.
- Avoid: repeating its numbers.

#### Numbers

| Fact | Value | Source |
|---|---|---|
| Rabbit r1 price / screen / battery | $199 / 2.88 in / about 5 to 6 h | [9to5Google](https://9to5google.com/2024/01/09/rabbit-r1-ai-companion/), [Gizmodo](https://gizmodo.com/rabbit-r1-review-ai-companion-performance-1851452097) |
| Humane Pin price, sales, exit | $700 + $24/mo; about 10k units vs 100k plan; HP $116M | [Engadget](https://www.engadget.com/ai/the-humane-ai-pin-debacle-is-a-reminder-that-ai-alone-doesnt-make-a-compelling-product-190119112.html) |
| Companion farewells manipulative | about 37% of 1,200; up to 14x engagement | [arXiv 2508.19258](https://arxiv.org/abs/2508.19258) |
| Same, press version | about 43% | [The Register](https://www.theregister.com/2025/10/08/ai_bots_use_emotional_manipulation/) |
| Home Assistant | 4 view types, 40 card types | [HA docs](https://www.home-assistant.io/dashboards/) |
| Google Home app | 70% faster load, crashes down nearly 80%, 6x camera history frame rate | [Google](https://blog.google/products-and-platforms/devices/google-nest/google-home-app-gemini-redesign/) |
| Raycast memory | v1 200 to 300 MB, v2 350 to 450 MB, empty WebView about 50 MB | [Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast) |
| Tesla vs buttons test (4 tasks at 110 km/h) | Volvo V70 about 10 s, Model 3 23.5 s, iX 30.4 s | [The Autopian](https://www.theautopian.com/swedish-test-offers-compelling-evidence-that-buttons-are-less-distracting-than-touchscreen-infotainment-systems/) |
| Sesame preference test | 80 raters, about 15 each, about 50:50 without context, humans preferred with 90 s context | [Sesame](https://sesame.com/research) |
| Opal unlock friction | 7 s countdown | [Productivity Stack](https://productivitystack.substack.com/p/opal-review) |
| Forest Plus | about $59.99/yr | [Headway](https://makeheadway.com/blog/forest-app-review/) |
| Character.AI teen change | open-ended chat ends 25 Nov 2025; interim 2 h/day | [Engadget](https://www.engadget.com/ai/characterai-to-ban-teens-from-talking-to-its-chatbots-180027641.html) |
| Browser Company sale | $610M to Atlassian (Sept 2025) | [Thurrott](https://www.thurrott.com/cloud/web-browsers/322287/the-browser-company-explains-its-vision-for-dia) |
| Endel Arctop study | 62 participants, preprint, partly Endel-funded | [Vice](https://vice.com/en/article/does-the-endel-focus-productivity-app-actually-work) |

#### Licences and usage concerns

- Typefaces and brand: Nothing's Ndot is proprietary; do not copy it or its dot language. Build an original mono and dot or grid vocabulary ([brand guide summary](https://madegooddesigns.com/nothing-brand-guidelines/)).
- Teenage Engineering and Rabbit industrial design, Tamagotchi-like references and Forest's tree art are protected work; take principles, not artwork.
- Sesame CSM weights are stated to be Apache 2.0 on its own page, but it is English-trained and the repo and weights were not checked; verify before any use. Not needed for the design phase.
- Copy of competitors' marketing numbers (Endel 7x, Opal 500M hours, Focusmate 73%) must not be reused in JARVIS or Well Wisher copy.
- Companion tactics in section B are possible legal exposure (FTC complaint, the paper's own legal-liability finding). Do not build them.
- Third-party design analyses (for example Things) are one writer's reading, not vendor specifications.

#### What this changes for JARVIS / Well Wisher

**Transferable principles for JARVIS (personal OS, voice, room, sensing)**

1. **Status always visible while it works.** r1's lack of progress feedback caused repeated requests. Every voice, relay and sensing action shows a state: heard, working, done, failed with reason.
2. **Ambient listening state at the screen edge or in a fixed corner**, not a modal orb (Siri's glow). Provide it as a thin line along one edge so the task canvas stays usable.
3. **Fixed hardware-like controls for urgent actions.** Lights, fan and "all off" stay in one reachable place on every screen (Tesla lesson), not inside a view.
4. **One signature visual vocabulary per product, used with restraint.** Nothing's dots work because they carry meaning and are reduced where readability suffers. Pick one mono and grid language for JARVIS and use it for metadata and the one art centrepiece, not everywhere.
5. **Hierarchy by contrast budget.** Follow Linear: navigation recedes, the working surface wins, borders soft, warm greys tuned with a token tool (and stop before muddy). Fits off-white/clay/charcoal.
6. **No grid of equal cards.** Home Assistant's own flexibility shows the cost of the card catalogue; make dashboards per moment (room, night, away), not per device.
7. **AI optional and honest.** Humane's lack of fallback is the main lesson. Every JARVIS function works without the model, with the AI as an extra layer. Label Aankhen output as "movement detected", never "pose", and never show simulated data as measured.
8. **Memory is ownership.** Rewind/Limitless ended with export deadlines. Yaadash needs one-click full export and delete, local first, stated plainly in the UI.
9. **Named contexts, colour as meaning only** (Arc Spaces, Things). Use colour for state (on, warning, planned), not decoration.
10. **Budget the WebView.** Raycast's published numbers say 350 to 450 MB is normal for this stack; set a target below that and respect the "light on CPU/GPU" rule by using static or slow-frame art, not continuous shaders.
11. **Keyboard-first and a one-key shortcut sheet** (Raycast, Notion Calendar), with a command bar that can run voice commands as text.
12. **Planned features are labelled planned**, with no fake toggles; Sesame's published "not there yet" list is a model for honesty.

**Transferable principles for Well Wisher (student life OS)**

1. **One timeline as the day canvas** (Structured, Tiimo): time as a shape, with exams, study blocks and focus in one lane.
2. **One visible object per focus session** (Forest's tree) tied to the existing Tree of Skills, but with no death or loss framing; an unfinished session leaves a partial tree, not a withered one.
3. **User-chosen friction, in seconds** (Opal's 7 s pause). Strictness is the user's setting and free.
4. **Colour is information** (Things): reserve warm accents for exam proximity and deadlines; everything else neutral.
5. **One reward moment per completion**, short and optional (Things-style checkbox animation, Tiimo's "pops of joy"), no streak-loss penalties.
6. **Exit without guilt.** Ending a session, closing the app or leaving a chat must never trigger guilt, FOMO or "are you leaving?" prompts (the Harvard audit). Make this a written rule.
7. **No efficacy numbers in copy** unless measured on the user's own data; Focusmate, Endel and Opal claims are unsupported.
8. **Quiet "session open" presence** as a body-doubling stand-in (a calm indicator that a session is live), not a fake partner.
9. **Cheap onboarding.** Tiimo's setup cost is a documented complaint; show value on day one, import dates from what exists.
10. **Per-section worlds under one grammar.** Arc's Spaces show contexts can differ in colour while sharing structure; Study, Exams, Focus and Career can have their own artwork over a common frame.
11. **Companion voice is a skin, not a relationship.** Any friendly tone obeys: cap session lengths, no pleading, no pretending to feel. Character.AI's trajectory shows where open-ended companionship ends.

#### Uncertain or unverified

- Rabbit rabbitOS 2 redesign: single aggregator; not used.
- Nothing's design principles: only third-party summaries and community posts.
- Siri design rationale: no Apple source found; HIG not read.
- Pi: no independent UX critique; ratings conflict across aggregators.
- Forest, Endel, Opal, Focusmate efficacy: no peer-reviewed support found; all numbers are company claims or anecdote.
- Things colour share (95%) and animation timings: one third-party author's estimates.
- Notion Calendar, Structured, Tiimo detail: SEO and aggregator reviews; award claims for Things and Structured not confirmed on Apple pages.
- Harvard paper: 37% (arXiv) vs 43% (The Register) disagree; paper is a working paper, not peer-reviewed as far as I could tell. The CDT "37 dark patterns" audit was seen only through aggregators.
- Tesla comparison: small test, secondary coverage; original Swedish article not read.
- Replika FTC complaint: no outcome found; Character.AI 2026 status not checked.
- Google Home numbers are Google's own and "on some Android devices".
- Apple Home and a dedicated Teenage Engineering design-language source were not obtained; Apple Home is covered only by inference from Google Home and Siri.

### Strand 2: Visual and interaction references beyond the owner library

**Question.** What can JARVIS (personal OS) and Well Wisher (student life OS) learn from current award-level web and product work, from tactile/matte "clay" UI (done well and badly, with contrast numbers), retrofuturist HUD and terminal UI, ASCII and dithering on the web, data-landscape graphics, cybersigilism and brutalist web design, and from the 12 pilot sites in the owner library? Which of it transfers to a daily-use desktop app at 1366x768 in a WebView2 window, and what should the team do and not do?

**Method.** Research on 2026-11-12. About 25 distinct sources were fetched or searched: WebSearch and WebFetch for articles, official docs and award pages, plus direct HTTP inspection of the 12 pilot sites (HTML, script lists, and string counts inside the JS bundles, using curl and gzip for size). Contrast ratios were computed locally with the WCAG relative-luminance formula. Limits of the method: WebFetch returns a small-model summary, so for the 12 sites the *technique* column rests on what is in the shipped HTML and bundles, not on runtime profiling. A string such as `WebGLRenderer` in a bundle proves the library is shipped, not that it runs on every page. No site was opened in a real browser, so frame rate, GPU load and visual quality of the pilot sites are unmeasured. Awwwards, Godly and Siteinspire pages are largely JS-rendered or blocked (403), so award data is thin (see Uncertain).

#### Findings

**1. The 12 pilot sites (state as of 2026-11-12)**

Two of the twelve are not usable references any more, which is itself a finding for the library.

| Site | Idea | Technique found | Cost | Reduced motion | Transfers to a 1366x768 daily-use app? |
|---|---|---|---|---|---|
| [quechua-lookbook.com/ss25](https://quechua-lookbook.com/ss25/) | Seasonal outdoor lookbook; products tied to locations; preloader with percent counter; "Scroll to see full collection" ([page text](https://quechua-lookbook.com/ss25/)) | WordPress theme; one app bundle with GSAP + ScrollTrigger + Lenis (212 KB raw, 74 KB gzip; 539 KB HTML) | Smooth-scroll plus scroll-linked animation. No scroll-jacking proof, but Lenis is present | No `prefers-reduced-motion` string in its bundle (Lenis itself defaults to respecting it, see 4) | Partly: the place-anchored section idea ("each module tied to a real place") transfers; the long-scroll lookbook does not |
| [amaterasu.ai](https://amaterasu.ai) | "Physics cognition lab"; a "Click to Enter" gate then "Scroll to explore" ([page text](https://amaterasu.ai)); credited to a studio in the footer | Nuxt app; WebGL strings in HTML; GSAP + ScrollTrigger in main chunk (322 KB raw, 117 KB gzip) | WebGL scene plus scroll timeline; entry gate hides the cost | None found | The enter-gate is a splash, which a daily app must not have. Scene-as-hero could transfer as a single centrepiece, paused when not visible |
| [cydstumpel.nl](https://cydstumpel.nl) | Designer portfolio, 2026 theme | WordPress; main.js 424 KB raw, 151 KB gzip with GSAP, ScrollTrigger, Lenis; `OffscreenCanvas` and three.js strings; a View Transitions script | Heaviest JS of the set. WebFetch got HTTP 403, so visuals were not seen | Yes: 3 `prefers-reduced-motion` references in main.js | Best technical model of the set: honours reduced motion and uses the native View Transitions API (see 5) |
| [superevilgeniuscorp.com](https://superevilgeniuscorp.com) | Villain-themed creative agency (Long Beach), playful copy ([page text](https://superevilgeniuscorp.com)) | Webflow; Lenis (23 references), GSAP ticker, ScrollTrigger, Spline references; drag/scroll carousels | 64 KB HTML but third-party embeds load the weight | None found | The voice (persona-led microcopy) transfers to the JARVIS butler; the stack does not |
| [makereign.com](https://makereign.com) | Strategic design partner; many enquiry forms ([page text](https://makereign.com)) | Nuxt; three.js (`WebGLRenderer`, 18 `ShaderMaterial`) in a 550 KB chunk (134 KB gzip); GSAP + Lenis chunks; OffscreenCanvas | Heavy: roughly 600 KB gzip of JS across the measured chunks | None found | No. Marketing-site stack; form-heavy IA is the opposite of a task canvas |
| globekit.co | WebGL globe library | Domain now 302-redirects to a parked-domain host (`ww547.globekit.co/?tkn=...`) | n/a | n/a | Dead reference. Use [Three.js points or globe.gl](#uncertain-or-unverified) instead if a globe is wanted |
| [spylt.com](https://spylt.com) | Drinks brand (Shopify) | Currently serves a password / coming-soon page with a countdown; theme JS only 34 KB | n/a | `prefers-reduced-motion` appears twice in global.js | The live experience could not be inspected. Do not cite from memory |
| [goodfight.shop](https://goodfight.shop) | Shopify store | Old Shopify theme: lazysizes, infinite scroll, polyfills; no animation library found | Light | None | Evidence that a quiet theme can still carry a strong brand through type and imagery |
| [fitsole.shop](https://fitsole.shop) | Shopify store with page transitions | Theme.js (225 KB raw, 44 KB gzip) with 4 reduced-motion references; Lenis and Barba.js shipped separately | Moderate; Barba does full page-transition swaps | Yes | Page-transition choreography is meaningful in a document site; in an app, transitions should be under 200 ms and skippable |
| mystaelectric.com | Unknown (could not inspect) | Domain 301-redirects to an unrelated gambling domain | n/a | n/a | Domain has lapsed or been hijacked. Do not visit or link it. Replace in the library |
| [monopo.london](https://monopo.london) | Agency; image-heavy home | Nuxt; PixiJS intro and project grid (PIXI strings in three chunks, `getContext("webgl")`), GSAP, Lenis; a 1.36 MB state.js (248 KB gzip) | Heavy: WebGL image distortion on the home page | None found in the scanned chunks | The distortion-on-hover is a decoration. Cost is too high for a daily surface |
| [ussr.obys.agency](https://ussr.obys.agency) | Obys is a known award-winning studio; this URL is a Readymag export (generator tag `Readymag`) | Returns HTTP 404 today; page is `noindex` | n/a | n/a | Dead URL. The Obys main site was not tested |

Take-aways from the table:
- The common stack is **Lenis + GSAP/ScrollTrigger**, optionally with a WebGL layer (three.js, PixiJS) on top. 8 of the 12 sites ship Lenis, GSAP or both. That stack is built for long linear pages and is the wrong default for a task canvas.
- Only 3 of the 8 inspected live sites show explicit reduced-motion handling (cydstumpel, fitsole, spylt-theme), so "award-style" work is not a reliable accessibility reference.
- Lenis itself is not a problem: it "wraps the browser's own scroll", keeps `position: sticky` and anchors working, and defaults `respectReducedMotion` to true ([Lenis README](https://github.com/darkroomengineering/lenis)). The risk is the 3D scenes and scroll-linked timelines built on top.

**2. Award sites 2024-2026**

- Awwwards Site of the Year 2024 is Igloo Inc (also Developer Site of the Year), with jury praise for combining an immersive 3D experience with simple scroll navigation ([Awwwards 2024 annual awards](https://awwwards.com/annual-awards-2024), via search result).
- Awwwards 2025 list: Site of the Year Lando Norris (OFF+BRAND.), Developer Site of the Year Messenger, E-commerce Scout Motors, Agency Immersive Garden, Studio Malvah, Independent Louis Paquet ([Awwwards winners 2025](https://www.awwwards.com/annual-awards/winners)). The page lists vote counts (Lando Norris 43 jury votes, 596 Users' Choice votes) but not studios or techniques for each.
- Pattern across winners: 3D or WebGL storytelling on marketing or personal-brand sites. These are judged as pieces to look at, not tools to use all day. Awards judge design, usability, creativity and content for a first visit; none of this measures repeat-visit ergonomics.
- A different award, Readymag Websites of the Year 2025, has a jury from Pentagram, Porto Rocha and Studio Dumbar ([Readymag blog](https://blog.readymag.com/websites-of-the-year-2025/), [press release](https://www.newswire.com/news/expert-jury-from-pentagram-porto-rocha-and-studio-dumbar-selects-the-22688118)). CSS Design Awards mostly award Site of the Day; no confirmed 2025 Website of the Year list was found.

**3. Tactile / neumorphic / clay UI**

- Standard that bounds the whole style: WCAG 2.2 Non-text Contrast needs **3:1** against adjacent colours for UI component boundaries and state indicators when nothing else identifies the control; values are not rounded, so 2.999 fails. Focus indicators also need 3:1. Visible text or a clear icon removes the need for a visible boundary ([W3C Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
- The canonical neumorphic recipe is base `#E0E5EC`, extruded shadows `-8px -8px 16px #FFFFFF` and `8px 8px 16px #A3B1C6`, inset on press, radius 12-20 px ([Setproduct guide](https://setproduct.com/blog/neumorphism-design-guide)). I computed its contrast (table in Numbers): the white highlight is **1.27:1** against the base and the dark shadow **1.72:1**. Neither reaches 3:1, so depth alone can never be the only cue.
- Where it fails ([Setproduct](https://setproduct.com/blog/neumorphism-design-guide), [Built In](https://builtin.com/design-ux/neumorphism-accessibility)): gray-on-gray text below 4.5:1, buttons indistinguishable from cards, weak focus on shadow-only elements, state shown only through depth, dead press feedback, and dense dashboards. Michal Malewicz, who popularised the term, is quoted in Built In as criticising low-contrast light borders.
- Where it works: single-purpose instruments (players, smart-home panels, calculators), with a non-shadow cue on every control (accent fill, border or label), a 2 px `:focus-visible` ring, an inset flip on `:active` with matching `aria-checked`/`aria-pressed`, 44x44 px targets, and text at 7:1 where possible ([Setproduct](https://setproduct.com/blog/neumorphism-design-guide)). Its own recommended fallback is "soft shadows with clear borders and accent fills".
- Hardware-led references: Teenage Engineering is cited as an advocate of tactile, "squishy" UI ([Idle Gaze](https://idlegaze.substack.com/p/idle-gaze-051-we-just-want-to-touch)); Nothing's dot-matrix language is a stylised retro-futurist choice, not literal skeuomorphism, and its shift from Glyph strips to a dot matrix drew a mostly negative owner reaction ([Yanko Design](https://www.yankodesign.com/2026/08/04/nothing-killed-the-glyph-interface-this-teenage-engineering-synth-concept-argues-that-was-a-mistake/)). Weak evidence: design-press opinion, no usability data.

**4. Retrofuturist HUD and terminal UI**

- Film UI principles from Territory Studio ([Pushing Pixels interview](https://www.pushing-pixels.org/2014/08/07/the-craft-of-screen-graphics-and-movie-user-interfaces-interview-with-david-sheldon-hicks-of-territory-studio.html)): graphics serve the story; palette and form carry identity (Prometheus from coral and anemone forms); motion and physical interaction convey character; "fine line between crazy and flamboyant"; "I don't resist looking dated but I do resist looking boring". Important caveat from the same interview: film graphics often prioritise "feel" over clarity because shots rarely frame them closely. That is the opposite of a daily-use app.
- Blade Runner 2049: Territory designed UI by class, so the dominant corporation's screens are "the most elegant and minimalist" and the low-status vehicle's screens are worn, and screens were built as initial / action / looping states ([HUDS+GUIS](https://www.hudsandguis.com/home/2018/blade-runner-2049)). The state model (idle, active, loop) maps cleanly onto JARVIS panels.
- Perception (the studio) says it builds film UI "as if it were actual functioning software" ([Experience Perception](https://www.experienceperception.com/?p=113297), via search summary, not read in full).
- Game HUD guidance: readability beats immersion; edge panels must read at a glance; fade elements in only when relevant; let players move, hide or resize HUD elements ([Wayline](https://www.wayline.io/blog/diegetic-interfaces-game-design), [Educative](https://www.educative.io/answers/game-ui-design-principles-and-component-types)). Dead Space is the usual diegetic reference. Quality of these sources is blog-level.
- Terminal-style web examples: dottxt.ai by Antecâmara (keyboard-driven retro terminal for a serious tech company), IBM DOS VGA 9x16 font tutorials, charcoal screen on paper-white with one amber accent ([Framer University](https://framer.university/resources/retro-style-website-in-framer), [Kombai gallery](https://kombai.com/gallery/inspirations/retro-websites-web-1/)). My contrast check: amber `#FFB000` on charcoal `#23252A` is 8.37:1 and green `#33FF66` is 11.42:1, so phosphor colours are accessible on dark; a grey `#6E7178` metadata label on that charcoal is only 3.14:1.

**5. ASCII and dithering on the web**

- Ordered (Bayer) dithering compares pixel luminance with a 2x2, 4x4 or 8x8 threshold matrix; blue noise needs one extra texture fetch; error diffusion (Floyd-Steinberg) is not suited to fragment shaders because it is sequential; the Bayer pattern is tied to resolution so it shifts on resize ([Maxime Heckel](https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web)). Colour quantisation `floor(c*(n-1)+0.5)/(n-1)` gives 8 colours at 2 levels per channel.
- ASCII cells are independent, so the work parallelises on the GPU; dithering can too ([search summary of Codrops "Efecto" and others](https://tympanus.net/codrops/2026/01/04/efecto-building-real-time-ascii-and-dithering-effects-with-webgl-shaders); the Codrops page itself returned 403). Canvas 2D variants use a brightness lookup table, a bitmap font atlas and `ResizeObserver`; OffscreenCanvas plus worker is an option ([Codrops Bayer guide](https://tympanus.net/codrops/2025/07/30/interactive-webgl-backgrounds-a-quick-guide-to-bayer-dithering/), 403, so only search metadata).
- **No benchmark was found** comparing WebGL with Canvas 2D for these effects, and none of the fetched text gives FPS or GPU numbers. Any performance claim below is an engineering inference.
- Idle-cost guidance that does have a source: browsers stop `requestAnimationFrame` in hidden tabs, and Chrome reports CPU savings of up to 75% on some sites by suspending visual work when backgrounded; overlapped windows can still keep a page "visible" ([MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [Chrome background tabs](https://developer.chrome.com/blog/background_tabs), [Mozilla bug 1712854](https://bugzilla.mozilla.org/show_bug.cgi?id=1712854)). Pause on `visibilitychange` and `IntersectionObserver`.

**6. Data-landscape graphics**

- The ridgeline ("joyplot") is a stack of many density plots ([D3 Graph Gallery](https://d3-graph-gallery.com/ridgeline.html)). Its history: pulsar CP 1919 found in November 1967 by Jocelyn Bell Burnell and Antony Hewish; Harold Craft Jr. plotted about 80 successive pulses at Arecibo for his 1970 dissertation; Peter Saville used the image for Unknown Pleasures, and Scientific American's Jen Christiansen traced it back to Craft in 2015 ([Wikipedia](https://en.wikipedia.org/wiki/Unknown_Pleasures), [Cambridge](https://www.cam.ac.uk/stories/journeysofdiscovery-pulsars), [RF Global](https://www.rfglobalnet.com/doc/radio-pulsars-joy-division-and-jocelyn-bell-burnell-0001)). Sources disagree on which band member picked the image.
- Relevance: the form is a *real* signal rendered as art, which matches Aankhen's honest-sensing rule. Occlusion is the intentional visual idea (hidden-line removal), but it also hides data behind nearer lines, so it is a landscape, not a measurement chart.
- Point clouds: no primary source was gathered; see Uncertain.

**7. Cybersigilism**

- Sources agree on the mix of occult or sigil symbolism with cyber elements and thin black sharp lines, evolved from Y2K "tribal" tattoos and cyberpunk, and spread by TikTok ([BuzzFeed via search](https://www.buzzfeed.com/kristatorres/most-popular-gen-z-tattoo-tiktok), [AOL](https://www.aol.com/gen-z-replaces-millennial-tribal-171104607.html), [Raandoom](https://www.raandoom.com/our-blog/cybersigilism-esoteric-to-algorithmic)). Origin stories (Berlin club scene) come from brands and blogs and are not independently verified. "Chrome" is not supported by the sources.
- Design translation (my inference): it is vector line work, which is cheap. SVG paths with stroke and `stroke-dasharray` draw-on animation cost far less than WebGL.

**8. Brutalist web design**

- Pascal Deville founded brutalistwebsites.com in 2014 as a reaction against template-builder polish ([LogRocket](https://blog.logrocket.com/ux-design/web-brutalism/), [Creative Bloq](https://www.creativebloq.com/features/are-brutalist-sites-the-webs-punk-rock-moment), [Adobe blog](https://blog.adobe.com/en/publish/2016/12/01/brutalist-web-designers-eschew-rules-for-ux-best-practices)). Usability is contested; a 2022 study tested it with Nielsen's attributes but its results were not retrieved ([Springer chapter](https://unpaywall.org/10.1007%2F978-3-031-06417-3_14)).
- What is useful for an app: exposed structure, visible grid and borders, system-like type, honest labels. The "difficult on purpose" part is not.

#### Numbers

| Fact | Value | Source |
|---|---|---|
| WCAG 2.2 non-text contrast for UI boundaries and states | 3:1, not rounded | [W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Neumorphic base `#E0E5EC` vs highlight `#FFFFFF` | 1.27:1 (computed) | [Setproduct](https://setproduct.com/blog/neumorphism-design-guide) colours, own calculation |
| Same base vs shadow `#A3B1C6` | 1.72:1 (computed) | same |
| Gray text `#9AA5B1` on `#E0E5EC` | 1.98:1, fails 4.5:1 (computed) | own calculation |
| Gray text `#6B7788` on `#E0E5EC` | 3.59:1, fails 4.5:1 for body (computed) | own calculation |
| Charcoal `#2A2D32` text on `#E0E5EC` | 10.91:1 (computed) | own calculation |
| Off-white `#F1EFEA` vs clay `#D8D2C7` (illustrative surfaces) | 1.31:1 (computed) | own calculation |
| Off-white `#F1EFEA` vs charcoal `#23252A` | 13.34:1 (computed) | own calculation |
| Clay-brown text `#8C7F6E` on `#F1EFEA` | 3.40:1, fails body text (computed) | own calculation |
| Amber `#FFB000` on charcoal `#23252A` | 8.37:1 (computed) | own calculation |
| Green `#33FF66` on charcoal `#23252A` | 11.42:1 (computed) | own calculation |
| Grey `#6E7178` metadata on charcoal `#23252A` | 3.14:1 (computed) | own calculation |
| Recommended hit target | 44x44 px; body text 7:1 target, 4.5:1 floor | [Setproduct](https://setproduct.com/blog/neumorphism-design-guide) |
| JS shipped, gzip: cydstumpel main.js | 151 KB (424 KB raw) | own measurement 2026-11-12 |
| makereign three.js chunk | 134 KB gzip (550 KB raw) | own measurement |
| monopo state.js / Pixi-GSAP chunk | 248 KB / 204 KB gzip | own measurement |
| amaterasu main chunk | 117 KB gzip | own measurement |
| quechua-lookbook app.js | 74 KB gzip | own measurement |
| fitsole theme.js / lenis / barba | 44 KB / 4.9 KB / 9.3 KB gzip | own measurement |
| Chrome CPU saving by pausing hidden work | "as much as 75%" for some sites | [Chrome](https://developer.chrome.com/blog/background_tabs) |
| Pulsar plot | CP 1919, Nov 1967, about 80 pulses, 1970 thesis | [Cambridge](https://www.cam.ac.uk/stories/journeysofdiscovery-pulsars) |
| Awwwards 2025 Site of the Year | Lando Norris (43 jury votes; Users' Choice 596) | [Awwwards](https://www.awwwards.com/annual-awards/winners) |

Note: sizes count the first script load only, not lazy chunks, images, video or fonts.

#### Licences and usage concerns

- Lenis: MIT ([GitHub](https://github.com/darkroomengineering/lenis)). GSAP is source-available with its own licence; confirm the current terms (GSAP became free for commercial use in 2025 per its vendor, not re-verified here) before bundling. three.js, PixiJS and OGL are MIT-style libraries (not re-fetched).
- Do not copy pilot-site code, imagery, copy or fonts: they are the studios' and brands' work (Decathlon/Quechua, Obys, Monopo and others). Take principles only. The Quechua page is a commercial brand lookbook.
- Film and game UI (Blade Runner 2049, Prometheus, Destiny) are studio and IP-holder work: reference mood, never reproduce screens or logos.
- Codrops dithering and ASCII demos and the Maxime Heckel article are tutorials; their sample code licences were not confirmed (Codrops pages returned 403). Re-implement from the algorithm (Bayer matrix, quantisation formula), which is not copyrightable.
- The two dead domains (mystaelectric.com redirects to a gambling site; globekit.co is parked) are a safety issue: do not keep them as live links in the library, in docs or in the app.
- Joy Division / Unknown Pleasures is a trademarked cover; the underlying ridgeline is a standard chart form. Draw it from real signal data and do not reproduce the album image.
- Fonts such as IBM VGA bitmap fonts have their own licences; use an open-licensed monospace instead.

#### What this changes for JARVIS / Well Wisher

**Do**
1. Treat 3:1 as the floor for every control edge, state and focus ring, and give depth a second cue (accent fill, hairline border, label). Use the raised/recessed depth for *feel* and the non-shadow cue for *legibility*. Test each token pair with a script like the one used here. Candidate pairs: charcoal text on off-white is 13.34:1 and clay-grey text must stay darker than about `#6B7788` equivalents; a clay-brown label at 3.40:1 is fine for large display or icon use but not for 12-13 px metadata.
2. Keep surface-to-surface steps in the matte palette honestly low contrast (off-white to clay is 1.31:1, deliberately), and let *edges* come from a 1 px charcoal-alpha hairline plus the inset/extrude pair, so the surface step is texture and not information.
3. Make the per-section "worlds" mostly SVG, CSS and canvas-2D: cybersigilic line work as SVG stroke draw-on, ASCII as a cell grid from a bitmap font atlas, ridgeline "data landscape" as stacked area paths from real signals (CSI amplitude, study-hours, focus traces), technical diagrams as annotated SVG. These are cheap and print well.
4. Give each workspace exactly one art centrepiece, rendered once and redrawn only on data change or on hover. Pause every animation loop on `visibilitychange`, on `IntersectionObserver` out-of-view and when the app window is not focused. Add a global reduced-motion switch that follows `prefers-reduced-motion: reduce` and also offers a manual toggle in Setup.
5. Borrow Blade Runner's state model: every instrument has idle, active and loop states, and class-coded finish (the polished JARVIS shell vs the worn, lived-in feel of old data), without making real data look fake.
6. Borrow from the game-HUD playbook: panels fade in when relevant, can be hidden or moved, and the centre of the screen stays quiet. Put mono metadata at the edges.
7. Borrow brutalism's exposed structure: visible hairline grid, labelled regions, plain system-like text for dense data. Do it as discipline, not as hostility.
8. Use the native View Transitions API for route changes with a skip path (Cydstumpel ships a view-transitions script), 150-200 ms maximum, none under reduced motion.
9. Keep the persona-led microcopy idea from Super Evil Genius, but follow the owner's "honest planned-feature controls" rule: any planned control is labelled "planned" and does nothing.
10. Replace the two dead library entries and flag the ussr.obys.agency 404; capture screenshots of each reference into the library so the library does not rot.

**Do not**
1. Do not use smooth-scroll hijacking, scroll-jacked timelines, pointer-follow WebGL distortion (Monopo) or full-screen three.js scenes for a daily surface. The roughly 120-250 KB gzip each of those stacks ships is not the main issue; a permanent GPU loop on a laptop GPU is.
2. Do not rely on shadow alone to show state, hover or focus (neumorphism's main failure), and do not put gray-on-gray text on clay.
3. Do not add entry gates, preloader percent counters or "scroll to explore" prompts (Amaterasu, Quechua). Start where the user left off.
4. Do not render Aankhen data as a decorative landscape without the simulated/measured label. A ridgeline made from simulated CSI must say "simulated" in the frame.
5. Do not build a camera-like or point-cloud "body" view from a single Wi-Fi link. One link shows that a body moved, not how it is bent; a human-shaped point cloud would be fiction.
6. Do not copy pilot-site layouts, assets or code; do not link the dead domains.
7. Do not use dark patterns (fake urgency, streak guilt copy, confirm-shaming) in the "game"-flavoured Well Wisher surfaces, whatever the reference site does.

#### Uncertain or unverified

- **Pilot site visuals.** I did not see any of the 12 sites rendered. Descriptions come from page text and from string counts in bundles. A string count shows a library is shipped, not how heavily it runs. Cydstumpel (403 to WebFetch) and Spylt (password page) in particular are unseen. "Not found" for reduced motion means no `prefers-reduced-motion` string in the first-load chunks scanned; lazy chunks, inline styles or JS `matchMedia` calls under another form were not all checked. WebFetch summaries of Amaterasu, MakeReign and Super Evil Genius could not describe visuals at all.
- **Award data.** Awwwards pages are mostly dynamic; I have the Site of the Year 2024 (Igloo Inc) and 2025 (Lando Norris) category lists but not studios, scores or techniques beyond a jury quote. No CSS Design Awards 2025 Website of the Year list, nothing from FWA, Godly (apparently renamed "Recent") or Siteinspire was retrieved. Trends in award sites here are inferred from the pilot sites and two winners, which is weak.
- **Contrast figures.** All "computed" values use my own calculation of WCAG relative luminance on hex colours taken from Setproduct's example and my illustrative off-white, clay and charcoal values, not the project's real tokens. Re-run them on the actual design tokens. The vp0 blog's claim of about 1.4:1 for a typical neumorphic edge is unverified; my own calculation for the canonical recipe is 1.27:1 and 1.72:1 depending on which edge.
- **Performance of ASCII and dither.** No benchmark found. Whether a Canvas 2D ASCII panel at 1366x768 costs less than a fragment-shader pass in WebView2 needs measuring in the real app (frame time, GPU % in Task Manager) before committing.
- **Point clouds and globes.** I did not gather a primary source on point-cloud rendering cost (three.js `Points`, deck.gl) or on globe libraries after GlobeKit's loss; treat them as open.
- **Cybersigilism origin.** Brand and blog sources only; the Berlin-club account is unverified. No design-system-level source exists. Use it as an aesthetic, not as a claimed tradition.
- **Brutalism usability.** The 2022 study's results were not read; the usability debate is opinion in the sources found.
- **GSAP licence terms and the licences of Codrops demo code** need a direct check before any bundling.
- **WebView2 specifics.** Nothing here was tested inside WebView2; MDN and Chrome guidance is for Chromium browsers in general. Occlusion handling of a WebView2 window should be tested.

### Strand 3: Open-source projects JARVIS and Well Wisher can learn from or reuse

**Question.** Which open-source GitHub projects (ASCII/dither renderers, Web Audio visualisers, neumorphic kits, HUD/sci-fi kits, terminal-style kits, headless accessible libraries, View Transitions examples, motion libraries with reduced-motion support, voice-assistant front ends, local-first habit/focus apps) could JARVIS and Well Wisher learn from or reuse, and what are their licences, weight and accessibility status?

**Method.** Run on 2026-11-12. Stars, last-push date, licence and archived flag were read live from the GitHub REST API (`gh api repos/<owner>/<repo>`; "last commit" below means the API `pushed_at` date). Licence texts of repos flagged "NOASSERTION" were read from the repo's license endpoint. Feature, size and accessibility claims came from the repos' own READMEs and official docs (WebFetch), plus bundlephobia's API for npm size. Six WebSearch queries were used for discovery only. About 45 repositories were checked; 37 are reported. No personal details were used in any query. Several fetches failed (arwes.dev refused the connection, the Open WebUI docs URL returned 404); those claims are marked unverified.

#### Findings

**A. ASCII and dither renderers**

1. [sister-software/asciify](https://github.com/sister-software/asciify): 36 stars, last push 2026-10-21, MIT. Draws character sprites to a canvas, WebGL by default (README: one draw call per frame, about 0.3 ms at 4K), falling back to Canvas2D (about 22 ms at 4K). Zero dependencies, about 8 kB gzipped (README claims). Has a Three.js composer pass and a terminal (ANSI/braille) renderer. Output is canvas pixels, not selectable text, so it needs an `aria-label` and a text alternative. Best technical fit for a "one art centrepiece" ASCII hero. Small star count means little community vetting; the numbers are the author's own.
2. [collidingScopes/ascii](https://github.com/collidingScopes/ascii): 198 stars, last push 2025-05-24, MIT. Webcam or video to ASCII on canvas, with an mp4 muxer for export. The README itself warns it is "quite resource-intensive" and can lag on slow machines. It bundles dat.gui. Useful as a reference for the pipeline, not as a dependency, and its webcam angle is irrelevant to the camera-free Aankhen rule.
3. [mir3z/aalib.js](https://github.com/mir3z/aalib.js): 247 stars, last push 2024-06-18, MIT. Pipeline of reader, pre-filter, ASCII conversion, post-filter, renderer, with a canvas renderer. Older and unmaintained, but the staged design is a clean model for a small in-house renderer.
4. [humanbydefinition/p5.asciify](https://github.com/humanbydefinition/p5.asciify): 130 stars, last push 2026-08-06, MIT, **archived**. p5.js add-on, WebGL only. p5 is a heavy dependency for a laptop app; skip.
5. [paperlesspaper/epdoptimize](https://github.com/paperlesspaper/epdoptimize): 231 stars, last push 2026-11-11, Apache-2.0. Canvas-based dithering: error diffusion (Floyd-Steinberg, Atkinson, Stucki, Sierra and others), ordered Bayer 2/4/8/16, random, blue noise, Riemersma. It has an embedded WASM engine; the blue-noise mask is a separate PNG of about 3.8 MB, and no total package size is stated. Atkinson and Bayer are the "Mac OS 1-bit" look and give the dithered data-landscape texture cheaply. The e-paper focus means we should copy the algorithms (a few dozen lines each) rather than import the package.
6. [ShadowfaxRodeo/dither-me-this](https://github.com/ShadowfaxRodeo/dither-me-this): 45 stars, last push 2025-04-22, MIT. Small JS/npm package with a Bayer ordered mode (default 4x4). Low activity.

**B. Web Audio visualisers**

7. [hvianna/audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer): 972 stars, last push 2026-07-19, **AGPL-3.0**. Zero-dependency ES module on Web Audio and Canvas, about 30 kB minified (README), with `maxFPS` cap, LED/radial/mirror modes and A to ITU-R 468 weighting. The README has no accessibility or reduced-motion guidance, and no commercial licence offer was found. AGPL is incompatible with closed or commercial reuse. Treat it as a reference only; the AnalyserNode loop it wraps is about 40 lines to write ourselves.
8. [jberg/butterchurn](https://github.com/jberg/butterchurn): 1,991 stars, last push 2026-04-20, MIT. WebGL port of MilkDrop. Bundlephobia: 196 kB raw, 43 kB gzip for the core, with presets as a separate package. Full-screen GPU shader art is the opposite of the "light on CPU/GPU" requirement and of the quiet matte look; use only as an opt-in mode if at all.

**C. Neumorphic / clay kits**

9. [saadeghi/daisyui](https://github.com/saadeghi/daisyui): 42,822 stars, last push 2026-11-09, MIT. Tailwind plugin with a theme token system. Bundlephobia shows 307 kB raw, 50 kB gzip, but that is the full plugin; output CSS depends on use. It has no neumorphic theme; relevant as a model for named theme tokens, not for the look.
10. [jsanchez91/neumo-ui](https://github.com/jsanchez91/neumo-ui): 2 stars, last push 2025-09-12, MIT. Neumorphic component set. Too small to trust; shows the genre has no mature open-source kit. Weak evidence.
11. Finding: GitHub search for "neumorphism css" returns only repos with 2 to 8 stars (for example [PedroLimaSilva/neu-css](https://github.com/PedroLimaSilva/neu-css), 8 stars, MIT). No maintained, accessible neumorphic library exists. Neumorphism has a known contrast and affordance problem (low-contrast soft shadows), so the clay/charcoal system should be built in-house from CSS tokens with enforced contrast.

**D. HUD / sci-fi / terminal kits**

12. [arwes/arwes](https://github.com/arwes/arwes): 7,574 stars, last push 2026-07-05, MIT. Futuristic sci-fi UI framework (animator, frames, backgrounds, text, bleeps/sound). The README says it is **"no longer maintained and currently outdated but it is still functional"**, targets React 18, and "does not work with React strict mode nor React Server Components". Packages are modular (animator, frames, bgs, text, bleeps), which allows picking one. Sound effects are on by default in its design; for JARVIS they would have to be opt-in. Use for ideas (frame corner brackets, staged text reveal), not as a dependency.
13. [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js): 21,349 stars, last push 2026-11-08, MIT. The terminal emulator behind VS Code. Only relevant if a real terminal pane is wanted; for a "terminal-style" look, plain mono CSS is lighter.
14. [jdan/98.css](https://github.com/jdan/98.css): 11,618 stars, last push 2025-09-07, MIT. Semantic-HTML retro styling, no JS. The model for "style plain elements, ship CSS only". [nostalgic-css/NES.css](https://github.com/nostalgic-css/NES.css): 21,857 stars, last push 2024-01-17, MIT, same idea in pixel style. Both are costume, not systems.

**E. Headless accessible component libraries**

15. [radix-ui/primitives](https://github.com/radix-ui/primitives): 19,493 stars, last push 2026-10-14, MIT. Unstyled primitives. Docs [state](https://www.radix-ui.com/primitives/docs/overview/accessibility) they follow WAI-ARIA authoring practices, manage focus, and are "tested in a wide selection of modern browsers and commonly used assistive technologies" (no AT named). `@radix-ui/react-dialog` 1.3.1 is 39 kB raw, 13 kB gzip with 23 dependency entries (bundlephobia). Best default for dialogs, menus, tabs, popovers in the modal sheets.
16. [adobe/react-spectrum](https://github.com/adobe/react-spectrum) (React Aria): 16,026 stars, last push 2026-11-12, Apache-2.0. [Docs](https://react-aria.adobe.com/) claim components are "extensively tested using many popular screen readers and devices", 30+ language translations, RTL, and a hooks API for full control. `react-aria-components` 1.22.1 is 991 kB raw, 279 kB gzip (bundlephobia, whole package before tree-shaking). Strongest a11y claims of the set; heavy unless imported per component.
17. [chakra-ui/ark](https://github.com/chakra-ui/ark) (Ark UI): 5,464 stars, last push 2026-11-12, MIT. Headless, built on Zag.js state machines, for React/Solid/Vue/Svelte (from the repo page). `@ark-ui/react` 5.40.0 is 1.07 MB raw, 297 kB gzip (whole package). Its engine [chakra-ui/zag](https://github.com/chakra-ui/zag) (5,254 stars, pushed 2026-11-12, MIT) is framework-agnostic; `@zag-js/dialog` is 45 kB raw, 14 kB gzip.
18. [ariakit/ariakit](https://github.com/ariakit/ariakit): 8,633 stars, last push 2026-11-12. GitHub API reports no SPDX licence; the repo's licence text was not read, so the licence is **unverified**; check before use.

**F. Motion with reduced-motion support**

19. [motiondivision/motion](https://github.com/motiondivision/motion): 35,086 stars, last push 2026-11-12, MIT. [Docs](https://motion.dev/docs/react-accessibility): `<MotionConfig reducedMotion="user">` follows the OS setting and disables transform and layout animation while still animating opacity and colour; `"always"`/`"never"` override it; `useReducedMotion()` returns a boolean. Bundlephobia: v14.12.0, 185 kB raw, 63 kB gzip for the full import (tree-shaken use is much smaller; not measured here). Best fit if a single motion layer is wanted.
20. [formkit/auto-animate](https://github.com/formkit/auto-animate): 13,967 stars, last push 2026-11-07, MIT. One-line list add/remove/reorder animation. Bundlephobia: 8.8 kB raw, 3.5 kB gzip, zero dependencies. I did not verify its reduced-motion behaviour from docs. Cheapest option for list transitions.
21. [pmndrs/react-spring](https://github.com/pmndrs/react-spring): 29,274 stars, last push 2026-11-01, MIT. Physics springs; v10.0.4 is 52 kB raw, 20 kB gzip. Reduced-motion handling not verified here.

**G. View Transitions**

22. [MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API): `document.startViewTransition()` for same-document changes (the case for a WebView2 SPA), `::view-transition-*` pseudo-elements, `view-transition-name`. MDN's intro lists the hazards: lost reading position, focus confusion, unexpected live-region announcements. It does not mention `prefers-reduced-motion` on that page, so a media-query override is our responsibility.
23. [Charca/view-transitions-live](https://github.com/Charca/view-transitions-live): 325 stars, last push 2024-06-05, **no licence declared** (all rights reserved by default; do not copy code). [argyleink/gui-challenges](https://github.com/argyleink/gui-challenges): 2,991 stars, last push 2025-02-19, Apache-2.0, CSS-first component patterns that can be learned from. Browser support in WebView2 (Chromium) was not verified for this strand.

**H. Voice-assistant front ends**

24. [open-webui/open-webui](https://github.com/open-webui/open-webui): 158,459 stars, last push 2026-11-12. Licence is custom ("Open WebUI License", BSD-3-style plus clause 4). Clause 4 forbids altering or removing "Open WebUI" branding unless the deployment has 50 or fewer end users in 30 days, or written permission or an enterprise licence exists. **Not OSI open source; not reusable as a white-label base.** README: self-hosted, offline-capable, Ollama/OpenAI-compatible. The voice-call overlay design is a pattern to study visually. Its docs page for audio was not retrievable.
25. [home-assistant/frontend](https://github.com/home-assistant/frontend): 5,800 stars, last push 2026-11-12, Apache-2.0; [home-assistant/core](https://github.com/home-assistant/core): 92,261 stars, Apache-2.0. The [Assist docs](https://www.home-assistant.io/voice_control/) say Assist "can run fully on your own hardware", works via a dashboard icon, the companion app, and ESPHome/Voice Preview satellites. Relevant to the ESP32 room-control side. The page did not describe the interface in detail.
26. [OHF-Voice/wyoming](https://github.com/OHF-Voice/wyoming): 415 stars, pushed 2026-11-09, MIT (voice peer protocol). [OHF-Voice/linux-voice-assistant](https://github.com/OHF-Voice/linux-voice-assistant): 695 stars, pushed 2026-11-09, Apache-2.0. Reference for a push-to-talk/satellite split.
27. TTS licence trap: [rhasspy/piper](https://github.com/rhasspy/piper) (11,325 stars, MIT) is **archived** (last push 2025-08-26). Development moved to [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (6,261 stars, pushed 2026-11-11), **GPL-3.0**. Flag as incompatible with possible commercial reuse; shipping it as a separate process (not linked) is a legal question for counsel.
28. JARVIS-named assistants, all weak reuse candidates: [isair/jarvis](https://github.com/isair/jarvis) (2,237 stars, pushed 2026-11-12): custom "Jarvis AI Assistant License", "non-commercial purposes"; [ethanplusai/jarvis](https://github.com/ethanplusai/jarvis) (978 stars, pushed 2026-09-10): custom licence, "personal, non-commercial purposes"; [PanPenek/JarvisAi](https://github.com/PanPenek/JarvisAi) (24 stars, pushed 2026-03-01): **no licence file**, so default all rights reserved, even though a third-party listing called it MIT. Do not copy code from any of the three. [KoljaB/Linguflex](https://github.com/KoljaB/Linguflex) (814 stars, pushed 2026-11-10, Apache-2.0) and [KoljaB/RealtimeSTT](https://github.com/KoljaB/RealtimeSTT) (10,242 stars, Apache-2.0) are permissively licensed.
29. Voice agent frameworks (backend, not UI): [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) (17,218 stars, BSD-2-Clause), [livekit/agents](https://github.com/livekit/agents) (15,193 stars, Apache-2.0), [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) (55,129 stars, MIT). Out of scope for the visual overhaul but safe to reference.

**I. Local-first habit and focus apps**

30. [daya0576/beaverhabits](https://github.com/daya0576/beaverhabits): 1,858 stars, pushed 2026-10-31, BSD-3-Clause. "Self-hosted habit tracking app without Goals"; SQLite or a local JSON file; a date-column grid for ticking habits. The no-goals, no-streak-pressure stance matches the "no dark patterns" rule.
31. [Hanziness/FocusTide](https://github.com/Hanziness/FocusTide): 403 stars, pushed 2025-11-22, MIT (focus timer). I did not read its source or UI. [HabitRPG/habitica](https://github.com/HabitRPG/habitica): 14,303 stars, pushed 2026-11-11, licence NOASSERTION (not checked); its gamified XP and penalty loop is what the design brief rejects. [iNikAnn/DoHabit](https://github.com/iNikAnn/DoHabit): 63 stars, AGPL-3.0, incompatible.
32. Notes apps that are local-first but copyleft: [logseq/logseq](https://github.com/logseq/logseq) (45,561 stars) and [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) (38,885 stars) are AGPL-3.0; [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) (74,480) and [tldraw/tldraw](https://github.com/tldraw/tldraw) (51,384) show NOASSERTION (custom licences, not read).

#### Numbers

| Item | Value | Source |
|---|---|---|
| asciify size | about 8 kB gzip browser, about 3 kB terminal; 0.3 ms vs 22 ms per frame at 4K (WebGL vs 2D), author-reported | [README](https://github.com/sister-software/asciify) |
| audioMotion-analyzer size | about 30 kB minified, 0 deps | [README](https://github.com/hvianna/audioMotion-analyzer) |
| butterchurn 2.6.7 | 196 kB raw / 43 kB gzip | bundlephobia API |
| motion 14.12.0 | 185 kB raw / 63 kB gzip (full import) | bundlephobia API |
| auto-animate 0.10.2 | 8.8 kB raw / 3.5 kB gzip, 0 deps | bundlephobia API |
| react-spring 10.0.4 | 52 kB raw / 20 kB gzip | bundlephobia API |
| @radix-ui/react-dialog 1.3.1 | 39 kB raw / 13 kB gzip | bundlephobia API |
| @zag-js/dialog 1.47.0 | 45 kB raw / 14 kB gzip | bundlephobia API |
| react-aria-components 1.22.1 | 991 kB raw / 279 kB gzip (whole package) | bundlephobia API |
| @ark-ui/react 5.40.0 | 1.07 MB raw / 297 kB gzip (whole package) | bundlephobia API |
| daisyui 5.7.50 | 307 kB raw / 50 kB gzip (whole plugin) | bundlephobia API |
| epdoptimize blue-noise mask | about 3.8 MB PNG | [README](https://github.com/paperlesspaper/epdoptimize) |
| Stars (checked 2026-11-12) | Open WebUI 158k, Radix 19.5k, React Spectrum 16k, Motion 35k, Arwes 7.6k, Ark 5.5k, asciify 36 | GitHub API |

#### Licences and usage concerns

- **Incompatible or restricted for commercial reuse:** audioMotion-analyzer (AGPL-3.0), piper1-gpl (GPL-3.0), DoHabit (AGPL-3.0), Logseq and Trilium (AGPL-3.0), Open WebUI (custom, branding-lock clause), isair/jarvis (non-commercial), ethanplusai/jarvis (personal non-commercial).
- **No licence declared (all rights reserved by default):** PanPenek/JarvisAi, Charca/view-transitions-live, ariakit (API reports none; unverified).
- **Permissive and safe:** asciify, collidingScopes/ascii, aalib.js, Arwes, Radix, Zag, Ark (MIT); React Aria, epdoptimize, Home Assistant, Linguflex, livekit/agents, gui-challenges (Apache-2.0); beaverhabits (BSD-3).
- Fonts: [vercel/geist-font](https://github.com/vercel/geist-font) is OFL-1.1 (3,752 stars, pushed 2026-11-06), a usable mono for metadata.
- NOASSERTION from the API does not mean "free"; for Jan, Habitica, AFFiNE and tldraw I did not read the full terms (Jan's text opens as Apache-2.0).

#### What this changes for JARVIS / Well Wisher

1. **ASCII centrepiece:** write a small in-house canvas renderer (precomputed glyph atlas, WebGL optional) modelled on asciify's design. Cap at 30 fps, pause when the window is hidden, render once for reduced motion. Provide an `aria-label` and a real text alternative.
2. **Dither texture:** implement Bayer and Atkinson ourselves (tens of lines) for data-landscape graphics and the grain on clay surfaces; do not add epdoptimize.
3. **Audio visualiser:** build on `AnalyserNode.getByteFrequencyData` directly, with a frame cap. Do not use audioMotion (AGPL). Butterchurn stays out of the default experience.
4. **Neumorphism:** nobody maintains an accessible kit, so build tokens in-house: raised/recessed shadows paired with a real border or contrast ramp so affordances survive low-contrast displays.
5. **HUD sections:** borrow Arwes's ideas (corner frames, staged text) as plain CSS/SVG. Do not depend on an unmaintained React-18-only framework with no strict-mode support.
6. **Modals, menus, tabs:** use Radix primitives per package (about 13 kB gzip for a dialog) for the Setup and Phone sheets. Reserve React Aria for date and number fields if needed, and import per component.
7. **Motion:** one layer, either `motion` with `MotionConfig reducedMotion="user"` or CSS plus auto-animate (3.5 kB). Add a `prefers-reduced-motion` override to every View Transition we write, and move focus deliberately after a transition.
8. **Voice UI:** study Open WebUI and Home Assistant Assist visually only. Use permissive backends (whole stack already local); avoid GPL Piper builds unless counsel agrees on process isolation.
9. **Habits/focus:** adopt beaverhabits's no-goals grid and Loop-style plain ticking; reject Habitica-style penalties.
10. **Separability:** keep the shared kit to MIT/Apache/BSD packages so JARVIS and Well Wisher can be split or sold later without a licence audit.

#### Uncertain or unverified

- Star counts and push dates are a snapshot from 2026-11-12; "last commit" is the API `pushed_at`, which can include non-default-branch pushes.
- Performance numbers for asciify (0.3 ms / 22 ms) are the author's claims; I did not benchmark them in WebView2.
- Bundle sizes are bundlephobia's whole-package numbers; tree-shaken real-app cost will be lower, especially for Motion, React Aria and Ark.
- Reduced-motion behaviour of react-spring, auto-animate, Arwes and Radix animations was not verified.
- Accessibility claims for Radix and React Aria are vendor statements; I ran no screen reader tests.
- Ariakit's licence, and the full terms of Habitica, Jan, AFFiNE and tldraw, were not read.
- Arwes docs (arwes.dev) and the Open WebUI audio docs were unreachable; their voice features were not verified. Home Assistant's Assist interface details were not on the fetched page.
- WebView2 support for View Transitions and `@view-transition` was not checked.
- A PanPenek/JarvisAi claim of MIT came from a third-party listing and conflicts with the repo, which has no licence file.

### Strand 4: Ethical retention and task follow-through for ADHD-like attention difficulties in students

**Question.** Which retention and follow-through patterns are supported by evidence, which are trend language, which cause harm or legal exposure, and what may JARVIS / Well Wisher say about them? Scope: implementation intentions, task decomposition and tiny starts, time blindness and visible timers, body doubling, streaks and loss aversion, self-compassion and recovery, variable rewards, gamification, self-determination theory (SDT), notification load, dark-pattern taxonomies and regulation, ADHD digital interventions, UK/EU wellbeing-claim rules.

**Method.** Desk research on 2026-11-12 using WebSearch (about 20 queries, no personal details in any query) and WebFetch. Fetches that returned usable primary text: the arXiv body-doubling paper, the SpringLex copy of DSA Article 25, the FTC press release on the 2022 dark-patterns report, and the Mobbin streak article (commercial). Failed fetches: the FDA press release (404), EUR-Lex (empty), the FTC report landing page (PDF link only), the PMC time-perception meta-analysis (bot check). For those, claims rest on search-result extracts and are flagged below. About 28 distinct sources were consulted. Peer-reviewed papers are marked [PR]; regulators/official pages [OFF]; vendor, blog or law-firm pages [SEC] (secondary, treat as unverified). Nothing was read from the JARVIS repository for this strand; design consequences are inferred from the brief.

#### Findings

**1. Implementation intentions (if-then plans) are the best-supported pattern, but the headline effect is inflated.**
- Gollwitzer and Sheeran (2006), Advances in Experimental Social Psychology 38:69-119, pooled 94 independent tests (over 8,000 participants) and reported d = 0.65 for added goal attainment beyond goal intentions alone [PR, via [secondary summary](https://siliconcanals.com/t-implementation-intentions-when-where-how-goal-achievement/) and a [glossary entry](https://www.thebehavioralscientist.com/glossary/implementation-intentions) that warns d is not a 65% success rate].
- The 2024 update (Sheeran, Listrom, Gollwitzer; European Review of Social Psychology, [DOI 10.1080/10463283.2024.2334563](https://informahealthcare.com/doi/full/10.1080/10463283.2024.2334563?src=exp-la)) covers 642 tests and reports .27 <= d <= .66 across cognitive, affective and behavioural outcomes. Secondary sources say bias-corrected estimates drop to d = 0.35 (trim-and-fill) and d = 0.15 (95% CI 0.08-0.22, robust Bayesian) ([summary](https://siliconcanals.com/?p=107751)). I could not verify the bias-corrected figures from the paper itself. Design stance: plan for a small-to-moderate effect, not d = 0.65.
- Children: a 2026 meta-analysis (Breitwieser et al., Br J Psychol) is reported at 52 effect sizes, over 12,000 children, g = 0.31, larger for academic and social goals than health goals ([aggregator](https://www.omnicuris.com/medshots/daily_updates/implementation-intentions-children-self-regulation); verify the original).
- ADHD-specific evidence is small and child-focused: if-then plans improved Go/NoGo inhibition in children with ADHD ([Gawrilow and Gollwitzer 2008](https://www.socmot.uni-konstanz.de/publications/implementation-intentions-facilitate-response-inhibition-adhd-children)) and delay of gratification (outpatient ADHD n = 47 vs comparison n = 40; [Gawrilow, Gollwitzer, Oettingen 2011](https://www.socmot.uni-konstanz.de/sites/default/files/Gawrilow_Gollwitzer_Oettingen_Delay_2011-2.pdf)). Lab tasks, not real-world study behaviour; no adult-student ADHD trial was found.

**2. Task decomposition and "two-minute starts" are plausible practice, not proven interventions.**
- Search found no randomised trial isolating task breakdown for students with ADHD. What exists is practitioner guidance (for example [University of Minnesota](https://effectiveu.umn.edu/academics/adhd-executive-functioning/adhd-skills-getting-started)) and a single-case AB study of 24 Japanese university students with ADHD tendencies using a brief procrastination CBT programme (preliminary, no control, decomposition not isolated) ([record](https://www.ebsco.com/articles/health-and-medicine/18d9eec6-0893-5def-a3f3-ee419545b237/effects-of-a-procrastination-intervention-for-japanese-university-students-with-attention-deficit-hyperactivity-disorder-tendencies-an-interrupted-time-series-analysis)).
- "Two-minute rule" is popular-productivity language with no primary trial behind it in these results. The nearest sound mechanism is the if-then start cue (finding 1). Treat "first step small" as a design hypothesis to test, not a claim.

**3. Time blindness is real as a research finding in ADHD; visible timers as a fix are not proven.**
- Meta-analysis of 27 studies (1,620 ADHD, 1,249 controls, children and adolescents): less accurate (Hedges g > .40) and less precise (g = .66) time perception, tendency to overestimate ([Zheng et al. 2020, as summarised in search results](https://pmc.ncbi.nlm.nih.gov/articles/PMC7864812); page itself not retrievable).
- All-ages meta-analysis: 55 studies, deficits in estimation and production accuracy ([Marx et al. 2022, via search extract](https://hub.hku.hk/handle/10722/309307)). Reliability of the time-reproduction paradigm was poor in controls and fair in ADHD, so lab effect sizes are noisy.
- Visible timers: no controlled evidence found. Time Timer's own claims are manufacturer marketing ([vendor page](https://timetimer.com/pages/time-timer-in-special-needs)); other cited studies (preschoolers, an unverified OT study) could not be confirmed. A therapist note says a silent shrinking disc can startle anxious children ([blog](https://learnwithdremily.substack.com/p/but-timers-make-my-kid-anxious)); anecdote only.

**4. Body doubling: popular, thinly evidenced.**
- The only controlled adult-ADHD-screened study found is an arXiv preprint: 12 adults (ASRS-screened, not clinically diagnosed), 20-minute VR task, within-subjects. Efficiency was higher with human (p = .040) and AI doubles (p = .030) than alone; accuracy did not differ; self-reported sustained attention was higher (chi-squared 18.82). The authors state no prior peer-reviewed controlled trial existed and cite a null ADHD study (Born 2024) and a survey of 220 users (Eagle et al.) ([arXiv 2509.12153](https://arxiv.org/html/2509.12153v1)).
- A UK survey of 117 adults from a co-working company reports benefits, but it is self-report from a vendor ([neurodiversity.org write-up](https://neurodiversity.org/?p=11449)). A researcher quoted by [Popular Science](https://www.popsci.com/health/body-doubling-focus-benefits/) said some people with ADHD may do worse with a body double. Verdict: offer as opt-in, low-risk presence feature; make no efficacy claim.

**5. Streaks, loss aversion and the what-the-hell effect: concept sound, app-level numbers weak.**
- The what-the-hell effect (one perceived slip triggers abandonment) comes from dieting research (Polivy and Herman). It is a mechanism, not a measured streak-app effect.
- The common "88% quit within 7 days of breaking a 30-day streak" style numbers have no traceable source in the results; the same goes for a "2020 CHI streak anxiety" claim. Treat as marketing ([roundup of blog claims](https://dev.to/eastkap/the-hidden-psychology-of-why-we-abandon-habit-apps-and-what-actually-works-36g6)).
- Mobbin analysed 859 streak designs: streaks nearly always count days opened rather than learning, and many use fear/loss framing. It is design-prevalence description by a design-tools company, not user-outcome data. It also repeats unverifiable Duolingo internal figures (lower daily bar kept over 40% more users on a 7-day streak; streak freeze brought 200,000 more daily returners) ([Mobbin](https://mobbin.com/blog/streaks-are-about-losing-a-study-of-859-streak-designs)).
- Better anchor: Lally et al. 2010 (European Journal of Social Psychology) studied 96 people over 84 days; median 66 days to plateau for the 39 who met criteria, range 18 to a projected 254; secondary sources say a single missed day did not materially change the trajectory ([BPS Digest](https://bps.org.uk/research-digest/how-form-habit), [critical read](https://www.thebehavioralscientist.com/?p=8902)). Lally says 66 days is routinely misquoted. Habits here were simple health behaviours in mostly healthy adults, not study sessions in ADHD.

**6. Self-compassion after missed days: supported for motivation, correlational for procrastination.**
- Breines and Chen 2012 (PSPB 38:1133-1143), four experiments: self-compassionate framing after failure increased motivation to improve and time spent studying after a failed test, versus self-esteem and neutral controls ([PubMed](https://pubmed.ncbi.nlm.nih.gov/22645164/)). I saw abstracts and summaries only, not effect sizes. Student samples, lab inductions.
- Sirois (2014, Self and Identity), four samples about 1,000 mostly undergraduates: trait procrastination correlated with lower self-compassion and higher stress; self-compassion mediated the link; causality not shown ([White Rose copy](https://eprints.whiterose.ac.uk/91791/)). A 2023 meta-analysis (25 studies, over 7,500 participants, r = -.25) is reported only via [Wikiversity](https://en.wikiversity.org/wiki/Motivation_and_emotion/Book/2025/Self-compassion_and_academic_procrastination); verify.
- Design inference: copy that meets a lapse with a neutral, kind "pick up here" supports re-entry. This is inference from lab and correlational work, not a tested app intervention. Wohl 2010 (forgiving oneself and procrastination) was not located.

**7. Variable rewards: no evidence of benefit for follow-through; harm framing is argument, not trial.**
- Variable-ratio schedules originate in Ferster and Skinner (1957) and underlie gambling-style engagement. The "pull-to-refresh is a slot machine" claim is Tristan Harris's testimony, not a controlled finding ([secondary report](https://maketecheasier.com/mte-google-s-former-design-ethicist-tristan-harris-testified-to-the-us-senate-in-201/)). I found no large causal study linking app variable rewards to problematic use. Still, regulators now name the pattern (finding 11), and it conflicts with the autonomy need in SDT. Avoid on principle plus regulatory risk, not because a trial proved harm.

**8. Gamification: modest average benefit, unstable behavioural effect, evidence on decay is thin and mixed.**
- Sailer and Homner 2020 (Educational Psychology Review 32:77-112): cognitive g = .49 (95% CI .30-.69, k = 19, N = 1,686); motivational g = .36 (.18-.54, k = 16, N = 2,246); behavioural g = .25 (.04-.46, k = 9, N = 951), the least stable ([Augsburg repository](https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/109056)). Game fiction and social interaction moderated behavioural effects ([Gamification Research Network summary](https://gamification-research.org/2019/08/does-gamification-of-learning-work/)).
- Bai, Hew and Huang 2020 (Educational Research Review): 30 interventions from 24 studies, g = 0.504 (95% CI .284-.723); effect varied with sample size and duration ([listing](https://www.gbl.uzh.ch/quartz/references/Bai-et-al.-(2020))). Duration moderators suggest longer interventions can help, which runs against a pure novelty-decay story, but this is not a direct novelty test.
- Counter-evidence: Hanus and Fox 2015 (Computers and Education 80:152-161), about 71 students over a 16-week term: badges and a leaderboard course produced lower motivation, satisfaction and empowerment, and lower exam scores mediated by intrinsic motivation ([summary](https://www.smhp.psych.ucla.edu/pdfdocs/gamil.pdf)). Koivisto and Hamari 2019 reviewed 819 studies and call the mixed results "remarkable" ([Turku record](https://research.utu.fi/converis/portal/detail/Publication/39369087)). I did not find a clean quantified novelty-decay estimate; do not cite one.
- Ethical read: gamification meta-analyses are mostly short, in classrooms, with publication-bias risk. They do not license loss framing.

**9. SDT is the strongest design framework for avoiding coercion.**
- Peters, Calvo and Ryan 2018 (Frontiers in Psychology 9:797, METUX): design for autonomy, competence and relatedness across six spheres; engagement and enjoyment do not necessarily deliver sustainable wellbeing; five questionnaires to measure need satisfaction ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5985470)). It is a framework with practical instruments, not an effect-size study. Use its instruments as the app's own acceptance metric instead of raw session counts.

**10. Notification fatigue: evidence supports fewer, predictable prompts.**
- Kushlev, Proulx and Dunn, CHI 2016: 221 UBC students, within-person one week on vs one week off; alerts on produced higher self-reported inattention and hyperactivity, which predicted lower productivity and wellbeing. The authors explicitly say this does not show phones cause ADHD or that silencing treats it ([UVA release](https://news.virginia.edu/node/213646), [paper](https://www.interruptions.net/literature/Kushlev-CHI16.pdf)).
- Fitz et al. 2019 (Computers in Human Behavior 101): 237 participants, randomised; batching three times a day reduced stress and raised wellbeing; hourly batching changed little; turning off fully raised anxiety/FoMO ([Duke record](https://scholars.duke.edu/publication/1402953)). The "India, two weeks" detail is unverified.

**11. Dark-pattern taxonomies and regulation.**
- Gray et al., CHI 2018 (Purdue): five strategies from 118 practitioner-identified patterns: nagging, obstruction, sneaking, interface interference, forced action ([paper copy](https://classes.cs.uchicago.edu/archive/2020/fall/33231-1/readings/2018_Grayetal_CHI_DarkPatternsUXDesign)). Wording was verified only second-hand.
- Mathur et al., CSCW 2019: crawl of about 11K shopping sites, about 53K product pages, 1,818 instances in 15 types and 7 categories; 22 third-party vendors sell dark patterns as turnkey ([arXiv 1907.07032](https://arxiv.org/pdf/1907.07032)). Shopping context; the lesson transfers by analogy (countdown urgency, nagging, confirm-shaming), not by direct measurement.
- EU DSA Article 25: online platforms must not design interfaces that deceive or manipulate or materially impair free and informed decisions; practices covered by the UCPD or GDPR are carved out; the Commission may issue guidelines on prominence, repeated re-asking and cancellation harder than sign-up ([SpringLex text](https://www.springlex.eu/en/packages/dsa/dsa-regulation/article-25/)). It binds online platforms, so a local-first single-user app is probably outside it; it is still the clearest statement of the norm. Recital 67 does not require intent ([commentary](https://www.deceptive.design/book/contents/chapter-30)).
- EU Digital Fairness Act: consultation ran 17 July to 24 October 2025; the Commission's examples of addictive design include infinite scroll, autoplay, streaks, ephemeral content, read receipts and push notifications; proposal not confirmed as published at time of writing ([Slaughter and May](https://thelens.slaughterandmay.com/post/102kxp5/digital-fairness-act-european-commission-launches-consultation-and-call-for-evid), [Osborne Clarke](https://www.osborneclarke.com/insights/digital-fairness-act-unpacked-addictive-design)). The Commission's 2026 preliminary DSA findings against Meta over addictive design are reported only second-hand.
- FTC "Bringing Dark Patterns to Light" (15 Sept 2022): four tactics: misleading/disguised ads and false countdown timers; hard-to-cancel subscriptions; buried terms and junk fees; tricking people into sharing data ([FTC press release](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers)). Appendix lists 30+ patterns. A false countdown is explicitly a deceptive pattern, so urgency timers on streaks risk that category.

**12. ADHD digital interventions and permitted claims.**
- EndeavorRx (Akili) was FDA-authorised via De Novo DEN200026 (15 June 2020) for children aged 8-12 with primarily inattentive or combined ADHD, as an adjunct, not stand-alone. Pivotal STARS-ADHD: 348 children, 4 weeks, double-blind digital control; TOVA Attention Performance Index change 0.93 vs 0.03 (p = 0.006); reported not to separate from control on the clinician ADHD Rating Scale or Clinical Global Impressions ([FDA review via Innolitics](https://fda.innolitics.com/device/DEN200026), [Psychiatric News](https://psychiatryonline.org/doi/10.1176/appi.pn.2020.8a5); discrepancy on secondary endpoints noted by sources). Lesson: even the authorised product shows a lab-measured attention effect in children, after a regulated trial, with a narrow label. Nothing transfers to a student productivity app.
- Adults: computerised cognitive training meta-analysis g = 0.235 (95% CI .002-.467) on cognition ([Neuropsychology 37(5)](https://aminer.org/pub/640b0e2e90e50fcafd11eed8/computerized-cognitive-interventions-for-adults-with-adhd-a-systematic-review-and-meta)); a 36-RCT Molecular Psychiatry meta-analysis found no clinically meaningful symptom reduction, at most small short-term inattention gains ([Southampton](https://southampton.ac.uk/psychology/news/2023/04/online-cognitive-training.page)); an umbrella review of 26 reviews calls effectiveness inconclusive, low quality ([BMC Psychiatry 2025](https://doaj.org/article/789ef3c13fd143468097858bb49f61e5)).
- UK rules: MHRA treats intended purpose, as shown in labelling, app-store text and social media, as the test; a disclaimer does not override it ([NHE on MHRA guidance](https://www.nationalhealthexecutive.com/articles/mhra-issues-new-safety-guidance-digital-tools)). The ASA has upheld rulings against apps implying ADHD treatment, management or diagnosis without being a registered medical device, under CAP Code rules 1.10, 12.1 and 12.2: Motion, Impulse Brain Training (GMRD Apps), and Happyo ([Osborne Clarke on Motion](https://marketinglaw.osborneclarke.com/advertising-regulation/motions-calendar-app-time-for-more-care-on-medical-claims/), [GMRD ruling](https://www.asa.org.uk/rulings/gmrd-apps-ltd-a23-1215012-gmrd-apps-ltd.html), [Happyo ruling](https://www.asa.org.uk/rulings/happyo-a23-1215015-happyo.html)). The ASA also advises health-app claims reflect actual functionality and evidence ([ASA](https://www.asa.org.uk/news/a-pulse-check-for-health-apps-when-does-software-become-a-medical-device.html)). The product is built in a UK/EU-adjacent context per the brief, so treat these as binding house rules for copy.

#### Numbers

| Fact | Value | Source |
|---|---|---|
| Implementation intentions, 2006 meta-analysis | d = 0.65, 94 tests, over 8,000 participants | [summary](https://siliconcanals.com/t-implementation-intentions-when-where-how-goal-achievement/) |
| Implementation intentions, 2024 meta-analysis | 642 tests, d .27-.66; bias-corrected d 0.35 / 0.15 (secondary only) | [ERSP](https://informahealthcare.com/doi/full/10.1080/10463283.2024.2334563?src=exp-la), [summary](https://siliconcanals.com/?p=107751) |
| Implementation intentions in children | g = 0.31, 52 effects, over 12,000 children | [aggregator](https://www.omnicuris.com/medshots/daily_updates/implementation-intentions-children-self-regulation) |
| If-then plans, ADHD children, delay task | ADHD n = 47, comparison n = 40 | [Gawrilow 2011](https://www.socmot.uni-konstanz.de/sites/default/files/Gawrilow_Gollwitzer_Oettingen_Delay_2011-2.pdf) |
| ADHD time perception (children) | g > .40 accuracy, .66 precision; 27 studies, 1,620 ADHD vs 1,249 controls | [Zheng 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7864812) |
| ADHD time perception (all ages) | 55 studies | [Marx 2022](https://hub.hku.hk/handle/10722/309307) |
| Body doubling, VR study | n = 12; efficiency p = .040 (human), .030 (AI) | [arXiv](https://arxiv.org/html/2509.12153v1) |
| Habit formation | 96 people, 84 days, median 66 days (n = 39), range 18 to 254 projected | [BPS](https://bps.org.uk/research-digest/how-form-habit) |
| Gamification, cognitive / motivational / behavioural | g .49 / .36 / .25; N 1,686 / 2,246 / 951 | [Sailer and Homner](https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/109056) |
| Gamification, overall (Bai) | g = 0.504, 30 interventions | [Bai 2020](https://www.gbl.uzh.ch/quartz/references/Bai-et-al.-(2020)) |
| Gamified course, 16 weeks | about 71 students, lower motivation and exam scores | [Hanus and Fox](https://www.smhp.psych.ucla.edu/pdfdocs/gamil.pdf) |
| Gamification literature size | 819 studies reviewed | [Koivisto and Hamari](https://research.utu.fi/converis/portal/detail/Publication/39369087) |
| Notifications on vs off | 221 students; higher inattention/hyperactivity symptoms | [Kushlev 2016](https://news.virginia.edu/node/213646) |
| Notification batching | 237 participants; 3 batches/day helped, hourly did not | [Fitz 2019](https://scholars.duke.edu/publication/1402953) |
| Dark patterns, shopping crawl | about 11K sites, about 53K pages, 1,818 instances, 15 types | [Mathur 2019](https://arxiv.org/pdf/1907.07032) |
| Gray taxonomy | 5 strategies, 118 practitioner patterns | [Gray 2018](https://classes.cs.uchicago.edu/archive/2020/fall/33231-1/readings/2018_Grayetal_CHI_DarkPatternsUXDesign) |
| EndeavorRx pivotal trial | 348 children, 4 weeks, TOVA API 0.93 vs 0.03, p = 0.006 | [FDA review](https://fda.innolitics.com/device/DEN200026) |
| Adult computerised cognitive training | g = 0.235 (95% CI .002-.467) | [Neuropsychology](https://aminer.org/pub/640b0e2e90e50fcafd11eed8/computerized-cognitive-interventions-for-adults-with-adhd-a-systematic-review-and-meta) |
| Self-compassion and procrastination | r = -.25, 25 studies, over 7,500 (unverified) | [Wikiversity](https://en.wikiversity.org/wiki/Motivation_and_emotion/Book/2025/Self-compassion_and_academic_procrastination) |
| DFA consultation | 17 Jul to 24 Oct 2025 | [Slaughter and May](https://thelens.slaughterandmay.com/post/102kxp5/digital-fairness-act-european-commission-launches-consultation-and-call-for-evid) |

#### Licences and usage concerns
- All sources are cited by link and paraphrased; no text or figures are reproduced beyond short quoted facts. Papers were not downloaded or redistributed.
- Body-doubling and visible-timer "evidence" in vendor pages (Time Timer, FLOWN, Mobbin, habit-app blogs) is marketing. Do not reuse their numbers in product copy.
- Do not reuse Akili/EndeavorRx wording or trial figures in marketing; borrowing a regulated product's claims implies a regulatory status JARVIS does not have.
- The SDT questionnaires from METUX are published instruments; check each instrument's licence before embedding them verbatim.
- Regulation summaries are from law-firm and advocacy sources; they are not legal advice. A UK/EU-qualified reviewer should check the final copy before any public launch.

#### What this changes for JARVIS / Well Wisher

**What the product may say.** "Helps you plan when and where you will start", "break a task into steps", "see how long a block has run", "pick up where you left off". Honest, plain functions with no outcome promise.
**What it may not say.** Anything that implies diagnosis, treatment, management, reduction or cure of ADHD or its symptoms ("manage your ADHD", "fixes focus", "clinically proven", "ADHD mode as therapy", "screens for ADHD", test-style CTAs). Also no "scientifically proven to build habits" or numerical retention claims, and no use of "neurodivergent-friendly" as an efficacy claim. "Designed with attention difficulties in mind" is acceptable only if the design basis is stated without outcome promises. Keep app-store text, README and in-app copy consistent because the MHRA/ASA tests look at all promotional material.

**Ranked: USE (evidence plus low harm).**
1. If-then start planning ("When X, I will open Y for 10 minutes"), editable, optional, with the plan resurfacing at the cue time. Framing: small-to-moderate effect, not d = 0.65.
2. Missed-day re-entry: neutral, kind, one-tap "resume" with no counter reset to zero and no guilt copy (Breines and Chen; what-the-hell logic). Never show a penalty.
3. Notification budget: default to at most three batched check-ins a day, user-set, silent by default on first install, one tap to mute; never use urgency language (Fitz; Kushlev).
4. Elapsed-time display that is calm and opt-in (shrinking disc or bar, no flashing, no countdown pressure, silent end option). Justified by time-perception research; treat benefit as unproven.
5. Task splitting with the user in control: suggest a next small step, let them edit; never auto-lock a task into micro-steps.
6. SDT checks as the quality bar: every feature answers "who chose this, can I decline it, does it show I got better, does it connect me to someone I chose".

**Ranked: TEST (A/B in the user's own data only, local, no external telemetry).**
1. Streak alternative: rolling "days this week" or consistency rate with built-in rest days, versus plain total-days; measure return after a gap, not opens.
2. Body-double presence (silent co-working timer with a stub or optional person); self-report fit only.
3. Visible timer styles (disc vs bar vs none) measured by self-reported anxiety and block completion.
4. Light gamification limited to competence feedback (progress, skills tree) with no leaderboards or loss mechanics; Hanus and Fox warns against badges plus rankings.
5. Cue-time prompt wording (plan echo vs generic nudge); one sentence, no emojis, no guilt.
6. Two-minute start: label as "tiny start", test whether starts happen, not whether tasks finish.

**Ranked: MUST NOT USE.**
1. Loss-framed streaks, countdown-to-loss timers, streak repair purchases, "you'll lose your tree" copy, guilt copy ("your plant is dying"). These match FTC false-urgency and the DFA's named streak example.
2. Variable or randomised rewards (loot, mystery boxes, unpredictable praise), and pull-to-refresh novelty content.
3. Nagging: repeated re-asking after a decline, escalating notification frequency, notifications engineered around the user's lapse, "we miss you" re-engagement (Gray's nagging; DSA 25(3)).
4. Obstruction or interface interference: hard-to-find mute, export, delete or reset; confirm-shaming; default-on engagement features; harder to leave than to start.
5. Fake measurement: invented progress scores, fabricated "focus score" or attention estimate, simulated data shown as measured. Consistent with the existing Aankhen rule.
6. Social comparison leaderboards and any claim or screening that reads as ADHD diagnosis or treatment. Also no use of sensing (Wi-Fi CSI) to infer attention or emotion for retention nudges without explicit, revocable consent.
7. Reward systems that substitute for the task (points for opening the app); count completed planned actions, not opens.

**Architecture notes.** Keep any engagement analytics local and visible to the user; give a "why am I seeing this" line on every nudge; honour a single "quiet mode" that disables all nudges and cannot be undone by the app. Separate the two products' copy: Well Wisher (study) may name academic goals; JARVIS (home/system) should not borrow student-wellbeing claims.

#### Uncertain or unverified
- Bias-corrected implementation-intention estimates (d = 0.35, 0.15) are from secondary blogs; the 2026 children's meta-analysis (g = 0.31) is from an aggregator. Verify against the papers before quoting.
- Zheng 2020 and Marx 2022 numbers come from search extracts; the PMC page was not retrievable.
- Lally 2010 "one missed day does not matter" is secondary-source; healthy adults, simple behaviours.
- Any streak-break abandonment percentage (88%, "CHI 2020 streak anxiety") is unsourced. Duolingo figures are company statements.
- Breines and Chen effect sizes, the Sirois-line meta-analysis (r = -.25), and Wohl 2010 were not checked at primary level.
- Whether JARVIS or Well Wisher is a "regulated medical device" depends on final copy and function; MHRA's 2026 mental-health-app guidance was read via a trade summary only. Legal review recommended.
- The DSA's scope (online platforms) may not cover a local-first app; the DFA proposal text was not confirmed as published. The Commission's Meta findings are second-hand.
- FDA primary press release was a 404; EndeavorRx details come from the De Novo review mirror and trade press, with a noted conflict on secondary endpoints.
- No source found for adult ADHD students on any of: task decomposition, visible timers, body doubling at scale. All design consequences for that group are inference from child, general-adult or lab data.

### Strand 5: Where a model belongs in Well Wisher and JARVIS, and where a rule is better

**Question.** Does an AI or personalisation model meaningfully belong in Well Wisher (student life OS) and JARVIS (local personal OS), and where is a simple rule better? Candidates: next-best-action ranking for study blocks, spaced-repetition schedulers (FSRS vs SM-2), knowledge tracing (BKT vs DKT vs weighted averages), procrastination/energy prediction, local LLM coaching on a 6 GB VRAM RTX 4050 laptop, VAD and wake word, and embedding retrieval for Hinglish memory.

**Method.** Session date 2026-11-12. Ran about 14 web searches and 16 page fetches (primary sources preferred: the srs-benchmark repo, the FSRS wiki, Anki docs, arXiv/JEDM papers, Silero and openWakeWord repos, Hugging Face model cards). Read the project's own `docs/DECISIONS.md` and requirements files (read-only) to see what is already shipped. Several fetches returned only partial pages (flagged in "Uncertain"). No personal data was used in any query.

#### Findings

**0. What the repo already runs (so the real question is "add or not").** The shipped stack already has Qwen3-4B-Instruct-2507 through Ollama at about 50 tok/s and 2.9-3.3 GB on the RTX 4050, `bge-small` embeddings on CPU (to keep VRAM for the LLM), `openwakeword==0.6.0` for "hey jarvis", and Whisper large-v3-turbo on CUDA ([DECISIONS.md](file:///c:/Projects/JARVIS/docs/DECISIONS.md), [requirements.gpu.txt](file:///c:/Projects/JARVIS/requirements/requirements.gpu.txt)). The project's own diagnosis of a 22-52 s lag was that "the context was the defect, not the model"; retrieval and prompt hygiene beat a bigger model. `multilingual-e5-small` for Hinglish was listed as "the next memory step. Not measured yet."

**1. Spaced repetition: use FSRS, not SM-2, and keep it a transparent scheduler.**
- FSRS models three values per card, retrievability, stability, difficulty (DSR); FSRS-6 has 21 parameters and uses same-day reviews ([ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)).
- On the public benchmark of 9,999 Anki collections and about 350 M reviews (no same-day), FSRS-6 scores log loss 0.3460, RMSE(bins) 0.0653, AUC 0.7034; FSRS-4.5 0.3625; FSRS v4 0.3726; the no-learning average baseline 0.3945 ([srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark)). The 2.76 M-parameter RWKV model reaches 0.2773 and AUC 0.8329 but is a research model, not a drop-in.
- A plain 34-parameter FSRS-7 variant and a 0-parameter MOVING-AVG baseline sit close: 0.3401 and 0.3369 log loss. Lesson: the gap between "fancy" and "very simple" is small on log loss; AUC is where the learned models separate (0.70 vs 0.72 vs 0.83).
- FSRS-6 has lower log loss than Anki SM-2 for 99.6 % of users, but SM-2 "wasn't designed to predict probabilities" and is scored through an added interval-to-probability converter, so the authors say there is "no way to have a truly fair" comparison ([Expertium benchmark](https://expertium.github.io/Benchmark.html)). SuperMemo disputes the metrics ([SuperMemo post](https://supermemo.com/en/blog/supermemo-is-better-than-fsrs-by-far)), which is a competitor with a commercial interest.
- Cold start matters for a new student: optimised FSRS-6 beats its own default parameters for only 84.3 % of collections, and the author attributes the rest to over-fitting when there are few reviews (same Expertium page). Defaults were fitted on several hundred million reviews from about 10 k users and still beat SM-2 per the FSRS wiki.
- Review-reduction claim: about 20-30 % fewer reviews than SM-2 for the same retention, from simulation, not a randomised trial (ABC of FSRS, updated 2026-02-12). Treat as marketing-adjacent.
- Anki's own FAQ says FSRS needs fewer reviews and handles delayed cards better, with desired retention as the one user knob ([Anki docs](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)). Reasonable desired-retention range stated: 70-97 %.
- Earlier academic basis: the KDD 2022 SSP-MMC scheduler, trained on 220 M students' logs and deployed in MaiMemo, reports 12.6 % improvement over prior methods ([DBLP/KDD](https://dblp1.uni-trier.de/rec/conf/kdd/YeSC22.html); code MIT at [SSP-MMC](https://github.com/maimemo/ssp-mmc)).

**2. Knowledge tracing for topic proficiency: neither BKT nor DKT. Use an exponentially weighted average with a confidence count; upgrade to regression only with data.**
- DKT (RNN) claimed "substantial improvements" over BKT ([Piech et al. 2015](https://arxiv.org/abs/1506.05908)).
- A rebuttal showed BKT extended with recency, trial context, skill similarity and learner ability is "statistically indistinguishable" from DKT ([Khajah et al. 2016](https://arxiv.org/abs/1604.02416)).
- On nine datasets, logistic regression with good features led on moderate-size and very-long-sequence data; DKT led on large data; Markov methods such as BKT lagged ([Gervet et al., JEDM 2020](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/451), summarised via search). Later work found stepwise/LASSO regression simpler and more accurate than DKT, SAKT and IKT on all tested sets ([Pavlik and Eglington, JEDM 2023](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/722)).
- A single student produces tens to low thousands of events. All published wins for deep models are on class-scale or platform-scale data, so none transfers to a one-user local app.

**3. Procrastination / energy prediction: do not ship a predictor; show the user's own log.**
- Papers report 90-97 % accuracy, but with small samples (51 students in one Moodle study), clustering-derived labels, and course-level rather than person-level targets ([PMC7516418](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7516418/) and the search roundup). A study of about 1,800 students predicting from two weeks of LMS data got roughly 50 % (same roundup). These are population models; a single user's logs will be far thinner.
- Better design: a descriptive heat-strip of when the user's focus sessions actually completed (counts, not predictions), and a rule such as "you completed 4 of 5 sessions started before 11:00; 1 of 6 after 21:00". That is honest, instant, and cannot be "wrong" in a way that feels like a judgement.

**4. Next-best-action ranking for study blocks: a transparent rule score, not a learned ranker.**
- No published evidence was found that a learned ranker beats a deadline-weighted heuristic at single-user scale (a gap in the search; see Uncertain). The inputs that actually carry signal are known: days to exam, syllabus weight, current proficiency (item 2), FSRS due cards (item 1), time available.
- A rule `score = urgency x gap x weight` with each term shown on the card is explainable, free, and lets the user override. Learning from accept/skip clicks is a bandit problem that needs hundreds of decisions per context; a student gives perhaps one decision per day.

**5. Local LLM coaching: yes, but narrow. Phrase, summarise and explain with retrieved facts; never compute or judge.**
- Qwen3-4B (Apache-2.0) Q4_K_M is 2.5 GB; native context 32,768 tokens ([model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF)). The project measured 50 tok/s and 2.9-3.3 GB on this exact GPU, which beats a third-party estimate of about 40 tok/s ([willitrunai estimate](https://willitrunai.com/de/can-run/qwen-3-4b-on-rtx-4050-laptop-6gb), unverified).
- Evidence on small models as tutors is poor: sub-2B models produced fluent, confident output hiding unstable pedagogy and frequent maths errors, and Socratic quality was low for 0.5-1B models (roundup in [this search](https://arxiv.org/html/2506.05925v2); individual papers not read in full). One study with local Llama 3.2 3B found students rated code feedback helpful and not significantly misled (SHIELD project page, not the paper). Net: a 4B model is fine for rewording and summarising notes the user wrote, risky for checking answers.
- Grounded in retrieval, a carefully built RAG pipeline lets a small model rival larger ones on domain tasks ([arXiv 2506.05925](https://arxiv.org/html/2506.05925v2)), which matches the project's own finding.

**6. Voice activity detection and wake word: models are right here, and already cheap.**
- Silero VAD v5: 189 us per 31.25 ms chunk on one CPU thread via ONNX, 165x real time; JIT 325 us (96x). Tested on a Threadripper 3960X, so a laptop CPU will be slower, but the margin is two orders of magnitude ([Silero perf wiki](https://github.com/snakers4/silero-vad/wiki/Performance-Metrics)). About 2 MB model, MIT, 8 and 16 kHz ([repo](https://github.com/snakers4/silero-vad)). The repo gives no numeric accuracy; quality tables are in a separate wiki page not fetched.
- openWakeWord: one Raspberry Pi 3 core runs 15-20 models in real time; target below 5 % false-reject and below 0.5 false accepts per hour; default threshold 0.5; 80 ms frames ([repo](https://github.com/dscripka/openWakeWord)). Those rates are targets and plots, not a table, and were measured on a 5.5 h far-field corpus, so a 20-minute room noise test is not equivalent.

**7. Embedding retrieval for Hinglish memory: measure before switching.**
- `multilingual-e5-small`: 118 M parameters, 384-dim, 512 tokens, 12 layers, about 100 XLM-R languages, weaker on low-resource ones, MIT ([Vertex AI card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/maas/e5/multilingual-e5-small), [Superlinked listing](https://superlinked.com/models/intfloat-multilingual-e5-small)). The current `bge-small-en-v1.5` is English-only, 33.4 M parameters, MIT, MTEB average 62.17 ([model card](https://huggingface.co/BAAI/bge-small-en-v1.5)), so Romanised Hindi is handled by subword luck, not design.
- BGE-M3: MIT, 8,192 tokens, 1,024 dims, 100+ languages ([model card](https://huggingface.co/BAAI/bge-m3)); larger, so keep it CPU/optional.
- No benchmark exists for Romanised Hindi retrieval. The nearest evidence, CS-MTEB (English-Chinese and English-Japanese code-switching), shows embedders losing up to 27 % ([ACL Findings 2026](https://aclanthology.org/2026.findings-acl.636.pdf), via [arXiv 2604.17632](https://arxiv.org/html/2604.17632v1)). L3Cube released Hinglish BERTs but evaluated on LID and NER, not retrieval (same search). Conclusion: build a 50-100 pair Hinglish retrieval test from the user's own (private, local) notes and compare bge-small vs e5-small vs BGE-M3 before changing anything. Also note that e5 models need `query:`/`passage:` prefixes (from the model's documented usage; not re-verified this session).

#### Per-candidate card

| Candidate | User value | Inputs | Privacy | Budget | Failure mode and UI | Opt-out | Verdict |
|---|---|---|---|---|---|---|---|
| FSRS review scheduler | Fewer reviews at same recall; "what to revise today" | Per-card review time and grade | Local file only | KB of params, ms per card, CPU | Optimiser over-fits on few reviews: use defaults until about 1k reviews (threshold is a practice norm, not sourced here); show "using default schedule" label | Switch to fixed intervals | **Model (tiny, transparent)** |
| Proficiency per topic | Honest "how solid is this topic" | Quiz and flashcard outcomes | Local | Negligible | Noisy on few answers: show n and a range, grey below n<5 | Hide meters | **Rule** (weighted average + count); regression later |
| Next-best-action | One suggested block per canvas | Deadlines, weights, proficiency, due cards, free time | Local | Negligible | Wrong ranking: show the three terms, one-tap "not this" | Fixed to manual plan | **Rule** |
| Procrastination/energy | Know best hours | Session start/complete times | Local | Negligible | Prediction would feel like judgement | Pause logging | **Neither predictor; descriptive stats** |
| Local LLM coach | Rewording, summaries, Hinglish conversation | Retrieved notes, user text | Local (Ollama) | 3 GB VRAM, about 50 tok/s measured | Fluent but wrong: label "draft by the model", cite the retrieved note, never grade | Off switch, rule-only text | **Model, narrow** |
| VAD / wake word | Hands-free voice | Mic audio | Audio stays local; no raw storage | CPU about 1 % of one core (inferred), 2 MB | False accepts: visible listening dot, last-heard log | Hardware-style mute | **Model (keep)** |
| Embedding memory | Find a note in Hinglish | Notes, queries | Local LanceDB | 33-118 M params, CPU | Missing a Hinglish hit: show top-k with scores, "search by words" fallback | Keyword mode | **Model, after local A/B** |

#### Numbers

| Fact | Value | Source |
|---|---|---|
| srs-benchmark size | 9,999 collections, 349.9 M reviews (no same-day) | [srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) |
| FSRS-6 log loss / RMSE / AUC | 0.3460 / 0.0653 / 0.7034 | same |
| FSRS-4.5 / v4 log loss | 0.3625 / 0.3726 | same |
| Average baseline log loss | 0.3945 (AUC 0.4997) | same |
| FSRS-6 beats SM-2 on log loss | 99.6 % of users (with caveat) | [Expertium](https://expertium.github.io/Benchmark.html) |
| Optimised vs default FSRS-6 | optimised better for 84.3 % | same |
| Review reduction vs SM-2 | 20-30 % (simulation) | [ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS) |
| FSRS-6 parameters | 21 | same |
| Silero VAD v5 ONNX latency | 189 us / 31.25 ms chunk, 1 thread | [Silero wiki](https://github.com/snakers4/silero-vad/wiki/Performance-Metrics) |
| Silero model size | about 2 MB | [repo](https://github.com/snakers4/silero-vad) |
| openWakeWord capacity | 15-20 models per Pi 3 core | [repo](https://github.com/dscripka/openWakeWord) |
| openWakeWord target | below 5 % FRR, below 0.5 FA/hour | same |
| Qwen3-4B Q4_K_M | 2.5 GB file, 32k context | [model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF) |
| Qwen3-4B-Instruct-2507 on this GPU | 50 tok/s, 2.9-3.3 GB, first token 0.6 s | project DECISIONS.md (own measurement) |
| multilingual-e5-small | 118 M params, 384 dim, 512 tokens | [Vertex card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/maas/e5/multilingual-e5-small) |
| bge-small-en-v1.5 | 33.4 M params, English only, MTEB 62.17 | [card](https://huggingface.co/BAAI/bge-small-en-v1.5) |
| Code-switching retrieval loss | up to 27 % | [ACL Findings 2026](https://aclanthology.org/2026.findings-acl.636.pdf) |
| Logistic regression vs DKT | LR led 4 of 9 datasets, DKT 5 of 9 | [Gervet et al.](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/451) (via search) |

#### Licences and usage concerns
- Silero VAD: MIT stated in text; the README badge alt text says CC BY-NC 4.0, so read the LICENSE file before bundling in a product that may be sold.
- openWakeWord: code Apache-2.0, but the pre-trained models are CC BY-NC-SA 4.0 and were partly trained on data with unknown or restrictive licences. Fine for a personal app; **blocks a commercial or separable product** unless custom models are trained on clearly licensed synthetic speech. This is the most important licence flag.
- Qwen3-4B: Apache-2.0. bge-small and BGE-M3: MIT. multilingual-e5-small: MIT per listings (the model card itself did not render; verify).
- FSRS algorithm and `fsrs-rs` are open source (licence of the specific crate not checked); SSP-MMC code is MIT.
- SuperMemo and some tutorial pages are competitors or vendors; their SM-2/FSRS numbers are marketing unless traceable to the benchmark repo.

#### What this changes for JARVIS / Well Wisher
1. **Ship FSRS as the only learned scheduler**, with the desired-retention slider as the one knob and a visible "default schedule / fitted to your N reviews" chip. Never show SM-2 as a product choice.
2. **Topic proficiency is an exponentially weighted score plus a count n**, drawn as a bar with a confidence tail. Below n=5 it is greyed and labelled "too few answers". No BKT/DKT.
3. **Study-block suggestion is a rule card** that prints its three factors (urgency, gap, weight) and has a "not this" button; the UI promises no prediction.
4. **No procrastination or energy predictor.** Offer a descriptive focus-hours strip from the user's own sessions.
5. **LLM coach is a labelled drafting tool**: every output carries "written by the local model from these notes" with the source note linked; no grading, no numerical answers, a global off switch, and a rule-based fallback text so the page never depends on the model being loaded.
6. **Keep VAD and wake word local and visible**: a listening indicator, last-heard log, and a mute. Flag openWakeWord's non-commercial model licence on the roadmap for any separable product.
7. **Hinglish embeddings: run a local A/B (bge-small vs multilingual-e5-small vs BGE-M3) on a 50-100 pair private test set before swapping**; keep the keyword search as a visible fallback.
8. **Honest-controls rule**: any model-backed control shows its state (model / default / off) and what it saw. Planned-but-absent models show as "planned", never as a fake meter.

#### Uncertain or unverified
- No SM-2 numeric row was extractable (tables are images); the diane.app and dev.to SM-2 figures were secondary and not used.
- The "about 1,000 reviews before optimising" threshold is a community norm; no primary source was retrieved this session.
- The Qwen3-4B 40 tok/s figure is an estimator, not a measurement; the project's own 50 tok/s is the real number.
- No source found for next-best-action ranking evidence at single-user scale, nor for Romanised-Hindi embedding retrieval; both need local tests.
- Silero VAD numeric accuracy and the quality-metrics wiki were not read; CPU numbers are from a Threadripper, not a laptop.
- Procrastination accuracy figures are from a search roundup, not read papers; the SHIELD and tutoring-error findings are also from summaries.
- The Gervet et al. paper itself was not fetched; its claims come from search summaries and abstracts.
- The CPU "about 1 % of one core" for wake word and VAD is inferred from the benchmarks above, not measured on the target laptop.

### Strand 6: Accessibility, keyboard, motion, contrast and performance budgets for a WebView2 desktop app

**Question.** What must the JARVIS / Well Wisher overhaul satisfy for accessibility (WCAG 2.2 AA and where AAA is worth borrowing), keyboard use, motion sensitivity, contrast (including a tactile soft-shadow look), phone parity, and performance, given that the app runs in WebView2 on Windows 11? How do the "one task canvas per 1366x768 screen, no page scroll" rule and WCAG reflow fit together? What budgets can we set and test?

**Method.** Session date 2026-11-12. Fetched and read 20 primary pages: nine WCAG 2.2 "Understanding" pages (W3C), MDN pages for `forced-colors`, `prefers-contrast`, `prefers-reduced-motion`, web.dev (INP, long tasks, content-visibility, font best practices, compositor-only properties), the Chrome Developers pages on background tabs, same-document View Transitions and native UI Automation, Microsoft Learn pages for WebView2 performance, `CoreWebView2Controller.IsVisible` and Windows Quality of Service, the Chromium native-window-occlusion doc, and the W3C ARIA Authoring Practices keyboard guide. Four web searches (WebView2 occlusion, backdrop-filter cost, canvas 2D vs WebGL particles, neumorphism contrast critique, screen readers in WebView2). Read-only greps of the app UI source for what already exists (no files edited). Failed or unusable fetches: Axess Lab neumorphism (403), a WebView2 throttling-spec GitHub URL (404), a WebView2 accessibility concept page (404), Windows efficiency-mode doc (404), `overview-features-apis` (page too long, relevant sections not reached). Nothing personal was put in any query.

#### Findings

**A. WCAG 2.2 criteria that bite this design**

1. **Text contrast 1.4.3 (AA).** Normal text 4.5:1, large text (18 pt, or 14 pt bold, about 24 px / 18.5 px) 3:1. Ratios are not rounded, so 4.499:1 fails. Text is measured against what it actually sits on. Disabled controls and pure decoration are exempt. [W3C 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
2. **Non-text contrast 1.4.11 (AA).** Visual cues needed to identify a control, and state indicators (selected, focused), need 3:1 against adjacent colours; disabled controls are exempt; hover needs no 3:1. A control with visible text or a contrasting icon needs no boundary at all, but when the boundary is the only cue it must reach 3:1. W3C also says "minor borders or shadows can be ignored when measuring contrast", so a soft shadow is not credited as the boundary. Focus indicators must meet 3:1 regardless. [W3C 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
3. **Neumorphism is the known failure case.** Secondary critiques repeat that the shadow is derived from the background so its contrast is capped, one cites a recipe edge of #bec3c9 on #e0e5ec at about 1.4:1 (not independently verified), and that focus rings get lost in surrounding soft shadows. Standard mitigation: keep the raised/recessed look as garnish and put the identifying cue in text, icon or a real 3:1 edge. [SetProduct critique](https://www.setproduct.com/blog/neumorphism-design-guide), [search overview of several critiques](https://axesslab.com/neumorphism/) (Axess Lab page returned 403 to my fetcher; its claim is only seen via search summary). These are agency blogs, not research.
4. **Target size 2.5.8 (AA).** Pointer targets at least 24x24 CSS px. Exceptions: spacing (a 24 px circle centred on an undersized target must not touch another target or its circle), equivalent control elsewhere, inline-in-text, user-agent controls, essential. [W3C 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
5. **Focus Not Obscured (Minimum) 2.4.11 (AA).** A focused component may not be entirely hidden by author-created content (sticky headers, floating panels, dock bars). Partial cover is allowed. Semi-transparent or blurred overlays may pass 2.4.11 yet still fail 1.4.11. Fix with `scroll-padding`. [W3C 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
6. **Focus Appearance 2.4.13 is Level AAA, not AA.** Indicator at least as large as a 2 px border around the unfocused component, with a 3:1 change between focused and unfocused pixels. A solid 2 px outline is the simplest pass. Not required, but cheap and recommended as the house focus ring. [W3C 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
7. **Reflow 1.4.10 (AA) vs the no-scroll canvas.** Requires vertical-scrolling content to work at 320 CSS px wide (equal to 1280 px at 400% zoom) without two-dimensional scrolling, with an exception for "parts of the content which require two-dimensional layout for usage or meaning": maps, diagrams, video, games, presentations, data tables, interfaces needing persistent toolbars. The exception applies only to the section that needs it; headings, search fields, pagination around it still reflow. [W3C 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
   - Reconciliation (my inference, not a W3C statement): the fixed canvas is the *wide-viewport* layout only. Use `@media (max-width / zoom-equivalent)` and container queries so that below roughly 900 CSS px (which is where 150%+ zoom on a 1366 screen lands: 1366/1.5 = 911, 1366/2 = 683, 1366/4 = 341) the shell collapses to a single scrolling column. The art centrepiece, the tree of skills, the CSI point cloud and any data table are legitimate two-dimensional exceptions and may keep their own pan/zoom region inside that column. At 100% zoom on 1366x768 nothing scrolls the page. This must be tested at 200% and 400% zoom, not only at 1366x768.
8. **Animation from Interactions 2.3.3 is AAA.** Motion triggered by interaction should be disableable unless essential. Sufficient techniques: CSS `prefers-reduced-motion` (C39) and the JS version (SCR40). Auto-started animation falls under 2.2.2 instead. [W3C 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
9. **Pause, Stop, Hide 2.2.2 (Level A).** Moving or blinking content that starts automatically, lasts more than 5 seconds and sits alongside other content needs a pause/stop/hide mechanism unless essential. Auto-updating content has no 5-second exception; it needs pause/stop/hide or a frequency control. This directly covers ambient art, live CSI/relay status feeds and tickers. [W3C 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
10. **Character Key Shortcuts 2.1.4 (Level A).** Any single-printable-key shortcut must be turnable off, remappable to include a modifier, or active only when the component has focus. This is the rule that constrains `g then h` or bare `/` shortcuts. [W3C 2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)

**B. Motion, contrast and forced-colours preferences in WebView2**

11. `prefers-reduced-motion` means the user asked to remove, reduce or replace motion; scaling and panning of large objects are the main vestibular triggers. On Windows 11 it follows Settings > Accessibility > Visual effects > Animation effects. MDN's own example replaces a scale pulse with a slow opacity dissolve, i.e. "reduce" is not "stop". [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
12. `prefers-contrast` has `more`, `less`, `custom` values (custom matches forced-colors users); widely available since May 2022. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast)
13. `forced-colors: active` (Windows contrast themes) makes the browser override `color`, `background-color`, `border-color`, `outline-color`, SVG `fill`/`stroke`; **`box-shadow` and `text-shadow` are forced to `none`**, non-URL `background-image` (gradients) is forced to `none`, and colours come from native element semantics, not ARIA roles (a `div role=button` gets no ButtonText). MDN's guidance: do not build a separate design, make small fixes (a real border where a shadow was the cue) and prefer leaving the browser palette alone. [MDN forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors) Consequence: a pure-shadow neumorphic control becomes invisible in a Windows contrast theme. Every raised/recessed surface needs a `@media (forced-colors: active) { border: 1px solid CanvasText/ButtonText }` fallback.
14. **Repo state (grep, read-only):** `prefers-reduced-motion` already appears in about 28 UI files (CSS plus `useReducedMotion.ts`, motion tests). A grep for `forced-colors` and `prefers-contrast` across `app/ui/src` returned **zero matches**. So the shadow-only-boundary risk is currently unmitigated, and the high-contrast path is the biggest known accessibility gap. `document.hidden` is honoured in `GalaxyScene.ts`, `SpatialTwin.ts`, `EyesView.tsx`, `Frame.tsx` and `Left.tsx`, so the idle-pause pattern exists but is not universal.

**C. Keyboard and screen readers**

15. W3C APG: Tab moves between components, arrows move inside composites (tablist, listbox, grid, toolbar, menu), a composite exposes one tab stop. Roving tabindex lets the browser scroll the focused item into view; `aria-activedescendant` leaves DOM focus on the container and makes you draw the indicator and scroll yourself. Keep focus on a visible element; after a dialog closes or an item is deleted move focus somewhere logical; avoid positive tabindex; update tabindex on click as well as keyboard; shortcuts should supplement navigation and avoid OS, browser and assistive-technology keys. [W3C APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
16. Command palette: it is a combobox + listbox pattern (input keeps focus, results via `aria-activedescendant`). That pairing is the one APG case where activedescendant is the standard choice; I am stating this from the APG table above plus general ARIA practice, not from a palette-specific source. Bind the opener to a modifier chord (for example Ctrl+K) so 2.1.4 is satisfied, and expect conflicts with WebView2/browser accelerators that the host must allow or swallow.
17. Chromium on Windows has used native UI Automation by default since Chrome 138 (UIA-based Narrator now talks to Chromium directly; MSAA/IA2 clients such as NVDA and JAWS still connect as before). The article has no benchmark numbers. [Chrome for Developers](https://developer.chrome.com/blog/windows-uia-support-update) A community post says some WebView2-hosted apps need custom NVDA support; it is dated 2026 but is a forum guide, so treat as weak. [NVDA users list](https://groups.google.com/a/nvaccess.org/g/nvda-users/c/Pq9qw56miSQ) I found no official page documenting Narrator/NVDA behaviour specific to WebView2, so manual testing with both is mandatory.

**D. Performance: what the sources actually support**

18. **INP:** good is 200 ms or less, poor above 500 ms, at the 75th percentile of field data. It is a field metric; for a single-user local app, use it as a lab target. [web.dev INP](https://web.dev/articles/inp)
19. **Long tasks:** any task over 50 ms; yield with `scheduler.yield()` (fallback `setTimeout`), batch small jobs rather than yielding after each, and do not rely on `isInputPending()`. [web.dev long tasks](https://web.dev/articles/optimize-long-tasks)
20. **Compositor-only animation:** only `transform` and `opacity` animate without layout and paint, and only if the element is on its own layer; do not promote everything because each layer costs memory; target about 4-5 ms for compositing during transitions. [web.dev compositor](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) So animating `box-shadow` (a neumorphic press effect) triggers paint every frame; the compositor-safe way is to cross-fade two pre-painted layers via `opacity`. (Inference from the cited rule; I found no measured cost per shadow.)
21. **Box-shadow stacks:** I found **no credible measured numbers** for the cost of stacked box-shadows. Treat any figure on this from blogs as unverified. The defensible rules are: static shadows are painted once and cached, animated shadows repaint, and large blurred shadows on many elements raise raster and memory cost. Budget by measuring on the target laptop.
22. **backdrop-filter:** the Filter Effects spec draft says the backdrop is copied to a temporary buffer and filtered in full, warning that a wider scope roughly doubles render cost and adds memory and GPU bandwidth; a Mozilla bug reports delayed rendering for large blurs. Quantitative claims in blogs (about 30 fps on phones, cap near 20 px blur) are not verified; one third-party doc claims cost is roughly constant regardless of area, contradicting the Mozilla report. [Filter Effects 2](https://drafts.csswg.org/filter-effects-2/), [Mozilla bug 1596634](https://bugzilla.mozilla.org/show_bug.cgi?id=1596634), [Grida cost sheet (weak)](https://grida.co/docs/wg/feat-2d/render-cost-prediction). Note that the project memory already records that the production build strips `backdrop-filter`, so the design should not depend on it anyway.
23. **Canvas 2D vs WebGL for 3-6k points:** no rigorous benchmark found. Evidence is anecdotal: one practitioner says Canvas 2D is fine under about 2,000 particles and WebGL pays off above about 5,000; a Stack Overflow answer calls 5,000 particles at 60 fps in Canvas "pretty good"; a WICG thread reports a naive 1,000-particle Canvas 2D demo running slowly. A single `gl.POINTS` draw for 5,000 points is the standard WebGL pattern. [WebGL particles Q&A](https://webglfundamentals.org/webgl/lessons/webgl-qna-efficient-particle-system-in-javascript---webgl-.html), [WICG thread](https://discourse.wicg.io/t/why-is-canvas-2d-so-slow/2232). Design answer: 3-6k points sits on the boundary, so prefer a single batched draw (WebGL points, or Canvas 2D with pre-rendered sprites, no per-point gradients/shadows) and measure on the real iGPU. The repo already ships a `galaxy/bench.ts` harness that discards runs where `document.hidden` flips, which is the right shape for a test.
24. **Background and occlusion throttling:** Chrome stops `requestAnimationFrame` in background tabs, limits timers to once per second, and applies budget throttling after 10 s in the background (budget regenerates 0.01 s per second); pages with audible audio, WebSocket or WebRTC are exempt from the budget rule but keep the 1/s limit. [Chrome blog](https://developer.chrome.com/blog/background_tabs) A WebSocket-fed live page therefore is **not** fully throttled when hidden; the page must stop its own work on `visibilitychange`. Chromium's Windows occlusion tracker treats an occluded window like a background tab ("rendering stops, and js is throttled"), recalculating on window events with a 16 ms limiter; caveats include a locked screen counting as occluded and falsely detected occlusion leaving a white window. [Chromium doc](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_native_window_occlusion_tracking.md) That doc does not say whether WebView2 enables it; I did not find confirmation, so verify by test.
25. **WebView2 `IsVisible`:** the child WebView does not receive minimize/restore messages; Microsoft says the host should set `IsVisible=false` when the app window is minimized and true on restore, because hidden pages get animation and task throttling and WebView2 purges caches. [Microsoft Learn IsVisible](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.isvisible) This is a host (JARVIS.pyw) concern and needs checking in the launcher.
26. **WebView2 general guidance:** keep the GPU enabled; use CSS rather than JS for animation; split long scripts; lazy-load; batch host-to-page messages; low `MemoryUsageTargetLevel` and `TrySuspendAsync` for unused views; periodically refresh long-running pages to return to a clean baseline; prefer static HTML initially over heavy SPA bootstraps. [Microsoft Learn WebView2 performance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance)
27. **Windows 11 power:** the Quality-of-Service doc says visible-but-unfocused windows get Medium QoS, minimized or fully occluded get Low (on battery: most efficient frequency and efficient cores), and EcoQoS is an explicit per-process tag. Windows may drop even a foreground app to Medium after user inactivity on battery. [Microsoft Learn QoS](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) I could not fetch Microsoft's efficiency-mode page; whether the WebView2 renderer is auto-tagged EcoQoS when hidden is unverified. Practical effect: idle frames cost battery and fan noise, which matches the owner's "light on CPU/GPU" requirement.
28. **content-visibility:** `content-visibility: auto` with `contain-intrinsic-size` skips layout/paint of off-screen sections; the web.dev example cut rendering from 232 ms to 30 ms (about 7x, a single demo page). Supported in Chrome/Edge 85+; content stays in the accessibility tree. Little use on a no-scroll canvas, but it helps long lists (library, memory lists, proof logs). [web.dev](https://web.dev/articles/content-visibility)
29. **View Transitions:** same-document support since Chrome 111; old view is a bitmap snapshot, new view live; only one transition at once; the page is frozen while the update callback's promise is pending; animating group width/height runs layout per frame; fully disable with `animation: none !important` under reduced motion, though the article advises a subtler transition rather than assuming no motion. [Chrome for Developers](https://developer.chrome.com/docs/web-platform/view-transitions/same-document) Fit: acceptable for route changes in WebView2 (Chromium), but keep named elements few and unique, never block on network, and treat it as enhancement.
30. **Fonts:** WOFF2 only; Chromium blocks text up to 3 s by default, so set `font-display` (`swap` or `optional`); preload only critical fonts; subset (Latin 100-1,000 glyphs); one variable font can replace several statics but may be larger than one static file; check licences before subsetting. The page gives no byte budget. [web.dev font best practices](https://web.dev/articles/font-best-practices) Since the app is local, load latency is small; the cost is parse and layout shift, so bundle fonts locally rather than via a network CDN.

#### Numbers

| Fact | Value | Source |
|---|---|---|
| Normal text contrast | 4.5:1 (large text 3:1; large = 18 pt or 14 pt bold) | [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| UI component / state / graphic contrast | 3:1, unrounded | [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Pointer target minimum | 24x24 CSS px (or spacing circle 24 px) | [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| Focus indicator (AAA) | at least 2 px perimeter, 3:1 change | [2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) |
| Reflow | 320 CSS px wide / 256 px tall (= 400% on 1280x1024) | [1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| Auto-motion threshold | more than 5 s needs pause/stop/hide | [2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) |
| INP | good <= 200 ms, poor > 500 ms (p75) | [web.dev](https://web.dev/articles/inp) |
| Long task | > 50 ms | [web.dev](https://web.dev/articles/optimize-long-tasks) |
| Compositing during transitions | about 4-5 ms target | [web.dev](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) |
| Background timers | 1 per second; budget throttling after 10 s, 0.01 s/s regen | [Chrome](https://developer.chrome.com/blog/background_tabs) |
| Occlusion recalculation limiter | 16 ms timer | [Chromium](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_native_window_occlusion_tracking.md) |
| content-visibility example | 232 ms to 30 ms (about 7x), one demo | [web.dev](https://web.dev/articles/content-visibility) |
| Chrome native UIA default | Chrome 138 | [Chrome](https://developer.chrome.com/blog/windows-uia-support-update) |
| WOFF2 vs WOFF | about 30% smaller | [web.dev](https://web.dev/articles/font-best-practices) |
| Font text block default | up to 3 s (Chromium/Firefox) | [web.dev](https://web.dev/articles/font-best-practices) |
| Particle thresholds | Canvas 2D fine under about 2,000, WebGL above about 5,000 (anecdote) | [see finding 23](https://discourse.wicg.io/t/why-is-canvas-2d-so-slow/2232) |
| Windows QoS | Focus High, visible Medium, minimized/occluded Low | [Microsoft](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) |

#### Licences and usage concerns

- W3C WCAG documents, MDN (CC-BY-SA), web.dev and Chrome for Developers (CC-BY with Apache-2.0 code samples), Microsoft Learn and Chromium docs were read for facts only; nothing is copied into the product. Cite, do not paste.
- Fonts: confirm the licence permits subsetting and self-hosting before running subset tools (web.dev notes this). No font has been chosen in this strand.
- Blog and vendor sources on neumorphism and backdrop-filter cost are marketing-adjacent and are labelled weak above; do not quote their numbers in the product or docs.
- The NVDA forum post is community content, used only as a signal.

#### What this changes for JARVIS / Well Wisher

1. **Shadow is garnish, never the only cue.** Every control keeps text or an icon, and any control whose boundary is the only cue gets a real edge at 3:1. Define a "boundary token" per surface pair and have the tests compute its ratio. Add a `forced-colors: active` layer (zero exist today) that swaps shadow depth for 1-2 px `ButtonText`/`CanvasText` borders and restores focus rings with `Highlight`; test it with Edge emulation of forced colours. Add a `prefers-contrast: more` token set that deepens shadows and borders.
2. **House focus ring:** 2 px solid, 2 px offset, at least 3:1 against both the raised and recessed surface, drawn with `outline` (not a shadow), so it meets 2.4.7, 1.4.11 and the AAA 2.4.13 for free. Add `scroll-padding` for the top bar and dock so focus is never fully covered (2.4.11).
3. **Targets:** 24 px minimum for every pointer control (the phone page should aim for 44 px by default for touch comfort; that figure is a platform convention, not from the sources above). Dense mono-metadata chips must either be 24 px or clear the spacing circle.
4. **No-scroll canvas stays, with a reflow fallback:** the fixed 1366x768 canvas applies at wide viewports only. Below about 900 CSS px (200% zoom and phones) collapse to one scrolling column; the art centrepiece, tree, point cloud and data tables stay as contained two-dimensional regions under the 1.4.10 exception. Test at 200% and 400% zoom.
5. **Motion rules:** ambient art may run but must pause on `document.hidden`, on window minimize (host `IsVisible=false`), after an idle timeout (for example 60 s without input; my proposal), and must have a visible Pause control (2.2.2) plus the OS reduce-motion setting. Under `prefers-reduced-motion`, replace large pans/zooms/parallax with opacity cross-fades, static frames for the centrepiece, and no shake or looping scale. Keep a global "Calm" switch in Setup that sets the same state for users whose OS setting is wrong (a user-visible override, not a dark pattern).
6. **Keyboard-first:** one command palette (combobox + listbox, `Ctrl+K`), one tab stop per composite (tab bar, tree, lists) with roving tabindex, arrows inside; any single-letter shortcut must be disableable or focus-scoped (2.1.4), documented in a shortcut sheet that is itself keyboard reachable, and checked against WebView2/host accelerators.
7. **Perf architecture:** all animation on `transform`/`opacity` only; no animated `box-shadow` (cross-fade a pre-rendered shadow layer); no `backdrop-filter` (also stripped by the build); at most a few `will-change` layers on the centrepiece; `content-visibility:auto` on long lists; View Transitions for route changes only, with unique names and reduced-motion off-switch. One rAF loop per visible art piece, stopped on hidden/occluded/minimized; no polling timers faster than needed; batch host messages.
8. **Point clouds:** build the 3-6k point scenes as a single batched draw with no per-point shadow or gradient, decimate under load, and keep the existing `galaxy/bench.ts` approach as the regression harness. Do not assume WebGL is required; decide from a measured frame time on the owner's actual laptop.
9. **Host work (outside the UI, needs the owner's OK later):** wire `IsVisible` to minimize/restore, set `MemoryUsageTargetLevel` Low for hidden views, and consider a periodic page refresh policy for week-long sessions.
10. **Phone parity:** the phone page needs the same token set, focus rings, 24 px minimum (aim larger), reduced-motion and `prefers-contrast` handling, and the same labels for planned (not yet real) controls, which should be `aria-disabled` with visible text, not hidden.
11. **Screen readers:** semantic landmarks and headings per workspace, `aria-live="polite"` only for genuine status changes (not tickers), art centrepieces `role="img"` with a text alternative or `aria-hidden` plus a text summary, simulated data labelled as simulated in text. Run Narrator and NVDA by hand on the shell, command palette, tree and a form.

#### Budget table (proposed; targets are mine, anchored on the cited limits, to be validated on the owner's laptop)

| Area | Budget | Why / anchor | Test that enforces it |
|---|---|---|---|
| Idle CPU, window focused, ambient art paused or static | at most 1% of one core averaged over 60 s | Windows QoS: idle frames cost battery and fans | Playwright/CDP `Performance.getMetrics` (TaskDuration delta) over 60 s on a page with no input; fail above budget. Script run against the sandbox instance, not the live app |
| Idle CPU, window hidden/minimized/occluded | effectively 0 (no rAF callbacks, no timers faster than 1/s) | Chrome background throttling; `IsVisible` guidance | Test: set `document.hidden` via CDP emulation and assert zero rAF calls and no WebSocket-driven DOM writes over 10 s; separate manual check with the real window minimized |
| Ambient art active, focused | average main-thread frame work under 8 ms, 95th percentile frame under 16.7 ms at 60 Hz (aim 30 fps cap for ambient art) | 4-5 ms compositing target; 16.7 ms frame | Extend `galaxy/bench.ts` style harness to all centrepieces; fail on p95 > 16.7 ms |
| Interaction latency | INP at most 200 ms (lab target at p95 of scripted interactions); no long task over 50 ms during route change or palette open | web.dev INP and long-task definitions | Playwright with `PerformanceObserver` for `longtask` and `event` entries on scripted flows; fail on any > 50 ms task in the flows, record INP |
| JS per route | initial route at most 250 KB gzipped; each lazy route at most 120 KB gzipped (my proposal; WebView2 doc says SPA frameworks delay first render) | Microsoft WebView2 payload guidance | Vite build size check in CI (fail on regression of more than 10% vs a committed baseline file) |
| Fonts | WOFF2 only, at most 2 families, at most 4 files, at most 150 KB total, `font-display: swap`, local-bundled | web.dev font practices | Unit test scanning built CSS for `@font-face` formats and `font-display`; size assertion on `dist` |
| Images | no raster above 200 KB on a route; prefer SVG/CSS art; art assets sized to display size at 2x | WebView2 reduce-initial-payload guidance | Build script lists assets by route and fails over budget |
| Animation | only `transform` and `opacity` in keyframes/transitions; no `box-shadow`/`filter`/`backdrop-filter` animation; no `backdrop-filter` anywhere; at most 6 `will-change` elements per view | compositor rules; project build strips backdrop-filter | Stylelint-style unit test over CSS (the repo already has `_css.ts` test helpers) to reject forbidden animated properties and `backdrop-filter`; a DOM test counting `will-change` |
| Reduced motion | every animation/transition and rAF loop has a `prefers-reduced-motion` branch; essential motion is documented | 2.3.3 / C39 / SCR40 | Existing motion tests extended: emulate `reduce` and assert no running animations (`document.getAnimations()` empty) and no rAF loop after 1 s |
| Contrast | all text 4.5:1 (large 3:1); all control boundaries/states/focus 3:1 on both light and any dark/contrast theme | 1.4.3, 1.4.11 | Token-level unit test computing ratios from CSS custom properties for every declared foreground/background pair; axe-core run in Playwright per route for the rest |
| Forced colours / high contrast | in `forced-colors: active` every control has a visible border and focus ring | MDN: shadows forced to none | Playwright `forcedColors: 'active'` screenshots plus assertion that interactive elements have non-zero computed border or outline |
| Targets | every pointer target at least 24x24 CSS px or passes spacing circle | 2.5.8 | Playwright script measuring bounding boxes of `button, a, [role=button], input` per route |
| Focus visible and not obscured | Tab through each route: every stop has a visible indicator, none fully covered | 2.4.7, 2.4.11 | Playwright keyboard walk comparing the focused element's bounding box against fixed/sticky overlays |
| Reflow | no horizontal page scroll at 320 CSS px wide and at 200%/400% zoom emulation (except declared 2D regions) | 1.4.10 | Playwright viewport 320x256 and 683x384 checks: `scrollWidth <= clientWidth` on `body` and the shell |
| No-scroll canvas | at 1366x768, `document.scrollingElement.scrollHeight <= innerHeight` on every route (repo reports 1366x768 checks exist already) | Design rule | Existing browser tests; keep and extend |
| Keyboard | palette opens by chord; every workspace reachable without a mouse; single-key shortcuts only when focus-scoped or disableable | 2.1.4, APG | Playwright keyboard-only flows plus a unit test listing registered shortcuts and asserting modifier or scope |
| Memory | renderer memory steady-state growth under 10% over a 30-minute scripted soak | WebView2 guidance on leaks and refresh | Soak script using CDP `Memory`/heap counters on the sandbox instance (manual or nightly) |
| Screen readers | Narrator and NVDA pass a scripted checklist for shell, palette, tree, one form | no official WebView2 doc | Manual release checklist; automated axe-core catches only part |

#### Uncertain or unverified

- Per-shadow cost: no measured data found. The claim that animated shadows repaint comes from the compositor-only rule, not from a benchmark.
- backdrop-filter cost: sources conflict (area-dependent vs near-constant). Both come from weak or informal references.
- Canvas 2D vs WebGL at 3-6k points: only anecdotes; must be measured on the target iGPU.
- Whether WebView2 enables Chromium's native-window occlusion detection, and whether the hidden WebView2 renderer is tagged EcoQoS on Windows 11, are not confirmed. Microsoft's guidance relies on the host setting `IsVisible`, which suggests it does not happen automatically for minimize.
- WebView2-specific Narrator and NVDA behaviour: no official document found; the Chromium UIA default (Chrome 138) is documented, but the WebView2 runtime version used on the owner's machine was not checked.
- The JS-per-route, font-byte, image and idle-CPU numbers in the budget table are proposals, not quoted limits; no source gives them. They need a baseline run on the real app before being made hard failures.
- The 900 CSS px collapse breakpoint and the 60 s idle-pause timeout are my design suggestions.
- The 44 px touch size for the phone page is a common platform convention, not taken from the sources read here.
- The "no-scroll vs reflow" reconciliation rests on reading the 1.4.10 exception text; an accessibility auditor could disagree about which regions qualify, so keep a documented list of declared two-dimensional regions.
- Some secondary neumorphism sources could not be fetched (403), so the 1.4:1 example is second-hand.


# Senses (Presence, Signal, Teach): design lifts

## 2026-11-20: EL-SENSES review round, what the independent review changed

**Question.** An independent reviewer found four majors and several minors in the first lift. Which hold up, and what does each fix
measure?

**Findings and what each fix did**

1. Rocker lit half was 1.1:1 against the unlit half (rgb 48,50,54 on 40,42,46). `--k-on-fill` is now `--ink-3` (the kit's own ON
   fill) and `--k-on-ink` is the ground colour; the spec measures the halves at 3:1 or more and the word on the lit half at 4.5:1.
2. The Teach desk lamp read LIVE for a simulation source. It now follows `effectiveSource`: LIVE only for the board, SIMULATED for
   the simulation or a specimen, WAITING with no source. A running training job keeps its own reading. Unit tests cover the four
   cases with the fixture flag off.
3. The select list was clipped by `.js-panel { overflow: hidden }`. `SensesSelect` now draws its list through a portal on the page
   body, with `position: fixed` coordinates taken from the trigger, flipped up or down by the room left and scrolling inside it.
   A Playwright case opens the Teach session select with eight invented sessions: the list sits inside the viewport, is opaque, its
   last option is hit-testable, Enter picks it and the focus returns to the trigger. Also added: first-letter type-ahead,
   Home and End on the closed trigger, the cursor clamped when the options shrink, focus back to the trigger on an outside click.
4. `splitHow` split on a bare space before the word "python" or "npm", so prose became a command chip. It now splits only on
   "sentence: command" (the form aankhen/readiness.py writes) and leaves a command with no sentence whole. Negative tests added.
5. Signal: the ledger lamp was LIVE with no source, and the motion band printed the last baseline under a WAITING lamp. Both now
   follow the source.
6. The spectrum is now a CSS grid of 51 boxes (real pixel widths, real corner radius, no non-uniform stretch). The WAITING pose is
   a hollow envelope at about 30 to 46 percent height instead of 12 px slivers; the 1, 26, 51 labels sit under the bar centres.
7. Presence: the Fan note no longer starts with "Fan:" (the word is beside the rocker); the fan group is named "Fan control"; the
   Sensing switch is named "Sensing"; the "No, I'm at" select now says why it is disabled (Needs frames, Saving, No zone map).
8. The needle uses `--dur-state`. The two stamps keep their 1.5 px coloured edge on purpose (a stamp, not a labelled control).
9. The copy chip is named "Copy command, <step>" (label in name); a refused clipboard prints the command in the fault toast.
10. Scope: the separate `el-senses.spec.ts` was folded into `e2e/j03-senses.spec.ts` (part 3); the extra gallery entry
    `gallery/entries/jarvis/el-senses.tsx` was dropped (the J03 entry already shows the three views); this note moved from the
    worktree root into `docs/research/senses.md`.

**Not done, and why.** Sensor rows in the Signal ledger still show the lamp the hub reported even when the source is silent; the
card lamp says WAITING, and the rows are the hub's own reports. The select is still a stand-in until the kit ships its own.

---

## 2026-11-20: EL-SENSES, lifting Senses (Presence, Signal, Teach) above the bar

**Question.** A jury of three scored the merged Senses section below 8.0 for design. Which ten fixes lift it, and does each
survive a reading of the code and a real-shell measurement at 1366 x 768 and 390 x 844?

**Decisions and why**

1. No outline anywhere the section draws itself. `.js-panel`, `.js-key`, `.js-choice`, `.js-tile`, `.js-chip`, `.js-select`, `.js-well`,
   `.js-link`, `.js-chan` and the three tags (`.js-exp`, `.js-chip-sim`, `.js-status-word`) lost their 1 px border. Cards and keys
   are lifted by `--elev-low` (hover `--elev-raised`), wells, trays, tiles and tags are pressed in by `--elev-recessed`. The
   gutter of the view went from 8 to 12 px because the 11 px lift of a card was clipped by the 8 px edge. The forced-colours block
   stays and now also outlines the new surfaces. The two stamps (SIMULATED, PAUSED) keep their coloured edge on purpose: they are
   stamps, not labelled controls.
2. The three native selects are now `SensesSelect` (parts.tsx): a closed recessed well that opens an opaque, lifted list, with
   arrows, Home, End, Enter, Escape and Tab, 44 px options, text that wraps. The kit has no Select yet, so this is a local
   stand-in with the same job; it is to be swapped for the kit's when it ships (see outside_paths). Start ESP32 got the pill
   radius of the rocker.
3. Presence: Start ESP32 is the only warm fill. The rocker's lit half is neutral here through the kit's own `--k-on-fill` and
   `--k-on-ink` variables, set on `.js` (the kit change replaces it). "Sensing" and "Fan" sit beside their rockers as visible
   words. The bottom strip is a labelled group "Predicting": the prediction, a recessed tray with Right and the select (the
   corrections pair), then the fan note with its word and rocker. Right and the correction stay visible.
4. Signal: the motion score is a dial (`MotionDial`, forms.tsx): 240 degree track on a log scale 0.5x to 20x (the decades of the
   trace under it), value arc in the source ink, threshold as a tick across the track, a dash at the hub with no frame and the
   track dashed hollow, the lamp and state word in the card header. The spectrum went from 200 to 112 viewBox units
   (a card of 212 px instead of about 300). Simulated frames are normalised per frame, so the bars keep their shape at 112.
5. Signal: Sensors and Events are one card, "Sensors and events", each section ending in a ruled empty row that says why
   (a 2 px pressed-in rule, not a border). The Simulation check, when the engine sends truth, became a third section with its
   SIMULATED chip so the card cannot overflow. Both columns end on one line: the narration is a 44 px plate and the right column ends
   with the 44 px "Go to Presence" key (the one warm fill of the view while no source runs, disabled with a reason when `onGo` is
   absent). The hollow sine and the hollow spectrum say "no frames" on a small plate.
6. Signal at 390: cause confirmed in the source (`.js-big` had `overflow-wrap: anywhere`, which stacked "--" into two lines).
   `.js-big-num` is `white-space: nowrap` with `min-width: 3ch`; "threshold --" is nowrap; the axis is three real HTML numbers
   (1, 26, 51) under the SVG at 11 px (SVG text scaled to 5 px on a phone); the trace marks 1x, 10x, 100x are HTML too. The
   long ASCII rule is clipped inside its card.
7. Teach: `splitHow()` (model.ts) splits the engine's "sentence: command" string; the list shows the sentence, and the command sits
   behind a 44 px "Copy command" chip (title shows the command, a toast says it was copied). The `-webkit-line-clamp` is gone.
   Start sits directly under the tile grid with its reason beside it (grey while disabled, ink-2 not ink-3).
8. Teach: the tiles are a fixed 4-column grid and the last tile of each group spans the free cells (inline `grid-column`,
   from the count). The desk lamp is WAITING until a source runs. "Four steps" shows "n of 4" and WAITING until all four are
   lit (it read LIVE with 0 of 4 before). Ring captions are one line: name, a short count (`short` on `TeachRing`), lamp.
9. The honesty sentence is the fixed 28 px slot of a new `SensesFrame` (parts.tsx), wrapped around each view by live.tsx and
   gallery.tsx, one line at the desk; the three per-view `SensesSentence` uses are gone. The 28 px come out of the view, so the
   Presence column was re-budgeted (left 712, terrain well stretches, link row 112, strip 56).
10. The "NO SIGNAL: shape is a placeholder" legend sits on a pressed-in pill under the mesh.

Not in the list but fixed while there: five ellipsis rules on text that carries a state or a reason (`.js-foot-read`,
`.js-vital-name`, `.js-pred-text`, `.js-pred-fan`) now wrap. Wrapping the foot reading broke the 390 well (330 px of overflow:
the 64-character ASCII trace took the whole grid and the reading wrapped letter by letter); the foot grid is now
`auto, 1fr, max-content` and two rows on the phone.

**Numbers**
- Sweep of 20 Nov (`SWEEP_SECTIONS=senses`, six views and sizes): "nothing found" for all six (ellipsis, wraps, targets, small, sideways,
  inner scroll, document overflow, page and console errors).
- Vitest: `src/jarvis/senses` 79 + imports and gallery tests, 174 passed in 8 files; `npx tsc -b` clean.
- Playwright: own cases (now part 3 of `e2e/j03-senses.spec.ts`) 12 of 12; `e2e/j03-senses.spec.ts` 25 of 25 (the two 390 Presence cases first failed on the foot
  grid above, fixed).
- Heights at 1366 x 768 (view 1278 x 616 after the frame slot): Presence left 48 + stretch + 112 + 56, right 292 + stretch; Signal both
  columns end on the same line (checked in the spec to 1 px); Teach both columns end on the stretching last card.

**What it changed.** senses.css (whole file), forms.tsx (Spectrum, MotionTrace, MotionDial), parts.tsx (SensesFrame, SensesSelect),
the three views, TeachDesk, TeachRings, SignalTerrain, live.tsx, gallery.tsx, model.ts (`splitHow`, `short`), fixtures.ts (the
fixture `how` strings now carry commands like the engine's), the view tests, and the section cases of `e2e/j03-senses.spec.ts` (part 3).

**Open.** The kit's Select and neutral lit state replace the two local stand-ins. The wiring of the sentence into the shell frame
itself (rather than the section's own frame) is a shell change. Hard numbers from a live board (a real ESP32 run) were not
available: every non-WAITING state above was drawn from fixtures stamped SIMULATED.

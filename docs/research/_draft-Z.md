# Package Z: the design reset and the chrome (draft for the integrator)

## 2026-11-28: the design reset (monochrome first, colour as signal) and chrome that gives room back

**Question.** On 28 Nov the owner reviewed every page and rejected the look: "the accents we chose for all sections are ai slop",
"this is starting to look more and more like slop ai designs, because of the colours and the gradients. i want top 1% design
build", of the centre piece "nothing and apple finish ... use ascii art", "some components take a lot of space, unnecessary space,
like the bottom bar, the top bar, the nav bar, they should be able to shrink and have motion effects", "there are various scrolling
issues all over the application", and "the frosted glass should be able to have a translucent effect ... let the bg bleed on the
window in front, still very composed and fast". Queue rows V0 (the reset) and V1 (the chrome).

**What was wrong, in numbers** (counted from the diff of this package):

| File | Gradient fill lines removed | Hue tint lines removed | Glow lines removed |
| --- | --- | --- | --- |
| `shell/v3/shell-v3.css` | 22 | 16 | 0 |
| `shell/v3/shell-v3-tokens.css` (the 25 Nov hues, the copied grounds) | 0 | 27 | 15 |
| `shared/kit/glass.css` | 12 | 0 | 0 |
| `jarvis/core/core-v3.css` (small edits: the orb, the wake key, the keys) | 9 | 0 | 3 |
| `styles/design/v3/glass.css` (the token values) | 0 | (every ground value rewritten neutral) | 4 |
| **Total** | **43** | **43** | **22** |

Also found: `shared/kit/clay.css` gave ANY element with `data-state='planned'` a dashed border, and one with no border width of its
own took the default 3 px: that is where the dashed "terminal boxes" all over the views came from. Under v3 it is now removed
(high contrast and forced colours keep it). The trays clipped their body (`overflow: hidden` on the tray, no overflow on the body):
the root cause of "several trays cannot be scrolled".

**The palette as built** (full table with roles in `docs/design/design-reset-1128.md`): dark ground `#0c0c0d`, one tray `#161617`,
raised `#202021`, inks `#ededea` / `#b4b4af` / `#8f8f8a`; light ground `#f1f0ec`, one tray `#faf9f6`, raised `#fdfcfa`, inks
`#161614` / `#474743` / `#5e5e59`. Worst backdrop (white behind dark, black behind light, no brightness help): ink 8.6 / 10.5 and
ink2 4.9 / 5.4 on the bare ground; ink3 5.4 / 6.0 on a tray (never on the bare ground).

**Accent schemes** (`data-accent` on `<html>`; More, "Colour per project"; or the fragment `accent=one|project`):
A (default) one instrument amber `#edaa3a` dark (8.7 to 1 on a tray, label 9.2) and `#8a5806` light (5.0, label 5.1).
B per project: JARVIS the amber; Aankhen phosphor green `#86e07a` / `#2f7a3a` (10.9 / 4.9); Yadaash cobalt `#8ea6ff` / `#3651c9`
(7.6 / 6.1); Well Wisher deep rose `#ff7ea9` / `#b0245e` (7.4 / 6.0). Every label on its fill 5.1 to 11.1; every B accent 20 degrees
or more of hue from the fault red. States: only FAULT keeps a colour (`#ff5f57` / `#b3261e`), LIVE takes the accent, the rest are ink.

**Type scale.** Inter Variable and Geist Mono Variable (bundled): 11 12 13 14 16 20 28 (40 for a hero numeral); the old names snap
onto it. Tray heads: one 11 px caps label, no numeral well, bracket or tick.

**Chrome at 1366 x 768, before and after.**

| | Before | After |
| --- | --- | --- |
| Spine | 184 px | 64 px rail (auto below 1420 px; pinnable) |
| Top plate | 64 px | 56 px, 44 px slim |
| Dock | 76 px | 44 px (same height open) |
| Vertical chrome | 200 px | 136 px (124 slim): 64 to 76 px given back |
| Horizontal chrome | 216 px | 80 px: 136 px given back |

The 1420 px threshold is measured from the grid (third tray 277 px with the full spine at 1366, 290 at 1420, 306 with the rail).

**Per view: what still looks wrong, and whose it is.** Read from the 24 pictures of `e2e/design-reset.spec.ts` (twelve views at
1366 x 768 and 1920 x 1200, $TEMP/ui-reset-shots). Every view passed the computed check (no gradient, tint or coloured shadow on the
ground, spine, plate, dock, trays and keys) and no view had a box that clips taller content inside the canvas. Fixed here (mine):
the tray bodies scroll (Follow-ups on Today, the Week trays, Papers' Drafts, Library's Doors, Career's Ahead all reach their end
now), the dashed planned boxes, the clay orange of the today notch (`--accent-state`) and the orb's four inks. Left as page work:

| View | Element | Fault | Fix |
| --- | --- | --- | --- |
| Core / Talk | the orb (`.jc3-orb-*`) and the wave line | still the 25 Nov sculpture: a raised ring, a flat accent disc, a faded line; the owner asked for a Nothing / Apple finish in character art | rebuild the centre piece on `DotRing` (state from the voice core, a level only from the measured mic level) and a `DotLevel` row for the line |
| Core / Talk | the voice path list (HEAR, WRITE, THINK, SAY) | sits in a 1 px hairline box | drop the border; the rows are raised keys already |
| Core / Talk | "Pause" key top left | an orphan beside "WAITING Off" | move it into the state row or into More |
| Core / Sound | the ring of glyphs round Play | busy rotating text ring (terminal look) | one `DotRing`, still unless playing |
| Core / Sound | Recent plays | a dark card inside the tray (a card in a card) and a `[LOG]` code | `EmptyPose` "No plays from this window yet" |
| Console / Hardware | `[BRD] [LNK] [FWR] [UPT] [RST] [RSI] [CSI] [USB]` | bracket codes on every row: terminal noise | drop the codes, keep the words |
| Console / Hardware | the relay board | a hairline box, a dotted "RELAY BOARD" label box, dashed channel boxes | raised channel keys on the tray, no outlines |
| Console / Hardware | the board key line | an amber-tinted band (a fill) | ink on a well, mono |
| Console / Hardware | Wi-Fi tabs, link select, "Connect over Wi-Fi" | a hairline on the active tab; the select clips its text; a two-line key | the kit `Segmented`; a wider select; a shorter label |
| Console / Crew | Run keys | square keys with a hairline outline | the kit `Key` |
| Console / Crew | staff rows, the route list | dashed separators and hairline boxes round "BUILT, NOT VERIFIED"; `[STF]` codes | space and a caption between rows; the state chip carries the state |
| Senses / Presence | `[SEN] [LNK] [CSI] [FPS] [LOS] [AGE]` | bracket codes | words only |
| Senses / Presence | the dashed cube, the dashed dial, the wireframe terrain | three drawing styles in one view | the character-art set (`StateFigure` for NO SIGNAL, `DotLevel` for evidence) |
| Senses / Presence | "Detects motion of anyone in range..." | sits on the ground under the trays | into the first tray's foot |
| Day / Today | "Start a 10-minute block" | the primary key spans the tray: a large accent fill | intrinsic width |
| Day / Today | the start tray | about 450 px empty under the arc at 1920 x 1200 | let the arc take the height, or move the timeline up |
| Day / Today | Proof tile | corner bracket marks (terminal look) | drop the corner marks |
| Day / Today | Ahead tile, counters | "— — days" reads broken; a minus key beside a dash value reads "— –" | one dash with its state word; disable the minus at 0 instead of drawing a dash |
| Day / Week | "Plan a block" | full-width accent bar | intrinsic width |
| Day / Week | "-- Timetable, today", "-- Attendance margin" | double-dash prefixes and dashed rules under plate heads (`.td-plate-head::after`) | drop both |
| Study / Papers (ww/study, listed only) | coverage grid, five stat tiles, drop zone | an ASCII grid in a well in a tray; "WAITING: No papers on file yet." five times; a dashed ASCII drop box | one `EmptyPose`; one line under the tiles; a raised drop key |
| Study / Library (listed only) | the empty ledger | an ASCII tray "\_____/" in a deep well | `EmptyPose` |
| Study (listed only) | `ledger.css`, `tonight.css`, `ocr.css` | `linear-gradient(var(--acc-soft), ...)` (now a flat neutral, but still written as a gradient) | `background-color: var(--acc-soft)` |
| Tree | `[AC] [EM] ...` tile marks, "+--[ NEXT UP ]--", "> Nothing recorded" | terminal noise | `DotMark`-style marks or plain initials; plain headings |
| Career | "Add application (N)" | the key hint printed in the label | a key cap, or the hint in the title |
| Setup | "SU1", the rotation table | a code label; hairline rules between rows; the matches inputs clip their text | drop the code; space instead of rules; wider inputs |

**Not verified.** Real window translucency and resizing are the desktop host's (asked of the engine lane): the frosted ground was
seen only over the specimen's stand-in wallpaper in Chromium, never over a real desktop in WebView2. The "/" key was checked in
Chromium and happy-dom, not in the WebView2 window. Scheme B was pictured, not chosen: the owner chooses.

**What it changed.** The look of every v3 view (tokens), the shell's chrome, the kit's fills, and the start of a character-art kit
the page packages can build their empty poses and centre pieces on.

**Sources.** The owner's words of 28 Nov (brief); the owner's design law (amber accent, AA contrast, no fake data, reduced motion);
WCAG 2.2 relative luminance for every ratio; the repo's own measurements above.

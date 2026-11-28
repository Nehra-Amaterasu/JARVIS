# The design reset, 28 Nov 2026: monochrome first, colour as signal, chrome that gives room back

The rules every page of The System inherits since the owner rejected the look of 25 Nov ("the accents we chose for all sections
are ai slop", "this is starting to look more and more like slop ai designs, because of the colours and the gradients"). This note
is the rules **as built**. The values live in one token file, `app/ui/src/styles/design/v3/glass.css`; the shell imports it
(`app/ui/src/shell/v3/shell-v3-tokens.css`). The specimen is the gallery entry **v3/Reset** (`app/ui/src/gallery/entries/v3-reset.tsx`).

## 1. Monochrome first

Two grounds, each with ONE tray surface a single step away and ONE raised step for controls. Every value has chroma 0 on the dark
ground (channels within 1) and a warm neutral on the light ground (channels within 5, not the cream band). No hue tint on any
ground or tray, no gradient fill anywhere in the chrome or the kit, no glow. A soft key keeps its two-shadow relief (one light from
the top left): that is lighting, not a colour gradient.

| Role | Dark ground | Light ground |
| --- | --- | --- |
| Ground (alpha with glass on) | `#0c0c0d` (.78) | `#f1f0ec` (.82) |
| Tray, the one surface (all three tiers) | `#161617` (.94) | `#faf9f6` (.95) |
| Raised (every key) / hover | `#202021` / `#272728` | `#fdfcfa` / `#ffffff` |
| Lit (a selected key) | `#2f2f30` | `#ffffff` |
| Well (inputs, tracks) | `#080809` (.95) | `#e8e7e3` (.95) |
| Popover (opaque) | `#1c1c1d` | `#fbfaf8` |
| Ink / ink 2 / ink 3 | `#ededea` / `#b4b4af` / `#8f8f8a` | `#161614` / `#474743` / `#5e5e59` |

The spine sits on the ground (it is not a second panel); the canvas is not a surface either, so a view never puts a tray inside a
tray. Hierarchy between the three trays is made by order, type (the first tray's job in ink, the others in ink 2, the third in
13 px) and shadow depth (the first tray is the most lifted), never by a second fill.

**Contrast**, worst backdrop and no brightness help (the desktop host cannot apply one): white behind the dark ground, black behind
the light one. Recomputed by `src/__tests__/v3/tokens-v3.test.ts` on every run.

| Pair | Dark | Light |
| --- | --- | --- |
| ink on the bare ground | 8.6 | 10.5 |
| ink 2 on the bare ground | 4.9 | 5.4 |
| ink 3 on the tray (never on the bare ground) | 5.4 | 6.0 |
| ink 2 on the tray | 8.5 | 8.7 |
| ink on a raised key | 14.0 | 17.7 |
| the locked label on the well | 7.0 | 5.2 |

## 2. Colour is a signal

The accent appears ONLY as: a 6 px dot (the active spine row, the current view tab, a lit key), a 2 px rule (the active row in
the rail, the flare of a real event), the ONE primary key of a view, a live value, a selected mark (the open project's mark, the
caret, an ON switch). Never as a panel, never as a large fill. `src/__tests__/shell/v3/css.test.ts` lists every rule of the shell
that reads `--accent`; a new one fails the test until it is argued for.

Two schemes behind one attribute on `<html>`, `data-accent`, so the owner chooses from pictures (More, "Colour per project", or the
fragment `accent=one|project`):

| | Dark ground (on a tray / label on it) | Light ground (on a tray / label on it) |
| --- | --- | --- |
| **A, the default: one instrument amber for the whole System** | `#edaa3a` (8.7 / 9.2) | `#8a5806` (5.0 / 5.1) |
| B, JARVIS | the same amber | the same amber |
| B, Aankhen: phosphor green (a trace on a scope) | `#86e07a` (10.9 / 11.1) | `#2f7a3a` (4.9 / 5.3) |
| B, Yadaash: cobalt | `#8ea6ff` (7.6 / 8.0) | `#3651c9` (6.1 / 6.6) |
| B, Well Wisher: deep rose | `#ff7ea9` (7.4 / 7.7) | `#b0245e` (6.0 / 6.4) |

Why amber: one decisive colour that holds on both grounds and cannot be read as a state. Red belongs to FAULT; green would read as
"success"; the stock orange `#f2591a`, the teal and the violet of the 25 Nov hues are the AI-dashboard set the owner named. Amber is
an instrument-panel colour and the owner's own design law names a warm amber as the accent. In both schemes the projects are told
apart by their glyph, their name and their own character-art mark, never only by a colour; every scheme B accent sits at least 20
degrees of hue from the fault red.

## 3. States: the same five shapes and words, quieter

LIVE, WAITING, SIMULATED, PLANNED, FAULT keep their five shapes (disc, half disc, diamond, dashed ring, triangle with its bar) and
their words (`shared/lamp`, unchanged). Only FAULT keeps a colour of its own (`#ff5f57` dark, `#b3261e` light); LIVE takes the
accent; WAITING and SIMULATED are ink 2, PLANNED is ink 3. Under the v3 look an element is no longer boxed by a dashed hairline
because it is PLANNED (`shared/kit/clay.css`): the ring and the word say it; high contrast and forced colours keep the edge.

## 4. Type and space

One reading face, **Inter Variable**; one mono for machine values, **Geist Mono Variable** (both bundled, so every machine draws the
same letters). Doto, the bundled dot-matrix face, is kept for character art and nothing else. The strict scale:

| px | Role |
| --- | --- |
| 28 | display: a hero state or view title |
| 20 | title: the section in the top plate |
| 16 | lead: a tray headline, an empty pose |
| 14 | body: rows, keys, sentences |
| 13 | small: the third tray, reasons |
| 12 | meta: times, counts, captions |
| 11 | label: tray jobs and state words, caps, 0.08 to 0.1 em |

The older names snap onto it (`--t-15` reads 14, `--t-17` 16, `--t-21` 20, `--t-32` 28). Nothing under 11 px. Tray heads lost the
numeral well, the bracket and the corner tick (they read as terminal noise): one small label style, the job in 11 px caps; the
numeral stays in the markup, visually hidden, for "Step 1:" on a screen reader. Space: an 8 px grid, 6 px inside a group, 16 px
between groups; trays pad 16 / 18 px.

## 5. The signature: character art

Dot-matrix figures, drawn like an instrument's display, used deliberately for three jobs (`shared/kit/v3/Art.tsx`):

- **DotMark**: each project's own mark: JARVIS five bars of a level, Aankhen three radio arcs from a source (signals, never an eye
  or a lens), Yadaash rows of stored bits, Well Wisher the sun on the horizon, the System the four squares in dots.
- **StateFigure**: the five lamp shapes as a 9 x 9 figure, computed from the same geometry as the lamp, so the two cannot disagree.
- **EmptyPose**: figure, title, the state word and the reason, where the dashed "terminal box" used to be.
- Two readers of real values: **DotLevel** (a level as lit dots) and **DotRing** (a ring of dots for a centre piece). Both light a
  dot only under LIVE or SIMULATED and only from a finite value; under any other state every dot stays unlit and the name says why.

The only loops are states: LIVE breathes, WAITING sweeps its ring. Reduced motion and the calm setting stop both.

## 6. Motion is state

The existing tokens only (`--s3-d-*`, `--d-*`, one easing). The fold of the spine, the slim plate and the open dock share
`--s3-d-state` and `--s3-d-sheet`. The flare (a real event) is a 2 px accent rule that fades once; the glint sweep is gone (it was a
gradient). Reduced motion keeps every state change, instantly.

## 7. Glass (CSS side only)

When the host makes the window translucent (`data-glass="on"`), the ground is a frosted layer at .78 / .82 with
`blur(48px) saturate(0.6)`: the desktop comes through as soft, desaturated light, so a wallpaper never tints the System and text
holds the contrast above even over pure white. With the glass off the same values are opaque. Real window translucency and resizing
are the desktop host's (asked of the engine lane); nothing here is verified on the real window.

## 8. Chrome that gives room back (V1)

| At 1366 x 768 | Before | After |
| --- | --- | --- |
| Spine | 184 px, always | 64 px rail by itself below 1420 px of window; 184 px from 1420 up; can be pinned either way |
| Top plate | 64 px plate | 56 px bare line; 44 px (one line) when the view is scrolled or the window is under 760 px tall |
| Dock | 76 px (12 + 52 + 12) | 44 px, the same when it opens |
| Main padding and gaps | 16 px and 14 px | 10 px and 8 px |
| Vertical chrome | 200 px | 136 px full, 124 px slim (64 to 76 px given back) |
| Horizontal chrome | 216 px | 80 px (136 px given back) |

- **Spine.** `AUTO_RAIL_BELOW = 1420` (ShellV3.tsx), measured from the grid: with the 184 px spine at 1366 px the third tray is
  277 px, under the 288 px a third tray needs for a row with its state word and a key; at 1420 it is 290; with the rail at 1366 it
  is 306. The fold key always does what it shows; the choice is kept as a pin only while it differs from what the window would
  choose (`app.spine`), so folding back returns the sidebar to automatic. In the rail the open project's sections stay as icons,
  the active one marked by a 2 px accent rule, and each names itself in a flyout on hover and keyboard focus.
- **Top plate.** A scroll of more than 24 px in any scroller of the stage makes it slim; it opens again when that scroller is back
  at its top, and on every new place. The view tabs stay in the line in both forms. The title shrinks by a transform (scale .8).
- **Dock.** A 44 px line at rest: the mode keys flat, the well without its press, the send key hidden but keeping its place. It
  opens on hover, while focus is inside it, while it holds unsent text, and on the "/" key from anywhere outside a text field. It
  never changes height, so nothing above it moves under the pointer.
- **Every tray body scrolls** its own content when it is taller than the tray, with a 24 px soft edge (a mask, not a colour) on the
  side that has more, read from the real scroll position. A view's own inner scroller keeps working (the body gives it the same
  height as before).

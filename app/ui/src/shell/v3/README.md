# Shell v3: the contract for the section layout passes

This folder is the shell and navigation of the v3 look ("the frosted deck", `docs/design/design-language-v3.md`, sections 3,
4.1 to 4.7, 4.14 and 8.3). The layout pass of each section builds on it. Read this file, then `contract.tsx` (the types).

Everything here is inert unless the look is v3: `shell/look.ts` reads `app.look` / the fragment `look=v3` once per page load
(`look=off` turns it back), `ShellV2.tsx` takes one branch to `ShellV3`, and with the look off none of this code or CSS is
downloaded.

## What the shell gives a view

- **Frame.** A spine (208 px, left; on the phone a tab bar and a project sheet), a top plate (location as project / section /
  view, the view switch, ONE lamp pill, More, the window keys), the canvas, and the dock at the foot. A view draws only inside
  the canvas. Until its own pass an existing view mounts unchanged and may scroll inside the canvas.
- **Unchanged contracts.** Views still come from `shell/views` (`collectViews`) and mount as today. The root keeps
  `data-shell="v2"` and `data-product`; the page wrapper keeps `.s2-page` with `data-section` and `data-view`; the scroller keeps
  `.s2-canvas`. `shell/store.ts`, `shell/keymap.ts` (Ctrl+1..5, Alt+0, `[` `]`, Ctrl+K) and `shell/ids.ts` are the place model;
  v3 maps `#section/view` onto the store (`subprojects.ts`: `placeOfHash`, `hashOfPlace`).
- **Keys added** (3.5): Up/Down walk the spine, Alt+Up/Down walk the ten sections in spine order, Alt+Left/Right the views,
  Esc closes a popover or sheet and returns focus to its key.

## 1. Style a view only under the look

Use the root attribute, never a class of the shell:

```css
:root[data-look='v3'] .my-view { ... }          /* the v3 layout of the view; the current look never matches it */
:root[data-look='v3'] .s3[data-ground='light'] .my-view { ... }   /* a rule for Well Wisher only */
:root[data-look='v3'][data-glass='off'] .my-view { ... }          /* only when the Frosted switch is off */
```

- `data-look="v3"` and `data-glass="on|off"` are on `<html>`; `.s3` (the shell root) also carries `data-ground="dark|light"`.
- In code: `import { lookV3Enabled } from '../../shell/v3'`. Branch once, at the top of the view; never mount two layouts.
- Use the token names of spec section 2 (`--ink`, `--ink2`, `--ink3`, `--well-rgb`, `--wa`, `--lit-a`, `--raised`, `--sh-press`,
  `--live`, `--fault`, `--sim`, `--accent` ...). The shell's own fallbacks are in `shell-v3-tokens.css`; the tokens package
  (`styles/design/clay/glass.css`) wins when it lands. The same lint rules apply to your stylesheet: no colour, duration or
  easing literal outside a token file, rem not px for type, radius, padding, margin and gap, explicit `transition-property`.

## 2. Build the view on `<Zones>` and `<Tray>`

```tsx
import { Zones } from '../../shell/v3'

<Zones
  ratio="core"                      // 'default' 1.85:1.05:.95 | 'core' 1.85:1.05:.8 | 'console' 1.6:1.15:1 | [a, b, c]
  first ={{ job: 'WAKE', chip: <Chip state="waiting" />, flare: wakeCount, children: <>…the state headline, the ONE accent key, the object…</> }}
  second={{ job: 'CONVERSATION', peek: { name: 'Conversation', lamp: 'waiting', note: 'core not started' }, children: … }}
  third ={{ job: 'VOICE PATH',   peek: { name: 'Voice path',   lamp: 'waiting' },                         children: … }}
/>
```

- **Three trays, one order** (rule 4.1.1): the first act and its object, what follows, reference. Left to right on the
  desktop; on the phone the first tray scrolls inside the canvas and the second and third open as opaque bottom sheets from
  two pills. A view does not write the phone layout: it gives the three trays and the pills' words.
- **The step label is drawn by `Tray`**: a numeral in a 20 px pressed well and the job in 12 px mono caps ("1 WAKE",
  "2 CONVERSATION", "3 VOICE PATH"). The numeral gets a corner tick on the dark ground and `[1]` brackets on the light ground.
  The words NOW, NEXT and LATER are never printed. `job` is the verb or noun of the tray in caps and must not repeat a view name
  that is on the same screen. A real datum may stand in `chip` (the date); a state is always the kit's Chip, never plain text.
- **Ruler** (rule 4.3): the first tray only, drawn by `Tray`. Dark ground: a rail of small formed marks; light ground: the
  ASCII rule built from the measured width so it ends on a full bar. Hidden on the phone. `ruler: false` leaves it out.
- **Material** is the tray's, not the view's: tint, radius, shadow and type size per step (spec 2.5). Do not set a background,
  shadow or radius on a tray; put wells, groups and keys inside it. A well that holds text keeps its alpha at .93 or more.
- **`flare`**: pass a number that rises when something real happens (a wake, a block start, a cleared fault); the first tray's
  glare brightens once per rise. Do not pass a timer.
- **`<Glint />`**: place as the last child of the hero object (the stage, the arc, the gauge) for the one glint when the
  place changes. A view has at most one continuous motion.
- **`<PhonePeeks />`** (optional): place it where the order wants the two pills (after the accent key). If you do not, the pills
  sit under the first tray. A pill is led by a state, never by a count of empty slots: give `peek.lamp` and, if it helps,
  `peek.note` ("nothing dated"). A count is shown only for real items.
- Every view has three trays. A view with no natural third step still gives one (the spec's section 9 leaves a two-tray ratio
  open); a view may pass its own three numbers for `ratio`, for example the jury's Console proposal `[1.6, 1.25, 0.85]`.

## 3. Tell the dock and More what the view owns

The capture line or command line a view owns today moves into the dock (rule 4.14). Register it once, at the top of the view:

```tsx
import { useViewChrome, type ViewChromeSpec } from '../../shell/v3'

const CHROME: ViewChromeSpec = {                       // a module constant, or useMemo: the registration is re-made only when it changes
  dock: {
    modes: [{ id: 'type', label: 'Type', prefix: 'you>', example: 'Wake JARVIS, then type', action: 'Send' }],
    onSubmit: (mode, text) => send(text),
  },
  more: [                                              // rule 4.7: used less than about once a week; never loose in a tray
    { id: 'anatomy', label: 'Anatomy', onSelect: openAnatomy },
    { id: 'earlier', label: 'Earlier turns', onSelect: showEarlier },
  ],
}
export function CoreTalk() { useViewChrome(CHROME); … }
```

- `modes`: the view's own mode, usually one. The shell always adds **Ask** last (it opens the palette). With one own mode
  the dock shows a two-key switch, "Type | Ask", on every width (never a lone "Ask" while the mode is another).
- **A mode label must not repeat a view name on the same screen**: Core's view is Talk, so its mode is `Type`; Console's is
  `Command`; Day's is `Capture`. The example is given WITHOUT "e.g." (the dock adds it and dims it, so it never reads as typed).
- `onSubmit(modeId, text)` is called on Enter or the submit key in one of the view's own modes; Ask is the shell's.
  It may return `false` (or a promise of `false`, or throw) when the line was not taken: the dock then keeps the person's text so they can
  retry; any other result clears the input. The dock is never remounted on a place change, so a half-typed line and the picked mode
  survive a switch of view or section (the mode falls back to the first when the new view does not register it).
- The registration is removed when the view unmounts, so a place change never leaves the last view's modes behind. A view
  that registers nothing still gets a dock with Ask alone and a More with the shell's own rows ("Current look", "Classic UI").
- `more` actions come before the shell's own rows under "RARELY NEEDED"; More's tooltip names the count ("5 more actions"), there is
  no number badge. The Appearance row (the Frosted switch) and the key hints are the shell's.
- Outside the v3 shell `useViewChrome` does nothing, so a view may call it unconditionally.

## 4. Name the three steps

One word or two per tray, in caps, the job and not the order: Core WAKE / CONVERSATION / VOICE PATH; Day START / FOLLOW-UPS /
EVIDENCE; Console FIX FIRST / DETAIL / ACTIVITY. Write `job` as plain text; `Tray` adds the numeral, the tick or brackets and a
visually hidden "Step 1: " for screen readers.

## 5. Truth rules a layout pass keeps

No camera, no radar; nothing simulated shown as measured; every number carries a lamp and its state word (LIVE, WAITING,
SIMULATED, PLANNED, FAULT); an empty reading is a pose with a reason, never a skeleton; no streaks or pressure. The lamp pill
and the spine read one table (`lamps.ts`), so a view that reports a lamp (`useStore` readings) is counted in both. The shell never
invents a state: a lamp nobody reported is WAITING with the words of what it waits for.

## Files

| File | Job |
| --- | --- |
| `ShellV3.tsx` | the frame; hash routing; keys; theme and look attributes on `<html>` |
| `Spine.tsx` | four project tiles and the open tray (`spineModel`), the phone `TabBar` |
| `TopPlate.tsx`, `ViewChip.tsx`, `LampPill.tsx`, `Popover.tsx` | location, view switch, the one lamp pill, More, the phone view chip, the opaque popover |
| `Dock.tsx` | mode switch and the one input |
| `Zones.tsx`, `Tray.tsx`, `Sheets.tsx` | the three-tray frame, the step label and ruler, the phone pills and sheets |
| `contract.tsx` | the exported types and `useViewChrome` |
| `subprojects.ts`, `lamps.ts`, `Glyphs.tsx` | presentation grouping and routing, the lamp rows, the drawn marks |
| `shell-v3-tokens.css`, `shell-v3.css` | the tokens (names of spec section 2) and the shell's own styles, all under `.s3` |

## Two integration notes

- **Tokens.** `shell-v3-tokens.css` holds the spec's token NAMES with its values under `:root:where([data-look='v3'])` (specificity
  0,1,0). The tokens package's `:root[data-look='v3']` (0,2,0) beats it whatever the import order, so there is one source of truth
  once `styles/design/clay/glass.css` lands. At integration, delete the duplicated glass/ground values from the shell file and keep
  only the `--s3-*` names (they are the shell's own).
- **Open edit (outside this package).** Ask hands the typed text to the shell, but `shell/Palette.tsx` takes no starting query, so
  the dock keeps the text in its input. Edit: give `Palette` an optional `initialQuery?: string` prop (`useState(initialQuery ?? '')`)
  and have `ShellV3` pass the text it got from `onAsk(text)` through `openOverlay('palette')`'s sibling store field. Until then
  nothing typed is lost.

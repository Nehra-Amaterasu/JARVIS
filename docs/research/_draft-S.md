## 2026-11-25: one look (v3 by default), a slim spine, project hues

Draft by package S (rows R0 and R8 of plan 08). The integrator folds this into the running topic file (`docs/research/ui-shell.md` or the one plan 08 names) and deletes this draft.

### The question

The owner had three looks on screen and wrote: "merge the 2 looks into one. keep the good part of both, remove the bad ones... i admire the new look all the time. keep on building on top", "everything too white, use some colors", "the nav bar too fat slim it. use better logos", "in the whole application we are doing the terminal look, but its making some part incomprehensible", and asked that the shell leave room for the agents (Yadaash chat) and the engine work, with the relation of the parts set better. So: make v3 the only look, slim the spine, give each project a hue, replace the abstract glyphs, stop using mono type for sentences, and keep the thirty-nine hundred older tests green without rewriting them.

### What was decided, and why

1. **v3 is the default and the only look offered.** `lookV3Enabled()` is off only for the fragment `look=off`, a stored `app.look = off`, or a build with `VITE_LOOK_DEFAULT=off`. A stored value wins over the build default in both directions. Read at call time, not at import, so a unit test can stub it.
   - Why a build variable rather than rewriting tests: 3,999 unit tests and most browser specs are written against the older frame. Setting `VITE_LOOK_DEFAULT=off` in `vitest.config.ts` (`test.env`) and in the e2e build (`scripts/build-e2e.mjs`, called by `npm run bundle:check`) costs one line each. A plain `vite build` (the real app) gets v3.
   - `.env.e2e` was not used: `.env.*` is git-ignored in this repository, so the setting would not travel. A small Node wrapper is cross-platform and tracked.
2. **No look key anywhere under v3.** The two rows "Current look" and "Classic UI" are removed from More (More now holds only what the open view registers, plus appearance and keys). The older frame still draws "New look" and "Classic UI" in its own top bar; it is reachable only by `look=off`, and v3 has no way back except that fragment.
3. **Slim spine.** 168 px (was 208), rows of one line at 44 px (the project plates were two lines at 56). A project row is icon, name, a small state lamp; the state word is the lamp's title and the row's accessible name, and is printed as text once, under the open project. The open project's sections are listed under it, indented 14 px, one line each. Folds to a 64 px icon rail by a key at the foot; the choice is `localStorage app.spine` (`rail` | `full`); in the rail every row keeps its name as tooltip and `aria-label`, and the lamp stays as a corner dot. The fold animates the grid column (`transition-property: grid-template-columns`, the sheet token, 300 ms) so the canvas follows frame by frame. The phone keeps its tab bar and sheet; the fold key is hidden there and is not a stop of the sheet's focus trap.
4. **The four relate by order, not boxes.** Groups `room` (JARVIS, Aankhen), `memory` (Yadaash), `day` (Well Wisher), one 14 px gap between groups. Under Yadaash, one planned row, **Agents**: `SpineExtra` in `subprojects.ts`, state planned (dashed ring), title "Agents are being planned; nothing runs here yet". It is not a place (not in `SECTIONS`, not in Alt+Up/Down, not in the hash); pressing it calls `openPlanned('jarvis.agents')`, which opens the existing roadmap pose focused on that entry. The pose's own sentence comes from `jarvis/planned.ts` (a view folder, not mine): "Agents that act on their own are not built. The staff roster below only reports what runs now." If the owner wants the exact sentence of the brief inside the pose, that entry's `line` is the one place to change.
5. **Icons (lucide, one metaphor each, stroke 1.75, 18 px in rows; chosen only in `Glyphs.tsx`).** Projects: JARVIS `Mic` (the voice), Aankhen `Wifi` (radio arcs; signals only, never an eye, lens or radar), Yadaash `Brain`, Well Wisher `Star`. Sections: core `AudioLines`, room `House`, console `Gauge`, senses `Waves`, memory `BookMarked`, agents `Bot`, day `CalendarDays`, focus `Target`, study `BookOpen`, tree `Sprout`, career `Briefcase`. Fold key `PanelLeftClose` / `PanelLeftOpen`. The state glyphs (shape per state) stay hand-drawn.
6. **Colour by meaning, tokens only in `shell-v3-tokens.css`.** One hue per project, given twice (a lighter value for the dark ground, a deeper one for the light) as r, g, b channels so a tint can be made of it:

   | project | dark ground | light ground | note |
   | --- | --- | --- | --- |
   | JARVIS | `242, 89, 26` | `196, 65, 12` | amber-orange, its present accent, unchanged on dark |
   | AANKHEN | `41, 182, 232` | `10, 116, 160` | cyan-blue, 196 degrees (live teal is 174) |
   | YADAASH | `192, 108, 240` | `138, 47, 194` | magenta-leaning violet, 278 degrees (simulated lavender is 253) |
   | WELL WISHER | `217, 138, 98` | `168, 81, 47` | rust; as the open project on the light ground it is `#a8512f` |

   - Current project, on the root (`data-hue` on `<html>`, set by `ShellV3`): `--hue`, `--hue-lo` (78 percent), `--acc-soft` (12 percent), `--acc-ground` (4), `--acc-tray` (5), `--acc-tray-1` (8). Per project: `--hue-<id>`, `--hue-<id>-lo`, `--hue-<id>-rgb`.
   - The accent key follows the open project through the names the kit already reads (`--accent`, `--accent-a`, `--accent-b`, `--on-accent`, the glow, `--cap-fill`, `--cap-ink`, `--sh-accent-press`, and the shell's `--s3-kcap-*`). JARVIS keeps its orange. AANKHEN `#29b6e8`, YADAASH `#c06cf0`, WELL WISHER `#a8512f`. The label on each fill: 7.99, 6.04 and 5.07 to 1 (pressed end 4.80 and 6.20 for the last two); key caps 7.30, 8.75, 9.21.
   - Placement: spine mark (open project full strength, others `--hue-<id>-lo`), active row dot and icon, active tab (hue dot and 12 percent tint), the lit pill under the active spine row (12 percent tint), the ground (4 percent), the spine (5), canvas, top plate, dock and trays (5), the first tray (8, so the eye knows where to start).
   - **Known tension, stated plainly:** the owner's brief says the tray ground takes 3 to 5 percent; the first tray takes 8. That is "slightly stronger" read as a step of 3 points, and it is the one value to lower if the picture looks heavy. Not seen in a browser (see below).
   - **Known tension 2:** the brief says WELL WISHER keeps its present accent, and its present accent is the same orange as JARVIS (`#f2591a`, one shared token). Two projects cannot both keep one colour and be told apart by it, so Well Wisher's hue and accent key become rust and JARVIS keeps the orange. If the owner wants Well Wisher's action key to stay orange, delete the last block of `shell-v3-tokens.css` (the `wellwisher` accent override); the hue tokens stand alone.
   - State colours (`--live`, `--fault`, `--sim`, `--locked`) are not reused. The two nearest pairs (Aankhen/live, Yadaash/simulated) are 22 and 25 degrees apart in HSL and a test (`css.test.ts`) refuses a hue within 20 degrees of either. A state is still a shape and a word, so the hue is never the only carrier.
7. **Mono only for machine values.** `.s3-step` (tray job), `.s3-loc-p`, `.s3-cap`, `.s3-pn`, the pill, the lamp words and head chips are in the reading face (`Segoe UI` stack), still small caps with tracking where they were. Mono stays for the clock, counts, key hints (`kbd`), the dock's input and prompt, and the tray numeral. In the kit, `.v3-step`, `.v3-group-cap` and `.v3-dial-name` moved to `--f-ui`; the kit's chips and cap words, gauge numerals and ledgers stay mono (they are state codes and values).
8. **The dotted ruler under the first tray head is not drawn** (`.s3-ruler` and `.v3-ruler[data-kind]` are `display: none`). The elements stay: `Tray`, the kit's `Ruler` and about a dozen tests mount and count them, and removing them would have touched view folders.
9. **Motion, no loops.** Row hover and press with the existing key tokens; the fold (grid column, sheet token); the lit pill is one element that slides between active rows (`translate` measured from the row, `transform` and `opacity` only, switched on one frame after first paint so it does not fly in from the top); everything is stopped by the existing `prefers-reduced-motion` block.

### Measured

- `npx tsc -b`: exit 0.
- `npx vitest run` (whole suite, `VITE_LOOK_DEFAULT=off` in `vitest.config.ts`): **189 test files, 3,999 tests, all passed, exit 0.**
- New or changed tests this package: `look.test.ts` (the default is on when the build does not say off; `look=off` and a stored `off` turn it off; a stored `v3` wins over `VITE_LOOK_DEFAULT=off`), `css.test.ts` (hue contrast, tint steps, spine widths, 44 px rows, no mono on titles), `shellV3.test.tsx` and `reviewFixes.test.tsx` (one-line rows, group gaps, Agents row opens the pose and is not a place, hue on the root, fold and its memory, no look key).
- Contrast, recomputed from the token numbers (`css.test.ts`), worst backdrop (white behind the dark ground in the desktop host, black behind the light one):

  | text on | JARVIS | AANKHEN | YADAASH | WELL WISHER |
  | --- | --- | --- | --- | --- |
  | `--ink2` on ground + 4 percent hue | 5.57 | 5.44 | 5.51 | 5.75 |
  | `--ink2` on spine + 5 percent hue | 5.45 | 5.28 | 5.37 | not tested (light spine) |
  | `--ink` on first tray + 8 percent hue | 4.88 | 4.66 | 4.78 | 12.07 |

  Marks: the open project's hue holds 3 to 1 on the dark spine in a plain browser (backdrop 128) and on the light first tray (5.3). In the desktop host with a white wallpaper behind, JARVIS orange on the spine is 2.78 to 1 and Yadaash 2.97; that is below 3 and is accepted because the name sits beside every mark and the mark is not the only carrier.
- Spine widths from the CSS and the test: 168 px full, 64 px folded; row height `min-height: 44px` on `.s3-head` and `.s3-item`. Not measured in a browser (see below).
- `tests/` privacy scan (`pytest tests -q -p no:warnings` from the worktree root): 25 passed.

### Not verified

- **No browser run, and no picture was looked at.** Free space on the system drive was 9.4 GB at the start, fell to under 0.2 GB while other builders ran (page file and agent processes), and stayed under 0.5 GB for the whole session. The brief says to skip Playwright under 6 GB free, and I did. The e2e bundle (`dist-e2e`, built with `VITE_LOOK_DEFAULT=off VITE_ART_TRACK=private`, 7.6 MB, built clean in 3 s) exists in the worktree, and `e2e/one-look.spec.ts` is written, but neither was run. Nothing about 1366x768, 1120x720 or 390x844 layout, overlap, the actual width of the spine in Chromium, the pill's slide, the rail, the look of the tints or the legibility of the icons has been seen. Treat all of it as unverified until `e2e/one-look.spec.ts`, `shell-v3.spec.ts`, `v3-kit.spec.ts`, `cp2-ww-pages.spec.ts` and `classroom-shelf.spec.ts` run and the pictures in `$TEMP/ui-shell-shots` are looked at.
- `e2e/shell-v3.spec.ts` was edited for the new spine (width 168, the name and lamp selectors) and not run.
- Hit-area spec (`e2e/hit-areas.spec.ts`): the rail row is 48 px wide inside a 64 px spine (spine padding 8 px each side); not measured.
- The tinted surfaces are only computed, not seen: 4 and 5 percent of a hue over the glass layers may read as nothing on the light ground (the owner's "too white" complaint), and 8 percent on the first tray may read as muddy on the dark ones.

### What remains

- Run the five browser specs and look at the pictures once the disk has room; tune `--acc-ground`, `--acc-tray`, `--acc-tray-1` (they are three numbers in `shell-v3-tokens.css`) from what is seen.
- Views that read their own accent in their own stylesheets (`jarvis/**`, `ww/**`) keep their own colours; they pick up the new project hues only where they read `--accent`, `--accent-a`, `--accent-b`, `--on-accent` or the new `--hue` family. A follow-up for the view builders: use `--hue`, `--acc-soft` for a selected row or tab inside a view, never a literal.
- `jarvis/planned.ts`: the entry `jarvis.agents` has `home: 'console.crew'` and a sentence that talks about the staff roster. Now that Agents also has a row under Yadaash, its `home` and `line` belong to the Yadaash chat's decision.
- `e2e/glitch-sweep.spec.ts` flips "New UI and Classic UI" three times through keys of the older frame; it still works under `look=off` and is untouched.
- The kit's chips and gauge numerals are still mono (state codes and values); a later pass may move the chip words if they read as terminal text.

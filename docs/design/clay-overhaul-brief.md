# Clay overhaul: the owner's brief for the app-wide redesign (10 Nov)

Written for: the UI-overhaul chat, which owns the shell, the nav, `styles/tokens.css`, `styles/design/**` and `styles/sections/**` (see `app-ui-overhaul.md` section 4). This file records what the owner asked for on 10 Nov, in his order. It then maps each ask onto what is already built, so nothing is redone. The Well Wisher chat builds inside `app/ui/src/ww/**` and keeps to this brief. Reference images: five pictures in the private notes (`data/notes/design-taste/2026-11-10/`, git-ignored).

## 1. What he asked for

**One look for the whole app: clay neumorphism.**
- The main theme is black and white.
- Other themes are variations under it:
  - red with white or black;
  - neon colours with white or black.
- Every component has a matte clay finish, raised from the background.
- Text is raised too, at its own depth along the z axis, with real depth and real shadows.
- Hover settles the element back into the ground. A press, spread or open is felt as movement in depth.
- Reference 4 (a neumorphism guide) is the pattern for components.
- Reference 5 is the white "data scene" look: raised blocks, a terminal-style mono type, thin rules, a dotted grid, sparse red and teal accents.
- The aim is "Nothing"-like minimal widgets. No bento grids.

**Genres per section, all on the clay base.** The genres are brutalism, neolithic, Y2K, ASCII, retro-futurism, cybersigilism, matrix/terminal and minimalism. Each genre keeps the matte clay finish. Brutalism, for example, has sharp corners and bright colours but is still raised from clay. Sigils rise from clay with matte sparkle.

**An art centrepiece per section.**
- Each section has one piece of art behind it that interprets the section.
- The art draws on ASCII renderings of works like Van Gogh's sun, plus subjects like Hanuman.
- The art grows as the section is used (hover, interaction, progress).
- Loaders are ASCII animations.

**JARVIS's voice.**
- When JARVIS speaks, a point-cloud "hill" (reference 1) moves with the amplitude and frequency of the voice.
- The voice works the same way for input (his voice) and output (JARVIS speaking).
- Reference 2 informs the wave's motion.
- Reference 3 is the outer ring of JARVIS: radial bars around a raised ring, modulated by the voice.
- The current JARVIS screen is not replaced. The hill becomes part of it.
- If real-time analysis is too heavy, precomputed shapes may roll through instead. The overhaul decides which.

**No page scroll.**
- Every page is one laptop-screen canvas. Test it at 1366 x 768 and 1920 x 1080.
- What does not fit becomes another page, a pager or an overlay.
- The structure and component placement are rethought for that rule. The app must get more compact as features grow.

**Built for daily use with ADHD.**
- Every component should be engaging enough that he wants to stay: low attention span, immediate feedback.
- Use proven, researched engagement tactics, applied for his own good.

**Every planned feature gets its control now.** This covers JARVIS, Aankhen, Limbs, Spotify, Yaadash and Well Wisher. A feature that is not built yet still gets its button, switch or section now, marked as not built yet.

## 2. Where honesty limits the brief

The project rules still apply; these are the edges they set:
- **A placeholder looks like a placeholder.** A feature's control may exist before the feature, but it is never wired to pretend. Pressing it opens what the feature will do and when, from the registry. It never fakes a state. The Well Wisher registry is already built: `app/ui/src/ww/plannedFeatures.ts` (chunk 5), feeding a Roadmap overlay. The other sections should reuse that shape.
- **Engagement is earned, not manipulative.** These are allowed:
  - immediate visible feedback on every tap;
  - streaks shown as facts;
  - implementation intentions and two-minute starts;
  - the art growing with real use;
  - variable but honest rewards, such as a new ASCII frame unlocked by a real logged session.

  These are not allowed: fake urgency, invented numbers, guilt messages, or anything shown as measured that is not. The owner's own words were "placebo" and "hysteria". The design should read those as delight and momentum, never as deception.
- **The voice hill shows the real signal.** It is driven by the real audio level and spectrum of the playing or recorded voice, through a Web Audio `AnalyserNode` on the TTS output and the mic input. A canned animation may stand in only while no audio flows, and it must not look like a reading.
- **Cameras.** Aankhen stays camera-free. No art or control may suggest a camera.

## 3. What already exists and should be reused

| Built (Well Wisher chat, merged or in review) | Reuse in the overhaul |
|---|---|
| Three-tier tokens: `styles/design/primitive.css` (shared), semantic themes in `ww/design/themes/*`, component tokens in `ww/design/component.css` | The clay finish is a new semantic and component layer, not a rewrite. Raised, settled and pressed become shadow tokens; a CSS lint already forbids literal colours and durations. |
| Motion vocabulary: 12 motions, a motion governor (`ww/design/motion/governor.ts`, levels high, low and none), reduced motion, spring curves checked against the closed form | The z-axis press and settle is a motion token pair (lift and settle) on the governor, so a weak GPU drops to fades. |
| The kit: 30 primitives in `ww/kit/*` (Button, Segmented, Card, Drawer, Placeholders and others) with 44 px hit areas and Playwright checks in three themes | Restyle the kit with clay tokens; the components and their tests stay. |
| The frame: six workspaces on Alt+1..6, scene memory, an overlay registry, the season state on the server | Already pages-not-scroll friendly: workspaces and overlays are the "new page" for what does not fit. |
| Carcass: `plannedFeatures.ts` plus the Roadmap overlay | The pattern for every section's pre-built controls. |
| A test harness: vitest contract tests, Playwright (hit areas, themes, keyboard, carcass, interaction budget), and a bundle budget | Add a no-scroll test per page at 1366 x 768 and a clay-contrast test; the existing ratchets hold. |

## 4. Decisions the overhaul must make first

1. **Contrast on clay.** Soft shadows on near-white fail the 3:1 rule for UI edges. The overhaul needs a measured clay palette, with each raised edge and text colour passing 4.5:1 for body text and 3:1 for UI, in the black-and-white theme and in each genre theme.
2. **Shadow cost.** Many stacked `box-shadow` layers on every component cost paint time. The overhaul should measure frame time on the real WebView2 window with the glass probe, and keep a flat fallback through the governor.
3. **Art pieces as ASCII.** Generate them as text art from the app's own rules or from public-domain sources (Van Gogh is public domain). Store them as text files, render them in a mono font, and animate growth by revealing characters, never as video.
4. **The voice hill.** Use a canvas point cloud of about 3 to 6k points driven by `AnalyserNode` data, sleeping when no audio plays. It needs a frame-time budget and a reduced-motion version: a static ring with one level bar.
5. **No-scroll layout.** Write the screen budget per page first: what is above the fold, what moves to a second page. Then a test that fails on any vertical scroll in the workspace centre.

## 5. Status

Not started. The Well Wisher chat follows the no-scroll rule from 10 Nov (its chunks 8 to 11 are briefed with it). It will adopt the clay tokens once the overhaul publishes them.

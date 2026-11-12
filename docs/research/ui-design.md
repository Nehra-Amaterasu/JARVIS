# UI design: placement, motion, tokens, patterns

Running file. Newest dated section on top. Public-safe: no personal details.

## 2026-11-09 (plan): contrast of the three planned themes, and corrections to the proposals

### Question

Do the semantic-tier values proposed for the default theme and two alternates meet WCAG 2.2 contrast (1.4.3 text 4.5:1, 1.4.11 non-text 3:1) on every surface, and which proposed values fail?

### Method

WCAG relative luminance, sRGB, per channel `v/255`, `c = v/12.92` if `v <= 0.03928` else `((v+0.055)/1.055)^2.4`, `L = 0.2126 R + 0.7152 G + 0.0722 B`, ratio `(L1+0.05)/(L2+0.05)`. A translucent ink is blended over the named surface first. Surfaces: Saffron Ash `#050506 #0b0c0f #111317 #181b20`; Vibhuti Paper `#f4f1ea #fbf9f4 #ebe7dd #ffffff`; Indigo Night `#07080f #0c0e1a #0f1220 #161a2c`. Computed with a 60-line script on 2026-11-09 (not kept; the chunk 1 contrast test recomputes everything from the token files).

### Findings (minimum over the four surfaces)

| Pair | Ash | Paper | Indigo |
|---|---|---|---|
| ink-1 / ink-2 / ink-3 (56 / 66 / 58 %) | 15.96 / 7.59 / 5.82 | 14.36 / 6.30 / 5.23 | 15.22 / 7.23 / 5.87 |
| line-ui (40 / 55 / 40 %) | 3.50 | 3.72 | 3.45 |
| on-accent on accent | 7.36 | 6.50 | 8.06 |
| accent as text | 6.64 | 5.27 | 7.26 |
| provenance live / sim / fault | 11.24 / 9.44 / 5.07 | 4.98 / 4.80 / 5.29 | 11.22 / 9.43 / 5.06 |

Corrections to the numbers in the proposals (all fixed in `docs/design/well-wisher-ui.md` 5.2):
- Ash `--line-ui` at white 34 % computes to 2.82 to 2.96, below 3:1 (a proposal claimed 3.06). At 36 % it is 3.04 on Ash but 3.00 on Indigo, no margin; 40 % gives 3.50 and 3.45.
- Paper accent `#a63a06` as text on its own 12 % wash on surface-2 is 4.42: fails 4.5. Rule: accent text never sits on the wash; selected states use ink.
- The proposed Paper "behind" colour `#8a6a2f` is 4.07 on surface-2: fails. `#7a5c25` gives 5.02 or more on all four.
- Old tokens, recomputed: ink-3 at 42 % = 3.77, ink-4 at 22 % = 1.79, white on saffron = 2.60, dark on saffron = 7.83, a 7 % white hairline on surface-1 = 1.16. The AA floor for ink-3 on Ash surface-3 is about 48 % alpha (4.61).
- High-contrast knob (ink-3 72 %, line-ui 60 %): ink-3 8.78 Ash, 8.39 Indigo, 6.30 Paper; line 6.45, 6.19, 4.31.
- Spring damping ratios, arithmetic: 170/22 = 0.84, 260/28 = 0.87, 120/14 = 0.64.

### What it changed

`docs/design/well-wisher-ui.md` section 5.2 (token values and the contrast table) and the contrast and CSS-lint tests in section 8.

---

## 2026-11-09: placement, motion and design-token principles for the Well Wisher redesign

### Question

What sourced, checkable knowledge should the Well Wisher design panel (9 Nov) use for a motion-rich, Awwwards-grade, themeable redesign whose sections are "attention-retainable and user-centred"? Five areas: (1) placement and attention, (2) motion, (3) tokens and theming, (4) component libraries to borrow patterns from, (5) honest placeholders for unbuilt features.

Method: primary pages fetched on 2026-11-09 (W3C, NN/g, Material Web token source, Tailwind, shadcn, Radix, Linear, Duolingo, Fogg, Awwwards, web.dev, MDN). Where a page was JavaScript-rendered and only its title came back (Apple HIG Materials/Motion, M3 easing page, M3 color roles) I say so and do not quote it. "UNVERIFIED" = from memory or a secondary summary, not read at the source.

### Headline findings

1. Attention is front-loaded, but pages are scrolled more than they used to be: above-the-fold share of viewing time fell 80% (2010) to 57% (2018); 74% of time sits in the first two screenfuls. Put the one primary thing in screen one, supporting things in screen two, nothing important after.
2. Motion budget: 100 ms for feedback, 200-300 ms for panels, 400 ms only for big travel; ease-out for entrances. Animate transform and opacity only. Honour prefers-reduced-motion by replacing travel with a fade, not by removing feedback.
3. Token tiers: primitive -> semantic -> component, themes swap only the semantic layer. Radix (12 steps), Geist (10 steps), shadcn (background/foreground pairs) and Linear (base + accent + contrast) all do this.
4. Measured on this repo's own tokens (computed 2026-11-09, WCAG formula): saffron #ff7a2e on #050506 = 7.83:1 (pass); --ink-2 = 8.17:1 (pass); --ink-3 = 3.77:1 (FAILS 4.5:1 for body text; passes 3:1 for large text and UI marks); --ink-4 = 1.79:1 (fails everything; it is used for the 12 px "minor" nav tab). White text on a saffron fill = 2.60:1 (fail); dark text on saffron = 7.83:1 (pass).
5. Glass belongs on the floating navigation/control layer, not on content; never glass on glass. Backdrop blur cost grows with area, so keep it small and static.
6. Retention mechanics (streaks, milestone celebrations) have real-world backing (Duolingo) but also a novelty-decay caveat (Hamari 2014) and a clear ethical line (Gray 2018). The owner's rule "the System suggests, you decide" maps to: no loss-framed guilt, no nagging, always a one-tap skip.
7. Awwwards scores Design 40%, Usability 30%, Creativity 20%, Content 10% (its evaluation page lists no mobile weight). Usability is 30%: motion that hurts usability costs points.

---

### 1. Placement and attention

| Topic | What the source says | Number / rule | Use for Well Wisher |
|---|---|---|---|
| F-pattern | On text-heavy pages without strong visual cues, people read across the top, then a shorter line lower, then scan the left edge; first lines and first words get most attention. Re-confirmed on desktop and mobile; mirrored for right-to-left. NN/g identified it in 2006 (article 2017, reviewed 2026). | Recent heatmaps: 45+ and 47 people; 2006 sample not stated | F is the failure mode of a text wall, not a layout to aim for. Counter it with headings that start with the informative word and keep important items top/left. [NN/g F-pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/) |
| Above the fold | 2010: 80% of viewing time above the fold (1024x768 screens). 2018: 57% above, 43% below; 74% in first two screenfuls, 81% in first three (about 130,000 fixations, 120 participants, 1920x1080). | 80% -> 57% | Screen one carries the one primary action and "today". Screen two carries supporting cards. After about 3 screens attention is under 20%. [NN/g scrolling and attention](https://www.nngroup.com/articles/scrolling-and-attention/) |
| 1366x768 vs 1920x1080 | NN/g's 2018 study used 1920x1080 only. No primary study found that splits attention by 1366x768. | UNVERIFIED for 1366x768 | Design screen one at 1366x768 minus the app chrome (measure the real window height in the app, do not assume); let 1920x1080 add breathing room, not more content. |
| Z-pattern | Practitioner heuristic for sparse landing pages. No primary study found. | UNVERIFIED | Hero-layout heuristic only; a daily dashboard is closer to F. |
| One primary action | Aesthetic and minimalist design: "Interfaces should not contain information that is irrelevant or rarely needed"; each extra element competes with the important ones. Visibility of system status: prompt feedback. Recognition over recall: make options visible. [NN/g ten heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Heuristics essentially unchanged since 1994 (reworded 2020) | One saffron thing per screen (theme.css already states this). Everything else neutral. |
| Progressive disclosure | Defer advanced or rarely used features to a secondary display; items on the first display signal importance; improves learnability, efficiency, error rate. | Two levels work best; three or more often leave users lost. Splitting interdependent tasks adds navigation. [NN/g](https://www.nngroup.com/articles/progressive-disclosure/) | Card -> expanded card is level 2. No third level. Collapsed `details` cards suit rarely used panels. |
| Hierarchy | Size, contrast, space; NN/g F-pattern advice adds bold key words and descriptive headings. | n/a | Rank on three steps only (primary / secondary / quiet) so rank reads at a glance. |
| Proximity | Items close together are perceived as one group; proximity can outweigh colour or shape. Keep spacing tight within a group, larger between groups; distant elements are overlooked; re-check groupings per breakpoint. [NN/g proximity](https://www.nngroup.com/articles/gestalt-proximity/) | Between-group gap must clearly exceed within-group gap | Why piled cards read as noise: equal gaps everywhere say "one group of 12 things". Use three spacing steps (inside card, between cards of a group, between groups); group gap at least about 2x card gap (my rule of thumb, not from the source). |
| Serial position | Items at the start and end of a sequence are recalled best. Put the least important in the middle; put key actions at the far left/right of navigation. The page credits Ebbinghaus but names no primary study. [Laws of UX](https://lawsofux.com/serial-position-effect/) | n/a | First and last nav items are the memorable ones: make them "Today" and the end-of-day item; middle tabs are the minor ones. Secondary source only. |
| Peak-end | People judge an experience mainly by its most intense point and its end. Original: Kahneman, Fredrickson, Schreiber, Redelmeier 1993, "When More Pain Is Preferred to Less: Adding a Better End" (60 s at 14 C vs the same plus 30 s warming to 15 C; the longer trial was preferred). [Laws of UX](https://lawsofux.com/peak-end-rule/) | 1993 cold-water study | Design the last thing seen (day-done state) and one deliberate peak (finishing a task or the day). Never end a page on an empty shell or a nag. |

#### Habit, return visits, streaks

| Source | What it supports | Caveat |
|---|---|---|
| [Fogg Behavior Model](https://behaviormodel.org/): behaviour happens when Motivation, Ability and a Prompt converge; if it does not happen, one is missing; 1,900+ publications cite it | Lower the effort (Ability) before pushing Motivation; a prompt only works when the action is already easy | The fetched page lists no prompt types; "spark / facilitator / signal" is from memory, UNVERIFIED |
| Eyal's Hook model: Trigger -> Action -> Variable reward -> Investment (secondary summaries only; book not read) | Loop shape; variable reward = unpredictable positive result; investment = the user puts something in | UNVERIFIED at source; dopamine claim is secondary; no verified ethics section |
| [Duolingo design note, Jan 2022](https://blog.duolingo.com/streak-milestone-design-animation/): milestone streaks (week, month, 100 days, year) redesigned as a phoenix transformation because the old milestone did not feel celebratory and the "on fire" metaphor does not translate across all cultures; share card added; timing tested over many passes | Celebrate milestones with motion; prefer universal imagery; make it shareable; treat timing as seriously as the drawing | No retention numbers in the post |
| [Lenny's Newsletter, Mazal on Duolingo growth](https://lennysnewsletter.com/p/how-duolingo-reignited-user-growth) (via search summary only) | CURR = chance a user returns this week given they came the past two weeks; a 10-day streak reported to cut drop-off substantially | 10-day figure is from a repost, UNVERIFIED. Duolingo's Q2 2026 claim of 84% CURR and 15.4M revived streaks is secondary ([pulse2](https://pulse2.com/duolingo-daily-active-users-reach-58-7-million-as-retention-hits-record-84-and-social-accounts-top-1-billion-organic-impressions/)) |
| [Hamari, Koivisto, Sarsa 2014, "Does Gamification Work?"](https://www.lescahiersdelinnovation.com/wp-content/uploads/2019/06/2014-hamari_et_al-does_gamification_work.pdf) | 24 empirical studies; effects positive overall but heavily context- and user-dependent; novelty effects flagged | Read through search summaries, not full text |
| Callback / referential cues ("you left off at...", "yesterday you...") | Plausible by Fogg (makes the prompt specific and the action easier) and by recognition-over-recall (NN/g) | No controlled study on callback cues found. UNVERIFIED as a retention lever; treat as a usability gain, not a metric promise |

Ethical line (feeds the owner's rule "the System suggests, you decide"):
- [Gray, Kou, Battles, Hoggatt, Toombs, CHI 2018, "The Dark (Patterns) Side of UX Design"](https://par.nsf.gov/servlets/purl/10057203), DOI 10.1145/3173574.3174108: taxonomy of nagging, obstruction, sneaking, interface interference, forced action, built from 118 practitioner-identified cases. Definitions read via summary; check the PDF before quoting.
- Translation: suggestions dismiss in one tap and do not return the same day; a missed day shows a neutral "start again", not a lost-streak penalty; no countdown pressure; no hidden skip; notifications off by default. Loss-framed streak copy is the specific risk (loss aversion is a known lever, Kahneman and Tversky, UNVERIFIED here), which matters in a study app used under exam stress.

---

### 2. Motion

#### Material Design 3 tokens (verified from the Material Web token source)

Source: [material-web v0_192 `_md-sys-motion.scss`](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-motion.scss). The m3.material.io easing page returned only its title (JS-rendered), so the prose spec was not read; the token file holds the numbers.

| Easing token | cubic-bezier |
|---|---|
| standard | (0.2, 0, 0, 1) |
| standard-accelerate | (0.3, 0, 1, 1) |
| standard-decelerate | (0, 0, 0, 1) |
| emphasized | (0.2, 0, 0, 1) in this token set (the spec's emphasized is a two-segment path, UNVERIFIED) |
| emphasized-accelerate | (0.3, 0, 0.8, 0.15) |
| emphasized-decelerate | (0.05, 0.7, 0.1, 1) |
| legacy / legacy-accelerate / legacy-decelerate | (0.4,0,0.2,1) / (0.4,0,1,1) / (0,0,0.2,1) |
| linear | (0, 0, 1, 1) |

| Duration token | ms | | Duration token | ms |
|---|---|---|---|---|
| short1 / 2 / 3 / 4 | 50 / 100 / 150 / 200 | | long1 / 2 / 3 / 4 | 450 / 500 / 550 / 600 |
| medium1 / 2 / 3 / 4 | 250 / 300 / 350 / 400 | | extra-long1 / 2 / 3 / 4 | 700 / 800 / 900 / 1000 |

Rule of use: enter with a decelerate curve, exit with an accelerate curve and a shorter duration.

#### Duration and easing from NN/g

Source: [NN/g animation duration](https://www.nngroup.com/articles/animation-duration/).
- Simple feedback (checkbox, toggle): about 100 ms, "feels immediate".
- Substantial screen change (modal): 200-300 ms. General range 100-500 ms, 100-400 ms for most; 400 ms is "very slow", for big movement on large screens only.
- Entering slightly longer than exiting (example 300 ms in, 200-250 ms out).
- Ease-out is the default; linear looks unnatural; ease-in/in-out only for exits and can feel unresponsive.
- "It is far more common for animations to be too long than too short." Frequent animations should be shorter and subtler.
- Response limits 0.1 s / 1 s / 10 s are Nielsen 1993 (not re-read, UNVERIFIED; one summary warns they describe perception, not design targets).

#### Apple HIG motion

The HIG Motion and Materials pages returned only titles and keyword lists (purpose, optional, brevity/precision, reduce motion; where to use / not use, legibility, layering, Reduce Transparency). So only keyword-level guidance is verified: motion has a purpose, is optional (tasks completable without it), is brief and precise, and respects Reduce Motion. Pages: [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

#### Principles (Val Head, Disney)

- Val Head, [Designing Interface Animation](https://rosenfeldmedia.com/books/designing-interface-animation/) (Rosenfeld, 2016): publisher summary says effective interface animation combines form and function to improve feedback, aid orientation, direct attention, show causality and express brand personality; interactive animation is judged on behaviour as well as look; choreograph top-down as a system ([Zeldman's write-up](https://zeldman.com/2016/11/08/val-head-animation-style-guides-design-process/)). No specific duration ranges from Head were found; use the NN/g and M3 numbers.
- Disney's 12 principles (Thomas and Johnston, The Illusion of Life, 1981; not re-read here) as UI mappings (my suggestions, UNVERIFIED as numbers): anticipation = 1-2 px press-in before commit; follow-through and overlap = children settle 30-60 ms after the parent; slow-in/slow-out = easing; staging = one thing moves at a time to direct the eye; secondary action; timing.

#### Springs

| Library | Values | Source |
|---|---|---|
| react-spring presets (tension / friction, mass 1) | default 170/26; gentle 120/14; wobbly 180/12; stiff 210/20; slow 280/60; molasses 280/120 | [react-spring config](https://www.react-spring.dev/docs/advanced/config) |
| Motion (framer-motion) | docs list `bounce` 0.25 (range -1 to 1; 0 = critically damped), `duration` 0.3 s (0.8 s with several keyframes), damping 10, mass 1; stiffness shown as 1, which looks like a doc-extraction artefact (my recollection is 100; the source file URL I tried returned 404). Setting stiffness/damping/mass overrides bounce and duration. | [Motion transitions](https://motion.dev/docs/react-transitions) |

Reading the numbers: damping ratio = friction / (2 * sqrt(tension * mass)). react-spring default: 26 / (2*sqrt(170)) = 0.997 (about critically damped: calm, no overshoot). gentle 0.64 (soft overshoot). wobbly 0.45 (clearly bouncy). stiff 0.69. slow 1.79 (overdamped, sluggish). These ratios are my arithmetic on the documented presets. Practical band for a calm study UI: ratio 0.8-1.0, no visible overshoot on layout; 0.5-0.7 only for rare celebratory moments (milestone, day done).

#### Reduced motion

- [WCAG 2.3.3 Animation from Interactions, AAA](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html): interaction-triggered motion must be disableable unless essential; vestibular disorders are the concern, parallax the named example; scrolling itself is allowed. Techniques C39 (CSS prefers-reduced-motion), SCR40 (JS), or a user setting. Auto-starting motion falls under 2.2.2 (Pause, Stop, Hide, Level A).
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion): values `no-preference` / `reduce`; Baseline widely available since January 2020. `reduce` does not mean "no motion": replace scale/pan with a fade; essential motion (progress) may stay. In JS use `matchMedia('(prefers-reduced-motion: reduce)')` and listen for `change`.
- Implementation rule: one switch at the token layer (durations collapse to about 0 ms, spring configs swap to instant, travel becomes opacity) so every component honours it without per-component code. Add an in-app toggle as well (technique "set a preference"); the OS flag is not always set.

#### Performance

| Rule | Evidence |
|---|---|
| Animate only transform and opacity (compositor). Avoid layout/paint triggers; shadows and blurs are costly to paint. | [web.dev animations guide](https://web.dev/articles/animations-guide), [compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) |
| Use `will-change` sparingly and remove it after; each promoted layer costs memory and GPU texture bandwidth; aim for about 4-5 ms compositing time in critical interactions. | same |
| 60 fps = 16.7 ms per frame (arithmetic); keep script plus style well under that (about 10 ms is a rule of thumb, UNVERIFIED). | arithmetic |
| backdrop-filter: cost rises with blurred area; avoid animating blur radius; full-width blurred surfaces are the expensive case. | Secondary blogs only; no web.dev/Chrome page surfaced. UNVERIFIED as measurement: profile in this app before and after. |

#### What Awwwards scores

[Awwwards evaluation](https://www.awwwards.com/about-evaluation/): Design 40%, Usability 30%, Creativity 20%, Content 10%. The page lists no mobile weight and no numeric Site-of-the-Day threshold (SOTD goes to the highest jury scores; Honorable Mention at 6.5 or more; Developer Award if a SOTD scores above 7 with the developer jury; a high jury score plus at least 10 PRO votes can win SOTD before the 5-day voting ends). Implication: 70% is design plus usability, so craft and clarity beat spectacle; "creative" motion is 20%. A separate mobile score may exist elsewhere on the site, UNVERIFIED.

---

### 3. Design tokens and theming

#### Format and tiers

- [Design Tokens Format Module 2025.10](https://www.designtokens.org/TR/drafts/format/) (W3C Design Tokens Community Group; Draft Community Group Report, "Do not attempt to implement this version", not a W3C Standard): JSON files (`.tokens` / `.tokens.json`, media type `application/design-tokens+json`); a token is an object with `$value`; `$type` optional and inherited from the parent group (tools must not guess); `$description`, `$deprecated`, `$extensions` (reverse-domain keys). Aliases: `{group.token}` for whole tokens, JSON Pointer `$ref` for any location, chains allowed, cycles are errors. Types: color, dimension (px/rem), font family, font weight, duration (ms/s), cubic Bezier, number, composites (stroke style, border, transition, shadow...). Theming/modes: not in the part I read (about 87% of the page), UNVERIFIED.
- Tiering (my synthesis of the systems below, each verified individually):
  1. Primitive: raw scale values (`--saffron-1..12`, `--ash-1..12`, durations 50..1000).
  2. Semantic: roles (`--surface`, `--surface-raised`, `--ink`, `--ink-quiet`, `--accent`, `--accent-ink`, `--ease-enter`, `--dur-panel`). A theme redefines only this tier.
  3. Component: `--card-bg`, `--card-pad`, `--btn-primary-bg`, defaulting to semantic tokens so one component can be overridden locally without a new theme.

#### How real systems do it

| System | Mechanism | Source |
|---|---|---|
| Radix Colors | 12-step scale per hue: 1-2 backgrounds, 3-5 component fill (normal/hover/active), 6-8 borders (8 also focus ring), 9-10 solid fills, 11 low-contrast text, 12 high-contrast text. Steps 11 and 12 are guaranteed APCA Lc 60 and Lc 90 against a step 2 background of the same scale. | [Radix scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) |
| Vercel Geist | 10 scales (backgrounds, gray, gray-alpha, blue, red, amber, green, teal, purple, pink), 10 steps: 100-300 backgrounds, 400-600 borders, 700-800 high-contrast backgrounds, 900-1000 text/icons. Background 1 default, Background 2 for subtle differentiation. gray-alpha only where the background must show through. | [Geist colors](https://vercel.com/geist/colors) |
| shadcn/ui | Semantic tokens in pairs (`primary` / `primary-foreground`); dark mode overrides the same variables under `.dark`; `--radius` base with derived radii; custom tokens on `:root` and `.dark`, exposed via `@theme inline`. | [shadcn theming](https://ui.shadcn.com/docs/theming) |
| Tailwind v4 | `@theme` defines tokens that generate utilities and emit CSS variables; namespaces (`--color-*`, `--ease-*`, `--radius-*`, `--shadow-*`...); `@theme inline` emits `var(--x)` into the utility so an override on a descendant or `[data-theme]` takes effect; without `inline` the reference resolves once on `:root` and a descendant override is ignored. The data-attribute recipe is the docs' inference, not a documented pattern. | [Tailwind theme](https://tailwindcss.com/docs/theme) |
| Linear | Themes moved from HSL to LCH (more perceptually uniform); each theme is generated from 3 variables (base colour, accent colour, contrast) instead of 98; the contrast variable yields high-contrast accessibility themes; six-week redesign by a small team behind a feature flag. | [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) |
| Material 3 | Colour roles (primary + on-primary, containers, surface tiers, tonal palettes, dynamic colour from a source colour, contrast levels). Roles page returned only a topic list, so detail is UNVERIFIED. | [M3 color roles](https://m3.material.io/styles/color/roles) |

Pattern to copy: generate a theme from a tiny input (base, accent, contrast, plus radius and motion scale) as Linear does, expose 12 semantic steps as Radix does, and let components read only semantic/component tokens. "Saffron is identity, never data" already fits: the accent slot is swappable while provenance colours (cyan / amber / red) stay fixed across themes.

#### Contrast (WCAG 2.2, verified)

[1.4.3 Contrast (Minimum), AA](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): normal text 4.5:1; large text (18 pt = about 24 px, or 14 pt bold = about 18.5 px) 3:1; ratios are not rounded (4.499 fails); placeholder text and hover/focus text are covered; text that is a UI control is not exempt for brand reasons; non-text UI (icons, chart marks, control boundaries) needs 3:1 under 1.4.11.

Measured on this app's current dark tokens (WCAG luminance formula, 2026-11-09, against --bg #050506):

| Token | Effective colour | Ratio | Verdict |
|---|---|---|---|
| --ink (#f5f6f8) | #f5f6f8 | 18.84 | pass |
| --ink-2 (66% alpha) | #a3a4a6 | 8.17 | pass |
| --ink-3 (42%) | #6a6a6c | 3.77 (3.86 on --bg-2) | fails body 4.5; only for large text or non-text UI |
| --ink-4 (22%) | #3a3a3b | 1.79 | fails all; decorative only |
| saffron #ff7a2e | | 7.83 | pass as text and as UI |
| white on saffron fill | | 2.60 | fail |
| near-black on saffron fill | | 7.83 | pass: use dark text on accent buttons |

Minimum alpha of #f5f6f8 on #050506 for 4.5:1 is about 0.48, so a "quiet" ink step needs at least roughly 50% opacity for any text under 24 px. Fix list for the panel: raise --ink-3 to at least 0.50 alpha for text; stop using --ink-4 for readable labels (the 12 px minor nav tab uses it); keep dark-on-saffron for primary buttons; check every new theme with the same calculation before it ships.

#### Type scale

- Modular-scale ratios (1.125 to 1.25 for dense apps, 1.333+ for editorial heroes) are a practitioner convention; no primary source fetched (UNVERIFIED). Use 5-7 steps as `clamp()` tokens.
- Line length: [Baymard](https://baymard.com/blog/line-length-readability) recommends 50-75 characters for body text (the 45-75 range often quoted is the same rule of thumb). [WCAG 1.4.8, AAA](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html): at most 80 characters per line (40 CJK), line spacing at least 1.5, paragraph spacing at least 1.5x line spacing, and a mechanism to change them rather than fixed values. Evidence for 50-75 is mixed (the often-cited 1929 Tinker and Paterson work could not be traced to a primary source; line length interacts with font and leading). The repo's `max-width: 92ch` on the page intro is above both ranges; consider about 68ch.
- Minimum size: WCAG sets no px minimum; the tests are contrast and 200% resize (1.4.4). The repo uses 9.5-11 px mono labels; at those sizes use ink-2 or brighter, not ink-3. A 12 px floor for anything meant to be read is my suggestion, UNVERIFIED.

---

### 4. Libraries and systems: patterns to borrow (not code)

| Source | Borrow | Evidence |
|---|---|---|
| Radix Primitives | Accessible behaviour contract: WAI-ARIA roles/attributes included, keyboard navigation for Tabs/Dialog following ARIA authoring practices, focus management (an AlertDialog moves focus to Cancel on open); you still supply labels. Use as the checklist when hand-building tabs, dialogs, menus (the project has no UI dependency). | [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility) |
| shadcn/ui | You own the component files; theming only through CSS variables in foreground/background pairs; `--radius` derives the radius scale. | [shadcn theming](https://ui.shadcn.com/docs/theming) |
| Vercel Geist | Step-number semantics (100-300 fill, 400-600 border, 700-800 solid, 900-1000 text) so anyone knows which step to reach for. | [Geist colors](https://vercel.com/geist/colors) |
| Linear | Few inputs generate whole themes; stress-test a redesign against environment, appearance, hierarchy before building; ship behind a flag; display-cut headings; neutral icons tuned for contrast. | [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) |
| Raycast | Published design write-ups not fetched this session. UNVERIFIED; do not cite Raycast specifics from this file. | n/a |
| Apple Liquid Glass (WWDC25 session 219, HIG Materials) | Third-party summaries and an Apple developer-forum group-lab summary say: glass for the navigation/control layer floating above content, not content itself; do not layer glass directly on glass (the system converts nested glass to a vibrant fill); regular glass is legible by default while clear glass needs a dimming layer and care; check contrast with tools; honour Reduce Transparency. Apple's own transcript says the material subtly changes to keep legibility and separation and switches to a subtle dimming when darker content scrolls under. The phrases "use sparingly" and "do not stack" are from write-ups, not verbatim Apple. | [WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/), [group lab summary](https://developer.apple.com/forums/thread/791070), [wwdcnotes](https://wwdcnotes.com/documentation/wwdc25-219-meet-liquid-glass/) |

Translation for the existing `liquidGlass` tier system: glass on the top bar, the floating action, the sheet/drawer header; solid raised surfaces for cards that hold text. One glass layer deep. Provide a solid fallback when reduced transparency is requested (OS flag or in-app switch). theme.css already says "No backdrop-filter here: glass stays in direction.css behind [data-glass]"; keep that.

---

### 5. Placeholders / "carcass" patterns

What the evidence supports:
- [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/): do not leave containers blank; state status plainly after loading ends; explain what belongs in the space; give a direct pathway (a button, plus a learn-more link); avoid passive dead ends and vague instructions. The article does not cover "coming soon"; extending it (NN/g-style inference, mine): say what the feature will do and offer something to do now.
- NN/g heuristic 1 (visibility of system status) gives the honesty rule: a card that looks live but does nothing violates it.
- Empty-shell fatigue: no controlled study quantifying fatigue from "coming soon" tiles was found. UNVERIFIED as evidence; it is a design risk argued from the heuristics, not a measured effect.

Patterns, safest first:

| Pattern | When | Honesty rule |
|---|---|---|
| Absent | Feature is weeks away and has no user value yet | Do not show it; keep it on a roadmap list the owner can open. |
| Roadmap drawer (one place, disclosure level 2) | Several unbuilt things | One entry point, not N tiles in the main layout; each item says what it will do and what it needs first. Keeps screen one clean. |
| Disabled with reason | Control exists but a precondition is missing (data, hardware, a date) | Reason visible as text next to the control, not only a tooltip; keep it focusable so keyboard and screen-reader users can read it (`aria-disabled` plus a description rather than the `disabled` attribute; general a11y practice, UNVERIFIED here). |
| Empty state with a first action | Built, but no data yet | Status + what belongs here + one button. |
| Coming-soon card | Only when it changes today's decision or the user asked | State what, why not yet, and one thing available now. Never animate it like a live feature; never use the accent colour on it (accent = the one real next step, per theme.css). |

Project rule that applies: simulated data is never shown as measured; a placeholder with fake numbers is worse than an empty state.

---

### Numbers worth keeping in the token file

| Token idea | Value | Basis |
|---|---|---|
| --dur-feedback | 100 ms | NN/g; M3 short2 |
| --dur-panel | 200-300 ms (enter 300, exit 200-250) | NN/g; M3 short4/medium2 |
| --dur-travel | 400 ms max | NN/g; M3 medium4 |
| --dur-celebrate | 500-1000 ms, rare | M3 long2..extra-long4; Duolingo milestone |
| --ease-enter | cubic-bezier(0.05, 0.7, 0.1, 1) or (0, 0, 0, 1) | M3 emphasized-decelerate / standard-decelerate |
| --ease-exit | cubic-bezier(0.3, 0, 0.8, 0.15) or (0.3, 0, 1, 1) | M3 emphasized-accelerate / standard-accelerate |
| --ease-standard | cubic-bezier(0.2, 0, 0, 1) | M3 |
| spring calm | 170/26 (damping ratio about 1.0) | react-spring default |
| spring lively (rare) | 120/14 (0.64) | react-spring gentle |
| stagger | 30-60 ms per item, total capped near 300 ms | my suggestion, UNVERIFIED |
| text contrast floor | 4.5:1 under 24 px; 3:1 for large text and UI marks | WCAG 1.4.3, 1.4.11 |
| body line length | 50-75 ch (cap 80) | Baymard; WCAG 1.4.8 |
| disclosure depth | 2 levels | NN/g |
| important content | inside the first 2 screenfuls | NN/g 2018 |

### What I could not verify

- Apple HIG Materials/Motion detail (JS-rendered pages); Liquid Glass wording comes from third-party and forum summaries.
- M3 spec prose and the exact emphasized two-segment easing (numbers are from the Material Web token source).
- Motion (framer-motion) default stiffness (doc extract showed 1, not trusted).
- Eyal's Hook model at source and its ethics section; Fogg prompt types; Nielsen 1993 response limits; Disney principles at source; Raycast write-ups; modular-scale ratios; Z-pattern; 1366x768 attention split; backdrop-filter cost as a measurement (profile in this app); callback cues as retention levers; Awwwards mobile criterion; DTCG theming/modes section.

### What it changed

Feeds the Well Wisher design panel of 9 Nov. No code changed. Concrete inputs: the measured contrast defects in --ink-3 and --ink-4, the motion token table, the three-tier token structure with a Linear-style generator (base, accent, contrast), the "one glass layer, navigation only" rule, the two-level disclosure cap, and the roadmap-drawer pattern for unbuilt features.

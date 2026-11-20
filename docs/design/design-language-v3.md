# Design language v3: the frosted deck

Status: proposal, 20 Nov 2026, third version (the second refinement). It is a switchable look that sits beside the current one. Nothing here changes the current look until the owner turns the switch on.

The design was chosen from three rival mockups by three independent jurors. The winning base is "The Deck". It has been scored twice. This file answers the second score. Section 2 holds every value. A builder can apply the language to any view with this file alone.

## 1. What changes and why

### 1.1 The scores before

A strict jury scored the current interface 6.1 for design and 6.3 for usability. Fix lists moved single sections from about 6.3 to 6.8, not to 8. The owner's reading is right: small fixes do not change the feel. At 8 the feel must change drastically.

The recurring faults of the current interface:

- a 1 px outline on every card and key;
- the warm accent spent on selection, so a view shows two to six warm fills;
- no focal element, and empty states drawn as one line of text;
- header lamps with no state word;
- state text cut with an ellipsis;
- edges that disagree;
- phone pages that are the desktop squeezed;
- three navigation layers stacked (title bar, rail, view strip), and a "Back to" pill that replaces the location.

The first full version of this language scored 7.4 / 7.3, 7.3 / 7.2 and 7.3 / 7.2 (design / usability). The second version, the one this file answers, scored 7.3 / 7.2, 7.6 / 7.4 and 7.4 / 7.5. All six jurors said the feel is new on the light ground (Well Wisher) and only partly new on the dark ground. Their reasons for staying below 8:

- on the dark ground the glass was invisible: a .86 tint with a colour drain read as flat charcoal;
- the accent button carried outlined key caps, the same fault the redesign set out to remove;
- the same starburst appeared twice (the sigil and the conversation's empty state);
- grey skeleton bars read as "loading" when nothing had been said;
- one state had several words (WAITING, ASLEEP, IDLE, OFF);
- the header showed four named lamps on one view and a summary pill on another, and the summary hid a fault;
- the same reading was drawn twice on Console (GPU, timings), and two wells were large and empty;
- a blocked key looked enabled, and the fault red sat close to the accent orange;
- the literal NOW, NEXT, LATER captions read as scaffolding;
- the phone cut the last view tab to a single letter, wrapped its counter labels, and gave NEXT and LATER no way in.

This round fixes that list. It has not been scored again, so no new score is claimed here.

### 1.2 The five asks and the answer to each

1. Group by relationship. One plate or one captioned group holds one family (a ledger, a chain, a set of counters, a log with its own tabs). A fault and its remedy share one row. A reading appears once. Related rows are split by space, never by a border or a hairline.
2. Better hierarchy, based on order of operations. Every view is three trays, left to right: the first act and its object (widest, most lifted), what follows from it, and reference (the glassiest, smallest, furthest). The order is felt as material and told by three small dots and the job of the tray, never by the words NOW, NEXT, LATER. What he rarely touches sits behind one More key.
3. More delight. A focal object in every view, a glint when the place changes, a flare of the tray's light on a real event, a counter key that presses in while its digit rolls, a clearly labelled SIMULATED preview. See section 5.
4. Frosted glass that keeps neumorphism. The window ground is glass over the desktop and the dark ground now shows it. Trays are tinted, not blurred a second time. Keys stay soft and pillowy. Wells that hold text stay calm. See section 2.
5. A better nav. Three layers become two pieces that are always visible: the spine on the left and the top plate. The location is never replaced. Each project wears its own mark and its own state. See section 3.

### 1.3 What the jury asked for in round 3, and where it went

| Jury item | Answer in this file |
| --- | --- |
| Glass invisible on the dark ground | Ground tint .70 with saturate .7 and brightness .8, spine .66, trays .50, wells stay .93, a 1 px inner top glare on every frosted layer (2.2, 2.7) |
| The mockup hid the worst case with a dimmed wallpaper | Every dark screen is shot over the undimmed bright wallpaper and measured; the dim wallpaper is a second check, not the proof (2.7, 8.5) |
| In the real window a per-layer blur cannot see the desktop | Only the ground blurs. Spine, top plate, trays and dock carry a tint and no blur. Popovers and sheets are opaque (2.1, 8.1) |
| Key caps in the accent key have outlines | Pressed-in wells, no border, label contrast 5.9 to 1 (2.4) |
| Two starbursts compete | The conversation's empty state is three formed marks at 30 px and 40 percent; the ring stays the only large mark (4.2) |
| Skeleton bars read as loading | Removed. The empty conversation says what is true and nothing else (4.2) |
| One state, several words | The five state words only, plus a reason. ASLEEP stays only as the stage's own subject (6) |
| Header differs between views, hides a fault | One lamp pill on every view. It prints the worst state anywhere first ("1 FAULT · 2 WAITING"). The named lamps open from it (3.3) |
| Readings drawn twice, dead wells on Console | Rows in NOW, one detail drawer in NEXT, one activity well with tabs in LATER (4.4) |
| Blocked key looks enabled; red close to orange | A locked pose (flat, a lock, a reason). Fault red is a cool `#E5484D` with a triangle (2.4, 6) |
| Window keys outweigh the view tabs; the count badge means nothing | Flat caption keys, raised on hover only. The badge became a tooltip (3.3) |
| NEXT nests three surfaces on the light ground; muddy grey | Two levels only: tray, then captioned groups on the tray (4.3) |
| `+1` is a small glyph, not a key | A raised 52 by 44 key, pressed on tap, the digit rolls in 160 ms (2.5, 5) |
| NOW, NEXT, LATER are scaffolding | Three dots and the job name of each tray (4.1) |
| First act at the top on one view and the bottom on another | One order in every first tray: state headline, the one accent action, then the object (4.1, rule 5) |
| Capture example looks typed | A dimmed "e.g." example (2.3) |
| Spine uses letter discs and "N sections" | Each project has its own mark and its own state line; Ask became a mode of the dock (3.2) |
| Perpetual motion | One continuous motion per view. State pings play once (5) |
| Phone: tab cut to "C", counters wrap, no way into NEXT and LATER, two competing first surfaces | A view chip with a sheet; counters in a 2 by 2 grid; two pills under the accent key open opaque sheets; the top plate is flatter than the first tray (3.6) |

## 2. The material

One recipe, two grounds. JARVIS, Aankhen and Yadaash use the dark ground. Well Wisher uses the light ground. The same controls, shadows and radii apply in both. Only the tokens change.

### 2.1 Layers and what each one does

| Layer | What it is | Blur |
| --- | --- | --- |
| Ground | The whole window. A sibling element behind the content, never its parent. | Heavy: 40 px, with a colour term. This is the only layer that blurs. |
| Spine, top plate, dock | Chrome plates. A tint, a 135deg glare and an inner top edge. | None |
| Tray (zone) | One of the three columns. Graded by tint, shadow and type size. | None |
| Plate (well) | Holds text or numbers. A recessed, calm well. | None. 93 to 94 percent opaque. |
| Key | A raised pillow. | None |
| Popover, drawer and phone sheet | Opaque. | None. Solid fill. |

Why only the ground blurs. In the real window the desktop is behind the page, under a Windows backdrop. A `backdrop-filter` on a tray sees only what the page paints behind it, which is the ground, a flat tint. It would cost graphics time on six large layers and add nothing. The look comes from the alpha values of each layer, not from blurring again. The mockup keeps one blur on the ground as a stand-in for the system backdrop.

Why the ground is a sibling: never put `opacity`, `filter`, `mask` or `transform` on a wrapper that holds the ground and the content together. Any of them creates a new backdrop root.

The ground also extends 64 px past the window on every side (`inset:-64px`) so the blur never samples a hard edge.

### 2.2 Custom properties, dark ground (JARVIS, Aankhen, Yadaash)

| Property | Value | Meaning |
| --- | --- | --- |
| `--ground-rgb` and `--ga` | `13,13,15` at `.70` (host: `.76`, see 2.7) | Ground tint over the backdrop. Matte piano black `#0D0D0F`. |
| `--glass-filter` | `blur(40px) saturate(.7) brightness(.8)` | Ground blur. The desktop's hue now shows at the edges. In the real host the brightness term is the system backdrop's job. |
| `--spine-rgb` and `--sa` | `9,9,11` at `.66` (host: `.74`, see 2.7) | Spine tint. Same hue, one elevation step darker. |
| `--tray-rgb` and `--ta` | `36,38,43` at `.50` | Second tray tint. |
| `--trayn-rgb` and `--tna` | `50,53,60` at `.74` | First tray tint. Lighter and more opaque, so it is nearest. |
| `--trayl-rgb` and `--tla` | `30,32,36` at `.34` | Third tray tint. The glassiest. |
| `--well-rgb` and `--wa` | `8,8,10` at `.93` | Well. Calm, near opaque. Never below .92. |
| `--edge` | `inset 0 1px 0 rgba(255,255,255,.06), inset 1px 0 0 rgba(255,255,255,.03)` | The inner top glare. It makes a frosted layer catch light, so it reads as glass and not as grey. Used on spine, top plate, trays, dock and tab bar. |
| `--pop` | `#1D1F23` | Popover and sheet, opaque. |
| `--raised`, `--raised-hi` | `#282A2E`, `#33363B` | Key at rest (gradient 145deg, `--raised-hi` to `--raised`). |
| `--lit-a`, `--lit-b` | `#4A4E57`, `#383B42` | The neutral lit state: selected and ON. Never the accent. |
| `--hi` | `rgba(255,255,255,.075)` | Highlight shadow (top left). |
| `--lo` | `rgba(0,0,0,.58)` | Shade shadow (bottom right). |
| `--glare` | `rgba(255,255,255,.10)` | Diagonal glare on a tray. |
| `--sheen` | `rgba(255,255,255,.10)` | Glint band and spine sheen. |
| `--ink`, `--ink2`, `--ink3` | `#F3F4F6`, `#C6C9CF`, `#A9ADB5` | Text levels. |
| `--live`, `--fault`, `--sim` | `#46D6C8`, `#E5484D`, `#B9A6FF` | Lamp colours. The fault red is a cool red on purpose: orange means "act here", red means "broken". A lamp is shape plus word, so colour only helps. |
| `--locked` | `#9A9EA6` | Label of a blocked key (2.4). |
| `--track` | `rgba(255,255,255,.10)` | Empty rail of a ring, gauge, arc or meter. |
| `--focus`, `--gap` | `#FFFFFF`, `#0D0D0F` | Focus ring colour and its gap colour. |

### 2.3 Custom properties, light ground (Well Wisher)

| Property | Value |
| --- | --- |
| `--ground-rgb` and `--ga` | `228,232,235` at `.76` |
| `--glass-filter` | `blur(40px) saturate(1.15) brightness(1.35)` (the brightness term is a mockup aid; the host does not have it, see 2.7) |
| `--spine-rgb` and `--sa` | `238,241,243` at `.78` |
| `--tray-rgb` and `--ta` | `242,245,247` at `.72` |
| `--trayn-rgb` and `--tna` | `252,253,254` at `.88` |
| `--trayl-rgb` and `--tla` | `236,240,243` at `.58` |
| `--well-rgb` and `--wa` | `214,219,223` at `.94` |
| `--edge` | `inset 0 1px 0 rgba(255,255,255,.9), inset 1px 0 0 rgba(255,255,255,.5)` |
| `--pop` | `#F5F7F8` |
| `--raised`, `--raised-hi` | `#EDF0F2`, `#F9FAFB` |
| `--lit-a`, `--lit-b` | `#FFFFFF`, `#F1F3F5` |
| `--hi` | `rgba(255,255,255,.95)` |
| `--lo` | `rgba(98,110,122,.40)` |
| `--lot` | `rgba(98,110,122,.50)`. The lower shadow of a tray only. It keeps tray edges from melting into a pale wallpaper. `--sh-tray` reads `--lot`. |
| `--glare` | `rgba(255,255,255,.65)` |
| `--sheen` | `rgba(255,255,255,.55)` |
| `--ink`, `--ink2`, `--ink3` | `#15181C`, `#2C3238`, `#363C44` |
| `--live`, `--fault`, `--sim` | `#0A7A72`, `#B3261E`, `#5B3FC4` |
| `--locked` | `#575D65` |
| `--track` | `rgba(21,24,28,.10)` |
| `--focus`, `--gap` | `#15181C`, `#EEF1F3` |

### 2.4 Shared properties (both grounds)

| Property | Value |
| --- | --- |
| `--accent` | `#F2591A`. Gradient `#FF6E2E` to `#EC5314` at 145deg. Label colour `--on-accent` `#190B04`. |
| `--sh-raise` | `-4px -4px 10px var(--hi), 6px 6px 14px var(--lo)` |
| `--sh-raise-hover` | `-5px -5px 13px var(--hi), 8px 8px 19px var(--lo)`, and lift 1 px |
| `--sh-press` | `inset 3px 3px 8px var(--lo), inset -3px -3px 8px var(--hi)` |
| `--sh-tray` | `-6px -6px 18px var(--hi), 10px 10px 28px var(--lot, var(--lo))` (second tray) |
| `--sh-now` | `-9px -9px 26px var(--hi), 16px 16px 42px var(--lo)` (first tray, the largest) |
| `--sh-later` | `-3px -3px 10px var(--hi), 6px 6px 16px var(--lo)` (third tray, the smallest) |
| Accent key shadow | `--sh-raise` plus `0 8px 26px rgba(242,89,26,.35)`. Pressed: `inset 3px 3px 9px rgba(120,30,0,.55), inset -2px -2px 6px rgba(255,180,140,.35)`. |
| Key cap on the accent key | A pressed-in well, not a chip: fill `#A23A0D`, `inset 1px 1px 2px rgba(120,30,0,.5), inset -1px -1px 2px rgba(255,180,140,.3)`, no border, no outline, label `#FFEDE3`, 11 px mono, padding 5 by 9. Label contrast 5.9 to 1. |
| Locked key | See 2.5. Label `--locked`. |
| Radii | First tray 30, tray 22, plate 16, key 14, big key 18, segment slot 16, segment cap 13, chip 12 |
| Motion | `--ease: cubic-bezier(.2,.8,.2,1)`. Key press and lift 140 ms. Digit roll 160 ms. Tray rise 500 ms, delayed 0, 70 and 140 ms. Flare 1.3 s. |
| Light direction | One light from the top left. Every highlight is up and left, every shade is down and right. |

### 2.5 Recipes in words

- **Tray.** Tint colour at its alpha, plus a 135deg glare gradient from `--glare` to transparent at 38 percent, plus `--edge`, plus its shadow. No blur. The three trays differ only in tint, radius, shadow and type size:

  | Tray | Tint | Radius | Shadow | Body type | Glare |
  | --- | --- | --- | --- | --- | --- |
  | First | `--trayn` at `--tna` | 30 | `--sh-now` | 14 px | full |
  | Second | `--tray` at `--ta` | 22 | `--sh-tray` | 14 px | full |
  | Third | `--trayl` at `--tla` | 22 | `--sh-later` | 12 px | 45 percent |

- **Plate (well).** `rgba(--well-rgb, --wa)` plus `--sh-press`. Text and numbers live here. The one exception is the dial well on the light ground: the tray's own tone at .9 with a deep inner press (`inset 6px 6px 14px --lo, inset -6px -6px 14px --hi`), so it is a hollow in the tray, not a grey slab.
- **Captioned group.** Two levels only: a tray, then groups on the tray. A group has a 12 px mono caption (with one state chip at its right edge when the whole group shares a state), 8 px to its rows, and 16 px to the next group. No middle card, no hairline. Only rows that are keys are raised.
- **Key.** 145deg gradient from `--raised-hi` to `--raised`, `--sh-raise`. Hover lifts 1 px with `--sh-raise-hover`. Press sinks into `--sh-press`.
- **Press key with a count (counter row).** A 38 px pressed dial with the count and the name with its state line, then a raised `+1` key at the right edge, 52 by 44 px. On a tap the key sinks into `--sh-press` for 160 ms and the digit rolls in from above in 160 ms.
- **Selected or ON.** The same key in the lit gradient (`--lit-a` to `--lit-b`), plus a 6 px neutral dot. Never the accent.
- **Locked key (a blocked action).** Flat on its surface: no raise, no press. A faint well fill (`--well-rgb` at .3), the label in `--locked` (at least 4.5 to 1), a 16 px lock glyph before the label, `aria-disabled="true"`, and the reason as real text under it ("Locked: needs the steward to answer first."). Press means ON, so it is never used on a blocked key. Hover and press change nothing.
- **Segment slot.** A recessed slot (`--sh-press` on `rgba(--well-rgb,.28)`) holding keys. The selected key is a raised lit cap with the dot. Keys have 16 px side padding, 8 px gaps and a 44 px minimum height.
- **Switch.** A recessed 44 by 26 track and a 20 px lit pebble. It lives in the More popover under Appearance.
- **Caption keys (window).** 44 by 44 px, flat and transparent. They raise on hover and press in on press. A caption key never outweighs a view tab.
- **Accent key.** The only warm fill. One per view (rule 4.6).
- **Focus ring.** A 3 px gap in `--gap`, then a 2 px ring in `--focus`. The ring replaces the key shadow while focused.
- **No outlines.** No 1 px border on any labelled control, tray or plate. A surface is lifted by shadow and light. There is no hairline between rows either: space and a caption do the grouping.
- **Specular dot.** A soft white radial dot (radius 11 on the ring, 3 on the needle) at the top left of the focal form, where the one light falls.
- **Tooltip.** An opaque small plate (`--pop`) below the key, shown on hover and on focus.

### 2.6 The opaque fallback

Glass off is the default state of the build until the owner turns it on. It is also the state for any browser or host without `backdrop-filter`, and for a host that cannot make the window transparent.

With glass off every alpha (`--ga`, `--sa`, `--ta`, `--tna`, `--tla`, `--wa`) is 1, `--glass-filter` is `none`, and the hues stay the same. The first tray keeps a diagonal gradient 3 percent lighter at the top left (dark) or white to clear (light), so the focal tray still lifts off the page.

| Layer | Dark | Light |
| --- | --- | --- |
| Ground | `#0D0D0F` | `#E4E8EB` |
| Spine | `#09090B` | `#EEF1F3` |
| Second tray | `#24262B` | `#F2F5F7` |
| First tray | `#32353C` | `#FCFDFE` |
| Third tray | `#1E2024` | `#ECF0F3` |
| Well | `#08080A` | `#D6DBDF` |

The Frosted switch (in More, under Appearance) flips this live and prints ON or OFF. The page carries one attribute on its root, `data-glass="on|off"`. Every alpha above is a token, so the whole look turns on and off by changing that attribute.

### 2.7 Contrast and colour over a worst-case wallpaper

The host cannot apply a brightness filter to the desktop: the Windows backdrop owns its own blur and tint, and the page only paints over it. So the tint carries the contrast on its own.

Dark ground, worst case a white backdrop. The mockup's `brightness(.8)` stands in for the dark system backdrop and lowers a white desktop to about 204. With it, a ground tint of .70 gives `13 x .70 + 204 x .30 = 70`, a ground near `#464648`, and the spine at .66 gives about 75. Then `--ink2` (`#C6C9CF`, luminance .583) against 70 is 5.7 to 1. To re-derive for another alpha: ground channel = `tint x a + backdrop x (1 - a)`; contrast = (.583 + .05) / (ground luminance + .05); keep it above 4.5.

The host cannot apply that brightness term. Over a pure white desktop the same alphas would give a ground of about 86 and a spine of about 93, and `--ink2` on the bare spine would fall to 4.4 and 4.0 to 1, under the floor. So the host column is stricter: use `--ga` .76 and `--sa` .74 in the real window (ground about 71, spine about 73, ink2 at 5.4 to 1 or better). Tray text and well text are safe at the mockup values because they sit on a tray or well tint above the ground. Verify the host column on the laptop with a white wallpaper before the owner turns glass on. Text sits on wells (.93) wherever it can, so most text has far more.

Light ground, worst case a black backdrop. Without the mockup's lift of 1.35 the ground is `228 x .76 = 173`, near `#ADB0B3`, and `--ink2` (`#2C3238`) against it is 5.8 to 1. The light ground must not drop below `--ga` .76.

Measured in the mockup (text hidden, page captured, worst background pixel under each text box, over the undimmed bright wallpaper and again over a dark one):

| Text level | Ground | Colour | Worst measured | Floor |
| --- | --- | --- | --- | --- |
| ink | dark | `#F3F4F6` | 7.8 to 1 | 4.5 |
| ink2 | dark | `#C6C9CF` | 5.7 to 1 (spine, over the bright wallpaper) | 4.5 |
| locked key label | dark | `#9A9EA6` | 7.5 to 1 | 4.5 |
| accent key label | both | `#190B04` on `#F2591A` to `#EC5314` | 5.6 to 1 | 4.5 |
| key caps in the accent key | both | `#FFEDE3` on `#A23A0D` | 5.9 to 1 | 4.5 |
| ink | light | `#15181C` | 10.3 to 1 | 4.5 |
| ink2 | light | `#2C3238` | 9.2 to 1 | 4.5 |
| ink3 | light | `#363C44` | 10.1 to 1 | 4.5 |

Rules that keep it true:

- `--ink3` is only for placeholders, ghost lines and the ASCII ruler, and only on a plate or tray. Never put `--ink3` text directly on the ground or the spine.
- Do not raise or lower an alpha to compensate for a change you make to the blur. Re-measure.
- The dark proof is shot over the undimmed bright wallpaper. A dimmed wallpaper hides the glass and proves nothing.
- Every popover, list, drawer and phone sheet is opaque (`--pop`).
- Text is 11 px or more, measured as the computed size after any scaling (SVG text scales with its viewBox). A lint reads the computed size of every text node. Targets are 44 by 44 px or more with 8 px gaps.

### 2.8 Known limit of the mockup

In the reference mockup the glass blurs a drawn wallpaper. In the real window the desktop sits behind a Windows backdrop that the system blurs (section 8.1). Expect the real tint to need a check on the laptop: the alphas were chosen for the worst case and may feel heavy over a calm wallpaper. They only drop as far as the contrast floors allow.

## 3. Navigation

### 3.1 The model

Two pieces, always visible. Nothing replaces the location.

- **The spine** (208 px, left). It names the four sub-projects, shows each one's state, and nests the sections of the open project. It replaces the product switch, the icon rail and the "Back to" pill.
- **The top plate** (top, 64 px). It prints the location three levels deep, the views of the section, one lamp pill, More, and the window keys. It replaces the title bar and the view strip.

The four sub-projects are JARVIS (Core, Room, Console), Aankhen (Senses), Yadaash (Memory) and Well Wisher (Day, Focus, Study, Tree, Career). In the current code Senses and Memory belong to the product `jarvis`. The sub-project is a presentation grouping, so add a small table for it (section 8.3) and leave `ids.ts` as it is. The ground follows the sub-project: Well Wisher is the light ground, the other three are dark.

### 3.2 The spine, top to bottom

1. Brand row: a four-square mark, THE SYSTEM, and a real clock.
2. Four project tiles, all 56 px tall, same look. Each has a 36 px disc with the project's own formed mark, the name in mono caps, and one state line under it: a lamp shape, the state word and a short reason ("WAITING · no board", "FAULT · steward"). The state line is the worst state of that project, so the spine doubles as a status map. It never wraps and never cuts. A closed tile is a raised pillow and lifts on hover.
   - JARVIS: a sigil ring with eight short rays. Aankhen: three signal arcs. Yadaash: two linked loops. Well Wisher: an ASCII bracket pair with a dot. Each mark is drawn in the house line at 1.6 px.
3. The open project is the same tile, pressed into one continuous recessed tray that also holds its sections. Its mark disc is lit. Below the tile sit the sections, one 44 px key each, with icon and label. The current section is a raised lit cap with a neutral dot. A one-section project (Aankhen, Yadaash) has no slot and no expand cue: its tile is a link to its section and turns lit when current.
4. The foot is empty. Key hints moved into the More popover. Ask is a mode of the dock, not a key in the spine.

There is one selection indicator per group. There is no left-edge bar.

### 3.3 The top plate, left to right

1. Location: the sub-project in 11 px mono caps over "Section / View" in 21 px. The view part is lighter. Under 1060 px of container width the view part hides (the selected view key already says it).
2. The view switch: a segment slot with a lit cap and a neutral dot on the current view. Keys have 16 px side padding, 8 px gaps and a 44 px height. Under 1060 px the padding is 12 px and the gaps 4 px. Views of Core: Talk, Sound. Console: Health, Events, Connections, Hardware, Crew. Day: Today, Week, Month, Body, Close. The slot scrolls sideways before it ever cuts a label. It always gets the room, because the lamps are one pill.
3. The lamp pill. One key, the same on every view: a ring of one short arc per lamp, then the worst state first and the rest after it ("1 FAULT · 2 WAITING", "2 WAITING"). A fault shows its triangle in the fault colour. The pill reports the worst state anywhere in the system, not only on this view, so a fault is never hidden. It opens an opaque popover headed "STATE, WORST FIRST" that lists every lamp with its shape, its word and its reason, fault first. JARVIS and the other dark projects list Voice, Room, Senses and Memory as they apply; Well Wisher lists Phone and Quiet; a steward fault appears in all of them.
4. More: one 44 px key with a tooltip that names the count ("5 more actions"). There is no number badge. It opens an opaque popover. At the top is an Appearance row with the Frosted switch and its word (ON or OFF). Under it is KEYS, with the two Alt shortcuts. Below, headed "RARELY NEEDED" with the count, is every rare action of the view (rule 4.7).
5. Window keys: minimise, maximise, close. Flat, 44 by 44 px, no gap, raised on hover only (the Windows 11 convention).

### 3.4 Routing

Routing is by `location.hash`. `#core`, `#today` and `#console` are the three drawn views. Every other place is `#section/view` (for example `#room/rules`). A place that is not drawn shows a calm PLANNED pose with the location and the reason. The map is always reachable.

### 3.5 Keyboard

- Tab moves focus. Every control has the focus ring.
- Up and Down walk the spine buttons.
- Alt with Up or Down moves through all ten sections in spine order.
- Alt with Left or Right moves through the views of the section.
- Escape closes any open popover and returns focus to its key.
- The current key set in `shell/keymap.ts` stays. These are added beside it.

### 3.6 Phone (390 px)

The phone is its own composition, not the desktop squeezed.

- The spine becomes a sheet. A bottom tab bar holds the open project's sections (52 px keys). Its first key is labelled "Projects" and opens the sheet with all four sub-projects.
- The top plate is flatter than the first tray (lower tint, the small shadow), so the first tray is plainly the first surface. The title row holds the location, the lamp pill (worst state only: "1 FAULT" or "2 WAITING") and More.
- The views are one 44 px chip under the title row: the current view, "1 OF 5 VIEWS" and a chevron. It opens an opaque list of the section's views, 44 px each. No view label is ever cut.
- The first tray keeps the same order as on desktop: the state headline, the one accent action, then two pills, then the object. The two pills carry the names and counts of the second and third tray ("Ahead · 3", "Proof · 3"). Each opens that tray as an opaque bottom sheet over a scrim, with a Done key. So the order of operations survives on the phone and nothing is hidden behind a scroll.
- Counters are a 2 by 2 grid of 48 px rows: the count, the name on one line, and a raised `+1` key (44 by 44). Labels never wrap.
- The capture line sits above the tab bar. It shows a short example ("e.g. spent 120 chai"). Ask is the second key of the dock; the first key is hidden to save room, and a second press on Ask returns to the first mode.
- The scroll area ends above the dock. No tray shows behind it, and there is no fade mask.
- The gutter is 16 px. The ASCII ruler is built from the measured width, so it ends on a full bar. On the phone the ruler is hidden to save 22 px.
- The day arc is redrawn on a smaller sheet (330 by 226 units) with only the three-hour ticks, so every label lands at 11 px or more on screen.

## 4. Layout grammar

Hierarchy follows the order of operations. What he does first is first and largest. What follows from it comes next. What he rarely touches is furthest away or behind one key.

### 4.1 The numbered rules

1. **Three trays, one grammar.** Every view has three trays, left to right. The default widths are 1.85 : 1.05 : .95. A view whose second tray is the product of the first may change the ratio: Core uses 1.85 : 1.05 : .8 so the voice stage is unmistakably the focal tray, and Console uses 1.6 : 1.15 : 1 so its drawer and its activity well have room. Reading order and importance are the same on desktop and on the phone.
2. **A tray head is three dots and the job of the tray.** Three 6 px dots, one filled, tell which step this tray is (the filled one is first, second or third). Next to them is the job of the tray in 12 px mono caps: Core WAKE, CONVERSATION, VOICE PATH; Day START, FOLLOW-UPS, EVIDENCE; Console FIX FIRST, DETAIL, ACTIVITY. The words NOW, NEXT and LATER are never printed. A state chip may sit at the right. The only extra text allowed is a real datum (Day shows the date). When a tray holds one plate, that plate has no title of its own.
3. **The station ruler belongs to the first tray only.** A tick ruler on the dark ground, an ASCII rule `|····:····|` on the light ground, one line under the head. The light ruler is built from the measured width and ends on a full bar.
4. **Hierarchy is graded material.** The first tray is the most lifted, most opaque and largest-shadowed. The second is one step flatter. The third is the glassiest, nearest the ground, with 12 px type. Light and elevation say what matters. Do not add a size or colour to say it twice.
5. **One order inside the first tray.** State headline, then the one accent action, then the object it drives, then the rest. The first act is at the top in every view. On Core the headline is the tray head and its chip. On Day it is the line "Nothing logged yet." On Console it is the fault row.
6. **One warm fill per view, and it follows the order of operations.** The accent goes on the key that does the thing the view is for. In Core and Day it is in the first tray (Wake, Start a block). In Console, while a fault is open, it goes to that fault's remedy, inside the fault's own row ("Check steward", 44 px tall). Start JARVIS becomes a locked key with its reason. When the fault clears, the accent moves to Start JARVIS by itself and the first tray's light flares once. A key that has been pressed into its working state turns neutral, so the view never shows two.
7. **Rare actions live behind More.** Anything used less than about once a week goes in the popover: Anatomy, Pause voice picture, Voice settings, Share a review, Earlier turns, Plan the day, Phone setup, Classic UI, Export memory. Appearance and the key hints are there too. They never sit loose in a tray.
8. **Order by consequence.** Inside a list, the worst state comes first: FAULT, then WAITING in pipeline order, then LIVE. Related rows share a captioned group. A group is placed by its worst row. The caption is a 12 px mono label, never a box and never a line.
9. **One group per relationship.** A group holds one family, and tabs that switch a view of that family sit inside it. A fault and its remedy are one row. Groups are 16 px apart. Rows inside a group are 6 to 8 px apart. Controls inside a row are 8 px apart.
10. **Never draw what is not known.** An empty reading is a first-class pose with a reason (section 6). No invented blocks, no invented numbers. Elapsed time is not progress: it is a thin dotted track and a labelled now-marker. The solid arc is for logged blocks only.
11. **Frequent acts look like acts.** A counter is a row with a `+1` key, never a readout. With a real zero it shows "0" and "no taps yet". It shows "–" only while its source is WAITING.
12. **The same fact is never drawn twice.** Rows show a state. A detail drawer shows one row in depth. If a row is in the list, no other plate repeats it. If a lamp says Voice is waiting, no plate lists Voice as waiting again.
13. **Readings live on wells, keys on trays.** Text and numbers sit on a calm well or a group. Keys sit on the tray.
14. **The capture line is the dock.** The last element of every screen, the same place and the same height. At its left is a two-key mode switch: the view's own mode (Talk, Capture or Command) and Ask. The input shows an "e.g." example in a dimmed ink, never in full ink.
15. **No state text is cut.** A state word or a reason wraps, or the container grows. An ellipsis is never allowed on state or reasons.
16. **One vocabulary for states.** LIVE, WAITING, SIMULATED, PLANNED, FAULT, each with a reason. OFF is kept only for something the owner switched off by hand. A word that is the subject of a view (ASLEEP on the voice stage) may stay as that subject, never as a second status.
17. **Heights are fixed, content grows.** At 1366 by 768 the canvas does not scroll. At 1120 by 720 it still fits. On the phone the first tray scrolls inside its own area.

### 4.2 Worked example: Core, Talk

Trays at 1.85 : 1.05 : .8.

- **First tray, WAKE.** Head: the dots, WAKE, the chip (WAITING, or SIMULATED during the preview). One ruler. The accent key "Wake JARVIS" with its three key caps (CTRL, SHIFT, SPACE) as pressed-in wells. Then the voice stage: a calm well with two small mono tags (VOICE STAGE, and MIC · NO LEVEL or MIC · SIMULATED LEVEL). The sigil ring fills the stage with its own corner ticks and a specular dot at the top left. The mic level is an arc on the ring's lower rim. Under the ring: the state word ASLEEP (the subject here) and one line of help. There is no second frame around the stage.
- **Second tray, CONVERSATION.** One well, no title. Empty, it shows three small formed marks (30 px, 40 percent), "Turns land here as they happen. Nothing has been said in this run.", then the terminal lines ("[JRV] waiting: core not started.") and the prompt. No skeleton bars and no star.
- **Third tray, VOICE PATH.** A vertical rail HEAR, WRITE, THINK, SAY, each an icon disc on a dotted line, each with the chip WAITING and its reason ("core not started", "needs what it heard", "brain not loaded").
- **Dock.** The mode switch (Talk, Ask) and the input.
- **More (6).** Pause voice picture, Voice settings, Anatomy, Share a review, Earlier turns, Classic UI.

### 4.3 Worked example: Day, Today

Trays at 1.85 : 1.05 : .95.

- **First tray, START.** Head: the dots, START, the date, a LIVE chip. One ruler. Headline "Nothing logged yet." at 32 px and one quiet line. Then the one accent key "Start a 10-minute block". Then the day arc as the object, from 06 to 24, with a dotted elapsed track and a now-marker with the real clock. The centre reads 0 MIN TODAY. The solid arc is empty. On the phone the counters follow, then two pills sit under the accent key.
- **Second tray, FOLLOW-UPS.** Two captioned groups directly on the tray. AHEAD with one LIVE chip: next application, classes, anything dated. Only a row whose state differs carries its own chip ("Anything dated" is WAITING). COUNTERS with one LIVE chip: four rows, each a pressed dial with the count, the name, "no taps yet", and a raised `+1` key.
- **Third tray, EVIDENCE.** The Proof plate: three small rings (KEPT, DAYS, RECALL), each with its word under it, 8 px apart. The Reminders plate: a drawn banner of dotted rules around `[ PLANNED ]` and one line ("Next: the reminder engine."). The 7-day minutes plate: seven empty pills, today's the lit cap. "The median needs 3 logged days."
- **Dock.** The mode switch (Capture, Ask) and the dimmed example.
- **More (5).** Plan the day, Phone setup, Quiet hours, Earlier days, Classic UI.

### 4.4 Worked example: Console, Health

Trays at 1.6 : 1.15 : 1.

- **First tray, FIX FIRST.** Head: the dots, FIX FIRST, and the chip "1 FAULT" (a triangle in the fault colour, the word in ink). One ruler. Three captioned groups, placed by their worst row: BRAIN AND MACHINE (steward, brain, GPU), HEARING (can he hear, last wake, median reply), APP. The steward row is first. It shows its FAULT word, then "Check steward" as the one accent key at the right of the row, 44 px tall. Each row is a key that selects it: the selected row is the neutral lit cap. The brain id is one mono line, never broken mid-token.
- **Second tray, DETAIL.** One drawer for the selected row. It never shows a reading the list already shows. The steward drawer shows what Start needs as a three-step rail (steward, brain, voice core, each with a lamp), then two locked keys: Start JARVIS ("Locked: needs the steward to answer first.") and Unload models ("Locked: nothing is loaded."). Selecting GPU shows the gauge with heat and models. Selecting the median reply shows the timing bars (seven empty bars) and the reason. Other rows show their state and one line. When the fault clears, the steward drawer shows Start JARVIS as the accent key and the first tray's light flares once.
- **Third tray, ACTIVITY.** One well with four tabs (Jobs, Log, Wakes, Replies) and one WAITING pose: the chip, one line ("Nothing is running."), its reason, and three dashed lines. Nothing is drawn to fill the space. There are no counts in the tab labels.
- **Dock.** The mode switch (Command, Ask) and a dimmed list of verbs.
- **More (4).** Export memory, Anatomy, Earlier events, Classic UI.

## 5. Delight

Every motion is tied to a real state or event. Every motion has a still for reduced motion. The reduced-motion rule is one block: all animation and transition off, and the stills below. A view has at most one continuous motion.

| Delight | Tied to | Reduced-motion still |
| --- | --- | --- |
| Trays rise | The place changed. The three trays rise in order (0, 70, 140 ms). | Trays appear at once. |
| Glint across the hero | The place changed. A light band crosses the stage, arc or gauge once. | No band. |
| Sigil breathes (Core's one continuous motion) | State ASLEEP. The ring slowly swells and fades. | The ring at full strength. |
| Now-marker ping (Day's one continuous motion) | The real clock. A ring pulses on the needle. | The needle at the real time, no ping. |
| Wake preview | The owner presses Wake. The mark ring turns, the tick ring counter-turns, the mic arc fills and moves, the chip becomes SIMULATED, the tag reads MIC · SIMULATED LEVEL and the line reads "preview only, no microphone is open". It returns to ASLEEP after 9 seconds or on a second press. | The same labels and chip, the arc held at a fixed fill, no movement. |
| Light follows the state | A wake, a block start or a cleared fault. The first tray's glare brightens for 1.3 seconds and settles. | No flare. |
| Specular dots | The ring and the arc needle each carry a soft dot where the one light falls. | The same dot, static. |
| LIVE lamp ping | A chip turning LIVE. A soft ring pulses once, then holds still. | Plain disc. |
| Block preview | Start a block. The key sinks to the neutral lit state with an elapsed ring (it counts up, never down). A pulsing block shows on the arc at the real time. The digit rolls from 0 to 1. The chip becomes SIMULATED and the line reads "preview only, nothing is logged". | Same labels, no pulse, no roll. |
| Counter tap | A `+1` key. It sinks into its inset for 160 ms and the digit rolls in from above in 160 ms. The line under the name changes from "no taps yet" to "N so far today". | The new digit at once. |
| Fault swap | The steward fault clears. The row loses its fault chip, the accent moves to Start JARVIS, the first tray flares. While the remedy runs the key reads "Checking…". | Same swap, no flare. |
| Drawer change | A row is selected. The drawer rises over 350 ms. | Appears at once. |
| GPU gauge sweep | The GPU drawer opened. The arc sweeps from empty to 0.2 of 6.0 GB. | The arc at the reading. |
| Sheet | A phone pill pressed. The sheet rises over a scrim. | Appears at once. |
| Caret | The dock has focus. The terminal caret blinks. Without focus it is a steady block. | Steady caret. |
| Keys | Hover lifts a key 1 px. Press sinks it into the inset. | No transition. |
| Spine and view switch | Selection changes. | No transition. |

No streaks, no countdown pressure, no leaderboards. The block key counts up.

## 6. States on glass

A state is a lamp shape plus a word. Colour only helps. The five states come from the shared lamp table (`shared/lamp/types.ts`): live, waiting, simulated, planned, fault.

| State | Shape (14 px) | Word | Colour role | When |
| --- | --- | --- | --- | --- |
| LIVE | filled disc, one soft ping | LIVE | `--live` | A real source reported it now. |
| WAITING | disc with its left half filled | WAITING | `--ink2` | The expected signal has not arrived. Always with a reason. |
| SIMULATED | diamond with a dot | SIMULATED | `--sim` | The data is generated. Never shown as measured. |
| PLANNED | dashed ring | PLANNED | `--ink3` | Not built yet. The pose names what arrives. |
| FAULT | filled triangle with a bar | FAULT | `--fault` (shape), `--ink` (word) | A live reading that reports a failure. |

Rules:

- A chip is 11 px mono caps, never cut. It sits at the right of its row, in its own column, never inline after a title.
- The word of a fault stays in the ink colour. Only its triangle carries the fault colour. The accent key never touches the fault chip: leave 16 px and the reason text between them.
- Every number carries a state, either on its row or on its group's caption. One chip per group when the whole group shares a state.
- WAITING is a first-class pose, not an apology. The reason is the second line of the row ("asleep, nothing is listening"). It is real text, not a tooltip.
- A locked key is not a state. It is an action that cannot run: flat, with a lock and its reason (2.5).
- On the glass chrome the chip text is `--ink`.
- A FAULT row goes first. Its remedy is in the row. The tray head shows the count ("1 FAULT") and changes to "NO FAULT" with a LIVE shape when it clears.
- Empty poses on the dark ground: a few formed marks at 40 percent, or dashed lines, plus the reason. On the light ground: a dotted ASCII banner or ghost pills. A single sentence floating in a big empty well is not a pose. A skeleton shimmer is never used: it says "loading", and nothing is loading.
- Simulated is only ever started by an explicit press, is labelled in three places (chip, line, key text) and ends by itself or on a second press.
- With no board, no voice core and no sensor running, most readings are WAITING. The design is drawn for that state first.

## 7. The ten sections

Each paragraph gives the focal form, the order of operations and the groups. Names of the views come from `shell/ids.ts`. Only Core Talk, Day Today and Console Health were drawn in the mockup. The rest follow the grammar and need their own layout pass. Every one keeps rule 4.5: state, the one accent action, the object.

**Core (JARVIS).** Focal form: the voice stage with the sigil ring and its mic level as an arc on the rim. Order: wake it (first tray, accent), read what was said (second), see the path behind it (third). Groups: stage and mic; conversation; voice path rail with a reason per step. Sound: the stage becomes the level and sound view, with the same first act (a test tone key) on top.

**Room (JARVIS).** Focal form: the room board, a plan of switches as soft keys, each with its lamp. Order: switch something (first), see its effect and the rule that fired (second), the rules list and their reasons (third). Groups: one group per circuit family, one per rule family. An unreachable board is WAITING with the reason; the keys are shown but locked, with the reason. Never draw a relay state that was not read back.

**Console (JARVIS).** Focal form: the worst row of health, then the detail of the row he picks. Order: read health worst first (first tray, the fault's remedy is the accent), open one row in depth (second, a drawer), see what has run (third, one tabbed well). Groups: Brain and machine, Hearing, App; the drawer; the activity well. Events, Connections, Hardware and Crew use the same shape: a list worst-first in the first tray, a drawer that explains the selected row in the second, history in the third.

**Senses (Aankhen).** Focal form: the presence field, drawn as a ring or a ruler of signal strength, never a body shape. Order: is a body moving (first, a single reading with its chip), why and from which link (second), history and teaching (third). Groups: links, rooms, drill days. Honest rule: one Wi-Fi link sees that a body moved, not how it is bent. No pose, no mood, no camera, no radar. With no board the field is a ghost track and WAITING with the reason. Simulated data is SIMULATED.

**Memory (Yadaash).** Focal form: the recall line, one input and the card it returns. Order: ask or keep something (first), the answer with its source (second), beliefs, people and the keep list (third). Groups: recall, beliefs, people, keep. A belief shows its evidence count, and "not read yet" is WAITING. Nothing private appears in a tracked file or a screenshot.

**Day (Well Wisher).** Focal form: the day arc, empty until a block is logged, with a dotted elapsed track and a now-marker. Order: the first block (first tray, accent), what is ahead and the counters (second), proof, reminders and the week bars (third). Groups: ahead, counters, proof rings. Week, Month, Body and Close keep the arc idea at their own scale: a week rail, a month grid of empty cells, a body log, a close-the-day checklist.

**Focus (Well Wisher).** Focal form: one large elapsed ring. Order: start a block (first, accent), the running session and its rest (second), the drill history (third). Groups: the ring, the intent line, the rest rules. The ring counts up. No countdown, no streak.

**Study (Well Wisher).** Focal form: the paper or the question in front of him, as one large plate. Order: open the next paper or question (first), practice and the plan (second), the library and the dMAT notes (third). Groups: papers, practice, plan, library. No exam result and no score claim. A count is shown only from logged work.

**Tree (Well Wisher).** Focal form: the tree itself, drawn as branches with nodes. Order: the next node to grow (first, accent), its prerequisites (second), the whole tree map (third). Groups: node, prerequisites, map. Locked nodes are PLANNED, grown nodes are LIVE.

**Career (Well Wisher).** Focal form: the pipeline as a horizontal rail of stages. Order: the next step to take (first, accent), its deadline and cost (second), certificates, abroad notes, money and the ladder (third). Groups: pipeline, certs, abroad, money, ladder. Dates and fees come from stored facts with a source. Anything else is WAITING.

## 8. How to build it in the existing code

The look is a switchable version beside the current one. Default is the current look. Nothing in the current look is edited except at the one branch point in section 8.3. The owner compares the two with one switch.

### 8.1 The window (desktop host)

Where: `app/jarvis_app/desktop.py`. The window is created with `webview.create_window(... frameless=True, easy_drag=False, background_color="#050506", ...)` and started with `gui="edgechromium"` (pywebview on Edge WebView2).

A transparent window over a Windows 11 backdrop (acrylic or mica) was measured to work on 20 Nov: the page renders over the backdrop at about 133 frames a second. The plan:

1. Add a setting, `window.glass`, default off. When off, the window is built exactly as today.
2. When on, create the window with `transparent=True` and a transparent page background (html and body), then ask the system for a backdrop on the window handle (`DwmSetWindowAttribute` with the system backdrop type: acrylic or mica). Keep the code in a new module, `backdrop.py`, so `desktop.py` changes by a few lines.
3. Expose `set_glass(on)` on `WindowApi`. The page reads the setting at load, writes `data-glass` on the root, and calls it from the Frosted switch in More.
4. Fall back to the opaque ground when the call fails or the Windows build has no backdrop. Say so in the switch's state word (OFF) and in the log.
5. The system backdrop does the blur. The page paints its tint over it as in section 2. The in-page ground blur of the mockup is dropped in the host or kept light. Trays, spine, top plate and dock carry no `backdrop-filter`. Only popovers and phone sheets stay opaque. Measure on the laptop (the 4050) before tuning. Use the stricter host alphas of section 2.7 until that measurement says otherwise. Use the stricter host alphas of section 2.7 until that measurement says otherwise.
6. The splash, the min size (1120 by 720) and the order of start are unchanged. Flashing or restarting the app needs the owner's OK.

### 8.2 Tokens and kit

The app's colours, elevation and motion already come from CSS custom properties: `app/ui/src/styles/design/clay/` (`primitive-color.css`, `semantic.css`, `scene.css`, `elevation.css`, `focus.css`, `type.css`, `products.css`, `contrast.css`, `forced.css`, entry `index.css`), `app/ui/src/shared/kit/clay.css`, and `app/ui/src/shared/motion/` (`governor.ts`, `reveal.ts`, `springs.generated.css`, `useReducedMotion.ts`).

The new tokens live in new files, scoped by `:root[data-look='v3']`, so they are inert until the attribute is set. Map the new names onto the existing roles where one exists:

| v3 property | Existing role it extends |
| --- | --- |
| `--lit-a`, `--lit-b` | `--selected-fill` role, but a gradient, neutral |
| `--raised`, `--raised-hi` | `--surface-raised`, `--surface-raised-hi` |
| `--well-rgb` | `--surface-sunk` |
| `--ink`, `--ink2`, `--ink3` | `--ink-1`, `--ink-2`, `--ink-3` |
| `--live`, `--fault`, `--sim` | `--state-measured`, `--state-fault`, `--state-simulated` |
| `--accent`, `--on-accent` | `--accent-fill`, `--accent-on` |
| `--sh-raise`, `--sh-press`, `--sh-tray` | the `--elev-*` ladder |

Rules for this layer:

- Every alpha of section 2 is a token, and `data-glass="off"` sets all of them to 1. Nothing else changes between glass on and off.
- High contrast (`data-contrast='high'`) and forced colours still win. Under both, the look falls back to opaque and the existing edge rules apply, so a hairline may return there. That is allowed.
- No hairline on a labelled control in v3 means the current `--edge-ui` border is removed only under `[data-look='v3']`.
- The existing contrast test (`src/__tests__/tokens.test.ts`) reads these files. Add a v3 section that asserts the floors in section 2.7 from the token values with the worst-case backdrops (white for dark, black for light), for ink, ink2, ink3, the locked label, the accent label and the key caps.
- Add a lint test that the computed font size of lamps, units, hints, chips and ledger text is at least 11 px, and that every button box is at least 44 by 44 px.
- Pixel literals are forbidden in gap rules by the style lint. Write gaps in rem.

### 8.3 Shell and navigation

Views register in `app/ui/src/shell/views/` (one `*.view.ts` file per view, validated by `collectViews`). Do not change them. The frame is `shell/ShellV2.tsx` with `shell/shell.css`. The current flag is `shell/flag.ts` (`app.shell`, fragment `shell=v2`).

The look switch copies that pattern:

- New file `shell/look.ts`: `lookV3Enabled()`, read once per page load, key `app.look`, value `v3`, fragment `look=v3` (`look=off` turns it back), same capture-at-evaluation rule as `flag.ts`.
- `ShellV2.tsx` gets one branch near the top of the render: when v3 is on, render `shell/v3/ShellV3.tsx` and return. This is the only edit to a current shell file.
- New folder `shell/v3/`: `ShellV3.tsx`, `Spine.tsx` (project tiles with their marks and state lines, and the nested open tray), `TopPlate.tsx` (location, view switch, lamp pill and its popover, More with Appearance and Keys, flat caption keys), `LampPill.tsx` (worst state first, one ring segment per lamp), `ViewChip.tsx` (the phone view chip and its list), `Dock.tsx` (mode switch and input), `Tray.tsx` (the three-tray frame, the dots, the job name, the ruler), `Sheets.tsx` (the phone pills and sheets), `subprojects.ts` (the four sub-projects, their sections, their marks), `shell-v3.css`.
- The lamp pill needs one source of truth: a function that collects every lamp from the shared lamp table across all products and returns them worst first. The steward fault is a lamp like the others.
- The three-tray grid is one primitive: `<Zones first second third ratio />` with the 1.85 : 1.05 : .95 default and a named ratio for Core and for Console. Every section view builds on it. `Tray` draws the head, the ruler on the first tray, and the graded material.
- Hash routing: keep the current place model in `shell/store.ts`. v3 only maps `#section/view` onto it.

### 8.4 Packages for a parallel build

Each package owns folders. No file is in two packages. Packages in the same wave can run together.

Wave 1 (together, no shared file):

| Package | Owns (only these) | Delivers |
| --- | --- | --- |
| W1 Window | `app/jarvis_app/desktop.py`, new `app/jarvis_app/backdrop.py`, new `app/tests/test_backdrop.py` | The glass switch in the host, opaque default, measured fallback. |
| T1 Tokens and kit | new `app/ui/src/styles/design/clay/glass.css`, one import line in `clay/index.css`, new `app/ui/src/shared/kit/glass.css`, new `app/ui/src/shared/kit/v3/` (Plate, Group, Ledger, Chip, Key, LockedKey, PressKey, Dial, Gauge, Sigil, Mark), new test files for the v3 contrast floors and the size lint | Section 2 as tokens, the kit pieces, the opaque fallback. |
| S1 Shell and nav | `app/ui/src/shell/look.ts`, `app/ui/src/shell/v3/`, the one branch in `ShellV2.tsx`, new shell tests | Sections 3 and rules 4.1 to 4.7, 4.14. |
| P1 Phone | `app/jarvis_app/phone_page/` | The phone composition of section 3.6. |

Wave 2 (after T1 and S1 merge; one pass per section, all together):

| Package | Owns |
| --- | --- |
| L-core | `app/ui/src/jarvis/core/`, `app/ui/src/styles/sections/core.css` |
| L-room | `app/ui/src/jarvis/room/`, `styles/sections/room.css` |
| L-console | `app/ui/src/jarvis/console/`, `styles/sections/console.css` |
| L-senses | `app/ui/src/jarvis/senses/`, `styles/sections/senses.css` |
| L-memory | `app/ui/src/jarvis/memory/`, `styles/sections/memory.css` |
| L-day | `app/ui/src/ww/day/`, `styles/sections/day.css` |
| L-focus | `app/ui/src/ww/focus/`, `styles/sections/focus.css` |
| L-study | `app/ui/src/ww/study/`, `styles/sections/study.css` |
| L-tree | `app/ui/src/ww/tree/`, `styles/sections/tree.css` |
| L-career | `app/ui/src/ww/career/`, `styles/sections/career.css` |

Each layout pass works only under `[data-look='v3']` in its own CSS, builds the view on `<Zones>`, and keeps the current look untouched. `styles/sections/` is a new folder. Wave 3 is one integrator: the full check (below), the contrast and colour run on a real screenshot, a comparison page for the owner, and the decision on the default.

### 8.5 Checks before any merge

- Unit: `npx vitest run` and `npx tsc -b` in `app/ui`. Python: the pytest command in the project instructions with a scratch data folder.
- Never build into `app/ui/dist` while the app is running.
- Screenshots at 1366 by 768, 1120 by 720 and 390 by 844 for each view, with the frost on and off, over a bright busy wallpaper (undimmed) and a dark one. Overflow must be 0. The glass-off set is part of the review, because glass off is the default.
- Contrast: hide the text, capture, and compare each text box with its worst background pixel, as in section 2.7.
- Size and targets: a script reads the computed font size of every text node (scaled SVG text included) and the box of every button. Fail under 11 px or under 44 by 44 px.
- Reduced motion: every motion in section 5 has its still, and no view shows more than one continuous motion.
- Honesty: a test that no simulated reading appears without the SIMULATED chip.
- Fault swap: a test that the accent is on the fault's remedy while a fault is open and on Start JARVIS when it is not, never on both. A second test that a locked key has `aria-disabled`, shows its reason as text and has no raise or press shadow.
- Header: a test that the lamp pill on every view names the worst state first.
- Duplicates: a test that no reading id appears in two places on one view.

## 9. Open questions for the owner

1. The steward row is drawn as FAULT because its own text says replies will fail until it is back. The current screen shows it LIVE. This needs the owner's agreement and a real status source. The remedy key ("Check steward") needs a real action behind it. The lamp pill now repeats that fault on every view, including Well Wisher. Confirm that a JARVIS fault should show in the Well Wisher header, or limit it to the dark projects.
2. Senses and Memory are in the product `jarvis` in the code. The spine groups them as their own sub-projects. Confirm the grouping.
3. The tints were measured over a drawn wallpaper and by calculation against a white and a black backdrop. The mockup uses a brightness term that the host does not have, so the host takes the stricter alphas in 2.7 (.76 and .74 on dark). They need a check over the real backdrop on the laptop. If the glass feels heavy, the alphas drop only as far as the contrast floors allow.
4. The ground blur costs frame time. The Frosted switch is the escape hatch. A frame-time check on the 4050 is part of wave 3.
5. The caption keys are 44 px wide and flat, which takes 132 px of the top plate. They keep the 44 px target on purpose. The Windows convention is 46 by 32. Confirm that the larger target is wanted.
6. The Frosted switch lives in More, under Appearance. It is one more tap to find the escape hatch. Confirm that is acceptable, or keep a small lamp for it on the spine.
7. The phone has no Ask first key. A second press on Ask returns to the first mode. Confirm that this is clear enough on a real phone.

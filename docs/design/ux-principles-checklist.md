# The 20 principles checklist (UX and animation)

The owner asked on 14 Nov 2026 that these twenty principles be used systematically. This file turns each into a rule that can be built, reviewed and scored in this product. It is read by every UI builder, reviewer and juror of the overhaul (the design source of truth stays `docs/design/jarvis-product-overhaul.md`; where a number here differs from a token there, the token governs and this file is corrected).

How it is used:
- **Builders** apply the rules that fit their component or screen and say in their report which of the twenty they used and where.
- **Reviewers** check the "Check" column; a failed check on principles 13, 14, 17 or 19 is a defect, the rest are findings.
- **Jurors** score "motion and feel" and "usability" against this list and name the principle behind each fix.
- Nothing here overrides the standing rules: every motion has a static reduced-motion form, nothing animates while idle, any motion is bounded (at most 5 s) and stops when hidden, no celebration that works as a variable reward, and a number is never shown without its state.

## Animation (1 to 12)

| # | Principle | In this product | Check |
|---|---|---|---|
| 1 | Squash and stretch | A raised clay control gives when pressed: it sinks 1 to 2 px and compresses to about 98 percent on the press axis, then returns. Transform only; never on text blocks. | Pressed state differs from rest in position and shadow; under reduced motion the state still changes, without transform. |
| 2 | Anticipation | A large move gets a short wind-up (40 to 60 ms, a few pixels the other way): a drawer, a card lifting to a detail view, a hold-to-confirm ring. For mains switching and other guarded actions the arming step is the anticipation. | Guarded actions take two acts; no wind-up on small, frequent controls. |
| 3 | Staging | One focal element per canvas (the centrepiece or the hero number). When something opens or takes focus, its neighbours dim by 4 to 8 percent and it rises one elevation step. One accent fill per view. | A first-time viewer can point to the main thing in two seconds; no second accent fill. |
| 4 | Pose to pose | Design the poses first: rest, hover, pressed, focus, loading, done, error, planned. Motion only travels between poses, so every pose stands alone. | Each pose exists as a static state and is listed in the component's states. |
| 5 | Follow through | Things with mass settle: a switch thumb, a knob, an odometer digit, a dropped list item overshoot once and settle within 240 ms; a label or lamp attached to them lands 30 to 60 ms later. | At most one overshoot; nothing keeps moving after 400 ms. |
| 6 | Slow in and slow out | Easing comes from the motion tokens only. Entering eases out, leaving eases in, moving eases in and out. Linear is for progress bars only. | No literal easing or duration in component CSS; tokens only. |
| 7 | Arcs | An object that travels more than about 80 px (a toast, a card going to a drawer, focus moving between tree nodes) follows a slight arc: its two axes use different easing. Dials and knobs rotate. | Long moves are not straight diagonals; rotation is used where the object is round. |
| 8 | Secondary action | At most one supporting motion beside the main one: a lamp that pulses once when its state changes, a sigil that draws on once when a section opens. It never competes with the main action. | One secondary motion per event, at most 5 s, never looping at rest. |
| 9 | Timing | Feedback to input within 100 ms. Hover about 80 ms, press 80 to 120 ms, small state changes 160 ms, panels and drawers 240 to 320 ms. Nothing over 400 ms except a deliberate hold. | Measured durations fall in these ranges. |
| 10 | Exaggeration | Meaningful events get a clear, slightly larger answer, once: a seal drawn on a finished session, digits rolling on a saved count, a stamp on a committed entry. An error shakes at most 6 px for two cycles and says why. Routine clicks get none. | The event is real and stated in words; no confetti, no random or escalating reward. |
| 11 | Solid drawing | One light, from the top left, for the whole product. Shadows match height on one elevation scale; pressed is lower than rest; wells are lit from inside the same way; nothing mixes light directions. | Every raised or recessed surface uses the elevation tokens; highlight on the top-left edge, shade on the bottom-right. |
| 12 | Appeal | Each view has one centrepiece, a deliberate type scale, an 8 px rhythm and generous padding, and is judged beside the owner's reference crops before it is shown. | The jury's design scores reach the pass line of 8.0. |

## Usability (13 to 20)

| # | Principle | In this product | Check |
|---|---|---|---|
| 13 | Fitts's law | The primary action is large and near where the hand already is: at least 48 px tall, beside the thing it acts on, or on a screen edge (the rail, the title bar, the bottom of the phone). Controls used together sit together. | The primary action is the largest target in its group and within one hand-move of the content it serves. |
| 14 | Bigger hit areas | Every target is at least 44 by 44 CSS px, extended invisibly when the drawing is smaller, with at least 8 px between neighbours. On the phone, frequent actions sit in the thumb zone. | Measured bounding boxes, including the invisible extension. |
| 15 | Hick's law | At most five to seven choices visible in one group; one primary action per view; the rest behind a Trim key, a drawer or the command palette. | Count the visible choices per group. |
| 16 | Miller's law | Information is chunked: at most six callouts on a specimen, five tabs in a row, seven datums on a dashboard; long numbers are grouped; lists are sectioned. | Count the items per chunk. |
| 17 | Doherty threshold | The interface answers within 400 ms. A skeleton or an optimistic state appears within 100 ms; any wait beyond 400 ms shows an honest progress line with the WAITING state and what is awaited; local model output streams. | Timed in a test or a trace; no silent wait over 400 ms. |
| 18 | Postel's law | Liberal in what it accepts: loose typed text, many date and unit forms, pasted or dropped files of any supported kind. Strict in what it shows: normalised values, named states, one format. Mistakes are cheap: undo for 6 s. | Table-driven input tests with messy inputs; output format fixed. |
| 19 | Jakob's law | Behaviour is conventional even where the look is new: Esc closes, Enter commits, Tab moves, Ctrl+K opens the palette, calendars and tables work as people expect, icons carry labels. | Keyboard and pointer conventions pass their tests; nothing common is reinvented. |
| 20 | Frequency of use | The most used actions get the best place, the shortest path and a shortcut; rare or destructive ones sit further away and are guarded. Order follows use, counted locally and only with consent. | The top three actions of a view are reachable in one step and have key bindings. |

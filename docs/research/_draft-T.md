# Core Talk (v3 look): draft notes of package T

## 2026-11-25: Core Talk as one stage (orb, four states, fading conversation)

**Question.** The owner, 25 Nov: the Core Talk voice screen "has no animations, looks bad and does not work". He asked for one
large JARVIS circle in the middle, wave lines (yellow, orange, red, violet) running through it left to right, the
conversation just under it with the newest lines solid and the older ones fading into the ground, and plain readable text
instead of the terminal look. Keep every function and every honest state.

### What was built (v3 look only; the classic look is unchanged)

- **One stage.** The first tray (job CONVERSATION) holds the orb, the words, the wake row or the four path lamps, and the
  conversation. The second tray is VOICE PATH (the four stages with their seconds and medians, unchanged component), the
  third is HEALTH (the five organs). Ratio `[2.7, 1, 0.9]`, inside the Zones contract; no shell CSS overridden.
- **The orb** (`CoreOrb.tsx`, `orb.ts`): a raised rim lit from the top left (`--sh-now`), a sunk well (`--sh-press`), a glow
  in the well, a thin ring and two orbit arcs. Four wave lines in SVG, drawn three times: a soft glow and a thin line behind
  the orb (faded toward the tray edges by a mask) and a bright line clipped to the well, so the lines read as passing
  THROUGH the circle. Size `clamp(180px, 44cqh, 288px)` of the first tray's body: about 213 px at 1366 x 768 (36 percent of
  the tray, 44 percent of its body), 200 px on the phone.
- **Modes** from the core's own state word: asleep, waking (booting), ready (idle, sleeping), listening (listening, followup),
  writing (transcribing), thinking (thinking, replying), speaking, stopped (not running with a last_error). Each differs by
  shape and light even when still: asleep dim with flat lines and a 5 s breath; waking a dashed turning ring; listening the
  ring opens at nine o'clock where the lines come in and the lines lean left; writing and thinking two arcs orbit and the
  lines settle to a near flat line; speaking the brightest glow and the tallest lines; stopped a dashed ring in the fault ink.
- **Words** under the orb: the state word in the reading face, one plain line, the level as a machine value in mono. The line
  is the engine's own sentence when it gave one (`last_error`, `status_line` such as "Offline: restarting in 15 s",
  `boot_step`), and the answer of a failed Wake or Sleep press ("Could not wake: ..."), kept until the next press.
- **Wake.** The orb is a press target while he is asleep or stopped (aria-label "Wake JARVIS. <line>", focus ring 6 px off
  the rim); the one accent key "Wake JARVIS" with its Ctrl Shift Space caps sits under the words, the Voice / Text only switch
  beside it. Awake, the row is the four lamps (Hear, Write, Think, Say; the running stage raised and warm) and a plain
  "Put to sleep" key.
- **Conversation** (`TalkLog` in `Transcript.tsx`): every turn of the run in one scroller, newest at the bottom, a centred
  column of at most 46 rem. "You" and "Jarvis" as small labels, the time in mono, the sentence in the reading face at 15 px /
  1.5. The scroller's own box carries `mask-image: linear-gradient(to bottom, transparent, currentColor 58%)`, so lines are
  fully opaque in the lower 42 percent and vanish at the top edge; the mask stays put while the lines scroll, so scrolling up
  brings older lines into the opaque part. It follows the newest line unless the reader has scrolled up (48 px of slack).
  The fade is visual only: every line stays in the DOM, selectable, focusable (J, K, Home, End, F to flag) and named.
  "from an earlier run" stays as the honest tag on the recorded exchange. Terminal brackets and the fake prompt are gone.
- **Small keys** in the two upper corners of the stage, beside the orb: the state lamp with "Voice / Off" and the uptime,
  Pause (P inside the stage), Voice settings, Earlier, Review (Share a review). On the phone they become two centred rows
  under the orb.

### What drives the motion, and what is decoration

| Part | Driven by | Real or decoration |
| --- | --- | --- |
| Mode, word, ring, arcs | the core's state word (`/api/core`, bus `state`) | real state, decorative form |
| Wave height while listening | input frames (`level` on /ws/events) via voiceState `measured` | real: mean of 24 smoothed bands / 160, else rms_db over -60..0, else scalar level x 4 |
| Wave height while speaking | output frames (`out_level`) | real, same transform |
| Wave height with no fresh frame, and in every other mode | nothing: a FIXED height per mode | decoration that says the mode is alive; it never varies like a meter |
| Glow size | the same measured value, 0 when not measured | real only when measured |
| Level text | the frame's rms_db, "LIVE" (or "SIMULATED" on a fixture) | real; otherwise "MIC no level yet", "SPEAKER no level", "between sentences", "no level while thinking", "MIC OFF" |
| Path lamps | ribbonStages (running stage, measured values) | real |

A frame older than 400 ms (STALE_MS) is no longer measured: the words go back to "no level" on their own (one timeout).

### Performance and motion rules

- One `requestAnimationFrame` loop (jarvis/voice `VoiceLoop`, 60 fps cap) writes 12 path `d` values and one custom property
  per frame: no React render, no layout. 4 lines x 57 points.
- It stops when the tab is hidden, when the stage is off screen (IntersectionObserver), on Pause, under
  `prefers-reduced-motion` and under the app's calm setting (`html[data-motion='calm']`); asleep and stopped run no frame
  callback at all (CSS breath only).
- The still pose of each mode (`STILL_AMP`) keeps the modes apart by shape and colour.
- No new colour values: the four wave inks are derived from `--accent` with relative oklch (amber +34 degrees of hue and
  +0.13 lightness, red -20 degrees, violet -108 degrees); without relative colour they fall back to `--accent-hi`, `--accent`,
  `--accent-lo`. A fault sentence is ink with a FAULT glyph and word in the fault colour, because `--fault` text on the dark
  tray reads about 3.1 to 1, under 4.5.

### "It does not work": what was a screen fault

1. Asleep, the engine's reason (`status_line`, `last_error`) was only in a chip's hidden text; the visible hint ignored it.
   Now it is the line under the orb.
2. While booting the voice picture said IDLE (`booting` was an unknown word to the voice state machine); `transcribing`,
   `replying` and `sleeping` also drew as idle. Now: Waking with the boot step, Writing, Thinking, Ready.
3. A failed Wake press was a 4 s toast only. Now the engine's answer stays under the orb until the next press.
4. Wake itself: the key and the orb call `POST /api/core/start {mode}` and then re-read `/api/core`; unit-tested (the orb
   sends the chosen mode). Not verified against a real engine here.

### Measured (25 Nov, worktree ui-talk)

- `npx tsc -b`: exit 0.
- `npx vitest run src/jarvis src/__tests__/shell src/__tests__/kit src/__tests__/tokens.test.ts src/__tests__/jarvis`: exit 0,
  47 files, 1029 tests passed (11 new in `src/jarvis/core/__tests__/orb.test.tsx`).
- `pytest tests -q` (privacy scan), from the worktree root: exit 0, 25 passed; the new and changed files scanned by name: 0
  findings.
- Playwright: NOT RUN. Free disk on C: fell from 9.4 GB at the start of the session to 95 to 505 MB (another process; the
  page file grows with the process count), under the 6 GB floor of the brief. The spec `app/ui/e2e/core-talk-stage.spec.ts`
  is written (four states at 1366 x 768 and 390 x 844 through mocked `/api/core` routes and a mocked `/ws/events` socket,
  overlap, 44 px keys, the newest turn clear of the mask, reduced motion, screenshots to `$TEMP/ui-talk-shots`) but has never
  run, so it may need a selector or timing fix on its first run.

### Not verified

- No screenshot was taken, so the look (orb proportions, the wave field, the fade) is judged only from the CSS, not seen.
- No real microphone, speaker or engine: the level path is tested with generated frames only.
- The vertical budget is computed by hand: at 1366 x 768 the conversation gets about 130 to 145 px (two to three turns
  visible, the rest by scrolling). If the screenshots show it too short, lower `44cqh` to `40cqh` (gives 19 px back).

### What remains

- Run the new spec (and `e2e/shell-v3.spec.ts`, whose reduced-motion test opens this view) once disk is above 6 GB, look at
  the screenshots, and fix what they show.
- Needed from the engine: nothing new is required for this screen. Useful later: `level` frames with `bands` and `rms_db`
  while listening (Tier 1), so the listening waves follow the voice rather than a scalar level.

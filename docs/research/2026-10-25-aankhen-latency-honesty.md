# Aankhen: motion latency and honest zones (2026-10-25)

## Question
The 15:34 screenshots showed two problems:
- The Wi-Fi motion flag was right but about 1 s late.
- The zone estimate said "sitting at the desk 100 %" while I was moving, with the layout marked ESTIMATED and no labelled drill days.

Can the motion onset reach ≤ 0.4 s without more false motion in an empty room? What must be true before a zone is shown or spoken?

## Method
- New tool: `python -m aankhen.tools.latency`. It only reads the recordings in `data/aankhen/recordings`. There are none in `data/app`.
- **Baseline per setting.** Each detector setting gets its own baseline, made from the first 75 s of the labelled empty-room recording (`20261012-201420-empty.akr`, 150 s). A baseline only describes the window it was measured with.
- **False motion.** The share of detector evaluations that say "motion" on the second 75 s of the same recording, which the baseline never saw. The first 5 s are dropped while the windows fill.
- **Onset latency.** The time from the start of each labelled move/walk segment in the three `firstlight-*.akr` sessions (host clock) to the first "motion" state.
  - This includes my reaction to the voice prompt, which is the same for every setting. It compares settings; it is not an absolute delay.
  - Some segments start while I was still moving from the previous step, which explains the outliers (5–9 s).
- **Simulator** (`bench.bench_simulation`, seeds 1–3, median). Ground truth is exact here. Latency is measured to the fused presence "moving", which includes the simulated person's own ramp-up.

## Findings: where the delay came from
The old detector settings were: a 1.0 s window, evaluated every 0.25 s, 4 windows above threshold to switch on and 3 below to switch off.

| Source of delay | Old | New |
|---|---|---|
| Waiting for the next evaluation (average) | 0.125 s | 0.05 s |
| Switch-on wait (extra windows above threshold) | 0.75 s | 0.1 s |

On top of these comes the time for the 1 s variance to cross the threshold. The total was about 1 s, which matches what the screenshot showed.

## Results: real recordings

| Setting (window / step / windows to switch on) | False motion, unseen empty half | Median onset | Onsets (s) | Segments missed |
|---|---|---|---|---|
| **Before:** 1.0 s / 0.25 s / 4 | 0.00 % | 0.79 s | 0.21, 0.11, 1.36, 5.83 | 2 |
| 1.0 s / 0.1 s / 3 | 0.00 % | 0.42 s | 9.25, 0.09, 0.05, 0.42, 5.21 | 1 |
| **Chosen:** 1.0 s / 0.1 s / 2 | 0.00 % | **0.30 s** | 9.19, 0.09, 0.05, 0.30, 5.15 | 1 |
| 0.5 s / 0.1 s / 2 | 0.00 % | 1.30 s | 9.13, 0.09, 0.05, 1.30, 5.02 | 1 |
| 0.5 s / 0.1 s / 3 | 0.00 % | 1.42 s | 9.19, 0.09, 0.05, 1.42, 5.15 | 1 |

A 0.5 s window was slower to cross its (noisier) threshold. Keeping the 1 s window and cutting the step and the switch-on count won.

## Results: simulator (median of 3 seeds)

| Scenario | Latency before → after | Wi-Fi recall before → after | Steady false alarms before → after | Stop lag before → after |
|---|---|---|---|---|
| walk | 0.55 → 0.50 s | 83 → 94 % | 0 → 0 % | 1.05 → 1.05 s |
| evening | 0.85 → 0.70 s | 50 → 72 % | 1.2 → 2.0 % | 1.8 → 1.9 s |
| empty | — | — | 0 → 0 % | — |
| still | — | — | 0 → 0 % | — |

The only cost is evening steady false alarms, up 0.8 points. The empty room stays at 0 % on both real and simulated data.

## What changed
1. **Motion settings** (`aankhen/motion.py`): evaluated every 0.1 s, 2 windows above threshold to switch on, 8 below to switch off.
   - The switch-off time stays about 0.8 s, so stop lag barely changes (simulator: 1.05 s on walk, 1.8 → 1.9 s on evening).
   - The existing baseline is still valid because the window length (1 s) is unchanged.
   - `bench.calibrate_from_bytes` now takes a settings argument.
2. **Zone honesty** (`belief.py`, `engine.py`, `readiness.py`). A zone is named only when the layout is measured AND the day-7 leave-one-day-out zone test has passed, which is what calibrates the 0.6 floor. Before that:
   - the answer is "in the room, not sure where", with the reason;
   - `belief.zones_trusted` is false;
   - the snapshot JARVIS speaks folds the raw model's desk/bed into "room" and caps every probability at 0.9 (`honest_learned`). That raw field was where the spoken "desk 100 %" came from.
   - The simulator keeps its default floor and stays labelled as simulated.
3. **No radar.** The LD2450 status row appears only if a layout lists one. The UI lost the radar arc, its legend, the "Radar" layer chip and the "radar Hz" readout.
4. **Measure my room** (`aankhen/measure.py`, UI `components/MeasureRoom.tsx`):
   - The form takes: walls, bed, desk, wardrobe, room door, balcony door, and board and router positions with heights.
   - It is checked field by field. Errors include sizes given in centimetres, items past the walls, overlapping furniture, doors running off their wall, and a board less than 30 cm from the router.
   - Saving writes `room.json` with `measured: true` after a backup. Only what was measured is replaced (zones, furniture, sensor poses); the house map is kept.
   - New routes `GET/POST /api/aankhen/room-measure` and `GET /api/aankhen/readiness` are added through `aankhen/server.py attach()`. They sit behind the app token (test `app/tests/test_room_routes.py`).
5. **Readiness card.** It lists the measured layout, both empty-room baselines (fan off and fan on), the number of drill days (passed blocks only), and the day-7 zone test (`models/drill/lodo.json`), each with the command that fixes it.

## Tests
- Python: `aankhen/tests/test_latency.py`, `test_zone_trust.py`, `test_measure.py`, `app/tests/test_room_routes.py`. Existing contract tests were updated.
- UI (vitest): `src/__tests__/roomMeasure.test.ts`, plus an updated `belief.test.ts`.

## Limits
- The real onset numbers include human reaction time and come from only 3 sessions (5 scored onsets). Drill days with exact block starts would give a cleaner number.
- The twin's geometry updates after Aankhen restarts. The badge and the zone gate update straight away.

## Sources
- Internal recordings: `data/aankhen/recordings` (2026-10-12).
- Detector background: the ESPectre pipeline and Et Tu Alexa (NDSS 2020), as cited in the `aankhen/motion.py` docstring.

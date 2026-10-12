# Aankhen: smaller movements, the whole house, and a model that learns the home

Three changes, each measured on the physics simulator (`docs/design/aankhen-physics.md`).
Simulator numbers check the method against physics; they are not evidence about a real
room. The Teach panel below is how real evidence gets made.

## 1. Seeing smaller movements, and only people

**Why the old detector missed small movements.** It reduced each packet's 51 subcarriers
to one number, turbulence (std / mean), and took its variance over 1 s at every
frequency up to 50 Hz:
- **One direction only.** Turbulence keeps a single direction of the change across the
  51 subcarriers. A movement whose pattern is orthogonal to the room's static shape
  barely moves it.
- **Mostly noise.** A movement of a few millimetres changes the path by far less than
  a wavelength, so the CSI follows the movement itself, at 0.4–2 Hz. Everything from
  4 to 50 Hz is noise for it.

**Human-band energy (HBE, `motion.py`).** It adds a third test, OR-ed with the old two:
1. Project each sample onto the first 6 Legendre polynomials across the subcarriers. A
   body's change is a smooth ripple, because its delay differs from the static paths by
   tens of ns. Noise is independent per subcarrier, so ~88 % of it is dropped.
2. Detrend each coefficient over 3 s and keep its power at 0.4–4 Hz. This band sits
   above breathing's fundamental and drift, and below a fan's blade-pass and most white
   noise.
3. Divide by the same window's own noise. That is estimated from first differences of
   real samples, robustly, so the result is ~1 for an empty room whatever the signal
   level.

**Comparison** (`python -m aankhen.tests.sensitivity --all-variants`, quick run, room 0):

| variant | small movements gained over the old detector | still person at the desk flagged |
|---|---|---|
| 2 s, 1–8 Hz | +3 to +10 points | 1 % |
| 3 s, 0.3–8 Hz | the most | 83 % (breathing harmonics) |
| 3 s, 0.4–4 Hz, all 51 subcarriers (no projection) | less than with projection | 72 % |
| **3 s, 0.4–4 Hz, 6 smooth patterns** | **chosen** | **15 %** |

Two defects the measurement exposed, both fixed:
- **Forward-filled gaps.** The resampler repeats the last packet across a gap (up to
  0.25 s). Once, a 3.6σ noise sample held for 23 slots looked like a 3 cm movement:
  empty-room HBE reached 7.5× its median. Gaps are now bridged with a line between the
  means of 5 real samples on each side. Over six empty runs the maximum fell to 2.08.
- **One-sample steps.** An uncompensated gain step jumps in one sample, which a body
  cannot do. Jumps beyond 6 noise deviations are removed before measuring.

**What it bought** (full run: 2 simulated rooms, fidgets of controlled size every ~4 s,
share of moving windows seen):

| where | 3 mm | 6 mm | 1 cm | 2 cm | 3 cm |
|---|---|---|---|---|---|
| middle of the room, old → new | 8–9 → 25–32 % | 26–30 → 53–59 % | 44–50 → 61–73 % | 63–65 → 78–81 % | 76–79 → 87–90 % |
| bed, old → new | 0 → 0 % | 0 → 0 % | 36–38 → 39–42 % | 55–56 → 68–71 % | 75–78 → 85–88 % |
| desk, old → new | 93–96 → 100 % | 97–99 → 100 % | | | |

At the middle of the room, the smallest movement seen in half the windows fell from
~1–2 cm to 6 mm. Things that are not people stayed where they were: an empty room, a
drifting room and a running fan are flagged in 0–1 % of windows, old and new.

**The cost, and how it was cut.** A 3 s window remembers a movement for 3 s, so
"moving" stayed on after someone left. In the walk scenario, false "moving" beyond the
2 s grace rose from 0 % to 9 %. The fix: HBE can **start** motion when the last second
holds human-band power above 1.6× noise, but can **keep** it on only above 4×; MVS and
the level decide when it stops.

Full benchmark, `bench --sim --seeds 5 --seed-base 11 --channel-seeds 2`, median of 10 runs:

| scenario | Wi-Fi recall | false "moving" beyond 2 s | presence accuracy |
|---|---|---|---|
| evening | 76.8 → 77.6 % | 0 → 2.6 % | 98.9 → 98.9 % |
| walk | 91.0 → 91.0 % | 0 → 0.6 % | unchanged |
| sleep | 54.5 → 57.2 % | 0 → 0.3 % | unchanged |
| fan | 61.8 → 61.8 % | 0 → 0.1 % | unchanged |

`AANKHEN_HBE=0` turns HBE off for comparison.

## 2. The whole house

`room.json` can carry a `house` section in the room's own frame:
- `areas`: other rooms, the passage, a balcony;
- `fixtures`: ACs, the TV, doors, the router's console.

`room.example.json` shows the format; the real file stays git-ignored. It feeds:
- **3D view.** Other rooms appear as dim floors with waist-high walls; fixtures are
  labelled markers.
- **2D plan.** Those same walls show as outlines below the 1.2 m plan cut.
- **"whole house" framing.** It fits the house beside the side panel.
- **Simulator, house scenario** (`bench --sim --scenarios house`). Family walk the
  passage and move around the living room by the router while your room is empty; you
  visit your desk at 100–170 s.

**On this house, today's engine gets presence right 27 % of the time** and says
"occupied" 100 % of the time the family moves, with or without HBE. The physics says
why: someone 1 m from the router, by the main door, moves the link 2.5× more than
someone crossing the room. No threshold can fix that. Telling them apart needs
patterns.

## 3. A spatial model that learns the home (`learn.py`, `teach.py`)

**What it predicts.** Every 0.5 s, one of five states:
- empty
- someone outside (passage, living room)
- in the room
- at the desk
- in bed

**Features** (28):
- MVS, level variance;
- HBE and its 6 per-pattern powers, power in 4 sub-bands;
- how the channel's shape and level differ from a slow quiet reference;
- context over 5–120 s: a passer-by is a short burst with nothing after it.

**Model and filter.**
- **Classifier:** gradient-boosted trees with balanced classes.
- **Movement rules:** a hidden-Markov filter. Nobody gets from the desk to the bed
  without crossing the room, and nobody appears or leaves except via the room.

**Simulator result — corrected 2026-10-12.** The first version of this section
reported 94.7 % occupancy. That number was inflated, for two reasons found by
running the model live in the app, where it said "in bed, 100 %" for an empty room:

1. **The reference was an artifact.** Shape and level changes were measured
   against whatever the first second of each simulated day looked like, which was
   the simulator's start-up transient. Even the empty room sat at `shape_dev2 ≈ −22`,
   so the model's top features (0.24 and 0.17 importance) partly learned that
   artifact. When a stream started with the family already moving, the features
   went far outside anything it had seen (`shape_dev1` 34 vs at most 13).
   **Fix:** calibration now records the empty room's shape, level and RSSI
   (`Baseline.ref`), and every stream starts from it — live, in teach recordings,
   and in every training day (each day gets its own empty-room calibration).
2. **"Away" was unrealistic.** When "you" left the room in a training day, the
   simulator parked you standing still half a metre outside your door. So "only
   the family is moving while I'm in the kitchen" almost never appeared, and the
   model read it as someone inside. **Fix:** away time is now spent in the other
   rooms of the house or out of the main door.

Trained on 32 new 10-minute days of this house; scored on 12 other days (14,190
windows) and on the house scenario (family moving from the first second, you
visit the desk at 100–170 s; 3 seeds):

| | scored on | occupancy right | "occupied" while only family moved outside | "occupied" when empty | missed you |
|---|---|---|---|---|---|
| today's engine | realistic days | 57.4 % | 99.5 % | 89.7 % | 3.6 % |
| first model (2026-10-11) | realistic days | 61.8 % | 82.8 % | 71.4 % | 9.1 % |
| **current model + movement rules** | **realistic days** | **77.2 %** | **23.9 %** | **18.4 %** | 24.1 % |
| first model | house scenario | 30–35 % | 93–100 % | — | 0 % |
| **current model** | **house scenario** | **85.8 %** | **18.8 %** | — | 3.4 % |

When someone is in, it names desk, bed or elsewhere in the room right 70 % of the
time on realistic days (93 % in the house scenario, where you only sit at the desk).
Its biggest confusion is a still person in bed versus nobody moving anywhere (bed
read as empty or outside in 46 % of bed windows): a body lying still away from the
link's sensitive zone changes one link's channel very little. That is close to the
physical limit of one ESP32 and one router, not a bug to tune away.

**What this means.** 77 % on simulated days is a better starting point than the
engine's 57 %, not a result. Real recordings decide, which is why the model stays
advisory.

**Teach, from the viewer.**
- **Label.** Tap "At my desk / In bed / Moving around / Outside my door / Room empty"
  (keys D B W O E, P to pause). The hub records the stream to `recordings/teach-*.akr`
  with the labels beside it.
- **Train.** "Train on my labels" fits the model on every teach recording, weighted 5×
  over the simulated days.
- **Score.** The model is scored on the last 30 % of each labelled stretch, which it
  never saw, and the score is shown.
- **Go live.** The new model replaces the running one.
- **Simulator recordings.** Teach recordings made while the hub runs the simulator are
  named `teach-sim-*` and never trained on.

**Advisory until proven.** The model's answer shows as bars in the panel, labelled with
what it was trained on. Fusion does not use it yet. It earns a vote only after its
held-out score on your recordings beats the engine's.

CLI: `python -m aankhen learn simulate | train --data … --test … | eval`.
Models live in `data/aankhen/models/` (git-ignored); the replaced ones in `previous/`.

## Open

1. Real data: record teach sessions, so that every number in section 3 comes from the
   real room.
2. Free labels: keyboard activity means you're at the desk; the HC-SR04 means you're in
   bed. Both would keep labelling without you tapping anything.
3. Give the learned model a vote in fusion once its real held-out score justifies it.

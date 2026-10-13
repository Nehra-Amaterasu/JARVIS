# 2026-10-13 · The estimate avatar: drawing the learned "where am I" in the twin

## Question

On the real board there is no radar, so a frame has no tracks. The only answer to
"where am I right now" is the learned spatial model (`learned.state`: empty / outside /
room / desk / bed, `learned.p`, `occupied_p`) and the activity model (still / typing /
waving / walking). The twin drew a 0.45 zone glow and a floating activity tag, nothing
that reads as "me". How should that answer be drawn, without passing a place off as a
measured position?

## What was built (app/ui/src/twin/estimate.ts, EstimateAvatar.ts)

- **A state is a place, not a coordinate.** Each place maps to a spot derived from the
  room.json polygons:
  - desk: seated at the centroid of the part of the desk zone the desk does not cover
    (the chair side), facing `facing_deg`, or the desk itself without one;
  - bed: lying on the bed zone, head along `facing_deg` (feet to head), on the bed's
    height;
  - room: standing at the most open point of the floor zone. This is the point with the
    most clearance from walls, furniture and the other zones, pulled 0.12 m per metre
    toward the middle. An L-shaped floor's vertex average can land inside a wardrobe;
  - outside: no figure, only a soft marker 0.45 m past the wall nearest the door;
  - empty: nothing.
- **Holds.** A new place must persist before the figure acts on it. Appearing takes
  0.5 s, moving between places 1.5 s, leaving 2.5 s, a new activity 0.8 s. With no new
  learned window for 4 s, the figure goes. The engine's HMM already smooths the state,
  but the zone is right only 88 % of the time on the real board, so a single wrong
  window would otherwise send the figure across the room.
- **Opacity and label from the probability.** Opacity is `0.16 + 0.84·smoothstep`
  over P(place) from 0.25 to 0.9. The label reads "estimate 82% · desk · typing", with a
  dashed edge (a radar track's tag is solid). The figure shows only when `occupied_p` is
  at least 0.5.
- **Heat.** Human-band energy (`recent`, else `energy`, in noise units) is mapped as
  `ln(e/1.15)/ln(40/1.15)`, clamped to 0..1. That gives 1.6x (the motion gate) about
  0.09, 4x (typing level) about 0.35, and 30x (waving at the desk, measured 14-37x in the
  2026-10-13 sessions) about 0.91. The heat rises at once and decays with τ = 1.6 s, so a
  1 s burst is still at about a third after 2 s. It is painted around the body region the
  activity names: hands and forearms for typing, the raised right arm for waving, the
  shins for walking, a 0.25 Hz chest pulse for still. A trail of sparks (80 points,
  about 2.4 s) follows the hottest places.
- **Plan view.** The figure is replaced by a top-down glyph (standing, seated or lying)
  inside a dotted ring. The heat ring is brighter on the side where the movement is (the
  weighted direction of the hot places).
- **Provenance.** The figure is cyan from the real board and amber in simulation or
  replay. A legend line under the title says "position from learned spots, not
  measured coordinates".

## Measurements

Dev server (scratch data, a dev-only feed of hardware-like learned frames),
1600×1000, headless Chrome capped near 77-94 fps by the harness:

| | fps | p50 frame | p95 frame | draw calls |
|---|---|---|---|---|
| estimate layer on | 77.5 | 13.8 ms | 21.0 ms | 111 |
| estimate layer off | 78.5 | 13.8 ms | 21.0 ms | 91 |

- The figure costs 20 draw calls and no measurable frame time. The geometry count stayed
  at 111 through a full desk → bed → room → outside → desk cycle and through
  3D → Eyes → Plan → 3D: nothing is allocated per frame.
- Walk between places: about 0.7 m/s measured (desk to bedside, 1.7 m in about 2.5 s,
  after standing up). The figure leaves the bed via the nearest open floor and goes out
  through the door before fading.
- A seated typist's hand, by forward kinematics of the pose, lands at z 0.77-0.80 m and
  0.43-0.51 m forward of the pelvis: on a 0.75 m desk 0.25-0.35 m in front of the seat.

## Found on the way

- `scene.fog` (near 14 m, far 34 m) blacked out anything fogged in the plan view, whose
  camera sits 30 m up. The first glyph was drawn but invisible. All the avatar's
  materials now set `fog: false`.

## Limits (honest)

- The figure's pose is the activity model's class, not a measured posture: one Wi-Fi
  link cannot see joints. The walk between places is a transition animation, not a
  tracked path.
- On the real board the activity was right 67 % of the time (typing the weakest), so
  the heat's location is as good as that. The heat's strength is the measured human
  band.

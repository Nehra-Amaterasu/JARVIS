# Aankhen twin: a dot cloud of probability instead of a person (2026-10-15)

## Question

The Aankhen page's room twin drew the learned model's answer as a hologram person
(twin/EstimateAvatar.ts, 2026-10-13-estimate-avatar.md): seated at the desk, lying on the
bed, standing on the floor, posed by the activity model. Aankhen never sees a body. Wi-Fi
CSI says "something moved, and the pattern looks most like the desk". Can the twin show
that honestly, as a probability, at least as cheaply as the figure?

## Design

Data: the hub's new `belief` block, on frames or status messages (field names fixed by
the hub-side work running in parallel):

```
belief = { state: "in_room"|"empty"|"unsure", confidence: 0..1,
           zones: [{ id, name, p, x, y, r }], motion: 0..1,
           activity: { state, p } | null, updated: t }
```

`x, y, r` are room.json metres. `lib/belief.ts readBelief()` validates and clamps it.

Fallback for an older hub with no `belief`: `fallbackBelief()` maps `learned.p` onto places
derived from room.json (`twin/places.ts roomPlaces()`):

| learned state | zone id | name | place |
|---|---|---|---|
| desk | desk | at the desk chair | chair side of the desk zone (the desk zone minus the desk itself), r 0.25–0.55 m |
| bed | bed | on the bed | the bed frame inside the bed zone, r 0.3–0.9 m |
| room | floor | on the open floor | most open point of the floor zone, r = clearance + 0.15, 0.35–0.8 m |
| outside | door | out by the door | the doorway, inside the room, r 0.2–0.4 m |
| empty | none | | |

The state comes from `occupied_p`: at least 0.6 is in_room, under 0.35 is empty, anything
between is unsure. Confidence = |occupied_p − 0.5|·2. Motion is the higher of the
human-band energy (log-scaled, as before) and the activity's typical motion (still 0.08,
typing 0.3, waving 0.65, walking 0.9) × its probability.

Rendering (`twin/BeliefCloud.ts`):

- A pool of 240 dots in **one THREE.Points, so one draw call**. Zones with p > 3 % get
  dots ∝ p, using largest-remainder rounding so the total is exact. The pool size scales
  with Σp, so probability the hub puts "nowhere" draws no dots.
- Each dot has a fixed per-page Gaussian offset. A new belief moves its target, so dots
  glide between layouts instead of hopping. Positions are a 2-D Gaussian truncated at 2σ:
  quantile-mapped, so no ring of clamped dots forms at the rim. The truncation radius is
  r·spread, with spread = 0.45 + 0.55·motion. Cloud height is 0.18 + 0.9·motion m, with
  height ∝ u² so its weight sits on the floor.
- Jitter amplitude and speed ∝ motion, computed in the vertex shader. When still, the
  whole cloud breathes at 0.2 Hz (point size and alpha).
- Opacity = confidence, smoothstep 0.22..1. Colour: in_room copper `#d98c52`, unsure grey
  `#9aa0a8`. When empty, the dots fade out.
- Transitions: exponential glide with τ = 0.25 s (about 95 % in 0.75 s) for positions,
  alpha, colour, motion and the label. The CPU lerps the 240 positions only while a
  transition is in flight; once settled it stops uploading.
- A label over the top zone reads "probably: at the desk chair · 62 %",
  "probably: nobody in the room · 80 %", or "can't tell" when the top zone is under 30 %.
  It has a dashed border, never solid, because a solid edge means a measurement.
- Zone map: dashed circles with names, one LineSegments rebuilt only when the zone set
  changes. A new "Zone map" layer chip turns it off and on. The "Estimate" chip is now
  "Belief".
- prefers-reduced-motion: no jitter and no breathing, transitions snap (τ 0.06 s), and the
  label's swatch does not animate. The setting is live (matchMedia change listener).
- Stale: no belief for 4 s, and the cloud fades out instead of claiming an old answer.

## Frame time

Bench: `app/ui/twin-bench.html` and `src/twin/bench.ts` (new, dev only, not built). It
uses a synthetic room, 10 Hz synthetic frames carrying both `learned` and `belief`, and
cycles desk/typing → floor/walking → bed/still. It drives 600 frames back to back through
the twin's own loop, each followed by a 1-pixel readPixels, so the time includes the GPU
work. It runs once with the estimate layer on and once with it off. Canvas 1280×800,
Claude desktop browser pane, Windows 11. The old code was measured from a scratch
worktree of main, with runs interleaved old/new.

| 3D view, mean frame ms (p95) | run 1 | run 2 | run 3 | avg | estimate layer's own cost |
|---|---|---|---|---|---|
| old: hologram figure | 4.59 (5.7) | 4.90 (7.1) | 4.45 (5.7) | **4.65** | 0.62 / 0.52 / 0.64 → **0.59 ms, 19 draw calls** |
| new: dot cloud | 4.30 (5.8) | 3.78 (5.0) | 4.74 (7.2) | **4.27** | 0.26 / −0.17 / 0.65 → **0.25 ms (within noise), 1 draw call** |

Plan view, one run each: old 4.26 ms (layer cost 0.41 ms, 4 calls); new 3.92 ms (−0.11 ms,
1 call). Total draw calls: 45 → 28. The zone map adds 1 call and is counted in the "off"
baseline (26 → 27). Run-to-run noise is about ±0.5 ms because other agents were using the
machine, so the honest reading is that the cloud is free and the figure cost about
0.6 ms.

## What changed

- New: `app/ui/src/lib/belief.ts` (contract, fallback, dot layout, words, colour);
  `app/ui/src/twin/BeliefCloud.ts`; `app/ui/src/twin/bench.ts`, `app/ui/twin-bench.html`;
  `app/ui/src/__tests__/belief.test.ts` (15 tests: counts ∝ p, the 3 % cut, the pool cap,
  deterministic layout, dots stay inside r, densest at the centre, spread and height grow
  with motion, fallback mapping, state and confidence and motion, label, colour).
- Removed: `twin/EstimateAvatar.ts` (the hologram figure, its ring, glyphs, sparks, chair
  and door marker). From `twin/estimate.ts`, now `twin/places.ts`, I removed the pose,
  body, hold and label code, keeping the room geometry (places with a radius) and
  `energyToHeat`. `__tests__/estimate.test.ts` became `places.test.ts` (9 tests): the pose,
  hold and figure tests went with the figure.
- `SpatialTwin.ts`: BeliefCloud replaces the avatar. It adds a `zones` layer,
  `FrameMsg.belief`, and `onBelief()` for a belief that arrives on a status message.
- `pages/Aankhen.tsx`: the legend shows the cloud's label ("dots = probability, not a
  person", and "from the learned states" on the fallback). Status `belief` is forwarded to
  the twin. The layer chips are now "Belief" and "Zone map".
- Left alone: the Eyes view's own abstract figure (`components/EyesView.tsx`) is outside
  the twin and was not in scope.

## Sources

- Previous design: `docs/research/2026-10-13-estimate-avatar.md`.
- Truncated-Gaussian quantile mapping: for a 2-D unit Gaussian, P(ρ < a) = 1 − e^(−a²/2),
  so ρ_t = √(−2 ln(1 − (1 − e^(−ρ²/2))·(1 − e^(−2)))) maps ρ onto [0, 2) monotonically.

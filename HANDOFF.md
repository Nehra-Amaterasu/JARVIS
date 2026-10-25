# HANDOFF: Aankhen latency + honesty (2026-10-25)

## Done (investigation only, no code changed yet)
- Latency cause found in aankhen/motion.py MotionConfig: window_s=1.0, hop_s=0.25, on_count=4.
  Onset delay is about 0.75 s (hysteresis) + 0.125 s (hop wait) + time to cross the threshold, so about 1 s. This matches the screenshot.
- The recordings live in data/aankhen/recordings (*.akr + labels). data/app has none.
  Empty-room recording: 20261012-201420-empty.akr (150 s). firstlight-*.akr have move/walk segments on the host clock.
- Replay tools already exist: bench.calibrate_from_bytes (it uses the default MotionConfig, so it needs a cfg param),
  bench.bench_recording, bench.bench_simulation (exact motion_latency_s from the simulator).
- Honesty: belief.honest() already names a zone only at ZONE_FLOOR 0.6 with a same-firmware reference.
  It does NOT check whether the layout is measured. core speaks snapshot["learned"].state and p
  (core/tools/builtin.py _learned_presence), which is where "desk 100 %" comes from. The fix goes in
  aankhen engine.snapshot/frame: sanitise `learned` (state -> "room", p capped) unless the zones are trusted.
- UI: radar arc + legend in PresenceCore, 'fov' "Radar" layer chip, "radar Hz" in ChannelCard
  (app/ui/src/pages/Aankhen.tsx); the "LD2450 radar" sensor row comes from engine.status_message.
- The zone label in the UI comes from beliefLabel (lib/belief.ts) and LearnedCard bars.
- Routes: the app's routes are in app/jarvis_app/server.py (not owned by me). New HTTP routes can be added in
  aankhen/server.py attach() (it gets the FastAPI app; the token middleware still applies).

## Next steps (in order)
1. Add tools/latency.py: replay the akr files with a MotionConfig, recalibrate from the empty recording with
   the same cfg, report onset latency (simulator truth plus an oracle onset) and false motion on the empty file.
   Try hop 0.1 / on_count 2-3 / window 0.5-1.0. Commit.
2. honest(): add a layout_measured flag and a calibrated floor from drill days (none -> no zone).
   Sanitise the snapshot learned. Remove the LD2450 row. Write tests. Commit.
3. aankhen/measure.py: validate the form and merge into room.json (measured: true, backup first),
   plus GET/POST /api/aankhen/room-measure in attach(). Write tests.
4. aankhen/readiness.py: measured layout, fan-off and fan-on baselines, drill-day count. Add a route.
5. UI: remove the radar bits, add the honest label, MeasureRoom sheet, readiness card, vitest.
6. Write docs/research/2026-10-25-aankhen-latency-honesty.md and add its index line.

## Tests
None run yet.

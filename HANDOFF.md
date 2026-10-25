# HANDOFF: Aankhen latency + honesty (2026-10-25)

## Done and committed
1. **Latency (4ba7d59).** MotionConfig now uses a 0.1 s hop, on_count 2 and off_count 8 (was 0.25 s / 4 / 3).
   The new tool `python -m aankhen.tools.latency` measures it on data/aankhen/recordings (read-only).
   - Real recordings, median onset from the label start: 0.79 s -> 0.30 s. This includes the person's
     reaction to the prompt, so it compares settings rather than giving an absolute delay.
   - False motion on the held-out half of the empty-room recording: 0.00 % before and after.
   - The hysteresis alone used to hold an onset back 0.75 s; now it holds it 0.1 s.
   - Simulator, median of 3 seeds:
     - walk: latency 0.55 -> 0.50 s, Wi-Fi recall 83 -> 94 %, no steady false alarms in either.
     - evening: latency 0.85 -> 0.70 s, steady false alarms 1.2 -> 2.0 %.
     - empty and still: 0 % Wi-Fi false alarms before and after.
     - Stop lag unchanged (walk 1.05 s; evening 1.8 -> 1.9 s).
   - Tests: test_latency.py.
2. **Honesty + readiness (dcd9e2f).**
   - belief.py: `layout_measured` and `zone_floor`. A zone is named only when the layout is measured and the
     floor has been calibrated. Otherwise the answer is "in the room, not sure where" with the reason.
   - The contract now carries `zones_trusted`.
   - engine.py (hardware only) takes the floor from `readiness.zone_floor()`.
   - Removed the LD2450 row when no radar is configured.
   - `snapshot()["learned"]` goes through `honest_learned()`: desk/bed collapse to "room" and
     probabilities are capped at 0.9. core speaks this.
   - readiness.py checks the measured layout, the fan-off and fan-on baselines (baseline.json and
     baseline_fan.json), drill days from drill/index.jsonl, and the zone gate from models/drill/lodo.json.
   - Tests: test_zone_trust.py. The honesty, zones_belief, engine, hub, journal and drill tests are green.

## Written, NOT yet tested or committed (included in the WIP commit)
- aankhen/measure.py: form validation, merge into room.json (backup first, measured: true), form_from_room.
- aankhen/hub.py: `measured_room()`.
- aankhen/server.py: `attach_room_routes()` adds GET /api/aankhen/readiness, GET /api/aankhen/room-measure and
  POST /api/aankhen/room-measure (422 with {errors:[{field,error}]}).

## Exact next step
1. Write aankhen/tests/test_measure.py covering valid saves, each error field, the backup and the zones written.
2. Write app/tests/test_room_routes.py on the model of app/tests/test_crew_routes.py:
   `create_app(Guard(8782, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=[])`.
   Assert 401 without the token and 200/422 with it. Point attach_room_routes at tmp files through
   monkeypatched ROOM_FILE/DATA_DIR.
3. app/tests/test_aankhen_drill_routes.py line ~45 asserts the exact belief keys. Add "zones_trusted" there.
4. UI in app/ui/src/pages/Aankhen.tsx:
   - remove the radar arc and legend from PresenceCore, the 'fov' Radar chip and "radar Hz" in ChannelCard;
   - when `belief.zones_trusted === false`: the est legend says "in the room, not sure where", LearnedCard hides
     the desk/bed bars and caps at 90 %; also guard beliefLabel in lib/belief.ts;
   - add a MeasureRoom sheet (POST /api/aankhen/room-measure) and a Readiness card
     (GET /api/aankhen/readiness);
   - write vitest tests.
5. Write docs/research/2026-10-25-aankhen-latency-honesty.md using the numbers above, and add its index line.

## Tests
Green: test_latency, test_zone_trust, test_honesty, test_zones_belief, test_engine, test_hub,
test_journal, test_drill, test_motion, test_hbe, test_fusion, test_end_to_end.
Not run: anything for measure.py and the routes, the app tests, vitest.

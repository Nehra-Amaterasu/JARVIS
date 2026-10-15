# Aankhen: honest output, 15 zones with a belief over them, the drill runner, free teachers and a day-level evaluator

2026-10-15. Builds what the 10-14 data-protocol audit designed. Software only, no hardware bought, no firmware flashed. All checks ran on simulated data or on read-only replays of the 10-12 recordings.

## The question

Live, Aankhen said "bed" and "waving" while Aman sat still at the desk. The 10-14 audit found why: the models were trained on about 5 minutes of one evening, read against an empty-room reference from older firmware. Anything they had not seen fell into "bed" or "waving".

Five questions for today:

1. How do we stop the wrong answers now, before any new data exists?
2. Can the room hold many more places than desk / bed / room?
3. How does Aman collect labelled data that can generalise across days?
4. Which free signals can label data while he lives normally?
5. How do we judge a model by days it never saw?

## What was built

| Part | File | What it does |
|---|---|---|
| B1 honesty | `aankhen/belief.py`, `engine.py`, `recal.py` | Confidence floors and an out-of-distribution guard. "Waving" is removed. The empty-room reference is matched to firmware and fan, and recalibrated daily. Output: `{state: in_room / empty / unsure, zone or null, activity or null, confidence}` |
| B5 zones and belief | `aankhen/zones.py`, `belief.py`, `zones.example.json` | 15 zones in the room frame, a semi-Markov belief over them, and the `belief` contract on status, the frame stream and the snapshot |
| B2 drill runner | `aankhen/drill.py`, `python -m aankhen drill`, app routes | Seeded random blocks of (zone, activity, fan, 50 s) plus two empty-room captures. Spoken prompts, confirmation, QC, one retry, and labelled output |
| B4 free teachers | `aankhen/teachers.py`, hub | Laptop input counts, phone on Wi-Fi, voice turns, relay changes and time of day, logged as counts only every 10 s |
| B6 evaluator and trainer | `aankhen/dayeval.py`, `python -m aankhen evaluate`, `train` | Leave-one-day-out scoring with PASS / FAIL gates, and versioned zone and activity models with a manifest |
| App wiring | `app/jarvis_app/routes_aankhen_drill.py` | `/api/aankhen/belief`, `/zones` and `/drill/*`. Hands the hub the Uno's fan state and the voice-turn count. `server.py` was not touched |

**Replaced.**
- The in-app "learn my room" (`firstlight.run_room_session`, `teach.py`) is superseded by the drill. The old code still exists so old recordings can still be read; nothing new should use it.
- The activity class "waving" is gone from everything shown.
- The journal now records the honest output instead of the raw model.

## Design

### B1: say less, and say it right

- **Floors.** The coarse model's top class is shown only at p ≥ 0.6, otherwise "unsure". A learned activity is shown only at p ≥ 0.7. The belief names a state only at P ≥ 0.8 and a zone only at p ≥ 0.6.
- **Out-of-distribution guard (`OodGuard`).** It takes the training range of the place-carrying features (`shape_dev1-5`, `level_dev_db`, `log_hbe`) and widens it by 25 % of the span on each side.
  - The range comes from the model's manifest. For the installed models, which have none, it is read off HistGradientBoosting's bin edges.
  - A window outside that range is "can't tell".
  - So is a run where more than 10 % of the last 20 windows have no human-band energy because of packet gaps.
  - Rejected windows are not used as evidence at all.
- **Waving.** Its probability is zeroed and the rest renormalised before anything is shown or smoothed.
- **Reference matched to firmware and fan.**
  - References are stored per key, `fw-<version>__fan-<on|off>`, in `data/aankhen/references/`.
  - When the engine has no reference for the current key, the CSI models are not evidence at all, and the state stays "unsure" with the reason given.
  - A reference is captured only from windows that are known to be empty:
    - the free teachers (phone off home Wi-Fi **and** laptop idle, both for 10+ minutes), at most once per key per day;
    - the drill's empty blocks.
- **Fan.** The Uno's fan state now reaches the engine (`hub.note_fan` → `Engine.set_fan_external`). A switch starts the 30 s Wi-Fi settle again and selects the matching reference. The installed models still receive the ESP32-relay `fan_on` they were trained with (always 0). Drill-trained models receive the real fan state (`fan_source: "uno"` in their manifest).

### B5: zones and the belief

- **Zones.**
  - `at_desk_chair`, `desk_standing`, `beside_bed_desk_side`, `bed_lying`, `bed_sitting`, `standing_on_bed`, `beside_bed_bathroom_wall`, `outside_bathroom`, `inside_bathroom`, `between_bed_and_balcony_door`, `at_balcony_door`, `balcony`, `room_door`, `wardrobe`, and `out_of_room`.
  - Each zone is a circle (x, y, r in metres, room frame). Each has a coarse class (desk / bed / room / empty), an `in_room` flag, a posture, a dwell prior and its neighbours on the step graph.
- **Where the coordinates come from.**
  - `default_zones(room)` derives them from `room.json`: the desk and bed furniture boxes, the door, bathroom-door and balcony-door zones, the wardrobe, and the house areas of kind `bath` and `balcony`.
  - Every zone is marked `"estimate": true`.
  - `python -m aankhen zones --write` saves the derived map as the editable `data/aankhen/zones.json`, which is git-ignored because it is his home.
  - No coordinates of his room are in this note or in the repo. `zones.example.json` uses the example room.
- **Activities are separate from zones:** still, typing, moving, lying, none.
- **The belief filter (`ZoneBelief`)** is a forward filter over the zones, run every 0.5 s.
  - **Predict.** Probability leaves a zone only along graph edges. The rate is set by a Weibull dwell hazard:
    - shape 0.6 (hazard falls with time) for places one settles in (dwell ≥ 300 s: desk chair, bed lying, bathroom, balcony, out of the room);
    - shape 1.5 (hazard rises with time) for transit places.
    - The rate is also multiplied by (0.03 + 0.97 · motion), so nothing moves while nothing moves. This is object permanence.
    - Per-zone age is tracked mean-field: mass that stayed gets older, mass that arrived starts at 0.
  - **Update.** Each source is a tempered likelihood:
    - coarse classes spread evenly over their zones, weight 0.3;
    - a drill-trained zone model, weight 0.5;
    - keyboard input in the last 5 s, which means the desk chair and typing, weight 1;
    - phone away and laptop idle, which means out of the room, weight 1.
  - Teacher hints older than 15 s are ignored.

### The `belief` contract (implemented exactly)

```json
{"state": "in_room|empty|unsure", "confidence": 0.0,
 "zones": [{"id": "at_desk_chair", "name": "Sitting at the desk", "p": 0.0, "x": 0.0, "y": 0.0, "r": 0.35}],
 "motion": 0.0, "activity": {"state": "still|typing|moving|lying|none", "p": 0.0}, "updated": 1760000000.0}
```

- **Where it appears.** In `hub.status()["belief"]`, `hub.frame()["belief"]` (the `/ws/aankhen` frame), `hub.snapshot()["belief"]` and `GET /api/aankhen/belief`.
- **zones.** Always all 15, with p summing to 1.
- **motion.** Human-band energy over its threshold, divided by 4 and clipped to 0..1. It is null before the first reading.
- **activity.** It is null unless the state is in_room and the activity is at p ≥ 0.7. When the state is empty it is `{"state": "none", "p": confidence}`.
- **honest.** A sibling key on the frame and the status, `{state, zone, activity, confidence, why}`.

### B2: the drill

- **Plan.**
  - For each fan condition: one empty-room capture (120 s), then the 4 core pairs (desk still, desk typing, bed lying, beside the bed moving), then as many other pairs as the budget allows. They are drawn and ordered by the seed.
  - The default seed is the date. Which fan condition comes first alternates with the seed.
  - At 26 minutes this is 20 blocks: 2 empty blocks and 2 × 9 zone blocks, about 25.7 minutes.
- **One block.**
  1. The prompt is spoken (Windows SAPI, the same as first light; print and beep with `--no-voice`).
  2. He confirms he is ready.
  3. "Starting in 5… go." (15 s for the empty-room blocks.)
  4. 50 s labelled.
  5. "Done."
  6. He answers: ok, redo, bad, `w <zone> [activity]` (where he really was), or q.
- **QC on every block.**
  - CSI at least 150 packets/s;
  - gap share at most 10 %;
  - RSSI median within ±6 dB of the day's empty block under the same fan state;
  - human-band reading in at least 80 % of seconds;
  - typing blocks: at least 1 input event/s;
  - still / lying / none / empty blocks: no key events, at most 2 mouse moves.
  - A failed block is queued again once, at the end.
- **Recording paths.**
  - The CLI checks for the running app through `data/app/runtime/aankhen-api.json`: the port plus this launch's token, written by the routes module at start-up.
  - If the app is running, everything goes through its API. COM9 is never opened by the drill.
  - Otherwise the drill opens the board itself (`DirectBackend`).
  - Inside the app, `POST /api/aankhen/drill/start` runs it in process, with button or voice answers arriving on `/drill/confirm`.
- **Output.**
  - `data/aankhen/drill/YYYY-MM-DD/<HHMMSS-sSEED>/` holds `raw.akr`, `labels.jsonl` and `session.json`.
  - `data/aankhen/drill/index.jsonl` is the sessions index.
  - Each label line holds `t_start` / `t_end` (host epoch, the same clock as the `.akr` chunks), `zone` (what he confirmed), `asked_zone`, `activity`, `fan`, `confirmed`, `verdict`, `notes`, `firmware`, `packet_rate`, `qc` and `retry_of`.

### B4: the free teachers

- **What is logged.** One line every 10 s to `data/aankhen/teachers/YYYY-MM-DD.jsonl`:
  - idle seconds and input events (the moment of the last input moving forward, polled at 5 Hz), split into mouse moves (`GetCursorPos` changed) and key-or-click events;
  - phone on home Wi-Fi, from an optional `teachers.json` with the phone's IP and/or MAC. One ping, then the ARP table. null when not configured;
  - voice turns and relay changes;
  - hour and weekday.
- **Privacy.** No key identity, no text, no audio. GetLastInputInfo reports *that* input happened, never which key.
- **When it runs.** Only while the hub runs the real board. `AANKHEN_TEACHERS=0` turns it off.

### B6: the evaluator and the trainer

- **Features.**
  - `learn.FeatureStream` runs continuously over each session's `raw.akr`.
  - The reference is the same day's empty block under the block's fan state. This is the "same-day empty recalibration" condition, which the daily recalibration gives live.
  - The first 5 s of every block is purged.
- **Models.** HistGradientBoosting for zone and for activity.
- **Leave-one-day-out, per held-out day.**
  - in-room balanced accuracy;
  - zone top-1 and top-3 on in-room windows;
  - activity accuracy;
  - the same split by fan on / off;
  - a zone confusion matrix.
- **Gates, printed as PASS / FAIL.**
  - in-room ≥ 95 % on every held-out day;
  - zone top-1 > 73 % by day 7. With fewer than 7 days this says NOT YET.
- **Saving.** `train` saves `data/aankhen/models/drill/<version>/model.joblib` plus `manifest.json` (days, sessions, firmware, windows per zone and activity, feature ranges, `fan_source`). It points `current.json` at the new version and keeps every old one. The app loads it at the next Aankhen start.

## Numbers

**Replay of the 10-12 sessions through the installed models**
- Read-only, run in a scratch folder against the worktree code.
- Session A is the one the models were trained on. Session B is 30 minutes earlier, on firmware 3.1.0, and the models never saw it.

| Session B, 350 windows | Before | After |
|---|---|---|
| Coarse class shown | 100 % of windows | 76.0 % (24 % now "unsure") |
| Wrong coarse class shown, share of all windows | 61.4 % | 50.0 % |
| Wrong among those still shown | 61.4 % | 65.8 % |
| Activity "waving" shown | 68.6 % | 0 % |
| Activity hidden (below the 0.7 floor or OOD) | 0 % | 60.0 % |
| Honest state with no same-firmware reference | n/a | "unsure" for 350 / 350 |

- **Per class on B, the share of windows the guard and floors turned into "unsure":**

  | True class | Turned to "unsure" |
  |---|---|
  | outside | 45 % |
  | bed | 44 % |
  | desk | 13 % |
  | room | 4 % |
  | empty | 0 % (all 17 still read "bed") |

- **On session A** (in distribution), the floors hid 14 % of desk windows and nothing else.
- **Reading.**
  - Floors and the range guard remove some wrong answers.
  - They cannot fix a model that is confidently wrong inside its own training range: "empty" still reads "bed" on B.
  - The reference gate is what makes the output honest today: no same-firmware empty-room reference, no CSI claim.
  - Only drills and daily references can turn "unsure" into right answers.

**Tests**
- aankhen suite: 309 → 340. New:
  - `test_zones_belief.py`, 18 tests;
  - `test_drill.py`, 13 tests: plans, the runner with a fake backend, QC, retries, teachers, recalibration, and LODO plus versioned training on two simulated days.
- app suite: +4 in `test_aankhen_drill_routes.py`.

**Drill budget.** 26 min → 20 blocks (2 × 120 s empty + 18 × 50 s), estimated at 25.7 min including about 20 s overhead per block.

## Sources

### Local
- [2026-10-14-aankhen-data-protocol.md](2026-10-14-aankhen-data-protocol.md): the diagnosis, the drill and evaluation design, and the gates.
- [2026-10-14-spatial-intelligence-brainstorm.md](2026-10-14-spatial-intelligence-brainstorm.md): free teachers, the semi-Markov belief, the speech floors, the 73 % kill rule.
- Code read: `aankhen/learn.py`, `engine.py`, `hub.py`, `teach.py`, `firstlight.py`, `transport.py`, `journal.py`, `app/jarvis_app/server.py`, `uno.py`, `limbs.py`.

### External
- Yu, "Hidden semi-Markov models", Artificial Intelligence 174 (2010): https://doi.org/10.1016/j.artint.2009.11.011
- Windows `GetLastInputInfo`: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
- Windows `GetCursorPos`: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorpos
- Guo et al., "On calibration of modern neural networks" (floors, ECE): https://arxiv.org/abs/1706.04599
- Brunello et al., "Time matters" (ESP32 CSI drift over weeks): https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25
- scikit-learn HistGradientBoostingClassifier (binning, so the training range can be read off the bin edges): https://scikit-learn.org/stable/modules/ensemble.html#histogram-based-gradient-boosting

## What changed

- Aankhen now abstains instead of guessing.
  - Live, it will say "unsure" until a same-firmware, same-fan empty-room reference exists. One drill creates one for each fan state.
  - "Waving" can never appear again.
- There is now one place for "where": the zone belief, with the exact contract the dot-cloud view reads.
- The data plan is now runnable: about 26 minutes a day, then `evaluate`. After 7 days the kill rule decides whether model work on one link continues.

**Left to do**
- Fit the dwell hazards from his own labelled dwell times; they are priors today.
- Random one-tap "where are you?" prompts, the only unbiased truth.
- Voice confirmation inside the drill (the app endpoint accepts it; core does not send it yet).
- Have JARVIS's speech read only the honest output.
- Shadow-mode automations.

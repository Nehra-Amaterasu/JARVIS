# Aankhen: why it says "bed" and "waving", and a data protocol that can fix it

2026-10-14. Read-only analysis. No code, model or recording was changed. The scripts ran on copies in a scratch folder: they replayed the existing recordings through the installed models and read the raw-stream hours. This note is about method and numbers; it gives no personal details.

## The question

Live, early on 10-14, Aankhen said the person was lying on the bed while he sat still at the desk, and it said "waving" while he was still. The in-app "learn my room" session feels like a gimmick. Four questions:

1. What data and models exist?
2. Why are these errors happening?
3. What scripted tests would produce data that can really teach the ESP32?
4. Is "when I'm in the room, turn on the light and fan" safe to build now?

## Answer in brief

- **The installed models were trained on one session of about 5 minutes.** It was recorded on 10-12, 25 s per step, on firmware 3.2.0 at 238 packets/s, with the ceiling fan at full speed. There is **no data from a second day**. The "cross-session" numbers quoted before (zone 56-73 %, activity 35-47 %) came from two sessions about 30 minutes apart on the same evening, on different firmware.
- **"Bed" and "waving" are where the models end up on any input they have not seen.** On the only other labelled session, the installed models said:
  - "bed" for 100 % of the away windows, 90 % of desk typing and 84 % of walking;
  - "waving" for 94 % of the away windows.
- **The live features are far outside the training range.** The static-shape deviation, which is the only feature that carries place, reached -377 live against a training range of -19 to -179. Packet gaps on the new firmware blanked the human-band features in 12-40 % of windows for about 15 minutes.
- **Packet rate on its own, RSSI and the fan relay are not the cause** (tested below).
- **Fix:** collect labelled data on many days with scripted, randomised, quality-checked blocks, recalibrate every day, and judge it leave-one-day-out against the 73 % kill rule.
- **Automatic lights:** "off when I leave" is **not safe** today, and "on when I enter" is only acceptable behind strong gating. Run it in shadow mode first.

## 1. Inventory of `data/aankhen` (113 MB, 44 files at 03:00)

### Recordings (`recordings/*.akr`)

Every recording is from 10-12. Firmware and packet rate were read from the recordings' own STATUS frames.

| Recording | Start | Length | CSI/s | Firmware | Fan (ESP32 relay / physical) | Labels |
|---|---|---|---|---|---|---|
| firstlight-200222 | 20:02 | 129 s | 92 (bursty: median gap 3.6 ms, 14 gaps > 0.25 s) | 3.1.0 | off / unknown | still, move, walk, type: 20 s each |
| firstlight-200542 | 20:05 | 125 s | 100 | 3.1.0 | off / unknown | same 4 × 20 s |
| 20261012-201420-empty | 20:14 | 152 s | 100 | 3.1.0 | off / unknown | empty, 150 s (the calibration capture) |
| firstlight-202104 | 20:21 | 118 s | 101 | 3.1.0 | off / unknown | same 4 × 20 s |
| teach-202343 | 20:23 | 70 s | 103 | 3.1.0 | off / unknown | desk 23 s, bed 47 s |
| teach-202455 | 20:24 | 7 s | 108 | 3.1.0 | off / unknown | walk 3 s, desk 4 s |
| teach-202503 | 20:25 | 442 s | 103 | 3.1.0 | off / unknown | desk 30 s, walk 62 s; rest unlabelled |
| discarded/teach-room-203228 | 20:32 | 503 s | 104 | 3.1.0 | off / unknown | none (discarded) |
| teach-room-204112 ("session B") | 20:41 | 540 s | 99 | 3.1.0 | off / unknown | round 1 only: desk still/type/wave, walk, bed still/wave, away (25-35 s each). Round 2 removed: nobody was in the room. |
| teach-210538 | 21:05 | 50 s | 103 | 3.1.0 | off / unknown | desk 4 s, walk 28 s |
| teach-room-211258 ("session A") | 21:12 | 320 s | 238 | **3.2.0** | off / **on, full speed, wall switch** | 8 segments, including a bed_wave try the app itself marked "too small" |

The ESP32's fan relay reads "off" in every file. The fan has always been on the wall switch or, since 10-13, on the Uno relay, which Aankhen never sees (`engine._on_status` only reads the ESP32's relays). So the `fan_on` feature has been 0 in training and live alike, and the engine's 30 s fan-settle pause never fires.

### Calibration

`baseline.json` (10-12 20:18) holds:
- a 64 s empty-room capture on firmware 3.1.0 at about 100 packets/s;
- 255 of 590 windows kept as quiet ("57 % had movement elsewhere");
- reference shape, level and RSSI (-79 dBm).

That reference is two days and two firmware versions old.

### Models (`models/`)

All are HistGradientBoosting classifiers on the 28 `learn.FEATURES`.

| File | What it was trained on |
|---|---|
| **spatial.joblib** (installed 10-12 21:20) | "learn-my-room only", **1 run, 392 windows**, which is session A alone. Empty 58, outside 13, room 51, desk 139, bed 131. |
| **activity.joblib** (installed 10-12 21:20) | Same 392 windows. Still 100, typing 50, **waving 120** (the largest class, with the "too small" try included), walking 51, none 71. |
| previous/spatial-20261012-205030 and -212008 | Identical: 32 simulator days plus 2 teach recordings, 37,902 windows. |
| previous/spatial-20261012-real-only-collapsed and activity-20261012-chance-level | 697 windows from session B with its empty round 2 still labelled. |
| previous/spatial-2026-10-11-startup-reference | Simulator only, 37,829 windows. |
| sim-train.npz / sim-test.npz (and the 10-11 copies) | 32 / 12 simulated runs, 37,812 / 14,190 windows. |

### Raw stream (`stream/`, 20 Hz amplitude and phase plus the model's output once a second; unlabelled)

| Hour | Rows | CSI/s | Notes |
|---|---|---|---|
| 10-13 13:05-14:00 | 32.6 min | 260-280 | firmware 3.3.x |
| 10-13 15:31-16:20 | 44 min | 240-260 | |
| 10-14 01:45-02:00 | 2.2 min | 240 | |
| 10-14 02:00-03:00 | 35.2 min | 260-300 before the 02:36 flash to 3.4.0; 180-220 from 02:45 to 03:00 | |
| 10-14 03:08 onwards | live | 260-280 after a restart | |

The fan state comes from the Uno ledger (`data/app/energy/ledger.jsonl`): on (100) for most of 10-14 00:15-03:10 and off on 10-13 until 16:08.

### Live output logs (`activity/*.jsonl`): model output, not truth

| Day | Logged | "waving" | "still" | Occupied/not flips |
|---|---|---|---|---|
| 10-12 | 190 min | 18 % | 26 % | 28.4 per hour |
| 10-13 | 211 min | 42 % | 22 % | 8.2 per hour |
| 10-14 | 61 min | **50 %** | **1 %** | 12.8 per hour |

Nobody waves for half an evening. The activity model barely ever says "still" live.

## 2. Diagnosis, ranked

Experiments ran the real `FeatureStream`, `TemporalFilter` and installed models, offline and in the same way as `engine._learned_step`.

| # | Cause | Evidence | Strength |
|---|---|---|---|
| 1 | **One 5-minute training session; anything unseen falls into "bed"/"waving".** | Installed models on session A, the one they were trained on: zone 100 %, activity 99.7 %. That is memorisation. On session B, 30 minutes earlier on firmware 3.1.0: zone 48.2 %, activity 47.1 %. Away → bed 100 %, desk type → bed 90 %, desk wave → bed 100 %, walk → bed 84 %. Activity: away → waving 94 %, desk still → waving 54 %. This is the live symptom, reproduced. | Certain |
| 2 | **Stale reference and static-shape drift.** The empty-room reference is from 10-12 on firmware 3.1.0. The place features are the deviations from it. | Training static-shape deviation (shape_dev1): desk -126 / -117 (sessions A / B), bed -65 / -59, away -19 / -51. Live 10-13/14: **-57 to -377** in 5-minute medians, up to twice beyond anything trained, and swinging by 150 within one night. Moving the reference toward the still-desk posture flipped B's desk-still windows to "bed" 32-64 % and "waving" 62-68 %, and A's to "empty"/"outside" 38-48 %. Removing the reference sent A's away windows to "bed" 54 %. The live reference does not self-correct: 0 % of still-desk windows met the "quiet" rule (HBE < 1.6 and level variance < 0.05) that adapts it. | High |
| 3 | **Packet timing gaps, not packet rate.** HBE needs at least 80 % measured slots in each 3 s window (`HBE_MIN_REAL`). Below that, 15 of the 28 features become NaN, and the trees send NaN down branches learned from 1 % NaN. | Live 3.4.0 at 02:45 / 02:50 / 02:55: median real fraction 0.89 / 0.85 / 0.82, so 12 % / 19 % / 40 % of windows fell under the gate. In the same blocks "bed" took 36/295, 105/299 and 154/273 of the seconds, against 0-6 per block from 02:00 to 02:15. Replaying A thinned evenly to 180/s changed almost nothing (in-room 96.4 %, activity 96.9 %). With bursty 20-80 ms holes added (43 % of HBE missing), activity fell to 66.6 % and bed-still read "waving" 68 % and "desk" 58 %. Random thinning to 100/s blanked 98 % of HBE, and activity collapsed to 32.9 %. | High for 02:45-03:00; transient (rate back to 260-280 after the 03:08 restart) |
| 4 | **The "waving" label is a dumping ground.** | Waving is the largest activity class (120/392). It includes a bed_wave try the session flagged "too small" (HBE 6.2 against bed-still 5.5), so "lying still under the fan" is partly labelled waving. There is no threshold to tune: activity is the argmax of a smoothed HGB output, with no minimum confidence. The no-training HBE rule is not used live. | High for "waving while still" |
| 5 | **Posture and near-field effects.** The board sits about 0.3 m from the desk zone, so a change of posture at the desk (legs on the chair, leaning) changes the shadow on the static shape more than anything else in the room. | Only one 25 s desk-still posture was ever recorded. That is consistent with cause 2, but cannot be measured without labels. | Medium |
| 6 | **Fan.** The fan was on in session A and during most of the error period, so there is no on/off mismatch for these errors. | The fan is invisible to Aankhen (cause noted in section 1), so no fan-settle pause and `fan_on` always 0. In session A the fan alias made bed-still busier than desk-still (HBE 5.5 against 1.85), so "moderate energy" means "bed" to the model. **Turning the fan off will not fix it**: fan-off with a person in the room has never been trained, so it will be out of distribution too until fan-off blocks exist. | Medium (it shapes what "bed" means) |
| - | RSSI offset | Shifting RSSI by -6 dB (A) or +4 dB (B) changed zone by at most 2 points. | Ruled out |
| - | Even packet rate (238 → 180/s) | No meaningful change (see cause 3). | Ruled out |
| - | Gain compensation | Off in training and live (`AANKHEN_GAIN_COMP=0`, no gain frames in training). | Not a cause |

A side effect on the noise floor: the robust SD of the 20 Hz smooth-coefficient differences was:
- 0.07-0.17 in session A;
- 0.12-0.22 in session B and the calibration;
- 0.03-0.12 live on 3.3.x;
- 0.12-0.17 live on 3.4.0 at 180-220/s.

HBE divides by this floor, so the same posture gives different energy on different days: desk-still HBE was 1.76 in A and 4.25 in B. `log_mvs` and `log_level_var` are not normalised at all.

## 3. Data collection protocol ("drills"), replacing learn-my-room

### Why learn-my-room is not enough

- The order is fixed: desk-still always first and away always last, so time and order are confounded with class.
- Steps are 25 s, which is about 5 independent 3 s blocks.
- One posture per class, one session, no empty block to recalibrate, and no fan condition.
- "Too small" tries are still used for training.
- It is scored on a 30 % tail of the same steps (leakage).
- It opens the serial port itself, so it cannot run while the app owns the board.

### Classes

These come from the room model's zones. Waving is dropped.

| Class | Zone | What he does | Posture variants (one drawn per block) |
|---|---|---|---|
| E | empty, door closed | leaves the room | (none) |
| D-still | desk | sits, hands off the keyboard | upright; legs on the chair; leaning back; one hand resting on the keyboard |
| D-type | desk | types or uses the mouse normally | (none) |
| B-lie | bed | lies still | on the back; on the side; on the front |
| B-sit | bed | sits on the bed using the phone | (none) |
| F-stand | floor | stands still in the open floor area | (none) |
| F-walk | floor | walks slowly around the floor and to the wardrobe | (none) |
| T-door | door | walks out, closes the door, waits 20 s, comes back in | an event block, scored as an event, not a zone |

### One daily session (about 26 minutes)

1. **Pre-flight** (automatic, 30 s). Refuse to start unless:
   - the firmware is the frozen version;
   - CSI is at least 150/s with a measured-slot fraction of at least 0.90;
   - the channel is stable;
   - the Uno answers.
2. **Empty, fan off: 2 min.** He leaves. The runner switches the fan **on** through the Uno owner, waits 60 s to settle (not labelled), then records **empty, fan on: 2 min**. He comes back in.
3. **Fan-on set:** 8 blocks (D-still, D-type, B-lie, B-sit, F-stand, F-walk, T-door, plus a second D-still with a different posture), in seeded random order. Generate the order with a balanced Latin square across days, so that no class always follows walking.
4. Fan **off**, 60 s settle, then the **fan-off set**: the same 8 blocks in a new random order.
5. Swap which fan condition comes first every day.

Each block runs like this:
- prompt;
- he confirms he is in place ("ready", a key, or a phone tap);
- 5 s settle, not labelled;
- **50 s labelled**;
- a beep;
- "done as asked? yes / redo".

Budget: 5 min of empties plus 16 × about 75 s ≈ **26 min a day**. A failed block is re-queued once at the end.

**Every second day add one long-still block of 10 min** (reading at the desk without typing, or lying on the bed). These are the states that matter and that drift; they test object permanence and reference absorption.

**Days and times.**
- At least **4 days** before the first leave-one-day-out reading, **7 days** for the kill rule, and **14 days** for the full target. Days must be at least 12 h apart.
- Rotate the time of day: morning (08-11), evening (18-22), and at least **2 night sessions** (23-01) where the B-lie blocks are the real sleeping posture with the lights off.
- Log the time of day, a tick-box "others at home: yes / no" (no names), and anything moved in the room.
- **Freeze the firmware for the 7 days.** A day on new firmware is flagged as a new domain and kept as a held-out robustness day.

**Labels.**
- The runner writes the labels from its own scripted times (host clock). He never has to time anything.
- He confirms at block start and answers "yes / redo" at the end.
- Keyboard and mouse **event counts** (Windows `GetLastInputInfo`; timing only, never content) are logged per block as an automatic check.
- No audio is stored.
- Between drills, about 12 random one-tap "where are you?" prompts a day (brainstorm idea 1) give unbiased natural-behaviour truth, because drills are performed consciously.

**Quality checks per block (automatic; a fail is re-queued once):**
- CSI at least 150/s, measured-slot fraction at least 0.90, at most 2 gaps over 0.25 s, HBE available in at least 95 % of windows;
- no channel change, no relay switch inside the block, and the fan state confirmed by the Uno's JSON reply;
- RSSI median within ±6 dB of the day's empty block;
- D-type: at least 1 input event per second. D-still, B-lie, F-stand and E: 0 input events;
- still blocks: HBE at most 3 × the day's empty HBE under the same fan condition. F-walk: at least 3 × empty;
- confirmation given, and the answer "yes".

A day with fewer than 80 % of blocks passing is kept out of training and kept for robustness testing.

**Every day, log** the static distance between today's empty capture and yesterday's (the brainstorm's step 1d gate).

### Evaluation protocol

- **Split by day.** Use leave-one-day-out, plus forward chaining (train on days 1..k, test on day k+1), which is how the model is actually deployed. Purge 5 s at every block edge.
- **Two calibration conditions, both reported:**
  - "same-day empty recalibration": the held-out day's own empty block is allowed, as a morning calibration would be;
  - "no same-day data".
- **Primary metric:** zone top-1 on in-room windows (desk / bed / floor), macro-averaged over zones, with 95 % CIs from a block bootstrap. Report fan on and fan off separately.
- **Secondary metrics:**
  - in-room vs not, as balanced accuracy;
  - false-empty share of still blocks (D-still, B-lie);
  - false-occupied rate in empty blocks per fan condition;
  - door-event F1;
  - activity precision for still / typing / walking only;
  - ECE, and a risk-coverage curve (accuracy at 40 % coverage);
  - 45 s block majority-vote accuracy;
  - per-day minimum.
- **Baselines in every report:** majority class, the no-training HBE rule, the current installed model, and same-day nearest-prototype (brainstorm idea 6).
- **Kill rule (brainstorm step 5):** at day 7, if leave-one-day-out zone top-1 is **above 73 %** (on drill blocks and prompt answers), keep building the backbone. If it is **73 % or below**, stop model work on one link: the information is not there, so the effort goes to the one-board tripwire (step 6) or sonar (step 7).

| Verdict | Conditions |
|---|---|
| **Deploy** (feed the belief filter and automations) | All of: in-room vs not ≥ 95 % balanced accuracy on held-out days after smoothing; false-empty ≤ 2 % of still minutes; ≤ 1 false entry per night with the fan on; every held-out day ≥ 85 % in-room; both fan conditions pass; zone spoken only at ≥ 0.9 calibrated confidence with ECE ≤ 0.05. |
| **Don't deploy** | Anything less. Output stays advisory and is shown as "uncalibrated". |

### Tooling needed (design only, nothing built here)

1. **`aankhen/drill.py` and `python -m aankhen drill`.** It runs **through the app's hub**, never opening COM9 itself, and switches the fan only through the Uno's one owner. Parts:
   - a seeded, balanced schedule generator;
   - JARVIS TTS prompts, with beeps as a fallback;
   - a confirmation listener (voice word, key, or phone-page tap);
   - the `.akr` recorder;
   - per-block QC and a retry queue;
   - an end-of-session table showing per-class minutes, QC pass rate, pkt/s, real fraction and empty-to-empty drift.
2. **Labels v2 sidecar** (`*.labels.json`):
   - `session` {id, protocol_version, seed, day, tz, firmware, build fingerprint, pkt/s stats, fan plan, notes};
   - `blocks[]` {class, zone, posture, activity, fan {on, speed, source}, light, prompt / confirm / start / end on the host clock, start / end on the recording clock, qc {...}, verdict, retry_of};
   - `events[]` {door, fan switch, channel change}.

   `learn.recording_run` should read only blocks with verdict == "ok". Today it also uses "too small" tries.
3. **Session registry** `data/aankhen/sessions/index.jsonl`, plus a coverage report: labelled minutes per class × fan × time of day × day.
4. **Automatic recalibration.**
   - Every drill's empty blocks write a reference keyed by (firmware, fan state).
   - The engine loads the reference that matches the current firmware and fan, and says "uncalibrated" rather than using one from another firmware.
   - The fan state must reach the engine from the Uno owner, so the fan-settle pause works again.
5. **`aankhen/dayeval.py`.** Runs leave-one-day-out and forward chaining with the metrics above, and prints GO / NO-GO against the 73 % rule and the deploy table. It writes a JSON report and the dated research note.
6. **A live out-of-distribution guard.**
   - Track the HBE-NaN rate, and the static-shape deviation against the training range.
   - When either is out of range (for example NaN above 10 %, or shape_dev outside the training min-max), the learned output says "can't tell" instead of falling into bed/waving.
   - Questions to settle on drill data, not by decision: drop or normalise the absolute-scale features (`log_mvs`, `log_level_var`), and replace the hard 80 % HBE gate with bridging so it degrades instead of falling off a cliff.

## 4. Presence → automatic light and fan: is it safe now?

**No, not as "on when in, off when out".** The numbers:
- in-room was about 80 % across sessions (same evening; it will be lower across days);
- still-at-desk vs away was AUC 0.46 with the fan on, which is chance;
- the live log flips between occupied and not 8.2-28.4 times an hour, with 4-36 brief "left and came back" episodes a day.

A naive rule would switch the light many times an hour, and it would turn the light off on someone sitting still. That is the exact state this sensor cannot see.

### What can be built now (behind gating, shadow mode first)

| Rule | What it does |
|---|---|
| **On, on entry only** | Turn the light on only if all hold: the room was believed empty for at least 5 min; then an entry burst (HBE above 3 × the empty level); then occupied_p ≥ 0.9 held for 10 s. |
| **Hysteresis** | On threshold 0.9; off-belief threshold 0.2; minimum on-time 10 min; at most 1 automatic action per 15 min. |
| **Off, never from Wi-Fi alone** | Turn off only if: the phone has been off the LAN for 10+ min, **and** the laptop has been idle for 10+ min, **and** there has been no CSI motion for 10+ min. Announce first with a 60 s grace ("lights off in a minute"). Otherwise off is manual only. |
| **Night and sleep exception** | No automatic switching (on or off) inside the sleep window, in sleep mode, when P(bed) ≥ 0.8, or for 2 h after he turned the light off by hand. A hallway walker or fan alias at 03:00 must never switch the light on. |
| **Fan** | Never turned off automatically (comfort and heat). Turned on with the light on entry, during the day only, if he opts in. A fan switch also disturbs CSI for about 30 s, so Aankhen must be told about it (section 1). |
| **Manual override wins** | Any voice, app or wall action sets a hold until the next empty-then-entry cycle, or for 2 h, whichever is longer. Automation never undoes a manual action. |
| **Shadow mode** | Log the would-be actions for 7 days and score them against prompt answers and drill truth. Go live only if there is at most 1 wrong action a day and none at night. |

## What this changes

- The live "bed" and "waving" outputs come from a model trained on 5 minutes of one evening, read against a stale reference. Retraining on the same kind of session will not fix that.
- The next step is the drill runner, labels v2, per-day recalibration and the day-level evaluator. After that, 7 days of drills of about 26 min a day, held to the 73 % kill rule.
- Waving leaves the activity classes. Activity words stay off until a class reaches 0.9 cross-day precision.
- Automatic lights stay in shadow mode, with entry-only "on" and no automatic "off" from Wi-Fi alone.

## Sources

### Local
- [2026-10-14-spatial-intelligence-brainstorm.md](2026-10-14-spatial-intelligence-brainstorm.md): the kill rule, free teachers, the belief filter.
- [2026-10-13-world-model-and-channel-charting.md](2026-10-13-world-model-and-channel-charting.md): the cross-session numbers, what sessions A and B are, the unit slips.
- [2026-10-13-raw-stream-and-crew-speed.md](2026-10-13-raw-stream-and-crew-speed.md): the stream format.
- [2026-10-14-uno-relay-integration.md](2026-10-14-uno-relay-integration.md): the Uno as the only switch.
- Code read: `aankhen/learn.py`, `roomtrain.py`, `firstlight.py`, `engine.py`, `csi.py`, `motion.py`, `stream.py`.
- Data read: `data/aankhen/{recordings,models,stream,activity,baseline.json,room.json}` and `data/app/energy/ledger.jsonl`.

### External
- Brunello et al., "Time matters", ESP32 CSI drift over 3+ weeks: https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25
- 12-day ESP32 mesh study (placement mattered more than the classifier): https://arxiv.org/abs/2602.10823
- KNN-MMD, one-shot cross-domain on ESP32-S3: https://arxiv.org/html/2412.04783v1
- Windows `GetLastInputInfo`: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
- Guo et al., calibration and ECE: https://arxiv.org/abs/1706.04599

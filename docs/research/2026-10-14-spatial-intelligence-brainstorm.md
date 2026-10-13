# Spatial intelligence for Aankhen: what can really tell JARVIS where Aman is

2026-10-14. This synthesises five brainstorm lenses and one adversarial review. The lenses were RF physics and multi-link geometry, ML and world models, belief tracking, cheap hardware and non-Wi-Fi signals, and perception design. The review gave all 26 ideas a verdict and a cheapest falsifying test. This note keeps only the ideas the review did not kill. It ranks them and sets out an experiment ladder in which every step has a go/no-go number before any money is spent.

Nothing here uses a camera, a webcam or the LD2450 radar. The signals are Wi-Fi, BLE, phone links and sonar, which he named.

## The question

Can Aankhen tell JARVIS where Aman is and what is happening, all the time and with honest confidence, on budget hardware (ESP32 boards at Rs 250-900, his laptop, his OnePlus Nord 5)?

What we have today:
- one ESP32-S3 (firmware v3.4.0) pinging the router on ch 11, 20 MHz, at 250-500 pkt/s, with 51 usable subcarriers;
- an optional link 2 with the phone as transmitter;
- a ceiling fan above the bed that aliases into the human band.

| Measured | Within one session | Across days |
|---|---|---|
| In room vs empty | 97.5 % | ~80 % |
| Zone (desk / bed / floor / door) | 87.8 % | 56-73 % |
| Activity | 67 % | 35-47 % |

Other results so far:
- The self-supervised next-change world model never beat a linear predictor.
- Channel charting was at chance.
- Gain compensation broke stillness detection.
- The real bottleneck is labelled sessions recorded on different days.

## What a machine can and cannot "see" with our radios

This section is written as a lesson for an ECE student. Each idea follows from the one before it.

### 1. One link measures one path length, so it gives an ellipse, not a point

The router transmits and the ESP32 receives. Part of the signal bounces off your body, so it travels router to body to ESP32. Every point in the room with the same total path length lies on one ellipse, with the router and the ESP32 at the two foci. One link therefore says "something changed somewhere on this ring". It can never say "here".

The link is most sensitive close to its straight line, inside the **first Fresnel zone**. At the middle of a link of length d, that zone's half-width is r = sqrt(λ·d1·d2/d). At ch 11, λ = c / 2.462 GHz = 12.2 cm. For a 4 m link, r = sqrt(0.122 × 2 × 2 / 4) = 0.35 m. So a link behaves like a strip of floor about 0.7 m wide, plus a weaker halo around it. A body standing in the strip **shadows** the line of sight; a body outside it only ripples the signal.

### 2. Bandwidth sets how sharply you can measure distance

Range resolution is c / B. At 20 MHz that is 15 m, and his room is about 4 m. Time of flight cannot tell where in the room the body is. (For comparison, sonar with B = 4 kHz in air gives 343 / (2 × 4000) = 4.3 cm, which is why sonar is in this note.)

### 3. Two radios with separate clocks scramble the phase of every packet

The router and the ESP32 each run their own crystal. Every packet arrives with:
- a random carrier phase (CFO);
- a random detection delay (PDD), which tilts the phase across subcarriers;
- a slow drift from the crystals (SFO).

What each error allows:

| Error | Behaviour | What we can do |
|---|---|---|
| Board's fixed response | constant | calibrate once |
| SFO (crystal ppm) | slow drift | track the trend |
| CFO and PDD | new at random every packet, but shared by every path in that packet | align each packet to the room's static fingerprint; this keeps the *rate* of path change, not absolute delay or angle |

**Physically impossible with what he owns, whatever the model:**
- the body's range by time of flight (15 m blur, and one 50 ns sample of PDD jitter is 15 m of path);
- angle of arrival with one antenna;
- adding phases from different links, because each transmitter has its own clock (only rates and energies combine);
- detail finer than about λ/2 = 6 cm.

**Possible:**
- which link's strip is occupied;
- line-of-sight shadowing;
- breathing, on links whose geometry suits it;
- speed of motion: an amplitude ripple at f Hz means the bounced path changes by f × λ per second;
- signed Doppler, but only if the static part of the channel is stable. Our empty-room phase flicker (0.34-0.40 rad) says it may not be.

### 4. A still person is nearly invisible

Motion detection works on change. A person sitting still or asleep changes the channel only through breathing (3-5 mm of chest) and through a steady shadow. On one link, with the fan running, "desk still" and "away" were not separable (AUC 0.46). So "he is still in the room" has to come from **memory**: he came in, and nothing saw him leave. This is object permanence, not perception.

A related bug is in our own code. fusion.py relaxes presence toward 0.5 at 0.999 per second, which keeps 0.999^600 ≈ 55 % of a belief after 10 minutes. Over a night, a sleeping Aman fades away.

### 5. Why learned models drop across days

Within one session, the room's multipath fingerprint is stable, so a classifier learns "this fingerprint means bed". The next day the fingerprint has moved (doors, a chair, humidity, router AGC, the fan), and the classifier is reading a slightly different room. Brunello et al. measured the same thing on ESP32 over three weeks: positioning degrades over time even with no physical change in the room.

Two things fight this:
- **labels from many different days**, so the model learns what stays the same;
- **features with physical meaning** (a shadow on a known line, a speed) instead of raw fingerprints.

### 6. The clean ways around the clock wall

- **Two-way timing (Wi-Fi RTT / FTM):** a round trip measures both directions with each device's own clock, so the offsets cancel. It locates the *phone*, not the body.
- **Sonar:** the speaker and the microphone share one sample clock, so the CFO/PDD problem does not exist.
- **Phase-coherent arrays (ESPARGOS):** every chip shares one 40 MHz reference plus a phase reference signal, which gives angle. This is a PCB project or about EUR 350, outside the budget.

### 7. So what does "always knows where he is" honestly mean?

Three things together:
1. a **calibrated zone belief** ("desk 0.9", or "desk or bed");
2. **object permanence** between events;
3. **abstaining** when unsure.

It does not mean a continuous x/y dot. Most of the near-term gain will come from evidence that is not CSI (laptop input, phone state, voice, how long he usually stays somewhere) and from labels collected on different days. New physics comes later and one board at a time.

## His ideas, checked against physics and our data

| His idea | Verdict |
|---|---|
| 2D "change picture" for an AI to read | Yes, in two forms: a **speed picture** (what is happening) and, once more links exist, a **floor-zone posterior** (where). One image cannot do both jobs: our chart test showed change energy tracks time and activity, not place. |
| Predictive network that predicts the next change | It tied with linear because the input is a filtered, nearly linear (AR) signal, and MSE rewards modelling noise. Parked until at least 4 labelled days exist (see "What we will not do"). |
| Phones as extra antennas, with synchronised or modelled clocks | Rates and energies combine across links; phases do not. A phone is most useful as a **teacher and identity token**, not as a coherent antenna. |
| Teacher and student on the same device | Yes. This is the strongest idea; four lenses proposed it independently. His own devices are the teacher. |
| Perception need not look like human vision; "this thing is this thing" | Yes: a typed belief (place distribution, events, mover type, identity from his phone) instead of a picture. |
| 2D and 3D predictive images | A 2D zone posterior is possible. A 3D image is not, with one 20 MHz single-antenna link. |

## Ranked shortlist (ideas the review did not kill)

Each entry gives how it works, what to build, the test in his room and the success number. Rs 0 means software and things he already owns.

### 1. Free teachers: daily labels from his own devices, checked against random one-tap prompts (Rs 0)

Merges B3, C2, D3, E3 and C3.

**How it works.** Several signals already know the truth for part of the day, without any camera:

| Teacher signal | Label it gives | Confidence |
|---|---|---|
| Keyboard/mouse input in the last 30 s (Windows `GetLastInputInfo`; timing only, never content) | at the laptop, hands active | high |
| His phone gone from the LAN for 10+ min, laptop idle | away, room empty | high |
| Night, laptop idle, phone charging with screen off | bed | medium |
| Voice command heard by the laptop mic | awake, near the laptop | weak for place |
| JARVIS relay or fan command | near the switch | medium |
| A spoken check ("Quick check: are you on the bed?") | the zone he says | high |

Each source is a labelling function that either gives a label or abstains. A Snorkel-style label model learns how accurate each source is from where they agree and disagree. An HSMM forward-backward smoother (idea 2) then carries labels into the still gaps between anchors, and only keeps them where the posterior is at least 0.9. The student is the existing CSI classifier, retrained every night on a rolling 14 days.

**Ground truth that the teacher cannot fool.** About 12 random one-tap phone prompts a day: "where are you? desk / bed / room / other room / out". Random timing makes them unbiased. Scoring uses only these answers, never anchor labels; scoring on anchor labels would be circular.

**What to build.**
- `aankhen/teacher.py` (one module, not four): the collector, the labelling functions, the label model, and soft labels aligned to learn.py windows, written to `data/` (git-ignored).
- The prompt: a Home Assistant companion actionable notification first, a tiny app later.
- A nightly leave-one-day-out retrain, which promotes a new model only if it beats the current one on the last 3 held-out days.
- A coverage report: labelled minutes per zone per day, so thin classes (still at desk, floor, fan-on empty) are visible.

**Test in his room.** Run 3 days passively, then audit 30 random "desk" and "away" labels against spot checks. Train on days 1-2 and test on day 3 against prompt answers plus one 10-minute A-B-A-B block. Then keep running to 7 and 14 days and plot zone accuracy against days of labels.

**Success number.**
- Anchor-label precision of at least 95 % (a source below that is dropped).
- Prompt response rate of at least 70 %.
- Cross-day zone above 73 % after 3 days, and at least 80 % by day 14 (today 56-73 %).
- Cross-day in-room at least 90 % (today ~80 %).

**Caveats.**
- Labels pile up on typing, sleep and away. "Still at desk reading" stays thin, so report per-zone accuracy.
- If the laptop goes to the bed, the label must be "at laptop", not "desk".
- Labels cannot add physics. If zone does not move after 7 days, the information is not in one link, and that is a decisive answer.
- The IMFi "85 % in an unseen environment" figure one lens cited is binary gait identification, and the link given was a survey. Do not quote it as support.

### 2. One belief for the whole house: semi-Markov filter, calibrated sets, and a speech contract (Rs 0)

Merges C1, B5, E1, C3 and C5, plus the object-permanence part of E2.

**How it works.**
- **State:** away, other rooms, and in his room {desk, bed, floor, door}, crossed with how long he has been there (log bins: <30 s, 30 s-2 min, 2-10 min, 10-60 min, 1-3 h, >3 h). That is about 72 cells.
- **Predict:** every 0.5 s, move belief along the house graph using a duration hazard h_s(d), the chance of leaving state s after staying d. The hazards are fitted from his own labelled dwell times. A hazard learned from his nights keeps P(bed) high for hours with no CSI evidence, replacing the 0.999/s fade.
- **Update:** log b(s) += Σ w_k · log L_k(z_k | s) for each evidence source k. Each weight w_k ≤ 1 discounts sources that are over-confident or correlated with each other. The CSI classifier gets a small weight, because it is 56-73 % across days. A source that is offline is left out; silence never counts as "nothing happened".
- **Calibrate:** temperature-scale the output so that "0.8" means right 80 % of the time. Measure it with ECE.
- **Honest sets:** build an APS prediction set and adjust its level with **adaptive conformal inference** after each prompt answer: α_{t+1} = α_t + γ(α − err_t), with α = 0.1 and γ ≈ 0.02. This holds 90 % coverage over the long run even when days drift; split conformal does not, because it assumes exchangeability.
- **Speech contract:** JARVIS reads only the belief snapshot, through a phrase table:
  - p ≥ 0.95 and one zone in the set: a plain statement that names its evidence ("You're at your desk; keyboard 8 s ago").
  - 0.75-0.95: "probably".
  - Two zones in the set: "desk or bed, can't tell which".
  - Otherwise: "last sure at the desk 14 min ago".

  A validator blocks distances, postures, and identities not backed by a token. Activity words stay banned until some activity class reaches 0.9 cross-day precision; today none does.

**What to build.**
- `aankhen/belief.py`: HouseBelief (predict, update, snapshot), adapters for each source (learn.py proba, LinkBank HBE, the idle poller, presence.py, HA companion sensors), temperature fitting, and ACI state saved in `data/`.
- A replay harness that runs a day of `.akr` plus the event log offline.
- `core/whereabouts.py`: phrase table, validator, and a `where_is` tool.
- Run it beside PresenceFusion until it wins.

**Test in his room.**
- Replay one recorded night through PresenceFusion and through the HSMM.
- Then seven ordinary days: fit hazards and weights on days 1-4, test on days 5-7 against prompt answers.
- Ablations remove one source at a time, to show what CSI itself contributes.
- A 50-prompt red-team suite ("how far am I from the door?", "am I lying down?").

**Success number.**
- No false "empty" minutes at 03:00 on a sleeping night.
- "Bed" released within 10 minutes of a phone-gone event.
- Held-out days: home/away at least 98 %; his room vs elsewhere at least 92 %; zone top-1 at least 80 %.
- ECE at most 0.05.
- 90 % sets cover 87-93 % per day, with mean set size at most 1.4.
- Zero red-team utterances with distances, postures or unbacked identities.
- "Plain" statements correct at least 95 % of the time.

**Expect** the ablation to show CSI adds little for still states. That is consistent with what we measured, not a failure of the filter.

### 3. One extra ESP32 as a Fresnel tripwire across the bed (Rs 250-900 for one board)

From A1 and D1. Buy one board, not a mesh.

**How it works.** A second transmitter at mattress height, placed so its link runs across or along the bed, turns "something changed on an ellipse" into "something is in this 0.7 m strip".
- A body lying across the line of sight shadows it **continuously**, so a still sleeper becomes visible.
- Breathing shows as a 0.2-0.4 Hz line on the bed link and not on the router link. That places a still person, which one link cannot do.

Fusion keeps each link as its own detector, with a per-link likelihood over zones, and does **not** concatenate links into one model. The 12-day ESP32 study (arXiv 2602.10823) found its 72-link mesh worse (AUC 0.489) than its single best link (0.541), and placement mattered 2.7 times more than the classifier. Note how low 0.541 is: well placed is not the same as good.

**Corrections from the review.**
- The fan is **not** weakly coupled just because it sits around the 27th Fresnel zone. The zone index sets the reflection's phase, not its strength. Metal blades directly above the bed will couple strongly into a bed link, so the fan must be masked and tested with the fan on.
- Fixed TX power does not make absolute amplitude trustworthy: the receiver's AGC still moves, and that is the gain problem that broke stillness. Log the rx_ctrl gain readback with every frame.

**What to build.**
- About 50 lines of firmware: an ESP-NOW (or esp-csi `csi_send`) broadcaster at 100-200 Hz on ch 11 with a fixed MAC. Board A accepts it as a CSI_LINK frame with its own link id; the 0x08 frame and LinkBank are already per link.
- Per-link host features: HBE, breathing SNR, and shadow depth (dB below that link's empty baseline). Shadow depth comes from a separate stream; stillness stays on the per-packet-median path.
- Before buying, extend physics.py and room.json to search candidate positions.

**Test in his room.** On 2 different days, record 5 min empty and 5 min lying still across the link, with the fan off and then on. Measure link 1's packet rate before and after the new board runs.

**Success number (gate).**
- The still-body shadow (median dB drop) must be larger than the empty-to-empty difference between the two days.
- Link 1's rate must drop by less than 20 %.
- Gain steps in the readback must be smaller than the body shadow.

If it passes, the full target: cross-day zone at least 85 %, a still person in bed recognised in at least 80 % of 30 s windows on held-out days, and each further link adding at least 5 held-out points or being removed.

### 4. Sonar at the bed (and maybe the desk) for real range and breathing (Rs 0, if the speaker reaches 20 kHz)

From D2, plus the laptop-sonar teacher from E3.

**How it works.** The device sends an inaudible chirp from 18.5-22 kHz (B ≈ 4 kHz) and listens for its echo with its own microphone, on the same clock. Range resolution is c/2B ≈ 4.3 cm. At 20 kHz, λ ≈ 1.7 cm, so a 4 mm chest movement turns the echo phase by about 4π × 0.004 / 0.0172 ≈ 2.9 rad. Breathing becomes a large signal.

Processing steps:
1. Dechirp by correlating with the sent chirp. The direct speaker-to-mic leakage is the zero-range reference.
2. Subtract the static background so only moving or breathing range bins remain.
3. Kalman-track the strongest moving bin.
4. Unwrap that bin's phase and band-pass it at 0.1-0.5 Hz for breathing.

Precedents (none on a laptop or a phone at a nightstand):
- EchoSpot, one speaker and one mic at 18-23 kHz: 4.1 cm mean 2D error at 1 m and 9.2 cm at 2 m. That was on smart speakers.
- ApneaApp tracked breathing from a phone on a bedside table.
- Tarzia et al.: laptop sonar detected a user in front of the laptop almost perfectly after about 10 s (20 users).

**What to build.**
- `aankhen/sonar.py`: numpy plus sounddevice in WASAPI raw mode. High-pass at 17 kHz before anything is kept; never write raw audio to disk.
- Output at 10 Hz: range, range uncertainty, breathing rate, motion level. It enters the belief filter as one more source and is also a teacher for the "bed" and "at laptop" labels.
- An Android version on the Nord 5 at the nightstand, run only while charging.

**Test in his room.**
- 30 min: play the chirp from the laptop and record it with its own mic at 0.3 m.
- Then lie 1 m from the device with the fan **on**, pacing breathing to a metronome at 10, 15 and 20 per minute, 3 × 5 min, on 3 days.
- Ask everyone at home whether they hear it.

**Success number.**
- Gate: the 20 kHz level within 30 dB of 1 kHz.
- Breathing within ±1 per minute of the metronome in at least 60 % of 60 s windows with the fan on (at least 80 % with it off).
- Range median error at most 10 cm up to 2.5 m.
- Nobody hears it.

**Caveats.**
- The fan's blades are a strong moving reflector about 2 m from a nightstand phone, so range-gating it out is mandatory.
- Windows enhancements and echo cancellation can strip the band.
- Pets hear up to 45-64 kHz, so do not run it continuously if there is a pet.
- An always-on microphone needs a visible on/off indicator in JARVIS.

### 5. Offline ESPARGOS study: is phase coherence worth it? (Rs 0, 1-2 days of CPU)

From A5, which also tests A2's grid localiser at no cost.

**How it works.** The public dataset espargos-0007 (DaRUS, CC BY 4.0) has people walking among four phase-synchronous arrays, with position tags, at 2.472 GHz and 16.56 MHz. Its random-walk and meander files are small (80-437 MB). Compare three pipelines on the same grid:
- (a) one antenna per array, with a per-packet phase and delay scramble drawn from **our** measured flicker (0.07-0.40 rad) plus whole-sample delay jitter: this is the ESP32 reality;
- (b) two coherent antennas per array, using CSI ratio plus bearing;
- (c) the full array.

**Success number (decision rule).**
- If (b) beats (a) by less than 0.2 m median error, close the coherence road for good.
- If it wins by at least 0.5 m or 15 zone points, coherence goes on a future budget list. It stays out of the current budget: an ESPARGOS One is about EUR 350.
- If (a) with at most 4 links is worse than 1.5 m median, drop pixel localisation and keep only zones.

**Caveat.** It is a ceiling estimate: the arrays sit together in one corner, the transmitters are on the ceiling, and most of the data is a robot.

### 6. Same-day anchors with a prototype head (Rs 0)

From B4, without TENT.

**How it works.** Within a session, zone is 87.8 %. If a few labelled seconds from the same day re-anchor the model, much of the cross-day gap may close. KNN-MMD is directly relevant: its datasets are ESP32-S3, one antenna, router as transmitter, and its one-shot cross-domain results were 75-93 %. Keep one mean feature vector per zone, refreshed from today's high-confidence teacher windows (idea 1) or a 60 s morning ritual.

**Test in his room.** Record 20 s each at the desk, on the bed and away at 09:00, then an A-B-A-B block at 21:00. Use nearest-prototype on FEATURES, with no network.

**Success number.** Evening zone accuracy of at least 80 % from morning anchors. Below that, same-day anchors do not survive hours of drift and the idea dies.

Report it honestly as "about X % per day with daily anchors", not as generalisation. TENT is dropped: it is fragile on 8-hour single-class stretches such as sleep.

### 7. The speed picture for activity (Rs 0)

The speed half of B2. The place picture is a separate, riskier test, listed under event-first matching.

**How it works.**
1. Take 100 Hz conditioned amplitude, notch the fan lines (fan.py), and remove the per-subcarrier mean.
2. Run PCA across the 51 subcarriers, drop PC1 (common AGC and drift), and keep PCs 2-6.
3. STFT with a 1.28 s window and 0.1 s hop, 0-12 Hz.
4. Sum the power over the PCs and normalise by the empty-room floor.

A ripple at f Hz is a path speed of f × λ, so the image is path speed against time. That is the physics version of his "change picture", and CARM-style features like it transfer across days better than fingerprints.

**Test in his room.** Score activity (still / typing / waving / walking) leave-one-session-out on existing sessions against FEATURES+HGB.

**Success number.** At least 10 points above 47 % (the top of today's cross-day range), or the idea is dropped. It cannot separate "still at desk" from "away": a still person has no speed. Typing should come from the keyboard teacher, not from Wi-Fi.

### 8. Mover typing: human, fan, curtain or unknown (Rs 0)

From E4.

**How it works.** Average the amplitude's time autocorrelation over the subcarriers at the raw 250-500 Hz, resampled carefully to a uniform grid.
- A walking human decorrelates like J0(k·v·τ) and does not recur. Its first zero is at τ0 = 2.405 / (k·v), about 47 ms at 1 m/s (k = 2π/λ = 51.6 rad/m).
- The fan is rigid and periodic: the autocorrelation returns near 1 at the rotation period and has stable spectral lines.
- A curtain is slow, under about 0.2 m/s.

Wi-MoID reported 97.3 % human vs non-human accuracy (fans included) and 96 % in unseen buildings. Expect lower with one antenna.

**Test in his room.** On 2 days, record 2 min each of fan only (low and high) and of walking with the fan on.

**Success number.** Leave-one-day-out AUC at least 0.85 (kill below), with a target of 0.95 and at most 1 false "person moving" per hour in an empty room with the fan on. It classifies **movers only**; still people stay with ideas 2-4.

### 9. Event-first perception with within-day matching (Rs 0)

From E2.

**How it works.**
1. Bayesian online change-point detection on HBE and on the static amplitude shape splits the day into events and quiet segments.
2. Each still segment is matched to **today's** earlier segments and anchors, never to another day's model. Within a session the static shape does carry place (halves-to-steps ratio 0.35; transductive kNN 0.56-0.58), while across sessions it did not (0.10-0.41).
3. Occupancy holds from an "entered" event until a "left" event: a motion burst followed by a static shape that matches today's empty fingerprint.

**Test in his room.** Two empty captures 3 h apart, with 5 min desk-still and 5 min bed-still in between.

**Success number (gate).** The empty-to-empty static distance must be clearly smaller than empty-to-desk-still. If it is not, within-day matching and the "left" test both fail.

The full target is enter/leave event F1 of at least 0.85, and no false "empty" during a 20-minute still desk session. The weak link is "left": hallway motion moves the router link more than motion inside the room, so people walking past in the hallway will create false exits.

### 10. Phone RTT as a carried teacher (gated on one 5-minute check)

From A4. C6 is folded in here.

**How it works.** The phone ranges to ESP32-S3 FTM responders placed **at** zones (bed head, desk). The label is "nearest responder within r", not trilateration, which survives 1-2 m errors when zones are about 2 m apart. The phone's motion sensors gate "carried vs lying on the desk".

HopFTM measured ESP32-S3 to ESP32-S3: 1.2 m median on one channel, 0.3 m with 4-channel hopping, but 10-15 m worst cases. Our nodes cannot hop off ch 11, and a phone was not tested.

**Test.** First run `adb shell pm list features | grep -i rtt` on the Nord 5. If it shows `android.hardware.wifi.rtt`, flash one S3 as a SoftAP FTM responder, then range with Google's WifiRttScan at 1, 2 and 3 m for 60 s each.

**Success number.** At least 80 % of ranging attempts succeed, and the bias-corrected median error is at most 1 m. Otherwise drop it.

**Conflict to resolve.** A carried Nord 5 cannot also be link 2's fixed transmitter. Choose one role (see open questions).

### 11. Honest twin and a measured coverage map (Rs 0)

From E5.

**How it works.**
- Shade each room.json zone by P(place), using a value-suppressing palette that fades to grey as uncertainty grows.
- Fade the glow with time since the last evidence, and switch the label from "seen 3 s ago" to "assumed: no exit seen since 21:40".
- Add a measured coverage map: a 30 s walk per zone plus 60 s empty gives each link's walking-vs-empty AUC per zone. That shows where JARVIS is blind, and whether link 2 or a new board adds coverage.

**Success number.**
- The coverage map flags every zone with AUC below 0.7, with at most 1 false flag.
- Displayed-confidence ECE at most 0.05.
- Until idea 2's calibration exists, the twin must say "uncalibrated".

### 12. House-level room from BLE (later, about Rs 300-400 per scanner)

From D4.

**How it works.** The HA companion app beacons the phone about once a second. One **dedicated** ESP32 scanner per room reads its RSSI. Never scan BLE on a CSI board: the shared radio would steal CSI capture time, which D4 itself warned about and then contradicted. BLE is room-level at best (3.7-6.7 m 90th-percentile error in a body-present study) and never says where in a room.

**Test.** One scanner in one other room. Carry the phone through each room for 2 min, on 2 days.

**Success number.** Room accuracy of at least 85 % leave-one-day-out, or BLE adds nothing beyond the LAN presence that already exists.

## Experiment ladder

Every step has a go/no-go number. No money is spent until a step that needs it has passed.

### Step 1: this week, Rs 0, hardware he already has

| # | Test | Time | Go if | If no-go |
|---|---|---|---|---|
| 1a | `adb shell pm list features \| grep -i rtt` on the Nord 5 | 5 min | `android.hardware.wifi.rtt` is listed | delete RTT ideas (10) |
| 1b | Laptop speaker: 18.5-22 kHz chirp recorded by its own mic at 0.3 m, raw mode | 30 min | 20 kHz within 30 dB of 1 kHz | retry on the Nord 5; if both fail, sonar needs a Rs 500-1,500 USB card and tweeter |
| 1c | Risk-coverage curve and ECE on existing cross-session zone predictions | hours | some threshold gives ≥ 90 % accuracy at ≥ 40 % coverage | JARVIS must abstain on zone most of the time until new evidence arrives (still a useful finding) |
| 1d | Two empty captures 3 h apart, with desk-still and bed-still in between | 1 evening | empty-to-empty static distance clearly below empty-to-desk-still | drop within-day matching (idea 9) |
| 1e | Morning anchors (20 s desk, bed, away at 09:00), A-B-A-B at 21:00, nearest-prototype | 2 short recordings | evening zone ≥ 80 % | drop daily anchors (idea 6) |
| 1f | Rotate the existing board 90° and 180° on one day; bed-breathing SNR and hallway false-occupancy at each angle | 1 evening | either changes by ≥ 3 dB or 30 % | confirms there is no reason to buy a directional antenna |
| 1g | Fan-only vs walking-with-fan autocorrelation features | 2 days × 10 min | leave-one-day-out AUC ≥ 0.85 | drop mover typing (idea 8) |

### Step 2: weeks 1-2, Rs 0, the shared backbone

- Build `aankhen/teacher.py` (idea 1) and the random prompts.
- Run for 3 days.
- **Go if:** anchor precision is at least 95 %, he answers at least 70 % of prompts, and train-on-days-1-2 / test-on-day-3 zone is above 73 %.
- **If no-go:** fix the rules or reduce the prompt rate before building on top.

### Step 3: in parallel, Rs 0, belief and honesty

- Build `belief.py` (HSMM, ACI sets) and the speech contract (idea 2). Replay one night and one away day.
- **Go if:** zero false-empty minutes on the sleeping night, "bed" released within 10 min of phone-gone, and 90 % sets within 87-93 % coverage over the first 5 prompt days.
- Write the 50-prompt red-team suite first, against today's JARVIS. If today's JARVIS already says nothing false, the validator is low value.

### Step 4: in parallel, Rs 0, offline ESPARGOS study (idea 5)

- **Decision:** a coherence gain under 0.2 m closes the road for good.
- A 1-antenna scrambled median error above 1.5 m kills pixel localisation.

### Step 5: day 7, the program-level kill rule

- If 7 days of weak labels plus the belief filter lift cross-day zone **above 73 %** on prompt truth, keep tuning the backbone and add the speed picture (idea 7).
- If not, the information is not in one link. The money goes to step 6 or step 7, not to more models.

### Step 6: Rs 250-900, buy exactly one board (idea 3)

- **Go if:** the still-body shadow is larger than the day-to-day empty difference, link 1's rate drops by less than 20 %, and gain steps are smaller than the shadow (fan on and off, 2 days).
- **Only then** consider a second node. Each node must add at least 5 held-out zone points, or it comes out.

### Step 7: Rs 0 (or about Rs 500-1,500), sonar at the bed, only if 1b passed

- **Go if:** breathing is within ±1 per minute of a metronome in at least 60 % of 60 s windows with the fan on, and nobody hears it.

### Step 8: RTT teacher, only if 1a passed

- **Go if:** at least 80 % of ranging attempts succeed and the bias-corrected median error is at most 1 m.

### Step 9: later, about Rs 300-400 per room, a BLE scanner per room

- Only if house-level room presence is wanted beyond LAN home/away.
- **Go if:** room accuracy is at least 85 % leave-one-day-out.

## What we will not do, and why

- **Cameras, webcams, the LD2450 radar:** excluded by the owner. No idea here needs them.
- **Pixel imaging from 3-4 links (A2):** ghosts along whole ellipses. The published VRTI used 34 nodes. The posterior is kept only as the *output format* for zones, and step 4 tests it offline for free.
- **Signed Doppler on one antenna as a tracker (A3):** Widar's 25-38 cm took Intel 5300 cards with 3 antennas sharing a clock. Our empty-room flicker (0.34-0.40 rad, 27 % of subcarrier steps above 1 rad) breaks the "stable static template" it needs, and Doppler is zero for a still person. The only thing allowed is a half-day falsifier: residual phase variance in an empty room must sit at least 10 dB below walking, and the sign must be right in at least 75 % of 1 s windows on radial walks. Nothing is built unless both pass.
- **JEPA/MAE pretraining now (B1):** our own runs on 9, 17 and 30 minutes of data showed no slope, and the probes need labelled days that do not exist yet. Parked until at least 4 weak-labelled days exist. Then one MAE night against FEATURES+HGB; drop it unless it gains at least 5 zone points with a CI that excludes 0.
- **Using the next-change predictor as a "surprise" gate:** it never beat linear. Use the plain likelihood under the believed state instead.
- **Directional or external antenna (D5):** the router is on the hallway side, so a pattern that rejects the hallway also weakens the link being sensed. The limit is drift, not SNR. Step 1f (rotation) answers it for free.
- **Phone RTT as a separate filter term (C6):** folded into idea 10's gate.
- **The place picture as a cross-day feature (B2 place half):** cross-day static kNN was near chance (0.11-0.39). It survives only as within-day matching (idea 9).
- **A speed picture to separate "still at desk" from "away":** physically impossible, because a still person has no path speed.
- **TENT test-time adaptation:** fragile on long single-class stretches. Dropped.
- **BLE scanning on CSI boards:** coexistence steals CSI airtime. Use dedicated scanners.
- **A clock-sharing DIY PCB for two ESP32-S3s:** a separate hardware project with mixed forum reports. Only revisit if step 4 says coherence pays.
- **Tracking other people in the house (C4):** the maths is sound (an exact joint filter over about 1,000 states, identity from phone tokens, noisy-OR CSI). But it tracks people who have not agreed to it. Not built unless each person gives explicit consent. Even then: in memory only, never logged, and "someone" rather than a guess when there is no token.
- **Gait identification from one link:** 80-94 % for 2-9 people in labs, on multi-antenna NICs. Not credible on one link with a fan. Identity comes from tokens (his phone, his laptop input, his voice).
- **BLE Channel Sounding:** needs Pixel 10-class phones and nRF54L15 boards. Skip for now.

## Contradictions with our own results (flagged)

- fusion.py's 0.999/s relaxation, confirmed in code, keeps about 55 % of a belief after 10 minutes. That is incompatible with "always knows" for a sleeper. Idea 2's hazard replaces it.
- The "fan is weakly coupled at the 27th Fresnel zone" argument confuses the phase-zone index with scattered amplitude. The fan is right above the bed link.
- Shadow depth needs absolute amplitude, but gain compensation broke stillness and `AK_GAIN_CTRL` is compiled out. Keep two streams, and log the gain readback.
- The Nord 5 cannot be the fixed link-2 transmitter and also a carried teacher or RTT initiator.
- No source confirms Wi-Fi RTT on the Nord 5. An ESP32-S2 forum thread reports an Android phone that saw the responder but got no RTT results.
- CARM's "~80 % in untrained places" could not be confirmed. LoSRef's hardware and antenna count are unstated. The CSI-JEPA, CrossFi, IMFi and DATE 2026 numbers were read from abstracts or snippets only.

## Open questions for Aman

1. **Phone role.** Should the Nord 5 stay a fixed link-2 transmitter, or become the carried teacher (RTT, motion sensors, prompts)? It cannot be both. Is there another phone that could be the fixed one?
2. **Prompts.** Will you answer about 12 one-tap "where are you?" prompts a day for 1-3 weeks? They are the only unbiased ground truth, and everything is scored on them.
3. **Sonar.** Are there pets at home, and are you comfortable with a microphone that is always on (high-passed above 17 kHz, nothing stored, a visible on/off switch in JARVIS)?
4. **Room layout.** Where is the router relative to the bed and the desk? How far apart are the bed and desk (tripwires need about 2 m)? Is there a socket at mattress height for a second board?
5. **Other people.** Should JARVIS ever reason about anyone else at home? If yes, only with their explicit consent and with nothing logged.

## What this changes

- The goal is redefined from "a position" to **a calibrated zone belief plus object permanence plus abstention**. JARVIS speaks only from that belief.
- The next work is software at Rs 0: the teacher (`teacher.py`), the belief filter (`belief.py`), and the speech contract.
- Hardware is bought one board at a time, each behind a measured gate.
- The world model is parked, not deleted, until labelled days exist.

## Sources

### Wi-Fi sensing physics, geometry and multi-link
- 12-day ESP32 mesh study (72 links, AUC 0.541 vs 0.489): https://arxiv.org/abs/2602.10823
- VRTI, variance-based radio tomographic imaging (34 nodes): https://arxiv.org/abs/0909.5417 and https://arxiv.org/pdf/1110.1569
- RTI review: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6386865/
- Fresnel-zone theories for contactless sensing: https://research.buaa.edu.cn/zh/publications/fresnel-zone-based-theories-for-contactless-sensing/
- ESP32 multi-node ESP-NOW CSI thesis: https://dl.ucsc.cmb.ac.lk/jspui/handle/123456789/4933
- ESP32 multi-receiver CSI localisation: https://ideas.repec.org/a/gam/jftint/v17y2025i9p395-d1737965.html
- LiFS, model-based device-free localisation: https://collaborate.princeton.edu/en/publications/low-human-effort-device-free-localization-with-fine-grained-subca/
- Espressif esp-csi: https://github.com/espressif/esp-csi
- Widar (Intel 5300, 3 antennas): https://ct.cswu.me/papers/MobiHoc17_widar_paper.pdf
- Widar3.0: https://ct.cswu.me/papers/mobisys19_widar3_paper.pdf
- LoSRef: https://arxiv.org/abs/2602.05344
- FarSense, CSI ratio: https://arxiv.org/pdf/1907.03994
- CARM, CSI-speed model: https://old.sigmobile.org/mobicom/2015/papers/p65-wangA.pdf
- Brunello et al., "Time matters", ESP32 CSI over 3+ weeks: https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25
- Wi-MoID, human vs non-human motion: https://pure.bit.edu.cn/en/publications/wi-moid-human-and-nonhuman-motion-discrimination-using-wifi-with-
- WiSpeed: https://arxiv.org/abs/1712.00348
- Fresnel zone and activity sensing: https://researchportal.ip-paris.fr/en/publications/towards-a-dynamic-fresnel-zone-model-to-wifi-based-human-activity/

### Phase coherence (ESPARGOS)
- ESPARGOS paper: https://arxiv.org/pdf/2502.09405
- Earlier ESPARGOS work: https://arxiv.org/pdf/2408.16377
- Project site: https://espargos.net
- espargos-0007 dataset (CC BY 4.0): https://darus.uni-stuttgart.de/citation?persistentId=doi:10.18419/DARUS-4973
- Dataverse: https://darus.uni-stuttgart.de/dataverse/espargos
- ESP32-S3 external-crystal forum reports: https://esp32.com/viewtopic.php?p=153564

### Wi-Fi RTT / FTM and BLE
- Android WifiRttManager: https://developer.android.com/reference/android/net/wifi/rtt/WifiRttManager
- HopFTM, ESP32-S3 (Rösler et al. 2025): https://www.tkn.tu-berlin.de/bib/roesler2025improving/roesler2025improving.pdf
- FTM survey: https://arxiv.org/pdf/2509.03901
- FTM pitfalls (MIT): https://people.csail.mit.edu/bkph/ftmrtt_issues
- ESP32 FTM issues: https://github.com/espressif/esp-idf/issues/6810 and https://esp32.com/viewtopic.php?p=149300
- WifiRttScan app: https://9to5google.com/2019/04/14/google-releases-wifirttscan-app/
- BLE indoor accuracy with bodies present: https://pmc.ncbi.nlm.nih.gov/articles/PMC9227766
- ESP32 Wi-Fi/BLE coexistence: https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/coexist.html
- Bermuda: https://github.com/agittins/bermuda/wiki
- ESPresense: https://espresense.com/

### Acoustic sensing
- ApneaApp: https://homes.cs.washington.edu/~gshyam/Papers/apneaapp.pdf
- EchoSpot: https://par.nsf.gov/biblio/10338349
- FingerIO: https://fingerio.cs.washington.edu/
- LLAP: https://github.com/Samsonsjarkal/LLAP
- LoEar: https://research.buaa.edu.cn/en/publications/loear-push-the-range-limit-of-acoustic-sensing-for-vital-sign-mon/
- CovertBand: https://musicattacks.cs.washington.edu/activity-information-leakage.pdf
- Tarzia et al., laptop sonar presence: https://users.cs.northwestern.edu/~pdinda/Papers/ubicomp09.pdf

### Learning, labels and adaptation
- DLinear ("are transformers effective for forecasting"): https://arxiv.org/pdf/2205.13504
- Snorkel: https://arxiv.org/pdf/1711.10160
- KNN-MMD (ESP32-S3, one antenna): https://arxiv.org/html/2412.04783v1
- AutoFi: https://arxiv.org/pdf/2205.01629
- Survey cited as IMFi (not IMFi): https://arxiv.org/pdf/2403.15444
- DATE 2026 soft labels (snippet only): https://past.date-conference.com/proceedings-archive/2026/DATA/595.pdf
- Windows GetLastInputInfo: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
- Home Assistant companion sensors: https://companion.home-assistant.io/docs/core/sensors/

### Belief tracking, calibration and honest output
- Guo et al., calibration: https://arxiv.org/abs/1706.04599
- Adaptive conformal inference (Gibbs and Candès): https://arxiv.org/abs/2106.00170v3
- APS (Romano, Sesia and Candès): https://arxiv.org/abs/2006.02544
- Conformal tutorial (Angelopoulos and Bates): https://arxiv.org/abs/2107.07511
- Selective prediction (Geifman and El-Yaniv): https://arxiv.org/abs/1705.08500
- Bayesian online change-point detection: https://arxiv.org/abs/0710.3742
- HSMMs in smart homes (van Kasteren): https://www.dare.uva.nl/id/f6c70817-c5ad-4351-9d1d-9ab5bd39d6b2
- Probabilistic Robotics: https://cs.pomona.edu/~ajc/other/Thrun%20et%20al_2005_Probabilistic%20robotics.pdf
- Value-suppressing uncertainty palettes: https://www.tableau.com/research/publications/value-suppressing-uncertainty-palettes
- Matter Occupancy Sensing cluster: https://www.matteralpha.com/cluster/occupancy-sensing
- IEEE 802.11bf-2025: https://people.freebsd.org/~adrian/net80211/80211bf-2025.pdf
- IPCC uncertainty language: https://sites.pitt.edu/~jdnorton/teaching/2682_confirmation/2017/slides/IPCC2014%20Uncertainty%20Fragment.pdf

### Local files this builds on
- [2026-10-13-wifi-sensing-limits-and-routes.md](2026-10-13-wifi-sensing-limits-and-routes.md)
- [2026-10-13-csi-phase-vs-amplitude.md](2026-10-13-csi-phase-vs-amplitude.md)
- [2026-10-13-world-model-and-channel-charting.md](2026-10-13-world-model-and-channel-charting.md)
- [2026-10-13-phone-second-link.md](2026-10-13-phone-second-link.md)
- [2026-10-13-audit-phone-link.md](2026-10-13-audit-phone-link.md)
- `aankhen/` modules: fusion.py, learn.py, links.py, rf.py, physics.py, eyes.py, engine.py

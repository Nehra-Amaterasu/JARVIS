# Aankhen: running research log

Newest first. One section per question; older dated notes (`2026-10-*-aankhen-*.md`) stay as they were.

## 2026-10-27: training only on labelled time, and why the model kept saying "bed"

**Question.** Live, three walks to the bookshelf gave one "bookshelf" and two "bed". Why, and what training fixes it?

**Found.** The catalogue of every labelled second ever recorded: the bookshelf had **0 s**. The commonest place had 6,619 s (one night asleep), the next 1,536 s; the smallest places 5–77 s. No model had been taught the place it was asked about, and the sleep stretch dominated everything.

**Built.**
- A labelled-only, balanced training set: only labelled spans, trimmed 1 s at each edge, capped at 30 s per place per day, spread over different stays; unlabelled time is never trained on. 509 windows, 6 classes, 34 stays, 70 s cold / 7.6 s with the cache.
- One training job for the CLI and the app, with the evaluator-v2 rules: per-place recall, recall on the less-common stays reported apart, the majority baseline and a time-of-day prior-alone baseline, a flag when a session had to borrow an empty-room reference (4 of 8 did).
- The model's word is "predicting" until there are at least 4 labelled days and a leave-one-day-out lower bound above the majority baseline; only then "answering".
- The live CNN runs in numpy (0.5 ms per window, within 2e-6 of torch), so the running app never imports torch (about 0.5 GB of RAM saved).
- The rolling 7-day store now keeps the signal level, RSSI and gain per row in hourly files with a hash, so future hours can test the session-shift finding.
- In the app: tap-to-label mini drills from the laptop, phone-recording import, one Train button with a plain report, and ✓ / "No, I'm at…" corrections that become labelled data.

**Measured (3 labelled days).** Leave one session out, 5 places, chance 20 %: CNN 14 % [6–28], kNN 13 %, majority 20 %, time-of-day prior 22 %. Leave one day out, 2 places: CNN 35 %, kNN 42 %, majority 50 %. AdaBN's earlier 30–39 % did not reproduce on the balanced set (15 %, control 19 %). Status: **predicting**.

**What it changed.** Training no longer rewards the place with the most data. The next gain is data, not code: a few minutes per place per day across 4+ days, each session with its own 2 min of empty room, recorded from the app.

## 2026-10-27: a second expert hearing, and its ruling

**Question.** Why does a single-link ESP32 Wi-Fi fingerprint fail on a new session, and what is the cheapest honest way forward?

**What was measured** (one through-wall link, three sessions, one day):
- Across sessions, no method beats always naming the commonest place (kNN 15 %, CNN 11 %, baseline 25 % balanced).
- The session-to-session change is not the overall signal level: that is 3 % of it. It is the shape across subcarriers, mostly one tilt-like component, and it is 2.4× larger than the difference between places.
- One session's channel was about 6 dB weaker, with new multipath, and the receiver's gain bookkeeping checked out. So the radio paths themselves changed, most likely a door, the board's pose, or the hall path.
- Centring each session on its own median fails, because each session is mostly one place. That leaks "the usual place" into the score.
- Re-estimating batch-norm statistics on the new session (AdaBN) is the only lead: 30-39 % against an 18 % shuffled control. Its lower confidence bound is still below the baseline, so it is not a claim.
- Change-point detection finds a third of the transitions, at about 5× the false alarms.
- The live path costs about 0.1 ms per packet.

**Ruling.**
1. Move the transmitter into the room (a spare router as a dedicated transmitter, on a fixed channel and power), so the line of sight dominates the through-wall paths.
2. Keep the signal level in the 7-day store; it was being dropped.
3. Presence first, from band-limited variance against a self-updating empty reference, scored against empty time at matched hours.
4. A few short mixed-place sessions, so adaptation can be tested at all.
5. Zones only after presence passes.

**Large-area idea.** A transmitter at the centre of four corner reflectors senses only four thin strips. In simulation it is no better than guessing the middle at 10-30 m, and passive reflectors add paths 20-40 dB weaker. The established design is radio tomographic imaging: a perimeter mesh of cheap active nodes, every pair a link, taking millisecond turns, no precise clocks needed. It grows rung by rung, starting with a free single-link crossing test, with no spending before each rung passes.

**Owner's load before exams end:** about 75 min, ₹0 (flash 3.6.0, door/fan checks, the spare router as an in-room transmitter). First purchase (two ESP32-C3/C6, about ₹500–900) only after the free crossing test passes.

## 2026-10-26: the council's plan, built, and what it measured

**Question.** Does building the council's plan (honest evaluator, merged bed, calibration, belief rules, speed, link-aware firmware) make Aankhen locate anyone?

**Answer: no, not yet, and now the evaluator says so plainly.**

Leave one session out, 3 sessions, 4 places with 40+ windows and 2+ stays, 7,775 windows, chance 25 %:

| | balanced | 95 % interval (resampling stays) |
|---|---|---|
| kNN | 15 % | 1–34 % |
| CNN | 11 % | 2–18 % |
| always "bed" | 25 % | — |
| shuffled-label control | 5–7 % | 0–29 % |

- **A visit is now a stay**, ended only by another place, never by a silence: the weak link's dead stretches had cut 5 bed stays into 93 "visits", which would have made the interval far too narrow.
- **Merging lying and sitting on the bed did not help.** The council's idea that the session-confounded bed labels caused the low score is not supported.
- **What the confusion shows instead:** each held-out session collapses onto one label (3,384 bed windows mostly called "between bed and balcony door"; 2,754 of 2,766 called "desk"). This points to a per-session common-mode offset. That is a hypothesis to test next, not yet measured.
- **Temperature scaling** (T = 0.84–1.36) cut calibration error on same-session data (7 → 6 % at worst) but not across sessions (about 80 % → 80 %). The model is confidently wrong on a new session, so the UI caps the experimental place at 60 %.
- **Belief rules** (transit zones 3–4 s with constant hazard, dead-link time run as "motion unknown", forgetting towards the prior after 30 s, a small leak), replayed on the real stream: balanced 25.7 → 28.6 %, transitions caught 7 → 9 of 34, false switches 14.9/h either way. After a 10 min dead link the bed is named in 2.0 s instead of 12.5 s (synthetic). The rules cannot create evidence the CNN does not have.
- **Speed** (same output, checked against frozen old code): fan-line removal about 50× (one cached pseudo-inverse), Hampel about 10× (a median-of-7 sorting network), per-window features 2.8× (cleaned once for 5 bands). Day evaluation 2.3×, and its timestamps were 72 ms (median) to 21 s late; now board-clock.
- **Firmware 3.6.0** (compiled, 76 %, not flashed): STATUS reports ping ok/lost, the longest capture gap, PHY rate, reconnects, the disconnect reason and the AP; Wi-Fi reconnects without blocking (1–15 s backoff) and can pin the AP's BSSID; the watchdog covers loop().

**What it changed.** The limits are the link and the session-to-session offset, not the model or the filter. Next: test removing the common mode per session; flash 3.6.0 and measure the link; the in-room AP; more days.

## 2026-10-26: a five-expert review of Aankhen, and its verdict

**Question.** After one day of narrated data (3 sessions), what actually limits Aankhen, and what should be built next? Five independent reviews (deep learning, sequence models and rules, Wi-Fi CSI physics, firmware and link, code quality), then a judge who ruled where they disagreed. The full reports are private notes; the public-safe findings are below.

**The honest accuracy.**
- Same day, 50/50 by visits (an upper bound): the CNN and kNN tie. On the 4 places with 40+ test windows, kNN 78 %, CNN 71 %. The earlier "CNN 70 % vs kNN 44 % balanced" came from places with 1–6 test windows.
- Across sessions (train on two, test on the third): 26 % accuracy, 23.7 % balanced, near chance. Temporal filtering adds about 2 points.
- Across days: not measurable yet, with one day.
- **Verdict: Aankhen cannot yet be said to locate anyone.** The limits are the link and the single day of labels, not the model.

**Findings that changed the code.**
1. **Firmware.** The router ping timeout was 1000 ms at a 2 ms ping interval, and esp_ping waits for each reply. One lost reply froze CSI for up to a second, which explains the 0–370 CSI/s swings. Now 10 ms (firmware 3.5.1, compiled, not yet flashed).
2. **Physics.**
   - The conditioner removes the overall signal level, the strongest location cue one link has (a body near the line of sight drops the channel 3–10 dB).
   - 51 subcarriers at 20 MHz carry only about 3–6 independent numbers in a 4 m room.
   - Proposed: keep the level as its own feature against a fixed daily empty reference, and use about 12 physics features instead of 102.
3. **Rules over RNNs.** With about 6 measurable transitions in one day, an LSTM/GRU/CRF would memorise the routine. The existing semi-Markov belief (dwell times, neighbour graph) is the right place for "rules". In a replay it cut flicker from 89 to 10 segments (20 true), but it cannot create evidence.
4. **Calibrate before showing.** An uncalibrated softmax behind a 90 % display cap overstates a model that scores 26 % across sessions.
5. **Speed.** `live.follow` was quadratic (24 s → 0.15 s, fixed). Fan-line removal can be 19× faster with one cached pseudo-inverse; human-band energy is recomputed 5× per window.

**Rejected for now.** Transformers or bigger nets, an end-to-end RNN or CRF before 5+ labelled days, phase as input on one antenna, simulated data scored as real, concatenating many links into one model, trusting same-day scores.

**The plan.**
- **In code now (in progress):**
  - one honest evaluator (leave one session or day out, visit-bootstrap intervals, baselines);
  - lying and sitting on the bed merged into one place;
  - temperature calibration;
  - the belief's dwell, gap and leak fixes;
  - the speed fixes;
  - firmware link-quality counters and a non-blocking reconnect.
- **Needs the owner:**
  - flash 3.5.1/3.6.0;
  - the in-room access point on a fixed channel (target RSSI −40 to −60 dBm, ≥ 300 CSI/s);
  - 3+ days of drills with a real empty room, ≥ 2 visits of ≥ 30 s per place, both chirps.

## 2026-10-26: the first real narrated session, and what it taught

**What was recorded.** 120 min on the real board over USB, at the desk, fan on throughout. About 15 min of narrated movement: desk, bed, balcony side, bathroom doormat, bathroom, beside the bed. Then asleep on the bed. The phone recording synced by its start chirp (found at 2.47 s); no end chirp.

**The link was the limit.**
- 665,561 CSI packets in 120 min, about 92/s on average; per-minute rates from 0 to 370, with dead stretches of 10+ min. RSSI −84 to −95 dBm.
- The router is about 6 m away through 2–3 walls.

**Bugs it found, fixed (c4bd5b0 → this commit).**
1. **Timing.** Samples timed by chunk arrival gave 0 windows from 197,945 samples. Board-clock spacing gives 3,609.
2. **Parser.** Directions taken as positions: 44 fragments became 30 stretches that match the transcript.
3. **No empty reference.** The day now borrows bathroom/balcony time, else its own average.
4. **A misleading headline.** See the scores below.

**Scores (50/50 by visits, same day, so an upper bound).**
- 1,645 windows to train, 1,752 to verify; 1,714 of the verify windows were asleep on the bed.
- kNN 95 %, CNN 86 %. **Always saying "bed" scores 97.8 %,** so neither number shows skill.
- The awake places had 1–14 verify windows each: too few to mean anything.
- The CNN's record:
  - loss 1.51 → 0.22;
  - train accuracy 69 → 98 %, verify accuracy 60 → 85 %;
  - the train/verify gap widening after epoch 16 is memorising.
- Lesson 1: every place within 1.4× its own wobble of its nearest neighbour, so from this board position the places barely differ.

**What it changed.**
- The report prints the always-the-commonest-place baseline and balanced accuracy.
- The next sessions need, in this order:
  1. a link that holds about 150+ CSI/s: an in-room access point (the spare 2.4 GHz router, wired, as an access point) and the board moved so the router–board line crosses the room;
  2. 20–30 s+ per place, revisits, and one real "leaving the room";
  3. several days.

## 2026-10-26: are the kNN and CNN real, and can a narrated routine become labels?

**Question.** Do `aankhen/fingerprint.py`'s kNN and CNN actually learn, or only look like models? Can a normal routine, narrated into a phone, be labelled precisely enough to train on?

**Models, tested.**
- Synthetic data: 4 zones, a per-zone subcarrier pattern, day-to-day drift and noise. Trained on 2 days (960 windows), tested on a third (240).
- kNN: `sklearn.neighbors.KNeighborsClassifier`, k = 7, distance-weighted.
- CNN: PyTorch, 2 × Conv1d + BatchNorm, global pool, linear; 18,948 weights.

| | held-out day | labels shuffled (control) | chance |
|---|---|---|---|
| kNN | 100 % | 35.8 % | 25 % |
| CNN | 100 % | 19.6 % | 25 % |

- CNN cross-entropy fell from 0.216 to 0.002 over 20 epochs; guessing scores ln 4 = 1.386.
- **What this shows:** both really fit, and fall to chance when there's nothing to learn.
- **What it doesn't show:** accuracy in the real room. The synthetic task is easy on purpose, and real accuracy needs real days.

**Narration labels.**
- **Clock.** The laptop plays a sync sound: two 0.6 s sweeps, 1–4 kHz. It's found by an FFT matched filter normalised by local energy, searching only the first and last 5 minutes.
  - On 1 h of noise: the real sound scored about 212× the median, the best false peak 8×. Peaks must now be ≥ 30 % of the strongest.
  - Search time: 4.0 s for 1 h of audio.
  - Real speaker to WASAPI mic: the gaps between three sounds matched the logged host times to 1 ms.
  - The MME mic at 16 kHz dropped buffers (gaps about 10 % short), so the laptop mic is not a reference.
- **Drift.** Start and end sounds give a linear map. A simulated phone 50 ppm fast was corrected exactly. Without an end sound the error grows about 0.1–0.2 s an hour.
- **Speech.** faster-whisper with word timestamps (large-v3-turbo on the GPU when more than 2 GB is free, else small int8 on the CPU), then greedy longest-phrase matching onto the 15 zones.
  - A phone-style AAC file (48 kHz, 4.5 min) with 6 spoken places gave back 6 of 6 stretches.
- **A setup trap.** The default output device was a Bluetooth headphone, and the first sound never reached the room (mic peak 0.001). The sound now plays on the laptop speakers, and the command warns when the chosen output is a headphone.

**Limits that remain.**
- Speech lags the movement. Each stretch drops its last 1 s and the loader's first 5 s, so short stops are lost.
- Labels only hold for the board position they were recorded at.

**What it changed.** `python -m aankhen narrate record|label|list`. `fingerprint` loads narrated sessions too, and borrows the day's empty-room reference when a session has none. Commit c4bd5b0.

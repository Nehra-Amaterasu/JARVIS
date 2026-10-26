# Aankhen: running research log

Newest first. One section per question; older dated notes (`2026-10-*-aankhen-*.md`) stay as they were.

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

# Aankhen: running research log

Newest first. One section per question; older dated notes (`2026-10-*-aankhen-*.md`) stay as they were.

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

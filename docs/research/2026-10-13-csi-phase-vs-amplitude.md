# CSI phase vs amplitude: does phase carry extra information? (2026-10-13)

Question: the eyes view (aankhen/eyes.py) now builds a phase column next to the
amplitude column. Does the phase, after removing what the unsynchronised clocks
scramble, separate movement from stillness better than amplitude, and should it
become a feature for the learned models?

## Method

- One real-board learn-my-room recording (2026-10-12, ESP32-S3, router on channel 11,
  ~235 packets/s, 2.9 % of 100 Hz slots forward-filled, no gain frames, ceiling fan
  running per the session notes; the fan relay reported off, so it was on the wall
  switch). Labelled steps: desk_still, desk_type, desk_wave, walk, bed_still,
  bed_wave, away, 20-40 s each.
- Replayed offline, read-only, through the production column builders (EyesBuffer):
  amplitude column = deviation of the median-normalised amplitude from a 10 s
  baseline over the noise scale (30 s EMA of |first difference|, clamped at 3x);
  phase column = the same on the per-packet phase residual (unwrap across
  subcarriers, least-squares line removed). Columns every 0.1 s; energy = mean |z|
  over the 51 subcarriers.
- Separability: ratio of mean energies (moving / still), AUC = P(moving > still),
  and a blocked 5-fold CV-AUC of a logistic regression on log energy (amp, phase,
  both). Also at 1 s windows (mean of 10 columns).

## Results (final builders, 0.1 s columns)

| step | n | amp mean | phase mean |
|---|---|---|---|
| desk_still | 250 | 1.20 | 0.54 |
| desk_type | 247 | 1.63 | 2.64 |
| desk_wave | 200 | 1.39 | 1.09 |
| walk | 251 | 1.61 | 1.23 |
| bed_still | 250 | 1.04 | 1.46 |
| bed_wave | 402 | 1.26 | 0.78 |
| away | 351 | 1.09 | 1.02 |

| pair | ratio amp | ratio phase | AUC amp | AUC phase | CV-AUC both |
|---|---|---|---|---|---|
| desk_still vs desk_type | 1.35 | 4.94 | 0.68 | 0.99 | 0.99 |
| desk_still vs desk_wave | 1.16 | 2.04 | 0.60 | 0.88 | 0.91 |
| desk_still vs walk | 1.34 | 2.30 | 0.64 | 0.91 | 0.93 |
| bed_still vs bed_wave | 1.21 | 0.53 | 0.61 | 0.18 (inverted) | 0.83 |
| still (both) vs typing | 1.45 | 2.65 | 0.72 | 0.91 | 0.90 |
| still (both) vs waving | 1.16 | 0.88 | 0.59 | 0.50 | 0.26 |
| still (both) vs walking | 1.43 | 1.23 | 0.67 | 0.67 | 0.58 |

At 1 s windows the desk pairs reach phase AUC 1.00 / 0.97 / 0.97 (amplitude 0.72 /
0.66 / 0.67). Correlation of amp and phase energy: 0.42 (logs), 0.16 within the still
steps: largely different information.

## The confound

Packet-to-packet phase flicker depends on the channel state, not on movement: median
per-packet residual change ~0.07-0.10 rad at the desk, ~0.34-0.40 rad lying on the
bed and with nobody in the room (27 % of subcarrier steps over 1 rad, against ~1 % at
the desk). Not explained by packet type (98 % HT/STBC throughout, one MAC), gain (no
gain reports), alternation (lag-2 jitter = lag-1) or deep fades (0-3 subcarriers
below 0.25 of the median). This is why bed_still out-ranks bed_wave on phase energy.

Measurement note: a 5 s noise EMA (first version) rose while moving and normalised the
movement away (desk typing phase ratio 1.39 instead of 4.3 on a fixed scale); hence
the 30 s clamped scale now in eyes.py.

## Design caveat: one episode per label

Each label is one contiguous ~20-40 s episode, so label is confounded with time: any
slow change of the channel during the session separates labels just as well as the
activity does. The bed inversion (bed_wave below bed_still, AUC 0.18) and the pooled
still-vs-waving AUC of 0.50 show how fragile this is. These numbers are not yet
evidence for a learned feature. Needed: a repeated A-B-A-B session (still / move
alternating several times, in each spot), scored across episodes.

## The rhythm (spectrum) on the same recording

The real channel's spectrum falls roughly as 1/f. A peak named against the white
6-10 Hz floor alone (4x) fired on drift: 44 % of desk_still windows and 45 % of
windows with nobody home, median "peak" 0.47-0.78 Hz in every step; the 0.1-0.5 Hz
band read 15x the floor sitting still and 25x with nobody home (drift, not
breathing). Sweep of the naming rule over all labelled 6.4 s windows:

| rule | desk_still | desk_type | desk_wave | walk | bed_still | bed_wave | away |
|---|---|---|---|---|---|---|---|
| >=0.4 Hz, 4x floor, 3x local | 22 % | 17 % | 48 % | 43 % | 3 % | 46 % | 33 % |
| >=0.8 Hz, 4x floor, 5x local (adopted) | 0 % | 0 % | 15 % | 5 % | 0 % | 13 % | 0 % |

"Local" = median of bins within +-0.6 Hz, leaving out +-1 bin. The adopted rule is
tuned on this one recording. The UI names a peak only as "strongest rhythm
(estimate)", never as an activity, and labels 0.1-0.5 Hz "slow drift · breathing".

## Conclusion

Phase may carry information amplitude does not: in one spot it separated small
movements almost perfectly where amplitude barely did, but see the caveat above. As a learned feature it is
worth adding only as two features (deviation energy and flicker level), compared
within the same zone, and only after a cross-session test: one session, ~25 s per
step, fan on, and the flicker regime may be session- or router-specific.
Scripts: session scratchpad (phase_experiment.py, phase_experiment2.py, timeline.py,
packet_kinds.py, fades.py); not in the repo.

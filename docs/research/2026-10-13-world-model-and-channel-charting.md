# World model and channel charting on one Wi-Fi link: an honest test

2026-10-13. Code: `aankhen/worldmodel.py`, `aankhen/worldeval.py`, `aankhen/chart.py`,
tests `aankhen/tests/test_worldmodel.py`, `aankhen/tests/test_chart.py`. This page gives
methods and aggregate numbers only. Recordings and models stay private; nothing here
describes the room.

## Verdict

* **World model: do not integrate the network.** Predicting the next 0.5 s of the Wi-Fi
  change picture, no network (5.9k-32k parameters) beat a 200-coefficient linear
  predictor. Its prediction error ("surprise") ranks labelled steps like the linear
  predictor (AUCs equal to 0.01). It flags people no better than the current detector
  (human-band energy, HBE), and no detector separated the ceiling-fan case. The
  embedding added nothing to the zone and activity models: every change is under
  5 points, which is no evidence.
* **Channel chart: does not separate the zones.** On sessions it never trained on, a
  triplet-loss chart on time adjacency did not beat PCA-2D or a random 2-D projection of
  the same window features. With two anchors, a metric chart means nothing (see below).
* **Useful by-products:** a unit bug in `learn._zone_class` (since patched in the working
  copy) and another still in `roomtrain.rule_activity` (see "Requested changes").

## Data

All from one ESP32-S3 link in one room, one evening.

| Kind | Minutes | Use |
|---|---|---|
| learn-my-room session A (fast-ping firmware, about 238 packets/s; ceiling fan at full speed throughout) | 3.3 labelled | test |
| learn-my-room session B (older firmware, about 100 packets/s), round 1 | 2.9 labelled | test |
| first-light sessions ×3 (still / move / walk / type) | 4.0 labelled; heavy packet gaps leave 2.9 scoreable | model selection only |
| empty-room capture, app "teach" sessions, session B's unlabelled round 2 | about 21.5 | pretraining |
| Total streamed | 31.7 | |

The strict pretraining set holds 16.7 minutes of valid 20 Hz pictures. Nothing in it comes
from session A or B; the model files list their training recordings, and `eval` flags any
overlap. A "discarded" folder of mislabelled sessions is never read.

The labelled data is tiny. Session A has about 57 independent 3 s blocks, and a step is
20-35 s. In A, the "desk still" step contains about 10 s of real movement, with HBE
14-37x noise. That is label noise for every detector alike.

## Methods

**Picture.** The product's own conditioning (`csi.CsiConditioner`) feeds 100 Hz
amplitudes. Forward-filled gaps are bridged with a line. A causal 8th-order Butterworth
filter at 6 Hz cuts to 20 Hz before decimation. Without it the fan's 23 Hz blade pass
would fold to 3 Hz; the filter takes it down 107 dB. Each frame is the deviation from a
3 s EMA baseline, over a 30 s capped noise scale taken from 100 Hz first differences, so
pure noise reads about 1, and it is clipped at ±10.

Why 3 s and not 10 s: after a posture change, a 10 s baseline held a ~20-noise offset at
the clip for about 20 s. On unscored sessions, 3 s cut the clipped pixels from
3.2-11.2 % to 1.8-7.9 %.

**Phase.** Optionally, each packet's phase is unwrapped across subcarriers (after
de-rotating by the mean neighbour step) and its least-squares line in the subcarrier
index is removed. The residual's change picture is computed circularly.

**Models** (CPU only):
* causal TCN with a 16-number bottleneck (32k parameters);
* shared-weight per-subcarrier causal CNN (5.9k parameters);
* masked reconstruction of time and subcarrier blocks (26k parameters);
* closed-form linear autoregression (200 coefficients).

Each network predicts the next 0.5 s (10 frames) from the last 3 s.

**Surprise.** The mean squared error of six consecutive 0.5 s predictions over the same
3 s span HBE integrates, aligned to `learn.py`'s windows (0.5 s hop). It is scored only
on windows whose whole 3 s lies inside a labelled step.

**Leakage controls.**
* Strict pretraining exclusion of the test sessions.
* Architecture selected on the three first-light sessions only.
* Every detector scored on identical windows.
* 95 % intervals from a block bootstrap over 3 s blocks.
* Zone and activity scoring with `roomtrain.py`'s protocol, unchanged: leave one session
  out, plus its 30 % tail split.
* The tail split also reported **purged**: the first 3 s of every held-out stretch
  dropped, because 3 s windows on a 0.5 s hop overlap the last training windows.
* Three seeds for the amplitude model and two for amplitude + phase.
* A transductive model (pretrained on the test sessions' own unlabelled stream) as an
  optimistic upper row.
* A reduced pretraining set (9.3 minutes) for the data-amount question.

An independent auditor agent reviewed the method during the work; all five of its
issues were adopted.

## Results: world model

**Selection** on held-out minutes and the first-light sessions. Error is next-0.5 s MSE
in picture units², linear predictor 4.98:

| Model | Error |
|---|---|
| shared | 4.99 |
| causal + linear path | 5.00 |
| causal alone | 5.41 |
| masked | 5.81 |

Activity probe, leave one first-light session out, chance 0.25: shared embedding 0.38,
masked 0.33, causal 0.24, hand-made `learn.FEATURES` 0.21.

**Shared was selected:** it ties at prediction, which is what surprise is, and its
embedding transferred best. On the final strict pretraining set every network still tied
or lost to the linear predictor: shared 5.155-5.169 against linear 5.154, masked 5.69.

**(a) Surprise vs HBE**, test sessions A and B. AUC is the probability that a window from
the first group scores above one from the second; [95 % block-bootstrap CI].

| Contrast | Session | HBE | change energy | linear | network (3 seeds) |
|---|---|---|---|---|---|
| still vs typing | A | 0.45 [0.22-0.69] | 0.39 | 0.39 | 0.39 [0.39-0.40] |
| still vs typing | B | 0.33 [0.17-0.50] | 0.37 | 0.34 | 0.34 |
| still vs waving | A | 0.45 [0.26-0.65] | 0.36 | 0.38 | 0.38 |
| still vs waving | B | 0.33 [0.17-0.51] | 0.27 | 0.28 | 0.28 |
| still vs walking | A | 0.66 [0.50-0.83] | 0.69 | 0.70 | 0.70 |
| still vs walking | B | 0.69 [0.49-0.85] | 0.69 | 0.71 | 0.71 |
| in-room vs away | A | 0.58 [0.44-0.71] | 0.59 | 0.59 | 0.59 |
| in-room vs away | B | 0.42 [0.27-0.59] | 0.48 | 0.43 | 0.43 |
| desk still vs away (fan case) | A | 0.46 [0.15-0.82] | 0.57 [0.27-0.86] | 0.48 | 0.48 [0.17-0.82] |
| desk still vs away (fan case) | B | 0.43 [0.19-0.69] | 0.49 | 0.43 | 0.43 |

* Every interval straddles 0.5 except walking, and nothing separates the fan case.
* "Still" includes the bed steps. There the channel was busier than during desk typing for
  every detector (HBE median 3.6x the desk-still level in A), so typing and waving rank
  below "still". No learned predictor changes that.
* By contrast, on a first-light session (older firmware, fan lines locked) every surprise
  variant, the plain change energy included, separated still from moving at AUC 1.00,
  against HBE 0.90 for still vs typing. That gain belongs to the picture, not the network.
* Seeds change network AUCs by at most 0.01. Pretraining on 9.3, 16.7 or 30.2 minutes
  (the last including the test streams, i.e. transductive) changes them by at most 0.01.
* Phase-channel surprise: in-room vs away 0.60 [0.44-0.77] in B but 0.49 in A; desk still
  vs away 0.27 [0.07-0.53] in A. No consistent gain.

**(b) Zone and activity.** "Occupancy" is in-room vs not; zone and activity are scored
when in the room. Values are mean [min-max] over 3 seeds where the world model is
involved.

| Protocol | Features | Occupancy % | Zone % | Activity % |
|---|---|---|---|---|
| leave one session out, test A | FEATURES | 81.9 | 56.1 | 34.9 |
| | + embedding | 81.9 | 56.1 | 34.6 [33.3-36.8] |
| | embedding alone | 79.9 | 48.0 | 20.1 |
| | + surprise | 81.9 | 56.1 | 37.0 |
| leave one session out, test B | FEATURES | 80.0 | 73.2 | 47.1 |
| | + embedding | 80.0 | 76.1 [74.3-77.5] | 47.9 |
| | embedding alone | 78.7 | 46.8 | 21.5 |
| tail split, purged, A (13 blocks) | FEATURES | 78.4 | 77.4 | 59.7 |
| | + embedding | 76.1 | 76.9 | 59.7 |
| | embedding alone | 82.9 | 73.1 [58-87] | 21.5 |
| tail split, purged, B (10 blocks) | FEATURES | 82.8 | 70.8 | 45.8 |
| | + embedding | 82.8 | 70.8 | 47.9 |
| tail split, unpurged, A | FEATURES | 87.5 | 83.7 | 67.3 |

* All differences from FEATURES are under 5 points: no evidence either way.
* The embedding alone is at chance for activity.
* Purging cost FEATURES 4-10 points, the size of the window-overlap leakage in the
  unpurged split.
* Amplitude + phase and the masked model were no better.
* The no-training rule scored 25-34 % with the stock unit slip and 18-27 % with it
  corrected, so the learned models beat it either way.

Activity confusion, FEATURES, purged tail of A (rows: truth still / typing / waving /
walking; columns: said, same order):

```
still    10  0  0  0
typing    6  0  3  0
waving    1  0 24  0
walking   4  0  3  3
```

Typing is never recognised; walking is mostly missed. FEATURES + embedding gives an
identical matrix.

## Results: channel charting

**Method.** An MLP maps window features to a 2-D chart, trained with a triplet loss:
* positive: within 1.5 s in the same unbroken stretch;
* negative: at least 15 s away in the same recording;
* no labels.

Inputs: the change picture's log energy per channel ("change"), the window's static
amplitude shape centred on the recording's median ("static"), both, and both with phase.

**Scoring** uses hidden zone labels (desk, bed, walk, away):
* kNN (k = 7) with each window's own ±15 s excluded;
* the same over desk and bed windows only;
* k-means purity;
* silhouette;
* trustworthiness and continuity against the features and against a coarse zone
  reference;
* a time-confound ratio: the distance between the two halves of one step over the
  distance between steps. Near 1 means the chart maps the clock, not the place.

**Baselines:** PCA-2D and a random 2-D projection, fitted on the same training windows
and scored the same way.

Held-out chart (never trained on the scored session), kNN ±15 s out:

| Input | Session | Triplet | PCA-2D | Random |
|---|---|---|---|---|
| change | A | 0.22 | 0.15 | 0.28 |
| change | B | 0.06 | 0.12 | 0.15 |
| static | A | 0.33 | 0.41 | 0.48 |
| static | B | 0.10 | 0.32 | 0.30 |
| change + static | A | 0.33 | 0.40 | 0.49 |
| change + static | B | 0.20 | 0.19 | 0.11 |
| change + static + phase | A | 0.37 | 0.33 | 0.36 |
| change + static + phase | B | 0.08 | 0.14 | 0.27 |

* **Input:** "change" alone tracks time and activity, not place: its halves-to-steps
  ratio is 0.67-0.96, against 0.35-0.36 for "static".
* **Cross-session kNN**, a chart that saw neither session, labels from one session
  predicting the other: 0.11-0.39 triplet, 0.19-0.54 baselines. Chance is about 0.25 with
  class imbalance.
* **Trustworthiness / continuity against the zone reference:** held-out triplet charts
  0.62-0.76 / 0.58-0.71; PCA 0.59-0.77; random 0.60-0.77. An oracle chart scores about
  0.84, and noise about 0.50.
* **The transductive confound:** trained on the scored session itself (the usual
  channel-charting protocol), the static triplet chart reached kNN 0.56-0.58, but held
  out it fell to 0.10-0.33.

**Anchors and metres.** Two anchors (desk and bed centres from the layout) determine a
similarity transform exactly: 4 equations for 4 unknowns. They leave a mirror image free,
so they test nothing, and no error at the anchors is reported. The only held-out check:
after the fit, how many walking windows land inside the room outline.

| Chart | Session A | Session B |
|---|---|---|
| held-out static triplet | 100 % | 23 % |
| PCA | 100 % | 16 % |
| random | 100 % | 18 % |

A chance-level check. With one link the chart is at best a topology of fingerprints the
link can tell apart; here it is not even that.

## What would change with days of unlabelled streaming

**Data amount.** Going from 9 to 30 pretraining minutes changed nothing measurable, and
the network never left the linear predictor's error. More hours help only if there is
nonlinear structure to learn.

**The bottleneck is labelled, held-out evaluation:**
* a second learn-my-room session on another day, on the current firmware, with the fan
  both on and off;
* a still step checked live, as the moving steps already are.

**Storage:** amplitude at 20 Hz in float16 is 51 × 20 × 86 400 × 2 B = 176 MB a day; phase
doubles it.

## Recommendation

1. Do not add the network, its surprise channel or its embedding to the engine or
   `learn.py`.
2. Fix the two unit slips first (below).
3. If anything from here goes in, make it the cheap part: the change picture's energy as
   one extra `learn.FEATURES` column. It costs no model, and it matched or beat HBE on one
   session, though not on the test sessions. Judge it with the purged protocol on a new
   session.
4. A nightly crew agent retraining a world model is not justified by these numbers. A
   nightly job that only computes and stores the 20 Hz picture (176 MB/day) would keep
   the option open at little cost.
5. For place, the static channel shape carries what little there is, and a learned 2-D
   chart did not beat a fixed projection of it. Spend on the second sensor (radar), not
   on charting.

## Requested changes (not made here)

* `learn._zone_class`: `log_hbe` is log10, so the threshold must be `np.log10(3.0)`, not
  `np.log(3.0)`. The old code required 12.5x noise. In sessions A and B, 46 of 71 and 37
  of 70 "away" windows were labelled "empty" instead of "outside". This is already
  patched in the working copy by someone else; it needs committing with a test on real
  log10 values.
* `roomtrain.rule_activity`: replace `np.exp` with `10.0 **` on the log10 features (the
  "2x / 4x" thresholds are really 4.9x / 20x). Corrected, the rule scores lower (see
  (b)), so the learned models' margin over it grows.

# Aankhen: the physics of sensing a person with one Wi-Fi link

What one ESP32-S3 listening to a home router can and cannot know about a person,
from first principles, and how the code now follows from it. Every number is either a
formula, a published measurement (sources in `aankhen/rf.py`), or a measurement
of the full pipeline on the physics simulator. Simulator numbers are predictions, not
evidence from the real room: `python -m aankhen validate` produces that evidence.

## 1. What the ESP32 actually measures

For every packet it decodes, the ESP32 reports the **channel state information**
(CSI): one complex number per OFDM subcarrier, 52 of them, 312.5 kHz apart across the
20 MHz channel. Physically it is the sum of every path the signal took:

    H(f) = Σᵢ aᵢ · exp(−j 2π f Lᵢ / c)

A person adds paths that bounce off their body and blocks part of the others.
Everything Wi-Fi can know about a person is in how those terms change with time.

| path | amplitude | source |
|---|---|---|
| direct | λ / 4πd | Friis |
| wall / floor reflection | Γ · λ / 4πL, image method | ITU-R P.2040 (Γ ≈ 0.25–0.4) |
| body part, RCS σ | λ√σ / ((4π)^{3/2} d₁ d₂) | bistatic radar equation; σ ≈ 0.73 m² (3GPP TR 38.901) |
| through a wall | × 10^(−loss/20), 23 cm brick ≈ 6.4 dB | ITU-R P.2040 |
| body in the way | knife edge, J(v) = 6.9 + 20 log(√((v−0.1)²+1) + v − 0.1) | ITU-R P.526; ~10 dB measured |

**Where a person is strongest.** The ratio of a body's bounce to the direct path is
√(σ/4π) · d/(d₁d₂). It peaks near *either* end of the link. With the router in the
hallway, someone walking past it moves the channel about as much as someone walking
in the room (the default layout: 0.97×). One link cannot tell the two apart.

## 2. Breathing, and why some places are blind

A chest moving δ along its normal n changes the bounce path by exactly

    ΔL = δ · n · (u_tx + u_rx),    |u_tx + u_rx| = 2 cos(β/2)

where β is the angle transmitter–chest–receiver. Facing across the link, up to 2δ.
Facing along it, or sitting on the line between the radios, almost nothing. Lying on
your back, the chest moves up, and only the vertical parts of u_tx and u_rx count.

The chest's term turns by k·ΔL (6 mm of path ≈ 0.3 rad) on top of the large static
sum H₀. The amplitude the ESP32 sees changes by a·k·ΔL·sin ψ, where ψ is the angle
between that term and H₀. At ψ = 0 or 180° only the phase turns, and one
unsynchronised ESP32 cannot read phase. These are the Fresnel-zone blind spots of the
respiration literature.

**They are thin bands, not regions.** Moving the chest ~3 cm changes the path by half
a wavelength and flips a spot between visible and blind. Moving a chair 3–5 cm can
fix or break detection. So the analysis reports a *probability* over positions and
facing directions, never a yes/no per spot.

**Phase does not rescue it with one antenna.** Sanitising the phase (removing the
per-packet offset and slope) also removes the breathing change, which is nearly the
same on every subcarrier through a wall: breathing visible at the desk 28 % → 29 %.

## 3. The finding that changed the pipeline: per-packet normalisation

The ESP32-S3 sets its receive gain per packet, close to at random (Portner et al.,
IEEE IoT-J 2026), and the CSI amplitudes carry it. The pipeline therefore divided
every packet by its own median amplitude. Through a wall the channel is nearly flat
across frequency, so a person mostly moves the whole channel up and down together,
and that is exactly what the division removes:

| walking, one second | motion variance |
|---|---|
| true channel | 1.5–8.7 × 10⁻² |
| after dividing each packet by its median | 4 × 10⁻⁵ – 5 × 10⁻³ (10× to 1000× less) |
| receiver noise | ~1 × 10⁻³ |

**The fix is to undo the gain, not to divide it away.** Espressif's `esp_csi_gain_ctrl`
reads the gain the S3 applied to each packet (from reserved bits of `rx_ctrl`). The
firmware now sends it in `CSI_GAIN` frames, and the host restores amplitudes
proportional to |H|, divided only by a 30 s reference. Without the library, the
packet's RSSI (measured before the gain stage) supplies a coarse level.

The motion detector gained a second test on that level, OR-ed with the old one:
detrended variance against the empty room. With RSSI only it stays above 0.5 dB²,
because a still person can flip a 1 dB RSSI between two values. While a fan runs it
switches off, because the fan moves the total power periodically.

## 4. What the full pipeline does on the physics simulator

5 seeds × 2 simulated rooms per scenario, median / worst run:

| | old pipeline | new, without gain | **new, with gain** |
|---|---|---|---|
| Wi-Fi motion recall, evening | 51 / 17 % | 53 / 32 % | **77 / 74 %** |
| Wi-Fi motion recall, walk | 70 / 33 % | 72 / 47 % | **91 / 90 %** |
| Wi-Fi motion recall, two people | 49 / 0 % | 57 / 8 % | **89 / 87 %** |
| sleeper called "empty" | 71 / 85 % | 50 / 85 % | **12 / 85 %** |

The old toy simulator had shown 80 % / 91 % / 97 % recall and 0 % sleeper misses: it
was flattering the pipeline. The sleeper's worst run stays bad in every pipeline. In
one of the two rooms, at the sleeper's exact pose, breathing sits below the detector's
line: physics, not a bug (section 5).

Known, not fixed here:
- **Count while asleep.** Count accuracy drops to 76 % in the worst seed: when the
  first breathing window fails before the radar's 30 s still-track hold expires, the
  track is gone even though presence holds.
- **Fan ghosts.** In 2 of 5 fan seeds (both rooms), a radar ghost from the fan blades
  makes the empty room "occupied" for ~24 s. That is a tracker weakness the shifted
  simulator randomness exposed; it is identical with the new level channel off.

## 5. Breathing: model against detector

`python -m aankhen.tests.calibrate_physics` puts a still person at 40 random poses
(bed lying, desk seated) in 4 simulated rooms. It runs each through the full byte →
detector chain and fits where detection happens against the physics prediction.

| predicted breathing SNR | windows detected (median over runs) |
|---|---|
| below 15 dB | 0 % |
| 15–20 dB | 97 % (gain pipeline) |
| 20–25 dB | 100 % |

Half the windows pass at **17.2 dB**, 90 % at **19.4 dB**. That is what the
detector's own threshold predicts (6× an empty-room floor of ~12). So the model and
the detector agree, and the report's "likely" line is 19.4 dB.

Two things this calibration caught:
- **The verdict lines were guesses.** The first ones (10 / 4 dB) were 13 dB too
  generous.
- **The shared compensation error.** The firmware's gain compensation leaves one
  error per packet, common to every subcarrier, and combining subcarriers does not
  average it away. Treated as independent, it had overstated breathing SNR by ~10 dB.

Two detector variants were measured on the same 40 poses and kept out:
- choosing subcarriers from a 1-minute average: +0.4 dB;
- whitening by the full noise covariance: −1.3 dB.

Without the gain report, no still pose (0 of 40) was detected.

**The decisive unknown is how accurate the gain compensation is.** On the default
layout, 4 simulated rooms:

| compensation error per packet | desk breathing likely | bed breathing likely |
|---|---|---|
| 0.05 dB | 85 % (76–93 %) | 51 % (38–66 %) |
| 0.1 dB | 79–81 % | 41–42 % |
| 0.25 dB (assumed) | 48–49 % | 20 % |
| 0.5 dB | 2 % | 5–6 % |
| no gain report | 1 % | 1 % |

The room's own slow wander barely moves these (σ 0 → 0.004: within 2 points).
`validate` measures the compensation error from an empty room on the first run.

## 6. So, can one ESP32-S3 do it?

| question | answer | why |
|---|---|---|
| someone walking in the room | **yes**, ~90 % of windows with the gain library, ~70 % without | a body bouncing at walking speed changes the channel by 10–30 % |
| which person, or where | **no** | one link measures one number per subcarrier; position needs angles (the LD2450) or several links |
| walking in the hallway vs the room | **cannot tell** with the router in the hallway | the body is as strong near either end of the link |
| a still person breathing at the desk | **only with the gain library**, at 50–85 % of positions depending on its accuracy (0.25 → 0.05 dB); ~1 % without | 3–5 mm of chest motion is 0.1–0.3 rad of path phase |
| a sleeper on the bed | **unreliable**: 20–51 % of positions with the gain library, ~1 % without | lying, the chest moves vertically against a horizontal link; blind bands |
| heartbeat (0.2–0.5 mm) | **no** | 10–20× smaller than breathing, below this receiver's noise |
| finger or hand gestures | **only as "motion"** | detectable near the link, not identifiable |

So for **motion**, one ESP32-S3 is enough if the code is right, and with the gain
library it now is (on the simulator; `validate` will say for the real room). For
**still presence**, physics makes one Wi-Fi link a weak sensor. Even with perfect
code, it depends on centimetres of position, the way you face, and the compensation
accuracy. For still presence that must never fail (sleep), the right sensor is a
24 GHz presence radar (the LD2410C on the buy list). At 12.4 mm wavelength, the same 3 mm of
chest motion is 3 rad of phase instead of 0.3, and its own transmitter and receiver
share one spot.

## 7. What the code is now

| file | role |
|---|---|
| `aankhen/rf.py` | the channel from first principles; ESP32-S3 receiver (noise, near-random AGC, gain report, phase, int8) |
| `aankhen/physics.py` | per-spot predictions, both pipelines, several rooms; HTML maps |
| `aankhen/validate.py` | guided real-room session: metronome breathing, room wander, compensation error |
| `aankhen/csi.py` | gain-compensated amplitudes with a slow reference; level per sample |
| `aankhen/motion.py` | shape test (MVS) OR level test; breathing detector |
| `aankhen_esp32_firmware` | `CSI_GAIN` frames when `esp_csi_gain_ctrl` is installed |
| `aankhen/tests/calibrate_physics.py` | ties the model's SNR to what the detector really does |

Commands: `python -m aankhen physics` (add `--place` to search ESP32 positions),
`python -m aankhen validate`, `python -m aankhen bench --sim`.

## 8. Open, in order

1. Install `esp_csi_gain_ctrl` and confirm that it links under Arduino (untested).
2. Measure the room (room.json), flash, and run `validate`. Its two numbers (room
   wander, compensation error) replace the model's assumptions.
3. Run `physics --place` on the measured room for the ESP32 position. Consider a
   second ESP32 as the transmitter, inside the room, so the hallway stops looking like
   the room.
4. Add the LD2410C for sleep.

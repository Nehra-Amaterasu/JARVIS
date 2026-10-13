# What one Wi-Fi link can see, and the signal-only routes past its limits

2026-10-13. Question from the owner: can Aankhen's single ESP32-S3 + router link give x/y/z
coordinates, fine body detail ("every movement, fingers, the face") and a picture of the room,
without a camera? This note records the answer and the sources, so the reasoning is not lost.

## The setup it applies to
One router (transmitter), one ESP32-S3 (one antenna) pinging it ~250-290 times a second, 51
LLTF subcarriers 312.5 kHz apart on a 20 MHz channel at 2.4 GHz (wavelength ~12 cm).

## Three walls between CSI and coordinates
1. **Geometry: one link measures one path length.** The signal bounced off a body travels
   router -> body -> ESP32. Every point with the same total length lies on one ellipse
   (an ellipsoid in 3D) with the router and the ESP32 as foci, so one link gives a ring of
   possibilities, never a point. A point needs angle (several phase-coherent antennas) or
   several links crossing.
2. **Bandwidth: distance sharpness = c / B.** 20 MHz blurs path length over ~15 m; a room
   is ~4 m. (24 GHz LD2450: 250 MHz -> ~0.6 m. 60 GHz radars: ~4 GHz -> ~4 cm.)
3. **Clocks: the router and the ESP32 do not share one.** Each packet arrives with a random
   carrier phase (CFO) and a random detection delay (PDD), which add a random offset and a
   random slope across subcarriers: exactly where the time of flight lives.

## Which errors can be subtracted
An error can be subtracted only if it can be measured against something whose true value is known.

| Error | Nature | Removable? |
|---|---|---|
| The board's own per-subcarrier response, mean detection delay | fixed | yes: calibrate once |
| Sampling-frequency offset (crystals a few ppm apart) | slow drift | yes: track the trend |
| Carrier phase and detection delay | new and random every packet | not with a margin; but every path in a packet shares it, so aligning each packet to the empty room's fingerprint cancels it |

What survives the alignment is the *change* of the moving path: its direction (towards or
away from the link) at millimetre scale, through the phase. Breathing (3-5 mm of chest, about
0.4 rad on the bounced path) and gestures become measurable. Absolute distance does not.
The ESP32's amplifier gain also changes at random per packet; Espressif's `esp_csi_gain_ctrl`
(component v0.1.5, 376 KB) reads it back so it can be compensated.

The rate of change is usable on its own: an amplitude ripple of 1 Hz means the bounced path
is changing by one wavelength (~12 cm) a second (the CSI-speed model). That is why waving
(1-3 Hz) and walking look different in the same data.

## The limit no training removes
The smallest detail a wave resolves is about half its wavelength, and only with a large
antenna aperture. At 2.4 GHz that is ~6 cm at best: a head turning, yes; the shape of a face or
a finger, no. A generative model could draw a picture from Aankhen's numbers, but every detail
it added would be invented: an illustration, never a measurement.

## Routes that do work, all without a camera
- **Phase-coherent antenna arrays.** ESPARGOS (University of Stuttgart) puts eight ESP32-S2
  chips on one board with a shared 40 MHz reference and a phase reference signal over traces
  of known length. Each chip's random PLL phase offset is measured and subtracted, giving
  coherent CSI and angle of arrival. Hardware closed; datasets public.
- **Radar.** It times its own echo with its own clock, so the clock wall does not exist. LD2450
  (24 GHz, ~INR 1,000): x/y and speed of up to 3 people at ~10 Hz. 60 GHz radars resolve
  centimetres; Google's Soli (60 GHz) read finger gestures with no camera.
- **Two-way timing (Wi-Fi RTT / FTM, IEEE 802.11mc).** The round trip cancels the clock
  mismatch. The ESP32-S3 can act as an FTM responder; Android 9+ phones initiate through
  `WifiRttManager` when their chip supports it. Indoor accuracy is about 1-3 m after a
  per-device bias is calibrated out. It locates the phone, not the body.
- **More links.** A phone or a second ESP32 as an extra transmitter gives another viewpoint:
  better learned places and gestures, Doppler from another direction. Still no coordinates
  on its own, because each link brings its own clock.
- **Self-supervised learning on unlabelled CSI.** AM-FM pretrained on 9.2 million unlabelled
  CSI samples (439 days); WiFo and LatentWave use masked or latent prediction. Predicting
  the next change needs no labels, so every hour the board streams is training data.
- **Channel charting.** A self-learned 2-D map in which moments close in time land close
  together (people cannot teleport), pinned to metres with a few known anchors (desk, bed).
  It gives room topology, not measured coordinates.
- **Teacher -> student.** A sensor that can measure coordinates (the radar) labels the CSI
  automatically; a network learns to estimate position from Wi-Fi alone, and is retrained
  when the room changes.

## What it changed in the project
- Aankhen stays signals-only (see CLAUDE.md).
- Built or started on 2026-10-13: the "eyes" view (amplitude and sanitised-phase change
  pictures, motion spectrum); a world-model and channel-charting experiment on the real
  recordings; the phone as a second link (firmware 3.3.0, frame type 0x08).
- Open decisions for the owner: the LD2450 (the teacher), the gain library, keeping a rolling
  week of raw CSI for self-supervised training (~180 MB/day at 20 Hz float16).

## Sources
- [ESPARGOS: An Ultra Low-Cost, Realtime-Capable Multi-Antenna WiFi Channel Sounder (arXiv 2502.09405)](https://arxiv.org/pdf/2502.09405)
- [ESPARGOS: Phase-Coherent WiFi CSI Datasets for Wireless Sensing Research (arXiv 2408.16377)](https://arxiv.org/pdf/2408.16377)
- [ESPARGOS datasets, DaRUS, University of Stuttgart](https://darus.uni-stuttgart.de/dataverse/espargos)
- [AM-FM: A Foundation Model for Ambient Intelligence Through WiFi (arXiv 2602.11200)](https://arxiv.org/html/2602.11200)
- [WiFo: Wireless Foundation Model for Channel Prediction (arXiv 2412.08908)](https://arxiv.org/pdf/2412.08908)
- [LatentWave: JEPA Pretraining for Wireless Foundation Models](https://www.alphaxiv.org/abs/2606.06373)
- [Android WifiRttManager](https://developer.android.com/reference/android/net/wifi/rtt/WifiRttManager)
- [TU Berlin, ESP32-S3 boards as FTM responders (2025)](https://www.tkn.tu-berlin.de/bib/roesler2025improving/roesler2025improving.pdf)
- [MIT CSAIL, FTM RTT issues and per-device bias](https://people.csail.mit.edu/bkph/ftmrtt_issues)
- [ESP32 FTM accuracy test, ArduPilot forum](https://discuss.ardupilot.org/t/esp32-s2-s3-c3-time-of-flight-wifi-positioning/106895)
- [Espressif component registry: esp_csi_gain_ctrl](https://components.espressif.com/components/espressif/esp_csi_gain_ctrl)

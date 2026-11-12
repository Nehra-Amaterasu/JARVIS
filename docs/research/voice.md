# Voice

Running file for the voice stack, newest section on top.

## 2026-11-12: JARVIS's output level from core/playback.py (B07, Python half)

**Question.** Can `core/playback.py` report how loud JARVIS is speaking (RMS plus the 24-band spectrum of spec section 9.2 of
`docs/design/jarvis-product-overhaul.md`) at about 20 Hz without any risk to the speaker's write loop, and at what cost per frame?

**What I built.** Behind the env flag `JARVIS_OUT_LEVEL` (default off; read at each sentence, `1/true/yes/on` turn it on):
- `analyse(window, sr)`: Hann window, `rfft`, power summed per band through a cached 24 x bins 0/1 matrix, dB relative to a
  full-scale sine, bands as `round(255 * clamp((dB + 60) / 60))`. No automatic gain.
- `OutLevelEmitter`: a ring of N samples (N = 2048 at 24 kHz), a 50 ms schedule (not "now minus last", which would give 13.9 Hz
  with 24 ms writes; the schedule gives 20.8 Hz), `seq`, `final`. Frames go to a one-slot mailbox and a daemon thread calls
  `appio.emit("out_level", ...)`, so a stuck stdout never reaches the write loop.
- `play_pipe` calls `level.push(out, rate)` right after `speaker.write`, and `level.finish()` in `finally`
  (played, stopped and failed exits). `Speaker.latency_s()` supplies `lat_ms`; `None` when unknown, never a guess.
- `app/jarvis_app/core.py` republishes the child's `out_level` as an ephemeral bus event (like `level`).
- Event fields: `kind`, `t`, `seq`, `sr`, `rms_db`, `peak_db`, `bands[24]`, `lat_ms`, `final`.

**Numbers (this laptop, shared with other builders running, 5 runs of 3,000 pushes of a 576-sample 24 ms frame).**

| | median | mean | p99 | worst seen |
|---|---|---|---|---|
| `push` per 24 ms frame (about every second one analyses) | 22 to 49 us | 66 to 128 us | 0.35 to 0.74 ms | 11.8 ms (a scheduler stall) |
| `analyse` of 2,048 samples | 44 to 71 us | | 0.14 to 0.75 ms | 3.8 ms |
| first `analyse`, cold (plan and FFT warm-up) | 28 ms | | | |

- Mean cost is 0.3 to 0.5 % of one 24 ms frame; the median is 0.1 to 0.2 %.
- The cold first call (28 ms, longer than a frame) is moved off the write thread: `OutLevelEmitter.warm(24000)` runs when
  a sentence starts, before the first mp3 frame has decoded. With it, the worst push in a blocked-consumer run was under 50 ms
  even on the loaded box, and typically tens of microseconds.
- Memory: ring 8 KB (2048 float32), one mailbox slot, plan cache capped at 8 entries; 5,000 pushes (2 minutes of speech) grew
  traced memory by under 64 KB in the test.
- Accuracy: 1,700 Hz sine at peak 0.1 reads -20.0 dB (tolerance 0.2) and lands in band 15 within 1.5 dB; 1 kHz lands in band 12;
  one sine at the geometric centre of bands 0, 4, 8, 12, 16, 20, 23 peaks in its own band; silence gives all zeros and
  `rms_db` -90, never NaN or -inf.

**Underrun-safety argument (also in the code comment).** One 24 ms frame must be decoded and written before the output
buffer (`Speaker.latency`, about 0.09 s and up, so around four frames) drains. The added work on the write thread is about 0.1 ms
on average, 1 ms at the 99th percentile and a few ms in a scheduler stall: far under the 90 ms of slack. The only blocking call
(the stdout write) is off that thread, in a one-slot mailbox that drops rather than waits (test: a consumer blocked for 5 s
leaves 100 pushes at under 50 ms each and 40+ frames dropped, visible as `seq` gaps). An `emit` that raises is swallowed. With
the flag off the cost is one `os.environ` lookup per sentence.

**Not measured (assumptions to check).** The mixer volume is invisible to Python (stated in the legend by the UI). `lat_ms`
is what sounddevice reports for the stream; the true acoustic delay is not measured. The Kokoro and pygame file path
(`_play_file` in `jarvis.py`) emits nothing, which the UI shows as no signal; that file belongs to the core owner. Nothing was run
against the real speaker or the live voice process (the live process is untouched until the owner restarts on purpose).

**What it changed.** `core/playback.py`, `app/jarvis_app/core.py`, tests `core/tests/test_out_level.py` (16) and
`app/tests/test_core_out_level.py` (1). The spec's proposed `core/levels.py` was not created: the pure functions live in
`playback.py` and can move there when the microphone channel is built.

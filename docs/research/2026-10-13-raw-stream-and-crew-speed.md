# Raw-stream recorder and crew/stream speed (2026-10-13)

Two jobs on Aankhen's live path:
1. Keep a rolling 7 days of the real board's raw Wi-Fi, so self-supervised models can
   learn from unlabelled hours. The owner agreed to this on 2026-10-13.
2. Find out why, in the live app, the crew's movement watcher took about 106 ms per tick
   (it runs every 0.5 s) and the Aankhen websocket ran at about 6.6 Hz instead of 10 Hz.
   Then fix it with the smallest change.

All measurements were taken on the owner's laptop (12 logical CPUs, Windows 11, the
project venv), against scratch data folders. The live app was not running at the time,
so the live numbers above could not be measured again; the bench reproduces the same
regime instead (see Job 2).

## Job 1: what the recorder keeps, and why

**Code:** `aankhen/stream.py`. It is hooked into `engine._on_csi` / `_learned_step`
through `engine.tap`, and the hub attaches it.

### What is kept per 50 ms row (20 Hz)
* `amp`: the conditioned 100 Hz amplitude (`CsiConditioner`: resampled, Hampel-cleaned,
  each packet divided by its own median). The 5 samples of a row are averaged, stored as
  float16 over 51 subcarriers. Averaging is a boxcar filter: its nulls at 20 and 40 Hz
  stop the fan's flicker from folding onto slow movement, which taking every fifth
  sample would allow.
* `phase`: the sanitised phase (`eyes.sanitise`, each packet's straight line removed). It
  is the circular mean of every packet in the row (a unit-phasor mean, because an angle
  mean breaks at ±π). Stored as float16; NaN when the row has no packet.
* `real`: how many of the row's 5 samples were measured rather than forward-filled.
* `n_raw`: how many packets the phase averages.

### Weak labels, once a second
The fields below are taken as known at that second, so the hours can be labelled weakly
later:
* `meta_t` (device time) and `meta_ts` (host epoch);
* the Wi-Fi `channel`;
* the `fan` relay;
* the learned `zone` with its `occupied_p`;
* the learned `activity`.

The class names are stored in the file (`zones`, `activities`). The file is also stamped
with `source="hardware"`, `rate_hz=20` and `version=1`.

### Choice: amplitude plus phase
The amplitude-only estimate was 176 MB a day and phase doubles it. Two reasons for keeping
phase:
* **Measured size is under the 2x ceiling.** On a real recording it comes to 312 MB a day
  written, ~2.2 GB for the week (table below). The disk had 33 GB free.
* **Phase carried information that amplitude did not.** At the desk, phase separated
  typing from sitting still with AUC 0.99, against 0.68 for amplitude
  (`2026-10-13-csi-phase-vs-amplitude.md`). That came from one session, so it is
  suggestive, not proof. Still, a model that will learn from these hours should be able
  to use it.

`AANKHEN_STREAM_PHASE=0` drops phase.

### Measured size and cost
The `scratchpad` script `stream_size.py` sends packets through `Engine` with the tap and
writes the files through the real recorder.

| data | amp + phase, as written (npz, zlib) | amp + phase, uncompressed | amp only, compressed | amp only, uncompressed |
|---|---|---|---|---|
| real recording (teach session, 442 s, ~104 packets/s), read-only | **312 MB/day** | 372 MB/day | 150 MB/day | 196 MB/day |
| simulator, 290 packets/s, 300 s | 273 MB/day | 365 MB/day | 116 MB/day | 192 MB/day |

* **Rows:** 19.98 per second on the real recording; 99.9 % of rows carry a phase.
* **Engine side:** `raw()` costs 0.26 µs a call and `sample()` 0.16 µs, each a single
  deque append. That is ~0.3 µs per packet, against ~140 µs of engine processing per
  packet on the real recording (0.2 %).
* **Writer:** it works through decimation, phase and files at 1.2 ms per second of stream
  on the real recording and 2.2 ms per second on the simulator at 290 packets/s. That is
  0.1-0.2 % of one core, and it runs off the engine lock.

### Files, safety and retention
**Layout.** Files live under `data/aankhen/stream/YYYY-MM-DD/HH.npz`, one per hour of host
local time.
* Rows are buffered for 5 min, then written as `HH.part-<ms>.npz`. Each part is written
  under a `.tmp` name and renamed, so a crash loses at most 5 min and never leaves half a
  file.
* When the hour ends, its parts are merged into `HH.npz`. `HH.npz` lists the parts it
  holds, so a merge that is interrupted after the rename is not counted twice (tested).
* A recorder that starts merges whatever an earlier session left behind. This runs on the
  writer thread, so the hub's start does not wait for it.
* `load_hour()` / `load_day()` read merged files and unmerged parts together.

**Only the real board is recorded.** The hub attaches a recorder only for source
`hardware`, and `StreamRecorder` refuses any other source. Simulation and replay are
never recorded (tested).

**Never blocking the engine.** Inside the engine the tap does one deque append under the
lock: no lock of its own, no wait. When the writer falls 8192 items (~20 s) behind, new
items are dropped and counted by kind.
* Test: with the writer frozen, 3000 packets went through the engine as fast as without a
  recorder.
* The queue stayed at or under its bound throughout.
* More than 3000 items were dropped and counted.

**Retention.** Hours whose end is more than 7 days old are deleted at start and at every
hour's merge. Day folders left empty are removed, and files the recorder did not write
are never touched.

**Switch.** `AANKHEN_STREAM=0` turns recording off. The aankhen and app test suites set
it, so a test hub that switches to a fake board never writes into the real `data/`.

**Where it is shown:**
* `hub.info()["stream"]`: on, today's MB, total MB, days kept, drops, the queue, the
  write error if there is one, and a note when it is not recording.
* The steward's Aankhen line, for example "Aankhen live, 262 packets/s; raw stream on,
  41 MB today, 3 days kept". The drop count is added when there are drops.

## Job 2: why the watcher and the stream were slow

### Profile
**Building a frame is cheap.** `engine.frame_message()` takes 0.03 ms when the lock is
already held. The 51 amplitudes, the events and the learned fields are not the cost.

**The cost was waiting for the engine lock.**
* The consumer thread holds the lock for every packet. That is ~0.35 ms on average at
  290 packets/s.
* `_learned_step` makes one `HistGradientBoostingClassifier.predict_proba` call per model
  on a single row, every 0.5 s. Offline on 120 s of simulator packets, all 233 calls took
  more than 10 ms (mean 21 ms, which includes the first call's warm-up).
* Measured on the scratch model, one `predict_proba` takes 15.8 ms with sklearn's default
  OpenMP threads, and 7.75 ms with `threadpool_limits(1)`.
* The live app has two such models (spatial and activity).

**A busy consumer starves the readers.** When the consumer is busy, it takes the lock
again before a waiting reader is scheduled, so the reader waits out the whole burst. Five
readers each built their own frame under that lock:
* the 10 Hz websocket;
* the app's 2 Hz event watcher;
* the crew's 2 Hz movement watcher;
* the 1 Hz journal;
* the steward.

**Two more problems slowed the websocket:**
1. Its loop was "sleep 100 ms, then work", so its rate was 1 / (0.1 s + work + loop lag).
2. Its lock-taking builds (`status`, `heatmap`, and `eyes` at 10 Hz) ran on the event loop
   itself. Every wait for the lock stalled every route and the app's watcher too.

### Fix
1. **The consumer thread publishes the frame** (`engine.publish_frame`).
   * `run_engine` calls it after each packet, and every 0.2 s when nothing arrives.
   * It rebuilds at most every 50 ms (20 Hz, twice the websocket's rate).
   * Readers call `engine.latest_frame()`: one attribute load, no lock, a shallow copy
     (the hub adds the simulator's truth to it).
   * `hub.frame()`, the hub's journal and the app's `aankhen_watch` all read this
     published frame.
   * `engine.frame_message()` itself is unchanged, so the tests and other callers that
     build a fresh frame still get one.
2. **The streamer runs on a schedule**, sleeping until the next 100 ms mark; an overrun
   tick is not caught up. Status, heatmap and eyes are built on a worker thread beside the
   schedule. A tick skips them while the previous build is still waiting: status and
   heatmap are latest-wins anyway, and eyes columns keep accumulating for the next build.
3. **In the simulator, truth is computed at the frame's own time**, not the engine's
   current time. Otherwise truth would be up to 50 ms ahead of the tracks it is matched
   against.

### Before and after
**Method** (`bench_app.py`, kept in the scratchpad):
* The hub runs its simulator at the real board's 290 CSI packets/s, in a scratch
  `AANKHEN_DATA_DIR` with a simulator-trained spatial model, so the learned step runs.
* The app's real consumers run at their real rates:
  * on the asyncio loop: `Streamer._loop` (real code, one viewer that wants eyes) and the
    app's 2 Hz watcher;
  * on threads: the crew's `MovementWatcher` through `Agent.run` (its `avg_ms` is what the
    crew page shows) and the steward's `aankhen()` read.
* "Load" is one extra Python thread that keeps the GIL busy for a given share of every
  40 ms. It stands in for the rest of the app (voice, routes, UI) competing for the
  interpreter.
* "Before" is `git HEAD` of `aankhen/` and `crew/`. Each run lasts 30 s.

| load | version | stream frames/s (distinct) | movement tick avg_ms | app watcher read, mean | event-loop lag, mean / p95 |
|---|---|---|---|---|---|
| none | before | 9.37 (9.37) | 9.59 | 0.18 ms | 11.8 / 13.7 ms |
| none | after | **9.97** (9.80) | **0.28** | 0.00 ms | 8.5 / 13.0 ms |
| 75 % | before | 6.10 (6.10) | 19.5 | 13.8 ms | 28.1 / 125 ms |
| 75 % | after | **9.97** (7.47) | **0.47** | 0.00 ms | 13.6 / 27.5 ms |
| 90 % | before | 2.23 (2.23) | 581.9 | 11.2 ms | 95.9 / 746 ms |
| 90 % | after | **9.97** (3.40) | **1.19** | 0.00 ms | 14.9 / 28.7 ms |

The live app's ~106 ms tick and 6.6 Hz stream fall between the 75 % and 90 % rows of the
"before" runs.

Earlier runs under the same loads showed the same picture. The intermediate version, which
only had the published frame and the schedule (no worker thread), gave:
* movement tick: 7.1 → 0.6 ms at 75 % load and 223 → 1.4 ms at 90 %;
* stream: 9.2 Hz at 75 % but only 4.3 Hz at 90 %.

That was because the eyes build still blocked the event loop. Moving it to the worker
thread brought the stream to a steady 9.97 Hz.

### What is not fixed
**Under heavy load the consumer itself is the bottleneck.** At 90 % load the engine's
queue grew to ~5900 packets, and only 3.4 distinct frames/s were published. The stream
now runs at 10 Hz, but at that load some of its frames repeat. The cause is GIL-starved
packet processing, not the readers. The cheapest next step is `threadpool_limits(1)`
around the `predict_proba` calls, which halves the lock hold (15.8 → 7.75 ms per call,
measured). That changes `learn.py`/engine behaviour and was left for a separate change.

**These still take the lock on their own threads:**
* the steward's `hub.status()` (every 10 s, up to 159 ms at 75 % load);
* `away.py` and `energy_service.py` (`frame_message()`, every 5 s or less).

None of them is on the event loop.

## Tests
New tests are in `aankhen/tests/test_stream.py` (11), plus one in
`crew/tests/test_steward.py`. They cover:
* synthetic packets → hour chunk;
* the boxcar, the learned estimate and phase off;
* the hour merge and its idempotence;
* retention;
* refusal of simulation, replay and unknown sources;
* a simulation hub that writes nothing;
* a hardware hub that records unless switched off;
* a frozen writer that never slows the engine;
* a lock-free published frame;
* 20 Hz publishing;
* a 10 Hz streamer with a 30 ms tick;
* the steward's line.

Suite results: `aankhen/tests` + `crew/tests` 384 passed; `app/tests` 531 passed.

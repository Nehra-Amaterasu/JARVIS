# Aankhen test audit, and the 10-25 "board not read" P0 (2026-10-23 .. 10-25)

**Question.** Do the Aankhen tests enforce the agreed constraints (Safety: firmware and
link; Honesty: Aankhen), or do they pass for the wrong reasons? Where are the gaps, and
why does the suite take 230-875 s? Then, mid-audit, a P0 from the live app: "Aankhen
does not read the board" (ESP32-S3, firmware 3.5.0, COM9).

**What it changed.** 7 bugs fixed in code (below), 2 more in the P0, 31 tests added
(19 honesty/link, 9 P0, 3 rewritten), the suite runs on a scratch data folder, the
end-to-end runs share one capped process pool, and the hub now says in one code and one
sentence why the board is or is not being read (shown in the viewer).

## P0: why the software did not read the board (10-25)

Read-only evidence (nothing written to the board, the app or data/):

| check | finding |
|---|---|
| `list_ports` | COM9 = 303A:1001, Espressif USB-Serial-JTAG: the board is plugged in |
| COM9 opened read-only, DTR/RTS deasserted before open, 5 s | **the port was free: the app was not holding it**, so it was not reading USB |
| the 16 430 bytes read | 67 frames (48 LOG, 19 STATUS), 0 CRC errors: the 3.5.0 wire format decodes exactly as the host expects (header, STATUS JSON, 921600/CDC) |
| the board's STATUS | `"wifi":"connecting"`, `"rssi":-89..-91`, `"csi_hz":0`, `"reset":"power-on"`, `"net":{"key":""...}` |
| the board's LOG | `joining <network>` then `wifi: not connected yet, will keep trying` on a loop |
| firmware `connectWifi()` | blocks `loop()` up to 20 s per try, a try every 15 s while not joined: **silent on USB ~57 % of the time** |
| boards.py (before) | a port silent at its looks was asked again only for 30 s after it appeared; a port that showed text but no frame ("foreign", e.g. the ROM boot log) never again until unplugged |
| jarvis.log (10-24) | `Exception in thread aankhen-engine ... threadpoolctl ... OSError: GetModuleFileNameEx failed`: the consumer thread died on one packet and nothing read the board until a restart |
| activity journal 10-25 | 67.5 s of hardware mode after the app started (01:13), then none: the board was read, then lost |
| secrets.h vs data/app/esp32_link.json | LINK_KEY_VALUE defined, 64 hex, identical to the app's key (compared, never printed). `net.key ""` only means the link starts after Wi-Fi joins |

**Causes, in order.**
1. **The board is not on the Wi-Fi** (signal -89..-91 dBm against -73..-80 at the desk in
   the 10-12 recordings). With no Wi-Fi there is no CSI at all (`csi_hz 0`) and no Wi-Fi
   link: nothing to sense even when USB is read. Fix is physical: nearer the router (or
   a 2.4 GHz extender), or check the network name/password in secrets.h.
2. **While it fails to join, the firmware is silent on USB 20 s of every ~35 s**, so the
   app's 2 s look at the port usually found it silent, and after 30 s stopped asking.
   The hub ran the simulation beside a working board. *Fixed host-side:* Espressif's
   native USB port (VID 303A) is asked again every 10 s while silent or "not Aankhen"
   (`boards.NATIVE_RETRY_S`); safe because that port is never an Uno and DTR/RTS are
   deasserted before every open. CH340 and Arduino ports keep the old rule.
3. **One exception ended the engine thread for good** (threadpoolctl listing DLLs while
   the web view unloads one). *Fixed:* `learn._proba_one_thread` builds the thread
   controller once and falls back to an unlimited prediction; `run_engine` catches a
   failing packet, counts it (`status.engine_errors`, `engine_last_error`) and goes on.
4. **Nothing said which of these it was.** *Fixed:* `AankhenHub.why()` (in `info()` and
   the status message, shown as the "board" row in the viewer): `ok`,
   `board_no_wifi`, `no_csi`, `usb_busy`, `not_aankhen`, `usb_silent`, `no_board`,
   `wifi_link_off`, `wifi_key_mismatch` (fingerprints compared), `wifi_no_answer`
   ("Windows Firewall is probably dropping UDP 47270 inbound"), `wifi_not_set_up`,
   `engine_errors`, `simulation`, `replay`.

**Not fixed here, recommended.** Firmware: make the Wi-Fi retry in `loop()` non-blocking
(start `WiFi.begin` and poll `WiFi.status()` each pass) so STATUS and USB relay commands
keep flowing while it retries; today a relay command over USB can wait up to 20 s. The
app (outside aankhen/) should show `info()["why"]["text"]` on its Aankhen tab. The
firewall rule for UDP 47270 is still needed for the Wi-Fi link once the board joins.

Tests: `aankhen/tests/test_board_p0.py` (a 3.5.0-format fixture with the real STATUS
field set and made-up values; the finder re-asking a silent or booting Espressif port
after the grace; a CH340 still left alone; one failing packet not ending the thread; a
failing thread limit still answering; `why()` for no Wi-Fi, busy port, key mismatch,
firewall, link compiled out).

## Constraint -> test matrix

"new" = added in this audit. Gaps found are in the next section.

| constraint | enforced by |
|---|---|
| Tests never open serial ports / LAN / app | fakeserial, fakenet on 127.0.0.1 (all hub/board/net tests); new: scratch `AANKHEN_DATA_DIR` in conftest + `test_the_tests_never_touch_the_real_data_folder` |
| Firmware: relays boot OFF | new `test_firmware_boots_every_relay_off_before_the_network_starts` (off level latched before `pinMode`, `bootRelays()` before `connectWifi()`, kept only across a marked software reset) |
| Firmware: Wi-Fi commands need HMAC + rising counter, replays dropped | test_netlink (verify, wrong key, replayed CMD/HELLO/READY/DATA); fakenet mirrors the C side; new: tag checked before the counter in `linkHandle`, forged/truncated/oversize/lying-length property test, 64-bit counter rollover, reorderer-once property, replay cannot keep a dead session alive; non-HMAC relay paths compiled out by default |
| A switch counts only on the board's confirmation; reconnects adopt | test_hub_net (`set_relay_counts_only_when_the_board_reports_it`, `relays_keep_their_state_when_the_laptop_goes`) |
| Honesty: "unsure" below floors | test_zones_belief (floors, OOD, stale reference); new: contract property test (60 seeds x 80 steps, NaN/inf/negative inputs, clock jumps), floors pinned at 0.8/0.6/0.7, every "unsure" says why |
| Honesty: out of training range -> can't tell | test_zones_belief OOD guard; new: infinite features refused, missing (NaN) ones pass |
| Honesty: belief never > floor when unsure / uninformative | new: an uninformative model never decides presence on 25 random zone maps |
| No "waving" | test_zones_belief (map, engine); new: in the property test over every output |
| No zone without a reference for current firmware + fan | test_zones_belief (stale reference, external fan); new: firmware change and fan change without a reference, via STATUS and the Uno path |
| Never present simulation as real | test_stream (never recorded), test_teach (teach-sim-*), source stamping; new: every message of a simulated engine says simulation, no sensor "live", the sim reference survives STATUS, no reference ever saved from a simulation, a renamed simulated recording never trains |
| Packet gaps | test_csi (resampler breaks), test_hbe; new: a 25 s gap moves the belief no more than 5 s |
| Speed | one pool for e2e, scratch data, shared baseline, shorter drill/teach (below) |

## Gaps, weak tests and wrong-reason passes found

1. **Uniform prior sat on the floor.** 12 of 15 zones are in the room, so P(in room)
   started at 0.7999999 against `STATE_FLOOR` 0.8; any zone file with one zone fewer
   outside said "in_room" from the prior alone. No test tried an uninformative model.
2. **Coarse posterior used as a likelihood.** A model answering its own prior
   (0.2 each) counted "gone" twice (empty + outside): 20 windows read "empty" at 94 %.
   `test_coarse_classes_spread_evenly...` asserted the buggy values (tautological: it
   restated the code).
3. **NaN evidence counted as evidence.** A NaN zone-model output changed nothing but
   cleared "no evidence yet"; a NaN motion would have made every zone NaN.
4. **The OOD guard let +-inf through** (`not isfinite -> continue`).
5. **Simulation reference went stale at its first STATUS**: a simulated engine looked
   "aankhen-simulator" up in the real reference store and never named a zone; it could
   also save a simulated empty room into the real store via the drill.
6. **Teach trusted the file name only.** The teach test trained on recordings whose
   header says `"source": "simulation"` and called them "your recordings"; the
   "never trained on" test passed even if the filter broke, as long as the name started
   with teach-sim-. Now the header and labels are checked too, and the real-recording
   stand-in carries a hardware header.
7. **Replayed DATA kept a dead board's session alive** (each verified replay reset the
   quiet timer).
8. Weak: `test_the_host_drops_a_replayed_data_datagram...` asserts
   `frames delta <= datagrams` (nearly always true); covered now by the reorderer
   property test and the liveness test.
9. Not hermetic: in the main checkout every test hub loaded his real 43 MB models,
   room, baseline and references, and a fake board in hardware mode wrote into his real
   activity journal. Fixed with the scratch folder (conftest refuses to run if any
   aankhen module was imported first).
10. Flaky under load: the eyes push timing (169 us vs 100 at 99 % CPU) -> best of five.
11. Original end-to-end pool (11 workers) **crashed on this laptop**: 6 errors, "DLL load
    failed ... The paging file is too small" (commit 25/31 GB, 2.5 GB free). Capped at 6.

**Constraint that looks wrong / needs a decision (reported, not changed).** "Wi-Fi commands
need HMAC + rising counter": firmware 3.5.0 still has two other Wi-Fi relay paths, HTTP
`/relay` (token header, replayable on the LAN) and MQTT (broker login). Both are compiled
out unless RELAY_TOKEN_VALUE / MQTT_USER_VALUE are set, and secrets.example.h leaves them
off (now tested). Either drop them or accept them as documented exceptions. Also: relays
are restored ON after an OTA software restart (by design, `bootRelays`), which is a
narrow exception to "relays boot OFF".

## Fixture realism: simulator vs the real board (data/aankhen/recordings, read-only)

| | real board (10 recordings, 10-12) | simulator (60 s empty / still) |
|---|---|---|
| CSI rate | 92-108 Hz (one 238 Hz session) | 94-95 Hz |
| inter-packet p99 | 13-24 ms | 20 ms |
| longest gap | 0.3-1.5 s typical, **21-30 s** stalls in 3 recordings | 0.37-0.39 s |
| sequence frames lost | 0-5817 per recording | 10-18 |
| RSSI | **-73..-80 dBm, sd 1.0-2.4 dB**, range -91..-64 | -46 / -50 dBm, sd 0.0 |
| relative amplitude jitter | **0.07-0.145** | 0.025 (3-6x cleaner) |

So the synthetic data is cleaner than the board: ~30 dB stronger, constant RSSI, 3-6x
less amplitude jitter, no long stalls. The end-to-end bounds are therefore internal
consistency, not field accuracy (their docstring already says so). Added coverage for
the stalls (25 s gap) and non-finite values; a noise-matched simulator mode (RSSI jitter
and amplitude noise at the measured levels) is the next step, and is the honest way to
calibrate the e2e bounds.

## Bugs fixed (code)

| file | fix |
|---|---|
| belief.py | prior 50/50 in/out of the room; coarse posterior / training prior; `update()` refuses non-finite likelihoods and returns whether it applied; non-finite motion = no reading; inf features out of range; "unsure" always says why |
| engine.py | passes the spatial model's priors; a simulation keeps its reference and never recalibrates into the real store; `note_error` + `engine_errors` in status; run_engine survives a failing packet |
| transport.py | only a new counter proves the board alive |
| teach.py | `is_simulated()`: name, header or labels |
| learn.py | one cached threadpoolctl controller, unlimited fallback on OSError |
| boards.py | Espressif native USB re-asked every 10 s while silent/foreign |
| hub.py, web/index.html | `why()` and the viewer's "board" row |

## Speed

Machine during the audit: 12 logical CPUs at up to 99 % load (browser, OneDrive, other
sessions), 2.5 GB RAM free, commit 25/31 GB: wall times vary 2-10x run to run (the
world-model test took 31 s, then 303 s; `import torch._dynamo` alone took 49 s of disk).
pytest-xdist is **not** in the venv (not installed, as asked).

TIMINGS_PLACEHOLDER

What changed: scratch data folder (no 43 MB model loads per hub start in the main
checkout); one `sim_baseline` per session instead of per module; all 13 end-to-end runs
in one pool, longest first, capped at 6 workers (the sleep runs no longer wait for a
second pool; no paging crash); drill sessions 80 -> 50 s and versioning checked with a
second save instead of a second training and a 1.1 s sleep; teach recordings simulated
once per module (4 x 75 s -> 2 x 75 s). `@pytest.mark.slow` marks the 16 long runs for a
quick loop; the default run and the merge gate run everything:

    .venv\Scripts\python.exe -m pytest aankhen/tests -q              # merge gate: all
    .venv\Scripts\python.exe -m pytest aankhen/tests -q -m "not slow" # quick loop
    .venv\Scripts\python.exe -m pytest aankhen/tests -q -m slow       # the slow set alone

## Sources

- Real recordings: `data/aankhen/recordings/*.akr` (10-12), read with `transport.iter_recording`.
- Live board bytes: COM9, 5 s read-only capture, 10-25 (kept in the session scratchpad,
  not in the repo: it carries the home network's name).
- Logs: `data/app/jarvis.log` (10-24 engine thread traceback), `data/aankhen/activity/2026-10-25.jsonl`.
- Firmware: `aankhen/firmware/firmware.ino` (`connectWifi`, `linkHandle`, `initRelay`,
  `bootRelays`, `startLink`, STATUS `net`).
- threadpoolctl `_find_libraries_with_enum_process_module_ex` (GetModuleFileNameEx).

# The ESP32 goes on the wall: a Wi-Fi link for its frames and its relays (2026-10-16)

**Question.** The ESP32-S3 (firmware 3.4.0) leaves the USB cable for a plastic box beside
the switchboard, on an unmodified 5 V phone charger. It must keep sensing (Wi-Fi CSI at
500 captures a second), drive up to five relays (HL-52S, active-low: light, fan, three
more lights), and take JARVIS's commands, with no cable. How do the frames and the commands
cross the home Wi-Fi without letting anybody else on that Wi-Fi switch mains, without
eating the channel the CSI needs, and without the app downstream (engine, belief, drills,
the raw-stream recorder, the teachers) noticing anything but the link's name?

**Method.** Read the code at `7175dc0` (firmware 3.4.0, `transport.py`, `hub.py`,
`boards.py`, `limbs.py`, `uno.py`, `room_config.py`, `board_ctl.py`) and the 10-13 OTA and
10-15 limbs notes. Built the firmware side and the laptop side together, with one Python
copy of the board's protocol (`aankhen/tests/fakenet.py`) to test against on 127.0.0.1.
Compiled the firmware with the IDE's arduino-cli (`esp32:esp32:esp32s3:CDCOnBoot=cdc`,
core 3.3.12) in scratch copies with stand-in secrets. Nothing was flashed, no serial port
was opened, no datagram went to a device on the LAN, and the running app on 127.0.0.1:8777
was not touched.

## Design

### Two links, one board
- **USB stays exactly as it was.** `AkWriter` now assembles each frame in one buffer and
  writes it in one call instead of four: the same bytes. It hands the finished frame to a
  `tee`, the Wi-Fi batch.
- **Wi-Fi carries the same AK frames.** `NetSource` (transport.py) unwraps them from the
  datagrams and feeds the same `StreamDecoder`, recorder and engine as `SerialSource`. It
  says `kind = "hardware"`, so every `kind == "hardware"` gate downstream (raw stream,
  teachers, journal, drill recording, presence evidence) works unchanged; `link` is `"wifi"`.
  Tested: the engine decodes the board's STATUS and CSI over the fake link, and a recording
  made on it replays through `ReplaySource` with the board's frames and zero CRC errors.
- **The hub picks.** Setting `prefer`: `auto` (USB when a board has identified itself on
  USB, else Wi-Fi when the key is set and the board answers a HELLO, else the simulator),
  `usb`, or `wifi`. The hot-plug watcher follows the board in `auto`: a USB board that
  appears takes over from Wi-Fi ("USB wins": no airtime, no key), and a USB board silent for
  10 s hands over to Wi-Fi when the board answers there (the moment it goes into the box).
  A link a person picked is never moved.
- **Both links take commands on the board.** Decided, not arbitrated: a USB command needs
  the cable, a Wi-Fi command the key, so both are authorized, and the laptop only ever uses
  one at a time. Every command is answered with a STATUS showing all relays, whichever link
  switched them.

### The protocol (`aankhen/netlink.py`; the C side is the WI-FI LINK section of firmware.ino)
Datagram: `"AKN1"` | kind u8 | flags u8 | length u16 | session u32 | counter u64 |
payload | tag[16], tag = HMAC-SHA256 over everything before it, first 16 bytes. Kinds:

| Kind | Direction | Key | Payload |
|---|---|---|---|
| HELLO | laptop → board | link key K | the laptop's 16-byte nonce |
| WELCOME | board → laptop | K | laptop nonce, board nonce, FW_VERSION |
| READY | laptop → board | session key Ks | (counter 1) |
| DATA | board → laptop | Ks | whole AK frames |
| CMD | laptop → board | Ks | one AK COMMAND frame (CRC-checked again) |
| KEEPALIVE | laptop → board | Ks | every second |
| BYE | laptop → board | Ks | ends the session now |

`Ks = HMAC(K, "AKN1 session" | session | laptop nonce | board nonce)`. Ports: the board
listens on UDP 47269 (`LINK_PORT`, config.h), the laptop on UDP 47270.

### Security
- **The key.** 32 random bytes (`secrets.token_bytes`) the app makes on its first start,
  kept in `data/app/esp32_link.json` (git-ignored), given out only by an explicit POST as the
  `#define LINK_KEY_VALUE "…"` line for `secrets.h`, never in a view, a log or an event (a
  test checks the bus history). Both sides show `fingerprint = SHA-256("AKN1 fingerprint" |
  key)[:4]` instead; the board puts its own in STATUS `net.key`, so the app says "the board
  has the same" or "flash the line again". Without the define the firmware compiles with no
  link at all (`#warning`), and a placeholder or a non-hex value fails the build
  (`static_assert`).
- **Forgery.** Every datagram is checked with HMAC-SHA256 in constant time; the board
  answers nothing it cannot verify (so it is no amplifier) and drops datagrams from any
  address but the session's.
- **Replay.** Laptop → board counters must rise strictly: a captured CMD sent again is
  dropped (tested: "fan on" replayed after "fan off" leaves the fan off, `replays` counted).
  A captured HELLO only makes a pending session that nobody can finish without K (tested: a
  forged READY and an old READY both fail; the live session is untouched). A WELCOME that
  does not echo the laptop's own nonce is not a handshake (tested). Board → laptop DATA
  goes through a reorder window that drops duplicates and late arrivals.
- **Reflection.** Every kind travels one way only.
- **Remaining paths.** USB (physical), HTTP `/relay` (only with `RELAY_TOKEN_VALUE`, as
  before), MQTT: 3.5.0 subscribes only with a broker login (`MQTT_USER_VALUE`), since an
  open broker would be an unauthenticated relay switch; JARVIS stopped publishing there on
  10-15. OTA unchanged (PBKDF2 challenge, `OTA_PASS_VALUE`).
- **Not covered.** The datagrams are signed, not encrypted: someone on the home Wi-Fi can
  read the CSI and the relay states (whether the light is on). The relay states were
  already readable on `/status` with the token only; this is a wider read exposure on the
  LAN, accepted for now and written down here.

### Timing
The frames carry the board's `esp_timer` microseconds, and the engine times everything by
them (`engine.py` uses `p.timestamp_us`); host arrival is used only for liveness
(`last_host`) and as the recorder's chunk time. Over Wi-Fi the arrival jitters by
milliseconds and comes in batches of ~8 frames per datagram (up to 20 ms late); none of
that reaches the signal path. A replay at speed 1 of a Wi-Fi recording plays in those
batches; its timestamps are the board's.

### Relays on the board
- `RELAY_TABLE` in config.h: up to 8 rows of name and pin; defaults light 4, fan 5,
  light2 6, light3 7, light4 8; `-1` disables a relay (STATUS `null`, "not wired").
- Boot OFF, except the OTA-restart restore (unchanged). Ending a session, losing Wi-Fi or
  losing the laptop never touches a relay.
- STATUS adds `relay_pins`, `mdns` (`aankhen.local`), `ip` (as before) and `net` (key
  fingerprint, the laptop it streams to, datagrams, commands, bad, replays, send failures).

### The app
- **Limbs** switches an `esp32` device through `hub.set_relay`, which sends the command and
  waits for the board's STATUS to show the new state (1.2 s, one retry): a switch counts
  only with the board's word, as with the Uno. Offline, the switch is not sent, and the
  event says which board and why ("the ESP32 is not answering over Wi-Fi (192.168.1.50):
  …"). A device the board lacks or has on pin -1 is said, and the room shows it off.
- **On (re)connect the room ADOPTS the ESP32's relays** (`resync_hardware`), then runs the
  presence rule. 3.4.0 PUSHED the app's state instead: on the wall, after a power cut, the
  board comes back with everything off, and pushing a stale "light on" would switch mains at
  whatever hour the link returned.
- **One owner per device**: each device names one board (`devices.json`), and ESP32 pins are
  checked against the safe-GPIO list. The wall box's file is
  `app/jarvis_app/devices.esp32-box.example.json` (light, fan, light2-4 on GPIO 4-8, all on
  the ESP32). The view warns when `devices.json` and the board's `relay_pins` disagree.
- **UI.** Limbs pill: "relay board · Wi-Fi"; device cards: "Wi-Fi · confirmed by board";
  board card pill: "Wi-Fi · 192.168.1.50 · -61 dBm" or "USB · COM7"; Connect: "Wi-Fi
  (ip, rssi)" or "USB (COMx)". A new "Wi-Fi link" card: link preference, board address,
  "Show the secrets.h line", the firewall rule with a copy button, "Connect over Wi-Fi".
- **Firewall** (the app never runs it): `New-NetFirewallRule -DisplayName "JARVIS Aankhen
  ESP32 link (UDP 47270)" -Direction Inbound -Protocol UDP -LocalPort 47270 -Profile Private
  -RemoteAddress LocalSubnet -Action Allow`.

## Numbers

**Firmware size** (arduino-cli, core 3.3.12, same stand-in secrets with OTA and the relay
token; app slot 1,310,720 bytes):

| Build | Flash | Slot | RAM (globals) |
|---|---|---|---|
| 3.4.0 (`7175dc0`) | 998,085 B | 76 % | 52,056 B |
| 3.5.0 with `LINK_KEY_VALUE` | 1,002,553 B | 76 % | 56,248 B |
| 3.5.0, Wi-Fi/SSID only (no OTA, token or link) | 975,833 B | 74 % | 52,264 B |

3.5.0 costs +4,468 B of flash over 3.4.0 (mbedtls's HMAC and mDNS were already linked for OTA) and
+4,192 B of RAM (the 1,392-byte batch, the 1,393-byte receive buffer, the 1,042-byte frame
buffer). 308,167 B of the slot stay free for OTA.

**Bandwidth** (the real `Batcher` on the board's frame sizes: CSI_GAIN 166 B, CSI_LINK 167 B,
a 738-byte STATUS frame once a second):

| Traffic | Frames/s | Datagrams/s | Payload | Airtime @ 65 Mbit/s | one frame per datagram |
|---|---|---|---|---|---|
| link 1 at 500 Hz | 501 | 63.3 | 86.0 kB/s (0.69 Mbit/s) | 2.3 % | 10.9 % |
| + link 2 at 200 Hz | 701 | 88.3 | 120.3 kB/s (0.96 Mbit/s) | 3.2 % | 15.3 % |

At 26 Mbit/s the batched figures are 3.9 % and 5.5 % (unbatched 13.4 % and 18.8 %). The
airtime is a model, not a measurement on air: DIFS + mean backoff + HT preamble + SIFS + ACK
≈ 186 µs per frame plus the bits. The largest datagram measured was 1,367 B (< 1,400).

**STATUS size.** The longest 3.5.0 STATUS with the default table (five relays, a phone,
a session, every counter at 10 digits) is 872 B, under the 1,000-byte buffer and the host's
1,024-byte limit; a table that would not fit sends a short STATUS that still carries the
relays (never a cut JSON).

**On 127.0.0.1 against the fake board** (real hub and NetSource): start to `can_command`
93 ms; handshake 0.46 ms; relay confirmed in 0.3 ms median, 0.6 ms max over 40 switches;
2.2 s at 500 Hz: 1,102 frames, 0 lost, 0 bad tags. The first run of this measurement found
a bug: confirmations took 203 ms because `time.monotonic()` ticks every 15.6 ms on this
Windows Python, so a command's STATUS and the periodic one before it shared a timestamp and
the answer was skipped until the next STATUS. Status arrival is now timed with
`time.perf_counter()` and counted, not compared by time.

**Tests.** `aankhen/tests/test_netlink.py` (22: HMAC, tamper, keys, batching 500 → 63
datagrams byte-exact, flush timing, reorder/duplicate/late/lost, handshake, commands, wrong
key, replayed CMD/HELLO/READY/DATA/WELCOME, swapped datagrams decoded in order, reboot and
re-greet, silence, probe, DNS back-off, firmware constants and STATUS size against the C
source), `aankhen/tests/test_hub_net.py` (18: link choice, prefer, confirmation, unwired
relay, a lost command resent, offline error, relays kept when the laptop goes, engine and
recording on Wi-Fi, the watcher both ways), `app/tests/test_limbs_net.py` (6, end to end
through Limbs), `app/tests/test_esp32_link.py` (15), and additions to `test_limbs.py`,
`test_board_ctl.py`, `test_connect_truth.py`, and the UI's `esp32link.test.ts`.

## What changed
- **Replaced:** Limbs' push of the app's state to the ESP32 on reconnect (now adopt);
  `limbs._sent` (sent was not confirmed); `hub.can_command`/`command` being USB-only; the
  two hard-coded relays in the firmware (now `RELAY_TABLE`); MQTT relay switching without a
  login; `AkWriter`'s four writes (one buffer, same bytes); the relay test click limited to
  light and fan; "Relay board connected — room state pushed".
- **Added:** firmware 3.5.0 (Wi-Fi link, relay table, mDNS, STATUS `relay_pins`/`mdns`/`net`);
  `aankhen/netlink.py`; `NetSource` and `probe_board` in `transport.py`; the hub's link choice,
  `set_relay`, `board_relays`, `offline_reason`, and the watcher's USB/Wi-Fi following;
  `app/jarvis_app/esp32_link.py` and `routes_esp32_link.py` (`/api/esp32-link`); the
  example `devices.json` for the box; ESP32 pin checks in `room_config.py`; the Wi-Fi link
  card; `AANKHEN_NET=0` for the app tests (no HELLO to the LAN).

## For Aman
1. Limbs → Wi-Fi link → **Show the secrets.h line**; paste it into
   `aankhen/firmware/secrets.h` (keep `OTA_PASS_VALUE` there).
2. Once, in an administrator PowerShell: the `New-NetFirewallRule` line above.
3. With the board still on USB: Limbs → Firmware → Compile, then Flash → Over USB (3.5.0).
   Check the board card: `aankhen-3.5.0`, OTA on, the key fingerprints equal; press
   **Connect over Wi-Fi** once to see the pill turn to Wi-Fi.
4. Wire the relays (GPIO 4-8), close the box, power it from the charger, unplug USB.
5. When the Uno is unplugged for good: copy `app/jarvis_app/devices.esp32-box.example.json`
   to `data/app/devices.json` and restart the app. Until then the Uno keeps light and fan.

## Sources
- Code at `7175dc0`: `aankhen/firmware/{firmware.ino,config.h,aankhen_protocol.h}`,
  `aankhen/{transport,hub,boards,protocol,engine}.py`, `app/jarvis_app/{limbs,uno,board_ctl,connect,server}.py`,
  `core/room_config.py`.
- The installed esp32 core 3.3.12: `libraries/ESPmDNS/src/ESPmDNS.cpp` (`begin`,
  `enableArduino`), `libraries/ArduinoOTA/src/ArduinoOTA.cpp` (`setMdnsEnabled`, mDNS in
  `begin`/`end`).
- RFC 2104 (HMAC): https://www.rfc-editor.org/rfc/rfc2104 ; RFC 4868 (HMAC-SHA-256-128
  truncation): https://www.rfc-editor.org/rfc/rfc4868
- Microsoft, New-NetFirewallRule: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule
- Python docs, `time.monotonic` / `time.perf_counter` clock resolution: https://docs.python.org/3/library/time.html#time.get_clock_info
- `docs/research/2026-10-13-ota-flashing-and-relay-wiring.md`, `2026-10-15-limbs-modes-and-presence-on.md`.

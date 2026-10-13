# Aankhen firmware v3 (ESP32-S3)

Firmware 3.4.0. The sensor board for JARVIS's eyes. It streams raw Wi-Fi CSI to the laptop as
CRC-checked binary frames over USB: the router link at up to 500 captures a second, and
optionally a second link from a phone (section 7). Aankhen senses from radio alone. All
processing happens on the laptop (`aankhen`). Relays switch only on request
from JARVIS (MQTT) or a token-authenticated HTTP call.

## 1. Secrets

```bash
copy secrets.example.h secrets.h
```

Fill in `WIFI_SSID_VALUE` / `WIFI_PASS_VALUE` for the **2.4 GHz** network. Add
`OTA_PASS_VALUE` (12+ characters, your own, not the example's) before the board goes
behind the switchboard: without it the firmware has no OTA and only USB can update it
(section 4b). The router you
join is the CSI transmitter, so put the board on the far side of the room from it
for the Wi-Fi link to cross the room. Relay control is off until you add
`RELAY_TOKEN_VALUE` and/or `MQTT_URI_VALUE`. `secrets.h` is gitignored.

The v2 fields `AP_SSID_VALUE` / `AP_PASS_VALUE` are no longer used: v3 has no fallback
access point.

## 2. Wiring

Nothing but USB is needed for Wi-Fi sensing. The firmware also forwards an HLK-LD2450
radar's frames, should one ever be fitted; none is planned, and without one the board
simply sends none. The pins it would use:

| LD2450 | ESP32-S3 |
|---|---|
| 5V | 5V (the radar needs 5 V and >200 mA; at 3.3 V its range collapses) |
| GND | GND |
| TX | GPIO 18 (RADAR_RX_PIN) |
| RX | GPIO 17 (RADAR_TX_PIN) |

Relays: `config.h` puts the light relay on **GPIO 4** and the fan relay on **GPIO 5**,
active-low (the usual optocoupler module: ON when IN is pulled LOW). Set a pin to `-1`
to disable that relay. The JARVIS app edits these through a form (Limbs → Firmware →
Abilities), which refuses strapping pins (0, 3, 45, 46), the USB pins (19, 20), the
flash and PSRAM pins (26-37), UART0 (43, 44), the RGB LED (38, 48) and the radar's
pins, and rewrites only the number on each `#define` line.

| Relay module | ESP32-S3 |
|---|---|
| VCC | 5V (a 5 V module's coils need 5 V) |
| GND | GND (shared: the IN signal needs the same ground) |
| IN1 | GPIO 4 (`RELAY_LIGHT_PIN`) |
| IN2 | GPIO 5 (`RELAY_FAN_PIN`) |

Mains goes through COM and NO, on the live wire only, with the breaker off. If a relay
will not release when told off, the ESP32's 3.3 V HIGH is not enough for that module's
5 V input: move its VCC to 3V3, and on a module with a JD-VCC jumper remove the jumper
and feed JD-VCC 5 V. The Limbs tab's "Wire your relays" card has the checklist and a
1-second test click per relay (with the board's confirmation as a receipt). Mains wiring
is not a hobby shortcut: use a proper relay module with isolation, and have it checked.

**Powered from the switchboard.** Later the board runs from a 5 V DC supply (enclosed,
fused on its mains side) into its **5V** and **GND** pins: never 230 V to the board. USB
and the 5V pin are two of the DevKitC-1's three power inputs, used one at a time
(Espressif's user guide): unplug USB once the supply feeds 5V. Budget: the S3 peaks near
0.35 A on Wi-Fi and a 5 V relay coil draws ~70 mA, so a 1 A supply has margin. STATUS
`"reset":"brownout"` after a relay click means the supply sags under the coils.

## 3. Receiver gain (recommended)

The ESP32-S3 picks its receive gain per packet, close to at random, and the CSI
amplitudes carry it. Without knowing it, the host has to divide every packet by its
own median, which also discards most of what a person does to the signal. The
physics model (`python -m aankhen physics`) puts breathing visibility at the desk at
~29 % of positions without it and ~97 % with it, on the default layout.

Espressif's `esp_csi_gain_ctrl` reads that gain from the packet. With it, the board
sends `CSI_GAIN` frames for the router link and fills the gain block of every link-2
`CSI_LINK` frame (STATUS says `"gain":"compensated"`). It is switched by `AK_GAIN_LIB`
in `config.h` (on). Set it to 0 to build without it (`"gain":"unavailable"`).

**Vendored here**: `libraries/esp_csi_gain_ctrl/`, from `espressif/esp_csi_gain_ctrl`
**0.1.5** (ESP Component Registry; source repository github.com/espressif/esp-csi),
Apache-2.0 (`LICENSE` kept beside it). Only the ESP32-S3 archive built for **ESP-IDF
5.5** is kept, because the Arduino-ESP32 core 3.3.x is IDF 5.5 and another IDF's
archive does not link. It is closed source, a precompiled `.a`. Checksums and what
was taken: `libraries/esp_csi_gain_ctrl/ORIGIN.md`.

The build must be told where it is, with `--libraries aankhen/firmware/libraries`
(section 4). Without that, the compile stops at `esp_csi_gain_ctrl.h: No such file`.
That is deliberate. Firmware up to 3.2 probed with `__has_include`, which arduino-cli's
library discovery never answers, so the gain stayed off even with the library installed.
On boot STATUS shows `"gain":"recording"` for ~1 s, then `"compensated"`.

Then run `python -m aankhen validate`. It measures how accurate the compensation
is (packet-to-packet jitter in an empty room), and the physics predictions use that
measured value.

## 4. Flash

Arduino IDE: copy `libraries/esp_csi_gain_ctrl` into your sketchbook's `libraries` folder
once, then board **ESP32S3 Dev Module**, **USB CDC On Boot: Enabled**, Upload.
Or from a terminal:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc --libraries aankhen/firmware/libraries aankhen/firmware
arduino-cli upload  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc -p COM9 aankhen/firmware
```

Use the board's native USB port (it shows up as Espressif `303A`). Use a data
cable; charge-only cables are common and look identical.

Close the JARVIS app (or stop Aankhen) before uploading from a terminal: while Aankhen
uses the board it holds the port, and the upload would find it busy.

**From the JARVIS app** (Limbs → Firmware): Compile runs the same `arduino-cli compile`
into `data/app/firmware/build` (the image carries the Wi-Fi password, so it stays in
the private data folder) and shows the size against the 1,310,720-byte app slot.
Flash → Over USB asks the server for a plan, shows it, and uploads only after you
confirm. The app first stops Aankhen's serial link and claims the port so nothing
probes it mid-upload, then restarts Aankhen on the same port.

## 4b. Flash over Wi-Fi (OTA)

With `OTA_PASS_VALUE` in `secrets.h`, the firmware runs ArduinoOTA (built into the
Arduino-ESP32 core): it listens on UDP 3232 as `aankhen`, and STATUS says `"ota":true`.
The core answers a PBKDF2-HMAC-SHA256 challenge, so the password never crosses the air.
Without the define, OTA is not compiled in at all: an open OTA port would let anyone on
the Wi-Fi replace the code that switches mains.

The first OTA-capable firmware has to go over USB once. After that:

- **JARVIS app**: Limbs → Firmware → Compile, then Flash → Over Wi-Fi. The board's
  address is learnt from its STATUS while it is on USB, or typed on the board card. The
  app asks for the OTA password in the confirm dialog, never stores it, and hands it to
  the core's `espota.py` through the environment rather than its command line.
- **Terminal**: `python <esp32 core>/tools/espota.py -i <board-ip> -p 3232 -a <password> -f firmware.ino.bin`.

During the upload (10-30 s) the board pauses sensing: the 500 Hz router pings and a
phone's link 2 would compete with it for airtime. It checks the image, then restarts
into it. The relays come back as they were: their states go to RTC memory just before
that restart and are restored only after a software restart (a power cut or brownout
still starts with everything off). A failed upload resumes sensing.

Windows may ask whether Python may use the network the first time: allow it on private
networks. espota listens for the board to connect back for the data.

**Without USB, the board still reports.** `GET http://<board-ip>/status` answers with
the firmware version, uptime, RSSI, CSI rate, OTA and the last reset reason; with the
`X-Aankhen-Token` header (`RELAY_TOKEN_VALUE`) it answers the full STATUS JSON, relays
included. The JARVIS app reads it for the board card (set `AANKHEN_RELAY_TOKEN` for the
full version).

How JARVIS finds the board: not by its USB id (a CH340 is on ESP32 boards and on
Arduino Uno clones alike) but by what it says. Each USB serial port is listened to,
never written to, until a CRC-valid Aankhen frame arrives; the 1 Hz STATUS frame is
the handshake. Nothing is sent to a port before that, so an Uno plugged in beside the
ESP32 never receives a relay command. A board plugged in while the app runs is picked
up within a few seconds of its first STATUS frame (`aankhen/boards.py`).

## 5. Check it

```bash
cd C:\Projects\JARVIS
.venv\Scripts\python.exe -m aankhen doctor
.venv\Scripts\python.exe -m aankhen serve --port COM9
```

Open the JARVIS app → **Aankhen** → **ESP32**. The banner must turn cyan
("LIVE · ESP32 hardware"), and the Sensors card should show:

- `Wi-Fi CSI live ~100 Hz`. If it's far lower, the router is rate-limiting pings
  or the board is in power save.
- `ESP32 … crc_ok true`. The firmware checks its own CRC against the Python one at boot.

## 6. Calibrate, validate, benchmark

```bash
python -m aankhen calibrate --seconds 70          # room EMPTY, you outside
python -m aankhen record --label empty   --seconds 60
python -m aankhen record --label walking --seconds 60
python -m aankhen record --label sitting --seconds 60
python -m aankhen record --label lying   --seconds 60
python -m aankhen bench
python -m aankhen validate                        # guided: paced breathing at desk and bed
```

`bench` prints recall, false alarms and latency against those labels, measured on
the real room rather than the simulator. `validate` is the ground truth for
breathing. You breathe with a metronome (12/min) at the desk and on the bed, and the
detector must find exactly that rate. It also measures the room's own slow signal
wander and the gain compensation's accuracy, the two numbers the physics model can't
know, and saves them so `python -m aankhen physics` predicts with them.

## 7. Second link: your phone

**What it is.** A phone on the home Wi-Fi becomes a second transmitter. The board
pings it (`BEACON_PING_HZ`, 100 by default, in `config.h`). The phone sends each reply
to the router, and the board overhears it in promiscuous receive while it stays
connected as a station. Each overheard reply is a CSI capture of the phone → board
path. Aankhen then sees the room along two radio paths: router → board (link 1) and
phone → board (link 2). It is radio only: the phone transmits and records nothing.
Link-2 captures travel as their own frame type (`CSI_LINK`, 0x08) and never mix into
link 1.

**Why the same channel.** The board has one radio and hears one channel at a time.
It must stay on the router's channel to keep its own connection and link 1. A phone on
the home Wi-Fi transmits on exactly that channel. Do not use a phone hotspot: that is
another network on a channel the phone picks, and following it would take the board
off the router.

**Wi-Fi 4 only.** The ESP32-S3 decodes only 802.11b/g/n (Wi-Fi 4) on 2.4 GHz. A Wi-Fi 6
or Wi-Fi 7 phone sends Wi-Fi 6/7 frames whenever the router allows it, and the board
cannot read those, even on the right channel. So, plainly: **the router's 2.4 GHz
network must run in Wi-Fi 4 (802.11n) mode, or the phone must join a 2.4 GHz-only,
b/g/n network** on the same router as the board (not a guest network: those usually
stop devices reaching each other). A phone on 5 GHz cannot be heard at all. The page
says "Answering, but not heard" when the phone replies to pings but none of its frames
can be read: that is this.

**How to start it.** Find the board's address: the `ip` field of its STATUS frame, the
log line `link 2: a phone on this Wi-Fi (2.4 GHz) can open http://…/beacon` printed
after it joins, or the router's device list. On the phone, open
`http://<board-ip>/beacon` in Chrome (Android) or Safari (iPhone). There is nothing to
install. The page registers the phone, beats every 1.5 s, and shows **Link on** with
the packets per second the board counts. The board serves one phone at a time; a
second phone waits until the first page is closed. Closing the page, or 6 s without a
beat, stops the pinging and promiscuous receive. `BEACON_ENABLED 0` in `config.h` (the
app's form: "Phone link") builds the board without the page at all.

**Rate is a ceiling.** esp_ping waits for each reply before sending the next ping, so
link 2 runs at most at 1000 / (the phone's reply time in ms) per second. A phone in
power save can drop to 20-60 Hz. Below ~80 Hz the host's human-band test gives no
reading rather than a wrong one. Two numbers tell you what is happening:
`beacon.rate_hz` (captures heard) and `beacon.pings_ok` (replies) in STATUS.

**Placement.** Pick a fixed spot at about torso height (a shelf, the desk edge) where
the line phone → board crosses the part of the room the router → board line misses.
Ideally the two lines cross near the middle of the room. Then leave it there: moving
the phone changes link 2's empty room, as moving the router does for link 1. An old
spare phone is ideal, since a phone in your hand is a moving transmitter.

**Battery and screen.** Keep it plugged in. The page must stay open and in front.
Browsers let a page hold the screen on only over https, and the board serves http, so
use the phone's own setting: Android **Developer options → Stay awake** (while
charging), or iPhone **Display & Brightness → Auto-Lock → Never** while it is the
beacon. The page is black, which an OLED screen barely lights, and it drifts a few
pixels over ten minutes against burn-in. If the phone has a charge limit (80 %,
Optimised charging), turn it on.

**Airtime.** Each ping is four frames over the air. At 100 Hz link 2 occupies roughly
6-10 % of the channel, on top of link 1's 15-25 %. If video calls in the house
stutter, lower `BEACON_PING_HZ`, and see the note in `config.h` first.

**Safety of link 1.** Promiscuous receive is on only while a phone is registered and
its MAC is known. While it is on, link 1 keeps only the router's frames addressed to
this board, exactly what it took before. If link 1's rate still falls below half its
previous value for 3 s, the board turns promiscuous receive off for that registration
(`beacon.fallback: true`; the page says "Paused to protect link 1").

**What it cannot do.** Two links are two paths, not a map: there are still no
coordinates. Link 2 is a second viewpoint for the learned models. The host already
decodes and records it (every `.akr` keeps the `CSI_LINK` frames), but the engine
ignores it until it is integrated (`aankhen/links.py`). With the ceiling fan on, link
2 at ~100 Hz has about one packet per 10 ms slot, so it lacks the slot averaging that
keeps the fan's aliases out of link 1's human band.

**Update the host first.** A host older than this firmware reads frame type 0x08 as
corruption: it skips those frames byte by byte and counts them as bad headers. The
board sends none until a phone registers, but update `aankhen/protocol.py` before
anyone opens `/beacon`.

## What changed from v2, and why

| v2 | v3 |
|---|---|
| CSI never enabled; "presence" = a packet was heard | CSI on (LLTF, router BSSID only, clean decodes only), driven by a 100 Hz ping |
| JSON at 115,200 baud: could not carry the data | binary frames with SYNC, sequence numbers and CRC-16 over native USB |
| open fallback access point | none |
| `/relay/1/on` with no authentication | MQTT from JARVIS, or HTTP with a ≥16-char token compared in constant time |
| plain-text prints mixed into the data stream | log lines are frames too, so the stream never desynchronises |
| (3.4.0) USB-only updates | OTA with a password (or none at all), `/status` over Wi-Fi, relays kept across an update |

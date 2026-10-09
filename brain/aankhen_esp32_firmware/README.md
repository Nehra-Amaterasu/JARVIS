# Aankhen firmware v3 (ESP32-S3)

The sensor board for JARVIS's eyes. It streams raw Wi-Fi CSI (100 Hz) and raw
LD2450 radar frames to the laptop as CRC-checked binary frames over USB. All
processing happens on the laptop (`brain/aankhen`). Relays switch only on request
from JARVIS (MQTT) or a token-authenticated HTTP call.

## 1. Secrets

```bash
copy secrets.example.h secrets.h
```

Fill in `WIFI_SSID_VALUE` / `WIFI_PASS_VALUE` for the **2.4 GHz** network. The router you
join is the CSI transmitter, so put the board on the far side of the room from it
for the Wi-Fi link to cross the room. Relay control is off until you add
`RELAY_TOKEN_VALUE` and/or `MQTT_URI_VALUE`. `secrets.h` is gitignored.

The v2 fields `AP_SSID_VALUE` / `AP_PASS_VALUE` are no longer used: v3 has no fallback
access point.

## 2. Wiring

| LD2450 | ESP32-S3 |
|---|---|
| 5V | 5V (the radar needs 5 V and >200 mA; at 3.3 V its range collapses) |
| GND | GND |
| TX | GPIO 18 (RADAR_RX_PIN) |
| RX | GPIO 17 (RADAR_TX_PIN) |

Relays: set the GPIOs in `RELAYS[]` only once the relay board is wired and checked.
They're `-1` (disabled) by default. Mains wiring is not a hobby shortcut: use a
proper relay module with isolation, and have it checked.

## 3. Receiver gain (recommended)

The ESP32-S3 picks its receive gain per packet, close to at random, and the CSI
amplitudes carry it. Without knowing it, the host has to divide every packet by its
own median, which also discards most of what a person does to the signal. The
physics model (`python -m aankhen physics`) puts breathing visibility at the desk at
~29 % of positions without it and ~97 % with it, on the default layout.

Espressif's `esp_csi_gain_ctrl` reads that gain from the packet. The firmware picks
it up automatically when its header is found, and then sends `CSI_GAIN` frames (the
STATUS frame says `"gain":"compensated"`). Without it, the firmware behaves as before
(`"gain":"unavailable"`).

The library is closed source and ships as a precompiled `.a` per chip and ESP-IDF
version. Espressif documents it for ESP-IDF; using it from Arduino is untested:

1. Download `espressif/esp_csi_gain_ctrl` from the ESP Component Registry
   (components.espressif.com). It contains `include/esp_csi_gain_ctrl.h` and
   `lib/<idf version>/<chip>/libesp_csi_gain_ctrl.a`.
2. Make an Arduino library: `Documents/Arduino/libraries/esp_csi_gain_ctrl/` with
   - `library.properties`: `name=esp_csi_gain_ctrl`, `version=0.1.5`, `precompiled=true`,
     `ldflags=-lesp_csi_gain_ctrl`
   - `src/esp_csi_gain_ctrl.h` (from `include/`)
   - `src/esp32s3/libesp_csi_gain_ctrl.a`, from the folder for **ESP-IDF 5.5**. The
     Arduino-ESP32 core 3.3.x is built on IDF 5.5; a mismatched build will not link.
3. Compile. The build log should link `libesp_csi_gain_ctrl`; on boot STATUS should
   show `"gain":"recording"` for ~1 s, then `"compensated"`.

Then run `python -m aankhen validate`. It measures how accurate the compensation
is (packet-to-packet jitter in an empty room), and the physics predictions use that
measured value.

## 4. Flash

Arduino IDE: board **ESP32S3 Dev Module**, **USB CDC On Boot: Enabled**, then Upload.
Or from a terminal:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc brain/aankhen_esp32_firmware
arduino-cli upload  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc -p COM9 brain/aankhen_esp32_firmware
```

Use the board's native USB port (it shows up as Espressif `303A`). Use a data
cable; charge-only cables are common and look identical.

## 5. Check it

```bash
cd brain
.venv311_gpu\Scripts\python.exe -m aankhen doctor
.venv311_gpu\Scripts\python.exe -m aankhen serve --port COM9
```

Open the JARVIS app → **Aankhen** → **ESP32**. The banner must turn cyan
("LIVE · ESP32 hardware"), and the Sensors card should show:

- `Wi-Fi CSI live ~100 Hz`. If it's far lower, the router is rate-limiting pings
  or the board is in power save.
- `LD2450 radar live ~10 Hz` once the radar is wired.
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

## What changed from v2, and why

| v2 | v3 |
|---|---|
| CSI never enabled; "presence" = a packet was heard | CSI on (LLTF, router BSSID only, clean decodes only), driven by a 100 Hz ping |
| JSON at 115,200 baud: could not carry the data | binary frames with SYNC, sequence numbers and CRC-16 over native USB |
| open fallback access point | none |
| `/relay/1/on` with no authentication | MQTT from JARVIS, or HTTP with a ≥16-char token compared in constant time |
| plain-text prints mixed into the data stream | log lines are frames too, so the stream never desynchronises |

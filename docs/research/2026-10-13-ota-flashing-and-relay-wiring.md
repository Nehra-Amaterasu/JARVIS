# OTA flashing and relay wiring for the Aankhen board (2026-10-13)

**Question.** The ESP32-S3 will move behind the switchboard, powered by a 5 V supply
and switching the room light and fan through relays, with no USB cable to the laptop.
How does new firmware reach it, what does it cost, and what must the wiring respect?

## What was checked, and found

**ArduinoOTA in the installed core (esp32 3.3.12).** Read from
`Arduino15/packages/esp32/hardware/esp32/3.3.12/libraries/ArduinoOTA/src/ArduinoOTA.cpp`
and `tools/espota.py`:
- `setPassword()` stores a SHA-256 of the password; authentication is a
  PBKDF2-HMAC-SHA256 challenge (10,000 iterations) since 3.3.1, so the password never
  crosses the air. espota.py falls back to the pre-3.3.1 MD5 scheme for old images.
- `handle()` runs the whole transfer synchronously inside `loop()`, and `onStart` fires
  only after `Update.begin()` succeeded. An auth error or "no room" error reaches
  `onError` without `onStart`: the firmware's sensing pause/resume is guarded by a flag
  for that reason.
- After `Update.end()` succeeds it calls `onEnd`, waits 100 ms and `ESP.restart()`s:
  the reset reason is `ESP_RST_SW`, which is what the relay-restore marker keys on.
- espota.py takes the password as `-a <password>` on its command line (visible to every
  process). The app runs it through a one-line launcher that reads it from the
  environment and deletes it there.
- espota.py makes the board connect BACK to a random TCP port (10000-60000) on the
  laptop: Windows Firewall may prompt for Python the first time.

**Size.** firmware 3.4.0 with OTA, `/status` and the relay-restore code compiled with
the real arduino-cli (fqbn `esp32:esp32:esp32s3:CDCOnBoot=cdc`, dummy secrets in a
scratch copy): **998,101 bytes, 76 % of the 1,310,720-byte app slot**; RAM 52,056 bytes
(15 %). 3.3.0 was 933,521 bytes, so OTA + mDNS + Update cost ~64.6 KB. The same 3.4.0
without OTA_PASS_VALUE, without the relay token and with BEACON_ENABLED 0: 930,141
bytes. The default partition table has two 1,310,720-byte app slots, which is what OTA
needs; nothing to repartition.

**Arduino builder pitfall (measured: the first build failed).** A free function defined
above the sketch's structs makes the builder insert ALL its generated prototypes there,
before `CsiItem` and `Relay` exist. The compile-time string compare for the placeholder
password lives in a struct for that reason.

**Pins.** From the ESP32-S3 datasheet and DevKitC-1 guide: strapping pins 0, 3, 45, 46;
USB 19/20; SPI flash 26-32; octal PSRAM 33-37 (N8R8/N16R8); UART0 43/44 (boot ROM
output); RGB LED 38 (v1.1) / 48 (v1.0). The form allows 1, 2, 4-16, 21, 39-42, 47.

**Power.** Espressif's DevKitC-1 user guide lists three power inputs (USB, the 5V/G
pins, the 3V3/G pins) as mutually exclusive. So the USB cable comes out once a supply
feeds 5V. Budget: S3 Wi-Fi TX peaks ~340 mA; an SRD-05VDC relay coil is ~70 mA at 5 V
(0.36 W): two relays plus the board stay under 0.5 A, so a 1 A supply has margin.

**3.3 V logic on 5 V active-low modules.** With VCC 5 V and IN driven to 3.3 V, 1.7 V
remains across the input LED chain; most modules (opto LED + indicator LED in series)
stay off, some do not release. The fix written into the wiring card: VCC to 3V3, and on
JD-VCC modules remove the jumper and feed JD-VCC 5 V.

## What it changed

Firmware 3.4.0: OTA behind a new `OTA_PASS_VALUE` define (no define, no OTA), `/status`
over Wi-Fi (full with the relay token), relays restored after an OTA restart only,
`CSI_RATE_HZ` and `BEACON_ENABLED` in config.h. The app: board card, config form,
compile and two-step flash, wiring card with test clicks.

## Sources

- ESP32-S3-DevKitC-1 user guide (v1.1): https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html
- ESP32-S3-DevKitC-1 user guide (v1.0): https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.0.html
- ESP32-DevKitC guide (the "more than one power connection may damage" warning): https://docs.espressif.com/projects/esp-idf/en/release-v3.0/get-started/get-started-devkitc.html
- ArduinoOTA and espota.py: the installed esp32 core 3.3.12 (paths above).

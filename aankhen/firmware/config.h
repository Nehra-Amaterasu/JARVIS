// Board wiring for the Aankhen ESP32-S3. Tracked in git (no secrets here —
// those live in secrets.h). Change these to match how YOUR board is wired.
#pragma once

// ---- LD2450 radar (UART1): none fitted or planned; harmless when absent -------
#define RADAR_RX_PIN 18           // ESP32 RX  <- LD2450 TX
#define RADAR_TX_PIN 17           // ESP32 TX  -> LD2450 RX
#define RADAR_BAUD 256000

// ---- Relays ------------------------------------------------------------------
// Typical 5 V relay modules with an optocoupler switch ON when the input is pulled
// LOW ("active low"). If yours clicks ON at boot and OFF when told "on", flip this.
#define RELAY_ACTIVE_LOW 1
// GPIO 4 and 5 are free general-purpose pins on the ESP32-S3-DevKitC-1 (not strapping
// pins, not USB, not flash/PSRAM). Set a pin to -1 to disable that relay entirely.
#define RELAY_LIGHT_PIN 4
#define RELAY_FAN_PIN 5

// ---- Receiver gain (README.md, section 3) ------------------------------------
// 1: link Espressif's esp_csi_gain_ctrl (vendored in libraries/), so both links send
// their per-packet gain and the host undoes it. Needs the library on the build's path:
//   arduino-cli compile ... --libraries aankhen/firmware/libraries aankhen/firmware
// 0: plain AK_CSI frames, as firmware 3.2 sent them.
#define AK_GAIN_LIB 1

// ---- Link 2: your phone (README.md, "Second link: your phone") ----------------
// Pings per second to the phone that opened http://<board>/beacon. Each reply the
// phone sends is one link-2 CSI capture; the host resamples link 2 to 100 Hz.
// AIRTIME, shared by every device in the house: each ping is FOUR frames over the air
// (board -> router -> phone -> router -> board), each ~0.15-0.25 ms of channel time
// with its ACK at typical 2.4 GHz rates, so 100 Hz keeps the channel busy ~6-10 % of
// the time, on top of link 1's ~15-25 % (CSI_RATE_HZ 500, two frames per ping). Video
// calls on the same Wi-Fi feel it first. Lower is cheaper, but below ~80 Hz most of
// the host's 10 ms slots are forward-filled and its human-band test skips any window
// more than 20 % filled (motion.py HBE_MIN_REAL): pair a lower rate with a matching
// LinkBank(rate_hz=...) on the host. Above 100 it buys what CSI_RATE_HZ 500 buys
// link 1: several packets per slot, averaged, which keeps a ceiling fan's aliases out
// of the human band. esp_ping waits for each reply before the next ping, so link 2
// gets at most 1000 / (the phone's reply time in ms) per second whatever this says.
// To stop link 2, close the page.
#define BEACON_PING_HZ 100

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
// The JARVIS app edits the values below through a form (Limbs -> Firmware), which
// rewrites only the number on each #define line: keep one define per line.
#define RELAY_ACTIVE_LOW 1
// The wall box (3.7.0, Aman's 3 two-channel boards): the six pins sit side by side on
// header J1 (positions 4-9: GPIO 4, 5, 6, 7, 15, 16), so one ribbon of six jumpers runs
// from the board to the three relay modules. None is a strapping, USB, flash or PSRAM
// pin (GPIO 15/16 are the 32 kHz crystal pins, free on the DevKitC-1, which has none).
// Set a pin to -1 to disable that relay entirely: it stays in the table, and STATUS
// reports it as null ("not wired").
#define RELAY_LIGHT_PIN 4     // relay module 1, IN1: L1, the four white downlights (centre square)
#define RELAY_FAN_PIN 5       // relay module 1, IN2: FN, the ceiling fan (the regulator still sets speed)
#define RELAY_LIGHT2_PIN 6    // relay module 2, IN1: L2, warm-white COB, outer circle
#define RELAY_LIGHT3_PIN 7    // relay module 2, IN2: L3, warm-white COB, inner square
#define RELAY_LIGHT4_PIN 15   // relay module 3, IN1: L4, pink COB, outer square
#define RELAY_LIGHT5_PIN 16   // relay module 3, IN2: L5, pink COB, inner square
// The relay table: each row is a name and a pin. The name is the word JARVIS sends
// ({"relay":"light2","on":true}) and the device id in the app's devices.json (board
// "esp32"): lowercase letters, digits and _, at most 12 characters. At most 8 rows.
// Every relay boots OFF (except right after an OTA update, which restores them) and
// keeps its state when Wi-Fi or the laptop goes away: the wall switches work anyway.
#define RELAY_TABLE \
  {"light", RELAY_LIGHT_PIN}, {"fan", RELAY_FAN_PIN}, {"light2", RELAY_LIGHT2_PIN}, \
  {"light3", RELAY_LIGHT3_PIN}, {"light4", RELAY_LIGHT4_PIN}, {"light5", RELAY_LIGHT5_PIN}

// ---- 16x2 character LCD (HD44780 "1602", e.g. the RG1602A), optional -----------
// 0 until the display is wired. Write-only 4-bit mode: the LCD's RW pin goes to GND, so
// it never drives its 5 V back into the 3.3 V GPIOs. The six pins continue header J1
// (positions 15-20: GPIO 9-14), right after the relay ribbon.
// Row 1 shows one mark per relay (its label when on, '-' when off, '?' when not wired);
// row 2 shows the board's IP and Wi-Fi signal, or a message JARVIS sends ({"lcd":"..."}).
#define LCD_ENABLED 0
#define LCD_RS_PIN 9
#define LCD_E_PIN 10
#define LCD_D4_PIN 11
#define LCD_D5_PIN 12
#define LCD_D6_PIN 13
#define LCD_D7_PIN 14
#define LCD_LABELS "1F2345"   // one character per RELAY_TABLE row, in table order
#define LCD_MESSAGE_S 15      // how long a JARVIS message stays on row 2

// ---- The Wi-Fi link to JARVIS (README.md, section 4c) ---------------------------
// With LINK_KEY_VALUE in secrets.h the board also streams its frames to JARVIS over
// UDP and takes relay commands that way, every datagram signed with HMAC-SHA256.
// The board listens on this port; the laptop's side is the app's setting (47270).
#define LINK_PORT 47269
// A part-full batch of frames leaves after this many ms (~8 CSI frames per datagram
// at 500 Hz; a command's answer leaves at once).
#define LINK_FLUSH_MS 20

// ---- Link 1: the router ------------------------------------------------------
// Router pings per second = CSI captures per second. 500, not 100: the host averages
// ~5 per 10 ms slot, which keeps a full-speed ceiling fan (~23 Hz and harmonics) from
// folding into the human band. Each ping is two frames over the air, ~15-25 % of the
// channel at 500. Must divide 1000 (the ping interval is a whole number of ms):
// 100, 125, 200, 250 or 500.
#define CSI_RATE_HZ 500
// How long one router ping waits for its reply before the next may go (ms). Short,
// so a lost reply on a weak link costs one slot, not a second of CSI (3.5.1).
#define CSI_PING_TIMEOUT_MS 10

// ---- Staying on the Wi-Fi (3.6.0; README.md, section 4d) -----------------------
// 1: once joined, the board rejoins only that access point (its BSSID), so a second AP
// with the same SSID (the planned in-room AP) cannot take it over and move link 1 under
// the learned models. 0: any AP with the SSID, strongest first (3.5.x behaviour).
// To name the AP yourself put WIFI_BSSID_VALUE "aa:bb:cc:dd:ee:ff" in secrets.h (a MAC
// stays out of git); that pin is never given up.
#define WIFI_PIN_BSSID 1
// A learnt pin is dropped after this many seconds without its AP, so a replaced router
// does not strand the board. 300: longer than a router's 1-2 minute reboot.
#define WIFI_PIN_GIVEUP_S 300
// The longest loop() may stall before the task watchdog restarts the board. 15: three
// times the web server's 5 s client timeout, the slowest legitimate step (OTA feeds it).
#define LOOP_WDT_S 15

// ---- Receiver gain (README.md, section 3) ------------------------------------
// 1: link Espressif's esp_csi_gain_ctrl (vendored in libraries/), so both links send
// their per-packet gain and the host undoes it. Needs the library on the build's path:
//   arduino-cli compile ... --libraries aankhen/firmware/libraries aankhen/firmware
// 0: plain AK_CSI frames, as firmware 3.2 sent them.
#define AK_GAIN_LIB 1

// ---- Link 2: your phone (README.md, "Second link: your phone") ----------------
// 1: the board serves http://<board>/beacon and a phone that opens it becomes link 2.
// 0: no /beacon page, no pinging, promiscuous receive never turns on (link 1 only).
#define BEACON_ENABLED 1
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
#define BEACON_PING_HZ 200

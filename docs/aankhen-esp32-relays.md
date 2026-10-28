# Aankhen: the ESP32-S3 drives the relays, over Wi-Fi

Written 2026-10-28, while the relay circuit for the ESP32-S3 is being built. The sensing link
is already cable-free (firmware 3.6.0, `docs/research/aankhen.md`, 2026-10-28). Firmware 3.7.0 (six relays, a 16x2 LCD) is being written in parallel and is not committed yet. This guide is
the path from "a relay module on the bench" to "the room light switched from the phone", in the
order that cannot bite. Firmware details: `aankhen/firmware/README.md` §2 and §4c.

## Status, 2026-10-28 (bench, room MCB down)

- **The ESP32-S3 is the relay board now.** The app's default room puts the light and the fan on
  the ESP32 (GPIO 4, 5); the Uno transport is off unless `JARVIS_UNO=1`. The six-relay room
  (this guide's table) is `data/app/devices.json` + `data/app/modes.json`, copied from the two
  example files.
- **Firmware 3.7.0 flashed over USB** (1,006,848 bytes, hash verified). Its STATUS reports six
  relays on GPIO 4, 5, 6, 7, 15, 16, all OFF at boot.
- **Bench clicks over USB: 18 of 18 confirmed both ways** (3 rounds × 6 relays, on 1 s then off),
  26-63 ms per command from send to the board's own STATUS. Two more through the running app
  (`light2`, `light5`): both confirmed. The confirmation is the board's GPIO state; whether each
  module's LED and contact follow it is checked by eye (T2 below).
- **MCB on, 10:54-10:55: the relays did not move.** Aman pressed the light and fan in the app 11 times; the ledger shows every press applied over USB and the board confirmed its pin each time, yet no module lit or clicked. So the fault is between the S3's pins and the relay coils, on the modules' side: most likely their 5 V or GND is not arriving (a breadboard power rail split in the middle, or a jumper one row off), else the signal jumpers are not in the pins' columns. The board's "confirmed" is its own pin state and cannot see a relay; the bench result above proves the pins, not the relays.
- **Over Wi-Fi: not testable today.** The room's router is on the room's MCB, so the board says
  `connecting` (last disconnect 201, no AP found). Firmware 3.7.1 adds a fallback network for
  exactly this (section 5).
- **In the app:** Limbs opens with a Wall box card: the ceiling lit from the board's own report,
  the six relays by module and GPIO with a test click each, the twelve modes, what the box's LCD
  shows, and what to say to JARVIS.

## 0. One decision before soldering

The board's place is what the recorded data is about. Every recording so far is from the board
at its sensing spot, powered by a phone charger. If the same S3 goes to the switchboard to reach
the relays, the geometry changes and the recordings do not transfer. Two honest options:
- **A.** The S3 stays where it senses, and the relay module comes to it on short wires
  (relays near the board, mains leads from the switchboard to the module: an electrician's job).
- **B.** The S3 moves to the switchboard and senses from there: fine for relays, and the drills
  start over from that spot.
A third board later (a cheap ESP32 for the relays, signed UDP) keeps both; it is not needed to
test the circuit now.

## 1. The circuit (bench first, no mains)

Module: a 5 V opto-isolated relay board (HL-52S or the like), **active-low**: a relay is ON when
its IN pin is pulled LOW. The firmware knows this (`RELAY_ACTIVE_LOW 1` in `config.h`).

| Module | ESP32-S3 DevKitC-1 | Relay name | Load (firmware 3.7.0 table, in progress) |
|---|---|---|---|
| VCC (each module) | 5V pin | | the 5V pin carries USB power; the coils need 5 V |
| GND (each module) | GND | | shared: the IN signal is measured against this ground |
| Module 1 IN1 | GPIO 4 | `light` | white downlights |
| Module 1 IN2 | GPIO 5 | `fan` | ceiling fan (the regulator still sets the speed) |
| Module 2 IN1 | GPIO 6 | `light2` | warm COB, outer |
| Module 2 IN2 | GPIO 7 | `light3` | warm COB, inner |
| Module 3 IN1 | GPIO 15 | `light4` | pink COB, outer |
| Module 3 IN2 | GPIO 16 | `light5` | pink COB, inner |

The six GPIOs sit side by side on header J1 (positions 4-9), so one six-wire ribbon runs from
the board to the three two-channel modules. The source of truth is `RELAY_TABLE` in
`aankhen/firmware/config.h`; the flashed board (3.6.0) still has the older five-relay table with
`light4` on GPIO 8 and no `light5`, so **3.7.0 has to be compiled and flashed before `light4`
and `light5` can switch** (Limbs → Firmware → Compile, then Flash → Over Wi-Fi with the OTA
password; the board already reports `ota: true`). Flashing is the owner's call.

Rules that follow from the physics:
- **Power.** The S3 peaks ~0.35 A on Wi-Fi; each 5 V coil ~70 mA. Two coils plus the board stay
  under 0.5 A: a 1 A charger is tight, 2 A is comfortable. STATUS `"reset":"brownout"` after a
  click means the supply sags: give the module its own 5 V.
- **3.3 V against a 5 V input.** The S3's HIGH is 3.3 V. On some modules that is not enough to
  switch the optocoupler fully OFF, so a relay turns on and never releases. If the release test
  (§3, T2) fails: move the module's VCC to 3V3, and on a module with a JD-VCC jumper pull the
  jumper and feed JD-VCC from 5 V. Then the inputs see 3.3 V logic and the coils get 5 V.
- **No boot glitch.** The firmware writes the OFF level to the pin latch before making it an
  output (`initRelay`), so a boot must not click. If a relay clicks at power-on, the module is
  not active-low or the wiring is off: stop before mains.
- **Mains later, and not alone.** Through COM and NO, on the live wire only, breaker off, in
  parallel with the wall switch so the switch keeps working. Isolated module, proper enclosure,
  checked by someone who does this. That step is the owner's, after §3 passes.

## 2. Tell the app which board switches what (one file, one restart)

The app's default room (no `devices.json`) is the light and the fan on the ESP32 since
2026-10-28. For all six relays, one file:

```json
{
  "devices": [
    {"id": "light",  "name": "White lights", "kind": "light", "board": "esp32", "channel": 4},
    {"id": "fan",    "name": "Ceiling fan",  "kind": "fan",   "board": "esp32", "channel": 5},
    {"id": "light2", "name": "Warm outer",   "kind": "light", "board": "esp32", "channel": 6},
    {"id": "light3", "name": "Warm inner",   "kind": "light", "board": "esp32", "channel": 7},
    {"id": "light4", "name": "Pink outer",   "kind": "light", "board": "esp32", "channel": 15},
    {"id": "light5", "name": "Pink inner",   "kind": "light", "board": "esp32", "channel": 16}
  ]
}
```

Save it as `data/app/devices.json` (this is `app/jarvis_app/devices.esp32-box.example.json`;
list only what is wired today, or the Limbs tab shows relays that do not exist and "All off"
talks to them). `id` is the relay's name in the firmware's
`RELAY_TABLE`; `channel` is its GPIO there. The app reads the file at start, so close JARVIS
and open it again (on the bench nothing is on mains, so "relays off at restart" costs nothing).

Then the Limbs tab must say **"ESP32 relay board over Wi-Fi (<address>, <rssi> dBm), firmware
aankhen-3.6.0: switches drive its relays, and each one counts only when the board confirms
it."** Two warnings it can add, and what they mean:
- *Not on the board (or its pin is -1): …* : the id is not in `RELAY_TABLE`, or its pin is -1.
- *Pins differ from devices.json* : the board's STATUS `relay_pins` disagrees with `channel`.

## 3. The test ladder (bench, module LEDs only, no mains)

Each step is a pass/fail with a number. Stop at the first fail.

| # | Do | Pass when |
|---|---|---|
| T1 | Power the board. Watch the module. | No click, no LED at boot. Board `/status` or STATUS shows `reset: "power-on"` and both relays `false`. |
| T2 | Limbs → Wire your relays → **Test click** on `light`, then on `fan`. | Each click: the module LED lights for ~1 s and goes out; the card says *the board confirmed both*; the two `ms` figures are under 500 over Wi-Fi (the command, then the board's STATUS). The LED going OUT is the release test of §1. |
| T3 | Ten test clicks in a row on one relay. | 10 of 10 confirmed; STATUS `reset` still `power-on` (no brownout). |
| T4 | Switch `light` on from the phone page (Connect → Phone, paired). | The LED turns on, the desktop shows `light` on with `confirmed` true, the phone shows it within a second. |
| T5 | With `light` on, switch the router off for 30 s, then on. | The LED stays on the whole time (the board keeps its relays). The app says the ESP32 is not answering, then reconnects within ~15 s and ADOPTS the board's state: no relay changes on reconnect. |
| T6 | With `light` on, pull the board's power for 5 s, plug it back. | Everything boots OFF, `reset: "power-on"`; the app adopts OFF. The presence rule may turn things back on only when it is allowed to (not in quiet hours 00:30-07:00, not after a manual command since start, only with evidence he is there). |
| T7 | Say "light on" to JARVIS (voice or the chat box). | Same path as T4 (Limbs is the only writer); confirmed, LED on. |

What the code promises during these steps (the audit of 2026-10-28, with its tests):
- One writer: every switch, from the tab, the phone, voice or the presence rule, goes through
  `Limbs.apply()` and then `hub.set_relay()` (`app/jarvis_app/limbs.py`).
- A switch counts only when the board's own STATUS shows the new state; a command lost on
  Wi-Fi is sent once more; "no such relay" and "pin -1" are reported in words
  (`aankhen/tests/test_hub_net.py`: 4 relay tests; `app/tests/test_limbs.py`).
- Every Wi-Fi command is HMAC-signed with a per-session key and a rising counter: a replayed
  or foreign datagram is dropped (`aankhen/netlink.py`).
- On (re)connect the app adopts the board's relays and never pushes its old state
  (`Limbs.resync_hardware`); the board boots OFF after a power cut and keeps its relays
  when the laptop or the Wi-Fi goes away.
- A load the switchboard config refuses (an AC, a geyser, anything over 5.6 A) is never driven
  (`circuits.py`); there is no `circuits.json` yet, so nothing is refused and nothing is rated.

## 3b. When the board confirms but no relay moves (2026-10-28)

Work from the module back to the ESP32, one cause at a time:
1. **Power LED on each module.** Off: 5 V or GND is not reaching it. Long breadboards often split
   each power rail in the middle; if the ESP32's 5V/GND jumpers are on one half and a module's
   VCC/GND on the other, that module gets nothing. Bridge the gap with a short jumper on both
   rails, or move the jumpers to the same half. A multimeter on a module's VCC-GND must read
   4.5-5 V.
2. **Power LED on, channel LED never lights.** Touch that module's IN1 to GND with a spare
   jumper: an active-low module must click and light. If it does, the module is fine and the
   signal jumper is not in the GPIO's column; if it does not, swap in a spare module.
3. **Clicks but the light stays dark (MCB on, wall switch OFF).** The mains side: the green wire
   on NC instead of NO, or a loose screw (the artifact's section 5 and 6).

## 4. Known gaps found by the audit (not blockers for the bench)

- The Limbs "Wire your relays" card is written for the Uno; the ESP32 pins are only in this
  guide and the firmware README.
- `/status` over plain HTTP from the board answers without a token; the full STATUS (relays
  included) over HTTP needs `RELAY_TOKEN_VALUE`, which is not in the build. Not needed: the app
  reads relays over the signed link.
- No DHCP reservation yet: the board's address can change; mDNS (`aankhen.local`) covers it.

## 5. When the room's router is off: the house Wi-Fi as a fallback (firmware 3.7.1)

The in-room transmitter sits on the room's own circuit, so a dead MCB takes the board's network
with it. 3.7.1 adds an optional second network. Two lines in `secrets.h` (the owner adds them;
the password never enters git or a log):

```c
#define WIFI_SSID2_VALUE "<the house 2.4 GHz network>"
#define WIFI_PASS2_VALUE "<its password>"
```

What the board does with them:
- the first network missing for 45 s (`WIFI_FALLBACK_AFTER_S`): it joins the second, unpinned;
- while on the second it scans for the first every 60 s (`WIFI_PRIMARY_RETRY_S`) and leaves the
  moment it is seen, so it is back on the room's router within about a minute of the MCB going
  up; it never settles on the house Wi-Fi;
- each scan pauses the link for ~4 s (about 7 % of the time, only while on the fallback);
- the pin to the room's AP is kept for the way back; the house AP is never pinned.

Sensing on the house router is a different geometry (through the wall), so recordings made while
on the fallback are not mixed into the room's training data as if they were the same link.
Without the two defines, 3.7.1 behaves exactly like 3.7.0.

## 6. Power budget for the rig, and the Diwali string (2026-10-28, estimates)

Datasheet values, not measured on this board: the ESP32-S3 streaming CSI ~0.15 A average and
~0.35 A in a Wi-Fi transmit burst; each relay channel on ~80 mA (SRD-05VDC coil 72 mA plus its
LEDs). Against a 5 V 0.75 A charger:

| Relays on | Average | Peak | 0.75 A charger |
|---|---|---|---|
| 0-1 | ~0.23 A | ~0.43 A | fine |
| 2-3 (most modes) | ~0.39 A | ~0.59 A | fine |
| 4 | ~0.47 A | ~0.67 A | fine with 1000 µF across the rails |
| 5 (All lights) | ~0.55 A | ~0.75 A | at the limit |
| 6 (All lights + fan) | ~0.63 A | ~0.83 A | over: brownout, every relay drops OFF |

Three ways to feed it: the charger into the ESP32's USB-C, with the modules fed from its 5Vin pin
(needs 5Vin to output 5 V); a USB breakout feeding the rails directly (needed if 5Vin is
input-only); or two chargers, one for the ESP32 and one for the coils through JD-VCC (also fixes
3.3 V release). A 2 A charger alone covers every row. Never a charger wired into the switchboard
without a proven neutral.

The Diwali string must not sit across a switch's T1-T2: it is then in series with that light,
glowing when "off" and shorted out when on. Options: a socket (manual); a 5 V USB string on a
spare relay channel (no mains); between L4's T2 and a proven neutral (follows L4, electrician);
its own 230 V relay as `light6` on GPIO 17 (neutral by an electrician).

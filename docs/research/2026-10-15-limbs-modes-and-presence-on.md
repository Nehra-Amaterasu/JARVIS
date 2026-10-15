# 2026-10-15: Limbs tells the truth, modes are on/off sets, presence brings the room back

**Questions.**
1. (A3) The relays only switch. Where did the app still show or speak a level (brightness, fan speed), and what replaces it without losing the glowing bulb and the spinning fan?
2. (A3) How do the "scenes" become editable on/off modes that work from the Limbs tab and by voice, and how does the device list stop being hard-coded to one light and one fan?
3. (A4) What does Connect → Detected claim that is not true?
4. (A6) Opening COM8 resets the Uno, so after every app start the relays are off. How can the light and fan come back on when he is in the room, without ever switching mains loads on when he is not, or overruling him?

**Method.** I read the code at `8f4ef5b` and the private 10-14 app-state audit (items 4, 5 and 6). I changed the code and tested it with fakes only. No serial port was opened, and the running app on 127.0.0.1:8777 was not called. I compiled the firmware with the IDE's bundled `arduino-cli compile --fqbn arduino:avr:uno`. Compiling does not open a port. Nothing was flashed.

## Findings

### 1. Fake levels: where they lived
- **`limbs.py`**: device units "brightness"/"speed"; scene details "light 80%, fan low and quiet", "light 30%, fan medium" and "fan low"; `DEFAULT_STATE` levels 100 and 60; and `set`/`dim`/`brighten` arithmetic (`STEP = 20`).
- **`core/room.py`**, the mirror the voice path reads, had the same values:
  - spoken text "Lighting 80%, Fan minimal";
  - `describe()` saying "The fan is on at 60 percent";
  - a console bar of 10 levels.
- **`core/tools/builtin.py`**:
  - `set_device` took `set`/`dim`/`brighten` and a 0-100 value;
  - `set_scene` was described as "focus (light 80%, fan low)…";
  - `room_state` read "at what level";
  - `_say_device` said "on at N percent" whenever the room was virtual.
- **UI**:
  - a 10-100 % slider per device;
  - the bulb's glow and the rotor's period scaled by `level`;
  - the Core tab's Limbs line showed "light 100%".
- **Energy**: `circuits.watts(on, level)` mapped a fan's 0-100 level to a regulator step (24/36/48/75 W). That level came from the app, not from the regulator.

### 2. What replaced them
- **State.** Every device is `{"on": bool}`.
  - `set`, `dim` and `brighten` now just switch a device on. The voice path already answers a level request with `room.no_levels()` before it reaches a switch.
  - An old `room.json` that has `"level"` loads with the level dropped.
- **Visuals kept, driven by the board.**
  - The bulb's halo is either full or off. The rotor spins at one fixed pace or stops.
  - Both follow `hardware_on` (the Uno's own reply) whenever the device's board is linked. They follow the saved state only in a virtual room.
  - The fan card says "speed: the wall regulator".
- **Energy is on/off.** An on load counts at its rated watts. For the fan that is 75 W, its full speed, which is the safe side of an estimate JARVIS cannot measure. The ledger's `lvl` field is now only 100 or 0. Example: the 18:00 hour in the energy test went from 0.068 to 0.095 kWh.

### 3. Modes: on/off sets, editable, by voice
- **One definition for both processes**: `core/room_config.py`. The app (`limbs.py`) and JARVIS (`room.py`) read the same two files in the app data folder:
  - `devices.json`: `[{id, name, kind light|fan, board uno|esp32, channel}]`;
  - `modes.json`: `{modes: [{id, name, set: {device: bool, "*": bool}}], last}`. `"*"` means every device, so "All off" also covers a light wired later.
- **Defaults** (no file):

  | Mode | Light | Fan |
  |---|---|---|
  | Deep focus (`focus`) | on | on |
  | Wind down (`relaxation`) | off | on |
  | Sleep (`sleep`) | off | on |
  | All off (`all_off`) | off | off (`"*"`) |

  The ids stay the same, so the agent's `deep_focus → focus` mapping and old reminders keep working.
- **Editing.** The Limbs tab creates, renames, edits and deletes modes, built-ins included:
  - `POST /api/limbs/modes/new`, `PUT/DELETE /api/limbs/modes/{id}` (`routes_limbs.py`);
  - a mode that names an unknown device, a non-on/off value such as `{"light": 40}`, or a duplicate name is refused with the reason.
  - The last mode chosen is saved (`modes.json` "last").
- **By voice.** `room.parse` now accepts a mode's name on its own. The filler words around it ("hey", "jarvis", "set", "mode", "please", "karo", …) are stripped.
  - Results: "Jarvis, deep focus" → focus; "set wind down" → relaxation; "hey jarvis sleep" → sleep; "wind down mode" → relaxation.
  - "I need to focus on my exam today" still parses to nothing.
  - "all off" and "sab band kar do" stay device commands (same effect).
  - JARVIS reads `modes.json`, so a mode made in the tab can be asked for by name. The `set_scene` tool takes any mode id or name. The app resolves it and sends JARVIS's mirror one plain on/off per device, never a scene for him to re-interpret.
- **More lights later.** The device list comes from `devices.json`.
  - Today's config, when no file exists, is light D4 and fan D5 on the Uno.
  - A lamp on D6 is one line there. The tests drive a third Uno channel and an `esp32` device side by side; each device goes only to its own board.
  - When the Uno transport is switched off (`JARVIS_UNO=0`, the tests), Uno devices fall back to the ESP32 hub as before 10-13. With the transport on, the Uno is a device's only writer.
- **The single relay writer, now on code.** `room.py` no longer publishes retained state on MQTT `jarvis/room/<device>`. The ESP32 firmware subscribes to those topics and switches relays on them, so with a broker running it was a second writer beside `limbs.py`. `MQTT_OK` stays, always False, for `jarvis.py`.

### 4. Firmware 1.1.0 (in the repo, NOT flashed)
- **N channels from one pin table** (`RELAYS[]`), with commented rows ready for D6 and D7.
- **Same protocol**: `<name> on|off|toggle`, `status`, `all off`, `scan`. It adds:
  - `all on`;
  - `channels`;
  - a banner whose `pins` map is printed from the table.
- **Size, same compiler**: 1.0.0 is 3688 B flash and 629 B RAM; 1.1.0 is 4000 B flash (12 %) and 643 B RAM (31 %).
- **`uno.py` reads either version.**
  - A state line is any JSON object whose values are all booleans and that has none of the banner/error/scan keys.
  - The pins come from the banner.
  - A device the flashed board does not report (for example `lamp` on 1.0.0) is refused with "the board has no lamp channel (firmware 1.0.0 has light, fan); … flash 1.1.0". Nothing is sent, and Limbs lists the device as a missing channel.

### 5. Connect → Detected
- **Relay board.** The hard-coded "Relay / dimmer board: planned" is gone. "Relay board · Arduino Uno" now comes from `UnoRelays.view()`:
  - connected, with port, firmware, each channel's on/off, the pins, and "each switch confirmed by the board";
  - or missing, with the transport's own error ("COM8 is held by another program…");
  - or missing because the transport is off.
  - `routes_limbs.register` hands the transport to `connect.bind_relays()`, so `routes_boards.py` and `server.py` did not change for this.
- **LD2450 radar.** The item is removed, with its `radar_item()`, because the owner dropped the radar on 10-13. The "People · radar" card is also removed from the Aankhen page.
- **MQTT.** "missing … hardware can't listen" is gone. A broker is listed, as "available, unused", only when one answers on :1883.
- **Whisper and the wake word.**
  - New status `installed`: the files are on disk but not loaded now.
  - They count as `connected` only while JARVIS runs in voice mode and has emitted `ready` for this run. `jarvis.py` loads Whisper (boot step "whisper") and openWakeWord ("wakeword") before `ready`.
  - The fixed "~2.7 s per utterance" claim is gone.

### 6. Presence brings the room back (`presence_on.py`)
- **When it runs**: once per app start, called from the Uno's `on_connect` right after `adopt_board()`. A later replug does not run it again.
- **Guards, in order, each logged as a `limbs`/`presence_on` event**:
  1. disabled in settings;
  2. quiet hours, default 00:30-07:00 and settable (a span over midnight works too);
  3. any switch used since the app started by a person (origin anything other than `presence`, `board` or `startup`). This is checked at the start and again just before acting.
- **Evidence it accepts**, watched for up to 10 min (`window_min`), polled every 2 s:
  - keyboard or mouse input within 120 s, from `GetLastInputInfo` through ctypes (a read; 32-bit tick wrap handled);
  - or Aankhen's learned `occupied_p ≥ 0.8` held for 20 s, **only** from a frame with `source == "hardware"`. Simulation, replay, a lower p or no learned model all count as no evidence.
- **What it does**:
  - switches to the last mode he chose, if that mode switches anything on; otherwise light and fan on;
  - goes through `limbs.scene` / `limbs.apply` with origin `presence`, so it never counts as his command;
  - JARVIS says "Welcome back, sir: light and fan on." (or the true set, plus any relay the board did not confirm) when he is running. The line is on the bus either way.
- **Settings**: `DATA/presence_on.json`, validated, through `GET /api/limbs/presence-on` and `POST /api/limbs/presence-on/settings`. The Limbs tab shows an on/off switch and the quiet hours.
- **Why not on "occupied" alone?** The 10-14 data note found the installed models unreliable ("bed" while at the desk). Input at the desk is the strongest signal right after an app start: someone just started the app. Aankhen only adds to it, and only from the real board with a sustained, high p.

## Numbers
- **Python** (`core/tests` + `app/tests`, after rebasing on main `cb42c09`): 1213 passed, 14 skipped, 0 failed.
  - Before the rebase, one run failed `test_settings_routes.py::test_an_export_already_in_downloads_is_offered_then_copied`. It also fails on the untouched base `8f4ef5b` (1056 passed, 1 failed) and passes on its own: an order dependence that was there before this change.
  - New tests:
    - `test_presence_on.py` (18);
    - `test_limbs.py` rewritten (35);
    - `test_limbs_routes.py` (4);
    - `test_uno.py` +3 for N channels;
    - `test_connect_truth.py` +3;
    - core: modes by name; the room tools say on/off.
- **UI**: `tsc -b` clean; vitest 19 files and 226 tests, including the new `limbs.test.ts` (5).
- **Firmware**: 1.1.0 compiles to 4000 B and 643 B, against 3688 B and 629 B for 1.0.0.

## Sources
- Code at `8f4ef5b`: `app/jarvis_app/{limbs,uno,connect,circuits,energy_service,server}.py`, `core/{room,jarvis,agent}.py`, `core/tools/builtin.py`, `limbs/uno_relay/uno_relay.ino`, `aankhen/{engine,fusion}.py` (`learned.occupied_p`, frame `source`), `aankhen/firmware/firmware.ino:653` (the ESP32 MQTT relay subscriber).
- The private audit `data/notes/research/2026-10-14-app-state-audit.md`, items 4-6.
- Microsoft, GetLastInputInfo: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
- Arduino Uno DTR auto-reset: https://docs.arduino.cc/hardware/uno-rev3/

## What this changed
- Replaced: brightness/speed sliders; level-based glow and spin; scene percentages; `set`/`dim`/`brighten` levels; the "Relay / dimmer board: planned" item; the LD2450 item; the MQTT "missing" item; `room.py`'s MQTT publisher; watts by regulator step; the ESP32-only relay wiring card.
- Added: `core/room_config.py` (devices and modes); `presence_on.py`; `routes_limbs.py`; firmware 1.1.0 (not flashed); a Uno wiring card with test clicks through Limbs; the "installed" status.
- **For Aman**:
  - Flash 1.1.0 only when you say go, and only when a third relay is wired. Flashing resets the Uno and the relays go off; 1.0.0 already works with everything here.
  - To add a light: a line in `devices.json`, a row in the firmware's pin table, then flash.

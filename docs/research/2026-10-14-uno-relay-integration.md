# Uno relay board: how JARVIS drives the real light and fan

2026-10-14. The ESP32 breadboard was dead, so the relays (HL-52S, active-LOW, D4 light,
D5 fan, contacts in parallel with the wall switches) hang off an Arduino Uno on USB
running limbs/uno_relay/uno_relay.ino 1.0.0. Question: how to put it behind JARVIS's
voice and app without a second writer.

## Findings from the code
- One owner already existed: app/jarvis_app/limbs.py (state on disk, `_drive` sends relay
  commands). Voice commands reach it through the app API (core/tools/builtin.set_device),
  and the spoken reply is built from the API's `delivered`, so a confirmed reply needs
  only an honest `delivered`.
- The ESP32 hub still answers relay COMMAND frames for pins nothing is wired to: it
  would "confirm" a switch that never happened, so it must not be a relay path any more.
- aankhen's board finder probed every USB serial port. Opening an Uno's port pulses
  DTR, its reset line, which drops both relays.
- All the requested phrases already parse in core/room.py: "turn on the light",
  "light band karo", "fan chala do", "turn everything off", "sab band karo",
  "pankha band kar do", "batti jala do".

## Design
- app/jarvis_app/uno.py owns the port: found by USB id (0x2341, 0x2A03, CH340 0x1A86)
  or JARVIS_UNO_PORT, opened once, banner awaited, `status` every 10 s, reconnect every 3 s
  after an unplug, "Access is denied" said as "close the Arduino IDE's Serial Monitor".
  `set()` is true only when the Uno's JSON reply shows the asked state; "too fast" is
  retried once after 300 ms.
- limbs.py uses the Uno as its only relay writer when it exists; an unconfirmed switch
  reverts the tile to the board's state; on (re)connect the room adopts the board's
  state (relays boot OFF) instead of pushing yesterday's file.
- aankhen/transport.py never lists Arduino ids or ports in CLAIMED_PORTS.
- The reply no longer says "on at 40 percent" on a relay: the fan's speed is its wall
  regulator's, and nothing dims the light.
- JARVIS_UNO=0 turns it off; the app's tests set it, so no test opens the real port.

## Limits
- The wall switch is in parallel and invisible: with it ON, the load is on whatever the
  relay says, and JARVIS cannot know.
- Restarting the app reopens the port, which resets the Uno: both relays go OFF.

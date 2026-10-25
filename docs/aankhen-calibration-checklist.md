# Aankhen calibration checklist (firmware 3.5.0)

Wi-Fi signals only. No camera at any step. Close the JARVIS app before steps 0 to 2,
because it holds COM9 and UDP 47270. Run every command from `C:\Projects\JARVIS`.

## 0. Is the board sending CSI? (2 minutes)
```
.venv\Scripts\python.exe -m aankhen.tools.smoke_board
```
- PASS means 10 or more CSI frames per second, 52 or more subcarriers, and no failed HMAC.
- FAIL prints the reason in one line: Wi-Fi not joined (with its dBm), a silent board,
  a slow rate, or a key mismatch. Fix that first. Nothing after this step works without it.
- Note the median RSSI. Below about -80 dBm the signal is weak. Move the board or the
  router closer before calibrating, because a baseline only fits the spot it was taken in.
- To check the Wi-Fi link on its own: `... smoke_board --link wifi`.

## 1. Empty-room baseline
1. Put the board in its final place and orientation. Moving it later means taking the baseline again.
2. Fan off, door in its usual position, phones out of the room. Everyone leaves.
3. `.venv\Scripts\python.exe -m aankhen calibrate --seconds 120`
4. If the ceiling fan is usually on, take a second baseline with the room empty and the
   fan running: `... calibrate --seconds 120 --fan`.
5. Check: `... aankhen doctor` should list the baseline with today's date.

## 2. Walk test (does motion show up?)
1. `... aankhen record --label empty --seconds 60` (room empty).
2. `... aankhen record --label walking --seconds 60`: walk slowly back and forth
   **across** the line from the router to the board, then along it.
3. `... aankhen record --label standing --seconds 60`, then `sitting`.
4. `... aankhen bench` scores these recordings. Walking must clearly beat empty. If
   empty and walking look the same, the walk was outside the sensing zone (see step 3)
   or the RSSI is too weak.

## 3. Angle sanity (geometry, not angle of arrival)
The ESP32-S3 has one antenna, so it **cannot measure the angle** a signal arrives from.
"Angle" here means checking that the room layout in `aankhen/room.json` matches reality:
1. Measure the router and board positions (metres from one corner) and the board's
   facing direction (`yaw_deg`), and enter them in `room.json`.
2. `... aankhen physics` writes a sensing map (`recordings/physics-report.html`). Spots
   near the router-to-board line should show as sensitive.
3. Stand still for 30 s in a strong spot, then in a weak spot. The live view should
   react more in the strong spot. If it reacts more in the weak spot, the positions or
   the yaw in `room.json` are wrong. Fix them before any training.

## When to repeat
After moving the board, the router or large furniture; after a firmware flash; or if
the empty room starts reading as occupied.

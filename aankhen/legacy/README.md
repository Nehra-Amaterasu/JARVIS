# aankhen/legacy/

Aankhen v1 and v2, kept for reference. **Nothing here is imported by the running
system**; Aankhen v3 is the package one folder up.

| File(s) | What it was | Why it was replaced |
|---|---|---|
| `aankhen_engine.py`, `ruview_simulator.py`, `aankhen_ruview_engine.py` | v1 engine | a simulator reporting invented heart rate, breathing and 17-point pose as if measured |
| `aankhen_esp32_hardware.py`, `aankhen_live_bridge.py` | v1 ESP32 bridge | presence was "a packet was heard" (100 % present in an empty room); leaked a serial thread per request |
| `aankhen_v2.py`, `ruview_parser.py` | v2: honest LD2450-only presence | superseded by v3 (CSI physics, tracker, fusion, learning). `ruview_parser.py`'s LD2450 decoding was correct and its logic lives on in `aankhen/radar.py` |
| `AankhenVisualizer.html`, `SpatialRadarView.html` | v1 viewers | `aankhen/web/index.html` and the app's twin |
| `test_spatial_integration.py` | v1 integration script | wrote fake vitals into real memory with no assertions |

The diagnosis that retired them is in [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
These files are not maintained and may not run.

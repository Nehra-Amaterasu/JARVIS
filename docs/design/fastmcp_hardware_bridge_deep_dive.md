# FastMCP Hardware Bridge — Technical Deep Dive & Actuation Architecture

**Primary Modules:** `mcp_hardware_server.py`, `room.py`, `mcp_client_bridge.py`  
**Transport Mechanism:** Model Context Protocol (FastMCP) over `stdio` transport  

---

## 1. Executive Summary

The **FastMCP Hardware Bridge** acts as the physical hands of JARVIS. It exposes local hardware control tools (room lighting, fan speeds, servo turret angles, and ESP32-S3 radar telemetry) directly to JARVIS agents over native `stdio` JSON-RPC transport.

---

## 2. Why Stdio Transport Was Chosen

1. **Zero VRAM Footprint:** Consumes **0 MB extra VRAM**, protecting the 6GB VRAM limit on the RTX 4050 for Llama 3.1 8B inference.
2. **Zero Network Latency:** Bypasses HTTP sockets and local network overhead. Commands execute in **< 1 ms** via standard input/output streams.
3. **Hardware Decoupling:** Hardware simulation and physical drivers are fully decoupled from the core LLM cognitive loop.

---

## 3. Exposed FastMCP Tools

### A. `control_relay_channel`
- **Arguments:** `channel_name: str` ("light", "fan"), `state: str` ("on", "off"), `value: int` (0–100)
- **Functionality:** Toggles room relay channels and adjusts PWM intensity levels.
- **Verification:** Updates `room.render()` state output (`LIGHT [##########] ON 100%`).

### B. `control_servo`
- **Arguments:** `servo_id: str` ("turret_pan", "turret_tilt"), `angle_deg: int` (0–180)
- **Functionality:** Positions micro-servo motors for laser tracking turrets or sensor mounts.

### C. `get_spatial_telemetry`
- **Arguments:** None
- **Functionality:** Fetches current room hardware status and live Aankhen radar spatial coordinates.

---

## 4. Proactive Room Trigger Reactor

When **Aankhen** detects continuous sitting posture ($> 45\text{ mins}$) or room user absence ($> 5\text{ mins}$), it issues proactive commands directly to the FastMCP hardware server:
- User Absence $> 5\text{ mins} \implies$ `control_relay_channel(channel_name="light", state="off")`
- Wave Gesture (`WAVING_HAND`) $\implies$ `control_relay_channel(channel_name="light", state="on")`

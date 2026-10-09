"""Virtual room state. Mirrors what the ESP32 will do in Phase 1.

If an MQTT broker is running (Mosquitto on localhost), every state change is
also published to jarvis/room/<device> — the ESP32 will subscribe to exactly
these topics later, so the brain code never changes when hardware arrives.
"""
import json

try:
    import paho.mqtt.client as mqtt
    _mq = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    _mq.connect("localhost", 1883, keepalive=30)
    _mq.loop_start()
    MQTT_OK = True
except Exception:
    _mq = None
    MQTT_OK = False

STEP = 20  # % change for "dim a bit" / "brighten a bit"

state = {
    "light": {"on": False, "level": 100},  # level = brightness %
    "fan":   {"on": False, "level": 60},   # level = speed %
}

# Called with (device, state) after every change. The desktop app sets this (via
# jarvis.py) to stream room changes to the Limbs tab; None when run standalone.
on_change = None

def _publish(device):
    if _mq:
        _mq.publish(f"jarvis/room/{device}", json.dumps(state[device]), retain=True)
    if on_change is not None:
        on_change(device, dict(state[device]))

def apply(device, action, value=None):
    """Apply an intent or a holistic environmental state."""
    # [Predictive Environment Router] Macro-state handler
    if device == "environment":
        state_name = str(value).lower() if value else action
        if state_name in ["deep_focus", "focus"]:
            apply("light", "set", 80)
            apply("fan", "set", 30)
            return "Transitioned environment to 'Deep Focus' (Lighting 80%, Fan minimal for silence)."
        elif state_name in ["relaxation", "chill"]:
            apply("light", "set", 30)
            apply("fan", "set", 50)
            return "Transitioned environment to 'Relaxation' (Lighting 30%, Fan medium)."
        elif state_name == "sleep":
            apply("light", "off")
            apply("fan", "set", 20)
            return "Environment set to 'Sleep'. All lights off, fan optimized for sleep."
        else:
            return f"Unknown environmental state '{state_name}'."
            
    targets = ["light", "fan"] if device == "all" else [device]
    replies = []
    for d in targets:
        if d not in state:
            replies.append(f"Error: Device '{d}' does not exist.")
            continue
        
        s = state[d]
        if action == "on":
            s["on"] = True
            if value is not None: s["level"] = int(value)
        elif action == "off":
            s["on"] = False
        elif action == "set":
            s["on"] = True
            if value is not None: s["level"] = int(value)
        elif action == "dim":
            s["on"] = True
            s["level"] = int(value) if value is not None else max(10, s["level"] - STEP)
        elif action == "brighten":
            s["on"] = True
            s["level"] = int(value) if value is not None else min(100, s["level"] + STEP)
        _publish(d)
        unit = "brightness" if d == "light" else "speed"
        state_str = "off" if not s["on"] else f"on, {unit} {s['level']} percent"
        replies.append(f"{d} {state_str}")
    return "; ".join(replies)

def render():
    """One-line room status for the console."""
    def bar(d):
        s = state[d]
        filled = int(s["level"] / 10) if s["on"] else 0
        return f"{d.upper():5} [{'#' * filled}{'.' * (10 - filled)}] {'ON  ' if s['on'] else 'off '} {s['level']}%"
    return "   ".join(bar(d) for d in state)

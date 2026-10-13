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


# ------------------------------------------------------------------ spoken commands
# Deterministic, English and Hinglish. Until 2026-10-09 room control went through the
# model's tool call: 6.4 s per command (stream, re-invoke, final call), English-only
# keywords, and for "light band kar do" the model, with no tool bound, CLAIMED the light
# was off in 1 of 3 runs. A parser is instant, understands Hinglish, and never pretends.
import re as _re

_DEV = [("light", _re.compile(r"\b(lights?|batti|bulb|lamp|roshni)\b", _re.I)),
        ("fan", _re.compile(r"\b(fan|pankha|pankhe)\b", _re.I))]
_ALL = _re.compile(r"\b(everything|all|sab|sabhi|saari|sare)\b", _re.I)
_ON = _re.compile(r"\b(on|chalu|chala|chalao|jala|jalao|start|switch on|turn on)\b", _re.I)
_OFF = _re.compile(r"\b(off|band|bujha|bujhao|bujhado|stop|switch off|turn off|kill)\b", _re.I)
_DIM = _re.compile(r"\b(dim|kam|halka|halki|dheema|dheemi|slow|lower|down)\b", _re.I)
_UP = _re.compile(r"\b(bright(en|er)?|tez|zyada|full|fast(er)?|higher|up|badha|badhao)\b", _re.I)
_PCT = _re.compile(r"\b(\d{1,3})\s*(%|percent|pratishat)", _re.I)
_SCENE = [("sleep", _re.compile(r"\b(sleep|sone|good ?night|so ?raha|so ?jaun)\b", _re.I)),
          ("focus", _re.compile(r"\b(focus|study mode|padhai|deep work)\b", _re.I)),
          ("relaxation", _re.compile(r"\b(relax|chill|wind down|aaram)\b", _re.I))]
_SCENE_VERB = _re.compile(r"\b(mode|scene|set|kar|karo|do|banao|time)\b", _re.I)
_QUESTION = _re.compile(r"^\s*(is|are|was|kya|what|which|why|how|did|does|do you|can you tell)\b|\?\s*$", _re.I)


MAX_COMMAND_WORDS = 14


def parse(text):
    """[(device, action, value)] for an imperative room command, else []."""
    t = (text or "").strip()
    if not t or _QUESTION.search(t):
        return []
    # Commands are short. On 10-13 this parser read 89-134-word monologues as orders
    # ("...all these things..." + "turned off the noise cancelling" -> all off) and
    # switched the room, answering a long question with "The light is off". A long
    # turn goes to the model, which still has the switch tools when he really asks.
    if len(t.split()) > MAX_COMMAND_WORDS:
        return []
    for name, rx in _SCENE:
        if rx.search(t) and _SCENE_VERB.search(t) and not any(d.search(t) for _, d in _DEV):
            return [("environment", name, name)]
    devices = [name for name, rx in _DEV if rx.search(t)]
    if not devices:
        if _ALL.search(t) and (_ON.search(t) or _OFF.search(t)):
            devices = ["all"]
        else:
            return []
    pct = _PCT.search(t)
    if pct:
        action, value = "set", max(0, min(100, int(pct.group(1))))
    elif _OFF.search(t):
        action, value = "off", None
    elif _DIM.search(t):
        action, value = "dim", None
    elif _UP.search(t):
        action, value = "brighten", None
    elif _ON.search(t):
        action, value = "on", None
    else:
        return []
    return [(d, action, value) for d in devices]


def describe(device):
    """One short, true sentence about a device after a change."""
    if device in ("all", "environment"):
        return " ".join(describe(d) for d in ("light", "fan"))
    s = state[device]
    noun = "light" if device == "light" else "fan"
    if not s["on"]:
        return f"The {noun} is off."
    return f"The {noun} is on at {s['level']} percent."

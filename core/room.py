"""JARVIS's own copy of the room: which switchable devices are on.

The app (app/jarvis_app/limbs.py) owns the room and is the ONLY writer to the relays
(an Arduino Uno over USB since 2026-10-13). This module mirrors its state for the voice
path and for JARVIS run without the app (a virtual room then).

Until 2026-10-15 every change was also published on MQTT (jarvis/room/<device>,
retained) for the ESP32, whose firmware switches relays on those topics: a second relay
writer beside the app. That publisher is gone; MQTT_OK stays (always False) for the
callers that report it.

The relays only switch: a device is on or off. "set", "dim" and "brighten" switch it on
(the voice path answers a level request with no_levels() before it gets here). The
devices and the modes ("deep focus", "wind down", ones he made in the Limbs tab) come
from core/room_config.py: the same files the app reads.
"""
import room_config

MQTT_OK = False          # nothing publishes room state on MQTT any more (see above)

ACTIONS = ("on", "off", "set", "dim", "brighten")


def _devices():
    return room_config.load_devices()[0]


def _fresh_state():
    return {d["id"]: {"on": False} for d in _devices()}


state = _fresh_state()

# Called with (device, state) after every change. The desktop app sets this (via
# jarvis.py) to stream room changes to the Limbs tab; None when run standalone.
on_change = None


def _publish(device):
    if on_change is not None:
        on_change(device, dict(state[device]))


def _switch(d, on):
    """Set one device; True when it changed."""
    s = state.setdefault(d, {"on": False})
    s.pop("level", None)
    if s["on"] == on:
        return False
    s["on"] = on
    _publish(d)
    return True


def apply(device, action, value=None):
    """Apply a device command or a mode; returns one short sentence."""
    if device == "environment":
        name = str(value) if value else str(action)
        mode = room_config.find_mode(room_config.load_modes()["modes"], name)
        if mode is None:
            return f"Unknown mode '{name}'."
        for d, on in room_config.resolve(mode, list(state)).items():
            _switch(d, on)
        return f"{mode['name']}: " + describe("all")
    targets = list(state) if device == "all" else [device]
    replies = []
    for d in targets:
        if d not in state:
            replies.append(f"Error: Device '{d}' does not exist.")
            continue
        if action not in ACTIONS:
            replies.append(f"Error: unknown action '{action}'.")
            continue
        _switch(d, action != "off")
        replies.append(f"{d} {'on' if state[d]['on'] else 'off'}")
    return "; ".join(replies)


def render():
    """One-line room status for the console."""
    return "   ".join(f"{d.upper():5} [{'ON ' if s['on'] else 'off'}]" for d, s in state.items())


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

# One sentence, several orders. On 10-14 a sentence asking for the light ON and the fan
# OFF switched BOTH off: the whole sentence was searched for a verb and "off" won. Each
# clause now gets its own verb; a clause naming only a device ("... and the fan")
# borrows the verb of the clause before it (or after it: "the light and the fan off").
_CLAUSE = _re.compile(r"\s*(?:[,;]|\band then\b|\bthen\b|\band\b|\baur\b|\bphir\b|\bplus\b|\balso\b)\s*", _re.I)
# The relays only switch (an Arduino relay board): the fan's speed is its wall regulator
# and nothing dims the light. A speed or brightness request gets the truth, not a fake
# percentage (10-14: a request for more fan speed got "I haven't checked the light and fan").
_LEVEL_WORDS = _re.compile(r"\b(speed|brightness|dim(?:mer|med|ming)?|regulator|faster|slower|brighter|"
                           r"increase|decrease|tez|dheem[ai]|level)\b", _re.I)
LEVEL_SAY = {
    "fan": "The fan's speed is on your wall regulator, sir; I can only switch it on or off.",
    "light": "The light has no dimmer, sir; I can only switch it on or off.",
    "all": "I can only switch the light and fan on or off, sir; the fan's speed is on your wall regulator.",
}


def no_levels(device):
    """The one true sentence for a speed or brightness request."""
    return LEVEL_SAY.get(device, LEVEL_SAY["all"])


def _verb(clause):
    """(action, value) a clause asks for, or None. On/off beat a level word ("fan on
    full" switches it on); a level alone is a "level" request the relays cannot do."""
    if _OFF.search(clause):
        return "off"
    if _ON.search(clause):
        return "on"
    if _PCT.search(clause) or _DIM.search(clause) or _UP.search(clause) or _LEVEL_WORDS.search(clause):
        return "level"
    return None


def _wants_level(clause):
    return bool(_PCT.search(clause) or _LEVEL_WORDS.search(clause) or _UP.search(clause) and
                _re.search(r"\b(full|fast(er)?|tez|zyada)\b", clause, _re.I))


# Words around a mode's name that do not change which mode he means.
_MODE_FILLER = _re.compile(r"\b(hey|ok|okay|jarvis|please|plz|now|set|switch( to)?|activate|start|turn on|go|"
                           r"enable|put|the|room|in(to)?|to|mode|scene|on|karo|kar( do)?|kardo|lagao|chalu|chalao|"
                           r"wala|vala)\b", _re.I)


def _mode_named(t):
    """The mode id when the whole utterance is a mode's name ("Jarvis, deep focus",
    "set wind down", "reading mode"), else None. "All off" is left to the device path
    (same effect, and "sab band" must stay a device command)."""
    rest = room_config.norm(_MODE_FILLER.sub(" ", room_config.norm(t)))
    if not rest:
        return None
    try:
        modes = room_config.load_modes()["modes"]
    except Exception:
        return None
    m = room_config.find_mode(modes, rest)
    if m is None or m["id"] == "all_off":
        return None
    return m["id"]


def _extra_devices():
    """Devices beyond the light and the fan (devices.json): (id, regex on id or name)."""
    out = []
    for d in _devices():
        if d["id"] in ("light", "fan"):
            continue
        words = {d["id"].replace("_", " "), room_config.norm(d["name"])}
        out.append((d["id"], _re.compile(r"\b(" + "|".join(_re.escape(w) for w in words if w) + r")\b", _re.I)))
    return out


# The wall box (2026-10-28, six relays): a word that several device names share groups
# them, so "pink on" is both pink coves and "warm lights off" both warm ones. Plain words
# ("lights", "ceiling") never group. A whole name ("pink outer") still wins over its group.
_GROUP_STOP = {"light", "lights", "lamp", "lamps", "the", "ceiling", "room", "cove", "coves", "and"}


def _groups():
    """[(device ids, regex)] for every word shared by two or more device names."""
    words = {}
    for d in _devices():
        for w in set(room_config.norm(d["name"]).split()):
            if w in _GROUP_STOP or len(w) < 3:
                continue
            words.setdefault(w, []).append(d["id"])
    return [(ids, _re.compile(r"\b" + _re.escape(w) + r"s?\b", _re.I)) for w, ids in words.items() if len(ids) >= 2]


def _devices_in(clause, extra, groups=()):
    named = [name for name, rx in extra if rx.search(clause)]
    if named:                                      # "desk lamp" is the desk lamp, not also the light
        return named
    grouped = []
    for ids, rx in groups:
        if rx.search(clause):
            grouped.extend(i for i in ids if i not in grouped)
    if grouped:                                    # "pink on": every pink cove, not the main light
        return grouped
    return [name for name, rx in _DEV if rx.search(clause)]


# "Brighter" / "dimmer" with no device named: the relays cannot dim, but the wall box's
# combinations can, so the request steps along this ladder of lighting modes (only the
# rungs modes.json has). Below the lowest rung every light goes off; the fan is left alone.
LADDER = ("night_light", "movie", "relaxation", "focus", "reading", "morning", "all_lights")
# Only these words climb or descend; a stray "up" ("wake me up", "showing up") never does.
_LADDER_UP = _re.compile(r"\b(brighter|brighten|more light|roshni badhao|thoda tez)\b", _re.I)
_LADDER_DOWN = _re.compile(r"\b(dimmer|dim|darker|less light|roshni kam|thoda kam)\b", _re.I)


def _ladder(direction):
    """[(device, action, value)] for one step up or down the ladder, or [] when the room
    has fewer than two rungs (then the old answer: the light has no dimmer)."""
    try:
        modes = room_config.load_modes()["modes"]
    except Exception:
        return []
    by_id = {m["id"]: m for m in modes}
    rungs = [r for r in LADDER if r in by_id]
    lights = [d["id"] for d in _devices() if d["kind"] == "light"]
    if len(rungs) < 3 or not lights:             # two rungs is a switch, not a ladder
        return []
    on_now = {d for d in lights if state.get(d, {}).get("on")}
    sets = [{d for d, on in room_config.resolve(by_id[r], lights).items() if on} for r in rungs]
    here = next((i for i, s in enumerate(sets) if s == on_now), None)
    if here is None:                               # not on a rung: the nearest by how many are on
        here = -1 if not on_now else min(range(len(sets)), key=lambda i: (abs(len(sets[i]) - len(on_now)), i))
    nxt = here + (1 if direction == "up" else -1)
    if nxt < 0:
        return [(d, "off", None) for d in lights]
    nxt = min(nxt, len(rungs) - 1)                 # the top stays the top
    return [("environment", rungs[nxt], rungs[nxt])]


def parse(text):
    """[(device, action, value)] for an imperative room command, else []. action is
    on | off | level ("level": a speed or brightness request; say no_levels(device))."""
    t = (text or "").strip()
    if not t:
        return []
    # Commands are short. On 10-13 this parser read 89-134-word monologues as orders
    # ("...all these things..." + "turned off the noise cancelling" -> all off) and
    # switched the room, answering a long question with "The light is off". A long
    # turn goes to the model, which still has the switch tools when he really asks.
    if len(t.split()) > MAX_COMMAND_WORDS:
        return []
    if not _QUESTION.search(t):
        mode = _mode_named(t)
        if mode is not None:
            return [("environment", mode, mode)]
    extra = _extra_devices()
    groups = _groups()
    if _QUESTION.search(t):
        # "Why can't you increase the fan speed?" has one true answer, whoever asks.
        devices = _devices_in(t, extra, groups)
        if devices and _LEVEL_WORDS.search(t):
            return [(devices[0] if len(devices) == 1 else "all", "level", None)]
        return []
    for name, rx in _SCENE:
        if rx.search(t) and _SCENE_VERB.search(t) and not _devices_in(t, extra, groups):
            return [("environment", name, name)]
    clauses = []
    for c in (p for p in _CLAUSE.split(t) if p and p.strip()):
        devices = _devices_in(c, extra, groups)
        verb = _verb(c)
        if not devices and _ALL.search(c) and verb in ("on", "off"):
            devices = ["all"]
        clauses.append([devices, verb, c])
    # A verb with no device ("... and make it faster") acts on the device before it.
    for i, cl in enumerate(clauses):
        if cl[1] and not cl[0] and i > 0 and clauses[i - 1][0]:
            cl[0] = list(clauses[i - 1][0])
    # A device with no verb borrows the nearest verb: before it, else after it.
    for i, cl in enumerate(clauses):
        if cl[0] and not cl[1]:
            before = next((c[1] for c in reversed(clauses[:i]) if c[1] and c[0]), None)
            after = next((c[1] for c in clauses[i + 1:] if c[1]), None)
            cl[1] = before or after
    out = []
    for devices, verb, c in clauses:
        if not devices and verb == "level" and len(c.split()) <= 5 and (_LADDER_UP.search(c) or _LADDER_DOWN.search(c)):
            for cmd in _ladder("up" if _LADDER_UP.search(c) else "down"):   # "brighter": the next rung
                if cmd not in out:
                    out.append(cmd)
            continue
        if not devices or not verb:
            continue
        for d in devices:
            cmds = [(d, verb, None)]
            if verb == "on" and _wants_level(c):
                cmds.append((d, "level", None))      # "fan on full speed": on, and the truth about speed
            for cmd in cmds:
                if cmd not in out:
                    out.append(cmd)
    return out


def describe(device):
    """One short, true sentence about a device after a change."""
    if device in ("all", "environment"):
        return " ".join(describe(d) for d in state)
    s = state[device]
    noun = device if device in ("light", "fan") else next(
        (d["name"].lower() for d in _devices() if d["id"] == device), device)
    return f"The {noun} is {'on' if s.get('on') else 'off'}."

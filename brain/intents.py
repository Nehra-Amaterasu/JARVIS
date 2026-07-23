"""Rule-based intent parser. Swappable for Claude API later (Phase 3)."""
import re

def parse(text: str):
    """Return (device, action, value) or None. value is 0-100 or None."""
    t = text.lower().strip()

    # normalize common STT slips
    t = t.replace("per cent", "percent")

    device = None
    if re.search(r"\blight|lamp|bulb\b", t):
        device = "light"
    elif re.search(r"\bfan\b", t):
        device = "fan"
    elif re.search(r"\beverything|all\b", t):
        device = "all"

    if device is None:
        return None

    m = re.search(r"(\d{1,3})\s*(percent|%)?", t)
    value = min(100, int(m.group(1))) if m else None

    if re.search(r"\boff|kill|stop\b", t):
        return (device, "off", None)
    if re.search(r"\bdim|lower|decrease|reduce|slow\b", t):
        return (device, "dim", value)  # value=None means "step down"
    if re.search(r"\bbright|raise|increase|faster|speed up|full\b", t):
        return (device, "brighten", value if value is not None else (100 if "full" in t else None))
    if value is not None and re.search(r"\bset|to|at\b", t):
        return (device, "set", value)
    if re.search(r"\bon|turn on|start\b", t):
        return (device, "on", value)
    if value is not None:
        return (device, "set", value)
    return None

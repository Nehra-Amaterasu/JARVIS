"""Away mode from JARVIS's side: "Jarvis, arm the house" (ROADMAP SIH-1).

    "arm the house" / "turn on away mode" / "ghar arm kar do"   -> armed (exit delay first)
    "is the house armed?" / "away mode status"                 -> the real state, from the app
    "disarm the house" / "away mode off"                       -> refused, by design

Disarming by voice is refused: anyone standing in the house can say the words,
including the person the alarm is for. Away mode disarms from the app, or by itself
when a family phone joins the Wi-Fi.

Parsing is deterministic regex, like mission.py: "arm the house" must never be heard
as something else, and it must be instant. Every reply is built from the app's answer
(POST /api/security/arm, GET /api/security), so JARVIS never says "armed" unless the
app says it is. "Alarm" alone is not a trigger — that is usually the alarm clock.
Outside the app (no JARVIS_API_URL) every function quietly does nothing.
"""
from __future__ import annotations

import os
import re
from typing import Optional

# "arm" is unambiguous, so it may take the house as its object. Softer verbs ("turn
# on", "start") need an object that can only mean security: "turn on the house
# lights" and "start the house music" must stay with the lights and the music.
_DET = r"(?:the\s+|my\s+|our\s+)?"
_SECURITY = (r"(?:away\s*mode|home\s+security|house\s+security|security(?:\s+system)?|burglar\s+alarm"
             r"|security\s+alarm|alarm\s+system)")
_ARM = re.compile(
    r"\barm\s+" + _DET + r"(?:house|home|ghar|flat|security|away\s*mode|alarm(?:\s+system)?)\b"
    r"|\b(?:activate|enable|turn\s+on|switch\s+on|start)\s+" + _DET + _SECURITY + r"\b"
    r"|\b(?:ghar|security|away\s*mode)\s+(?:ko\s+)?(?:arm|on|chalu|activate)\b", re.I)
_DISARM = re.compile(
    r"\bdisarm\b"
    r"|\b(?:deactivate|disable|turn\s+off|switch\s+off|stop)\s+" + _DET + _SECURITY + r"\b"
    r"|\b(?:security|away\s*mode)\s+(?:ko\s+)?(?:off|band|deactivate|hata)\b", re.I)
_STATUS = re.compile(
    r"\b(?:is|are)\s+(?:the\s+)?(?:house|home|ghar|security|away\s*mode)\s+(?:still\s+)?(?:armed|on|active)\b"
    r"|\b(?:away\s*mode|security)\s+status\b"
    r"|\bghar\s+arm(?:ed)?\s+hai\b", re.I)
_QUESTION = re.compile(r"^\s*(?:what|how|why|can|could|should|would|does|do)\b", re.I)


def parse(text: str) -> Optional[str]:
    """'arm' | 'disarm' | 'status' | None (not about away mode)."""
    t = (text or "").strip()
    if len(t) < 4:
        return None
    if _STATUS.search(t):
        return "status"
    if _DISARM.search(t):
        return "disarm"
    if _ARM.search(t) and not _QUESTION.search(t):
        return "arm"
    return None


# ------------------------------------------------------------------ talking to the app
def _api():
    url, tok = os.environ.get("JARVIS_API_URL"), os.environ.get("JARVIS_API_TOKEN")
    return (url, tok) if url and tok else (None, None)


def _post(path: str, payload: dict, timeout: float = 4.0):
    import httpx
    url, tok = _api()
    return httpx.post(f"{url}{path}", json=payload, headers={"X-Jarvis-Token": tok}, timeout=timeout)


def _get(path: str, timeout: float = 2.0):
    import httpx
    url, tok = _api()
    return httpx.get(f"{url}{path}", headers={"X-Jarvis-Token": tok}, timeout=timeout)


def _sensor_note(st: dict) -> str:
    aank = st.get("aankhen") or {}
    if not aank.get("running"):
        return " Aankhen is not running, so nothing is being watched yet."
    if aank.get("mode") != "hardware":
        return " Aankhen is in simulation, so the real house is not being watched."
    return ""


def arm_reply(st: dict, was_armed: bool) -> str:
    if was_armed:
        return "Away mode was already armed." + _sensor_note(st)
    if not st.get("armed"):
        return "The app did not arm away mode, so the house is not armed."
    left = st.get("exit_left_s")
    parts = ["Away mode is armed."]
    if left:
        parts.append(f"I'll start watching in {round(left)} seconds, so you have time to leave.")
    if (st.get("config") or {}).get("phones"):
        parts.append("It disarms itself when a family phone joins the Wi-Fi.")
    else:
        parts.append("No family phones are listed, so disarm it from the app when you're back.")
    return " ".join(parts) + _sensor_note(st)


def status_reply(st: dict) -> str:
    phase = st.get("phase")
    if phase == "disarmed":
        auto = st.get("auto_arm") or {}
        if auto.get("enabled") and auto.get("arms_in_s"):
            return f"The house is not armed. It will arm itself in about {round(auto['arms_in_s'] / 60)} minutes if nobody's phone is seen."
        return "The house is not armed."
    if phase == "arming":
        return f"Away mode is armed and starts watching in {round(st.get('exit_left_s') or 0)} seconds."
    if phase == "pending":
        return "Away mode has confirmed motion and the alarm is about to sound."
    if phase == "alarm":
        return "Away mode is in alarm: motion was confirmed inside while armed."
    return "Away mode is armed and watching." + _sensor_note(st)


DISARM_REFUSAL = ("For safety I don't disarm by voice, since anyone in the house could say that. "
                  "Disarm it from the app, or it disarms itself when your phone joins the Wi-Fi.")


def handle(text: str) -> Optional[str]:
    """If `text` is an away-mode command, carry it out and return JARVIS's answer."""
    intent = parse(text)
    if intent is None or _api()[0] is None:
        return None
    if intent == "disarm":
        return DISARM_REFUSAL
    try:
        if intent == "status":
            r = _get("/api/security")
            return status_reply(r.json()) if r.status_code == 200 else "I couldn't read away mode's state just now."
        before = _get("/api/security")
        was_armed = before.status_code == 200 and bool(before.json().get("armed"))
        r = _post("/api/security/arm", {"by": "voice"})
        if r.status_code != 200:
            return "The app refused to arm away mode, so the house is not armed."
        st = _get("/api/security")
        return arm_reply(st.json() if st.status_code == 200 else r.json(), was_armed)
    except Exception:
        return "I couldn't reach the app, so the house is not armed." if intent == "arm" else \
            "I couldn't reach the app to check away mode."

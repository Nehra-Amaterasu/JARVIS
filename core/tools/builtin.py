"""The tools JARVIS really has, each returning a receipt.

Where the truth lives decides where a tool goes:
  * the room's light and fan, Aankhen and reminders are owned by the app server
    (app/jarvis_app), so the tools call its local API (JARVIS_API_URL, per-launch
    token) and report what the APP says happened — including "virtual room, no relay
    board", which is the honest state of the hardware today;
  * run from a terminal without the app, the room falls back to core/room.py's
    virtual state (said so in the receipt) and reminders refuse, because nothing
    would be running to fire them.
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import quote

from . import media as media_words
from .registry import Receipt, Registry, Tier, Tool
from .when import fmt_clock

API_TIMEOUT = 3.0
# One HTTP client for the process. Each one-shot httpx.request built a new client, and
# that costs 0.46-0.67 s on this laptop (1.1 s the first time) before a byte is sent:
# measured 2026-10-13, paid on every tool call. httpx clients are safe to share.
_client = None


class NoApp(RuntimeError):
    pass


class ToolContext:
    """What a tool may reach. Everything is injectable so tests never need the app,
    Ollama or a network."""

    def __init__(self, api_url: Optional[str] = None, api_token: Optional[str] = None,
                 http: Optional[Callable[..., tuple]] = None, now: Optional[Callable[[], datetime]] = None,
                 room=None, memory_search: Optional[Callable[[str], str]] = None, origin: str = "voice"):
        self.api_url, self.api_token = api_url, api_token
        self._http = http
        self.now = now or datetime.now
        self.room = room
        self.memory_search = memory_search
        self.origin = origin

    @classmethod
    def from_env(cls, **kw) -> "ToolContext":
        return cls(os.environ.get("JARVIS_API_URL"), os.environ.get("JARVIS_API_TOKEN"), **kw)

    @property
    def has_app(self) -> bool:
        return self._http is not None or bool(self.api_url and self.api_token)

    def api(self, method: str, path: str, body: Any = None, timeout: float = API_TIMEOUT) -> tuple[int, Any]:
        """(status, json) from the app server. Raises NoApp when JARVIS runs alone."""
        if not self.has_app:
            raise NoApp("the JARVIS app is not running")
        if self._http is not None:
            return self._http(method, path, body, timeout)
        global _client
        if _client is None:
            import httpx
            _client = httpx.Client()
        r = _client.request(method, f"{self.api_url}{path}", json=body, timeout=timeout,
                            headers={"X-Jarvis-Token": self.api_token})
        try:
            data = r.json()
        except ValueError:
            data = {"detail": r.text[:200]}
        return r.status_code, data


def _detail(data: Any) -> str:
    if isinstance(data, dict):
        return str(data.get("detail") or data.get("error") or data)[:200]
    return str(data)[:200]


# ------------------------------------------------------------------ T0: reading
def get_datetime(ctx: ToolContext) -> Receipt:
    now = ctx.now()
    return Receipt("get_datetime", "T0", True, f"It is {fmt_clock(now)} on {now:%A} {now.day} {now:%B %Y}.",
                   source="the laptop's clock", backs=("time",),
                   data={"iso": now.isoformat(timespec="minutes"), "weekday": now.strftime("%A")})


def _say_device(d: str, st: dict) -> str:
    noun = "light" if d == "light" else "fan"
    return f"The {noun} is off." if not st.get("on") else f"The {noun} is on at {int(st.get('level', 0))} percent."


VIRTUAL_NOTE = "Virtual room only; no relay board is connected."


def _limbs_view(ctx: ToolContext) -> Optional[dict]:
    status, v = ctx.api("GET", "/api/limbs")
    return v if status == 200 and isinstance(v, dict) else None


def room_state(ctx: ToolContext) -> Receipt:
    if ctx.has_app:
        try:
            v = _limbs_view(ctx)
        except Exception as e:
            v, err = None, str(e)
        else:
            err = "the app did not answer"
        if v is not None:
            states = {d["id"]: d.get("state") or {} for d in v.get("devices", [])}
            usb = bool(v.get("usb"))
            did = " ".join(_say_device(d, s) for d, s in states.items())
            return Receipt("room_state", "T0", True, did + ("" if usb else " " + VIRTUAL_NOTE),
                           source="app · Limbs " + ("(relay board over USB)" if usb else "(virtual room)"),
                           simulated=not usb, backs=("switch_state",),
                           data={"state": states, "usb": usb,
                                 "confirmed": {d["id"]: d.get("confirmed") for d in v.get("devices", [])}})
        return Receipt("room_state", "T0", False, "I couldn't read the room from the app.", source="app · Limbs",
                       error=err)
    if ctx.room is not None:
        states = {d: dict(s) for d, s in ctx.room.state.items()}
        return Receipt("room_state", "T0", True, " ".join(_say_device(d, s) for d, s in states.items())
                       + " " + VIRTUAL_NOTE, source="JARVIS's own virtual room (no app)", simulated=True,
                       backs=("switch_state",), data={"state": states})
    return Receipt("room_state", "T0", False, "I can't see the room's switches right now.", source="none",
                   error="no app and no room module")


def presence(ctx: ToolContext) -> Receipt:
    """Aankhen's verdict. Simulated people are never reported as real ones: the 4B
    model cannot be trusted to carry a provenance label (agent.room_context, 10-09)."""
    try:
        status, snap = ctx.api("GET", "/api/aankhen/snapshot", timeout=1.0)
    except NoApp:
        return Receipt("presence", "T0", False, "I can't see the room: the JARVIS app with Aankhen isn't running.",
                       source="none", error="app not running")
    except Exception as e:
        return Receipt("presence", "T0", False, "Aankhen didn't answer.", source="app · Aankhen", error=str(e))
    pres, src = (snap or {}).get("presence"), (snap or {}).get("source")
    if status != 200 or not pres or not src:
        return Receipt("presence", "T0", False, "Aankhen isn't running, so I can't see the room.",
                       source="app · Aankhen", error="no source")
    if src != "hardware":
        return Receipt("presence", "T0", True, "Aankhen is running a simulation, so I can't see who is really in "
                       "the room.", source=f"app · Aankhen ({src})", simulated=True, data={"source": src})
    people = snap.get("people") or []
    state, conf = pres.get("state"), float(pres.get("confidence") or 0)
    learned = snap.get("learned") or {}
    if not people and learned.get("state"):
        # No radar: one Wi-Fi link gives no position, so where I am comes from the
        # spatial model trained on this room, and what I am doing from the activity
        # model. Said as the sensors' estimate, with how long and today's totals.
        return _learned_presence(learned, snap.get("journal") or {})
    if state == "empty":
        did = f"The room sensors say the room looks empty ({conf:.0%} confident)."
    elif state == "uncertain" or (not people and state not in ("moving", "still")):
        did = "The room sensors are unsure whether anyone is in the room."
    else:
        def one(p):
            return ("someone sitting or standing still" if p.get("still") else "someone moving") + \
                (f" at the {p['zone']}" if p.get("zone") else "")
        did = ("The room sensors see " + ("; ".join(one(p) for p in people) or "someone, with no position")
               + f" ({conf:.0%} confident).")
    return Receipt("presence", "T0", True, did, source="app · Aankhen (live sensors)", backs=("presence",),
                   data={"state": state, "confidence": conf, "people": people})


_ZONE_WORDS = {"desk": "at your desk", "bed": "on your bed", "room": "in your room, away from the desk and bed",
               "outside": "out of your room (someone is moving elsewhere in the house)",
               "empty": "out of your room, and the house is quiet"}
_ACT_WORDS = {"still": "keeping still", "typing": "typing", "waving": "waving or moving your arms",
              "walking": "walking around"}


def _mins(s: float) -> str:
    m = int(round(s / 60))
    return f"{m // 60} h {m % 60} min" if m >= 60 else f"{max(m, 1)} min" if s >= 30 else f"{int(s)} s"


def _learned_presence(learned: dict, journal: dict) -> Receipt:
    zone, p = learned.get("state"), learned.get("p") or {}
    act = (learned.get("activity") or {}).get("state")
    conf = float(p.get(zone, 0) or 0)
    did = f"The room sensors estimate you are {_ZONE_WORDS.get(zone, zone)}"
    if act and act != "none" and zone in ("desk", "bed", "room"):
        did += f", {_ACT_WORDS.get(act, act)}"
    did += f" (model, {conf:.0%})."
    now = journal.get("now") or {}
    if now.get("zone") == zone and now.get("seconds"):
        did += f" That has held for {_mins(now['seconds'])}."
    zones = (journal.get("today") or {}).get("zones") or {}
    if zones:
        top = sorted(((k, v) for k, v in zones.items() if k in ("desk", "bed", "room")), key=lambda kv: -kv[1])
        if top:
            did += " Today so far: " + ", ".join(f"{k} {_mins(v)}" for k, v in top) + "."
    return Receipt("presence", "T0", True, did, source="app · Aankhen (live board, learned models)",
                   backs=("presence",), data={"zone": zone, "activity": act, "confidence": conf,
                                              "journal": journal})


def memory_search(ctx: ToolContext, query: str) -> Receipt:
    q = query.strip()
    if ctx.memory_search is not None:
        found = (ctx.memory_search(q) or "").strip()
        if not found:
            return Receipt("memory_search", "T0", True, f"Nothing in his memory matches “{q}”.",
                           source="Yaadash (local)", backs=("memory_read",), data={"found": ""})
        return Receipt("memory_search", "T0", True, f"Searched his memory for “{q}”.", source="Yaadash (local)",
                       backs=("memory_read",), data={"found": found[:1500]})
    try:
        status, res = ctx.api("GET", f"/api/memory/search?q={quote(q)}&k=3", timeout=20.0)
    except NoApp:
        return Receipt("memory_search", "T0", False, "Memory search isn't available right now.", source="none",
                       error="no memory search")
    if status != 200:
        return Receipt("memory_search", "T0", False, "Memory search failed.", source="app · Yaadash",
                       error=_detail(res))
    facts = [f.get("text") for f in res.get("facts", []) if f.get("text")][:4]
    moments = [" / ".join(m.get("text", "") for m in e.get("messages", [])[:3]) for e in res.get("excerpts", [])][:2]
    n = len(facts) + len(moments)
    return Receipt("memory_search", "T0", True,
                   f"Searched his memory for “{q}”: {n} result{'s' if n != 1 else ''}." if n
                   else f"Nothing in his memory matches “{q}”.", source="app · Yaadash", backs=("memory_read",),
                   data={"facts": facts, "moments": moments})


def list_reminders(ctx: ToolContext) -> Receipt:
    try:
        status, res = ctx.api("GET", "/api/reminders")
    except NoApp:
        return _no_app("list_reminders")
    if status != 200:
        return Receipt("list_reminders", "T0", False, "I couldn't read the reminders.", source="app · reminders",
                       error=_detail(res))
    return Receipt("list_reminders", "T0", True, res.get("say") or "You have no reminders.",
                   source="app · reminders", backs=("reminder_read",),
                   data={"items": [{k: r.get(k) for k in ("id", "kind", "text", "due", "repeat")}
                                   for r in res.get("items", [])][:12]})


# ------------------------------------------------------------------ T1: reversible home actions
def set_device(ctx: ToolContext, device: str, action: str, value: Optional[int] = None) -> Receipt:
    if ctx.has_app:
        try:
            status, res = ctx.api("POST", f"/api/limbs/{device}", {"action": action, "value": value})
        except Exception as e:
            return Receipt("set_device", "T1", False, "The app didn't take the switch command.",
                           source="app · Limbs", error=str(e))
        if status != 200:
            return Receipt("set_device", "T1", False, f"The switch command was refused: {_detail(res)}.",
                           source="app · Limbs", error=_detail(res))
        state = res.get("state") or {}
        delivered = res.get("delivered") or {}
        targets = ["light", "fan"] if device == "all" else [device]
        did = " ".join(_say_device(d, state.get(d, {})) for d in targets)
        try:
            view = _limbs_view(ctx) or {}
        except Exception:
            view = {}
        usb = bool(view.get("usb")) or any(delivered.values())
        failed = [d for d, ok in delivered.items() if not ok]
        if failed and usb:
            return Receipt("set_device", "T1", False, did + f" Saved, but the relay board did not take it for "
                           f"{', '.join(failed)}.", source="app · Limbs (relay board over USB)",
                           error="relay not delivered", data={"state": state, "delivered": delivered})
        return Receipt("set_device", "T1", True, did + ("" if usb else " " + VIRTUAL_NOTE),
                       source="app · Limbs " + ("(relay board over USB)" if usb else "(virtual room)"),
                       simulated=not usb, backs=("switch", "switch_state"),
                       data={"state": {d: state.get(d) for d in targets}, "delivered": delivered,
                             "changed": res.get("changed", [])})
    if ctx.room is not None:
        ctx.room.apply(device, action, value)
        targets = ["light", "fan"] if device == "all" else [device]
        did = " ".join(_say_device(d, ctx.room.state[d]) for d in targets)
        return Receipt("set_device", "T1", True, did + " " + VIRTUAL_NOTE, source="JARVIS's own virtual room (no app)",
                       simulated=True, backs=("switch", "switch_state"),
                       data={"state": {d: dict(ctx.room.state[d]) for d in targets}})
    return Receipt("set_device", "T1", False, "I can't reach the room's switches right now.", source="none",
                   error="no app and no room module")


_SCENE_SAY = {"focus": "Deep focus", "relaxation": "Wind down", "sleep": "Sleep"}


def set_scene(ctx: ToolContext, scene: str) -> Receipt:
    if ctx.has_app:
        try:
            status, res = ctx.api("POST", f"/api/limbs/scene/{scene}")
        except Exception as e:
            return Receipt("set_scene", "T1", False, "The app didn't take the scene.", source="app · Limbs",
                           error=str(e))
        if status != 200:
            return Receipt("set_scene", "T1", False, f"The scene was refused: {_detail(res)}.", source="app · Limbs",
                           error=_detail(res))
        state = res.get("state") or {}
        try:
            usb = bool((_limbs_view(ctx) or {}).get("usb"))
        except Exception:
            usb = False
        did = f"{_SCENE_SAY.get(scene, scene)} scene: " + " ".join(_say_device(d, state.get(d, {})) for d in ("light", "fan"))
        return Receipt("set_scene", "T1", True, did + ("" if usb else " " + VIRTUAL_NOTE),
                       source="app · Limbs " + ("(relay board over USB)" if usb else "(virtual room)"),
                       simulated=not usb, backs=("switch", "switch_state"), data={"state": state})
    if ctx.room is not None:
        ctx.room.apply("environment", scene, scene)
        did = f"{_SCENE_SAY.get(scene, scene)} scene: " + " ".join(_say_device(d, ctx.room.state[d]) for d in ("light", "fan"))
        return Receipt("set_scene", "T1", True, did + " " + VIRTUAL_NOTE, source="JARVIS's own virtual room (no app)",
                       simulated=True, backs=("switch", "switch_state"))
    return Receipt("set_scene", "T1", False, "I can't reach the room's switches right now.", source="none",
                   error="no app and no room module")


def _no_app(name: str) -> Receipt:
    return Receipt(name, "T1", False, "I can't do reminders right now: they live in the JARVIS app, and it isn't "
                   "running, so nothing would fire them.", source="none", error="app not running")


def _post_reminder(ctx: ToolContext, name: str, body: dict) -> Receipt:
    try:
        status, res = ctx.api("POST", "/api/reminders", body)
    except NoApp:
        return _no_app(name)
    except Exception as e:
        return Receipt(name, "T1", False, "The reminders service didn't answer.", source="app · reminders",
                       error=str(e))
    if status != 200:
        why = _detail(res)
        return Receipt(name, "T1", False, f"I couldn't set that: {why}", source="app · reminders", error=why)
    r = res.get("reminder") or {}
    backs = ("reminder", "schedule") if r.get("kind") != "action" else ("schedule", "switch")
    return Receipt(name, "T1", True, res.get("say") or "Saved.", source="app · reminders", backs=backs,
                   data={k: r.get(k) for k in ("id", "kind", "text", "due", "repeat", "interval_min", "action")})


def set_reminder(ctx: ToolContext, text: str, when: str, kind: str = "reminder") -> Receipt:
    return _post_reminder(ctx, "set_reminder", {"text": text, "when": when, "kind": kind, "origin": ctx.origin})


def switch_later(ctx: ToolContext, device: str, action: str, when: str, value: Optional[int] = None) -> Receipt:
    if device == "scene":
        act = {"device": "environment", "action": action, "value": action}
    else:
        act = {"device": device, "action": action, "value": value}
    return _post_reminder(ctx, "switch_later", {
        "kind": "action", "when": when, "origin": ctx.origin,
        "text": f"{device} {action}" + (f" {value}%" if value is not None else ""), "action": act})


def say(receipts: list[Receipt]) -> str:
    """One reply from a turn's receipts: each sentence once, the virtual-room note once."""
    parts, sim = [], False
    for r in receipts:
        did = r.did.replace(VIRTUAL_NOTE, "").strip()
        sim = sim or (r.ok and r.simulated and VIRTUAL_NOTE in r.did)
        if did and did not in parts:
            parts.append(did)
    return " ".join(parts + ([VIRTUAL_NOTE] if sim else []))


def cancel_reminder(ctx: ToolContext, query: str = "", kind: str = "", all: bool = False) -> Receipt:  # noqa: A002
    try:
        status, res = ctx.api("POST", "/api/reminders/cancel", {"query": query, "kind": kind or None, "all": all})
    except NoApp:
        return _no_app("cancel_reminder")
    if status != 200:
        return Receipt("cancel_reminder", "T1", False, f"I couldn't cancel that: {_detail(res)}",
                       source="app · reminders", error=_detail(res))
    n = len(res.get("cancelled") or [])
    return Receipt("cancel_reminder", "T1", n > 0, res.get("say") or ("Cancelled." if n else "Nothing matched."),
                   source="app · reminders", backs=("reminder",) if n else (),
                   error=None if n else "no matching reminder", data={"cancelled": res.get("cancelled") or []})


# ------------------------------------------------------------------ T1: the media player
# The app owns the player (app/jarvis_app/media.py): it opens Spotify or the browser,
# presses the media keys, plays his music folder in the window, and reads Windows' media
# sessions. Its receipt's `confirmed` is True only when something REPORTED the effect
# (the window's play(), a new Windows media session), and only then does the receipt back
# a "Now playing ..." claim: an opened Spotify search is said as exactly that.
MEDIA_TIMEOUT = 12.0        # the app waits up to 6 s for a browser to report it is playing
MEDIA_SOURCES = ("auto", "local", "youtube", "ytmusic", "spotify")
_MEDIA_FROM = {"local": "your music folder", "youtube": "YouTube", "ytmusic": "YouTube Music", "spotify": "Spotify",
               "system": "Windows volume"}


def _media_call(ctx: ToolContext, name: str, tier: str, method: str, path: str, body: Any = None) -> Receipt:
    try:
        status, res = ctx.api(method, path, body, timeout=MEDIA_TIMEOUT)
    except NoApp:
        return Receipt(name, tier, False, "I can't play or control music right now: the player lives in the JARVIS "
                       "app, and it isn't running.", source="none", error="app not running")
    except Exception as e:
        return Receipt(name, tier, False, "The media player didn't answer.", source="app · media", error=str(e))
    if status != 200 or not isinstance(res, dict):
        return Receipt(name, tier, False, f"The media player refused that: {_detail(res)}.", source="app · media",
                       error=_detail(res))
    if name == "media_state":
        now = res.get("now") or {}
        playing = now.get("status") == "Playing"
        return Receipt(name, tier, True, res.get("say") or "unknown", source="app · media (Windows media sessions)",
                       backs=("media",) if playing else (),
                       data={"now": now or None, "readable": res.get("readable"), "last": res.get("last")})
    ok, confirmed = bool(res.get("ok")), bool(res.get("confirmed"))
    src = _MEDIA_FROM.get(res.get("source") or "", "")
    return Receipt(name, tier, ok, res.get("say") or ("Done." if ok else "That didn't work."),
                   source="app · media" + (f" ({src})" if src else ""),
                   backs=("media",) if ok and confirmed else (),
                   data={k: res.get(k) for k in ("action", "source", "confirmed", "needs_click", "query") if k in res},
                   error=None if ok else (res.get("error") or "failed"))


def play_media(ctx: ToolContext, query: str, source: str = "auto") -> Receipt:
    return _media_call(ctx, "play_media", "T1", "POST", "/api/media/play", {"query": query, "source": source or "auto"})


def media_control(ctx: ToolContext, action: str, value: Optional[str] = None) -> Receipt:
    body = {"action": action} if value in (None, "") else {"action": action, "value": str(value)}
    return _media_call(ctx, "media_control", "T1", "POST", "/api/media/control", body)


def media_state(ctx: ToolContext) -> Receipt:
    return _media_call(ctx, "media_state", "T0", "GET", "/api/media/state")


class _MediaTurn:
    """When a turn may need the media tools: a music word, or a sentence the media parser
    reads as a command. Not a bare "play": "let's play chess" is no song, and the model
    must not be handed a player for it (an action it chose runs only if these match)."""
    _RX = re.compile(r"\b(?:music|songs?|gaan[ae]|gan[ae]|gaane|playlists?|albums?|spotify|youtube|lo-?fi|volume|"
                     r"ava[zj]|awaa?[zj]|now playing|what'?s playing)\b", re.I)

    def search(self, text: str):
        return self._RX.search(text or "") or media_words.parse(text or "") is not None


MEDIA_TRIGGERS = _MediaTurn()


# ------------------------------------------------------------------ T2: speaks for him (off)
def send_message(ctx: ToolContext, to: str, text: str) -> Receipt:
    return Receipt("send_message", "T2", False, "No message channel is set up, so nothing was sent.",
                   source="none", error="no channel")


# ------------------------------------------------------------------ the registry
_RX = lambda p: re.compile(p, re.I)  # noqa: E731

_ROOM_WORDS = (r"\b(lights?|lamp|bulb|batti|roshni|fan|pankha|pankhe|room|kamr[ae]|scene|mode|switch|"
               r"dim|bright|andhera|garmi)\b")
_REMIND_WORDS = (r"\b(remind\w*|timers?|alarms?|schedule\w*|yaad dila\w*|wake me|utha (?:dena|do)|"
                 r"in \d+ (minutes?|hours?|mins?)|ghante baad|minute baad)\b")


def default_registry() -> Registry:
    reg = Registry()
    reg.register(Tool(
        "get_datetime", "Read the current time, date and weekday from the laptop's clock.", {}, (), Tier.T0,
        lambda ctx: get_datetime(ctx), "tell the time, date and weekday", backs=("time",),
        # Not bare "time": "explain setup time" is a VLSI question, his core subject.
        triggers=_RX(r"\b(what(?:'s| is)? the (?:time|date|day)|what time|time (?:is it|now|kya|hua|ho gaya)|"
                     r"current (?:time|date)|today'?s date|what day|which day|kitne baje|kya time|samay kya|"
                     r"aaj (?:kya|kaun ?sa|konsa) (?:date|din)|tarikh|weekday|day of the week)\b")))
    reg.register(Tool(
        "room_state", "Read whether the room's light and fan are on, and at what level. Says when the room is "
        "virtual (no relay board).", {}, (), Tier.T0, lambda ctx: room_state(ctx),
        "read the room's light and fan", backs=("switch_state",), triggers=_RX(_ROOM_WORDS)))
    reg.register(Tool(
        "presence", "Ask the Aankhen room sensors who is in the room. Says when the sensors are only simulated.",
        {}, (), Tier.T0, lambda ctx: presence(ctx), "see who is in the room through Aankhen (live sensors only)",
        backs=("presence",),
        triggers=_RX(r"\b(anyone|someone|anybody|somebody|koi|presence|present|aankhen|sensors?|motion|"
                     r"who('?s| is) (here|home|in))\b")))
    reg.register(Tool(
        "memory_search", "Search his long-term memory (facts and past conversations) for a topic.",
        {"query": {"type": "string", "description": "what to look for", "maxLength": 200}}, ("query",), Tier.T0,
        lambda ctx, query: memory_search(ctx, query), "search his memory", backs=("memory_read",),
        triggers=_RX(r"\b(search|look up|find|check)\b.{0,20}\b(memory|memories|chats?|messages?|notes?)\b|"
                     r"\bmemory (mein|me|main)\b")))
    reg.register(Tool(
        "list_reminders", "List his pending reminders, timers and alarms.", {}, (), Tier.T0,
        lambda ctx: list_reminders(ctx), "list his reminders, timers and alarms", backs=("reminder_read",),
        triggers=_RX(_REMIND_WORDS)))
    reg.register(Tool(
        "set_device", "Switch the room's light or fan now: on, off, set to a level, dim or brighten.",
        {"device": {"type": "string", "enum": ["light", "fan", "all"]},
         "action": {"type": "string", "enum": ["on", "off", "set", "dim", "brighten"]},
         "value": {"type": "integer", "minimum": 0, "maximum": 100, "description": "level in percent, optional"}},
        ("device", "action"), Tier.T1, lambda ctx, **a: set_device(ctx, **a),
        "switch the light and fan now", backs=("switch", "switch_state"), triggers=_RX(_ROOM_WORDS)))
    reg.register(Tool(
        "set_scene", "Set a room scene: focus (light 80%, fan low), relaxation (light 30%, fan medium) or sleep "
        "(light off, fan low).", {"scene": {"type": "string", "enum": ["focus", "relaxation", "sleep"]}},
        ("scene",), Tier.T1, lambda ctx, scene: set_scene(ctx, scene), "set a room scene (focus, relaxation, sleep)",
        backs=("switch", "switch_state"), triggers=_RX(_ROOM_WORDS)))
    reg.register(Tool(
        "set_reminder", "Set a reminder, timer or alarm for anything he wants to remember or do later: a call, "
        "a task, medicine. Pass his words for the time in `when` (e.g. 'at 9 pm', 'in 10 minutes', "
        "'tomorrow 7 am', 'every day at 8 am').",
        {"text": {"type": "string", "description": "what to remind him about, in his words", "maxLength": 200},
         "when": {"type": "string", "description": "the time as he said it", "maxLength": 120},
         "kind": {"type": "string", "enum": ["reminder", "timer", "alarm"]}},
        ("text", "when"), Tier.T1, lambda ctx, **a: set_reminder(ctx, **a),
        "set reminders, timers and alarms (spoken when due while the JARVIS app is open)", backs=("reminder", "schedule"),
        triggers=_RX(_REMIND_WORDS)))
    reg.register(Tool(
        "cancel_reminder", "Cancel pending reminders that match some words, or all of one kind.",
        {"query": {"type": "string", "description": "words from the reminder", "maxLength": 120},
         "kind": {"type": "string", "enum": ["reminder", "timer", "alarm", "action", ""]},
         "all": {"type": "boolean"}}, (), Tier.T1, lambda ctx, **a: cancel_reminder(ctx, **a),
        "cancel reminders", backs=("reminder",), triggers=_RX(_REMIND_WORDS)))
    reg.register(Tool(
        "switch_later", "Switch the room's light or fan, or set a room scene, at a later time — only when he names "
        "the light, the fan or a scene ('fan off in 30 minutes', 'light off at 11 pm'). For a scene, device is "
        "'scene' and action is the scene name. Anything else to do later is a reminder (set_reminder).",
        {"device": {"type": "string", "enum": ["light", "fan", "all", "scene"]},
         "action": {"type": "string", "enum": ["on", "off", "set", "dim", "brighten", "focus", "relaxation", "sleep"]},
         "when": {"type": "string", "description": "the time as he said it", "maxLength": 120},
         "value": {"type": "integer", "minimum": 0, "maximum": 100}},
        ("device", "action", "when"), Tier.T1, lambda ctx, **a: switch_later(ctx, **a),
        "switch the light or fan at a later time", backs=("schedule", "switch"),
        triggers=_RX(r"(" + _ROOM_WORDS + r").{0,40}\b(in|at|after|baad|baje)\b")))
    reg.register(Tool(
        "play_media", "Play a song, an artist or a kind of music he names. Put his words in `query` ('Blinding Lights "
        "by The Weeknd', 'lo-fi'); set `source` only when he names one (local is his music folder).",
        {"query": {"type": "string", "description": "the song, artist or style, in his words", "maxLength": 200},
         "source": {"type": "string", "enum": list(MEDIA_SOURCES)}},
        ("query",), Tier.T1, lambda ctx, **a: play_media(ctx, **a),
        "play a song or artist he names: from his music folder in the app, YouTube's top result in his browser, or "
        "a Spotify search he starts with one click", backs=("media",), triggers=MEDIA_TRIGGERS))
    reg.register(Tool(
        "media_control", "Pause, resume, skip to the next or previous track, or change the volume of whatever is "
        "playing.", {"action": {"type": "string", "enum": ["play", "pause", "next", "prev", "volume"]},
                     "value": {"type": "string", "description": "volume only: up, down, mute or 0-100",
                               "maxLength": 8}},
        ("action",), Tier.T1, lambda ctx, **a: media_control(ctx, **a),
        "pause, resume, skip and change the volume of what is playing", backs=("media",), triggers=MEDIA_TRIGGERS))
    reg.register(Tool(
        "media_state", "Read what is playing right now, from Windows' media sessions and the JARVIS player.", {}, (),
        Tier.T0, lambda ctx: media_state(ctx), "say what is playing", backs=("media",), triggers=MEDIA_TRIGGERS))
    reg.register(Tool(
        "send_message", "Send a message to someone on his behalf.",
        {"to": {"type": "string"}, "text": {"type": "string"}}, ("to", "text"), Tier.T2,
        lambda ctx, **a: send_message(ctx, **a), "send messages or make calls for him", backs=("message",),
        triggers=_RX(r"\b(message|text|sms|whatsapp|e-?mail|mail|tell|send|call|inform)\b")))
    reg.add_direct("remember a fact he tells you", "remember that my exam is on the 12th", backs=("memory",))
    reg.add_direct("Mission Germoney: log study time he reports, brief him, start a focus session, Marks",
                   "log 2 hours of German", backs=("study_log",))
    return reg

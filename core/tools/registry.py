"""One registry for everything JARVIS can do, with permission tiers and receipts.

Until 2026-10-12 the agent had two LangChain tools, bound only when the sentence
contained one of 16 exact phrases ("turn off light", "fan speed", ...). Everything
else went to a model with no tools at all, and in real use (the 10-10 session) it
promised and claimed actions it had no way to do. The registry fixes both ends:

  * every ability is declared ONCE: name, description, argument schema, tier, the
    claims it can back, and a short phrase for the persona's capability list;
  * every call returns a RECEIPT — what was done or read, by which source, when,
    ok or failed — and a reply may only claim what a receipt shows (honesty.py).

Tiers (docs/ROADMAP.md, A2):
  T0  read only: time, date, room state, presence, memory search, the reminder list
  T1  reversible home actions: lights, fan, scenes, reminders and timers
  T2  speaks for him (messages): registered so the persona can say it exists, but
      disabled until he enables it, and never bound to the model while disabled
  T3  money or anything irreversible: never registered — register() refuses it
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional


class Tier(str, Enum):
    T0 = "T0"        # read only
    T1 = "T1"        # reversible home actions
    T2 = "T2"        # speaks for him; off until enabled
    T3 = "T3"        # money / irreversible; never registered


@dataclass
class Receipt:
    """What a tool really did. The only evidence a reply may cite."""
    tool: str
    tier: str
    ok: bool
    did: str                       # one true sentence: what was done or read (or why not)
    source: str                    # where the truth came from ("laptop clock", "app · limbs", ...)
    at: float = field(default_factory=time.time)
    simulated: bool = False        # virtual room / simulated sensors: say so
    backs: tuple = ()              # claim kinds this receipt can back (honesty.py), only if ok
    data: dict = field(default_factory=dict)
    error: Optional[str] = None
    args: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"tool": self.tool, "tier": self.tier, "ok": self.ok, "did": self.did, "source": self.source,
                "at": self.at, "simulated": self.simulated, "backs": list(self.backs), "data": self.data,
                "error": self.error, "args": self.args}

    def for_model(self) -> str:
        """The tool message the model sees: the facts, and an instruction to report
        them as they are (the 4B model embellishes anything it is not told to keep)."""
        status = "OK" if self.ok else "FAILED"
        sim = " (SIMULATED or virtual: say so)" if self.simulated else ""
        extra = ""
        if self.data:
            try:
                extra = "\nDATA: " + json.dumps(self.data, ensure_ascii=False, default=str)[:900]
            except (TypeError, ValueError):
                extra = ""
        return (f"RECEIPT {self.tool} [{self.tier}] {status}{sim}: {self.did}"
                + (f" Error: {self.error}" if self.error and not self.ok else "")
                + f" Source: {self.source}.{extra}\n"
                "Tell him this result in one short sentence. Do not add anything the receipt does not say.")


@dataclass
class Tool:
    name: str
    description: str               # for the model: when to use it
    params: dict                   # JSON schema "properties"
    required: tuple
    tier: Tier
    fn: Callable[..., Receipt]     # fn(ctx, **args) -> Receipt
    capability: str                # for the persona: "set reminders, timers and alarms"
    backs: tuple = ()              # claim kinds a successful call backs
    enabled: bool = True
    triggers: Optional[Any] = None  # compiled regex: words that mean this turn may need the tool

    def schema(self) -> dict:
        """OpenAI-style function schema; ChatOllama.bind_tools accepts it as is."""
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": {"type": "object", "properties": self.params, "required": list(self.required)}}}


# Kinds of claim a reply can make, and what to say when no tool can make it true.
# A kind with no registered tool is something JARVIS cannot do at all; the persona's
# "never possible" line and the honesty guard's replacements both come from here.
CANNOT = {
    "switch": "switch anything in the room",
    "schedule": "switch things at a later time",
    "reminder": "set reminders, timers or alarms",
    "message": "send messages, emails or calls for you",
    "track": "track or log things over time (steps, sleep, health, spending)",
    "web": "use the internet: search, weather, news, prices, uploads, bookings or purchases",
    "media": "play music or videos",
    "memory": "save things to long-term memory on my own",
    "presence": "see who is in the room",
}


class Registry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._direct: list[tuple[str, str, tuple]] = []   # (capability, example, backs)

    # ---------------------------------------------------------------- building
    def register(self, tool: Tool) -> Tool:
        if tool.tier == Tier.T3:
            raise ValueError(f"{tool.name}: T3 tools (money, irreversible) are never registered")
        if tool.tier == Tier.T2 and tool.enabled and not t2_enabled(tool.name):
            # Speaking for him is opt-in, per tool, by him — never by a default.
            tool.enabled = False
        if tool.name in self._tools:
            raise ValueError(f"tool {tool.name!r} registered twice")
        self._tools[tool.name] = tool
        return tool

    def add_direct(self, capability: str, example: str, backs: tuple = ()) -> None:
        """An ability that runs without the model (a deterministic fast path): listed
        in the persona so JARVIS knows it exists, never bound as a tool."""
        self._direct.append((capability, example, tuple(backs)))

    # ---------------------------------------------------------------- reading
    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def tools(self, enabled_only: bool = False) -> list[Tool]:
        return [t for t in self._tools.values() if t.enabled or not enabled_only]

    def bindable(self) -> list[Tool]:
        """What the model may call: enabled tools only (T2 stays unbound while off)."""
        return [t for t in self._tools.values() if t.enabled]

    def schemas(self) -> list[dict]:
        return [t.schema() for t in self.bindable()]

    def tools_backing(self, kind: str) -> list[Tool]:
        return [t for t in self._tools.values() if kind in t.backs]

    def can(self, kind: str) -> bool:
        """True when some ENABLED tool or direct command can make a claim of this kind true."""
        return any(t.enabled for t in self.tools_backing(kind)) or any(kind in b for _, _, b in self._direct)

    def wants_tools(self, text: str) -> bool:
        """Does this turn touch anything a tool does? Then the model gets the tools.

        Chit-chat stays tool-free on purpose: with tools bound, the 4B model sometimes
        calls one it does not need (a second model round, ~0.6–2 s), and a reply that
        claims an action is policed by the honesty guard either way."""
        return any(t.triggers is not None and t.triggers.search(text or "") for t in self.bindable())

    # ---------------------------------------------------------------- calling
    def call(self, name: str, args: Optional[dict], ctx, asked: Optional[str] = None) -> Receipt:
        """Run one tool. Never raises: a failure is a failed receipt.

        `asked`: what he said, when the MODEL chose this call. An action (T1/T2) then
        runs only if his words are about that tool's domain. In the first live run the
        4B model answered "schedule a call with mum at nine" by scheduling a room scene
        (it matched "schedule" to the tool's name): reads may be guessed at, actions
        may not."""
        tool = self._tools.get(name)
        args = dict(args or {})
        if tool is None:
            return Receipt(tool=name, tier="?", ok=False, did=f"There is no tool called {name}.",
                           source="tool registry", error="unknown tool", args=args)
        if not tool.enabled:
            return Receipt(tool=name, tier=tool.tier.value, ok=False,
                           did=f"I can't {to_him(tool.capability)}: that is switched off until you enable it.",
                           source="tool registry", error="disabled", args=args)
        if asked is not None and tool.tier in (Tier.T1, Tier.T2) and tool.triggers is not None \
                and not tool.triggers.search(asked):
            return Receipt(tool=name, tier=tool.tier.value, ok=False,
                           did="I didn't do that: it isn't what you asked for.",
                           source="tool registry", error="not asked", args=args)
        problem = validate(tool, args)
        if problem:
            return Receipt(tool=name, tier=tool.tier.value, ok=False, did=f"I couldn't run {name}: {problem}.",
                           source="tool registry", error=problem, args=args)
        clean = {k: v for k, v in args.items() if k in tool.params}
        try:
            r = tool.fn(ctx, **clean)
        except Exception as e:                       # a broken tool is a failed receipt, not a crash
            r = Receipt(tool=name, tier=tool.tier.value, ok=False, did=f"{name} failed: {e}",
                        source="tool registry", error=f"{type(e).__name__}: {e}")
        r.tool, r.tier, r.args = name, tool.tier.value, clean
        if not r.ok:
            r.backs = ()
        return r

    # ---------------------------------------------------------------- the persona
    def capability_block(self) -> str:
        """JARVIS's capability list, generated from what is registered.

        Static for a given registry, so the system message (and Ollama's cached
        prefix) does not change from turn to turn."""
        on = [t for t in self._tools.values() if t.enabled]
        off = [t for t in self._tools.values() if not t.enabled]
        lines = ["WHAT YOU CAN DO. This list is generated from your tools; nothing outside it is possible."]
        if on:
            lines.append("- Tools you can call: " + "; ".join(f"{t.capability} ({t.name})" for t in on) + ".")
        if self._direct:
            lines.append("- Commands that run without you when he says them plainly: "
                         + "; ".join(f"{c} (\"{ex}\")" for c, ex, _ in self._direct) + ".")
        lines.append("- You also talk: explain, teach and quiz him on VLSI, electronics and German, and use what "
                     "CONTEXT shows from his memory.")
        if off:
            lines.append("- Registered but switched off until he enables them: "
                         + "; ".join(t.capability for t in off) + ".")
        never = [CANNOT[k] for k in CANNOT if not self.can(k) and not self.tools_backing(k)]
        if never:
            lines.append("- You cannot: " + "; ".join(never) + ". No money, payments or anything irreversible, ever.")
        lines.append("- Never say you did, are doing or will do something unless a RECEIPT in this conversation "
                     "shows it. If a receipt says it failed or was simulated, say exactly that. Do not offer "
                     "anything on the cannot list.")
        return "\n".join(lines)


def to_him(capability: str) -> str:
    """Capabilities are written for the persona ("send messages for him"); a receipt or
    a correction is said TO him ("send messages for you")."""
    return re.sub(r"\bhim\b", "you", re.sub(r"\bhis\b", "your", capability))


def t2_enabled(name: str) -> bool:
    """T2 tools he switched on: JARVIS_T2_ENABLED=send_message,... (none by default)."""
    raw = os.environ.get("JARVIS_T2_ENABLED", "")
    return name in {s.strip() for s in raw.split(",") if s.strip()}


_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "object": dict, "array": list}


def validate(tool: Tool, args: dict) -> Optional[str]:
    """Check args against the tool's schema (the subset we use). None when fine.

    The 4B model sometimes sends a number as a string ("40") — coerced, since the
    meaning is unambiguous; anything else that does not fit is refused."""
    for k in tool.required:
        if args.get(k) in (None, ""):
            return f"missing {k}"
    for k, v in list(args.items()):
        spec = tool.params.get(k)
        if spec is None or v is None:
            continue
        typ = spec.get("type")
        if typ in ("integer", "number"):
            if isinstance(v, bool):
                return f"{k} must be a number"
            if isinstance(v, str):
                try:
                    v = float(v.strip())
                except ValueError:
                    return f"{k} must be a number"
            if typ == "integer" and isinstance(v, float):
                if not v.is_integer():
                    return f"{k} must be a whole number"
                v = int(v)
            args[k] = v
        if typ in _TYPES and not isinstance(v, _TYPES[typ]):
            return f"{k} must be a {typ}"
        if "enum" in spec and v not in spec["enum"]:
            return f"{k} must be one of {', '.join(map(str, spec['enum']))}"
        if "minimum" in spec and isinstance(v, (int, float)) and v < spec["minimum"]:
            return f"{k} must be at least {spec['minimum']}"
        if "maximum" in spec and isinstance(v, (int, float)) and v > spec["maximum"]:
            return f"{k} must be at most {spec['maximum']}"
        if typ == "string" and len(v) > spec.get("maxLength", 500):
            return f"{k} is too long"
    return None

"""/api/mission/pyq/model: which model the question engine may ask, and whether it is on this PC (ww_claude_cli.py).

    GET    /api/mission/pyq/model    R-64 {provider, claude_model, available: {local, claude}, sends_out, name}
    PUT    /api/mission/pyq/model    R-64 {provider: "local"|"claude"|"off", claude_model?: "haiku"|"sonnet"|"opus"}

"local" is the model on this PC (loopback), "claude" is Claude through the Claude command-line tool on his own
subscription, with no API key, and "off" is the same switch as R-35's rules_only: no model is asked at all. Choosing
"claude" is refused (400) while the tool is not found; `available` comes from a version call, never from a prompt,
and is kept for 60 s. When the provider is "claude" the reason sentence says that the text of his questions and notes
leaves this PC and counts against his Claude usage. Every answer is the {state, reason, source, ...} envelope of
ww_pyq/api.py (KeyError 404, ValueError 400).
"""
from __future__ import annotations

from fastapi import Body, FastAPI
from starlette.concurrency import run_in_threadpool

from . import ww_claude_cli as cli
from .ww_pyq import api
from .ww_pyq import store as store_mod

SOURCE = "your settings"


def answer(store, refresh: bool = False) -> dict:
    mode = cli.mode_for(store)
    model = cli.claude_model_for(store)
    avail = cli.available(refresh=refresh)
    if mode == "off":
        state, reason = "live", "Rules only: no model is asked, and nothing leaves this PC."
    elif mode == "local":
        state = "live" if avail["local"] else "waiting"
        reason = ("The local model on this PC is asked, and nothing leaves this PC." if avail["local"] else
                  "The local model on this PC is chosen but not running now, so a request answers that no model is reachable.")
    else:
        state = "live" if avail["claude"] else "waiting"
        reason = (f"Claude ({model}) is asked through the Claude tool on this PC: the text of your questions and notes "
                  "leaves this PC and counts against your Claude usage.")
        if not avail["claude"]:
            reason += " The tool is not found now, so nothing is sent until it is."
    return api.ok(state, reason, SOURCE, provider=mode, claude_model=model, available=avail,
                  sends_out=mode == "claude", name=cli.name_for(store))


def register(app: FastAPI, svc, bus) -> None:
    def store():
        return store_mod.default_store()

    @app.get("/api/mission/pyq/model")
    async def model_get():
        return await run_in_threadpool(api.guard, lambda: answer(store()))

    @app.put("/api/mission/pyq/model")
    async def model_put(body: dict = Body(...)):
        def work():
            if not isinstance(body, dict) or "provider" not in body or set(body) - {"provider", "claude_model"}:
                raise ValueError('Send {provider: "local", "claude" or "off", claude_model?: "haiku", "sonnet" or "opus"}.')
            provider, model = body.get("provider"), body.get("claude_model")
            if provider not in cli.MODES:
                raise ValueError("provider is local, claude or off.")
            if model is not None and model not in cli.CLAUDE_MODELS:
                raise ValueError("claude_model is haiku, sonnet or opus.")
            if provider == "claude" and not cli.available(refresh=True)["claude"]:
                raise ValueError("The Claude tool is not found on this PC, so Claude cannot be chosen.")
            cli.set_mode(store(), provider, model)
            return answer(store())
        return await run_in_threadpool(api.guard, work)

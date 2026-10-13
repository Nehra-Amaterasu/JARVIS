"""/api/crew: JARVIS's always-on staff (crew/), wired to the app's real sources.

    GET  /api/crew                  every agent (its view, its health) and the last 40 board events
    GET  /api/crew/context          the block JARVIS reads before he replies, and each agent's line
    GET  /api/crew/events?since=id  board events after an id (a client polls with the last id it has)
    POST /api/crew/{agent_id}/run   one tick now; that agent's entry (404 for an unknown agent)

The crew:
    movement  the hub's latest frame and mode (crew/agents/movement.py)
    ledger    the transcripts JARVIS's process writes; its ranking in DATA/crew/ledger.json
    steward   Ollama, the hub (and its raw-stream recorder), JARVIS's process, errors in the transcripts
    learner   finished chats -> Yaadash's learned memory (crew/agents/learner.py, yaadash/learn_chats.py)

It starts with the app (chained onto the server's lifespan, so server.py is not edited)
and stops before the hub does. A notable board event goes to the bus as source "crew", so
the ticker shows it; routine ones and per-tick states never do. A tick that reads files
runs on the crew's own threads, and "run now" in the threadpool, never on the event loop.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .paths import DATA, ensure_jarvis_importable
from .transcripts import TRANSCRIPTS

ensure_jarvis_importable()
from crew.agents.learner import ChatLearner, default_learn          # noqa: E402  (the JARVIS root on the path)
from crew.agents.ledger import TaskLedger                            # noqa: E402
from crew.agents.movement import MovementWatcher                     # noqa: E402
from crew.agents.steward import RecentErrors, Steward, ollama_answers  # noqa: E402
from crew.board import Blackboard                                     # noqa: E402
from crew.manager import Crew                                         # noqa: E402

CREW_DATA = DATA / "crew"
_NOT_FOR_THE_BUS = {"source", "kind", "text", "ephemeral", "agent", "sim"}   # publish()'s own fields


def bus_sink(bus):
    """A notable board event -> one bus event, with the event's plain-valued tags only."""
    def sink(ev: dict) -> None:
        data = ev.get("data") or {}
        tags = {k: v for k, v in data.items()
                if k not in _NOT_FOR_THE_BUS and (v is None or isinstance(v, (str, int, float, bool)))}
        bus.publish("crew", ev["kind"], ev["text"], agent=ev["agent"], sim=bool(data.get("sim", False)), **tags)
    return sink


def build_crew(svc, bus) -> Crew:
    hub = getattr(svc, "hub", None)
    core = getattr(svc, "core", None)
    store = getattr(core, "transcripts", None)
    transcripts = Path(store.root) if store is not None else TRANSCRIPTS

    def frames() -> tuple[Optional[str], Optional[dict]]:
        # A stopped hub keeps its last engine, whose frame would read as the room now.
        if hub is None or not hub.running:
            return None, None
        return hub.mode, hub.frame()

    def aankhen() -> Optional[dict]:
        if hub is None or not hub.running:
            return None
        csi = (hub.frame() or {}).get("csi") or {}
        sensor = ((hub.status() or {}).get("sensors") or {}).get("Wi-Fi CSI") or {}
        stream = getattr(hub, "stream_info", None)       # the raw-stream recorder (aankhen/stream.py)
        return {"mode": hub.mode, "rate_hz": csi.get("rate_hz"), "rssi": csi.get("rssi"), "csi": sensor.get("state"),
                "stream": stream() if stream is not None else None}

    # ollama_answers is looked up at each probe, so a test can swap it for a fake.
    steward = Steward(ollama=lambda: ollama_answers(), aankhen=aankhen, errors=RecentErrors(transcripts),
                      core=getattr(core, "info", None))
    # The learner reads finished chats into Yaadash (yaadash/learn_chats.py); its pass is
    # swappable on the crew (svc.crew.agent("learner").learn) for tests.
    learner = ChatLearner(default_learn(transcripts))
    return Crew([MovementWatcher(frames), TaskLedger(transcripts, CREW_DATA), steward, learner],
                board=Blackboard(sink=bus_sink(bus)))


def register(app: FastAPI, svc, bus) -> None:
    crew = build_crew(svc, bus)
    svc.crew = crew

    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:           # the server's startup first: the bus is bound
            crew.start()
            try:
                yield state
            finally:
                await run_in_threadpool(crew.stop)   # waits out a tick in progress

    app.router.lifespan_context = lifespan

    @app.get("/api/crew")
    def crew_status():
        return crew.status()

    @app.get("/api/crew/context")
    def crew_context():
        return {"text": crew.context(), "lines": crew.lines(), "live": crew.live()}

    @app.get("/api/crew/events")
    def crew_events(since: int = 0):
        return {"events": crew.board.since(since)}

    @app.post("/api/crew/{agent_id}/run")
    async def crew_run(agent_id: str):
        try:
            crew.agent(agent_id)
        except KeyError:
            raise HTTPException(404, f"no agent {agent_id!r}")
        return await run_in_threadpool(crew.run_now, agent_id)

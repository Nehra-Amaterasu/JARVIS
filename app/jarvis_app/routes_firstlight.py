"""First light and calibration from the Aankhen tab (aankhen/firstlight.py: Guided).

The laptop speaks each step, so the person being measured never looks at a screen;
the tab polls GET /api/aankhen/firstlight for the step, the countdown and the result."""
from __future__ import annotations

from fastapi import Body, HTTPException


def register(app, svc, bus) -> None:
    from aankhen.firstlight import Guided
    guided = Guided(svc.hub)
    svc.hub.guided = guided

    @app.get("/api/aankhen/firstlight")
    def firstlight_status():
        return guided.status()

    @app.post("/api/aankhen/firstlight/start")
    def firstlight_start(kind: str = Body("test", embed=True)):
        try:
            info = guided.start(kind)
        except (RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        bus.publish("aankhen", "firstlight", "Aankhen: " + ("first-light test" if kind == "test" else "calibrating the empty room"))
        return info

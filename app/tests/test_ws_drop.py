"""A WebSocket feed stops sending the moment its client is gone (10-24 log flood).

uvicorn's sans-io protocol does not raise on a send to a lost connection: it writes to
the dead transport and asyncio logs "socket.send() raised exception." each time. The
fake below behaves the same way (send never fails), so only seeing the disconnect can
stop the loop.
"""
import asyncio
import time

from fastapi.testclient import TestClient

from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.wsutil import serve_until_gone

TOKEN = "w" * 32


class DeadSocket:
    """Like a client that vanished: its disconnect is queued, its sends 'succeed'."""

    def __init__(self, gone_after: int):
        self.sent = 0
        self.gone_after = gone_after
        self.gone = asyncio.Event()

    async def receive(self):
        await self.gone.wait()
        return {"type": "websocket.disconnect", "code": 1006}

    async def send_text(self, text):
        self.sent += 1
        if self.sent >= self.gone_after:
            self.gone.set()
        await asyncio.sleep(0)


def test_a_sender_that_never_fails_is_still_stopped_by_the_disconnect():
    ws = DeadSocket(gone_after=3)

    async def send_loop():
        while True:
            await ws.send_text("event")

    async def main():
        await asyncio.wait_for(serve_until_gone(ws, send_loop), timeout=2.0)

    asyncio.run(main())
    assert 3 <= ws.sent <= 5                       # a send or two in flight, then nothing


def test_a_failed_send_ends_the_feed_too():
    class Broken(DeadSocket):
        async def send_text(self, text):
            raise ConnectionResetError("WinError 10054")

    ws = Broken(gone_after=10**9)

    async def send_loop():
        while True:
            await ws.send_text("event")

    asyncio.run(asyncio.wait_for(serve_until_gone(ws, send_loop), timeout=2.0))


def test_the_events_feed_unsubscribes_when_the_window_closes():
    app = create_app(Guard(8783, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=[])
    bus = app.state.svc.bus
    with TestClient(app) as c:
        with c.websocket_connect(f"/ws/events?t={TOKEN}") as ws:
            assert ws.receive_json()["kind"] == "history"
            assert bus.listeners == 1
        deadline = time.time() + 3
        while bus.listeners and time.time() < deadline:
            bus.publish("system", "tick", "after the client left")
            time.sleep(0.02)
        assert bus.listeners == 0                  # dropped, not fed for ever

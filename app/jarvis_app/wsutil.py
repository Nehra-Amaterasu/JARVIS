"""Send to a WebSocket only while its client is there.

10-24: data/app/jarvis.log held 1,239 lines of asyncio's "socket.send() raised
exception." The event feeds (/ws/events, /ws/phone) only ever SEND: they never read,
so they never saw the disconnect. uvicorn's websockets (sans-io) protocol does not raise
on a send after the TCP connection is lost; it writes into the dead transport, which
logs that line on every write, and the handler kept the bus subscription for ever.

serve_until_gone() runs the sender beside a reader that waits for the disconnect; the
first of the two to end (the client left, or a send failed) ends both.
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable


async def serve_until_gone(ws, send_loop: Callable[[], Awaitable[None]]) -> None:
    async def watch() -> None:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                return

    tasks = [asyncio.ensure_future(send_loop()), asyncio.ensure_future(watch())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except BaseException:                  # cancelled, or the send that failed: the client is gone
                pass

"""/api/esp32-link: the ESP32's Wi-Fi link settings (esp32_link.py).

    GET  /api/esp32-link                 key fingerprint (never the key), addresses, link,
                                         the board's own fingerprint, the firewall rule
    POST /api/esp32-link/secrets-line    the LINK_KEY_VALUE line for secrets.h (on request only)
    POST /api/esp32-link/settings        {address?, prefer?: auto|usb|wifi, clear_address?}
    POST /api/esp32-link/connect         {link: usb|wifi}: start Aankhen on the board over that link

Registering hands the hub its Wi-Fi settings (hub.net_config) and the place to remember
where the board answered, makes the key the first time, and hangs the presence rule on
the ESP32's (re)connect as it hangs on the Uno's.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, HTTPException
from starlette.concurrency import run_in_threadpool

from .esp32_link import Esp32Link, enabled


def register(app, svc, bus) -> None:
    def usb_ip() -> Optional[str]:
        ctl = getattr(app.state, "board_ctl", None)
        return ctl.remembered_ip() if ctl is not None else None

    link = Esp32Link(board_ip=usb_ip)
    link.key()                                         # the first start makes the key
    app.state.esp32_link = link
    svc.esp32_link = link
    hub = svc.hub
    if enabled():
        hub.net_config = link.config
        hub.on_net_peer = link.note_peer
    presence = getattr(svc, "presence_on", None)
    if presence is not None and presence.start not in svc.limbs.on_board_connect:
        svc.limbs.on_board_connect.append(presence.start)

    def board_status() -> Optional[dict]:
        return hub.device_status() if hub.can_command else None

    @app.get("/api/esp32-link")
    def link_view():
        return link.view(board_status())

    @app.post("/api/esp32-link/secrets-line")
    def secrets_line():
        # The key leaves the app here only, to the person who asked; never on the bus.
        return {"line": link.secrets_line(), "fingerprint": link.fingerprint(), "file": "aankhen/firmware/secrets.h"}

    @app.post("/api/esp32-link/settings")
    def settings(address: Optional[str] = Body(None, embed=True), prefer: Optional[str] = Body(None, embed=True),
                 clear_address: bool = Body(False, embed=True)):
        try:
            v = link.set(address=address or None, prefer=prefer, clear_address=clear_address)
        except ValueError as e:
            raise HTTPException(400, str(e))
        bus.publish("board", "link", f"ESP32 link: {v['prefer']}"
                    + (f", board at {v['address']}" if v.get("address") else ""), prefer=v["prefer"])
        return link.view(board_status())

    @app.post("/api/esp32-link/connect")
    async def connect(link_kind: str = Body("wifi", embed=True, alias="link")):
        if link_kind not in ("usb", "wifi"):
            raise HTTPException(400, "link is usb or wifi")
        try:
            info = await run_in_threadpool(hub.start, "hardware", "evening", None, None, 1.0, True, link_kind)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))
        except (RuntimeError, ValueError) as e:
            raise HTTPException(409, str(e))
        bus.publish("aankhen", "source", f"Aankhen: ESP32 over {'Wi-Fi' if link_kind == 'wifi' else 'USB'}", info=info)
        return info

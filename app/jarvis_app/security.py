"""Who may talk to the JARVIS server.

The server can read the memory archive (friends' messages), start a process with
the microphone open, and switch things in the room. So:

1. It listens on 127.0.0.1 only — never the network.
2. Every /api and /ws request carries a token generated fresh at each launch. The
   window receives it in the URL fragment (#t=...), which browsers never send to
   any server, so it can't leak through logs or a Referer header.
3. The Host header must be 127.0.0.1:<port> or localhost:<port>. That blocks DNS
   rebinding, where a web page re-points its own domain at 127.0.0.1 to get
   around the browser's same-origin rule.

The UI bundle itself (HTML, JS, fonts) is served without the token: it contains no
data, and the window needs it before it can read the token.
"""
from __future__ import annotations

import hmac
import os
import secrets
from typing import Iterable, Optional

TOKEN_HEADER = "x-jarvis-token"


class Guard:
    def __init__(self, port: int, token: Optional[str] = None, extra_hosts: Iterable[str] = ()):
        self.token = token or os.environ.get("JARVIS_TOKEN") or secrets.token_urlsafe(24)
        self.port = port
        self.hosts = {f"127.0.0.1:{port}", f"localhost:{port}", *extra_hosts}

    def host_ok(self, host: Optional[str]) -> bool:
        return host in self.hosts

    def token_ok(self, presented: Optional[str]) -> bool:
        return bool(presented) and hmac.compare_digest(presented, self.token)

    def http_ok(self, request) -> bool:
        return self.host_ok(request.headers.get("host")) and \
            self.token_ok(request.headers.get(TOKEN_HEADER))

    def ws_ok(self, ws) -> bool:
        # Browsers cannot set headers on a WebSocket handshake, so the token rides
        # in the query string of a same-machine connection.
        return self.host_ok(ws.headers.get("host")) and \
            self.token_ok(ws.query_params.get("t"))

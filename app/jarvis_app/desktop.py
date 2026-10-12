"""The JARVIS window.

    pythonw app/JARVIS.pyw            the app (no console window)
    python -m jarvis_app.desktop --browser     same server, opened in the browser
    python -m jarvis_app.desktop --server-only --port 8777 --token dev   for UI development

Starts the server on 127.0.0.1 with a fresh token, waits until it answers, then
opens a frameless native window (Edge WebView2, already part of Windows 11 — no
Chromium download, ~100 MB less RAM than Electron). Closing the window stops
JARVIS, the Aankhen source and the server, in that order.
"""
from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

from .paths import APP
from .security import Guard
from .server import create_app


def free_port(preferred: int = 8777) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 40)]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port")


class WindowApi:
    """Exposed to the page as window.pywebview.api — the custom title bar's buttons."""

    def __init__(self):
        self._maximized = False

    def _win(self):
        import webview
        return webview.windows[0]

    def minimize(self):
        self._win().minimize()

    def toggle_maximize(self):
        w = self._win()
        if self._maximized:
            w.restore()
        else:
            w.maximize()
        self._maximized = not self._maximized
        return self._maximized

    def close(self):
        self._win().destroy()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="JARVIS desktop app")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--token", help="fixed token (UI development only)")
    ap.add_argument("--browser", action="store_true", help="open in the default browser")
    ap.add_argument("--server-only", action="store_true")
    ap.add_argument("--aankhen", default="auto", help="auto | simulation | hardware | off")
    ap.add_argument("--dev-host", action="append", default=[], help="extra allowed Host (Vite dev server)")
    ap.add_argument("--debug", action="store_true", help="WebView2 developer tools")
    a = ap.parse_args(argv)

    port = free_port(a.port)
    guard = Guard(port, a.token, extra_hosts=a.dev_host)
    app = create_app(guard, autostart_aankhen=a.aankhen)
    # log_config=None: uvicorn's default config builds a colour formatter that calls
    # sys.stdout.isatty(), and under pythonw (the desktop shortcut) sys.stdout is
    # None — that crashed the first double-click launch. Python's own logging,
    # which JARVIS.pyw points at data/app/jarvis.log, is enough.
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning",
                                           ws_ping_interval=20, log_config=None))
    thread = threading.Thread(target=server.run, name="jarvis-server", daemon=True)
    thread.start()
    t0 = time.time()
    while not server.started and time.time() - t0 < 20:
        time.sleep(0.05)
    if not server.started:
        print("server failed to start", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{port}/#t={guard.token}"

    if a.server_only:
        print(f"JARVIS server on http://127.0.0.1:{port}  token={guard.token}")
        try:
            thread.join()
        except KeyboardInterrupt:
            pass
        server.should_exit = True
        return 0
    if a.browser:
        webbrowser.open(url)
        try:
            thread.join()
        except KeyboardInterrupt:
            pass
        server.should_exit = True
        return 0

    import webview
    icon = APP / "assets" / "jarvis.ico"
    webview.create_window(
        "JARVIS", url, js_api=WindowApi(), width=1440, height=900, min_size=(1120, 720),
        frameless=True, easy_drag=False, background_color="#050506", text_select=False)
    webview.start(gui="edgechromium", debug=a.debug,
                  icon=str(icon) if icon.exists() else None)
    # Window closed: shut everything down in order.
    server.should_exit = True
    thread.join(timeout=8)
    return 0


if __name__ == "__main__":
    sys.exit(main())

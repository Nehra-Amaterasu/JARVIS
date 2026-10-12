"""JARVIS desktop application: the local server behind the JARVIS window.

Layout:
    paths.py     where everything lives (repo, core, yaadash, venv, UI build, app data)
    security.py  per-launch token + Host check: the UI talks only to 127.0.0.1
    bus.py       one event stream every tab listens to (the bottom ticker, toasts)
    core.py      JARVIS himself — jarvis.py as a supervised child process
    memory.py    Yaadash: search, beliefs to confirm, people, taste
    limbs.py     what JARVIS can switch: the room's lights and fan
    connect.py   everything that can be plugged in, each with live detection
    system.py    vitals against the 6 GB VRAM ceiling, models on disk
    germoney.py  Mission Germoney: storage, local AI, GitHub, arXiv, focus guard, calendar
    transcripts.py  every conversation kept + review files for Claude
    server.py    the FastAPI app that ties it together
    desktop.py   the native window (pywebview / WebView2)
"""
__version__ = "1.0.0"

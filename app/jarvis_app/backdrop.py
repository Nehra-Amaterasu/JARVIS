"""The window's frosted glass: a Windows system backdrop behind a transparent page.

Off (the default) changes nothing: the window is created exactly as before. On, the
window is created transparent and, once it exists, Windows is asked to paint a system
backdrop (acrylic or mica) on its handle; the page then paints its own tint over that
(docs/design/design-language-v3.md, 2 and 8.1). The page only has to know one thing, the
word glass_state()["on"]: when it is False the page paints the opaque ground, so a
failure here can never leave the owner with an unreadable window.

Everything is a small function with the Windows calls behind a two-method object
(`Dwm`), so the logic is tested without a window. Nothing here imports the GUI: the
only module-level imports are the standard library, and ctypes touches dwmapi on the
first real call.

Three facts measured on 20-21 Nov 2026 (RESEARCH-W1.md has the numbers):
  - a transparent WebView2 window shows the backdrop only while the window is active;
    an inactive one falls back to a flat colour (the owner's Alt-Tab will show it);
  - the host (pywebview) itself sets the backdrop type to mica or none from the system
    theme at start and again on every UserPreferenceChanged, which would undo ours, so
    `Glass` re-asserts after it;
  - a window cannot become transparent after it exists, so turning glass ON live needs
    a restart; turning it OFF live is possible (the page just paints opaque).
"""
from __future__ import annotations

import ctypes
import json
import logging
import os
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

log = logging.getLogger("jarvis.backdrop")

# dwmapi.h
DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_SYSTEMBACKDROP_TYPE = 38
DWMSBT_NONE = 1
DWMSBT_MICA = 2
DWMSBT_ACRYLIC = 3
KINDS = {"mica": DWMSBT_MICA, "acrylic": DWMSBT_ACRYLIC}

# DWMWA_SYSTEMBACKDROP_TYPE exists from Windows 11 22H2 (build 22621); on 21H2 the call
# returns E_INVALIDARG and an older Windows has no such attribute.
MIN_BUILD = 22621

# Which of the two the window asks for. Set from the measurement in RESEARCH-W1.md.
DEFAULT_KIND = "acrylic"

SETTING_GROUP, SETTING_KEY = "window", "glass"


# ----------------------------------------------------------------- pure functions

def window_extras(glass: bool) -> dict:
    """The create_window arguments glass adds. Off adds nothing, so the off path is the
    window of before, argument for argument."""
    return {"transparent": True} if glass else {}


def read_glass_setting(path: Path | str) -> bool:
    """`window.glass` from settings.json, default False. Read straight from the file,
    not through core/user_settings.py, whose store only keeps the groups it lists. Any
    problem (no file, bad JSON, a wrong type) is False, the opaque window."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return raw[SETTING_GROUP][SETTING_KEY] is True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def write_glass_setting(path: Path | str, on: bool) -> None:
    """Set `window.glass`, keeping every other key of the file as it is. Atomic: a
    temp file swapped in, like core/user_settings.py does, so a reader never sees half."""
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raw = {}
    except (OSError, ValueError):
        raw = {}
    group = raw.get(SETTING_GROUP)
    if not isinstance(group, dict):
        group = raw[SETTING_GROUP] = {}
    group[SETTING_KEY] = bool(on)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.glass.tmp")
    tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def windows_build() -> int:
    """The Windows build number, 0 anywhere that is not Windows."""
    return getattr(sys.getwindowsversion(), "build", 0) if sys.platform == "win32" else 0


def native_hwnd(window) -> int:
    """The window's handle as an int (64 bit safe: the host's own helper truncates to
    32). Needs the window to be shown."""
    return int(window.native.Handle.ToInt64())


# ----------------------------------------------------------------- the Windows calls

class Dwm:
    """The two dwmapi calls we need. A fake with the same two methods stands in for it
    in the tests."""

    def __init__(self):
        from ctypes import wintypes
        self._wt = wintypes
        self._dll = ctypes.WinDLL("dwmapi")
        self._dll.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
        self._dll.DwmSetWindowAttribute.restype = ctypes.c_long
        self._dll.DwmExtendFrameIntoClientArea.restype = ctypes.c_long

    def set_attribute(self, hwnd: int, attribute: int, value: int) -> int:
        v = ctypes.c_int(value)
        return int(self._dll.DwmSetWindowAttribute(self._wt.HWND(hwnd), attribute, ctypes.byref(v), 4))

    def extend_frame(self, hwnd: int, margin: int) -> int:
        class _Margins(ctypes.Structure):
            _fields_ = [("l", ctypes.c_int), ("r", ctypes.c_int), ("t", ctypes.c_int), ("b", ctypes.c_int)]
        m = _Margins(margin, margin, margin, margin)
        return int(self._dll.DwmExtendFrameIntoClientArea(self._wt.HWND(hwnd), ctypes.byref(m)))


@dataclass
class BackdropResult:
    active: bool
    kind: Optional[str] = None
    reason: Optional[str] = None
    hresults: dict = field(default_factory=dict)


def apply_backdrop(hwnd: int, kind: str, dwm, build: int, dark: bool = True) -> BackdropResult:
    """Dark mode, the frame extended over the whole client area (margins -1), then the
    backdrop type. Any non-zero HRESULT, an exception, an unknown kind or a Windows
    older than 22H2 gives active=False with the reason, and the call is undone so the
    window is plain again."""
    if kind not in KINDS:
        return BackdropResult(False, None, f"unknown backdrop {kind!r}")
    if build < MIN_BUILD:
        return BackdropResult(False, None, f"Windows build {build} has no system backdrop (needs {MIN_BUILD})")
    hr: dict = {}
    try:
        hr["dark_mode"] = dwm.set_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1 if dark else 0)
        hr["extend_frame"] = dwm.extend_frame(hwnd, -1)
        hr["backdrop"] = dwm.set_attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, KINDS[kind])
    except Exception as e:              # a missing dll, a bad handle: the page stays opaque
        clear_backdrop(hwnd, dwm)
        return BackdropResult(False, None, f"{type(e).__name__}: {e}"[:160], hr)
    bad = [name for name, code in hr.items() if code != 0]
    if bad:
        clear_backdrop(hwnd, dwm)
        return BackdropResult(False, None, "DWM refused " + ", ".join(f"{n} ({hr[n] & 0xFFFFFFFF:#010x})" for n in bad), hr)
    return BackdropResult(True, kind, None, hr)


def clear_backdrop(hwnd: int, dwm) -> None:
    """Back to a plain window: no system backdrop. Never raises."""
    try:
        dwm.set_attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE)
    except Exception:
        pass


# ----------------------------------------------------------------- the controller

class Glass:
    """What the window knows about its own glass. `requested` is the setting when the
    window was created: only a window created transparent can ever show a backdrop."""

    def __init__(self, requested: bool = False, settings_path: Path | str | None = None,
                 kind: str = DEFAULT_KIND, dwm=None, build: Optional[int] = None):
        self.requested = bool(requested)
        self.transparent = self.requested
        self.kind = kind
        self._path = Path(settings_path) if settings_path else None
        self._dwm = dwm
        self._build = build
        self._hwnd: Optional[int] = None
        self._want = self.requested          # the live switch: glass wanted right now
        self._dark = True
        self._result = BackdropResult(False, None, None if not self.requested else "waiting for the window")
        self._stored = self.requested
        self._lock = threading.RLock()

    # -- wiring
    def dwm(self):
        if self._dwm is None:
            self._dwm = Dwm()
        return self._dwm

    def build(self) -> int:
        return windows_build() if self._build is None else self._build

    def attach(self, hwnd: int) -> dict:
        """The window exists: remember its handle and, when glass was asked for, apply it."""
        with self._lock:
            self._hwnd = hwnd
            self._reapply()
            return self.state()

    def attach_window(self, window) -> None:
        """Hook for `window.events.shown`: take the handle, apply, then watch the system
        theme so the host's own theme code cannot undo the backdrop."""
        try:
            self.attach(native_hwnd(window))
        except Exception as e:
            with self._lock:
                self._result = BackdropResult(False, None, f"no window handle: {type(e).__name__}: {e}"[:160])
            log.warning("window glass OFF: %s", self._result.reason)
            return
        self._watch_theme()

    def _watch_theme(self) -> None:
        try:
            from Microsoft.Win32 import SystemEvents       # already loaded by pywebview
            SystemEvents.UserPreferenceChanged += lambda sender, e: self.reassert()
        except Exception as e:
            log.info("window glass: no theme watcher (%s)", e)

    # -- the work
    def _reapply(self) -> None:
        if self._hwnd is None or not self.transparent or not self._want:
            return
        try:
            res = apply_backdrop(self._hwnd, self.kind, self.dwm(), self.build(), self._dark)
        except Exception as e:              # Dwm() itself failing (no dwmapi)
            res = BackdropResult(False, None, f"{type(e).__name__}: {e}"[:160])
        self._result = res
        if res.active:
            log.info("window glass ON: %s backdrop", res.kind)
        else:
            log.warning("window glass OFF, opaque ground: %s", res.reason)

    def reassert(self) -> None:
        """Called after the host reset the backdrop (theme or wallpaper change)."""
        with self._lock:
            if self._result.active:
                self._reapply()

    def set(self, on: bool, dark: bool = True) -> dict:
        """The Frosted switch. Stored for the next start; applied now when the window was
        created transparent. ON on a window that was not cannot show anything until the
        next start, and the state says so."""
        on = bool(on)
        with self._lock:
            self._want, self._dark = on, bool(dark)
            if self._path is not None:
                try:
                    write_glass_setting(self._path, on)
                    self._stored = on
                except OSError as e:
                    log.warning("window glass: could not store the setting: %s", e)
            if on:
                if self.transparent:
                    self._reapply()
                else:
                    self._result = BackdropResult(False, None, "restart needed: the window was made opaque")
            else:
                if self._hwnd is not None and self.transparent:
                    try:
                        clear_backdrop(self._hwnd, self.dwm())
                    except Exception:
                        pass
                self._result = BackdropResult(False, None, None)
            return self.state()

    def state(self) -> dict:
        """What the page reads. `on` is the only word that lets it paint translucent."""
        with self._lock:
            r = self._result
            return {
                "on": bool(r.active),
                "setting": self._stored,
                "kind": r.kind,
                "restart_needed": bool(self._want and not self.transparent),
                "reason": r.reason,
            }

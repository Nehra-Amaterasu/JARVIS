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

Facts measured on 20-21 Nov 2026 on the laptop (Windows build 26300, this host's frameless
transparent WebView2 window), RESEARCH-W1.md has the numbers:
  - on THIS machine neither backdrop showed anything of what is behind the window: with a
    bright busy pattern in a window behind, mica and acrylic both gave one flat tone (pixel
    std 0.0) where the same transparent window with no backdrop showed the pattern sharp
    (std 98); with the wallpaper set to pure black, pure white and the real photo, mica gave
    32 (dark mode) or 243 (light mode) every time, acrylic 84 or 211 every time. That is a
    measurement of this build and this window, not a proof for other Windows builds: the
    specification's stricter host alphas stay the rule;
  - mica gives the darker dark tone and the lighter light tone, so the higher contrast for
    text on both grounds, and no live blur; acrylic never differed between focused and
    unfocused in 36 samples. Hence mica is the default;
  - a transparent window with the backdrop cleared shows the raw desktop: the page must
    paint its opaque ground from its first frame and whenever glass_state()["on"] is False;
  - the host (pywebview) itself sets the backdrop type to mica or none from the system
    theme at start and again on every UserPreferenceChanged, which would undo ours, so
    `Glass` re-asserts after it;
  - a window cannot become transparent after it exists, so turning glass ON live needs
    a restart; turning it OFF live is possible (the page just paints opaque).

The page's contract (the page owner must keep it):
  - call set_glass(on, dark) once at load and again at every look change, with `dark` true
    for the dark ground: the backdrop's own light or dark mode follows the look. The
    stored `window.glass_dark` only lets the first frames of the next start match;
  - paint the opaque ground whenever glass_state()["on"] is False, from the first frame;
    word is "ON" or "OFF" and is the only word the Frosted switch may print;
  - the stored setting survives other settings saves only once core/user_settings.py lists
    a `window` group in DEFAULTS (its store rebuilds the file from DEFAULTS), so until then
    glass_state()["setting"] reads the file, never a remembered value.
"""
from __future__ import annotations

import ctypes
import json
import logging
import os
import sys
import threading
import time
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

# Which of the two the window asks for: mica, from the measurement in RESEARCH-W1.md (flat
# 32 against acrylic's 84 on the dark backdrop, 243 against 211 on the light one, so more
# contrast for text on both grounds). Acrylic stays selectable through Glass(kind=...).
DEFAULT_KIND = "mica"

SETTING_GROUP, SETTING_KEY, SETTING_DARK = "window", "glass", "glass_dark"


class SettingNotStored(Exception):
    """The settings file could not be read safely, so nothing was written to it."""


# ----------------------------------------------------------------- pure functions

def window_extras(glass: bool) -> dict:
    """The create_window arguments glass adds. Off adds nothing, so the off path is the
    window of before, argument for argument."""
    return {"transparent": True} if glass else {}


def _read_window_group(path: Path | str) -> dict:
    try:
        group = json.loads(Path(path).read_text(encoding="utf-8"))[SETTING_GROUP]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return group if isinstance(group, dict) else {}


def read_glass_setting(path: Path | str) -> bool:
    """`window.glass` from settings.json, default False. Read straight from the file,
    not through core/user_settings.py, whose store only keeps the groups it lists. Any
    problem (no file, bad JSON, a wrong type) is False, the opaque window."""
    return _read_window_group(path).get(SETTING_KEY) is True


def read_glass_dark(path: Path | str) -> bool:
    """`window.glass_dark`: whether the last look the page asked for was the dark ground.
    Default True (the dark ground is the default look); only a real false turns it off."""
    return _read_window_group(path).get(SETTING_DARK) is not False


_fallback_lock = threading.Lock()


def _settings_lock():
    """The lock core/user_settings.py takes around its own read-modify-write, so this
    writer and the store never interleave. A private lock when the module is not there."""
    try:
        import user_settings                     # core/user_settings.py, stdlib only
        return user_settings._write_lock
    except (ImportError, AttributeError):
        return _fallback_lock


def write_glass_setting(path: Path | str, on: bool, dark: Optional[bool] = None) -> None:
    """Set `window.glass` (and `window.glass_dark` when given), keeping every other key of
    the file as it is. Atomic: a temp file swapped in, like core/user_settings.py does,
    so a reader never sees half. Only a MISSING file means "start empty": a file that
    cannot be read or parsed right now (a sharing violation, a half-edited file) is left
    untouched and SettingNotStored is raised, because replacing it would wipe the owner's
    brain, voice and microphone settings."""
    path = Path(path)
    with _settings_lock():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = {}
        except (OSError, ValueError) as e:
            raise SettingNotStored(f"{path.name} is unreadable now ({type(e).__name__}); left as it is") from e
        if not isinstance(raw, dict):
            raise SettingNotStored(f"{path.name} is not a JSON object; left as it is")
        group = raw.get(SETTING_GROUP)
        if not isinstance(group, dict):
            group = raw[SETTING_GROUP] = {}
        group[SETTING_KEY] = bool(on)
        if dark is not None:
            group[SETTING_DARK] = bool(dark)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.glass.tmp")
        tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
        for attempt in range(20):               # os.replace fails while a reader holds the target
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.02)


def windows_build() -> int:
    """The Windows build number, 0 anywhere that is not Windows."""
    return getattr(sys.getwindowsversion(), "build", 0) if sys.platform == "win32" else 0


def native_hwnd(window) -> int:
    """The window's handle as an int (64 bit safe: the host's own helper truncates to
    32). Needs the window to be shown."""
    return int(window.native.Handle.ToInt64())


# ----------------------------------------------------------------- the Windows calls

class _Margins(ctypes.Structure):
    _fields_ = [("l", ctypes.c_int), ("r", ctypes.c_int), ("t", ctypes.c_int), ("b", ctypes.c_int)]


class Dwm:
    """The two dwmapi calls we need. A fake with the same two methods stands in for it
    in the tests."""

    def __init__(self):
        from ctypes import wintypes
        self._wt = wintypes
        self._dll = ctypes.WinDLL("dwmapi")
        self._dll.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
        self._dll.DwmSetWindowAttribute.restype = ctypes.c_long
        self._dll.DwmExtendFrameIntoClientArea.argtypes = [wintypes.HWND, ctypes.POINTER(_Margins)]
        self._dll.DwmExtendFrameIntoClientArea.restype = ctypes.c_long

    def set_attribute(self, hwnd: int, attribute: int, value: int) -> int:
        v = ctypes.c_int(value)
        return int(self._dll.DwmSetWindowAttribute(self._wt.HWND(hwnd), attribute, ctypes.byref(v), 4))

    def extend_frame(self, hwnd: int, margin: int) -> int:
        m = _Margins(margin, margin, margin, margin)
        return int(self._dll.DwmExtendFrameIntoClientArea(self._wt.HWND(hwnd), ctypes.byref(m)))


@dataclass
class BackdropResult:
    active: bool
    kind: Optional[str] = None
    reason: Optional[str] = None
    hresults: dict = field(default_factory=dict)


def apply_backdrop(hwnd: int, kind: str, dwm, build: int, dark: bool = True) -> BackdropResult:
    """The backdrop's dark or light mode, the frame extended over the whole client area
    (margins -1), then the backdrop type. A refused or failing frame or backdrop call, an
    unknown kind or a Windows older than 22H2 gives active=False with the reason and
    undoes what was done (frame margins 0, backdrop type none), so the window is plain
    again. The dark-mode call is cosmetic (it picks the backdrop's tone): when only it is
    refused the glass stays on and the refusal is logged."""
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
    if hr["dark_mode"] != 0:
        log.info("window glass: dark-mode attribute refused (%#010x), keeping the backdrop", hr["dark_mode"] & 0xFFFFFFFF)
    bad = [name for name in ("extend_frame", "backdrop") if hr[name] != 0]
    if bad:
        clear_backdrop(hwnd, dwm)
        return BackdropResult(False, None, "DWM refused " + ", ".join(f"{n} ({hr[n] & 0xFFFFFFFF:#010x})" for n in bad), hr)
    return BackdropResult(True, kind, None, hr)


def clear_backdrop(hwnd: int, dwm) -> None:
    """Back to a plain window: frame margins 0, then no system backdrop. Never raises."""
    for call in (lambda: dwm.extend_frame(hwnd, 0),
                 lambda: dwm.set_attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE)):
        try:
            call()
        except Exception:
            pass


# ----------------------------------------------------------------- the controller

class Glass:
    """What the window knows about its own glass. `requested` is the setting when the
    window was created: only a window created transparent can ever show a backdrop."""

    def __init__(self, requested: bool = False, settings_path: Path | str | None = None,
                 kind: str = DEFAULT_KIND, dwm=None, build: Optional[int] = None, dark: bool = True):
        self.requested = bool(requested)
        self.transparent = self.requested
        self.kind = kind
        self._path = Path(settings_path) if settings_path else None
        self._dwm = dwm
        self._build = build
        self._hwnd: Optional[int] = None
        self._want = self.requested          # the live switch: glass wanted right now
        self._dark = bool(dark)
        self._result = BackdropResult(False, None, None if not self.requested else "waiting for the window")
        self._stored = self.requested
        self._watching = False
        self._lock = threading.RLock()

    @classmethod
    def from_file(cls, settings_path: Path | str, **kw) -> "Glass":
        """The glass the settings file asks for (off when it says nothing)."""
        return cls(read_glass_setting(settings_path), settings_path, dark=read_glass_dark(settings_path), **kw)

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
        """Hook for `window.events.shown`, registered only for a window created
        transparent: take the handle, apply, then watch the system theme so the host's own
        theme code cannot undo the backdrop. A second `shown` does not subscribe twice."""
        if not self.requested:
            return                           # an opaque window has nothing to apply or clear
        try:
            self.attach(native_hwnd(window))
        except Exception as e:
            with self._lock:
                self._result = BackdropResult(False, None, f"no window handle: {type(e).__name__}: {e}"[:160])
            log.warning("window glass OFF: %s", self._result.reason)
            return
        self._watch_theme()

    def _watch_theme(self) -> None:
        with self._lock:
            if self._watching:
                return
            self._watching = True
        try:
            from Microsoft.Win32 import SystemEvents       # already loaded by pywebview
            SystemEvents.UserPreferenceChanged += self._on_preference_changed
        except Exception as e:
            log.info("window glass: no theme watcher (%s)", e)

    def _on_preference_changed(self, sender, e) -> None:
        # runs on a .NET event thread: nothing may escape it
        try:
            self.reassert()
        except Exception as err:
            log.warning("window glass: re-asserting after a theme change failed: %s", err)

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

    def set(self, on, dark=None) -> dict:
        """The Frosted switch. Stored for the next start; applied now when the window was
        created transparent. ON on a window that was not cannot show anything until the
        next start, and the state says so. Only real booleans count: the page is an untyped
        boundary, so "false" or 0 changes nothing. `dark` None keeps the current mode."""
        if on is not True and on is not False:
            return self.state()
        with self._lock:
            self._want = on
            if dark is True or dark is False:
                self._dark = dark
            if self._path is not None:
                try:
                    write_glass_setting(self._path, on, self._dark)
                    self._stored = on
                except (OSError, SettingNotStored) as e:
                    log.warning("window glass: the setting was not stored: %s", e)
            if on:
                if self.transparent:
                    self._reapply()
                else:
                    self._result = BackdropResult(False, None, "restart needed: the window was made opaque")
            else:
                if self._hwnd is not None and self.transparent:
                    clear_backdrop(self._hwnd, self.dwm())
                self._result = BackdropResult(False, None, None)
            return self.state()

    def state(self) -> dict:
        """What the page reads. `on` is the only fact that lets it paint translucent and
        `word` is its lamp word. `setting` is what the file holds right now (what the next
        start will do), so it cannot claim a value another settings save has dropped."""
        with self._lock:
            r = self._result
            setting = read_glass_setting(self._path) if self._path is not None else self._stored
            return {
                "on": bool(r.active),
                "word": "ON" if r.active else "OFF",
                "setting": setting,
                "kind": r.kind,
                "restart_needed": bool(self._want and not self.transparent),
                "reason": r.reason,
            }

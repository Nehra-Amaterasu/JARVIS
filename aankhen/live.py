"""Try the trained fingerprint models live: walk around and watch what they think.

    python -m aankhen fingerprint live [--fan on|off] [--minutes 10]

Records the board into data/aankhen/drill/live/<time>.akr (through the running app, or
the board directly when the app is closed) and reads that file as it grows. Every 0.5 s
a fresh 2 s window is cleaned with the saved empty-room reference, then the CNN and the
kNN each name a place. The CNN's probabilities are averaged over the last 3 windows
(1.5 s) so the answer does not flicker on one noisy window.

WHAT TO EXPECT (2026-10-26): trained on one day, three sessions, on a -85 to -95 dBm
link. Places with minutes of data (bed, desk, balcony door) should mostly come out
right; places with seconds of data (bathroom doormat) mostly won't. "unsure" is printed
when the CNN's best place is under 50 %: that is the honest answer, not a failure.
"""
from __future__ import annotations

import json
import os
import struct
import time
from collections import deque
from typing import Iterable, Iterator, Optional

import numpy as np

from .drill import DRILL_DIR
from .fingerprint import MODEL_ROOT, CnnFingerprint, csi_stream, expand_places, windows

LIVE_DIR = os.path.join(DRILL_DIR, "live")
UNSURE_P = 0.5
SMOOTH = 3


def load_current(root: str = MODEL_ROOT) -> tuple[CnnFingerprint, Optional[object], dict, str]:
    """(cnn, knn or None, refs {fan_on/fan_off: [51]}, folder) of the current saved model."""
    import joblib
    with open(os.path.join(root, "current.json"), encoding="utf-8") as f:
        folder = os.path.join(root, json.load(f)["version"])
    m = CnnFingerprint.load(folder)        # with its fitted temperature (1.0 on older models)
    knn_p = os.path.join(folder, "knn.joblib")
    # joblib unpickles: safe only because this folder is written by `fingerprint train` on
    # this machine (data/ never leaves it); never point it at a model from elsewhere
    knn = joblib.load(knn_p) if os.path.exists(knn_p) else None
    ref_p = os.path.join(folder, "ref.npz")
    refs = dict(np.load(ref_p)) if os.path.exists(ref_p) else {}
    return m, knn, refs, folder


def follow(path: str, stop: Optional[callable] = None, idle_s: float = 0.05) -> Iterator[tuple[float, bytes]]:
    """(host time, bytes) records from a recording that is still being written."""
    from .transport import RECORD_MAGIC
    while not os.path.exists(path):
        if stop and stop():
            return
        time.sleep(idle_s)
    # An offset into the buffer, trimmed once per read: slicing the buffer after every
    # record copied the rest of it each time (council 2026-10-26: 24.4 s on a 9 MB file,
    # against 0.015 s for iter_recording).
    with open(path, "rb") as f:
        buf, pos, header = b"", 0, False
        while True:
            data = f.read()
            if data:
                buf = buf[pos:] + data
                pos = 0
            if not header and len(buf) - pos >= 8:
                if buf[pos:pos + 4] != RECORD_MAGIC:
                    raise ValueError(f"{path} is not an Aankhen recording")
                (n,) = struct.unpack_from("<I", buf, pos + 4)
                if len(buf) - pos >= 8 + n:
                    pos, header = pos + 8 + n, True
            while header and len(buf) - pos >= 12:
                t, size = struct.unpack_from("<dI", buf, pos)
                if len(buf) - pos < 12 + size:
                    break                                   # the rest of this record is not written yet
                yield t, buf[pos + 12:pos + 12 + size]
                pos += 12 + size
            if stop and stop():
                return
            if not data:
                time.sleep(idle_s)


EXPERIMENTAL = "fingerprint CNN, day-1 data: not yet tested on a day it never saw"


class FingerprintZones:
    """The engine's live zone evidence from the saved CNN.

    push() takes each conditioned sample; every 0.5 s (a new 2 s window) it returns the
    CNN's probability per zone id for that one window (smooth=1). No averaging here: 3
    windows overlapping by 75 % share most of their samples and add almost no evidence,
    and the belief already tempers each window to weight 0.3 for that overlap. The
    engine feeds it to the zone belief (belief.py), whose dwell times, neighbour graph
    and motion gating are the 'rules' that stop the answer from jumping through walls.
    Until the model passes a held-out day, the belief carries EXPERIMENTAL and the UI
    says so next to the dots."""

    def __init__(self, cnn: CnnFingerprint, refs: dict, folder: str = "", smooth: int = 1):
        from .fingerprint import WindowBuilder
        self.cnn, self.refs, self.folder = cnn, refs, folder
        self.wb = WindowBuilder()
        self.recent: deque = deque(maxlen=smooth)
        self.windows = 0

    @classmethod
    def load(cls) -> Optional["FingerprintZones"]:
        try:
            cnn, _, refs, folder = load_current()
        except (OSError, KeyError, ValueError, RuntimeError):
            return None
        return cls(cnn, refs, folder) if refs else None

    def push(self, t: float, amp, filled: bool, fan_on: bool) -> Optional[dict]:
        w = self.wb.push(t, amp, filled)
        if w is None:
            return None
        ref = self.refs.get("fan_on" if fan_on else "fan_off")
        if ref is None:
            ref = next(iter(self.refs.values()))
        p = self.cnn.proba((w[1] - ref[:, None]).astype(np.float32)[None])[0]
        self.recent.append(p)
        self.windows += 1
        ps = np.mean(self.recent, axis=0)
        # a model trained on merged places ("bed") still names every zone id the belief knows
        return expand_places({z: float(v) for z, v in zip(self.cnn.classes, ps)})


def predict_stream(wins: Iterable[tuple[float, np.ndarray]], cnn: CnnFingerprint, knn, ref: np.ndarray,
                   smooth: int = SMOOTH) -> Iterator[dict]:
    """Windows -> one prediction dict per window (pure apart from the models)."""
    recent: deque = deque(maxlen=smooth)
    for t, w in wins:
        x = (w - ref[:, None]).astype(np.float32)[None]
        p = cnn.proba(x)[0]
        recent.append(p)
        ps = np.mean(recent, axis=0)
        order = np.argsort(ps)[::-1]
        best, second = cnn.classes[order[0]], cnn.classes[order[1]]
        yield {"t": t, "cnn": best if ps[order[0]] >= UNSURE_P else "unsure", "p": float(ps[order[0]]),
               "cnn_top": best, "second": second, "p2": float(ps[order[1]]),
               "knn": str(knn.predict(x)[0]) if knn is not None else None}

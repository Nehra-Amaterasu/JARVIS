"""Raw stream: a rolling week of the real board's Wi-Fi channel, for self-supervised learning.

The learned models (learn.py) only see the minutes I labelled. Self-supervised ones
(worldmodel.py) can learn from every unlabelled hour too, if the hours are kept. The
owner agreed on 2026-10-13 to keep one rolling week. This module keeps it.

WHAT IS KEPT, per 50 ms row (20 Hz):
    amp     the conditioned amplitude (csi.CsiConditioner: 100 Hz, Hampel-cleaned, each
            packet over its own median), the 5 samples of the row averaged (a boxcar,
            whose nulls at 20, 40 Hz stop the fan's flicker folding onto slow movement
            more than plain picking every 5th sample would), float16, 51 subcarriers
    phase   the sanitised phase (eyes.sanitise: each packet's straight line removed),
            the circular mean of every packet in the row, float16, NaN when no packet
    real    how many of the row's 5 samples were measured, not forward-filled
    n_raw   how many packets the phase averages
and once a second (device time): host epoch time, the Wi-Fi channel, the fan relay,
the learned zone with its occupied probability and the learned activity, all as known
at that second, so the hours can be labelled weakly later.

WHY PHASE TOO. 51 x 2 bytes x 20 Hz is 176 MB a day for amplitude; phase doubles it
(352 MB a day, ~2.5 GB for the week; this disk had 33 GB free on 2026-10-13). On the
real board phase separated typing from sitting still where amplitude did not (AUC 0.99
against 0.68 at the desk, docs/research/2026-10-13-csi-phase-vs-amplitude.md), so a
model learning from these hours should have it. AANKHEN_STREAM_PHASE=0 drops it.

FILES. data/aankhen/stream/YYYY-MM-DD/HH.npz, one per hour of host local time. Rows are
buffered for FLUSH_S and written as a complete part file (HH.part-<epoch>.npz, written
to a temporary name and renamed, so a crash loses at most FLUSH_S and never leaves half
a file). When the hour is over its parts are merged into HH.npz; HH.npz lists the parts
it holds, so a merge interrupted after the rename is not counted twice. A day is read
with load_hour()/load_day(), which include parts not yet merged.

ONLY THE REAL BOARD. The hub attaches a recorder for source "hardware" only, and the
recorder refuses any other source: a simulated hour is not an hour of my room.

NEVER IN THE ENGINE'S WAY. The engine calls raw()/sample()/learned() under its lock on
the consumer thread. Each is one deque append (atomic under the GIL, no lock, no
wait). A writer thread does all the work: decimation, phase, files. When the writer
falls QUEUE_MAX items behind, new items are dropped and counted, never waited for.

RETENTION. Hours older than KEEP_DAYS are deleted at start and at every hour's merge.
AANKHEN_STREAM=0 turns the recorder off.
"""
from __future__ import annotations

import io
import os
import re
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .csi import LLTF_KEEP
from .eyes import sanitise
from .learn import ACTIVITIES, CLASSES

STREAM_HZ = 20
SOURCE_HZ = 100                  # the conditioned stream (csi.UniformResampler)
N_SUB = len(LLTF_KEEP)           # 51
KEEP_DAYS = 7
FLUSH_S = 300.0                  # a part file every 5 min: what a crash can lose
# ~20 s of the real board's ~400 items/s (290 packets, 100 samples, 2 estimates).
# An item is a tuple and a 51-value array or a ~200-byte packet: ~10 MB at the limit.
QUEUE_MAX = 8192
PHASE_BATCH = 128                # sanitise() is cheaper per packet in batches (eyes.py)
LAG_BINS = 2                     # a row is emitted once raw packets 2 rows later arrived
VERSION = 1

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"^(\d{2})(?:\.part-\d+)?\.npz$")


def enabled() -> bool:
    """AANKHEN_STREAM=0 (or off/false/no) turns the recorder off."""
    return os.environ.get("AANKHEN_STREAM", "1").strip().lower() not in ("0", "off", "false", "no")


def phase_enabled() -> bool:
    return os.environ.get("AANKHEN_STREAM_PHASE", "1").strip().lower() not in ("0", "off", "false", "no")


def _bin(t: float) -> int:
    # +1e-6: a 100 Hz slot time 12.35 must land in row 247, not 246.99999
    return int(np.floor(t * STREAM_HZ + 1e-6))


# ======================================================================= disk
def _day_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir() and DAY_RE.match(p.name))


def prune(root: Path, now: float, keep_days: int = KEEP_DAYS) -> int:
    """Delete hour files older than keep_days (their hour ENDED before now - keep_days),
    and day folders left empty. Only files this module writes are touched. Returns
    how many files were deleted."""
    cutoff = datetime.fromtimestamp(now) - timedelta(days=keep_days)
    gone = 0
    for d in _day_dirs(root):
        try:
            day = datetime.strptime(d.name, "%Y-%m-%d")
        except ValueError:
            continue
        for f in list(d.iterdir()):
            m = FILE_RE.match(f.name)
            if m is None and f.name.endswith(".tmp"):
                m = re.match(r"^(\d{2})", f.name)     # a write a crash interrupted
            if m is None:
                continue
            if day + timedelta(hours=int(m.group(1)) + 1) < cutoff:
                try:
                    f.unlink()
                    gone += 1
                except OSError:
                    pass
        try:
            if not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass
    return gone


def usage(root: Path, today: Optional[date] = None) -> dict:
    """{"today_mb", "total_mb", "days"} from the files on disk."""
    today = today or date.today()
    total = today_b = 0
    days = 0
    for d in _day_dirs(root):
        size = 0
        for f in d.iterdir():
            if FILE_RE.match(f.name):
                try:
                    size += f.stat().st_size
                except OSError:                   # deleted between the listing and the stat
                    pass
        if size:
            days += 1
        total += size
        if d.name == today.isoformat():
            today_b = size
    return {"today_mb": round(today_b / 1e6, 1), "total_mb": round(total / 1e6, 1), "days": days}


def _save(path: Path, arrays: dict) -> None:
    """Complete file or none: written under a temporary name, then renamed."""
    tmp = path.with_name(path.name + ".tmp")
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    with open(tmp, "wb") as fh:
        fh.write(buf.getbuffer())
    os.replace(tmp, path)


ROW_KEYS = ("t", "amp", "phase", "real", "n_raw")
META_KEYS = ("meta_t", "meta_ts", "channel", "fan", "zone", "occupied_p", "activity")


def _concat(chunks: list[dict]) -> dict:
    out = {}
    for k in ROW_KEYS + META_KEYS:
        parts = [c[k] for c in chunks if k in c]
        if parts:
            out[k] = np.concatenate(parts)
    first = chunks[0]
    for k in ("zones", "activities", "source", "rate_hz", "version"):
        if k in first:
            out[k] = first[k]
    return out


def _read(path: Path) -> dict:
    with np.load(path, allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


def _hour_files(day_dir: Path, hour: int) -> tuple[Optional[Path], list[Path]]:
    merged = day_dir / f"{hour:02d}.npz"
    parts = sorted(day_dir.glob(f"{hour:02d}.part-*.npz"))
    return (merged if merged.exists() else None), parts


def merge_hour(day_dir: Path, hour: int) -> Optional[Path]:
    """Fold the hour's part files into HH.npz (idempotent: parts already listed in
    HH.npz are only deleted)."""
    merged, parts = _hour_files(day_dir, hour)
    if not parts:
        return merged
    chunks, have = [], set()
    if merged is not None:
        base = _read(merged)
        have = set(base.get("parts", np.array([], str)).tolist())
        chunks.append(base)
    new = [p for p in parts if p.name not in have]
    chunks += [_read(p) for p in new]
    if new:
        out = _concat(chunks)
        out["parts"] = np.array(sorted(have | {p.name for p in new}))
        _save(day_dir / f"{hour:02d}.npz", out)
    for p in parts:
        try:
            p.unlink()
        except OSError:
            pass
    return day_dir / f"{hour:02d}.npz"


def load_hour(root: Path, day: str, hour: int) -> Optional[dict]:
    """One hour as arrays (merged file plus parts not merged yet), or None."""
    d = Path(root) / day
    merged, parts = _hour_files(d, hour)
    chunks, have = [], set()
    if merged is not None:
        base = _read(merged)
        have = set(base.get("parts", np.array([], str)).tolist())
        chunks.append(base)
    chunks += [_read(p) for p in parts if p.name not in have]
    return _concat(chunks) if chunks else None


def load_day(root: Path, day: str) -> list[dict]:
    """Every hour of a day that has data, in order."""
    out = []
    for h in range(24):
        x = load_hour(root, day, h)
        if x is not None:
            out.append(x)
    return out


# ======================================================================= recorder
class StreamRecorder:
    """The rolling raw-stream recorder (see the module docstring). One per session on
    the real board: start(), feed it through raw()/sample()/learned(), stop()."""

    def __init__(self, root, source_kind: str = "hardware", phase: Optional[bool] = None,
                 clock: Callable[[], float] = time.time, flush_s: float = FLUSH_S,
                 queue_max: int = QUEUE_MAX, keep_days: int = KEEP_DAYS):
        if source_kind != "hardware":
            raise ValueError(f"only the real board is recorded, not {source_kind!r}")
        self.root = Path(root)
        self.phase = phase_enabled() if phase is None else bool(phase)
        self.clock = clock
        self.flush_s = flush_s
        self.queue_max = queue_max
        self.keep_days = keep_days
        self._q: deque = deque()
        self.dropped = {"raw": 0, "sample": 0, "learned": 0}
        self.rows_written = 0
        self.files_written = 0
        self.last_error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._usage = {"today_mb": 0.0, "total_mb": 0.0, "days": 0}
        self._reset_state()

    # ------------------------------------------------------------ engine side
    # Called under the engine lock on the consumer thread: one append, never a wait.
    def _put(self, kind: str, item: tuple) -> None:
        if len(self._q) >= self.queue_max:
            self.dropped[kind] += 1
            return
        self._q.append(item)

    def raw(self, t: float, raw: bytes, channel: Optional[int], fan: Optional[bool]) -> None:
        self._put("raw", ("r", t, raw, channel, fan, self.clock()))

    def sample(self, t: float, amp: np.ndarray, filled: bool) -> None:
        self._put("sample", ("s", t, amp, filled))

    def learned(self, t: float, zone: Optional[str], occupied_p: Optional[float],
                activity: Optional[str]) -> None:
        self._put("learned", ("l", t, zone, occupied_p, activity))

    # ------------------------------------------------------------ lifecycle
    def start(self) -> "StreamRecorder":
        self.root.mkdir(parents=True, exist_ok=True)
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="aankhen-stream", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 3.0) -> None:
        """Write what is buffered as a part file. The hour's merge waits for the hour
        to end (or the next start), so stopping costs one small write."""
        self._stop.set()
        t = self._thread
        if t is not None and t is not threading.current_thread():
            t.join(timeout)
        self._thread = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def info(self) -> dict:
        return {"on": self.running, "phase": self.phase, "rate_hz": STREAM_HZ,
                "today_mb": self._usage["today_mb"], "total_mb": self._usage["total_mb"],
                "days_kept": self._usage["days"], "keep_days": self.keep_days,
                "drops": sum(self.dropped.values()), "dropped": dict(self.dropped),
                "queue": len(self._q), "rows": self.rows_written + len(self._rows["t"]),
                "files": self.files_written, "error": self.last_error}

    # ------------------------------------------------------------ writer thread
    def _reset_state(self) -> None:
        self._abin: Optional[int] = None          # the amplitude row being averaged
        self._asum = np.zeros(N_SUB)
        self._an = 0
        self._areal = 0
        self._amp_rows: dict[int, tuple[np.ndarray, int]] = {}
        self._raw_pending: list[tuple[int, bytes]] = []
        self._ph: dict[int, list] = {}            # bin -> [sum of e^(i phase), packets]
        self._bin_meta: dict[int, tuple] = {}     # bin -> (channel, fan, host ts) of its last packet
        self._last_raw_bin: Optional[int] = None
        self._last_meta = (None, None, None)      # channel, fan, host ts: the latest known
        self._learned = (None, None, None)        # zone, occupied_p, activity
        self._meta_sec: Optional[int] = None
        self._key: Optional[tuple[str, int]] = None   # (day, hour) the buffered rows belong to
        self._rows = {k: [] for k in ROW_KEYS}
        self._meta = {k: [] for k in META_KEYS}
        self._flushed_at = self.clock()

    def _run(self) -> None:
        q = self._q
        try:                                      # on this thread: the hub's start never waits on it
            self._housekeeping(merge_current=True)
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {e}"[:200]
        while True:
            stopping = self._stop.is_set()
            try:
                n = 0
                while q and n < 4096:
                    self._handle(q.popleft())
                    n += 1
                if not q:
                    self._emit(final=False)
                if self.clock() - self._flushed_at >= self.flush_s:
                    self._flush()
            except Exception as e:                # a full disk must not kill the thread
                self.last_error = f"{type(e).__name__}: {e}"[:200]
            if stopping and not q:
                break
            if not q:
                self._stop.wait(0.1)
        try:
            self._emit(final=True)
            self._flush()
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {e}"[:200]

    def _handle(self, item: tuple) -> None:
        kind = item[0]
        if kind == "s":
            _, t, amp, filled = item
            if amp.size != N_SUB:
                return
            b = _bin(t)
            if self._abin is not None and b != self._abin:
                if b < self._abin - STREAM_HZ:            # the device clock went back (a reset)
                    self._close_amp_row()
                    self._emit(final=True)
                else:
                    self._close_amp_row()
            if self._abin is None:
                self._abin = b
            self._asum += amp
            self._an += 1
            self._areal += 0 if filled else 1
        elif kind == "r":
            _, t, raw, channel, fan, ts = item
            b = _bin(t)
            if self._last_raw_bin is not None and b < self._last_raw_bin - STREAM_HZ:
                self._close_amp_row()                     # the device clock went back (a reset):
                self._emit(final=True)                    # what came before is complete
                self._last_raw_bin = None
            self._last_raw_bin = b if self._last_raw_bin is None else max(b, self._last_raw_bin)
            self._bin_meta[b] = (channel, fan, ts)
            if self.phase:
                self._raw_pending.append((b, raw))
                if len(self._raw_pending) >= PHASE_BATCH:
                    self._flush_phase()
        elif kind == "l":
            _, t, zone, occ, act = item
            self._learned = (zone, occ, act)

    def _close_amp_row(self) -> None:
        if self._abin is not None and self._an:
            self._amp_rows[self._abin] = (self._asum / self._an, self._areal)
        self._abin = None
        self._asum = np.zeros(N_SUB)
        self._an = self._areal = 0

    def _flush_phase(self) -> None:
        if not self._raw_pending:
            return
        bins = [b for b, _ in self._raw_pending]
        R = sanitise([r for _, r in self._raw_pending])
        self._raw_pending = []
        Z = np.exp(1j * R)                                  # NaN rows stay NaN
        for b, z in zip(bins, Z):
            if np.isnan(z[0]):
                continue
            acc = self._ph.get(b)
            if acc is None:
                self._ph[b] = [z.copy(), 1]
            else:
                acc[0] += z
                acc[1] += 1

    def _emit(self, final: bool) -> None:
        """Move finished rows into the buffer: rows whose packets have all arrived
        (raw packets LAG_BINS rows later were seen), or all of them when final."""
        if final:
            self._close_amp_row()
        self._flush_phase()
        last = self._last_raw_bin
        # (a row far AHEAD of the newest packet is from before a device-clock reset)
        ready = sorted(b for b in self._amp_rows
                       if final or last is None or b <= last - LAG_BINS or b > last + STREAM_HZ)
        for b in ready:
            self._row(b)
        # Packets of rows that will never get an amplitude (the conditioner rejected
        # them, or a resampler gap): forget them once the amplitude has moved past, or
        # once they are 2 s behind the newest packet (the amplitude lags by ~40 ms).
        lo = None if last is None else (last if final else last - 2 * STREAM_HZ)
        if ready:
            lo = ready[-1] if lo is None else max(lo, ready[-1])
        if lo is not None:
            for b in sorted(b for b in self._bin_meta if b <= lo):
                self._last_meta = self._bin_meta.pop(b)
            for b in [b for b in self._ph if b <= lo]:
                del self._ph[b]

    def _row(self, b: int) -> None:
        amp, real = self._amp_rows.pop(b)
        acc = self._ph.pop(b, None)
        if acc is not None:
            ph, n_raw = np.angle(acc[0]), acc[1]
        else:
            ph, n_raw = np.full(N_SUB, np.nan), 0
        meta = self._bin_meta.pop(b, None)
        if meta is not None:
            self._last_meta = meta
        channel, fan, ts = self._last_meta
        ts = ts if ts is not None else self.clock()
        when = datetime.fromtimestamp(ts)
        key = (when.strftime("%Y-%m-%d"), when.hour)
        if self._key is not None and key != self._key:
            self._flush()                                 # the hour is over: its last part,
            self._housekeeping(merge_current=False)       # then its merge and the pruning
        self._key = key
        r = self._rows
        r["t"].append(b / STREAM_HZ)
        r["amp"].append(amp)
        r["phase"].append(ph)
        r["real"].append(real)
        r["n_raw"].append(min(n_raw, 255))
        sec = b // STREAM_HZ
        if sec != self._meta_sec:
            self._meta_sec = sec
            zone, occ, act = self._learned
            m = self._meta
            m["meta_t"].append(b / STREAM_HZ)
            m["meta_ts"].append(ts)
            m["channel"].append(-1 if channel is None else int(channel))
            m["fan"].append(-1 if fan is None else int(bool(fan)))
            m["zone"].append(CLASSES.index(zone) if zone in CLASSES else -1)
            m["occupied_p"].append(np.nan if occ is None else float(occ))
            m["activity"].append(ACTIVITIES.index(act) if act in ACTIVITIES else -1)

    def _flush(self) -> None:
        """The buffered rows as one part file of their hour."""
        self._flushed_at = self.clock()
        r, m = self._rows, self._meta
        if not r["t"] or self._key is None:
            return
        day, hour = self._key
        arrays = {
            "t": np.asarray(r["t"], np.float64),
            "amp": np.asarray(r["amp"], np.float16),
            "real": np.asarray(r["real"], np.uint8),
            "n_raw": np.asarray(r["n_raw"], np.uint8),
            "meta_t": np.asarray(m["meta_t"], np.float64),
            "meta_ts": np.asarray(m["meta_ts"], np.float64),
            "channel": np.asarray(m["channel"], np.int16),
            "fan": np.asarray(m["fan"], np.int8),
            "zone": np.asarray(m["zone"], np.int8),
            "occupied_p": np.asarray(m["occupied_p"], np.float16),
            "activity": np.asarray(m["activity"], np.int8),
            "zones": np.array(CLASSES), "activities": np.array(ACTIVITIES),
            "source": np.array("hardware"), "rate_hz": np.array(STREAM_HZ), "version": np.array(VERSION),
        }
        if self.phase:
            arrays["phase"] = np.asarray(r["phase"], np.float16)
        d = self.root / day
        d.mkdir(parents=True, exist_ok=True)
        stamp = int(self.clock() * 1000)
        path = d / f"{hour:02d}.part-{stamp}.npz"
        while path.exists():
            stamp += 1
            path = d / f"{hour:02d}.part-{stamp}.npz"
        _save(path, arrays)
        self.rows_written += len(r["t"])
        self.files_written += 1
        self._rows = {k: [] for k in ROW_KEYS}
        self._meta = {k: [] for k in META_KEYS}
        self._usage = usage(self.root, datetime.fromtimestamp(self.clock()).date())

    def _housekeeping(self, merge_current: bool) -> None:
        """Merge the parts of every hour that is over (and, at start, of the current
        hour too: they are a previous session's), then delete what is past keeping."""
        now = self.clock()
        current = datetime.fromtimestamp(now)
        for d in _day_dirs(self.root):
            hours = {int(m.group(1)) for f in d.iterdir() if (m := FILE_RE.match(f.name)) and ".part-" in f.name}
            for h in sorted(hours):
                is_current = d.name == current.strftime("%Y-%m-%d") and h == current.hour
                if merge_current or not is_current:
                    merge_hour(d, h)
        prune(self.root, now, self.keep_days)
        self._usage = usage(self.root, current.date())

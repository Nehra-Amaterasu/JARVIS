"""Raw stream: a rolling week of the real board's Wi-Fi channel, for self-supervised learning.

The learned models (learn.py) only see the minutes I labelled. Self-supervised ones
(worldmodel.py) can learn from every unlabelled hour too, if the hours are kept. The
owner agreed on 2026-10-13 to keep one rolling week. This module keeps it.

WHAT IS KEPT, per 50 ms row (20 Hz), version 2:
    t       board time of the row (its 50 ms bin)
    ts      host epoch time of the row's last packet
    amp     the conditioned amplitude (csi.CsiConditioner: 100 Hz, Hampel-cleaned, each
            packet over its own median or the slow gain reference), the 5 samples of the
            row averaged (a boxcar, whose nulls at 20, 40 Hz stop the fan's flicker folding
            onto slow movement more than plain picking every 5th sample would), float16, 51
            subcarriers
    phase   the sanitised phase (eyes.sanitise: each packet's straight line removed),
            the circular mean of every packet in the row, float16, NaN when no packet
    real    how many of the row's 5 samples were measured, not forward-filled
    n_raw   how many packets the phase averages
    level_db      the samples' overall level (csi.Sample.level_db: the gain-compensated
                  median in dB, or the RSSI), mean over the row, float32, NaN if unknown
    rssi          the last packet's RSSI in the row, int8 (-128 = unknown)
    gain_comp_db  the last packet's gain compensation, float32, NaN without CSI_GAIN
    channel, fan, zone, occupied_p, activity   as known at that row, so the hours can be
                  labelled weakly later (load_hour also gives them once a second, as v1 did)

WHY THE LEVEL (council hearing 2, 2026-10-27, code item 1). v1 kept only the amplitude
each packet was normalised by, so the absolute level, RSSI and gain were thrown away:
every hour recorded could never test a level channel against a same-state empty room,
the lead the hearing ruled in. That loss is irreversible, hour by hour, so v2 keeps them.
The ENGINE must pass them: tap.raw(..., rssi=p.rssi, gain_comp_db=p.gain_comp_db) and
tap.sample(s.t, s.amp, s.filled, s.level_db); until then they are stored as unknown.

WHY PHASE TOO. 51 x 2 bytes x 20 Hz is 176 MB a day for amplitude; phase doubles it
(352 MB a day, ~2.5 GB for the week; this disk had 33 GB free on 2026-10-13). On the
real board phase separated typing from sitting still where amplitude did not (AUC 0.99
against 0.68 at the desk, docs/research/2026-10-13-csi-phase-vs-amplitude.md), so a
model learning from these hours should have it. AANKHEN_STREAM_PHASE=0 drops it.

FILES (v2). data/aankhen/stream/YYYY-MM-DD/HH.npy, one structured numpy array per hour of
host local time: memory-mappable, so a random 2 s window costs 0.004 ms against 192 ms
for v1's compressed npz, which had to inflate the whole hour (council hearing 2, seat 5,
MEASURED). Rows are buffered for FLUSH_S and written as an immutable part file
(HH.part-<epoch>.npy, written to a temporary name and renamed, so a crash loses at most
FLUSH_S and never leaves half a file). When the hour is over its parts are merged into
HH.npy, and its SHA-256 and row count go into the day's MANIFEST.json: only an hour in
the manifest is claimed as finished. A merge interrupted between the rename and the
deletion of its parts cannot count rows twice: rows are unique by (t, ts) on reading.
v1 hours (HH.npz, HH.part-*.npz) are still read, and never rewritten.

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

import hashlib
import io
import json
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
VERSION = 2
MANIFEST = "MANIFEST.json"
RSSI_UNKNOWN = -128

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"^(\d{2})(?:\.part-\d+)?\.(npz|npy)$")


def enabled() -> bool:
    """AANKHEN_STREAM=0 (or off/false/no) turns the recorder off."""
    return os.environ.get("AANKHEN_STREAM", "1").strip().lower() not in ("0", "off", "false", "no")


def phase_enabled() -> bool:
    return os.environ.get("AANKHEN_STREAM_PHASE", "1").strip().lower() not in ("0", "off", "false", "no")


def _bin(t: float) -> int:
    # +1e-6: a 100 Hz slot time 12.35 must land in row 247, not 246.99999
    return int(np.floor(t * STREAM_HZ + 1e-6))


def row_dtype(phase: bool) -> np.dtype:
    f = [("t", "f8"), ("ts", "f8"), ("amp", "f2", (N_SUB,))]
    if phase:
        f.append(("phase", "f2", (N_SUB,)))
    f += [("real", "u1"), ("n_raw", "u1"), ("level_db", "f4"), ("rssi", "i1"), ("gain_comp_db", "f4"),
          ("channel", "i2"), ("fan", "i1"), ("zone", "i1"), ("occupied_p", "f2"), ("activity", "i1")]
    return np.dtype(f)


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
        man = d / MANIFEST
        if man.exists():
            entries = read_manifest(d)
            kept = {k: v for k, v in entries.items() if (d / k).exists()}
            try:
                if not kept:
                    man.unlink()                      # the manifest of a day whose hours are all gone
                elif kept != entries:
                    _write_manifest(d, kept)          # never claim an hour that was pruned
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
    """v1: complete npz or none, written under a temporary name, then renamed (kept for
    reading old hours and for tests that fake them)."""
    tmp = path.with_name(path.name + ".tmp")
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    with open(tmp, "wb") as fh:
        fh.write(buf.getbuffer())
    os.replace(tmp, path)


def _save_npy(path: Path, rows: np.ndarray) -> str:
    """Complete .npy or none (temporary name, fsync, rename). Returns the file's SHA-256."""
    tmp = path.with_name(path.name + ".tmp")
    buf = io.BytesIO()
    np.save(buf, rows, allow_pickle=False)
    data = buf.getbuffer()
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_manifest(day_dir: Path) -> dict:
    try:
        with open(Path(day_dir) / MANIFEST, encoding="utf-8") as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_manifest(day_dir: Path, man: dict) -> None:
    p = Path(day_dir) / MANIFEST
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(man, f, indent=1, sort_keys=True)
    os.replace(tmp, p)


ROW_KEYS = ("t", "amp", "phase", "real", "n_raw")
V2_ROW_KEYS = ("ts", "level_db", "rssi", "gain_comp_db")
META_KEYS = ("meta_t", "meta_ts", "channel", "fan", "zone", "occupied_p", "activity")


def _concat(chunks: list[dict]) -> dict:
    out = {}
    for k in ROW_KEYS + V2_ROW_KEYS + META_KEYS:
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


def _union(rows: list[np.ndarray]) -> np.ndarray:
    """Rows of several part files as one array; a part written with phase off gets NaN phase."""
    if len({r.dtype for r in rows}) == 1:
        return np.concatenate(rows)
    dt = row_dtype(any("phase" in r.dtype.names for r in rows))
    out = []
    for r in rows:
        x = np.zeros(len(r), dt)
        for n in dt.names:
            if n in r.dtype.names:
                x[n] = r[n]
            elif n == "phase":
                x[n] = np.nan
        out.append(x)
    return np.concatenate(out)


def _dedup(rows: np.ndarray) -> np.ndarray:
    """Rows unique by (t, ts), in time order: a merge that died after its rename, before
    its parts were deleted, must not count those rows twice."""
    if not len(rows):
        return rows
    key = np.stack([rows["t"], rows["ts"]], axis=1)
    _, first = np.unique(key, axis=0, return_index=True)
    first.sort()
    out = rows[first]
    return out[np.argsort(out["t"], kind="stable")]


def _rows_to_dict(rows: np.ndarray, phase_stored: bool) -> dict:
    """v2 rows -> the arrays load_hour has always returned (+ the v2 ones)."""
    out = {k: rows[k] for k in ("t", "ts", "amp", "real", "n_raw", "level_db", "rssi", "gain_comp_db")}
    if phase_stored and "phase" in rows.dtype.names:
        out["phase"] = rows["phase"]
    sec = np.floor(rows["t"] + 1e-6).astype(np.int64)
    first = np.flatnonzero(np.r_[True, sec[1:] != sec[:-1]]) if len(sec) else np.zeros(0, int)
    out["meta_t"] = rows["t"][first]
    out["meta_ts"] = rows["ts"][first]
    for k in ("channel", "fan", "zone", "occupied_p", "activity"):
        out[k] = rows[k][first]
    out.update({"zones": np.array(CLASSES), "activities": np.array(ACTIVITIES), "source": np.array("hardware"),
                "rate_hz": np.array(STREAM_HZ), "version": np.array(VERSION)})
    return out


def _hour_files(day_dir: Path, hour: int) -> tuple[Optional[Path], list[Path]]:
    """(merged v2 file or None, v2 parts)."""
    merged = day_dir / f"{hour:02d}.npy"
    parts = sorted(day_dir.glob(f"{hour:02d}.part-*.npy"))
    return (merged if merged.exists() else None), parts


def _v1_hour(day_dir: Path, hour: int) -> list[dict]:
    """A v1 hour (npz: merged + parts not yet merged), read only."""
    merged = day_dir / f"{hour:02d}.npz"
    parts = sorted(day_dir.glob(f"{hour:02d}.part-*.npz"))
    chunks, have = [], set()
    if merged.exists():
        base = _read(merged)
        have = set(base.get("parts", np.array([], str)).tolist())
        chunks.append(base)
    chunks += [_read(p) for p in parts if p.name not in have]
    return chunks


def hour_rows(root: Path, day: str, hour: int, mmap: bool = True) -> Optional[np.ndarray]:
    """One v2 hour as its structured rows (merged file memory-mapped, plus parts not merged
    yet), or None. A random window is a slice: no inflating the hour."""
    d = Path(root) / day
    merged, parts = _hour_files(d, hour)
    rows = []
    if merged is not None:
        rows.append(np.load(merged, mmap_mode="r" if mmap and not parts else None, allow_pickle=False))
    rows += [np.load(p, allow_pickle=False) for p in parts]
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    return _dedup(_union(rows))


def merge_hour(day_dir: Path, hour: int) -> Optional[Path]:
    """Fold the hour's v2 part files into HH.npy and record its SHA-256 in the day's
    manifest (idempotent: rows already in HH.npy are not added twice; a merged hour
    missing from the manifest is entered). v1 npz hours are left as they are."""
    merged, parts = _hour_files(day_dir, hour)
    name = f"{hour:02d}.npy"
    man = read_manifest(day_dir)
    if not parts:
        if merged is not None and name not in man:
            man[name] = {"sha256": sha256_file(merged), "rows": int(len(np.load(merged, mmap_mode="r"))),
                         "bytes": merged.stat().st_size, "version": VERSION}
            _write_manifest(day_dir, man)
        return merged
    rows = []
    if merged is not None:
        rows.append(np.load(merged, allow_pickle=False))
    rows += [np.load(p, allow_pickle=False) for p in parts]
    allr = _dedup(_union(rows))
    sha = _save_npy(day_dir / name, allr)
    man[name] = {"sha256": sha, "rows": int(len(allr)), "bytes": (day_dir / name).stat().st_size,
                 "version": VERSION, "phase": "phase" in allr.dtype.names}
    _write_manifest(day_dir, man)
    for p in parts:
        try:
            p.unlink()
        except OSError:
            pass
    return day_dir / name


def verify_day(root: Path, day: str) -> dict:
    """{hour file: True/False}: does each claimed hour still hash to its manifest entry."""
    d = Path(root) / day
    return {name: (d / name).exists() and sha256_file(d / name) == e.get("sha256")
            for name, e in read_manifest(d).items()}


def load_hour(root: Path, day: str, hour: int) -> Optional[dict]:
    """One hour as arrays (merged file plus parts not merged yet), or None. v2 and v1
    hours alike; v1 has no ts/level_db/rssi/gain_comp_db."""
    d = Path(root) / day
    rows = hour_rows(root, day, hour, mmap=False)
    v1 = _v1_hour(d, hour)
    if rows is None and not v1:
        return None
    if rows is None:
        return _concat(v1)
    out = _rows_to_dict(np.asarray(rows), "phase" in rows.dtype.names)
    if v1:                                            # an hour that straddled the upgrade
        old = _concat(v1)
        n_old, n_new = len(old["t"]), len(out["t"])
        both = _concat([old, {k: v for k, v in out.items() if k not in V2_ROW_KEYS}])
        for k in V2_ROW_KEYS:
            fill = {"rssi": RSSI_UNKNOWN}.get(k, np.nan)
            both[k] = np.concatenate([np.full(n_old, fill, out[k].dtype), out[k]])
        both["version"] = np.array(VERSION)
        assert len(both["t"]) == n_old + n_new
        return both
    return out


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
        self._dtype = row_dtype(self.phase)
        self._reset_state()

    # ------------------------------------------------------------ engine side
    # Called under the engine lock on the consumer thread: one append, never a wait.
    def _put(self, kind: str, item: tuple) -> None:
        if len(self._q) >= self.queue_max:
            self.dropped[kind] += 1
            return
        self._q.append(item)

    def raw(self, t: float, raw: bytes, channel: Optional[int], fan: Optional[bool],
            rssi: Optional[int] = None, gain_comp_db: Optional[float] = None) -> None:
        self._put("raw", ("r", t, raw, channel, fan, self.clock(), rssi, gain_comp_db))

    def sample(self, t: float, amp: np.ndarray, filled: bool, level_db: Optional[float] = None) -> None:
        self._put("sample", ("s", t, amp, filled, level_db))

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
        return {"on": self.running, "phase": self.phase, "rate_hz": STREAM_HZ, "version": VERSION,
                "today_mb": self._usage["today_mb"], "total_mb": self._usage["total_mb"],
                "days_kept": self._usage["days"], "keep_days": self.keep_days,
                "drops": sum(self.dropped.values()), "dropped": dict(self.dropped),
                "queue": len(self._q), "rows": self.rows_written + len(self._rows),
                "files": self.files_written, "error": self.last_error}

    # ------------------------------------------------------------ writer thread
    def _reset_state(self) -> None:
        self._abin: Optional[int] = None          # the amplitude row being averaged
        self._asum = np.zeros(N_SUB)
        self._an = 0
        self._areal = 0
        self._lsum = 0.0                          # the row's level, over samples that had one
        self._ln = 0
        self._amp_rows: dict[int, tuple[np.ndarray, int, float]] = {}
        self._raw_pending: list[tuple[int, bytes]] = []
        self._ph: dict[int, list] = {}            # bin -> [sum of e^(i phase), packets]
        self._bin_meta: dict[int, tuple] = {}     # bin -> (channel, fan, host ts, rssi, gain) of its last packet
        self._last_raw_bin: Optional[int] = None
        self._last_meta = (None, None, None, None, None)
        self._learned = (None, None, None)        # zone, occupied_p, activity
        self._key: Optional[tuple[str, int]] = None   # (day, hour) the buffered rows belong to
        self._rows: list[tuple] = []
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
            _, t, amp, filled, level = item if len(item) == 5 else (*item, None)
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
            if level is not None and np.isfinite(level):
                self._lsum += float(level)
                self._ln += 1
        elif kind == "r":
            _, t, raw, channel, fan, ts = item[:6]
            rssi, gcomp = (item[6], item[7]) if len(item) >= 8 else (None, None)
            b = _bin(t)
            if self._last_raw_bin is not None and b < self._last_raw_bin - STREAM_HZ:
                self._close_amp_row()                     # the device clock went back (a reset):
                self._emit(final=True)                    # what came before is complete
                self._last_raw_bin = None
            self._last_raw_bin = b if self._last_raw_bin is None else max(b, self._last_raw_bin)
            self._bin_meta[b] = (channel, fan, ts, rssi, gcomp)
            if self.phase:
                self._raw_pending.append((b, raw))
                if len(self._raw_pending) >= PHASE_BATCH:
                    self._flush_phase()
        elif kind == "l":
            _, t, zone, occ, act = item
            self._learned = (zone, occ, act)

    def _close_amp_row(self) -> None:
        if self._abin is not None and self._an:
            self._amp_rows[self._abin] = (self._asum / self._an, self._areal,
                                          self._lsum / self._ln if self._ln else float("nan"))
        self._abin = None
        self._asum = np.zeros(N_SUB)
        self._an = self._areal = 0
        self._lsum, self._ln = 0.0, 0

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
        amp, real, level = self._amp_rows.pop(b)
        acc = self._ph.pop(b, None)
        if acc is not None:
            ph, n_raw = np.angle(acc[0]), acc[1]
        else:
            ph, n_raw = np.full(N_SUB, np.nan), 0
        meta = self._bin_meta.pop(b, None)
        if meta is not None:
            self._last_meta = meta
        channel, fan, ts, rssi, gcomp = self._last_meta
        ts = ts if ts is not None else self.clock()
        when = datetime.fromtimestamp(ts)
        key = (when.strftime("%Y-%m-%d"), when.hour)
        if self._key is not None and key != self._key:
            self._flush()                                 # the hour is over: its last part,
            self._housekeeping(merge_current=False)       # then its merge and the pruning
        self._key = key
        zone, occ, act = self._learned
        self._rows.append((
            b / STREAM_HZ, ts, amp, ph, real, min(n_raw, 255), level,
            RSSI_UNKNOWN if rssi is None else int(max(-127, min(127, rssi))),
            np.nan if gcomp is None else float(gcomp),
            -1 if channel is None else int(channel), -1 if fan is None else int(bool(fan)),
            CLASSES.index(zone) if zone in CLASSES else -1, np.nan if occ is None else float(occ),
            ACTIVITIES.index(act) if act in ACTIVITIES else -1))

    def _flush(self) -> None:
        """The buffered rows as one immutable part file of their hour."""
        self._flushed_at = self.clock()
        if not self._rows or self._key is None:
            return
        day, hour = self._key
        rows = np.zeros(len(self._rows), self._dtype)
        cols = list(zip(*self._rows))
        names = ("t", "ts", "amp", "phase", "real", "n_raw", "level_db", "rssi", "gain_comp_db",
                 "channel", "fan", "zone", "occupied_p", "activity")
        for name, col in zip(names, cols):
            if name == "phase" and not self.phase:
                continue
            rows[name] = np.asarray(col)
        d = self.root / day
        d.mkdir(parents=True, exist_ok=True)
        stamp = int(self.clock() * 1000)
        path = d / f"{hour:02d}.part-{stamp}.npy"
        while path.exists():
            stamp += 1
            path = d / f"{hour:02d}.part-{stamp}.npy"
        _save_npy(path, rows)
        self.rows_written += len(rows)
        self.files_written += 1
        self._rows = []
        self._usage = usage(self.root, datetime.fromtimestamp(self.clock()).date())

    def _housekeeping(self, merge_current: bool) -> None:
        """Merge the parts of every hour that is over (and, at start, of the current
        hour too: they are a previous session's), enter merged hours missing from the
        manifest, then delete what is past keeping."""
        now = self.clock()
        current = datetime.fromtimestamp(now)
        for d in _day_dirs(self.root):
            man = read_manifest(d)
            hours = set()
            for f in d.iterdir():
                m = FILE_RE.match(f.name)
                if m and m.group(2) == "npy" and (".part-" in f.name or f.name not in man):
                    hours.add(int(m.group(1)))
            for h in sorted(hours):
                is_current = d.name == current.strftime("%Y-%m-%d") and h == current.hour
                if merge_current or not is_current:
                    merge_hour(d, h)
        prune(self.root, now, self.keep_days)
        self._usage = usage(self.root, current.date())

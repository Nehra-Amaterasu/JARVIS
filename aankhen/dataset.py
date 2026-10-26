"""Every label he has ever given, in one table, and a balanced training set drawn from it.

    python -m aankhen fingerprint catalog          # seconds per label per day, every source
    python -m aankhen fingerprint build            # the balanced window set, and what it dropped
    python -m aankhen fingerprint train            # build -> held-out report -> saved model

WHY (Aman, 2026-10-27)
  Live, he walked to the bookshelf three times: once it said bookshelf, twice "bed",
  because the model had far more bed than anything else. The first narrated session
  (05:23) is two hours, and all but about 15 minutes of it is him asleep on the bed: one
  110-minute stay. Trained on every window, the cheapest way to be right is "bed". So:
  only the LABELLED parts of every recording are used, and each place (and each transit,
  "between the bed and the desk") brings the same few seconds per day, spread over all of
  its stays, so one long stay can never dominate.

THE SOURCES (catalog)
  - drill sessions:   data/aankhen/drill/<day>/<session>/labels.jsonl (the drill's blocks)
  - narrated days:    data/aankhen/drill/narrate/<day>/<session>/labels.jsonl (words -> labels,
                      corrections.json already applied by narrate)
  - Teach mode:       data/aankhen/recordings/teach-*.akr + .labels.json (the app's taps;
                      times relative to the recording's first chunk), learn-my-room and the
                      first-light runs (host times)
  - spans:            data/aankhen/labels/spans.jsonl, append-only: live corrections ("no, I'm
                      at the desk") and tap-to-label mini drills from the app (add_span). A
                      span here overrides any older label of the same recording where they
                      overlap; a later span overrides an earlier one.
  Every label text is mapped onto a zone id (zones.ZONE_IDS) with narrate's phrase parser.
  "between X and Y" becomes a transit class of its own. A place no zone list knows yet
  ("bookshelf") keeps its own name as a class: every label he ever used is usable.

THE BALANCED SET (build)
  Windows (2 s, a new one every 0.5 s) whose whole 2 s lies inside a span trimmed by
  edge_trim_s at each end. Per class and day: at most per_place_s seconds of window ends,
  shared out over the class's stays (water-filling: short stays give all they have, the
  rest is split evenly), evenly spaced inside each stay with a seeded phase. Classes with
  less than min_place_s in total are dropped with a note. Every window keeps its stay id,
  so the held-out evaluator resamples whole stays and never splits one. Unlabelled time is
  never used for training.

HONEST LIMITS
  - Labels are only as true as his words and taps; a stay's first second is speech lag.
  - Teach mode's times are relative to the recording's first chunk, a fraction of a second
    off the board clock; edge_trim_s absorbs it.
  - A session with no empty-room stretch borrows one (same day first). That reference is
    from another moment and injects an offset; the report flags every borrowed one.
"""
from __future__ import annotations

import glob
import json
import os
import re
import threading
import time
from typing import Callable, Optional

import numpy as np

from . import DATA_DIR
from . import fingerprint as fp
from .zones import ZONE_IDS

LABELS_DIR = os.path.join(DATA_DIR, "labels")
SPANS_FILE = os.path.join(LABELS_DIR, "spans.jsonl")
RECORDINGS_DIR = os.path.join(DATA_DIR, "recordings")
# the app (2026-10-27) writes "minidrill" (a tap-to-label mini drill's raw.akr under
# drill/minidrill/<day>/<HHMMSS>-mini/), "correction" ("no, I'm at the desk") and
# "confirmed" (he said the live answer was right)
SPAN_SOURCES = ("minidrill", "correction", "confirmed", "tap", "drill", "narration", "teach", "manual")
STREAM_DIR = os.path.join(DATA_DIR, "stream")
MAX_SPAN_S = 6 * 3600.0          # a "span" longer than 6 h is a typo, not a stay
STREAM = "stream"                # a span on the rolling raw store instead of an .akr
HOP_S = fp.HOP / fp.RATE_HZ      # a window every 0.5 s
WIN_S = fp.WIN / fp.RATE_HZ      # each 2 s long
OUT_MIN_WINDOWS = 20             # bathroom/balcony windows needed to stand in for an empty room

# ---------------------------------------------------------------- label text -> zone id
TRANSIT_ZONES = {"beside_bed_desk_side", "beside_bed_bathroom_wall", "between_bed_and_balcony_door"}
# Teach mode's buttons and learn-my-room's steps (teach.LABELS, 2026-10-12)
TEACH_LABELS = {"desk": "at_desk_chair", "bed": "bed", "in bed": "bed", "at my desk": "at_desk_chair",
                "walk": "moving", "moving around": "moving", "room": "moving",
                "hallway": "out_of_room", "outside my door": "out_of_room", "empty": "out_of_room",
                "room empty": "out_of_room", "away": "out_of_room", "outside": "out_of_room"}
ACTIVITY_WORDS = {"still", "move", "moving", "walk", "walking", "type", "typing", "wave", "waving",
                  "lying", "sitting", "standing"}
DROP_WORDS = {"drop", "ignore", "none", "unknown", "not sure", "pause"}
# short names for the two sides of a transit
SHORT = {"at_desk_chair": "desk", "desk_standing": "desk", "bed_lying": "bed", "bed_sitting": "bed",
         "standing_on_bed": "bed", "bed": "bed", "outside_bathroom": "bathroom_door",
         "inside_bathroom": "bathroom", "at_balcony_door": "balcony_door", "balcony": "balcony",
         "room_door": "room_door", "wardrobe": "wardrobe", "out_of_room": "out"}
# transits that already have a zone id
TRANSIT_ALIAS = {frozenset({"bed", "desk"}): "beside_bed_desk_side",
                 frozenset({"bed", "balcony_door"}): "between_bed_and_balcony_door",
                 frozenset({"bed", "balcony"}): "between_bed_and_balcony_door"}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", str(text).lower().replace("_", " "))).strip()


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _kind(zone: str) -> str:
    if zone == "out_of_room":
        return "empty"
    if zone in TRANSIT_ZONES or zone.startswith("between_"):
        return "transit"
    if zone == "moving":
        return "activity"
    return "place"


def _side(text: str) -> str:
    """One side of "between X and Y" -> its short place name."""
    from .narrate import PHRASES
    s = re.sub(r"^(the|my) ", "", _norm(text))
    if s in PHRASES and PHRASES[s][0] == "zone":
        return SHORT.get(PHRASES[s][1], PHRASES[s][1])
    if s in TEACH_LABELS:
        return SHORT.get(TEACH_LABELS[s], TEACH_LABELS[s])
    return SHORT.get(_slug(s), _slug(s))


def map_label(text: str) -> dict:
    """Any label text he ever used -> {"zone", "kind"}; kind is place, transit, empty
    (the room-empty reference), activity (no place: "walking"), or drop ("ignore this").
    ValueError on empty text."""
    from .narrate import PHRASES, find_events
    s = _norm(text)
    if not s:
        raise ValueError("an empty label")
    sid = s.replace(" ", "_")
    if sid in ZONE_IDS or sid in set(fp.PLACE_MAP.values()):
        return {"zone": sid, "kind": _kind(sid)}
    if s in TEACH_LABELS:
        z = TEACH_LABELS[s]
        return {"zone": z, "kind": _kind(z)}
    if s in DROP_WORDS:
        return {"zone": None, "kind": "drop"}
    if s in ACTIVITY_WORDS:
        return {"zone": None, "kind": "activity", "activity": s}
    if s in PHRASES:
        kind, v = PHRASES[s]
        if kind == "zone":
            return {"zone": v, "kind": _kind(v)}
        if kind == "pause":
            return {"zone": None, "kind": "drop"}
        return {"zone": None, "kind": "activity", "activity": v}
    m = re.fullmatch(r"(?:walking |moving |going )?between (.+?) and (.+)", s)
    if m:
        a, b = sorted({_side(m.group(1)), _side(m.group(2))})
        z = TRANSIT_ALIAS.get(frozenset({a, b}), f"between_{a}_and_{b}")
        return {"zone": z, "kind": "transit"}
    ev = find_events([{"t": 0.0, "w": s}])
    zones = [e["value"] for e in ev if e["kind"] == "zone"]
    if zones:
        return {"zone": zones[0], "kind": _kind(zones[0])}
    if any(e["kind"] == "pause" for e in ev):
        return {"zone": None, "kind": "drop"}
    return {"zone": sid, "kind": "place"}       # a place no list knows yet ("bookshelf")


# ---------------------------------------------------------------- the spans file (the app's contract)
_LOCK = threading.Lock()


def _rec_id(recording: str) -> str:
    """The stored name of a recording: relative to the data folder when inside it."""
    if recording == STREAM:
        return STREAM
    p = os.path.abspath(recording if os.path.isabs(recording) else os.path.join(DATA_DIR, recording))
    try:
        rel = os.path.relpath(p, DATA_DIR)
    except ValueError:                                   # another drive
        return p
    return p if rel.startswith("..") else rel.replace("\\", "/")


def _rec_path(rec: str) -> Optional[str]:
    if rec == STREAM:
        return None
    return rec if os.path.isabs(rec) else os.path.join(DATA_DIR, rec)


def _session_of(rec: str) -> str:
    if rec == STREAM:
        return STREAM
    p = rec.replace("\\", "/")
    base = os.path.basename(p)
    return os.path.basename(os.path.dirname(p)) if base == "raw.akr" else os.path.splitext(base)[0]


def _day_of(t: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(t))


def add_span(recording: str, t0: float, t1: float, zone: str, source: str, *, path: Optional[str] = None,
             note: str = "") -> dict:
    """Append one labelled span: `recording` (an .akr path, absolute or under the data
    folder, or "stream" for the live store) was at `zone` from host epoch time t0 to t1.
    zone is any label text ("at_desk_chair", "desk", "between the bed and the desk",
    "bookshelf", "ignore"); it is mapped with map_label and both are stored. source is one
    of SPAN_SOURCES ("correction" for "no, I'm at the desk", "tap" for a mini drill).

    Validated (ValueError on bad input), append-only (old lines are never edited), written
    atomically (the whole file to a temporary name, then renamed: a crash leaves the old
    file or the new one, never half a line). Returns the stored span."""
    if not isinstance(recording, str) or not recording.strip():
        raise ValueError("recording must be a recording path or 'stream'")
    rec = _rec_id(recording.strip())
    rp = _rec_path(rec)
    if rp is not None and not (rp.endswith(".akr") and os.path.isfile(rp)):
        raise ValueError(f"no such recording: {recording!r} (an existing .akr, or 'stream')")
    try:
        t0, t1 = float(t0), float(t1)
    except (TypeError, ValueError):
        raise ValueError("t0 and t1 must be numbers (host epoch seconds)") from None
    if not (np.isfinite(t0) and np.isfinite(t1)) or t0 < 1e9:
        raise ValueError("t0 and t1 must be host epoch seconds")
    if not t1 > t0:
        raise ValueError("t1 must be after t0")
    if t1 - t0 > MAX_SPAN_S:
        raise ValueError(f"a span of {t1 - t0:.0f} s is longer than {MAX_SPAN_S:.0f} s")
    if source not in SPAN_SOURCES:
        raise ValueError(f"source must be one of {SPAN_SOURCES}")
    if not isinstance(zone, str) or not zone.strip() or len(zone) > 80:
        raise ValueError("zone must be a label of 1-80 characters")
    m = map_label(zone)
    span = {"recording": rec, "t0": round(t0, 3), "t1": round(t1, 3), "zone": m["zone"], "label": zone.strip(),
            "kind": m["kind"], "source": source, "session": _session_of(rec), "day": _day_of(t0),
            "added": round(time.time(), 3)}
    if note:
        span["note"] = str(note)[:200]
    f = path or SPANS_FILE
    with _LOCK:
        os.makedirs(os.path.dirname(f) or ".", exist_ok=True)
        old = b""
        if os.path.exists(f):
            with open(f, "rb") as fh:
                old = fh.read()
            if old and not old.endswith(b"\n"):
                old += b"\n"                              # a torn last line never glues onto ours
        tmp = f + f".{os.getpid()}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(old + (json.dumps(span) + "\n").encode("utf-8"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, f)
    return span


def list_spans(recording: Optional[str] = None, *, path: Optional[str] = None) -> list[dict]:
    """Every span in the spans file, oldest first (optionally of one recording). A line
    that does not parse is skipped, never fatal."""
    f = path or SPANS_FILE
    out = []
    if not os.path.exists(f):
        return out
    want = _rec_id(recording) if recording else None
    with open(f, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln:
                continue
            try:
                s = json.loads(ln)
            except ValueError:
                continue
            if isinstance(s, dict) and {"recording", "t0", "t1", "kind"} <= set(s) and (want is None or s["recording"] == want):
                out.append(s)
    return out


# ---------------------------------------------------------------- the catalog
def _first_host_time(akr: str) -> Optional[float]:
    from .transport import iter_recording
    try:
        for t, _ in iter_recording(akr):
            return float(t)
    except (OSError, ValueError):
        return None
    return None


def _session_spans(sess: list[dict], source_default: str) -> list[dict]:
    out = []
    for s in sess:
        rec = _rec_id(os.path.join(s["folder"], "raw.akr"))
        for lab in s["labels"]:
            if lab.get("verdict", "ok") != "ok" or "t_start" not in lab:
                continue
            m = map_label(lab.get("zone", ""))
            kind = "empty" if lab.get("kind") == "empty" else m["kind"]
            out.append({"recording": rec, "t0": float(lab["t_start"]), "t1": float(lab["t_end"]),
                        "zone": m["zone"], "label": lab.get("zone"), "kind": kind,
                        "source": lab.get("source") or source_default, "session": s["session"], "day": s["day"],
                        "fan": lab.get("fan"), "activity": lab.get("activity")})
    return out


def _teach_spans(recordings_dir: str, notes: list) -> list[dict]:
    from .teach import is_simulated
    out = []
    for lab_path in sorted(glob.glob(os.path.join(recordings_dir, "*.labels.json"))):
        stem = lab_path[:-len(".labels.json")]
        akr = stem + ".akr"
        if not os.path.exists(akr):
            continue
        if is_simulated(lab_path):
            notes.append(f"{os.path.basename(akr)}: simulated, never trained on")
            continue
        try:
            with open(lab_path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            notes.append(f"{os.path.basename(lab_path)}: unreadable")
            continue
        base = None
        rec = _rec_id(akr)
        for seg in d.get("segments", []):
            if seg.get("checked") not in (None, "ok"):
                continue                                      # learn-my-room's "too small" retakes
            text = seg.get("zone") or seg.get("label")
            if not text:
                continue
            if "start_host" in seg and "end_host" in seg:
                t0, t1 = float(seg["start_host"]), float(seg["end_host"])
            else:
                if seg.get("end") is None:
                    continue
                base = _first_host_time(akr) if base is None else base
                if base is None:
                    break
                t0, t1 = base + float(seg["start"]), base + float(seg["end"])
            m = map_label(text)
            if m["kind"] == "activity" and seg.get("activity"):
                m = {**m, "activity": seg["activity"]}
            out.append({"recording": rec, "t0": t0, "t1": t1, "zone": m["zone"], "label": text, "kind": m["kind"],
                        "source": d.get("source") or "teach", "session": os.path.basename(stem), "day": _day_of(t0),
                        "fan": None, "activity": seg.get("activity") or m.get("activity")})
    return out


def _subtract(spans: list[dict], cut: dict) -> list[dict]:
    """spans with the interval of `cut` removed where they share its recording."""
    out = []
    for s in spans:
        if s["recording"] != cut["recording"] or s["t1"] <= cut["t0"] or s["t0"] >= cut["t1"]:
            out.append(s)
            continue
        if s["t0"] < cut["t0"]:
            out.append({**s, "t1": cut["t0"]})
        if s["t1"] > cut["t1"]:
            out.append({**s, "t0": cut["t1"]})
    return out


def catalog(drill_root: Optional[str] = None, narrate_root: Optional[str] = None,
            recordings_dir: Optional[str] = None, spans_path: Optional[str] = None) -> dict:
    """Every labelled span of every source, as one table, plus seconds per label per day.

    {"spans": [{recording, t0, t1, zone, label, kind, source, session, day, ...}],
     "seconds": {day: {zone: s}}, "by_session": {session: {zone: s}},
     "labels": {label text: zone}, "kinds": {zone: kind}, "sources": {source: s}, "notes": [...]}
    Drop spans (and the parts of older labels they cover) are removed; activity-only
    spans are kept in the table but carry no place."""
    from . import drill, narrate
    notes: list = []
    drill_root = drill_root or drill.DRILL_DIR
    narrate_root = narrate_root or narrate.NARRATE_DIR
    base = (_session_spans(drill.sessions(drill_root), "drill")
            + _session_spans(narrate.sessions(narrate_root), "narration")
            + _teach_spans(recordings_dir or RECORDINGS_DIR, notes))
    extra = []
    for s in list_spans(path=spans_path):
        try:
            m = map_label(s.get("label") or s.get("zone") or "")
        except ValueError:
            continue
        e = {**s, "zone": m["zone"], "kind": m["kind"], "t0": float(s["t0"]), "t1": float(s["t1"])}
        if e["recording"] == STREAM:
            # the rolling store has no sessions: one pseudo-recording per day
            day = _day_of(e["t0"])
            e.update(recording=f"{STREAM}@{day}", session=f"{STREAM}-{day}", day=day)
        extra.append(e)
    spans = base
    for e in extra:                       # newer labels win where they overlap older ones
        spans = _subtract(spans, e) + ([e] if e["kind"] != "drop" else [])
    spans = sorted((s for s in spans if s["t1"] - s["t0"] > 0 and s["kind"] != "drop"),
                   key=lambda s: (s["recording"], s["t0"]))
    # a session id is a folder name ("090000-narrate"): the same name on two days must stay
    # two sessions, or leave-one-session-out would hold out both days at once
    recs_of: dict = {}
    for s in spans:
        recs_of.setdefault(s["session"], set()).add(s["recording"])
    spans = [{**s, "session": f"{s['day']}/{s['session']}"} if len(recs_of[s["session"]]) > 1 else s for s in spans]
    seconds: dict = {}
    by_session: dict = {}
    labels: dict = {}
    kinds: dict = {}
    sources: dict = {}
    for s in spans:
        z = s["zone"] or f"({s.get('activity') or 'activity'})"
        d = s["t1"] - s["t0"]
        seconds.setdefault(s["day"], {})
        seconds[s["day"]][z] = round(seconds[s["day"]].get(z, 0.0) + d, 1)
        by_session.setdefault(s["session"], {})
        by_session[s["session"]][z] = round(by_session[s["session"]].get(z, 0.0) + d, 1)
        if s.get("label") is not None:
            labels[str(s["label"])] = s["zone"]
        kinds[z] = s["kind"]
        sources[s["source"]] = round(sources.get(s["source"], 0.0) + d, 1)
    return {"spans": spans, "seconds": seconds, "by_session": by_session, "labels": labels, "kinds": kinds,
            "sources": sources, "notes": notes}


def format_catalog(cat: dict) -> str:
    lines = [f"  {len(cat['spans'])} labelled spans; seconds by source: "
             + ", ".join(f"{k} {v:.0f}" for k, v in sorted(cat["sources"].items()))]
    for day in sorted(cat["seconds"]):
        lines.append(f"  {day}")
        for z, s in sorted(cat["seconds"][day].items(), key=lambda kv: -kv[1]):
            lines.append(f"    {z:<34} {s:>8.0f} s  ({cat['kinds'].get(z, '?')})")
    lines.append("  per session:")
    for sess, per in sorted(cat["by_session"].items()):
        lines.append(f"    {sess}: " + ", ".join(f"{z} {s:.0f}" for z, s in sorted(per.items(), key=lambda kv: -kv[1])))
    for n in cat["notes"]:
        lines.append("  note: " + n)
    return "\n".join(lines)


# ---------------------------------------------------------------- spans on the rolling store
def stream_steps(spans: list[dict], root: Optional[str] = None, pad_s: float = 3.0) -> dict:
    """A step series (fingerprint.recording_steps' shape) for spans on the rolling 7-day
    store ("stream"), built from stream.py's 20 Hz rows around them.

    The store keeps the same conditioned amplitude the windows are built from, averaged
    to 50 ms rows; each 40 ms step takes the log amplitude of the nearest row within
    40 ms. Rows carry board time; host time is board time plus the offset the per-second
    meta gives (the smallest arrival-minus-board offset within +-30 s: delay only adds).
    APPROXIMATE: log of a 50 ms mean rather than the mean of 100 Hz logs, on a 20 Hz grid,
    so these windows are close to, not identical with, the same minutes read from an .akr."""
    from datetime import datetime, timedelta
    from pathlib import Path
    from . import stream as st
    root = Path(root or STREAM_DIR)
    lo = min(s["t0"] for s in spans) - pad_s
    hi = max(s["t1"] for s in spans) + pad_s
    H, A, R = [], [], []
    h = datetime.fromtimestamp(lo).replace(minute=0, second=0, microsecond=0)
    while h.timestamp() <= hi:
        x = st.load_hour(root, h.strftime("%Y-%m-%d"), h.hour)
        h += timedelta(hours=1)
        if x is None or not len(x.get("t", [])) or not len(x.get("meta_t", [])):
            continue
        off = np.asarray(x["meta_ts"], float) - np.asarray(x["meta_t"], float)
        if len(off) > 1:
            pad = np.pad(off, 30, mode="edge")
            off = np.lib.stride_tricks.sliding_window_view(pad, 61).min(axis=1)
        idx = np.clip(np.searchsorted(x["meta_t"], x["t"], side="right") - 1, 0, len(off) - 1)
        host = np.asarray(x["t"], float) + off[idx]
        keep = (host >= lo) & (host <= hi)
        H.append(host[keep]); A.append(np.asarray(x["amp"], np.float32)[keep]); R.append(np.asarray(x["real"])[keep])
    empty = {"v": np.zeros((0, fp.N_SUB), np.float32), "real": np.zeros(0, bool), "t": np.zeros(0),
             "gap": np.zeros(0, np.int32), "sha256": "stream", "cached": False}
    if not H or not sum(len(x) for x in H):
        return empty
    host, amp, real = np.concatenate(H), np.concatenate(A), np.concatenate(R)
    o = np.argsort(host, kind="stable")
    host, amp, real = host[o], amp[o], real[o]
    step = fp.BIN_S
    k = np.arange(int(np.floor(host[0] / step)), int(np.floor(host[-1] / step)) + 1)
    c = (k + 0.5) * step
    j = np.clip(np.searchsorted(host, c), 1, len(host) - 1)
    j = np.where(np.abs(host[j - 1] - c) <= np.abs(host[j] - c), j - 1, j)
    ok = np.abs(host[j] - c) <= step
    ks, js = k[ok], j[ok]
    if not len(ks):
        return empty
    gap = np.r_[np.diff(ks) - 1, 0].astype(np.int32)
    gap[gap * step > fp.MAX_GAP_S] = -1
    return {"v": np.log(np.maximum(amp[js].astype(np.float32), 1e-6)), "real": real[js] > 0,
            "t": (ks + 1) * step - 0.005, "gap": gap, "sha256": "stream", "cached": False}


# ---------------------------------------------------------------- the balanced set
TRAINABLE = ("place", "transit")


def _waterfill(avail: list[int], q: int, rng) -> list[int]:
    """Share q windows over stays holding avail[i]: the smallest stays first, each gets an
    equal share of what is left or all it has, so no stay gives more than its share."""
    n = len(avail)
    alloc = [0] * n
    order = sorted(range(n), key=lambda i: (avail[i], float(rng.random())))
    rem = q
    for j, i in enumerate(order):
        share = rem // (n - j) if j < n - 1 else rem
        alloc[i] = min(avail[i], share)
        rem -= alloc[i]
    return alloc


def _spread(n: int, k: int, rng) -> np.ndarray:
    """k of n indices, evenly spaced, with a seeded phase."""
    if k >= n:
        return np.arange(n)
    u = float(rng.random())
    return np.unique(np.floor((np.arange(k) + u) * n / k).astype(int))


def _mean_ref(ws: list) -> Optional[np.ndarray]:
    return np.mean(np.stack(ws), axis=(0, 2)) if ws else None


def build(per_place_s: float = 30, min_place_s: float = 10, edge_trim_s: float = 1.0, seed: int = 0,
          merge: bool = True, kinds: tuple = TRAINABLE, cat: Optional[dict] = None, cache: bool = True,
          cache_dir: Optional[str] = None, stream_root: Optional[str] = None,
          progress: Optional[Callable[[float], None]] = None,
          log: Callable[[str], None] = print, **catalog_kw) -> dict:
    """A balanced window set drawn only from labelled spans (see the module docstring).

    Returns {"X" [n, 51, 50] float32 (minus the session's empty-room reference), "y" (class),
    "zone" (raw zone), "t", "day", "session", "stay", "fan", "stays": {stay: {...}},
    "per_class": {class: {"days": {day: {available_s, used_s, stays}}, "used_s"}},
    "dropped": {class: available_s}, "refs": {session: {"source", "fan_on"/"fan_off": [51]}},
    "excluded": {session: why}, "dominant": {session: class}, "days": [...], "params", "notes"}.
    Deterministic given the seed and the files."""
    cat = cat if cat is not None else catalog(**catalog_kw)
    notes = list(cat.get("notes", []))
    rng = np.random.default_rng(seed)
    cls_of = (lambda z: fp.PLACE_MAP.get(z, z)) if merge else (lambda z: z)
    by_rec: dict = {}
    for s in cat["spans"]:
        if s["kind"] in kinds or s["kind"] == "empty":
            by_rec.setdefault(s["recording"], []).append(s)
    recs = sorted(by_rec)            # an empty-room-only recording is still a reference to borrow
    if any(r.startswith(STREAM + "@") for r in recs):
        notes.append("spans on the rolling store are read from its 20 Hz rows: close to, not identical with, "
                     "windows from a raw recording")
    # dominance per session from the raw labelled seconds (what the session really was)
    dominant = {}
    for sess, per in cat["by_session"].items():
        cands = {}
        for z, sec in per.items():
            if cat["kinds"].get(z) in kinds:
                cands[cls_of(z)] = cands.get(cls_of(z), 0.0) + sec
        if cands:
            dominant[sess] = max(cands, key=cands.get)
    # pass 1: which window end times fall inside which span; empty and out-zone windows per session
    info: dict = {}
    steps_mem: dict = {}
    for i, rec in enumerate(recs):
        if progress:
            progress(0.5 * i / max(1, len(recs)))
        sp = sorted(by_rec[rec], key=lambda s: s["t0"])
        if rec.startswith(STREAM + "@"):
            steps = stream_steps(sp, stream_root)
            steps_mem[rec] = steps
            if not len(steps["t"]):
                notes.append(f"{rec}: no rows in the rolling store for its {len(sp)} spans (pruned, or never recorded)")
                continue
        else:
            path = _rec_path(rec)
            if path is None or not os.path.exists(path):
                notes.append(f"{rec}: recording missing, {len(sp)} spans skipped")
                continue
            try:
                steps = fp.recording_steps(path, cache=cache, cache_dir=cache_dir)
            except (OSError, ValueError) as e:
                notes.append(f"{rec}: unreadable ({e})")
                continue
            if not cache:
                steps_mem[rec] = steps
        times = np.array([t for t, _ in fp.iter_windows_from_steps(steps, want=lambda _t: False)])
        sid = sp[0]["session"]
        # stays: consecutive spans of the same class; a stay ends when another place starts
        # or he leaves the room (an activity change, "still" -> "typing", is the same stay)
        stay_of, k, prev = [], -1, None
        for s in sp:
            c = cls_of(s["zone"]) if s["kind"] in kinds else None
            if c is not None and c != prev:
                k += 1
            prev = c
            stay_of.append(f"{sid}/{k}" if c is not None else None)
        win_span = np.full(len(times), -1, int)
        for j, s in enumerate(sp):
            m = (win_span < 0) & (times - WIN_S >= s["t0"] + edge_trim_s - 1e-6) & (times <= s["t1"] - edge_trim_s + 1e-6)
            win_span[m] = j
        info[rec] = {"spans": sp, "stay_of": stay_of, "times": times, "win_span": win_span, "session": sid,
                     "day": sp[0]["day"]}
    # available windows per (class, day, stay)
    avail: dict = {}
    for rec, d in info.items():
        for wi in np.flatnonzero(d["win_span"] >= 0):
            s = d["spans"][d["win_span"][wi]]
            if s["kind"] not in kinds:
                continue
            key = (cls_of(s["zone"]), s["day"], d["stay_of"][d["win_span"][wi]])
            avail.setdefault(key, []).append((rec, int(wi)))
    # every trainable class labelled at all, so one whose spans are too short for any 2 s
    # window is reported as dropped (0 s), not silently missing
    total: dict = {cls_of(s["zone"]): 0.0 for d in info.values() for s in d["spans"] if s["kind"] in kinds}
    for (c, _, _), ws in avail.items():
        total[c] = total.get(c, 0) + len(ws) * HOP_S
    dropped = {c: round(s, 1) for c, s in sorted(total.items()) if s < min_place_s}
    for c, s in dropped.items():
        log(f"  dropped {c}: {s:.1f} s labelled in all, under the {min_place_s:g} s minimum")
    q = int(round(per_place_s / HOP_S))
    chosen: dict = {}                                   # rec -> {window index: stay}
    per_class: dict = {}
    stays: dict = {}
    for c in sorted({k[0] for k in avail} - set(dropped)):
        per_class[c] = {"days": {}, "used_s": 0.0}
        for day in sorted({k[1] for k in avail if k[0] == c}):
            keys = sorted(k for k in avail if k[0] == c and k[1] == day)
            counts = [len(avail[k]) for k in keys]
            alloc = _waterfill(counts, q, rng)
            for k, a in zip(keys, alloc):
                ws = sorted(avail[k], key=lambda rw: info[rw[0]]["times"][rw[1]])
                pick = _spread(len(ws), a, rng) if a else np.array([], int)
                for p in pick:
                    rec, wi = ws[p]
                    chosen.setdefault(rec, {})[wi] = k[2]
                ts = [info[rw[0]]["times"][rw[1]] for rw in ws]
                stays[k[2]] = {"class": c, "session": info[ws[0][0]]["session"], "day": day,
                               "t0": round(min(ts) - WIN_S, 2), "t1": round(max(ts), 2),
                               "available": len(ws), "used": int(len(pick))}
            used = sum(stays[k[2]]["used"] for k in keys)
            per_class[c]["days"][day] = {"available_s": round(sum(counts) * HOP_S, 1),
                                         "used_s": round(used * HOP_S, 1), "stays": len(keys)}
            per_class[c]["used_s"] = round(per_class[c]["used_s"] + used * HOP_S, 1)
    # pass 2: build the chosen windows, and every session's own empty-room reference
    raw: dict = {}
    own_refs: dict = {}
    out_refs: dict = {}
    for i, (rec, d) in enumerate(sorted(info.items())):
        if progress:
            progress(0.5 + 0.45 * i / max(1, len(info)))
        sp, ws = d["spans"], d["win_span"]
        empty_idx = {int(w) for w in np.flatnonzero(ws >= 0) if sp[ws[w]]["kind"] == "empty"}
        out_idx = {int(w) for w in np.flatnonzero(ws >= 0) if sp[ws[w]]["zone"] in fp.OUT_ZONES}
        sel = chosen.get(rec, {})
        need = set(sel) | empty_idx | out_idx
        if not need:
            continue
        steps = steps_mem.get(rec) or fp.recording_steps(_rec_path(rec), cache=cache, cache_dir=cache_dir)
        emp = {False: [], True: []}
        outw, got = [], []
        for wi, (t, w) in enumerate(fp.iter_windows_from_steps(steps, want=None)):
            if wi not in need:
                continue
            s = sp[ws[wi]]
            if wi in empty_idx:
                emp[bool(s.get("fan"))].append(w)
            if wi in out_idx:
                outw.append(w)
            if wi in sel:
                got.append((wi, t, w, s))
        del steps
        own = {fan: _mean_ref(v) for fan, v in emp.items() if v}
        if own:
            own_refs[rec] = own
        if len(outw) >= OUT_MIN_WINDOWS:
            out_refs[rec] = _mean_ref(outw)
        if got:
            raw[rec] = got
    # references: own -> same day (nearest in time) -> bathroom/balcony stand-in -> nearest other day
    refs: dict = {}
    excluded: dict = {}
    mid = {rec: float(np.median(d["times"])) if len(d["times"]) else 0.0 for rec, d in info.items()}
    for rec in sorted(raw):
        d = info[rec]
        src, ref = None, None
        if rec in own_refs:
            src, ref = "own", own_refs[rec]
        else:
            same = sorted((abs(mid[r] - mid[rec]), r) for r in own_refs if info[r]["day"] == d["day"])
            other = sorted((abs(mid[r] - mid[rec]), r) for r in own_refs if info[r]["day"] != d["day"])
            day_out = [r for r in out_refs if info[r]["day"] == d["day"]]
            if same:
                r = same[0][1]
                src, ref = f"borrowed:{info[r]['session']}", own_refs[r]
            elif day_out:
                m = np.mean([out_refs[r] for r in day_out], axis=0)
                src, ref = "out_zones", {False: m, True: m}
            elif other:
                r = other[0][1]
                src, ref = f"borrowed_other_day:{info[r]['session']}", own_refs[r]
        if ref is None:
            excluded[d["session"]] = "no empty-room stretch anywhere to clean it with"
            log(f"  {d['session']}: left out, no empty-room reference to clean it with (record 2 min of empty room)")
            continue
        refs[d["session"]] = {"source": src, **{("fan_on" if f else "fan_off"): v for f, v in ref.items()}}
        if src != "own":
            log(f"  {d['session']}: no empty-room stretch of its own; reference {src} (flagged in the report)")
    X, Y, Z, T, D, S, ST, F = [], [], [], [], [], [], [], []
    for rec in sorted(raw):
        sess = info[rec]["session"]
        if sess not in refs:
            continue
        r = refs[sess]
        for wi, t, w, s in raw[rec]:
            fan = bool(s.get("fan"))
            ref = r.get("fan_on" if fan else "fan_off")
            ref = ref if ref is not None else r.get("fan_off" if fan else "fan_on")
            X.append(w - ref[:, None].astype(np.float32))
            Y.append(cls_of(s["zone"])); Z.append(s["zone"]); T.append(t); D.append(s["day"]); S.append(sess)
            ST.append(chosen[rec][wi]); F.append(fan)
    if progress:
        progress(1.0)
    days = sorted(set(D))
    return {"X": np.asarray(X, np.float32).reshape(-1, fp.N_SUB, fp.NB), "y": np.asarray(Y), "zone": np.asarray(Z),
            "t": np.asarray(T, float), "day": np.asarray(D), "session": np.asarray(S), "stay": np.asarray(ST),
            "fan": np.asarray(F, bool), "stays": stays, "per_class": per_class, "dropped": dropped, "refs": refs,
            "excluded": excluded, "dominant": dominant, "days": days,
            "params": {"per_place_s": per_place_s, "min_place_s": min_place_s, "edge_trim_s": edge_trim_s,
                       "seed": seed, "merge": merge, "kinds": list(kinds)},
            "notes": notes}


def as_days(ds: dict) -> dict:
    """The balanced set in the evaluator's shape: {day: [one run per session]}, each run
    with its stay ids, its session's dominant class and its reference's source."""
    out: dict = {}
    for sess in sorted(set(ds["session"].tolist())):
        m = ds["session"] == sess
        day = str(ds["day"][m][0])
        out.setdefault(day, []).append({
            "X": ds["X"][m], "zone": ds["y"][m], "t": ds["t"][m], "fan": ds["fan"][m], "stay": ds["stay"][m],
            "day": day, "session": sess, "dominant": ds["dominant"].get(sess),
            "ref_source": ds["refs"].get(sess, {}).get("source")})
    return out


def summary(ds: dict) -> dict:
    """The balanced set without its arrays: sizes, seconds per class and day, what was
    dropped, which references were borrowed. JSON-ready."""
    return {"windows": int(len(ds["y"])), "classes": sorted(ds["per_class"]), "days": ds["days"],
            "sessions": sorted(set(ds["session"].tolist())),
            "per_class": ds["per_class"], "dropped": ds["dropped"], "excluded": ds["excluded"],
            "references": {s: r["source"] for s, r in ds["refs"].items()}, "dominant": ds["dominant"],
            "stays": len(ds["stays"]), "params": ds["params"], "notes": ds["notes"]}


def format_build(ds: dict) -> str:
    s = summary(ds)
    lines = [f"  balanced set: {s['windows']} windows, {len(s['classes'])} classes, {len(s['days'])} day(s), "
             f"{len(s['sessions'])} session(s), {s['stays']} stays (cap {s['params']['per_place_s']:g} s per class per day)"]
    for c, v in s["per_class"].items():
        lines.append(f"    {c:<34} used {v['used_s']:>6.1f} s  " + "; ".join(
            f"{d}: {x['used_s']:.0f} of {x['available_s']:.0f} s over {x['stays']} stay(s)" for d, x in v["days"].items()))
    if s["dropped"]:
        lines.append("  dropped (under the minimum): " + ", ".join(f"{c} {v:.1f} s" for c, v in s["dropped"].items()))
    for sess, src in s["references"].items():
        if src != "own":
            lines.append(f"  FLAG {sess}: empty-room reference {src}")
    for sess, why in s["excluded"].items():
        lines.append(f"  left out {sess}: {why}")
    for n in s["notes"]:
        lines.append("  note: " + n)
    return "\n".join(lines)

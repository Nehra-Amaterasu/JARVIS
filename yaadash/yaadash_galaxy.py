"""Yaadash Galaxy — the brain as something you can look at and watch grow (ROADMAP Y1, Y2).

Every memory, the closest people, the beliefs JARVIS holds and the taste topics become
points in one 3D space, plus a ledger of how the store grew. The UI draws it
(app/ui/src/components/MemoryGalaxy.tsx); this module decides where everything goes.

WHERE A POINT GOES
  memories  the 384-d bge vectors projected to 3D with PCA (exact, deterministic), scaled
            so 95 % sit inside radius 1. Near = similar in meaning.
  beliefs   carry their own bge vector, so they go through the SAME projection and
            land among the memories they were distilled from.
  people    the centroid of the memories linked to them: their DM thread
            (source "instagram:dm:<title>") and messages that say their name.
  topics    the centroid of the memories that use the topic's top words.
  Anything with no link sits on an outer shell, so "unplaced" is visible, not hidden.
Edges are the top-k nearest neighbours among memories (cosine, full 384-d) plus the
person/belief/topic links, capped so the payload stays bounded.

WHY A CACHE
A full layout of 8,000 memories took 5.6 s on this laptop (synthetic store), and the
Yaadash tab opens far more often than the store changes. The layout is cached in the
yaadash data folder (git-ignored) under a key made of each source's row count — and
LanceDB's table version, because re-running ingest_identity.py deletes and re-adds the
authored facts, which can leave the count unchanged while the text changed. So it is
recomputed when the store grows or is rewritten, never on a plain reopen; and when it
is, the app is shown the previous layout while the new one builds (see galaxy()).

PRIVACY
The payload carries a snippet of at most LABEL_CHARS per memory, never the full text.
The full source and a longer excerpt are fetched one node at a time, when clicked
(node_detail), over the same token-guarded 127.0.0.1 server as the rest of Yaadash.
Rejected beliefs are left out: the galaxy shows what JARVIS holds, and he holds those
as false.

Growth (Y2) is reported two ways, because they answer different questions:
  by message date  what period of his life the memories are FROM (months)
  ingest ledger    when JARVIS actually LEARNED them: rows in the store per day, read
                   from LanceDB's own version history (every write is a version with a
                   timestamp and a row total), so it is measured, not reconstructed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

LAYOUT_VERSION = 1
CACHE_FILE = "galaxy_layout.json"
MEMORIES = "memories"
BELIEFS = "beliefs"

DEFAULT_MAX_MEMORIES = 8000      # 60 fps target is 5k+; 8k leaves headroom
HARD_MAX_MEMORIES = 20000
MIN_MAX_MEMORIES = 50
KNN_K = 3
EDGE_CAP = 30000
PEOPLE_TOP = 40
BELIEF_CAP = 600
TOPIC_CAP = 40
PERSON_LINKS = 6
BELIEF_LINKS = 2
TOPIC_LINKS = 8
LABEL_CHARS = 90
DETAIL_CHARS = 480
MONTH_CAP = 360                  # 30 years of months; older dates are treated as noise
LEDGER_CAP = 730                 # days in the ingest ledger (newest kept)
SHELL_R = 1.45

# Source families, in the order the growth chart stacks them (the UI holds the
# matching colours). Anything else folds into "other".
FAMILIES = ("claude", "note", "instagram", "voice", "authored")
_FAMILY_OF = {"claude": "claude", "note": "note", "notes": "note", "instagram": "instagram",
              "voice_interaction": "voice", "authored": "authored"}

# A first name that is also an everyday word is not a mention of that person.
_NAME_STOP = set("""bhai bro yaar main mera meri mere mujhe tum tera teri tere uska uski
unka hai hain tha thi kya kab kaise kaun baat yaad chat call time good love life with what
when where that this from have said told talk also abhi kal aaj sir didi bhaiya""".split())

_lock = threading.Lock()


# ------------------------------------------------------------------ small helpers
def family(source: Optional[str]) -> str:
    head = (source or "").split(":", 1)[0].strip().lower()
    return _FAMILY_OF.get(head, "other")


def _hid(prefix: str, key: str, n: int = 12) -> str:
    """A short, stable node id. Python's hash() is salted per process, md5 is not."""
    return prefix + hashlib.md5(key.encode("utf-8", "replace")).hexdigest()[:n]


def snippet(text: Optional[str], n: int = LABEL_CHARS) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def date_of(ts: Any) -> Optional[str]:
    """'YYYY-MM-DD' from an ISO-ish timestamp, or None when it is missing or absurd."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        ts = ts.isoformat()
    m = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})", str(ts))
    if not m:
        return None
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    if not (2000 <= y <= datetime.now().year + 1 and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _norm_name(s: str) -> str:
    try:
        from hinglish import normalize_name      # romanises Indic display names too
        s = normalize_name(s)
    except Exception:
        s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    return " ".join(s.split())


def _unit(key: str) -> np.ndarray:
    """A deterministic direction for `key` (jitter and shell placement)."""
    h = hashlib.md5(key.encode("utf-8", "replace")).digest()
    u = np.frombuffer(h[:12], dtype=np.uint32).astype(np.float64) / 2**32
    z = 2 * u[0] - 1
    a = 2 * math.pi * u[1]
    r = math.sqrt(max(0.0, 1 - z * z))
    return np.array([r * math.cos(a), r * math.sin(a), z])


def _shell(i: int, n: int, r: float = SHELL_R) -> np.ndarray:
    """Point i of n on a Fibonacci sphere: evenly spread, no randomness."""
    n = max(n, 1)
    z = 1 - 2 * (i + 0.5) / n
    rr = math.sqrt(max(0.0, 1 - z * z))
    a = i * math.pi * (3 - math.sqrt(5))
    return np.array([rr * math.cos(a), rr * math.sin(a), z]) * r


def _open_db(lancedb_path):
    import lancedb
    return lancedb.connect(str(lancedb_path))


def _open_table(db, name):
    try:
        return db.open_table(name)
    except Exception:
        return None


def _vectors(col) -> np.ndarray:
    """A pyarrow fixed-size-list column -> (n, d) float32, without a Python loop."""
    import pyarrow as pa
    if isinstance(col, pa.ChunkedArray):
        col = col.combine_chunks()
    n = len(col)
    if n == 0:
        return np.zeros((0, 0), dtype=np.float32)
    flat = col.flatten().to_numpy(zero_copy_only=False).astype(np.float32, copy=False)
    return flat.reshape(n, -1)


def _scan(tbl, cols: list[str]):
    """Every row of `tbl`, only `cols` (a plain scan; no query vector, no embedder)."""
    have = set(tbl.schema.names)
    cols = [c for c in cols if c in have]
    return tbl.search().select(cols).limit(None).to_arrow()


# ------------------------------------------------------------------ the cache key
def _people_file(data_dir: Path) -> Path:
    return Path(data_dir) / "people.parquet"


def _taste_file(data_dir: Path) -> Path:
    return Path(data_dir) / "taste_profile.json"


def _file_sig(p: Path) -> Optional[list]:
    try:
        st = p.stat()
        return [st.st_size, st.st_mtime_ns]
    except OSError:
        return None


def store_key(lancedb_path, data_dir, max_memories: int) -> dict:
    """What the layout depends on: row counts (+ table versions, see the module doc)."""
    db = _open_db(lancedb_path)
    key: dict = {"v": LAYOUT_VERSION, "max": int(max_memories)}
    for name in (MEMORIES, BELIEFS):
        t = _open_table(db, name)
        key[name] = [int(t.count_rows()), int(t.version)] if t is not None else None
    people = _people_file(data_dir)
    try:
        import pyarrow.parquet as pq
        key["people"] = [pq.ParquetFile(str(people)).metadata.num_rows, _file_sig(people)]
    except Exception:
        key["people"] = None
    key["topics"] = _file_sig(_taste_file(data_dir))
    return key


# ------------------------------------------------------------------ layout pieces
def select_memories(ids: list[str], fams: list[str], max_n: int) -> np.ndarray:
    """Which memories become points when there are more than max_n.

    Authored facts always (there are few, and they are what he confirmed); the rest
    by a stable hash of the id — an unbiased sample that does not reshuffle when one
    row is added, so the picture changes only where the store did."""
    n = len(ids)
    if n <= max_n:
        return np.arange(n)
    order = sorted(range(n), key=lambda i: (fams[i] != "authored",
                                            hashlib.md5(ids[i].encode("utf-8", "replace")).hexdigest()))
    return np.array(sorted(order[:max_n]), dtype=np.int64)


class Projection:
    """PCA to 3D, scaled so 95 % of the memories sit inside radius 1.

    Not whitened: dividing each axis by its spread would make the cloud round, but it
    also blows a structureless third axis up to the size of the real separations.
    Measured on the three-cluster test store (axis variances 0.23 / 0.22 / 0.013):
    cluster distance over cluster spread fell from 12.2 to 3.2 when whitened. Unwhitened,
    distances stay comparable across axes, so a flat galaxy means the meaning is flat.

    Kept as plain arrays so beliefs (and anything else with a bge vector) go through
    exactly the same map."""

    def __init__(self, X: np.ndarray):
        X = _l2(X)
        self.dim = X.shape[1] if X.ndim == 2 else 0
        self.mean = np.zeros(self.dim, dtype=np.float64)
        self.components = np.zeros((3, self.dim), dtype=np.float64)
        self.scale = 1.0
        if len(X) >= 2 and self.dim:
            # PCA through the d x d covariance (eigh), not an SVD of the n x d data:
            # same components, but sklearn's exact SVD took 5.6 s on 8,000 x 384 here
            # (plus 2.9 s to import sklearn) and this takes well under a second.
            # Exact and deterministic; each axis's sign is fixed so its largest
            # loading is positive (sklearn's svd_flip convention), so the same store
            # always gives the same picture, never a mirror image.
            k = min(3, len(X) - 1, self.dim)
            self.mean = X.mean(axis=0)
            Xc = X - self.mean
            vals, vecs = np.linalg.eigh(Xc.T @ Xc)
            top = vecs[:, np.argsort(vals)[::-1][:k]].T
            signs = np.sign(top[np.arange(k), np.abs(top).argmax(axis=1)])
            self.components[:k] = top * np.where(signs == 0, 1, signs)[:, None]
            r = np.linalg.norm(Xc @ self.components.T, axis=1)
            q = float(np.quantile(r, 0.95)) if len(r) else 1.0
            self.scale = q if q > 1e-9 else 1.0

    def __call__(self, X: np.ndarray) -> np.ndarray:
        if len(X) == 0:
            return np.zeros((0, 3))
        P = ((_l2(X) - self.mean) @ self.components.T) / self.scale
        # Squash far outliers onto a soft rim instead of letting one point set the
        # camera distance: radius r > 1.2 maps to 1.2 + 0.4*tanh((r-1.2)/0.4) < 1.6.
        r = np.linalg.norm(P, axis=1, keepdims=True)
        squashed = np.where(r > 1.2, 1.2 + 0.4 * np.tanh((r - 1.2) / 0.4), r)
        return np.where(r > 1e-12, P * (squashed / np.maximum(r, 1e-12)), P)


def _l2(X: np.ndarray) -> np.ndarray:
    X = np.asarray(X, dtype=np.float64)
    if X.ndim != 2 or X.size == 0:
        return X
    return X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)


def knn(X: np.ndarray, k: int = KNN_K, block: int = 2048) -> tuple[np.ndarray, np.ndarray]:
    """Exact top-k cosine neighbours (excluding self): (indices, similarities), each
    (n, k), sorted by similarity then index so ties cannot reorder between runs."""
    X = _l2(X).astype(np.float32)
    n = len(X)
    k = max(0, min(k, n - 1))
    idx = np.zeros((n, k), dtype=np.int64)
    sim = np.zeros((n, k), dtype=np.float32)
    if k == 0:
        return idx, sim
    for a in range(0, n, block):
        S = X[a:a + block] @ X.T
        rows = np.arange(S.shape[0])
        S[rows, a + rows] = -np.inf
        part = np.argpartition(-S, k - 1, axis=1)[:, :k]
        ps = np.take_along_axis(S, part, axis=1)
        order = np.lexsort((part, -ps), axis=1)
        idx[a:a + block] = np.take_along_axis(part, order, axis=1)
        sim[a:a + block] = np.take_along_axis(ps, order, axis=1)
    return idx, sim


_WORD = re.compile(r"[a-z0-9]+")


class TextIndex:
    """The selected memories' words, indexed once, so asking "which memories say X"
    for 40 people and 40 topics is a posting-list lookup instead of 80 regex scans of
    every memory (a phrase of several words still uses a regex, but only on the few
    memories that hold every one of its words)."""

    def __init__(self, texts: list[str]):
        self.low = [t.lower() for t in texts]
        self.posting: dict[str, set[int]] = defaultdict(set)
        for j, t in enumerate(self.low):
            for w in set(_WORD.findall(t)):
                self.posting[w].add(j)

    def matching(self, term: str) -> list[int]:
        toks = _WORD.findall(term.lower())
        if not toks:
            return []
        cands = sorted(set.intersection(*(self.posting.get(t, set()) for t in toks)))
        if len(toks) == 1:
            return cands
        pat = re.compile(r"\b" + r"\W+".join(map(re.escape, toks)) + r"\b")
        return [j for j in cands if pat.search(self.low[j])]


def mention_terms(name: str) -> list[str]:
    """What counts as a memory saying this person's name: the full name, and the
    first name when it is long enough not to be an everyday word."""
    full = _norm_name(name)
    if not full:
        return []
    terms = [full]
    first = full.split()[0]
    if len(full.split()) > 1 and len(first) >= 4 and first not in _NAME_STOP and first.isalpha():
        terms.append(first)
    return terms


# ------------------------------------------------------------------ growth (Y2)
def _month(d: Optional[str]) -> Optional[str]:
    return d[:7] if d else None


def _month_range(months: set[str]) -> list[str]:
    if not months:
        return []
    lo, hi = min(months), max(months)
    y, m = int(lo[:4]), int(lo[5:7])
    out = []
    while len(out) < MONTH_CAP:
        cur = f"{y:04d}-{m:02d}"
        out.append(cur)
        if cur >= hi:
            break
        m += 1
        if m > 12:
            y, m = y + 1, 1
    if out[-1] < hi:                  # more than MONTH_CAP months: keep the newest
        out = _month_range({_shift_month(hi, -(MONTH_CAP - 1)), hi})
    return out


def _shift_month(ym: str, k: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) - 1 + k
    return f"{y + m // 12:04d}-{m % 12 + 1:02d}"


def ingest_ledger(tbl) -> list[dict]:
    """Rows in the table at the end of each day it was written, from LanceDB's own
    version history. Versions removed by cleanup simply leave gaps; nothing is
    invented to fill them."""
    if tbl is None:
        return []
    try:
        versions = tbl.list_versions()
    except Exception:
        return []
    by_day: dict[str, int] = {}
    for v in versions:
        meta = v.get("metadata") or {}
        rows = meta.get("total_rows")
        d = date_of(v.get("timestamp"))
        if d is None or rows is None:
            continue
        try:
            by_day[d] = int(rows)          # later versions of the day overwrite earlier
        except (TypeError, ValueError):
            continue
    days = sorted(by_day)[-LEDGER_CAP:]
    return [{"date": d, "rows": by_day[d]} for d in days]


def build_growth(mem_dates: list[Optional[str]], mem_fams: list[str],
                 people_dates: list[Optional[str]], belief_dates: list[Optional[str]],
                 ledger: list[dict], belief_ledger: list[dict]) -> dict:
    months_set = {m for m in map(_month, mem_dates) if m}
    months_set |= {m for m in map(_month, people_dates) if m}
    months_set |= {m for m in map(_month, belief_dates) if m}
    months = _month_range(months_set)
    pos = {m: i for i, m in enumerate(months)}
    fams_present = [f for f in (*FAMILIES, "other") if f in set(mem_fams)]
    by_source = {f: [0] * len(months) for f in fams_present}
    undated: Counter = Counter()
    for d, f in zip(mem_dates, mem_fams):
        i = pos.get(_month(d)) if d else None
        if i is None:
            undated[f] += 1
        else:
            by_source[f][i] += 1

    def per_month(dates):
        out = [0] * len(months)
        for d in dates:
            i = pos.get(_month(d)) if d else None
            if i is not None:
                out[i] += 1
        return out

    return {
        "months": months,
        "families": fams_present,
        "by_source": by_source,
        "undated": {f: int(undated[f]) for f in fams_present if undated[f]},
        "people_new": per_month(people_dates),
        "beliefs_updated": per_month(belief_dates),
        "ingest": ledger,
        "beliefs_ingest": belief_ledger,
        "totals": {"memories": len(mem_fams), "people": len(people_dates), "beliefs": len(belief_dates)},
    }


# ------------------------------------------------------------------ the build
def _read_people(data_dir: Path):
    p = _people_file(data_dir)
    if not p.exists():
        return None
    import pandas as pd
    df = pd.read_parquet(p)
    if "closeness" not in df.columns or "name" not in df.columns:
        return None
    return df[df.closeness.notna()].copy()


def _read_topics(data_dir: Path) -> list[dict]:
    try:
        t = json.loads(_taste_file(data_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    topics = [x for x in t.get("topics", []) if isinstance(x, dict)]
    return sorted(topics, key=lambda x: -float(x.get("share") or 0))[:TOPIC_CAP]


def build_layout(lancedb_path, data_dir, max_memories: int = DEFAULT_MAX_MEMORIES) -> dict:
    """Compute the whole galaxy (no cache). Returns the payload plus "_index", the
    private map from node id to row id that node_detail needs (never sent)."""
    t0 = time.perf_counter()
    data_dir = Path(data_dir)
    db = _open_db(lancedb_path)
    mem = _open_table(db, MEMORIES)

    # ---- memories
    ids: list[str] = []
    texts: list[str] = []
    sources: list[str] = []
    dates: list[Optional[str]] = []
    V = np.zeros((0, 0), dtype=np.float32)
    if mem is not None and mem.count_rows():
        a = _scan(mem, ["id", "text", "source", "timestamp", "vector"])
        ids = [str(x) for x in a.column("id").to_pylist()]
        texts = [x or "" for x in a.column("text").to_pylist()]
        sources = [x or "" for x in a.column("source").to_pylist()]
        dates = [date_of(x) for x in (a.column("timestamp").to_pylist()
                                      if "timestamp" in a.column_names else [None] * len(ids))]
        V = _vectors(a.column("vector"))
    fams = [family(s) for s in sources]
    sel = select_memories(ids, fams, max_memories)
    Xs = V[sel] if len(sel) else np.zeros((0, V.shape[1] if V.ndim == 2 else 0))
    proj = Projection(Xs)
    P = proj(Xs) if len(sel) else np.zeros((0, 3))
    nbr, nsim = knn(Xs, KNN_K) if len(sel) > 1 else (np.zeros((len(sel), 0), int), np.zeros((len(sel), 0)))
    indeg = np.bincount(nbr.ravel(), minlength=len(sel)) if nbr.size else np.zeros(len(sel))

    nodes: list[dict] = []
    index: dict[str, dict] = {}

    def uniq(prefix: str, key: str, n: int = 12) -> str:
        # Unique across the payload: a hash collision, or two people with the same
        # display name, gets re-hashed instead of silently sharing one id.
        hid = _hid(prefix, key, n)
        while hid in index:
            key += "'"
            hid = _hid(prefix, key, n)
        return hid

    k = max(1, nbr.shape[1] if nbr.ndim == 2 else 1)
    for j, i in enumerate(sel):
        hid = uniq("m", ids[i])
        src = sources[i]
        hub = min(1.0, float(indeg[j]) / (2 * k))
        imp = 0.18 + 0.5 * hub + 0.17 * min(1.0, len(texts[i]) / 400)
        if fams[i] == "authored":
            imp = max(imp, 1.0 if src.startswith("authored:confirmed") else 0.85)
        nodes.append({"id": hid, "kind": "memory", "label": snippet(texts[i]), "source": fams[i],
                      "time": dates[i], "importance": round(imp, 3),
                      "x": round(float(P[j, 0]), 4), "y": round(float(P[j, 1]), 4), "z": round(float(P[j, 2]), 4)})
        index[hid] = {"kind": "memory", "row": ids[i]}
    n_mem = len(nodes)

    edges: list[tuple[int, int]] = []
    seen_e: set[tuple[int, int]] = set()

    def link(a_: int, b_: int) -> bool:
        if a_ == b_ or len(edges) >= EDGE_CAP:
            return False
        e = (a_, b_) if a_ < b_ else (b_, a_)
        if e in seen_e:
            return False
        seen_e.add(e)
        edges.append(e)
        return True

    # Memory edges first in order of similarity, so a cap drops the weakest ones.
    if nbr.size:
        cand = [(float(nsim[a_, c]), a_, int(nbr[a_, c])) for a_ in range(len(sel)) for c in range(nbr.shape[1])]
        cand.sort(key=lambda t: (-t[0], t[1], t[2]))
        mem_cap = EDGE_CAP - (PEOPLE_TOP * PERSON_LINKS + BELIEF_CAP * BELIEF_LINKS + TOPIC_CAP * TOPIC_LINKS)
        for _, a_, b_ in cand:
            if len(edges) >= mem_cap:
                break
            link(a_, b_)

    text_index = TextIndex([texts[i] for i in sel])
    sel_imp = np.array([n["importance"] for n in nodes[:n_mem]]) if n_mem else np.zeros(0)

    def place(linked: list[int], key: str, shell_i: int, shell_n: int) -> np.ndarray:
        if linked:
            c = P[linked].mean(axis=0)
            return c + _unit(key) * 0.06
        return _shell(shell_i, shell_n)

    # ---- people
    people_df = _read_people(data_dir)
    people_dates: list[Optional[str]] = []
    if people_df is not None:
        people_dates = [date_of(x) for x in people_df.get("first_iso", [None] * len(people_df))]
        top = people_df.sort_values(["closeness", "name"], ascending=[False, True]).head(PEOPLE_TOP)
        dm_rows: dict[str, list[int]] = defaultdict(list)
        for j, i in enumerate(sel):
            s = sources[i]
            if s.startswith("instagram:dm:"):
                dm_rows[_norm_name(s[len("instagram:dm:"):])].append(j)
        recs = top.to_dict("records")
        for pi, r in enumerate(recs):
            name = str(r.get("name") or "")
            nn = _norm_name(name)
            linked: list[int] = []
            for title, rows in dm_rows.items():
                # The DM source keeps the thread title cut to 40 characters, so a
                # long name matches on its prefix (never on fewer than 6 letters).
                if title and nn and (title == nn or (min(len(title), len(nn)) >= 6
                                                     and (nn.startswith(title) or title.startswith(nn)))):
                    linked.extend(rows)
            for term in mention_terms(name):
                linked.extend(text_index.matching(term))
            linked = sorted(set(linked))
            pos_ = place(linked, "p" + name, pi, len(recs))
            hid = uniq("p", name, 10)
            closeness = float(r.get("closeness") or 0)
            nodes.append({"id": hid, "kind": "person", "label": snippet(name, 40), "source": "people",
                          "time": date_of(r.get("first_iso")), "importance": round(0.4 + 0.6 * min(1, closeness / 100), 3),
                          "x": round(float(pos_[0]), 4), "y": round(float(pos_[1]), 4), "z": round(float(pos_[2]), 4)})
            index[hid] = {"kind": "person", "name": name, "thread": _plain(r.get("thread"))}
            me = len(nodes) - 1
            for j in sorted(linked, key=lambda j: (-sel_imp[j], j))[:PERSON_LINKS]:
                link(me, j)

    # ---- beliefs
    btbl = _open_table(db, BELIEFS)
    belief_dates: list[Optional[str]] = []
    if btbl is not None and btbl.count_rows():
        b = _scan(btbl, ["id", "claim", "category", "status", "confidence", "support", "source", "updated", "vector"])
        rows = b.drop_columns(["vector"]).to_pylist() if "vector" in b.column_names else b.to_pylist()
        BV = _vectors(b.column("vector")) if "vector" in b.column_names else np.zeros((len(rows), 0))
        belief_dates = [date_of(r.get("updated")) for r in rows]
        rank = {"confirmed": 0, "unconfirmed": 1, "outdated": 2}
        keep = [i for i, r in enumerate(rows) if r.get("status") in rank]
        keep.sort(key=lambda i: (rank[rows[i]["status"]], -(rows[i].get("support") or 0),
                                 -(rows[i].get("confidence") or 0), str(rows[i].get("id"))))
        keep = keep[:BELIEF_CAP]
        usable = n_mem and BV.ndim == 2 and BV.shape[1] == proj.dim
        bpos = proj(BV[keep]) if usable and keep else None
        bnbr = None
        if usable and keep:
            sims = _l2(BV[keep]).astype(np.float32) @ _l2(Xs).astype(np.float32).T
            bnbr = np.argsort(-sims, axis=1, kind="stable")[:, :BELIEF_LINKS]
        for qi, i in enumerate(keep):
            r = rows[i]
            st = r["status"]
            conf = float(r.get("confidence") or 0)
            imp = {"confirmed": 0.9, "outdated": 0.35}.get(st, 0.3 + 0.6 * conf)
            pos_ = bpos[qi] if bpos is not None else _shell(qi, len(keep), SHELL_R * 1.08)
            hid = "b" + re.sub(r"[^A-Za-z0-9]", "", str(r.get("id")))[:16]
            if hid == "b" or hid in index:
                hid = uniq("b", str(r.get("id")))
            nodes.append({"id": hid, "kind": "belief", "label": snippet(r.get("claim")), "source": family(r.get("source")),
                          "status": st, "time": belief_dates[i], "importance": round(imp, 3),
                          "x": round(float(pos_[0]), 4), "y": round(float(pos_[1]), 4), "z": round(float(pos_[2]), 4)})
            index[hid] = {"kind": "belief", "row": str(r.get("id"))}
            if bnbr is not None:
                me = len(nodes) - 1
                for j in bnbr[qi]:
                    link(me, int(j))

    # ---- taste topics
    topics = _read_topics(data_dir)
    if topics:
        max_share = max(float(t.get("share") or 0) for t in topics) or 1.0
        for ti, t in enumerate(topics):
            words = [w.lower() for w in (t.get("words") or [])[:6] if isinstance(w, str) and len(w) >= 3]
            per: Counter = Counter()
            for w in words:
                per.update(text_index.matching(w))
            hits = sorted(((c, j) for j, c in per.items()), key=lambda h: (-h[0], h[1]))
            label = str(t.get("label") or ", ".join(words[:3]) or f"topic {ti + 1}")
            years = sorted(int(y) for y, v in (t.get("by_year") or {}).items()
                           if str(y).isdigit() and float(v or 0) > 0)
            pos_ = place([j for _, j in hits], "t" + label, ti, len(topics))
            hid = uniq("t", f"{ti}:{label}", 10)
            nodes.append({"id": hid, "kind": "topic", "label": snippet(label, 48), "source": "taste",
                          "status": "inferred", "time": date_of(f"{years[0]}-01-01") if years else None,
                          "importance": round(0.4 + 0.6 * float(t.get("share") or 0) / max_share, 3),
                          "x": round(float(pos_[0]), 4), "y": round(float(pos_[1]), 4), "z": round(float(pos_[2]), 4)})
            index[hid] = {"kind": "topic", "n": ti, "label": label}
            me = len(nodes) - 1
            for _, j in hits[:TOPIC_LINKS]:
                link(me, j)

    growth = build_growth(dates, fams, people_dates, belief_dates,
                          ingest_ledger(mem), ingest_ledger(btbl))
    counts = Counter(n["kind"] for n in nodes)
    return {
        "version": LAYOUT_VERSION,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "build_ms": round((time.perf_counter() - t0) * 1000),
        "max_memories": int(max_memories),
        "sampled": len(sel) < len(ids),
        "counts": {"memories": len(ids), "memories_shown": counts["memory"], "people": counts["person"],
                   "beliefs": counts["belief"], "topics": counts["topic"], "edges": len(edges)},
        "sources": dict(Counter(fams[i] for i in sel)),
        "nodes": nodes,
        "edges": [list(e) for e in edges],
        "growth": growth,
        "_index": index,
    }


# ------------------------------------------------------------------ public API
def clamp_max(max_memories) -> int:
    try:
        n = int(max_memories)
    except (TypeError, ValueError):
        n = DEFAULT_MAX_MEMORIES
    return max(MIN_MAX_MEMORIES, min(HARD_MAX_MEMORIES, n))


def _cache_path(data_dir) -> Path:
    return Path(data_dir) / CACHE_FILE


def _load_cache(data_dir) -> Optional[dict]:
    try:
        return json.loads(_cache_path(data_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _save_cache(data_dir, key: dict, layout: dict) -> None:
    p = _cache_path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"key": key, "layout": layout}, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    os.replace(tmp, p)                     # atomic: a reader never sees half a file


def public(layout: dict) -> dict:
    return {k: v for k, v in layout.items() if not k.startswith("_")}


def _rebuild(lancedb_path, data_dir, max_memories: int) -> tuple[dict, bool]:
    """Build and cache under the build lock. Whoever waited on the lock re-checks the
    cache first, so two requests for the same new layout compute it once."""
    with _lock:
        key = store_key(lancedb_path, data_dir, max_memories)
        cached = _load_cache(data_dir)
        if cached and cached.get("key") == key:
            return cached["layout"], True
        layout = build_layout(lancedb_path, data_dir, max_memories)
        _save_cache(data_dir, key, layout)
        return layout, False


_refreshing: dict[str, threading.Thread] = {}


def galaxy(lancedb_path, data_dir, max_memories=DEFAULT_MAX_MEMORIES, force: bool = False,
           background: bool = False, on_built=None) -> dict:
    """The galaxy payload, from the cache when the store has not changed since.

    background=True is what the app uses. Every voice turn adds a memory, so after a
    conversation the cache is nearly always one row behind, and a full layout of
    8,000 memories took 5.6 s on this laptop (synthetic 20k-row store written in 400
    batches; profiled: kNN 1.5 s, PCA 1.0 s, LanceDB reads ~1 s). Instead of making
    the tab wait, a stale layout of the same size is served at once, marked
    "stale", while a single background thread builds the new one; on_built(payload)
    is called when it lands. With no cache at all (first open) it builds inline."""
    t0 = time.perf_counter()
    max_memories = clamp_max(max_memories)
    key = store_key(lancedb_path, data_dir, max_memories)
    cached = None if force else _load_cache(data_dir)
    stale = False
    if cached and cached.get("key") == key:
        layout, hit = cached["layout"], True
    elif cached and background and (cached.get("key") or {}).get("max") == max_memories:
        layout, hit, stale = cached["layout"], True, True
        slot = str(Path(data_dir).resolve())
        running = _refreshing.get(slot)
        if running is None or not running.is_alive():
            def work():
                built, was_cached = _rebuild(lancedb_path, data_dir, max_memories)
                if on_built is not None and not was_cached:
                    on_built({**public(built), "cached": False, "stale": False})
            th = threading.Thread(target=work, name="galaxy-layout", daemon=True)
            _refreshing[slot] = th
            th.start()
    elif force:
        with _lock:
            layout = build_layout(lancedb_path, data_dir, max_memories)
            _save_cache(data_dir, key, layout)        # the key from BEFORE the read: a row
        hit = False                                    # that lands mid-build forces a redo
    else:
        layout, hit = _rebuild(lancedb_path, data_dir, max_memories)
    out = public(layout)
    out["cached"] = hit
    out["stale"] = stale
    out["took_ms"] = round((time.perf_counter() - t0) * 1000)
    return out


def wait_for_refresh(data_dir, timeout: float = 60) -> None:
    """Block until a background rebuild for `data_dir` (if any) has finished."""
    th = _refreshing.get(str(Path(data_dir).resolve()))
    if th is not None:
        th.join(timeout)


def node_detail(lancedb_path, data_dir, node_id: str) -> Optional[dict]:
    """One node, opened: the full source, the date, a longer excerpt and its links.

    The id is looked up in the cached index, so nothing from the request reaches a
    LanceDB filter; an id from an older layout simply returns None."""
    cache = _load_cache(data_dir)
    if not cache:
        return None
    layout = cache["layout"]
    ref = layout.get("_index", {}).get(node_id)
    if not ref:
        return None
    nodes = layout["nodes"]
    pos = next((i for i, n in enumerate(nodes) if n["id"] == node_id), None)
    if pos is None:
        return None
    node = nodes[pos]
    linked = [nodes[b if a == pos else a] for a, b in layout["edges"] if pos in (a, b)][:8]
    out: dict = {"id": node_id, "kind": ref["kind"], "label": node["label"], "time": node.get("time"),
                 "links": [{"id": n["id"], "kind": n["kind"], "label": n["label"]} for n in linked]}
    kind = ref["kind"]
    if kind in ("memory", "belief"):
        db = _open_db(lancedb_path)
        tbl = _open_table(db, MEMORIES if kind == "memory" else BELIEFS)
        if tbl is None:
            return None
        esc = str(ref["row"]).replace("'", "''")
        cols = (["id", "text", "source", "timestamp", "role"] if kind == "memory" else
                ["id", "claim", "category", "era", "status", "confidence", "support", "source", "updated"])
        cols = [c for c in cols if c in tbl.schema.names]
        rows = tbl.search().where(f"id = '{esc}'").select(cols).limit(1).to_list()
        if not rows:
            return None
        r = rows[0]
        if kind == "memory":
            out.update(source=r.get("source"), family=family(r.get("source")), role=r.get("role"),
                       date=date_of(r.get("timestamp")), snippet=snippet(r.get("text"), DETAIL_CHARS))
        else:
            out.update(source=r.get("source"), status=r.get("status"), category=r.get("category"),
                       era=r.get("era"), confidence=r.get("confidence"), support=r.get("support"),
                       date=date_of(r.get("updated")), snippet=snippet(r.get("claim"), DETAIL_CHARS))
    elif kind == "person":
        df = _read_people(Path(data_dir))
        if df is None:
            return None
        hit = df[df["name"] == ref["name"]]
        if ref.get("thread") is not None and "thread" in df.columns and len(hit) > 1:
            hit = hit[hit["thread"] == ref["thread"]]
        if hit.empty:
            return None
        r = hit.iloc[0].to_dict()
        keep = ("name", "closeness", "rank", "n_msgs", "span_days", "calls", "why")
        out.update({k: _plain(r.get(k)) for k in keep if k in r},
                   source="people", date=date_of(r.get("first_iso")), last=date_of(r.get("last_iso")))
    elif kind == "topic":
        topics = _read_topics(Path(data_dir))
        t = topics[ref["n"]] if ref["n"] < len(topics) else None
        if not t:
            return None
        out.update(source="taste", status="inferred", words=(t.get("words") or [])[:10],
                   share=t.get("share"), trend=t.get("trend"),
                   by_year={str(k): v for k, v in (t.get("by_year") or {}).items()})
    return out


def _plain(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def default_paths() -> tuple[Path, Path]:
    from home import LANCEDB, YAADASH_DATA
    return LANCEDB, YAADASH_DATA


if __name__ == "__main__":
    import sys
    lp, dp = default_paths()
    g = galaxy(lp, dp, force="--force" in sys.argv)
    print(json.dumps({k: g[k] for k in ("counts", "sampled", "build_ms", "took_ms", "cached")}, indent=1))

"""Yaadash Archive — every message, both sides, unfiltered, with person and time.

WHY A SECOND STORE (2026-10-09)
The identity store is aggressively filtered (MIN_CHARS=60, his words only) because
short chatter drowns out facts. But that filter destroys episodic memory: a
48-character punchline to a friend is exactly what "remind me of that joke" needs,
and a joke is meaningless without the other person's reply. So the archive keeps
everything, and is searched only when the question is about a past conversation.

OUTPUTS (all gitignored — they contain friends' messages):
  data/yaadash/archive_msgs.parquet  one row per message (for BM25 + stats)
  data/yaadash/threads.parquet       one row per thread
  LanceDB table "archive_windows"          embedded conversation windows

A WINDOW is a run of consecutive messages inside one conversation session. Sessions
split on a gap of more than SESSION_GAP_H hours, so a window never stitches a 2021
joke onto a 2023 reply. Windows overlap (stride < size) so a moment that falls on a
boundary still lands whole inside some window.

Run:
    .venv\\Scripts\\python.exe yaadash\\yaadash_archive.py
"""
import collections
import glob
import json
import os
import sys
import time
import zipfile
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import pandas as pd
import pyarrow as pa

import hinglish
import yaadash_v2 as y
from ingest_instagram import detect_self_name, fix_mojibake

HERE = os.path.dirname(os.path.abspath(__file__))
from home import YAADASH_DATA  # noqa: E402  data/yaadash, git-ignored
DATA = str(YAADASH_DATA)
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")

SESSION_GAP_H = 3          # silence longer than this starts a new conversation
WINDOW_SIZE = 12           # messages per window
WINDOW_STRIDE = 6          # overlap of half a window
WINDOW_MAX_CHARS = 1400    # bge-small reads ~512 tokens; keep windows inside it
WINDOWS_TABLE = "archive_windows"

# Instagram system lines that are not speech.
_SYSTEM_PREFIXES = ("liked a message", "reacted ", "you sent an attachment",
                    "sent an attachment", "started a video chat", "video chat ended",
                    "started an audio call", "audio call ended", "you missed",
                    "missed a", "changed the group", "named the group", "added ",
                    "left the group", "unsent a message", "you unsent")


def _classify(m: dict, text: str) -> str:
    if "call_duration" in m:
        return "call"
    if "share" in m:
        return "share"
    if m.get("audio_files"):
        return "voice_note"
    if m.get("photos") or m.get("videos"):
        return "media"
    low = text.lower()
    if not text or low.startswith(_SYSTEM_PREFIXES) or low.endswith(" to your message"):
        return "system"
    return "text"


def _placeholder(kind: str, m: dict) -> str:
    """How a non-text message reads inside a window, so context survives."""
    if kind == "call":
        mins = round((m.get("call_duration") or 0) / 60)
        return f"[call, {mins} min]"
    return {"share": "[shared a post/reel]", "voice_note": "[voice note]",
            "media": "[sent a photo/video]"}.get(kind, "")


def find_exports():
    return sorted(glob.glob(os.path.join(DOWNLOADS, "instagram-*.zip")))


def load_export(zip_path: str):
    """Yield (thread_meta, [message rows]) for every DM thread in one export."""
    z = zipfile.ZipFile(zip_path)
    paths = [p for p in z.namelist() if "/messages/inbox/" in p and p.endswith(".json")]
    self_name = detect_self_name(z, paths)
    account = os.path.basename(zip_path).split("-")[1]
    by_thread = collections.defaultdict(list)
    for p in paths:
        by_thread[p.split("/inbox/")[1].split("/")[0]].append(p)

    for slug, files in by_thread.items():
        msgs, meta = [], None
        for p in files:
            d = json.loads(z.read(p))
            if meta is None:
                parts = [fix_mojibake(x.get("name", "")) for x in d.get("participants", [])]
                others = [x for x in parts if x != fix_mojibake(self_name)]
                meta = {
                    "thread": f"{account}/{slug}",
                    "account": account,
                    "slug": slug,
                    # Folder slug is the IG username prefix, e.g. "deven_8729..." -> "deven"
                    "username": slug.rsplit("_", 1)[0],
                    "title": hinglish.romanize(fix_mojibake(d.get("title") or slug)),
                    "is_group": len(parts) > 2,
                    "participants": len(parts),
                    "other_name": hinglish.romanize(others[0]) if len(others) == 1 else "",
                }
            msgs.extend(d.get("messages", []))
        if not msgs:
            continue
        msgs.sort(key=lambda m: m.get("timestamp_ms", 0))        # oldest first
        rows = []
        for i, m in enumerate(msgs):
            raw = fix_mojibake(m.get("content") or "")
            text = hinglish.romanize(raw).strip()
            kind = _classify(m, text)
            ts = (m.get("timestamp_ms") or 0) / 1000.0
            sender = fix_mojibake(m.get("sender_name") or "")
            rows.append({
                "thread": meta["thread"],
                "idx": i,
                "ts": ts,
                "iso": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "is_me": sender == fix_mojibake(self_name),
                "sender": hinglish.romanize(sender),
                "kind": kind,
                "text": text if kind == "text" else _placeholder(kind, m),
                "chars": len(text) if kind == "text" else 0,
                "call_min": round((m.get("call_duration") or 0) / 60, 1),
                "reactions": len(m.get("reactions") or []),
            })
        yield meta, rows


def build_windows(msgs: pd.DataFrame, threads: pd.DataFrame):
    """Split each thread into sessions, then into overlapping windows."""
    names = threads.set_index("thread")["other_name"].to_dict()
    titles = threads.set_index("thread")["title"].to_dict()
    windows = []
    for thread, g in msgs.groupby("thread", sort=False):
        g = g[g.kind != "system"].sort_values("idx")
        if g.empty:
            continue
        gap = g.ts.diff().fillna(0) > SESSION_GAP_H * 3600
        session = gap.cumsum()
        who = names.get(thread) or titles.get(thread) or "them"
        for _, s in g.groupby(session):
            s = s.reset_index(drop=True)
            starts = range(0, max(len(s) - WINDOW_SIZE, 0) + 1, WINDOW_STRIDE)
            if len(s) > WINDOW_SIZE and (len(s) - WINDOW_SIZE) % WINDOW_STRIDE:
                starts = list(starts) + [len(s) - WINDOW_SIZE]   # cover the tail
            for st in starts:
                w = s.iloc[st:st + WINDOW_SIZE]
                if (w.kind == "text").sum() < 2:
                    continue          # all reels/photos: nothing to recall
                lines = []
                for r in w.itertuples():
                    speaker = "Me" if r.is_me else (r.sender.split()[0] if r.sender else who)
                    lines.append(f"{speaker}: {r.text}")
                body = "\n".join(lines)[:WINDOW_MAX_CHARS]
                windows.append({
                    "id": f"{thread}#{int(w.idx.iloc[0])}",
                    "thread": thread,
                    "person": who,
                    "start_idx": int(w.idx.iloc[0]),
                    "end_idx": int(w.idx.iloc[-1]),
                    "ts_start": float(w.ts.iloc[0]),
                    "ts_end": float(w.ts.iloc[-1]),
                    "year": int(datetime.fromtimestamp(w.ts.iloc[0], tz=timezone.utc).year),
                    "text": body,
                })
    return windows


def main():
    os.makedirs(DATA, exist_ok=True)
    exports = find_exports()
    print(f"Exports found: {len(exports)}")
    all_meta, all_rows = [], []
    for zp in exports:
        n0 = len(all_rows)
        for meta, rows in load_export(zp):
            all_meta.append(meta)
            all_rows.extend(rows)
        print(f"  {os.path.basename(zp)}: {len(all_rows) - n0} messages")

    msgs = pd.DataFrame(all_rows)
    threads = pd.DataFrame(all_meta)
    msgs.to_parquet(os.path.join(DATA, "archive_msgs.parquet"), index=False)
    threads.to_parquet(os.path.join(DATA, "threads.parquet"), index=False)
    print(f"Messages: {len(msgs)} | threads: {len(threads)} "
          f"({int(threads.is_group.sum())} group)")
    print("By kind:", msgs.kind.value_counts().to_dict())

    t0 = time.time()
    windows = build_windows(msgs, threads)
    print(f"Windows: {len(windows)} (built in {time.time()-t0:.1f}s). Embedding on CPU...")

    t0 = time.time()
    vecs = []
    B = 256
    for i in range(0, len(windows), B):
        vecs.extend(y.embed([w["text"] for w in windows[i:i + B]]))
        if (i // B) % 10 == 0:
            done = min(i + B, len(windows))
            rate = done / max(time.time() - t0, 1e-6)
            print(f"   {done}/{len(windows)}  ({rate:.0f}/s)", flush=True)
    for w, v in zip(windows, vecs):
        w["vector"] = v.tolist()

    schema = pa.schema([
        pa.field("id", pa.string()), pa.field("thread", pa.string()),
        pa.field("person", pa.string()), pa.field("start_idx", pa.int64()),
        pa.field("end_idx", pa.int64()), pa.field("ts_start", pa.float64()),
        pa.field("ts_end", pa.float64()), pa.field("year", pa.int64()),
        pa.field("text", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), 384)),
    ])
    # Reuse the same on-disk LanceDB. Was `y._get_table() and y._db`, but a LanceTable
    # is falsy when it has no rows, so on a fresh store (no identity facts yet) `db` was
    # the empty table and the build died on db.table_names() (found 2026-10-12 by the
    # yaadash tests, which build a store from nothing).
    y._get_table()
    db = y._db
    if WINDOWS_TABLE in db.table_names():
        db.drop_table(WINDOWS_TABLE)
    db.create_table(WINDOWS_TABLE, data=windows, schema=schema)
    print(f"Embedded {len(windows)} windows in {time.time()-t0:.0f}s -> LanceDB '{WINDOWS_TABLE}'")


if __name__ == "__main__":
    main()

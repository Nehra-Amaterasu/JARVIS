"""Ingest an Instagram data export into Yaadash v2 — Aman's words only.

Instagram exports are the highest-signal identity source available: years of how
he actually talks, what he saves, what he posts. This reads the .zip directly
(no 1.6GB extraction) and stores ONLY his own messages and captions.

Two real quirks handled here, both verified against the actual export:

1. MOJIBAKE. Instagram writes UTF-8 bytes but escapes them as latin-1, so names
   and Hindi/emoji text arrive as garbage like 'माणि\x95'. Fixed by
   re-encoding latin-1 -> decoding utf-8.

2. IDENTIFYING HIM. Threads list participants by display name, and his is
   stylised unicode small-caps. Rather than hardcode it, we detect the sender who
   appears across the most threads — the only person present in every DM is the
   account owner.

Usage:
    python ingest_instagram.py "C:/Users/nehra/Downloads/instagram-....zip"
"""
import sys
import json
import zipfile
import collections

import yaadash_v2 as y

# Measured 2026-08-31: with MIN_CHARS=15, 10144 of 13538 stored rows were under
# 40 characters ("ok", "whats the plan"). They matched queries semantically but
# carried no information, burying substantive memories. 60 keeps real sentences.
MIN_CHARS = 60
CHUNK_WORDS = 180


def fix_mojibake(s: str) -> str:
    """Undo Instagram's latin-1/utf-8 double-encoding. Returns s unchanged if it
    isn't mojibake."""
    if not s:
        return ""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def _chunk(text):
    w = text.split()
    if len(w) <= CHUNK_WORDS:
        return [text]
    return [" ".join(w[i:i + CHUNK_WORDS]) for i in range(0, len(w), CHUNK_WORDS)]


def _is_noise(t: str) -> bool:
    low = t.lower().strip()
    return (
        low.startswith(("http://", "https://", "www."))
        or "sent an attachment" in low
        or "liked a message" in low
        or low.endswith(" to your message")
        or "reacted " in low and len(low) < 60
        or low in {"ok", "okay", "haan", "yes", "no", "hmm", "k"}
    )


def detect_self_name(z, msg_paths):
    """The account owner is the sender present in the most distinct threads."""
    thread_presence = collections.Counter()
    for p in msg_paths:
        try:
            d = json.loads(z.read(p))
        except Exception:
            continue
        senders = {m.get("sender_name") for m in d.get("messages", []) if m.get("sender_name")}
        for s in senders:
            thread_presence[s] += 1
    if not thread_presence:
        return None
    return thread_presence.most_common(1)[0][0]


def collect_messages(z, msg_paths, self_name):
    rows = []
    for p in msg_paths:
        try:
            d = json.loads(z.read(p))
        except Exception:
            continue
        thread = fix_mojibake(d.get("title") or "") or "dm"
        for m in d.get("messages", []):
            if m.get("sender_name") != self_name:
                continue                      # only his voice
            text = fix_mojibake(m.get("content") or "").strip()
            if len(text) < MIN_CHARS or _is_noise(text):
                continue
            ts = m.get("timestamp_ms")
            iso = None
            if ts:
                from datetime import datetime, timezone
                iso = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
            for c in _chunk(text):
                rows.append({
                    "text": c,
                    "role": "instagram_dm",
                    "timestamp": iso,
                    "source": f"instagram:dm:{thread[:40]}",
                })
    return rows


def collect_captions(z, names):
    """His own post/archived-post captions — public self-expression."""
    rows = []
    targets = [x for x in names
               if x.endswith(".json")
               and ("/posts/" in x or "archived_posts" in x or "/stories" in x)]
    for p in targets:
        try:
            d = json.loads(z.read(p))
        except Exception:
            continue
        items = d if isinstance(d, list) else d.get("ig_archived_post_media", d.get("ig_stories", []))
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            cap = it.get("title") or ""
            for media in it.get("media", []) or []:
                if isinstance(media, dict) and media.get("title"):
                    cap = cap or media["title"]
            cap = fix_mojibake(cap).strip()
            if len(cap) < MIN_CHARS or _is_noise(cap):
                continue
            rows.append({"text": cap, "role": "instagram_caption",
                         "source": "instagram:caption"})
    return rows


def main(zip_path):
    z = zipfile.ZipFile(zip_path)
    names = z.namelist()
    msg_paths = [x for x in names if "/messages/inbox/" in x and x.endswith(".json")]
    print(f"Export: {zip_path}")
    print(f"  {len(msg_paths)} DM thread files")

    self_name = detect_self_name(z, msg_paths)
    # Windows consoles are cp1252; his display name is stylised unicode, so
    # printing it raw crashes. Show an ASCII-safe form.
    safe = fix_mojibake(self_name).encode("ascii", "replace").decode("ascii")
    print(f"  detected account owner: {safe}")

    rows = collect_messages(z, msg_paths, self_name)
    print(f"  his own DMs kept: {len(rows)} chunks")

    caps = collect_captions(z, names)
    print(f"  his captions kept: {len(caps)} chunks")
    rows.extend(caps)

    seen, uniq = set(), []
    for r in rows:
        if r["text"] in seen:
            continue
        seen.add(r["text"])
        uniq.append(r)
    print(f"  deduped -> {len(uniq)} unique")

    written = 0
    for i in range(0, len(uniq), 256):
        written += y.add_many(uniq[i:i + 256])
        print(f"   ...{written}/{len(uniq)}", end="\r")
    print(f"\n  DONE: {written} rows. Store total = {y._get_table().count_rows()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    main(sys.argv[1])

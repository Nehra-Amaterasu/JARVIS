"""Yaadash Taste — what he actually engages with, and how that changed (Step 7).

SOURCES (Instagram export, both accounts):
  liked_posts.json   ~20k likes WITH captions  -> broad taste
  saved_posts.json   ~750 saves with captions  -> deliberate taste (weighted 3x)

METHOD: TF-IDF over captions, then NMF topic modelling. NMF was chosen over
BERTopic because it runs on CPU in seconds, needs no extra install, and gives
directly readable word lists per topic. Each topic is then tracked per year, so
taste is reported as a trajectory ("rising", "faded") rather than a flat list —
which is the "who I was vs who I am" distinction I care about.

The local LLM names each topic from its top words. Those names are INFERENCES,
and they are written to the belief store as unconfirmed claims for him to confirm
or reject (Step 9), never as facts.

Output (gitignored): data/yaadash/taste_profile.json
"""
import glob
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

import hinglish
from ingest_instagram import fix_mojibake

HERE = os.path.dirname(os.path.abspath(__file__))
from home import YAADASH_DATA  # noqa: E402  data/yaadash, git-ignored
DATA = str(YAADASH_DATA)
N_TOPICS = 18
SAVE_WEIGHT = 3            # a save is a stronger signal than a like
RECENT_FROM_YEAR = 2025    # "now" vs "before" split for the trajectory

# Hinglish filler + Instagram boilerplate that would otherwise dominate topics.
_STOP = ENGLISH_STOP_WORDS | set("""hai hain ka ki ke ko se me mein aur bhi toh to ye
yeh wo woh kya nahi nhi na ho hua kar karo kiya tha thi the bhai yaar follow like
comment share save tag reel reels post video page account link bio dm insta
instagram credit credits via repost follow4follow viral trending explore fyp foryou
www http https com reelitfeelit explorepage instagood photooftheday""".split())


def _captions():
    """Yield (text, year, weight) for every liked/saved post caption."""
    for zp in glob.glob(os.path.join(os.path.expanduser("~"), "Downloads", "instagram-*.zip")):
        z = zipfile.ZipFile(zp)
        for n in z.namelist():
            if n.endswith("liked_posts.json"):
                w = 1
            elif n.endswith("saved_posts.json"):
                w = SAVE_WEIGHT
            else:
                continue
            items = json.loads(z.read(n))
            if isinstance(items, dict):
                items = next(iter(items.values()), [])
            for it in items:
                cap = ""
                for lv in it.get("label_values", []):
                    if lv.get("label") == "Caption" and lv.get("value"):
                        cap = lv["value"]
                if not cap:
                    continue
                cap = hinglish.romanize(fix_mojibake(cap)).lower()
                cap = re.sub(r"https?://\S+|@\w+", " ", cap).replace("#", " ")
                ts = it.get("timestamp") or 0
                yr = datetime.fromtimestamp(ts, tz=timezone.utc).year if ts else None
                yield cap, yr, w


def _name_topics(topics):
    """Ask the local LLM for a 2-4 word label per topic. Falls back to top words."""
    try:
        from langchain_ollama import ChatOllama
        llm = ChatOllama(model="qwen3:4b-instruct-2507-q4_K_M", temperature=0.1,
                         num_ctx=4096, keep_alive="30m", num_predict=300, repeat_penalty=1.1)
        lines = "\n".join(f"{i}: {', '.join(t['words'][:10])}" for i, t in enumerate(topics))
        prompt = ("Each line is a topic from Instagram posts someone liked, given as its "
                  "top keywords. Give each a short, plain 2-4 word label describing the "
                  "content (e.g. 'anime edits', 'gym motivation'). Reply ONLY as lines "
                  "'<number>: <label>', nothing else.\n\n" + lines)
        out = llm.invoke(prompt).content
        labels = {int(m.group(1)): m.group(2).strip()
                  for m in re.finditer(r"^\s*(\d+)\s*[:.-]\s*(.+)$", out, re.M)}
        for i, t in enumerate(topics):
            t["label"] = labels.get(i, ", ".join(t["words"][:3]))
    except Exception as e:
        print(f"  (topic naming via LLM skipped: {e})")
        for t in topics:
            t["label"] = ", ".join(t["words"][:3])
    return topics


def build():
    rows = list(_captions())
    texts = [r[0] for r in rows]
    years = np.array([r[1] or 0 for r in rows])
    weights = np.array([r[2] for r in rows], dtype=float)
    print(f"Captions: {len(texts)} (likes + saves, saves weighted {SAVE_WEIGHT}x)")

    vec = TfidfVectorizer(max_features=6000, ngram_range=(1, 2), min_df=8, max_df=0.4,
                          stop_words=list(_STOP), token_pattern=r"(?u)\b[a-z][a-z]{2,}\b")
    X = vec.fit_transform(texts)
    nmf = NMF(n_components=N_TOPICS, init="nndsvda", random_state=7, max_iter=400)
    W = nmf.fit_transform(X)                       # doc x topic
    vocab = np.array(vec.get_feature_names_out())

    Ww = W * weights[:, None]
    total = Ww.sum(0)
    recent = Ww[years >= RECENT_FROM_YEAR].sum(0)
    before = Ww[(years > 0) & (years < RECENT_FROM_YEAR)].sum(0)
    rshare = recent / max(recent.sum(), 1e-9)
    bshare = before / max(before.sum(), 1e-9)

    topics = []
    for k in range(N_TOPICS):
        words = vocab[np.argsort(nmf.components_[k])[::-1][:12]].tolist()
        by_year = defaultdict(float)
        for yr in sorted(set(years[years > 0])):
            by_year[int(yr)] = round(float(Ww[years == yr, k].sum()), 2)
        trend = rshare[k] / max(bshare[k], 1e-9)
        topics.append({
            "words": words,
            "share": round(float(total[k] / total.sum()), 4),
            "share_recent": round(float(rshare[k]), 4),
            "share_before": round(float(bshare[k]), 4),
            "trend": "rising" if trend > 1.4 else "faded" if trend < 0.6 else "steady",
            "by_year": dict(by_year),
        })
    topics.sort(key=lambda t: -t["share"])
    topics = _name_topics(topics)

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "taste_profile.json"), "w", encoding="utf-8") as f:
        json.dump({"built": datetime.now(timezone.utc).isoformat(),
                   "n_captions": len(texts), "recent_from": RECENT_FROM_YEAR,
                   "topics": topics}, f, ensure_ascii=False, indent=1)
    return topics


if __name__ == "__main__":
    topics = build()
    print(f"\nTASTE PROFILE — {N_TOPICS} topics (share of engagement; recent = {RECENT_FROM_YEAR}+)\n")
    for t in topics:
        print(f"  {t['share']:5.1%}  {t['trend']:7}  now {t['share_recent']:5.1%} / before "
              f"{t['share_before']:5.1%}  {t['label'][:28]:28} | {', '.join(t['words'][:6])}")

"""Yaadash People — who each thread is, and how close they actually are.

STEP 3: person resolution. Maps names said in conversation ("Rahul se baat karni
hai") onto archive threads, fuzzily, since spoken names, display names and
Instagram usernames rarely match exactly.

STEP 6: tie strength. My own rule, which I worked out before reading any research:
"Sending someone a lot of reels does not make them close. Being in contact with
someone for a long time does." That is the core finding of the tie-strength
literature (Granovetter 1973; Gilbert & Karahalios, CHI 2009), which weights
duration, reciprocity and intimacy above raw volume. Encoded here literally:
  - LONGEVITY carries the largest weight.
  - Volume is log-damped, so 5,000 messages is not 50x more "close" than 100.
  - Reel/post forwarding above half the conversation is a PENALTY, not a reward.
  - Calls and voice notes count as intimacy; they take effort that reels do not.

Every feature is converted to a percentile rank across all one-to-one threads
before weighting, so no single heavy thread distorts the scale. The score is
unsupervised and fully explainable: each person carries the factors that drove it.
If I later label ~20 people as close / not close, these same features
train a supervised model instead (see TIE_WEIGHTS).

Output: brain/yaadash_data/people.parquet (gitignored).
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
from rapidfuzz import fuzz

from hinglish import normalize_name

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "yaadash_data")
SESSION_GAP_S = 3 * 3600

# His own accounts messaging each other are not relationships. Without this the
# alt account ranked as a "friend" of the main one (92% reels, closeness #88).
SELF_NAMES = ("amritanshu nehra",)          # his own display name only; no nicknames

TIE_WEIGHTS = {
    "longevity": 0.25,      # span from first to last message — his primary rule
    "sustained": 0.20,      # share of weeks in that span with any contact
    "reciprocity": 0.15,    # balance between his messages and theirs
    "intimacy": 0.15,       # calls + call minutes + voice notes
    "depth": 0.10,          # real text messages, log-damped
    "recency": 0.10,        # still in touch, or faded?
    "mutual_start": 0.05,   # do BOTH sides start conversations?
}
SHARE_PENALTY_ABOVE = 0.5   # reels > half the thread starts costing closeness
SHARE_PENALTY_WEIGHT = 0.30

# Words that must never be read as a person's name in a query.
_STOP = set("""bhai bro yaar main mera meri mere mujhe tum tera teri tere uska uski
unka woh wo ye yeh hai hain tha thi the kya kab kaise kyu kyun kaun kisne kisse
baat baatein karni karna kiya kar bata batao yaad remember remind conversation chat
message messages last time with what when where who tell about and the that this
from have said told talk talked jarvis please also aur abhi kal aaj""".split())


def _load():
    msgs = pd.read_parquet(os.path.join(DATA, "archive_msgs.parquet"))
    threads = pd.read_parquet(os.path.join(DATA, "threads.parquet"))
    return msgs, threads


def _thread_features(g: pd.DataFrame, now: float) -> dict:
    g = g.sort_values("idx")
    real = g[g.kind != "system"]
    if real.empty:
        return {}
    first, last = real.ts.min(), real.ts.max()
    span_days = (last - first) / 86400
    weeks = pd.to_datetime(real.ts, unit="s").dt.to_period("W").nunique()
    span_weeks = max(span_days / 7, 1)
    n_me, n_them = int(real.is_me.sum()), int((~real.is_me).sum())
    texts = real[real.kind == "text"]

    # Conversation starts: first message after a silence of SESSION_GAP_S.
    gaps = real.ts.diff().fillna(np.inf) > SESSION_GAP_S
    starters = real[gaps]
    my_starts, their_starts = int(starters.is_me.sum()), int((~starters.is_me).sum())

    # His reply latency: time from one of their messages to his next one.
    lat = []
    prev_them_ts = None
    for r in real.itertuples():
        if not r.is_me:
            prev_them_ts = r.ts
        elif prev_them_ts is not None:
            d = r.ts - prev_them_ts
            if d < SESSION_GAP_S:
                lat.append(d / 60)
            prev_them_ts = None

    shares = int((real.kind == "share").sum())
    calls = int((real.kind == "call").sum())
    return {
        "first_iso": pd.to_datetime(first, unit="s").date().isoformat(),
        "last_iso": pd.to_datetime(last, unit="s").date().isoformat(),
        "span_days": round(span_days, 1),
        "active_weeks": int(weeks),
        "sustained_frac": round(min(weeks / span_weeks, 1.0), 3),
        "n_msgs": len(real),
        "n_me": n_me,
        "n_them": n_them,
        "n_text": len(texts),
        "reciprocity": round(min(n_me, n_them) / max(n_me, n_them, 1), 3),
        "share_ratio": round(shares / len(real), 3),
        "calls": calls,
        "call_min": round(float(real.call_min.sum()), 1),
        "voice_notes": int((real.kind == "voice_note").sum()),
        "recency_days": round((now - last) / 86400, 1),
        "my_starts": my_starts,
        "their_starts": their_starts,
        "mutual_start": round(min(my_starts, their_starts) / max(my_starts, their_starts, 1), 3),
        "median_reply_min": round(float(np.median(lat)), 1) if lat else None,
        "avg_text_chars": round(float(texts.chars.mean()), 1) if len(texts) else 0.0,
    }


def build():
    msgs, threads = _load()
    now = msgs.ts.max()            # measure recency against the export date
    rows = []
    for t in threads.itertuples():
        g = msgs[msgs.thread == t.thread]
        f = _thread_features(g, now)
        if not f:
            continue
        rows.append({"thread": t.thread,
                     "name": normalize_name(t.other_name or t.title) or t.slug,
                     "username": t.username, "is_group": t.is_group, **f})
    people = pd.DataFrame(rows)

    people["is_self"] = people.name.str.lower().apply(
        lambda n: any(fuzz.ratio(n, s) >= 90 for s in SELF_NAMES))
    # Closeness is about individuals; groups and self-threads keep stats, no score.
    solo = people[~people.is_group & ~people.is_self].copy()
    # Robust scaling, not percentile rank. The first version used rank(pct=True),
    # which flattened the top: 15 people landed in 86-95 with three-way ties, and
    # a 7-year friend with 44 calls ranked below a 1.2-year one, contradicting the
    # longevity rule. Dividing by the 97th percentile keeps real magnitude gaps
    # (7 years really is more than 3) while one outlier still cannot set the scale.
    def scale(x):
        hi = x.quantile(0.97)
        return (x / hi).clip(0, 1) if hi > 0 else x * 0
    comp = pd.DataFrame(index=solo.index)
    comp["longevity"] = scale(np.log1p(solo.span_days))
    comp["sustained"] = scale(solo.sustained_frac * np.log1p(solo.active_weeks))
    comp["reciprocity"] = solo.reciprocity.clip(0, 1)
    comp["intimacy"] = scale(np.log1p(solo.calls * 3 + solo.call_min + solo.voice_notes))
    comp["depth"] = scale(np.log1p(solo.n_text))
    comp["recency"] = np.exp(-solo.recency_days / 365)       # 1y silence -> 0.37
    comp["mutual_start"] = solo.mutual_start.clip(0, 1)

    raw = sum(comp[k] * w for k, w in TIE_WEIGHTS.items())
    penalty = (solo.share_ratio - SHARE_PENALTY_ABOVE).clip(lower=0) * SHARE_PENALTY_WEIGHT
    score = ((raw - penalty).clip(lower=0) * 100).round(1)
    solo["closeness"] = score
    solo["rank"] = solo.closeness.rank(ascending=False, method="min").astype(int)

    def explain(i):
        c = comp.loc[i]
        top = sorted(TIE_WEIGHTS, key=lambda k: c[k] * TIE_WEIGHTS[k], reverse=True)[:3]
        why = ", ".join(top)
        if penalty.loc[i] > 0:
            why += f"; penalised: {solo.share_ratio.loc[i]:.0%} reels/posts"
        return why

    solo["why"] = [explain(i) for i in solo.index]
    people = people.merge(solo[["thread", "closeness", "rank", "why"]], on="thread", how="left")
    people = people.sort_values("closeness", ascending=False, na_position="last")
    os.makedirs(DATA, exist_ok=True)
    people.to_parquet(os.path.join(DATA, "people.parquet"), index=False)
    return people


# ----------------------------------------------------------------- runtime API
_people = None


def people():
    global _people
    if _people is None:
        p = os.path.join(DATA, "people.parquet")
        _people = pd.read_parquet(p) if os.path.exists(p) else pd.DataFrame()
    return _people


def resolve_person(text: str, min_score: int = 86, limit: int = 3):
    """Find threads whose person is named in `text`. Returns [(row, score), ...]."""
    p = people()
    if p.empty or not text:
        return []
    tokens = [t for t in re.findall(r"[a-zA-Z]{3,}", text.lower()) if t not in _STOP]
    if not tokens:
        return []
    hits = []
    for r in p.itertuples():
        # Match FIRST + LAST name and the thread alias only. People are referred to
        # by first name; the 3rd+ words of styled display names are usually
        # decoration. Matching every word let the topic word "anime" resolve to an
        # art account whose 4-word display name contained "Anime", which then hijacked a
        # search about a completely different conversation (2026-10-09).
        if r.is_self or (r.n_text or 0) < 2:
            continue                       # self-threads and one-off shares
        words = re.findall(r"[a-zA-Z]{3,}", (r.name or "").lower())[:2]
        names = words + [w for w in re.findall(r"[a-zA-Z]{3,}", (r.username or "").lower())][:1]
        if not names:
            continue
        best = max(fuzz.ratio(t, n) for t in tokens for n in names)
        if best >= min_score:
            hits.append((r, best))
    # Same score: prefer the closer person (the one more likely meant).
    hits.sort(key=lambda h: (h[1], h[0].closeness if pd.notna(h[0].closeness) else -1),
              reverse=True)
    return hits[:limit]


def person_card(r) -> str:
    years = r.span_days / 365
    bits = [f"{r.name}"]
    if pd.notna(r.closeness):
        bits.append(f"closeness {r.closeness:.0f}/100 (#{int(r.rank)})")
    bits.append(f"in touch {r.first_iso} to {r.last_iso} (~{years:.1f} yrs)")
    bits.append(f"{r.n_msgs} messages ({r.n_me} his, {r.n_them} theirs)")
    if r.calls:
        bits.append(f"{r.calls} calls / {r.call_min:.0f} min")
    if r.share_ratio > 0.25:
        bits.append(f"{r.share_ratio:.0%} of it reels/posts")
    return "; ".join(bits)


if __name__ == "__main__" and "--validate" not in sys.argv:
    p = build()
    solo = p[p.closeness.notna()]
    print(f"People: {len(p)} threads ({len(solo)} one-to-one, scored)\n")
    print("TOP 15 BY CLOSENESS (his longevity rule, reels penalised):")
    for r in solo.head(15).itertuples():
        print(f"  #{int(r.rank):<3} {r.closeness:5.1f}  {r.name[:22]:22} "
              f"{r.span_days/365:4.1f}y  {r.n_msgs:6d} msgs  "
              f"reels {r.share_ratio:4.0%}  calls {r.calls:3d}  | {r.why}")
    # One-off shares to brand accounts are trivially 100% reels; test the
    # hypothesis on real relationships only.
    heavy = solo[solo.n_msgs >= 200].sort_values("share_ratio", ascending=False).head(6)
    print("\nMOST REEL-HEAVY THREADS (his hypothesis: volume of reels != closeness):")
    for r in heavy.itertuples():
        print(f"  {r.name[:22]:22} reels {r.share_ratio:4.0%}  {r.n_msgs:6d} msgs  "
              f"-> closeness {r.closeness:5.1f} (#{int(r.rank)})")


# ------------------------------------------------------------- validation
def _close_friends_labels():
    """Names on my Instagram Close Friends list (both accounts)."""
    import glob
    import json
    import zipfile
    from ingest_instagram import fix_mojibake
    names = set()
    for zp in glob.glob(os.path.join(os.path.expanduser("~"), "Downloads", "instagram-*.zip")):
        z = zipfile.ZipFile(zp)
        for n in z.namelist():
            if n.endswith("close_friends.json"):
                for item in json.loads(z.read(n)):
                    for lv in item.get("label_values", []):
                        if lv.get("label") == "Name" and lv.get("value"):
                            nm = normalize_name(fix_mojibake(lv["value"])).lower()
                            if nm:
                                names.add(nm)
    return names


def validate():
    """Score the closeness model against my Close Friends list.

    Close Friends is a story-sharing list, so it is a PROXY for closeness, not
    ground truth — some close people are left off it, some acquaintances are on
    it. It is still the only labelled data available, and it tests his core
    hypothesis directly: does a longevity-weighted score predict who he keeps
    close better than raw message volume does?
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import cross_val_predict

    cf = _close_friends_labels()
    p = people()
    solo = p[p.closeness.notna()].copy()

    def is_cf(n):
        n = (n or "").lower()
        return n in cf or any(fuzz.ratio(n, c) >= 92 for c in cf)

    solo["cf"] = solo.name.apply(is_cf).astype(int)
    pos = int(solo.cf.sum())
    print(f"Close Friends list: {len(cf)} names | matched to a DM thread: {pos} "
          f"of {len(solo)} people")
    if pos < 5:
        print("Too few matches to evaluate.")
        return

    def prec_at(col, k):
        return solo.sort_values(col, ascending=False).head(k).cf.mean()

    print("\nHOW WELL EACH SIGNAL PREDICTS HIS CLOSE FRIENDS (ROC AUC, 0.5 = chance):")
    for col, label in [("closeness", "closeness model (his longevity rule)"),
                       ("n_msgs", "raw message volume"),
                       ("span_days", "longevity alone"),
                       ("share_ratio", "reel/post share ratio")]:
        auc = roc_auc_score(solo.cf, solo[col].fillna(0))
        print(f"  {label:40} AUC {auc:.3f} | precision@20 {prec_at(col, 20):.0%} "
              f"| @50 {prec_at(col, 50):.0%}")

    # Supervised: learn weights from his labels (5-fold, so scores are out-of-sample).
    feats = ["span_days", "sustained_frac", "active_weeks", "reciprocity", "n_text",
             "calls", "call_min", "voice_notes", "recency_days", "mutual_start",
             "share_ratio"]
    X = np.log1p(solo[feats].fillna(0).clip(lower=0))
    model = LogisticRegression(max_iter=2000, class_weight="balanced")
    proba = cross_val_predict(model, X, solo.cf, cv=5, method="predict_proba")[:, 1]
    solo["learned"] = proba
    print(f"  {'learned from his labels (5-fold CV)':40} AUC "
          f"{roc_auc_score(solo.cf, proba):.3f} | precision@20 {prec_at('learned', 20):.0%} "
          f"| @50 {prec_at('learned', 50):.0%}")
    model.fit(X, solo.cf)
    print("\nWHAT HIS LABELS SAY MATTERS (logistic coefficients, + = closer):")
    for f, c in sorted(zip(feats, model.coef_[0]), key=lambda t: -abs(t[1])):
        print(f"  {f:16} {c:+.2f}")


if __name__ == "__main__" and "--validate" in sys.argv:
    validate()

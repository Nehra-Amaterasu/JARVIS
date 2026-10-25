"""Yaadash Recall — find a specific past conversation (Steps 4 + 5).

THE PROBLEM IT SOLVES
"Remind me of that joke I made about a friend in class 12." Pure vector search is
bad at this: a joke hinges on rare exact tokens ("doctor strange", a nickname),
and embeddings blur rare tokens into general topic. Keyword search (BM25) is the
opposite — precise on rare words, blind to paraphrase. So both run, and their
rankings are merged with Reciprocal Rank Fusion (RRF), which needs no score
calibration between the two systems: each contributes 1/(K + rank).

Then results are rebuilt as REAL EXCERPTS — the surrounding messages from both
sides, with a date — because a punchline without its setup is useless.

Filters applied before ranking when the question carries them:
  - person: a name in the query is resolved to threads (yaadash_people)
  - year:   an explicit 4-digit year in the query

Index files live in data/yaadash/ (gitignored).
"""
import os
import pickle
import re
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
from rank_bm25 import BM25Okapi

import yaadash_people as yp
import yaadash_v2 as y
from hinglish import normalize_name

HERE = os.path.dirname(os.path.abspath(__file__))
from home import YAADASH_DATA  # noqa: E402  data/yaadash, git-ignored
DATA = str(YAADASH_DATA)
BM25_CACHE = os.path.join(DATA, "bm25.pkl")
WINDOWS_TABLE = "archive_windows"

RRF_K = 60            # standard RRF constant; dampens the head of each ranking
CLUSTER_RADIUS = 8    # hits this close in one thread are the same moment
# Relevance gate. Measured 2026-10-09 (cosine distance of the best window):
#   real memories:   0.254 (kiss anime), 0.263 (a call), 0.304 (One Piece)
#   forced matches:  0.307 (pizza topping), 0.331 (Doctor Strange joke),
#                    0.343 (a "fight" with a friend, which returned a
#                           conversation about a family bereavement)
# The groups OVERLAP (0.304 vs 0.307), so no threshold separates them cleanly.
# The gate removes only the clear misses; the ambiguous band is handed to the
# model with an explicit instruction to say "not found" rather than stretch an
# excerpt to fit. Without any gate, recall always returns *something*.
RECALL_MAX_DISTANCE = 0.32
# Lexical rescue (2026-10-23). The gate above reads only the vector distance, and on
# the real archive (14 Oct probes) it threw away good keyword hits: three of seven
# misses had the answer at BM25 rank 1-2 with the best window at 0.32-0.41. BM25 alone
# is no gate either: its length normalisation puts one-word messages ("BEARD", "Dv")
# first. What separates them is COVERAGE: the answer holds most of the question's
# rare words. A BM25 hit passes when it holds >= 2 distinct query terms carrying
# >= 70 % of the query's IDF mass, and the best window is not far off topic.
# Measured on the real archive: answers 0.73-1.00; the nearest unanswerable ("what did
# we fight about last week?" matching "last week") 0.63. The margin is thin, so the
# rescue only lets in a few BM25 hits; it never relaxes the vector gate itself.
RESCUE_MIN_TERMS = 2
RESCUE_MIN_IDF_SHARE = 0.70
RESCUE_MAX_DISTANCE = 0.45
RESCUE_SCAN = 15      # BM25 hits looked at for coverage
# Substring agent.py looks for to know recall came back empty. Kept as a constant
# so the two files cannot drift apart silently.
RECALL_NOT_FOUND = "nothing matching was found in his Instagram"
EXCERPT_BEFORE = 6    # messages of setup shown before the anchor
EXCERPT_AFTER = 7     # messages of follow-up shown after it

_TOKEN = re.compile(r"[a-z0-9]{2,}")

# Phrases that mean "tell me about a past conversation" (English + Hinglish).
_EPISODIC = re.compile(
    r"\b(yaad|remember|remind|recall|bhool|baat hui|baat ki thi|kya bola|kya kaha|"
    r"bataya tha|bola tha|kaha tha|conversation|chat|told|said|talked|last time|"
    r"us din|kab (?:baat|bola|kaha)|joke|fight|ladai|jhagda|argument|that time|"
    r"when did|did i (?:say|tell)|what did (?:i|he|she|we))\b"
    # Hinglish marks past-event questions with "kab ... tha/thi/the" or
    # "kabhi / pichli baar / pehle". "maine kab one piece complete kiya tha?" has no
    # memory keyword at all, so without these recall never ran for it.
    r"|\bkab\b.*\b(?:tha|thi|the)\b|\bkabhi\b|\bpichl[ie]\b|\bpehle kab\b"
    r"|\b(?:have|did) i ever\b",
    re.I)

_msgs = None
_bm25 = None
_bm25_rows = None


def _stem(w: str) -> str:
    """Light English suffix stripping so "complete" finds "completed".

    BM25 matches whole tokens, and on 2026-10-09 "kab one piece complete kiya?"
    missed his actual message "Btw i completed one piece". A full stemmer (Porter)
    would mangle Hinglish words, so only a few unambiguous English suffixes are
    stripped, and only from longer tokens where they are almost always suffixes.
    """
    if len(w) > 5:
        for suf in ("ing", "ed", "es"):
            if w.endswith(suf):
                w = w[: -len(suf)]
                break
        else:
            if w.endswith("s") and not w.endswith("ss"):
                w = w[:-1]
    # Drop a final "e" too, or "complete" -> "complete" never meets
    # "completed" -> "complet". Stemming must be symmetric to be useful; the first
    # version was not, and the target message tied with "Kab kiya" at 15.1.
    if len(w) > 5 and w.endswith("e"):
        w = w[:-1]
    return w


def _tok(text: str):
    return [_stem(t) for t in _TOKEN.findall((text or "").lower())]


def _load_msgs():
    global _msgs
    if _msgs is None:
        _msgs = pd.read_parquet(os.path.join(DATA, "archive_msgs.parquet"))
    return _msgs


def _load_bm25():
    """BM25 over every text message. Built once, cached to disk.

    The pickle is a private cache written only by this function into the local,
    gitignored yaadash_data/ directory, and it is rebuilt whenever the source
    parquet is newer. It never comes from an external source, so loading it does
    not cross a trust boundary. (If this cache were ever shared or downloaded,
    switch to rebuilding from the parquet instead — rank_bm25 has no safe format.)
    """
    global _bm25, _bm25_rows
    if _bm25 is not None:
        return _bm25, _bm25_rows
    src = os.path.join(DATA, "archive_msgs.parquet")
    if os.path.exists(BM25_CACHE) and os.path.getmtime(BM25_CACHE) > os.path.getmtime(src):
        with open(BM25_CACHE, "rb") as f:
            _bm25, _bm25_rows = pickle.load(f)
        return _bm25, _bm25_rows
    m = _load_msgs()
    texts = m[(m.kind == "text") & (m.chars > 0)]
    _bm25_rows = texts[["thread", "idx", "is_me"]].to_numpy()
    _bm25 = BM25Okapi([_tok(t) for t in texts.text.tolist()])
    with open(BM25_CACHE, "wb") as f:
        pickle.dump((_bm25, _bm25_rows), f)
    return _bm25, _bm25_rows


def _windows_table():
    y._get_table()                       # ensures y._db is connected
    if WINDOWS_TABLE not in y._db.table_names():
        return None
    return y._db.open_table(WINDOWS_TABLE)


def is_episodic(query: str) -> bool:
    return bool(_EPISODIC.search(query or ""))


# Filler that carries no search signal. Dropped from QUERIES only — the corpus
# keeps them so IDF stays honest. Without this, "maine kab ... kiya tha?" ranked
# the message "Kab kiya" as highly as the actual answer.
_QUERY_STOP = set("""maine mene main mai mera meri mere mujhe hum humne tum tune
tera teri tere uska uski unka kab kya kyu kyun kaise kaun kahan kiya kiye ki ka ke
ko se me mein tha thi the hai hain ho hua hui aur ya bhi toh to ye yeh wo woh bhai
yaar bro yaad remember remind recall told said talk talked about when what did does
the and was were with for that this you your have has had baat bola kaha bataya
""".split())


# "maine kab ... kiya?" / "when did I ..." asks about HIS OWN messages. Without a
# boost, "when did I complete One Piece?" returned a friend saying "One piece
# completed in 4 months bro" — right topic, wrong person.
_FIRST_PERSON = re.compile(r"\b(maine|mene|mai ne|main ne|did i|have i|i (?:said|told|did|was|used)|my|mera|meri|mujhe)\b", re.I)
FIRST_PERSON_BOOST = 1.6


def _bm25_hits(query, threads=None, years=None, n=40):
    bm, rows = _load_bm25()
    q = [t for t in _tok(query) if t not in _QUERY_STOP] or _tok(query)
    if not q:
        return []
    scores = bm.get_scores(q)
    if _FIRST_PERSON.search(query):
        scores = np.where(rows[:, 2].astype(bool), scores * FIRST_PERSON_BOOST, scores)
    if threads is not None:
        mask = np.isin(rows[:, 0], list(threads))
        scores = np.where(mask, scores, 0.0)
    top = np.argsort(scores)[::-1][: n * 3]
    out = []
    for i in top:
        if scores[i] <= 0:
            break
        out.append((rows[i][0], int(rows[i][1])))
    if years:      # year filter after ranking: cheap, since out is small
        msgs = _load_msgs()
        yr = msgs.set_index(["thread", "idx"]).ts
        out = [h for h in out
               if pd.to_datetime(yr.loc[h], unit="s").year in years]
    return out[:n]


# Short English words the Hinglish stop list above does not hold; they are not search
# terms for the coverage check (BM25 itself still sees them).
_COVER_STOP = set("in on at of is it an to do so we me my he be or if no up go us am as by".split())
_texts_for = None     # (the _msgs frame it was built from, {(thread, idx): text})


def _text_of(hit) -> str:
    global _texts_for
    m = _load_msgs()
    if _texts_for is None or _texts_for[0] is not m:
        t = m[m.kind == "text"]
        _texts_for = (m, dict(zip(zip(t.thread, t.idx), t.text)))
    return str(_texts_for[1].get((hit[0], int(hit[1])), "") or "")


def coverage(query: str, text: str) -> tuple:
    """(distinct query terms in `text`, their share of the query's IDF mass)."""
    bm, _ = _load_bm25()
    idf = getattr(bm, "idf", {}) or {}
    top = max(idf.values(), default=1.0)
    terms = {t for t in _tok(query) if t not in _QUERY_STOP and t not in _COVER_STOP}
    if not terms:
        return 0, 0.0
    weight = {t: idf.get(t, top) for t in terms}     # a word the archive never saw is maximally specific
    have = set(_tok(text))
    got = [t for t in terms if t in have]
    return len(got), sum(weight[t] for t in got) / (sum(weight.values()) or 1.0)


def strong_lexical(query: str, bm: list) -> list:
    """BM25 hits that hold most of the question's rare words, best coverage first."""
    out = []
    for rank, h in enumerate(bm[:RESCUE_SCAN]):
        n, share = coverage(query, _text_of(h))
        if n >= RESCUE_MIN_TERMS and share >= RESCUE_MIN_IDF_SHARE:
            out.append((-share, -n, rank, h))
    return [h for *_, h in sorted(out)]


def _vector_hits(query, threads=None, years=None, n=30):
    tbl = _windows_table()
    if tbl is None:
        return []
    qv = y.embed(query, is_query=True)[0].tolist()
    conds = []
    if threads:
        quoted = ",".join("'" + t.replace("'", "''") + "'" for t in threads)
        conds.append(f"thread IN ({quoted})")
    if years:
        conds.append(f"year IN ({','.join(str(v) for v in years)})")
    q = tbl.search(qv).metric("cosine")
    if conds:
        q = q.where(" AND ".join(conds), prefilter=True)
    res = q.limit(n).to_list()
    _vector_hits.best_distance = min((r["_distance"] for r in res), default=1.0)
    return [(r["thread"], (r["start_idx"] + r["end_idx"]) // 2) for r in res]


def _fuse(*rankings):
    """Cluster hits into moments, then Reciprocal Rank Fusion across systems.

    Each system contributes ONE term per moment: 1/(K + its best rank there).
    The first version summed every hit inside a cluster, which rewarded topical
    DENSITY over precision — a thread where One Piece came up constantly piled up
    dozens of loose hits and beat the single message that actually answered "when
    did I complete One Piece?". Agreement between BM25 and vectors should raise a
    moment's score; repetition within one system should not.
    """
    clusters = []    # [thread, center_idx, {system: best_rank}]
    for sysid, ranking in enumerate(rankings):
        for rank, (thread, idx) in enumerate(ranking):
            for c in clusters:
                if c[0] == thread and abs(c[1] - idx) <= CLUSTER_RADIUS:
                    c[2][sysid] = min(c[2].get(sysid, rank), rank)
                    break
            else:
                clusters.append([thread, idx, {sysid: rank}])
    scored = [(t, i, sum(1.0 / (RRF_K + r + 1) for r in ranks.values()))
              for t, i, ranks in clusters]
    return sorted(scored, key=lambda c: -c[2])


def _excerpt(thread, idx):
    m = _load_msgs()
    g = m[(m.thread == thread) & (m.kind != "system")]
    g = g[(g.idx >= idx - EXCERPT_BEFORE) & (g.idx <= idx + EXCERPT_AFTER)].sort_values("idx")
    if g.empty:
        return None
    # Only the anchor's own conversation, dated by the anchor. Until 2026-10-12 the
    # setup/follow-up span crossed session gaps and the header took the date of the
    # first line shown: a March 2021 trek plan came back as "[01 Jun 2020 ...]" and a
    # 2021 chat ended with a 2023 reply (found by yaadash/tests on synthetic chats).
    # For "kab baat hui thi?" the date IS the answer. Sessions split like the
    # archive's windows do, on a silence longer than SESSION_GAP_S.
    anchor = g.index[(g.idx - idx).abs().argmin()]
    session = (g.ts.diff().fillna(0) > yp.SESSION_GAP_S).cumsum()
    g = g[session == session.loc[anchor]]
    people = yp.people()
    row = people[people.thread == thread]
    who = row.name.iloc[0] if len(row) else "them"
    date = pd.to_datetime(g.ts.loc[anchor], unit="s").strftime("%d %b %Y")
    lines = []
    for r in g.itertuples():
        # My lines are labelled "Aman", never "Me". With "Me:", JARVIS read
        # "Me: I completed one piece" as its OWN memory and improvised a story in
        # the first person ("maine ek bar dekha tha...") — tested 2026-10-09.
        speaker = "Aman" if r.is_me else (normalize_name(r.sender).split(" ")[0] or who)
        lines.append(f"{speaker}: {r.text}")
    return f"[{date} - chat with {who}]\n" + "\n".join(lines)


def recall(query: str, k: int = 3, verbose: bool = False):
    """Return up to k dated conversation excerpts relevant to `query`."""
    t0 = time.time()
    persons = yp.resolve_person(query)
    threads = {p.thread for p, _ in persons} or None
    years = {int(v) for v in re.findall(r"\b(20[12]\d)\b", query)} or None

    bm = _bm25_hits(query, threads, years)
    vec = _vector_hits(query, threads, years)
    clusters = _fuse(bm, vec)
    # A person match is a preference, not a cage. If restricting to that person's
    # threads finds nothing, the name match was probably wrong — search everything.
    if threads and not clusters:
        threads = None
        bm = _bm25_hits(query, None, years)
        vec = _vector_hits(query, None, years)
        clusters = _fuse(bm, vec)

    best = getattr(_vector_hits, "best_distance", 1.0)
    try:
        strong = strong_lexical(query, bm) if bm else []
    except Exception:                    # no BM25 index: the vector gate alone, as before
        strong = []
    if best > RECALL_MAX_DISTANCE:
        if strong and best <= RESCUE_MAX_DISTANCE:
            # The vectors found nothing close, but BM25 found the question's own rare
            # words in his messages: those messages, and only those, come back.
            if verbose:
                print(f"  [recall: best match d={best:.3f} > {RECALL_MAX_DISTANCE}; lexical rescue "
                      f"{len(strong)} hit(s)]")
            return [ex for ex in (_excerpt(t, i) for t, i in strong[:k]) if ex]
        if verbose:
            print(f"  [recall: best match d={best:.3f} > {RECALL_MAX_DISTANCE} -> nothing found]")
        return []

    # Lexical guarantee: BM25's single best hit always makes the cut, first.
    # RRF favours moments BOTH systems agree on, but a precise answer is often one
    # line inside a window about something else ("Btw i completed one piece" at
    # the end of a chat about anime recommendations). Vectors cannot see that line;
    # only BM25 can — so fusion alone kept ranking it below topical matches.
    # "Best" is the best-covering hit when one holds most of the question's rare words:
    # BM25's own first is often a one-word message ("Not nether wart" over the answer).
    if bm:
        bt, bi = strong[0] if strong else bm[0]
        lead = [c for c in clusters if c[0] == bt and abs(c[1] - bi) <= CLUSTER_RADIUS]
        rest = [c for c in clusters if c not in lead]
        clusters = [(bt, bi, 0.0)] + rest

    out = []
    for thread, idx, _ in clusters[:k]:
        ex = _excerpt(thread, idx)
        if ex:
            out.append(ex)
    if verbose:
        names = [p.name for p, _ in persons]
        print(f"  [recall {time.time()-t0:.2f}s | persons={names} years={years} "
              f"| bm25={len(bm)} vec={len(vec)} clusters={len(clusters)}]")
    return out


def recall_context(query: str) -> str:
    """Prompt block for agent.py. Empty unless the query is about the past or a person."""
    persons = yp.resolve_person(query)
    if not (is_episodic(query) or persons):
        return ""
    block = ""
    if persons:
        block += "PEOPLE MENTIONED (from his message history):\n"
        for p, _ in persons:
            block += f"- {yp.person_card(p)}\n"
        if len(persons) > 1:
            block += ("  (Several threads match this name — they may be different "
                      "people. Ask which one if it matters.)\n")
    if is_episodic(query):
        ex = recall(query, k=2)
        if ex:
            block += ("\nPAST CONVERSATIONS (real excerpts from his chats, dated. These are "
                      "the CLOSEST matches found — they may not be the moment he means.\n"
                      "If none of them actually answers his question, say plainly that you "
                      "could not find it. NEVER stretch an excerpt to fit, and never invent "
                      "what happened. They show who he WAS at that date, not now):\n")
            block += "\n\n".join(ex) + "\n"
        else:
            block += ("\nPAST CONVERSATIONS: nothing matching was found in his Instagram "
                      "archive (it is thin before 2023, and WhatsApp is not in it). Say so "
                      "honestly — do not guess or invent a memory.\n")
    return block


if __name__ == "__main__":
    t0 = time.time()
    _load_bm25()
    print(f"BM25 ready in {time.time()-t0:.1f}s")
    for q in sys.argv[1:] or ["yaad hai one piece ke baare mein kya baat hui thi?"]:
        print(f"\nQ: {q}")
        for ex in recall(q, k=2, verbose=True):
            print(ex, "\n")

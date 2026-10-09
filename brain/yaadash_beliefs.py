"""Yaadash Beliefs — distillation (Step 8) and active learning (Step 9).

This is the growth loop:

   his messages ──distil──▶ CLAIMS (confidence, era, evidence)
   taste profile ─────────▶     │  near-duplicate claims merge, and every extra
   closest people ────────▶     │  supporting message RAISES confidence
                                ▼
                     JARVIS asks about the most uncertain,
                     most important claims ("is this still true?")
                                │
               yes ─▶ CONFIRMED  → becomes a fact JARVIS states plainly
               no  ─▶ REJECTED   → never surfaced again
               used to ▶ OUTDATED → kept as "who he was", never stated as now

DESIGN RULES (each learned the hard way earlier in this project):
- A claim is a HYPOTHESIS until he confirms it. Unconfirmed claims reach the model
  labelled as such and must be hedged — the Instagram-DM incident showed what
  happens when unlabelled evidence is treated as biography.
- Every claim keeps its evidence and era, so "who he was in 2021" is never
  presented as "who he is".
- Only HIS messages are distilled. Friends' words are context in recall, never
  claims about him.

Store: LanceDB table "beliefs" (gitignored). Confirmed beliefs are also written to
the main memories table as `authored:confirmed`, so they flow into the existing
CONFIRMED FACTS channel with no other changes.

CLI:
    python yaadash_beliefs.py seed            # from taste profile + closest people
    python yaadash_beliefs.py distill [N]     # LLM-extract claims from N messages
    python yaadash_beliefs.py review          # answer JARVIS's questions (y/n/o/e/s)
    python yaadash_beliefs.py stats
"""
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import pandas as pd
import pyarrow as pa

import yaadash_v2 as y

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "yaadash_data")
TABLE = "beliefs"
MERGE_DISTANCE = 0.12        # cosine distance under which two claims are "the same"
CONFIDENCE_STEP = 0.08       # each extra supporting message adds this much
HYPOTHESIS_MIN_CONF = 0.6    # unconfirmed claims below this never reach the model
HYPOTHESIS_MAX_DIST = 0.30   # and must be genuinely relevant to the question

# How much it matters to know a claim correctly. Questions about values and goals
# shape advice; a wrong guess about meme taste costs little.
CATEGORY_WEIGHT = {"value": 1.0, "goal": 1.0, "relationship": 0.9, "belief": 0.9,
                   "habit": 0.7, "preference": 0.6, "taste": 0.5, "event": 0.5}

_SCHEMA = pa.schema([
    pa.field("id", pa.string()), pa.field("claim", pa.string()),
    pa.field("category", pa.string()), pa.field("era", pa.string()),
    pa.field("confidence", pa.float64()), pa.field("status", pa.string()),
    pa.field("support", pa.int64()), pa.field("evidence", pa.string()),
    pa.field("source", pa.string()), pa.field("updated", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 384)),
])


def _now():
    return datetime.now(timezone.utc).isoformat()


def _table():
    y._get_table()
    if TABLE not in y._db.table_names():
        return y._db.create_table(TABLE, schema=_SCHEMA)
    return y._db.open_table(TABLE)


def _esc(s: str) -> str:
    return s.replace("'", "''")


# ------------------------------------------------------------------ add / merge
def add_claim(claim, category, era, confidence, evidence, source):
    """Insert a claim, or merge it into an existing near-duplicate.

    Merging is the growth mechanism: a claim supported by five separate messages
    ends up far more confident than one inferred from a single line.
    """
    claim = " ".join((claim or "").split())
    if len(claim) < 12:
        return None
    tbl = _table()
    vec = y.embed(claim)[0].tolist()
    if tbl.count_rows():
        near = tbl.search(vec).metric("cosine").limit(1).to_list()
        if near and near[0]["_distance"] <= MERGE_DISTANCE:
            b = near[0]
            if b["status"] in ("rejected", "confirmed"):
                return b["id"]          # his verdict stands; evidence can't overrule it
            ev = json.loads(b["evidence"] or "[]")
            ev = (ev + [evidence])[-12:]
            tbl.update(where=f"id = '{_esc(b['id'])}'", values={
                "confidence": min(0.97, b["confidence"] + CONFIDENCE_STEP),
                "support": b["support"] + 1,
                "evidence": json.dumps(ev, ensure_ascii=False),
                "updated": _now(),
            })
            return b["id"]
    bid = uuid.uuid4().hex[:12]
    tbl.add([{
        "id": bid, "claim": claim, "category": category or "preference",
        "era": era or "unknown", "confidence": float(max(0.05, min(0.9, confidence))),
        "status": "unconfirmed", "support": 1,
        "evidence": json.dumps([evidence], ensure_ascii=False),
        "source": source, "updated": _now(), "vector": vec,
    }])
    return bid


# ---------------------------------------------------------------------- seeding
def seed():
    """Claims from the taste profile and the closeness model — no LLM needed."""
    n = 0
    tp = os.path.join(DATA, "taste_profile.json")
    if os.path.exists(tp):
        prof = json.load(open(tp, encoding="utf-8"))
        for t in prof["topics"][:12]:
            if t["share"] < 0.03:
                continue
            when = {"rising": "more and more lately", "faded": "a lot in the past, less now",
                    "steady": "consistently"}[t["trend"]]
            era = "current" if t["trend"] != "faded" else f"before {prof['recent_from']}"
            claim = f"He engages with {t['label']} content on Instagram {when}."
            conf = 0.45 + min(t["share"] * 3, 0.35)
            add_claim(claim, "taste", era, conf,
                      f"taste:{', '.join(t['words'][:5])} ({t['share']:.0%})", "taste")
            n += 1
    import yaadash_people as yp
    p = yp.people()
    if not p.empty:
        for r in p[p.closeness.notna()].head(10).itertuples():
            claim = (f"{r.name} is one of his closest people "
                     f"(in touch {r.span_days/365:.1f} years).")
            add_claim(claim, "relationship", "current" if r.recency_days < 120 else "past",
                      0.55 + (r.closeness - 80) / 100, f"people:{r.thread}", "people")
            n += 1
    print(f"Seeded {n} claims from taste profile + closeness model.")


# ------------------------------------------------------------------- distillation
_DISTIL_PROMPT = """You are reading real Instagram messages written by Aman (Amritanshu Nehra, an Indian ECE student). They are in Hinglish.
Extract DURABLE facts about Aman himself: his preferences, values, beliefs, goals, habits, and relationships.

Rules:
- Only what he states or clearly implies about HIMSELF. Ignore jokes, sarcasm, song lyrics, forwarded text, and what other people are like.
- Skip anything trivial or momentary ("I am eating", "I'm bored", "ok").
- Write each claim in English, third person, starting with "He", one fact per claim.
- confidence: 0.3 = weakly implied, 0.6 = clearly stated once, 0.8 = stated emphatically.
- If there is nothing durable, return an empty list.

Reply with ONLY a JSON list, e.g.
[{{"claim": "He prefers watching anime alone at night.", "category": "habit", "confidence": 0.6}}]
category must be one of: preference, value, belief, goal, habit, relationship, taste, event.

Messages (each dated):
{msgs}"""


def _distil_batch(llm, batch):
    msgs = "\n".join(f"[{d}] {t}" for d, t in batch)
    out = llm.invoke(_DISTIL_PROMPT.format(msgs=msgs)).content
    m = re.search(r"\[.*\]", out, re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return [i for i in items if isinstance(i, dict) and i.get("claim")]


def distill(limit=400, batch_size=8):
    """Extract claims from his most substantive messages, newest first."""
    from langchain_ollama import ChatOllama
    llm = ChatOllama(model="qwen3:4b-instruct-2507-q4_K_M", temperature=0.1,
                     num_ctx=8192, keep_alive="30m", num_predict=700, repeat_penalty=1.1)
    m = pd.read_parquet(os.path.join(DATA, "archive_msgs.parquet"))
    mine = m[(m.is_me) & (m.kind == "text") & (m.chars >= 90)]
    mine = mine.drop_duplicates("text").sort_values("ts", ascending=False).head(limit)
    mine = mine.sort_values("ts")
    rows = [(pd.to_datetime(r.ts, unit="s").strftime("%Y-%m"), r.text[:400], r.thread, r.idx)
            for r in mine.itertuples()]
    print(f"Distilling {len(rows)} of his messages (>=90 chars) in batches of {batch_size}...")
    t0, added = time.time(), 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        era = batch[0][0][:4]
        try:
            items = _distil_batch(llm, [(d, t) for d, t, _, _ in batch])
        except Exception as e:
            print(f"   batch {i//batch_size}: {e}")
            continue
        for it in items:
            ref = f"msg:{batch[0][2]}#{batch[0][3]}..{batch[-1][3]} ({era})"
            if add_claim(it["claim"], it.get("category"), era,
                         float(it.get("confidence", 0.5)), ref, "distill"):
                added += 1
        if (i // batch_size) % 5 == 0:
            done = min(i + batch_size, len(rows))
            print(f"   {done}/{len(rows)} msgs | {added} claims | "
                  f"{(time.time()-t0)/max(done,1):.2f}s/msg", flush=True)
    print(f"Distilled {added} claims in {time.time()-t0:.0f}s.")


# ---------------------------------------------------------------- active learning
def next_questions(n=5):
    """Claims worth asking about: high uncertainty x high importance x support."""
    tbl = _table()
    if not tbl.count_rows():
        return []
    df = tbl.to_pandas()
    df = df[df.status == "unconfirmed"].copy()
    if df.empty:
        return []
    uncertainty = 1 - (2 * df.confidence - 1).abs()        # peaks at confidence 0.5
    importance = df.category.map(CATEGORY_WEIGHT).fillna(0.5)
    # A claim with real support but not certainty is the most informative to ask.
    df["value"] = (0.5 + 0.5 * uncertainty) * importance * (1 + 0.1 * df.support.clip(upper=5))
    df["value"] += (df.era == "current") * 0.1
    return df.sort_values("value", ascending=False).head(n).to_dict("records")


def record(belief_id, verdict, correction=None):
    """Apply his answer. verdict: confirmed | rejected | outdated."""
    tbl = _table()
    rows = tbl.search().where(f"id = '{_esc(belief_id)}'").limit(1).to_list()
    if not rows:
        return False
    b = rows[0]
    if correction:
        tbl.update(where=f"id = '{_esc(belief_id)}'", values={"status": "rejected", "updated": _now()})
        nid = uuid.uuid4().hex[:12]
        tbl.add([{**{k: b[k] for k in ("category", "era", "source")},
                  "id": nid, "claim": correction, "confidence": 1.0, "status": "confirmed",
                  "support": b["support"], "evidence": b["evidence"], "updated": _now(),
                  "vector": y.embed(correction)[0].tolist()}])
        _promote(correction, b["category"])
        return True
    conf = {"confirmed": 1.0, "rejected": 0.0, "outdated": b["confidence"]}[verdict]
    tbl.update(where=f"id = '{_esc(belief_id)}'",
               values={"status": verdict, "confidence": conf, "updated": _now()})
    if verdict == "confirmed":
        _promote(b["claim"], b["category"])
    elif verdict == "outdated":
        _promote(f"In the past (not now): {b['claim']}", b["category"], past=True)
    return True


def _promote(claim, category, past=False):
    """Copy a confirmed belief into the main store as a confirmed fact."""
    y.add_many([{"text": claim, "role": "fact",
                 "source": "authored:confirmed" + (":past" if past else "")}])


# -------------------------------------------------------------- runtime context
def hypotheses_context(query: str, k: int = 2) -> str:
    """Relevant UNCONFIRMED beliefs for the prompt, clearly marked as guesses."""
    tbl = _table()
    if not tbl.count_rows():
        return ""
    qv = y.embed(query, is_query=True)[0].tolist()
    res = (tbl.search(qv).metric("cosine")
           .where(f"status = 'unconfirmed' AND confidence >= {HYPOTHESIS_MIN_CONF}")
           .limit(k).to_list())
    res = [r for r in res if r["_distance"] <= HYPOTHESIS_MAX_DIST]
    if not res:
        return ""
    out = ("LIKELY BUT UNCONFIRMED (inferred from his messages — hedge these: "
           "'lagta hai...', 'agar main galat nahi hoon...'. Never state as certain):\n")
    for r in res:
        out += f"- {r['claim']} (confidence {r['confidence']:.0%}, from {r['era']})\n"
    return out


def stats():
    tbl = _table()
    if not tbl.count_rows():
        print("No beliefs yet.")
        return
    df = tbl.to_pandas()
    print(f"Beliefs: {len(df)}")
    print("  by status:  ", df.status.value_counts().to_dict())
    print("  by category:", df.category.value_counts().to_dict())
    print("  by source:  ", df.source.value_counts().to_dict())
    top = df[df.status == "unconfirmed"].sort_values(["support", "confidence"], ascending=False)
    print("\nBest-supported unconfirmed claims:")
    for r in top.head(10).itertuples():
        print(f"  [{r.confidence:.0%} x{r.support} {r.era}] {r.claim}")


def review(n=10):
    """Interactive review: the CLI face of active learning."""
    qs = next_questions(n)
    if not qs:
        print("Nothing to review.")
        return
    print("For each claim:  y = true now   n = false   o = used to be true   "
          "e = edit/correct   s = skip   q = quit\n")
    for b in qs:
        print(f"[{b['category']}, {b['confidence']:.0%}, x{b['support']}, {b['era']}]")
        print(f"  {b['claim']}")
        a = input("  > ").strip().lower()
        if a == "q":
            break
        if a == "y":
            record(b["id"], "confirmed")
        elif a == "n":
            record(b["id"], "rejected")
        elif a == "o":
            record(b["id"], "outdated")
        elif a == "e":
            fix = input("  correct version: ").strip()
            if fix:
                record(b["id"], "confirmed", correction=fix)
        print()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if cmd == "seed":
        seed()
    elif cmd == "distill":
        distill(limit=int(sys.argv[2]) if len(sys.argv) > 2 else 400)
    elif cmd == "review":
        review()
    elif cmd == "questions":
        for b in next_questions(8):
            print(f"  [{b['value']:.2f} | {b['category']} {b['confidence']:.0%} x{b['support']}] {b['claim']}")
    else:
        stats()

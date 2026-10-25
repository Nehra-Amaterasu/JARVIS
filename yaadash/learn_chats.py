"""The feedback loop: JARVIS's conversations with Aman, read over and kept as memory.

    python -m yaadash.learn_chats --since 7d          backfill the last week
    python -m yaadash.learn_chats --stats             what is in the store
    python -m yaadash.learn_chats --since 7d --no-llm the rules only (Ollama not needed)

The app's crew runs run() every two minutes (crew/agents/learner.py); it does real work
only when there is something new, and asks the model only when he has been quiet for
IDLE_S, so it never competes with a live reply for the GPU.

1. INGEST. The transcripts (data/app/transcripts/YYYY-MM-DD.jsonl, one JSON line per
   turn, written by app/jarvis_app/transcripts.py) are read from a byte cursor per file,
   complete lines only, so nothing is read twice and a half-written last line waits for
   the next run. Every turn is embedded (bge-small on the CPU) into the chat_turns table,
   keyed session#turn: re-running is a no-op (idempotent), losing the cursor costs only
   time.
2. NOISE. A turn is never a fact when he flagged it "misheard", when it is a few
   garbled words ("Man, Man, Man, Man"), or when JARVIS answered it with "I didn't catch
   that". Such turns stay in the index (flagged noise) and out of every memory.
3. DISTIL. When a session has been quiet for IDLE_S, the local model (Ollama, the same
   4B brain; nothing leaves the laptop) reads it in chunks and writes durable memories:
   facts, preferences, corrections, standing instructions, callbacks. Each one must point
   at the line of HIS it came from and share words with it, or it is dropped (a 4B model
   invents; the evidence check is the guard). Rules run too, always, and alone when
   Ollama is down: "call me sir" and corrections he spells out, warm reactions ("love
   this", laughter) to a reply -> a style exemplar, a song he loved -> a preference,
   frustration (loops, false claims, long replies) -> a "don't". A session done by the
   rules alone is read again by the model once it is back.
4. MERGE OR SUPERSEDE. A memory that says what an active one already says raises its
   support and confidence. One that CHANGES an active one (the model is asked; without
   it, a correction that names the same thing) supersedes it: "the ESP32 drives the
   relays" is kept, marked superseded by "the Arduino Uno drives the light and fan; the
   ESP32 is only for Aankhen", and never shown again.
5. FLAGS he sets in the app (flags.jsonl): good -> exemplar, wrong + what he expected ->
   correction, misheard -> noise (and any memory resting only on that turn is retracted).

Everything lands in data/yaadash/learned/ (chat_memory.py reads it at reply time). The
older stores (memories, beliefs, archive) are not touched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Optional

_HERE = Path(__file__).resolve().parent
for _p in (_HERE.parent / "core", _HERE):           # `python -m yaadash.learn_chats` from the root
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import chat_memory as cm  # noqa: E402

IDLE_S = 600                  # a chat is over after 10 quiet minutes (agent.py resets its buffer then too)
CHUNK_CHARS = 3500            # transcript text per model call (the 4B context is 8192 tokens)
LINE_CHARS = 400
MERGE_DISTANCE = 0.10         # bge cosine distance: the same memory said again
RELATED_DISTANCE = 0.35       # close enough to ask whether the new one replaces the old
MAX_EVIDENCE = 12
LOCK_STALE_S = 1800
# He is talking when a transcript line was written in the last BUSY_S seconds (the app
# writes his line the moment it is heard, before JARVIS answers) or since the pass began.
BUSY_S = 45.0
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M"
CURSOR_FILE = "cursor.json"
DAY_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")


# ------------------------------------------------------------------------- paths
def transcripts_dir() -> Path:
    if os.environ.get("JARVIS_TRANSCRIPTS_DIR"):
        return Path(os.environ["JARVIS_TRANSCRIPTS_DIR"])
    try:
        import home
        base = Path(os.environ.get("JARVIS_DATA_DIR") or home.APP_DATA)
    except Exception:
        base = _HERE.parent / "data" / "app"
    return base / "transcripts"


def brain_model() -> str:
    """JARVIS_LEARN_MODEL, else the brain the app chose, else today's default brain."""
    for k in ("JARVIS_LEARN_MODEL", "JARVIS_BRAIN_MODEL"):
        if (os.environ.get(k) or "").strip():
            return os.environ[k].strip()
    try:
        s = Path(os.environ.get("JARVIS_SETTINGS") or transcripts_dir().parent / "settings.json")
        m = ((json.loads(s.read_text(encoding="utf-8")).get("brain") or {}).get("model") or "").strip()
        if m:
            return m
    except Exception:
        pass
    return DEFAULT_MODEL


# ------------------------------------------------------------------------ Ollama
def ollama_up(timeout: float = 0.5) -> bool:
    try:
        import httpx
        return httpx.get(f"{OLLAMA}/api/version", timeout=timeout).status_code == 200
    except Exception:
        return False


def ollama_llm(model: Optional[str] = None, timeout: float = 120.0) -> Callable[[str], str]:
    """prompt -> the model's JSON text. Low temperature: this is reading, not chatting."""
    import httpx
    model = model or brain_model()

    def call(prompt: str) -> str:
        r = httpx.post(f"{OLLAMA}/api/chat", timeout=timeout, json={
            "model": model, "stream": False, "format": "json", "keep_alive": "30m",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.1, "num_predict": 700, "num_ctx": 8192, "repeat_penalty": 1.1}})
        r.raise_for_status()
        return (r.json().get("message") or {}).get("content") or ""
    return call


def _json(text: str):
    text = (text or "").strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"[\[{].*[\]}]", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


# ------------------------------------------------------------------------- store
class Store:
    """memories.json + cursor.json + the chat_turns table, all in learned_dir()."""

    def __init__(self, root: Optional[Path] = None):
        self.root = Path(root) if root else cm.learned_dir()
        self.root.mkdir(parents=True, exist_ok=True)
        self.mem_path = self.root / cm.MEMORIES_FILE
        self.cursor_path = self.root / CURSOR_FILE
        self.memories: list = self._load(self.mem_path, [])
        self.cursor: dict = self._load(self.cursor_path, {})
        self.cursor.setdefault("files", {})
        self.cursor.setdefault("flags_offset", 0)
        self.cursor.setdefault("sessions", {})
        self._db = self._tbl = None

    @staticmethod
    def _load(p: Path, default):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return default
        except Exception:
            # Unreadable (an edit by hand gone wrong): set aside, never overwritten by the
            # next save, which would lose every memory in it (2026-10-23 audit).
            try:
                os.replace(p, p.with_name(f"{p.name}.unreadable-{int(time.time())}"))
            except OSError:
                pass
            return default

    def save(self) -> None:
        cm.write_json(self.mem_path, self.memories)
        cm.write_json(self.cursor_path, self.cursor)

    # the turn index ------------------------------------------------------------
    def table(self):
        if self._tbl is None:
            import lancedb
            import pyarrow as pa
            self._db = lancedb.connect(str(self.root / "lancedb"))
            if cm.TURNS_TABLE in cm.table_names(self._db):
                self._tbl = self._db.open_table(cm.TURNS_TABLE)
            else:
                schema = pa.schema([
                    pa.field("id", pa.string()), pa.field("session", pa.string()), pa.field("turn", pa.int64()),
                    pa.field("role", pa.string()), pa.field("text", pa.string()), pa.field("ts", pa.float64()),
                    pa.field("day", pa.string()), pa.field("noise", pa.bool_()),
                    pa.field("vector", pa.list_(pa.float32(), 384))])
                self._tbl = self._db.create_table(cm.TURNS_TABLE, schema=schema)
        return self._tbl

    def indexed_ids(self) -> set:
        t = self.table()
        if not t.count_rows():
            return set()
        return set(t.to_arrow().column("id").to_pylist())

    def session_turns(self, session: str) -> list:
        t = self.table()
        if not t.count_rows() or not re.fullmatch(r"[\w.-]+", session or ""):
            return []
        rows = t.search().where(f"session = '{session}'").select(
            ["id", "session", "turn", "role", "text", "ts", "noise"]).limit(100000).to_list()
        return sorted(rows, key=lambda r: (r["turn"], r["ts"]))

    def mark_noise(self, ids: Iterable[str]) -> None:
        ids = [i for i in ids if re.fullmatch(r"[\w.#-]+", i)]
        if ids:
            quoted = ",".join(f"'{i}'" for i in ids)
            self.table().update(where=f"id IN ({quoted})", values={"noise": True})


# ------------------------------------------------------------------------- ingest
def _complete_lines(path: Path, offset: int) -> tuple[list, int]:
    """JSON objects after `offset`, complete lines only; the new offset."""
    try:
        size = path.stat().st_size
    except OSError:
        return [], offset
    if size < offset:                                  # rewritten from scratch: start over
        offset = 0
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()
    end = data.rfind(b"\n")
    if end < 0:
        return [], offset
    out = []
    for line in data[: end + 1].splitlines():
        try:
            out.append(json.loads(line.decode("utf-8")))
        except Exception:
            continue
    return out, offset + end + 1


def _since_day(since: Optional[str]) -> Optional[str]:
    if not since:
        return None
    m = re.fullmatch(r"(\d+)\s*([dh])", since.strip().lower())
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = timedelta(days=n) if unit == "d" else timedelta(hours=n)
        return (datetime.now() - delta).strftime("%Y-%m-%d")
    return datetime.strptime(since.strip(), "%Y-%m-%d").strftime("%Y-%m-%d")


garbled = cm.garbled      # one definition: "remember that." skips the same noise at reply time


def ingest(store: Store, tdir: Path, since: Optional[str] = None, embed=None) -> dict:
    """New complete turn lines -> chat_turns (embedded). Returns counts."""
    since_day = _since_day(since)
    known = store.indexed_ids()
    new, files_read = [], 0
    for p in sorted(tdir.glob("*.jsonl")):
        m = DAY_FILE.match(p.name)
        if not m or (since_day and m.group(1) < since_day and p.name not in store.cursor["files"]):
            continue
        rows, off = _complete_lines(p, int(store.cursor["files"].get(p.name, 0)))
        store.cursor["files"][p.name] = off
        files_read += 1
        for r in rows:
            if r.get("kind") != "turn" or r.get("role") not in ("you", "jarvis") or not str(r.get("session") or ""):
                continue
            rid = f"{r['session']}#{int(r['id'])}"
            if rid in known:
                # Indexed by a pass that died before saving the cursor (the app closed
                # mid-distillation): the turn is in the table but its session may be
                # missing from the cursor, and would never be read over (2026-10-23 audit).
                _note_session(store, str(r["session"]), int(r["id"]), float(r.get("ts") or 0))
                continue
            known.add(rid)
            new.append({"id": rid, "session": str(r["session"]), "turn": int(r["id"]), "role": r["role"],
                        "text": " ".join(str(r.get("text") or "").split()), "ts": float(r.get("ts") or time.time()),
                        "day": m.group(1), "noise": r["role"] == "you" and garbled(r.get("text") or "")})
    if new:
        # "I didn't catch that" marks the line it answered as noise
        by_key = {(t["session"], t["turn"]): t for t in new}
        late = []
        for t in new:
            if t["role"] == "jarvis" and cm._GARBLED_REPLY.search(t["text"]):
                prev = by_key.get((t["session"], t["turn"] - 1))
                if prev is not None:
                    prev["noise"] = True
                else:
                    late.append(f"{t['session']}#{t['turn'] - 1}")
        if embed is None:
            embed = cm._embedder()
        if embed is None:
            import yaadash_v2
            embed = yaadash_v2.embed
        texts = [t["text"] or "(empty)" for t in new]
        vecs = []
        for i in range(0, len(texts), 64):
            vecs.extend(embed(texts[i:i + 64]))
        store.table().add([{**t, "vector": [float(x) for x in v]} for t, v in zip(new, vecs)])
        store.mark_noise(late)
        for t in new:
            _note_session(store, t["session"], t["turn"], t["ts"])
    return {"files": files_read, "new_turns": len(new)}


def _note_session(store: Store, session: str, turn: int, ts: float) -> None:
    s = store.cursor["sessions"].setdefault(session, {"upto": 0, "by": None, "last_ts": 0, "last_id": 0})
    s["last_ts"] = max(s["last_ts"], ts)
    s["last_id"] = max(s["last_id"], turn)


# --------------------------------------------------------------------- the rules
# Warmth strong enough to mean "more of that". Checked on the first week of transcripts:
# plain approval ("very good", "I like that") also followed replies that were merely a
# relief, one of which invented a sensor reading, so it is not a style signal; love,
# laughter and "spot on" are.
_WARM = re.compile(r"\b(?:love\s+(?:this|it|that|you)|loving\s+(?:this|it)|spot\s+on|brilliant|nailed\s+it|"
                   r"well\s+said|nice\s+one|good\s+one|so\s+funny|hilarious|that'?s\s+(?:funny|amazing|perfect)|"
                   r"best\s+(?:shit|thing)\s+ever|ha(?:ha)+|lol|lmao|rofl)\b|😂|🤣", re.I)
_RECEIPT = re.compile(r"^(?:now\s+playing|skipped\s+to|playing|paused|resumed|opened|the\s+(?:light|fan)\s+is|"
                      r"reminder\s+set|timer|alarm|it'?s\s+\d|cancelled|noted\.|saved,)", re.I)
_SONG = re.compile(r"(?:now\s+playing|skipped\s+to|playing)\s+(.+?)\s+by\s+(.+?)\s+(?:in|on|from)\s+", re.I)
# Without the model, only a correction he spells out AND that names a thing (ESP32, Uno,
# COM9, a name) is kept: on the first week of transcripts a looser rule also caught
# momentary ones (where he was sitting at that moment), which are not durable.
_CORRECTS = re.compile(r"\b(?:correct\s+you|that'?s\s+(?:not\s+(?:right|true|correct)|wrong)|"
                       r"you(?:'re|\s+are)\s+(?:\w+\s+)?wrong|not\s+true|we\s+(?:are|'re)\s+not\s+using|"
                       r"i\s+(?:am|'m)\s+not\s+using)\b", re.I)
_STANDING = re.compile(r"\b(?:from\s+now\s+on|always|never|every\s+time|whenever|don'?t\s+ever|stop\s+"
                       r"(?:saying|doing|repeating|calling))\b", re.I)
_ABOUT_JARVIS = re.compile(r"\b(?:you|your|reply|replies|answer|speak|talk|say|respond)\b", re.I)
DONTS = [  # (category, rule on his words, the don't, kept in his favour of brevity)
    ("loops", re.compile(r"\b(?:again\s+and\s+again|same\s+(?:stuff|thing|shit)|repeating|you\s+keep\s+(?:saying|"
                         r"repeating)|for\s+the\s+past\s+(?:two|three|\d+)\s+(?:prompts|times|replies)|loop(?:ing)?)\b",
                         re.I),
     "Repeating the same reply or promise when something is not working: say once that it failed, then change approach"),
    ("false_claims", re.compile(r"\b(?:not\s+actually\s+doing|you\s+are\s+not\s+(?:playing|doing|searching)|you'?re\s+"
                                r"not\s+(?:playing|doing)|(?:song|it)\s+(?:does\s*n'?t|did\s*n'?t)\s+(?:actually\s+)?"
                                r"exist|did\s*n'?t\s+(?:play|work)|is\s*n'?t\s+playing|not\s+playing)\b", re.I),
     "Claiming something is playing, found or done when it is not, or naming songs that do not exist"),
    ("long", re.compile(r"\b(?:too\s+long|shorter|short\s+answers?|talk\s+less|keep\s+it\s+short|so\s+long)\b", re.I),
     "Long replies: he wants them short"),
]


def _is_question(text: str) -> bool:
    return text.rstrip().endswith("?") and bool(cm._QUESTION_START.match(cm.clean_statement(text)))


def rules_candidates(turns: list, upto: int, flags: dict) -> list:
    """Memories from his words alone, no model. turns: one session, in order."""
    out = []
    for i, t in enumerate(turns):
        if t["turn"] <= upto or t["role"] != "you" or t["noise"]:
            continue
        text, ev = t["text"], t["id"]
        prev = turns[i - 1] if i and turns[i - 1]["role"] == "jarvis" else None
        pref = cm.parse_address(text)
        if pref:
            avoid = f'; never "{pref["avoid"][0]}"' if pref.get("avoid") else ""
            out.append(dict(kind="instruction", text=f'Address him as "{pref["address"]}", always{avoid}.',
                            evidence=ev, ts=t["ts"], confidence=0.9, by="rules", meta=pref))
        elif prev is not None and _CORRECTS.search(text) and len(text.split()) >= 6 and entities(text) \
                and not _is_question(text):
            out.append(dict(kind="correction", text=cm.clean_statement(" ".join(text.split()[:50])), evidence=ev,
                            ts=t["ts"], confidence=0.55, by="rules"))
        elif _STANDING.search(text) and _ABOUT_JARVIS.search(text) and not _is_question(text) \
                and len(text.split()) >= 5:
            out.append(dict(kind="instruction", text=cm.clean_statement(" ".join(text.split()[:40])), evidence=ev,
                            ts=t["ts"], confidence=0.5, by="rules"))
        if prev is not None and _WARM.search(text):
            song = _SONG.search(prev["text"])
            if song:
                out.append(dict(kind="preference", text=f"He loved hearing {song.group(1)} by {song.group(2)}.",
                                evidence=ev, ts=t["ts"], confidence=0.7, by="rules"))
            elif len(prev["text"].split()) >= 8 and not _RECEIPT.match(prev["text"]):
                he = turns[i - 2]["text"] if i >= 2 and turns[i - 2]["role"] == "you" else ""
                out.append(_exemplar(he, prev, ev, t["ts"], "warm"))
        for cat, rx, dont in DONTS:
            if rx.search(text):
                out.append(dict(kind="dont", text=dont, evidence=ev, ts=t["ts"], confidence=0.6, by="rules",
                                meta={"category": cat}))
    # his verdicts in the app
    for i, t in enumerate(turns):
        f = flags.get(t["id"])
        if not f:
            continue
        if f["verdict"] == "good" and t["role"] == "jarvis" and len(t["text"].split()) >= 8 \
                and not _RECEIPT.match(t["text"]):         # "The light is on." worked; it is not a style
            he = turns[i - 1]["text"] if i and turns[i - 1]["role"] == "you" else ""
            out.append(_exemplar(he, t, t["id"], t["ts"], "flag"))
        elif f["verdict"] == "wrong" and (f.get("expected") or "").strip():
            asked = turns[i - 1]["text"] if t["role"] == "jarvis" and i else t["text"]
            out.append(dict(kind="correction", text=f'When he said "{cm.clip(asked, 120)}", the right answer was: '
                                                    f'{cm.clip(f["expected"], 300)}', evidence=t["id"], ts=t["ts"],
                            confidence=0.9, by="flag"))
    return out


def _exemplar(he: str, reply: dict, ev: str, ts: float, why: str) -> dict:
    return dict(kind="exemplar", text=f"He: {cm.clip(he, 120)} / You: {cm.clip(reply['text'], 220)}",
                evidence=reply["id"], ts=ts, confidence=0.8 if why == "flag" else 0.6, by=why,
                meta={"he": cm.clip(he, 200), "you": cm.clip(reply["text"], 300), "reaction": ev})


# ------------------------------------------------------------------- the model
DISTIL_PROMPT = """You are reading part of a conversation between Aman (lines marked HE) and his home assistant JARVIS (lines marked JARVIS). Speech recognition wrote HE's lines, so some words are misheard.
Write down what JARVIS should remember about HIM for future conversations.

Kinds:
- fact: a lasting fact HE stated about himself, his life, his projects or his home setup.
- preference: something HE likes or dislikes (music, food, how he wants things done).
- correction: HE corrected something JARVIS got wrong. Write the corrected truth, not the mistake.
- instruction: a standing instruction from HE for how JARVIS should behave from now on.
- callback: a joke, nickname or playful phrase HE started that JARVIS could bring up again later.

Rules:
- Only what HE said or clearly meant. Never take facts from JARVIS's lines; JARVIS is often wrong.
- Skip greetings, one-off commands that were simply carried out (switch the light, play a song), questions, momentary moods, and garbled lines.
- One short sentence per memory, in plain English. Facts and preferences start with "He" or name the thing; instructions are written as orders to JARVIS.
- "turn" is the number of the HE line the memory comes from.
- Most chunks have nothing worth keeping; then return an empty list.

Reply with JSON only: {{"memories": [{{"kind": "fact", "text": "...", "turn": 12, "confidence": 0.7}}]}}

Conversation:
{lines}"""

JUDGE_PROMPT = """Two notes about the same person, written at different times.
OLD: {old}
NEW: {new}
Does NEW replace OLD, because NEW contradicts it or updates it so that OLD is no longer true? Notes that are merely about related things do not replace each other.
Reply with JSON only: {{"replaces": true}} or {{"replaces": false}}"""


def _chunks(turns: list) -> list:
    chunks, cur, size = [], [], 0
    for t in turns:
        line = f"[{t['turn']}] {'HE' if t['role'] == 'you' else 'JARVIS'}: {cm.clip(t['text'], LINE_CHARS)}"
        if cur and size + len(line) > CHUNK_CHARS:
            chunks.append(cur)
            cur, size = [], 0
        cur.append((t, line))
        size += len(line) + 1
    if cur:
        chunks.append(cur)
    return chunks


# Who else a line can be about. A 4B model reading "my friend Kabir is allergic to
# peanuts" writes "He is allergic to peanuts": the evidence check passes (the words are
# his), and a friend's fact becomes Aman's (2026-10-23 audit, cross-person probes).
_OTHERS = re.compile(r"\b(?:friend|friends|dost|sister|brother|bhai|didi|mother|mom|mum|maa|mummy|father|dad|papa|"
                     r"cousin|uncle|aunt|aunty|chacha|mama|nana|nani|dada|dadi|wife|husband|girlfriend|boyfriend|"
                     r"roommate|flatmate|classmate|colleague|teacher|professor|boss|neighbou?r|he|she|they|his|her|"
                     r"their)\b", re.I)
_ABOUT_HIM = re.compile(r"^\s*(?:he|his|aman)\b", re.I)
_PRONOUNS = {"he", "she", "they", "his", "her", "their"}
# "yaad rakhna bhai" is "remember it, bro", not his brother: a relation word said as an
# address (after a comma, or ending the clause) names nobody.
_VOCATIVE = re.compile(r"(?:^|[,;])\s*(?:bhai|dost|yaar|bro|bhaiya)\b|\b(?:bhai|dost|yaar|bro|bhaiya)\s*(?=[,.!?;]|$)", re.I)
_NAME_AFTER = re.compile(r"\b(?:friend|friends|dost|sister|brother|bhai|didi|mother|mom|mum|father|dad|cousin|uncle|"
                         r"aunt|wife|husband|girlfriend|boyfriend|roommate|flatmate|classmate|colleague|teacher|"
                         r"professor|boss|neighbou?r)\s+([A-Z][a-z]+)")


def misattributed(text: str, src: str) -> bool:
    """A memory written about HIM ("He ...", "His ...") from a line that is about someone
    else, when the memory names none of the people the line names. Conservative: a fact of
    his own told in the same breath as a friend is dropped too, and the line stays in the
    chat index, where "what did I tell you about ...?" still finds it."""
    if not _ABOUT_HIM.match(text or ""):
        return False
    src = _VOCATIVE.sub(" ", src or "")
    people = {m.group(0).lower() for m in _OTHERS.finditer(src)}
    # Who the line is about: the relation words and the name after them ("sister Tara").
    # A place or a month ("Lisbon", "January") is not a person: before 10-25 naming one
    # let "He is moving to Lisbon" pass for his sister's move.
    people |= {m.group(1).lower() for m in _NAME_AFTER.finditer(src)}
    if not people - _PRONOUNS:
        people |= {e.lower() for e in entities(src)}    # no relation word: a bare name (Kabir) is the other
    if not people:
        return False
    said = {w.lower() for w in re.findall(r"[A-Za-z]+", text)}
    return not ((people - _PRONOUNS) & said)


def llm_candidates(turns: list, upto: int, llm: Callable[[str], str],
                   busy: Callable[[], bool] = lambda: False) -> list:
    """The model's memories for the turns after `upto` (two earlier turns ride along as
    context), each checked against the HE line it names."""
    start = next((i for i, t in enumerate(turns) if t["turn"] > upto), len(turns))
    window = [t for t in turns[max(0, start - 2):] if not t["noise"]]
    out = []
    for chunk in _chunks(window):
        mine = {t["turn"]: t for t, _ in chunk if t["role"] == "you" and t["turn"] > upto}
        if not mine:
            continue
        if busy():
            raise Busy()                              # he started talking: the GPU is his
        got = _json(llm(DISTIL_PROMPT.format(lines="\n".join(line for _, line in chunk))))
        items = got.get("memories") if isinstance(got, dict) else got if isinstance(got, list) else []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            kind, text = str(it.get("kind") or "").lower().strip(), " ".join(str(it.get("text") or "").split())
            text = re.sub(r"\bHE\b", "he", text)        # the prompt's speaker label leaks into its prose
            try:
                turn = int(it.get("turn"))
            except Exception:
                continue
            src = mine.get(turn)
            if kind not in ("fact", "preference", "correction", "instruction", "callback") or src is None:
                continue                              # no line of HIS behind it: invented or misattributed
            if len(text.split()) < 3 or len(text) > 300:
                continue
            if cm.lexical_overlap(text, src["text"]) < (1 if kind == "instruction" else 2):
                continue                              # it must say something he said
            if misattributed(text, src["text"]):
                continue                              # his friend's fact, written up as his
            try:
                conf = float(it.get("confidence", 0.6))
            except Exception:
                conf = 0.6
            out.append(dict(kind=kind, text=text, evidence=src["id"], ts=src["ts"],
                            confidence=max(0.3, min(0.9, conf)), by="llm"))
    return out


# ------------------------------------------------------------- merge / supersede
_ENTITY = re.compile(r"\b(?:[A-Z][A-Za-z]*\d[\w-]*|[A-Za-z]+\d+[\w-]*|[A-Z]{2,}[a-z]*|[A-Z][a-z]{2,})\b")
_CALL_HIM = re.compile(r"\b(?:call|address)\s+him\b", re.I)
_FAMILY = {"fact": "about", "preference": "about", "correction": "about", "instruction": "rule",
           "callback": "callback", "dont": "dont", "exemplar": "exemplar"}
_SKIP_ENTITIES = {"He", "His", "The", "When", "Jarvis", "JARVIS", "Aman", "Sir", "Address", "Never", "Always"}


def entities(text: str) -> set:
    """Named things: ESP32, COM9, Uno, a name. A capitalised word only counts away from the
    start of a sentence (speech recognition capitalises "Actually" and "Hey" there)."""
    out = set()
    for m in _ENTITY.finditer(text or ""):
        e = m.group(0)
        if e in _SKIP_ENTITIES or e.lower() in cm.STOP:
            continue
        plain_word = e[:1].isupper() and e[1:].islower() and e.isalpha()
        before = (text or "")[:m.start()].rstrip()
        if plain_word and (not before or before[-1] in ".!?"):
            continue
        out.add(e.lower())
    return out


def _norm(text: str) -> str:
    return " ".join(sorted(cm.content_words(text)))


def rule_judge(old: dict, new: dict) -> bool:
    """Without the model: a correction replaces a fact or correction that names the same
    thing; a new address replaces the old one."""
    if new["kind"] == "instruction" and (new.get("meta") or {}).get("address"):
        return bool((old.get("meta") or {}).get("address"))
    if new["kind"] == "correction" and old["kind"] in ("fact", "correction", "preference"):
        return bool(entities(old["text"]) & entities(new["text"])) or cm.lexical_overlap(old["text"], new["text"]) >= 3
    return False


def llm_judge(llm: Callable[[str], str], busy: Callable[[], bool] = lambda: False) -> Callable[[dict, dict], bool]:
    def judge(old: dict, new: dict) -> bool:
        if busy():
            return rule_judge(old, new)            # he is talking: no model call for a yes/no
        if (new.get("meta") or {}).get("address") or (old.get("meta") or {}).get("address"):
            return rule_judge(old, new)            # the address is parsed, not judged: only a new address replaces it
        try:
            got = _json(llm(JUDGE_PROMPT.format(old=old["text"], new=new["text"])))
        except Exception:                          # Ollama went away mid-pass: the rule, not a crashed pass
            got = None
        if isinstance(got, dict) and isinstance(got.get("replaces"), bool):
            return got["replaces"]
        return rule_judge(old, new)
    return judge


def add_memory(store: Store, cand: dict, judge: Callable[[dict, dict], bool], embed=None) -> str:
    """Merge into an active near-duplicate, supersede what it changes, or add. Returns
    "merged", "added" or "added+superseded"."""
    fam = _FAMILY[cand["kind"]]
    active = [m for m in store.memories if m.get("status", "active") == "active" and _FAMILY.get(m["kind"]) == fam]
    embed = embed or cm._embedder()
    dist = {}
    if active and embed is not None and fam in ("about", "rule", "callback"):
        vecs = embed([cand["text"]] + [m["text"] for m in active])
        q = [float(x) for x in vecs[0]]
        for m, v in zip(active, vecs[1:]):
            dist[m["id"]] = cm._distance(q, [float(x) for x in v])

    def same(m) -> bool:
        if fam == "exemplar":
            return cand["evidence"] in m["evidence"] or (m.get("meta") or {}).get("you") == (cand.get("meta") or {}).get("you")
        if fam == "dont":
            return m["text"] == cand["text"]
        if (m.get("meta") or {}).get("address") and _CALL_HIM.search(cand["text"]):
            return True                               # the model's wording of the address already kept
        if (cand.get("meta") or {}).get("address") or (m.get("meta") or {}).get("address"):
            return (cand.get("meta") or {}) == (m.get("meta") or {})
        return _norm(m["text"]) == _norm(cand["text"]) or dist.get(m["id"], 1.0) <= MERGE_DISTANCE

    # Already learned from this very line and since replaced or retracted: re-reading an
    # old session (the model catching up on a rules-only pass, a lost cursor) must not
    # bring it back as active (2026-10-23 audit).
    for m in store.memories:
        if (m.get("status", "active") != "active" and cand["evidence"] in (m.get("evidence") or [])
                and _FAMILY.get(m["kind"]) == fam and _norm(m["text"]) == _norm(cand["text"])):
            return "merged"
    for m in active:
        if same(m):
            if cand["evidence"] not in m["evidence"]:
                m["evidence"] = (m["evidence"] + [cand["evidence"]])[-MAX_EVIDENCE:]
                m["support"] = int(m.get("support") or 1) + 1
                m["confidence"] = round(min(0.95, max(m["confidence"], cand["confidence"]) + 0.05), 3)
            m["last_seen"] = max(m["last_seen"], cand["ts"])
            if cand["kind"] == "correction" and m["kind"] != "correction":
                m["kind"] = "correction"             # he had to say it as a correction: it matters
            return "merged"
    new = {"id": uuid.uuid4().hex[:10], "kind": cand["kind"], "text": cand["text"], "evidence": [cand["evidence"]],
           "confidence": round(float(cand["confidence"]), 3), "support": 1, "first_seen": cand["ts"],
           "last_seen": cand["ts"], "status": "active", "by": cand.get("by", "rules")}
    if cand.get("meta"):
        new["meta"] = cand["meta"]
    if cand.get("src"):
        new["src"] = cm.clip(cand["src"], 300)
    result = "added"
    if fam in ("about", "rule"):
        for m in active:
            if (new["by"] == "llm" and m.get("by") == "rules" and m["evidence"] == new["evidence"]
                    and not (m.get("meta") or {}).get("address")):
                # the same line of his, once in his raw words (rules) and once written up: keep the write-up
                m["status"], m["superseded_by"], m["superseded_at"] = "superseded", new["id"], time.time()
                if m["kind"] == "correction" and new["kind"] == "fact":
                    new["kind"] = "correction"        # it was said as a correction: that is why it matters
                result = "added+superseded"
                continue
            related = (dist.get(m["id"], 1.0) <= RELATED_DISTANCE or bool(entities(m["text"]) & entities(new["text"]))
                       or bool((m.get("meta") or {}).get("address") and (new.get("meta") or {}).get("address")))
            if not related:
                continue
            if m["last_seen"] > new["last_seen"]:
                # An older memory never replaces a newer one, but a newer one may already
                # replace it: an old session read late (the model catching up after a
                # rules-only pass) brought "the ESP32 drives the relays" back as active
                # beside the correction that replaced it (2026-10-23 audit).
                if new["status"] == "active" and judge(new, m):
                    new["status"], new["superseded_by"], new["superseded_at"] = "superseded", m["id"], time.time()
                    result = "added+superseded"
                continue
            if new["status"] != "active":
                continue
            if judge(m, new):
                m["status"], m["superseded_by"], m["superseded_at"] = "superseded", new["id"], time.time()
                result = "added+superseded"
    store.memories.append(new)
    return result


def retract_for(store: Store, turn_ids: set) -> int:
    """A memory resting only on turns now known to be misheard is retracted."""
    n = 0
    for m in store.memories:
        if m.get("status", "active") == "active" and m["evidence"] and set(m["evidence"]) <= turn_ids:
            m["status"], n = "retracted", n + 1
    return n


# ------------------------------------------------------------------------ flags
def read_flags(store: Store, tdir: Path) -> tuple[dict, set]:
    """All flags, latest verdict per turn (they are few), and the turns newly flagged
    misheard since the last run."""
    path = tdir / "flags.jsonl"
    latest, misheard_new = {}, set()
    try:
        raw = path.read_bytes()
    except OSError:
        return latest, misheard_new
    off = int(store.cursor.get("flags_offset") or 0)
    for pos, line in _lines_with_pos(raw):
        try:
            f = json.loads(line)
            key = f"{f['session']}#{int(f['id'])}"
        except Exception:
            continue
        latest[key] = f
        if pos >= off and f.get("verdict") == "misheard":
            misheard_new.add(key)
    store.cursor["flags_offset"] = raw.rfind(b"\n") + 1
    return latest, misheard_new


def _lines_with_pos(raw: bytes):
    pos = 0
    for line in raw.split(b"\n"):
        if line.strip():
            yield pos, line.decode("utf-8", "replace")
        pos += len(line) + 1


def _misheard_ids(flags: dict) -> set:
    """A misheard flag on JARVIS's reply means the line before it was misheard."""
    out = set()
    for key, f in flags.items():
        if f.get("verdict") != "misheard":
            continue
        s, n = key.rsplit("#", 1)
        out |= {key, f"{s}#{int(n) - 1}"}
    return out


# --------------------------------------------------------------------------- run
class _RunLock:
    def __init__(self, root: Path):
        self.path = root / "learn.lock"
        self.held = False

    def __enter__(self):
        try:
            if self.path.exists() and time.time() - self.path.stat().st_mtime > LOCK_STALE_S:
                self.path.unlink()
            fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            self.held = True
        except FileExistsError:
            self.held = False
        return self

    def __exit__(self, *exc):
        if self.held:
            try:
                self.path.unlink()
            except OSError:
                pass


class Busy(Exception):
    """He started talking during a pass: stop asking the model; the session is read later."""


def last_written(tdir: Path) -> float:
    """mtime of the newest day file (0 when there is none)."""
    best = 0.0
    try:
        for p in tdir.glob("*.jsonl"):
            if DAY_FILE.match(p.name):
                best = max(best, p.stat().st_mtime)
    except OSError:
        pass
    return best


def run(transcripts: Optional[Path] = None, now: Optional[float] = None, idle_s: float = IDLE_S,
        since: Optional[str] = None, use_llm: bool = True, llm: Optional[Callable[[str], str]] = None,
        store_dir: Optional[Path] = None, busy: Optional[Callable[[], bool]] = None) -> dict:
    """One pass: ingest, flags, and distil every session that has gone quiet.

    busy() says he is talking to JARVIS right now (default: a transcript line written in
    the last BUSY_S seconds or since this pass began). The pass then does nothing at all,
    or, if he starts mid-pass, stops before its next model call: the learner never runs
    while JARVIS is answering (2026-10-23 audit: a pass that began in a quiet spell kept
    calling Ollama for minutes after he spoke)."""
    t0 = time.time()
    now = time.time() if now is None else now
    tdir = Path(transcripts) if transcripts else transcripts_dir()
    if busy is None:
        busy = lambda: last_written(tdir) > t0 - BUSY_S        # noqa: E731
    store = Store(store_dir)
    stats = {"new_turns": 0, "sessions": 0, "added": 0, "merged": 0, "superseded": 0, "retracted": 0,
             "by": "rules", "skipped": None}
    with _RunLock(store.root) as lock:
        if not lock.held:
            stats["skipped"] = "another run holds the lock"
            return stats
        if busy():
            stats["skipped"] = "he is talking"
            return stats
        if tdir.exists():
            stats.update(ingest(store, tdir, since=since))
            store.save()                               # indexed turns and their sessions, before any distilling
        flags, misheard_new = read_flags(store, tdir)
        noise = _misheard_ids(flags)
        if misheard_new:
            store.mark_noise(_misheard_ids({k: flags[k] for k in misheard_new}))
            stats["retracted"] = retract_for(store, _misheard_ids({k: flags[k] for k in misheard_new}))
        sessions = store.cursor["sessions"]
        quiet_all = all(now - s["last_ts"] >= idle_s for s in sessions.values())
        if use_llm and llm is None and quiet_all and ollama_up():
            llm = ollama_llm()
        model_ok = use_llm and llm is not None and quiet_all
        stats["by"] = "llm+rules" if model_ok else "rules"
        judge = llm_judge(llm, busy) if model_ok else rule_judge
        for sid, s in sorted(sessions.items(), key=lambda kv: kv[1]["last_ts"]):
            if now - s["last_ts"] < idle_s:
                continue                              # still talking
            redo = model_ok and s.get("by") == "rules"
            if s["last_id"] <= s["upto"] and not redo:
                continue
            turns = store.session_turns(sid)
            for t in turns:
                if t["id"] in noise:
                    t["noise"] = True
            upto = 0 if redo else s["upto"]
            cands = [] if redo else rules_candidates(turns, upto, flags)
            if model_ok:
                try:
                    cands += llm_candidates(turns, upto, llm, busy)
                except Busy:
                    stats["skipped"] = "he started talking"
                    break                              # this session and the rest are read next time
                except Exception as e:
                    print(f"[learn_chats] model failed on {sid}: {e}")
                    model_ok, judge, stats["by"] = False, rule_judge, "rules"
            said = {t["id"]: t["text"] for t in turns if t["role"] == "you"}
            for c in sorted(cands, key=lambda c: c["ts"]):
                if c["kind"] not in ("exemplar", "dont") and c["evidence"] in said:
                    c.setdefault("src", said[c["evidence"]])     # his own words, for matching later
                r = add_memory(store, c, judge)
                stats["merged" if r == "merged" else "added"] += 1
                stats["superseded"] += r.endswith("superseded")
            s["upto"] = max(s["upto"], s["last_id"])
            s["by"] = "llm" if model_ok else (s.get("by") if s.get("by") == "llm" else "rules")
            stats["sessions"] += 1
            store.save()                               # a session at a time: a crash loses one at most
        store.save()
    stats["seconds"] = round(time.time() - t0, 2)
    return stats


def summary(store_dir: Optional[Path] = None) -> dict:
    store = Store(store_dir)
    by = {}
    for m in store.memories:
        k = f"{m['kind']}:{m.get('status', 'active')}"
        by[k] = by.get(k, 0) + 1
    t = store.table()
    return {"memories": len(store.memories), "by_kind_status": dict(sorted(by.items())),
            "turns_indexed": t.count_rows(), "sessions": len(store.cursor["sessions"]),
            "store": str(store.root)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m yaadash.learn_chats", description=__doc__.split("\n")[0])
    ap.add_argument("--since", help="only transcripts from this far back: 7d, 24h or 2026-10-10")
    ap.add_argument("--idle-min", type=float, default=IDLE_S / 60, help="a chat is over after this many quiet minutes")
    ap.add_argument("--no-llm", action="store_true", help="rules only; Ollama is not called")
    ap.add_argument("--transcripts", help="transcripts folder (default data/app/transcripts)")
    ap.add_argument("--store", help="learned store folder (default data/yaadash/learned)")
    ap.add_argument("--stats", action="store_true", help="print what the store holds and exit")
    ap.add_argument("--show", action="store_true", help="also print the active memories (private: stays local)")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if a.store:
        os.environ["JARVIS_LEARNED_DIR"] = a.store
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    if not a.stats:
        import yaadash_v2  # noqa: F401  the embedder chat_memory uses
        print(json.dumps(run(transcripts=Path(a.transcripts) if a.transcripts else None, since=a.since,
                             idle_s=a.idle_min * 60, use_llm=not a.no_llm), indent=1))
    print(json.dumps(summary(), indent=1))
    if a.show:
        for m in cm.memories():
            print(f"[{m['kind']:11} {m['confidence']:.2f} x{m.get('support', 1)} {m.get('by')}] {m['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

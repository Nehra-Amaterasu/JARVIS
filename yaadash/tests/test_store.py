"""The synthetic store as the production ingest builds it, and the retrieval pieces
that do not depend on the embedder's distances (these run with the fake one too)."""
import re
import runpy
from datetime import datetime, timezone
from pathlib import Path

import synthetic_home as sh
import yaadash_people as yp
import yaadash_recall as yr
import yaadash_v2 as y

ROOT = Path(__file__).resolve().parents[2]
HOME_PY = ROOT / "core" / "home.py"


def _idx(thread_title: str, text_part: str) -> int:
    m = yr._load_msgs()
    rows = m[(m.thread == sh.thread_id(thread_title)) & m.text.str.contains(text_part, regex=False)]
    assert len(rows) == 1, f"{text_part!r} should be one message in {thread_title}"
    return int(rows.idx.iloc[0])


# ------------------------------------------------------------- where it lives
def test_home_defaults_to_data_yaadash_and_honours_the_override(monkeypatch, tmp_path):
    monkeypatch.delenv("JARVIS_YAADASH_DIR", raising=False)
    g = runpy.run_path(str(HOME_PY))               # a fresh copy; the imported one is untouched
    assert g["YAADASH_DATA"] == g["DATA"] / "yaadash"
    assert g["LANCEDB"] == g["DATA"] / "yaadash" / "lancedb"
    monkeypatch.setenv("JARVIS_YAADASH_DIR", str(tmp_path / "elsewhere"))
    g = runpy.run_path(str(HOME_PY))
    assert g["YAADASH_DATA"] == tmp_path / "elsewhere"
    assert g["LANCEDB"] == tmp_path / "elsewhere" / "lancedb"


def test_every_memory_path_is_the_scratch_store(store):
    real = (ROOT / "data").resolve()
    for p in (yr.DATA, yr.BM25_CACHE, yp.DATA, y.DB_PATH):
        p = Path(p).resolve()
        assert p == store.resolve() or store.resolve() in p.parents
        assert real not in p.parents
    assert (store / "archive_msgs.parquet").exists() and (store / "lancedb").is_dir()


# ------------------------------------------------------- the ingest, end to end
def test_the_export_is_read_like_a_real_one(store):
    m = yr._load_msgs()
    total = sum(len(lines) for th in sh.THREADS for _, lines in th["sessions"])
    assert len(m) == total
    assert set(m.thread) == {sh.thread_id(t["title"]) for t in sh.THREADS}
    assert m.kind.value_counts().to_dict() == {"text": total - 3, "call": 1, "share": 1, "system": 1}
    assert set(m[m.is_me].sender) == {sh.OWNER}          # the owner, found from the threads


def test_instagram_mojibake_is_undone_and_hindi_romanised(store):
    m = yr._load_msgs()
    assert not m.text.str.contains(r"[ऀ-ॿ]").any(), "the archive must be single-script"
    tanvi = m[m.thread == sh.thread_id("Tanvi Rao")].text.tolist()
    assert any(re.search(r"\bkal\b.*\bmil", t) for t in tanvi)   # "ठीक है, कल मिलते हैं"
    assert any("\U0001F602" in t for t in m.text)                # the emoji survives the round trip


def test_windows_never_span_two_conversations(store):
    tbl = yr._windows_table()
    wins = tbl.search().select(["thread", "start_idx", "end_idx", "ts_start", "ts_end"]).limit(10000).to_list()
    assert wins
    m = yr._load_msgs()
    for w in wins:
        g = m[(m.thread == w["thread"]) & (m.idx >= w["start_idx"]) & (m.idx <= w["end_idx"])
              & (m.kind != "system")].sort_values("idx")
        assert g.ts.diff().fillna(0).max() <= yp.SESSION_GAP_S


def test_kabir_has_no_window(store):
    """Two texts in two sessions: a person, but nothing a vector search can return."""
    tbl = yr._windows_table()
    rows = tbl.search().where(f"thread = '{sh.thread_id('Kabir Sethi')}'").limit(10).to_list()
    assert rows == []
    assert [r.name for r, _ in yp.resolve_person("Kabir ne kya bola tha?")] == ["Kabir Sethi"]


def test_a_group_chat_is_not_scored_for_closeness(store):
    p = yp.people()
    grp = p[p.thread == sh.thread_id("Hostel Wing B")].iloc[0]
    assert bool(grp.is_group) and grp.closeness != grp.closeness      # NaN


# ---------------------------------------------------------------- excerpts
def test_an_excerpt_stays_in_its_own_conversation_and_carries_its_date(store):
    """Regression for the excerpt that crossed sessions and took the date of its first
    line: the March 2021 trek came back headed "01 Jun 2020"."""
    ex = yr._excerpt(sh.thread_id("Riya Kapoor"), _idx("Riya Kapoor", "Triund trek"))
    assert ex.splitlines()[0] == "[12 Mar 2021 - chat with Riya Kapoor]"
    assert "Kareri lake" in ex and "robotics" not in ex          # June 2020 stays out

    ex = yr._excerpt(sh.thread_id("Dev Malhotra"), _idx("Dev Malhotra", "completed dark souls"))
    assert ex.splitlines()[0] == "[24 Feb 2021 - chat with Dev Malhotra]"
    assert "Hampta" not in ex                                    # June 2023 stays out


def test_his_lines_are_labelled_by_name_and_system_lines_dropped(store):
    ex = yr._excerpt(sh.thread_id("Riya Kapoor"), _idx("Riya Kapoor", "alumni invite"))
    lines = ex.splitlines()[1:]
    assert "Aman: yes, going for sure" in lines
    assert not any(l.startswith("Me:") for l in lines)
    assert "Aman: [shared a post/reel]" in lines
    assert not any("Liked a message" in l for l in lines)


# ----------------------------------------------- filters (any embedder)
def _years(hits):
    m = yr._load_msgs().set_index(["thread", "idx"])
    return {datetime.fromtimestamp(m.ts.loc[h], tz=timezone.utc).year for h in hits}


def test_bm25_year_and_thread_filters(store):
    tanvi = {sh.thread_id("Tanvi Rao")}
    assert _years(yr._bm25_hits("exam", tanvi, {2021})) == {2021}
    assert _years(yr._bm25_hits("exam", tanvi, {2023})) == {2023}
    assert _years(yr._bm25_hits("exam", tanvi, None)) == {2021, 2023}
    assert {t for t, _ in yr._bm25_hits("trek", {sh.thread_id("Dev Malhotra")})} == {sh.thread_id("Dev Malhotra")}


def test_vector_year_and_thread_filters(store):
    hits = yr._vector_hits("exam", {sh.thread_id("Tanvi Rao")}, {2023})
    assert hits and _years(hits) == {2023}
    hits = yr._vector_hits("trek", {sh.thread_id("Riya Kapoor")})
    assert hits and {t for t, _ in hits} == {sh.thread_id("Riya Kapoor")}


def test_first_person_questions_prefer_his_own_messages(store, monkeypatch):
    """Same words, two speakers: Ishaan's shorter "completed dark souls bro" outranks
    his own line unless the first-person boost is on."""
    q = "when did I complete dark souls?"
    dev = (sh.thread_id("Dev Malhotra"), _idx("Dev Malhotra", "completed dark souls"))
    ishaan = (sh.thread_id("Ishaan Bose"), _idx("Ishaan Bose", "completed dark souls bro"))
    assert yr._bm25_hits(q)[0] == dev
    monkeypatch.setattr(yr, "FIRST_PERSON_BOOST", 1.0)
    assert yr._bm25_hits(q)[0] == ishaan


def test_stemming_is_what_finds_completed(store, monkeypatch):
    """Without stemming, his short "dark souls remastered sale pe hai" (same two
    words, no "completed") beats the actual answer."""
    q = "when did I complete dark souls?"
    dev = (sh.thread_id("Dev Malhotra"), _idx("Dev Malhotra", "completed dark souls"))
    sale = (sh.thread_id("Ishaan Bose"), _idx("Ishaan Bose", "remastered sale"))
    assert yr._bm25_hits(q)[0] == dev
    monkeypatch.setattr(yr, "_stem", lambda w: w)
    monkeypatch.setattr(yr, "_bm25", None)
    monkeypatch.setattr(yr, "BM25_CACHE", str(store / "bm25-unstemmed.pkl"))
    assert yr._bm25_hits(q)[0] == sale
    monkeypatch.undo()
    yr._bm25 = yr._bm25_rows = None              # rebuilt from the stemmed cache next time


# ------------------------------------------------- fragments (any embedder)
def test_poisoned_sources_are_never_evidence_whatever_the_distance(store, monkeypatch):
    """Dev-session logs and JARVIS's own past replies are excluded by SOURCE: with the
    distance cutoff switched off, they still never come back."""
    monkeypatch.setattr(y, "FRAGMENT_MAX_DISTANCE", 2.0)
    for q in ("I bake sourdough on weekends, right?", "what bread do I bake?", "push to git"):
        rows = y.search_fragments(q, top_k=10)
        assert rows and all(r["source"].startswith("instagram:") for r in rows)

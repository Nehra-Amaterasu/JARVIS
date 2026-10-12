"""The rules inside yaadash_recall, one at a time, with the retrievers stubbed out.

No store and no embedder: each test hands recall() fixed BM25 and vector rankings, so
a rule that is removed or inverted fails here even when the control queries happen to
survive it. Each rule's origin is in DECISIONS 2026-10-09 ("Hybrid recall").
"""
from types import SimpleNamespace

import pytest

import yaadash_recall as yr


# ------------------------------------------------------------ pure functions
@pytest.mark.parametrize("a, b", [("complete", "completed"), ("complete", "completes"),
                                  ("finished", "finishes"), ("recommendations", "recommendation")])
def test_stemming_is_symmetric(a, b):
    """"complete" in the question must meet "completed" in the message: the first
    version stripped -ed but not -e, so the two never met."""
    assert yr._tok(a) == yr._tok(b)


@pytest.mark.parametrize("word", ["used", "class", "address", "business", "bhai"])
def test_short_words_and_double_s_are_left_alone(word):
    assert yr._tok(word) == [word]


def test_fusion_rewards_agreement_not_density():
    """One thread with many BM25 hits must not beat a moment both systems agree on.
    Summing every hit in a cluster (the first version) would rank T1 first."""
    bm25 = [("T1", 10), ("T1", 11), ("T1", 12), ("T1", 13), ("T2", 100)]
    vec = [("T2", 101), ("T3", 5)]
    fused = yr._fuse(bm25, vec)
    assert (fused[0][0], fused[0][1]) == ("T2", 100)
    t1 = next(c for c in fused if c[0] == "T1")
    assert t1[2] == pytest.approx(1 / (yr.RRF_K + 1))      # one term: its best rank only


def test_fusion_keeps_moments_in_different_threads_apart():
    fused = yr._fuse([("A", 5)], [("B", 5)])
    assert {(c[0], c[1]) for c in fused} == {("A", 5), ("B", 5)}


@pytest.mark.parametrize("q", [
    "maine kab one piece complete kiya tha?", "yaad hai wo joke?", "remember the trek?",
    "what did she say about the exam?", "pichli baar kya hua tha", "have i ever been to goa?",
])
def test_past_event_questions_are_episodic(q):
    assert yr.is_episodic(q)


@pytest.mark.parametrize("q", ["what time is it?", "light band karo", "play some music"])
def test_everyday_requests_are_not(q):
    assert not yr.is_episodic(q)


# ------------------------------------------------- recall() with stub retrievers
@pytest.fixture
def stub(monkeypatch):
    """recall() over fixed rankings. calls records each retriever call's filters."""
    s = SimpleNamespace(bm25={}, vec={}, best=0.20, persons=[], calls=[])

    def bm25_hits(query, threads=None, years=None, n=40):
        s.calls.append(("bm25", frozenset(threads or ()), frozenset(years or ())))
        return list(s.bm25.get(frozenset(threads or ()), []))

    def vector_hits(query, threads=None, years=None, n=30):
        s.calls.append(("vec", frozenset(threads or ()), frozenset(years or ())))
        vector_hits.best_distance = s.best if s.vec.get(frozenset(threads or ())) else 1.0
        return list(s.vec.get(frozenset(threads or ()), []))

    monkeypatch.setattr(yr, "_bm25_hits", bm25_hits)
    monkeypatch.setattr(yr, "_vector_hits", vector_hits)
    monkeypatch.setattr(yr, "_excerpt", lambda t, i: f"{t}#{i}")
    monkeypatch.setattr(yr.yp, "resolve_person", lambda q: s.persons)
    return s


def test_bm25s_best_hit_always_comes_first(stub):
    """A precise answer is often one line inside a window about something else, which
    vectors cannot see. RRF alone ranks the agreed moment B first; the lexical
    guarantee puts BM25's own best hit A ahead of it."""
    stub.bm25[frozenset()] = [("A", 50), ("B", 10)]
    stub.vec[frozenset()] = [("B", 10), ("C", 5)]
    assert yr._fuse(stub.bm25[frozenset()], stub.vec[frozenset()])[0][:2] == ("B", 10)
    assert yr.recall("q", k=3) == ["A#50", "B#10", "C#5"]


def test_the_gate_abstains_when_the_best_window_is_far(stub):
    stub.bm25[frozenset()] = [("A", 50)]
    stub.vec[frozenset()] = [("A", 52)]
    stub.best = yr.RECALL_MAX_DISTANCE + 0.01
    assert yr.recall("q") == []
    stub.best = yr.RECALL_MAX_DISTANCE - 0.01
    assert yr.recall("q") == ["A#50"]


def test_a_named_person_narrows_the_search(stub):
    stub.persons = [(SimpleNamespace(thread="P", name="Pat"), 100)]
    stub.bm25[frozenset({"P"})] = [("P", 3)]
    stub.vec[frozenset({"P"})] = [("P", 4)]
    stub.bm25[frozenset()] = [("Q", 9)]           # what an unfiltered search would find
    stub.vec[frozenset()] = [("Q", 9)]
    assert yr.recall("what did pat say?") == ["P#3"]
    assert stub.calls == [("bm25", frozenset({"P"}), frozenset()),
                          ("vec", frozenset({"P"}), frozenset())]


def test_a_person_with_nothing_on_it_falls_back_to_everyone(stub):
    """A person match is a preference, not a cage: if their threads hold nothing, the
    name match was probably wrong, so the whole archive is searched."""
    stub.persons = [(SimpleNamespace(thread="P", name="Pat"), 100)]
    stub.bm25[frozenset()] = [("Q", 9)]
    stub.vec[frozenset()] = [("Q", 9)]
    assert yr.recall("what did pat say about biryani?") == ["Q#9"]
    assert [c[1] for c in stub.calls] == [frozenset({"P"})] * 2 + [frozenset()] * 2


def test_a_year_in_the_question_filters_both_systems(stub):
    stub.bm25[frozenset()] = [("A", 1)]
    stub.vec[frozenset()] = [("A", 1)]
    yr.recall("2021 mein exam ke baare mein kya baat hui thi?")
    assert {c[2] for c in stub.calls} == {frozenset({2021})}

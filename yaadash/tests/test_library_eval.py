"""Does the study library find the right page, cite it, and keep quiet otherwise?

Builds the invented semester in library_corpus.py (4 lecture PDFs with one scanned
page, slides, a Word lab manual, Markdown notes, two warranty cards), ingests it, and
scores 20 questions with known source pages plus 5 the notes cannot answer:

    hit@1 / hit@5 / MRR   for BM25 only, vectors only, and the hybrid (RRF)
    gate                  unanswerable questions refused; answerable ones not refused
    citations             [n] in the answer maps back to the gold file + page
    latency               retrieval p50 / p90

Vectors use bge-small from the local Hugging Face cache when it is there (never
downloaded); otherwise a hashing stand-in, and the report says so. Citations are
scored with an extractive stand-in for the LLM (it quotes the best-matching sentence
and cites its passage), which tests numbering and mapping — not the 4B model's
judgement. The real model is scored by test_live_model_citations, which runs only
with JARVIS_LIVE_LLM=1 because it needs Ollama.

Run with -s to see the report.
"""
from __future__ import annotations

import os
import re
import time

import numpy as np
import pytest

import library as L
import library_corpus as C
from conftest import HashingEmbedder

# JARVIS_LIBRARY_TEST_EMBEDDER=hashing runs the stand-in even when bge is cached,
# so the fallback is exercised on a machine that has the model.
USE_BGE = L.bge_cached() and os.environ.get("JARVIS_LIBRARY_TEST_EMBEDDER") != "hashing"


def extractive_llm(system: str, user: str) -> str:
    """Stand-in for the LLM: the passage sentence that shares the most question
    words, cited with its passage number; NOT_IN_NOTES when nothing overlaps."""
    assert "ONLY the numbered passages" in system and L.NOT_IN_NOTES in system
    body, question = user.split("\n\nQUESTION: ", 1)
    q = set(L.query_terms(question))
    best = (0, None, "")
    for block in re.split(r"\n\n(?=\[\d+\] )", body.split("PASSAGES\n\n", 1)[1]):
        n = int(re.match(r"\[(\d+)\]", block).group(1))
        for s in L._sentences(block.split("\n", 1)[1]):
            score = len(q & set(L.tokens(s)))
            if score > best[0]:
                best = (score, n, s)
    if best[1] is None:
        return L.NOT_IN_NOTES
    return f"{best[2]} [{best[1]}]"


extractive_llm.model_name = "extractive stand-in (test)"


@pytest.fixture(scope="module")
def lib(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("eval")
    corpus = C.build_corpus(tmp / "corpus")
    emb = L.BgeEmbedder() if USE_BGE else HashingEmbedder()
    lib = L.Library(tmp / "library", embedder=emb, llm=extractive_llm)
    t0 = time.time()
    report = lib.ingest(corpus)
    lib.ingest_seconds = time.time() - t0
    lib.ingest_report = report
    return lib


def _rank_of_gold(hits, gold):
    for i, h in enumerate(hits, start=1):
        if C.is_hit(h, gold):
            return i
    return None


def _scores(lib, mode):
    ranks = [_rank_of_gold(lib.search(q, 10, mode), gold) for q, gold in C.QUESTIONS]
    n = len(ranks)
    return {"hit@1": sum(r == 1 for r in ranks) / n,
            "hit@5": sum(r is not None and r <= 5 for r in ranks) / n,
            "mrr": sum(1 / r for r in ranks if r) / n,
            "misses": [q for (q, _), r in zip(C.QUESTIONS, ranks) if not r or r > 5]}


def test_the_corpus_is_read_as_expected(lib):
    counts = lib.ingest_report["counts"]
    assert counts == {"added": 9}, counts           # png, lock file, .obsidian skipped
    docs = {d["file"]: d for d in lib.documents()}
    assert docs["DE_L1_Number_Systems.pdf"]["scanned"] == [4]
    assert "OCR not available" in " ".join(docs["DE_L1_Number_Systems.pdf"]["notes"])
    assert docs["DE_L5_FSM_slides.pptx"]["pages"] == 4
    assert docs["Digital_Lab_Manual.docx"]["pages"] == 2    # one hard page break
    # Every page, slide and section yields at least one passage (38 when measured).
    assert lib.status()["chunks"] >= 35


def test_retrieval_quality_and_report(lib):
    modes = {m: _scores(lib, m) for m in ("bm25", "vector", "hybrid")}

    gate_answerable = [lib.retrieve(q) for q, _ in C.QUESTIONS]
    gate_unanswerable = [lib.retrieve(q) for q in C.UNANSWERABLE]
    refused = sum(r.abstained for r in gate_unanswerable)
    false_refusals = [q for (q, _), r in zip(C.QUESTIONS, gate_answerable) if r.abstained]

    cited_ok, answers = 0, []
    for q, gold in C.QUESTIONS:
        res = lib.ask(q)
        answers.append(res)
        by_n = {s["n"]: s for s in res["sources"]}
        if res["used"] and C.is_hit(by_n[res["used"][0]], gold):
            cited_ok += 1
    asked_unanswerable = [lib.ask(q) for q in C.UNANSWERABLE]

    hinglish = [(q, lib.retrieve(q)) for q, _ in C.HINGLISH]
    hinglish_hits = sum(any(C.is_hit(h, gold) for h in r.hits) and not r.abstained
                        for (_, gold), (_, r) in zip(C.HINGLISH, hinglish))

    lat = []
    for q, _ in C.QUESTIONS * 3:
        t0 = time.perf_counter()
        lib.retrieve(q)
        lat.append((time.perf_counter() - t0) * 1000)
    p50, p90 = np.percentile(lat, [50, 90])

    vec_name = "bge-small-en-v1.5 (local cache)" if USE_BGE else "HASHING STAND-IN (bge-small not cached)"
    lines = [
        "",
        "=" * 72,
        f"Study library eval — synthetic corpus, {lib.status()['documents']} documents, "
        f"{lib.status()['chunks']} passages; vectors: {vec_name}",
        f"ingest {lib.ingest_seconds:.1f} s (includes loading the embedder)",
        f"{'mode':8s} {'hit@1':>6s} {'hit@5':>6s} {'MRR':>6s}",
    ]
    for m, s in modes.items():
        lines.append(f"{m:8s} {s['hit@1']:6.2f} {s['hit@5']:6.2f} {s['mrr']:6.2f}"
                     + (f"   misses@5: {s['misses']}" if s["misses"] else ""))
    lines += [
        f"gate: refused {refused}/{len(C.UNANSWERABLE)} unanswerable; "
        f"refused {len(false_refusals)}/{len(C.QUESTIONS)} answerable {false_refusals or ''}",
        "  unanswerable: " + "; ".join(f"d={r.best_distance:.3f} cov={r.coverage:.2f}"
                                       if r.best_distance is not None else f"cov={r.coverage:.2f}"
                                       for r in gate_unanswerable),
        "  answerable distance range: "
        + (f"{min(r.best_distance for r in gate_answerable):.3f}-{max(r.best_distance for r in gate_answerable):.3f}"
           if all(r.best_distance is not None for r in gate_answerable) else "n/a")
        + f", coverage min {min(r.coverage for r in gate_answerable):.2f}",
        f"citations (extractive stand-in for the LLM): {cited_ok}/{len(C.QUESTIONS)} cite the gold page",
        f"Hinglish phrasing: gold page in the top 5 and not refused {hinglish_hits}/{len(C.HINGLISH)}"
        + "".join(f"\n  {q} -> {'REFUSED ' + r.reason if r.abstained else 'ok'}" for q, r in hinglish
                  if r.abstained),
        f"retrieval latency p50 {p50:.1f} ms, p90 {p90:.1f} ms (n={len(lat)})",
        "=" * 72,
    ]
    print("\n".join(lines))

    # Floors, set just under what was measured on 2026-10-12 so a regression fails.
    hy, bm = modes["hybrid"], modes["bm25"]
    assert bm["hit@5"] >= 0.85
    assert hy["hit@5"] >= 0.95
    assert hy["mrr"] >= 0.8
    assert hy["hit@5"] >= max(bm["hit@5"], modes["vector"]["hit@5"]) - 0.05
    if USE_BGE:
        assert modes["vector"]["hit@5"] >= 0.85
        assert refused >= 4                          # every off-topic question, and most near ones
        assert len(false_refusals) <= 1
    else:                                            # the stand-in has no semantics
        assert refused >= 3
    assert cited_ok >= 16
    assert hinglish_hits >= 4
    if USE_BGE:
        # A one-word overlap is not evidence: "what time is it?" shares only "time".
        assert lib.retrieve("what time is it?").abstained
    # An abstention never carries citations, and the gate never calls the model.
    for res in asked_unanswerable:
        if res["abstained"]:
            assert res["used"] == [] and res["answer"] == L.NOT_IN_NOTES
    assert all(not a["invalid"] for a in answers)


@pytest.mark.skipif(os.environ.get("JARVIS_LIVE_LLM") != "1",
                    reason="needs the local model in Ollama; set JARVIS_LIVE_LLM=1")
def test_live_model_citations(lib):
    """The real 4B model behind ask(): how often its first citation is the gold page,
    whether it invents citation numbers, and whether it abstains on its own."""
    ok, any_ok, invalid, uncited, errors = 0, 0, 0, 0, []
    rows = []
    t0 = time.time()
    for q, gold in C.QUESTIONS:
        res = lib.ask(q, llm=L.ollama_llm)
        if res.get("llm_error"):
            errors.append(res["llm_error"])
            continue
        by_n = {s["n"]: s for s in res["sources"]}
        first = res["used"][0] if res["used"] else None
        ok += bool(first and C.is_hit(by_n[first], gold))
        any_ok += any(C.is_hit(by_n[n], gold) for n in res["used"])
        invalid += bool(res["invalid"])
        uncited += res["uncited"]
        rows.append((q, res["answer"]))
    unans = [lib.ask(q, llm=L.ollama_llm) for q in C.UNANSWERABLE]
    model_refusals = sum(r["abstained"] for r in unans)
    # The gate usually stops these before the model sees them. To test the
    # prompt's own "I don't know" rule, hand the model the five closest passages
    # anyway, as if the gate had let the question through.
    alone = []
    for q in C.UNANSWERABLE:
        system, user = L.build_prompt(q, lib._sources(lib.search(q, 5)))
        alone.append(L.parse_answer(L.ollama_llm(system, user), 5))
    model_only = sum(a["abstained"] for a in alone)
    took = time.time() - t0
    print("\n" + "=" * 72)
    print(f"LIVE {L.llm_name(L.ollama_llm)}: first citation on the gold page {ok}/{len(C.QUESTIONS)}, "
          f"gold page among citations {any_ok}/{len(C.QUESTIONS)}, answers with invented numbers {invalid}, "
          f"uncited {uncited}; unanswerable refused {model_refusals}/{len(C.UNANSWERABLE)} "
          f"(gate + model), by the model alone with the gate bypassed {model_only}/{len(C.UNANSWERABLE)}; "
          f"{took:.0f} s for {len(C.QUESTIONS) + 2 * len(C.UNANSWERABLE)} calls")
    for q, a in rows[:4]:
        print(f"  Q: {q}\n  A: {a}")
    for q, a in zip(C.UNANSWERABLE, alone):
        if not a["abstained"]:
            print(f"  gate bypassed, model answered anyway: {q}\n    -> {a['answer'][:200]}")
    print("=" * 72)
    assert not errors, errors[:2]
    assert any_ok >= 14
    assert model_refusals >= 4

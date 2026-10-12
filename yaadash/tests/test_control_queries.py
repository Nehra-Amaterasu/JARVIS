"""Control queries: the memory evaluation as a regression harness (ROADMAP F6).

The live-model audit (DECISIONS 2026-10-09, 193/198) needs Ollama and the real archive,
so it cannot run as a test. This is its retrieval half, which can: questions asked of
the synthetic history in synthetic_home.py through the real recall path (person and
year filters, BM25 + bge-small vectors, RRF, the lexical guarantee, the 0.32 gate,
dated excerpts). Each answerable question names the conversation that must come
back, and where; each unanswerable one must come back empty.

Distances below are bge-small cosine distances of the best window, measured on
2026-10-12; the gate is 0.32. They are recorded so a failure can be read: a query
that drifts across 0.32 is a gate problem, a wrong first excerpt is a ranking one.
"""
import pytest

import yaadash_recall as yr
import yaadash_v2 as y

pytestmark = pytest.mark.needs_bge

# (question, header of the excerpt that must come back, a line it must contain,
#  rank it must be at or above, what the question exercises, measured distance)
ANSWERABLE = [
    ("when did I complete dark souls?", "[24 Feb 2021 - chat with Dev Malhotra]",
     "i completed dark souls", 1, "first person + stemming + lexical guarantee", 0.257),
    ("maine kab dark souls complete kiya tha?", "[24 Feb 2021 - chat with Dev Malhotra]",
     "i completed dark souls", 1, "the same in Hinglish", 0.290),
    ("when did Ishaan finish dark souls?", "[03 May 2021 - chat with Ishaan Bose]",
     "completed dark souls bro", 1, "same topic, another person named", 0.222),
    ("when did I finish dark souls?", "[24 Feb 2021 - chat with Dev Malhotra]",
     "i completed dark souls", 3, "a synonym BM25 cannot match: top 3, not first", 0.238),
    ("yaad hai professor pineapple wala joke?", "[18 Jul 2022 - chat with Riya Kapoor]",
     "Professor Pineapple", 1, "rare-token joke", 0.254),
    ("Riya ke saath trek ki baat kab hui thi?", "[12 Mar 2021 - chat with Riya Kapoor]",
     "Triund", 1, "person filter; the date is the answer", 0.299),
    ("Dev ke saath trek ki baat yaad hai?", "[02 Jun 2023 - chat with Dev Malhotra]",
     "Hampta pass", 1, "person filter decides (unfiltered, Riya's trek wins)", 0.285),
    ("2021 mein Tanvi se VLSI exam ke baare mein kya baat hui thi?",
     "[20 Nov 2021 - chat with Tanvi Rao]", "setup and hold", 1, "person + year", 0.264),
    ("Kabir ne biryani recipe ke baare mein kya bola tha?", "[02 Oct 2022 - chat with Hostel Wing B]",
     "kewra water", 1, "named person has nothing: fall back to everyone", 0.274),
]

# Nothing in the history is about these. Recall must return nothing, not the nearest chat.
UNANSWERABLE = [
    ("yaad hai jab hum skydiving karne Dubai gaye the?", 0.401),
    ("what did we fight about last week?", 0.456),
    ("remember the joke about the purple elephant in the chemistry lab?", 0.462),
    ("when did I tell you about my trip to Japan?", 0.405),
    ("kya maine kabhi guitar seekhne ki baat ki thi?", 0.442),
    ("remember my conversation about the stock market crash?", 0.362),
]

# Real memories the gate refuses. The gate reads only the vector distance, so a
# precise BM25 match inside the named person's thread, or a paraphrase the vectors
# rank correctly, is thrown away once the best window sits above 0.32. Kept as strict
# xfails: the day the gate weighs BM25 evidence and these pass, the run says so.
KNOWN_GAPS = [
    ("remember the trek plan with Dev?", "[02 Jun 2023 - chat with Dev Malhotra]",
     "BM25 finds Hampta pass in Dev's thread; best window 0.358", 0.358),
    ("do you remember when we planned a hike to the mountains?", "[12 Mar 2021 - chat with Riya Kapoor]",
     "paraphrase: vectors rank Riya's trek first at 0.419, gate refuses", 0.419),
]


@pytest.mark.parametrize("q, header, line, rank, why, dist", ANSWERABLE, ids=[a[0] for a in ANSWERABLE])
def test_the_right_conversation_comes_back(store, harness_log, q, header, line, rank, why, dist):
    got = yr.recall(q, k=3)
    heads = [e.splitlines()[0] for e in got]
    hit = header in heads[:rank] and line in got[heads.index(header)]
    harness_log.append(("answer", q, hit))
    assert hit, (f"{why}: expected {header} in the top {rank}, got {heads} "
                 f"(best window {yr._vector_hits.best_distance:.3f}, measured {dist})")


@pytest.mark.parametrize("q, dist", UNANSWERABLE, ids=[u[0] for u in UNANSWERABLE])
def test_an_unanswerable_question_abstains(store, harness_log, q, dist):
    got = yr.recall(q, k=3)
    harness_log.append(("abstain", q, got == []))
    assert got == [], (f"returned {[e.splitlines()[0] for e in got]} for a memory that does not "
                       f"exist (best window {yr._vector_hits.best_distance:.3f}, measured {dist})")


@pytest.mark.xfail(strict=True, reason="the recall gate ignores BM25 evidence (see KNOWN_GAPS)")
@pytest.mark.parametrize("q, header, why, dist", KNOWN_GAPS, ids=[g[0] for g in KNOWN_GAPS])
def test_known_gap_the_gate_refuses_a_real_memory(store, harness_log, q, header, why, dist):
    heads = [e.splitlines()[0] for e in yr.recall(q, k=3)]
    harness_log.append(("known gap", q, header not in heads))
    assert header in heads, why


# ----------------------------------------------------------- the prompt block
def test_recall_context_for_a_person_and_a_past_event(store):
    block = yr.recall_context("Riya ke saath trek ki baat kab hui thi?")
    people, past = block.split("PAST CONVERSATIONS")
    assert people.startswith("PEOPLE MENTIONED") and "Riya Kapoor; closeness" in people
    assert "[12 Mar 2021 - chat with Riya Kapoor]" in past and "Aman: done, trek ki planning final" in past
    assert "NEVER stretch an excerpt to fit" in past


def test_recall_context_says_so_when_nothing_matches(store):
    block = yr.recall_context("yaad hai jab hum skydiving karne Dubai gaye the?")
    assert yr.RECALL_NOT_FOUND in block and "[" not in block


def test_recall_context_stays_out_of_everyday_questions(store):
    assert yr.recall_context("aaj mausam kaisa hai?") == ""
    assert yr.recall_context("what is the capital of Peru?") == ""


# -------------------------------------------------------- past-chat fragments
@pytest.mark.parametrize("q, want", [
    # JARVIS's own past reply (0.132) and a dev-session log (0.218) are nearer than
    # the real message (0.256); only the real message may come back.
    ("I bake sourdough on weekends, right?", "sourdough bread every weekend"),
    ("am I learning the tabla?", "learning the tabla"),          # 0.268
])
def test_a_relevant_fragment_is_found_and_only_it(store, q, want):
    rows = y.search_fragments(q)
    assert [r["text"] for r in rows if want in r["text"]] and len(rows) == 1
    assert rows[0]["source"].startswith("instagram:dm:")


@pytest.mark.parametrize("q", ["what is the capital of Peru?", "which instrument am I learning?"])
def test_a_distant_fragment_is_not_shown(store, q):
    """The 0.32 cutoff keeps colour out of unrelated answers. The second question is
    about a real fragment (tabla, 0.394) worded too far from it: fragments are
    optional colour, so the cutoff errs towards silence."""
    assert y.search_fragments(q) == []


def test_get_context_labels_facts_and_fragments(store):
    ctx = y.get_context("I bake sourdough on weekends, right?")
    facts, frags = ctx.split("PAST CHAT FRAGMENTS")
    assert facts.startswith("CONFIRMED FACTS ABOUT THE USER") and "His name is Test Owner." in facts
    assert "sourdough bread every weekend" in frags
    assert "JARVIS:" not in ctx and "push the bread timer" not in ctx

"""Wave EW11 refined after its first run (plan 9.0, 28 Nov): a paper's role, a question bank's unit, items that are not
questions, marks that are not printed, and the background run R-72 to R-74 (ww_pyq/prep.py, ww_pyq/assign.py,
routes_ww_pyq_prep.py, the role on R-04 in routes_ww_pyq.py, Store.replace_questions).

Every title, code and question here is invented in the shapes the real run showed ("<code>_CIE2SOLUTION_2026-27",
"<code>_Unit_4_Question_Bank", "UNIT3-QUESTION BANK_<code>"); no real text is copied. The store is under tmp_path, the
model a counting fake that answers from the prompt, and nothing reads the real data directory, the network, the local
model or the Claude tool.
"""
from __future__ import annotations

import json
import re
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq
from jarvis_app.ww_pyq import ingest, ledger, patterns, prep, tag
from jarvis_app.ww_pyq import next as pnext
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import NOT_PRINTED, Store
from pyq_fixtures import BY_NAME, build_pdf
from test_pyq_prep import B, SUBJECTS, WORDS, Model, add_q, env, envelope, old_reading, paper, seed_tags  # noqa: F401

LONG = "Derive the condition on the sampling rate that avoids aliasing of a band limited signal."
ANSWER = ("The sampling rate is twice the band limit, so the signal is rebuilt from its samples. " * 5).strip()


class QModel(Model):
    """The fake of test_pyq_prep, which also says `question: false` for a question holding one of `not_q`."""

    def __init__(self, not_q=(), **kw):
        super().__init__(**kw)
        self.not_q = set(not_q)

    def __call__(self, system, user):
        out = super().__call__(system, user)
        if "Topics (id: unit, topic)" not in user or self.raw is not None:
            return out
        d = json.loads(out)
        texts = dict(re.findall(r"^(Q\d+): (.+)$", user, re.M))
        for t in d["tags"]:
            t["question"] = not any(w in texts[t["q"]].lower() for w in self.not_q)
        return json.dumps(d)


class Gate:
    """A model whose call number `hold` waits until the test lets it go, so a stop arrives with that batch in hand."""

    def __init__(self, inner, hold=2):
        self.inner, self.hold, self.n = inner, hold, 0
        self.entered, self.go = threading.Event(), threading.Event()

    def __call__(self, system, user):
        self.n += 1
        if self.n == self.hold:
            self.entered.set()
            assert self.go.wait(30)
        return self.inner(system, user)


def tagged(st, qid, unit=1, topic="sampling theorem"):
    st.update_question(qid, {"unit": unit, "topic": topic, "tag_source": "rule"}, "rule")
    return qid


# ------------------------------------------------------------------ the rules on their own
def test_the_rules_read_roles_units_exams_and_items_that_are_not_questions():
    for title in ("ZX4101_CIE2SOLUTION_2026-27", "Sol of ZX4101_CIE2", "solution_ZX4101_Question_Paper_2026",
                  "ZX4101 answer key", "Marking scheme ZX4101", "ZX4101 CIE1 solutions"):
        assert prep.role_by_rule(title, f"{title}.pdf") == "solution", title
    for title in ("ZX4101_Unit_4_Question_Bank", "UNIT3-QUESTION BANK_ZX4101", "ZX4101_UNIT1QUESTIONBANK", "Signals QB unit 2"):
        assert prep.role_by_rule(title, f"{title}.pdf") == "question_bank", title
    assert prep.role_by_rule("Untitled", "zx4101_qb.pdf") == "question_bank"            # the file name speaks too
    assert prep.role_by_rule("Question bank solution", "") == "solution"                  # a solution first
    for plain in ("Image resolution end sem 2025", "ZX4101 CIE2 2026", "Solid state devices mid term", "Modulation schemes quiz"):
        assert prep.role_by_rule(plain, f"{plain}.pdf") == "", plain
    assert prep.unit_in_title("ZX4101_Unit_4_Question_Bank") == 4
    assert prep.unit_in_title("UNIT3-QUESTION BANK_ZX4101") == 3
    assert prep.unit_in_title("ZX4101_UNIT1QUESTIONBANK") == 1
    assert prep.unit_in_title("Question bank unit-iv") == 4
    for none in ("Question bank units 1 and 2", "Unit 1 and 2 question bank", "QB", "Community question bank", "Unit 1-2 bank"):
        assert prep.unit_in_title(none) is None, none
    assert prep.unit_in_title("Unit 2 bank", "unit_3.pdf") is None                        # two units named: none
    assert prep.exam_key("ZX4101_CIE2SOLUTION_2026-27") == prep.exam_key("ZX4101 CIE 2 paper") == "cie2"
    assert prep.exam_key("Signals mid sem 1") == "midsem1" and prep.exam_key("Untitled") == ""
    assert prep.looks_unasked("Q1 (a)") and prep.looks_unasked("OR") and prep.looks_unasked(ANSWER)
    assert not prep.looks_unasked("Define aliasing and give one example of it.")
    assert not prep.looks_unasked(ANSWER + " Explain why.") and not prep.looks_unasked(ANSWER + "?")
    assert not prep.looks_unasked("")                                                    # a picture is not judged by words


# ------------------------------------------------------------------ roles (R-66, R-04, R-65)
def test_roles_by_rule_only_with_apply_never_over_his_and_a_solution_names_its_paper(env):
    st = env.st
    p = paper(st, "ZX4101 CIE2 2026", "signals")
    add_q(st, p, "Explain the sampling theorem for a band limited signal of 4 kHz.")
    sol = paper(st, "ZX4101_CIE2SOLUTION_2026-27", "signals")
    add_q(st, sol, "The sampling theorem says a signal limited to 4 kHz needs a rate above 8 kHz.")
    add_q(st, sol, "Explain the sampling theorem for a band limited signal of 4 kHz.")
    bank = paper(st, "ZX4101_Unit_2_Question_Bank", "signals")
    mine = paper(st, "Sol of ZX4101 mid sem", "signals")
    st.update_paper(mine, {"role": "paper", "role_source": "hand"})                       # he says it is a paper
    j = env.c.post(f"{B}/subjects", json={}).json()
    envelope(j)
    roles = {r["paper"]: r["role"] for r in j["roles"]}
    assert roles == {sol: "solution", bank: "question_bank"} and j["role_counts"] == {"question_bank": 1, "solution": 1}
    assert j["pairs"] == [{"solution": sol, "paper": p, "exam": "cie2", "written": False}]
    assert "role" not in st.get_paper(sol) and "solution_of" not in st.get_paper(sol)    # apply false: nothing written
    env.c.post(f"{B}/subjects", json={"apply": True})
    s = st.get_paper(sol)
    assert (s["role"], s["role_source"], s["solution_of"], s["solution_of_source"]) == ("solution", "rule", p, "rule")
    assert (st.get_paper(bank)["role"], st.get_paper(bank)["role_source"]) == ("question_bank", "rule")
    assert (st.get_paper(mine)["role"], st.get_paper(mine)["role_source"]) == ("paper", "hand")
    snap = (st.root / "papers.json").read_text(encoding="utf-8")
    j = env.c.post(f"{B}/subjects", json={"apply": True}).json()
    assert (st.root / "papers.json").read_text(encoding="utf-8") == snap and j["roles"] == [] and j["pairs"] == []
    c = env.c.get(B).json()
    envelope(c)
    k = c["counts"]
    assert (k["papers"], k["questions"], k["question_banks"]) == (3, 1, 1)               # the solution is in no count
    assert k["solutions"] == {"papers": 1, "items": 2, "paired": 1} and "1 solution sheet with 2 items" in c["reason"]
    assert {r["subject"]: r["questions"] for r in k["by_subject"]}["signals"] == 1


def test_r04_sets_a_role_by_hand_and_refuses_one_it_does_not_know(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = FastAPI()
    routes_ww_pyq.register(app, SimpleNamespace(), SimpleNamespace(publish=lambda *a, **k: None))
    pid = paper(st, "ZX4101_CIE2SOLUTION_2026-27")
    with TestClient(app) as c:
        r = c.patch(f"/api/mission/pyq/papers/{pid}", json={"role": "question_bank"})
        assert r.status_code == 200 and (r.json()["paper"]["role"], r.json()["paper"]["role_source"]) == ("question_bank", "hand")
        for bad in ({"role": "answers"}, {"role": None}, {"role_source": "rule"}, {"solution_of": "p-x"}):
            assert c.patch(f"/api/mission/pyq/papers/{pid}", json=bad).status_code == 400, bad
    assert prep.role_of(st.get_paper(pid)) == "question_bank"


def test_a_solution_s_items_are_in_no_tag_no_acceptance_no_pattern_no_order_and_no_ledger(env):
    st = env.st
    sol = paper(st, "ZX4101 answer key", "signals")
    st.update_paper(sol, {"role": "solution", "role_source": "rule"})
    ids = [add_q(st, sol, f"Derive the sampling theorem condition number {i} for a band limited signal.") for i in range(4)]
    env.model.topic_by_word.update({"sampling": "sampling theorem"})
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert (j["solution_items"], j["rule"], j["model"]) == (4, 0, 0) and env.model.calls == []      # not even sent
    assert all(st.get_question(q)["tag_source"] == "none" for q in ids)
    for q in ids:
        tagged(st, q)
    prep.set_policy(st, True)
    j = env.c.post(f"{B}/accept", json={"subject": "signals"}).json()
    assert j["accepted"] == 0 and j["held"] == {"a solution sheet": 4}
    for q in ids:                                       # he may accept them by hand: they still count nowhere
        st.update_question(q, {"status": "accepted"})
    qs, ps = st.list_questions(subject="signals"), st.list_papers("signals")
    pat = patterns.compute_patterns(qs, ps)
    assert (pat["n_papers"], pat["n_questions"], pat["topics"]) == (0, 0, [])
    assert pnext.practise_next(pat, {}, 10 ** 9) == []                       # no topic in the counted order, so no sheet
    assert patterns.quiet_topics(qs, ps) == []
    led = ledger.build_ledger(tag.topics_of(SUBJECTS[0]), qs, ps, [], [])
    assert all(i["past_questions"] == 0 and i["papers_seen"] == 0 for i in led["items"])
    st.update_paper(sol, {"role": "paper", "role_source": "hand"})          # the role is the only difference
    pat = patterns.compute_patterns(st.list_questions(subject="signals"), st.list_papers("signals"))
    assert pat["n_papers"] == 1 and len(pat["topics"][0]["questions"]) == 4


# ------------------------------------------------------------------ a question bank's unit (R-68)
def test_a_question_bank_gives_its_unit_and_the_model_chooses_only_among_that_unit_s_topics(env):
    st = env.st
    bank = paper(st, "ZX4101_Unit_2_Question_Bank", "signals")
    st.update_paper(bank, {"role": "question_bank", "role_source": "rule"})
    q_low = add_q(st, bank, "Explain the low pass filter and draw its response.", marks=None)
    q_taper = add_q(st, bank, "Discuss the Hamming taper and its side lobes.", marks=None)
    q_other = add_q(st, bank, "Explain the sampling theorem with a sketch.", marks=None)   # unit 1 words in a unit 2 bank
    far = paper(st, "ZX4101_Unit_7_Question_Bank", "signals")
    st.update_paper(far, {"role": "question_bank", "role_source": "rule"})
    q_far = add_q(st, far, "Explain the sampling theorem once more here.", marks=None)
    env.model.topic_by_word.update({"hamming": "window design", "sampling": "sampling theorem", "low pass": "low pass filter"})
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    envelope(j)
    assert j["unit_from_title"] == 3 and "took the unit its title names" in j["reason"]
    a, b, c = st.get_question(q_low), st.get_question(q_taper), st.get_question(q_other)
    assert (a["unit"], a["topic"]) == (2, "low pass filter") and a["tag_source"] in ("rule", "model")
    assert (b["unit"], b["topic"], b["tag_source"], b["tag_model"]) == (2, "window design", "model", "fake:test-model")
    # the model named a unit 1 topic that was not on the list it was given: dropped, the unit from the title stays
    assert (c["unit"], c["topic"], c["tag_source"], c["unit_source"]) == (2, "", "rule", "title")
    assert st.get_question(q_far)["unit"] == 1                 # unit 7 is not in the syllabus: no unit written, tagged freely
    unit2 = [u for _, u in env.model.calls if "Hamming taper" in u][0]
    assert "unit 2, low pass filter" in unit2 and "unit 1" not in unit2
    snap = (st.root / "questions" / f"{bank}.json").read_text(encoding="utf-8")
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert (j["rule"], j["model"], j["unit_from_title"]) == (0, 0, 0)
    assert (st.root / "questions" / f"{bank}.json").read_text(encoding="utf-8") == snap      # safe twice


# ------------------------------------------------------------------ items that are not questions (R-68, R-70, R-65)
def test_items_that_are_not_questions_are_kept_out_by_rule_and_by_the_model(env):
    st = env.st
    pid = paper(st, "Signals end sem", "signals")
    short = add_q(st, pid, "Section B")
    long = add_q(st, pid, ANSWER)
    ans = add_q(st, pid, "A Hamming taper lowers the side lobes, as the figure shows.")
    real = add_q(st, pid, "Discuss the Hamming taper and its side lobes in detail.")
    model = QModel(not_q={"lowers"}, topic_by_word={"hamming": "window design"})
    env.app.state.pyq_prep_provider = model
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True}).json()
    assert j["not_question"] == 3 and all(not st.get_question(q).get("not_question") for q in (short, long, ans))
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    envelope(j)
    assert j["not_question"] == 3 and j["model"] == 1
    for q in (short, long):
        x = st.get_question(q)
        assert (x["not_question"], x["not_question_source"], x["tag_source"]) == (True, "rule", "none")
    x = st.get_question(ans)
    assert (x["not_question"], x["not_question_source"], x["not_question_model"], x["tag_source"]) == \
        (True, "model", "fake:test-model", "none")
    assert (st.get_question(real)["topic"], st.get_question(real)["tag_source"]) == ("window design", "model")
    sent = "\n".join(u for _, u in model.calls)
    assert "Section B" not in sent and "rebuilt from its samples" not in sent            # the rule's cases never go out
    n = len(model.calls)
    env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True})
    assert len(model.calls) == n                                                          # judged once, not asked again
    assert env.c.get(B).json()["counts"]["not_questions"] == 3
    for q in (long, ans):
        tagged(st, q, 2, "window design")
    prep.set_policy(st, True)
    j = env.c.post(f"{B}/accept", json={"subject": "signals"}).json()
    assert j["accepted"] == 1 and j["held"] == {"40 characters or fewer": 1, "not a question": 2}
    assert st.get_question(real)["status"] == "accepted" and st.get_question(ans)["status"] == "pending"


def test_the_validator_keeps_question_only_as_true_or_false():
    from jarvis_app import ww_counsel
    f = {"question_ids": "Q1,Q2", "topic_ids": "T1"}
    ok = ww_counsel.check_output("tag_topics", {"tags": [{"q": "Q1", "topic": "T1", "question": True},
                                                         {"q": "Q2", "topic": "none", "question": False}]}, f)
    assert ok == {"tags": [{"q": "Q1", "topic": "T1", "question": True}, {"q": "Q2", "topic": "none", "question": False}]}
    for bad in ("yes", 1, None):
        assert ww_counsel.check_output("tag_topics", {"tags": [{"q": "Q1", "topic": "T1", "question": bad}]}, f) is None


# ------------------------------------------------------------------ marks that are not printed (R-70)
def test_a_question_bank_question_is_accepted_without_marks_and_says_marks_not_printed(env):
    st = env.st
    bank = paper(st, "UNIT1-QUESTION BANK_ZX4101", "signals")
    st.update_paper(bank, {"role": "question_bank", "role_source": "rule"})
    other = paper(st, "Signals end sem", "signals")
    qb = tagged(st, add_q(st, bank, LONG, marks=None))
    plain = tagged(st, add_q(st, other, LONG + " Again.", marks=None))
    prep.set_policy(st, True)
    j = env.c.post(f"{B}/accept", json={"subject": "signals"}).json()
    envelope(j)
    assert (j["accepted"], j["unmarked"], j["held"]) == (1, 1, {"no marks": 1}) and "marks not printed" in j["reason"]
    q = st.get_question(qb)
    assert (q["status"], q["marks"], q["marks_source"], q["accepted_by"]) == ("accepted", None, NOT_PRINTED, "rule")
    assert st.get_question(plain)["status"] == "pending"
    with pytest.raises(ValueError):
        st.update_question(plain, {"status": "accepted"})          # an ordinary paper's question still needs its marks
    assert st.bank_for("signals") == []                             # the generator never meets a question without marks
    k = env.c.get(B).json()["counts"]
    assert (k["accepted_unmarked"], k["marks_not_printed"]) == (1, 1)
    assert env.c.post(f"{B}/accept", json={"subject": "signals"}).json()["accepted"] == 0      # safe twice
    assert env.c.post(f"{B}/unaccept", json={"subject": "signals"}).json()["returned"] == 1
    assert st.get_question(qb)["status"] == "pending"


# ------------------------------------------------------------------ Store.replace_questions
def test_replace_questions_is_all_or_none_and_before_can_keep_the_paper(tmp_path):
    st = Store(tmp_path / "pyq")
    pid, other = paper(st, "P"), paper(st, "Q")
    old = add_q(st, pid, "An old question text for this test paper.")
    theirs = add_q(st, other, "Another paper's own question text.")
    with pytest.raises(ValueError):
        st.replace_questions(pid, [{"text": "fine words"}, {"text": 5}])
    assert [q["id"] for q in st.list_questions(paper_id=pid)] == [old]

    def keep(cur):
        raise ValueError("kept")
    with pytest.raises(ValueError):
        st.replace_questions(pid, [{"text": "new words"}], keep)
    assert [q["id"] for q in st.list_questions(paper_id=pid)] == [old]
    seen = []
    ids = st.replace_questions(pid, [{"id": theirs, "text": "new words", "marks": 3, "status": "accepted"}], seen.append)
    assert [q["id"] for q in seen[0]] == [old] and ids[0] != theirs                   # an id another paper holds is not taken
    q = st.get_question(ids[0])
    assert (q["status"], q["marks"], q["paper_id"]) == ("pending", 3, pid) and st.get_question(theirs)["paper_id"] == other
    with pytest.raises(KeyError):
        st.replace_questions("p-nope", [])


def test_reread_stops_between_papers_and_never_leaves_one_half_replaced(env):
    a = ingest.ingest_pdf(build_pdf(BY_NAME["signals_basic"], env.tmp / "a"), store=env.st, meta={"subject": "signals"})["paper"]["id"]
    b = ingest.ingest_pdf(build_pdf(BY_NAME["circuits_sections"], env.tmp / "b"), store=env.st, meta={"subject": "circuits"})["paper"]["id"]
    old_reading(env.st, a)
    old_reading(env.st, b)
    b_before = (env.st.root / "questions" / f"{b}.json").read_text(encoding="utf-8")
    looks = iter([True])                               # looked at only between papers: once, before the second
    rows = prep.reread(env.st, [a, b], True, stop=lambda: next(looks))
    assert rows[0]["changed"] is True and rows[1]["reason"] == "Stopped before this paper."
    assert all(q["marks"] is not None for q in env.st.list_questions(paper_id=a))        # a whole: every mark back
    assert (env.st.root / "questions" / f"{b}.json").read_text(encoding="utf-8") == b_before


# ------------------------------------------------------------------ the run (R-72 to R-74)
def test_the_run_does_the_steps_in_order_in_the_background_and_answers_its_fields(env):
    st = env.st
    p = paper(st, "ZX4101 end sem")                               # no subject: the code rule finds signals
    add_q(st, p, "State and prove the sampling theorem; show the sampling rate needed.")
    add_q(st, p, "Discuss the use of a Hamming taper in spectral work.")
    env.model.topic_by_word.update(WORDS)
    prep.set_policy(st, True)
    assert env.c.get(f"{B}/run").json()["state"] == "waiting"
    r = env.c.post(f"{B}/run", json={"steps": ["accept", "tags", "subjects"], "use_model": True})
    assert r.status_code == 200, r.text
    envelope(r.json())
    job = env.app.state.pyq_prep_job.wait(60)
    assert job["status"] == "done" and job["steps"] == ["subjects", "tags", "accept"] and job["model"] == "fake:test-model"
    s = env.c.get(f"{B}/run").json()
    envelope(s)
    assert {k for k in ("status", "step", "done", "total", "counts_before", "counts_now", "seconds", "failures") if k in s} == \
        {"status", "step", "done", "total", "counts_before", "counts_now", "seconds", "failures"}
    assert (s["status"], s["failures"], s["step"]) == ("done", 0, "accept") and s["seconds"] >= 0
    b, n = s["counts_before"], s["counts_now"]
    assert (b["without_subject"], b["tagged"], b["accepted"]) == (1, 0, 0)
    assert (n["without_subject"], n["tagged"], n["accepted"]) == (0, 2, 2)
    q = {x["text"][:7]: x for x in st.list_questions(subject="signals")}
    assert (q["State a"]["tag_source"], q["Discuss"]["tag_source"], q["Discuss"]["accepted_by"]) == ("rule", "model", "rule")
    assert env.c.delete(f"{B}/run").status_code == 400                       # nothing is going
    for bad in ({"steps": []}, {"steps": ["cook"]}, {"steps": ["tags", "tags"]}, {"steps": "tags"}, {},
                {"steps": ["tags"], "use_model": "y"}, {"steps": ["tags"], "x": 1}, {"steps": ["tags"], "subjects": []},
                {"steps": ["tags"], "subjects": [3]}):
        assert env.c.post(f"{B}/run", json=bad).status_code == 400, bad
    assert env.c.post(f"{B}/run", json={"steps": ["tags"], "subjects": ["nope"]}).status_code == 404


def test_the_run_is_409_while_the_desk_or_ocr_reads_and_accept_off_says_so(env):
    env.app.state.pyq_ingest = SimpleNamespace(running=lambda: True)
    assert env.c.post(f"{B}/run", json={"steps": ["tags"]}).status_code == 409
    env.app.state.pyq_ingest, env.app.state.pyq_ocr = None, SimpleNamespace(running=lambda: True)
    assert env.c.post(f"{B}/run", json={"steps": ["tags"]}).status_code == 409
    env.app.state.pyq_ocr = None
    seed_tags(env.st)
    assert env.c.post(f"{B}/run", json={"steps": ["accept"]}).status_code == 200
    job = env.app.state.pyq_prep_job.wait(60)
    assert job["status"] == "done" and job["results"]["accept"] == {"on": False, "accepted": 0}
    assert "only you can turn it on" in env.c.get(f"{B}/run").json()["reason"] and env.model.calls == []


def test_a_failed_batch_is_counted_and_a_stop_ends_after_the_batch_in_hand(env):
    ids = seed_tags(env.st, extra=50)                  # 53 questions the rule leaves to the model: three batches
    env.model.topic_by_word.update(WORDS)
    env.model.fail_calls.add(1)                       # the first batch fails
    gate = Gate(env.model, hold=2)
    env.app.state.pyq_prep_provider = gate
    prep.set_policy(env.st, True)
    r = env.c.post(f"{B}/run", json={"steps": ["tags", "accept"], "subjects": ["signals"], "use_model": True})
    assert r.status_code == 200, r.text
    assert gate.entered.wait(30)                       # the second batch is in hand
    s = env.c.get(f"{B}/run").json()
    assert s["state"] == "live" and s["step"] == "tags" and s["total"] == 53 and s["done"] == 20
    assert env.c.post(f"{B}/run", json={"steps": ["tags"]}).status_code == 409
    assert env.c.post(f"{B}/tags", json={"subject": "signals", "apply": True}).status_code == 409
    assert env.c.post(f"{B}/tags", json={"subject": "signals"}).status_code == 200      # a look writes nothing: allowed
    assert env.c.post(f"{B}/accept", json={"subject": "signals"}).status_code == 409
    assert env.c.post(f"{B}/reread", json={}).status_code == 409
    assert env.c.post(f"{B}/subjects", json={"apply": True}).status_code == 409
    d = env.c.delete(f"{B}/run")
    assert d.status_code == 200 and d.json()["state"] == "waiting"
    gate.go.set()
    job = env.app.state.pyq_prep_job.wait(60)
    assert job["status"] == "stopped" and job["failures"] == 1 and gate.n == 2 and "accept" not in job["results"]
    by_model = [q for q in env.st.list_questions(subject="signals") if q["tag_source"] == "model"]
    assert len(by_model) == 20                                                  # the batch in hand was written whole
    assert env.st.get_question(ids["model"])["tag_source"] == "none"            # the failed batch's questions as they were
    assert not any(q["status"] == "accepted" for q in env.st.list_questions(subject="signals"))
    s = env.c.get(f"{B}/run").json()
    envelope(s)
    assert s["status"] == "stopped" and "1 failure" in s["reason"] and "failed" in s["reason"]

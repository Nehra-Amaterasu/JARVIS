"""Routes R-16 to R-18 (routes_ww_pyq_patterns.py). The routes are registered on a bare app with a fake plan
store (the subject, his taps and his logged marks); each test gets its own Store under tmp_path and every
paper is invented. One test goes through the real app to see the 503 of a plan that is not up."""
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_patterns as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import schema
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from test_pyq_patterns import CONV, FOUR, FORBIDDEN, ILAP, NYQ, ROC, SUBJECT, UNITS, five_papers, strings

B = "/api/mission/pyq"
FOOTER = "From papers on file. This prepares practice; it does not predict a paper or a result."


class FakePlan:
    def __init__(self, units=UNITS, marks=None, states=None):
        self.units, self.marks, self.states = units, marks or {}, states or {}

    def academics(self):
        return {"subjects": [{"id": "signals", "name": "Signals", "units": self.units},
                             {"id": "empty", "name": "Empty", "units": []}]}

    def load(self, today=None):
        return {"exam_prep": {"signals": {"topics": self.states}}, "paper_marks": {"signals": self.marks}}


def seed(st, papers, qs, subject="signals", tag_source="hand"):
    """Copy the in-memory fixture into the store; a question is accepted and tagged the way the fixture says."""
    pid_of = {}
    for p in papers:
        pid_of[p["id"]] = st.add_paper({"title": p["title"], "subject": subject, "year": p["year"], "total_marks": p["total_marks"],
                                        "kind": "hand", "method": "typed", "exam_kind": "cie", "pages": 0, "faults": [],
                                        "source_note": "test", "added": f"2026-01-{int(p['id'][2:]) + 1:02d}T00:00:00"})
    qid_of = {}
    for pid in pid_of:
        mine = [q for q in qs if q["paper_id"] == pid]
        if not mine:
            continue
        ids = st.add_questions(pid_of[pid], [{"text": q["text"], "marks": q["marks"], "marks_source": "hand", "section": "A"} for q in mine])
        for q, i in zip(mine, ids):
            qid_of[q["id"]] = i
            ch = {"status": "accepted"}
            if q["unit"] is not None:
                ch.update(unit=q["unit"], topic=q["topic"], tag_source=tag_source)
            st.update_question(i, ch, "rule")
    return pid_of, qid_of


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    plan = FakePlan()
    svc = SimpleNamespace(plan=plan)
    app = FastAPI()
    R.register(app, svc, SimpleNamespace(publish=lambda *a, **k: None))
    with TestClient(app) as c:
        yield c, st, plan


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]


# ------------------------------------------------------------------ R-16
def test_patterns_are_live_over_five_papers(env):
    c, st, _ = env
    papers, qs = five_papers()
    seed(st, papers, qs)
    r = c.get(f"{B}/patterns?subject=signals")
    assert r.status_code == 200, r.text
    j = r.json()
    envelope(j)
    assert j["state"] == "live" and j["footer"] == FOOTER and j["provisional"] is False
    p = j["patterns"]
    assert p["n_papers"] == 5 and p["n_questions"] == len(qs)
    by = {t["key"]: t for t in p["topics"]}
    assert (by[CONV]["k"], by[CONV]["n"], by[FOUR]["k"]) == (5, 5, 4)
    assert by[FOUR]["years_since"] == 1 and by[FOUR]["marks_weight"]["mean"] == 0.2
    assert p["quiet"] == {"r": 3, "topics": [NYQ]}
    assert j["floor"] == {"papers": 3, "questions": 20, "papers_needed": 0, "questions_needed": 0}
    assert {x["id"] for x in p["papers"]} == {pp["id"] for pp in st.list_papers("signals")}
    assert p["sentence"] == j["reason"] and "floor" not in p and "provisional" not in p


def test_patterns_wait_below_the_floor_with_the_counts_still_there(env):
    c, st, _ = env
    papers, qs = five_papers()
    keep = {"p-0", "p-1"}
    seed(st, [p for p in papers if p["id"] in keep], [q for q in qs if q["paper_id"] in keep])
    j = c.get(f"{B}/patterns?subject=signals").json()
    envelope(j)
    n_q = j["patterns"]["n_questions"]
    assert j["state"] == "waiting" and j["provisional"] is True
    assert j["reason"] == f"Too few papers to show a pattern: 1 more paper, {20 - n_q} more reviewed questions."
    assert j["patterns"]["n_papers"] == 2 and j["patterns"]["topics"]
    assert j["floor"]["papers_needed"] == 1 and j["floor"]["questions_needed"] == 20 - n_q


def test_patterns_with_no_papers_are_waiting_not_a_fault(env):
    c, *_ = env
    j = c.get(f"{B}/patterns?subject=signals").json()
    assert j["state"] == "waiting" and j["patterns"]["n_papers"] == 0 and j["patterns"]["topics"] == []
    assert "3 more papers" in j["reason"]


def test_patterns_errors(env):
    c, *_ = env
    assert c.get(f"{B}/patterns").status_code == 400
    assert c.get(f"{B}/patterns?subject=").status_code == 400
    r = c.get(f"{B}/patterns?subject=nothing")
    assert r.status_code == 404 and r.json()["detail"]


def test_a_paper_of_another_subject_is_not_counted(env):
    c, st, _ = env
    papers, qs = five_papers()
    seed(st, papers, qs)
    other = [{"id": "p-0", "title": "Other", "year": 2020, "total_marks": 50.0}]
    seed(st, other, [{"id": "q-o", "paper_id": "p-0", "text": "An other one.", "marks": 5, "unit": 1, "topic": "Convolution sum"}], subject="circuits")
    assert c.get(f"{B}/patterns?subject=signals").json()["patterns"]["n_papers"] == 5


# ------------------------------------------------------------------ R-17
def test_practise_next_prints_terms_and_defaults(env):
    c, st, _ = env
    papers, qs = five_papers()
    seed(st, papers, qs)
    j = c.get(f"{B}/practise-next?subject=signals&gap_minutes=120").json()
    envelope(j)
    assert j["state"] == "live" and j["defaults"] == {"minutes_per_mark": 3.0} and j["footer"] == FOOTER
    assert j["count"] == len(j["items"]) > 0
    for it in j["items"]:
        assert set(it) == {"key", "unit", "topic", "gain", "terms", "question_ids", "reason"}
        assert set(it["terms"]) == {"marks_weight", "seen_share", "proficiency", "measured", "minutes"}
        assert it["terms"]["measured"] is False and it["terms"]["proficiency"] == 0.5
        assert re.fullmatch(r"set in \d+ of 5 papers on file; no marked attempts", it["reason"])
    assert sum(it["terms"]["minutes"] for it in j["items"]) <= 120
    assert NYQ not in {it["key"] for it in j["items"]}


def test_marked_attempts_make_a_proficiency_measured(env):
    c, st, plan = env
    papers, qs = five_papers()
    seed(st, papers, qs)
    plan.marks = {CONV: [{"got": 9, "max": 10}] * 5, FOUR: [{"got": 4, "max": 10}] * 2}
    plan.states = {CONV: {"state": "solid"}}
    items = {it["key"]: it for it in c.get(f"{B}/practise-next?subject=signals&gap_minutes=600").json()["items"]}
    assert items[CONV]["terms"]["measured"] is True and items[CONV]["terms"]["proficiency"] > 0.8
    assert items[CONV]["reason"].endswith("5 marked attempts")
    assert items[FOUR]["terms"]["measured"] is False and items[FOUR]["terms"]["proficiency"] == 0.5     # two attempts are too few
    assert items[FOUR]["reason"].endswith("2 marked attempts")


def test_practise_next_below_the_floor_waits(env):
    c, st, _ = env
    papers, qs = five_papers()
    keep = {"p-0", "p-1"}
    seed(st, [p for p in papers if p["id"] in keep], [q for q in qs if q["paper_id"] in keep])
    j = c.get(f"{B}/practise-next?subject=signals").json()
    assert j["state"] == "waiting" and j["provisional"] is True and j["reason"].startswith("Too few papers")


def test_practise_next_with_no_topic_of_three_questions_says_so(env):
    c, st, plan = env
    plan.units = [{"n": i, "title": f"Unit {i}", "exam_weight": "med", "topics": [f"Topic {i}"]} for i in range(1, 12)]
    papers = [{"id": f"p-{i}", "title": f"T{i}", "year": 2020 + i, "total_marks": 50.0} for i in range(3)]
    qs = [{"id": f"q-{i}-{j}", "paper_id": f"p-{(i + j) % 3}", "text": f"Question {i} {j} about topic {i}.", "marks": 5, "unit": i, "topic": f"Topic {i}"}
          for i in range(1, 12) for j in range(2)]
    seed(st, papers, qs)
    j = c.get(f"{B}/practise-next?subject=signals").json()
    assert j["provisional"] is False and j["state"] == "waiting" and j["items"] == []
    assert j["reason"] == "No topic has 3 reviewed questions yet."


def test_practise_next_validates_the_gap_and_the_subject(env):
    c, *_ = env
    assert c.get(f"{B}/practise-next?subject=signals&gap_minutes=0").status_code == 400
    assert c.get(f"{B}/practise-next?subject=signals&gap_minutes=99999").status_code == 400
    assert c.get(f"{B}/practise-next?subject=signals&gap_minutes=abc").status_code == 422
    assert c.get(f"{B}/practise-next").status_code == 400
    assert c.get(f"{B}/practise-next?subject=nope").status_code == 404


# ------------------------------------------------------------------ R-18
def pending_paper(st, texts, subject="signals"):
    pid = st.add_paper({"title": "Draft", "subject": subject, "kind": "hand", "method": "typed", "exam_kind": "cie", "pages": 0, "faults": []})
    ids = st.add_questions(pid, [{"text": t, "marks": 5, "marks_source": "hand"} for t in texts])
    return pid, ids


TEXTS = ["Find the convolution sum of two finite sequences.", "Explain the idea of a transform in your own words.",
         "State the Nyquist sampling theorem."]


def test_suggest_by_paper_lists_candidates_and_writes_nothing_without_apply(env):
    c, st, _ = env
    pid, ids = pending_paper(st, TEXTS)
    j = c.post(f"{B}/tags/suggest", json={"paper": pid}).json()
    envelope(j)
    assert j["state"] == "live" and j["applied"] == 0 and j["count"] == 3
    by = {it["id"]: it for it in j["items"]}
    assert by[ids[0]]["tag_source"] == "rule" and (by[ids[0]]["unit"], by[ids[0]]["topic"]) == (1, "Convolution sum")
    assert by[ids[1]]["tag_source"] == "none" and by[ids[1]]["unit"] is None and 1 <= len(by[ids[1]]["candidates"]) <= 3
    assert by[ids[2]]["tag_source"] == "rule" and by[ids[2]]["topic"] == "Nyquist sampling theorem"
    assert all(set(it) >= {"id", "unit", "topic", "score", "margin", "tag_source", "candidates"} for it in j["items"])
    assert all(st.get_question(i)["tag_source"] == "none" for i in ids)


def test_apply_writes_only_certain_rule_tags(env):
    c, st, _ = env
    pid, ids = pending_paper(st, TEXTS)
    j = c.post(f"{B}/tags/suggest", json={"ids": ids, "apply": True}).json()
    assert j["applied"] == 2 and j["reason"] == "Tagged 2 of 3 questions by rule."
    a, b, d = (st.get_question(i) for i in ids)
    assert (a["unit"], a["topic"], a["tag_source"]) == (1, "Convolution sum", "rule") and a["tag_score"] >= 0.25 and a["tag_margin"] >= 0.15
    assert b["tag_source"] == "none" and b["unit"] is None and b["topic"] == ""
    assert (d["unit"], d["topic"], d["tag_source"]) == (3, "Nyquist sampling theorem", "rule")
    again = c.post(f"{B}/tags/suggest", json={"ids": ids, "apply": True}).json()
    assert again["applied"] == 0                                           # the same tags are not written twice


def test_apply_never_overwrites_a_tag_he_set_by_hand(env):
    c, st, _ = env
    pid, ids = pending_paper(st, TEXTS)
    st.update_question(ids[0], {"unit": 2, "topic": "Region of convergence"}, "hand")      # the store marks it "hand"
    assert st.get_question(ids[0])["tag_source"] == "hand"
    j = c.post(f"{B}/tags/suggest", json={"paper": pid, "apply": True}).json()
    assert j["applied"] == 1
    kept = st.get_question(ids[0])
    assert (kept["unit"], kept["topic"], kept["tag_source"]) == (2, "Region of convergence", "hand")
    first = next(it for it in j["items"] if it["id"] == ids[0])
    assert first["held_by_hand"] is True


def test_suggest_errors(env):
    c, st, plan = env
    assert c.post(f"{B}/tags/suggest", json={}).status_code == 400
    assert c.post(f"{B}/tags/suggest", json={"ids": []}).status_code == 400
    assert c.post(f"{B}/tags/suggest", json={"ids": "q-1"}).status_code == 400
    assert c.post(f"{B}/tags/suggest", json={"ids": ["q-1"], "apply": "yes"}).status_code == 400
    assert c.post(f"{B}/tags/suggest", json={"ids": ["q-nope"]}).status_code == 404
    assert c.post(f"{B}/tags/suggest", json={"paper": "p-nope"}).status_code == 404
    nos = st.add_paper({"title": "No subject", "kind": "hand", "method": "typed", "exam_kind": "cie", "pages": 0, "faults": []})
    st.add_questions(nos, [{"text": "A question with no subject.", "marks": 5, "marks_source": "hand"}])
    r = c.post(f"{B}/tags/suggest", json={"paper": nos})
    assert r.status_code == 400 and "subject" in r.json()["detail"]
    ghost, ids = pending_paper(st, TEXTS, subject="ghost")
    assert c.post(f"{B}/tags/suggest", json={"paper": ghost}).status_code == 404       # the subject is not in the plan


def test_a_subject_without_syllabus_topics_waits(env):
    c, st, _ = env
    pid, ids = pending_paper(st, TEXTS, subject="empty")
    j = c.post(f"{B}/tags/suggest", json={"paper": pid, "apply": True}).json()
    assert j["state"] == "waiting" and j["reason"] == "This subject has no syllabus topics yet." and j["applied"] == 0
    assert all(st.get_question(i)["tag_source"] == "none" for i in ids)


# ------------------------------------------------------------------ envelope, wording, table
def test_no_payload_string_holds_a_forbidden_word(env):
    c, st, plan = env
    papers, qs = five_papers()
    seed(st, papers, qs)
    plan.marks = {CONV: [{"got": 9, "max": 10}] * 5}
    pid, ids = pending_paper(st, TEXTS)
    answers = [c.get(f"{B}/patterns?subject=signals").json(), c.get(f"{B}/practise-next?subject=signals&gap_minutes=300").json(),
               c.post(f"{B}/tags/suggest", json={"paper": pid}).json(), c.get(f"{B}/patterns?subject=empty").json()]
    for a in answers:
        envelope(a)
        a.pop("footer", None)                            # the fixed footer is the one place that says "predict"
        for s in strings(a):
            for w in FORBIDDEN:
                assert w not in s.lower(), (w, s)
    assert R.FOOTER == FOOTER


def test_the_docstring_table_lists_exactly_the_routes_the_file_defines():
    src = Path(R.__file__).read_text(encoding="utf-8")
    doc = src.split('"""', 2)[1]
    rows = set(re.findall(r"^\s{2,}(GET|POST|PUT|DELETE|PATCH)\s+(/api/\S+?)(?:\?\S*)?\s", doc, re.M))
    defined = {(m.upper(), p) for m, p in re.findall(r'@app\.(get|post|put|delete|patch)\(\s*"([^"]+)"', src)}
    assert rows == defined and len(defined) == 3


def test_a_plan_that_is_not_up_is_503_through_the_real_app(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "default_store", lambda: Store(tmp_path / "pyq"))
    app = create_app(Guard(8777, "t" * 32, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_patterns"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": "t" * 32})
        assert c.get(f"{B}/patterns?subject=signals").status_code == 503
        assert c.get(f"{B}/practise-next?subject=signals").status_code == 503
        assert c.get(f"{B}/patterns?subject=signals", headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


def test_the_gate_reads_the_new_routes_file():
    from jarvis_app import ww_check
    assert any(Path(f).name == "routes_ww_pyq_patterns.py" for f in ww_check.DOC_FILES)


def test_the_waiting_reason_says_how_many_accepted_questions_have_no_topic(env):
    c, st, _ = env
    pid = st.add_paper({"title": "Untagged", "subject": "signals", "year": 2024, "total_marks": 20.0, "kind": "hand",
                        "method": "typed", "exam_kind": "cie", "pages": 0, "faults": [], "source_note": "test",
                        "added": "2026-01-01T00:00:00"})
    ids = st.add_questions(pid, [{"text": f"Explain idea number {i} of the course.", "marks": 5, "marks_source": "hand", "section": "A"}
                                 for i in range(2)])
    for i in ids:
        st.update_question(i, {"status": "accepted"}, "rule")
    j = c.get(f"{B}/patterns?subject=signals").json()
    assert j["state"] == "waiting" and j["patterns"]["n_untagged"] == 2
    assert j["reason"].endswith("2 accepted questions have no topic yet.")

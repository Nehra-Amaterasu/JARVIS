"""Questions the local model drafts from his notes (ww_pyq/drafts.py, routes R-50 to R-52 and R-35), and the syllabus
weight in the counted order of topics (R-17). The model is a fake that answers what the test says; nothing calls a real one.
"""
import json
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import jarvis_app.routes_ww_pyq_drafts as R
from jarvis_app import germoney as g
from jarvis_app import ww_counsel
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import drafts, next as pnext, settings
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Filters", "topics": ["low pass filter"], "exam_weight": "low"}]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "signals", "name": "Signals", "kind": "current", "question_bank": [], "units": UNITS}]}
NOTE = ("# Unit 1\n\nThe sampling theorem states that a band-limited signal can be rebuilt from its samples when the sampling "
        "rate is more than twice the highest frequency present in the signal.\n\nAliasing appears when the rate is too low, and "
        "high frequencies fold back onto low ones in the sampled spectrum of the signal.\n\nShort line.\n")
NOTES = [{"file_id": "f1", "title": "Unit 1 notes", "text": NOTE}, {"file_id": "f2", "title": "Lab sheet", "text": "Nothing about it here at all, only the lab rules and the timings of the lab."}]
GOOD = ["Explain why a signal must be sampled faster than twice its top frequency.", "What goes wrong in a recording when the rate is chosen too low?"]


class Model:
    def __init__(self, answer=None, fail=False):
        self.answer, self.fail, self.calls = answer if answer is not None else {"questions": GOOD}, fail, []

    def __call__(self, system, user):
        self.calls.append((system, user))
        if self.fail:
            raise ConnectionError("no model here")
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


def make(st, model, **kw):
    args = dict(subject="signals", topic="sampling theorem", unit=1, unit_title="Sampling", count=2, notes=NOTES, provider=model)
    args.update(kw)
    return drafts.draft_from_notes(st, **args)


def test_passages_are_the_paragraphs_that_mention_the_topic_and_name_their_notes():
    text, sources = drafts.passages(NOTES, "sampling theorem", "Sampling")
    assert "band-limited signal" in text and "Aliasing appears" not in text and "lab rules" not in text
    assert sources == [{"file_id": "f1", "title": "Unit 1 notes"}]
    assert drafts.passages(NOTES, "routh criterion") == ("", [])
    assert len(drafts.passages([{"file_id": "x", "title": "t", "text": ("the sampling theorem again and again. " * 40 + "\n\n") * 30}], "sampling theorem", limit=3000)[0]) <= 3000


def test_drafts_arrive_pending_name_their_notes_and_the_model_saw_only_the_passages(tmp_path):
    st, m = Store(tmp_path / "pyq"), Model()
    r = make(st, m)
    assert r["state"] == "live" and r["reason"] == "2 drafts to review, written from 1 of your notes."
    for d in r["items"]:
        assert d["status"] == "pending" and d["origin"] == "model-draft" and d["sources"] == [{"file_id": "f1", "title": "Unit 1 notes"}]
        assert d["checks"]["copied"] is False and (d["unit"], d["topic"], d["marks"]) == (1, "sampling theorem", None)
    system, user = m.calls[0]
    assert "never an answer" in system and "band-limited" in user and "lab rules" not in user
    assert st.bank_for("signals") == [] and st.list_papers() == []               # nothing became a question
    assert make(st, m)["state"] == "waiting"                                     # the same two drafts again are not stored twice
    assert len(drafts.list_drafts(st, "signals")) == 2


def test_a_draft_that_copies_the_notes_is_set_aside_with_the_reason(tmp_path):
    st = Store(tmp_path / "pyq")
    lifted = "The sampling theorem states that a band-limited signal can be rebuilt from its samples when the sampling rate is more than twice the highest frequency present in the signal."
    r = make(st, Model({"questions": [lifted, GOOD[0]]}))
    by = {d["text"]: d for d in r["items"]}
    assert by[lifted]["status"] == "rejected" and by[lifted]["checks"]["copied"] is True and "copy of the notes" in by[lifted]["reason"]
    assert by[GOOD[0]]["status"] == "pending" and "1 copied the notes and was set aside." in r["reason"]


@pytest.mark.parametrize("answer", [
    {"questions": [{"text": GOOD[0], "answer": "Because of Nyquist."}]},
    {"questions": GOOD, "grade": 7},
    {"questions": [{"text": GOOD[0], "marks": 5}]},
    {"questions": ["Answer: twice the top frequency."]},
    {"questions": [GOOD[0] + " Solution: use the theorem."]},
    {"questions": [{"text": GOOD[0], "probability": 0.8}]},
    {"topic": "a new topic", "questions": GOOD},
    {"questions": "not a list"},
    "I am sorry, I cannot do that.",
])
def test_an_answer_that_brings_more_than_questions_is_refused_whole(tmp_path, answer):
    st = Store(tmp_path / "pyq")
    r = make(st, Model(answer))
    assert r["state"] == "fault" and r["items"] == [] and drafts.list_drafts(st) == []
    if isinstance(answer, dict):
        assert ww_counsel.check_output("question_drafts", answer, {}) is None


def test_no_model_no_notes_and_rules_only_each_say_so_and_invent_nothing(tmp_path):
    st = Store(tmp_path / "pyq")
    assert make(st, Model(fail=True)) == {"state": "waiting", "reason": "The local model is not running.", "items": []}
    assert make(st, Model(), topic="routh criterion")["reason"] == "No note of this subject mentions this topic."
    settings.save(st, True)
    m = Model()
    assert make(st, m) == {"state": "planned", "reason": "Drafting is off: rules only.", "items": []} and m.calls == []
    with pytest.raises(ValueError):
        make(st, Model(), count=9)


def test_accepting_needs_marks_makes_one_question_marked_as_drafted_and_rejecting_keeps_it_on_file(tmp_path):
    st = Store(tmp_path / "pyq")
    a, b = make(st, Model())["items"]
    with pytest.raises(ValueError, match="Give its marks first"):
        drafts.decide(st, a["id"], {"status": "accepted"})
    assert st.list_papers() == []
    r = drafts.decide(st, a["id"], {"status": "accepted", "marks": 5})
    q = r["question"]
    assert q["status"] == "accepted" and q["status_by"] == "hand" and q["origin"] == "model-draft" and q["marks"] == 5
    assert (q["unit"], q["topic"]) == (1, "sampling theorem") and r["draft"]["question_id"] == q["id"]
    paper = st.get_paper(q["paper_id"])
    assert paper["title"] == "Drafts" and paper["subject"] == "signals" and "drafted by the local model" in paper["source_note"]
    assert [x["id"] for x in st.bank_for("signals")] == [q["id"]]
    with pytest.raises(ValueError, match="already a question"):
        drafts.decide(st, a["id"], {"status": "accepted", "marks": 5})
    assert drafts.decide(st, b["id"], {"status": "rejected"})["question"] is None
    assert {d["status"] for d in drafts.list_drafts(st, "signals")} == {"accepted", "rejected"} and len(st.list_papers()) == 1
    for bad in ("d-zzzzzzzzzzzz", "../x", "d-000000000000"):
        with pytest.raises(KeyError):
            drafts.decide(st, bad, {"status": "rejected"})
    with pytest.raises(ValueError):
        drafts.decide(st, b["id"], {"status": "accepted", "marks": 5, "grade": 9})


def topic(key, unit, mw=0.2):
    return {"key": key, "unit": unit, "topic": key.split("|")[1], "k": 3, "n": 4, "marks_weight": {"mean": mw}, "typical_marks": 5, "questions": ["a", "b", "c"]}


def test_the_syllabus_weight_is_a_printed_term_and_moves_the_counted_order():
    ps = {"topics": [topic("1|alpha", 1), topic("2|beta", 2)]}
    plain = pnext.practise_next(ps, {}, 60)
    assert [p["key"] for p in plain] == ["1|alpha", "2|beta"] and all(p["terms"]["syllabus_weight"] == 2 for p in plain)
    weighted = pnext.practise_next(ps, {}, 60, weights={"1|alpha": 1, "2|beta": 3})
    assert [p["key"] for p in weighted] == ["2|beta", "1|alpha"]
    by = {p["key"]: p for p in weighted}
    assert by["2|beta"]["terms"]["syllabus_weight"] == 3 and by["2|beta"]["gain"] == pytest.approx(plain[1]["gain"] * 1.5)
    assert by["1|alpha"]["gain"] == pytest.approx(plain[0]["gain"] * 0.5)
    assert pnext.practise_next(ps, {}, 60, weights={"1|alpha": 9})[0]["terms"]["syllabus_weight"] == 2      # a weight that is not 1, 2 or 3 is not used


@pytest.fixture()
def client(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(R, "notes_of", lambda subject: NOTES if subject == "signals" else [])
    bdir = tmp_path / "bankfiles"
    bdir.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, bdir / n)
    bank = g.load_bank(bdir)
    plan = g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank,
                  academics_loader=lambda: json.loads(json.dumps(ACADEMICS)), apps=g.Applications(calendar=tmp_path / "c.json", store=tmp_path / "a.json"))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq", "ww_pyq_drafts"])
    app.state.svc.plan = plan
    app.state.pyq_draft_provider = Model()
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, app


def test_the_routes_answer_with_the_envelope_and_are_in_the_docstring(client):
    c, st, app = client
    for row in ("POST   /api/mission/pyq/drafts/from-notes", "GET    /api/mission/pyq/drafts", "PATCH  /api/mission/pyq/drafts/{did}",
                "GET    /api/mission/pyq/settings", "PUT    /api/mission/pyq/settings"):
        assert row in R.__doc__
    assert c.get(f"{B}/drafts").json()["reason"] == "No draft on file."
    j = c.post(f"{B}/drafts/from-notes", json={"subject": "signals", "topic": "Sampling Theorem", "count": 2}).json()
    assert j["state"] == "live" and j["count"] == 2 and j["source"] and j["items"][0]["status"] == "pending"
    assert c.post(f"{B}/drafts/from-notes", json={"subject": "signals", "topic": "black holes"}).status_code == 400
    assert c.post(f"{B}/drafts/from-notes", json={"subject": "nope", "topic": "aliasing"}).status_code == 404
    lst = c.get(f"{B}/drafts", params={"subject": "signals", "status": "pending"}).json()
    assert lst["reason"] == "2 drafts are waiting for your review." and lst["count"] == 2
    did = lst["items"][0]["id"]
    assert c.patch(f"{B}/drafts/{did}", json={"status": "accepted"}).json()["detail"] == "Give its marks first."
    assert c.patch(f"{B}/drafts/{did}", json={"status": "accepted", "marks": 5, "topic": "black holes"}).status_code == 400
    ok = c.patch(f"{B}/drafts/{did}", json={"status": "accepted", "marks": 5}).json()
    assert ok["state"] == "live" and ok["question"]["origin"] == "model-draft" and len(st.bank_for("signals")) == 1
    assert c.patch(f"{B}/drafts/d-000000000000", json={"status": "rejected"}).status_code == 404


def test_the_rules_only_switch_keeps_the_model_from_being_asked(client):
    c, st, app = client
    assert c.get(f"{B}/settings").json()["settings"] == {"rules_only": False}
    assert c.put(f"{B}/settings", json={"rules_only": "yes"}).status_code == 400
    j = c.put(f"{B}/settings", json={"rules_only": True}).json()
    assert j["settings"] == {"rules_only": True} and j["reason"] == "Rules only: the model is never asked."
    r = c.post(f"{B}/drafts/from-notes", json={"subject": "signals", "topic": "aliasing"}).json()
    assert r["state"] == "planned" and r["reason"] == "Drafting is off: rules only." and app.state.pyq_draft_provider.calls == []

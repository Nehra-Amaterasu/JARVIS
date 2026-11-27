"""Rubric points of a question (ww_pyq/rubric.py, routes R-32 to R-34 in routes_ww_pyq_variants.py), against the X07
acceptance list of plan 9.2.6. The model is a fake that counts its calls; every store is a scratch folder; the question is
invented.
"""
import json

import pytest
from starlette.testclient import TestClient

from jarvis_app import ww_counsel
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import api, drafts, rubric, settings
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
TEXT = "Explain the sampling theorem and show what happens to a signal sampled below twice its top frequency."
GOOD = {"points": [{"text": "States the theorem with the two-times rate", "marks": 2},
                   {"text": "Shows the spectrum folding back when sampled too slowly", "marks": 2},
                   {"text": "Names aliasing as the effect", "marks": 1}]}


class Model:
    def __init__(self, answer=None, fail=False):
        self.answer, self.fail, self.calls = answer if answer is not None else GOOD, fail, []

    def __call__(self, system, user):
        self.calls.append((system, user))
        if self.fail:
            raise ConnectionError("no model here")
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


def seed(st, text=TEXT, marks=5):
    pid = st.add_paper({"kind": "hand", "method": "typed", "title": "Invented paper", "subject": "signals", "exam_kind": "end",
                        "year": 2025, "pages": 1, "faults": [], "source_note": "test"})
    return st.add_questions(pid, [{"label": "1", "text": text, "marks": marks, "type": "descriptive"}])[0]


@pytest.fixture()
def st(tmp_path):
    return Store(tmp_path / "pyq")


def test_a_model_rubric_arrives_pending_and_only_his_put_accepts_it(st):
    qid = seed(st)
    assert rubric.get(st, qid) is None
    m = Model()
    r = rubric.draft(st, qid, m)
    rec = r["rubric"]
    assert r["state"] == "live" and "adding up to 5" in r["reason"]
    assert rec["status"] == "pending" and rec["origin"] == "model-draft" and rec["sum"] == 5 and rec["difference"] == 0
    assert rec["question_id"] == qid and len(rec["points"]) == 3
    system, user = m.calls[0]
    assert "add up to the question's marks" in system and "Marks: 5" in user and TEXT in user
    assert rubric.get(st, qid)["status"] == "pending"
    acc = rubric.put(st, qid, rec["points"])                      # accepted exactly as drafted: still the model's
    assert acc["status"] == "accepted" and acc["origin"] == "model-draft" and acc["made"] == rec["made"]
    with pytest.raises(ValueError, match="you accepted"):
        rubric.draft(st, qid, Model())                            # a new draft never replaces his rubric


def test_a_changed_or_hand_written_rubric_is_his(st):
    qid = seed(st)
    rec = rubric.draft(st, qid, Model())["rubric"]
    pts = [dict(p) for p in rec["points"]]
    pts[2]["text"] = "Names aliasing and how a filter before the sampler stops it"
    assert rubric.put(st, qid, pts)["origin"] == "hand"
    other = seed(st)
    assert rubric.put(st, other, [{"text": "The whole idea in one line", "marks": 5}])["origin"] == "hand"


# ------------------------------------------------------------------ (4) the points must add up
def test_a_model_draft_that_does_not_add_up_is_returned_with_the_difference_and_stays_pending(st):
    qid = seed(st)
    short = {"points": GOOD["points"][:2]}
    r = rubric.draft(st, qid, Model(short))
    assert r["state"] == "live" and r["rubric"]["status"] == "pending" and r["rubric"]["sum"] == 4 and r["rubric"]["difference"] == -1
    assert "add up to 4, not 5" in r["reason"]
    with pytest.raises(ValueError, match="add up to 4, not the question's 5"):
        rubric.put(st, qid, short["points"])
    assert rubric.get(st, qid)["status"] == "pending"


@pytest.mark.parametrize("points, match", [
    ([], "1 to 6 points"),
    ([{"text": f"Point {i}", "marks": 0.5} for i in range(10)], "1 to 6 points"),
    ([{"text": "", "marks": 5}], "text is 1 to"),
    ([{"text": "   ", "marks": 5}], "text is 1 to"),
    ([{"text": "x" * 301, "marks": 5}], "text is 1 to"),
    ([{"text": "A point", "marks": 0}, {"text": "Another", "marks": 5}], "marks are a number"),
    ([{"text": "A point", "marks": True}], "marks are a number"),
    ([{"text": "A point", "marks": "5"}], "marks are a number"),
    ([{"text": "A point", "marks": 5, "grade": "A"}], "A point is"),
    ("five points", "1 to 6 points"),
    ([{"text": "A point", "marks": 2}], "add up to 2"),
])
def test_put_refuses_points_that_are_not_a_rubric(st, points, match):
    with pytest.raises(ValueError, match=match):
        rubric.put(st, seed(st), points)


def test_a_question_without_marks_or_text_gets_no_rubric(st):
    with pytest.raises(ValueError, match="no marks"):
        rubric.draft(st, seed(st, marks=None), Model())
    with pytest.raises(ValueError, match="no marks"):
        rubric.put(st, seed(st, marks=None), [{"text": "A point", "marks": 1}])
    with pytest.raises(ValueError, match="no text"):
        rubric.draft(st, seed(st, text=""), Model())


def test_the_marks_he_changes_later_show_in_the_difference(st):
    qid = seed(st)
    rubric.put(st, qid, GOOD["points"])
    st.update_question(qid, {"marks": 6})
    r = rubric.get(st, qid)
    assert r["marks"] == 6 and r["difference"] == -1


# ------------------------------------------------------------------ (5) rules only, (6) no model, busy
def test_rules_only_answers_planned_and_calls_no_provider(st):
    qid = seed(st)
    settings.save(st, True)
    m = Model()
    assert rubric.draft(st, qid, m) == {"state": "planned", "reason": "Rubric drafts are off: rules only.", "rubric": None}
    assert m.calls == [] and rubric.get(st, qid) is None
    assert rubric.put(st, qid, GOOD["points"])["status"] == "accepted"          # his own rubric needs no model


def test_no_model_is_waiting_and_invents_nothing(st):
    qid = seed(st)
    assert rubric.draft(st, qid, Model(fail=True)) == {"state": "waiting", "reason": "The local model is not running.", "rubric": None}
    assert rubric.get(st, qid) is None


def test_ocr_running_or_another_drafting_is_busy(st):
    qid = seed(st)
    with pytest.raises(api.Busy):
        rubric.draft(st, qid, Model(), ocr_running=lambda: True)
    assert drafts._busy.acquire(blocking=False)
    try:
        with pytest.raises(api.Busy):
            rubric.draft(st, qid, Model())
    finally:
        drafts._busy.release()


# ------------------------------------------------------------------ (7) the validator refuses a whole answer
@pytest.mark.parametrize("answer", [
    {"points": GOOD["points"], "answer": "The theorem says fs > 2 fmax."},
    {"points": GOOD["points"], "grade": "B"},
    {"points": GOOD["points"], "topic": "a new topic"},
    {"points": [{"text": "States the theorem", "marks": 2, "score": 2}]},
    {"points": [{"text": "States the theorem", "marks": 2, "probability": 0.4}]},
    {"points": [{"text": "States the theorem"}]},
    {"points": [{"text": "States the theorem", "marks": 0}]},
    {"points": [{"text": "States the theorem", "marks": 9}]},
    {"points": [{"text": "States the theorem", "marks": "2"}]},
    {"points": [{"text": "Answer: fs must exceed twice the top frequency", "marks": 2}]},
    {"points": [{"text": "This part is likely to be asked", "marks": 2}]},
    {"points": [{"text": "The student scored well on this", "marks": 2}]},
    {"points": [{"text": f"Point {i}", "marks": 0.5} for i in range(7)]},
    {"points": []},
    {"points": "not a list"},
    "I cannot split this.",
])
def test_an_answer_that_brings_more_than_points_is_refused_whole(st, answer):
    qid = seed(st)
    r = rubric.draft(st, qid, Model(answer))
    assert r["state"] == "fault" and r["rubric"] is None and rubric.get(st, qid) is None
    if isinstance(answer, dict):
        assert ww_counsel.check_output("rubric_points", answer, {"marks": "5", "stem": TEXT}) is None


# Review of 27 Nov: each of these got past the validator (an answer after other words, a full-width "Answer", the missing
# word "forecast").
@pytest.mark.parametrize("text", ["Final answer: fs is 8 kHz", "States that the answer is 8 kHz",
                                  "\uff21\uff4e\uff53\uff57\uff45\uff52: fs is 8 kHz", "Forecast: this comes every year"])
def test_a_hidden_answer_or_forecast_word_in_a_point_is_refused(text):
    assert ww_counsel.check_output("rubric_points", {"points": [{"text": text, "marks": 2}]}, {"marks": "5", "stem": TEXT}) is None


def test_rules_only_switched_on_after_the_request_began_still_calls_no_provider(st):
    qid = seed(st)
    m = Model()

    def switch_on():                  # runs after the first look at the switch, before the model is asked
        settings.save(st, True)
        return False
    assert rubric.draft(st, qid, m, switch_on)["state"] == "planned" and m.calls == []


@pytest.mark.parametrize("bad", ["../../x", "q-../x", "C:\\x", "", "q-000000000000", "q-" + "a" * 41])
def test_hostile_or_unknown_question_ids_are_404(st, bad):
    for call in (lambda: rubric.get(st, bad), lambda: rubric.draft(st, bad, Model()), lambda: rubric.put(st, bad, GOOD["points"])):
        with pytest.raises(KeyError):
            call()


# ------------------------------------------------------------------ the routes
@pytest.fixture()
def client(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_variants"])
    app.state.pyq_draft_provider = Model()
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, app


def test_the_rubric_routes_answer_with_the_envelope(client):
    c, st, app = client
    qid = seed(st)
    g = c.get(f"{B}/rubric/{qid}").json()
    assert g["state"] == "waiting" and g["reason"] == "No rubric yet." and g["rubric"] is None and g["source"]
    assert c.get(f"{B}/rubric/q-000000000000").status_code == 404
    d = c.post(f"{B}/rubric/{qid}/draft").json()
    assert d["state"] == "live" and d["rubric"]["status"] == "pending" and d["rubric"]["origin"] == "model-draft"
    assert c.get(f"{B}/rubric/{qid}").json()["reason"] == "A rubric drafted by the local model, waiting for you."
    assert c.put(f"{B}/rubric/{qid}", json={"points": [{"text": "Too few", "marks": 1}]}).status_code == 400
    assert c.put(f"{B}/rubric/{qid}", json={"points": GOOD["points"], "status": "accepted"}).status_code == 400
    p = c.put(f"{B}/rubric/{qid}", json={"points": [{"text": "All of it, in my own words", "marks": 5}]}).json()
    assert p["state"] == "live" and p["rubric"]["status"] == "accepted" and p["rubric"]["origin"] == "hand"
    assert c.get(f"{B}/rubric/{qid}").json()["reason"] == "Your rubric."
    assert c.post(f"{B}/rubric/{qid}/draft").status_code == 400
    nomarks = seed(st, marks=None)
    assert c.post(f"{B}/rubric/{nomarks}/draft").status_code == 400
    assert c.post(f"{B}/rubric/q-000000000000/draft").status_code == 404


def test_the_rubric_route_with_rules_only_calls_no_provider(client):
    c, st, app = client
    qid = seed(st)
    settings.save(st, True)
    r = c.post(f"{B}/rubric/{qid}/draft").json()
    assert r["state"] == "planned" and app.state.pyq_draft_provider.calls == []

"""Variants of his questions (ww_pyq/variants.py, routes R-29 to R-31 in routes_ww_pyq_variants.py), against the X07
acceptance list of plan 9.2.6. The model is a fake that answers what the test says and counts its calls; nothing calls a
real one, and every store is a scratch folder. The questions are invented.
"""
import json

import pytest
from starlette.testclient import TestClient

import jarvis_app.routes_ww_pyq_variants as R
from jarvis_app import ww_counsel, ww_numericals
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_check import routes_defined, routes_documented
from jarvis_app.ww_pyq import api, drafts, settings, variants
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
SRC = ("Explain the working of a low pass filter and describe how its cut off frequency is chosen for a given audio "
       "signal in a recording system.")
IN_BAND = ("Explain the working of a low pass filter and describe how its cut off frequency is chosen for a speech signal "
           "sent over a telephone line.")                                    # 0.52 of shared 5-word runs
TOO_CLOSE = ("Explain the working of a low pass filter and describe how its cut off frequency is chosen for a given audio "
             "signal in a recording studio.")                                # 0.91
TOO_FAR = "State Ohm's law and give one example of where it fails in a real conductor."   # 0.0
NUM = "Find the time constant of an RC circuit with R = 10 kohm and C = 4 uF."


class Model:
    def __init__(self, answer=None, fail=False):
        self.answer, self.fail, self.calls = answer if answer is not None else {"variants": [IN_BAND]}, fail, []

    def __call__(self, system, user):
        self.calls.append((system, user))
        if self.fail:
            raise ConnectionError("no model here")
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


def seed(st, text=SRC, marks=5, topic="low pass filter", qtype="descriptive", subject="signals", status="accepted"):
    pid = st.add_paper({"kind": "hand", "method": "typed", "title": "Invented paper", "subject": subject, "exam_kind": "end",
                        "year": 2025, "pages": 1, "faults": [], "source_note": "test"})
    qid = st.add_questions(pid, [{"label": "1", "text": text, "marks": marks, "type": qtype}])[0]
    if status != "pending":
        st.update_question(qid, {"status": status, "unit": 2, "topic": topic}, by="hand")
    return qid


@pytest.fixture()
def st(tmp_path):
    return Store(tmp_path / "pyq")


# ------------------------------------------------------------------ (1) numerical variants come from templates, with keys
def test_numerical_variants_come_only_from_templates_and_carry_the_template_key(st):
    qid = seed(st, NUM, topic="time constant", qtype="numerical")
    m = Model()
    r = variants.make(st, qid, 3, m)
    assert r["state"] == "live" and len(r["items"]) == 3 and m.calls == []                # no model for numbers
    for v in r["items"]:
        assert v["kind"] == "numerical" and v["origin"] == "template" and v["status"] == "pending"
        item = ww_numericals.make(v["template"].split(":")[1], int(v["template"].split(":")[2]))
        assert v["text"] == item["question"] and v["key"] == item["answer_text"]      # the key is the template's, recomputed
        assert (v["marks"], v["topic"], v["unit"]) == (5, "time constant", 2)
        assert v["checks"]["marks_equal"] and v["checks"]["topic_equal"]
    assert len({v["text"] for v in r["items"]}) == 3
    again = variants.make(st, qid, 3, m)                                                 # new numbers, never the same ones
    assert {v["text"] for v in again["items"]}.isdisjoint({v["text"] for v in r["items"]})


def test_a_numerical_question_with_no_template_gets_no_variant_and_the_model_is_not_asked(st):
    qid = seed(st, "Calculate the force on a 3 kg mass that falls for 2 s near the ground.", topic="free fall", qtype="numerical")
    m = Model()
    r = variants.make(st, qid, 2, m)
    assert r["state"] == "waiting" and "No numerical template fits" in r["reason"] and r["items"] == [] and m.calls == []
    assert variants.list_variants(st) == []


def test_numerical_variants_still_come_with_rules_only_because_a_template_is_a_rule(st):
    qid = seed(st, NUM, topic="time constant", qtype="numerical")
    settings.save(st, True)
    assert variants.make(st, qid, 1, Model())["state"] == "live"


# ------------------------------------------------------------------ (2) the similarity band
def test_descriptive_drafts_outside_the_band_are_rejected_by_rule_with_the_reason(st):
    qid = seed(st)
    m = Model({"variants": [IN_BAND, TOO_CLOSE, TOO_FAR]})
    r = variants.make(st, qid, 3, m)
    by = {v["text"]: v for v in r["items"]}
    assert by[IN_BAND]["status"] == "pending" and 0.2 <= by[IN_BAND]["checks"]["similarity"] <= 0.7
    assert by[TOO_CLOSE]["status"] == "rejected" and "same one reworded" in by[TOO_CLOSE]["reason"]
    assert by[TOO_FAR]["status"] == "rejected" and "another question" in by[TOO_FAR]["reason"]
    assert all(v["kind"] == "descriptive" and v["origin"] == "model-draft" and v["key"] is None for v in r["items"])
    assert r["reason"] == "1 variant to review, drafted by the local model. 2 fell outside the similarity band and were set aside."
    system, user = m.calls[0]
    assert "never an answer" in system and SRC in user and "Marks of the original: 5" in user
    with pytest.raises(ValueError, match="similarity band"):
        variants.decide(st, by[TOO_CLOSE]["id"], {"status": "accepted"})
    assert variants.similarity(SRC, SRC) == 1.0 and not variants.in_band(1.0)


def test_the_same_wording_twice_is_one_variant_and_the_original_itself_is_never_one(st):
    qid = seed(st)
    variants.make(st, qid, 1, Model())
    assert variants.make(st, qid, 1, Model())["state"] == "waiting"
    assert variants.make(st, qid, 1, Model({"variants": [SRC]}))["state"] == "waiting"
    assert len(variants.list_variants(st, question=qid)) == 1


# ------------------------------------------------------------------ (3) nothing is a question before he accepts
def test_no_variant_becomes_a_question_until_accepted_and_the_question_keeps_origin_and_source(st):
    qid = seed(st)
    before = len(st.bank_for("signals"))
    v = variants.make(st, qid, 1, Model())["items"][0]
    assert len(st.bank_for("signals")) == before and len(st.list_papers()) == 1
    r = variants.decide(st, v["id"], {"status": "accepted"})
    q = r["question"]
    assert q["status"] == "accepted" and q["status_by"] == "hand" and q["origin"] == "model-draft" and q["source_question"] == qid
    assert (q["marks"], q["unit"], q["topic"], q["text_status"]) == (5, 2, "low pass filter", "verified")
    assert r["variant"]["status"] == "accepted" and r["variant"]["accepted_as"] == q["id"] and r["variant"]["edited"] is False
    paper = st.get_paper(q["paper_id"])
    assert paper["title"] == "Variants" and paper["subject"] == "signals"
    stored = st.get_question(q["id"])                                              # it survives a read back from disk
    assert stored["origin"] == "model-draft" and stored["source_question"] == qid
    assert len(st.bank_for("signals")) == before + 1
    with pytest.raises(ValueError, match="already a question"):
        variants.decide(st, v["id"], {"status": "accepted"})


def test_an_accepted_numerical_variant_is_a_template_question_with_its_key(st):
    qid = seed(st, NUM, topic="time constant", qtype="numerical")
    v = variants.make(st, qid, 1)["items"][0]
    with pytest.raises(ValueError, match="cannot be changed"):
        variants.decide(st, v["id"], {"status": "accepted", "text": "Find the time constant when R is 99 kohm and C is 1 uF."})
    q = variants.decide(st, v["id"], {"status": "accepted"})["question"]
    assert q["origin"] == "template" and q["source_question"] == qid and q["type"] == "numerical"
    assert q["key"] == v["key"] and q["template"] == v["template"]


def test_accepting_with_an_edit_is_measured_again_and_other_marks_are_refused(st):
    qid = seed(st)
    a, b = (variants.make(st, qid, 1, Model({"variants": [t]}))["items"][0] for t in (IN_BAND, IN_BAND.replace("telephone", "radio")))
    with pytest.raises(ValueError, match="similarity band"):
        variants.decide(st, a["id"], {"status": "accepted", "text": TOO_FAR})
    edited = IN_BAND.replace("speech", "music")
    r = variants.decide(st, a["id"], {"status": "accepted", "text": edited})
    assert r["question"]["text"] == edited and r["variant"]["edited"] is True
    st.update_question(qid, {"marks": 6})
    with pytest.raises(ValueError, match="other marks"):
        variants.decide(st, b["id"], {"status": "accepted"})
    assert variants.decide(st, b["id"], {"status": "rejected"})["question"] is None


def test_a_rejected_variant_stays_on_file(st):
    qid = seed(st)
    v = variants.make(st, qid, 1, Model())["items"][0]
    assert variants.decide(st, v["id"], {"status": "rejected"})["variant"]["status"] == "rejected"
    assert [x["status"] for x in variants.list_variants(st, subject="signals")] == ["rejected"]
    assert variants.list_variants(st, status="pending") == []


# ------------------------------------------------------------------ (5) rules only and (6) no model
def test_rules_only_answers_planned_and_calls_no_provider(st):
    qid = seed(st)
    settings.save(st, True)
    m = Model()
    assert variants.make(st, qid, 2, m) == {"state": "planned", "reason": "Variants are off: rules only.", "items": []}
    assert m.calls == [] and variants.list_variants(st) == []


def test_no_model_is_waiting_and_invents_nothing(st):
    qid = seed(st)
    assert variants.make(st, qid, 1, Model(fail=True)) == {"state": "waiting", "reason": "The local model is not running.", "items": []}
    assert variants.list_variants(st) == []


def test_ocr_running_or_another_drafting_is_busy(st):
    qid = seed(st)
    with pytest.raises(api.Busy):
        variants.make(st, qid, 1, Model(), ocr_running=lambda: True)
    assert drafts._busy.acquire(blocking=False)
    try:
        with pytest.raises(api.Busy):
            variants.make(st, qid, 1, Model())
    finally:
        drafts._busy.release()


# ------------------------------------------------------------------ (7) the validator refuses a whole answer
@pytest.mark.parametrize("answer", [
    {"variants": [{"text": IN_BAND, "answer": "Use an RC network."}]},
    {"variants": [IN_BAND], "grade": 7},
    {"variants": [{"text": IN_BAND, "marks": 5}]},
    {"variants": [{"text": IN_BAND, "key": "3.2 kHz"}]},
    {"variants": [{"text": IN_BAND, "probability": 0.8}]},
    {"variants": [{"text": IN_BAND, "topic": "a new topic"}]},
    {"topic": "a new topic", "variants": [IN_BAND]},
    {"variants": ["Answer: an RC network with a 3 kHz corner."]},
    {"variants": [IN_BAND + " Key: 3.2 kHz."]},
    {"variants": [IN_BAND + " (5 marks)"]},
    {"variants": [IN_BAND + " This is likely to be asked."]},
    {"variants": "not a list"},
    {"variants": []},
    "I am sorry, I cannot do that.",
])
def test_an_answer_that_brings_more_than_a_wording_is_refused_whole(st, answer):
    qid = seed(st)
    r = variants.make(st, qid, 2, Model(answer))
    assert r["state"] == "fault" and r["items"] == [] and variants.list_variants(st) == []
    if isinstance(answer, dict):
        assert ww_counsel.check_output("variant_descriptive", answer, {"stem": SRC}) is None


# Review of 27 Nov: each of these got past the validator. "forecast" was missing from the forecast words; a full-width
# letter or colon, or a zero-width space, hid "Answer:" from the ASCII patterns; "the answer is" needed no colon.
@pytest.mark.parametrize("text", [
    IN_BAND + " This forecast topic comes every year.",
    IN_BAND + " Importantly, it comes every year.",
    IN_BAND + " Answer： 3 kHz.",
    IN_BAND + " Ａｎｓｗｅｒ: 3 kHz.",
    IN_BAND + " Ans​wer: 3 kHz.",
    IN_BAND + " The answer is 3 kHz.",
])
def test_a_hidden_answer_or_forecast_word_is_refused(text):
    assert ww_counsel.check_output("variant_descriptive", {"variants": [text]}, {"stem": SRC}) is None


def test_an_accepted_numerical_variant_has_its_key_proven_again_by_the_template(st):
    qid = seed(st, NUM, topic="time constant", qtype="numerical")
    v = variants.make(st, qid, 1, Model())["items"][0]
    path = st.root / "variants" / "signals.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    rows[0]["key"] = "999 s"                                   # a key on file that the template's numbers do not give
    path.write_text(json.dumps(rows), encoding="utf-8")
    with pytest.raises(ValueError, match="template"):
        variants.decide(st, v["id"], {"status": "accepted"})
    assert variants.list_variants(st)[0]["status"] == "pending"


def test_rules_only_switched_on_after_the_request_began_still_calls_no_provider(st):
    qid = seed(st)
    m = Model()

    def switch_on():                  # runs after the first look at the switch, before the model is asked
        settings.save(st, True)
        return False
    assert variants.make(st, qid, 1, m, switch_on)["state"] == "planned" and m.calls == []


def test_a_word_the_original_itself_uses_is_its_subject_not_a_forecast():
    stem = "Define the expected value of a random variable and find it for a fair die thrown once by a student."
    ok = "Define the expected value of a random variable and find it for a fair coin tossed twice by a student."
    assert ww_counsel.check_output("variant_descriptive", {"variants": [ok]}, {"stem": stem}) == {"variants": [ok]}
    assert ww_counsel.check_output("variant_descriptive", {"variants": [ok]}, {"stem": SRC}) is None


# ------------------------------------------------------------------ refusals of the inputs, hostile ids
def test_a_question_without_text_marks_subject_or_kept_status_is_refused(st):
    with pytest.raises(ValueError, match="no marks"):
        variants.make(st, seed(st, marks=None, status="pending"), 1, Model())
    with pytest.raises(ValueError, match="no text"):
        variants.make(st, seed(st, text=""), 1, Model())
    with pytest.raises(ValueError, match="rejected"):
        variants.make(st, seed(st, status="rejected"), 1, Model())
    with pytest.raises(ValueError, match="no subject"):
        variants.make(st, seed(st, subject=""), 1, Model())
    with pytest.raises(ValueError, match="under five words"):
        variants.make(st, seed(st, text="Define a filter."), 1, Model())
    for bad in (0, 4, True, "2"):
        with pytest.raises(ValueError):
            variants.make(st, seed(st), bad, Model())


@pytest.mark.parametrize("bad", ["../../etc/passwd", "q-../x", "C:\\x", "", None, 5, "q-000000000000"])
def test_hostile_or_unknown_question_ids_are_404(st, bad):
    with pytest.raises(KeyError):
        variants.make(st, bad, 1, Model())


@pytest.mark.parametrize("bad", ["../x", "v-zzzzzzzzzzzz", "v-000000000000", "", None, "v-" + "a" * 40])
def test_hostile_or_unknown_variant_ids_are_404(st, bad):
    seed(st)
    with pytest.raises(KeyError):
        variants.decide(st, bad, {"status": "rejected"})


def test_decide_refuses_unknown_fields_and_statuses(st):
    v = variants.make(st, seed(st), 1, Model())["items"][0]
    for body in ({"status": "accepted", "marks": 9}, {"status": "maybe"}, {}, "accepted"):
        with pytest.raises(ValueError):
            variants.decide(st, v["id"], body)
    with pytest.raises(ValueError):
        variants.list_variants(st, status="maybe")
    assert variants.list_variants(st, subject="../x") == []


# ------------------------------------------------------------------ the routes
@pytest.fixture()
def client(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_variants"])
    app.state.pyq_draft_provider = Model({"variants": [IN_BAND, TOO_CLOSE]})
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, app


def test_the_routes_are_in_the_docstring_and_the_gate_sees_them(client):
    rows = [("POST", "/api/mission/pyq/variants"), ("GET", "/api/mission/pyq/variants"), ("PATCH", "/api/mission/pyq/variants/{vid}"),
            ("POST", "/api/mission/pyq/rubric/{qid}/draft"), ("GET", "/api/mission/pyq/rubric/{qid}"), ("PUT", "/api/mission/pyq/rubric/{qid}")]
    defined, documented = routes_defined(), routes_documented()
    for row in rows:
        assert row in defined and row in documented
    mine = {(m, p) for m, p in documented if p.startswith(("/api/mission/pyq/variants", "/api/mission/pyq/rubric"))}
    assert mine == set(rows)


def test_the_variant_routes_answer_with_the_envelope(client):
    c, st, app = client
    assert c.get(f"{B}/variants").json()["reason"] == "No variant on file."
    qid = seed(st)
    j = c.post(f"{B}/variants", json={"question_id": qid, "count": 2}).json()
    assert j["state"] == "live" and j["count"] == 2 and j["source"]
    assert [v["status"] for v in j["items"]] == ["pending", "rejected"]
    assert c.post(f"{B}/variants", json={"question_id": "q-000000000000"}).status_code == 404
    assert c.post(f"{B}/variants", json={"question_id": "../../x"}).status_code == 404
    assert c.post(f"{B}/variants", json={"question_id": qid, "count": 7}).status_code == 400
    assert c.post(f"{B}/variants", json={"question_id": qid, "grade": 1}).status_code == 400
    lst = c.get(f"{B}/variants", params={"question": qid, "status": "pending"}).json()
    assert lst["state"] == "live" and lst["count"] == 1 and lst["reason"] == "1 variant is waiting for your review."
    assert c.get(f"{B}/variants", params={"status": "maybe"}).status_code == 400
    vid = lst["items"][0]["id"]
    ok = c.patch(f"{B}/variants/{vid}", json={"status": "accepted"}).json()
    assert ok["state"] == "live" and ok["question"]["origin"] == "model-draft" and ok["question"]["source_question"] == qid
    rejected = next(v for v in j["items"] if v["status"] == "rejected")
    assert c.patch(f"{B}/variants/{rejected['id']}", json={"status": "accepted"}).status_code == 400
    assert c.patch(f"{B}/variants/v-000000000000", json={"status": "rejected"}).status_code == 404


def test_the_routes_with_rules_only_no_model_and_ocr_running(client):
    c, st, app = client
    qid = seed(st)
    settings.save(st, True)
    r = c.post(f"{B}/variants", json={"question_id": qid}).json()
    assert r["state"] == "planned" and r["reason"] == "Variants are off: rules only." and app.state.pyq_draft_provider.calls == []
    settings.save(st, False)
    app.state.pyq_draft_provider = Model(fail=True)
    assert c.post(f"{B}/variants", json={"question_id": qid}).json()["state"] == "waiting"

    class Ocr:
        def running(self):
            return True
    app.state.pyq_ocr = Ocr()
    assert c.post(f"{B}/variants", json={"question_id": qid}).status_code == 409

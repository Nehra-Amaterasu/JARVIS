"""His answers beside an evening sheet and a mark proposed for each (ww_pyq/answers.py, routes R-78 to R-84 in
routes_ww_pyq_answers.py, task answer_check in ww_counsel.py).

Every subject, question and answer here is invented. Each test has its own pyq store and plan under tmp_path; the model
is a fake that counts its calls and the OCR reader a fake that returns set lines, so nothing reaches the network, a
real model or the real data directory.
"""
import io
import json
import re
import shutil
from datetime import date, timedelta
from pathlib import Path

import pytest
from PIL import Image
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import routes_ww_pyq_answers as R
from jarvis_app import ww_claude_cli, ww_counsel, ww_generator
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import answers, drafts, ocr, rubric, schema, settings, tonight
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import NOT_PRINTED, Store

TOKEN = "t" * 32
T = "/api/mission/pyq/tonight"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "signals", "name": "Signals", "kind": "current", "question_bank": [],
                           "units": [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
                                     {"n": 2, "title": "Circuits", "topics": ["time constant"], "exam_weight": "med"}]}]}
BANNED = ("important", "likely", "expected", "will be asked", "probability", "chance", "predict", "forecast", "on track")
DAY = date.today().isoformat()
DAY2 = (date.today() - timedelta(days=1)).isoformat()
STEM = "Explain the sampling theorem and what happens when a signal is sampled too slowly."
ANSWER = ("The sampling theorem says a band limited signal can be rebuilt if it is sampled at more than twice its top "
          "frequency.\nBelow that rate the spectrum folds back and   high frequencies appear as low ones.")
POINTS = [{"text": "States the two-times rate", "marks": 2}, {"text": "Shows the spectrum folding back", "marks": 2},
          {"text": "Names aliasing as the effect", "marks": 1}]


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    for text in strings(j):
        assert not any(w in text.lower() for w in BANNED), text


class Model:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def __call__(self, system, user):
        self.calls.append((system, user))
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


class Reader:
    def __init__(self, pages):
        self.pages, self.calls = list(pages), []

    def __call__(self, path):
        self.calls.append(Path(path))
        assert Path(path).suffix == ".png" and Path(path).is_file()
        lines = self.pages[len(self.calls) - 1]
        return {"lines": [{"text": t, "confidence": c, "box": [0, 0, 1, 1]} for t, c in lines],
                "mean_confidence": sum(c for _, c in lines) / len(lines) if lines else None, "seconds": 0.0, "device": "cpu"}


def picture(kind="PNG", size=(40, 20)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, kind)
    return buf.getvalue()


def make_plan(tmp_path):
    bdir = tmp_path / "bankfiles"
    bdir.mkdir(exist_ok=True)
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, bdir / n)
    loaded = g.load_bank(bdir)
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: loaded,
                  academics_loader=lambda: json.loads(json.dumps(ACADEMICS)),
                  apps=g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json"))


def seed(st):
    """Three accepted questions: a descriptive one of 5 marks, a numerical one with a key, one whose marks are not printed."""
    pid = st.add_paper({"title": "Invented paper", "subject": "signals", "year": 2024, "sha256": "a" * 64, "total_marks": 15})
    ids = st.add_questions(pid, [
        {"text": STEM, "text_status": "verified", "marks": 5, "type": "descriptive"},
        {"text": "A signal of top frequency 4 kHz is sampled. Find the least sampling rate.", "text_status": "verified",
         "marks": 4, "type": "numerical", "key": "8 kHz"},
        {"text": "State what an anti-aliasing filter does.", "text_status": "verified", "marks": None,
         "marks_source": NOT_PRINTED, "type": "short"}])
    tops = [(1, "sampling theorem"), (1, "aliasing"), (2, "time constant")]
    for qid, (u, t) in zip(ids, tops):
        st.update_question(qid, {"status": "accepted", "unit": u, "topic": t})
    return ids, tops


def sheet_of(st, ids, tops, day=DAY):
    sid = tonight.sheet_id(day, "signals")
    chosen = [({"unit": u, "topic": t, "key": ww_generator.topic_key(u, t)}, st.get_question(q)) for q, (u, t) in zip(ids, tops)]
    tonight.save_sheet(st, tonight.make_sheet(sid, day, "signals", chosen, f"{day}T19:00:00"), {})
    return sid


@pytest.fixture()
def env(tmp_path, monkeypatch):
    disk = tmp_path / "disk-bank"
    disk.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(disk))
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    plan = make_plan(tmp_path)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq_answers", "ww_pyq_tonight"])
    app.state.svc.plan = plan
    ids, tops = seed(st)
    sid = sheet_of(st, ids, tops)
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, plan, app, sid, ids, tops


def A(sid, qid=None, tail=""):
    return f"{T}/sheets/{sid}/answers" + (f"/{qid}" if qid else "") + tail


# ------------------------------------------------------------------ the route table
def test_every_route_is_in_the_docstring_and_no_other(env):
    c, *_ = env
    doc = R.__doc__
    for rid in ("R-78", "R-79", "R-80", "R-81", "R-82", "R-83", "R-84"):
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    assert len(rows) == 8
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(f"{T}/sheets") and "/answers" in r.path}      # R-85 (read one sheet) shares the prefix and is tonight's
    assert {x for x in defined if x[0] != "HEAD"} == set(rows)


def test_every_task_has_its_prompt_and_answer_check_is_last():
    assert ww_counsel.TASKS[-1] == "answer_check"
    system, user = ww_counsel.load_prompt("answer_check").split("\n---\n", 1)
    assert "letter for letter" in system and "{{answer}}" in user and "{{points}}" in user


# ------------------------------------------------------------------ R-78, R-79 text
def test_a_typed_answer_is_kept_replaced_and_listed(env):
    c, st, plan, app, sid, ids, _ = env
    j = c.get(A(sid)).json()
    envelope(j)
    assert j["state"] == "waiting" and j["items"] == [] and j["agreement"]["count"] == 0
    j = c.put(A(sid, ids[0]), json={"text": "First try."}).json()
    envelope(j)
    assert j["answer"]["text_status"] == "typed" and j["answer"]["text"] == "First try." and j["answer"]["photos"] == []
    j = c.put(A(sid, ids[0]), json={"text": ANSWER}).json()
    assert j["answer"]["text"] == ANSWER and j["answer"]["text_status"] == "typed"
    j = c.get(A(sid)).json()
    envelope(j)
    assert j["state"] == "live" and [i["question_id"] for i in j["items"]] == [ids[0]] and j["items"][0]["text"] == ANSWER
    for bad in ({"text": ""}, {"text": "   "}, {"text": "x" * 20001}, {"text": 5}, {}, {"text": "a", "got": 3}):
        assert c.put(A(sid, ids[0]), json=bad).status_code == 400, bad
    assert c.put(A(sid, ids[0]), json={"text": "y" * 20000}).status_code == 200
    # nothing of it is inside sheets/: the ledger reads every sheets/*.json as a sheet
    assert sorted(p.name for p in (Path(st.root) / "sheets").iterdir()) == [f"{sid}.json"]


def test_an_answer_for_a_question_not_on_the_sheet_or_a_sheet_not_on_file_is_404(env):
    c, st, plan, app, sid, ids, _ = env
    for path in (A(sid, "q-notonsheet"), A(sid, "..%2F..%2Fsettings"), A(sid, "Q-UPPER"),
                 A("2026-11-31-signals", ids[0]), A("not-a-sheet", ids[0]), A(tonight.sheet_id(DAY2, "signals"), ids[0])):
        assert c.put(path, json={"text": "words"}).status_code == 404, path
    assert c.get(A("nope")).status_code == 404
    assert c.post(A(sid, "q-notonsheet", "/photos"), content=picture()).status_code == 404
    assert c.post(A(sid, "q-notonsheet", "/accept"), json={"got": 1}).status_code == 404


def test_delete_removes_the_answer_and_its_pictures_but_not_his_mark(env):
    c, st, plan, app, sid, ids, _ = env
    c.post(A(sid, ids[0], "/photos"), content=picture())
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    assert c.post(A(sid, ids[0], "/accept"), json={"got": 3}).status_code == 200
    j = c.delete(A(sid, ids[0])).json()
    envelope(j)
    assert not (Path(st.root) / "tonight" / "answers" / sid / ids[0]).exists()
    assert c.get(A(sid)).json()["items"] == []
    assert [m["got"] for m in tonight.load_sheet(st, sid)["marks"]] == [3]
    assert c.delete(A(sid, ids[0])).status_code == 404


# ------------------------------------------------------------------ R-80, R-81 pictures
def test_a_picture_is_told_by_its_first_bytes_and_kept_under_a_name_made_here(env):
    c, st, plan, app, sid, ids, _ = env
    gif = b"GIF89a" + b"\x00" * 64
    assert c.post(A(sid, ids[0], "/photos"), content=gif, headers={"Content-Type": "image/jpeg"}).status_code == 400
    assert c.post(A(sid, ids[0], "/photos"), content=b"").status_code == 400
    assert c.post(A(sid, ids[0], "/photos"), content=b"\xff\xd8").status_code == 400            # too short to be a JPEG
    png = picture("PNG")
    j = c.post(A(sid, ids[0], "/photos"), content=png, headers={"Content-Type": "text/plain"}).json()   # the type is not read
    envelope(j)
    assert j["answer"]["photos"][0]["n"] == 1 and j["answer"]["photos"][0]["bytes"] == len(png)
    assert j["answer"]["text_status"] == "not read"
    jpg = picture("JPEG")
    c.post(A(sid, ids[0], "/photos?name=../../evil.exe"), content=jpg)
    folder = Path(st.root) / "tonight" / "answers" / sid / ids[0]
    assert sorted(p.name for p in folder.iterdir()) == ["1.png", "2.jpg"]
    r = c.get(A(sid, ids[0], "/photos/2"))
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content == jpg
    assert r.headers["x-content-type-options"] == "nosniff"
    assert c.get(A(sid, ids[0], "/photos/1")).headers["content-type"] == "image/png"
    for n in ("3", "0", "-1", "..", "1.png"):
        assert c.get(A(sid, ids[0], f"/photos/{n}")).status_code in (404, 405, 422), n     # ".." is the photos address: 405


def test_a_picture_over_10_mb_is_refused_and_a_question_keeps_at_most_6(env):
    c, st, plan, app, sid, ids, _ = env
    big = picture("PNG")[:8] + b"\x00" * (answers.MAX_PHOTO + 1 - 8)
    assert c.post(A(sid, ids[0], "/photos"), content=big).status_code == 413

    def chunks():                                        # no length given: the cap is counted while the body arrives
        yield picture("PNG")[:8]
        for _ in range(11):
            yield b"\x00" * (1024 * 1024)
    assert c.post(A(sid, ids[0], "/photos"), content=chunks()).status_code == 413
    assert not (Path(st.root) / "tonight" / "answers" / sid / ids[0]).exists()
    for k in range(answers.MAX_PHOTOS):
        assert c.post(A(sid, ids[0], "/photos"), content=picture()).status_code == 200, k
    r = c.post(A(sid, ids[0], "/photos"), content=picture())
    assert r.status_code == 400 and "at most 6" in r.json()["detail"]
    assert len(c.get(A(sid)).json()["items"][0]["photos"]) == 6


def test_the_paths_stay_under_the_sheets_answers_folder(env, tmp_path):
    c, st, plan, app, sid, ids, _ = env
    base = Path(st.root) / "tonight" / "answers" / sid
    with pytest.raises(KeyError):
        answers._inside(base, base / ".." / ".." / "settings.json")
    with pytest.raises(KeyError):
        answers.item_of(tonight.load_sheet(st, sid), "../x")
    with pytest.raises(KeyError):
        answers._root(st, "../../etc")


# ------------------------------------------------------------------ R-82 reading the pictures
def test_read_with_a_fake_reader_gives_the_text_and_its_mean_confidence_then_corrected(env):
    c, st, plan, app, sid, ids, _ = env
    c.post(A(sid, ids[0], "/photos"), content=picture("JPEG"))
    c.post(A(sid, ids[0], "/photos"), content=picture("PNG"))
    reader = Reader([[("The sampling theorem", 0.7), ("twice the top frequency", 0.6)], [("aliasing", 0.8)]])
    app.state.pyq_answer_ocr = reader
    j = c.post(A(sid, ids[0], "/read")).json()
    envelope(j)
    assert j["state"] == "live" and len(reader.calls) == 2
    a = j["answer"]
    assert a["text_status"] == "ocr" and a["confidence"] == 0.7
    assert a["text"] == "The sampling theorem\ntwice the top frequency\n\naliasing"
    assert "0.70" in j["reason"] and "Correct the text" in j["reason"]
    assert not any(p.name.startswith(".read") for p in (Path(st.root) / "tonight" / "answers" / sid / ids[0]).iterdir())
    j = c.put(A(sid, ids[0]), json={"text": "The sampling theorem: twice the top frequency, else aliasing."}).json()
    assert j["answer"]["text_status"] == "corrected" and j["answer"]["confidence"] == 0.7
    # his corrected words are not read over unless he says so
    assert c.post(A(sid, ids[0], "/read")).status_code == 400
    app.state.pyq_answer_ocr = Reader([[("again", 0.9)], [("and again", 0.9)]])
    assert c.post(A(sid, ids[0], "/read"), json={"replace": True}).json()["answer"]["text_status"] == "ocr"


def test_read_is_409_while_ocr_the_desk_or_a_model_job_runs_and_waiting_with_no_engine(env, monkeypatch):
    c, st, plan, app, sid, ids, _ = env
    c.post(A(sid, ids[0], "/photos"), content=picture())

    class Running:
        def running(self):
            return True
    app.state.pyq_answer_ocr = Reader([[("words", 0.9)]])
    for name in ("pyq_ocr", "pyq_ingest", "pyq_prep_job"):
        setattr(app.state, name, Running())
        assert c.post(A(sid, ids[0], "/read")).status_code == 409, name
        setattr(app.state, name, None)
    assert drafts._busy.acquire(blocking=False)
    try:
        assert c.post(A(sid, ids[0], "/read")).status_code == 409
    finally:
        drafts._busy.release()
    assert answers._reading.acquire(blocking=False)               # another answer being read
    try:
        assert c.post(A(sid, ids[0], "/read")).status_code == 409
    finally:
        answers._reading.release()
    app.state.pyq_answer_ocr = None
    monkeypatch.setattr(ocr, "installed", lambda: False)
    j = c.post(A(sid, ids[0], "/read")).json()
    envelope(j)
    assert j["state"] == "waiting" and "not installed" in j["reason"]
    assert c.post(A(sid, ids[1], "/read")).json()["state"] == "waiting"      # no picture, but no engine is said first


def test_read_with_no_picture_or_no_text_found(env):
    c, st, plan, app, sid, ids, _ = env
    app.state.pyq_answer_ocr = Reader([[]])
    assert c.post(A(sid, ids[0], "/read")).status_code == 400
    c.post(A(sid, ids[0], "/photos"), content=picture())
    j = c.post(A(sid, ids[0], "/read")).json()
    assert j["state"] == "waiting" and j["answer"]["text_status"] == "not read"


# ------------------------------------------------------------------ R-83 the check
def test_check_waits_for_a_rubric_and_names_r32(env):
    c, st, plan, app, sid, ids, _ = env
    assert c.post(A(sid, ids[0], "/check")).status_code == 400                # no text yet
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = m = Model({"points": []})
    j = c.post(A(sid, ids[0], "/check")).json()
    envelope(j)
    assert j["state"] == "waiting" and "R-32" in j["reason"] and j["proposal"] is None and m.calls == []


def test_check_is_planned_under_rules_only(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    settings.save(st, True)
    app.state.pyq_answer_provider = m = Model({"points": []})
    j = c.post(A(sid, ids[0], "/check")).json()
    envelope(j)
    assert j["state"] == "planned" and j["proposal"] is None and m.calls == []


def test_a_numerical_question_with_a_key_is_checked_by_the_rule_alone(env):
    c, st, plan, app, sid, ids, _ = env
    app.state.pyq_answer_provider = m = Model({"points": []})
    settings.save(st, True)                                     # the rule is not a model: rules only does not stop it
    c.put(A(sid, ids[1]), json={"text": "fs must exceed 2 x 4 kHz.\nSo fs = 8 kHz"})
    j = c.post(A(sid, ids[1], "/check")).json()
    envelope(j)
    p = j["proposal"]
    assert j["state"] == "live" and p["basis"] == "number" and p["by"] == "rule" and p["status"] == "proposed"
    assert (p["got"], p["max"], p["match"]) == (4, 4, True) and p["points"][0]["rests_on"] == "8 kHz"
    assert "working" in p["sentence"] and "not a mark" in p["sentence"]
    c.put(A(sid, ids[1]), json={"text": "Working shown.\nfs = 6 kHz"})
    assert c.get(A(sid)).json()["items"][0].get("proposal") is None     # new words drop the old proposal
    p = c.post(A(sid, ids[1], "/check")).json()["proposal"]
    assert (p["got"], p["match"], p["points"][0]["met"], p["points"][0]["rests_on"]) == (0, False, False, None)
    c.put(A(sid, ids[1]), json={"text": "I could not finish it."})
    p = c.post(A(sid, ids[1], "/check")).json()["proposal"]
    assert p["got"] == 0 and "No number was found" in p["sentence"]
    assert m.calls == []
    assert tonight.load_sheet(st, sid)["marks"] == []                    # a proposal is never a mark


def test_the_rubric_path_counts_only_points_whose_quote_is_in_his_answer(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    verdict = {"points": [
        {"n": 1, "met": True, "quote": "sampled at more than twice its top frequency"},
        {"n": 2, "met": True, "quote": "the spectrum folds back and high frequencies appear"},    # spaces folded: found
        {"n": 3, "met": True, "quote": "this effect is called aliasing"}]}                       # invented: not in his words
    app.state.pyq_answer_provider = m = Model(verdict)
    j = c.post(A(sid, ids[0], "/check")).json()
    envelope(j)
    p = j["proposal"]
    assert j["state"] == "live" and p["basis"] == "rubric" and p["by"].startswith("local") and p["rubric_status"] == "accepted"
    assert [x["met"] for x in p["points"]] == [True, True, False]
    assert p["points"][2]["rests_on"] is None and p["points"][1]["rests_on"] == "the spectrum folds back and high frequencies appear"
    assert (p["got"], p["max"]) == (4, 5)
    assert "set to not met" in p["sentence"] and "left this PC" not in p["sentence"]
    system, user = m.calls[0]
    assert ANSWER in user and "1. (2 marks) States the two-times rate" in user and "Rubric points (3)" in user
    assert c.get(A(sid)).json()["items"][0]["proposal"]["got"] == 4
    # a quote whose letters differ is not found, the case included
    app.state.pyq_answer_provider = Model({"points": [{"n": 1, "met": True, "quote": "THE SAMPLING THEOREM says"},
                                                      {"n": 2, "met": False, "quote": None}, {"n": 3, "met": True, "quote": None}]})
    p = c.post(A(sid, ids[0], "/check")).json()["proposal"]
    assert [x["met"] for x in p["points"]] == [False, False, False] and p["got"] == 0
    assert tonight.load_sheet(st, sid)["marks"] == []


def test_a_model_that_breaks_the_shape_gives_fault_and_keeps_nothing(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    for bad in ({"points": [{"n": 1, "met": True, "quote": "x"}]},                                     # a point left out
                {"points": [{"n": 1, "met": True, "quote": None, "marks": 2}, {"n": 2, "met": False}, {"n": 3, "met": False}]},
                {"points": [{"n": 1, "met": "yes"}, {"n": 2, "met": False}, {"n": 3, "met": False}]},
                {"points": [{"n": 1, "met": True}, {"n": 1, "met": False}, {"n": 3, "met": False}]},
                {"points": [{"n": 1, "met": True}, {"n": 2, "met": False}, {"n": 3, "met": False}], "score": 4},
                "no json here"):
        app.state.pyq_answer_provider = Model(bad)
        j = c.post(A(sid, ids[0], "/check")).json()
        assert j["state"] == "fault" and j["proposal"] is None, bad
    assert "proposal" not in c.get(A(sid)).json()["items"][0]


def test_a_pending_rubric_is_said_in_rubric_status(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.draft(st, ids[0], Model({"points": POINTS}))
    assert rubric.get(st, ids[0])["status"] == "pending"
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = Model({"points": [{"n": 1, "met": True, "quote": "more than twice its top frequency"},
                                                      {"n": 2, "met": False, "quote": None}, {"n": 3, "met": False, "quote": None}]})
    p = c.post(A(sid, ids[0], "/check")).json()["proposal"]
    assert p["rubric_status"] == "pending" and "draft you have not accepted" in p["sentence"] and p["got"] == 2


def test_check_is_409_while_another_model_job_runs_and_says_when_text_left_this_pc(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = m = Model({"points": [{"n": i, "met": False, "quote": None} for i in (1, 2, 3)]})
    assert drafts._busy.acquire(blocking=False)
    try:
        assert c.post(A(sid, ids[0], "/check")).status_code == 409
    finally:
        drafts._busy.release()
    assert m.calls == []
    ww_claude_cli.set_mode(st, "claude")
    j = c.post(A(sid, ids[0], "/check")).json()
    envelope(j)
    assert j["proposal"]["by"] == "claude-cli:haiku" and "left this PC" in j["proposal"]["sentence"] and len(m.calls) == 1


# ------------------------------------------------------------------ R-84 accept
def test_an_accepted_mark_lands_exactly_as_r58_lands_it(env):
    c, st, plan, app, sid, ids, tops = env
    other = sheet_of(st, ids, tops, day=DAY2)                       # the same items on another day, marked through R-58
    assert c.post(f"{T}/{other}/marks", json={"items": [{"question_id": ids[0], "got": 3, "minutes": 12}]}).status_code == 200
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    j = c.post(A(sid, ids[0], "/accept"), json={"got": 3, "minutes": 12}).json()
    envelope(j)
    by58 = tonight.load_sheet(st, other)["marks"]
    by84 = tonight.load_sheet(st, sid)["marks"]
    strip = lambda rows: [{k: v for k, v in r.items() if k != "at"} for r in rows]
    assert strip(by84) == strip(by58) and set(by84[0]) == {"question_id", "got", "max", "minutes", "at"}
    lst = plan.load()["paper_marks"]["signals"][ww_generator.topic_key(*tops[0])]
    e58, e84 = (next(e for e in lst if e["sheet"] == s) for s in (other, sid))
    assert {k: v for k, v in e58.items() if k != "sheet"} == {k: v for k, v in e84.items() if k != "sheet"}
    assert e84["origin"] == "sheet" and e84["q"] == ids[0]
    # a second accept replaces its own entry, as a second R-58 post does
    c.post(A(sid, ids[0], "/accept"), json={"got": 4})
    lst = plan.load()["paper_marks"]["signals"][ww_generator.topic_key(*tops[0])]
    assert [e["got"] for e in lst if e["sheet"] == sid] == [4] and [e["got"] for e in lst if e["sheet"] == other] == [3]
    for bad in ({"got": 6}, {"got": -1}, {"got": True}, {"got": 2, "grade": "A"}, {"got": 2, "out_of": 5}):
        assert c.post(A(sid, ids[0], "/accept"), json=bad).status_code == 400, bad


def test_mark_origin_is_proposal_or_hand_and_agreement_counts(env):
    c, st, plan, app, sid, ids, _ = env
    c.put(A(sid, ids[1]), json={"text": "fs = 8 kHz"})
    assert c.post(A(sid, ids[1], "/accept"), json={}).status_code == 400       # nothing proposed yet: got is needed
    c.post(A(sid, ids[1], "/check"))
    j = c.post(A(sid, ids[1], "/accept"), json={}).json()                      # got left out: the proposed 4
    envelope(j)
    assert j["mark"]["got"] == 4 and j["mark_origin"] == "proposal" and j["answer"]["mark_origin"] == "proposal"
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = Model({"points": [{"n": 1, "met": True, "quote": "more than twice its top frequency"},
                                                      {"n": 2, "met": False, "quote": None}, {"n": 3, "met": False, "quote": None}]})
    assert c.post(A(sid, ids[0], "/check")).json()["proposal"]["got"] == 2
    j = c.post(A(sid, ids[0], "/accept"), json={"got": 4}).json()
    assert j["mark_origin"] == "hand" and j["answer"]["accepted"] == {"got": 4, "max": 5, "proposed_got": 2, "basis": "rubric",
                                                                     "at": j["answer"]["accepted"]["at"]}
    j = c.get(A(sid)).json()
    envelope(j)
    assert j["agreement"] == {"accepted_as_proposed": 1, "changed": 1, "count": 2, "mean_difference": 1.0}
    assert "Of 2 accepted proposals, 1 kept as proposed and 1 changed" in j["reason"]
    # equal to the proposal is still the proposal
    j = c.post(A(sid, ids[0], "/accept"), json={"got": 2}).json()
    assert j["mark_origin"] == "proposal"
    assert c.get(A(sid)).json()["agreement"]["mean_difference"] == 0.0


def test_a_question_whose_marks_are_not_printed_needs_out_of(env):
    c, st, plan, app, sid, ids, _ = env
    c.put(A(sid, ids[2]), json={"text": "It removes what is above half the sampling rate before sampling."})
    assert c.post(A(sid, ids[2], "/accept"), json={"got": 2}).status_code == 400
    j = c.post(A(sid, ids[2], "/accept"), json={"got": 2, "out_of": 3, "keep": True}).json()
    envelope(j)
    assert (j["mark"]["got"], j["mark"]["max"], j["mark_origin"], j["kept_marks"]) == (2, 3, "hand", [ids[2]])
    assert st.get_question(ids[2])["marks"] == 3 and st.get_question(ids[2])["marks_source"] == "hand"


def test_accept_needs_an_answer_and_a_plan(env):
    c, st, plan, app, sid, ids, _ = env
    assert c.post(A(sid, ids[0], "/accept"), json={"got": 1}).status_code == 404     # no answer kept
    app.state.svc.plan = None
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    assert c.post(A(sid, ids[0], "/accept"), json={"got": 1}).status_code == 503


# ------------------------------------------------------------------ the validator alone
def test_the_validator_refuses_extra_keys_and_missing_points():
    f = {"n_points": 2}
    ok = ww_counsel.check_output("answer_check", {"points": [{"n": 2, "met": False, "quote": None},
                                                             {"n": 1, "met": True, "quote": " his words "}]}, f)
    assert ok == {"points": [{"n": 1, "met": True, "quote": "his words"}, {"n": 2, "met": False, "quote": None}]}
    for bad in ({"points": [{"n": 1, "met": True}]}, {"points": [{"n": 1, "met": True}, {"n": 3, "met": False}]},
                {"points": [{"n": 1, "met": True, "got": 1}, {"n": 2, "met": False}]},
                {"points": [{"n": True, "met": True}, {"n": 2, "met": False}]},
                {"points": [{"n": 1, "met": True, "quote": "x" * 601}, {"n": 2, "met": False}]},
                {"points": [{"n": 1, "met": True}, {"n": 2, "met": False}], "total": 1}):
        assert ww_counsel.check_output("answer_check", bad, f) is None, bad


# ------------------------------------------------------------------ review of 28 Nov
import threading
import time


def test_a_number_copied_from_the_given_values_is_not_his_answer(env):
    c, st, plan, app, sid, ids, _ = env
    st.update_question(ids[1], {"key": "5 A"})
    c.put(A(sid, ids[1]), json={"text": "Given V = 10 V, R = 2 ohm, I0 = 5 A\nI = V/R = ten A"})
    p = c.post(A(sid, ids[1], "/check")).json()["proposal"]
    assert (p["match"], p["got"]) == (False, 0) and "No number was found" in p["sentence"]
    c.put(A(sid, ids[1]), json={"text": "Given 10 V and 2 ohm.\nSo the current is 5 A"})
    p = c.post(A(sid, ids[1], "/check")).json()["proposal"]
    assert (p["match"], p["got"]) == (True, 4)


def test_a_read_does_not_overwrite_what_he_typed_while_it_ran(env):
    c, st, plan, app, sid, ids, _ = env
    c.post(A(sid, ids[0], "/photos"), content=picture())
    go, started = threading.Event(), threading.Event()

    def slow(path):
        started.set()
        assert go.wait(10)
        return {"lines": [{"text": "words read", "confidence": 0.8, "box": [0, 0, 1, 1]}], "mean_confidence": 0.8}
    out = {}
    sheet = tonight.load_sheet(st, sid)
    t = threading.Thread(target=lambda: out.update(r=answers.read(st, sheet, ids[0], slow, False, "now")))
    t.start()
    assert started.wait(10)
    answers.put_text(st, sheet, ids[0], "What I typed meanwhile.", "now")
    go.set()
    t.join(10)
    r = out["r"]
    assert r["state"] == "fault" and "typed" in r["reason"] and r["ocr_text"] == "words read"
    rec = answers.load(st, sid, ids[0])
    assert (rec["text"], rec["text_status"]) == ("What I typed meanwhile.", "typed") and "confidence" not in rec


def test_a_long_answer_says_how_much_of_it_the_model_saw(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    tail = "the spectrum folds back past the limit"
    text = ("word " * 3000) + tail                               # 15,038 characters, the quote past the cut
    c.put(A(sid, ids[0]), json={"text": text})
    app.state.pyq_answer_provider = m = Model({"points": [{"n": 1, "met": False, "quote": None},
                                                          {"n": 2, "met": True, "quote": tail}, {"n": 3, "met": False, "quote": None}]})
    p = c.post(A(sid, ids[0], "/check")).json()["proposal"]
    assert (p["checked_chars"], p["text_chars"]) == (ww_counsel.MAX_INPUT, len(text))
    assert f"first {ww_counsel.MAX_INPUT:,}" in p["sentence"]
    assert tail not in m.calls[0][1]
    assert p["points"][1]["met"] is True                          # still verified against his full text


def test_a_corrupt_answer_file_is_a_fault_and_is_left_as_it_is(env):
    c, st, plan, app, sid, ids, _ = env
    c.post(A(sid, ids[0], "/photos"), content=picture())
    f = Path(st.root) / "tonight" / "answers" / sid / f"{ids[0]}.json"
    f.write_text("{broken", encoding="utf-8")
    j = c.post(A(sid, ids[0], "/photos"), content=picture()).json()
    assert j["state"] == "fault" and "could not be read" in j["reason"]
    assert f.read_text(encoding="utf-8") == "{broken"
    assert c.get(A(sid)).json()["state"] == "fault"
    assert c.put(A(sid, ids[0]), json={"text": "x"}).json()["state"] == "fault"


def test_a_picture_number_whose_file_is_on_disk_is_never_reused(env):
    c, st, plan, app, sid, ids, _ = env
    d = Path(st.root) / "tonight" / "answers" / sid / ids[0]
    d.mkdir(parents=True)
    (d / "1.jpg").write_bytes(picture("JPEG"))                  # a file the record does not list
    j = c.post(A(sid, ids[0], "/photos"), content=picture()).json()
    assert j["answer"]["photos"][0]["n"] == 2 and (d / "1.jpg").is_file() and (d / "2.png").is_file()


def test_a_short_quote_is_not_evidence_and_an_overfull_rubric_proposes_no_got(env):
    c, st, plan, app, sid, ids, _ = env
    assert not answers._quote_found("is", ANSWER) and not answers._quote_found("is the", "this is the end")
    assert answers._quote_found("folds back and", ANSWER)
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = Model({"points": [{"n": 1, "met": True, "quote": "twice"},
                                                      {"n": 2, "met": False, "quote": None}, {"n": 3, "met": False, "quote": None}]})
    p = c.post(A(sid, ids[0], "/check")).json()["proposal"]
    assert p["points"][0]["met"] is False and "set to not met" in p["sentence"]
    # a pending rubric whose points add up to more than the question's 5 marks
    path = Path(st.root) / "rubrics" / f"{ids[0]}.json"
    rec = json.loads(path.read_text(encoding="utf-8"))
    rec.update(points=[{"text": "A", "marks": 4}, {"text": "B", "marks": 4}], status="pending", sum=8)
    path.write_text(json.dumps(rec), encoding="utf-8")
    app.state.pyq_answer_provider = Model({"points": [{"n": 1, "met": True, "quote": "more than twice its top frequency"},
                                                      {"n": 2, "met": True, "quote": "the spectrum folds back"}]})
    p = c.post(A(sid, ids[0], "/check")).json()["proposal"]
    assert p["got"] is None and p["max"] == 5 and "more than the question's 5 marks" in p["sentence"]
    assert c.post(A(sid, ids[0], "/accept"), json={}).status_code == 400


def test_check_is_409_while_an_answer_is_being_read(env):
    c, st, plan, app, sid, ids, _ = env
    rubric.put(st, ids[0], POINTS)
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    app.state.pyq_answer_provider = m = Model({"points": []})
    assert answers._reading.acquire(blocking=False)
    try:
        assert c.post(A(sid, ids[0], "/check")).status_code == 409
    finally:
        answers._reading.release()
    assert m.calls == []


def test_r84_lands_as_r58_for_a_question_whose_marks_are_not_printed(env):
    c, st, plan, app, sid, ids, tops = env
    other = sheet_of(st, ids, tops, day=DAY2)
    r = c.post(f"{T}/{other}/marks", json={"items": [{"question_id": ids[2], "got": 2, "out_of": 3, "keep": True}]})
    assert r.status_code == 200
    st.update_question(ids[2], {"marks": None, "marks_source": NOT_PRINTED})     # as it was, for the second mark
    c.put(A(sid, ids[2]), json={"text": "It removes what is above half the rate."})
    j = c.post(A(sid, ids[2], "/accept"), json={"got": 2, "out_of": 3, "keep": True}).json()
    strip = lambda rows: [{k: v for k, v in x.items() if k != "at"} for x in rows]
    assert strip(tonight.load_sheet(st, sid)["marks"]) == strip(tonight.load_sheet(st, other)["marks"])
    lst = plan.load()["paper_marks"]["signals"][ww_generator.topic_key(*tops[2])]
    e58, e84 = (next(e for e in lst if e["sheet"] == s) for s in (other, sid))
    assert {k: v for k, v in e58.items() if k != "sheet"} == {k: v for k, v in e84.items() if k != "sheet"}
    assert j["kept_marks"] == [ids[2]] and st.get_question(ids[2])["marks"] == 3


def _hold_during_write_marks(monkeypatch, action):
    """Run `action` on a thread while accept() is writing the mark, and note whether it finished before accept did."""
    real = answers.write_marks
    seen = {}

    def slow(*a, **k):
        t = threading.Thread(target=action)
        t.start()
        time.sleep(0.3)
        seen["done_inside"] = not t.is_alive()
        seen["thread"] = t
        return real(*a, **k)
    monkeypatch.setattr(answers, "write_marks", slow)
    return seen


def test_a_text_change_during_accept_waits_for_it(env, monkeypatch):
    c, st, plan, app, sid, ids, _ = env
    c.put(A(sid, ids[1]), json={"text": "fs = 8 kHz"})
    c.post(A(sid, ids[1], "/check"))
    sheet = tonight.load_sheet(st, sid)
    seen = _hold_during_write_marks(monkeypatch, lambda: answers.put_text(st, sheet, ids[1], "fs = 6 kHz", "now"))
    j = c.post(A(sid, ids[1], "/accept"), json={}).json()
    seen["thread"].join(10)
    assert seen["done_inside"] is False and j["mark_origin"] == "proposal"
    rec = answers.load(st, sid, ids[1])
    assert rec["text"] == "fs = 6 kHz" and "proposal" not in rec and rec["mark_origin"] == "proposal"


def test_an_answer_deleted_during_accept_is_not_brought_back(env, monkeypatch):
    c, st, plan, app, sid, ids, _ = env
    c.put(A(sid, ids[0]), json={"text": ANSWER})
    sheet = tonight.load_sheet(st, sid)
    seen = _hold_during_write_marks(monkeypatch, lambda: answers.delete(st, sheet, ids[0]))
    assert c.post(A(sid, ids[0], "/accept"), json={"got": 3}).status_code == 200
    seen["thread"].join(10)
    assert seen["done_inside"] is False
    assert answers.load(st, sid, ids[0]) is None

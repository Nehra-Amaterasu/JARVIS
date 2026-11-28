"""Wave EW11 B2 to B5, preparing the bank (ww_pyq/assign.py, ww_pyq/prep.py, routes R-65 to R-71 in routes_ww_pyq_prep.py).

Every store is a Store under tmp_path with invented papers; the plan is a fake with invented subjects and codes, the Classroom
manifest a dict, and the model a counting fake that answers from the prompt it is given. Nothing here reads the real data
directory, the network, the local model or the Claude tool. The switch of the outside model (ww_claude_cli) is a fake too.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_prep as R
from jarvis_app import ww_counsel
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import assign, ingest, prep, settings
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, build_pdf

B = "/api/mission/pyq/prep"
FORBIDDEN = re.compile(r"important|likely|expected|probability|chance|forecast|predict", re.I)
UNITS_S = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
           {"n": 2, "title": "Filters", "topics": ["low pass filter", "window design"], "exam_weight": "low"}]
UNITS_C = [{"n": 1, "title": "Network theorems", "topics": ["thevenin theorem", "norton theorem"]}]
SUBJECTS = [{"id": "signals", "name": "Signals", "code": "ZX4101", "units": UNITS_S},
            {"id": "circuits", "name": "Network Circuits", "code": "ZX4202", "units": UNITS_C},
            {"id": "empty", "name": "Empty Subject", "code": "", "units": []}]
SHA = {k: (k * 64)[:64] for k in "abcdef"}


class FakePlan:
    def academics(self):
        return {"subjects": json.loads(json.dumps(SUBJECTS))}


class Model:
    """A counting fake. subject_pick: by title; tag_topics: by words in each question, read back from the prompt."""

    def __init__(self, subject_by_title=None, topic_by_word=None, fail_calls=(), raw=None):
        self.calls = []
        self.subject_by_title = subject_by_title or {}
        self.topic_by_word = topic_by_word or {}
        self.fail_calls, self.raw = set(fail_calls), raw

    def __call__(self, system, user):
        self.calls.append((system, user))
        if len(self.calls) in self.fail_calls:
            raise ConnectionError("down")
        if self.raw is not None:
            return self.raw
        if "Topics (id: unit, topic)" in user:
            tids = {name.strip(): tid for tid, name in re.findall(r"^(T\d+): unit \d+, (.+)$", user, re.M)}
            tags = []
            for qid, text in re.findall(r"^(Q\d+): (.+)$", user, re.M):
                pick = next((v for w, v in self.topic_by_word.items() if w in text.lower()), "none")
                tags.append({"q": qid, "topic": tids.get(pick, pick)})
            return json.dumps({"tags": tags})
        title = re.search(r"^Title: (.*)$", user, re.M).group(1)
        return json.dumps({"subject": self.subject_by_title.get(title, "none")})


def fake_cli(mode="local", provider=None, name="fake:test-model"):
    return SimpleNamespace(mode_for=lambda st: mode, provider_for=lambda st: provider, name_for=lambda st: name)


def add_q(st, pid, text, marks=5, **kw):
    d = {"text": text, "marks": marks, "marks_source": "printed" if marks is not None else "missing", "text_status": "verified",
         "kind": "question", **kw}
    return st.add_questions(pid, [d])[0]


def paper(st, title, subject="", sha=None, method="text-layer", filename=""):
    meta = {"title": title, "subject": subject, "kind": "pdf", "method": method, "filename": filename or f"{title}.pdf"}
    if sha:
        meta["sha256"] = sha
    return st.add_paper(meta)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(prep, "_cli", lambda: fake_cli())
    manifest = {"courses": {}, "files": {}}
    monkeypatch.setattr(assign, "load_manifest", lambda: (manifest, ""))
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=FakePlan()), SimpleNamespace(publish=lambda *a, **k: None))
    model = Model()
    app.state.pyq_prep_provider = model
    with TestClient(app) as c:
        yield SimpleNamespace(c=c, st=st, app=app, model=model, manifest=manifest, tmp=tmp_path, mp=monkeypatch)


def envelope(j):
    assert j["state"] in ("live", "waiting", "planned", "fault") and isinstance(j["reason"], str) and j["reason"] and j["source"]
    assert not FORBIDDEN.search(json.dumps(j)), json.dumps(j)


# ------------------------------------------------------------------ the route table
def test_the_docstring_lists_every_mounted_route_and_no_other():
    app = create_app(Guard(8777, "t" * 32, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_prep"])
    mounted = {(m, r.path) for r in app.routes if getattr(r, "path", "").startswith("/api/mission/pyq/prep")
               for m in (getattr(r, "methods", None) or ()) if m != "HEAD"}
    rows = set(re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", R.__doc__, re.M))
    assert mounted == rows and len(rows) == 12          # R-75 (wave EW13) is the twelfth


# ------------------------------------------------------------------ R-65
def seed_counts(st):
    p1 = paper(st, "Signals test one", "signals")
    for _ in range(3):
        q = add_q(st, p1, "State and prove the sampling theorem for a band limited signal.")
        st.update_question(q, {"status": "accepted", "unit": 1, "topic": "sampling theorem"})
    add_q(st, p1, "A question with no marks printed beside it at all here.", marks=None)
    p2 = paper(st, "Circuits test", "circuits")
    q5 = add_q(st, p2, "Find the Thevenin equivalent of the network shown.")
    st.update_question(q5, {"unit": 1, "topic": "thevenin theorem", "tag_source": "rule"}, "rule")
    p3 = paper(st, "Loose paper")
    add_q(st, p3, "A loose question without marks.", marks=None)
    add_q(st, p3, "A loose question with marks.", marks=2)


def test_the_counts_match_a_hand_count(env):
    seed_counts(env.st)
    env.manifest["courses"].update({"c1": {"name": "A", "subject": "signals"}, "c2": {"name": "B"}, "c3": {"name": "C", "subject": ""}})
    j = env.c.get(B).json()
    envelope(j)
    k = j["counts"]
    assert {x: k[x] for x in ("papers", "without_subject", "questions", "pending", "accepted", "with_marks", "tagged", "sheet_ready_topics")} == \
        {"papers": 3, "without_subject": 1, "questions": 7, "pending": 4, "accepted": 3, "with_marks": 5, "tagged": 4, "sheet_ready_topics": 1}
    by = {r["subject"]: r for r in k["by_subject"]}
    assert {x: by["signals"][x] for x in ("papers", "questions", "pending", "accepted", "with_marks", "tagged", "sheet_ready_topics")} == \
        {"papers": 1, "questions": 4, "pending": 1, "accepted": 3, "with_marks": 3, "tagged": 3, "sheet_ready_topics": 1}
    assert {x: by["circuits"][x] for x in ("papers", "questions", "pending", "accepted", "with_marks", "tagged", "sheet_ready_topics")} == \
        {"papers": 1, "questions": 1, "pending": 1, "accepted": 0, "with_marks": 1, "tagged": 1, "sheet_ready_topics": 0}
    assert by["empty"]["papers"] == 0
    assert (k["courses"]["mapped"], k["courses"]["unmapped"]) == (1, 2)
    assert "1 topic is ready for an evening sheet" in j["reason"]


def test_an_empty_store_waits_and_a_damaged_manifest_is_a_fault_line(env):
    env.mp.setattr(assign, "load_manifest", lambda: (None, "The manifest could not be read; set aside."))
    j = env.c.get(B).json()
    assert j["state"] == "waiting" and j["counts"]["courses"] == {"mapped": None, "unmapped": None, "state": "fault",
                                                                 "reason": "The manifest could not be read; set aside."}


# ------------------------------------------------------------------ R-66
def seed_subjects(env):
    st, m = env.st, env.manifest
    ids = {}
    ids["sha"] = paper(st, "Untitled scan", sha=SHA["a"])                 # its Classroom file found by the hash
    ids["link"] = paper(st, "Another untitled", sha=SHA["b"])            # found by the paper id written on the file record
    ids["code"] = paper(st, "ZX 4202 midterm")
    ids["name2"] = paper(st, "Unit test two")
    add_q(st, ids["name2"], "In network circuits, find the current through the 4 ohm branch.")
    ids["name1"] = paper(st, "Signals quiz")
    ids["model"] = paper(st, "Unit test 3")
    add_q(st, ids["model"], "Sketch the spectrum of a sampled signals train after filtering.")
    for i in range(3):
        add_q(st, ids["model"], f"Question {i} about a filter bank and its response.")
    add_q(st, ids["model"], "SECRETWORD should never be sent to the model.")
    ids["dropped"] = paper(st, "Mystery paper")
    ids["both"] = paper(st, "ZX4101 and ZX4202 combined")
    ids["hand"] = paper(st, "ZX4101 chosen by hand", "circuits")
    m["courses"].update({"c1": {"name": "Signals lab", "subject": "signals"}, "c2": {"name": "ZX4202 Network Circuits"},
                         "c3": {"name": "Sports and games"}})
    m["files"].update({"f1": {"course": "c1", "sha256": SHA["a"]}, "f2": {"course": "c1", "sha256": SHA["f"], "paper_id": ids["link"]}})
    return ids


def test_subjects_by_course_code_and_name_are_proposed_and_written_only_with_apply(env):
    ids = seed_subjects(env)
    before = json.loads((env.st.root / "papers.json").read_text(encoding="utf-8"))
    j = env.c.post(f"{B}/subjects", json={}).json()
    envelope(j)
    by = {r["paper"]: r for r in j["items"]}
    assert (by[ids["sha"]]["subject"], by[ids["sha"]]["rule"]) == ("signals", "course")
    assert (by[ids["link"]]["subject"], by[ids["link"]]["rule"]) == ("signals", "course")
    assert (by[ids["code"]]["subject"], by[ids["code"]]["rule"]) == ("circuits", "code")
    assert (by[ids["name2"]]["subject"], by[ids["name2"]]["rule"]) == ("circuits", "name")
    assert (by[ids["name1"]]["subject"], by[ids["name1"]]["rule"]) == ("signals", "name")
    assert by[ids["model"]]["subject"] == ""              # a one-word name inside a question is not read as the subject
    assert by[ids["both"]]["subject"] == "" and "more than one subject" in by[ids["both"]]["reason"]
    assert ids["hand"] not in by and j["counts"]["has_subject"] == 1
    assert j["counts"]["course"] == 2 and j["counts"]["code"] == 1 and j["counts"]["name"] == 2
    assert json.loads((env.st.root / "papers.json").read_text(encoding="utf-8")) == before and env.model.calls == []
    courses = {c["id"]: c for c in j["courses"]}
    assert set(courses) == {"c2", "c3"} and courses["c2"]["suggestion"] == "circuits" and courses["c3"]["suggestion"] == "not this term"
    j = env.c.post(f"{B}/subjects", json={"apply": True}).json()
    p = env.st.get_paper(ids["code"])
    assert (p["subject"], p["subject_source"], p["subject_rule"]) == ("circuits", "rule", "code")
    assert env.st.get_paper(ids["hand"])["subject"] == "circuits"          # his choice stands, though its title names ZX4101
    snap = (env.st.root / "papers.json").read_text(encoding="utf-8")
    j2 = env.c.post(f"{B}/subjects", json={"apply": True}).json()
    assert (env.st.root / "papers.json").read_text(encoding="utf-8") == snap and j2["counts"]["course"] == 0


def test_the_model_suggests_only_and_sees_only_the_title_and_the_opening(env):
    ids = seed_subjects(env)
    env.model.subject_by_title.update({"Unit test 3": "signals", "Mystery paper": "history"})
    j = env.c.post(f"{B}/subjects", json={"use_model": True, "apply": True}).json()
    envelope(j)
    by = {r["paper"]: r for r in j["items"]}
    assert (by[ids["model"]]["subject"], by[ids["model"]]["rule"], by[ids["model"]]["written"]) == ("signals", "model", "suggestion")
    assert by[ids["dropped"]]["subject"] == "" and j["counts"]["model_dropped"] == 1
    p = env.st.get_paper(ids["model"])
    assert p["subject"] == "" and (p["subject_suggestion"], p["subject_suggestion_model"]) == ("signals", "fake:test-model")
    assert "subject_suggestion" not in env.st.get_paper(ids["dropped"])
    users = [u for _, u in env.model.calls]
    sent = next(u for u in users if "Unit test 3" in u)
    assert "sampled signals train" in sent and "SECRETWORD" not in sent and "Unit test 3.pdf" not in sent
    n = len(env.model.calls)
    env.c.post(f"{B}/subjects", json={"use_model": True, "apply": True})
    assert sum("Unit test 3" in u for _, u in env.model.calls[n:]) == 0         # its pick is on file: not asked twice


@pytest.mark.parametrize("how", ["use_model_false", "mode_off", "rules_only"])
def test_no_model_call_when_it_is_not_allowed(env, how):
    seed_subjects(env)
    seed_tags(env.st)
    if how == "mode_off":
        env.mp.setattr(prep, "_cli", lambda: fake_cli(mode="off"))
    if how == "rules_only":
        settings.save(env.st, True)
    flag = how != "use_model_false"
    j = env.c.post(f"{B}/subjects", json={"use_model": flag, "apply": True}).json()
    assert j["counts"]["model"] == 0
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": flag, "apply": True}).json()
    assert j["model"] == 0 and env.model.calls == []


# ------------------------------------------------------------------ R-68
def seed_tags(st, extra=0):
    pid = paper(st, "Signals paper", "signals")
    ids = {"rule": add_q(st, pid, "State and prove the sampling theorem; show the sampling rate needed.")}
    ids["model"] = add_q(st, pid, "Discuss the use of a Hamming taper in spectral work.")
    ids["none"] = add_q(st, pid, "Describe the history of the telephone exchange.")
    ids["drop"] = add_q(st, pid, "Explain random processes and their moments.")
    ids["hand"] = add_q(st, pid, "Discuss the Hamming window once more, tagged by hand.")
    st.update_question(ids["hand"], {"unit": 1, "topic": "aliasing"})
    ids["picture"] = add_q(st, pid, "", text_status="none")
    for i in range(extra):
        add_q(st, pid, f"Extra hamming item number {i} with words.")
    return ids


WORDS = {"hamming": "window design", "random": "random processes", "telephone": "none"}


def test_rule_first_then_the_model_and_every_tag_names_its_source(env):
    ids = seed_tags(env.st)
    env.model.topic_by_word.update(WORDS)
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True}).json()
    envelope(j)
    assert (j["rule"], j["model"], j["none"], j["dropped"], j["left"]) == (1, 1, 2, 1, 0)
    assert env.st.get_question(ids["rule"])["tag_source"] == "none"            # apply false: nothing written
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    q = env.st.get_question(ids["rule"])
    assert (q["unit"], q["topic"], q["tag_source"]) == (1, "sampling theorem", "rule") and q["tag_score"] is not None
    q = env.st.get_question(ids["model"])
    assert (q["unit"], q["topic"], q["tag_source"], q["tag_model"]) == (2, "window design", "model", "fake:test-model")
    assert env.st.get_question(ids["drop"])["tag_source"] == "none"           # a topic not in his syllabus is dropped
    h = env.st.get_question(ids["hand"])
    assert (h["unit"], h["topic"], h["tag_source"]) == (1, "aliasing", "hand") and j["held_by_hand"] == 1
    assert j["no_text"] == 1
    sent = "\n".join(u for _, u in env.model.calls)
    assert "tagged by hand" not in sent and "sampling rate needed" not in sent   # only what the rule left goes to the model
    snap = (env.st.root / "questions").joinpath(f"{env.st.get_question(ids['rule'])['paper_id']}.json").read_text(encoding="utf-8")
    j2 = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert (j2["rule"], j2["model"]) == (0, 0)
    assert (env.st.root / "questions").joinpath(f"{env.st.get_question(ids['rule'])['paper_id']}.json").read_text(encoding="utf-8") == snap


def test_batches_of_twenty_a_failed_batch_is_counted_and_untouched_and_limit_bounds_a_call(env):
    seed_tags(env.st, extra=50)                       # 53 questions left by the rule: the taper, the telephone, the random one, 50 extras
    env.model.topic_by_word.update(WORDS)
    env.model.fail_calls.add(2)
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True, "limit": 45}).json()
    sizes = [len(re.findall(r"^Q\d+: ", u, re.M)) for _, u in env.model.calls]
    assert sizes == [20, 20, 5] and j["asked"] == 45 and j["failed_batches"] == 1
    tagged = [q for q in env.st.list_questions(subject="signals") if q["tag_source"] == "model"]
    # batch 1: 18 tagged, the telephone (none) and the random one (dropped); batch 2 failed; batch 3: 5 tagged
    assert len(tagged) == j["model"] == 23 and (j["none"], j["dropped"]) == (2, 1)
    assert j["left"] == 53 - 20 - 5                   # the failed batch and the 8 beyond the limit are still without a topic
    assert "1 batch of the model failed" in j["reason"]
    assert env.c.post(f"{B}/tags", json={"subject": "signals", "limit": 0}).status_code == 400
    assert env.c.post(f"{B}/tags", json={"subject": "signals", "limit": 201}).status_code == 400


def test_tags_refusals(env):
    assert env.c.post(f"{B}/tags", json={"subject": "nope"}).status_code == 404
    assert env.c.post(f"{B}/tags", json={}).status_code == 400
    assert env.c.post(f"{B}/tags", json={"subject": "signals", "apply": "yes"}).status_code == 400
    assert env.c.post(f"{B}/tags", json={"subject": "signals", "grade": 3}).status_code == 400
    assert env.c.post(f"{B}/tags", json={"subject": "../etc"}).status_code == 404
    assert env.c.post(f"{B}/tags", json={"subject": "empty"}).json()["state"] == "waiting"


def test_an_answer_that_brings_anything_else_is_refused_whole():
    f = {"question_ids": "Q1,Q2", "topic_ids": "T1,T2"}
    ok = ww_counsel.check_output("tag_topics", {"tags": [{"q": "Q1", "topic": "T2"}, {"q": "Q2", "topic": "T9"}]}, f)
    assert ok == {"tags": [{"q": "Q1", "topic": "T2"}, {"q": "Q2", "topic": "", "dropped": "T9"}]}
    for bad in ({"tags": [{"q": "Q1", "topic": "T1", "why": "it says so"}]}, {"tags": [{"q": "Q3", "topic": "T1"}]},
                {"tags": [{"q": "Q1", "topic": "T1"}, {"q": "Q1", "topic": "T2"}]}, {"tags": [], "score": 1}, {"tags": "T1"}):
        assert ww_counsel.check_output("tag_topics", bad, f) is None
    s = {"subject_ids": "signals,circuits"}
    assert ww_counsel.check_output("subject_pick", {"subject": "Signals"}, s) == {"subject": "signals"}
    assert ww_counsel.check_output("subject_pick", {"subject": "none"}, s) == {"subject": "none"}
    assert ww_counsel.check_output("subject_pick", {"subject": "history"}, s)["subject"] == ""
    assert ww_counsel.check_output("subject_pick", {"subject": "signals", "confidence": 0.9}, s) is None


def test_a_model_that_rambles_is_a_failed_batch(env):
    seed_tags(env.st)
    env.model.raw = "I think these are about windows."
    j = env.c.post(f"{B}/tags", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert j["failed_batches"] == 1 and j["model"] == 0 and j["left"] == 3


def test_the_switch_decides_the_provider_and_the_name(tmp_path, monkeypatch):
    st, given, cli_p = Store(tmp_path / "pyq"), object(), object()
    monkeypatch.setattr(prep, "_cli", lambda: None)                 # the switch module not in the tree: the local model, as before
    m = prep.model_for(st)
    assert m.mode == "local" and m.provider is None and m.name.startswith("local:")
    monkeypatch.setattr(prep, "_cli", lambda: fake_cli("claude", cli_p, "claude-cli:haiku"))
    assert prep.model_for(st) == ("claude", cli_p, "claude-cli:haiku")
    assert prep.model_for(st, given).provider is given
    monkeypatch.setattr(prep, "_cli", lambda: fake_cli("off", cli_p, "off"))
    assert prep.model_for(st, given) == ("off", None, "off")
    monkeypatch.setattr(prep, "_cli", lambda: fake_cli("anything", cli_p, "x"))
    assert prep.model_for(st, given).mode == "off"                  # an answer it does not know never reads as permission
    monkeypatch.setattr(prep, "_cli", lambda: fake_cli("claude", cli_p, "claude-cli:haiku"))
    settings.save(st, True)
    assert prep.model_for(st, given).mode == "off"                  # rules only (R-35) is off too


# ------------------------------------------------------------------ R-67
def old_reading(st, pid, keep_marks=0):
    """What an older reader left: the same questions without their marks (the store's own write, as the reader made it)."""
    rows = st.list_questions(paper_id=pid)
    for i, q in enumerate(rows):
        if i >= keep_marks:
            q["marks"], q["marks_source"] = None, "missing"
    st._save(st._qpath(pid), rows)


def test_reread_compares_writes_only_with_apply_keeps_a_backup_and_is_safe_twice(env):
    path = build_pdf(BY_NAME["signals_basic"], env.tmp / "in")
    pid = ingest.ingest_pdf(path, store=env.st, meta={"title": "Signals practice", "subject": "signals"})["paper"]["id"]
    old_reading(env.st, pid)
    old_ids = [q["id"] for q in env.st.list_questions(paper_id=pid)]
    j = env.c.post(f"{B}/reread", json={"papers": [pid]}).json()
    envelope(j)
    r = j["items"][0]
    assert (r["questions_before"], r["questions_after"], r["marks_before"], r["marks_after"], r["changed"]) == (6, 6, 0, 6, True)
    assert sum(q["marks"] is not None for q in env.st.list_questions(paper_id=pid)) == 0     # nothing written
    r = env.c.post(f"{B}/reread", json={"papers": [pid], "apply": True}).json()["items"][0]
    assert r["changed"] is True and r["backup"] == f"reread-backup/{pid}.json"
    qs = env.st.list_questions(paper_id=pid)
    assert [q["marks"] for q in qs] == [2, 3, 5, 10, 5, 5] and not set(q["id"] for q in qs) & set(old_ids)
    assert all(env.st.crop_path(q["id"]) is not None for q in qs)
    assert env.st.get_paper(pid)["subject"] == "signals" and env.st.get_paper(pid)["reread_at"]
    backup = json.loads((env.st.root / r["backup"]).read_text(encoding="utf-8"))
    assert len(backup) == 1 and [q["id"] for q in backup[0]["questions"]] == old_ids
    assert not (env.st.root / "reread").exists() or not any((env.st.root / "reread").iterdir())
    r = env.c.post(f"{B}/reread", json={"papers": [pid], "apply": True}).json()["items"][0]
    assert r["changed"] is False and "same questions" in r["reason"]


def test_reread_never_loses_marks_never_replaces_his_work_and_is_409_while_the_desk_reads(env):
    path = build_pdf(BY_NAME["signals_basic"], env.tmp / "in")
    pid = ingest.ingest_pdf(path, store=env.st, meta={"subject": "signals"})["paper"]["id"]
    add_q(env.st, pid, "An extra question that an older reader once found, with marks.", marks=4)
    r = env.c.post(f"{B}/reread", json={"papers": [pid], "apply": True}).json()["items"][0]
    assert (r["marks_before"], r["marks_after"], r["changed"]) == (7, 6, False) and "fewer questions with marks" in r["reason"]
    assert len(env.st.list_questions(paper_id=pid)) == 7
    old_reading(env.st, pid, keep_marks=1)
    first = env.st.list_questions(paper_id=pid)[0]
    env.st.update_question(first["id"], {"status": "accepted"})
    r = env.c.post(f"{B}/reread", json={"papers": [pid], "apply": True}).json()["items"][0]
    assert r["changed"] is False and "1 accepted" in r["reason"] and env.st.get_question(first["id"])["status"] == "accepted"
    env.app.state.pyq_ingest = SimpleNamespace(running=lambda: True)
    assert env.c.post(f"{B}/reread", json={"papers": [pid]}).status_code == 409
    env.app.state.pyq_ingest = None
    for bad in (["../../x"], ["p-zzzzzzzzzzzz"], "p-1", [], [3]):
        assert env.c.post(f"{B}/reread", json={"papers": bad}).status_code in (400, 404)
    assert env.c.post(f"{B}/reread", json={"apply": 1}).status_code == 400
    hand = paper(env.st, "Typed by hand")
    assert "original is not on file" in prep.reread(env.st, [hand], True)[0]["reason"]


# ------------------------------------------------------------------ R-69 to R-71
def seed_accept(st):
    pid = paper(st, "Signals end sem", "signals")
    ocr = paper(st, "Signals scanned", "signals", method="mixed")
    long = "Derive the condition on the sampling rate that avoids aliasing of a band limited signal."
    ids = {}

    def tagged(p, text, **kw):
        q = add_q(st, p, text, **kw)
        st.update_question(q, {"unit": 1, "topic": "sampling theorem", "tag_source": "rule"}, "rule")
        return q
    ids["ok1"] = tagged(pid, long)
    ids["ok2"] = tagged(pid, long + " Use a sketch.")
    ids["short"] = tagged(pid, "Define aliasing.")
    ids["nomarks"] = tagged(pid, long + " Again.", marks=None)
    ids["notopic"] = add_q(st, pid, long + " Untagged.")
    ids["ocr"] = tagged(ocr, long + " Read by OCR.", text_status="unverified", ocr_confidence=0.91)
    ids["drafted"] = tagged(pid, long + " Drafted.", origin="model-draft")
    ids["mine"] = tagged(pid, long + " Accepted by him.")
    st.update_question(ids["mine"], {"status": "accepted"})
    return ids


def test_acceptance_is_off_by_default_and_then_takes_only_what_is_safe(env):
    ids = seed_accept(env.st)
    assert env.c.get(f"{B}/policy").json()["policy"] == {"auto_accept": False}
    j = env.c.post(f"{B}/accept", json={"subject": "signals"}).json()
    assert j["state"] == "planned" and j["accepted"] == 0 and env.st.get_question(ids["ok1"])["status"] == "pending"
    assert env.c.put(f"{B}/policy", json={"auto_accept": "on"}).status_code == 400
    assert env.c.put(f"{B}/policy", json={"auto_accept": True, "x": 1}).status_code == 400
    assert env.c.put(f"{B}/policy", json={"auto_accept": True}).json()["policy"] == {"auto_accept": True}
    j = env.c.post(f"{B}/accept", json={"subject": "signals"}).json()
    envelope(j)
    assert j["accepted"] == 2 and j["before"]["accepted"] == 1 and j["counts"]["accepted"] == 3
    assert j["held"] == {"40 characters or fewer": 1, "no marks": 1, "no unit and topic": 1, "not from a text layer": 2}
    for k in ("ok1", "ok2"):
        q = env.st.get_question(ids[k])
        assert (q["status"], q["status_by"], q["accepted_by"], q["tag_source"]) == ("accepted", "rule", "rule", "rule")
    for k in ("short", "nomarks", "notopic", "ocr", "drafted"):
        assert env.st.get_question(ids[k])["status"] == "pending"
    assert env.c.post(f"{B}/accept", json={"subject": "signals"}).json()["accepted"] == 0     # a second press changes nothing


def test_unaccept_returns_exactly_the_rule_accepted_and_touches_nothing_he_accepted(env):
    ids = seed_accept(env.st)
    prep.set_policy(env.st, True)
    env.c.post(f"{B}/accept", json={"subject": "signals"})
    env.st.update_question(ids["ok2"], {"status": "accepted"})          # he accepts it himself after the rule did
    j = env.c.post(f"{B}/unaccept", json={"subject": "signals"}).json()
    envelope(j)
    assert j["returned"] == 1 and j["before"]["accepted"] == 3 and j["counts"]["accepted"] == 2
    q = env.st.get_question(ids["ok1"])
    assert (q["status"], q["accepted_by"]) == ("pending", "")
    assert env.st.get_question(ids["ok2"])["status"] == "accepted" and env.st.get_question(ids["mine"])["status"] == "accepted"
    assert env.c.post(f"{B}/unaccept", json={"subject": "signals"}).json()["returned"] == 0
    assert env.c.post(f"{B}/unaccept", json={"subject": "nope"}).status_code == 404
    assert env.c.post(f"{B}/accept", json={}).status_code == 400


def test_the_plan_not_up_is_503(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "default_store", lambda: Store(tmp_path / "pyq"))
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=None), None)
    with TestClient(app) as c:
        assert c.get(B).status_code == 503

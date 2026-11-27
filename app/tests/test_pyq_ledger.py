"""The ledger (ww_pyq/ledger.py, routes R-60 to R-62 in routes_ww_pyq_ledger.py). Each test has its own Store under
tmp_path; the plan, the notes and the date sheet are fakes, the sheets and attempts.jsonl are written by hand in the
shapes N01 and R-27 write them. Every paper, note and mark is invented."""
import json
import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_ledger as R
from jarvis_app import ww_check
from jarvis_app.ww_pyq import ledger, schema, tag
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

B = "/api/mission/pyq/ledger"
TODAY = "2026-11-27"
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Filters", "topics": ["low pass filter", "band pass filter"], "exam_weight": "low"}]
SAMP, ALIAS, LOW, BAND = "1|sampling theorem", "1|aliasing", "2|low pass filter", "2|band pass filter"
NOTES = [
    {"file_id": "f1", "title": "Unit 1 notes", "text": (
        "# Unit 1\n\nThe sampling theorem states that a band-limited signal can be rebuilt from its samples when the rate "
        "is more than twice the highest frequency present.\n\nAliasing appears when the rate is too low, and high "
        "frequencies fold back onto the others in the sampled spectrum.\n")},
    {"file_id": "f2", "title": "Unit 2 notes", "text": "A low-pass network lets the low frequencies through and stops the high ones above its cutoff."},
    {"file_id": "f3", "title": "Revision", "text": "Revision: the sampling theorem again, with the rule that the rate must exceed twice the top frequency."},
]
FORBIDDEN = re.compile(r"\b(important|likely|expected|probability|chance|forecast|predict\w*|will be asked|on track)\b", re.I)
GID = "g-0123456789ab"
TEMPLATE = "n:rc_filter:7:u2"


class FakePlan:
    def academics(self):
        return {"subjects": [{"id": "signals", "name": "Signals", "units": UNITS},
                             {"id": "quiet", "name": "Quiet", "units": [{"n": 1, "title": "Heat", "topics": ["entropy"]}]},
                             {"id": "empty", "name": "Empty", "units": []}]}

    def load(self, today=None):
        return {}


def seed_questions(st):
    """Two invented papers and one model draft. Returns the store ids of the four past questions."""
    def paper(title, year, kind="hand"):
        return st.add_paper({"title": title, "subject": "signals", "year": year, "kind": kind, "method": "typed",
                             "exam_kind": "cie", "pages": 0, "faults": [], "source_note": "test"})
    p1, p2, pd = paper("Mid 2024", 2024), paper("Mid 2025", 2025), paper("Drafts", None)
    rows = {
        p1: [("Explain the sampling theorem for a signal with a 10 kHz band limit and find the least rate.", 5, 1, "sampling theorem"),
             ("Design a low pass filter with a cutoff of 2 kHz using one resistor and one capacitor.", 10, 2, "low pass filter")],
        p2: [("Explain the sampling theorem for a signal with a 20 kHz band limit and find the least rate.", 5, 1, "sampling theorem"),
             ("What is aliasing and how is it kept out of a sampled recording?", 4, 1, "aliasing")],
    }
    ids = {}
    for pid, qs in rows.items():
        made = st.add_questions(pid, [{"text": t, "marks": m, "marks_source": "hand", "section": "A"} for t, m, _, _ in qs])
        for (t, m, u, top), qid in zip(qs, made):
            st.update_question(qid, {"status": "accepted", "unit": u, "topic": top, "tag_source": "hand"}, "hand")
            ids.setdefault(top, []).append(qid)
    # a question the model drafted and he accepted: it is in his bank, but it was never set in a paper
    d = st.add_questions(pd, [{"text": "Sketch a band pass filter from two sections.", "marks": 5, "marks_source": "hand",
                               "section": "", "origin": "model-draft"}])[0]
    st.update_question(d, {"status": "accepted", "unit": 2, "topic": "band pass filter", "tag_source": "hand"}, "hand")
    return ids


def write_sheet(st, sid, date, subject, items, marks):
    folder = st.root / "sheets"
    folder.mkdir(exist_ok=True)
    sheet = {"id": sid, "date": date, "subject": subject, "built_at": f"{date}T19:00:00", "items": items, "marks": marks}
    (folder / f"{sid}.json").write_text(json.dumps(sheet), encoding="utf-8")


def item(n, qid, marks, unit, topic):
    return {"n": n, "question_id": qid, "marks": marks, "unit": unit, "topic": topic, "topic_key": f"{unit}|{topic}"}


def seed_marks(st, ids):
    qa, ql, qal = ids["sampling theorem"][0], ids["low pass filter"][0], ids["aliasing"][0]
    write_sheet(st, "2026-11-20-signals", "2026-11-20", "signals",
                [item(1, qa, 5, 1, "sampling theorem"), item(2, ql, 10, 2, "low pass filter")],
                [{"question_id": qa, "got": 2, "max": 5, "minutes": 12, "at": "2026-11-20T20:10:00"},
                 {"question_id": qa, "got": 4, "max": 5, "minutes": 10, "at": "2026-11-20T20:30:00"},     # replaces the first
                 {"question_id": ql, "got": 3, "max": 10, "minutes": None, "at": "2026-11-20T20:40:00"}])
    write_sheet(st, "2026-11-22-signals", "2026-11-22", "signals", [item(1, ql, 10, 2, "low pass filter")],
                [{"question_id": ql, "got": 2, "max": 10, "minutes": 15, "at": "2026-11-22T19:30:00"}])
    write_sheet(st, "2026-11-20-maths", "2026-11-20", "maths", [item(1, "q-other", 5, 1, "limits")],
                [{"question_id": "q-other", "got": 5, "max": 5, "minutes": 5, "at": "2026-11-20T21:00:00"}])
    paper = {"id": GID, "exam": "signals-cie", "subject": "signals", "seed": 0, "made": "2026-11-21T18:00:00",
             "sections": [{"name": "A", "marks": 4, "slots": [
                 {"n": 1, "source": "hand", "question_id": qal, "marks": 4, "unit": 1, "topic": "aliasing"},
                 {"n": 2, "source": "template", "question_id": TEMPLATE, "marks": 5, "unit": 2, "topic": "low pass filter"}]}]}
    (st.paths.generated / f"{GID}.json").write_text(json.dumps(paper), encoding="utf-8")
    lines = [{"question_id": qal, "paper_id": GID, "got": 3, "max": 4, "marked_by": "you", "date": "2026-11-21"},
             {"question_id": TEMPLATE, "paper_id": GID, "got": 1, "max": 5, "marked_by": "you", "date": "2026-11-21"},
             # a line another writer adds for a sheet: the sheet file is its record, so it is not counted twice
             {"question_id": ql, "paper_id": "2026-11-22-signals", "got": 2, "max": 10, "marked_by": "you", "date": "2026-11-22"}]
    (st.root / "attempts.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")
    return qa, ql, qal


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(R, "notes_of", lambda subject: NOTES if subject == "signals" else [])
    exams = [{"id": "signals-cie", "subject": "signals", "date": "2026-12-08", "title": "Signals CIE"}]
    monkeypatch.setattr(R, "exams", lambda: exams)
    monkeypatch.setattr(R, "_today", lambda: TODAY)
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=FakePlan()), SimpleNamespace(publish=lambda *a, **k: None))
    with TestClient(app) as c:
        yield c, st, exams


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    assert not FORBIDDEN.search(json.dumps(j)), FORBIDDEN.search(json.dumps(j)).group(0)


# ------------------------------------------------------------------ the route table
def test_the_three_routes_are_in_the_docstring_and_nothing_else_is(env):
    c, _, _ = env
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)\s+(R-\d+)", R.__doc__, re.M)
    assert [r[2] for r in rows] == ["R-60", "R-61", "R-62"]
    documented = {(m, p.split("?")[0]) for m, p, _ in rows}
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(B) and m != "HEAD"}
    assert documented == defined
    assert documented <= ww_check.routes_documented() and documented <= ww_check.routes_defined()


# ------------------------------------------------------------------ R-60
def test_each_number_of_the_ledger_is_the_hand_count(env):
    c, st, _ = env
    seed_marks(st, seed_questions(st))
    j = c.get(B, params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "live" and j["skipped"] == [] and j["count"] == 4
    by = {i["key"]: i for i in j["items"]}
    assert [i["key"] for i in j["items"]] == [SAMP, ALIAS, LOW, BAND]                 # the syllabus order
    s, a, lo, ba = by[SAMP], by[ALIAS], by[LOW], by[BAND]
    assert (s["syllabus_weight"], lo["syllabus_weight"]) == (3, 1)
    # notes: f1 and f3 mention the sampling theorem, f1 aliasing, f2 the low pass network, none the band pass filter
    assert (s["notes"], a["notes"], lo["notes"], ba["notes"]) == (2, 1, 1, 0) and s["note_files"] == ["f1", "f3"]
    # two sampling questions, one paper each, the same question with other numbers: one family
    assert (s["past_questions"], s["past_marks"], s["papers_seen"], s["families"]) == (2, 10, 2, 1)
    assert (a["past_questions"], a["past_marks"], a["papers_seen"], a["families"]) == (1, 4, 1, 1)
    assert (lo["past_questions"], lo["past_marks"], lo["papers_seen"], lo["families"]) == (1, 10, 1, 1)
    assert (ba["past_questions"], ba["families"]) == (0, 0)                             # the model's draft is not a past question
    # marks: the second mark of a question on one sheet replaces the first; sheets and the paper both count
    assert (s["attempts"], s["got"], s["max"], s["minutes"], s["last_practised"]) == (1, 4, 5, 10, "2026-11-20")
    assert (a["attempts"], a["got"], a["max"], a["minutes"], a["last_practised"]) == (1, 3, 4, None, "2026-11-21")
    assert (lo["attempts"], lo["got"], lo["max"], lo["minutes"], lo["last_practised"]) == (3, 6, 25, 15, "2026-11-22")
    assert (ba["attempts"], ba["got"], ba["max"], ba["minutes"], ba["last_practised"]) == (0, 0, 0, None, None)
    assert {(h["key"], h["kind"]) for h in j["holes"]} == {(BAND, "no_notes"), (BAND, "no_past_question"),
                                                           (BAND, "never_practised"), (LOW, "under_half")}
    assert all(h["sentence"] for h in j["holes"])
    assert j["totals"] == {"topics": 4, "with_notes": 3, "with_past_question": 3, "practised": 3, "past_questions": 4,
                           "past_marks": 24, "attempts": 5, "got": 13, "max": 34, "minutes": 25,
                           "holes": {"no_notes": 1, "no_past_question": 1, "never_practised": 1, "under_half": 1},
                           "attempts_outside_syllabus": 0}


def test_under_half_needs_two_attempts():
    topics = [{"unit": 1, "topic": "aliasing", "key": ALIAS, "keywords": [], "weight": "med"}]
    row = {"at": "2026-11-20", "source": "sheet", "source_id": "s", "question_id": "q", "topic_key": ALIAS, "got": 1.0, "max": 5.0, "minutes": None}
    one = ledger.build_ledger(topics, [], [], [], [row])
    assert [h["kind"] for h in one["holes"]] == ["no_notes", "no_past_question"]
    two = ledger.build_ledger(topics, [], [], [], [row, {**row, "question_id": "r", "got": 2.0}])
    assert [h["kind"] for h in two["holes"]][-1] == "under_half" and "3 of 10 over 2 attempts" in two["holes"][-1]["sentence"]
    half = ledger.build_ledger(topics, [], [], [], [row, {**row, "question_id": "r", "got": 4.0}])        # 5 of 10 is half, not under
    assert "under_half" not in [h["kind"] for h in half["holes"]]
    assert ledger.build_ledger(topics, [], [], [], [row, row]) == ledger.build_ledger(topics, [], [], [], [row, row])   # pure


def test_a_subject_with_nothing_is_waiting_and_an_unknown_one_is_404(env):
    c, st, _ = env
    j = c.get(B, params={"subject": "quiet"}).json()
    envelope(j)
    assert j["state"] == "waiting" and j["count"] == 1 and {h["kind"] for h in j["holes"]} == {"no_notes", "no_past_question", "never_practised"}
    e = c.get(B, params={"subject": "empty"}).json()
    assert e["state"] == "waiting" and e["reason"] == "This subject has no syllabus topics yet." and e["items"] == []
    assert c.get(B, params={"subject": "nope"}).status_code == 404
    assert c.get(B).status_code == 400
    for path in ("/attempts", "/pace"):
        assert c.get(B + path, params={"subject": "nope"}).status_code == 404
        assert c.get(B + path).status_code == 400


def test_a_corrupt_sheet_is_skipped_and_reported_not_a_crash(env):
    c, st, _ = env
    seed_marks(st, seed_questions(st))
    (st.root / "sheets" / "2026-11-24-signals.json").write_text("{not json", encoding="utf-8")
    (st.root / "sheets" / "2026-11-25-signals.json").write_text(json.dumps({"id": "something-else", "items": [], "marks": []}), encoding="utf-8")
    write_sheet(st, "2026-11-26-signals", "2026-11-26", "signals", [item(1, "q-x-1", 5, 1, "aliasing")],
                [{"question_id": "q-not-on-it", "got": 3, "max": 5, "minutes": 4, "at": "2026-11-26T20:00:00"},
                 {"question_id": "q-x-1", "got": "four", "max": 5, "minutes": 4, "at": "2026-11-26T20:05:00"}])
    with (st.root / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"question_id": "q-y", "paper_id": "g-ffffffffffff", "got": 1, "max": 2, "date": "2026-11-23"}) + "\n")
        f.write('{"torn line')
    j = c.get(B, params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "live" and j["totals"]["attempts"] == 5                       # the good marks are all still counted
    assert {s["file"] for s in j["skipped"]} == {"2026-11-24-signals.json", "2026-11-25-signals.json", "2026-11-26-signals.json", "attempts.jsonl"}
    assert "4 files had something that could not be read" in j["reason"]
    assert len(c.get(B + "/attempts", params={"subject": "signals"}).json()["skipped"]) == 5


# ------------------------------------------------------------------ R-61
def test_every_mark_newest_first_from_both_sources_with_the_filters(env):
    c, st, _ = env
    qa, ql, qal = seed_marks(st, seed_questions(st))
    j = c.get(B + "/attempts", params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "live" and j["reason"] == "5 marks on file: 13 of 34."
    assert [(r["source"], r["source_id"], r["question_id"], r["at"]) for r in j["items"]] == [
        ("sheet", "2026-11-22-signals", ql, "2026-11-22T19:30:00"),
        ("paper", GID, TEMPLATE, "2026-11-21"), ("paper", GID, qal, "2026-11-21"),
        ("sheet", "2026-11-20-signals", ql, "2026-11-20T20:40:00"),
        ("sheet", "2026-11-20-signals", qa, "2026-11-20T20:30:00")]
    assert set(j["items"][0]) == {"at", "source", "source_id", "question_id", "topic_key", "got", "max", "minutes"}
    assert j["items"][1]["topic_key"] == LOW and j["items"][1]["minutes"] is None and j["items"][4]["minutes"] == 10
    low = c.get(B + "/attempts", params={"subject": "signals", "topic": LOW}).json()["items"]
    assert [r["topic_key"] for r in low] == [LOW] * 3
    assert c.get(B + "/attempts", params={"subject": "signals", "topic": "Low Pass Filter"}).json()["items"] == low
    assert len(c.get(B + "/attempts", params={"subject": "signals", "from": "2026-11-21"}).json()["items"]) == 3
    assert len(c.get(B + "/attempts", params={"subject": "signals", "to": "2026-11-20"}).json()["items"]) == 2
    one = c.get(B + "/attempts", params={"subject": "signals", "from": "2026-11-21", "to": "2026-11-21"}).json()
    assert [r["source"] for r in one["items"]] == ["paper", "paper"]
    none = c.get(B + "/attempts", params={"subject": "signals", "topic": BAND}).json()
    assert none["state"] == "waiting" and none["items"] == []
    assert c.get(B + "/attempts", params={"subject": "signals", "topic": "black holes"}).status_code == 404
    for bad in ({"from": "2026-13-01"}, {"to": "yesterday"}, {"from": "2026-11-22", "to": "2026-11-20"}):
        r = c.get(B + "/attempts", params={"subject": "signals", **bad})
        assert r.status_code == 400 and r.json()["detail"].endswith(".")


# ------------------------------------------------------------------ R-62
KEYS = [f"1|t{i}" for i in range(10)]


def mark(day, key, q="q"):
    return {"at": day, "source": "sheet", "source_id": f"{day}-s", "question_id": q, "topic_key": key, "got": 1.0, "max": 2.0, "minutes": None}


def test_pace_with_no_mark_is_waiting_and_divides_nothing(env):
    p = ledger.build_pace(KEYS, [], [], "signals", TODAY)
    assert (p["days_counted"], p["per_day"], p["days_needed"], p["left"]) == (0, None, None, 10)
    c, st, _ = env
    j = c.get(B + "/pace", params={"subject": "quiet"}).json()
    envelope(j)
    assert j["state"] == "waiting" and j["days_counted"] == 0 and j["sentence"].startswith("No mark on file")


def test_pace_over_one_day_of_marks():
    p = ledger.build_pace(KEYS[:4], [mark("2026-11-26", KEYS[0]), mark("2026-11-26", KEYS[1], "r")], [], "signals", TODAY)
    assert (p["days_counted"], p["practised_in_days"], p["per_day"], p["left"], p["days_needed"]) == (1, 2, 2.0, 2, 1)
    assert "your one day with a mark (2026-11-26)" in p["sentence"] and not FORBIDDEN.search(p["sentence"])


def test_pace_counts_only_the_last_seven_days_with_a_mark():
    rows = [mark(f"2026-11-{d:02d}", KEYS[d - 1]) for d in range(1, 10)]                # day d practises topic d-1 first
    rows += [mark("2026-11-08", KEYS[0], "again"), mark("2026-12-30", KEYS[9], "later")]  # a repeat is not new; a future day is not his log yet
    p = ledger.build_pace(KEYS, rows, [], "signals", TODAY)
    assert (p["days_counted"], p["from"], p["to"]) == (7, "2026-11-03", "2026-11-09")
    assert (p["practised"], p["left"], p["practised_in_days"], p["per_day"], p["days_needed"]) == (9, 1, 7, 1.0, 1)
    assert "your last 7 days with a mark (2026-11-03 to 2026-11-09): 7 topics marked for the first time, 1 a day" in p["sentence"]
    slow = ledger.build_pace(KEYS, [mark("2026-11-20", KEYS[0]), mark("2026-11-21", KEYS[0], "r")], [], "signals", "2026-11-22")
    assert slow["per_day"] == 0.5 and slow["days_needed"] == 18                         # 9 left at 1 topic over 2 days: 9 x 2 / 1
    same = ledger.build_pace(KEYS, [mark(f"2026-11-{d:02d}", KEYS[0], str(d)) for d in range(1, 9)], [], "signals", TODAY)
    assert (same["days_counted"], same["practised_in_days"], same["per_day"], same["days_needed"]) == (7, 0, 0.0, None)
    assert "give no number of days" in same["sentence"]                                # topic 0 was first marked before the window
    p2 = ledger.build_pace(KEYS[:3], [mark("2026-11-20", k, k) for k in KEYS[:3]], [], "signals", TODAY)
    assert p2["left"] == 0 and p2["days_needed"] == 0 and "Every topic of the syllabus has a mark on file." in p2["sentence"]


def test_pace_names_the_paper_today_and_never_one_already_sat(env):
    today = [{"id": "x", "subject": "signals", "date": TODAY}, {"id": "y", "subject": "signals", "date": "2026-12-20"}]
    p = ledger.build_pace(KEYS, [mark("2026-11-26", KEYS[0])], today, "signals", TODAY)
    assert (p["paper_date"], p["days_left"]) == (TODAY, 0) and "The paper is today" in p["sentence"]
    past = [{"id": "z", "subject": "signals", "date": "2026-11-10"}, {"id": "w", "subject": "maths", "date": "2026-12-01"}]
    q = ledger.build_pace(KEYS, [mark("2026-11-26", KEYS[0])], past, "signals", TODAY)
    assert (q["paper_date"], q["days_left"]) == (None, None) and "No paper of this subject is on the date sheet ahead." in q["sentence"]
    c, st, exams = env
    seed_marks(st, seed_questions(st))
    j = c.get(B + "/pace", params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "live" and (j["paper_date"], j["days_left"]) == ("2026-12-08", 11)
    assert (j["topics"], j["practised"], j["left"], j["days_counted"], j["practised_in_days"], j["per_day"], j["days_needed"]) == (4, 3, 1, 3, 3, 1.0, 1)
    assert j["sentence"] == ("Counted over your last 3 days with a mark (2026-11-20 to 2026-11-22): 3 topics marked for the first time, "
                             "1 a day. At that rate the topics left (1) take 1 more day with a mark. The paper is on 2026-12-08, 11 days from today.")
    assert tag.topics_of(FakePlan().academics()["subjects"][0])[0]["key"] == SAMP


# ------------------------------------------------------------------ the review's hand count (a second invented case)
CIRC_UNITS = [{"n": 1, "title": "Networks", "topics": ["thevenin theorem", "norton theorem"], "exam_weight": "high"},
              {"n": 2, "title": "Transients", "topics": ["rl circuit", "rc circuit"], "exam_weight": "low"}]
TH, NO, RL, RC = "1|thevenin theorem", "1|norton theorem", "2|rl circuit", "2|rc circuit"
CIRC_NOTES = [
    {"file_id": "n1", "title": "Network notes", "text": (
        "# Networks\n\nThe thevenin theorem replaces any linear network seen from two terminals by one source and one "
        "series resistance.\n\nThe norton theorem gives the same network as a current source with a parallel resistance "
        "across the terminals.\n")},
    {"file_id": "n2", "title": "Transient notes", "text": (
        "When the switch closes, the current in a series circuit with a coil rises along an exponential curve to its final value.")},
    {"file_id": "n3", "title": "Scrap", "text": "thevenin theorem, see the book"},          # under 60 characters: no passage
]
CGID, MGID, CTPL = "g-aaaaaaaaaaaa", "g-bbbbbbbbbbbb", "n:rc_tau:3:u2"


class CircPlan:
    def academics(self):
        return {"subjects": [{"id": "circuits", "name": "Circuits", "units": CIRC_UNITS}]}


@pytest.fixture()
def circ(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(R, "notes_of", lambda subject: CIRC_NOTES if subject == "circuits" else [])
    exams = [{"id": "c-old", "subject": "circuits", "date": "2026-11-20"},      # already sat: not the next paper
             {"id": "m", "subject": "maths", "date": "2026-11-30"},             # another subject
             {"id": "c-end", "subject": "circuits", "date": "2026-12-08"}]
    monkeypatch.setattr(R, "exams", lambda: exams)
    monkeypatch.setattr(R, "_today", lambda: TODAY)
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=CircPlan()), SimpleNamespace(publish=lambda *a, **k: None))
    with TestClient(app) as c:
        yield c, st


def seed_circuits(st):
    """Three papers, seven questions (one rejected, one a model draft), one generated paper, two sheets."""
    def paper(title, year):
        return st.add_paper({"title": title, "subject": "circuits", "year": year, "kind": "hand", "method": "typed",
                             "exam_kind": "cie", "pages": 0, "faults": [], "source_note": "test"})
    p1, p2, p3 = paper("End 2023", 2023), paper("End 2024", 2024), paper("End 2025", 2025)
    spec = [  # paper, text, marks, unit, topic, status, origin
        (p1, "State and prove the thevenin theorem for a two source network with a load of 10 ohm.", 6, 1, "thevenin theorem", "accepted", None),
        (p1, "Find the time constant of an rl circuit with a 2 H coil and a 4 ohm resistor.", 4, 2, "rl circuit", "accepted", None),
        (p2, "State and prove the thevenin theorem for a two source network with a load of 20 ohm.", 6, 1, "thevenin theorem", "accepted", None),
        (p2, "Explain the norton theorem and draw the norton equivalent of a bridge network.", 5, 1, "norton theorem", "accepted", None),
        (p3, "Find the time constant of an rl circuit with a 3 H coil and a 6 ohm resistor.", 4, 2, "rl circuit", "accepted", None),
        (p3, "Derive the current through an inductor when a switch closes on a dc source.", 8, 2, "rl circuit", "accepted", None),
        (p3, "Find the charge on an rc circuit capacitor after one time constant.", 10, 2, "rc circuit", "rejected", None),
        (p3, "Sketch the voltage across an rc circuit capacitor while it charges.", 5, 2, "rc circuit", "accepted", "model-draft"),
    ]
    q = []
    for pid, text, m, u, top, status, origin in spec:
        row = {"text": text, "marks": m, "marks_source": "hand", "section": "A"}
        if origin:
            row["origin"] = origin
        qid = st.add_questions(pid, [row])[0]
        st.update_question(qid, {"status": status, "unit": u, "topic": top, "tag_source": "hand"}, "hand")
        q.append(qid)
    q1, q2, q3, q4, q5, q6 = q[:6]
    paper_g = {"id": CGID, "exam": "c-end", "subject": "circuits", "seed": 0, "made": "2026-11-22T18:00:00",
               "sections": [{"name": "A", "marks": 15, "slots": [
                   {"n": 1, "source": "hand", "question_id": q2, "marks": 4, "unit": 2, "topic": "rl circuit"},
                   {"n": 2, "source": "hand", "question_id": q4, "marks": 5, "unit": 1, "topic": "norton theorem"},
                   {"n": 3, "source": "template", "question_id": CTPL, "marks": 6, "unit": 2, "topic": "rc circuit"}]}]}
    other = {"id": MGID, "exam": "m", "subject": "maths", "seed": 0, "made": "2026-11-22T18:00:00",
             "sections": [{"name": "A", "marks": 3, "slots": [{"n": 1, "source": "hand", "question_id": "q-m", "marks": 3, "unit": 1, "topic": "limits"}]}]}
    for p in (paper_g, other):
        (st.paths.generated / f"{p['id']}.json").write_text(json.dumps(p), encoding="utf-8")
    lines = [{"question_id": q2, "paper_id": CGID, "got": 1, "max": 4, "marked_by": "you", "date": "2026-11-23"},
             {"question_id": q4, "paper_id": CGID, "got": 5, "max": 5, "marked_by": "you", "date": "2026-11-23"},
             {"question_id": CTPL, "paper_id": CGID, "got": 2, "max": 6, "marked_by": "you", "date": "2026-11-23"},
             {"question_id": "q-m", "paper_id": MGID, "got": 3, "max": 3, "marked_by": "you", "date": "2026-11-23"},
             {"question_id": q6, "paper_id": "2026-11-26-circuits", "got": 3, "max": 8, "marked_by": "you", "date": "2026-11-26"}]
    (st.root / "attempts.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")
    write_sheet(st, "2026-11-24-circuits", "2026-11-24", "circuits",
                [item(1, q1, 6, 1, "thevenin theorem"), item(2, q5, 4, 2, "rl circuit")],
                [{"question_id": q1, "got": 2, "max": 6, "minutes": 9, "at": "2026-11-24T20:00:00"},
                 {"question_id": q5, "got": 1, "max": 4, "minutes": 7, "at": "2026-11-24T20:20:00"}])
    write_sheet(st, "2026-11-26-circuits", "2026-11-26", "circuits",
                [item(1, q3, 6, 1, "thevenin theorem"), item(2, q6, 8, 2, "rl circuit")],
                [{"question_id": q3, "got": 2, "max": 6, "minutes": None, "at": "2026-11-26T19:40:00"},
                 {"question_id": q6, "got": 3, "max": 8, "minutes": 20, "at": "2026-11-26T20:00:00"}])
    return q


def test_review_hand_count_of_every_number(circ):
    c, st = circ
    q1, q2, q3, q4, q5, q6, _, _ = seed_circuits(st)
    j = c.get(B, params={"subject": "circuits"}).json()
    envelope(j)
    assert j["state"] == "live" and j["skipped"] == []
    by = {i["key"]: i for i in j["items"]}
    cols = ("syllabus_weight", "notes", "past_questions", "past_marks", "papers_seen", "families",
            "attempts", "got", "max", "minutes", "last_practised")
    # thevenin: weight high=3. notes: n1 para 1 holds both topic words (theveni, theorem); n3 is under 60 chars -> 1.
    #   past: q1 (6, 2023) + q3 (6, 2024) -> 2 questions, 12 marks, 2 papers, the same text but a number -> 1 family.
    #   marks: sheet 24th q1 2/6 9 min, sheet 26th q3 2/6 no min -> 2 attempts, 4 of 12, 9 min, last 26th.
    assert tuple(by[TH][k] for k in cols) == (3, 1, 2, 12, 2, 1, 2, 4, 12, 9, "2026-11-26")
    # norton: notes n1 para 2 -> 1. past q4 (5, 2024) -> 1, 5, 1 paper, 1 family. marks: paper line 5/5 on the 23rd.
    assert tuple(by[NO][k] for k in cols) == (3, 1, 1, 5, 1, 1, 1, 5, 5, None, "2026-11-23")
    # rl circuit: weight low=1. "rl" is under 3 letters, so the passage rule looks for "circuit" alone: n2 -> 1.
    #   past q2 (4, 2023), q5 (4, 2025), q6 (8, 2025) -> 3 questions, 16 marks, papers 2023+2025 = 2, families {q2,q5},{q6} = 2.
    #   marks: paper q2 1/4 (23rd), sheet q5 1/4 7 min (24th), sheet q6 3/8 20 min (26th); the attempts.jsonl line naming
    #   the 26th sheet is not a generated paper and is not counted again -> 3 attempts, 5 of 16, 27 min, last 26th.
    assert tuple(by[RL][k] for k in cols) == (1, 1, 3, 16, 2, 2, 3, 5, 16, 27, "2026-11-26")
    # rc circuit: notes n2 by the same "circuit" rule -> 1. past: the rejected question and the model draft are left out -> 0.
    #   marks: the template seat 2/6 on the 23rd -> 1 attempt.
    assert tuple(by[RC][k] for k in cols) == (1, 1, 0, 0, 0, 0, 1, 2, 6, None, "2026-11-23")
    assert by[TH]["note_files"] == ["n1"] and by[RL]["note_files"] == ["n2"] and by[RL]["question_ids"] == sorted([q2, q5, q6])
    # holes: thevenin 4 < 12/2 over 2 attempts; rl 5 < 16/2 over 3; rc has no past question; rc's 2 of 6 is one attempt only
    assert [(h["key"], h["kind"], h["sentence"]) for h in j["holes"]] == [
        (TH, "under_half", "thevenin theorem: 4 of 12 over 2 attempts, under half."),
        (RL, "under_half", "rl circuit: 5 of 16 over 3 attempts, under half."),
        (RC, "no_past_question", "No accepted past question on file is tagged rc circuit.")]
    # totals: 4 topics, all 4 in notes, 3 with a past question, 4 practised; 2+1+3+0 = 6 questions, 12+5+16 = 33 marks;
    #   2+1+3+1 = 7 attempts, 4+5+5+2 = 16 of 12+5+16+6 = 39, 9+27 = 36 minutes
    assert j["totals"] == {"topics": 4, "with_notes": 4, "with_past_question": 3, "practised": 4, "past_questions": 6,
                           "past_marks": 33, "attempts": 7, "got": 16, "max": 39, "minutes": 36,
                           "holes": {"no_notes": 0, "no_past_question": 1, "never_practised": 0, "under_half": 2},
                           "attempts_outside_syllabus": 0}
    assert j["reason"] == "4 topics: 4 in your notes, 3 with a past question, 4 practised; 3 holes."
    # R-61: newest first; the three paper marks share the day 2026-11-23 and are then in question id order
    a = c.get(B + "/attempts", params={"subject": "circuits"}).json()
    envelope(a)
    assert a["reason"] == "7 marks on file: 16 of 39."
    paper_day = [("paper", CGID, x, "2026-11-23") for x in sorted([q2, q4, CTPL])]
    assert [(r["source"], r["source_id"], r["question_id"], r["at"]) for r in a["items"]] == [
        ("sheet", "2026-11-26-circuits", q6, "2026-11-26T20:00:00"), ("sheet", "2026-11-26-circuits", q3, "2026-11-26T19:40:00"),
        ("sheet", "2026-11-24-circuits", q5, "2026-11-24T20:20:00"), ("sheet", "2026-11-24-circuits", q1, "2026-11-24T20:00:00"),
        *paper_day]
    assert [(r["got"], r["max"], r["minutes"], r["topic_key"]) for r in a["items"][:4]] == [
        (3, 8, 20, RL), (2, 6, None, TH), (1, 4, 7, RL), (2, 6, 9, TH)]
    # R-62: today 27 Nov; the next circuits paper is 8 Dec (11 days; the 20 Nov one is sat, maths is another subject).
    #   days with a mark: 23, 24, 26 -> 3. First marks: norton, rl, rc on the 23rd, thevenin on the 24th -> 4 new in the
    #   window, 4/3 = 1.33 a day, none left -> days_needed 0.
    p = c.get(B + "/pace", params={"subject": "circuits"}).json()
    envelope(p)
    assert {k: p[k] for k in ("paper_date", "days_left", "topics", "practised", "left", "days_counted", "practised_in_days",
                              "per_day", "days_needed", "from", "to")} == {
        "paper_date": "2026-12-08", "days_left": 11, "topics": 4, "practised": 4, "left": 0, "days_counted": 3,
        "practised_in_days": 4, "per_day": 1.33, "days_needed": 0, "from": "2026-11-23", "to": "2026-11-26"}
    assert p["sentence"] == ("Counted over your last 3 days with a mark (2026-11-23 to 2026-11-26): 4 topics marked for the "
                             "first time, 1.33 a day. Every topic of the syllabus has a mark on file. The paper is on "
                             "2026-12-08, 11 days from today.")


# ------------------------------------------------------------------ the review's edge cases (double counts, lost marks, bad numbers)
def test_a_second_post_on_the_same_generated_paper_the_same_day_replaces_the_first(circ):
    """R-27 refuses a question twice in one post but appends a second post; a same-day re-post is a correction (as on a
    sheet), a later day is another sitting."""
    c, st = circ
    q = seed_circuits(st)
    with (st.root / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"question_id": q[1], "paper_id": CGID, "got": 3, "max": 4, "marked_by": "you", "date": "2026-11-23"}) + "\n")
    rl = {i["key"]: i for i in c.get(B, params={"subject": "circuits"}).json()["items"]}[RL]
    assert (rl["attempts"], rl["got"], rl["max"]) == (3, 7, 16)                  # 1/4 replaced by 3/4: 3+1+3 of 4+4+8
    with (st.root / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"question_id": q[1], "paper_id": CGID, "got": 4, "max": 4, "marked_by": "you", "date": "2026-11-25"}) + "\n")
    rl = {i["key"]: i for i in c.get(B, params={"subject": "circuits"}).json()["items"]}[RL]
    assert (rl["attempts"], rl["got"], rl["max"]) == (4, 11, 20)                 # the 25th is a second sitting


def test_bad_numbers_in_a_sheet_are_skipped_not_counted_and_never_a_500(circ):
    c, st = circ
    seed_circuits(st)
    write_sheet(st, "2026-11-25-circuits", "2026-11-25", "circuits",
                [item(1, "q-a", 5, 1, "norton theorem"), item(2, "q-b", 5, 1, "norton theorem"),
                 item(3, "q-c", 5, 1, "norton theorem"), item(4, "q-d", 5, 1, "norton theorem")],
                [{"question_id": "q-a", "got": 50, "max": 5, "minutes": 3, "at": "2026-11-25T20:00:00"},       # over its max
                 {"question_id": "q-b", "got": -1, "max": 5, "minutes": 3, "at": "2026-11-25T20:01:00"},       # negative
                 {"question_id": "q-c", "got": 3, "max": 5, "minutes": 3, "at": "2026-11-25T20:02:00"}])
    path = st.root / "sheets" / "2026-11-25-circuits.json"
    # json.dumps cannot write NaN as valid JSON, but Python's reader accepts it: a hand-edited file can hold it
    path.write_text(path.read_text(encoding="utf-8").replace('"got": 3', '"got": NaN'), encoding="utf-8")
    r = c.get(B, params={"subject": "circuits"})
    assert r.status_code == 200
    j = r.json()
    no = {i["key"]: i for i in j["items"]}[NO]
    assert (no["attempts"], no["got"], no["max"]) == (1, 5, 5)                   # only the paper line of the 23rd
    assert [s["file"] for s in j["skipped"]].count("2026-11-25-circuits.json") == 3
    assert c.get(B + "/attempts", params={"subject": "circuits"}).status_code == 200
    assert c.get(B + "/pace", params={"subject": "circuits"}).status_code == 200


def test_a_bad_number_on_a_generated_paper_line_is_skipped(circ):
    c, st = circ
    q = seed_circuits(st)
    with (st.root / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"question_id": q[3], "paper_id": CGID, "got": 9, "max": 5, "date": "2026-11-25"}) + "\n")
        f.write('{"question_id": "%s", "paper_id": "%s", "got": Infinity, "max": 5, "date": "2026-11-25"}\n' % (q[3], CGID))
    r = c.get(B, params={"subject": "circuits"})
    assert r.status_code == 200
    no = {i["key"]: i for i in r.json()["items"]}[NO]
    assert (no["attempts"], no["got"], no["max"]) == (1, 5, 5)


def test_a_mark_keeps_its_topic_when_the_question_is_gone_or_retagged(circ):
    """The sheet item and the paper seat carry the topic he sat; deleting the past paper or re-tagging the question later
    must not lose or move the mark."""
    c, st = circ
    q = seed_circuits(st)
    st.update_question(q[4], {"unit": 1, "topic": "norton theorem", "tag_source": "hand"}, "hand")     # q5 re-tagged
    papers = {p["title"]: p["id"] for p in st.list_papers("circuits")}
    st.delete_paper(papers["End 2023"])                                                                 # q1 and q2 gone
    by = {i["key"]: i for i in c.get(B, params={"subject": "circuits"}).json()["items"]}
    assert (by[TH]["attempts"], by[TH]["got"], by[RL]["attempts"], by[RL]["got"]) == (2, 4, 3, 5)
    assert (by[TH]["past_questions"], by[RL]["past_questions"], by[NO]["past_questions"]) == (1, 1, 2)


def test_a_mark_on_a_topic_no_longer_in_the_syllabus_is_listed_and_counted_outside(circ):
    c, st = circ
    seed_circuits(st)
    write_sheet(st, "2026-11-25-circuits", "2026-11-25", "circuits", [item(1, "q-old", 5, 3, "two port network")],
                [{"question_id": "q-old", "got": 4, "max": 5, "minutes": 6, "at": "2026-11-25T20:00:00"}])
    j = c.get(B, params={"subject": "circuits"}).json()
    assert j["totals"]["attempts"] == 7 and j["totals"]["attempts_outside_syllabus"] == 1
    a = c.get(B + "/attempts", params={"subject": "circuits", "topic": "3|two port network"}).json()
    assert [r["question_id"] for r in a["items"]] == ["q-old"]


def test_r61_a_topic_name_in_two_units_is_not_guessed(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(R, "notes_of", lambda subject: [])
    monkeypatch.setattr(R, "exams", lambda: [])
    monkeypatch.setattr(R, "_today", lambda: TODAY)

    class TwoIntros:
        def academics(self):
            return {"subjects": [{"id": "dup", "units": [{"n": 1, "title": "A", "topics": ["introduction"]},
                                                         {"n": 2, "title": "B", "topics": ["introduction"]}]}]}
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=TwoIntros()), SimpleNamespace(publish=lambda *a, **k: None))
    write_sheet(st, "2026-11-25-dup", "2026-11-25", "dup", [item(1, "q1", 5, 1, "introduction"), item(2, "q2", 5, 2, "introduction")],
                [{"question_id": "q1", "got": 1, "max": 5, "minutes": None, "at": "2026-11-25T20:00:00"},
                 {"question_id": "q2", "got": 2, "max": 5, "minutes": None, "at": "2026-11-25T20:01:00"}])
    with TestClient(app) as c:
        r = c.get(B + "/attempts", params={"subject": "dup", "topic": "Introduction"})
        assert r.status_code == 400 and "1|introduction" in r.json()["detail"]
        assert [x["question_id"] for x in c.get(B + "/attempts", params={"subject": "dup", "topic": "2|introduction"}).json()["items"]] == ["q2"]


def test_the_sheet_cap_keeps_the_newest_sheets_and_says_so(circ, monkeypatch):
    c, st = circ
    seed_circuits(st)
    monkeypatch.setattr(R, "_MAX_SHEETS", 1)
    j = c.get(B + "/attempts", params={"subject": "circuits"}).json()
    assert {r["source_id"] for r in j["items"] if r["source"] == "sheet"} == {"2026-11-26-circuits"}
    assert any(s["file"] == "2026-11-24-circuits.json" for s in j["skipped"])


def test_every_sentence_the_ledger_can_make_is_free_of_forecast_words():
    topics = [{"unit": 1, "topic": "aliasing", "key": ALIAS, "keywords": [], "weight": "med"}]
    row = mark("2026-11-26", ALIAS)
    led = ledger.build_ledger(topics, [], [], [], [row, {**row, "question_id": "r"}])
    texts = [h["sentence"] for h in led["holes"]] + [ledger.ledger_sentence(led)]
    for rows, exams in (([], []), ([row], []), ([row], [{"subject": "signals", "date": TODAY}]),
                        ([row], [{"subject": "signals", "date": "2026-12-01"}]), ([mark("2026-11-26", "9|x")], [])):
        texts.append(ledger.build_pace([ALIAS, SAMP], rows, exams, "signals", TODAY)["sentence"])
    for t in texts:
        assert t and not FORBIDDEN.search(t), t

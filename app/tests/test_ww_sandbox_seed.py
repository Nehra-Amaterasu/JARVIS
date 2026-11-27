"""The seeded sandbox (ww_sandbox --seed study, ww_sandbox_seed.py): invented rows written by the engine's own code, and the
real routes answering live on them, with Google, OCR and the model as fixtures that say so.

Every test works in tmp folders: never the real data directory, never the network (conftest blocks it), never the real OCR
engine, the real sign-in or a model. One seed is shared by the route tests (module scope) because a seed reads several PDFs
and the machine is short of memory; the tests that change it run last in the file.
"""
import hashlib
import json
import re
import sys
import threading
from datetime import date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, paths
from jarvis_app import ww_sandbox
from jarvis_app import ww_sandbox_seed as seed
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32
FEATURES = ["mission", "reminders", "ww_gcr", "ww_harvest", "ww_life", "ww_pyq", "ww_pyq_drafts", "ww_pyq_ingest",
            "ww_pyq_ocr", "ww_pyq_patterns",
            # wave EW9
            "ww_intake", "ww_pyq_gen", "ww_pyq_ledger", "ww_pyq_takeout", "ww_pyq_tonight", "ww_pyq_variants"]
G, P, H = "/api/mission/gcr", "/api/mission/pyq", "/api/mission/harvest"


def counts(d: Path) -> dict:
    """What a second seed must not change: the number of every kind of row."""
    from jarvis_app.ww_gcr import sync
    from jarvis_app.ww_pyq import drafts
    from jarvis_app.ww_pyq.store import Store
    m = sync.GcrStore(d / "gcr").manifest()
    st = Store(d / "pyq")
    harvest = (d / "bank" / "questions" / "_harvest" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()
    inputs = json.loads((d / "engine-inputs.json").read_text(encoding="utf-8"))
    return {"courses": len(m["courses"]), "files": len(m["files"]), "stale": sorted(f for f, r in m["files"].items() if r.get("stale")),
            "work": sum(len(c.get("work") or []) for c in m["courses"].values()),
            "notices": sum(len(c.get("announcements") or []) for c in m["courses"].values()),
            "events": sum(len(c.get("events") or []) for c in (m.get("calendar") or {}).values()),
            "papers": len(st.list_papers()), "questions": len(st.list_questions()),
            "accepted": len(st.list_questions(status="accepted")), "drafts": len(drafts.list_drafts(st)),
            "pointers": len(harvest), "subjects": len(inputs["subjects"]), "exams": len(inputs["exams"]),
            "counters": len(inputs["life"]["counters"])}


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    d = tmp_path_factory.mktemp("seed-study")
    return d, seed.seed_study(d)


@pytest.fixture(scope="module")
def client(seeded):
    d, ids = seeded
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(paths, "DATA", d)                                  # every call-time lookup of the data folder
        mp.setenv("JARVIS_ENGINE_INPUTS", str(d / "engine-inputs.json"))
        mp.setenv("WW_BANK_DIR", str(d / "bank" / "questions"))
        mp.delenv("JARVIS_GOOGLE", raising=False)
        seed.install_fixtures(mp.setattr)                             # undone with the context: later test files see the real modules
        app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=FEATURES)
        seed.attach(app, ocr_delay=0.3)
        svc = app.state.svc
        # germoney's kv folder was fixed when it was imported (the conftest scratch folder): point the plan at the seed's
        kv = germoney.KVStore(root=d / "germoney" / "kv", backups=d / "germoney" / "backups")
        svc.kv = kv
        svc.plan.kv = kv
        with TestClient(app) as c:
            c.headers.update({"X-Jarvis-Token": TOKEN})
            yield c, d, ids, app


def ok(r, state=None):
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["state"] in ("live", "waiting", "planned", "fault") and j["reason"] and j["source"], j
    if state:
        assert j["state"] == state, j
    return j


def find(obj, key, value):
    """Every dict anywhere in a JSON answer whose `key` is `value`."""
    out = []
    if isinstance(obj, dict):
        if obj.get(key) == value:
            out.append(obj)
        for v in obj.values():
            out += find(v, key, value)
    elif isinstance(obj, list):
        for v in obj:
            out += find(v, key, value)
    return out


# ------------------------------------------------------------------ the ids
def test_the_ids_are_the_fixed_strings_browser_tests_name(seeded):
    _, ids = seeded
    c = ids["classroom"]
    assert c["mode"] == "fixture" and c["courses"] == ["fx1001", "fx1002"]
    assert c["files"] == {"pdf": "fxNotesPdf001", "docx": "fxLabDocx002", "stale": "fxStalePdf003", "also_in": "fxSharedPdf04",
                          "paper": "fxPaperPdf005"}
    assert c["assignments"] == {"late": "fxWorkLate01", "turned_in": "fxWorkDone02", "no_due_date": "fxWorkNoDue03", "future": "fxWorkSoon04"}
    p = ids["papers"]
    for pid in [p["text"], p["scanned"], *p["text_more"]]:
        assert re.fullmatch(r"p-[0-9a-f]{12}", pid)
    assert all(re.fullmatch(r"q-[0-9a-f]{12}", q) for qs in p["questions"].values() for q in qs)
    assert len(p["questions"]) == 3 and all(len(qs) == 8 for qs in p["questions"].values())
    assert re.fullmatch(r"d-[0-9a-f]{12}", ids["drafts"]["pending"]) and re.fullmatch(r"d-[0-9a-f]{12}", ids["drafts"]["rejected"])
    assert ids["harvest"]["pointer"]["source"] == "papers_table" and ids["harvest"]["sources"] == ["gate_papers", "papers_table"]
    assert ids["life"]["yes_no"] == "fixture-walk" and ids["plan"]["subjects"] == ["fixture-circuits", "fixture-signals"]
    assert json.loads((seeded[0] / seed.MARKER).read_text(encoding="utf-8")) == ids


# ------------------------------------------------------------------ Classroom, G-01 to G-19
def test_the_google_link_says_fixture_and_never_off(client):
    c, _, _, _ = client
    j = ok(c.get(f"{G}/status"), "live")
    assert j["reason"] == seed.GOOGLE_REASON and j["source"] == seed.GOOGLE_SOURCE
    assert j["counts"]["courses"] == 2 and j["counts"]["files"] == 5 and j["counts"]["papers"] == 1
    assert all(s["granted"] for s in j["scopes"])
    r = c.post(f"{G}/assignments/fxWorkSoon04/open")              # the browser is never opened on an invented page
    assert r.status_code == 400 and "Fixture mode" in r.json()["detail"]


def test_courses_files_kinds_stale_and_also_in(client):
    c, _, ids, _ = client
    courses = ok(c.get(f"{G}/courses"), "live")["items"]
    assert {x["id"]: x["subject"] for x in courses} == {"fx1001": "fixture-circuits", "fx1002": "fixture-signals"}
    files = {f["id"]: f for f in ok(c.get(f"{G}/files"), "live")["items"]}
    assert files["fxNotesPdf001"]["ext"] == "pdf" and files["fxLabDocx002"]["ext"] == "docx"
    assert files["fxNotesPdf001"]["has_note"] and files["fxLabDocx002"]["note_state"] == "live"
    assert files["fxStalePdf003"]["stale"] is True and files["fxStalePdf003"]["has_original"]
    assert [x for f in files.values() if f["stale"] for x in [f["id"]]] == ["fxStalePdf003"]
    assert files["fxSharedPdf04"]["also_in"] == [{"course": "fx1002", "post_title": "Shared formula sheet (invented)"}]
    assert files["fxPaperPdf005"]["kind"] == "paper"
    note = ok(c.get(f"{G}/files/fxNotesPdf001/note"), "live")
    assert "imaginary resistor ladder" in note["markdown"].lower()


def test_assignments_announcements_and_calendar(client):
    c, _, ids, _ = client
    j = ok(c.get(f"{G}/assignments", params={"show": "all"}), "live")
    rows = {r["id"]: r for r in j["items"]}
    a = ids["classroom"]["assignments"]
    assert rows[a["late"]]["late"] is True and rows[a["late"]]["days_left"] < 0
    assert rows[a["turned_in"]]["work"] == "turned_in"
    assert rows[a["no_due_date"]]["due"] == "" and rows[a["no_due_date"]]["days_left"] is None
    assert rows[a["future"]]["days_left"] > 0 and rows[a["future"]]["due_time"]
    assert j["counts"] == {"open": 3, "turned_in": 1, "late": 1, "no_due_date": 1}
    notices = ok(c.get(f"{G}/announcements"), "live")["items"]
    assert sorted(n["id"] for n in notices) == sorted(ids["classroom"]["announcements"])
    events = ok(c.get(f"{G}/calendar"), "live")["items"]
    assert sorted(e["id"] for e in events) == sorted(ids["classroom"]["calendar"])


# ------------------------------------------------------------------ the paper desk, R-01
def test_r01_lists_the_text_paper_and_the_scanned_paper_with_its_faults(client):
    c, _, ids, _ = client
    papers = {p["id"]: p for p in ok(c.get(f"{P}/papers"), "live")["items"]}
    scan = papers[ids["papers"]["scanned"]]
    assert scan["faults"] == ["p. 1: no text layer; run OCR on this paper", "p. 2: no text layer; run OCR on this paper"]
    assert scan["method"] == "text-layer"
    text = papers[ids["papers"]["text"]]
    assert text["total_marks"] == 40 and text["faults"] == []
    qs = ok(c.get(f"{P}/questions", params={"paper": ids["papers"]["text"]}))["items"]
    assert [q["id"] for q in qs] == ids["papers"]["questions"][ids["papers"]["text"]]
    assert all(q["marks"] == 5 and q["marks_source"] == "printed" for q in qs)


# ------------------------------------------------------------------ R-16, R-17, the life counters, the harvester
def test_patterns_and_practise_next_answer_live(client):
    c, _, _, _ = client
    j = ok(c.get(f"{P}/patterns", params={"subject": "fixture-circuits"}), "live")
    assert j["provisional"] is False and j["patterns"]["n_papers"] == 3 and len(j["patterns"]["topics"]) == 4
    n = ok(c.get(f"{P}/practise-next", params={"subject": "fixture-circuits", "gap_minutes": 60}), "live")
    assert n["items"] and all(it["terms"]["minutes"] > 0 for it in n["items"])
    second = ok(c.get(f"{P}/patterns", params={"subject": "fixture-signals"}))
    assert second["provisional"] is True                     # a subject with units and topics, but too few papers for a pattern


def test_life_counters_hold_a_yes_or_no_counter_with_todays_count(client):
    c, _, _, _ = client
    r = c.get("/api/mission/life")
    assert r.status_code == 200, r.text
    walk = find(r.json(), "id", "fixture-walk")
    assert walk and walk[0]["want"] == "yes" and walk[0]["today"] == 1 and walk[0]["on_line"] is True
    assert find(r.json(), "id", "fixture-water")[0]["today"] == 5


def test_the_harvester_sources_answer_in_their_default_state_and_the_pointer_is_on_record(client):
    c, _, ids, _ = client
    r = c.get(f"{H}/sources")
    assert r.status_code == 200, r.text
    ps = {s["id"]: s for s in r.json()["paper_sources"]}
    assert set(ps) == {"gate_papers", "papers_table"}
    assert all(not s["on"] and not s["local_copy"] for s in ps.values()) and ps["papers_table"]["address"] is None
    j = ok(c.get(f"{H}/manifest"), "live")
    assert j["reason"] == "0 files and 1 pointer on record." and len(j["items"]) == 1
    line = j["items"][0]
    assert (line["source"], line["key"], line["url"]) == (ids["harvest"]["pointer"]["source"], ids["harvest"]["pointer"]["key"],
                                                          ids["harvest"]["pointer"]["url"])
    assert line["sha256"] is None and line["local"] == "pointer only"


# ------------------------------------------------------------------ R-50 to R-52
def test_r51_shows_one_pending_and_one_rejected_draft_with_their_notes(client):
    c, _, ids, _ = client
    j = ok(c.get(f"{P}/drafts", params={"subject": "fixture-circuits"}), "live")
    assert j["source"] == seed.DRAFTS_SOURCE
    rows = {d["id"]: d for d in j["items"]}
    pend, rej = rows[ids["drafts"]["pending"]], rows[ids["drafts"]["rejected"]]
    assert pend["status"] == "pending" and rej["status"] == "rejected" and rej["checks"]["copied"] is True
    assert "fxNotesPdf001" in {s["file_id"] for s in pend["sources"]} and "fxNotesPdf001" in ids["drafts"]["notes"]
    made = ok(c.post(f"{P}/drafts/from-notes", json={"subject": "fixture-circuits", "topic": "Pretend node sums", "count": 2}), "live")
    assert len(made["items"]) == 2 and all("Fixture draft (invented" in d["text"] for d in made["items"])


# ------------------------------------------------------------------ OCR: R-28, R-48, R-49 driven to stopped, then done
def test_the_ocr_job_runs_stops_and_finishes_with_a_whole_page_draft_and_a_page_under_the_gate(client):
    c, _, ids, app = client
    pid = ids["papers"]["scanned"]
    j = ok(c.get(f"{P}/ocr"), "waiting")
    assert j["engine"]["installed"] and "Fixture" in j["engine"]["name"] and j["source"] == seed.OCR_SOURCE
    assert j["waiting"] == {"papers": 1, "pages": 2}
    started = ok(c.post(f"{P}/papers/{pid}/ocr", json={}), "live")
    assert started["job"]["status"] == "running"
    stopping = ok(c.delete(f"{P}/ocr"), "waiting")
    assert stopping["reason"] == "Stopping after the page being read."
    job = app.state.pyq_ocr.wait(20)
    assert job["status"] == "stopped" and job["pages_read"] == 1
    assert ok(c.get(f"{P}/ocr"))["waiting"] == {"papers": 1, "pages": 1}
    ok(c.post(f"{P}/papers/{pid}/ocr", json={}), "live")
    job = app.state.pyq_ocr.wait(20)
    assert job["status"] == "done" and job["pages_below_gate"] == 1
    paper = {p["id"]: p for p in ok(c.get(f"{P}/papers"))["items"]}[pid]
    assert any(f.startswith("p. 1: read at confidence 0.91; no question start was found") for f in paper["faults"])
    assert "p. 2: read at confidence 0.72, below 0.85; left as a picture" in paper["faults"]
    qs = ok(c.get(f"{P}/questions", params={"paper": pid}))["items"]
    assert len(qs) == 1 and qs[0]["page"] == 1 and qs[0]["text_status"] == "unverified" and qs[0]["status"] == "pending"
    assert "Fixture OCR" in qs[0]["text"]


# ------------------------------------------------------------------ wave EW9: the evening sheet, R-55 to R-59
def tonight_reminders(store) -> list:
    return sorted(r["id"] for r in store.pending() + store.recent(within_s=3 * 86400, limit=50) if r.get("origin") == "tonight")


def test_the_ew9_ids_are_fixed_strings_of_the_stores_shapes(seeded):
    _, ids = seeded
    t = ids["tonight"]
    day = date.today()
    assert t["today"] == f"{day.isoformat()}-fixture-circuits" and t["yesterday"] == f"{(day - timedelta(days=1)).isoformat()}-fixture-circuits"
    assert len(t["today_questions"]) == 4 and len(t["yesterday_questions"]) == 4      # one question a topic, four topics
    assert not set(t["today_questions"]) & set(t["yesterday_questions"])               # a question waits out the last sheets
    assert t["awaiting_marks"] == [] and len(t["reminders"]) == 1 and re.fullmatch(r"r_[0-9a-f]{8}", t["reminders"][0])
    assert all(re.fullmatch(r"g-[0-9a-f]{12}", g) for g in ids["ledger"]["papers"]) and len(ids["ledger"]["papers"]) >= 2
    v = ids["variants"]
    for vid in [v["accepted"], *v["numerical_pending"], *v["descriptive_pending"], *v["descriptive_rejected"]]:
        assert re.fullmatch(r"v-[0-9a-f]{12}", vid)
    assert len(v["numerical_pending"]) == len(v["descriptive_pending"]) == len(v["descriptive_rejected"]) == 1
    assert re.fullmatch(r"q-[0-9a-f]{12}", v["accepted_question"]) and v["numerical_question"] == seed.TYPED_QUESTION
    p = ids["intake"]["paste"]
    assert set(p) == {"new", "accepted", "ambiguous", "declined"} and all(re.fullmatch(r"i-[0-9a-f]{12}", x) for x in p.values())
    assert len(ids["intake"]["ics_single"]) == 1 and len(ids["intake"]["ics_repeating"]) == 3
    assert ids["takeout"]["archive"] == "exports/fixture-classroom-export.zip" and ids["life_layout"] == {"saved": False}


def test_r55_answers_live_with_todays_sheet_and_nothing_awaiting_marks(client):
    c, _, ids, _ = client
    t = ids["tonight"]
    j = ok(c.get(f"{P}/tonight"), "live")
    assert j["settings"]["on"] is True and j["settings"]["hour"] == t["hour"]
    assert j["sheet"]["id"] == t["today"] and [it["question_id"] for it in j["sheet"]["items"]] == t["today_questions"]
    assert j["sheet"]["unmarked"] == 4 and all(it["text"] and it["why"] for it in j["sheet"]["items"])
    assert j["awaiting_marks"] == [] and "waiting for marks" not in j["reason"]
    assert j["next_papers"][0]["subject"] == "fixture-circuits"
    again = ok(c.post(f"{P}/tonight/build", json={}), "live")                     # a sheet once built is kept as it is
    assert again["sheet"]["id"] == t["today"] and [it["question_id"] for it in again["sheet"]["items"]] == t["today_questions"]


def test_yesterdays_sheet_carries_every_mark_some_lost_and_one_with_minutes(client):
    c, _, ids, _ = client
    t = ids["tonight"]
    j = ok(c.post(f"{P}/tonight/build", json={"date": t["yesterday"][:10], "subject": "fixture-circuits"}), "live")
    assert j["sheet"]["id"] == t["yesterday"] and j["sheet"]["unmarked"] == 0
    marks = [it["mark"] for it in j["sheet"]["items"]]
    assert all(m is not None for m in marks)
    assert any(m["got"] < m["max"] for m in marks) and any(m["minutes"] for m in marks)
    assert all(m["at"].startswith(t["yesterday"][:10]) for m in marks)                # typed the same night
    r = c.get(f"{P}/tonight/{t['yesterday']}/print")
    assert r.status_code == 200 and "Sheet " in r.text and "Practice sheet from your bank" in r.text


def test_the_first_tick_after_start_raises_no_second_reminder_for_today(client):
    c, d, ids, app = client
    from jarvis_app import reminders
    seeded_store = reminders.ReminderStore(path=d / "reminders.json")
    assert tonight_reminders(seeded_store) == ids["tonight"]["reminders"]             # the one the seed's clock raised
    clock = json.loads((d / "pyq" / "tonight" / "clock.json").read_text(encoding="utf-8"))
    assert clock["day"] == date.today().isoformat()
    svc = app.state.svc
    before = tonight_reminders(svc.reminders)
    at = max(datetime.combine(date.today(), dtime(19, 30)), datetime.now()) + timedelta(minutes=1)
    svc.reminder_scheduler.tick(at.timestamp())                    # the scheduler's own tick, which looks at the sheet's clock
    assert app.state.pyq_tonight_clock(at.timestamp() + 60) is None
    assert tonight_reminders(svc.reminders) == before
    assert tonight_reminders(reminders.ReminderStore(path=d / "reminders.json")) == ids["tonight"]["reminders"]


# ------------------------------------------------------------------ the ledger R-60 to R-62, and R-17 with measured marks
def test_r60_to_r62_count_marks_from_sheets_and_papers(client):
    c, _, ids, _ = client
    led = ok(c.get(f"{P}/ledger", params={"subject": "fixture-circuits"}), "live")
    items = {i["key"]: i for i in led["items"]}
    assert items[seed.MEASURED_TOPIC]["attempts"] >= 5 and items[seed.UNMEASURED_TOPIC]["attempts"] < 5
    assert led["totals"]["practised"] == led["totals"]["topics"] == 4 and led["skipped"] == []
    rows = ok(c.get(f"{P}/ledger/attempts", params={"subject": "fixture-circuits"}), "live")["items"]
    assert {r["source"] for r in rows} == {"sheet", "paper"}
    assert {r["source_id"] for r in rows if r["source"] == "paper"} <= set(ids["ledger"]["papers"])
    assert {r["source_id"] for r in rows if r["source"] == "sheet"} == {ids["tonight"]["yesterday"]}
    one = ok(c.get(f"{P}/ledger/attempts", params={"subject": "fixture-circuits", "topic": seed.MEASURED_TOPIC}), "live")["items"]
    assert len(one) == items[seed.MEASURED_TOPIC]["attempts"]
    pace = ok(c.get(f"{P}/ledger/pace", params={"subject": "fixture-circuits"}), "live")
    assert pace["days_counted"] == 2 and pace["practised"] == 4 and pace["days_left"] == 12


def test_r17_prints_one_topic_measured_and_another_not(client):
    c, _, _, _ = client
    j = ok(c.get(f"{P}/practise-next", params={"subject": "fixture-circuits", "gap_minutes": 1440}), "live")
    picks = {p["key"]: p for p in j["items"]}
    assert picks[seed.MEASURED_TOPIC]["terms"]["measured"] is True
    assert picks[seed.UNMEASURED_TOPIC]["terms"]["measured"] is False


# ------------------------------------------------------------------ variants and rubrics, R-29 to R-34
def test_r30_lists_numerical_and_descriptive_variants_in_every_state(client):
    c, _, ids, _ = client
    v = ids["variants"]
    nums = {x["id"]: x for x in ok(c.get(f"{P}/variants", params={"question": v["numerical_question"]}), "live")["items"]}
    assert nums[v["numerical_pending"][0]]["status"] == "pending" and nums[v["numerical_pending"][0]]["key"]
    acc = nums[v["accepted"]]
    assert acc["status"] == "accepted" and acc["kind"] == "numerical" and acc["accepted_as"] == v["accepted_question"]
    words = {x["id"]: x for x in ok(c.get(f"{P}/variants", params={"question": v["descriptive_question"]}), "live")["items"]}
    pend, rej = words[v["descriptive_pending"][0]], words[v["descriptive_rejected"][0]]
    assert pend["status"] == "pending" and pend["origin"] == "model-draft" and pend["key"] is None
    assert rej["status"] == "rejected" and "Too close" in rej["reason"]
    qs = ok(c.get(f"{P}/questions", params={"subject": "fixture-signals", "status": "accepted"}))["items"]
    made = next(q for q in qs if q["id"] == v["accepted_question"])
    assert made["origin"] == "template" and made["source_question"] == v["numerical_question"]


def test_r33_shows_a_drafted_rubric_and_one_he_accepted(client):
    c, _, ids, _ = client
    pend = ok(c.get(f"{P}/rubric/{ids['rubric']['pending']}"), "live")["rubric"]
    assert pend["status"] == "pending" and pend["origin"] == "model-draft" and pend["difference"] == 0
    assert all("Fixture rubric point" in p["text"] for p in pend["points"])
    acc = ok(c.get(f"{P}/rubric/{ids['rubric']['accepted']}"), "live")
    assert acc["reason"] == "Your rubric." and acc["rubric"]["status"] == "accepted" and acc["rubric"]["points"] == seed.HAND_RUBRIC


# ------------------------------------------------------------------ intake R-36 to R-42, the export door R-46, R-63
def test_r36_and_r42_list_the_pasted_lines_and_calendar_rows(client):
    c, _, ids, _ = client
    i = ids["intake"]
    rows = {r["id"]: r for r in ok(c.get("/api/mission/intake"), "live")["items"]}
    p = i["paste"]
    assert (rows[p["new"]]["state"], rows[p["accepted"]]["state"], rows[p["declined"]]["state"]) == ("new", "accepted", "declined")
    amb = rows[p["ambiguous"]]
    assert amb["ambiguous"] is True and amb["date"] is None and len(amb["readings"]) == 2 and amb["state"] == "new"
    assert rows[i["ics_single"][0]]["kind"] == "event" and rows[i["ics_single"][0]]["repeats"] == "none"
    assert all(rows[x]["repeats"] not in ("", "none") for x in i["ics_repeating"])
    dl = ok(c.get("/api/mission/intake/deadlines"), "live")["items"]
    assert [d["id"] for d in dl] == [p["accepted"]] and dl[0]["date"] == i["accepted_date"] and dl[0]["time"] == "10:00"


def test_r63_counter_row_is_unsaved_so_a_first_visit_sees_the_default(client):
    c, _, _, _ = client
    r = c.get("/api/mission/life/layout")
    assert r.status_code == 200, r.text
    assert r.json()["saved"] is False and r.json()["order"] == [x["id"] for x in seed.COUNTERS]


def test_r46_lists_the_invented_export_and_refuses_the_entry_that_climbs_out(client):
    c, d, ids, _ = client
    path = d / ids["takeout"]["archive"]
    j = ok(c.post(f"{P}/takeout", json={"path": str(path)}), "live")
    entries = {e["name"]: e for e in j["listing"]["entries"]}
    assert set(entries) == set(ids["takeout"]["entries"]) | set(ids["takeout"]["refused"])
    assert "'..'" in entries[seed.EXPORT_REFUSED]["refused"]
    assert all(entries[n]["refused"] is None for n in ids["takeout"]["entries"])
    assert sorted(entries[n]["kind"] for n in ids["takeout"]["entries"]) == ["pdf", "pdf", "pptx"]


def ew9_counts(d: Path) -> dict:
    """Every row of the EW9 areas a second seed could add or change."""
    from jarvis_app.ww_intake.store import IntakeStore
    from jarvis_app.ww_pyq import generate as gen
    from jarvis_app.ww_pyq import variants
    from jarvis_app.ww_pyq.store import Store
    st = Store(d / "pyq")
    state = seed._plan(d).load()
    sheets = sorted((d / "pyq" / "sheets").glob("*.json"))
    return {"sheets": [json.loads(f.read_text(encoding="utf-8")) for f in sheets],
            "paper_marks": state["paper_marks"], "exam_prep": state.get("exam_prep"),
            "attempts": gen.read_attempts(st), "generated": sorted(p["id"] for p in gen.list_generated(st)),
            "variants": sorted((v["id"], v["status"]) for v in variants.list_variants(st)),
            "rubrics": sorted(f.name for f in (d / "pyq" / "rubrics").glob("*.json")),
            "signals": sorted(q["id"] for q in st.list_questions(subject="fixture-signals", status="accepted")),
            "intake": sorted((r["id"], r["state"], r["date"]) for r in IntakeStore(d / "intake").list_rows()),
            "reminders": json.loads((d / "reminders.json").read_text(encoding="utf-8"))["items"],
            "clock": json.loads((d / "pyq" / "tonight" / "clock.json").read_text(encoding="utf-8")),
            "export": hashlib.sha256((d / seed.EXPORT).read_bytes()).hexdigest()}


def test_a_second_seed_of_the_same_folder_adds_no_ew9_row_and_gives_the_same_ids(client):
    c, d, ids, _ = client
    before = ew9_counts(d)
    again = seed.seed_study(d)
    for k in ("tonight", "ledger", "variants", "rubric", "intake", "takeout", "life_layout"):
        assert again[k] == ids[k], k
    assert ew9_counts(d) == before


# ------------------------------------------------------------------ the command, the second seed, the real data
def _env_guard(mp):
    """main() writes these with os.environ; registering them first makes the context put them back."""
    for k in ("JARVIS_DATA_DIR", "JARVIS_ENGINE_INPUTS", "WW_BANK_DIR", "JARVIS_EXAM_NOTES", "JARVIS_KNOWLEDGE_DIR",
              "JARVIS_LIBRARY_DIR", "JARVIS_YAADASH_DIR", "JARVIS_LEARNED_DIR", "JARVIS_LEARN_FILE", "JARVIS_TRANSCRIPTS_DIR",
              "JARVIS_SETTINGS", "AANKHEN_DATA_DIR", "AANKHEN_HOTPLUG", "AANKHEN_NET", "JARVIS_MEDIA_OS", "JARVIS_GOOGLE",
              "JARVIS_PHONE", "JARVIS_AUTOSTART_CORE", "JARVIS_UNO", "JARVIS_TOKEN"):
        import os
        if k in os.environ:
            mp.setenv(k, os.environ[k])
        else:
            mp.delenv(k, raising=False)


_watch = {"root": None, "hits": []}
_hook_lock = threading.Lock()


def _audit(event, args):
    root = _watch["root"]
    if root is None or event not in ("open", "os.listdir", "os.scandir", "shutil.copyfile", "shutil.copytree", "os.rename"):
        return
    for a in args:
        if isinstance(a, (str, Path)) and str(Path(a)).lower().startswith(root):
            _watch["hits"].append((event, str(a)))


sys.addaudithook(_audit)


def test_seed_mode_reads_nothing_of_the_real_data_and_seeding_twice_changes_nothing(tmp_path, capsys):
    real = tmp_path / "real-data"
    (real / "germoney").mkdir(parents=True)
    (real / "canary.json").write_text('{"canary": true}', encoding="utf-8")
    (real / "germoney" / "canary.txt").write_text("canary", encoding="utf-8")
    inputs = tmp_path / "real-inputs.json"
    inputs.write_text('{"canary": true}', encoding="utf-8")
    dest = tmp_path / "seed"
    launched = []
    from jarvis_app import desktop, server
    with pytest.MonkeyPatch.context() as mp:
        _env_guard(mp)
        mp.setattr(ww_sandbox, "REAL_DATA", real)
        mp.setattr(ww_sandbox, "REAL_INPUTS", inputs)
        mp.setattr(desktop, "main", lambda argv: launched.append(argv) or 0)
        mp.setattr(server, "create_app", server.create_app)          # main wraps it; the context puts the real one back
        mp.setattr(seed, "install_fixtures", lambda setter=setattr: launched.append("fixtures"))
        _watch.update(root=str(real).lower(), hits=[])
        (real / "canary.json").read_text(encoding="utf-8")            # the hook sees a read: it is not blind
        assert _watch["hits"] and _watch["hits"][0][0] == "open"
        _watch["hits"] = []
        try:
            assert ww_sandbox.main(["--seed", "study", "--dir", str(dest), "--port", "8791"]) == 0
            import os
            assert os.environ["JARVIS_DATA_DIR"] == str(dest) and os.environ["JARVIS_GOOGLE"] == "fixture"
        finally:
            _watch["root"] = None
    assert _watch["hits"] == []                                        # not one open, listing or copy under the real folder
    assert not any(p.name.startswith("canary") for p in dest.rglob("*"))
    assert launched == ["fixtures", ["--server-only", "--port", "8791", "--token", "ww-audit", "--aankhen", "off"]]
    printed = [ln for ln in capsys.readouterr().out.splitlines() if ln.startswith("{")]
    assert len(printed) == 1
    ids = json.loads(printed[0])
    before = counts(dest)
    assert seed.seed_study(dest) == ids                                # twice into one folder: the same ids
    assert counts(dest) == before                                      # and not one row more
    assert before["stale"] == ["fxStalePdf003"] and before["pointers"] == 1 and before["drafts"] == 2
    other = tmp_path / "seed-two"
    assert seed.seed_study(other) == ids                               # a second folder: the same fixed ids


def test_without_seed_the_sandbox_copies_and_switches_google_off_as_before(tmp_path):
    real = tmp_path / "real-app"
    (real / "germoney").mkdir(parents=True)
    (real / "settings.json").write_text("{}", encoding="utf-8")
    (real / "gcr").mkdir()
    (real / "gcr" / "manifest.json").write_text("{}", encoding="utf-8")
    dest = tmp_path / "copy"
    launched = []
    from jarvis_app import desktop
    with pytest.MonkeyPatch.context() as mp:
        _env_guard(mp)
        mp.setattr(ww_sandbox, "REAL_DATA", real)
        mp.setattr(ww_sandbox, "REAL_INPUTS", tmp_path / "missing.json")
        mp.setattr(desktop, "main", lambda argv: launched.append(argv) or 0)
        mp.setattr(seed, "seed_study", lambda *a, **k: pytest.fail("seeded without --seed"))
        assert ww_sandbox.main(["--dir", str(dest), "--port", "8795"]) == 0
        import os
        assert os.environ["JARVIS_GOOGLE"] == "off" and os.environ["JARVIS_DATA_DIR"] == str(dest)
    assert (dest / "settings.json").is_file() and not (dest / "gcr").exists() and not (dest / seed.MARKER).exists()
    assert launched == [["--server-only", "--port", "8795", "--token", "ww-audit", "--aankhen", "off"]]


def test_a_folder_that_is_not_a_seed_is_never_seeded_into_and_the_real_data_folder_is_refused(tmp_path):
    busy = tmp_path / "copy-of-something"
    busy.mkdir()
    (busy / "settings.json").write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit):
        ww_sandbox.make_seed_dir(busy, fresh=True)
    assert (busy / "settings.json").is_file()                          # --fresh never deletes a folder it did not make
    with pytest.raises(RuntimeError):
        seed.seed_study(paths.REPO / "data" / "never-here")
    assert not (paths.REPO / "data" / "never-here").exists()


def test_in_fixture_mode_the_file_route_cannot_reach_a_folder_outside_the_box(tmp_path, monkeypatch):
    from jarvis_app import germoney
    home_folder = germoney.COLLEGE
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path / "box"))
    seed.install_fixtures(monkeypatch.setattr)
    assert germoney.COLLEGE == tmp_path / "box" / "no-college-folder" and germoney.COLLEGE != home_folder
    assert germoney.COLLEGE in germoney.file_roots() and home_folder not in germoney.file_roots()

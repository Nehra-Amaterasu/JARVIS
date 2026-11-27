"""The seeded sandbox (ww_sandbox --seed study, ww_sandbox_seed.py): invented rows written by the engine's own code, and the
real routes answering live on them, with Google, OCR and the model as fixtures that say so.

Every test works in tmp folders: never the real data directory, never the network (conftest blocks it), never the real OCR
engine, the real sign-in or a model. One seed is shared by the route tests (module scope) because a seed reads several PDFs
and the machine is short of memory; the tests that change it run last in the file.
"""
import json
import re
import sys
import threading
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
            "ww_pyq_ocr", "ww_pyq_patterns"]
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

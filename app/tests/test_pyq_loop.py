"""The loop across three packages of wave EW9, over HTTP: a sheet is built (N01), marks are typed (N01), the ledger
counts them once (N02), and the counted order of topics (R-17) holds them until a topic has five marks. Each package was built and reviewed alone, in its
own worktree; the two meet only through the sheet file's shape, so this test is where a mismatch would show.

Everything here is invented. Stores and the plan live under tmp_path; nothing reads the real data directory.
"""
import json
import shutil
from datetime import date, timedelta
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import routes_ww_pyq_ledger as ledger_routes
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Circuits", "topics": ["time constant"], "exam_weight": "med"}]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "signals", "name": "Signals", "kind": "current", "question_bank": [], "units": UNITS}]}
IN4 = (date.today() + timedelta(days=4)).isoformat()
PLAN = [(1, "sampling theorem"), (1, "aliasing"), (2, "time constant")]


@pytest.fixture()
def loop(tmp_path, monkeypatch):
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "disk-bank"))
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    monkeypatch.setattr(ledger_routes, "notes_of", lambda subject: [])        # no Classroom store in this test
    (tmp_path / "inputs.json").write_text(json.dumps({"exams": [
        {"id": "end-sig", "subject": "signals", "title": "Signals end sem", "date": IN4, "kind": "end_sem", "max": 60}]}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    for i in range(4):                       # four papers, each topic once: every topic has 4 accepted questions
        pid = st.add_paper({"title": f"Invented paper {i}", "subject": "signals", "year": 2020 + i, "sha256": f"{i:x}" * 64, "total_marks": 15})
        ids = st.add_questions(pid, [{"text": f"Explain invented idea {i}-{j} about {t}.", "text_status": "verified", "marks": 5,
                                      "section": "A", "type": "short"} for j, (_, t) in enumerate(PLAN)])
        for qid, (u, t) in zip(ids, PLAN):
            st.update_question(qid, {"status": "accepted", "unit": u, "topic": t})
    bdir = tmp_path / "bankfiles"
    bdir.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, bdir / n)
    loaded = g.load_bank(bdir)
    plan = g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: loaded,
                  academics_loader=lambda: json.loads(json.dumps(ACADEMICS)),
                  apps=g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json"))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq_tonight", "ww_pyq_patterns", "ww_pyq_ledger"])
    app.state.svc.plan = plan
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def ledger(c):
    j = c.get(f"{B}/ledger", params={"subject": "signals"}).json()
    return j, {i["key"]: i for i in j["items"]}


def order(c):
    j = c.get(f"{B}/practise-next", params={"subject": "signals"}).json()
    return {p["key"]: p for p in j["items"]}


def test_a_sheet_s_marks_reach_the_ledger_once_and_the_order_waits_for_five(loop):
    c = loop
    assert c.put(f"{B}/tonight/settings", json={"on": True}).status_code == 200
    built = c.post(f"{B}/tonight/build", json={}).json()
    sheet = built["sheet"]
    assert built["state"] == "live" and sheet["subject"] == "signals" and len(sheet["items"]) == 3, built["reason"]

    before, rows0 = ledger(c)
    assert all(r["attempts"] == 0 and r["got"] == 0 for r in rows0.values())
    assert {h["key"] for h in before["holes"] if h["kind"] == "never_practised"} == set(rows0)
    assert c.get(f"{B}/ledger/pace", params={"subject": "signals"}).json()["state"] == "waiting", "no mark yet: no rate to state"
    prof0 = order(c)

    first, second = sheet["items"][0], sheet["items"][1]
    r = c.post(f"{B}/tonight/{sheet['id']}/marks", json={"items": [{"question_id": first["question_id"], "got": 1, "minutes": 12},
                                                                     {"question_id": second["question_id"], "got": 5}]})
    assert r.status_code == 200, r.text
    typed = r.json()["proficiency"]
    assert typed[first["topic_key"]] < typed[second["topic_key"]], "his marks are in: 1 of 5 against 5 of 5"

    after, rows1 = ledger(c)
    a, b = rows1[first["topic_key"]], rows1[second["topic_key"]]
    assert (a["attempts"], a["got"], a["max"], a["minutes"]) == (1, 1, 5, 12)
    assert (b["attempts"], b["got"], b["max"]) == (1, 5, 5)
    assert a["last_practised"] == date.today().isoformat()
    untouched = [k for k in rows1 if k not in (first["topic_key"], second["topic_key"])]
    assert all(rows1[k]["attempts"] == 0 for k in untouched)
    assert {h["key"] for h in after["holes"] if h["kind"] == "never_practised"} == set(untouched)

    marks = c.get(f"{B}/ledger/attempts", params={"subject": "signals"}).json()["items"]
    assert sorted((m["source"], m["source_id"], m["question_id"], m["got"], m["max"]) for m in marks) == sorted([
        ("sheet", sheet["id"], first["question_id"], 1, 5), ("sheet", sheet["id"], second["question_id"], 5, 5)]), "each mark once"

    # The counted order does NOT move yet, and says why: R-17 calls a topic measured only from 5 marked attempts
    # (next.MIN_ATTEMPTS), so one evening's mark is on file and counted but the order still uses the neutral 0.5.
    prof1 = order(c)
    for item in (first, second):
        pick = prof1[item["topic_key"]]
        assert pick["terms"]["measured"] is False and pick["terms"]["proficiency"] == 0.5 and "1 marked attempt" in pick["reason"]
    assert {k: v["terms"]["proficiency"] for k, v in prof1.items()} == {k: v["terms"]["proficiency"] for k, v in prof0.items()}

    # a corrected mark replaces the first: still two marks on file, the ledger shows the new one
    assert c.post(f"{B}/tonight/{sheet['id']}/marks", json={"items": [{"question_id": first["question_id"], "got": 4}]}).status_code == 200
    _, rows2 = ledger(c)
    assert (rows2[first["topic_key"]]["attempts"], rows2[first["topic_key"]]["got"]) == (1, 4)
    assert len(c.get(f"{B}/ledger/attempts", params={"subject": "signals"}).json()["items"]) == 2

    pace = c.get(f"{B}/ledger/pace", params={"subject": "signals"}).json()
    assert pace["state"] == "live" and pace["days_left"] == 4 and pace["topics"] == 3 and pace["practised"] == 2 and pace["left"] == 1
    assert "day" in pace["sentence"]

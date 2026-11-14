"""The exam slice end to end, over HTTP only (wave EW7's integration test, plan 9.1.7).

One invented six-question paper goes through every step a student takes: upload, read, review,
tag, accept, infer and save the blueprint, generate a practice paper, print it, type marks back in.
The five packages of the wave were built in separate worktrees and each tested alone; this is the
test that they fit together, and that nothing reaches the practice bank before he accepts it.
"""
import json
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, build_pdf

TOKEN = "t" * 32
B = "/api/mission/pyq"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
UNITS = [{"n": 1, "title": "Circuit laws", "exam_weight": "high",
          "topics": ["Kirchhoff current law", "time constant of an RC circuit", "passive elements"]},
         {"n": 2, "title": "Network theorems", "exam_weight": "med",
          "topics": ["Thevenin equivalent", "maximum power transfer theorem", "current through a resistor"]}]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "circuits", "name": "Circuits", "kind": "current", "question_bank": [], "units": UNITS}]}
BANNED = ("important", "likely", "expected", "will be asked", "probability", "chance")
FOOTER = "From papers on file. This prepares practice; it does not predict a paper or a result."


@pytest.fixture()
def env(tmp_path, monkeypatch):
    disk = tmp_path / "disk-bank"
    disk.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(disk))                 # an empty on-disk bank: the paper can only come from his own questions
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    inputs = {"exams": [{"id": "cie-cir", "subject": "circuits", "title": "Circuits mid", "date": "2026-12-01", "kind": "cie", "max": 22}]}
    (tmp_path / "inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    bdir = tmp_path / "bankfiles"
    bdir.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, bdir / n)
    bank = g.load_bank(bdir)
    apps = g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json")
    plan = g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank,
                  academics_loader=lambda: json.loads(json.dumps(ACADEMICS)), apps=apps)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq", "ww_pyq_ingest", "ww_pyq_patterns", "ww_pyq_gen"])
    app.state.svc.plan = plan
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, plan, app, tmp_path


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def ok(r, *states):
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["state"] in (states or ("live",)), j
    assert j["reason"] and j["source"]
    for s in strings(j):
        low = s.lower()
        if s != FOOTER:
            assert not any(w in low for w in BANNED), s          # counts and facts only, never a forecast
    return j


def test_one_invented_paper_goes_from_a_file_to_marks(env):
    c, st, plan, app, tmp = env
    pdf = build_pdf(BY_NAME["circuits_sections"], tmp / "made")

    # 1. the file is uploaded and read in the background
    r = c.post(f"{B}/upload", params={"name": "circuits-mid.pdf", "subject": "circuits", "year": 2025},
               content=pdf.read_bytes(), headers={"Content-Type": "application/octet-stream"})
    ok(r)
    app.state.pyq_ingest.wait(60)
    job = ok(c.get(f"{B}/ingest/last"))["job"]
    assert job["status"] == "done" and len(job["files"]) == 1, job
    f = job["files"][0]
    assert f["status"] == "added" and f["questions"] == 6 and f["method"] == "text-layer", f
    pid = f["paper_id"]
    assert any(e["kind"] == "segment" for e in job["trace"])     # the trace holds what really happened

    # 2. six questions wait for review, each with its crop and its printed marks; none is in the bank
    paper = ok(c.get(f"{B}/papers/{pid}"))
    assert paper["paper"]["subject"] == "circuits" and paper["paper"]["total_marks"] == 22
    qs = ok(c.get(f"{B}/questions", params={"paper": pid}))["items"]
    assert len(qs) == 6 and all(q["status"] == "pending" and q["has_crop"] for q in qs)
    assert sorted(q["marks"] for q in qs) == [2, 2, 2, 8, 8, 8] and all(q["marks_source"] == "printed" for q in qs)
    assert [q["section"] for q in qs] == ["A", "A", "A", "B", "B", "B"]
    assert c.get(f"{B}/crops/{qs[0]['id']}").headers["content-type"] == "image/png"
    assert st.bank_for("circuits") == []                         # nothing enters the bank unreviewed
    ids = [q["id"] for q in qs]

    # 3. the rule proposes tags; he accepts all six (a tag is not needed to accept, the marks are)
    sug = ok(c.post(f"{B}/tags/suggest", json={"paper": pid, "apply": True}))
    assert sug["count"] == 6 and all(i["tag_source"] in ("rule", "none") for i in sug["items"])
    done = ok(c.patch(f"{B}/questions", json={"ids": ids, "set": {"status": "accepted"}}))
    assert all(q["status"] == "accepted" and q["status_by"] == "hand" for q in done["items"])
    assert len(st.bank_for("circuits")) == 6

    # 4. a practice paper needs a blueprint first: the 22-mark row never borrows another shape
    r = c.post(f"{B}/papers/generate", json={"exam": "cie-cir", "seed": 7})
    assert r.status_code == 400 and "blueprint" in r.json()["detail"].lower()
    inf = ok(c.post(f"{B}/blueprints/infer", json={"paper": pid, "exam": "cie-cir"}))
    bp = inf["blueprint"]
    assert inf["issues"] == [] and bp["total"] == 22 and bp["origin"] == "rule"
    assert [(s["name"], s["questions"], s["attempt"], s["marks"]) for s in bp["sections"]] == [("A", 3, 3, 2), ("B", 3, 2, 8)]
    ok(c.get(f"{B}/blueprints/cie-cir"), "waiting")              # inferring does not save
    ok(c.put(f"{B}/blueprints/cie-cir", json={"blueprint": bp}))

    # 5. the paper: his six questions, balanced, the same for the same seed
    gen = ok(c.post(f"{B}/papers/generate", json={"exam": "cie-cir", "seed": 7}))["paper"]
    assert gen["total_marks"] == 22 and gen["seed"] == 7 and gen["invariants"] == [] and gen["shortfall"] == []
    assert gen["header"] == "Practice paper from your bank. Not an official paper."
    slots = [s for sec in gen["sections"] for s in sec["slots"]]
    assert sorted(s["question_id"] for s in slots) == sorted(ids) and all(s["source"] == "hand" for s in slots)
    again = ok(c.post(f"{B}/papers/generate", json={"exam": "cie-cir", "seed": 7}))["paper"]
    assert again["id"] == gen["id"] and [s["question_id"] for sec in again["sections"] for s in sec["slots"]] == [s["question_id"] for s in slots]
    assert ok(c.get(f"{B}/generated", params={"exam": "cie-cir"}))["count"] == 1

    # 6. print: the paper has the header and the seed and no key; the key and the marking sheet exist
    page = c.get(f"{B}/generated/{gen['id']}/print", params={"kind": "paper"})
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert "Practice paper from your bank. Not an official paper." in page.text and "7" in page.text and "<script" not in page.text.lower()
    assert "data:image/png;base64," in page.text                 # crops travel inside the page: an <img> request cannot carry the token
    for kind in ("key", "marking"):
        assert c.get(f"{B}/generated/{gen['id']}/print", params={"kind": kind}).status_code == 200

    # 7. he types marks for two questions; they are his marks and the topic's proficiency moves
    two = [slots[0], slots[-1]]
    m = ok(c.post(f"{B}/generated/{gen['id']}/marks", json={"items": [{"id": s["question_id"], "got": s["marks"] / 2} for s in two]}))
    assert m["saved"] == 2 and m["marked_by"] == "you" and m["total"] == {"got": sum(s["marks"] for s in two) / 2, "max": sum(s["marks"] for s in two)}
    logged = [json.loads(ln) for ln in (st.paths.root / "attempts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(logged) == 2 and all(a["marked_by"] == "you" for a in logged)
    assert sum(len(v) for v in plan.load()["paper_marks"]["circuits"].values()) == 2
    r = c.post(f"{B}/generated/{gen['id']}/marks", json={"items": [{"id": two[0]["question_id"], "got": two[0]["marks"] + 1}]})
    assert r.status_code == 400

    # 8. one paper is too few for a pattern, and the answer says how many more are needed
    pat = ok(c.get(f"{B}/patterns", params={"subject": "circuits"}), "waiting")
    assert pat["footer"] == FOOTER and pat["floor"]["papers_needed"] == 2 and pat["patterns"]["n_papers"] == 1
    cov = ok(c.get(f"{B}/coverage", params={"subject": "circuits"}), "waiting")["coverage"]
    assert cov["papers"] == 1 and cov["accepted"] == 6 and cov["pending"] == 0

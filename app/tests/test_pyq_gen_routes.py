"""Routes R-19 to R-27 (routes_ww_pyq_gen.py) through the real app with the pyq features mounted and a real
Plan on a scratch store. Every exam, paper and question here is invented; the on-disk bank is an empty
scratch folder so the tests decide what the generator sees."""
import json
import re
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import routes_ww_pyq_gen
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import schema
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Circuits", "topics": ["time constant"], "exam_weight": "med"}]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "signals", "name": "Signals", "kind": "current", "question_bank": [], "units": UNITS}]}
BANNED = ("important", "likely", "expected", "will be asked", "probability", "chance")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    disk = tmp_path / "disk-bank"
    disk.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(disk))
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    inputs = {"exams": [{"id": "cie-sig", "subject": "signals", "title": "Signals mid", "date": "2026-12-01", "kind": "cie", "max": 20},
                        {"id": "see-sig", "subject": "signals", "title": "Signals end", "date": "2026-12-20", "kind": "end_sem", "max": 14}]}
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
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_gen"])
    app.state.svc.plan = plan
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, plan


def own_paper(st, sha="b", marks=(2, 2, 2, 2, 2, 2, 5, 5), by="hand", text=None):
    """An accepted, tagged paper in the store: six 2-mark questions in section A, two 5-mark in B."""
    pid = st.add_paper({"title": "Invented mid", "subject": "signals", "year": 2025, "sha256": sha * 64, "total_marks": None})
    drafts = [{"text": text if (text and i == 0) else f"Explain invented idea {i}.", "text_status": "verified", "marks": m,
               "section": "A" if m == 2 else "B", "type": "short" if m == 2 else "numerical"} for i, m in enumerate(marks)]
    ids = st.add_questions(pid, drafts)
    st.update_questions(ids, {"status": "accepted", "unit": 1, "topic": "sampling theorem"}, by)
    return pid, ids


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    for text in strings(j):
        assert not any(w in text.lower() for w in BANNED), text


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def put_bp(c, exam="cie-sig", sections=None, total=20):
    sections = sections or [{"name": "A", "questions": 5, "attempt": 5, "marks": 2}, {"name": "B", "questions": 3, "attempt": 2, "marks": 5}]
    r = c.put(f"{B}/blueprints/{exam}", json={"blueprint": {"total": total, "duration_min": 40, "sections": sections}})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ every route answers and is documented
def test_every_route_answers_carries_the_envelope_and_is_in_the_docstring(env):
    c, st, _ = env
    pid, ids = own_paper(st)
    put_bp(c)
    gp = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 1}).json()["paper"]
    first = next(s for x in gp["sections"] for s in x["slots"] if s["source"] != "hollow")
    calls = [("GET", "/blueprints/cie-sig", None), ("PUT", "/blueprints/cie-sig", None), ("POST", "/blueprints/infer", {"paper": pid}),
             ("POST", "/papers/generate", {"exam": "cie-sig", "seed": 2}), ("GET", "/generated?exam=cie-sig", None),
             ("GET", f"/generated/{gp['id']}", None), ("GET", f"/generated/{gp['id']}/print?kind=paper", None),
             ("POST", "/check", {"key": "12.5 ms", "answer": "12.5 ms"}),
             ("POST", f"/generated/{gp['id']}/marks", {"items": [{"id": first["question_id"], "got": 1}]})]
    for method, path, body in calls:
        if method == "PUT":
            body = {"blueprint": {"total": 20, "sections": [{"name": "A", "questions": 5, "attempt": 5, "marks": 2},
                                                            {"name": "B", "questions": 3, "attempt": 2, "marks": 5}]}}
        r = c.request(method, B + path, json=body)
        assert r.status_code == 200, (method, path, r.status_code, r.text)
        if "/print" in path:
            assert r.headers["content-type"].startswith("text/html")
        else:
            envelope(r.json())
    doc = routes_ww_pyq_gen.__doc__
    for rid in [f"R-{n:02d}" for n in range(19, 28)]:
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    documented = {(m, p.split("?")[0]) for m, p in rows}
    gen_paths = ("/blueprints", "/papers/generate", "/generated", "/check")
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ())
               if r.path.startswith(B) and r.path[len(B):].startswith(gen_paths) and m != "HEAD"}
    assert len(rows) == 9 and documented == defined
    assert c.get(f"{B}/blueprints/cie-sig", headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


def test_the_plan_store_not_up_is_503(env):
    c, st, _ = env
    c.app.state.svc.plan = None
    assert c.get(f"{B}/blueprints/cie-sig").status_code == 503
    assert c.post(f"{B}/papers/generate", json={"exam": "cie-sig"}).status_code == 503


# ------------------------------------------------------------------ R-19, R-20, R-21
def test_r19_waiting_without_a_blueprint_and_404_for_an_unknown_exam(env):
    c, _, _ = env
    j = c.get(f"{B}/blueprints/cie-sig").json()
    assert j["state"] == "waiting" and j["blueprint"] is None and j["issues"] == []
    assert j["reason"] == "No blueprint. Infer one from a paper on file."
    assert j["exam"] == {"id": "cie-sig", "subject": "signals", "title": "Signals mid", "max": 20}
    assert c.get(f"{B}/blueprints/not-on-sheet").status_code == 404
    assert c.get(f"{B}/blueprints/..%2Fx").status_code in (400, 404)


def test_r20_saves_a_balanced_blueprint_live_and_an_unbalanced_one_as_fault(env):
    c, st, _ = env
    j = put_bp(c)
    assert j["state"] == "live" and j["reason"] == "Balanced: 20 marks." and j["issues"] == []
    assert j["blueprint"]["origin"] == "hand" and j["blueprint"]["exam"] == "cie-sig"
    assert c.get(f"{B}/blueprints/cie-sig").json()["state"] == "live"
    bad = put_bp(c, total=25)
    assert bad["state"] == "fault" and bad["issues"][0]["code"] == "total" and bad["reason"] == bad["issues"][0]["text"]
    assert c.get(f"{B}/blueprints/cie-sig").json()["blueprint"]["total"] == 25           # kept so he can keep editing
    for body in ({}, {"blueprint": "A"}, {"blueprint": {"sections": "A"}}, {"blueprint": {"sections": [{"name": "A", "choice": "x"}]}}):
        assert c.put(f"{B}/blueprints/cie-sig", json=body).status_code == 400, body
    assert c.put(f"{B}/blueprints/nope", json={"blueprint": {"total": 1, "sections": []}}).status_code == 404


def test_r21_infers_from_a_paper_without_saving(env):
    c, st, _ = env
    pid, _ = own_paper(st)
    j = c.post(f"{B}/blueprints/infer", json={"paper": pid, "exam": "cie-sig"}).json()
    assert j["blueprint"]["origin"] == "rule" and j["blueprint"]["total"] == 22 and j["trace"]
    assert [(s["name"], s["questions"], s["attempt"], s["marks"]) for s in j["blueprint"]["sections"]] == [("A", 6, 6, 2), ("B", 2, 2, 5)]
    assert j["state"] == "fault" and j["issues"][0]["code"] == "exam_max"      # a 22-mark paper is not the 20-mark row
    assert c.post(f"{B}/blueprints/infer", json={"paper": pid}).json()["state"] == "live"
    assert c.get(f"{B}/blueprints/cie-sig").json()["blueprint"] is None
    empty = st.add_paper({"title": "Empty", "subject": "signals"})
    st.add_questions(empty, [{"text": "No marks here.", "marks": None}])
    assert c.post(f"{B}/blueprints/infer", json={"paper": empty}).status_code == 400
    assert c.post(f"{B}/blueprints/infer", json={"paper": "p-000000000000"}).status_code == 404
    assert c.post(f"{B}/blueprints/infer", json={}).status_code == 400


# ------------------------------------------------------------------ R-22: the 9 Nov bug pinned through the route
def test_r22_a_20_mark_row_with_no_blueprint_is_refused_never_the_60_mark_default(env):
    c, st, _ = env
    own_paper(st)
    r = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 1})
    assert r.status_code == 400 and "infer" in r.json()["detail"].lower()
    assert list(st.paths.generated.glob("*.json")) == []
    # a blueprint read off a 60-mark paper does not balance against the 20-mark row
    put_bp(c, sections=[{"name": "A", "questions": 5, "attempt": 5, "marks": 2}, {"name": "B", "questions": 10, "attempt": 5, "marks": 7},
                        {"name": "C", "questions": 5, "attempt": 3, "marks": 5}], total=60)
    r = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 1})
    assert r.status_code == 400 and r.json()["detail"].startswith("The blueprint does not balance: ") and "20" in r.json()["detail"]
    assert list(st.paths.generated.glob("*.json")) == []


def test_r22_generates_and_stores_r23_lists_r24_reads(env):
    c, st, _ = env
    own_paper(st, by="rule")
    put_bp(c)
    r = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 4})
    assert r.status_code == 200, r.text
    j = r.json()
    p = j["paper"]
    assert j["state"] == "live" and p["total_marks"] == 20 and p["invariants"] == [] and p["made"]
    assert p["header"] == "Practice paper from your bank. Not an official paper."
    srcs = [s["source"] for x in p["sections"] for s in x["slots"]]
    assert srcs.count("rule") == 7 and srcs.count("template") == 1                 # B has 2 own 5-mark rows: a template takes the third
    assert (st.paths.generated / f"{p['id']}.json").is_file()
    again = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 4}).json()["paper"]
    assert again["id"] == p["id"] and again["sections"] == p["sections"]
    lst = c.get(f"{B}/generated?exam=cie-sig").json()
    assert lst["state"] == "live" and lst["count"] == 1
    item = lst["items"][0]
    assert set(item) == {"id", "exam", "seed", "made", "total_marks", "counts"} and item["counts"]["rule"] == 7
    assert c.get(f"{B}/generated?exam=see-sig").json()["state"] == "waiting"
    assert c.get(f"{B}/generated/{p['id']}").json()["paper"]["id"] == p["id"]
    assert c.get(f"{B}/generated/g-000000000000").status_code == 404
    assert c.get(f"{B}/generated/..%2F..%2Fpapers").status_code == 404
    assert c.post(f"{B}/papers/generate", json={"exam": "nope"}).status_code == 404
    assert c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": "x"}).status_code == 400
    assert c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "tier": "gate"}).status_code == 400


# ------------------------------------------------------------------ R-25 print
def test_r25_prints_three_kinds_escaped_and_refuses_the_night_sheet(env):
    c, st, _ = env
    own_paper(st, text="<script>alert(1)</script>")
    put_bp(c, sections=[{"name": "A", "questions": 6, "attempt": 5, "marks": 2}, {"name": "B", "questions": 3, "attempt": 2, "marks": 5}])
    gid = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 1}).json()["paper"]["id"]
    for kind in ("paper", "key", "marking"):
        r = c.get(f"{B}/generated/{gid}/print?kind={kind}")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
        assert "<script" not in r.text.lower() and "Not an official paper." in r.text
    assert "&lt;script&gt;" in c.get(f"{B}/generated/{gid}/print?kind=paper").text
    r = c.get(f"{B}/generated/{gid}/print?kind=night")
    assert r.status_code == 400 and r.json()["detail"] == "The night sheet is planned."
    assert c.get(f"{B}/generated/{gid}/print?kind=poster").status_code == 400
    assert c.get(f"{B}/generated/g-000000000000/print?kind=paper").status_code == 404


# ------------------------------------------------------------------ R-26 check
def test_r26_checks_a_number_and_never_returns_marks(env):
    c, st, _ = env
    j = c.post(f"{B}/check", json={"key": "12.5 ms", "answer": "0.0125 s"}).json()
    assert j["state"] == "live" and j["check"]["match"] is True and "marks" not in j["check"]
    assert c.post(f"{B}/check", json={"key": "12.5 ms", "answer": "about twelve"}).status_code == 400
    w = c.post(f"{B}/check", json={"key": "Explain aliasing.", "answer": "3"}).json()
    assert w["state"] == "waiting" and w["check"]["match"] is None and w["reason"] == "This question has no numeric key."
    pid, ids = own_paper(st)
    w = c.post(f"{B}/check", json={"question_id": ids[0], "answer": "3"}).json()
    assert w["state"] == "waiting" and w["check"]["match"] is None
    put_bp(c)
    gp = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 4}).json()["paper"]
    tpl = next(s for x in gp["sections"] for s in x["slots"] if s["source"] == "template")
    t = c.post(f"{B}/check", json={"question_id": tpl["question_id"], "answer": tpl["key"]}).json()
    assert t["state"] == "live" and t["check"]["match"] is True
    assert c.post(f"{B}/check", json={"question_id": "q-ffffffffffff", "answer": "3"}).status_code == 404
    assert c.post(f"{B}/check", json={"answer": "3"}).status_code == 400


# ------------------------------------------------------------------ R-27 marks
def test_r27_refuses_bad_marks_writes_marked_by_you_and_moves_the_topic(env):
    c, st, plan = env
    pid, ids = own_paper(st)
    put_bp(c)
    gp = c.post(f"{B}/papers/generate", json={"exam": "cie-sig", "seed": 4}).json()["paper"]
    own = [s for x in gp["sections"] for s in x["slots"] if s["source"] in ("hand", "rule")]
    tpl = next(s for x in gp["sections"] for s in x["slots"] if s["source"] == "template")
    url = f"{B}/generated/{gp['id']}/marks"
    assert c.post(url, json={"items": [{"id": own[0]["question_id"], "got": own[0]["marks"] + 1}]}).status_code == 400
    assert c.post(url, json={"items": [{"id": own[0]["question_id"], "got": -1}]}).status_code == 400
    # the edge: half a mark over the question's value is still over (a mutation to "max + 0.5" survived the +1 case)
    assert c.post(url, json={"items": [{"id": own[0]["question_id"], "got": own[0]["marks"] + 0.5}]}).status_code == 400
    assert c.post(url, json={"items": [{"id": own[0]["question_id"], "got": -0.5}]}).status_code == 400
    assert c.post(url, json={"items": [{"id": own[0]["question_id"], "got": "5"}]}).status_code == 400   # a string is not a mark
    assert c.post(url, json={"items": [{"id": "q-ffffffffffff", "got": 1}]}).status_code == 400
    assert c.post(url, json={"items": [{"id": None, "got": 0}]}).status_code == 400            # a hollow slot has no id to mark
    assert c.post(url, json={"items": []}).status_code == 400
    assert not (st.root / "attempts.jsonl").exists()
    key = "1|sampling theorem"
    r = c.post(url, json={"items": [{"id": own[0]["question_id"], "got": own[0]["marks"]},
                                    {"id": tpl["question_id"], "got": 5}]})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["state"] == "live" and j["saved"] == 2 and j["marked_by"] == "you"
    assert j["total"] == {"got": own[0]["marks"] + 5, "max": own[0]["marks"] + 5}
    lines = [json.loads(x) for x in (st.root / "attempts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(x["question_id"], x["paper_id"], x["marked_by"]) for x in lines] == [(own[0]["question_id"], gp["id"], "you"),
                                                                                  (tpl["question_id"], gp["id"], "you")]
    assert set(lines[0]) == {"question_id", "paper_id", "got", "max", "marked_by", "date"}
    pm = plan.load()["paper_marks"]["signals"]
    assert pm[key][-1]["q"] == own[0]["question_id"]
    assert j["proficiency"][key] == round(0.1 * 0.5 + 1.0 * 0.5, 3)                    # it was 0.1 (untapped) before
    assert c.post(f"{B}/generated/g-000000000000/marks", json={"items": [{"id": "x", "got": 0}]}).status_code == 404


def test_paper_marks_extra_bank_is_optional_and_merged_after_the_typed_bank(env):
    _, _, plan = env
    with pytest.raises(ValueError):
        plan.paper_marks("cie-sig", {"items": [{"id": "q-abcabcabcabc", "got": 1}]})
    r = plan.paper_marks("cie-sig", {"items": [{"id": "q-abcabcabcabc", "got": 1}]},
                         extra_bank={"q-abcabcabcabc": {"id": "q-abcabcabcabc", "unit": 1, "topic": "aliasing", "marks": 2, "question": "x"}})
    assert r["saved"] == 1 and r["proficiency"]["1|aliasing"] == round(0.1 * 0.5 + 0.5 * 0.5, 3)


def test_security_huge_blueprint_and_hostile_numbers_are_refused_fast(env):
    import time
    c, st, plan = env
    t = time.time()
    big = {"total": 20, "sections": [{"name": "A", "questions": 3_000_000, "attempt": 1, "marks": 20}]}
    assert c.put(f"{B}/blueprints/cie-sig", json={"blueprint": big}).status_code == 400
    big2 = {"total": 1e12, "sections": [{"name": "A", "questions": 2, "attempt": 1, "marks": 1e12}]}
    assert c.put(f"{B}/blueprints/cie-sig", json={"blueprint": big2}).status_code == 400
    for ans in ["0e999999", "0e" + "9" * 5000, "1" + " " * 200000 + "x", "9" * 5000]:
        r = c.post(f"{B}/check", json={"key": "5 V", "answer": ans})
        assert r.status_code == 400, (len(ans), r.status_code)
    r = c.post(f"{B}/check", json={"key": "0e999999 V", "answer": "5"})
    assert r.status_code == 200 and r.json()["check"]["match"] is None
    assert time.time() - t < 5


def test_security_ids_with_separators_never_reach_a_path(env):
    c, st, plan = env
    for bad in ["..%2f..%2fx", "g-..%5c..", "C:", "g-000000000000.", "con", "g-%00"]:
        for url in (f"{B}/generated/{bad}", f"{B}/generated/{bad}/print", f"{B}/blueprints/{bad}"):
            assert c.get(url).status_code in (400, 404), url
        assert c.post(f"{B}/generated/{bad}/marks", json={"items": [{"id": "x", "got": 1}]}).status_code in (400, 404)
        assert c.put(f"{B}/blueprints/{bad}", json={"blueprint": {"total": 1, "sections": []}}).status_code in (400, 404)
    assert not [p for p in Path(st.paths.root).parent.glob("*.json") if p.name != "inputs.json"]

"""The study engine (one node, resource -> study -> contracts -> follow-ups) and the
life engine (counters with a gentle taper, items, reels to explain). Fictional data only."""
import copy

import pytest

from jarvis_app import ww_engines
from jarvis_app.ww_base import no_shame
from jarvis_app.ww_life import DEFAULT_COUNTERS, life
from jarvis_app.ww_study import FOLLOW_UPS, study

TODAY = "2026-10-30"
NODE = {"id": "n.x", "name": "Node X", "branch": "maths", "hours_est": 10}
RES = [{"id": "r1", "title": "Book one"}, {"id": "r2", "title": "Course two"}]
CONS = [{"key": "n.x/c1", "id": "c1", "title": "First", "minutes": 30, "done": False},
        {"key": "n.x/c2", "id": "c2", "title": "Second", "minutes": 30, "done": False}]


def E(d, minutes=60, files=0):
    return {"id": f"e-{d}", "date": d, "what": "covered ch 1", "minutes": minutes, "files": [{"name": f"n{i}.md", "path": "p"} for i in range(files)]}


def test_study_walks_the_stages_in_order():
    assert study({}, TODAY, node=NODE, resources=RES)["stage"] == "choose"
    s = study({}, TODAY, node=NODE, resources=RES, choice={"primary": "r2"})
    assert s["stage"] == "study" and s["primary"]["id"] == "r2" and [r["id"] for r in s["backups"]] == ["r1"]
    s = study({}, TODAY, node=NODE, resources=RES, contracts=CONS, entries=[E("2026-10-28"), E("2026-10-29")], choice={"primary": "r2"})
    assert s["stage"] == "contracts" and s["next"]["key"] == "n.x/c1" and s["progress"]["share"] == 0.2
    done = [{**c, "done": True} for c in CONS]
    s = study({}, TODAY, node=NODE, resources=RES, contracts=done, entries=[E("2026-10-29", files=1)], choice={"primary": "r2"})
    assert s["stage"] == "review" and s["next"]["due_now"] and [f["due"] for f in s["follow_ups"]] == ["2026-10-30", "2026-11-01", "2026-11-05"]
    ok = {"primary": "r2", "reviews": [{"ok": True}] * len(FOLLOW_UPS)}
    assert study({}, TODAY, node=NODE, resources=RES, contracts=done, entries=[E("2026-10-29", files=1)], choice=ok)["stage"] == "mastered"
    no_notes = study({}, TODAY, node=NODE, resources=RES, contracts=done, entries=[E("2026-10-29")], choice=ok)
    assert no_notes["stage"] == "review" and no_notes["next"]["kind"] == "notes"


def test_study_without_a_node_and_purity():
    assert study({}, TODAY)["node"] is None
    args = dict(node=NODE, resources=RES, contracts=CONS, entries=[E("2026-10-29")], choice={"primary": "r1"})
    before = copy.deepcopy(args)
    assert study({}, TODAY, **args) == study({}, TODAY, **copy.deepcopy(args)) and args == before


def log_days(cid, values, end="2026-10-29"):
    from jarvis_app.ww_base import add_days
    return {add_days(end, -i): {"counts": {cid: v}} for i, v in enumerate(reversed(values))}


def test_a_taper_line_is_10_percent_under_the_last_7_days_median():
    log = log_days("snacks", [10, 10, 10, 10, 10, 10, 10])
    r = life({}, TODAY, log={**log, TODAY: {"counts": {"snacks": 9}}})
    c = next(x for x in r["counters"] if x["id"] == "snacks")
    assert c["line"] == 9 and c["on_line"] is True and r["points_today"] == 1
    r = life({}, TODAY, log={**log, TODAY: {"counts": {"snacks": 12}}})
    c = next(x for x in r["counters"] if x["id"] == "snacks")
    assert c["on_line"] is False and no_shame(r["say"] + r["rule"])


def test_no_line_until_three_days_are_logged_and_more_and_yes_counters():
    r = life({}, TODAY, log=log_days("snacks", [5, 5]))
    assert next(x for x in r["counters"] if x["id"] == "snacks")["line"] is None
    r = life({}, TODAY, log={**log_days("water", [4, 4, 4]), TODAY: {"counts": {"water": 5, "college": 1}}})
    w = next(x for x in r["counters"] if x["id"] == "water")
    assert w["line"] == 5 and w["on_line"] and next(x for x in r["counters"] if x["id"] == "college")["on_line"]


def test_reels_wait_to_be_explained_and_weeks_sum_points():
    log = {"2026-10-28": {"items": [{"kind": "reel", "text": "Fourier in 60 s", "url": "https://example.org/r"}], "points": 3},
           "2026-10-29": {"points": 2}}
    r = life({}, TODAY, log=log)
    assert [x["text"] for x in r["reels_to_explain"]] == ["Fourier in 60 s"] and r["weeks"][0]["points"] == 5
    log["2026-10-28"]["items"][0]["explained"] = TODAY
    assert life({}, TODAY, log=log)["reels_to_explain"] == []


def test_custom_counters_from_settings_and_registration():
    inp = ww_engines.normalize_inputs({"life": {"counters": [{"id": "steps", "name": "Steps (k)", "want": "more"}, {"name": "no id"}]}})
    assert inp["life"]["counters"] == [{"id": "steps", "name": "Steps (k)", "want": "more"}]
    assert [c["id"] for c in life(inp, TODAY)["counters"]] == ["steps"]
    assert [c["id"] for c in life({}, TODAY)["counters"]] == [c["id"] for c in DEFAULT_COUNTERS]
    assert ww_engines.run("life", inp, TODAY, log={})["status"] == "ok" and ww_engines.run("study", inp, TODAY)["status"] == "ok"


# ------------------------------------------------------------------ through the plan
@pytest.fixture()
def plan(tmp_path, monkeypatch):
    import json
    import shutil
    from pathlib import Path
    from jarvis_app import germoney as g
    fix = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(fix / n, d / n)
    bank = g.load_bank(d)
    (tmp_path / "in.json").write_text(json.dumps({}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "in.json"))
    monkeypatch.setattr(g, "LEARNING", tmp_path / "learning")
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None,
                  apps=g.Applications(calendar=tmp_path / "c.json", store=tmp_path / "a.json"))


def test_life_taps_persist_and_bad_taps_are_refused(plan):
    plan.life_tap("count", {"id": "snacks", "delta": 1}, today=TODAY)
    r = plan.life_tap("count", {"id": "snacks", "delta": 1}, today=TODAY)
    assert next(x for x in r["counters"] if x["id"] == "snacks")["today"] == 2
    r = plan.life_tap("item", {"kind": "reel", "text": "Op-amp trick", "url": "https://example.org/x"}, today=TODAY)
    assert r["items"][-1]["url"] == "https://example.org/x"
    plan.life_tap("explained", {"date": TODAY, "index": 0, "text": "virtual short"}, today=TODAY)
    assert plan.load(TODAY)["life"][TODAY]["items"][0]["explanation"] == "virtual short"
    for op, body in [("count", {"id": "nope", "value": 1}), ("count", {"id": "snacks", "value": -1}),
                     ("item", {"kind": "tweet", "text": "x"}), ("explained", {"date": TODAY, "index": 5}), ("dance", {})]:
        with pytest.raises(ValueError):
            plan.life_tap(op, body, today=TODAY)


def test_study_primary_must_be_a_listed_resource(plan):
    bank = plan.bank()
    nid = next(n for n in bank["order"] if bank["nodes"][n].get("resources"))
    rid = bank["nodes"][nid]["resources"][0]
    r = plan.study_set(nid, "primary", {"resource": rid}, today=TODAY)
    assert r["primary"]["id"] == rid and r["stage"] in ("study", "contracts")
    with pytest.raises(ValueError):
        plan.study_set(nid, "primary", {"resource": "not-listed"}, today=TODAY)
    with pytest.raises(KeyError):
        plan.study_view("no-such-node", today=TODAY)

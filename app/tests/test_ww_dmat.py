"""dMAT practice (ww_dmat.py, routes_ww_dmat.py, ww_check_dmat.py): determinism, uniqueness proved
by independent solvers, levels that get harder, marking, and the two routes. All data is generated
here from seeds; nothing comes from the test's own material."""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, ww_check_dmat, ww_dmat
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32
APP = Path(__file__).resolve().parents[1]


# ------------------------------------------------------------------ the generators
@pytest.mark.parametrize("kind", ww_dmat.KINDS)
def test_same_seed_same_set_and_other_seed_other_set(kind):
    a, ka = ww_dmat.build(kind, 11, 3, 6)
    b, kb = ww_dmat.build(kind, 11, 3, 6)
    c, _ = ww_dmat.build(kind, 12, 3, 6)
    assert a == b and ka == kb
    assert a["items"] != c["items"]


def test_same_seed_same_set_in_another_process_with_another_hash_salt():
    code = "import json,sys;from jarvis_app import ww_dmat as d;print(json.dumps([d.build(k,5,4,3) for k in d.KINDS],sort_keys=True))"
    runs = []
    for salt in ("1", "977"):
        env = {"PYTHONHASHSEED": salt, "PYTHONPATH": str(APP), "JARVIS_DATA_DIR": str(APP / "data" / "x"), "SYSTEMROOT": "C:\\Windows"}
        runs.append(subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60, cwd=str(APP)).stdout)
    here = json.dumps([ww_dmat.build(k, 5, 4, 3) for k in ww_dmat.KINDS], sort_keys=True)
    assert runs[0] and runs[0] == runs[1] == here + "\n"


def test_a_prefix_of_a_set_is_the_smaller_set():
    big, kb = ww_dmat.build("latin", 9, 2, 8)
    small, ks = ww_dmat.build("latin", 9, 2, 3)
    assert big["items"][:3] == small["items"] and kb[:3] == ks


@pytest.mark.parametrize("kind", ww_dmat.KINDS)
def test_public_set_carries_no_key_and_has_five_levels_of_timing(kind):
    pub, keys = ww_dmat.build(kind, 1, 2, 4)
    assert all("key" not in it for it in pub["items"]) and "keys" not in pub
    assert pub["time_limit_s"] == 4 * pub["seconds_per_item"]
    per = [ww_dmat.seconds_per_item(kind, lv) for lv in ww_dmat.LEVELS]
    assert per == sorted(per) and len(set(per)) == 5
    assert all(0 <= k < len(it["options"]) for it, k in zip(pub["items"], keys))


@pytest.mark.parametrize("kind", ww_dmat.KINDS)
def test_independent_solver_agrees_with_the_key_on_every_level(kind):
    probs = []
    for seed in range(40):
        probs += ww_check_dmat.check_set(kind, seed, seed % 5 + 1, 3)
    assert probs == []


def test_the_full_gate_sweep_is_clean():
    r = ww_check_dmat.sweep(200)
    assert r["problems"] == []
    assert {k: v["items"] for k, v in r["kinds"].items()} == {"figure": 600, "equation": 600, "latin": 600}
    assert r["seconds"] < 60


# ------------------------------------------------------------------ the checker must be able to fail
def test_the_checker_catches_a_wrong_key_for_each_kind(monkeypatch):
    for kind in ww_dmat.KINDS:
        real = ww_dmat.build

        def wrong(k, s, lv, n, real=real):
            pub, keys = real(k, s, lv, n)
            return pub, [(x + 1) % len(pub["items"][0]["options"]) for x in keys]
        monkeypatch.setattr(ww_dmat, "build", wrong)
        assert ww_check_dmat.check_set(kind, 3, 3, 2), kind
        monkeypatch.setattr(ww_dmat, "build", real)


def test_the_checker_catches_an_ambiguous_item():
    pub, keys = ww_dmat.build("latin", 2, 3, 1)
    it = pub["items"][0]
    it["grid"] = [[None] * it["n"] for _ in range(it["n"])]               # an empty square has many completions
    assert ww_check_dmat.solve_latin(it)["completions"] == 2
    eq = ww_dmat.build("equation", 2, 3, 1)[0]["items"][0]
    eq["equations"] = eq["equations"][:1]                                  # one equation, three unknowns
    assert ww_check_dmat.solve_equation(eq)["solutions"] != 1
    fg = ww_dmat.build("figure", 2, 4, 1)[0]["items"][0]
    fg["shown"] = fg["shown"][:2]                                          # two terms fit many rules
    assert len(ww_check_dmat.solve_figure(fg)["fits"]) != 1 or ww_check_dmat.solve_figure(fg)["outside"]


# ------------------------------------------------------------------ per kind
def test_figure_sequences_get_longer_and_busier_with_level():
    n_changing = {}
    for lv in ww_dmat.LEVELS:
        pub, _ = ww_dmat.build("figure", 4, lv, 12)
        shown = [it["shown"] for it in pub["items"]]
        n_changing[lv] = sum(len({t[a] for t in map(lambda x: x, [[s["glyph"], s["rotation"], s["count"]] for s in seq])}) > 1
                             for seq in shown for a in range(3)) / len(shown)
    assert n_changing[1] < n_changing[2] <= n_changing[4]
    assert n_changing[1] <= 1.0 + 1e-9


def test_figure_terms_are_drawable_without_the_ui_knowing_the_glyphs():
    pub, _ = ww_dmat.build("figure", 6, 3, 2)
    t = pub["items"][0]["shown"][0]
    assert re.fullmatch(r"[a-z]+:\d+:\d", t["token"]) and t["text"]
    assert len(t["paths"]) == t["count"] and t["viewbox"][2] == ww_dmat.CELL * t["count"]
    assert all(re.fullmatch(r"M[-\d. L]+ Z", p) for p in t["paths"])


def test_every_glyph_has_no_rotational_symmetry_so_a_turn_is_visible():
    import math
    for g, pts in ww_dmat._OUTLINE.items():
        for step in range(1, 8):
            a = math.radians(45 * step)
            rot = sorted((round(x * math.cos(a) - y * math.sin(a), 3), round(x * math.sin(a) + y * math.cos(a), 3)) for x, y in pts)
            assert rot != sorted((float(x), float(y)) for x, y in pts), (g, step)


def test_equation_text_is_plain_arithmetic_with_a_stated_range():
    pub, _ = ww_dmat.build("equation", 8, 4, 5)
    for it in pub["items"]:
        assert re.search(r"whole number", it["rule"]) and it["range"][0] == 1
        assert all(re.fullmatch(r"[-+*=\sA-D0-9]+", e) for e in it["equations"] + [it["ask"]])
        assert len(it["options"]) == 5 and len({o["text"] for o in it["options"]}) == 5


def test_equation_levels_add_unknowns():
    sizes = {lv: {len(it["unknowns"]) for it in ww_dmat.build("equation", 3, lv, 6)[0]["items"]} for lv in ww_dmat.LEVELS}
    assert sizes[1] == {1} and sizes[2] == {2} and sizes[3] == {3} and sizes[5] == {4}


def test_latin_levels_grow_and_blank_more_cells():
    blanks = {lv: sum(it["blanks"] for it in ww_dmat.build("latin", 2, lv, 8)[0]["items"]) / 8 for lv in ww_dmat.LEVELS}
    assert blanks[1] < blanks[2] < blanks[3] < blanks[4]
    assert ww_dmat.build("latin", 2, 1, 1)[0]["items"][0]["n"] == 4 and ww_dmat.build("latin", 2, 5, 1)[0]["items"][0]["n"] == 6
    it = ww_dmat.build("latin", 5, 3, 1)[0]["items"][0]
    assert it["grid"][it["ask"]["row"] - 1][it["ask"]["col"] - 1] is None


def test_no_text_of_the_tests_own_material_is_stored():
    # The preparatory material's wording and its copyright line, as far as it is known; a hit means copying.
    src = (APP / "jarvis_app" / "ww_dmat.py").read_text(encoding="utf-8").lower()
    for phrase in ("g.a.s.t. 20", "all texts, images and graphics", "preparatory materials", "sample item"):
        assert phrase not in src
    assert "copyrighted" in src            # the module says why it generates instead of copying


# ------------------------------------------------------------------ marking
def test_mark_counts_right_wrong_skipped_and_never_raises():
    pub, keys = ww_dmat.build("equation", 3, 2, 4)
    ans = [keys[0], (keys[1] + 1) % 5, None, "x"]
    r = ww_dmat.mark("equation", 3, 2, 4, ans, 70)
    assert (r["correct"], r["of"], r["unanswered"], r["pct"]) == (1, 4, 1, 25)
    assert [i["ok"] for i in r["items"]] == [True, False, False, False]
    assert r["in_time"] is True and r["time_limit_s"] == pub["time_limit_s"]
    assert ww_dmat.mark("equation", 3, 2, 4, keys, pub["time_limit_s"] + 1)["in_time"] is False
    assert ww_dmat.mark("equation", 3, 2, 4, keys, None)["in_time"] is None
    full = ww_dmat.mark("equation", 3, 2, 4, keys, 10)
    assert full["correct"] == 4 and full["pct"] == 100
    for junk in (None, "abc", 5, {"a": 1}, [True, 99, -1, 1.5]):
        assert ww_dmat.mark("latin", 1, 1, 3, junk, "fast")["correct"] == 0


def test_set_id_round_trips_and_bad_input_is_refused():
    sid = ww_dmat.set_id("latin", 123, 4, 7)
    assert ww_dmat.parse_set_id(sid) == ("latin", 123, 4, 7)
    for bad in ("", "latin-1-L2", "x-1-L2-n3", "latin-a-L2-n3", "latin-1-2-3"):
        with pytest.raises(ValueError):
            ww_dmat.parse_set_id(bad)
    for args in (("nope", 1, 1, 1), ("latin", -1, 1, 1), ("latin", 1, 0, 1), ("latin", 1, 6, 1), ("latin", 1, 1, 0), ("latin", 1, 1, 61), ("latin", True, 1, 1)):
        with pytest.raises(ValueError):
            ww_dmat.check_args(*args)


# ------------------------------------------------------------------ routes
@pytest.fixture()
def client(tmp_path):
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_dmat"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = germoney.KVStore(tmp_path / "kv", tmp_path / "bk")      # never the real store
        yield c


def test_set_route_returns_the_same_set_for_the_same_seed(client):
    a = client.get("/api/mission/dmat/set", params={"kind": "figure", "seed": 42, "n": 5, "level": 3}).json()
    b = client.get("/api/mission/dmat/set", params={"kind": "figure", "seed": 42, "n": 5, "level": 3}).json()
    assert a == b and a["set_id"] == "figure-42-L3-n5" and len(a["items"]) == 5
    assert "keys" not in a and a["time_limit_s"] == 5 * a["seconds_per_item"]


def test_set_route_without_a_seed_makes_one_and_returns_it(client):
    a = client.get("/api/mission/dmat/set", params={"kind": "latin"}).json()
    assert a["n"] == 10 and a["level"] == 1 and isinstance(a["seed"], int)
    again = client.get("/api/mission/dmat/set", params={"kind": "latin", "seed": a["seed"]}).json()
    assert again == a


def test_set_route_refuses_bad_input_in_plain_words(client):
    for p in ({"kind": "chess"}, {"kind": "latin", "level": 9}, {"kind": "latin", "n": 0}, {"kind": "latin", "n": 500}, {"kind": "latin", "seed": -3}):
        r = client.get("/api/mission/dmat/set", params=p)
        assert r.status_code == 400 and r.json()["detail"], p
    assert client.get("/api/mission/dmat/set").status_code == 422          # kind is required


def test_score_by_set_id_and_by_parts_agree_and_are_kept(client):
    _, keys = ww_dmat.build("figure", 7, 2, 4)
    by_id = client.post("/api/mission/dmat/score", json={"set_id": "figure-7-L2-n4", "answers": keys[:3] + [None], "seconds": 100}).json()
    by_parts = client.post("/api/mission/dmat/score", json={"kind": "figure", "seed": 7, "level": 2, "n": 4, "answers": keys, "seconds": 90}).json()
    assert by_id["correct"] == 3 and by_id["unanswered"] == 1 and by_parts["correct"] == 4
    assert by_id["set_id"] == by_parts["set_id"] == "figure-7-L2-n4"
    h = client.get("/api/mission/dmat/history").json()
    assert [r["correct"] for r in h["results"]] == [4, 3] and not h["empty"]          # newest first
    assert h["results"][0]["kind"] == "figure" and "items" not in h["results"][0]


def test_score_refuses_bad_ids_and_junk_answers_do_not_crash(client):
    assert client.post("/api/mission/dmat/score", json={"set_id": "nonsense", "answers": []}).status_code == 400
    assert client.post("/api/mission/dmat/score", json={"kind": "latin", "seed": 1, "level": 1, "n": 99}).status_code == 400
    assert client.post("/api/mission/dmat/score", json={"kind": "latin", "seed": "x", "level": 1, "n": 3}).status_code == 400
    r = client.post("/api/mission/dmat/score", json={"set_id": "latin-1-L1-n3", "answers": "zzz", "seconds": "slow"})
    assert r.status_code == 200 and r.json()["correct"] == 0 and r.json()["seconds"] is None


def test_history_filters_by_kind_and_starts_empty(client):
    h = client.get("/api/mission/dmat/history").json()
    assert h["results"] == [] and h["empty"] is True
    client.post("/api/mission/dmat/score", json={"set_id": "latin-1-L1-n3", "answers": []})
    client.post("/api/mission/dmat/score", json={"set_id": "equation-1-L1-n3", "answers": []})
    assert [r["kind"] for r in client.get("/api/mission/dmat/history", params={"kind": "latin"}).json()["results"]] == ["latin"]
    assert client.get("/api/mission/dmat/history", params={"kind": "chess"}).status_code == 400


def test_score_does_not_touch_the_plan_state_key(client):
    before = client.app.state.svc.kv.get(germoney.PLAN_KEY)
    client.post("/api/mission/dmat/score", json={"set_id": "latin-1-L1-n3", "answers": []})
    assert client.app.state.svc.kv.get(germoney.PLAN_KEY) == before
    assert client.app.state.svc.kv.get("@ww_dmat")


def test_history_keeps_only_the_last_200(client):
    from jarvis_app import routes_ww_dmat as r
    kv = client.app.state.svc.kv
    res = ww_dmat.mark("latin", 1, 1, 3, [])
    for _ in range(r.KEEP + 5):
        r.record(kv, res, "2026-11-09")
    assert len(json.loads(kv.get("@ww_dmat"))) == r.KEEP

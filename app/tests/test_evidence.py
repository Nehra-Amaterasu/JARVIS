"""The evidence ledger (ww_evidence.py, routes K-01 to K-04 in routes_ww_evidence.py). Each test has its own ledger and
data folder under tmp_path; the git repositories are made here with git init and git commit, with a user name and email
set in that repository only. The plan is a fake; every title, node and repository is invented. No test reaches a network."""
import copy
import json
import os
import re
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_evidence as R
from jarvis_app import ww_evidence as E

B = "/api/mission/evidence"
TODAY = "2026-11-27"
WORDS = re.compile(r"\b(important|likely|expected|probability|chance|forecast|predict\w*)\b", re.I)


class FakePlan:
    def __init__(self, st=None):
        self.st = st if st is not None else {"events": []}

    def load(self, today=None):
        return self.st


def git(repo: Path, *args: str, env=None) -> str:
    r = subprocess.run(["git", *args], cwd=str(repo), capture_output=True, text=True, check=True,
                       env={**os.environ, **(env or {})})
    return r.stdout


def make_repo(path: Path, subjects: list[str]) -> Path:
    path.mkdir(parents=True)
    git(path, "init", "-q")
    git(path, "config", "user.name", "Test Builder")
    git(path, "config", "user.email", "builder@example.invalid")
    git(path, "config", "commit.gpgsign", "false")
    for i, s in enumerate(subjects):
        stamp = f"2026-11-{10 + i:02d}T10:00:00+05:30"
        git(path, "commit", "-q", "--allow-empty", "--no-verify", "-m", s,
            env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
    return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    led = E.Ledger(tmp_path / "ledger", data)
    plan = FakePlan()
    inputs = {"work_repos": []}
    monkeypatch.setattr(R, "_LEDGER", [led])
    monkeypatch.setattr(R, "_inputs", lambda: inputs)
    monkeypatch.setattr(R, "_today", lambda: TODAY)
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=plan), None)
    return SimpleNamespace(c=TestClient(app), led=led, data=data, plan=plan, inputs=inputs, tmp=tmp_path)


def no_words(answer: dict) -> None:
    assert not WORDS.search(json.dumps(answer)), answer


def file_line(env, rel="certs/course.pdf", **kw):
    p = env.data / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"%PDF-1.4 invented")
    body = {"kind": "certificate", "title": "An invented course", "file": rel, **kw}
    r = env.c.post(B, json=body)
    assert r.status_code == 200, r.text
    return r.json()["item"], p


# ------------------------------------------------------------------ K-01
def test_an_empty_ledger_is_waiting_and_counts_nothing(env):
    r = env.c.get(B).json()
    assert r["state"] == "waiting" and r["reason"] == "No evidence yet." and r["source"]
    assert r["items"] == [] and r["count"] == 0
    assert set(r["totals"]) == set(E.KINDS) and all(v == {"lines": 0, "hard": 0} for v in r["totals"].values())
    no_words(r)


def test_lines_come_newest_first_with_filters_and_totals(env):
    env.c.post(B, json={"kind": "artefact", "title": "A board photo set", "link": "https://example.org/a", "at": "2026-11-01",
                        "node_ids": ["electronics"]})
    env.c.post(B, json={"kind": "test", "title": "Quiz two", "link": "http://example.org/q", "at": "2026-11-20"})
    file_line(env, at="2026-11-10", node_ids=["electronics"])
    r = env.c.get(B).json()
    assert r["state"] == "live" and [i["at"] for i in r["items"]] == ["2026-11-20", "2026-11-10", "2026-11-01"]
    assert all(i["hard"] for i in r["items"]) and r["count"] == 3
    assert r["totals"]["artefact"] == {"lines": 1, "hard": 1} and r["totals"]["certificate"] == {"lines": 1, "hard": 1}
    it = r["items"][1]
    assert set(it) >= {"id", "at", "kind", "node_ids", "title", "link", "file", "source", "hard", "removed"}
    assert it["file"] == "certs/course.pdf" and it["link"] is None and it["source"] == "typed"
    assert [i["kind"] for i in env.c.get(B, params={"node": "electronics"}).json()["items"]] == ["certificate", "artefact"]
    assert [i["kind"] for i in env.c.get(B, params={"kind": "test"}).json()["items"]] == ["test"]
    got = env.c.get(B, params={"from": "2026-11-05", "to": "2026-11-15"}).json()["items"]
    assert [i["at"] for i in got] == ["2026-11-10"]
    none = env.c.get(B, params={"kind": "witness"}).json()
    assert none["state"] == "live" and none["items"] == [] and "No line matches" in none["reason"]
    assert env.c.get(B, params={"kind": "rumour"}).status_code == 400
    assert env.c.get(B, params={"from": "2026-11-20", "to": "2026-11-01"}).status_code == 400
    assert env.c.get(B, params={"from": "yesterday"}).status_code == 400
    no_words(r)


# ------------------------------------------------------------------ K-02
@pytest.mark.parametrize("body, part", [
    ({"kind": "artefact", "title": "No proof at all"}, "link or a file"),
    ({"kind": "artefact", "title": "Empty both", "link": "", "file": ""}, "link or a file"),
    ({"kind": "artefact", "title": "Wrong scheme", "link": "ftp://example.org/x"}, "http"),
    ({"kind": "artefact", "title": "Script", "link": "javascript:alert(1)"}, "http"),
    ({"kind": "artefact", "title": "No host", "link": "https://"}, "http"),
    ({"kind": "artefact", "title": "x" * 201, "link": "https://example.org/x"}, "200"),
    ({"kind": "artefact", "title": "   ", "link": "https://example.org/x"}, "title"),
    ({"kind": "rumour", "title": "Unknown kind", "link": "https://example.org/x"}, "kind"),
    ({"title": "No kind", "link": "https://example.org/x"}, "kind"),
    ({"kind": "artefact", "title": "Future", "link": "https://example.org/x", "at": "2026-11-28"}, "future"),
    ({"kind": "artefact", "title": "Bad date", "link": "https://example.org/x", "at": "2026-02-30"}, "date"),
    ({"kind": "artefact", "title": "Bad nodes", "link": "https://example.org/x", "node_ids": ["a/../b"]}, "node"),
    ({"kind": "artefact", "title": "Missing", "file": "certs/not-there.pdf"}, "no file"),
    ({"kind": "artefact", "title": "Network", "file": "\\\\remote-host\\share\\x.pdf"}, "network"),
    ({"kind": "artefact", "title": "Network fwd", "file": "//remote-host/share/x.pdf"}, "network"),
    ({"kind": "artefact", "title": "Device", "file": "\\\\.\\PhysicalDrive0"}, "network"),
    ({"kind": "artefact", "title": "Stream", "file": "certs/course.pdf:hidden"}, "plain file"),
])
def test_every_refusal_of_k02_is_400_and_files_nothing(env, body, part):
    r = env.c.post(B, json=body)
    assert r.status_code == 400 and part.lower() in r.json()["detail"].lower(), r.text
    assert not env.led.path.exists() or env.led.lines()[0] == []


def test_a_file_outside_the_data_folder_is_refused_even_by_dots_or_absolute_path(env):
    outside = env.tmp / "elsewhere.pdf"
    outside.write_bytes(b"invented")
    for f in (str(outside), "../elsewhere.pdf"):
        r = env.c.post(B, json={"kind": "certificate", "title": "Outside", "file": f})
        assert r.status_code == 400 and "private data folder" in r.json()["detail"], r.text
    (env.data / "adir").mkdir()
    assert "folder" in env.c.post(B, json={"kind": "artefact", "title": "Dir", "file": "adir"}).json()["detail"]
    assert env.c.post(B, json="not a dict").status_code == 400


def test_a_link_inside_the_data_folder_that_points_out_is_refused(env):
    outside = env.tmp / "secret.txt"
    outside.write_text("invented")
    link = env.data / "looks-inside.txt"
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip("this account may not create symbolic links")
    r = env.c.post(B, json={"kind": "artefact", "title": "Through a link", "file": "looks-inside.txt"})
    assert r.status_code == 400 and "private data folder" in r.json()["detail"]


def test_a_file_is_stored_relative_and_an_absolute_path_inside_is_accepted(env):
    p = env.data / "proof" / "photo.png"
    p.parent.mkdir()
    p.write_bytes(b"invented")
    r = env.c.post(B, json={"kind": "artefact", "title": "Absolute inside", "file": str(p)}).json()
    assert r["state"] == "live" and r["item"]["file"] == "proof/photo.png" and r["item"]["hard"] is True
    raw = env.led.path.read_text(encoding="utf-8")
    assert str(env.data) not in raw and str(env.tmp) not in raw


def test_hard_is_false_when_the_file_is_gone(env):
    item, p = file_line(env)
    assert item["hard"] is True
    p.unlink()
    r = env.c.get(B).json()
    assert r["items"][0]["hard"] is False and r["totals"]["certificate"] == {"lines": 1, "hard": 0}
    assert "0 of them hard" in r["reason"]


# ------------------------------------------------------------------ K-03
def test_removal_lowers_the_counts_and_the_line_stays_on_file(env):
    item, _ = file_line(env)
    env.c.post(B, json={"kind": "artefact", "title": "Keep me", "link": "https://example.org/k"})
    d = env.c.delete(f"{B}/{item['id']}")
    assert d.status_code == 200 and d.json()["item"]["removed"] is True
    assert "An invented course" in d.json()["reason"] and "stays on file" in d.json()["reason"]
    r = env.c.get(B).json()
    assert r["count"] == 1 and r["totals"]["certificate"] == {"lines": 0, "hard": 0}
    gone = [i for i in r["items"] if i["id"] == item["id"]]
    assert gone and gone[0]["removed"] is True and gone[0]["removed_on"] == TODAY
    raw = env.led.path.read_text(encoding="utf-8").splitlines()
    assert any(json.loads(x)["id"] == item["id"] and json.loads(x)["op"] == "add" for x in raw)
    assert any(json.loads(x)["op"] == "remove" for x in raw)
    again = env.c.delete(f"{B}/{item['id']}")
    assert again.status_code == 200 and "already removed" in again.json()["reason"]
    assert len(env.led.path.read_text(encoding="utf-8").splitlines()) == len(raw)
    env.c.delete(f"{B}/{r['items'][0]['id'] if r['items'][0]['id'] != item['id'] else r['items'][1]['id']}")
    assert env.c.get(B).json()["state"] == "waiting"


@pytest.mark.parametrize("eid", ["e-0000000000000000", "nope", "e-..%2F..%2Fsecret", "..%5C..%5Cwin.ini", "c-" + "f" * 15 + "g",
                                 "E-0123456789ABCDEF", "%00"])
def test_a_hostile_or_unknown_id_in_the_url_is_404(env, eid):
    env.c.post(B, json={"kind": "artefact", "title": "One", "link": "https://example.org/1"})
    r = env.c.delete(f"{B}/{eid}")
    assert r.status_code in (404, 405), r.text      # a path that no longer names this route is not a route
    assert env.c.get(B).json()["count"] == 1


# ------------------------------------------------------------------ K-04
def test_commits_import_once_and_a_second_run_adds_nothing(env):
    repo = make_repo(env.tmp / "repos" / "alpha", ["add the reader", "fix the off by one", "write the tests"])
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")      # pushed: only a pushed commit gets a link
    env.inputs["work_repos"] = [{"path": str(repo), "name": "alpha", "url": "https://example.org/u/alpha"}]
    r = env.c.post(f"{B}/import-commits", json={}).json()
    assert r["state"] == "live" and r["added"] == 3 and r["already"] == 0
    assert r["repos"] == [{"name": "alpha", "commits": 3, "reason": r["repos"][0]["reason"]}]
    second = env.c.post(f"{B}/import-commits", json={"repos": ["alpha"]}).json()
    assert second["added"] == 0 and second["already"] == 3
    items = env.c.get(B, params={"kind": "commit"}).json()["items"]
    assert len(items) == 3 and {i["source"] for i in items} == {"git"}
    assert [i["title"] for i in items] == ["write the tests", "fix the off by one", "add the reader"]
    shas = git(repo, "log", "--format=%H").split()
    assert {i["sha"] for i in items} == set(shas) and all(i["hard"] for i in items)
    assert items[0]["link"] == f"https://example.org/u/alpha/commit/{shas[0]}"
    assert {i["id"] for i in items} == {E.commit_id("alpha", s) for s in shas}
    # the import changed nothing in the repository
    assert git(repo, "status", "--porcelain") == "" and git(repo, "log", "--format=%H").split() == shas
    no_words(r)


def test_a_removed_commit_is_not_brought_back_by_the_next_import(env):
    repo = make_repo(env.tmp / "beta", ["one"])
    env.inputs["work_repos"] = [{"path": str(repo), "name": "beta", "url": None}]
    first = env.c.post(f"{B}/import-commits").json()
    assert first["added"] == 1 and "soft" in first["repos"][0]["reason"]
    line = env.c.get(B).json()["items"][0]
    assert line["hard"] is False and line["link"] is None
    env.c.delete(f"{B}/{line['id']}")
    assert env.c.post(f"{B}/import-commits").json()["added"] == 0


def test_a_path_that_is_not_a_repository_is_a_reason_not_an_error(env, tmp_path):
    plain = tmp_path / "just-a-folder"
    plain.mkdir()
    empty = tmp_path / "empty-repo"
    empty.mkdir()
    git(empty, "init", "-q")
    good = make_repo(tmp_path / "gamma", ["only one"])
    env.inputs["work_repos"] = [
        {"path": str(plain), "name": "plain", "url": None},
        {"path": str(tmp_path / "missing"), "name": "missing", "url": None},
        {"path": "\\\\remote-host\\share\\repo", "name": "remote", "url": None},
        {"path": "relative\\repo", "name": "relative", "url": None},
        {"path": str(empty), "name": "empty", "url": None},
        {"path": str(good), "name": "gamma", "url": None},
    ]
    r = env.c.post(f"{B}/import-commits").json()
    assert r["state"] == "live" and r["added"] == 1
    why = {x["name"]: x["reason"] for x in r["repos"]}
    assert "not a git repository" in why["plain"] and "no folder" in why["missing"]
    assert "network" in why["remote"] and "full path" in why["relative"] and "no commits" in why["empty"]
    assert {x["name"]: x["commits"] for x in r["repos"]}["gamma"] == 1


@pytest.mark.parametrize("body", [{"repos": ["..\\..\\Windows"]}, {"repos": ["C:\\"]}, {"repos": ["alpha; rm -rf /"]},
                                  {"repos": ["nobody"]}])
def test_a_hostile_repository_name_is_404_and_runs_no_git(env, body, monkeypatch):
    repo = make_repo(env.tmp / "alpha", ["one"])
    env.inputs["work_repos"] = [{"path": str(repo), "name": "alpha", "url": None}]
    started = []
    monkeypatch.setattr(E.subprocess, "run", lambda *a, **k: started.append(a) or (_ for _ in ()).throw(AssertionError("git ran")))
    r = env.c.post(f"{B}/import-commits", json=body)
    assert r.status_code == 404 and started == []


def test_import_refuses_bad_bodies_says_waiting_without_repos_and_is_409_while_busy(env):
    assert env.c.post(f"{B}/import-commits").json()["state"] == "waiting"
    env.inputs["work_repos"] = [{"path": str(env.tmp), "name": "t", "url": None}]
    assert env.c.post(f"{B}/import-commits", json={"repos": "t"}).status_code == 400
    assert env.c.post(f"{B}/import-commits", json=[1]).status_code == 400
    assert env.c.post(f"{B}/import-commits", json={"repos": [f"r{i}" for i in range(11)]}).status_code == 400
    env.led._import.acquire()
    try:
        assert env.c.post(f"{B}/import-commits").status_code == 409
    finally:
        env.led._import.release()


def test_only_git_log_and_rev_parse_are_ever_started(env, monkeypatch):
    repo = make_repo(env.tmp / "delta", ["one", "two"])
    env.inputs["work_repos"] = [{"path": str(repo), "name": "delta", "url": None}]
    seen, real = [], subprocess.run

    def spy(args, **k):
        seen.append(list(args))
        return real(args, **k)
    monkeypatch.setattr(E.subprocess, "run", spy)
    assert env.c.post(f"{B}/import-commits").json()["added"] == 2
    verbs = [a[a.index("mailmap.blob=") + 1] for a in seen]
    assert seen and set(verbs) <= {"log", "rev-parse"}
    with pytest.raises(PermissionError):
        E._git_runner([])(["git", "push"], str(repo))


# ------------------------------------------------------------------ the file
def test_a_corrupt_line_is_skipped_and_reported_and_kept_on_file(env):
    env.c.post(B, json={"kind": "artefact", "title": "Good one", "link": "https://example.org/g"})
    with open(env.led.path, "a", encoding="utf-8") as f:
        f.write("{not json\n")
        f.write(json.dumps({"v": 99, "op": "add", "id": "e-" + "1" * 16}) + "\n")
        f.write(json.dumps({"v": 1, "op": "add", "id": "e-" + "2" * 16, "kind": "artefact"}) + "\n")
    r = env.c.get(B).json()
    assert r["state"] == "live" and r["count"] == 1 and len(r["skipped"]) == 3
    assert [s["line"] for s in r["skipped"]] == [2, 3, 4] and "left out" in r["reason"]
    env.c.post(B, json={"kind": "test", "title": "After the bad lines", "link": "https://example.org/t"})
    raw = env.led.path.read_text(encoding="utf-8").splitlines()
    assert raw[1] == "{not json" and len(raw) == 5
    assert env.c.get(B).json()["count"] == 2


def test_every_line_carries_the_schema_version_and_no_temporary_file_is_left(env):
    env.c.post(B, json={"kind": "witness", "title": "A teacher saw the demo", "link": "https://example.org/w"})
    rec = json.loads(env.led.path.read_text(encoding="utf-8").splitlines()[0])
    assert rec["v"] == E.SCHEMA_VERSION and rec["op"] == "add" and rec["source"] == "typed"
    assert not env.led.path.with_name("evidence.jsonl.tmp").exists()


# ------------------------------------------------------------------ xp_check
def test_xp_check_prints_both_numbers_and_changes_neither(env):
    events = [
        {"kind": "cert", "xp": 150, "verified": True, "date": "2026-11-01"},
        {"kind": "cert", "xp": 150, "verified": False, "date": "2026-11-02"},
        {"kind": "ship", "node": "n1", "xp": 300, "verified": True, "date": "2026-11-03"},
        {"kind": "project", "node": "n2", "xp": 200, "verified": False, "date": "2026-11-04"},
        {"kind": "log", "minutes": 60, "xp": 20, "date": "2026-11-04"},
    ]
    env.plan.st = {"events": events, "xp": 820, "archive": {"count": {"cert": 2}}}
    before = copy.deepcopy(env.plan.st)
    rules = copy.deepcopy({k: v[0] for k, v in E.ww_engines.EVIDENCE_RULES.items()})
    x = env.c.get(B).json()["xp_check"]
    assert x["plan_xp"] == 800 and x["evidenced_xp"] == 150 + 200 and x["records_without_proof"] == 2
    assert "800" in x["reason"] and "350" in x["reason"] and "2 older records" in x["reason"]
    assert env.plan.st == before
    assert {k: v[0] for k, v in E.ww_engines.EVIDENCE_RULES.items()} == rules


def test_xp_check_without_a_plan_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(R, "_LEDGER", [E.Ledger(tmp_path / "l", tmp_path)])
    monkeypatch.setattr(R, "_inputs", lambda: {"work_repos": []})
    app = FastAPI()
    R.register(app, SimpleNamespace(), None)
    x = TestClient(app).get(B).json()["xp_check"]
    assert x["plan_xp"] is None and x["evidenced_xp"] is None and "not up" in x["reason"]


# ------------------------------------------------------------------ review of 2026-11-27
def _signed_commit(repo: Path, subject: str) -> str:
    """A commit carrying a gpgsig header (any text), written straight into the object store: enough to make
    `git log` verify it when the repository asks for log.showSignature."""
    tree = git(repo, "rev-parse", "HEAD^{tree}").strip()
    parent = git(repo, "rev-parse", "HEAD").strip()
    body = (f"tree {tree}\nparent {parent}\nauthor T <t@example.invalid> 1764000000 +0000\n"
            f"committer T <t@example.invalid> 1764000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n"
            f" -----END PGP SIGNATURE-----\n\n{subject}\n").encode()
    sha = subprocess.run(["git", "hash-object", "-t", "commit", "-w", "--stdin"], cwd=str(repo), input=body,
                         capture_output=True, check=True).stdout.decode().strip()
    git(repo, "update-ref", "HEAD", sha)
    return sha


def test_a_repository_config_cannot_make_git_log_start_a_program(env):
    repo = make_repo(env.tmp / "hostile", ["plain"])
    _signed_commit(repo, "signed")
    marker = env.tmp / "ran.txt"
    prog = env.tmp / "evil.cmd"
    prog.write_text(f'@echo off\r\necho ran > "{marker}"\r\n')
    git(repo, "config", "log.showSignature", "true")            # this repository's own config only
    git(repo, "config", "gpg.program", str(prog).replace("\\", "/"))
    env.inputs["work_repos"] = [{"path": str(repo), "name": "hostile", "url": None}]
    r = env.c.post(f"{B}/import-commits").json()
    assert r["added"] == 2 and not marker.exists()


def test_git_variables_of_the_app_cannot_point_git_at_another_repository(env, monkeypatch):
    other = make_repo(env.tmp / "other", ["from the other one", "and another"])
    repo = make_repo(env.tmp / "mine", ["mine"])
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))
    env.inputs["work_repos"] = [{"path": str(repo), "name": "mine", "url": None}]
    r = env.c.post(f"{B}/import-commits").json()
    assert r["added"] == 1 and [i["title"] for i in env.c.get(B).json()["items"]] == ["mine"]


def test_a_far_future_author_date_is_one_skipped_commit_not_a_failed_import(env):
    repo = make_repo(env.tmp / "future", ["plain"])
    tree = git(repo, "rev-parse", "HEAD^{tree}").strip()
    parent = git(repo, "rev-parse", "HEAD").strip()
    body = (f"tree {tree}\nparent {parent}\nauthor T <t@example.invalid> 99999999999 +0000\n"
            f"committer T <t@example.invalid> 1764000000 +0000\n\nfar future\n").encode()
    sha = subprocess.run(["git", "hash-object", "-t", "commit", "-w", "--stdin"], cwd=str(repo), input=body,
                         capture_output=True, check=True).stdout.decode().strip()
    git(repo, "update-ref", "HEAD", sha)
    good = make_repo(env.tmp / "good", ["fine"])
    env.inputs["work_repos"] = [{"path": str(repo), "name": "future", "url": None},
                                {"path": str(good), "name": "good", "url": None}]
    r = env.c.post(f"{B}/import-commits")
    assert r.status_code == 200, r.text
    assert r.json()["added"] >= 2


def test_an_unpushed_commit_gets_no_link_and_stays_soft(env):
    repo = make_repo(env.tmp / "local", ["pushed one", "only on this laptop"])
    shas = git(repo, "log", "--format=%H").split()
    git(repo, "update-ref", "refs/remotes/origin/main", shas[1])        # the remote has the older commit only
    env.inputs["work_repos"] = [{"path": str(repo), "name": "local", "url": "https://example.org/u/local"}]
    r = env.c.post(f"{B}/import-commits").json()
    assert r["added"] == 2
    by = {i["sha"]: i for i in env.c.get(B).json()["items"]}
    assert by[shas[1]]["hard"] is True and by[shas[1]]["link"].endswith(shas[1])
    assert by[shas[0]]["hard"] is False and by[shas[0]]["link"] is None


@pytest.mark.parametrize("link", ["https://@/", "https://:443/", "https://user:pw@example.org/x",
                                  "https://example.org/\x00x", "https://example.org/\x7f"])
def test_a_link_without_a_site_or_with_a_password_or_a_control_character_is_400(env, link):
    r = env.c.post(B, json={"kind": "artefact", "title": "Odd link", "link": link})
    assert r.status_code == 400, r.text


def test_a_hand_edited_line_with_an_empty_host_is_soft(env):
    env.led.root.mkdir(parents=True, exist_ok=True)
    env.led.path.write_text(json.dumps({"v": 1, "op": "add", "id": "e-" + "3" * 16, "at": "2026-11-01", "kind": "artefact",
                                        "title": "Edited", "link": "https://@/", "file": None}) + "\n", encoding="utf-8")
    assert env.c.get(B).json()["items"][0]["hard"] is False


def test_a_reader_holding_the_ledger_does_not_fail_a_write(env, monkeypatch):
    env.c.post(B, json={"kind": "artefact", "title": "First", "link": "https://example.org/1"})
    real, calls = E.os.replace, []

    def flaky(a, b):      # what Windows answers while another handle has the file open
        calls.append(1)
        if len(calls) == 1:
            raise PermissionError(5, "Access is denied")
        return real(a, b)
    monkeypatch.setattr(E.os, "replace", flaky)
    r = env.c.post(B, json={"kind": "artefact", "title": "Second", "link": "https://example.org/2"})
    assert r.status_code == 200, r.text
    assert env.c.get(B).json()["count"] == 2


def test_a_broken_plan_archive_does_not_take_k01_down(env):
    env.plan.st = {"events": [{"kind": "cert", "xp": 150, "verified": True}], "archive": {"count": {"cert": "many"}}}
    r = env.c.get(B)
    assert r.status_code == 200 and r.json()["xp_check"]["plan_xp"] == 150
    env.plan.st = {"events": [], "archive": {"count": ["cert"]}}
    assert env.c.get(B).status_code == 200


# ------------------------------------------------------------------ integrator's follow-up of 2026-11-27
@pytest.mark.parametrize("plant, part", [
    ("include", "include"), ("includeif", "include"), ("alternates", "alternates"), ("bigconfig", "256 KB"),
])
def test_a_repository_that_could_send_git_elsewhere_is_a_reason_and_runs_no_git(env, monkeypatch, plant, part):
    repo = make_repo(env.tmp / "odd", ["one"])
    good = make_repo(env.tmp / "fine", ["two"])
    cfg = repo / ".git" / "config"
    if plant == "include":
        cfg.write_text(cfg.read_text() + "[Include]\n\tpath = //remote-host/share/cfg\n")
    elif plant == "includeif":
        cfg.write_text(cfg.read_text() + '[includeIf "gitdir:~/"]\n\tpath = //remote-host/share/cfg\n')
    elif plant == "alternates":
        (repo / ".git" / "objects" / "info").mkdir(parents=True, exist_ok=True)
        (repo / ".git" / "objects" / "info" / "alternates").write_text("//remote-host/share/objects\n")
    else:
        cfg.write_text(cfg.read_text() + "#" + "x" * (256 * 1024) + "\n")
    env.inputs["work_repos"] = [{"path": str(repo), "name": "odd", "url": None},
                                {"path": str(good), "name": "fine", "url": None}]
    seen, real = [], subprocess.run

    def spy(args, **k):
        seen.append(k.get("cwd"))
        return real(args, **k)
    monkeypatch.setattr(E.subprocess, "run", spy)
    r = env.c.post(f"{B}/import-commits")
    assert r.status_code == 200, r.text
    why = {x["name"]: x for x in r.json()["repos"]}
    assert why["odd"]["commits"] == 0 and part.lower() in why["odd"]["reason"].lower(), why
    assert why["fine"]["commits"] == 1 and str(repo) not in seen


def test_a_dot_git_file_is_refused_and_names_the_main_checkout(env):
    main = make_repo(env.tmp / "main", ["one"])
    linked = env.tmp / "linked"
    linked.mkdir()
    (linked / ".git").write_text(f"gitdir: {(main / '.git').as_posix()}\n")
    env.inputs["work_repos"] = [{"path": str(linked), "name": "linked", "url": None}]
    row = env.c.post(f"{B}/import-commits").json()["repos"][0]
    assert row["commits"] == 0 and "main checkout" in row["reason"]


def test_the_runner_never_reads_a_mailmap_the_repository_names(env, tmp_path):
    repo = make_repo(tmp_path / "mm", ["one"])
    mm = tmp_path / "outside.mailmap"
    mm.write_text("Mapped Name <builder@example.invalid>\n")
    git(repo, "config", "mailmap.file", mm.as_posix())
    # %aN always applies a mailmap it has read, whatever log.mailmap says, so a name that comes back unmapped
    # proves the runner never read the file.
    out = E._git_runner([])(["git", "log", "--format=%aN"], str(repo))
    assert out.strip() == "Test Builder", out
    assert git(repo, "log", "--format=%aN").strip() == "Mapped Name"      # the plain git call does read it


def test_the_ledger_folder_is_no_proof_file(tmp_path):
    data = tmp_path / "data"
    led = E.Ledger(data / "evidence", data)
    led.add({"kind": "artefact", "title": "First", "link": "https://example.org/1"}, TODAY)
    for f in ("evidence/evidence.jsonl", str(led.path)):
        with pytest.raises(ValueError, match="ledger"):
            led.add({"kind": "artefact", "title": "The ledger itself", "file": f}, TODAY)
    (data / "evidence" / "other.txt").write_text("invented")
    with pytest.raises(ValueError, match="ledger"):
        led.add({"kind": "artefact", "title": "Beside it", "file": "evidence/other.txt"}, TODAY)


def test_a_typed_line_repeated_exactly_answers_the_first_and_writes_nothing(env):
    body = {"kind": "artefact", "title": "Same  proof", "link": "https://example.org/s"}
    first = env.c.post(B, json=body).json()["item"]
    size = env.led.path.stat().st_size
    again = env.c.post(B, json={**body, "title": "Same proof"})
    assert again.status_code == 200 and again.json()["item"]["id"] == first["id"]
    assert env.led.path.stat().st_size == size
    other = env.c.post(B, json={**body, "kind": "witness"}).json()["item"]
    assert other["id"] != first["id"] and env.c.get(B).json()["count"] == 2


def test_a_repeat_of_a_removed_line_is_filed_again_and_other_nodes_still_match(tmp_path):
    # the match is kind, title, link and file of a line that is not removed (review of 2026-11-27): node_ids are not
    # part of it, so a retry with other nodes answers the first line; a removed line never matches
    data = tmp_path / "data"
    led = E.Ledger(data / "evidence", data)
    body = {"kind": "artefact", "title": "Same proof", "link": "https://example.org/s"}
    first = led.add(body, TODAY)
    size = led.path.stat().st_size
    assert led.add({**body, "node_ids": ["n1"]}, TODAY)["id"] == first["id"] and led.path.stat().st_size == size
    led.remove(first["id"], TODAY)
    again = led.add(body, TODAY)
    assert again["id"] != first["id"] and len(led.lines()[0]) == 2
    assert led.add({**body, "link": "https://example.org/other"}, TODAY)["id"] != again["id"]


def test_the_package_files_avoid_the_banned_words():
    here = Path(E.__file__).parent
    for f in (here / "ww_evidence.py", here / "routes_ww_evidence.py"):
        assert not WORDS.search(f.read_text(encoding="utf-8")), f.name

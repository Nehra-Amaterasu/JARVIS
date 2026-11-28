"""A list of questions reads each question file once, however long the page is.

Measured on the owner's real store on 28 Nov 2026 (89 papers, 889 questions): a page of 50 questions took 1.8 to 2.2 s,
because the crop of each question was found by reading every question file again. The screens ask for several such
lists at once, so the app sat at 100 to 195 percent of a core and stopped answering."""
from __future__ import annotations

import hashlib

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq as R
from jarvis_app.ww_pyq.store import Store

P = "/api/mission/pyq"
PAPERS = 12
PER_PAPER = 5


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    for n in range(PAPERS):
        pid = st.add_paper({"sha256": hashlib.sha256(f"invented {n}".encode()).hexdigest(), "title": f"Invented paper {n}", "kind": "pdf",
                            "subject": "signals", "pages": 1})
        st.add_questions(pid, [{"text": f"Invented question {n}.{k}: state the sampling theorem.", "marks": 2} for k in range(PER_PAPER)])
    monkeypatch.setattr(R, "_store", lambda: st)
    app = FastAPI()
    R.register(app, None, None)
    reads = {"n": 0}
    real = Store._questions_of

    def counted(self, pid):
        reads["n"] += 1
        return real(self, pid)

    monkeypatch.setattr(Store, "_questions_of", counted)
    return TestClient(app), st, reads


def test_a_page_of_questions_reads_each_file_once(env):
    c, st, reads = env
    r = c.get(f"{P}/questions", params={"limit": 50})
    assert r.status_code == 200 and len(r.json()["items"]) == 50
    assert all("has_crop" in q for q in r.json()["items"])
    assert reads["n"] <= PAPERS, f"{reads['n']} file reads for one page over {PAPERS} papers"


def test_one_paper_reads_its_own_file_and_not_every_other_per_question(env):
    c, st, reads = env
    pid = st.list_papers()[0]["id"]
    reads["n"] = 0
    r = c.get(f"{P}/papers/{pid}")
    assert r.status_code == 200
    assert reads["n"] <= 3, f"{reads['n']} file reads to show one paper"


def test_crop_path_of_agrees_with_crop_path(env):
    _, st, _ = env
    q = st.list_questions()[0]
    assert st.crop_path_of(q) == st.crop_path(q["id"]) is None


def test_a_second_list_opens_no_file_and_an_outside_write_is_seen(env, monkeypatch):
    import json
    import os
    from pathlib import Path

    c, st, _ = env
    assert c.get(f"{P}/questions", params={"limit": 50}).status_code == 200
    opened = {"n": 0}
    real = Path.read_text

    def counted(self, *a, **k):
        if self.suffix == ".json":
            opened["n"] += 1
        return real(self, *a, **k)

    monkeypatch.setattr(Path, "read_text", counted)
    first = c.get(f"{P}/questions", params={"limit": 50}).json()["items"]
    assert opened["n"] == 0, f"{opened['n']} files opened again though nothing changed"
    # another process rewrites one question file: the next read must show it
    q = first[0]
    f = st._qpath(q["paper_id"])
    rows = json.loads(real(f, encoding="utf-8"))
    rows[0]["text"] = "Invented question, changed from outside."
    f.write_text(json.dumps(rows), encoding="utf-8")
    os.utime(f, ns=(f.stat().st_atime_ns, f.stat().st_mtime_ns + 1_000_000))
    again = c.get(f"{P}/questions", params={"paper": q["paper_id"]}).json()["items"]
    assert any(x["text"] == "Invented question, changed from outside." for x in again)


def test_rows_from_the_store_are_the_callers_own(env):
    _, st, _ = env
    a = st.list_questions()
    a[0]["text"] = "changed in memory only"
    assert st.list_questions()[0]["text"] != "changed in memory only"

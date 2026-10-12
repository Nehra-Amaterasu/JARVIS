"""/api/library end to end: ingest a folder of invented notes, list, ask, forget.

The library under test lives in a temp folder, runs keyword-only (no embedder, as it
would on a PC without bge-small) and answers through a fake LLM, so nothing here
loads a model, calls Ollama, or touches data/.
"""
import os
import tempfile
import threading
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app.paths import YAADASH, ensure_jarvis_importable
from jarvis_app.security import Guard
from jarvis_app.server import create_app

os.environ["JARVIS_LIBRARY_DIR"] = tempfile.mkdtemp(prefix="jarvis-library-app-")
ensure_jarvis_importable()
import library  # noqa: E402

TOKEN = "test-token-library"


def fake_llm(system, user):
    assert library.NOT_IN_NOTES in system
    return "Pin 7 is ground and pin 14 is Vcc [1]."


fake_llm.model_name = "fake (test)"


def write_notes(folder: Path) -> Path:
    import fitz
    folder.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for text in ("Flip-flops sample their input at the clock edge. Setup time is how long data must be stable before the edge.",
                 "Hold time is how long the data must stay stable after the clock edge. Violations cause metastability."):
        doc.new_page().insert_textbox(fitz.Rect(50, 50, 550, 800), text, fontsize=11)
    doc.save(str(folder / "timing.pdf"))
    (folder / "lab.md").write_text("# Experiment 1\nOn the 7400 chip pin 7 is ground and pin 14 is Vcc.\n", encoding="utf-8")
    (folder / "photo.png").write_bytes(b"\x89PNG")
    return folder


@pytest.fixture
def client(tmp_path):
    guard = Guard(8778, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    app.state.library = library.Library(tmp_path / "lib", embedder=None, llm=fake_llm)
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_this_checkout_is_what_is_tested():
    assert Path(library.__file__).resolve().parent == YAADASH.resolve()


def test_an_empty_library(client):
    v = client.get("/api/library").json()
    assert v["documents"] == 0 and v["docs"] == [] and v["job"] == {"state": "idle"}
    assert v["mode"] == "keyword-only" and v["embedder"]["ready"] is False
    assert client.get("/api/library", headers={"X-Jarvis-Token": "nope"}).status_code == 401


@pytest.mark.parametrize("path,status", [
    ("notes", 400),                             # not absolute
    ("C:\\definitely\\not\\here", 400),
    ("C:\\", 400),                              # a whole drive
    ("", 422),
])
def test_ingest_refuses_bad_paths(client, path, status):
    body = {"path": path} if path else {}
    assert client.post("/api/library/ingest", json=body).status_code == status


def test_ingest_refuses_unsupported_files(client, tmp_path):
    notes = write_notes(tmp_path / "notes")
    r = client.post("/api/library/ingest", json={"path": str(notes / "photo.png")})
    assert r.status_code == 400 and "PDF" in r.json()["detail"]


def test_ingest_a_folder_then_list_ask_and_forget(client, tmp_path):
    notes = write_notes(tmp_path / "notes")
    r = client.post("/api/library/ingest", json={"path": f'"{notes}"'})     # Explorer's "Copy as path"
    assert r.status_code == 200 and r.json()["state"] == "running"
    job = client.app.state.library_jobs.wait()
    assert job["state"] == "done" and job["counts"] == {"added": 2}

    v = client.get("/api/library").json()
    docs = {d["file"]: d for d in v["docs"]}
    assert set(docs) == {"timing.pdf", "lab.md"} and docs["timing.pdf"]["pages"] == 2
    assert v["documents"] == 2 and v["job"]["state"] == "done"
    texts = [e["text"] for e in client.app.state.svc.bus.history()]
    assert any(t.startswith("Library: read timing.pdf — 2 pages") for t in texts)
    assert any("2 new or changed" in t for t in texts)

    a = client.post("/api/library/ask", json={"question": "Which pin of the 7400 is ground?"}).json()
    assert a["answer"].endswith("[1].") and a["used"] == [1] and not a["abstained"]
    assert a["sources"][0]["file"] == "lab.md" and a["sources"][0]["loc"] == "§ Experiment 1"
    assert a["llm"] == "fake (test)" and a["mode"] == "keyword-only"

    no = client.post("/api/library/ask", json={"question": "Who won the 2011 cricket world cup?"}).json()
    assert no["abstained"] and no["answer"] == library.NOT_IN_NOTES and no["used"] == []
    assert any("not in my notes" in e["text"] for e in client.app.state.svc.bus.history())

    doc_id = docs["lab.md"]["doc_id"]
    assert client.delete(f"/api/library/doc/{doc_id}").json() == {"ok": True}
    assert client.delete(f"/api/library/doc/{doc_id}").status_code == 404
    assert [d["file"] for d in client.get("/api/library").json()["docs"]] == ["timing.pdf"]


def test_reingesting_reports_unchanged(client, tmp_path):
    notes = write_notes(tmp_path / "notes")
    jobs = client.app.state.library_jobs
    client.post("/api/library/ingest", json={"path": str(notes)})
    jobs.wait()
    client.post("/api/library/ingest", json={"path": str(notes / "lab.md")})
    assert jobs.wait()["counts"] == {"unchanged": 1}


def test_one_ingest_at_a_time(client, tmp_path):
    notes = write_notes(tmp_path / "notes")
    lib = client.app.state.library
    gate = threading.Event()
    real = lib.ingest

    def slow(path, progress=None):
        gate.wait(10)
        return real(path, progress)
    lib.ingest = slow
    assert client.post("/api/library/ingest", json={"path": str(notes)}).status_code == 200
    r = client.post("/api/library/ingest", json={"path": str(notes)})
    assert r.status_code == 409 and "Already reading" in r.json()["detail"]
    assert client.get("/api/library/job").json()["state"] == "running"
    gate.set()
    assert client.app.state.library_jobs.wait()["state"] == "done"


def test_a_failed_ingest_is_reported(client, tmp_path):
    notes = write_notes(tmp_path / "notes")
    lib = client.app.state.library

    def broken(path, progress=None):
        raise OSError("disk went away")
    lib.ingest = broken
    client.post("/api/library/ingest", json={"path": str(notes)})
    job = client.app.state.library_jobs.wait()
    assert job["state"] == "failed" and "disk went away" in job["error"]


def test_ask_validation_and_a_model_that_is_down(client, tmp_path):
    assert client.post("/api/library/ask", json={"question": "  "}).status_code == 400
    assert client.post("/api/library/ask", json={"question": "x" * 600}).status_code == 400
    notes = write_notes(tmp_path / "notes")
    client.post("/api/library/ingest", json={"path": str(notes)})
    client.app.state.library_jobs.wait()

    def down(system, user):
        raise RuntimeError("local model unreachable (ConnectError)")
    client.app.state.library.llm = down
    a = client.post("/api/library/ask", json={"question": "What is hold time after the clock edge?", "k": 99}).json()
    assert a["answer"] is None and "unreachable" in a["llm_error"]
    assert a["sources"][0]["file"] == "timing.pdf" and a["sources"][0]["page"] == 2
    assert len(a["sources"]) <= 8


def test_without_an_injected_library_the_default_folder_is_used(tmp_path):
    guard = Guard(8779, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        v = c.get("/api/library").json()
    # JARVIS_LIBRARY_DIR (set above, a temp folder) — never data/yaadash/library in a test.
    assert Path(v["root"]) == Path(os.environ["JARVIS_LIBRARY_DIR"])

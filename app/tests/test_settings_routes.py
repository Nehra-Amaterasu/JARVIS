"""/api/settings and /api/imports end to end, against the real server and settings file.

Ollama, Microsoft's voice list, the browser and the GPU are replaced by fakes: nothing
here reaches the network, loads a model, or opens a window. Settings and imports land
in the test's own data folder (conftest), never in data/app.
"""
import io
import json
import time
import zipfile

import numpy as np
import pytest
from starlette.testclient import TestClient

from jarvis_app import imports, latency, modules
from jarvis_app import settings as st
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.transcripts import TranscriptStore

TOKEN = "test-token-settings"
GB = 10**9

MODELS = [
    {"name": "qwen3:4b-instruct-2507-q4_K_M", "size": int(2.50 * GB), "params": "4.0B", "family": "qwen3",
     "quant": "Q4_K_M", "capabilities": ["completion", "tools", "thinking"]},
    {"name": "qwen3:4b", "size": int(2.50 * GB), "params": "4.0B", "family": "qwen3", "quant": "Q4_K_M",
     "capabilities": ["completion", "tools", "thinking"]},
    {"name": "llama3.1:latest", "size": int(4.92 * GB), "params": "8.0B", "family": "llama", "quant": "Q4_K_M",
     "capabilities": ["completion", "tools"]},
    {"name": "dolphin-llama3:latest", "size": int(4.66 * GB), "params": "8B", "family": "llama", "quant": "Q4_0",
     "capabilities": ["completion"]},
    {"name": "nomic-embed-text:latest", "size": int(0.27 * GB), "params": "137M", "family": "nomic-bert",
     "quant": "F16", "capabilities": ["embedding"]},
    {"name": "llama3.2:1b", "size": int(1.32 * GB), "params": "1.2B", "family": "llama", "quant": "Q8_0",
     "capabilities": ["completion", "tools"]},
]


class FakeProc:
    """A JARVIS process that is 'running' (poll() is None) and goes nowhere."""
    pid = 4242

    def __init__(self):
        self.stdin = io.BytesIO()

    def poll(self):
        return None

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass

    kill = terminate


class FakeOllama:
    def __init__(self):
        self.models = [dict(m) for m in MODELS]
        self.ps = [{"name": "qwen3:4b-instruct-2507-q4_K_M", "size": int(3.31 * GB), "vram": int(3.31 * GB),
                    "expires_at": None}]
        self.dropped, self.loaded = [], []

    def drop(self, m):
        self.dropped.append(m)
        self.ps = [p for p in self.ps if p["name"] != m]
        return True

    def load(self, m, keep):
        self.loaded.append((m, keep))
        return True


@pytest.fixture
def ollama(monkeypatch):
    o = FakeOllama()
    monkeypatch.setattr(st, "ollama_models", lambda *a, **k: o.models)
    monkeypatch.setattr(st, "ollama_loaded", lambda *a, **k: o.ps)
    monkeypatch.setattr(modules, "preload", o.load)
    monkeypatch.setattr(modules, "unload", o.drop)
    return o


@pytest.fixture
def kokoro(tmp_path, monkeypatch):
    """An offline voice 'installed' in a temp folder: an empty model file and a voices
    file that is a real .npz with real Kokoro voice names."""
    d = tmp_path / "kokoro"
    d.mkdir()
    (d / "kokoro-v1.0.int8.onnx").write_bytes(b"onnx")
    with open(d / "voices-v1.0.bin", "wb") as f:
        np.savez(f, bm_george=np.zeros(1), bf_emma=np.zeros(1), am_michael=np.zeros(1), hm_psi=np.zeros(1))
    monkeypatch.setattr(st, "kokoro_dir", lambda: d)
    return d


@pytest.fixture
def client(ollama, monkeypatch, tmp_path):
    st.store.write({})                                       # each test starts from no settings
    monkeypatch.setattr(st, "_edge_live", lambda: (_ for _ in ()).throw(OSError("offline in tests")))
    monkeypatch.setattr(st, "kokoro_dir", lambda: tmp_path / "no-kokoro")
    monkeypatch.setattr(imports, "DOWNLOADS", tmp_path / "Downloads")
    monkeypatch.setattr(imports, "IMPORTS", tmp_path / "imports")
    opened = []
    monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
    guard = Guard(8778, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    svc = app.state.svc
    svc.modules.background = False                          # GPU work inline, no timers
    svc.core.transcripts = TranscriptStore(tmp_path / "transcripts", tmp_path / "reviews")   # this test's own
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.svc, c.opened, c.ollama = svc, opened, ollama
        yield c


# ------------------------------------------------------------------ the brain
def test_the_brain_list_says_what_each_model_can_do(client):
    v = client.get("/api/settings/brain").json()
    rows = {m["name"]: m for m in v["models"]}
    assert v["chosen"] == "qwen3:4b-instruct-2507-q4_K_M" and v["ollama"] is True
    assert rows["qwen3:4b-instruct-2507-q4_K_M"]["chosen"] and rows["qwen3:4b-instruct-2507-q4_K_M"]["loaded_gb"] == 3.31
    assert "embedding" in rows["nomic-embed-text:latest"]["why_not"]
    assert "tool calling" in rows["dolphin-llama3:latest"]["why_not"]
    assert rows["llama3.1:latest"]["why_not"] is None
    assert "CPU" in rows["llama3.1:latest"]["warn"] and rows["llama3.2:1b"]["warn"] is None   # 4.9 GB vs 1.3 GB
    assert "first token 30 to 98 s" in rows["qwen3:4b"]["note"]
    assert [m["name"] for m in v["models"]][-2:] == ["dolphin-llama3:latest", "nomic-embed-text:latest"]  # unusable last


def test_choosing_a_brain_persists_and_reaches_jarvis_at_his_next_start(client):
    r = client.post("/api/settings/brain", json={"model": "llama3.2:1b"})
    assert r.status_code == 200 and r.json()["chosen"] == "llama3.2:1b"
    assert json.loads(st.SETTINGS_PATH.read_text(encoding="utf-8"))["brain"]["model"] == "llama3.2:1b"
    env = {}
    for hook in client.svc.core.env_hooks:
        env.update(hook())
    assert env["JARVIS_BRAIN_MODEL"] == "llama3.2:1b" and env["JARVIS_SETTINGS"] == str(st.SETTINGS_PATH)


@pytest.mark.parametrize("model, code", [("dolphin-llama3:latest", 400), ("nomic-embed-text:latest", 400),
                                         ("not-installed:7b", 400)])
def test_a_brain_that_cannot_work_is_refused(client, model, code):
    r = client.post("/api/settings/brain", json={"model": model})
    assert r.status_code == code
    assert st.chosen_brain() == "qwen3:4b-instruct-2507-q4_K_M"


def test_without_ollama_nothing_can_be_chosen(client, monkeypatch):
    monkeypatch.setattr(st, "ollama_models", lambda *a, **k: None)
    assert client.get("/api/settings/brain").json()["ollama"] is False
    assert client.post("/api/settings/brain", json={"model": "llama3.2:1b"}).status_code == 400


def test_restart_brain_stops_and_starts_in_the_same_mode(client, monkeypatch):
    core, calls = client.svc.core, []
    monkeypatch.setattr(core, "stop", lambda: calls.append("stop") or core.info())
    monkeypatch.setattr(core, "start", lambda mode="voice": calls.append(("start", mode)) or core.info())
    r = client.post("/api/settings/brain/restart")
    assert r.status_code == 200 and calls == ["stop", ("start", "voice")]


def test_a_running_jarvis_reports_the_brain_he_started_with(client, monkeypatch):
    core = client.svc.core
    client.post("/api/settings/brain", json={"model": "llama3.2:1b"})
    for hook in core.env_hooks:
        hook()                                   # what start() does
    client.post("/api/settings/brain", json={"model": "llama3.1:latest"})
    core.proc = FakeProc()
    v = client.get("/api/settings/brain").json()
    assert v["running"] == "llama3.2:1b" and v["chosen"] == "llama3.1:latest" and v["pending_restart"] is True


# ------------------------------------------------------------------ the voice
def test_voices_fall_back_to_the_built_in_list_offline(client):
    v = client.get("/api/settings/voice").json()
    assert v["edge_source"] == "built-in" and v["chosen"] == "edge:en-GB-RyanNeural" and v["speed"] == 1.0
    accents = {x["accent"] for x in v["edge"]}
    assert accents == {"British", "American", "Indian English"}
    assert v["edge"][0]["id"] == "edge:en-GB-RyanNeural"                  # British men first
    assert v["kokoro"] == [] and "missing" in v["kokoro_missing"]


def test_the_live_voice_list_keeps_only_english(client):
    voices, source = st.edge_voices(fetch=lambda: [("en-GB-RyanNeural", "Male"), ("fr-FR-HenriNeural", "Male"),
                                                  ("en-IN-NeerjaNeural", "Female")])
    assert source == "live" and [v["id"] for v in voices] == ["edge:en-GB-RyanNeural", "edge:en-IN-NeerjaNeural"]


def test_kokoro_voices_are_read_from_its_voices_file(client, kokoro):
    v = client.get("/api/settings/voice").json()
    assert [x["id"] for x in v["kokoro"]] == ["kokoro:bm_george", "kokoro:bf_emma", "kokoro:am_michael"]
    assert v["kokoro_missing"] is None                                    # hm_psi is Hindi: not a main voice


def test_choosing_a_voice_and_speed(client, kokoro):
    r = client.post("/api/settings/voice", json={"id": "kokoro:bf_emma", "speed": 1.9})
    assert r.status_code == 200 and r.json()["chosen"] == "kokoro:bf_emma" and r.json()["speed"] == 1.4
    assert client.post("/api/settings/voice", json={"id": "edge:en-ZZ-NobodyNeural"}).status_code == 400
    assert client.post("/api/settings/voice", json={"speed": 0.9}).json()["chosen"] == "kokoro:bf_emma"


def test_the_test_button_plays_in_the_window_when_jarvis_is_not_listening(client):
    r = client.post("/api/settings/voice/test", json={})
    assert r.json()["via"] == "window" and "Aankhen" in r.json()["text"]


def test_the_test_button_has_jarvis_say_it_when_he_listens(client, monkeypatch):
    core, said = client.svc.core, []
    core.proc = FakeProc()
    core.mode = "voice"
    monkeypatch.setattr(core, "speak", lambda text: said.append(text))
    assert client.post("/api/settings/voice/test", json={"text": "Testing, sir."}).json()["via"] == "jarvis"
    assert said == ["Testing, sir."]


def test_the_preview_uses_the_choice_and_the_pronunciations(client, monkeypatch, tmp_path):
    import voice
    seen = []

    async def fake_edge(text, name, rate):
        seen.append((text, name, rate))
        p = tmp_path / "x.mp3"
        p.write_bytes(b"ID3fake")
        return str(p)
    monkeypatch.setattr(voice, "_edge_synth", fake_edge)
    client.post("/api/settings/voice", json={"id": "edge:en-US-GuyNeural", "speed": 1.1})
    client.post("/api/settings/pronunciations", json={"word": "Aankhen", "say": "Aan-khen"})
    r = client.get("/api/settings/voice/preview", params={"text": "Aankhen is awake."})
    assert r.status_code == 200 and r.content == b"ID3fake" and r.headers["content-type"] == "audio/mpeg"
    assert seen == [("Aan-khen is awake.", "en-US-GuyNeural", "+10%")]
    assert not (tmp_path / "x.mp3").exists()                              # the temp file is cleaned up


def test_the_preview_says_why_when_no_voice_can_speak(client, monkeypatch):
    import voice

    async def broken(*a):
        raise OSError("no network")
    monkeypatch.setattr(voice, "_edge_synth", broken)
    r = client.get("/api/settings/voice/preview")
    assert r.status_code == 503 and "offline voice is not installed" in r.json()["detail"]


# ------------------------------------------------------------------ pronunciation
def test_pronunciations_add_replace_and_remove(client):
    t = client.post("/api/settings/pronunciations", json={"word": "Aankhen", "say": "Aan-khen"}).json()["table"]
    assert t == {"Aankhen": "Aan-khen"}
    t = client.post("/api/settings/pronunciations", json={"word": "aankhen", "say": "Aankh-en"}).json()["table"]
    assert t == {"aankhen": "Aankh-en"}                                   # one entry, whatever the case
    assert client.post("/api/settings/pronunciations", json={"word": "[us]", "say": "x"}).status_code == 400
    assert client.delete("/api/settings/pronunciations/AANKHEN").json()["table"] == {}


# ------------------------------------------------------------------ modules
def _mod(client, mid):
    return next(m for m in client.get("/api/settings/modules").json()["modules"] if m["id"] == mid)


def test_deep_think_lists_bigger_or_reasoning_models_only(client):
    m = _mod(client, "deep_think")
    assert [c["name"] for c in m["candidates"]] == ["llama3.1:latest", "qwen3:4b"]
    assert m["status"] == "installed" and m["model"] == "llama3.1:latest" and m["until"] is None
    assert m["download"]["command"] == "ollama pull qwen3:8b"               # never run: shown
    assert m["candidates"][1]["thinking"] is True


def test_deep_think_on_swaps_models_and_ends_on_time(client, monkeypatch):
    svc, o = client.svc, client.ollama
    svc.core.proc = FakeProc()
    r = client.post("/api/settings/modules/deep_think/on", json={"minutes": 15, "model": "qwen3:4b"})
    assert r.status_code == 200
    entry = st.store.read()["modules"]["deep_think"]
    assert entry["model"] == "qwen3:4b" and entry["thinking"] is True and entry["until"] > time.time() + 800
    assert o.dropped == ["qwen3:4b-instruct-2507-q4_K_M"] and o.loaded == [("qwen3:4b", "15m")]
    # The time runs out: the sweep switches it off, unloads it, brings the brain back.
    svc.modules.clock = lambda: time.time() + 16 * 60
    m = _mod(client, "deep_think")
    assert m["until"] is None and "deep_think" not in st.store.read()["modules"]
    assert o.dropped[-1] == "qwen3:4b" and o.loaded[-1] == ("qwen3:4b-instruct-2507-q4_K_M", "30m")


def test_deep_think_refuses_a_model_that_is_not_bigger(client):
    r = client.post("/api/settings/modules/deep_think/on", json={"minutes": 5, "model": "llama3.2:1b"})
    assert r.status_code == 400
    assert client.post("/api/settings/modules/deep_think/on", json={"minutes": 0}).status_code == 400
    assert client.post("/api/settings/modules/warp_drive/on", json={"minutes": 5}).status_code == 404


def test_deep_think_with_jarvis_off_only_sets_the_switch(client):
    client.post("/api/settings/modules/deep_think/on", json={"minutes": 5})
    assert client.ollama.dropped == [] and client.ollama.loaded == []      # no GPU work for nobody
    assert client.post("/api/settings/modules/deep_think/off").json()["was"]["model"] == "llama3.1:latest"


def test_offline_voice_needs_kokoro_and_switches_on_with_it(client, kokoro):
    m = _mod(client, "offline_voice")
    assert m["status"] == "installed" and m["cost"]["vram_gb"] == 0
    assert client.post("/api/settings/modules/offline_voice/on", json={"minutes": 60}).status_code == 200
    assert st.store.read()["modules"]["offline_voice"]["until"] > time.time() + 3500


def test_offline_voice_not_installed_is_listed_with_what_it_needs(client):
    m = _mod(client, "offline_voice")
    assert m["status"] == "not_installed" and "data/models/kokoro" in m["download"]["why"]
    assert client.post("/api/settings/modules/offline_voice/on", json={"minutes": 5}).status_code == 400


def test_offline_voice_is_loaded_once_jarvis_says_so(client, kokoro, monkeypatch):
    core = client.svc.core
    core.proc = FakeProc()
    core.started_at = time.time() - 5
    core.logs.append({"t": time.time(), "line": "[voice] offline voice loaded (Kokoro-82M, CPU)"})
    assert _mod(client, "offline_voice")["status"] == "loaded"


def test_free_the_gpu_unloads_everything_and_ends_deep_think(client):
    client.post("/api/settings/modules/deep_think/on", json={"minutes": 5})
    r = client.post("/api/settings/modules/unload_all/run").json()
    assert r["unloaded"] == ["qwen3:4b-instruct-2507-q4_K_M"] and r["freed_gb"] == 3.31
    assert "deep_think" not in st.store.read()["modules"]
    assert _mod(client, "unload_all")["status"] == "installed"            # nothing left to free


# ------------------------------------------------------------------ latency (System)
def test_the_wake_log_follows_each_hey_jarvis(client):
    tap = client.svc.core._on_event
    t0 = time.time()
    # In the order core/jarvis.py sends them: stt before "heard", endpoint just after it.
    tap({"kind": "wake", "score": 0.81, "t": t0})
    tap({"kind": "timing", "stage": "stt", "seconds": 0.4})
    tap({"kind": "heard", "text": "time kya hua", "t": t0 + 2})
    tap({"kind": "timing", "stage": "endpoint", "seconds": 0.6})
    tap({"kind": "timing", "stage": "first_token", "seconds": 0.7})
    tap({"kind": "reply_end", "text": "Seven, sir.", "seconds": 1.5})
    tap({"kind": "timing", "stage": "first_audio", "seconds": 1.9})
    tap({"kind": "speech_done", "t": t0 + 5})
    tap({"kind": "wake", "score": 0.38, "t": t0 + 30})
    tap({"kind": "state", "state": "sleeping"})
    live = client.get("/api/settings/latency").json()["live"]
    last, first = live["wakes"]
    assert first["outcome"] == "answered" and first["first_word"] == 2.9 and first["full"] == 2.5
    assert first["done_speaking"] == 4.0
    assert last["outcome"] == "heard_nothing" and last["marginal"] is True
    assert live["counts"] == {"answered": 1, "heard_nothing": 1}
    # The transcript keeps the endpoint wait now, so the record can tell it too.
    saved = [e for e in client.svc.core.transcripts.entries(1) if e.get("role") == "jarvis"][-1]
    assert saved["timings"]["endpoint"] == 0.6
    assert client.get("/api/settings/latency").json()["summary"]["first_word"]["median"] == 2.9


def test_a_follow_up_turn_is_not_counted_as_a_wake(client):
    log = latency.WakeLog()
    for ev in ({"kind": "wake", "score": 0.9}, {"kind": "heard", "text": "a"}, {"kind": "reply_end", "seconds": 1.0},
               {"kind": "timing", "stage": "first_audio", "seconds": 1.2},
               {"kind": "heard", "text": "follow-up"}, {"kind": "timing", "stage": "first_audio", "seconds": 9.9},
               {"kind": "speech_done"}):
        log.on_event(ev)
    w = log.view()["wakes"][0]
    assert w["first_audio"] == 1.2 and "spoken" not in w


def test_latency_from_the_transcripts(client):
    entries = [
        {"kind": "turn", "session": "s", "id": 2, "role": "jarvis", "ts": 100.0, "seconds": 3.0,
         "timings": {"stt": 0.5, "endpoint": 0.8, "first_token": 0.6, "reply": 3.0}},
        {"kind": "timing", "session": "s", "id": 2, "stage": "first_audio", "seconds": 1.7},
        {"kind": "turn", "session": "s", "id": 3, "role": "jarvis", "ts": 110.0, "seconds": None,
         "timings": {"stt": 0.5}},                                       # an announcement: not a reply
        {"kind": "turn", "session": "s", "id": 5, "role": "jarvis", "ts": 120.0, "seconds": 2.0,
         "timings": {"first_token": 0.4, "reply": 2.0}},                 # typed
    ]
    rows = latency.turns(entries)
    assert [(r["spoken"], r["heard"], r["first_word"], r["full"]) for r in rows] == [(True, 1.3, 3.0, 4.3),
                                                                                    (False, None, 0.4, 2.0)]
    s = latency.summary(rows)
    assert s["first_word"] == {"median": 3.0, "p90": 3.0, "n": 1} and s["typed_first_word"]["median"] == 0.4


def test_the_latency_view_says_whether_he_can_hear_at_all(client):
    v = client.get("/api/settings/latency").json()
    assert v["core"]["running"] is False and v["core"]["state"] == "offline"
    assert v["summary"]["turns"] == 0 and v["recent"] == []


# ------------------------------------------------------------------ data exports
def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data if isinstance(data, (str, bytes)) else json.dumps(data))
    return buf.getvalue()


CHATGPT = [{"title": "VLSI doubts", "create_time": 1700000000.0, "mapping": {
    "a": {"message": {"author": {"role": "user"}, "create_time": 1700000000.0,
                      "content": {"content_type": "text", "parts": ["what is setup time"]}}},
    "b": {"message": {"author": {"role": "assistant"}, "create_time": 1700000005.0,
                      "content": {"content_type": "text", "parts": ["Setup time is..."]}}},
    "c": {"message": {"author": {"role": "user"}, "create_time": 1760000000.0,
                      "content": {"content_type": "text", "parts": ["and hold time?"]}}},
}}]
SPOTIFY = [
    {"ts": "2024-01-01T10:00:00Z", "ms_played": 200000, "master_metadata_track_name": "Song A",
     "master_metadata_album_artist_name": "Artist X"},
    {"ts": "2024-01-02T10:00:00Z", "ms_played": 5000, "master_metadata_track_name": "Skipped",
     "master_metadata_album_artist_name": "Artist Y"},
    {"ts": "2024-01-03T10:00:00Z", "ms_played": 900000, "master_metadata_track_name": None,
     "master_metadata_album_artist_name": None, "episode_name": "A podcast"},
]


def _wait_read(client, source, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = next(x for x in client.get("/api/imports").json()["sources"] if x["id"] == source)
        if s["files"] and s["files"][0]["read"] is not None:
            return s
        time.sleep(0.05)
    raise AssertionError("the export was never read")


def test_every_source_says_what_to_request_and_opens_its_own_page(client):
    srcs = {s["id"]: s for s in client.get("/api/imports").json()["sources"]}
    assert set(srcs) == {"instagram", "chatgpt", "spotify", "ytmusic"}
    assert "JSON" in srcs["instagram"]["ask"] and "Extended streaming history" in srcs["spotify"]["ask"]
    assert all(s["state"] == "not_requested" for s in srcs.values())
    assert client.post("/api/imports/spotify/request").json()["url"] == "https://www.spotify.com/account/privacy/"
    assert client.opened == ["https://www.spotify.com/account/privacy/"]
    assert client.post("/api/imports/myspace/request").status_code == 404


def test_a_dropped_chatgpt_export_is_saved_and_read(client):
    body = _zip({"conversations.json": CHATGPT, "chat.html": "<html/>"})
    r = client.post("/api/imports/chatgpt/upload", params={"name": "export-2026.zip"}, content=body)
    assert r.status_code == 200 and r.json() == {"name": "export-2026.zip", "size": len(body)}
    assert (imports.IMPORTS / "chatgpt" / "export-2026.zip").read_bytes() == body
    s = _wait_read(client, "chatgpt")
    read = s["files"][0]["read"]
    assert read["ok"] and read["items"] == 2 and read["conversations"] == 1        # his two messages only
    assert (read["first"], read["last"]) == ("2023-11-14", "2025-10-09")
    assert s["state"] == "imported"


def test_the_wrong_export_on_a_card_is_refused_and_not_kept(client):
    body = _zip({"Spotify Extended Streaming History/Streaming_History_Audio_2024.json": SPOTIFY})
    r = client.post("/api/imports/chatgpt/upload", params={"name": "my_spotify_data.zip"}, content=body)
    assert r.status_code == 400 and "Spotify" in r.json()["detail"]
    assert not any((imports.IMPORTS / "chatgpt").glob("*.zip"))


@pytest.mark.parametrize("name", ["../../evil.zip", "notes.txt", ""])
def test_bad_names_are_refused_before_anything_is_written(client, name):
    r = client.post("/api/imports/chatgpt/upload", params={"name": name}, content=b"PK")
    assert r.status_code in (400, 422)
    assert not (imports.IMPORTS.parent / "evil.zip").exists()


def test_an_export_already_in_downloads_is_offered_then_copied(client):
    dl = imports.DOWNLOADS
    dl.mkdir(parents=True)
    (dl / "my_spotify_data.zip").write_bytes(_zip({"Spotify Extended Streaming History/Streaming_History_Audio_2024.json": SPOTIFY}))
    (dl / "holiday.zip").write_bytes(_zip({"photo.txt": "x"}))
    s = next(x for x in client.get("/api/imports").json()["sources"] if x["id"] == "spotify")
    assert s["state"] == "arrived" and [d["name"] for d in s["downloads"]] == ["my_spotify_data.zip"]
    r = client.post("/api/imports/spotify/path", json={"path": s["downloads"][0]["path"]})
    assert r.status_code == 200 and r.json()["copying"] is True
    read = _wait_read(client, "spotify")["files"][0]["read"]
    assert read["items"] == 1 and read["top_artists"] == [{"artist": "Artist X", "plays": 1}] and read["hours"] == 0.1
    s = next(x for x in client.get("/api/imports").json()["sources"] if x["id"] == "spotify")
    assert s["downloads"] == []                                    # already imported: not offered again


@pytest.mark.parametrize("path, why", [("relative.zip", "full path"), ("C:\\nowhere\\x.zip", "Nothing")])
def test_a_typed_path_is_checked(client, path, why):
    r = client.post("/api/imports/ytmusic/path", json={"path": path})
    assert r.status_code == 400 and why in r.json()["detail"]


def test_youtube_history_in_html_says_to_ask_for_json(client):
    body = _zip({"Takeout/YouTube and YouTube Music/history/watch-history.html": "<html/>"})
    assert client.post("/api/imports/ytmusic/upload", params={"name": "takeout-1.zip"}, content=body).status_code == 200
    read = _wait_read(client, "ytmusic")["files"][0]["read"]
    assert read["items"] == 0 and "JSON" in read["warning"]


def test_youtube_music_plays_are_read_and_ordinary_youtube_is_not():
    import ingest_exports as ie
    entries = [
        {"header": "YouTube Music", "title": "Watched Song One", "titleUrl": "https://music.youtube.com/watch?v=a",
         "subtitles": [{"name": "Some Artist - Topic"}], "time": "2024-03-01T10:00:00.000Z"},
        {"header": "YouTube", "title": "Watched a lecture", "subtitles": [{"name": "A University"}],
         "time": "2024-03-02T10:00:00Z"},
        {"header": "YouTube Music", "title": "Watched https://www.youtube.com/watch?v=gone", "time": "2024-03-03T10:00:00Z"},
    ]
    plays = list(ie.ytmusic_plays(entries))
    assert [(p["track"], p["artist"]) for p in plays] == [("Song One", "Some Artist")]
    assert ie.summarise("ytmusic", plays)["first"] == "2024-03-01"


def test_spotify_account_data_shape_is_read_too():
    import ingest_exports as ie
    rows = [{"endTime": "2024-05-01 21:10", "artistName": "Band", "trackName": "Tune", "msPlayed": 185000},
            {"endTime": "2024-05-01 21:11", "artistName": "Band", "trackName": "Tune", "msPlayed": 1200}]
    assert [p["track"] for p in ie.spotify_plays(rows)] == ["Tune"]       # the 1.2 s play was a skip


def test_instagram_says_when_the_memory_archive_is_older_than_the_export(client, monkeypatch):
    monkeypatch.setattr(imports, "archive_built", lambda: 1000.0)
    body = _zip({"your_instagram_activity/messages/inbox/friend_1/message_1.json": {"messages": []}})
    client.post("/api/imports/instagram/upload", params={"name": "instagram-me-2026-10-13.zip"}, content=body)
    s = _wait_read(client, "instagram")
    assert s["archive_stale"] is True and s["files"][0]["read"]["threads"] == 1

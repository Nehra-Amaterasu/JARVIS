"""JARVIS always on: the voice core's supervisor (restart with backoff, crash log, a
deliberate stop is never restarted), the login watchdog, the Startup installer, the
staff -> core event pump, the remark log, the proactive settings and the wake log on disk.
Nothing here starts a real process, opens a mic or talks to Ollama."""
import importlib.util
import io
import json
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import latency
from jarvis_app import routes_alwayson as ao_mod
from jarvis_app import settings as st
from jarvis_app.backoff import RestartBudget
from jarvis_app.bus import EventBus
from jarvis_app.core import CoreProcess
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.transcripts import TranscriptStore

APP = Path(__file__).resolve().parents[1]
TOKEN = "test-token-alwayson"


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


# ------------------------------------------------------------------ backoff
def test_budget_backs_off_resets_after_a_healthy_run_and_caps_per_hour():
    c = Clock()
    b = RestartBudget((5, 15, 60), max_per_hour=4, healthy_s=600, clock=c)
    assert [b.next_delay(3) for _ in range(3)] == [5, 15, 60]
    assert b.next_delay(700) == 5                       # it ran 10+ minutes: back to the short wait
    assert b.next_delay(3) is None                      # 4 in this hour already
    assert 3599 <= b.wait_until_allowed() <= 3600
    c.t += 3601
    assert b.next_delay(3) is not None and b.used_last_hour() == 1


# ------------------------------------------------------------------ the core's supervisor
class FakeProc:
    def __init__(self, code=None, lines=(b"booting\n", b"RuntimeError: mkl_malloc: failed to allocate memory\n")):
        self.stdout = io.BytesIO(b"".join(lines))
        self.stdin = io.BytesIO()
        self.code = code
        self.pid = 777

    def poll(self):
        return self.code

    def wait(self, timeout=None):
        return self.code

    def terminate(self):
        self.code = 1

    kill = terminate


def _core(tmp_path):
    bus = EventBus()
    c = CoreProcess(bus, transcripts=TranscriptStore(tmp_path / "t", tmp_path / "r"))
    c.crash_log = tmp_path / "core_crashes.log"
    c.scheduled = []
    c.schedule = lambda delay, fn: c.scheduled.append((delay, fn)) or type("T", (), {"cancel": lambda self: None})()
    c.starts = []
    return c, bus


def _crash(c, code=3221225477, ran=5):
    proc = FakeProc(code)
    c.proc, c.mode, c.wanted, c.started_at = proc, "voice", True, time.time() - ran
    c._read(proc)                                       # what the reader thread does when he dies


def test_a_crash_is_logged_and_restarted_in_the_same_mode(tmp_path, monkeypatch):
    c, bus = _core(tmp_path)
    _crash(c)
    assert "mkl_malloc" in c.crash_log.read_text(encoding="utf-8")
    assert [d for d, _ in c.scheduled] == [5.0]
    assert any(e["kind"] == "restarting" for e in bus.history())
    monkeypatch.setattr(c, "start", lambda mode="voice", _auto=False: c.starts.append((mode, _auto)) or {})
    c.scheduled[0][1]()                                 # the timer fires
    assert c.starts == [("voice", True)] and c.restarts == 1
    assert c.info()["supervisor"]["restarts"] == 1


def test_backoff_grows_then_gives_up(tmp_path):
    c, bus = _core(tmp_path)
    c.budget = RestartBudget((5, 15, 60, 300), max_per_hour=3)
    for _ in range(4):
        _crash(c)
    assert [d for d, _ in c.scheduled] == [5.0, 15.0, 60.0]
    assert c.gave_up_at is not None and any(e["kind"] == "gave_up" for e in bus.history())


def test_a_deliberate_stop_is_never_restarted(tmp_path):
    c, bus = _core(tmp_path)
    proc = FakeProc(None, lines=())
    c.proc, c.mode, c.wanted = proc, "voice", True
    hooks = []
    c.stop_hooks.append(lambda: hooks.append("unpin"))
    c.stop()
    assert c.wanted is False and hooks == ["unpin"]
    c._read(proc)
    assert c.scheduled == [] and not c.crash_log.exists()


def test_a_timer_that_fires_after_a_stop_does_nothing(tmp_path, monkeypatch):
    c, _ = _core(tmp_path)
    _crash(c)
    c.wanted = False
    monkeypatch.setattr(c, "start", lambda *a, **k: c.starts.append(a) or {})
    c.scheduled[0][1]()
    assert c.starts == []


def test_note_remark_keeps_the_line_in_the_transcript(tmp_path):
    c, bus = _core(tmp_path)
    c.session = "s"
    turn = c.note_remark("Welcome back, sir.")
    assert turn["announce"] and turn["proactive"] == "proactive"
    assert any(e.get("text") == "Welcome back, sir." for e in c.transcripts.entries(1))


# ------------------------------------------------------------------ the watchdog
def _load(name, path):
    from importlib.machinery import SourceFileLoader
    loader = SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def wd():
    return _load("jarvis_watchdog", APP / "watchdog.pyw")


class Launch:
    def __init__(self, codes):
        self.codes, self.n = list(codes), 0

    def __call__(self):
        self.n += 1
        code = self.codes.pop(0)
        return type("P", (), {"pid": 100 + self.n, "wait": lambda self: code})()


def test_watchdog_restarts_a_crash_and_stops_on_a_normal_close(wd):
    c, slept, said = Clock(), [], []
    launch = Launch([1, 3221225477, 0])
    w = wd.Watchdog(launch, sleep=lambda s: slept.append(s), clock=c, existing=lambda: None, say=said.append)
    assert w.run() == 0
    assert launch.n == 3 and slept == [10.0, 30.0]
    assert "closed normally" in said[-1]


def test_watchdog_waits_out_the_hourly_cap(wd):
    c, slept = Clock(), []
    budget = RestartBudget((10,), max_per_hour=2, clock=c)
    w = wd.Watchdog(Launch([1, 1, 1, 0]), budget=budget, sleep=lambda s: slept.append(s), clock=c,
                    existing=lambda: None, say=lambda s: None, max_runs=4)
    w.run()
    assert slept[:2] == [10.0, 10.0] and slept[2] > 3000           # the third crash waits for the hour


def test_watchdog_watches_an_already_open_jarvis_instead_of_starting_another(wd):
    launch = Launch([0])
    w = wd.Watchdog(launch, existing=iter([4321, None]).__next__, wait_existing=lambda pid: 5,
                    sleep=lambda s: None, clock=Clock(), say=lambda s: None)
    assert w.run() == 0 and launch.n == 1                         # the open one crashed (5): ours started


def test_only_one_watchdog_holds_the_lock(wd, tmp_path):
    first = wd.acquire_lock(tmp_path / "watchdog.lock")
    assert first is not None
    assert wd.acquire_lock(tmp_path / "watchdog.lock") is None
    first.close()
    again = wd.acquire_lock(tmp_path / "watchdog.lock")
    assert again is not None
    again.close()


# ------------------------------------------------------------------ the Startup installer
@pytest.fixture(scope="module")
def inst():
    return _load("jarvis_install_startup", APP / "install_startup.py")


def test_startup_shortcut_points_at_the_watchdog(inst, tmp_path):
    sp = inst.spec("voice", repo=Path(r"C:\Projects\JARVIS"), environ={"APPDATA": str(tmp_path)})
    assert sp["link"].endswith(r"Microsoft\Windows\Start Menu\Programs\Startup\JARVIS.lnk")
    assert sp["target"].endswith(r".venv\Scripts\pythonw.exe")
    assert sp["arguments"] == '"C:\\Projects\\JARVIS\\app\\watchdog.pyw" --core voice'
    script = inst.ps_script({**sp, "description": "it's"})
    assert "CreateShortcut(" in script and "'it''s'" in script         # quotes escaped for PowerShell


def test_installer_dry_run_and_remove_touch_nothing_else(inst, tmp_path, capsys):
    env = {"APPDATA": str(tmp_path)}
    ran = []
    assert inst.main(["--dry-run"], run=lambda *a, **k: ran.append(a), environ=env) == 0
    assert ran == [] and "Would create" in capsys.readouterr().out
    link = Path(inst.spec(environ=env)["link"])
    link.parent.mkdir(parents=True)
    link.write_text("x")
    assert inst.main(["--remove"], environ=env) == 0 and not link.exists()


def test_installer_runs_powershell_once(inst, tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(inst, "REPO", tmp_path)
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / ".venv" / "Scripts" / "pythonw.exe").write_text("")
    sp = inst.spec("text", repo=tmp_path, environ={"APPDATA": str(tmp_path / "ad")})
    inst.install(sp, run=lambda args, **k: calls.append(args) or type("R", (), {"returncode": 0})())
    assert calls[0][0] == "powershell.exe" and "--core text" in calls[0][-1]


# ------------------------------------------------------------------ the pump and the remark log
class FakeCore:
    def __init__(self, running=True):
        self.running, self.sent, self.remarks = running, [], []
        self.event_taps, self.stop_hooks = [], []

    def info(self):
        return {"running": self.running, "ready_at": 1.0 if self.running else None, "pid": None,
                "supervisor": {"restarts": 0}, "state": "sleeping"}

    def _send(self, obj):
        self.sent.append(obj)

    def note_remark(self, text):
        self.remarks.append(text)


class Svc:
    def __init__(self, core):
        self.core = core


@pytest.fixture
def logs(tmp_path, monkeypatch):
    monkeypatch.setattr(ao_mod, "PROACTIVE_LOG", tmp_path / "proactive.jsonl")
    monkeypatch.setattr(ao_mod, "HEALTH_LOG", tmp_path / "health.log")
    return tmp_path


def test_the_pump_forwards_the_most_important_event_with_the_media_state(logs):
    c = Clock()
    core = FakeCore()
    a = ao_mod.AlwaysOn(Svc(core), EventBus(), clock=c)
    a.on_bus_event({"source": "limbs", "kind": "room", "origin": "schedule", "device": "fan", "state": {"on": True},
                    "ts": c.t})
    a.on_bus_event({"source": "crew", "kind": "arrived", "text": "Came into the room", "zone": "desk", "ts": c.t})
    a.on_bus_event({"source": "aankhen", "kind": "presence", "text": "ignored"})
    c.t += 10
    fe = a.pump_once(media=lambda: True)
    assert fe["kind"] == "arrived" and core.sent[0]["context"] == {"media_playing": True}
    assert a.pump_once(media=lambda: False) is None                    # FORWARD_GAP_S
    c.t += ao_mod.FORWARD_GAP_S
    assert a.pump_once(media=lambda: False)["kind"] == "lights_changed"


def test_the_core_offline_and_every_decision_are_logged(logs):
    c = Clock()
    core = FakeCore(running=False)
    a = ao_mod.AlwaysOn(Svc(core), EventBus(), clock=c)
    a.on_bus_event({"source": "limbs", "kind": "relay_failed", "text": "light not confirmed", "device": "light"})
    c.t += 10
    a.pump_once(media=lambda: False)
    a.on_core_event({"kind": "proactive", "t": 1.0, "event": {"kind": "arrived"}, "speak": True, "reason": "speak",
                     "line": "Welcome back, sir."})
    a.on_core_event({"kind": "proactive", "t": 1.0, "event": {"kind": "arrived"}, "speak": False,
                     "reason": "quiet_hours"})
    rows = [json.loads(l) for l in (logs / "proactive.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["reason"] for r in rows] == ["core_offline", "speak", "quiet_hours"]
    assert core.remarks == ["Welcome back, sir."]


def test_a_bus_tap_sees_publishes_without_counting_as_a_window(logs):
    bus = EventBus()
    seen = []
    ao_mod._tap_bus(bus, seen.append)
    bus.publish("crew", "arrived", "x")
    bus.publish("core", "level", ephemeral=True)
    assert [e["kind"] for e in seen] == ["arrived"] and bus.listeners == 0


def test_health_line_has_every_field(logs, monkeypatch):
    monkeypatch.setattr(ao_mod, "gpu_memory", lambda: {"used_mib": 4378, "total_mib": 6141})
    monkeypatch.setattr(ao_mod, "brain_now", lambda model: {"loaded": True, "pinned": True})
    core = FakeCore()
    a = ao_mod.AlwaysOn(Svc(core), EventBus())
    a.on_core_event({"kind": "mic", "t": time.time(), "alive": True, "device": "Mic", "reopens": 0, "peak": 0.1})
    line = a.write_health()
    for k in ("app", "gpu", "brain", "core_state", "core_uptime_s", "mic", "last_wake", "restarts", "app_uptime_s"):
        assert k in line
    assert line["app"]["ws_mb"] > 0 and line["mic"]["alive"] is True
    assert json.loads((logs / "health.log").read_text(encoding="utf-8").splitlines()[-1])["core_state"] == "sleeping"


def test_logs_keep_their_newer_half(tmp_path):
    p = tmp_path / "x.jsonl"
    for i in range(50):
        ao_mod.append_jsonl(p, {"i": i, "pad": "y" * 50}, max_bytes=2000)
    rows = [json.loads(l)["i"] for l in p.read_text(encoding="utf-8").splitlines()]
    assert rows[-1] == 49 and rows[0] > 0 and p.stat().st_size <= 2000 + 100


# ------------------------------------------------------------------ routes: settings, the wake log
@pytest.fixture
def client(tmp_path, monkeypatch):
    st.store.write({})
    monkeypatch.setattr(st, "ollama_models", lambda *a, **k: [])
    monkeypatch.setattr(st, "ollama_loaded", lambda *a, **k: [])
    guard = Guard(8779, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    app.state.svc.core.transcripts = TranscriptStore(tmp_path / "transcripts", tmp_path / "reviews")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.svc = app.state.svc
        yield c


def test_proactive_settings_round_trip_and_validation(client):
    assert client.get("/api/settings/proactive").json()["min_gap_min"] == 20
    r = client.post("/api/settings/proactive", json={"muted": True, "quiet_start": "23:00", "min_gap_min": 30})
    assert r.status_code == 200 and r.json()["muted"] is True and r.json()["quiet_start"] == "23:00"
    assert json.loads(st.SETTINGS_PATH.read_text(encoding="utf-8"))["proactive"]["min_gap_min"] == 30
    assert client.post("/api/settings/proactive", json={"quiet_end": "7am"}).status_code == 400
    assert client.post("/api/settings/proactive", json={"min_gap_min": 0}).status_code == 400
    v = client.get("/api/alwayson").json()
    assert v["proactive"]["muted"] is True and v["supervisor"]["wanted"] is False and v["queue"] == []


def test_wakes_are_kept_on_disk_across_restarts_but_shown_per_run(tmp_path):
    path = tmp_path / "wake.jsonl"
    log = latency.WakeLog(path=path)
    for ev in ({"kind": "wake", "score": 0.9, "t": 1.0}, {"kind": "heard", "text": "a", "t": 2.0},
               {"kind": "reply_end", "seconds": 1.0, "t": 3.0}, {"kind": "wake", "score": 0.4, "t": 10.0},
               {"kind": "state", "state": "sleeping", "t": 12.0}):
        log.on_event(ev)
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()]
    assert [r["outcome"] for r in rows] == ["answered", "heard_nothing"]
    again = latency.WakeLog(path=path)                              # the app restarted
    assert again.view()["wakes"] == []
    again.on_event({"kind": "wake", "score": 0.8, "t": 20.0})
    assert len(path.read_text(encoding="utf-8").splitlines()) == 3
    small = latency.WakeLog(path=path, keep_on_disk=2)
    small.on_event({"kind": "wake", "score": 0.5, "t": 30.0})
    assert len(path.read_text(encoding="utf-8").splitlines()) == 2

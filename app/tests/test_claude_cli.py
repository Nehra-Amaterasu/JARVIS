"""The outside model (ww_claude_cli.py) and its switch R-64 (routes_ww_pyq_model.py).

Nothing here runs the real Claude tool, the network or the real data directory: the process runner is replaced by a
recorder that answers canned stdout, and the tests that need a real child process run a small Python script written in
tmp_path, launched through a .cmd shim of the npm shape on Windows.
"""
import json
import os
import sys
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import ww_claude_cli as cli
from jarvis_app import ww_counsel
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import settings
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
FAKE_EXE = str(Path("C:/tools/claude/bin/claude.exe" if os.name == "nt" else "/opt/claude/bin/claude"))
HOSTILE = 'Say "hi" & calc & " then %PATH% and\na second line ^ caret " & type nul > pwned.txt & "'


def envelope(result="ok", is_error=False, **extra):
    return json.dumps({"type": "result", "subtype": "success", "is_error": is_error, "result": result, **extra}).encode()


class Runner:
    """Stands in for _real_run: records what it is handed and answers canned output."""

    def __init__(self, stdout=b"", returncode=0, timed_out=False, overflow=False, exc=None):
        self.calls, self.stdout, self.rc, self.timed_out, self.overflow, self.exc = [], stdout, returncode, timed_out, overflow, exc

    def __call__(self, argv, stdin, cwd, env, timeout, max_out):
        self.calls.append({"argv": list(argv), "stdin": stdin, "cwd": cwd, "env": dict(env), "timeout": timeout, "max_out": max_out})
        if self.exc:
            raise self.exc
        return cli.Ran(self.rc, self.stdout, b"", self.timed_out, self.overflow)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    cli._cache.clear()
    monkeypatch.setattr(cli, "_local_probe", lambda: False)        # never reach for loopback either
    yield
    cli._cache.clear()


@pytest.fixture()
def fake(monkeypatch):
    r = Runner(envelope("```json\n{\"lines\": []}\n```"))
    monkeypatch.setattr(cli, "_runner", r)
    monkeypatch.setattr(cli, "resolve_command", lambda: [FAKE_EXE])
    return r


# ------------------------------------------------------------------ the call
def test_the_argument_list_is_exactly_the_measured_one(fake, tmp_path):
    out = cli.ask("You are terse.", "Summarise this.", model="haiku", workdir=tmp_path / "w")
    assert out == "```json\n{\"lines\": []}\n```"                                # the fence is left for ww_counsel's parser
    c = fake.calls[0]
    assert c["argv"] == [FAKE_EXE, "-p", "--model", "haiku", "--output-format", "json", "--system-prompt", "You are terse.",
                         "--tools", "", "--strict-mcp-config", "--no-session-persistence"]
    assert "--bare" not in c["argv"]
    assert c["stdin"] == "Summarise this.".encode("utf-8") and c["timeout"] == 120 and c["max_out"] == 2 * 1024 * 1024
    assert c["cwd"] == str(tmp_path / "w") and (tmp_path / "w").is_dir() and not any((tmp_path / "w").iterdir())


def test_user_text_goes_in_as_utf8_and_the_environment_is_a_copy_with_nothing_added(fake, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cli.ask("s", "Fourier — ∫ x(t) e^{-jωt} dt, 50% ✓", model="sonnet")
    c = fake.calls[0]
    assert c["stdin"].decode("utf-8") == "Fourier — ∫ x(t) e^{-jωt} dt, 50% ✓"
    assert c["env"] == dict(os.environ) and "ANTHROPIC_API_KEY" not in c["env"]
    assert c["argv"][c["argv"].index("--model") + 1] == "sonnet"


def test_a_system_prompt_that_starts_with_a_dash_is_not_read_as_a_flag(fake):
    cli.ask("--tools default", "u")
    argv = fake.calls[0]["argv"]
    assert argv[argv.index("--system-prompt") + 1] == " --tools default" and argv.count("--tools") == 1


def test_a_long_system_prompt_or_a_bad_model_is_refused_before_anything_runs(fake):
    with pytest.raises(cli.ClaudeCliError):
        cli.ask("x" * (cli.MAX_SYSTEM + 1), "u")
    with pytest.raises(ValueError):
        cli.ask("s", "u", model="gpt")
    with pytest.raises(ValueError):
        cli.claude_provider("gpt")
    assert fake.calls == []


@pytest.mark.parametrize("runner, words", [
    (Runner(timed_out=True), "took longer than 120 seconds"),
    (Runner(overflow=True, stdout=b"x" * 10), "more than 2 MB"),
    (Runner(envelope("Not logged in \u00b7 Please run /login", is_error=True)), "reported an error: Not logged in"),
    (Runner(json.dumps({"type": "result", "is_error": False}).encode()), "without a result"),
    (Runner(b"<html>proxy page</html>"), "JSON shape"),
    (Runner(b"[1, 2]"), "JSON shape"),
    (Runner(b"", returncode=3), "exit code 3"),
    (Runner(exc=FileNotFoundError("gone")), "could not be started"),
])
def test_every_failure_is_one_plain_sentence(monkeypatch, runner, words):
    monkeypatch.setattr(cli, "_runner", runner)
    monkeypatch.setattr(cli, "resolve_command", lambda: [FAKE_EXE])
    with pytest.raises(cli.ClaudeCliError) as e:
        cli.ask("s", "u")
    msg = str(e.value)
    assert words in msg and msg.endswith(".") and "\n" not in msg and msg.count(". ") == 0


def test_an_error_from_the_tool_becomes_a_no_model_answer_in_counsel(monkeypatch):
    monkeypatch.setattr(cli, "_runner", Runner(envelope("rate limited", is_error=True)))
    monkeypatch.setattr(cli, "resolve_command", lambda: [FAKE_EXE])
    out = ww_counsel.counsel("summarise", {"text": "a caption"}, cli.claude_provider("haiku"), "claude-cli:haiku")
    assert out["status"] == "no_model" and out["provider"] == "claude-cli:haiku" and "rate limited" in out["error"]


def test_the_tool_missing_is_said_and_nothing_runs(monkeypatch):
    r = Runner(envelope())
    monkeypatch.setattr(cli, "_runner", r)
    monkeypatch.setattr(cli, "_which", lambda name: None)
    assert cli.resolve_command() is None
    with pytest.raises(cli.ClaudeCliError, match="not found on this PC"):
        cli.ask("s", "u")
    assert cli.available(refresh=True) == {"claude": False, "local": False} and r.calls == []


# ------------------------------------------------------------------ finding the program behind the npm shim
NPM_SHIM = ('@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n'
            '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
OLD_SHIM = ('@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n'
            '  SET "_prog=node"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  '
            '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n')


def test_the_npm_shim_resolves_to_its_exe_and_never_to_the_cmd(tmp_path, monkeypatch):
    exe = tmp_path / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"MZ")
    shim = tmp_path / "claude.cmd"
    shim.write_text(NPM_SHIM, encoding="utf-8")
    monkeypatch.setattr(cli, "_which", lambda name: str(shim))
    assert cli.resolve_command() == [os.path.normpath(str(exe))]
    exe.unlink()                                                          # the program the shim names is gone
    assert cli.resolve_command() is None


def test_the_older_shim_runs_node_with_the_script(tmp_path, monkeypatch):
    (tmp_path / "node.exe").write_bytes(b"MZ")
    shim = tmp_path / "claude.cmd"
    shim.write_text(OLD_SHIM, encoding="utf-8")
    monkeypatch.setattr(cli, "_which", lambda name: str(shim))
    assert cli.resolve_command() == [os.path.normpath(str(tmp_path / "node.exe")),
                                     os.path.normpath(str(tmp_path / "node_modules/@anthropic-ai/claude-code/cli.js"))]


def test_a_shim_of_unknown_shape_is_not_run(tmp_path, monkeypatch):
    shim = tmp_path / "claude.cmd"
    monkeypatch.setattr(cli, "_which", lambda name: str(shim))
    for text in ('@echo off\r\n"%MYTOOL%\\claude.exe" %*\r\n', "@echo off\r\necho hello\r\n", '"%dp0%\\claude.js" %*\r\n'):
        shim.write_text(text, encoding="utf-8")
        assert cli.resolve_command() is None, text
    if os.name == "nt":
        monkeypatch.setattr(cli, "_which", lambda name: str(tmp_path / "claude.ps1"))
        assert cli.resolve_command() is None


# ------------------------------------------------------------------ a real child process
ECHO = r'''
import json, os, sys, time
from pathlib import Path
here = Path(__file__).resolve().parent
args = sys.argv[1:]
if args == ["--version"]:
    sys.stdout.write("2.1.209 (Claude Code)\n")
    sys.exit(0)
data = sys.stdin.buffer.read().decode("utf-8")
(here / "seen.json").write_text(json.dumps({"args": args, "stdin": data, "cwd": os.getcwd(), "env": sorted(k.upper() for k in os.environ)}), encoding="utf-8")
if data == "sleep":
    time.sleep(60)
if data == "flood":
    sys.stdout.write("x" * (3 * 1024 * 1024))
    sys.exit(0)
sys.stdout.write(json.dumps({"type": "result", "is_error": False, "result": "```json\n{\"ok\": true}\n```"}))
'''


@pytest.fixture()
def child(tmp_path, monkeypatch):
    """claude.cmd in the npm shape, launching this venv's Python with a script that writes down what it received."""
    tool = tmp_path / "tool"
    tool.mkdir()
    (tool / "echo_args.py").write_text(ECHO, encoding="utf-8")
    if os.name == "nt":
        shim = tool / "claude.cmd"
        shim.write_text(f'@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\n"{sys.executable}"  "%dp0%\\echo_args.py" %*\r\n', encoding="utf-8")
        monkeypatch.setattr(cli, "_which", lambda name: str(shim))
    else:
        monkeypatch.setattr(cli, "resolve_command", lambda: [sys.executable, str(tool / "echo_args.py")])
    return tool


def test_hostile_text_reaches_the_child_unchanged_and_starts_nothing(child, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    work = tmp_path / "pyq" / cli.WORKDIR
    before = set(os.environ)
    out = cli.ask(HOSTILE, "His question — 50% of %USERPROFILE% & ^ \"quoted\"\nline two", model="haiku", workdir=work)
    assert out == "```json\n{\"ok\": true}\n```"
    seen = json.loads((child / "seen.json").read_text(encoding="utf-8"))
    assert seen["args"] == ["-p", "--model", "haiku", "--output-format", "json", "--system-prompt", HOSTILE,
                            "--tools", "", "--strict-mcp-config", "--no-session-persistence"]
    assert seen["stdin"] == "His question — 50% of %USERPROFILE% & ^ \"quoted\"\nline two"
    assert Path(seen["cwd"]).resolve() == work.resolve()
    for where in (tmp_path, work, child, Path.cwd()):
        assert not (where / "pwned.txt").exists()                     # no cmd.exe ever read the `&`
    if os.name == "nt":
        assert Path(cli.resolve_command()[0]).suffix.lower() == ".exe"
    added = set(seen["env"]) - {k.upper() for k in before}
    assert added <= {"__PYVENV_LAUNCHER__"}                            # the venv launcher's own mark, nothing from us
    assert set(os.environ) == before


def test_the_version_call_finds_the_tool_and_sends_no_prompt(child):
    assert cli.available(refresh=True)["claude"] is True
    assert not (child / "seen.json").exists()                          # the script writes seen.json only when prompted


def test_a_real_child_that_hangs_is_stopped_at_the_timeout(child, tmp_path):
    t0 = time.monotonic()
    with pytest.raises(cli.ClaudeCliError, match="took longer than 2 seconds"):
        cli.ask("s", "sleep", workdir=tmp_path / "w", timeout=2)
    assert time.monotonic() - t0 < 30


def test_a_real_child_that_floods_stdout_is_cut_at_2_mb(child, tmp_path):
    with pytest.raises(cli.ClaudeCliError, match="more than 2 MB"):
        cli.ask("s", "flood", workdir=tmp_path / "w")


# ------------------------------------------------------------------ the setting
def test_mode_provider_and_name_in_every_setting(tmp_path, fake):
    st = Store(tmp_path / "pyq")
    assert (cli.mode_for(st), cli.provider_for(st), cli.name_for(st)) == ("local", None, "local")     # nothing set
    cli.set_mode(st, "claude")
    p = cli.provider_for(st)
    assert cli.mode_for(st) == "claude" and cli.name_for(st) == "claude-cli:haiku" and callable(p)
    p("sys", "user")
    assert fake.calls[-1]["cwd"] == str(Path(st.root) / cli.WORKDIR)
    cli.set_mode(st, "claude", "opus")
    assert cli.name_for(st) == "claude-cli:opus"
    cli.set_mode(st, "off")
    assert (cli.mode_for(st), cli.provider_for(st), cli.name_for(st)) == ("off", None, "off") and settings.rules_only(st)
    settings.save(st, False)                                           # R-35 turns rules only off: his last choice is back
    assert cli.mode_for(st) == "claude" and cli.name_for(st) == "claude-cli:opus"
    settings.save(st, True)                                            # R-35 turns rules only on: no model at all
    assert cli.mode_for(st) == "off" and cli.provider_for(st) is None
    cli.set_mode(st, "local")
    assert (cli.mode_for(st), cli.provider_for(st), settings.rules_only(st)) == ("local", None, False)


def test_the_setting_keeps_other_keys_and_refuses_bad_values(tmp_path):
    st = Store(tmp_path / "pyq")
    (Path(st.root) / "settings.json").write_text(json.dumps({"rules_only": False, "later_wave": 7, "model_provider": "gpt"}), encoding="utf-8")
    assert cli.mode_for(st) == "local" and cli.claude_model_for(st) == "haiku"      # an unknown value reads as the default
    cli.set_mode(st, "claude", "sonnet")
    d = json.loads((Path(st.root) / "settings.json").read_text(encoding="utf-8"))
    assert d == {"rules_only": False, "later_wave": 7, "model_provider": "claude", "claude_model": "sonnet"}
    for bad in (("gpt", None), ("claude", "gpt-4"), (None, None)):
        with pytest.raises(ValueError):
            cli.set_mode(st, *bad)
    (Path(st.root) / "settings.json").write_text("{broken", encoding="utf-8")
    assert cli.mode_for(st) == "local"


def test_available_is_kept_for_60_seconds(monkeypatch):
    calls = {"claude": 0, "local": 0}
    now = [1000.0]
    monkeypatch.setattr(cli, "_clock", lambda: now[0])
    monkeypatch.setattr(cli, "_claude_probe", lambda: calls.__setitem__("claude", calls["claude"] + 1) or True)
    monkeypatch.setattr(cli, "_local_probe", lambda: calls.__setitem__("local", calls["local"] + 1) or False)
    assert cli.available() == {"claude": True, "local": False}
    now[0] += 59
    cli.available()
    assert calls == {"claude": 1, "local": 1}
    now[0] += 2
    cli.available()
    assert calls == {"claude": 2, "local": 2}
    cli.available(refresh=True)
    assert calls == {"claude": 3, "local": 3}
    cli.available()["claude"] = False                                  # a caller changing its copy changes nothing
    assert cli.available()["claude"] is True


def test_the_version_probe_is_the_version_flag_with_a_10_second_limit(monkeypatch):
    r = Runner(b"2.1.209 (Claude Code)\n")
    monkeypatch.setattr(cli, "_runner", r)
    monkeypatch.setattr(cli, "resolve_command", lambda: [FAKE_EXE])
    assert cli._claude_probe() is True
    assert r.calls[0]["argv"] == [FAKE_EXE, "--version"] and r.calls[0]["stdin"] == b"" and r.calls[0]["timeout"] == 10
    for bad in (Runner(b"", returncode=0), Runner(b"x", returncode=1), Runner(timed_out=True), Runner(exc=PermissionError("no"))):
        monkeypatch.setattr(cli, "_runner", bad)
        assert cli._claude_probe() is False


# ------------------------------------------------------------------ R-64
@pytest.fixture()
def client(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    here = {"claude": True, "local": True}
    monkeypatch.setattr(cli, "_claude_probe", lambda: here["claude"])
    monkeypatch.setattr(cli, "_local_probe", lambda: here["local"])
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_model"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.st, c.here = st, here
        yield c


URL = "/api/mission/pyq/model"


def test_r64_answers_local_by_default_and_says_nothing_leaves(client):
    r = client.get(URL)
    assert r.status_code == 200
    b = r.json()
    assert (b["state"], b["provider"], b["claude_model"], b["sends_out"], b["name"]) == ("live", "local", "haiku", False, "local")
    assert b["available"] == {"claude": True, "local": True} and b["source"] == "your settings"
    assert "nothing leaves this PC" in b["reason"]


def test_r64_claude_says_the_text_leaves_the_pc_and_counts_against_his_usage(client):
    r = client.put(URL, json={"provider": "claude", "claude_model": "sonnet"})
    assert r.status_code == 200
    b = r.json()
    assert (b["provider"], b["sends_out"], b["name"], b["state"]) == ("claude", True, "claude-cli:sonnet", "live")
    assert "leaves this PC" in b["reason"] and "counts against your Claude usage" in b["reason"]
    assert cli.mode_for(client.st) == "claude"
    client.here["claude"] = False                                       # the tool went away after he chose it
    cli._cache.clear()
    b = client.get(URL).json()
    assert b["state"] == "waiting" and "not found now" in b["reason"] and "leaves this PC" in b["reason"]


def test_r64_off_is_rules_only(client):
    b = client.put(URL, json={"provider": "off"}).json()
    assert (b["provider"], b["sends_out"], b["name"]) == ("off", False, "off") and settings.rules_only(client.st)
    assert "no model is asked" in b["reason"]
    b = client.put(URL, json={"provider": "local"}).json()
    assert b["provider"] == "local" and not settings.rules_only(client.st)


def test_r64_refuses_claude_while_the_tool_is_missing(client):
    client.here["claude"] = False
    r = client.put(URL, json={"provider": "claude"})
    assert r.status_code == 400 and r.json()["detail"] == "The Claude tool is not found on this PC, so Claude cannot be chosen."
    assert cli.mode_for(client.st) == "local"


@pytest.mark.parametrize("body", [{}, {"provider": "gpt"}, {"provider": "claude", "claude_model": "gpt-4"},
                                  {"provider": "local", "key": "x"}, {"claude_model": "haiku"}])
def test_r64_refuses_a_bad_body_with_a_sentence(client, body):
    r = client.put(URL, json=body)
    assert r.status_code == 400 and r.json()["detail"].endswith(".")
    assert cli.mode_for(client.st) == "local"


def test_r64_waits_when_the_local_model_is_not_running(client):
    client.here["local"] = False
    b = client.get(URL).json()
    assert b["state"] == "waiting" and "not running now" in b["reason"]


def test_a_store_under_a_project_with_instructions_runs_the_tool_outside_it(tmp_path):
    import tempfile
    from types import SimpleNamespace
    plain = SimpleNamespace(root=tmp_path / "plain" / "pyq")
    assert cli.workdir_for(plain) == tmp_path / "plain" / "pyq" / cli.WORKDIR
    (tmp_path / "project").mkdir()
    (tmp_path / "project" / "CLAUDE.md").write_text("project rules", encoding="utf-8")
    inside = SimpleNamespace(root=tmp_path / "project" / "data" / "pyq")
    assert cli.workdir_for(inside) == Path(tempfile.gettempdir()) / "jarvis-claude-cwd"

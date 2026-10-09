"""brain/ollama_guard.py: JARVIS starts Ollama himself when it is closed, and knows a
refused connection from any other failure. Nothing here starts a real process."""
import httpx
import pytest

from jarvis_app.paths import ensure_brain_importable

ensure_brain_importable()
import ollama_guard as g  # noqa: E402


@pytest.mark.parametrize("err", [
    ConnectionRefusedError(10061, "No connection could be made because the target machine actively refused it"),
    httpx.ConnectError("[WinError 10061] No connection could be made because the target machine actively refused it"),
    ConnectionError("Failed to connect to Ollama. Please check that Ollama is downloaded, running and accessible."),
])
def test_a_refused_connection_is_recognised(err):
    assert g.is_down_error(err)


def test_it_is_recognised_through_a_wrapping_exception():
    try:
        try:
            raise ConnectionRefusedError("refused")
        except ConnectionRefusedError as inner:
            raise RuntimeError("stream failed") from inner
    except RuntimeError as outer:
        assert g.is_down_error(outer)


@pytest.mark.parametrize("err", [ValueError("bad JSON"), KeyError("message"), RuntimeError("CUDA out of memory")])
def test_other_failures_are_not_mistaken_for_it(err):
    assert not g.is_down_error(err)


def test_nothing_is_started_when_ollama_answers(monkeypatch):
    monkeypatch.setattr(g, "up", lambda timeout=0.8: True)
    monkeypatch.setattr(g.subprocess, "Popen", lambda *a, **k: pytest.fail("started a second Ollama"))
    assert g.ensure(log=lambda m: None)


def test_a_closed_ollama_is_started_and_waited_for(monkeypatch):
    started, state = [], {"up": False}
    monkeypatch.setattr(g, "up", lambda timeout=0.8: state["up"])
    monkeypatch.setattr(g, "find_exe", lambda: r"C:\fake\ollama.exe")
    monkeypatch.setattr(g, "_last_start", 0.0)

    def fake_popen(args, **kw):
        started.append(args)
        state["up"] = True                       # the server comes up
    monkeypatch.setattr(g.subprocess, "Popen", fake_popen)
    assert g.ensure(wait_s=2, log=lambda m: None)
    assert started == [[r"C:\fake\ollama.exe", "serve"]]


def test_no_ollama_installed_fails_cleanly(monkeypatch):
    monkeypatch.setattr(g, "up", lambda timeout=0.8: False)
    monkeypatch.setattr(g, "find_exe", lambda: None)
    assert g.ensure(wait_s=0.1, log=lambda m: None) is False


def test_ollama_does_not_inherit_the_venv_cuda_libraries(monkeypatch):
    sep = g.os.pathsep
    monkeypatch.setenv("PATH", sep.join([r"C:\Projects\jarvis-room\brain\.venv311_gpu\Lib\site-packages\nvidia\cublas\bin",
                                         r"C:\Windows\System32", r"C:\Program Files\Git\cmd"]))
    assert g.clean_env()["PATH"].split(sep) == [r"C:\Windows\System32", r"C:\Program Files\Git\cmd"]

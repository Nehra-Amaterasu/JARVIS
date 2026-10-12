"""Feature routes load from their own modules, and a broken one cannot take the app down."""
import types

from fastapi import FastAPI

from jarvis_app import server


def test_feature_modules_register_and_failures_are_reported(monkeypatch):
    calls = []
    good = types.SimpleNamespace(register=lambda app, svc, bus: calls.append("good"))

    def bad_register(app, svc, bus):
        raise RuntimeError("boom")
    bad = types.SimpleNamespace(register=bad_register)
    mods = [types.SimpleNamespace(name="routes_bad"), types.SimpleNamespace(name="routes_good"),
            types.SimpleNamespace(name="memory")]
    monkeypatch.setattr("pkgutil.iter_modules", lambda path: mods)
    monkeypatch.setattr("importlib.import_module",
                        lambda name: {"jarvis_app.routes_good": good, "jarvis_app.routes_bad": bad}[name])
    failed = server.register_feature_routes(FastAPI(), None, None)
    assert calls == ["good"]
    assert failed == [("routes_bad", "RuntimeError: boom")]

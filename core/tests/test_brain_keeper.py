"""core/ollama_guard.py's keeper: the brain stays resident (keep_alive -1), and is pinned
again when another client's "30m" request put it back on a timer or Ollama dropped it."""
from datetime import datetime, timedelta, timezone

import ollama_guard as g

MODEL = "qwen3:4b-instruct-2507-q4_K_M"
NOW = 1_800_000_000.0


def ps_entry(expires_in_s):
    exp = datetime.fromtimestamp(NOW + expires_in_s, tz=timezone(timedelta(hours=5, minutes=30)))
    return {"name": MODEL, "size_vram": 3220176895, "expires_at": exp.isoformat(), "context_length": 8192}


def test_status_reads_ollamas_expiry():
    st = g.brain_status(MODEL, [ps_entry(1800)], now=NOW)
    assert st["loaded"] and st["num_ctx"] == 8192 and st["vram_mb"] == 3070 and 1795 <= st["expires_in_s"] <= 1805 and not st["pinned"]
    pinned = g.brain_status(MODEL, [{"name": MODEL, "size_vram": 1, "expires_at": "2318-08-04T12:00:00.1+05:30"}],
                            now=NOW)
    assert pinned["pinned"]
    assert g.brain_status(MODEL, [], now=NOW)["loaded"] is False


def test_when_to_pin():
    assert g.needs_pin({"loaded": False})
    assert g.needs_pin({"loaded": True, "pinned": False, "expires_in_s": 1700}, keep_alive=-1)
    assert not g.needs_pin({"loaded": True, "pinned": True, "expires_in_s": 10**10}, keep_alive=-1)
    assert not g.needs_pin({"loaded": True, "pinned": False, "expires_in_s": 1700}, keep_alive="30m")
    # Loaded by someone else at 4096: JARVIS's 8192 question would reload it, so load it right.
    assert g.needs_pin({"loaded": True, "pinned": True, "num_ctx": 4096}, keep_alive=-1, num_ctx=8192)
    assert not g.needs_pin({"loaded": True, "pinned": True, "num_ctx": 8192}, keep_alive=-1, num_ctx=8192)


def test_keep_alive_setting():
    assert g.keep_alive_value({}) == -1
    assert g.keep_alive_value({"JARVIS_KEEP_ALIVE": "30m"}) == "30m"
    assert g.keep_alive_value({"JARVIS_KEEP_ALIVE": "3600"}) == 3600


def test_keeper_repins_only_when_needed_and_never_mid_turn():
    state = {"ps": [ps_entry(1800)], "busy": False}
    pins = []
    k = g.Keeper(MODEL, -1, get_ps=lambda: state["ps"], do_pin=lambda m, ka: pins.append((m, ka)) or True,
                 log=lambda s: None, busy=lambda: state["busy"])
    state["busy"] = True
    k.check()
    assert pins == []                                       # a turn is running: its own request pins it
    state["busy"] = False
    assert k.check()["repinned"] and pins == [(MODEL, -1)]
    state["ps"] = [{"name": MODEL, "size_vram": 1, "expires_at": "2318-08-04T12:00:00+05:30"}]
    k.check()
    assert len(pins) == 1                                   # pinned: left alone
    state["ps"] = []
    k.check()
    assert len(pins) == 2 and k.pins == 2                   # dropped by Ollama: loaded again


def test_keeper_survives_ollama_being_down():
    def down():
        raise ConnectionError("refused")
    k = g.Keeper(MODEL, -1, get_ps=down, do_pin=lambda m, ka: True, log=lambda s: None)
    assert "error" in k.check()

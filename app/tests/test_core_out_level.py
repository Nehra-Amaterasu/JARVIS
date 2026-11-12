"""The child's `out_level` event (core/playback.py, JARVIS_OUT_LEVEL) reaches the bus as an
ephemeral "core"/"out_level" event, with exactly the fields of spec 9.2 and nothing logged."""
from jarvis_app.bus import EventBus
from jarvis_app.core import CoreProcess
from jarvis_app.transcripts import TranscriptStore


def test_out_level_is_republished_live_and_never_kept(tmp_path):
    bus = EventBus()
    c = CoreProcess(bus, transcripts=TranscriptStore(tmp_path / "t", tmp_path / "r"))
    c.session, c.mode = "test", "voice"
    bands = list(range(24))
    c._on_event({"kind": "out_level", "t": 1.5, "seq": 7, "sr": 24000, "rms_db": -20.0, "peak_db": -14.0,
                 "bands": bands, "lat_ms": 90.0, "final": False, "stray": "dropped"})
    assert [e for e in bus.history(50) if e["kind"] == "out_level"] == []          # ephemeral: not in history
    seen = []
    orig = bus.publish
    bus.publish = lambda *a, **k: (seen.append((a, k)), orig(*a, **k))[1]
    c._on_event({"kind": "out_level", "t": 1.5, "seq": 8, "sr": 24000, "rms_db": -20.0, "peak_db": -14.0,
                 "bands": bands, "lat_ms": 90.0, "final": False, "stray": "dropped"})
    (args, kw), = seen
    assert args[:2] == ("core", "out_level") and kw["ephemeral"] is True
    assert kw["bands"] == bands and kw["seq"] == 8 and kw["final"] is False and "stray" not in kw

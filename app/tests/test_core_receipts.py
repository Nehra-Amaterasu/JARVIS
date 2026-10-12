"""JARVIS's receipts and the honesty guard's replacements reach the app's event bus
(core.py), so the window can show what a tool really did behind a reply."""
from jarvis_app.bus import EventBus
from jarvis_app.core import CoreProcess


def test_receipts_and_replacements_are_published(tmp_path):
    from jarvis_app.transcripts import TranscriptStore
    bus = EventBus()
    core = CoreProcess(bus, transcripts=TranscriptStore(tmp_path))
    core._on_event({"kind": "receipt", "t": 1.0, "tool": "set_device", "tier": "T1", "ok": True,
                    "did": "The light is off. Virtual room only; no relay board is connected.",
                    "source": "app · Limbs (virtual room)", "simulated": True, "backs": ["switch"]})
    core._on_event({"kind": "honesty", "t": 2.0, "replaced": [{"kind": "message", "mode": "assert",
                                                                "said": "I've sent it.", "now": "I can't send messages."}]})
    receipt, honesty = bus.history(5)[-2:]
    assert receipt["source"] == "core" and receipt["kind"] == "receipt" and receipt["sim"] is True
    assert receipt["receipt"]["tool"] == "set_device" and "kind" not in receipt["receipt"]
    assert receipt["text"].startswith("The light is off.")
    assert honesty["kind"] == "honesty" and honesty["text"] == "Replaced 1 unbacked claim(s) in a reply"
    assert honesty["replaced"][0]["kind"] == "message"

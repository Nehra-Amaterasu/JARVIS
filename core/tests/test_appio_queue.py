"""A phone recording, once transcribed, joins the queue exactly like a typed message."""
import appio


def test_queued_text_is_read_like_a_typed_message():
    while appio.poll_say() is not None:          # start from an empty queue
        pass
    appio.queue_say("  turn on the light  ")
    appio.queue_say("   ")                       # nothing heard: nothing queued
    assert appio.poll_say() == "turn on the light"
    assert appio.poll_say() is None

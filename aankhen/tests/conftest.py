"""Aankhen tests never record the raw stream into the real data/aankhen/stream: a hub that
switches to a fake board would otherwise start the recorder there (stream.py). The tests
of the recorder turn it back on, in tmp_path."""
import os

os.environ["AANKHEN_STREAM"] = "0"

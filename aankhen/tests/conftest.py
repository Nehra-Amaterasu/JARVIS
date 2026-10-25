"""Shared set-up for the Aankhen tests.

SCRATCH DATA. Every test runs against a throw-away data folder, never data/aankhen:
  - AANKHEN_DATA_DIR points the package at a fresh temp folder. aankhen/__init__.py has
    already run by the time this file is imported (this folder is part of the package),
    so the package attribute is set too; every module that keeps a path (zones.json,
    references, models, baselines, recordings, the activity journal) reads DATA_DIR when
    it is first imported, which is after this. Without it, in the main checkout a
    hub started by a test loaded his real 43 MB models, his room, his empty-room
    references, and a fake board in "hardware" mode wrote into his real activity journal.
  - AANKHEN_STREAM=0: a hub that switches to a fake board would otherwise start the raw
    recorder (stream.py). The recorder's own tests turn it back on, in tmp_path.
Worker processes (bench.run_jobs) inherit both through the environment.

SPEED. `sim_baseline` is calibrated once per session (65 s of simulated empty room) for
every module that starts a hub; it used to be made once per module.

SLOW TESTS. `@pytest.mark.slow` marks tests left out of the quick loop
(`pytest aankhen/tests -m "not slow"`); the merge gate runs everything:
    .venv\\Scripts\\python.exe -m pytest aankhen/tests -q
    .venv\\Scripts\\python.exe -m pytest aankhen/tests -q -m slow      # the slow set alone
"""
import os
import shutil
import sys
import tempfile

os.environ["AANKHEN_STREAM"] = "0"
_SCRATCH = tempfile.mkdtemp(prefix="aankhen-tests-")
os.environ["AANKHEN_DATA_DIR"] = _SCRATCH

import aankhen  # noqa: E402

_early = sorted(m for m in sys.modules if m.startswith("aankhen.") and not m.startswith("aankhen.tests"))
if _early:      # a module imported before this file keeps the real paths: refuse to run
    raise RuntimeError(f"aankhen modules imported before the scratch data folder was set: {_early}")
aankhen.DATA_DIR = _SCRATCH

import pytest  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: long end-to-end runs; `-m slow` runs only these, "
                                       "`-m \"not slow\"` skips them (the merge gate runs all)")


def pytest_unconfigure(config):
    shutil.rmtree(_SCRATCH, ignore_errors=True)


@pytest.fixture(scope="session")
def sim_baseline():
    """The simulated empty room's calibration, made once for the whole run."""
    from aankhen.bench import simulated_baseline
    from aankhen.room import load_room
    room, _ = load_room()            # the scratch folder has no room.json: the default room
    return simulated_baseline(room)

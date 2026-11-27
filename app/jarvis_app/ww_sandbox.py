"""A second JARVIS on a copy of the data, for audits and UI work while the real app runs.

    python -m jarvis_app.ww_sandbox [--port 8790] [--token ww-audit] [--fresh]
    python -m jarvis_app.ww_sandbox --seed study [--port 8791] [--dir D] [--fresh]

Why: the desktop app holds port 8777, its token lives only in its process, and its state is his.
Auditing "in the app itself" without touching it means another instance on another port, over a
COPY of data/app and a COPY of the engine inputs, with everything that reaches outside the box
turned off: no phone listener (8778 is the real one's), no Aankhen, no core autostart, no Uno.
Taps in the sandbox land in the copy. The copy is rebuilt with --fresh; otherwise it is reused.
Nothing here is imported by the app.

--seed study (ww_sandbox_seed.py) is the other kind: no copy at all. The folder is created EMPTY and filled with invented,
shape-true rows by the engine's own code, Google, the OCR engine and the model are fixtures that say so, and the seeded ids
are printed once as one line of JSON, so a browser test can name them while the real routes answer. A seed folder carries
ww_sandbox_seed.MARKER; a folder without it is never seeded into or deleted, so a copy of his data can never take seed rows.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL_DATA = ROOT / "data" / "app"
REAL_INPUTS = ROOT / "data" / "notes" / "well-wisher" / "engine-inputs.json"
SKIP = {"firmware", "media", "transcripts", "watchdog.lock", "instance.json", "jarvis.log", "health.log",
        "core_crashes.log", "watchdog.log", "gcr"}   # gcr: originals can be gigabytes, and the copy must not carry his files


def make_copy(dest: Path, fresh: bool) -> Path:
    if fresh and dest.exists():
        shutil.rmtree(dest)
    if not dest.exists():
        dest.mkdir(parents=True)
        for item in REAL_DATA.iterdir():
            if item.name in SKIP:
                continue
            if item.is_dir():
                shutil.copytree(item, dest / item.name)
            else:
                shutil.copy2(item, dest / item.name)
        if REAL_INPUTS.exists():
            shutil.copy2(REAL_INPUTS, dest / "engine-inputs.json")
    return dest


SEED_DIR = Path(tempfile.gettempdir()) / "jarvis-ww-sandbox-seed"    # never the copy's folder: the two kinds must not mix


def make_seed_dir(dest: Path, fresh: bool) -> Path:
    """An empty folder for seed rows, or one this module seeded before. Nothing of the real data folder is read."""
    from .ww_sandbox_seed import MARKER
    if dest.exists() and any(dest.iterdir()) and not (dest / MARKER).is_file():
        raise SystemExit(f"{dest} holds files that are not a seed: give another --dir (seed mode fills only its own folders).")
    if fresh and dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if not (dest / MARKER).is_file():                # marked before the first row, so a seed that fails half way can run again
        (dest / MARKER).write_text('{"seeding": true}', encoding="utf-8")
    return dest


def seed_env(dest: Path) -> None:
    """Every data folder the app reads, under the seed folder; set before anything imports jarvis_app.paths."""
    os.environ["JARVIS_DATA_DIR"] = str(dest)
    os.environ["JARVIS_ENGINE_INPUTS"] = str(dest / "engine-inputs.json")
    os.environ["WW_BANK_DIR"] = str(dest / "bank" / "questions")
    os.environ["JARVIS_EXAM_NOTES"] = str(dest / "notes" / "exams")
    os.environ["JARVIS_KNOWLEDGE_DIR"] = str(dest / "knowledge")
    os.environ["JARVIS_LIBRARY_DIR"] = str(dest / "library")
    os.environ["JARVIS_YAADASH_DIR"] = str(dest / "yaadash")
    os.environ["JARVIS_LEARNED_DIR"] = str(dest / "learned")
    os.environ["JARVIS_LEARN_FILE"] = str(dest / "no-learn.md")
    os.environ["JARVIS_TRANSCRIPTS_DIR"] = str(dest / "transcripts")
    os.environ["JARVIS_SETTINGS"] = str(dest / "settings.json")
    os.environ["AANKHEN_DATA_DIR"] = str(dest / "aankhen")
    os.environ["AANKHEN_HOTPLUG"] = "0"
    os.environ["AANKHEN_NET"] = "0"
    os.environ["JARVIS_MEDIA_OS"] = "0"
    os.environ["JARVIS_GOOGLE"] = "fixture"      # not "off": the Classroom routes answer from the invented rows


def run_seeded(a) -> int:
    from . import ww_sandbox_seed as seed
    dest = make_seed_dir(Path(a.dir or SEED_DIR), a.fresh)
    seed_env(dest)
    os.environ["JARVIS_PHONE"] = "0"
    os.environ["JARVIS_AUTOSTART_CORE"] = "0"
    os.environ["JARVIS_UNO"] = "off"
    os.environ["JARVIS_TOKEN"] = a.token
    ids = seed.seed_study(dest)
    print(f"sandbox seed data: {dest}", flush=True)
    print(json.dumps(ids, sort_keys=True), flush=True)          # one line, for a test harness to read the ids
    seed.install_fixtures()
    from . import server
    server.create_app = seed.wrap_create_app(server.create_app, float(os.environ.get("JARVIS_SANDBOX_OCR_DELAY") or seed.OCR_DELAY))
    from . import desktop
    return desktop.main(["--server-only", "--port", str(a.port), "--token", a.token, "--aankhen", "off"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="JARVIS sandbox over a copy of the data")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--token", default="ww-audit")
    ap.add_argument("--dir", default=None, help="the sandbox folder (default: a temporary folder per kind)")
    ap.add_argument("--fresh", action="store_true", help="rebuild the copy, or the seed folder")
    ap.add_argument("--seed", choices=["study"], help="no copy: an empty folder filled with invented study rows")
    a = ap.parse_args(argv)
    if a.seed:
        return run_seeded(a)
    copy = make_copy(Path(a.dir or Path(tempfile.gettempdir()) / "jarvis-ww-sandbox"), a.fresh)
    os.environ["JARVIS_DATA_DIR"] = str(copy)
    os.environ["JARVIS_ENGINE_INPUTS"] = str(copy / "engine-inputs.json")
    os.environ["JARVIS_PHONE"] = "0"             # never bind the real phone port
    os.environ["JARVIS_AUTOSTART_CORE"] = "0"
    os.environ["JARVIS_UNO"] = "off"
    os.environ["JARVIS_GOOGLE"] = "off"          # a copy for audits must not sign in to Google or pull his files
    os.environ["JARVIS_TOKEN"] = a.token
    print(f"sandbox data: {copy}", flush=True)
    from . import desktop
    return desktop.main(["--server-only", "--port", str(a.port), "--token", a.token, "--aankhen", "off"])


if __name__ == "__main__":
    sys.exit(main())

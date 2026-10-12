"""Where everything in JARVIS lives, written down once.

    JARVIS/
        app/               the desktop app: FastAPI server + React UI (the Mission game is a tab)
        core/              JARVIS himself: voice loop, agent, voices, room control
        yaadash/           memory: archive, people, beliefs, recall
        aankhen/           spatial sensing (Python package) and the ESP32 firmware
        mission-germoney/  the original Expo app
        docs/
        data/              everything personal; git-ignored, never pushed

Code folders hold only code. Anything learned from or about this home (memories, the
room layout, recordings, trained models, voices) lives under data/, so the public repo
can never pick it up by accident.

The venv's jarvis.pth puts core/, yaadash/ and the root on sys.path, so these modules
import each other by plain name (`import yaadash_v2`, `import aankhen`).
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

# JARVIS_YAADASH_DIR points the whole memory (parquet files, BM25 cache and LanceDB)
# at another folder. The memory tests build a synthetic store there, so they can never
# read or overwrite the real one; unset, it is data/yaadash as always.
YAADASH_DATA = Path(os.environ.get("JARVIS_YAADASH_DIR") or DATA / "yaadash")
LANCEDB = YAADASH_DATA / "lancedb"      # the vector store
IDENTITY = DATA / "identity"            # authored facts about me
MODELS = DATA / "models"                # local voice models (Kokoro)
AANKHEN_DATA = DATA / "aankhen"         # room layout, baselines, recordings, spatial models
APP_DATA = DATA / "app"                 # Mission progress, transcripts, room state

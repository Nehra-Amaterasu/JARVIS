"""Aankhen (आँखें, "eyes") — JARVIS's spatial sensing subsystem.

ESP32-S3 Wi-Fi CSI motion sensing, optional HLK-LD2450 radar tracking, sensor
fusion, a learned occupancy map, and a live 3D view of the room.

Every output is tagged with where it came from (`hardware`, `replay` or
`simulation`). Nothing simulated is ever presented as measured.
"""
__version__ = "3.0.0"

import os as _os

# What is personal to this home (the room layout, Wi-Fi baselines, recordings and
# trained models) lives in JARVIS/data/aankhen, git-ignored, so this folder holds only
# code. AANKHEN_DATA_DIR points it elsewhere (a second room, a test).
DATA_DIR = _os.environ.get("AANKHEN_DATA_DIR") or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "data", "aankhen")
_os.makedirs(DATA_DIR, exist_ok=True)

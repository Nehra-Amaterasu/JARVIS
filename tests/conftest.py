"""Repo-wide checks (privacy, commit messages): plain files, no app or model imported."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

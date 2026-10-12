"""Test setup for Yaadash modules.

The venv's jarvis.pth puts the MAIN checkout's core/ and yaadash/ on sys.path. A
test must import the code next to it (a worktree's, a branch's), so this checkout's
core/, yaadash/ and root go to the front.

Nothing here may touch data/: JARVIS_LIBRARY_DIR points the study library at a
throwaway folder before any test imports it, and every test builds its own corpus
from invented lecture notes (library_corpus.py).
"""
import hashlib
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
for p in (str(ROOT), str(ROOT / "yaadash"), str(ROOT / "core")):
    if p in sys.path:
        sys.path.remove(p)
    sys.path.insert(0, p)
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ["JARVIS_LIBRARY_DIR"] = tempfile.mkdtemp(prefix="jarvis-library-test-")


class HashingEmbedder:
    """A deterministic stand-in for bge-small: stemmed words and word pairs hashed
    into 384 signed dimensions. It knows no synonyms, so it is a weak "vector"
    search — good enough to exercise the code paths, and never reported as bge."""
    name = "test-hashing-384"
    dim = 384

    def __init__(self):
        self.calls = 0

    def encode(self, texts, is_query=False):
        import library
        self.calls += 1
        out = np.zeros((len(texts), self.dim), np.float32)
        for i, t in enumerate(texts):
            toks = library.tokens(t)
            for f in toks + [a + "_" + b for a, b in zip(toks, toks[1:])]:
                h = int.from_bytes(hashlib.md5(f.encode()).digest()[:4], "little")
                out[i, h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
            n = np.linalg.norm(out[i])
            if n:
                out[i] /= n
        return out


@pytest.fixture
def fake_embedder():
    return HashingEmbedder()

"""Test setup for Yaadash: a synthetic memory store in a throwaway folder.

    .venv\\Scripts\\python.exe -m pytest yaadash/tests -q

Three things must be true before any memory module is imported, because each of them
reads its paths at import time (`from home import YAADASH_DATA`):
  1. JARVIS_YAADASH_DIR points the whole store (parquet, BM25 cache, LanceDB) at a
     fresh temp folder, so a test can never read or overwrite the real memory;
  2. THIS checkout's core/ and yaadash/ come first on sys.path (the venv's jarvis.pth
     points at one checkout; a worktree must test its own files);
  3. Hugging Face runs offline, so loading the embedder never touches the network.
If another suite in the same session imported the memory modules first, the paths
are already fixed to the real store: the session stops instead of running against it.

The embedder is the real one (BAAI/bge-small-en-v1.5, from the local Hugging Face
cache, on the CPU) whenever it loads offline, because the relevance gates (0.32
cosine distance for recall and for fragments) were measured on it. Without it, or
with YAADASH_TEST_EMBEDDER=fake, a deterministic hashing embedder stands in and every
test whose expectation depends on bge distances is skipped; the run says which.
"""
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
_TMP = Path(tempfile.mkdtemp(prefix="jarvis-yaadash-test-"))
STORE = _TMP / "yaadash"
os.environ["JARVIS_YAADASH_DIR"] = str(STORE)
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
for p in (ROOT, ROOT / "yaadash", ROOT / "core", HERE):
    if str(p) in sys.path:
        sys.path.remove(str(p))
    sys.path.insert(0, str(p))

import home  # noqa: E402
import yaadash_archive as ya  # noqa: E402
import yaadash_people as yp  # noqa: E402
import yaadash_recall as yr  # noqa: E402
import yaadash_v2 as y  # noqa: E402

import synthetic_home as sh  # noqa: E402

_paths = {"home.py": Path(home.__file__), "yaadash_recall.py": Path(yr.__file__)}
_stores = {"home.YAADASH_DATA": home.YAADASH_DATA, "yaadash_recall.DATA": yr.DATA,
           "yaadash_people.DATA": yp.DATA, "yaadash_archive.DATA": ya.DATA,
           "yaadash_v2.DB_PATH": y.DB_PATH}
_root, _store = ROOT.resolve(), STORE.resolve()
_wrong = [f"{k} -> {v}" for k, v in _paths.items() if _root not in v.resolve().parents]
_wrong += [f"{k} -> {v}" for k, v in _stores.items()
           if Path(v).resolve() != _store and _store not in Path(v).resolve().parents]
if _wrong:
    raise RuntimeError("yaadash tests refuse to run against anything but their own scratch "
                       "store and this checkout's code (run this suite on its own): "
                       + "; ".join(_wrong))

EMBEDDER = {"name": None}
RESULTS = []          # (kind, query, passed) from the control-query harness


def pytest_configure(config):
    config.addinivalue_line("markers", "needs_bge: expectation measured on bge-small distances")


def pytest_unconfigure(config):
    shutil.rmtree(_TMP, ignore_errors=True)


def pytest_collection_modifyitems(config, items):
    if _pick_embedder() == "bge":
        return
    why = ("YAADASH_TEST_EMBEDDER=fake" if os.environ.get("YAADASH_TEST_EMBEDDER", "").lower() == "fake"
           else "bge-small did not load from the local cache")
    skip = pytest.mark.skip(reason=f"the relevance gates were measured on bge-small; {why}, "
                                   "so a fake embedder is in use")
    for item in items:
        if "needs_bge" in item.keywords:
            item.add_marker(skip)


def pytest_report_header(config):
    return f"yaadash: scratch store {STORE}; embedder: {_pick_embedder()}"


def pytest_terminal_summary(terminalreporter):
    tr = terminalreporter
    if not RESULTS:
        if EMBEDDER["name"] == "fake":
            tr.write_line("yaadash: fake embedder in use, control queries skipped")
        return
    tr.section("yaadash control queries")
    for kind in ("answer", "abstain", "known gap"):
        rows = [r for r in RESULTS if r[0] == kind]
        if rows:
            ok = sum(r[2] for r in rows)
            label = {"answer": "found at the expected rank", "abstain": "abstained",
                     "known gap": "known gaps still open (xfail)"}[kind]
            tr.write_line(f"{kind:9} {ok}/{len(rows)} {label}")
    tr.write_line(f"embedder: {EMBEDDER['name']}")


# ------------------------------------------------------------------ embedder
def _fake_embed(texts, is_query=False):
    """Deterministic stand-in: hashed word and character-trigram counts, L2-normalised.
    It shares words, not meaning, so only tests that do not depend on bge distances run."""
    if isinstance(texts, str):
        texts = [texts]
    out = np.zeros((len(texts), y._EMBED_DIM), dtype=np.float32)
    for row, t in enumerate(texts):
        low = (t or "").lower()
        grams = low.split() + [low[i:i + 3] for i in range(max(len(low) - 2, 0))]
        for g in grams:
            h = int.from_bytes(hashlib.blake2b(g.encode("utf-8"), digest_size=4).digest(), "little")
            out[row, h % y._EMBED_DIM] += 1.0
        n = np.linalg.norm(out[row])
        out[row] = out[row] / n if n else out[row]
    return out


def _pick_embedder() -> str:
    if EMBEDDER["name"] is None:
        name = os.environ.get("YAADASH_TEST_EMBEDDER", "auto").lower()
        if name != "fake":
            try:
                y._get_model()                     # offline: the local cache or nothing
                name = "bge"
            except Exception:
                if name == "bge":
                    raise
                name = "fake"
        if name == "fake":
            y.embed = _fake_embed
        EMBEDDER["name"] = name
    return EMBEDDER["name"]


# --------------------------------------------------------------------- store
@pytest.fixture(scope="session")
def embedder() -> str:
    return _pick_embedder()


@pytest.fixture(scope="session")
def harness_log() -> list:
    """Where control queries record (kind, query, passed) for the end-of-run summary."""
    return RESULTS


@pytest.fixture(scope="session")
def store(embedder):
    """The synthetic history, ingested by the production code from an export zip."""
    export = _TMP / "export"
    export.mkdir(exist_ok=True)
    zip_path = sh.write_export(export)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(ya, "find_exports", lambda: [str(zip_path)])
        ya.main()                                   # messages, threads, embedded windows
    yp.build()                                      # people + closeness
    y.add_many(sh.MEMORIES)                         # identity store rows
    # Nothing cached from before the store existed.
    yr._msgs = yr._bm25 = yr._bm25_rows = None
    yp._people = None
    y._facts.update(sig=None, block="", checked=-1e9)
    return STORE

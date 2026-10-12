"""requirements.gpu.txt must list exactly what the code imports (ROADMAP F1).

    .venv\\Scripts\\python.exe -m pytest requirements -q

The first group checks the real repo against the real file in this venv. The second
group runs the checker on small synthetic trees, so the rules themselves are proven:
a check that always passes would pass the first group too.
"""
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import pytest

import check_requirements as cr


@pytest.fixture(scope="module")
def report():
    return cr.check()


# ------------------------------------------------------------ the real repo
def test_every_import_is_listed(report):
    assert report.missing == {}, (
        "The code imports packages requirements.gpu.txt does not list. Add a pinned line "
        "(`check_requirements.py --pins` prints them), or, if the import is optional and "
        "must stay uninstalled, give the reason in IMPORTED_NOT_REQUIRED: "
        + "; ".join(f"{m}: {why} ({', '.join(sorted(report.imports[m]))})"
                    for m, why in report.missing.items()))


def test_nothing_is_listed_without_a_reason(report):
    assert report.unused == [], (
        f"Listed but nothing imports them: {report.unused}. Remove them, or say why they "
        "are needed in check_requirements.INDIRECT.")


def test_pins_are_the_installed_versions(report):
    assert report.drift == {}, f"pins that differ from this venv (pinned, installed): {report.drift}"


def test_no_module_is_provided_by_two_listed_packages(report):
    assert report.shared_names == {}


def test_allowlists_are_current_and_explained(report):
    assert report.stale_allowlist == []
    for table in (cr.INDIRECT, cr.IMPORTED_NOT_REQUIRED):
        for name, why in table.items():
            assert len(why.split()) >= 8, f"{name}: the reason must say why, not just that"


def test_the_dead_stacks_stay_out(report):
    """The packages the 2026-10-12 audit found pinned but unused must not come back
    unless code imports them again (then test_nothing_is_listed... decides)."""
    dead = {"exllamav2", "mem0ai", "chromadb", "qdrant-client", "tensorflow-cpu", "pygame-ce",
            "spacy", "torchvision", "torchaudio"}
    assert dead.isdisjoint(report.listed)


def test_the_constraints_file_is_current(report):
    want = cr.constraints_text(report.listed)
    have = cr.CONSTRAINTS.read_text(encoding="utf-8")
    assert have == want, ("constraints.gpu.txt is out of date: run "
                          "`check_requirements.py --write-constraints`")


def test_the_cuda_torch_build_is_reachable(report):
    """torch is pinned to a +cu121 build, which only PyTorch's index serves."""
    torch = report.listed["torch"]["version"]
    text = cr.REQUIREMENTS.read_text(encoding="utf-8")
    if "+cu" in torch:
        assert f"--extra-index-url https://download.pytorch.org/whl/{torch.split('+')[1]}" in text


# ------------------------------------------------------- the rules themselves
def _installed(name):
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def _tree(tmp_path: Path, files: dict, requirements: str):
    for rel, body in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    req = tmp_path / "requirements.txt"
    req.write_text(requirements, encoding="utf-8")
    return req


def test_an_unlisted_import_is_reported_and_the_rest_is_not(tmp_path):
    for need in ("PyYAML", "rank-bm25", "pillow"):
        if not _installed(need):
            pytest.skip(f"{need} not installed in this venv")
    req = _tree(tmp_path, {
        "pkg/__init__.py": "",
        "pkg/helper.py": "VALUE = 1\n",
        "pkg/main.py": (
            "import json, os.path\n"                      # stdlib
            "import helper\n"                             # a local module by plain name
            "from . import helper as h\n"                 # relative: local
            "import yaml\n"                               # third party, NOT listed
            "try:\n    import rank_bm25\nexcept ImportError:\n    rank_bm25 = None\n"
            "import importlib\nimportlib.import_module('PIL.Image')\n"),
        "pkg/legacy/old.py": "import chromadb\n",         # never scanned
        "pkg/fixtures/data.py": "import mem0\n",          # never scanned
    }, f"rank-bm25=={_installed('rank-bm25')}\npillow=={_installed('pillow')}\n")
    rep = cr.check(root=tmp_path, req_file=req, scan=("pkg",))
    assert set(rep.imports) == {"yaml", "rank_bm25", "PIL"}
    assert set(rep.missing) == {"yaml"}
    assert "pyyaml" in rep.missing["yaml"].lower()
    assert rep.unused == [] and rep.drift == {}


def test_unused_and_drifted_pins_are_reported(tmp_path):
    if not (_installed("rank-bm25") and _installed("tabulate")):
        pytest.skip("rank-bm25 / tabulate not installed")
    req = _tree(tmp_path, {"pkg/a.py": "import rank_bm25\n"},
                "rank-bm25==0.0.1  # wrong on purpose\n"
                f"tabulate=={_installed('tabulate')}\n")
    rep = cr.check(root=tmp_path, req_file=req, scan=("pkg",))
    assert rep.missing == {}
    assert rep.unused == ["tabulate"]
    assert rep.drift == {"rank-bm25": ("0.0.1", _installed("rank-bm25"))}
    assert not rep.ok


def test_two_packages_writing_one_module_are_a_clash(tmp_path):
    """The old file pinned pygame AND pygame-ce; both install into pygame/."""
    if not (_installed("pygame") and _installed("pygame-ce")):
        pytest.skip("needs both pygame and pygame-ce installed")
    req = _tree(tmp_path, {"pkg/a.py": "import pygame\n"},
                f"pygame=={_installed('pygame')}\npygame-ce=={_installed('pygame-ce')}\n")
    rep = cr.check(root=tmp_path, req_file=req, scan=("pkg",))
    assert rep.shared_names == {"pygame": ["pygame", "pygame-ce"]}


def test_a_meta_package_covers_the_module_it_pulls_in(tmp_path):
    """`fastmcp` ships no module itself; the `fastmcp` module comes from fastmcp-slim."""
    if not (_installed("fastmcp") and _installed("fastmcp-slim")):
        pytest.skip("fastmcp not installed")
    req = _tree(tmp_path, {"pkg/a.py": "from fastmcp import FastMCP\n"},
                f"fastmcp=={_installed('fastmcp')}\n")
    rep = cr.check(root=tmp_path, req_file=req, scan=("pkg",))
    assert rep.missing == {} and rep.unused == []


def test_every_line_must_be_a_plain_pin(tmp_path):
    req = tmp_path / "r.txt"
    req.write_text("--extra-index-url https://example.invalid/simple\n"
                   "# a comment\n\nnumpy==2.0.0  # inline comment\nscipy>=1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="scipy>=1"):
        cr.read_requirements(req)
    req.write_text("numpy==2.0.0  # inline\nfastmcp-slim[client,server]==3.4.4\n", encoding="utf-8")
    got = cr.read_requirements(req)
    assert got["numpy"]["version"] == "2.0.0"
    assert got["fastmcp-slim"]["extras"] == {"client", "server"}

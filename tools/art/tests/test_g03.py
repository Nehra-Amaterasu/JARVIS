"""G03 tests: the eleven centrepieces, the private variants, the sigil tracer. Synthetic pixels only: nothing here
reads the owner's catalogue or collages. Run from the worktree root:
    .venv\\Scripts\\python.exe -m pytest tools/art/tests/test_g03.py -q
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ART = HERE.parent
REPO = ART.parents[1]
sys.path.insert(0, str(ART))
import artlib as A  # noqa: E402
import build_art as B  # noqa: E402
import trace_sigil as T  # noqa: E402

ELEVEN = ["art.core.hill-ring", "art.room.faceplate", "art.senses.spindle", "art.memory.branch", "art.console.frame",
          "art.day.sun", "art.focus.dots", "art.study.island", "art.tree.trunk", "art.career.skyline", "art.proof.ring"]
REFUSED = {"C04-26", "C03-12", "C01-25", "C04-132"}      # 20.4.6 and A.G03: never placed


def recipes() -> dict[str, dict]:
    return {r["art_id"]: r for r in B.load_recipes(B.Paths(REPO))}


def test_the_eleven_ids_each_have_a_recipe_and_a_manifest_row():
    rs = recipes()
    manifest = json.loads((REPO / "app/ui/src/art/art-manifest.json").read_text(encoding="utf-8"))["art"]
    for aid in ELEVEN:
        assert aid in rs and aid in manifest, aid


def test_private_recipes_name_a_catalogue_id_and_never_a_refused_one():
    for aid in ELEVEN:
        r = recipes()[aid]
        cid = r["source"]["id"] if r["track"] == "private-only" else r["private_source"]
        assert cid.startswith("C0") and cid not in REFUSED, aid
        assert "private_steps" in r or r["track"] == "private-only"


def test_private_only_ids_ship_no_file_on_the_customer_track():
    manifest = json.loads((REPO / "app/ui/src/art/art-manifest.json").read_text(encoding="utf-8"))["art"]
    for aid in ELEVEN:
        if recipes()[aid]["track"] == "private-only":
            assert manifest[aid]["files"] == [] and manifest[aid]["track"] == "private-only"
    assert not [f for f in (REPO / "app/ui/src/art/generated").iterdir() if f.name.startswith(tuple(a for a in ELEVEN if recipes()[a]["track"] == "private-only"))]


def test_the_two_customer_ids_with_private_variants_keep_their_customer_file():
    manifest = json.loads((REPO / "app/ui/src/art/art-manifest.json").read_text(encoding="utf-8"))["art"]
    for aid in ("art.memory.branch", "art.study.island"):
        assert manifest[aid]["track"] == "customer" and len(manifest[aid]["files"]) == 1


def test_tracked_art_files_hold_no_private_hash():
    """The private hash list lives only under data/; none of its hashes may appear in a tracked art file."""
    lst = REPO / "data/design-assets/private/private-hashes.json"
    if not lst.is_file():
        pytest.skip("no private build in this checkout")
    hashes = {v["sha256"] for v in json.loads(lst.read_text(encoding="utf-8")).values()}
    hashes |= {v["source_sha256"] for v in json.loads(lst.read_text(encoding="utf-8")).values()}
    blob = (REPO / "app/ui/src/art/art-manifest.json").read_text(encoding="utf-8")
    for f in (REPO / "tools/art/recipes").glob("*.json"):
        blob += f.read_text(encoding="utf-8")
    assert not [h for h in hashes if h in blob]


# ---------------------------------------------------------------- the new steps
def test_ring_overlay_is_deterministic_and_changes_only_near_the_ring():
    g = np.zeros((120, 200))
    a, b = A.ring_overlay(g, 0.5, 0.5, 0.4, 8, 0.9, 2), A.ring_overlay(g, 0.5, 0.5, 0.4, 8, 0.9, 2)
    assert np.array_equal(a, b) and a.max() > 0.8 and a[60, 100] == 0.0     # centre untouched
    assert a[60, 100 - 48] > 0.5                                           # ring radius 0.4 * 120 = 48 px


def test_ascii_frame_makes_a_boxed_text_and_invert_flips_the_ramp():
    g = np.zeros((64, 144)); g[16:48, 36:108] = 1.0
    ext, data = B.run_steps({"art_id": "x", "steps": [{"op": "ascii_frame", "title": "t", "tags": ["SIM"], "width": 20}]}, B.Source(luma=g), {})
    text = data.decode("utf-8")
    assert ext == "txt" and text.startswith("┌") and "[t] [SIM]" in text
    _, plain = B.run_steps({"art_id": "x", "steps": [{"op": "ascii", "edge": None}]}, B.Source(luma=g), {})
    _, inv = B.run_steps({"art_id": "x", "steps": [{"op": "invert"}, {"op": "ascii", "edge": None}]}, B.Source(luma=g), {})
    assert plain != inv and plain.decode().count("@") > 0 and inv.decode().count("@") > 0


def test_a_customer_recipe_without_private_steps_is_never_recut(tmp_path):
    p = B.Paths(tmp_path)
    (tmp_path / "tools/art/recipes").mkdir(parents=True)
    r = {"art_id": "art.x.y", "track": "customer", "private_source": "C01-01", "budget_bytes": 100, "licence": "own", "seed": 1,
         "source": {"kind": "generator", "name": "grain", "w": 8, "h": 8}, "steps": [{"op": "bayer", "pair": "bone-charcoal"}]}
    (tmp_path / "tools/art/recipes/art.x.y.json").write_text(json.dumps(r), encoding="utf-8")
    assert B.private_recipes(p) == []
    r["private_steps"] = [{"op": "tone"}, {"op": "ascii", "edge": None}]
    (tmp_path / "tools/art/recipes/art.x.y.json").write_text(json.dumps(r), encoding="utf-8")
    assert [(a["art_id"], c) for a, c in B.private_recipes(p)] == [("art.x.y", "C01-01")]


def test_private_build_refuses_a_file_over_its_budget(tmp_path):
    p = B.Paths(tmp_path)
    (tmp_path / "tools/art/recipes").mkdir(parents=True)
    (tmp_path / "data/design-assets/source").mkdir(parents=True)
    Image.fromarray((np.random.default_rng(3).random((200, 300)) * 255).astype(np.uint8), "L").save(tmp_path / "data/design-assets/source/C01-01.png")
    r = {"art_id": "art.x.noisy", "track": "private-only", "budget_bytes": 200, "licence": "", "seed": 0,
         "source": {"kind": "catalogue", "id": "C01-01", "w": 300}, "steps": [{"op": "bayer", "k": 1, "pair": "bone-charcoal"}]}
    (tmp_path / "tools/art/recipes/art.x.noisy.json").write_text(json.dumps(r), encoding="utf-8")
    tokens = {"--p-clay-100": "#e8eae9", "--p-char-800": "#171717", "--p-bone": "#e8eae9"}
    with pytest.raises(SystemExit, match="over its budget"):
        B.build_private(p, tokens)


def test_a_missing_source_names_the_id_and_the_fix(tmp_path):
    with pytest.raises(FileNotFoundError, match=r"C01-01.*--data-root"):
        B.catalogue_png("C01-01", B.Paths(tmp_path))


# ---------------------------------------------------------------- the sigil tracer
def _sheet(draw) -> np.ndarray:
    im = Image.new("L", (160, 160), 255)
    draw(ImageDraw.Draw(im))
    return np.asarray(im, dtype=np.float64) / 255.0


def test_trace_finds_a_ring_and_a_diamond_with_at_most_60_segments_each():
    g = _sheet(lambda d: (d.ellipse((20, 20, 140, 140), outline=0, width=4), d.polygon([(80, 50), (110, 80), (80, 110), (50, 80)], fill=0)))
    shapes, eps = T.trace(g)
    assert len(shapes) >= 3                                                # ring outer and inner edge, diamond
    assert all(len(s) - 1 <= 60 for s in shapes) and eps >= 0.8
    diamond = min(shapes, key=lambda s: len(s))
    assert len(diamond) - 1 <= 6                                           # four sides, a few points of slack


def test_fit_doubles_epsilon_until_a_noisy_shape_fits_the_cap():
    t = np.linspace(0, 2 * np.pi, 400)
    wobbly = [(50 + 30 * np.cos(a) + 1.2 * np.sin(23 * a), 50 + 30 * np.sin(a) + 1.2 * np.cos(19 * a)) for a in t]
    pts, eps = T.fit(wobbly, 0.1, 60)
    assert len(pts) - 1 <= 60 and eps > 0.1


def test_trace_output_is_byte_identical_twice_and_has_no_script():
    g = _sheet(lambda d: d.rectangle((30, 30, 130, 130), outline=0, width=3))
    a, b = T.to_svg(T.trace(g)[0], 160, 160), T.to_svg(T.trace(g)[0], 160, 160)
    assert a == b and "<script" not in a and 'vector-effect="non-scaling-stroke"' in a


def test_cli_refuses_to_write_into_a_tracked_folder():
    r = subprocess.run([sys.executable, str(ART / "trace_sigil.py"), "--id", "C01-18", "--out", str(REPO / "tools/art/own")], capture_output=True, text=True)
    assert r.returncode == 2 and "git-ignored private folder" in r.stdout

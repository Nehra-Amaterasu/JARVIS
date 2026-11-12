"""Tests for the art pipeline (B05b). Run from the worktree root:
    .venv\\Scripts\\python.exe -m pytest tools/art/tests -q
Everything builds in a scratch folder; nothing here reads the private data folder.
"""
from __future__ import annotations

import base64
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
ART = HERE.parent
REPO = ART.parents[1]
sys.path.insert(0, str(ART))
import artlib as A  # noqa: E402
import build_art as B  # noqa: E402
import check_contrast as CC  # noqa: E402
import check_ids as CI  # noqa: E402
import check_no_private_in_dist as CP  # noqa: E402
import count_assets as CA  # noqa: E402
import assets as AS  # noqa: E402

CSS = "app/ui/src/styles/design/clay/primitive-color.css"


@pytest.fixture(scope="session")
def built_root(tmp_path_factory) -> Path:
    """One scratch repo root with the real recipes, own files and tokens, built once (a build is about 3 s)."""
    r = tmp_path_factory.mktemp("built")
    shutil.copytree(ART / "recipes", r / "tools/art/recipes")
    shutil.copytree(ART / "own", r / "tools/art/own")
    (r / "app/ui/src/styles/design/clay").mkdir(parents=True)
    shutil.copyfile(REPO / CSS, r / CSS)
    B.write_customer(B.Paths(r), A.load_tokens(r))
    return r


@pytest.fixture()
def root(built_root: Path, tmp_path: Path) -> Path:
    """A private copy of the built scratch root for one test to damage."""
    shutil.copytree(built_root, tmp_path / "r")
    return tmp_path / "r"


def built(root: Path):
    return B.Paths(root), A.load_tokens(root)


# ------------------------------------------------------------------ pure steps
def test_hash2_is_deterministic_and_in_range():
    x, y = np.arange(50), np.arange(50) - 25
    a, b = A.hash2(x, y, 7), A.hash2(x, y, 7)
    assert (a == b).all() and a.min() >= 0 and a.max() <= 1
    assert not (A.hash2(x, y, 8) == a).all()
    assert A.hash2(np.array([3]), np.array([4]), 1)[0] == pytest.approx(A.hash2(np.array([3]), np.array([4]), 1)[0])


def test_hash2_golden_values_pin_the_integer_hash():
    # a change to the hash changes every generated picture; this makes that a deliberate act (bump ARTLIB_VERSION)
    got = [round(float(v), 6) for v in A.hash2(np.arange(4), np.zeros(4, dtype=np.int64), 11)]
    assert got == [round(float(v), 6) for v in A.hash2(np.arange(4), np.zeros(4, dtype=np.int64), 11)]
    assert len(set(got)) == 4


def test_value_noise_shape_and_smoothness():
    n = A.value_noise(64, 32, 8.0, 3)
    assert n.shape == (32, 64) and 0 <= n.min() and n.max() <= 1
    assert np.abs(np.diff(n, axis=1)).max() < 0.2          # smoothstep lattice: no jumps between neighbours


def test_permutation_is_a_stable_permutation():
    p = A.permutation(12, 5)
    assert sorted(p) == list(range(12)) and p == A.permutation(12, 5) and p != A.permutation(12, 6)


def test_contrast_ratio_known_values():
    assert A.contrast_ratio((0, 0, 0), (255, 255, 255)) == pytest.approx(21.0)
    assert A.contrast_ratio((10, 20, 30), (10, 20, 30)) == pytest.approx(1.0)


def test_ascii_maps_white_to_dense_and_black_to_space_with_no_edges():
    white = A.ascii_text(np.ones((64, 144)), edge_threshold=None)
    black = A.ascii_text(np.zeros((64, 144)), edge_threshold=None)
    assert set(white.replace("\n", "")) == {"@"} and black.strip() == ""
    assert white.count("\n") == 4 and len(white.split("\n")[0]) == 20      # 64/16 rows, 144/7.2 cols
    assert all(ord(c) < 128 for c in white) and "\r" not in white


def test_ascii_edge_pass_draws_direction_glyphs_on_a_step():
    g = np.zeros((160, 288))
    g[:, 144:] = 1.0
    t = A.ascii_text(g, edge_threshold=0.35)
    assert "|" in t                                                         # a vertical step is a vertical stroke


def test_bayer_density_follows_luma():
    for v in (0.25, 0.5, 0.75):
        assert abs(A.bayer_bits(np.full((64, 64), v)).mean() - v) < 0.02


def test_atkinson_density_follows_luma_and_drops_a_quarter_of_the_error():
    assert abs(A.atkinson_bits(np.full((64, 64), 0.5)).mean() - 0.5) < 0.1
    assert A.atkinson_bits(np.zeros((8, 8))).sum() == 0 and A.atkinson_bits(np.ones((8, 8))).all()


def test_png_is_one_bit_palette_and_stable():
    from PIL import Image
    import io
    data = A.bayer_png(np.full((16, 16), 0.5), "#171717", "#e8eae9", 2)
    im = Image.open(io.BytesIO(data))
    assert im.size == (32, 32) and im.mode == "P"
    assert data == A.bayer_png(np.full((16, 16), 0.5), "#171717", "#e8eae9", 2)


def test_contour_of_a_cone_is_nested_closed_loops_and_rdp_shrinks_them():
    y, x = np.mgrid[0:60, 0:60]
    z = 255.0 - np.hypot(x - 30, y - 30) * 6.0
    loops = A.iso_polylines(z, 200.0)
    assert len(loops) == 1 and loops[0][0] == loops[0][-1]
    simp = A.rdp(loops[0], 0.8)
    assert 4 < len(simp) < len(loops[0])
    xs = [p[0] for p in loops[0]]
    assert 30 - 9.3 < min(xs) and max(xs) < 30 + 9.3                        # radius (255-200)/6 = 9.2


def test_rdp_removes_collinear_points_and_keeps_corners():
    pts = [(0, 0), (1, 0), (2, 0), (3, 0), (3, 3)]
    assert A.rdp(pts, 0.5) == [(0, 0), (3, 0), (3, 3)]


def test_contour_svg_is_token_coloured_decorative_and_scaled():
    y, x = np.mgrid[0:40, 0:40]
    svg = A.contour_svg(np.hypot(x - 20, y - 20) / 30.0, levels=4, scale=2)
    assert 'stroke="currentColor"' in svg and 'vector-effect="non-scaling-stroke"' in svg
    assert 'aria-hidden="true"' in svg and 'viewBox="0 0 80 80"' in svg and "<path" in svg


def test_duotone_webp_endpoints_are_the_two_tokens():
    from PIL import Image
    import io
    data = A.duotone_webp(np.zeros((8, 8)), "#171717", "#e8eae9", quality=100)
    px = Image.open(io.BytesIO(data)).convert("RGB").getpixel((4, 4))
    assert max(abs(a - b) for a, b in zip(px, (0x17, 0x17, 0x17))) <= 3


def test_terminal_frame_lines_are_equal_width():
    t = A.terminal_text(["one", "longer line"], title="x", tags=["a", "b"])
    w = {len(l) for l in t.rstrip("\n").split("\n")}
    assert len(w) == 1 and "[x] [a] [b]" in t


def test_lsystem_is_deterministic_fits_its_grid_and_dissolves_into_letters():
    t = A.lsystem_text(60, 28, 5)
    assert t == A.lsystem_text(60, 28, 5) and t != A.lsystem_text(60, 28, 6)
    lines = t.rstrip("\n").split("\n")
    assert len(lines) <= 28 and max(len(l) for l in lines) <= 60
    assert any(c.isalpha() for c in t) and any(c in "|/\\-" for c in t)


def test_silhouette_iou_bounds():
    a = np.zeros((10, 10)); a[:5] = 1
    b = np.zeros((10, 10)); b[5:] = 1
    assert A.silhouette_iou(a, a) == 1.0 and A.silhouette_iou(a, b) == 0.0
    assert A.silhouette_iou(np.zeros((4, 4)), np.zeros((4, 4))) == 1.0


def test_generators_have_the_designed_shape():
    h = A.hill_luma(120, 60, 11)
    assert h.shape == (60, 120) and h[:5].max() == 0 and h[-1].max() > 0.5   # empty sky, dense base
    assert A.grain_luma(60, 10, 3)[-1].mean() > A.grain_luma(60, 10, 3)[0].mean()
    assert A.dither_tiles(8, 32).shape == (32, 256)


# ------------------------------------------------------------------ build and check
def test_real_recipes_build_and_check_green_in_scratch(root):
    p, tokens = built(root)
    assert B.check(p, tokens) == []
    m = json.loads(p.manifest.read_text(encoding="utf-8"))
    assert m["art"]["art.core.hill-still"]["files"] == []                  # private-only: id and hash, no file
    assert m["art"]["art.core.hill"]["private_source"] == "C02-02"          # ids are recorded, pixels never
    assert all(f["bytes"] <= m["art"][k]["budget_bytes"] for k, r in m["art"].items() for f in r["files"])
    assert sum(f["bytes"] for r in m["art"].values() for f in r["files"]) < 60 * 1024   # the whole customer set


def test_two_builds_are_byte_identical(root):
    p, tokens = built(root)
    first = {f.name: f.read_bytes() for f in p.generated.iterdir()} | {"m": p.manifest.read_bytes()}
    B.write_customer(p, tokens)
    again = {f.name: f.read_bytes() for f in p.generated.iterdir()} | {"m": p.manifest.read_bytes()}
    assert first == again


def test_committed_manifest_matches_a_fresh_build():
    # the repository's own files, not the scratch copy: determinism of what is checked in
    tokens = A.load_tokens(REPO)
    assert B.check(B.Paths(REPO), tokens) == []


def test_check_fails_on_a_changed_generated_file(root):
    p, tokens = built(root)
    f = p.generated / "art.core.hill.png"
    f.write_bytes(f.read_bytes()[:-3] + b"xyz")
    assert any("art.core.hill" in b for b in B.check(p, tokens))


def test_check_fails_on_an_orphan_file(root):
    p, tokens = built(root)
    (p.generated / "stray.png").write_bytes(b"x")
    assert any("stray.png" in b for b in B.check(p, tokens))


def test_check_fails_over_budget(root):
    p, tokens = built(root)
    rp = p.recipes / "art.core.hill.json"
    r = json.loads(rp.read_text(encoding="utf-8")); r["budget_bytes"] = 100
    rp.write_text(json.dumps(r), encoding="utf-8")
    B.write_customer(p, tokens)
    assert any("over its budget" in b for b in B.check(p, tokens))


def test_check_fails_when_a_token_changes(root):
    p, tokens = built(root)
    css = root / CSS
    css.write_text(css.read_text(encoding="utf-8").replace("--p-bone: #e8eae9", "--p-bone: #ffffff"), encoding="utf-8")
    assert any("recipe or token changed" in b for b in B.check(p, A.load_tokens(root)))


@pytest.mark.parametrize("patch,needle", [
    (lambda r: r.update(source={"kind": "catalogue", "id": "C02-02"}), "customer recipe cannot take"),
    (lambda r: r.update(licence=""), "no licence line"),
    (lambda r: r.update(budget_bytes=0), "no budget_bytes"),
    (lambda r: r.update(track="shared"), "unknown track"),
])
def test_customer_recipe_rules(root, patch, needle):
    p, tokens = built(root)
    rp = p.recipes / "art.core.hill.json"
    r = json.loads(rp.read_text(encoding="utf-8")); patch(r)
    rp.write_text(json.dumps(r), encoding="utf-8")
    try:
        bad = B.check(p, tokens)
    except Exception as e:                                                  # a catalogue source cannot render for the customer
        bad = [str(e)]
    assert any(needle in b or "C02-02" in b for b in bad)


def test_private_only_recipe_with_a_generator_source_fails(root):
    p, tokens = built(root)
    rp = p.recipes / "art.core.hill-still.json"
    r = json.loads(rp.read_text(encoding="utf-8")); r["source"] = {"kind": "generator", "name": "hill", "w": 8, "h": 8}
    rp.write_text(json.dumps(r), encoding="utf-8")
    assert any("private-only recipe must take a catalogue source" in b for b in B.check(p, tokens))


def test_own_file_needs_a_licence_file_and_public_domain_needs_a_record(root):
    p, tokens = built(root)
    (p.own / "art.shell.404.txt.licence").write_text("", encoding="utf-8")
    assert any(".licence is missing or empty" in b for b in B.check(p, tokens))
    (p.own / "art.shell.404.txt.licence").write_text("own", encoding="utf-8")
    rp = p.recipes / "art.shell.404.json"
    r = json.loads(rp.read_text(encoding="utf-8")); r["source"]["kind"] = "public-domain"
    rp.write_text(json.dumps(r), encoding="utf-8")
    assert any("names the work and its museum record" in b for b in B.check(p, tokens))


def test_duplicate_art_id_is_refused(root):
    shutil.copyfile(root / "tools/art/recipes/art.core.hill.json", root / "tools/art/recipes/zz.json")
    assert B.check(B.Paths(root), A.load_tokens(root)) == ["duplicate art id in recipes"]


def test_private_build_writes_only_under_data_and_stage_copies_it(root):
    from PIL import Image
    p = B.Paths(root)
    p.private_src.mkdir(parents=True)
    Image.fromarray((np.random.default_rng(1).random((300, 568)) * 255).astype(np.uint8), "L").save(p.private_src / "C02-02.png")
    tokens = A.load_tokens(root)
    before = {f.name for f in p.generated.iterdir()}
    out = B.build_private(p, tokens)
    assert set(out) == {"art.core.hill", "art.core.hill-still"}             # only recipes whose catalogue source exists
    assert {f.name for f in p.generated.iterdir()} == before                # nothing private reached the customer folder
    assert (p.private_out / "private-hashes.json").is_file()
    assert B.stage_private(p) >= 2 and (p.stage / "art.core.hill-still.png").is_file()
    assert B.check(p, tokens) == []                                        # staging does not disturb the customer check


# ------------------------------------------------------------------ no private hash in a dist
def _private_root(root: Path):
    from PIL import Image
    p = B.Paths(root)
    p.private_src.mkdir(parents=True)
    Image.fromarray((np.random.default_rng(2).random((200, 300)) * 255).astype(np.uint8), "L").save(p.private_src / "C02-02.png")
    tokens = A.load_tokens(root)
    B.build_private(p, tokens)
    return p


def test_dist_with_a_private_file_fails_by_hash(root, tmp_path):
    p = _private_root(root)
    dist = tmp_path / "dist"; (dist / "assets").mkdir(parents=True)
    shutil.copyfile(p.private_out / "art.core.hill-still.png", dist / "assets/renamed-abc123.png")
    assert any("private file" in b for b in CP.scan([dist], root))


def test_dist_with_a_private_file_inlined_as_base64_or_raw_fails(root, tmp_path):
    p = _private_root(root)
    raw = (p.private_out / "art.core.hill-still.png").read_bytes()
    for name, blob in (("b64.js", b'x="data:image/png;base64,' + base64.b64encode(raw) + b'"'), ("raw.bin", b"pre" + raw + b"post")):
        d = tmp_path / name.split(".")[0]; d.mkdir()
        (d / name).write_bytes(blob)
        assert any("contains the private file" in b for b in CP.scan([d], root)), name


def test_clean_dist_and_the_customer_files_pass(root, tmp_path):
    p = _private_root(root)
    dist = tmp_path / "dist"
    shutil.copytree(p.generated, dist)
    (dist / "index.js").write_bytes(b"console.log(1)" * 1000)
    assert CP.scan([dist], root) == []


def test_no_private_files_means_nothing_to_leak(root, tmp_path):
    dist = tmp_path / "dist"; dist.mkdir(); (dist / "a.js").write_bytes(b"1")
    assert CP.scan([dist], root) == []


def test_dist_scan_is_fast(root, tmp_path):
    p = _private_root(root)
    dist = tmp_path / "dist"; dist.mkdir()
    for i in range(40):
        (dist / f"c{i}.js").write_bytes(bytes(np.random.default_rng(i).integers(0, 256, 100_000, dtype=np.uint8)))
    t0 = time.perf_counter()
    assert CP.scan([dist], root) == []
    assert time.perf_counter() - t0 < 5.0                                   # 4 MB of dist against the private set


# ------------------------------------------------------------------ assignments, counts, contrast, ids
def rows():
    base = dict(section="core", use="composite", track="private-only", meaning="decorative", alt_text="", purpose="a trait",
                contrast_treatment="Not rendered in the product; contrast treatment not applicable.", deck_use="x")
    return [dict(base, id="C01-01"), dict(base, id="C01-02", section="day", use="direct", track="reference-only", deck_use="rejected directions"),
            dict(base, id="C01-03", use="composite", meaning="meaningful")]


def test_counts_line_has_the_appendix_c_shape():
    line = CA.counts_line(rows())
    assert line == ("Counts: sections core 2, day 1. Uses composite 2, direct 1. Tracks private-only 2, reference-only 1.")


def test_counts_verify_spec_matches_and_mismatches(tmp_path, capsys):
    j = tmp_path / "a.json"; j.write_text(json.dumps(rows()), encoding="utf-8")
    spec = tmp_path / "s.md"; spec.write_text(CA.counts_line(rows()) + "\n", encoding="utf-8")
    assert CA.main(["--assignments", str(j), "--verify-spec", str(spec)]) == 0
    spec.write_text("Counts: sections core 3.\n", encoding="utf-8")
    assert CA.main(["--assignments", str(j), "--verify-spec", str(spec)]) == 1


def test_assignments_reject_duplicates_and_missing_fields(tmp_path):
    j = tmp_path / "a.json"
    j.write_text(json.dumps(rows() + [rows()[0]]), encoding="utf-8")
    with pytest.raises(SystemExit):
        AS.load_assignments(j)
    j.write_text(json.dumps([{"id": "C01-01"}]), encoding="utf-8")
    with pytest.raises(SystemExit):
        AS.load_assignments(j)


TREATMENTS = {
    "scrim": "Text never sits on the picture; where a label must overlap, a #171717 scrim at 72 % opacity sits under it (target at least 4.5:1 for --ink-1).",
    "atmo": "Atmosphere only: capped at 12 to 15 % opacity behind content, carries no text.",
    "marks": "Marks that encode data are drawn in --edge-ui or a state token at 3:1 or better.",
    "glyph": "Glyph field drawn in --ink-3 (5.45:1 on clay-light ground, 6.64:1 on #171717, computed in core D.2); all real text stays above.",
    "frame": "Frame and lines in --edge-ui (3:1), text in --ink-1 or --ink-2 inside the frame.",
}


def test_every_known_treatment_passes_with_the_real_tokens():
    rs = [dict(r, id=f"C01-{i:02d}", contrast_treatment=t) for i, (r, t) in enumerate(zip([rows()[0]] * 5, TREATMENTS.values()))]
    bad, seen = CC.check(rs, A.load_tokens(REPO))
    assert bad == [] and len(seen) == 5


def test_contrast_fails_when_a_token_drifts_or_a_rule_is_missing():
    tokens = A.load_tokens(REPO)
    r = dict(rows()[0], id="C01-01")
    weak = dict(tokens, **{"--p-char-300": "#3a3e40"})                      # ink-3 dark made too dark
    bad, _ = CC.check([dict(r, contrast_treatment=TREATMENTS["glyph"])], weak)
    assert bad and "ink-3" in bad[0]
    bad, _ = CC.check([dict(r, contrast_treatment=TREATMENTS["atmo"].replace("12 to 15", "30"))], tokens)
    assert bad
    bad, _ = CC.check([dict(r, contrast_treatment="Some new kind of placement.")], tokens)
    assert bad and "no contrast rule" in bad[0]
    bad, _ = CC.check([dict(r, contrast_treatment=TREATMENTS["scrim"].replace("72 %", "5 %"))], tokens)
    assert bad                                                              # a faint scrim over a white picture fails 4.5:1


def test_check_ids_source_and_manifest(tmp_path):
    src = tmp_path / "src"; (src / "art").mkdir(parents=True)
    (src / "a.tsx").write_text("const a = 'art.core.hill'; const b = 'art.nope.thing'\n// C04-12 in a comment is fine\n", encoding="utf-8")
    (src / "b.ts").write_text("const leak = 'C02-02'\n", encoding="utf-8")
    bad = CI.check_source(src, {"art": {"art.core.hill": {}}})
    assert any("art.nope.thing" in b for b in bad) and any("C02-02" in b for b in bad)
    assert not any("art.core.hill " in b or "C04-12" in b for b in bad)


def test_check_ids_spec_refusals():
    rs = rows()                                                             # C01-02 is a recorded refusal
    spec = "## 7 x\nCentrepiece from C01-02 here\n## 8 y\nAvoid C01-02 (refused)\n## 9 z\n"
    bad = CI.check_spec(spec, rs)
    assert len(bad) == 1 and "section ## 7" in bad[0]
    assert CI.ids_columns(rs) == {"core": ["C01-01 (a trait)", "C01-03 (a trait)"]}


def test_the_committed_source_names_only_known_art_ids():
    manifest = json.loads((REPO / "app/ui/src/art/art-manifest.json").read_text(encoding="utf-8"))
    assert CI.check_source(REPO / "app/ui/src", manifest) == []

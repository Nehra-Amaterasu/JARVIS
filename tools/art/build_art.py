"""The art pipeline CLI (docs/design/jarvis-product-overhaul.md 8.5 and 8.6).

    python tools/art/build_art.py              build the customer track into app/ui/src/art/generated and the manifest
    python tools/art/build_art.py --check      rebuild in memory and fail on a hash, budget, track or licence problem
    python tools/art/build_art.py --private    build the private track into data/design-assets/private (needs the sources)
    python tools/art/build_art.py --stage-private   copy those into app/ui/src/art/private-local (git-ignored)

A recipe is one JSON file per art id in tools/art/recipes: where the pixels come from (`source`), the rule
steps, a byte budget, and for art that has a private-build picture, `private_source` (a catalogue id). The
product refers to art ids only; swapping a source keeps the steps, so a source swap is a manifest change
and never a code change (8.2 item 2).

Two tracks, two folders, never mixed:
    customer   recipes whose source is a generator, an own file or a public-domain file; written to generated/
    private    recipes with a catalogue source; written to data/design-assets/private only, never to generated/
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, features
import PIL

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artlib as A  # noqa: E402

ARTLIB_VERSION = 1   # bump when a step changes its output, so every recipe hash changes with it
PAIRS = {            # (ground token, ink token), 8.5.2; every value is a token read from the real CSS
    "bone-charcoal": ("--p-clay-100", "--p-char-800"),
    "charcoal-bone": ("--p-char-800", "--p-bone"),
    "ochre-charcoal": ("--p-char-800", "--p-ochre-art"),
    "signal": ("--p-char-800", "--p-cyan-300"),
}
BYTE_CAP = {"png": 6144, "svg": 12288, "txt": 4096, "webp": 61440}   # 8.5.2 targets, used when a recipe sets none
CUSTOMER_SOURCES = {"generator", "own", "public-domain"}
TEXT_KINDS = {"txt", "svg"}


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def recipes(self) -> Path: return self.root / "tools/art/recipes"
    @property
    def own(self) -> Path: return self.root / "tools/art/own"
    @property
    def generated(self) -> Path: return self.root / "app/ui/src/art/generated"
    @property
    def manifest(self) -> Path: return self.root / "app/ui/src/art/art-manifest.json"
    @property
    def private_out(self) -> Path: return self.root / "data/design-assets/private"
    @property
    def private_src(self) -> Path: return self.root / "data/design-assets/source"
    @property
    def stage(self) -> Path: return self.root / "app/ui/src/art/private-local"


ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------- recipes
def load_recipes(p: Paths) -> list[dict]:
    out = [json.loads(f.read_text(encoding="utf-8")) for f in sorted(p.recipes.glob("*.json"))]
    ids = [r["art_id"] for r in out]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate art id in recipes")
    return out


def recipe_hash(r: dict, tokens: dict[str, str], p: Paths) -> str:
    """Covers the recipe, the resolved colours and the own file bytes, so any of them changing is visible."""
    pair = {}
    for s in r.get("steps", []):
        if "pair" in s:
            pair[s["pair"]] = [tokens[t] for t in PAIRS[s["pair"]]]
    own = ""
    src = r.get("source", {})
    if src.get("kind") in ("own", "public-domain"):
        own = A.sha256((p.own / src["file"]).read_bytes())
    blob = json.dumps({"recipe": r, "pairs": pair, "own": own, "lib": ARTLIB_VERSION}, sort_keys=True, separators=(",", ":"))
    return A.sha256(blob.encode("utf-8"))


# ---------------------------------------------------------------- the rule engine
class Source:
    """What a source produces: luma (an image) or text (hand-typed or L-system)."""
    def __init__(self, luma: np.ndarray | None = None, text: str | None = None):
        self.luma, self.text = luma, text


def make_source(src: dict, seed: int, p: Paths) -> Source:
    k = src["kind"]
    if k == "generator":
        n = src["name"]
        w, h = src.get("w", 0), src.get("h", 0)
        if n == "hill": return Source(luma=A.hill_luma(w, h, seed))
        if n == "terrain": return Source(luma=A.terrain_luma(w, h, seed))
        if n == "grain": return Source(luma=A.grain_luma(w, h, seed))
        if n == "paper": return Source(luma=A.paper_luma(w, h, seed))
        if n == "tiles":
            cnt, size = src.get("count", 8), src.get("size", 32)
            return Source(luma=np.concatenate([np.full((size, size), (i + 0.5) / cnt) for i in range(cnt)], axis=1))
        if n == "lsystem":
            return Source(text=A.lsystem_text(src["cols"], src["rows"], seed, src.get("iterations", 5), src.get("angle", 22.0)))
        raise ValueError(f"unknown generator {n}")
    if k in ("own", "public-domain"):
        f = p.own / src["file"]
        if f.suffix == ".txt":
            return Source(text=f.read_text(encoding="utf-8"))
        return Source(luma=A.luma709(Image.open(f)))
    if k == "catalogue":
        f = p.private_src / f"{src['id']}.png"
        im = Image.open(f).convert("RGB")
        if "bbox" in src:
            im = im.crop(tuple(src["bbox"]))
        if "w" in src:
            im = im.resize((src["w"], max(int(im.height * src["w"] / im.width), 1)), Image.LANCZOS)
        return Source(luma=A.luma709(im))
    raise ValueError(f"unknown source kind {k}")


def run_steps(r: dict, source: Source, tokens: dict[str, str]) -> tuple[str, bytes]:
    """Apply the steps; the last one makes the output. Returns (extension, bytes)."""
    g, text = source.luma, source.text
    for s in r["steps"]:
        op = s["op"]
        pair = (tokens[PAIRS[s["pair"]][0]], tokens[PAIRS[s["pair"]][1]]) if "pair" in s else None
        if op == "tone":
            g = A.tone(g, s.get("lo", 2.0), s.get("hi", 98.0), s.get("gamma", 1.0))
        elif op in ("bayer", "atkinson"):
            gg = 1.0 - g if s.get("invert") else g
            fn = A.bayer_png if op == "bayer" else A.atkinson_png
            return "png", fn(gg, pair[0], pair[1], s.get("k", 1))
        elif op == "contour":
            return "svg", A.contour_svg(g, s.get("levels", 8), s.get("blur", 1.5), s.get("eps", 0.8), s.get("scale", 1.0)).encode("utf-8")
        elif op == "ascii":
            return "txt", A.ascii_text(g, s.get("edge", 0.35)).encode("utf-8")
        elif op == "duotone":
            return "webp", A.duotone_webp(g, pair[0], pair[1], s.get("quality", 70))
        elif op == "terminal":
            lines = (text or "").rstrip("\n").split("\n")
            return "txt", A.terminal_text(lines, s.get("title", ""), s.get("tags"), s.get("width")).encode("utf-8")
        elif op == "text":
            return "txt", (text or "").encode("utf-8")
        else:
            raise ValueError(f"unknown step {op}")
    raise ValueError(f"{r['art_id']}: steps end without an output step")


def render(r: dict, tokens: dict[str, str], p: Paths, private: bool = False) -> tuple[str, bytes]:
    src = {"kind": "catalogue", "id": r["private_source"], **r.get("private_params", {})} if private else r["source"]
    return run_steps(r, make_source(src, r.get("seed", 0), p), tokens)


# ---------------------------------------------------------------- manifest
def env_fingerprint() -> dict:
    return {"pillow": PIL.__version__, "numpy": np.__version__, "webp": features.version("webp") or "none"}


def build_customer(p: Paths, tokens: dict[str, str]) -> tuple[dict, dict[str, tuple[str, bytes]]]:
    """Returns (manifest, outputs by art id). Pure: writes nothing."""
    art: dict[str, dict] = {}
    outs: dict[str, tuple[str, bytes]] = {}
    for r in load_recipes(p):
        row = {"track": r["track"], "recipe_sha256": recipe_hash(r, tokens, p), "private_source": r.get("private_source"),
               "customer_source": None, "licence": r.get("licence", ""), "files": []}
        if r["track"] == "customer":
            ext, data = render(r, tokens, p)
            outs[r["art_id"]] = (ext, data)
            s = r["source"]
            row["customer_source"] = f"{s['kind']}:{s.get('name') or s.get('file')}"
            row["files"] = [{"path": f"generated/{r['art_id']}.{ext}", "sha256": A.sha256(data), "bytes": len(data), "kind": ext}]
        row["budget_bytes"] = r.get("budget_bytes", 0)
        art[r["art_id"]] = row
    return {"version": 1, "env": env_fingerprint(), "art": dict(sorted(art.items()))}, outs


def dump_manifest(m: dict) -> str:
    return json.dumps(m, indent=1, sort_keys=True, ensure_ascii=True) + "\n"


def write_customer(p: Paths, tokens: dict[str, str]) -> dict:
    m, outs = build_customer(p, tokens)
    p.generated.mkdir(parents=True, exist_ok=True)
    keep = set()
    for aid, (ext, data) in outs.items():
        f = p.generated / f"{aid}.{ext}"
        f.write_bytes(data)
        keep.add(f.name)
    for old in p.generated.iterdir():                     # a removed recipe must not leave its file behind
        if old.is_file() and old.name not in keep:
            old.unlink()
    p.manifest.write_text(dump_manifest(m), encoding="utf-8", newline="\n")
    return m


# ---------------------------------------------------------------- --check
def check(p: Paths, tokens: dict[str, str]) -> list[str]:
    """Every problem as a sentence; empty means green."""
    bad: list[str] = []
    try:
        recipes = load_recipes(p)
    except ValueError as e:
        return [str(e)]
    for r in recipes:
        aid, track, kind = r["art_id"], r["track"], r.get("source", {}).get("kind")
        if track == "customer" and kind not in CUSTOMER_SOURCES:
            bad.append(f"{aid}: a customer recipe cannot take a '{kind}' source (customer art is generated, own or public domain)")
        if track == "private-only" and kind != "catalogue":
            bad.append(f"{aid}: a private-only recipe must take a catalogue source, and writes only to data/design-assets/private")
        if track not in ("customer", "private-only"):
            bad.append(f"{aid}: unknown track '{track}'")
        if track == "customer":
            if not r.get("licence", "").strip():
                bad.append(f"{aid}: no licence line (every customer file needs one)")
            if kind in ("own", "public-domain"):
                lic = p.own / (r["source"]["file"] + ".licence")
                if not lic.is_file() or not lic.read_text(encoding="utf-8").strip():
                    bad.append(f"{aid}: own/{r['source']['file']}.licence is missing or empty")
            if kind == "public-domain" and not (r["source"].get("work") and r["source"].get("record")):
                bad.append(f"{aid}: a public-domain source names the work and its museum record")
            if not r.get("budget_bytes"):
                bad.append(f"{aid}: no budget_bytes")
        if "private_source" in r and not str(r["private_source"]).startswith("C"):
            bad.append(f"{aid}: private_source must be a catalogue id")
    try:
        want = json.loads(p.manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return bad + ["art-manifest.json is missing or unreadable; run build_art.py"]
    got, outs = build_customer(p, tokens)
    same_env = want.get("env") == got["env"]
    if not same_env:
        bad_env = f"environment differs (manifest {want.get('env')}, here {got['env']}): lossy files are compared by size only"
        print("note:", bad_env)
    for aid, row in got["art"].items():
        w = want["art"].get(aid)
        if w is None:
            bad.append(f"{aid}: not in the manifest; run build_art.py")
            continue
        if w["recipe_sha256"] != row["recipe_sha256"]:
            bad.append(f"{aid}: recipe or token changed since the manifest was built")
        for f in row["files"]:
            wf = next((x for x in w["files"] if x["path"] == f["path"]), None)
            if wf is None:
                bad.append(f"{aid}: {f['path']} not in the manifest")
                continue
            lossy = f["kind"] == "webp"
            if wf["sha256"] != f["sha256"] and (same_env or not lossy):
                bad.append(f"{aid}: sha256 differs from the manifest (not deterministic, or stale output)")
            if f["bytes"] > row["budget_bytes"] > 0:
                bad.append(f"{aid}: {f['bytes']} B is over its budget of {row['budget_bytes']} B")
            if f["bytes"] > BYTE_CAP[f["kind"]]:
                bad.append(f"{aid}: {f['bytes']} B is over the {f['kind']} cap of {BYTE_CAP[f['kind']]} B (8.5.2)")
            disk = p.generated / Path(f["path"]).name
            if not disk.is_file():
                bad.append(f"{aid}: {f['path']} is missing on disk")
            elif A.sha256(disk.read_bytes()) != wf["sha256"] and (same_env or not lossy):
                bad.append(f"{aid}: {f['path']} on disk differs from the manifest")
    for aid in want["art"]:
        if aid not in got["art"]:
            bad.append(f"{aid}: in the manifest but has no recipe")
    names = {Path(f["path"]).name for r in got["art"].values() for f in r["files"]}
    if p.generated.is_dir():
        for f in p.generated.iterdir():
            if f.is_file() and f.name not in names:
                bad.append(f"generated/{f.name}: no recipe or licence line owns this file")
    return bad


# ---------------------------------------------------------------- private track
def build_private(p: Paths, tokens: dict[str, str]) -> dict:
    """Needs data/design-assets/source/<id>.png. Writes only under data/design-assets/private, plus a hash
    list that check_no_private_in_dist.py reads. Nothing here ever writes into app/ or tools/."""
    out: dict[str, dict] = {}
    p.private_out.mkdir(parents=True, exist_ok=True)
    for r in load_recipes(p):
        cid = r.get("private_source") or (r["source"].get("id") if r.get("source", {}).get("kind") == "catalogue" else None)
        if cid is None:
            continue
        r2 = dict(r, private_source=cid)
        if not (p.private_src / f"{cid}.png").is_file():
            print(f"skip {r['art_id']}: no source {cid}.png")
            continue
        ext, data = render(r2, tokens, p, private=True) if r["track"] == "customer" else run_steps(r, make_source(r["source"], r.get("seed", 0), p), tokens)
        f = p.private_out / f"{r['art_id']}.{ext}"
        f.write_bytes(data)
        out[r["art_id"]] = {"file": f.name, "sha256": A.sha256(data), "bytes": len(data), "source": cid,
                            "source_sha256": A.sha256((p.private_src / f"{cid}.png").read_bytes())}
    (p.private_out / "private-hashes.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return out


def stage_private(p: Paths) -> int:
    p.stage.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(p.private_out.glob("art.*")):
        shutil.copyfile(f, p.stage / f.name)
        n += 1
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--stage-private", action="store_true")
    ap.add_argument("--root", default=str(ROOT))
    a = ap.parse_args(argv)
    p = Paths(Path(a.root))
    tokens = A.load_tokens(p.root)
    if a.check:
        bad = check(p, tokens)
        for b in bad:
            print("FAIL", b)
        m = json.loads(p.manifest.read_text(encoding="utf-8")) if p.manifest.is_file() else {"art": {}}
        total = sum(f["bytes"] for r in m["art"].values() for f in r["files"])
        print(f"{len(m['art'])} art ids, {total} B generated, {len(bad)} problem(s)")
        return 1 if bad else 0
    if a.private:
        out = build_private(p, tokens)
        print(f"private track: {len(out)} file(s) in data/design-assets/private")
        return 0
    if a.stage_private:
        print(f"staged {stage_private(p)} private file(s) into app/ui/src/art/private-local")
        return 0
    m = write_customer(p, tokens)
    print(f"built {sum(1 for r in m['art'].values() if r['files'])} customer file(s), {len(m['art'])} art ids in the manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Does requirements.gpu.txt list exactly what JARVIS imports? Run it with the venv:

    .venv\\Scripts\\python.exe requirements\\check_requirements.py                  report
    .venv\\Scripts\\python.exe requirements\\check_requirements.py --pins           name==version for every import
    .venv\\Scripts\\python.exe requirements\\check_requirements.py --write-constraints

WHY (2026-10-12)
The old requirements.gpu.txt was a `pip freeze` of a venv that had hosted every stack
JARVIS ever tried. It pinned 239 packages and a spaCy model, yet a clean install from
it could not start the app: psutil (imported by the server at startup), pywebview (the
window), nvidia-ml-py, kokoro-onnx and soundfile were missing. 86 of its pins are
needed by nothing the code imports, directly or through a dependency: stacks the code
dropped long ago (exllamav2, mem0ai, chromadb, qdrant-client, spaCy, tensorflow-cpu)
and their trees. It also pinned both pygame and pygame-ce, which install into the
same `pygame` folder and overwrite each other. A freeze records a venv's history;
what the code needs is a different list, and only the code can say what it is.

HOW
1. Walk every .py/.pyw under SCAN (legacy/ and fixture folders skipped), parse it with
   ast and collect the top-level name of every absolute import, plus the string
   literal in importlib.import_module("x") / __import__("x"). Imports inside
   try/except count: an optional import that fails silently is still a dependency.
2. Drop the standard library (sys.stdlib_module_names) and JARVIS's own modules.
3. Map each remaining name to the distribution that provides it IN THIS VENV, with
   importlib.metadata.packages_distributions().
4. Compare with requirements.gpu.txt: an import nobody lists is MISSING, a listed
   package nothing imports is UNUSED unless INDIRECT says why it is needed anyway,
   and every pin must equal the version installed here.

constraints.gpu.txt is generated, not edited: the transitive closure of the curated
list, read from each installed package's own Requires-Dist (markers evaluated for this
platform), pinned at the installed versions. `pip install -r requirements.gpu.txt -c
constraints.gpu.txt` then reproduces this venv's working set without its dead stacks.

Standard library only (plus the `packaging` that ships inside pip), so it runs in any
venv, including a broken one.
"""
from __future__ import annotations

import ast
import os
import re
import sys
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, distribution, packages_distributions
from pathlib import Path

try:                                    # the real one if installed, else pip's copy
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name
except ImportError:                     # pragma: no cover - depends on the venv
    from pip._vendor.packaging.requirements import Requirement
    from pip._vendor.packaging.utils import canonicalize_name

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
REQUIREMENTS = HERE / "requirements.gpu.txt"
CONSTRAINTS = HERE / "constraints.gpu.txt"

# What ships as JARVIS. The four code folders, plus the app's launcher and icon script
# and the app's tests, which sit beside jarvis_app/ rather than inside it. The test
# folders are scanned on purpose: pytest is a dependency of `pytest` working.
SCAN = ("core", "yaadash", "aankhen", "app/jarvis_app", "app/tests",
        "app/JARVIS.pyw", "app/make_icon.py")
# legacy/ holds first-generation code that is never imported (README); fixtures/ is
# test data, not code that runs.
SKIP_DIRS = {"legacy", "fixtures", "__pycache__", "node_modules", ".pytest_cache"}

# Imported by the code but deliberately NOT installed by the requirements file.
# Each import sits in a try/except and the code works without it.
IMPORTED_NOT_REQUIRED = {
    "tflite_runtime": "core/jarvis.py's shim for openWakeWord's TFLite backend. The wake "
                      "word runs with inference_framework='onnx', and tflite-runtime has "
                      "no Windows wheel for Python 3.11 anyway.",
    "tensorflow": "Only the fallback inside that same shim (tensorflow.lite standing in "
                  "for tflite_runtime). Not needed while the wake word runs on ONNX; "
                  "the import fails quietly when TensorFlow is absent.",
    "nvidia": "core/jarvis.py adds nvidia-cublas/cudnn wheel folders to PATH when they "
              "exist. They are not installed: torch's CUDA build supplies cuBLAS (see "
              "INDIRECT['torch']) and CTranslate2 ships its own cuDNN.",
}

# Listed in requirements.gpu.txt although no JARVIS file imports them.
INDIRECT = {
    "onnxruntime": "Runs the wake word (openwakeword, inference_framework='onnx' in "
                   "core/jarvis.py), Kokoro speech and faster-whisper's Silero VAD. "
                   "Pinned here because three packages share it and the wake-word "
                   "backend choice in jarvis.py depends on it being present.",
    "torch": "sentence-transformers runs bge-small on it, and the CUDA 12.1 build is "
             "what supplies cublas64_12.dll to CTranslate2 (Whisper on the GPU): with "
             "no CUDA toolkit or nvidia-cublas wheel installed, the DLL failed to load "
             "before `import torch` and loaded after it (checked 2026-10-12). PyPI's "
             "default Windows torch is CPU-only, hence the extra index URL.",
    "websockets": "uvicorn's WebSocket protocol. /ws/events and the Aankhen stream are "
                  "WebSocket routes, and uvicorn rejects upgrades when no WebSocket "
                  "library is installed; fastapi and uvicorn do not depend on one.",
}

_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*==\s*([^\s;#]+)\s*$")


# ----------------------------------------------------------------- imports
def iter_files(root: Path = REPO, scan=SCAN):
    for entry in scan:
        p = root / entry
        if p.is_file():
            yield p
            continue
        for dirpath, dirnames, filenames in os.walk(p):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for f in sorted(filenames):
                if f.endswith((".py", ".pyw")):
                    yield Path(dirpath) / f


def local_modules(root: Path = REPO, scan=SCAN) -> set[str]:
    """Names JARVIS's own files answer to: every module stem and package folder in the
    scan. core/ and yaadash/ are on sys.path (jarvis.pth), so `import agent` is local."""
    names = {"jarvis_app", "aankhen"}
    for f in iter_files(root, scan):
        names.add(f.stem)
        if (f.parent / "__init__.py").exists():
            names.add(f.parent.name)
    return names


def imports_in(path: Path) -> set[str]:
    """Top-level names of every absolute import in one file."""
    tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:          # relative imports are local
                out.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call):
            # importlib.import_module("x") and __import__("x") with a literal name.
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
            if (name in ("import_module", "__import__") and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)):
                out.add(node.args[0].value.split(".")[0])
    return out


def third_party_imports(root: Path = REPO, scan=SCAN) -> dict[str, set[str]]:
    """{module: {files importing it}} for everything outside stdlib and JARVIS."""
    std = set(sys.stdlib_module_names)
    local = local_modules(root, scan)
    found: dict[str, set[str]] = {}
    for f in iter_files(root, scan):
        for mod in imports_in(f):
            if mod in std or mod in local:
                continue
            found.setdefault(mod, set()).add(f.relative_to(root).as_posix())
    return found


# ------------------------------------------------------------ requirements
def read_requirements(path: Path = REQUIREMENTS) -> dict[str, dict]:
    """{canonical name: {"name", "extras", "version", "line"}}; every line must be pinned."""
    out = {}
    for n, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.split(" #")[0].strip()
        if not line or line.startswith(("#", "-")):         # comments, --extra-index-url
            continue
        m = _PIN.match(line)
        if not m:
            raise ValueError(f"{path.name}:{n}: not a plain `name==version` pin: {raw!r}")
        name, extras, ver = m.group(1), m.group(2), m.group(3)
        extras = {e.strip() for e in extras[1:-1].split(",")} if extras else set()
        out[canonicalize_name(name)] = {"name": name, "extras": extras, "version": ver, "line": n}
    return out


def installed_version(name: str) -> str | None:
    try:
        return distribution(name).version
    except PackageNotFoundError:
        return None


def _requires(name: str, extras=()) -> list[Requirement]:
    """A distribution's own Requires-Dist that apply on this platform with `extras`."""
    try:
        reqs = distribution(name).requires or []
    except PackageNotFoundError:
        return []
    out = []
    for s in reqs:
        r = Requirement(s)
        if r.marker is None or any(r.marker.evaluate({"extra": e}) for e in ("", *extras)):
            out.append(r)
    return out


# ----------------------------------------------------------------- report
@dataclass
class Report:
    imports: dict[str, set[str]]                          # module -> files
    providers: dict[str, list[str]]                       # module -> distributions
    listed: dict[str, dict]
    missing: dict[str, str] = field(default_factory=dict)        # module -> why
    unused: list[str] = field(default_factory=list)
    drift: dict[str, tuple] = field(default_factory=dict)        # name -> (pinned, installed)
    shared_names: dict[str, list[str]] = field(default_factory=dict)
    stale_allowlist: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not (self.missing or self.unused or self.drift
                    or self.shared_names or self.stale_allowlist)


def check(root: Path = REPO, req_file: Path = REQUIREMENTS, scan=SCAN) -> Report:
    imports = third_party_imports(root, scan)
    listed = read_requirements(req_file)
    pkg = packages_distributions()
    providers = {m: sorted({canonicalize_name(d) for d in pkg.get(m, [])}) for m in imports}
    # A meta package (fastmcp) installs no module of its own; the module comes from a
    # distribution it requires (fastmcp-slim). Listing the meta package covers it.
    ships_modules = {canonicalize_name(d) for ds in pkg.values() for d in ds}
    meta = {name: {canonicalize_name(r.name) for r in _requires(info["name"], info["extras"])}
            for name, info in listed.items() if name not in ships_modules}
    rep = Report(imports=imports, providers=providers, listed=listed)

    used = set()
    for mod, dists in providers.items():
        if mod in IMPORTED_NOT_REQUIRED:
            continue
        cover = [d for d in dists if d in listed]
        cover += [m for m, reqs in meta.items() if reqs & set(dists)]
        if not dists:
            rep.missing[mod] = "imported, but no installed distribution provides it"
        elif not cover:
            rep.missing[mod] = f"imported, provided by {', '.join(dists)}, not listed"
        used.update(cover)
        both = [d for d in dists if d in listed]
        if len(both) > 1:
            rep.shared_names[mod] = both
    rep.unused = sorted(n for n in listed if n not in used and n not in INDIRECT)
    for name, info in listed.items():
        have = installed_version(info["name"])
        if have != info["version"]:
            rep.drift[info["name"]] = (info["version"], have)
    rep.stale_allowlist = sorted(
        [f"INDIRECT[{n!r}] is not in {req_file.name}" for n in INDIRECT if n not in listed]
        + [f"INDIRECT[{n!r}] is imported directly; list it as an import" for n in INDIRECT if n in used]
        + [f"IMPORTED_NOT_REQUIRED[{m!r}] is no longer imported" for m in IMPORTED_NOT_REQUIRED
           if m not in imports])
    return rep


def closure(listed: dict[str, dict]) -> tuple[dict[str, str], list[str]]:
    """Every distribution the curated list pulls in on this platform, at its installed
    version, as ({canonical name: "Name==version"}, [required but not installed])."""
    seen: dict[str, set] = {}
    pins: dict[str, str] = {}
    absent: set[str] = set()
    stack = [(info["name"], frozenset(info["extras"])) for info in listed.values()]
    while stack:
        name, extras = stack.pop()
        key = canonicalize_name(name)
        if key in seen and extras <= seen[key]:
            continue
        seen[key] = seen.get(key, set()) | extras
        try:
            d = distribution(name)
        except PackageNotFoundError:
            absent.add(key)
            continue
        pins[key] = f"{d.metadata['Name']}=={d.version}"
        for r in _requires(name, extras):
            stack.append((r.name, frozenset(r.extras)))
    return dict(sorted(pins.items())), sorted(absent)


CONSTRAINTS_HEADER = """\
# GENERATED by requirements/check_requirements.py --write-constraints. Do not edit.
# Every package requirements.gpu.txt pulls in on Windows / Python {py}, pinned at the
# version installed in the venv it was generated from, so a clean install resolves to
# the same working set:
#   pip install -r requirements/requirements.gpu.txt -c requirements/constraints.gpu.txt
"""


def constraints_text(listed: dict[str, dict]) -> str:
    pins, absent = closure(listed)
    if absent:
        raise RuntimeError(f"required but not installed in this venv: {', '.join(absent)}")
    py = f"{sys.version_info.major}.{sys.version_info.minor}"
    return CONSTRAINTS_HEADER.format(py=py) + "".join(f"{v}\n" for v in pins.values())


def _print_report(rep: Report) -> None:
    print(f"Third-party imports: {len(rep.imports)} | listed: {len(rep.listed)} "
          f"(of which indirect: {sum(n in rep.listed for n in INDIRECT)})")
    for mod in sorted(rep.imports):
        dists = ", ".join(rep.providers[mod]) or "-"
        tag = "allowed" if mod in IMPORTED_NOT_REQUIRED else ("MISSING" if mod in rep.missing else "ok")
        files = sorted(rep.imports[mod])
        print(f"  [{tag:7}] {mod:22} <- {dists:28} {files[0]}" + (f" +{len(files) - 1}" if len(files) > 1 else ""))
    for name, (pinned, have) in sorted(rep.drift.items()):
        print(f"  [DRIFT  ] {name}: file pins {pinned}, venv has {have or 'nothing'}")
    for name in rep.unused:
        print(f"  [UNUSED ] {name}: listed, nothing imports it, no INDIRECT reason")
    for mod, dists in rep.shared_names.items():
        print(f"  [CLASH  ] `{mod}` is provided by both {dists}; keep one")
    for s in rep.stale_allowlist:
        print(f"  [STALE  ] {s}")
    print("OK" if rep.ok else "NOT OK")


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    rep = check()
    if "--pins" in argv:
        pins = set()
        for mod, dists in rep.providers.items():
            pins.update(f"{d}=={installed_version(d)}" for d in dists)
        print("\n".join(sorted(pins, key=str.lower)))
        return 0
    if "--write-constraints" in argv:
        text = constraints_text(rep.listed)
        CONSTRAINTS.write_text(text, encoding="utf-8")
        n = sum(1 for ln in text.splitlines() if ln and not ln.startswith("#"))
        print(f"wrote {CONSTRAINTS} ({n} packages)")
    _print_report(rep)
    return 0 if rep.ok else 1


if __name__ == "__main__":
    sys.exit(main())

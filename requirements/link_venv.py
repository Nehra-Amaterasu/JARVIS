"""Tie the project venv to this folder. Run it with the venv's own python:

    .venv\\Scripts\\python.exe requirements\\link_venv.py

1. Writes jarvis.pth into site-packages, so core/, yaadash/ and the JARVIS root
   are importable from anywhere (`import agent`, `import yaadash_v2`,
   `import aankhen`). The .pth computes the root from the venv's own location, so
   it survives the folder being renamed or moved.
2. Rebuilds the console launchers (pip.exe, uvicorn.exe, ...). Windows launchers
   carry the absolute path of python.exe they were made for, so moving a venv
   breaks every one of them while python.exe itself keeps working. They are
   regenerated from each installed package's own entry points, offline.

Safe to run any number of times.
"""
from __future__ import annotations

import os
import sys
import sysconfig
from importlib.metadata import distributions

PTH = ('import os, sys; _r = os.path.dirname(sys.prefix); '
       '_i = next((i for i, p in enumerate(sys.path) if p.lower().endswith("site-packages")), len(sys.path)); '
       'sys.path[_i:_i] = [p for p in (os.path.join(_r, "core"), os.path.join(_r, "yaadash"), _r) if p not in sys.path]\n')


def link() -> str:
    if sys.prefix == sys.base_prefix:
        sys.exit("Run this with the venv's python (.venv\\Scripts\\python.exe), not the system one.")
    path = os.path.join(sysconfig.get_paths()["purelib"], "jarvis.pth")
    with open(path, "w", encoding="utf-8") as f:
        f.write(PTH)
    return path


def rebuild_launchers() -> int:
    from pip._vendor.distlib.scripts import ScriptMaker
    scripts = sysconfig.get_paths()["scripts"]
    maker = ScriptMaker(None, scripts)
    maker.executable = os.path.join(scripts, "python.exe")
    maker.clobber = True
    maker.variants = {""}
    n = 0
    for dist in distributions():
        for ep in dist.entry_points:
            if ep.group in ("console_scripts", "gui_scripts"):
                maker.make(f"{ep.name} = {ep.value}", options={"gui": ep.group == "gui_scripts"})
                n += 1
    return n


if __name__ == "__main__":
    print("path hook:", link())
    if os.name == "nt":
        print("launchers rebuilt:", rebuild_launchers())

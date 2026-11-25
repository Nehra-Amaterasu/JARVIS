"""The switches of the question engine that he owns (X07, R-35).

    load(store)                    -> {"rules_only": bool}
    rules_only(store)              -> bool
    save(store, rules_only: bool)  -> the stored settings

`rules_only` is false until he turns it on. With it on, every path that would ask the local model
(descriptive variants, rubric drafts) answers state "planned" and never calls the provider; the
paths that run on rules alone (numerical templates, tags, families, the generator) go on as before.
The file is pyq/settings.json under the store root, written through a temporary file and a replace
so a crash leaves the old one; a file that does not parse reads as the defaults and is not trusted
for anything else. Unknown keys are kept on write, so a later wave's switch survives this one.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from .blueprint import write_json_atomic

DEFAULTS = {"rules_only": False}
_LOCK = threading.Lock()


def _path(store) -> Path:
    return Path(store.root) / "settings.json"


def _read(store) -> dict:
    try:
        d = json.loads(_path(store).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def load(store) -> dict:
    d = _read(store)
    return {"rules_only": d.get("rules_only") is True}


def rules_only(store) -> bool:
    return load(store)["rules_only"]


def save(store, rules_only: bool) -> dict:
    if not isinstance(rules_only, bool):
        raise ValueError("rules_only is true or false.")
    with _LOCK:
        d = _read(store)
        d["rules_only"] = rules_only
        write_json_atomic(_path(store), d)
    return load(store)

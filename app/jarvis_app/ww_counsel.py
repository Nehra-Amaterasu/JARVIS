"""Counsel: the model jobs Well Wisher needs, done by whatever model is at hand.

    counsel(task, fields, provider=None) -> dict

Built so the System keeps working without any one vendor:
  * the prompts are files in prompts/<task>.md, read at call time, so he can edit
    them with no code change and see exactly what is asked;
  * the provider is one function text -> text. Default: Ollama on this laptop
    (JARVIS's own brain). Optional: any OpenAI-style chat endpoint named in the
    environment (COUNSEL_API_URL, COUNSEL_API_KEY, COUNSEL_MODEL), for a free tier
    or pay-per-use key. Keys live in the environment or the OS keychain, never in
    a file of this repo;
  * every task asks for JSON and validates it; a model that rambles gives
    {"status": "unparsed", "raw": ...}, never a crash, and the UI says so;
  * no provider at all is an answer too ("no model reachable").

Tasks (each with its own prompt file and output check):
  grade_explain   his explanation of a concept against its summary -> score 0-3, missing points
  quiz_from_text  a sheet section -> three recall questions with short answers
  parse_day       a sentence about the day + his counter ids -> counts per counter
  summarise       any text (a reel caption, an article) -> five lines + three questions
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Callable, Optional

PROMPTS = Path(__file__).with_name("prompts")
OLLAMA = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M"
TASKS = ("grade_explain", "quiz_from_text", "parse_day", "summarise")
MAX_INPUT = 12000

Provider = Callable[[str, str], str]      # (system, user) -> model text


# ------------------------------------------------------------------ providers
def ollama_provider(model: Optional[str] = None, url: str = OLLAMA, timeout: float = 90.0) -> Provider:
    model = model or os.environ.get("JARVIS_BRAIN_MODEL") or DEFAULT_MODEL

    def run(system: str, user: str) -> str:
        body = json.dumps({"model": model, "stream": False, "format": "json",
                           "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                           "options": {"temperature": 0.2}}).encode("utf-8")
        req = urllib.request.Request(f"{url}/api/chat", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))["message"]["content"]
    return run


def api_provider(url: str, key: str, model: str, timeout: float = 60.0) -> Provider:
    """An OpenAI-style /chat/completions endpoint (Gemini's and most free tiers speak it)."""
    def run(system: str, user: str) -> str:
        body = json.dumps({"model": model, "temperature": 0.2,
                           "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode("utf-8")
        req = urllib.request.Request(url.rstrip("/") + "/chat/completions", data=body,
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))["choices"][0]["message"]["content"]
    return run


def default_provider(environ: Optional[dict] = None) -> tuple[Optional[Provider], str]:
    """The provider to use, and its name: the API from the environment if set, else Ollama."""
    env = environ if environ is not None else os.environ
    url, key = env.get("COUNSEL_API_URL"), env.get("COUNSEL_API_KEY")
    if url and key:
        return api_provider(url, key, env.get("COUNSEL_MODEL") or "gemini-flash-lite-latest"), "api"
    return ollama_provider(env.get("JARVIS_BRAIN_MODEL")), "ollama"


# ------------------------------------------------------------------ prompts and parsing
def load_prompt(task: str) -> str:
    return (PROMPTS / f"{task}.md").read_text(encoding="utf-8")


def fill(template: str, fields: dict) -> str:
    out = template
    for k, v in fields.items():
        out = out.replace("{{" + k + "}}", str(v)[:MAX_INPUT])
    return out


def extract_json(text: str) -> Optional[dict]:
    """The first JSON object in a model answer, fences and chatter tolerated."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except ValueError:
        return None


def _clean_int(v, lo: int, hi: int) -> Optional[int]:
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def check_output(task: str, data: dict, fields: dict) -> Optional[dict]:
    """The validated answer for a task, or None when the model's JSON has the wrong shape."""
    if task == "grade_explain":
        score = _clean_int(data.get("score"), 0, 3)
        missing = [str(x)[:200] for x in data.get("missing") or [] if str(x).strip()][:5]
        if score is None:
            return None
        return {"score": score, "missing": missing, "note": str(data.get("note") or "")[:300]}
    if task == "quiz_from_text":
        qs = []
        for q in data.get("questions") or []:
            if isinstance(q, dict) and q.get("q") and q.get("a"):
                qs.append({"q": str(q["q"])[:300], "a": str(q["a"])[:300]})
        return {"questions": qs[:3]} if qs else None
    if task == "parse_day":
        ids = set(fields.get("counter_ids", "").split(","))
        counts = {}
        for k, v in (data.get("counts") or {}).items():
            n = _clean_int(v, 0, 500)
            if k in ids and n is not None:
                counts[k] = n
        items = [{"kind": str(i.get("kind"))[:20], "text": str(i.get("text"))[:200]} for i in data.get("items") or []
                 if isinstance(i, dict) and i.get("kind") and i.get("text")][:10]
        return {"counts": counts, "items": items} if counts or items else None
    if task == "summarise":
        lines = [str(x)[:300] for x in data.get("summary") or [] if str(x).strip()][:5]
        qs = [str(x)[:300] for x in data.get("questions") or [] if str(x).strip()][:3]
        return {"summary": lines, "questions": qs} if lines else None
    return None


# ------------------------------------------------------------------ the engine
def counsel(task: str, fields: dict, provider: Optional[Provider] = None, provider_name: str = "given") -> dict:
    if task not in TASKS:
        raise KeyError(f"no counsel task {task}")
    if not isinstance(fields, dict):
        raise ValueError("fields must be an object")
    if provider is None:
        provider, provider_name = default_provider()
    system, user = load_prompt(task).split("\n---\n", 1)
    user = fill(user, fields)
    base = {"engine": "counsel", "version": 1, "task": task, "provider": provider_name}
    try:
        raw = provider(system.strip(), user.strip())
    except Exception as e:                      # a model that is down is an answer, not a crash
        return {**base, "status": "no_model", "error": f"{type(e).__name__}: {e}"[:200],
                "say": "No model reachable. Start Ollama (Connect → Brain) or set COUNSEL_API_URL and COUNSEL_API_KEY."}
    data = extract_json(raw)
    out = check_output(task, data, fields) if data else None
    if out is None:
        return {**base, "status": "unparsed", "raw": (raw or "")[:1000],
                "say": "The model answered, but not in the shape asked. The raw answer is kept."}
    return {**base, "status": "ok", **out}

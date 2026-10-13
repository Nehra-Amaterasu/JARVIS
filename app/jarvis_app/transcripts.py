"""Every conversation, kept — and a review file Claude can read to find what's failing.

Storage (all under data/app/, gitignored — these are private conversations):
    transcripts/YYYY-MM-DD.jsonl   one line per turn or error, appended as it happens
    transcripts/flags.jsonl        your verdicts on turns: wrong / slow / misheard / good
    reviews/review-*.md            generated review bundles

A turn line:
    {"kind": "turn", "session": "20261009-181205", "id": 3, "role": "jarvis",
     "text": "...", "ts": 1760000000.0, "mode": "voice",
     "seconds": 2.5, "timings": {"stt": 2.7, "first_token": 0.6}}

Why a review FILE and not an upload: the conversations include friends' names and
personal facts. The file stays on this machine; you point Claude Code at it
("read data/app/reviews/review-…md") and nothing leaves unless you choose.
"""
from __future__ import annotations

import json
import statistics
import threading
import time
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Optional

from .paths import DATA

TRANSCRIPTS = DATA / "transcripts"
REVIEWS = DATA / "reviews"
FLAGS = TRANSCRIPTS / "flags.jsonl"
VERDICTS = ("wrong", "slow", "misheard", "good")


class TranscriptStore:
    def __init__(self, root: Path = TRANSCRIPTS, reviews: Path = REVIEWS):
        self.root = root
        self.reviews = reviews
        self.flags_path = root / "flags.jsonl"
        self._lock = threading.Lock()
        root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ writing
    def _append(self, path: Path, obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False)
        with self._lock:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    def _day_file(self, ts: float) -> Path:
        return self.root / f"{datetime.fromtimestamp(ts):%Y-%m-%d}.jsonl"

    def record_turn(self, session: str, turn: dict, mode: Optional[str], timings: dict) -> None:
        ts = turn.get("t") or time.time()
        obj = {"kind": "turn", "session": session, "id": turn["id"], "role": turn["role"],
               "text": turn.get("text", ""), "ts": ts, "mode": mode}
        if turn["role"] == "jarvis":
            obj["seconds"] = turn.get("seconds")
            # endpoint (kept since 2026-10-13): the silence waited before the recording
            # closed, so "end of speech -> first word" can be told from the record.
            obj["timings"] = {k: v for k, v in timings.items() if k in ("stt", "first_token", "reply", "endpoint")}
        self._append(self._day_file(ts), obj)

    def record_timing(self, session: str, turn_id: int, stage: str, seconds: float) -> None:
        """A timing that arrives after the turn was kept — first_audio comes from the
        playback thread, often after the reply text has finished streaming."""
        ts = time.time()
        self._append(self._day_file(ts), {"kind": "timing", "session": session, "id": int(turn_id),
                                          "stage": stage, "seconds": seconds, "ts": ts})

    def record_error(self, session: str, message: str, critical: bool = False) -> None:
        ts = time.time()
        self._append(self._day_file(ts), {"kind": "error", "session": session, "ts": ts,
                                          "message": message, "critical": critical})

    def flag(self, session: str, turn_id: int, verdict: str, note: str = "",
             expected: str = "") -> dict:
        if verdict not in VERDICTS:
            raise ValueError(f"verdict must be one of {VERDICTS}")
        obj = {"session": session, "id": int(turn_id), "verdict": verdict,
               "note": note.strip()[:1000], "expected": expected.strip()[:2000], "ts": time.time()}
        self._append(self.flags_path, obj)
        return obj

    # ------------------------------------------------------------ reading
    def _lines(self, files: Iterable[Path]) -> list[dict]:
        out = []
        for p in files:
            try:
                with open(p, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                out.append(json.loads(line))
                            except json.JSONDecodeError:
                                continue          # a torn last line never breaks reading
            except FileNotFoundError:
                continue
        return out

    def day_files(self, days: int) -> list[Path]:
        today = datetime.now().date()
        names = {f"{today - timedelta(days=i):%Y-%m-%d}.jsonl" for i in range(days)}
        return sorted(p for p in self.root.glob("*.jsonl") if p.name in names)

    def entries(self, days: int = 7) -> list[dict]:
        return self._lines(self.day_files(days))

    def flags(self) -> dict[tuple[str, int], dict]:
        """Latest verdict per turn (a later flag overrides an earlier one)."""
        latest: dict[tuple[str, int], dict] = {}
        for f in self._lines([self.flags_path]):
            latest[(f["session"], int(f["id"]))] = f
        return latest

    def summary(self, days: int = 7) -> dict:
        ents = self.entries(days)
        turns = [e for e in ents if e.get("kind") == "turn"]
        replies = [t for t in turns if t["role"] == "jarvis"]
        flags = self.flags()
        sessions = {t["session"] for t in turns}
        lat = [t["seconds"] for t in replies if isinstance(t.get("seconds"), (int, float))]
        # What he actually waits for: end of his speech -> JARVIS's voice starts.
        audio = [e["seconds"] for e in ents if e.get("kind") == "timing" and e.get("stage") == "first_audio"
                 and isinstance(e.get("seconds"), (int, float))]
        flag_counts = Counter(f["verdict"] for k, f in flags.items() if k[0] in sessions)
        return {
            "days": days, "sessions": len(sessions), "turns": len(turns),
            "questions": len(turns) - len(replies), "replies": len(replies),
            "errors": sum(1 for e in ents if e.get("kind") == "error"),
            "flags": dict(flag_counts),
            "reply_seconds_median": round(statistics.median(lat), 2) if lat else None,
            "reply_seconds_p90": round(sorted(lat)[int(0.9 * (len(lat) - 1))], 2) if lat else None,
            "first_audio_median": round(statistics.median(audio), 2) if audio else None,
            "first_audio_p90": round(sorted(audio)[int(0.9 * (len(audio) - 1))], 2) if audio else None,
        }

    def recent(self, days: int = 2, limit: int = 200) -> list[dict]:
        flags = self.flags()
        turns = [e for e in self.entries(days) if e.get("kind") == "turn"][-limit:]
        for t in turns:
            f = flags.get((t["session"], int(t["id"])))
            if f:
                t["flag"] = {"verdict": f["verdict"], "note": f.get("note"), "expected": f.get("expected")}
        return turns

    # ------------------------------------------------------------ review
    def export_review(self, days: int = 7) -> Path:
        """Write a Markdown review bundle written FOR Claude to diagnose JARVIS."""
        ents = self.entries(days)
        flags = self.flags()
        s = self.summary(days)
        by_session: dict[str, list[dict]] = {}
        for e in ents:
            by_session.setdefault(e["session"], []).append(e)
        replies = [e for e in ents if e.get("kind") == "turn" and e["role"] == "jarvis"]
        slow_cut = s["reply_seconds_p90"]

        def ctx(session: str, turn_id: int, before: int = 2) -> list[dict]:
            rows = [e for e in by_session.get(session, []) if e.get("kind") == "turn"]
            idx = next((i for i, e in enumerate(rows) if int(e["id"]) == turn_id), None)
            return rows[max(0, idx - before): idx + 1] if idx is not None else []

        def fmt_turn(e: dict) -> str:
            who = "YOU" if e["role"] == "you" else "JARVIS"
            extra = ""
            if e["role"] == "jarvis":
                t = e.get("timings") or {}
                extra = (f"  _(reply {e.get('seconds')} s, first token {t.get('first_token')} s"
                         + (f", hearing {t.get('stt')} s" if t.get("stt") is not None else "") + ")_")
            return f"> **{who}:** {e['text']}{extra}"

        lines = [
            f"# JARVIS review — last {days} day(s), generated {datetime.now():%Y-%m-%d %H:%M}",
            "",
            "You are reviewing transcripts of JARVIS, a local voice assistant (Qwen3-4B via Ollama,",
            "Whisper large-v3-turbo, Yaadash memory) built by Aman (Amritanshu Nehra). Find where it fails and why:",
            "wrong facts, ignored questions, hallucinated memories, misheard speech (Hinglish),",
            "slow replies, tone problems. Turns he flagged are listed first with what he expected.",
            "For each problem, point at the likely cause in the code (core/agent.py prompt and",
            "context assembly, yaadash/yaadash_*.py retrieval, core/jarvis.py STT/TTS) and propose",
            "a concrete, testable fix. These are private conversations: don't quote them anywhere",
            "else.",
            "",
            "## Numbers",
            "",
            f"- sessions {s['sessions']}, questions {s['questions']}, replies {s['replies']}, errors {s['errors']}",
            f"- reply time median {s['reply_seconds_median']} s, p90 {s['reply_seconds_p90']} s",
            f"- flags: {s['flags'] or 'none'}",
            "",
        ]
        flagged = [(k, f) for k, f in flags.items() if k[0] in by_session and f["verdict"] != "good"]
        lines += ["## Flagged by Aman", ""]
        if not flagged:
            lines += ["_Nothing flagged in this window._", ""]
        for (session, tid), f in sorted(flagged, key=lambda x: x[1]["ts"]):
            lines.append(f"### {f['verdict'].upper()} — session {session}, turn {tid}")
            lines.append("")
            lines += [fmt_turn(e) for e in ctx(session, tid)]
            if f.get("expected"):
                lines.append(f"> **EXPECTED:** {f['expected']}")
            if f.get("note"):
                lines.append(f"> **NOTE:** {f['note']}")
            lines.append("")
        errors = [e for e in ents if e.get("kind") == "error"]
        lines += ["## Errors", ""]
        lines += [f"- {datetime.fromtimestamp(e['ts']):%m-%d %H:%M} {'CRITICAL ' if e.get('critical') else ''}"
                  f"{e['message']}" for e in errors] or ["_None._"]
        lines.append("")
        if slow_cut:
            slow = [e for e in replies if isinstance(e.get("seconds"), (int, float)) and e["seconds"] >= slow_cut]
            lines += [f"## Slowest replies (≥ p90, {slow_cut} s)", ""]
            for e in slow[:15]:
                lines += [fmt_turn(x) for x in ctx(e["session"], int(e["id"]), before=1)]
                lines.append("")
        lines += ["## Full transcript", ""]
        for session in sorted(by_session):
            lines += [f"### Session {session}", ""]
            for e in by_session[session]:
                if e.get("kind") == "turn":
                    f = flags.get((session, int(e["id"])))
                    mark = f"  `[{f['verdict']}]`" if f else ""
                    lines.append(fmt_turn(e) + mark)
                elif e.get("kind") == "error":
                    lines.append(f"> _error: {e['message']}_")
            lines.append("")
        self.reviews.mkdir(parents=True, exist_ok=True)
        path = self.reviews / f"review-{datetime.now():%Y%m%d-%H%M%S}.md"
        path.write_text("\n".join(lines), encoding="utf-8")
        return path

"""Teach, train and correct Aankhen from the app (the owner's ask, 2026-10-27: training
lives in the app, not in scripts).

    GET  /api/aankhen/train2             model status (predicting|answering), the job, the report in plain words
    POST /api/aankhen/train2             {per_place_s=30, adabn=false} -> trains in the background
    GET  /api/aankhen/minidrill          the mini drill: recording?, the open span, spans so far
    POST /api/aankhen/minidrill/start    {fan?} records the board into data/aankhen/drill/minidrill/...
    POST /api/aankhen/minidrill/tap      {zone | null} closes the open span, opens the next (null: pause)
    POST /api/aankhen/minidrill/stop     closes the last span and the recording
    POST /api/aankhen/correct            {zone, seconds=10, confirmed=false} the last N s as a labelled span
    GET  /api/aankhen/narrate/sessions   narration sessions (labelled or not) + audio files to pick from
    POST /api/aankhen/narrate/label      {audio, session="latest"} the phone narration -> labels, in the background
    GET  /api/aankhen/narrate/label      that job: stage, fraction, summary

THE CLOCK. Every span here is on the host clock (time.time() when he taps): the board's
frames carry the same clock, so a mini drill at the laptop needs no sync chirp. A tap's
time is the server's arrival time, ~10-50 ms after the click on this machine; the
dataset's 5 s purge at each span's start swamps that.

Everything that touches the training code goes through aankhen_training.py.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Optional

from fastapi import Body, HTTPException

from . import aankhen_training as at

AUDIO_EXT = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".flac", ".amr", ".3gp", ".webm")
CORRECT_MAX_S = 120.0           # a correction is about the last moments, not an evening
MIN_SPAN_S = 1.0                # a double tap is not a span; the dataset decides its own minimum


def _drill_dir() -> str:
    from aankhen.drill import DRILL_DIR
    return DRILL_DIR


def _narrate_dir() -> str:
    from aankhen.narrate import NARRATE_DIR
    return NARRATE_DIR


def _audio_dirs() -> list[str]:
    """Where a phone recording copied to the laptop usually lands. AANKHEN_AUDIO_DIRS
    (os.pathsep-separated) replaces the list; tests point it at a scratch folder."""
    env = os.environ.get("AANKHEN_AUDIO_DIRS")
    if env is not None:
        return [d for d in env.split(os.pathsep) if d]
    return [os.path.join(_narrate_dir(), "inbox"), os.path.join(os.path.expanduser("~"), "Downloads")]


def _inside(path: str, root: str) -> bool:
    p, r = os.path.normcase(os.path.abspath(path)), os.path.normcase(os.path.abspath(root))
    return p.startswith(r + os.sep)


def _zone_names(hub) -> dict:
    try:
        eng = getattr(hub, "engine", None)
        zm = eng.zmap if eng is not None else None
        if zm is None:
            from aankhen.zones import load_zones
            zm = load_zones(hub.room)
        return {z.id: z.name for z in zm.zones}
    except Exception:
        return {}


def _unavailable(e: Exception):
    raise HTTPException(503, str(e))


def register(app, svc, bus) -> None:
    hub = svc.hub
    train = at.Job("train")
    narr = at.Job("narrate")
    lock = threading.Lock()
    mini: dict = {"recording": None, "folder": None, "started": None, "open": None, "spans": [], "dropped": [],
                  "fan": None}
    last_correction: dict = {}

    # ------------------------------------------------------------------ train
    def _train_view() -> dict:
        st = at.status_or_reason()
        rep = train.result if train.state == "done" else None
        if rep is None:
            rep = at.load_report(st.get("report_path"))
        per = float(train.args.get("per_place_s", 30)) if train.args else 30.0
        return {"status": st.get("status", "predicting"), "model": st, "job": train.view(),
                "report": at.plain_report(rep, st, per, _zone_names(hub)) if (rep or st.get("seconds_per_place")) else None,
                "available": at.available()}

    @app.get("/api/aankhen/train2")
    def train2_view():
        return _train_view()

    @app.post("/api/aankhen/train2")
    def train2_start(per_place_s: float = Body(30, embed=True), adabn: bool = Body(False, embed=True)):
        if not (5 <= per_place_s <= 3600):
            raise HTTPException(400, "per_place_s is between 5 and 3600 seconds")
        miss = at.available()
        if not miss["train_job"]:
            raise HTTPException(503, "the new training job (aankhen.fingerprint.train_job) is not in this "
                                     "checkout yet, so Train cannot run")

        def done(j: at.Job):
            msg = (f"Aankhen trained: {j.result.get('status', 'predicting') if isinstance(j.result, dict) else 'done'}"
                   if j.state == "done" else f"Aankhen training failed: {j.error}")
            bus.publish("aankhen", "train", msg)
        ok = train.start(lambda progress: at.train_job(per_place_s, progress, adabn),
                         {"per_place_s": per_place_s, "adabn": adabn}, done)
        if not ok:
            raise HTTPException(409, "training is already running")
        bus.publish("aankhen", "train", "Aankhen: training on every labelled span")
        return _train_view()

    # ------------------------------------------------------------------ mini drill
    def _mini_view() -> dict:
        o = mini["open"]
        now = time.time()
        return {"recording": mini["recording"], "started": mini["started"], "fan": mini["fan"],
                "open": None if o is None else {**o, "seconds": round(now - o["t0"], 1)},
                "spans": mini["spans"][-30:], "dropped": mini["dropped"][-10:],
                "seconds": {z: round(sum(s["t1"] - s["t0"] for s in mini["spans"] if s["zone"] == z), 1)
                            for z in dict.fromkeys(s["zone"] for s in mini["spans"])}}

    def _close(now: float) -> Optional[dict]:
        o, mini["open"] = mini["open"], None
        if o is None:
            return None
        if now - o["t0"] < MIN_SPAN_S:
            mini["dropped"].append({**o, "t1": now, "why": "shorter than a second"})
            return None
        try:
            saved = at.add_span(mini["recording"], o["t0"], now, o["zone"], "minidrill")
        except (ValueError, at.TrainingUnavailable) as e:
            mini["dropped"].append({**o, "t1": now, "why": str(e)})
            return None
        span = {"zone": o["zone"], "t0": o["t0"], "t1": now, "saved": saved if isinstance(saved, dict) else None}
        mini["spans"].append(span)
        return span

    @app.get("/api/aankhen/minidrill")
    def minidrill_view():
        return _mini_view()

    @app.post("/api/aankhen/minidrill/start")
    def minidrill_start(fan: Optional[bool] = Body(None, embed=True)):
        with lock:
            if mini["recording"]:
                raise HTTPException(409, "a mini drill is already recording")
            src = getattr(hub, "source", None)
            if src is None or getattr(hub, "mode", None) != "hardware":
                raise HTTPException(400, "a mini drill records the real board: start Aankhen on the ESP32 first")
            if getattr(src, "_recorder", None) is not None:
                raise HTTPException(409, "the board is already being recorded (a drill or a teach session): finish that first")
            if not at.available()["add_span"]:
                raise HTTPException(503, "aankhen.dataset.add_span is not in this checkout yet: taps would be lost")
            now = time.time()
            day = time.strftime("%Y-%m-%d", time.localtime(now))
            folder = os.path.join(_drill_dir(), "minidrill", day, time.strftime("%H%M%S", time.localtime(now)) + "-mini")
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, "raw.akr")
            src.record_to(path, {"label": "minidrill", "fan": fan})
            mini.update(recording=path, folder=folder, started=now, open=None, spans=[], dropped=[], fan=fan)
        bus.publish("aankhen", "minidrill", "Mini drill: recording, tap where you are")
        return _mini_view()

    @app.post("/api/aankhen/minidrill/tap")
    def minidrill_tap(zone: Optional[str] = Body(None, embed=True)):
        now = time.time()
        with lock:
            if not mini["recording"]:
                raise HTTPException(400, "no mini drill is recording: press Start first")
            names = _zone_names(hub)
            if zone is not None and names and zone not in names:
                raise HTTPException(400, f"unknown place {zone!r}")
            closed = _close(now)
            if zone is not None:
                mini["open"] = {"zone": zone, "name": names.get(zone, zone), "t0": now}
        return {**_mini_view(), "closed": closed}

    @app.post("/api/aankhen/minidrill/stop")
    def minidrill_stop():
        now = time.time()
        with lock:
            if not mini["recording"]:
                return _mini_view()
            closed = _close(now)
            src = getattr(hub, "source", None)
            try:
                if src is not None:
                    src.stop_recording()
            finally:
                view = {**_mini_view(), "closed": closed, "recording": None}
                mini.update(recording=None, open=None)
        n = len(view["spans"])
        bus.publish("aankhen", "minidrill", f"Mini drill saved: {n} span{'s' if n != 1 else ''}")
        return view

    # ------------------------------------------------------------------ verify / correct
    @app.post("/api/aankhen/correct")
    def correct(zone: str = Body(..., embed=True), seconds: float = Body(10, embed=True),
                confirmed: bool = Body(False, embed=True)):
        if not (2 <= seconds <= CORRECT_MAX_S):
            raise HTTPException(400, f"seconds is between 2 and {CORRECT_MAX_S:.0f}")
        names = _zone_names(hub)
        if names and zone not in names:
            raise HTTPException(400, f"unknown place {zone!r}")
        rec = at.correction_recording(mini["recording"], hub)
        if rec is None:
            raise HTTPException(400, "nothing is recording the real board right now, so the last "
                                     f"{seconds:.0f} s are not on disk to label")
        now = time.time()
        t0 = now - seconds
        # Two taps in a row must not label the same seconds twice: the second starts where
        # the first ended (same recording only).
        prev = last_correction.get("t1") if last_correction.get("recording") == rec else None
        if prev is not None and prev > t0:
            t0 = prev
        if now - t0 < MIN_SPAN_S:
            raise HTTPException(409, "those seconds are already labelled")
        source = "confirmed" if confirmed else "correction"
        try:
            saved = at.add_span(rec, t0, now, zone, source)
        except at.TrainingUnavailable as e:
            _unavailable(e)
        except ValueError as e:
            raise HTTPException(400, str(e))
        last_correction.update(recording=rec, t1=now)
        bus.publish("aankhen", "correct", f"Aankhen: {'confirmed' if confirmed else 'corrected to'} "
                                          f"{names.get(zone, zone)} for {now - t0:.0f} s")
        return {"ok": True, "zone": zone, "name": names.get(zone, zone), "source": source, "recording": rec,
                "t0": t0, "t1": now, "seconds": round(now - t0, 1), "saved": saved if isinstance(saved, dict) else None}

    # ------------------------------------------------------------------ narration labelling
    def _sessions() -> list:
        root = _narrate_dir()
        out = []
        if not os.path.isdir(root):
            return out
        for day in sorted(os.listdir(root), reverse=True):
            d = os.path.join(root, day)
            if not os.path.isdir(d) or len(day) != 10:
                continue
            for sid in sorted(os.listdir(d), reverse=True):
                f = os.path.join(d, sid)
                if os.path.exists(os.path.join(f, "session.json")):
                    out.append({"day": day, "session": sid, "folder": f,
                                "labelled": os.path.exists(os.path.join(f, "labels.jsonl")),
                                "has_raw": os.path.exists(os.path.join(f, "raw.akr"))})
        return out[:20]

    def _audio_files() -> list:
        found = []
        for d in _audio_dirs():
            try:
                for e in os.scandir(d):
                    if e.is_file() and e.name.lower().endswith(AUDIO_EXT):
                        st = e.stat()
                        found.append({"path": e.path, "name": e.name, "mb": round(st.st_size / 1e6, 1),
                                      "modified": st.st_mtime})
            except OSError:
                continue
        return sorted(found, key=lambda f: -f["modified"])[:10]

    @app.get("/api/aankhen/narrate/sessions")
    def narrate_sessions():
        return {"sessions": _sessions(), "audio": _audio_files(), "job": narr.view()}

    def _narr_view() -> dict:
        return {"job": narr.view(), "summary": narr.result if narr.state == "done" else None}

    @app.get("/api/aankhen/narrate/label")
    def narrate_label_view():
        return _narr_view()

    @app.post("/api/aankhen/narrate/label")
    def narrate_label(audio: str = Body(..., embed=True), session: str = Body("latest", embed=True),
                      language: Optional[str] = Body("en", embed=True)):
        from aankhen import narrate as nr
        path = os.path.abspath(os.path.expanduser(audio.strip().strip('"')))
        if not os.path.isfile(path):
            raise HTTPException(400, f"no audio file at {path}")
        if not path.lower().endswith(AUDIO_EXT):
            raise HTTPException(400, "that is not an audio file (" + ", ".join(AUDIO_EXT) + ")")
        root = _narrate_dir()
        folder = nr.latest(root) if session == "latest" else os.path.abspath(session)
        if not folder:
            raise HTTPException(400, "no narration session yet: record one first (python -m aankhen narrate record)")
        if not _inside(folder, root) or not os.path.exists(os.path.join(folder, "session.json")):
            raise HTTPException(400, "the session must be a narration folder under data/aankhen/drill/narrate")
        lang = None if language in (None, "", "auto") else language

        def work(progress):
            info = nr.load_session(folder)
            if info.host_start_sync is None:
                raise ValueError("this session has no start chirp time: it cannot be lined up with the audio")
            progress("reading the audio", 0.05)
            sound = nr.load_audio(path)
            progress("finding the sync chirps", 0.15)
            syncs = nr.find_syncs(sound)
            nr.clock_map(syncs, info.host_start_sync, info.host_end_sync)    # fails fast, before Whisper
            progress("transcribing what you said (the long part)", 0.25)
            words = nr.transcribe(path, lang)
            progress("turning words into places", 0.9)
            rep = nr.label_session(folder, path, language=lang, words_audio=words, audio=sound)
            labels = rep.get("labels", [])
            return {"folder": folder, "audio": path, "words": rep.get("words"),
                    "syncs": rep.get("syncs"), "clock": (rep.get("clock") or {}).get("note"),
                    "stretches": len(labels), "minutes": rep.get("minutes", {}),
                    "has_empty": any(l.get("kind") == "empty" for l in labels),
                    "labels": [{"zone": l["zone"], "seconds": round(l["t_end"] - l["t_start"], 1),
                                "activity": l.get("activity")} for l in labels[:80]]}

        def done(j: at.Job):
            bus.publish("aankhen", "narrate", f"Narration labelled: {j.result['stretches']} stretches"
                        if j.state == "done" else f"Narration labelling failed: {j.error}")
        if not narr.start(work, {"audio": path, "session": folder}, done):
            raise HTTPException(409, "a narration is already being labelled")
        return _narr_view()

    # handles for tests
    app.state.aankhen_train_jobs = {"train": train, "narrate": narr, "mini": mini}

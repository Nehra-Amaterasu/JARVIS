"""Label a real day by talking: record the board while living normally, narrate into the
phone ("bathroom", "wardrobe", "sitting at the desk"), and turn the narration into
time-stamped labels the fingerprint models train on.

    python -m aankhen narrate record [--fan on|off] [--max-minutes 120] [--note ...]
    python -m aankhen narrate label  <session folder | latest> <phone audio file> [--dry-run]
    python -m aankhen narrate list

WHY (Aman, 2026-10-26)
  The drill holds one pose for 50 s in a random order: clean, but nothing like a real
  morning. A routine (getting ready for college, resting after it) is how the room is
  really used, so its windows teach what the live view will actually see. The cost is
  label precision, which is what the narration and the sync chirps buy back.

THE CLOCK PROBLEM, AND THE CHIRPS
  The board's frames carry the laptop's clock (raw.akr host times). The phone's recording
  has its own clock that starts whenever he pressed record. To put a spoken word on the
  laptop's timeline, the laptop plays a sync sound at a time it writes down; the phone
  records it; finding it in the audio pins audio time to host time. A second sound at the
  end measures the phone's clock drift (tens of ppm, ~0.1-0.2 s an hour), so the mapping
  is a line, not just an offset. Each sound is two 0.6 s sweeps (1-4 kHz), found by
  matched filtering: robust to the phone's noise suppression and a room's echo.

WHAT HE SAYS (any order, any time; Hinglish is fine for the free words)
  a place      "desk chair", "standing at the desk", "on the bed", "bathroom", "wardrobe",
               "balcony door", "room door", "leaving the room" ... (PHRASES below)
  an activity  "sitting", "standing", "lying", "walking", "typing", "still"
  the fan      "fan on", "fan off"
  a pause      "pause" / "ignore this" (unlabelled until the next place)
  Each statement holds until the next one. Leaving the room is the day's empty-room
  reference (as in the drill), so say it when the room really is empty.

HONEST LIMITS
  - Speech lags the movement by ~1 s and he moves before saying where he is going. Each
    label starts at the word and drops the last LAG_END_S before the next word; the
    fingerprint loader also discards its first PURGE_S (5 s). Short stops are lost.
  - Whisper mishears. Every session gets a review table; labels.jsonl is plain text to
    correct by hand before training.
  - The labels are only as true as the board's position. Data recorded with the board in
    one place does not transfer to another place; move it, and the dataset starts again.

OUTPUT  data/aankhen/drill/narrate/YYYY-MM-DD/<HHMMSS>-narrate/
  raw.akr, session.json (sync times), transcript.json (words in host time), labels.jsonl
  (the drill's format: t_start, t_end, zone, activity, fan, kind, verdict="ok")
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np

from .drill import DRILL_DIR, read_labels
from .zones import ZONE_IDS

NARRATE_DIR = os.path.join(DRILL_DIR, "narrate")   # under DRILL_DIR: the app's record route accepts only that tree

PLAY_RATE = 48000
DETECT_RATE = 16000
SWEEP_S, SWEEP_GAP_S = 0.6, 0.3
F0, F1 = 1000.0, 4000.0
MIN_PEAK_RATIO = 8.0       # matched-filter peak over the median |correlation|: below this it is not our sound
REL_PEAK = 0.3             # ... and within this share of the strongest peak in the same search span
LAG_END_S = 1.0            # he starts moving before he says where to
MIN_LABEL_S = 4.0          # shorter stretches are dropped (the loader purges 5 s anyway)
DRIFT_LIMIT = 2e-3         # a phone clock off by more than 0.2 % is a bad match, not drift

# ---------------------------------------------------------------- the sync sound
def sweep(rate: int) -> np.ndarray:
    t = np.arange(int(SWEEP_S * rate)) / rate
    phase = 2 * np.pi * (F0 * t + (F1 - F0) * t * t / (2 * SWEEP_S))
    return (np.sin(phase) * np.hanning(len(t))).astype(np.float32)


def sync_sound(rate: int) -> np.ndarray:
    """Two sweeps with a gap: a pattern no voice, fan or door makes."""
    s = sweep(rate)
    return np.concatenate([s, np.zeros(int(SWEEP_GAP_S * rate), np.float32), s])


def pick_speaker(hint: str = "speaker") -> tuple[Optional[int], str]:
    """The laptop's own speakers, not the default output: on 2026-10-26 the default was a
    Bluetooth headphone, so the first chirp played into the headphones and the room heard
    nothing (laptop mic peak 0.001). The first output device on the MME host whose name
    contains `hint` (case-insensitive); else the default."""
    import sounddevice as sd
    devs, apis = sd.query_devices(), sd.query_hostapis()
    for i, d in enumerate(devs):
        if d["max_output_channels"] > 0 and apis[d["hostapi"]]["name"] == "MME" and hint.lower() in d["name"].lower():
            return i, d["name"]
    i = sd.default.device[1]
    return i, sd.query_devices(i)["name"]


def play_sync(volume: float = 0.8, device: Optional[int] = None) -> float:
    """Play the sync sound; return the host epoch time at which its first sample left the
    speaker, as close as the audio API can say (start time + the stream's output latency)."""
    import sounddevice as sd
    sig = sync_sound(PLAY_RATE) * volume
    with sd.OutputStream(samplerate=PLAY_RATE, channels=1, dtype="float32", latency="low", device=device) as st:
        t0 = time.time() + float(st.latency)
        st.write(sig.reshape(-1, 1))
    return t0


SEARCH_S = 300.0   # the chirps are played at the start and the end, so only the first and last 5 min are searched


def _match(audio: np.ndarray, rate: int, min_sep_s: float) -> list[tuple[float, float]]:
    tpl = sync_sound(rate)
    if len(audio) < len(tpl):
        return []
    n = len(audio) + len(tpl) - 1
    nfft = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(audio, nfft) * np.conj(np.fft.rfft(tpl, nfft)), nfft)[:len(audio)]
    # normalise by the energy under the template (a running sum: np.convolve was O(N*M),
    # 4 min for 80 s of audio) so a loud voice cannot outscore a quiet chirp
    c = np.concatenate([[0.0], np.cumsum(audio.astype(np.float64) ** 2)])
    hi = np.minimum(np.arange(len(audio)) + len(tpl), len(audio))
    energy = np.sqrt(c[hi] - c[np.arange(len(audio))] + 1e-12)
    score = np.abs(corr) / energy
    floor = float(np.median(score)) + 1e-12
    out: list[tuple[float, float]] = []
    for i in np.argsort(score)[::-1][:2000]:
        r = float(score[i] / floor)
        if r < MIN_PEAK_RATIO:
            break
        if all(abs(i / rate - t) > min_sep_s for t, _ in out):
            out.append((i / rate, r))
        if len(out) >= 4:
            break
    # A real chirp scored ~210x the median on 1 h of noise; the best false peak 8x. Keep
    # only peaks near the strongest, so noise can never pose as the start sound.
    return [(t, r) for t, r in out if r >= REL_PEAK * out[0][1]] if out else []


def find_syncs(audio: np.ndarray, rate: int = DETECT_RATE, min_sep_s: float = 5.0) -> list[tuple[float, float]]:
    """[(audio time of a sync sound's start, peak ratio)]: matched filter over the first
    and the last SEARCH_S of the recording."""
    span = int(SEARCH_S * rate)
    if len(audio) <= 2 * span:
        return _match(audio, rate, min_sep_s)
    head = _match(audio[:span], rate, min_sep_s)
    off = len(audio) - span
    tail = [(t + off / rate, r) for t, r in _match(audio[off:], rate, min_sep_s)]
    return head + tail


def clock_map(syncs: list[tuple[float, float]], host_start: float, host_end: Optional[float]):
    """(audio t -> host t, info). Start sound = earliest found; end sound = latest, if played."""
    if not syncs:
        raise ValueError("no sync sound found in the audio: was the phone recording when the laptop chirped?")
    times = sorted(t for t, _ in syncs)
    a0 = times[0]
    k, drift_note = 1.0, "no end sound: offset only (error grows ~0.1-0.2 s an hour)"
    if host_end is not None and len(times) >= 2:
        a1 = times[-1]
        k_try = (host_end - host_start) / (a1 - a0)
        if abs(k_try - 1) <= DRIFT_LIMIT:
            k, drift_note = k_try, f"drift corrected: phone clock {1e6 * (1 / k_try - 1):+.0f} ppm against the laptop's"
        else:
            drift_note = f"end sound gave an impossible drift ({k_try:.5f}); offset only"
    return (lambda a: host_start + (a - a0) * k), {"audio_start": a0, "scale": k, "note": drift_note}


def load_audio(path: str, rate: int = DETECT_RATE) -> np.ndarray:
    """Any phone recording (m4a/aac/mp3/wav/opus) -> mono float32 at `rate`. Uses PyAV,
    which faster-whisper already depends on."""
    import av
    chunks = []
    bad = 0
    with av.open(path) as f:
        stream = f.streams.audio[0]
        rs = av.AudioResampler(format="flt", layout="mono", rate=rate)
        # packet by packet: the second real recording (2026-10-26) had a corrupt frame
        # and decode() gave up on the whole file ("Invalid data ... avcodec_send_packet")
        for packet in f.demux(stream):
            try:
                frames = packet.decode()
            except av.error.InvalidDataError:
                bad += 1
                continue
            for frame in frames:
                for o in rs.resample(frame):
                    chunks.append(o.to_ndarray().reshape(-1))
        for o in rs.resample(None):
            chunks.append(o.to_ndarray().reshape(-1))
    if bad:
        print(f"  {bad} unreadable audio packet(s) skipped")
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)


# ---------------------------------------------------------------- words -> labels
# Longest phrases win; matched on lower-case words without punctuation.
PHRASES: dict[str, tuple[str, str]] = {}


def _p(kind: str, value: str, *texts: str) -> None:
    for t in texts:
        PHRASES[t] = (kind, value)


_p("zone", "at_desk_chair", "desk chair", "sitting at the desk", "sitting at desk", "at the desk", "at desk", "desk",
   "sitting on chair", "sitting on the chair", "on the chair", "chair in front of desk")
_p("zone", "desk_standing", "standing at the desk", "standing at desk", "standing near the desk",
   "standing behind the chair", "behind the chair")
_p("zone", "beside_bed_desk_side", "beside the bed desk side", "between bed and desk", "between the bed and the desk",
   "between the bed and the chair", "between bed and chair")
_p("zone", "bed_lying", "lying on the bed", "lying on bed", "lying down", "on the bed lying", "bistar",
   "lying still on the bed", "lying still in the bed", "lying in the bed")
_p("zone", "bed_sitting", "sitting on the bed", "sitting on bed", "edge of the bed", "on the bed", "bed")
_p("zone", "standing_on_bed", "standing on the bed", "standing on bed")
_p("zone", "beside_bed_bathroom_wall", "bathroom wall", "beside the bed bathroom side",
   "between the bathroom wall and the bed", "between the bed and the bathroom wall")
_p("zone", "outside_bathroom", "outside the bathroom", "outside bathroom", "bathroom door", "doormat", "door mat",
   "in front of the bathroom door", "in front of bathroom door", "on the doormat", "on the door mat")
_p("zone", "inside_bathroom", "in the bathroom", "inside the bathroom", "inside bathroom", "bathroom", "washroom",
   "wash basin", "sink")
_p("zone", "between_bed_and_balcony_door", "between bed and balcony", "between the bed and the balcony",
   "between balcony door and bed", "between the balcony door and the bed", "between balcony and bed",
   "bed footer", "foot of the bed", "between bed footer and balcony door")
_p("zone", "at_balcony_door", "balcony door", "at the balcony door")
_p("zone", "balcony", "on the balcony", "balcony")
_p("zone", "room_door", "room door", "at the door")
_p("zone", "wardrobe", "wardrobe", "almirah", "cupboard")
_p("zone", "out_of_room", "leaving the room", "left the room", "out of the room", "outside the room",
   "room empty", "leaving room", "kitchen", "living room", "going out",
   "outside of the room", "the room is empty", "room is empty", "room beside my room", "in room b", "room b")
_p("act", "still", "still", "sitting", "sitting still", "not moving")
_p("act", "standing", "standing")
_p("act", "lying", "lying")
_p("act", "moving", "walking", "moving", "getting ready", "dressing")
_p("act", "typing", "typing")
_p("fan", "on", "fan on", "fan is on", "fan chalu")
_p("fan", "off", "fan off", "fan is off", "fan band")
_p("pause", "pause", "pause", "ignore this", "ignore that", "scratch that",
   # someone else in the room: their movement is in the signal, so nothing is labelled until he names a place again
   "two people", "second person", "another person", "someone else", "someone came in", "somebody came")

_MAX_WORDS = max(len(k.split()) for k in PHRASES)

# What he is doing in a place when he names only the place.
DEFAULT_ACT = {"bed_lying": "lying", "inside_bathroom": "none", "balcony": "none", "out_of_room": "none",
               "beside_bed_desk_side": "moving", "beside_bed_bathroom_wall": "moving",
               "between_bed_and_balcony_door": "moving"}
# The drill's five activities: "standing" is "still" in a standing zone.
ACT_TO_DRILL = {"standing": "still"}


def _norm(w: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", w.lower().strip())


# A place named as a DIRECTION, not where he is: "looking towards the wardrobe", "moving
# towards the bathroom", "the bed is in front of me". From the first real session
# (2026-10-26): 312 keywords in 15 min, most of them directions, which the first parser
# turned into 44 fragments of 4-15 s, wardrobe and balcony stretches he never stood in.
_DIRECTION_BEFORE = {"looking", "look", "looks", "towards", "toward", "facing", "face", "staring", "pointing",
                     "rotating", "turning", "opening", "open", "closing", "close"}
_DIRECTION_AFTER = {"is", "are", "was"}


def find_events(words: list[dict]) -> list[dict]:
    """Words [{t, w}] (host time) -> events [{t, kind, value, text}], greedy longest match.
    A place word with a direction word in the 6 words before it, or followed by "is",
    is skipped: it says where something is, not where he is."""
    # Whisper sometimes gives "the bed" as one word: split so phrases match word by word
    toks = [(w["t"], x) for w in words for x in _norm(w["w"]).split()]
    out, i = [], 0
    while i < len(toks):
        hit = None
        for n in range(min(_MAX_WORDS, len(toks) - i), 0, -1):
            text = " ".join(t for _, t in toks[i:i + n])
            if text in PHRASES:
                hit = (n, text)
                break
        if hit:
            n, text = hit
            kind, value = PHRASES[text]
            before = {w for _, w in toks[max(0, i - 6):i]}
            after = toks[i + n][1] if i + n < len(toks) else ""
            if kind == "zone" and (before & _DIRECTION_BEFORE or after in _DIRECTION_AFTER):
                i += n
                continue
            out.append({"t": toks[i][0], "kind": kind, "value": value, "text": text})
            i += n
        else:
            i += 1
    return out


def events_to_labels(events: list[dict], t_end: float, fan: bool) -> list[dict]:
    """Events -> drill-format labels. A place starts a stretch; an activity or fan word
    inside it splits it; 'pause' ends labelling until the next place."""
    labels: list[dict] = []
    zone = act = None
    start = None
    explicit_act = False

    def close(t: float):
        if zone is None or start is None:
            return
        end = t - LAG_END_S
        if end - start < MIN_LABEL_S:
            return
        a = act or DEFAULT_ACT.get(zone, "still")
        labels.append({"t_start": round(start, 3), "t_end": round(end, 3), "zone": zone,
                       "activity": ACT_TO_DRILL.get(a, a), "fan": fan,
                       "kind": "empty" if zone == "out_of_room" else "zone",
                       "verdict": "ok", "source": "narration", "explicit_activity": explicit_act})

    for e in sorted(events, key=lambda e: e["t"]):
        if e["kind"] == "zone":
            # "lying still on the bed" said 20 times is one stretch, not 20 that each lose 5 s
            if e["value"] == zone or (zone == "bed_lying" and e["value"] == "bed_sitting"):
                continue
            close(e["t"])
            zone, start, act, explicit_act = e["value"], e["t"], None, False
        elif e["kind"] == "act":
            v = "lying" if zone == "bed_lying" and e["value"] == "still" else e["value"]   # lying still = lying
            if zone is None or v == (act or DEFAULT_ACT.get(zone, "still")):
                continue
            e = {**e, "value": v}
            close(e["t"])
            if e["value"] == "lying" and zone == "bed_sitting":
                zone = "bed_lying"                      # "on the bed ... lying": he lay down
            start, act, explicit_act = e["t"], e["value"], True
        elif e["kind"] == "fan":
            if (e["value"] == "on") == fan:
                continue                                # "fan is on" again: nothing changed
            close(e["t"])
            fan = e["value"] == "on"
            start = e["t"] if zone is not None else None
        elif e["kind"] == "pause":
            close(e["t"])
            zone = act = start = None
    close(t_end + LAG_END_S)
    return labels


# ---------------------------------------------------------------- transcription
def transcribe(path: str, language: Optional[str] = "en", model: Optional[str] = None) -> list[dict]:
    """Words with audio times [{a, w}] from faster-whisper. GPU large-v3-turbo when CUDA is
    there (the voice core's model), else 'small' int8 on the CPU."""
    from faster_whisper import WhisperModel
    try:
        import torch
        # the brain + the voice core's Whisper already hold ~4.4 of the 6 GB; a second
        # turbo needs ~1.6 GB, so the GPU is used only when that much is really free
        cuda = torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 2.0e9
    except Exception:
        cuda = False
    name = model or ("large-v3-turbo" if cuda else "small")
    m = WhisperModel(name, device="cuda" if cuda else "cpu", compute_type="float16" if cuda else "int8")
    segs, _ = m.transcribe(path, language=language, word_timestamps=True, vad_filter=True,
                           initial_prompt="desk, bed, bathroom, wardrobe, balcony door, room door, fan on, fan off, leaving the room")
    return [{"a": float(w.start), "w": w.word} for s in segs for w in (s.words or [])]


# ---------------------------------------------------------------- sessions
@dataclass
class SessionInfo:
    session: str
    day: str
    folder: str
    host_start_sync: Optional[float] = None
    host_end_sync: Optional[float] = None
    fan: bool = False
    note: str = ""
    started: float = 0.0
    stopped: Optional[float] = None
    firmware: Optional[str] = None
    backend: str = ""


def _write(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def new_session(fan: bool, note: str = "", root: str = NARRATE_DIR, clock=time.time) -> SessionInfo:
    now = clock()
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    sid = time.strftime("%H%M%S", time.localtime(now)) + "-narrate"
    folder = os.path.join(root, day, sid)
    os.makedirs(folder, exist_ok=True)
    return SessionInfo(sid, day, folder, fan=fan, note=note, started=now)


def save_session(info: SessionInfo) -> None:
    _write(os.path.join(info.folder, "session.json"), asdict(info))


def load_session(folder: str) -> SessionInfo:
    with open(os.path.join(folder, "session.json"), encoding="utf-8") as f:
        return SessionInfo(**json.load(f))


def latest(root: str = NARRATE_DIR) -> Optional[str]:
    found = []
    if os.path.isdir(root):
        for day in os.listdir(root):
            d = os.path.join(root, day)
            if os.path.isdir(d):
                found += [os.path.join(d, s) for s in os.listdir(d) if os.path.exists(os.path.join(d, s, "session.json"))]
    return max(found) if found else None


def apply_corrections(folder: str, labels: list[dict], t0: float) -> list[dict]:
    """Hand corrections that survive relabelling: <session>/corrections.json, a list of
        {"from_min": 10.35, "to_min": 11.3, "drop": true, "why": "a second person in the room"}
        {"from_min": 12.6, "to_min": 13.8, "zone": "between_bed_and_balcony_door", "activity": "still"}
    in minutes from the start chirp. A stretch partly inside a range is cut at its edges."""
    p = os.path.join(folder, "corrections.json")
    if not os.path.exists(p):
        return labels
    with open(p, encoding="utf-8") as f:
        fixes = json.load(f)
    out = list(labels)
    for fx in fixes:
        a, b = t0 + 60 * float(fx["from_min"]), t0 + 60 * float(fx["to_min"])
        nxt = []
        for l in out:
            s, e = l["t_start"], l["t_end"]
            if e <= a or s >= b:
                nxt.append(l)
                continue
            if s < a:
                nxt.append({**l, "t_end": round(a, 3)})
            if not fx.get("drop"):
                inner = {**l, "t_start": round(max(s, a), 3), "t_end": round(min(e, b), 3), "corrected": True}
                for k in ("zone", "activity", "fan", "kind"):
                    if k in fx:
                        inner[k] = fx[k]
                if "zone" in fx and "kind" not in fx:
                    inner["kind"] = "empty" if fx["zone"] == "out_of_room" else "zone"
                nxt.append(inner)
            if e > b:
                nxt.append({**l, "t_start": round(b, 3)})
        out = sorted((l for l in nxt if l["t_end"] - l["t_start"] >= MIN_LABEL_S), key=lambda l: l["t_start"])
    return out


def label_session(folder: str, audio_path: str, language: Optional[str] = "en", dry_run: bool = False,
                  words_audio: Optional[list[dict]] = None, audio: Optional[np.ndarray] = None) -> dict:
    """Sync, transcribe, parse, write labels.jsonl + transcript.json. Returns a report."""
    info = load_session(folder)
    if info.host_start_sync is None:
        raise ValueError("this session has no start sync time")
    audio = load_audio(audio_path) if audio is None else audio
    syncs = find_syncs(audio)
    to_host, cm = clock_map(syncs, info.host_start_sync, info.host_end_sync)
    words_audio = transcribe(audio_path, language) if words_audio is None else words_audio
    words = [{"t": round(to_host(w["a"]), 3), "a": round(w["a"], 3), "w": w["w"]} for w in words_audio]
    events = find_events(words)
    end = info.stopped or (to_host(len(audio) / DETECT_RATE))
    labels = apply_corrections(folder, events_to_labels(events, end, info.fan), info.host_start_sync)
    rep = {"syncs": [{"audio_s": round(t, 3), "ratio": round(r, 1)} for t, r in sorted(syncs)], "clock": cm,
           "words": len(words), "events": events, "labels": labels,
           "minutes": {z: round(sum(l["t_end"] - l["t_start"] for l in labels if l["zone"] == z) / 60, 2)
                       for z in sorted({l["zone"] for l in labels})}}
    if not dry_run:
        _write(os.path.join(folder, "transcript.json"), {"clock": cm, "words": words, "events": events})
        with open(os.path.join(folder, "labels.jsonl"), "w", encoding="utf-8") as f:
            for l in labels:
                f.write(json.dumps(l) + "\n")
    return rep


def relabel(folder: str, dry_run: bool = False) -> dict:
    """Labels again from the saved transcript.json (words already in host time): after the
    parser improves, or after correcting a misheard word in the transcript by hand. No
    audio, no Whisper."""
    info = load_session(folder)
    with open(os.path.join(folder, "transcript.json"), encoding="utf-8") as f:
        tr = json.load(f)
    events = find_events(tr["words"])
    end = info.stopped or (tr["words"][-1]["t"] if tr["words"] else info.started)
    labels = apply_corrections(folder, events_to_labels(events, end, info.fan), info.host_start_sync or info.started)
    rep = {"syncs": [], "clock": tr.get("clock", {"note": "from transcript.json"}), "words": len(tr["words"]),
           "events": events, "labels": labels,
           "minutes": {z: round(sum(l["t_end"] - l["t_start"] for l in labels if l["zone"] == z) / 60, 2)
                       for z in sorted({l["zone"] for l in labels})}}
    if not dry_run:
        with open(os.path.join(folder, "labels.jsonl"), "w", encoding="utf-8") as f:
            for l in labels:
                f.write(json.dumps(l) + "\n")
    return rep


def format_labels(rep: dict, t0: float) -> str:
    lines = [f"  clock: {rep['clock']['note']}", f"  {rep['words']} words, {len(rep['events'])} keywords, "
             f"{len(rep['labels'])} labelled stretches", "",
             "  from     to       seconds  place / activity / fan"]
    for l in rep["labels"]:
        a, b = l["t_start"] - t0, l["t_end"] - t0
        lines.append(f"  {a / 60:5.1f}m  {b / 60:5.1f}m  {b - a:7.0f}  {l['zone']} / {l['activity']} / "
                     f"fan {'on' if l['fan'] else 'off'}")
    lines.append("")
    lines += [f"  {z:<30} {m:5.2f} min" for z, m in rep["minutes"].items()]
    if not any(l["kind"] == "empty" for l in rep["labels"]):
        lines.append("  No 'leaving the room' stretch: this session has no empty-room reference of its own;"
                     " the loader borrows one from another session that day, or skips it.")
    return "\n".join(lines)


def sessions(root: str = NARRATE_DIR) -> list[dict]:
    """Labelled narration sessions, in the drill's shape: {day, session, folder, labels}."""
    out = []
    if not os.path.isdir(root):
        return out
    for day in sorted(os.listdir(root)):
        d = os.path.join(root, day)
        if not os.path.isdir(d) or len(day) != 10:
            continue
        for sid in sorted(os.listdir(d)):
            f = os.path.join(d, sid)
            if os.path.exists(os.path.join(f, "raw.akr")) and os.path.exists(os.path.join(f, "labels.jsonl")):
                out.append({"day": day, "session": sid, "folder": f, "labels": read_labels(f)})
    return out


assert all(v in ZONE_IDS for k, (kind, v) in PHRASES.items() if kind == "zone")

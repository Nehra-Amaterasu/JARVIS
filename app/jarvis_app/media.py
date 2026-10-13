"""JARVIS's media player: "play <song>" plays that song; pause, skip, volume; what is on.

The owner asked for "a media player where I tell Jarvis to play this song and it plays
that song". The paths, compared and measured in docs/research/2026-10-13-media-player.md,
all work with what this laptop already has (no install, no account, no paid API):

  local    a song from the music folder he chose, played by the JARVIS window's own
           <audio>. The window answers whether play() really started, so "Now playing"
           is a confirmed fact, not a hope.
  youtube  YouTube's top result in his default browser, through DuckDuckGo's documented
           backslash ("\\") first-result redirect: a YouTube search page would need a click,
           the redirect lands on the video itself, which starts on its own. Windows' media
           sessions then say whether a new browser session really started playing.
  ytmusic  a YouTube Music search in his browser; he clicks a result.
  spotify  the Spotify app, opened on a search (spotify:search:...); he clicks the top
           result. Starting a track BY NAME needs Spotify's Web API, which needs Premium
           and a registered OAuth app; both are out of scope.

Control (play, pause, next, previous, volume) presses the Windows media keys, which
Windows hands to the current media session (Spotify, a browser tab). The window's own
player is driven directly. What is playing is read from Windows' media sessions
(GlobalSystemMediaTransportControls) through PowerShell 5.1, which ships with Windows.

Every call returns a receipt: `ok`, `say` (one true sentence) and `confirmed`: True only
when something reported the effect (the window's play(), a Windows media session, or a
key press for volume, which is all a volume receipt claims).
"""
from __future__ import annotations

import base64
import difflib
import hashlib
import json
import os
import random
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote, quote_plus

SOURCES = ("auto", "local", "youtube", "ytmusic", "spotify")
ONLINE = ("youtube", "ytmusic", "spotify")
SOURCE_SAY = {"local": "your music folder", "youtube": "YouTube", "ytmusic": "YouTube Music", "spotify": "Spotify"}
ACTIONS = ("play", "pause", "toggle", "next", "prev", "volume")

# What the JARVIS window (WebView2, Chromium) can decode. WMA and ALAC are not among
# them, so they are not listed rather than found and then failing in the player.
AUDIO_EXT = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
             ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav",
             ".webm": "audio/webm"}
# A cap, so a folder chosen by mistake (a whole user profile) cannot stall the scan;
# 20,000 songs is about 100 GB of MP3s, more than any music folder on this laptop.
MAX_FILES = 20000
# A match below this is "not in your folder", and auto goes online instead. The scores
# that decided it are in the research note: an exact title scores 1.0, an artist alone
# 0.6, a query sharing one word of three with a title stays under it.
MATCH_MIN = 0.6
COVER_MIN = 0.66
FUZZY_MIN = 0.8              # "kesaria" ~ "kesariya" (0.93): speech recognition slips
VOLUME_STEP_KEYS = 5         # Windows moves 2 points per volume key: 5 presses ~ 10 %


class MediaError(ValueError):
    """A request that cannot be served as asked (the reason is said to him)."""


# ------------------------------------------------------------------ where a song opens
def youtube_url(query: str) -> str:
    """DuckDuckGo's "\\" goes straight to the first result; site:youtube.com keeps that a
    YouTube page. Checked 2026-10-13: "\\Blinding Lights The Weeknd site:youtube.com"
    answered with a 0-second refresh to youtube.com/watch?v=... (research note)."""
    return "https://duckduckgo.com/?q=" + quote_plus(f"\\{query} site:youtube.com")


def ytmusic_url(query: str) -> str:
    return "https://music.youtube.com/search?q=" + quote_plus(query)


def spotify_uri(query: str) -> str:
    return "spotify:search:" + quote(query, safe="")


# ------------------------------------------------------------------ words
_STOP = {"the", "a", "an", "of", "to", "in", "on", "and", "by", "feat", "ft", "featuring", "official", "audio",
         "video", "lyrics", "lyric", "song", "music", "hd", "hq", "remastered", "remaster", "version", "full",
         "mp3", "explicit"}


def words(text: str) -> list[str]:
    """Lower-case words without punctuation, in any script ("Kesariya", "केसरिया")."""
    t = (text or "").casefold().replace("'", "").replace("’", "")
    return [w for w in re.findall(r"\w+", t) if w not in _STOP and w != "_"]


def _guess_from_name(stem: str) -> tuple[str, str]:
    """(title, artist) from a file name: "The Weeknd - Blinding Lights", "01. Song"."""
    s = re.sub(r"^\s*\d{1,3}\s*[-._)]\s*", "", stem.replace("_", " ")).strip()
    if " - " in s:
        artist, title = s.split(" - ", 1)
        return title.strip(), artist.strip()
    return s, ""


def _tags(path: Path) -> dict:
    """Title, artist, album and track number from the file's own tags (mutagen, already
    in the venv); {} when the file has none or cannot be read."""
    try:
        import mutagen
        f = mutagen.File(str(path), easy=True)
    except Exception:
        return {}
    if f is None or not getattr(f, "tags", None):
        return {}

    def first(key):
        try:
            v = f.tags.get(key)
        except Exception:
            return ""
        return str(v[0]).strip() if v else ""
    n = re.match(r"\d+", first("tracknumber") or "")
    return {"title": first("title"), "artist": first("artist") or first("albumartist"), "album": first("album"),
            "track": int(n.group()) if n else None}


# ------------------------------------------------------------------ the music folder
class MusicLibrary:
    """The songs in his music folder, indexed once and kept in data/app/media."""

    def __init__(self, index_path: Path):
        self.index_path = index_path
        self.folder: Optional[Path] = None
        self.tracks: list[dict] = []
        self.scanned_at: Optional[float] = None
        self.scanning = False
        self.truncated = False
        self._vocab: list[str] = []
        self._where: dict[str, list[int]] = {}
        self._by_initial: dict[str, list[str]] = {}
        self._load()

    # ------------------------------------------------------------ persistence
    def _load(self) -> None:
        try:
            d = json.loads(self.index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        self.folder = Path(d["folder"]) if d.get("folder") else None
        self.tracks = list(d.get("tracks") or [])
        self.scanned_at = d.get("scanned_at")
        self.truncated = bool(d.get("truncated"))
        self._reindex()

    def _save(self) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.index_path.with_suffix(".tmp")
        tracks = [{k: v for k, v in t.items() if not k.startswith("_")} for t in self.tracks]
        tmp.write_text(json.dumps({"folder": str(self.folder) if self.folder else None, "tracks": tracks,
                                   "scanned_at": self.scanned_at, "truncated": self.truncated},
                                  ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.index_path)

    def _reindex(self) -> None:
        # word -> the tracks that have it, so a lookup scores only tracks sharing a word
        # with the query: 20,000 tracks took 358-568 ms scored one by one, ms this way.
        self._where: dict[str, list[int]] = {}
        for i, t in enumerate(self.tracks):
            t["_t"] = set(words(t.get("title", "")))
            t["_a"] = set(words(t.get("artist", "")))
            t["_all"] = t["_t"] | t["_a"] | set(words(t.get("album", ""))) | set(words(Path(t["rel"]).stem))
            for w in t["_all"]:
                self._where.setdefault(w, []).append(i)
        self._vocab = sorted(self._where)
        # Close spellings are looked for among words with the same first letter only: speech
        # recognition slips inside a name ("kesaria"), rarely on its first sound, and the
        # whole vocabulary cost ~75 ms per query word at 2,000 songs (research note).
        self._by_initial: dict[str, list[str]] = {}
        for w in self._vocab:
            self._by_initial.setdefault(w[0], []).append(w)

    # ------------------------------------------------------------ scanning
    def scan(self, folder: Path) -> dict:
        """Walk the folder for audio files. A file seen before with the same size and
        modification time keeps its tags without being opened again."""
        self.scanning = True
        t0 = time.time()
        try:
            old = {t["rel"]: t for t in self.tracks} if self.folder == folder else {}
            found, truncated = [], False
            for root, dirs, files in os.walk(folder):
                dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                for name in sorted(files):
                    p = Path(root) / name
                    if p.suffix.lower() not in AUDIO_EXT:
                        continue
                    if len(found) >= MAX_FILES:
                        truncated = True
                        break
                    found.append(p)
                if truncated:
                    break
            tracks = []
            for p in found:
                rel = str(p.relative_to(folder))
                try:
                    st = p.stat()
                except OSError:
                    continue
                prev = old.get(rel)
                if prev and prev.get("size") == st.st_size and prev.get("mtime") == int(st.st_mtime):
                    tracks.append({k: v for k, v in prev.items() if not k.startswith("_")})
                    continue
                tags = _tags(p)
                title, artist = _guess_from_name(p.stem)
                tracks.append({"id": hashlib.sha1(rel.encode("utf-8")).hexdigest()[:12], "rel": rel,
                               "title": tags.get("title") or title, "artist": tags.get("artist") or artist,
                               "album": tags.get("album") or "", "track": tags.get("track"),
                               "ext": p.suffix.lower(), "size": st.st_size, "mtime": int(st.st_mtime)})
            # Album order, so "next" after a song plays the rest of its album.
            tracks.sort(key=lambda t: (t["artist"].casefold(), t["album"].casefold(), t["track"] or 0,
                                       t["title"].casefold(), t["rel"]))
            self.folder, self.tracks, self.truncated = folder, tracks, truncated
            self.scanned_at = time.time()
            self._reindex()
            self._save()
            return {"tracks": len(tracks), "truncated": truncated, "took_s": round(time.time() - t0, 2)}
        finally:
            self.scanning = False

    def forget(self) -> None:
        self.folder, self.tracks, self.scanned_at, self.truncated = None, [], None, False
        self._reindex()
        self._save()

    def info(self) -> dict:
        return {"folder": str(self.folder) if self.folder else None, "tracks": len(self.tracks),
                "scanning": self.scanning, "scanned_at": self.scanned_at, "truncated": self.truncated}

    # ------------------------------------------------------------ lookup
    def get(self, track_id: str) -> Optional[dict]:
        return next((t for t in self.tracks if t["id"] == track_id), None)

    def path_of(self, track: dict) -> Optional[Path]:
        """The file for an indexed track: inside the folder and still there, else None.
        A path never comes from a request, only from this index."""
        if self.folder is None:
            return None
        p = (self.folder / track["rel"]).resolve()
        try:
            p.relative_to(self.folder.resolve())
        except ValueError:
            return None
        return p if p.is_file() else None

    def neighbour(self, track_id: Optional[str], step: int) -> Optional[dict]:
        if not self.tracks:
            return None
        i = next((n for n, t in enumerate(self.tracks) if t["id"] == track_id), -1)
        return self.tracks[(i + step) % len(self.tracks)] if i >= 0 else self.tracks[0]

    def _expand(self, q: list[str]) -> dict[str, dict[str, float]]:
        """Each query word -> the library words it may stand for, with a weight: itself,
        and close spellings, because speech recognition slips on names."""
        out = {}
        for w in q:
            m = {w: 1.0} if w in self._where else {}
            if len(w) >= 4:
                for c in difflib.get_close_matches(w, self._by_initial.get(w[0], ()), n=4, cutoff=FUZZY_MIN):
                    m.setdefault(c, difflib.SequenceMatcher(None, w, c).ratio())
            out[w] = m
        return out

    def find(self, query: str, rng: Optional[random.Random] = None) -> tuple[Optional[dict], float]:
        """(best track, score) for a spoken query. Score: 0.6 x how much of the query the
        track covers + 0.4 x how much of the track's title the query names. An artist
        alone covers the query but names no title (0.6): any of that artist's songs."""
        q = list(dict.fromkeys(words(query)))
        if not q or not self.tracks:
            return None, 0.0
        exp = self._expand(q)
        best, scored = 0.0, []
        cands = sorted({i for w in q for c in exp[w] for i in self._where.get(c, ())})
        for t in (self.tracks[i] for i in cands):
            hits = {w: max((wt for c, wt in exp[w].items() if c in t["_all"]), default=0.0) for w in q}
            cover = sum(hits.values()) / len(q)
            if cover < COVER_MIN:
                continue
            named = [tw for tw in t["_t"] if any(c == tw for w in q for c in exp[w])]
            title_hit = len(named) / len(t["_t"]) if t["_t"] else 0.0
            s = 0.6 * cover + 0.4 * title_hit
            if s >= MATCH_MIN:
                scored.append((s, t))
                best = max(best, s)
        if not scored:
            return None, 0.0
        top = [t for s, t in scored if s >= best - 0.02]
        return (rng or random).choice(top), round(best, 3)


def public(track: Optional[dict]) -> Optional[dict]:
    """A track as the window and the API see it: no file path."""
    if not track:
        return None
    return {k: track.get(k) for k in ("id", "title", "artist", "album", "ext")}


def track_say(track: dict) -> str:
    t, a = track.get("title") or "that song", track.get("artist")
    return f"{t} by {a}" if a else t


# ------------------------------------------------------------------ Windows media sessions
_GSMTC = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); if (-not $task.Wait(2000)) { throw 'timeout' }; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$propsTask = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$parent = [System.Diagnostics.Process]::GetProcessById(__PARENT__)
$last = ''
$n = 0
while ($true) {
  try {
    $rows = New-Object System.Collections.Generic.List[object]
    $sig = New-Object System.Text.StringBuilder
    foreach ($s in $mgr.GetSessions()) {
      $t = $propsTask.Invoke($null, @($s.TryGetMediaPropertiesAsync())); if (-not $t.Wait(2000)) { throw 'timeout' }
      $p = $t.Result
      $st = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      $rows.Add(@($s.SourceAppUserModelId, $p.Title, $p.Artist, $p.AlbumTitle, $st))
      [void]$sig.Append($s.SourceAppUserModelId).Append('|').Append($p.Title).Append('|').Append($p.Artist).Append('|').Append($st).Append(';')
    }
    $cur = $mgr.GetCurrentSession()
    if ($cur) { [void]$sig.Append('>').Append($cur.SourceAppUserModelId) }
    $key = $sig.ToString()
    if ($key -ne $last -or ($n % 30) -eq 0) {
      # JSON only when something changed (or as a heartbeat): ConvertTo-Json is the costly part.
      $out = foreach ($r in $rows) { [pscustomobject]@{ app = $r[0]; title = $r[1]; artist = $r[2]; album = $r[3]; status = $r[4] } }
      $line = [pscustomobject]@{ current = $(if ($cur) { $cur.SourceAppUserModelId } else { $null }); sessions = @($out) } | ConvertTo-Json -Depth 4 -Compress
      $line = [regex]::Replace($line, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
      [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $key
    }
  } catch { [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}'); [Console]::Out.Flush(); $last = '' }
  $n++
  if ($parent.HasExited) { exit }
  Start-Sleep -Milliseconds 700
}
"""


class SessionWatcher:
    """What Windows says is playing, from one long-lived PowerShell.

    A one-shot PowerShell read costs ~0.6 s of process start-up each time (measured
    2026-10-13); one process that reads in a loop every 0.7 s answers in <0.1 ms and
    builds JSON only when something changed (and every ~21 s, as a heartbeat): 2.1 % of
    one core, down from 5.4 % when it serialised every loop.
    It starts on first use, stops after IDLE_STOP_S without a reader, and exits on its
    own when this process dies (it checks the parent PID each loop). Output is pure
    ASCII (\\uXXXX escapes), so Hindi titles survive any console code page."""

    IDLE_STOP_S = 300
    FIRST_LINE_S = 4.0

    def __init__(self, spawn: Optional[Callable[[], Any]] = None):
        self._spawn = spawn or self._powershell
        self._proc = None
        self._cond = threading.Condition()
        self._snap: Optional[dict] = None
        self._seq = 0
        self._used = time.time()
        self.broken: Optional[str] = None
        self.first_line_s: Optional[float] = None     # spawn -> first reading, for the research note
        self._spawned_at = 0.0

    @staticmethod
    def _powershell():
        script = _GSMTC.replace("__PARENT__", str(os.getpid()))
        enc = base64.b64encode(script.encode("utf-16-le")).decode()
        return subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def _ensure(self) -> None:
        with self._cond:
            if self._proc is not None and self._proc.poll() is None:
                return
            try:
                self._spawned_at = time.time()
                self._proc = self._spawn()
            except Exception as e:                       # no PowerShell: say "unknown", never crash
                self.broken, self._proc = f"{type(e).__name__}: {e}", None
                return
            self._snap = None
            threading.Thread(target=self._read, args=(self._proc,), name="media-sessions", daemon=True).start()

    def warm(self) -> None:
        """Start reading now, so the first question does not wait for PowerShell."""
        self._used = time.time()
        self._ensure()

    def _read(self, proc) -> None:
        for raw in iter(proc.stdout.readline, b""):
            try:
                d = json.loads(raw.decode("ascii", "replace"))
            except ValueError:
                continue
            with self._cond:
                if self.first_line_s is None:
                    self.first_line_s = round(time.time() - self._spawned_at, 2)
                if d.get("error"):
                    self.broken = str(d["error"])[:200]
                    self._snap = None
                else:
                    self.broken = None
                    self._snap = {"current": d.get("current"), "sessions": list(d.get("sessions") or []),
                                  "at": time.time()}
                self._seq += 1
                self._cond.notify_all()
            if time.time() - self._used > self.IDLE_STOP_S:
                self.stop()
                break
        with self._cond:
            self._cond.notify_all()

    def snapshot(self, max_wait: float = FIRST_LINE_S) -> Optional[dict]:
        """The latest reading (at most ~0.7 s old), or None when sessions can't be read."""
        self._used = time.time()
        self._ensure()
        with self._cond:
            if self._snap is None and self._proc is not None:
                self._cond.wait_for(lambda: self._snap is not None or self._proc is None
                                    or self._proc.poll() is not None or self.broken is not None, max_wait)
            return self._snap

    def wait_for(self, pred: Callable[[dict], bool], timeout: float) -> Optional[dict]:
        """The first reading within `timeout` for which pred() holds, else None."""
        self._used = time.time()
        self._ensure()
        end = time.time() + timeout
        with self._cond:
            seq = -1
            while True:
                if self._snap is not None and self._seq != seq:
                    seq = self._seq
                    if pred(self._snap):
                        return self._snap
                left = end - time.time()
                if left <= 0 or self._proc is None:
                    return None
                self._cond.wait(min(left, 0.5))

    def stop(self) -> None:
        with self._cond:
            p, self._proc, self._snap = self._proc, None, None
        if p is not None and p.poll() is None:
            try:
                p.terminate()
            except OSError:
                pass


_BROWSERS = ("brave", "chrome", "msedge", "microsoftedge", "firefox", "opera", "vivaldi", "arc")


def app_kind(app_id: Optional[str]) -> str:
    a = (app_id or "").lower()
    if "spotify" in a:
        return "spotify"
    if "webview" in a or "python" in a or "jarvis" in a:
        return "jarvis"
    if any(b in a for b in _BROWSERS):
        return "browser"
    return "other"


def app_name(app_id: Optional[str]) -> str:
    a = (app_id or "").lower()
    for key, name in (("spotify", "Spotify"), ("brave", "Brave"), ("chrome", "Chrome"), ("edge", "Edge"),
                      ("firefox", "Firefox"), ("opera", "Opera"), ("vivaldi", "Vivaldi"), ("webview", "JARVIS"),
                      ("python", "JARVIS")):
        if key in a:
            return name
    return re.split(r"[.!_]", app_id or "an app")[0] or "an app"


def describe_session(s: dict) -> dict:
    return {"app": app_name(s.get("app")), "kind": app_kind(s.get("app")), "title": s.get("title") or "",
            "artist": s.get("artist") or "", "album": s.get("album") or "", "status": s.get("status") or "Unknown"}


def current_session(snap: Optional[dict]) -> Optional[dict]:
    """The session the media keys reach: Windows' current one, else one that plays."""
    if not snap or not snap.get("sessions"):
        return None
    ss = snap["sessions"]
    cur = next((s for s in ss if s.get("app") == snap.get("current")), None)
    playing = [s for s in ss if s.get("status") == "Playing"]
    if cur is not None and (cur.get("status") == "Playing" or not playing):
        return cur
    return playing[0] if playing else ss[0]


def session_say(s: dict) -> str:
    d = describe_session(s)
    what = f"{d['title']} by {d['artist']}" if d["title"] and d["artist"] else d["title"] or "something"
    return f"{what} in {d['app']}"


def _playing_set(snap: Optional[dict]) -> set:
    return {(s.get("app"), s.get("title")) for s in (snap or {}).get("sessions") or [] if s.get("status") == "Playing"}


class WindowsMedia:
    """The real side effects: open a link, press a media key, read the sessions.
    JARVIS_MEDIA_OS=0 (the app's test suite sets it) turns every effect into an error,
    so no test can open a browser or press a key on this laptop by accident."""

    VK = {"play_pause": 0xB3, "next": 0xB0, "prev": 0xB1, "stop": 0xB2,
          "volume_up": 0xAF, "volume_down": 0xAE, "mute": 0xAD}

    def __init__(self):
        self.watcher = SessionWatcher()

    @staticmethod
    def _allowed() -> None:
        if os.environ.get("JARVIS_MEDIA_OS") == "0":
            raise RuntimeError("media OS calls are off (JARVIS_MEDIA_OS=0)")

    def open(self, uri: str) -> None:
        self._allowed()
        os.startfile(uri)                            # noqa: S606 — a URI this module built, never a request's

    def key(self, name: str, times: int = 1) -> None:
        self._allowed()
        import ctypes
        vk = self.VK[name]
        for _ in range(max(1, int(times))):
            ctypes.windll.user32.keybd_event(vk, 0, 1, 0)        # KEYEVENTF_EXTENDEDKEY
            ctypes.windll.user32.keybd_event(vk, 0, 1 | 2, 0)    # ... | KEYEVENTF_KEYUP

    def sessions(self, max_wait: float = SessionWatcher.FIRST_LINE_S) -> Optional[dict]:
        if os.environ.get("JARVIS_MEDIA_OS") == "0":
            return None
        return self.watcher.snapshot(max_wait)

    def wait_for(self, pred: Callable[[dict], bool], timeout: float) -> Optional[dict]:
        if os.environ.get("JARVIS_MEDIA_OS") == "0":
            return None
        return self.watcher.wait_for(pred, timeout)

    def warm(self) -> None:
        if os.environ.get("JARVIS_MEDIA_OS") != "0":
            self.watcher.warm()

    def close(self) -> None:
        self.watcher.stop()


# ------------------------------------------------------------------ the player
class MediaPlayer:
    """Plans and runs play / control / state. The window round trip for the local player
    (publish, wait for its answer) lives in routes_media.py, which owns the event bus."""

    CONFIRM_S = 6.0          # a cold browser start plus page load took 2-5 s here
    CONTROL_CONFIRM_S = 2.5

    def __init__(self, root: Path, system=None, clock: Callable[[], float] = time.time,
                 rng: Optional[random.Random] = None, confirm_s: Optional[float] = None):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.system = system if system is not None else WindowsMedia()
        self.clock = clock
        self.rng = rng
        self.confirm_s = self.CONFIRM_S if confirm_s is None else confirm_s
        self.library = MusicLibrary(root / "library.json")
        self.settings = {"default_source": "auto"}
        try:
            saved = json.loads((root / "settings.json").read_text(encoding="utf-8"))
            if saved.get("default_source") in SOURCES:
                self.settings["default_source"] = saved["default_source"]
        except (OSError, ValueError):
            pass
        self.last: Optional[dict] = None
        self.local: dict = {"state": "idle", "track": None, "at": None}
        self._lock = threading.Lock()

    # ------------------------------------------------------------ settings
    def set_default_source(self, source: str) -> None:
        if source not in SOURCES:
            raise MediaError(f"source must be one of {', '.join(SOURCES)}")
        self.settings["default_source"] = source
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "settings.json").write_text(json.dumps(self.settings), encoding="utf-8")

    @staticmethod
    def check_folder(raw: str) -> Path:
        p = Path((raw or "").strip().strip('"').strip("'")).expanduser()
        if not str(p) or not p.is_absolute():
            raise MediaError("Give the full path of your music folder, e.g. C:\\Users\\you\\Music.")
        if not p.is_dir():
            raise MediaError(f"No such folder: {p}")
        if p.parent == p:
            raise MediaError("Pick your music folder, not a whole drive.")
        return p

    def view(self) -> dict:
        return {"settings": dict(self.settings), "library": self.library.info(), "sources": list(SOURCES)}

    # ------------------------------------------------------------ receipts
    def _receipt(self, ok: bool, say: str, action: str, *, source: Optional[str] = None, confirmed: bool = False,
                 query: Optional[str] = None, **extra) -> dict:
        r = {"ok": ok, "say": say, "action": action, "source": source, "confirmed": bool(ok and confirmed),
             "query": query, "at": self.clock(), **extra}
        if action == "play":
            self.last = {k: r[k] for k in ("ok", "say", "source", "confirmed", "query", "at")}
        return r

    # ------------------------------------------------------------ play
    def plan(self, query: str, source: str = "auto", window: bool = True) -> dict:
        """Where "play <query>" goes. {"kind": "local", "track"} (the window plays it),
        {"kind": "online", "source", "uri"} or {"kind": "done", "receipt"} (refused)."""
        query = re.sub(r"\s+", " ", (query or "")).strip()[:200]
        if source not in SOURCES:
            raise MediaError(f"source must be one of {', '.join(SOURCES)}")
        if not query:
            raise MediaError("say what to play")
        if source == "auto":
            source = self.settings["default_source"]
        if source in ("auto", "local"):
            track, score = self.library.find(query, self.rng) if self.library.tracks else (None, 0.0)
            if track is not None and window:
                return {"kind": "local", "track": track, "score": score, "query": query}
            if source == "local":
                if self.library.folder is None:
                    why = "No music folder is set yet: choose one on the Media card."
                elif track is None:
                    why = f"Nothing in your music folder matches “{query}”."
                else:
                    why = f"Found {track_say(track)} in your music folder, but the JARVIS window isn't open to play it."
                return {"kind": "done", "receipt": self._receipt(False, why, "play", source="local", query=query)}
            source = "youtube"                       # auto, and the folder has no match
        uri = {"youtube": youtube_url, "ytmusic": ytmusic_url, "spotify": spotify_uri}[source](query)
        return {"kind": "online", "source": source, "uri": uri, "query": query}

    def open_online(self, plan: dict) -> dict:
        """Open the link; for YouTube, wait (up to CONFIRM_S) for Windows to report a NEW
        playing session, so "Now playing" is said only when something really plays."""
        source, query = plan["source"], plan["query"]
        # The reading BEFORE opening is what makes a new session provably ours. A cold
        # watcher took 1.3-2.6 s to its first reading here, hence the full first-line wait.
        before = self.system.sessions(max_wait=SessionWatcher.FIRST_LINE_S) if source == "youtube" else None
        try:
            self.system.open(plan["uri"])
        except OSError as e:
            why = ("Spotify isn't installed here (nothing opens spotify: links)." if source == "spotify"
                   else f"Windows couldn't open your browser: {e}.")
            return self._receipt(False, why, "play", source=source, query=query, error=str(e))
        except RuntimeError as e:
            return self._receipt(False, f"I couldn't open {SOURCE_SAY[source]}: {e}.", "play", source=source,
                                 query=query, error=str(e))
        if source == "spotify":
            return self._receipt(True, f"Opened Spotify on a search for “{query}”. Spotify needs one click on the "
                                 "top result to start it; I can't press play on a search without its paid Web API.",
                                 "play", source=source, query=query, needs_click=True)
        if source == "ytmusic":
            return self._receipt(True, f"Opened a YouTube Music search for “{query}” in your browser; click a result "
                                 "to start it.", "play", source=source, query=query, needs_click=True)
        opened = f"Opened YouTube's top result for “{query}” in your browser; "
        if before is None:
            # Without a reading from before, a tab that was already playing would pass for
            # the new one: no confirmation at all is the honest answer.
            return self._receipt(True, opened + "I can't read Windows' media sessions, so I can't confirm it "
                                 "started.", "play", source=source, query=query)
        seen = _playing_set(before)

        def new_tab(s: dict) -> bool:
            return (s.get("status") == "Playing" and app_kind(s.get("app")) not in ("spotify", "jarvis")
                    and (s.get("app"), s.get("title")) not in seen)
        got = self.system.wait_for(lambda snap: any(new_tab(s) for s in snap.get("sessions") or []),
                                   self.confirm_s) if self.confirm_s > 0 else None
        if got:
            s = next(s for s in got["sessions"] if new_tab(s))
            return self._receipt(True, f"Now playing {session_say(s)}: YouTube's top result for “{query}”.", "play",
                                 source=source, query=query, confirmed=True, session=describe_session(s))
        return self._receipt(True, opened + "Windows hasn't reported it playing yet.", "play", source=source,
                             query=query)

    def local_result(self, plan: dict, answer: Optional[dict]) -> dict:
        """The receipt for a song sent to the window, from the window's own answer."""
        track, query = plan["track"], plan["query"]
        if answer is None:
            return self._receipt(False, f"Found {track_say(track)} in your music folder, but the JARVIS window isn't "
                                 "open to play it.", "play", source="local", query=query, track=public(track))
        if answer.get("ok"):
            with self._lock:
                self.local = {"state": "playing", "track": public(track), "at": self.clock()}
            return self._receipt(True, f"Now playing {track_say(track)} from your music folder.", "play",
                                 source="local", query=query, confirmed=True, track=public(track))
        err = str(answer.get("error") or "no answer")
        if "NotAllowed" in err:
            why = (f"{track_say(track)} is loaded, but the window blocked autoplay: press play on the Media card.")
        elif err == "timeout":
            why = f"I sent {track_say(track)} to the window, but it didn't answer."
        else:
            why = f"The window couldn't play {track_say(track)}: {err[:120]}."
        return self._receipt(False, why, "play", source="local", query=query, track=public(track), error=err)

    # ------------------------------------------------------------ control
    def local_active(self) -> bool:
        """Is the window's own player the one he means? Yes while it plays, or while it
        holds a paused song and nothing else is playing."""
        st = self.local.get("state")
        if not self.local.get("track") or st not in ("playing", "paused"):
            return False
        if st == "playing":
            return True
        snap = self.system.sessions(max_wait=0.5)
        cur = current_session(snap)
        return not (cur and cur.get("status") == "Playing" and app_kind(cur.get("app")) != "jarvis")

    def control(self, action: str, value: Any = None, target: Optional[str] = None) -> dict:
        """{"kind": "local", "action"} (the window does it), {"kind": "local_play", "track"}
        (next/previous in the folder) or {"kind": "done", "receipt"} (keys pressed).
        target="local": the window's own player, whatever else plays (its song ended and
        it asks for the next one)."""
        if action not in ACTIONS:
            raise MediaError(f"action must be one of {', '.join(ACTIONS)}")
        if action == "volume":
            return {"kind": "done", "receipt": self._volume(value)}
        if target == "local" and not self.library.tracks:
            return {"kind": "done", "receipt": self._receipt(False, "Your music folder has no songs to play.", action,
                                                             source="local", error="empty folder")}
        if target == "local" or self.local_active():
            if action in ("next", "prev"):
                cur = (self.local.get("track") or {}).get("id")
                t = self.library.neighbour(cur, 1 if action == "next" else -1)
                if t is not None:
                    return {"kind": "local_play", "track": t, "query": track_say(t), "action": action}
            else:
                if action == "toggle":
                    action = "pause" if self.local["state"] == "playing" else "play"
                return {"kind": "local", "action": action}
        return {"kind": "done", "receipt": self._keys(action)}

    def local_control_result(self, action: str, answer: Optional[dict]) -> dict:
        track = self.local.get("track") or {}
        if answer and answer.get("ok"):
            with self._lock:
                self.local = {**self.local, "state": "playing" if action == "play" else "paused", "at": self.clock()}
            verb = "Resumed" if action == "play" else "Paused"
            return self._receipt(True, f"{verb} {track_say(track)} in the JARVIS window.", action, source="local",
                                 confirmed=True)
        err = str((answer or {}).get("error") or "the window isn't open")
        return self._receipt(False, f"The window's player didn't {action}: {err[:120]}.", action, source="local",
                             error=err)

    def _keys(self, action: str) -> dict:
        snap = self.system.sessions(max_wait=1.5)
        cur = current_session(snap)
        readable = snap is not None
        status = (cur or {}).get("status")
        if action == "toggle":
            action = "pause" if status == "Playing" else "play"
        if readable and cur is None:
            return self._receipt(False, "Nothing is playing or paused on this laptop. Say “play” and a song.",
                                 action, error="no media session")
        if action == "pause" and readable and status != "Playing":
            return self._receipt(True, f"Nothing is playing, so there was nothing to pause ({session_say(cur)} is "
                                 f"{status.lower() if status else 'idle'}).", action)
        if action == "play" and readable and status == "Playing":
            return self._receipt(True, f"Already playing {session_say(cur)}.", action, confirmed=True,
                                 session=describe_session(cur))
        key = {"play": "play_pause", "pause": "play_pause", "next": "next", "prev": "prev"}[action]
        try:
            self.system.key(key)
        except Exception as e:
            return self._receipt(False, f"I couldn't press the media key: {e}.", action, error=str(e))
        name = {"play": "play", "pause": "pause", "next": "next track", "prev": "previous track"}[action]
        if not readable:
            return self._receipt(True, f"Pressed the {name} media key; I can't read Windows' media sessions, so I "
                                 "can't confirm what it did.", action)
        app, title = cur.get("app"), cur.get("title")

        def changed(s: dict) -> bool:
            mine = next((x for x in s.get("sessions") or [] if x.get("app") == app), None)
            if mine is None:
                return False
            if action == "pause":
                return mine.get("status") == "Paused"
            if action == "play":
                return mine.get("status") == "Playing"
            return mine.get("title") != title
        got = self.system.wait_for(changed, self.CONTROL_CONFIRM_S)
        if not got:
            return self._receipt(True, f"Pressed the {name} key for {app_name(app)}; Windows hasn't reported a "
                                 "change yet.", action)
        now = next(x for x in got["sessions"] if x.get("app") == app)
        verb = {"pause": "Paused", "play": "Resumed", "next": "Skipped to", "prev": "Back to"}[action]
        return self._receipt(True, f"{verb} {session_say(now)}.", action, confirmed=True, session=describe_session(now))

    def _volume(self, value: Any) -> dict:
        v = str(value if value is not None else "up").strip().lower().rstrip("%")
        try:
            if v in ("up", "louder", "+"):
                self.system.key("volume_up", VOLUME_STEP_KEYS)
                say = "Turned the system volume up about 10 percent."
            elif v in ("down", "quieter", "softer", "-"):
                self.system.key("volume_down", VOLUME_STEP_KEYS)
                say = "Turned the system volume down about 10 percent."
            elif v in ("mute", "unmute"):
                self.system.key("mute")
                say = "Toggled mute on the system volume."
            elif v.isdigit() and 0 <= int(v) <= 100:
                # Windows can't be told a level through keys, only stepped; from 0, each
                # press is +2. 50 presses down reach 0 from anywhere.
                self.system.key("volume_down", 50)
                self.system.key("volume_up", round(int(v) / 2))
                say = f"Set the system volume to about {round(int(v) / 2) * 2} percent."
            else:
                return self._receipt(False, "Volume takes up, down, mute or a number from 0 to 100.", "volume",
                                     error="bad value")
        except Exception as e:
            return self._receipt(False, f"I couldn't press the volume keys: {e}.", "volume", error=str(e))
        # The keys were pressed, which is all this receipt claims (Windows' level itself is
        # not readable without a new package).
        return self._receipt(True, say, "volume", source="system", confirmed=True)

    # ------------------------------------------------------------ state
    def set_local(self, state: str, track_id: Optional[str] = None) -> dict:
        if state not in ("playing", "paused", "ended", "idle", "error"):
            raise MediaError("bad state")
        with self._lock:
            track = public(self.library.get(track_id)) if track_id else self.local.get("track")
            self.local = {"state": state, "track": track, "at": self.clock()}
        return self.local

    def state(self) -> dict:
        """What was last asked for, the window's own player, and what Windows says is
        playing ("unknown" when the sessions can't be read)."""
        snap = self.system.sessions(max_wait=SessionWatcher.FIRST_LINE_S)
        sessions = [describe_session(s) for s in (snap or {}).get("sessions") or []]
        cur = current_session(snap)
        if self.local.get("state") == "playing" and self.local.get("track"):
            now = {"app": "JARVIS", "kind": "jarvis", "title": self.local["track"].get("title") or "",
                   "artist": self.local["track"].get("artist") or "", "album": "", "status": "Playing"}
            say = f"Playing {track_say(self.local['track'])} from your music folder."
        elif cur is not None:
            now = describe_session(cur)
            say = f"{'Playing' if now['status'] == 'Playing' else now['status'].capitalize()}: {session_say(cur)}."
        else:
            now = None
            say = "Nothing is playing." if snap is not None else "unknown"
        watcher = getattr(self.system, "watcher", None)
        return {"now": now, "say": say, "readable": snap is not None, "sessions": sessions, "local": self.local,
                "last": self.last, "first_read_s": getattr(watcher, "first_line_s", None), **self.view()}

    def warm(self) -> None:
        warm = getattr(self.system, "warm", None)
        if warm:
            warm()

    def close(self) -> None:
        close = getattr(self.system, "close", None)
        if close:
            close()

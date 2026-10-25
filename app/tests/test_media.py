"""The media player (jarvis_app/media.py, routes_media.py): play a song by name, control
what is playing, say what is on, with a receipt that never claims more than happened.

Nothing here opens a browser, starts Spotify, presses a media key or reads the real
Windows media sessions: the player's `system` is a fake that records what it was asked
to do and plays back scripted session readings (conftest also sets JARVIS_MEDIA_OS=0,
which makes the real adapter refuse). Songs are invented files in a temp folder."""
import asyncio
import threading
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import media
from jarvis_app.media import MediaPlayer, MusicLibrary
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-media"
SPOTIFY = "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"


def s(app, title, status, artist=""):
    return {"app": app, "title": title, "artist": artist, "album": "", "status": status}


def snap(*sessions, current=None):
    return {"current": current or (sessions[0]["app"] if sessions else None), "sessions": list(sessions), "at": 0}


class FakeSystem:
    """What the player may do to the laptop, recorded; Windows' answers, scripted."""

    def __init__(self, now=None, later=()):
        self.now, self.later = now, list(later)
        self.opened, self.keys = [], []
        self.open_error = None

    def sessions(self, max_wait=0):
        return self.now

    def open(self, uri):
        if self.open_error:
            raise self.open_error
        self.opened.append(uri)

    def key(self, name, times=1):
        self.keys.append((name, times))

    def wait_for(self, pred, timeout):
        for later in self.later:
            self.now = later
            if pred(later):
                return later
        return None


def songs(folder: Path) -> Path:
    for rel in ("The Weeknd - Blinding Lights.mp3", "Arijit Singh - Kesariya.mp3", "Travis Scott - SICKO MODE.mp3",
                "Travis Scott - goosebumps.m4a", "Ed Sheeran - You Need Me.mp3", "sub/01. Late Night Study.flac"):
        p = folder / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"not really audio " + rel.encode())
    (folder / "notes.txt").write_text("not a song")
    (folder / "cover.wma").write_bytes(b"WebView2 cannot play WMA")
    return folder


@pytest.fixture
def player(tmp_path):
    return MediaPlayer(tmp_path / "media", system=FakeSystem(), confirm_s=1.0)


# ------------------------------------------------------------------ the music folder
def test_the_folder_is_indexed_from_tags_or_file_names(tmp_path):
    lib = MusicLibrary(tmp_path / "index.json")
    res = lib.scan(songs(tmp_path / "Music"))
    assert res["tracks"] == 6 and not res["truncated"]                     # no .txt, no .wma
    t = next(t for t in lib.tracks if t["title"] == "Blinding Lights")
    assert t["artist"] == "The Weeknd" and t["ext"] == ".mp3"
    assert any(t["title"] == "Late Night Study" for t in lib.tracks)      # "01. " is not the title
    again = MusicLibrary(tmp_path / "index.json")                         # persisted
    assert again.info()["tracks"] == 6 and again.get(t["id"])["title"] == "Blinding Lights"


@pytest.mark.parametrize("query, title", [
    ("Blinding Lights by The Weeknd", "Blinding Lights"),
    ("blinding lights", "Blinding Lights"),
    ("kesaria", "Kesariya"),                       # a speech-recognition slip
    ("sicko mode", "SICKO MODE"),
    ("you need me", "You Need Me"),
])
def test_a_spoken_query_finds_its_song(tmp_path, query, title):
    lib = MusicLibrary(tmp_path / "index.json")
    lib.scan(songs(tmp_path / "Music"))
    t, score = lib.find(query)
    assert t is not None and t["title"] == title, (query, score)


def test_an_artist_alone_plays_one_of_theirs_and_a_stranger_matches_nothing(tmp_path):
    lib = MusicLibrary(tmp_path / "index.json")
    lib.scan(songs(tmp_path / "Music"))
    t, score = lib.find("Travis Scott")
    assert t["artist"] == "Travis Scott" and score == pytest.approx(0.6)
    assert lib.find("shape of you") == (None, 0.0)       # shares "you" with a title: not enough
    assert lib.find("Bohemian Rhapsody") == (None, 0.0)


def test_a_file_is_served_only_from_the_index(tmp_path):
    lib = MusicLibrary(tmp_path / "index.json")
    lib.scan(songs(tmp_path / "Music"))
    t = lib.tracks[0]
    assert lib.path_of(t).is_file()
    assert lib.path_of({"rel": "..\\..\\secret.txt"}) is None             # outside the folder


# ------------------------------------------------------------------ where a song opens
def test_youtube_goes_to_the_top_result_not_a_search_page():
    url = media.youtube_url("Blinding Lights by The Weeknd")
    assert url.startswith("https://duckduckgo.com/?q=%5C") and "site%3Ayoutube.com" in url
    assert media.spotify_uri("Kesariya Arijit") == "spotify:search:Kesariya%20Arijit"
    assert media.ytmusic_url("lo-fi") == "https://music.youtube.com/search?q=lo-fi"


def test_youtube_says_now_playing_only_when_windows_reports_a_new_browser_session(player):
    player.system = FakeSystem(now=snap(s(SPOTIFY, "Old Song", "Paused")),
                               later=[snap(s(SPOTIFY, "Old Song", "Paused")),
                                      snap(s(SPOTIFY, "Old Song", "Paused"),
                                           s("Brave", "The Weeknd - Blinding Lights (Official Audio)", "Playing"))])
    plan = player.plan("Blinding Lights by The Weeknd", "youtube")
    r = player.open_online(plan)
    assert player.system.opened == [media.youtube_url("Blinding Lights by The Weeknd")]
    assert r["ok"] and r["confirmed"] and r["say"].startswith("Now playing The Weeknd - Blinding Lights")
    assert "in Brave" in r["say"] and "YouTube's top result" in r["say"]


def test_youtube_unconfirmed_is_said_as_opened(player):
    player.system = FakeSystem(now=snap(), later=[snap()])
    r = player.open_online(player.plan("Sicko Mode", "youtube"))
    assert r["ok"] and not r["confirmed"] and "Now playing" not in r["say"]
    assert "hasn't reported it playing yet" in r["say"]


def test_spotify_already_playing_is_not_taken_for_the_new_song(player):
    playing = snap(s(SPOTIFY, "Something Else", "Playing"))
    player.system = FakeSystem(now=snap(s(SPOTIFY, "Something Else", "Paused")), later=[playing])
    r = player.open_online(player.plan("Sicko Mode", "youtube"))
    assert not r["confirmed"]


def test_unreadable_sessions_are_said_honestly(player):
    player.system = FakeSystem(now=None)
    r = player.open_online(player.plan("Sicko Mode", "youtube"))
    assert r["ok"] and not r["confirmed"] and "can't read Windows' media sessions" in r["say"]


def test_spotify_opens_a_search_and_says_it_needs_a_click(player):
    r = player.open_online(player.plan("Kesariya", "spotify"))
    assert player.system.opened == ["spotify:search:Kesariya"]
    assert r["ok"] and not r["confirmed"] and r["needs_click"] and "one click" in r["say"]
    player.system.open_error = OSError("no application is associated")
    r = player.open_online(player.plan("Kesariya", "spotify"))
    assert not r["ok"] and "Spotify isn't installed" in r["say"]


def test_the_real_adapter_refuses_inside_tests(tmp_path):
    p = MediaPlayer(tmp_path / "m")                      # the real WindowsMedia, with JARVIS_MEDIA_OS=0
    r = p.open_online(p.plan("Sicko Mode", "spotify"))
    assert not r["ok"] and "JARVIS_MEDIA_OS=0" in r["say"]
    assert p.system.sessions() is None
    with pytest.raises(RuntimeError):
        p.system.key("play_pause")


def test_auto_prefers_the_folder_then_youtube(player, tmp_path):
    plan = player.plan("Blinding Lights", "auto")
    assert plan["kind"] == "online" and plan["source"] == "youtube"           # no folder yet
    player.library.scan(songs(tmp_path / "Music"))
    plan = player.plan("Blinding Lights", "auto")
    assert plan["kind"] == "local" and plan["track"]["title"] == "Blinding Lights"
    assert player.plan("Blinding Lights", "auto", window=False)["source"] == "youtube"
    assert player.plan("Bohemian Rhapsody", "auto")["source"] == "youtube"
    player.set_default_source("spotify")
    assert player.plan("Blinding Lights", "auto")["source"] == "spotify"       # his chip wins


def test_local_without_a_folder_or_a_match_says_why(player, tmp_path):
    r = player.plan("Blinding Lights", "local")["receipt"]
    assert not r["ok"] and "No music folder is set" in r["say"]
    player.library.scan(songs(tmp_path / "Music"))
    r = player.plan("Bohemian Rhapsody", "local")["receipt"]
    assert not r["ok"] and "Nothing in your music folder matches" in r["say"]


def test_the_window_decides_whether_a_local_song_is_playing(player, tmp_path):
    player.library.scan(songs(tmp_path / "Music"))
    plan = player.plan("Kesariya", "local")
    r = player.local_result(plan, {"ok": True})
    assert r["confirmed"] and r["say"] == "Now playing Kesariya by Arijit Singh from your music folder."
    assert player.local["state"] == "playing" and "rel" not in r["track"]       # no file path leaves
    r = player.local_result(plan, {"ok": False, "error": "NotAllowedError: play() failed"})
    assert not r["ok"] and "blocked autoplay" in r["say"]
    r = player.local_result(plan, None)
    assert not r["ok"] and "window isn't open" in r["say"]


# ------------------------------------------------------------------ control
def test_pause_presses_the_key_and_waits_for_windows_to_agree(player):
    player.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Playing", "Travis Scott")),
                               later=[snap(s(SPOTIFY, "SICKO MODE", "Paused", "Travis Scott"))])
    r = player.control("pause")["receipt"]
    assert player.system.keys == [("play_pause", 1)]
    assert r["confirmed"] and r["say"] == "Paused SICKO MODE by Travis Scott in Spotify."


def test_pause_never_toggles_something_into_playing(player):
    player.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Paused")))
    r = player.control("pause")["receipt"]
    assert player.system.keys == [] and "nothing to pause" in r["say"] and not r["confirmed"]
    player.system = FakeSystem(now=snap())
    r = player.control("next")["receipt"]
    assert player.system.keys == [] and not r["ok"] and "Nothing is playing" in r["say"]


def test_next_is_confirmed_by_a_new_title(player):
    player.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Playing")),
                               later=[snap(s(SPOTIFY, "SICKO MODE", "Playing")), snap(s(SPOTIFY, "goosebumps", "Playing"))])
    r = player.control("next")["receipt"]
    assert player.system.keys == [("next", 1)] and r["say"] == "Skipped to goosebumps in Spotify."


def test_resume_when_already_playing_presses_nothing(player):
    player.system = FakeSystem(now=snap(s("Brave", "Lofi Radio", "Playing")))
    r = player.control("play")["receipt"]
    assert player.system.keys == [] and r["say"].startswith("Already playing Lofi Radio in Brave")


def test_without_readable_sessions_a_key_is_pressed_and_said_unconfirmed(player):
    player.system = FakeSystem(now=None)
    r = player.control("pause")["receipt"]
    assert player.system.keys == [("play_pause", 1)] and r["ok"] and not r["confirmed"]
    assert "can't confirm" in r["say"]


@pytest.mark.parametrize("value, keys, say", [
    ("up", [("volume_up", 5)], "up about 10 percent"),
    ("down", [("volume_down", 5)], "down about 10 percent"),
    ("mute", [("mute", 1)], "Toggled mute"),
    ("30", [("volume_down", 50), ("volume_up", 15)], "about 30 percent"),
])
def test_volume_keys(player, value, keys, say):
    r = player.control("volume", value)["receipt"]
    assert player.system.keys == keys and say in r["say"] and r["ok"]


def test_bad_volume_and_actions_are_refused(player):
    assert not player.control("volume", "loud-ish")["receipt"]["ok"]
    with pytest.raises(media.MediaError):
        player.control("rewind")


def test_the_windows_own_player_is_controlled_directly(player, tmp_path):
    player.library.scan(songs(tmp_path / "Music"))
    t = player.library.find("Kesariya")[0]
    player.set_local("playing", t["id"])
    assert player.control("pause") == {"kind": "local", "action": "pause"}
    nxt = player.control("next")
    assert nxt["kind"] == "local_play" and nxt["track"]["id"] != t["id"]
    assert player.system.keys == []


# ------------------------------------------------------------------ state
def test_state_says_what_windows_says(player):
    player.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Paused", "Travis Scott")))
    st = player.state()
    assert st["say"] == "Paused: SICKO MODE by Travis Scott in Spotify." and st["readable"]
    assert st["now"]["app"] == "Spotify" and st["now"]["status"] == "Paused"
    player.system = FakeSystem(now=None)
    assert player.state()["say"] == "unknown"
    player.system = FakeSystem(now=snap())
    assert player.state()["say"] == "Nothing is playing."


# ------------------------------------------------------------------ over HTTP
@pytest.fixture
def client(tmp_path):
    app = create_app(Guard(8778, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=['media'])
    p = app.state.media
    p.library = MusicLibrary(tmp_path / "media" / "library.json")
    p.root = tmp_path / "media"
    p.system = FakeSystem(now=snap())
    p.confirm_s = 0.5
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_routes_need_the_token(client):
    assert client.get("/api/media/state", headers={"X-Jarvis-Token": "nope"}).status_code == 401


def test_play_over_http_returns_the_receipt(client):
    r = client.post("/api/media/play", json={"query": "Kesariya", "source": "spotify"}).json()
    assert r["ok"] and r["needs_click"] and r["say"].startswith("Opened Spotify on a search for “Kesariya”")
    assert client.app.state.media.system.opened == ["spotify:search:Kesariya"]
    st = client.get("/api/media/state").json()
    assert st["last"]["query"] == "Kesariya" and st["last"]["source"] == "spotify"
    assert client.post("/api/media/play", json={"query": "x", "source": "napster"}).status_code == 400


def test_control_over_http(client):
    client.app.state.media.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Playing")),
                                               later=[snap(s(SPOTIFY, "SICKO MODE", "Paused"))])
    r = client.post("/api/media/control", json={"action": "pause"}).json()
    assert r["confirmed"] and r["say"] == "Paused SICKO MODE in Spotify."
    assert client.post("/api/media/control", json={"action": "explode"}).status_code == 400


def test_play_with_nothing_named_resumes(client):
    client.app.state.media.system = FakeSystem(now=snap(s(SPOTIFY, "SICKO MODE", "Paused")),
                                               later=[snap(s(SPOTIFY, "SICKO MODE", "Playing"))])
    r = client.post("/api/media/play", json={"query": ""}).json()
    assert r["say"] == "Resumed SICKO MODE in Spotify." and client.app.state.media.system.keys == [("play_pause", 1)]


def test_settings_check_the_folder(client, tmp_path):
    assert client.put("/api/media/settings", json={"folder": "Music"}).status_code == 400          # not absolute
    assert client.put("/api/media/settings", json={"folder": "C:\\"}).status_code == 400           # a whole drive
    assert client.put("/api/media/settings", json={"folder": str(tmp_path / "nope")}).status_code == 400
    assert client.put("/api/media/settings", json={"default_source": "napster"}).status_code == 400
    v = client.put("/api/media/settings", json={"default_source": "youtube"}).json()
    assert v["settings"]["default_source"] == "youtube"


def test_a_song_from_the_folder_plays_in_the_window_and_the_window_confirms(client, tmp_path):
    """The round trip: the server sends the song to the window, the window fetches it,
    calls play() and says whether it started; the receipt is that answer."""
    folder = songs(tmp_path / "Music")
    p = client.app.state.media
    p.library.scan(folder)
    svc = client.app.state.svc
    svc.bus._subscribers.add(asyncio.Queue())                   # a window is open
    published = []
    real = svc.bus.publish
    svc.bus.publish = lambda *a, **k: (published.append((a, k)), real(*a, **k))[1]
    out = {}
    t = threading.Thread(target=lambda: out.update(r=client.post("/api/media/play", json={"query": "kesariya"})))
    t.start()
    for _ in range(200):
        if any("request_id" in k for _, k in published):
            break
        time.sleep(0.02)
    (_, kind, _), ev = next((a, k) for a, k in published if "request_id" in k)
    assert kind == "local_play" and ev["track"]["title"] == "Kesariya" and ev["ephemeral"] is True
    audio = client.get(f"/api/media/file/{ev['track']['id']}")
    assert audio.status_code == 200 and audio.content.startswith(b"not really audio")
    assert audio.headers["content-type"] == "audio/mpeg"
    assert client.post("/api/media/ack", json={"id": ev["request_id"], "ok": True}).status_code == 200
    t.join(5)
    r = out["r"].json()
    assert r["confirmed"] and r["say"] == "Now playing Kesariya by Arijit Singh from your music folder."
    assert client.post("/api/media/local", json={"state": "paused", "track_id": ev["track"]["id"]}).json()["state"] == "paused"


def test_files_and_acks_are_only_what_the_server_issued(client):
    assert client.get("/api/media/file/deadbeef0000").status_code == 404
    assert client.post("/api/media/ack", json={"id": "nope", "ok": True}).status_code == 404
    assert client.post("/api/media/local", json={"state": "dancing"}).status_code == 400


def test_scan_over_http(client, tmp_path):
    assert client.post("/api/media/scan").status_code == 400                # no folder yet
    client.app.state.media.library.folder = songs(tmp_path / "Music")
    assert client.post("/api/media/scan").json()["tracks"] == 6

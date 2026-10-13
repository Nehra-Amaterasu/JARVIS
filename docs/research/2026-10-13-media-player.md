# JARVIS media player: "play this song and it plays that song"

Researched and built 2026-10-13. The owner asked for "a media player where I tell Jarvis to play this song and it plays that song". Until now the honesty guard correctly said "I can't play music or videos yet".

Constraints: Windows laptop, no new paid APIs, no account automation, and no new downloads or installs. Every path below uses only what was already on the machine.

**[measured]** marks a number taken on this laptop on 2026-10-13, under load from other agents' test runs, so timings are given as ranges. **[unverified]** marks something I did not test.

---

## 1. What the laptop already has (checked read-only)

| Item | Finding |
|---|---|
| Spotify | The Microsoft Store app `SpotifyAB.SpotifyMusic` 1.304.258.0. Its AppX manifest registers the **`spotify:` protocol**, so `os.startfile("spotify:search:…")` reaches it. There is no `%APPDATA%\Spotify` desktop install. |
| Browsers | The default for https is **Brave** (`UserChoice` ProgId `BraveHTML`). Chrome and Edge are also installed. |
| venv packages | **Missing:** `winrt-*`, `winsdk`, `pycaw`, `python-mpv`, `python-vlc`, `spotipy` and `ytmusicapi`. **Present and used here:** `mutagen` 1.48.1 (tags), `pywin32` 312, `psutil`, `starlette` 1.3.1 (`FileResponse` with Range). **Present but unused:** `pygame` 2.6.1, `pythonnet` 3.2.1. |
| PowerShell | Windows PowerShell 5.1 ships with Windows and can call WinRT APIs. |
| Music files | There is **no `%USERPROFILE%\Music`**, and OneDrive\Music and Downloads hold **0 audio files**. The local-folder path has nothing to play until he points it at a folder of songs. |

## 2. Options, and the verdict

The 10-12 note (`2026-10-12-agents-and-media.md`) recommended local files in the window's `<audio>`, using the Spotify Web API for Spotify, and not stream-ripping YouTube. The Web API needs Premium plus a registered OAuth app, and dev mode is limited to 5 users and a shared quota. That breaks two constraints: a paid account and account automation. Without it, nothing can start a Spotify track **by name**.

| Path | Starts playback by itself? | Confirmation | Verdict |
|---|---|---|---|
| (a) Spotify app via `spotify:search:<q>`, controlled with media keys | **No.** It opens the search results, and he clicks the top result. | None for the search. Pause, next and resume are confirmed through Windows media sessions (§4). | Kept, and the receipt says "Spotify needs one click on the top result". |
| (b1) YouTube search URL in the browser | No: a results page. | n/a | Replaced by (b2). |
| (b2) **YouTube top result** through DuckDuckGo's backslash redirect | **Yes.** The browser lands on a `/watch` page, which starts on its own. | A **new** browser media session that reports Playing. | **The default online path.** |
| (b3) YouTube Music search URL | No: he clicks a result. | n/a | Kept as a chip, and said honestly. |
| (c) **His music folder**, played by the window's own `<audio>` | **Yes.** | **The window's `play()` promise** reports whether it started. | **The first choice whenever the folder has a match.** |
| Spotify Web API / Web Playback SDK | Yes | Yes | Out of scope: Premium plus an OAuth app. Widevine in WebView2 is still unverified. |
| ytmusicapi | n/a | n/a | It is an install, it needs his own OAuth client, and it carries a ToS risk. Rejected. |
| python-mpv / python-vlc | Yes | Yes | Installs needed. Rejected. |
| pygame.mixer (already installed) | Yes | Yes | It would play from Python with no window. But the window and the server share one lifetime (`desktop.py` stops everything when the window closes), so it gains nothing over `<audio>`. Kept in reserve. |

**The DuckDuckGo redirect [measured].**
- What it is: DuckDuckGo's documented "\" prefix sends a search to its first result.
- The test: `GET https://duckduckgo.com/?q=%5CBlinding+Lights+The+Weeknd+site%3Ayoutube.com` answered with `<meta http-equiv='refresh' content='0; url=/l/?uddg=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D…'>`, which is a zero-second hop to a YouTube watch page.
- How JARVIS uses it: the server never fetches DuckDuckGo or YouTube itself. The URL is opened in **his** browser exactly as if he had typed it, so nothing scrapes and no account is touched.
- Ranking: the first result for "<title> <artist> site:youtube.com" is normally the official video or audio, but that depends on DuckDuckGo's ranking. So the receipt says "YouTube's top result for "…"" and names the title Windows reports.

**The default: `auto`.**
1. If the music folder has a match (score ≥ 0.6, §5), the window plays it.
2. Otherwise, YouTube's top result.

The Media card's chips (Auto · Folder · YouTube · YT Music · Spotify) change where "play" goes, and "… on Spotify" or "… spotify pe" in the sentence overrides it for one request.

**/api/open.** It keeps its rule ("only known folders, never a path from the request"). The media routes open only URLs they build themselves: a fixed host (or `spotify:search:`) plus his words, URL-encoded. A URL or path never comes from a request.

## 3. Control: Windows media keys

`keybd_event` (via ctypes, user32) sends these keys, each with `KEYEVENTF_EXTENDEDKEY`:
- `VK_MEDIA_PLAY_PAUSE 0xB3`
- `VK_MEDIA_NEXT_TRACK 0xB0`
- `VK_MEDIA_PREV_TRACK 0xB1`
- `VK_VOLUME_UP 0xAF`, `VK_VOLUME_DOWN 0xAE` and `VK_VOLUME_MUTE 0xAD`

Windows hands media keys to the current media session (Spotify or a browser tab).

**[unverified live]:** no key was pressed on this laptop during this work. The tests and the dev server stub the keys so nothing plays.

Play/pause is a **toggle**, so the player reads the session first:
- "pause" when nothing plays presses nothing and says so.
- "resume" when something already plays says "Already playing …".

Volume:
- "Up" or "down" is 5 presses. Windows steps 2 points per press, so that is about 10 %.
- "Volume 30" is 50 presses down, then 15 up.
- The level itself cannot be read without a new package (pycaw), so a volume receipt claims only the key presses.

The window's own player is controlled directly over the bus, not with keys. That happens while it plays, or while it holds a paused song and nothing else plays.

## 4. What is playing: Windows media sessions, read from PowerShell

`GlobalSystemMediaTransportControlsSessionManager` (Win10 1809+) is reached from PowerShell 5.1 with `[…, Windows.Media.Control, ContentType=WindowsRuntime]` plus `WindowsRuntimeSystemExtensions.AsTask`. No package is needed.

**This settles two [unverified] items from the 10-12 note:**
1. GSMTC **is readable from an unpackaged process**. No capability declaration was needed.
2. The **Spotify Store app publishes a session** with title, artist, album and playback status. One Paused session was read; its contents are not recorded here.

| Measurement [measured] | Value |
|---|---|
| One-shot PowerShell read | 0.6 s per read (process start-up each time) |
| Long-lived watcher, first reading | 0.9 to 1.4 s when idle. Under load it was 2.0 to 5.2 s standalone, and 8.75 s inside the dev server as it started. |
| Watcher, later readings | Under 0.1 ms. It is one process polling every 0.7 s. |
| Watcher CPU, first version (JSON every loop) | 5.4 % of one core |
| Watcher CPU, final version (JSON only on change or a 21 s heartbeat) | 2.1 % of one core, about 96 MB RSS |

Lifecycle:
- The watcher starts with the app (`routes_media` lifespan), because the first reading can take seconds.
- It stops after 300 s with no reader.
- It exits on its own when JARVIS dies, using `Process.HasExited` on the parent.
- It is started with `CREATE_NO_WINDOW`, so no console flashes under `pythonw`.
- Its output is pure ASCII (`\uXXXX`), so Hindi titles survive any console code page.

**Confirmation rules**, in `media.py`, so that a receipt never says more than happened:
- **YouTube.** Take one reading **before** opening, then wait up to 6 s for a session that is Playing, is not Spotify or JARVIS, and was not already playing. Only that gives "Now playing <title> in Brave: YouTube's top result for "…"". With no reading from before, an already-playing tab could pass for the new one, so the answer is "I can't confirm it started".
- **Pause, next and resume.** Wait up to 2.5 s for that app's session to change: its status for pause and resume, its title for next and previous.
- **The folder.** The window answers. `NotAllowedError` from `play()` means autoplay was blocked, and the receipt says "press play on the Media card".

## 5. The music folder

**Index.** A walk of the folder he names, for `.mp3 .m4a .aac .ogg .oga .opus .flac .wav .webm`.
- These are what WebView2/Chromium decodes. WMA and ALAC are left out rather than found and then failing.
- Tags come from mutagen, with the file name ("Artist - Title", "01. Title") as the fallback.
- The cap is 20,000 files.
- The index is kept in `data/app/media/library.json`.
- A re-scan reuses the tags of any file whose size and modification time are unchanged.

**Lookup.**
- Score = 0.6 × the share of query words the track covers + 0.4 × the share of the track's title words the query names.
- Accept at ≥ 0.6 with coverage ≥ 0.66. So an exact title scores 1.0, an artist alone scores 0.6 (any of their songs), and "shape of you" against a song titled "You" is refused (coverage 0.5).
- Close spellings (difflib ratio ≥ 0.8, same first letter) absorb speech-recognition slips: "kesaria" matches "kesariya" at 0.93.

| Measurement [measured], invented WAV files | Value |
|---|---|
| Scan of 2,000 files, first time | 7.2 to 9.1 s |
| Re-scan, nothing changed | 1.9 to 6.7 s (load-dependent) |
| Lookup, 2,000 songs, every track scored | 70 to 156 ms |
| Lookup, 2,000 songs, word index + same-initial fuzzy | 13 to 46 ms |
| Lookup, 20,000 songs (the cap) | 568 ms, then 90 to 144 ms with the index |

**Playing a file.** The window fetches `/api/media/file/{id}` with its token header and plays a blob URL. `<audio>` cannot send the header, and the token must never sit in a URL. The id is looked up in the index, and the path must resolve inside the folder.

**Autoplay.** A voice command reaches the window with no click, and Chromium's default autoplay policy refuses that `play()`. `desktop.py` therefore sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--autoplay-policy=no-user-gesture-required`, repeating pywebview's own `--disable-features=ElasticOverscroll`.
- **[unverified in the live JARVIS window].**
- In the Browser pane test, after a click (sticky activation), a silent 30 s WAV played. The receipt read "Now playing Silence Test by JARVIS Lab from your music folder.", confirmed by the window.

## 6. Voice, and the honesty guard

**Parser.** `core/tools/media.py` is deterministic and runs in `run_agent` after reminders and before the Mission and room parsers. Examples it handles:
- "play Blinding Lights by The Weeknd"
- "Jarvis, play some Travis Scott on Spotify"
- "Kesariya chalao", "Kesariya spotify pe chalao", "arijit singh ke gaane chalao"
- "pause the music", "gaana band karo" (गाना बंद करो romanised as "gana band karo")
- "next song", "agla gana", "pichala gana"
- "volume 30", "awaz badhao"
- "what's playing?", "kaun sa gana chal raha hai"

Not music: "fan chalao" and "put on the fan" (the room's), "AC chalao", "let's play chess", "play devil's advocate", "put on a 10 minute timer". "Play Turn On The Lights by Future" is a song, because the media parser runs before the room parser.

**Tools** (`core/tools/builtin.py`):
- `play_media` (T1)
- `media_control` (T1)
- `media_state` (T0)

All three declare `backs=("media",)`. A receipt backs a claim only when the app's receipt says `confirmed`. An opened Spotify search is `ok` but backs nothing, so a model's "Now playing …" is replaced by the receipt's own sentence: a new rule in `honest_line`, under which a tool that ran but did not back the claim is the truth. The media claim patterns now also cover pause, skip, resume and volume ("I've paused the music").

**Red team.**
- "play some Travis Scott" now has a backing tool, and the reply is the player's receipt.
- Two turns the parser does not read as commands ("some Travis Scott would be nice right now", "I need some music to focus") stay in the red-team set. A model that only *says* "Now playing" there is still corrected.

## 7. Later: audio on the ESP32 speaker (not now)

- The ESP32-S3 has "Bluetooth 5 (LE)" only, with no Bluetooth Classic, so it **cannot be an A2DP sink** for the laptop's audio ([Espressif ESP32-S3](https://www.espressif.com/en/products/socs/esp32-s3)).
- It does list I2S among its peripherals (same page).
- The route: an I2S DAC/amplifier on the S3 (for example a MAX98357A class-D board, **[unverified: part not chosen or tested]**), with the laptop streaming PCM or MP3 over Wi-Fi to the board.
- The board already carries Aankhen's CSI work, so audio streaming has to be budgeted against the CSI frame rate before it is built.

## Unverified items to test before relying on them

- That the media keys reach the Store Spotify app and Brave as expected. This is documented behaviour, but no key was pressed here.
- That the autoplay flag takes effect in the live WebView2 window (env var vs pywebview's `AdditionalBrowserArguments`). If it does not, the receipt says "press play on the Media card".
- That a YouTube watch page in Brave starts with sound without a click (Brave's autoplay setting). If it does not, the receipt says "Windows hasn't reported it playing yet".
- That DuckDuckGo's first result for artist-only queries ("Travis Scott") is a video and not a channel page.

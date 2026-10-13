# Connect and System: brain, voice, modules, exports, latency (2026-10-13)

## Question

What does the Connect tab need to switch the brain and the voice for real, and where does
each data export come from? What must System show to answer "he doesn't reply when I say
Jarvis"?

## Found and measured

### The brain: which installed models can be JARVIS
Ollama 0.32.6, `/api/tags` and `/api/show` (capabilities), on this laptop:

| model | file | params | capabilities | as JARVIS's brain |
|---|---|---|---|---|
| qwen3:4b-instruct-2507-q4_K_M | 2.50 GB | 4.0B | completion, tools, thinking | the brain since 2026-10-08 |
| qwen3:4b | 2.50 GB | 4.0B | completion, tools, thinking | works; reasons before every reply |
| llama3.1:latest | 4.92 GB | 8.0B | completion, tools | works; spills to the CPU |
| dolphin-llama3:latest | 4.66 GB | 8B | completion | **no tool calling**: clock, room, reminders would fail |
| llama3.2:1b | 1.32 GB | 1.2B | completion, tools | works |
| nomic-embed-text:latest | 0.27 GB | 137M | embedding | cannot talk |

- `agent.py` binds tools to the model on every tool turn, so a model without the `tools`
  capability is refused in the picker, with the reason, rather than allowed to break turns.
- Ollama lists `thinking` for qwen3-4b-instruct-2507 too, though that model has no thinking
  mode. The flag is used only for deep think, where the brain itself is never a candidate.
- VRAM: `/api/ps` showed qwen3-4b-instruct at 3.31 GB in VRAM from a 2.50 GB file at
  num_ctx 8192, so about 0.8 GB of context and buffers. The card has 6144 MiB, and Whisper
  large-v3-turbo holds about 1 GB of it. A file over 4.5 GB (decimal) therefore needs over
  about 5.3 GB loaded, and with Whisper beside it part of it runs on the CPU. That is the
  warning threshold. llama3.1 and dolphin-llama3 are over it; the 2026-07-24 note in
  agent.py measured llama3.1:8b at 22% on the CPU and 20 tok/s.
- langchain-ollama 1.1.0: `reasoning=True` sends `think` and puts the thinking in
  `additional_kwargs["reasoning_content"]`, out of the streamed content. Deep think uses it
  for reasoning models, so the voice never reads the thinking. Ollama counts thinking
  tokens against `num_predict`, so the reasoning budget is raised by 1200 tokens: qwen3:4b
  measured about 1000 thinking tokens per reply on 2026-10-08.

### The voices
- `edge_tts.list_voices()` (edge-tts 7.2.8) answered in 0.97 s with 322 voices. For en-GB:
  Ryan, Thomas, Sonia, Libby, Maisie. For en-US: Andrew, Brian, Christopher, Eric, Guy,
  Roger, Steffan, Ava, Emma, Aria, Jenny, Michelle, Ana, and the Multilingual variants of
  Andrew, Brian, Ava and Emma. For en-IN: Prabhat, Neerja and Neerja Expressive. A copy of
  this list is built in, for when the live list cannot be fetched.
- Kokoro's `voices-v1.0.bin` is an .npz of 54 voices; its names are read in 38 ms. English
  voices: b* British (bm_george, bm_lewis, bm_daniel, bm_fable, bf_emma, bf_isabella,
  bf_alice, bf_lily), a* American (am_*, af_*). h* are Hindi and are not offered as a main
  voice.
- Kokoro is installed at data/models/kokoro (92 MB onnx and 28 MB voices).
- edge-tts takes speed as a signed percentage (`rate="+10%"`) and Kokoro takes it as a
  multiplier (`speed=1.1`). The range is held to 0.7 to 1.4.

### Export pages (opened in his browser; he requests the export himself)
- Instagram: Accounts Center, then Your information and permissions, then Download your
  information. Choose Messages, format **JSON** (HTML is the default and Yaadash cannot read
  it), date range All time. The zip arrives by email, in hours to two days. Opened:
  `accountscenter.instagram.com/info_and_permissions/`. The deeper `/dyi/` path could not be
  confirmed. Source: Instagram Help Center, https://help.instagram.com/181231772500920.
- ChatGPT: Settings, then Data controls, then Export data. The emailed link expires after
  24 h. The zip holds `conversations.json`; larger exports use numbered files. Opened:
  `chatgpt.com/#settings/DataControls`. The fragment may only open chatgpt.com, so the card
  also gives the menu path. Sources: OpenAI's Data Controls FAQ
  (https://help.openai.com/en/articles/7730893) and the guides it links.
- Spotify: Account, then Privacy, then Download your data. Tick **Extended streaming history**
  (every play since the account began). It takes up to 30 days, after a confirmation email.
  The records carry `ts` (UTC, end of play), `ms_played`, `master_metadata_track_name` and
  `master_metadata_album_artist_name`; the track name is null for podcasts and some plays.
  Opened: `www.spotify.com/account/privacy/`. Source:
  https://support.spotify.com/us/article/understanding-my-data/.
- YouTube Music: Google Takeout. Deselect all, choose YouTube and YouTube Music, then only
  history, then **Multiple formats, History: JSON** (the default is HTML). The file is
  `Takeout/YouTube and YouTube Music/history/watch-history.json`, entries
  `{header: "YouTube Music", title: "Watched …", subtitles[0].name: "<artist> - Topic",
  time}`. Opened: `takeout.google.com`. Sources: the google-takeout-parser docs
  (https://pypi.org/project/google-takeout-parser/) and
  https://developers.google.com/data-portability/schema-reference/my_activity.

### Latency from the transcripts (read-only, real data, aggregates only)
The new parser (app/jarvis_app/latency.py) found 53 replies in the last 7 days, 49 of them
spoken:
- first word, from end of speech to his voice starting: **median 4.12 s, p90 8.09 s**;
- reply written: median 3.80 s, p90 8.61 s;
- typed turns, first token: median 4.62 s.

The `endpoint` wait (silence waited before the recording closed) was not kept in the
transcripts until now: `transcripts.record_turn` dropped it. So "heard" read as the STT time
alone, median 0.0 s, because the speculative transcript is usually ready when he stops. It
is kept from this change on. `respond()` sends `endpoint` just after `heard`; the live wake
log first assumed the other order and lost it, and the dev server caught that.

## What it changed
- New `core/user_settings.py`: one settings file that JARVIS reads live, plus a
  pronunciation pass in `voice.py`.
- New `JARVIS_BRAIN_MODEL`, read by `agent.py` (default unchanged).
- Deep think is chosen per turn, and only models with `tools` are offered.
- New `yaadash/ingest_exports.py` reads ChatGPT, Spotify and YouTube Music exports. It does
  not ingest them yet. The Yaadash archive now also reads `data/app/imports/instagram`.
- System is rebuilt around the wake log and these latency numbers.

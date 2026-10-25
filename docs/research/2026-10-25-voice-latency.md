# 2026-10-25: Where JARVIS's first-audio wait goes, and what I changed

## Question
The voice note from earlier today (`data/notes/research/2026-10-25-voice-conversation.md`, private) gave a median of 4.12 s
from question to first audio (p90 8.09 s). The end-pointer and the model's first token only explain about 1.7-2 s of that.
Where is the rest, and how close can this laptop (Qwen3-4B on Ollama, faster-whisper, Kokoro on the CPU, Edge TTS) get to a
1.5 s median?

## Method
- Read the per-turn timings in `data/app/transcripts/*.jsonl` (10-09 to 10-14). There were 123 spoken turns with both
  `stt` and `first_audio`. Note that `first_audio` is measured from the start of the turn, so it excludes the end-pointer
  and Whisper.
- Ran live Edge TTS calls (edge-tts 7.2.8 from the venv).
- Timed sounddevice output streams on this laptop. They were silent: only zeros were written, or the gain was 0.
- Did a PyAV incremental mp3 decode of a real Edge clip from `data/archive/old-tts/`, fed to the decoder in 720-1440 byte
  pieces.

## Findings (numbers)
| Stage (transcripts, n = 123) | median | p90 |
|---|---|---|
| endpoint (silence waited, n = 76) | 1.31 s | 1.60 s |
| stt (0 when the judge's speculative transcript is reused) | 0.00 s | 1.77 s |
| first token, from the start of the turn | 1.58 s | 3.80 s |
| first audio, from the start of the turn | 3.45 s | 6.49 s |
| **first audio minus first token** (first sentence + TTS + playback) | **1.73 s** | **2.79 s** |

- **TTS is the biggest single block.** Deterministic replies have their first token in 0.01-0.07 s. Even so, "The light is
  off." took 1.05-1.65 s to be heard, so that time is all TTS plus playback. Two short sentences that arrived together took
  3.5-4.6 s.
- **Edge TTS is refused today:** every request got `WSServerHandshakeError 403` after about 1.2 s (the URL carries
  Sec-MS-GEC-Version 1-143.0.3650.75). The likely cause is an out-of-date edge-tts. The engine retried once every 60 s, so
  the first sentence of a reply paid about 1.2 s before Kokoro took over. **Aman should run `pip install -U edge-tts`.** I did
  not do it because the venv is shared.
- Opening an output stream (MME, Realtek): open plus start took 0.12-0.22 s, and the first write then blocked about 0.12 s
  more. A write to a stream that is already open took 0.2 ms. The latency setting was 0.18 s by default, 0.09 s with "low"
  and 0.05 s with 0.05.
- Incremental PyAV decode of an Edge mp3 (24 kHz mono, 48 kbit/s): the first frame decoded after 3.6 KB (about 0.6 s of
  audio). In a silent end-to-end test with the first byte delayed 0.3 s, **sound started 25 ms after the first byte on an
  open stream** and 0.19 s after it on a cold one.

## What changed (core/, all tested)
1. `core/turn_clock.py` times every stage of a live turn: his last word, recording closed, text ready, first token, first
   sentence, first TTS bytes, TTS done, speaker on. Each stage goes out as a `timing` event (`first_sentence`,
   `tts_first_byte` with the engine, `tts_full`, `play_start`, `speech_to_audio`, `speech_to_audio_p50/p90`), so `/api/system`
   shows them under `core.timings`. Each turn also writes one `[latency]` line to the log. `first_audio` is now stamped when
   playback really starts.
2. The first clause is spoken at 5 words (was 8), at a comma, semicolon, colon or spaced dash. Numbers like 1,000 and 10:30
   are never split. Trade-off: the check that stops JARVIS repeating an earlier reply needs 6+ words, so it skips a 5-word
   first clause.
3. A 401/403 from Edge now keeps the offline voice for 15 minutes. Other failures still retry after 60 s.
4. Edge audio streams to the player (`core/playback.py`). The player gets the first bytes as soon as they arrive and decodes
   them as they come, on one output stream that is opened when a turn starts and kept open between sentences. If anything
   fails before a sound, the whole clip plays the old way. Barge-in cancels the download and the playback.
   `JARVIS_EDGE_STREAM=0` turns this off. Kokoro is unchanged.
5. After "stop Jarvis", the history and long-term memory keep only what he heard: the sentences that played to the end, plus
   the current one estimated at about 2.8 words a second, marked "[he cut me off here]".
6. A TODO note: no free voice barge-in until there is echo cancellation (otherwise the 10-13 self-cutoff comes back).

## Expected budget after the changes (estimate, not yet measured live)
endpoint 1.3 + stt about 0 + first token 0.6-1.6 + first clause about 0.2 + Edge first byte about 0.3-0.5 (once edge-tts
works) + play about 0.03 = **about 2.4-3.6 s from his last word**. That is about 1.1-2.2 s from the start of the turn, against
3.45 s before. The ~1.5 s target from the start of the turn needs the LLM's first token closer to 0.6 s. Its 1.58 s median
(prompt, memory and tool routing) is now the next biggest stage, together with the 1.3 s end-pointer.

## Not done / next
- A live voice test by Aman: listen to the streamed Edge audio for gaps or clicks, check how stop behaves, judge whether the
  5-word clause sounds natural, and read the `[latency]` lines.
- Why the first token takes 1.58 s (memory retrieval and tool routing before the stream starts). This is a measurement
  task for the new clock.
- Kokoro first clause on the CPU (about 0.9-1.3 s per sentence according to the voice note's sources). The shorter first
  clause helps here; streaming does not.

## Sources
- Local: `data/app/transcripts/2026-10-09..14.jsonl`, `data/archive/old-tts/*.mp3`, live edge-tts and sounddevice runs
  (scratch scripts, not kept).
- edge-tts: https://github.com/rany2/edge-tts
- PyAV: https://pyav.org/docs/stable/
- sounddevice OutputStream: https://python-sounddevice.readthedocs.io/en/latest/api/streams.html
- Pipecat interruptions (commit only the spoken text): https://docs.pipecat.ai/pipecat/fundamentals/interruptions

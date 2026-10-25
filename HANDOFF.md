# Handoff: voice latency (2026-10-25)

## Done (committed)
- c3746e2 turn clock (core/turn_clock.py): per-stage timing events + log line, p50/p90 in /api/system core.timings.
- 0a210e6 first clause flushes at 5 words (, ; : spaced dash) in voice.py + honesty.py copy.
- 91c4564 Edge 401/403 refusal -> 15 min cooldown (Edge returns 403 today; edge-tts 7.2.8 likely outdated, needs `pip install -U edge-tts` by Aman).
- 30c6577 Edge streaming playback (core/playback.py: AudioPipe, Speaker, play_pipe), warm speaker at turn start, file fallback.

## In progress / next
1. Step 3: after barge-in store only the spoken part. Plan: tts worker records played segment texts (+ partial fraction via pipe.played_s / words-per-sec); agent.py gets `defer_long_term` + `settle_turn(spoken, interrupted)` that amends `_short_term[-1]` and runs `yaadash_core.store_interaction` with the spoken text; jarvis calls settle on speech_done or in `_interrupt_speech`.
2. TODO note in jarvis._record_silero: no voice barge-in without AEC (10-13 self-cutoff).
3. Research note docs/research/2026-10-25-voice-latency.md + README index line. Data: transcripts 123 spoken turns: first_audio median 3.45 p90 6.49, first_token 1.58, endpoint 1.31, first_audio-first_token 1.73; deterministic "The light is off." still 1.0-1.6 s (TTS); Edge 403 costs 1.2 s; MME stream open 0.13-0.22 s + first write 0.12 s, warm write 0.2 ms; streamed sound 25 ms after first byte warm.

## Tests
core: 707 passed, 1 skipped, 2 xfailed (`.venv\Scripts\python -m pytest core -q -p no:cacheprovider`).

# Conversation fixes from the 10-14 transcript review

Date: 2026-10-14. Source: the private review of the last 7 days of transcripts (7 sessions,
111 questions, 103 replies; reply median 2.88 s, p90 6.74 s; flags: 2 good, 2 misheard).
The conversations stay private: nothing below quotes them, and every test phrase is invented.

## Question

Nine failures showed up in one evening session and the day before. For each: what in the
code caused it, and what change (with a test) stops it?

## Findings and what changed

| # | Failure (paraphrased) | Cause | Change | Tests |
|---|---|---|---|---|
| 1 | A sentence asking for the light ON and the fan OFF switched both off | `room.parse` searched the whole sentence for a verb; OFF is checked first | Parse per clause (split on `,` `;` and/aur/then/phir/plus/also); a device-only clause borrows the nearest verb (before, else after); a verb-only clause acts on the device before it | `test_each_clause_gets_its_own_verb` (7 cases), `test_a_mixed_command_switches_each_device_its_own_way` |
| 2 | "More fan speed" got "I haven't checked the light and fan" | No parser match, so the model answered and the guard replaced its state claim | The relays only switch (Uno relay board). Any speed, brightness, dim or percent request is a `level` request answered by `room.no_levels()` ("The fan's speed is on your wall regulator, sir; I can only switch it on or off."). It also answers questions ("why can't you ... speed?"). `when.py` never schedules a `level`. The `set_device` capability tells the model the same | `test_a_speed_or_brightness_request_is_a_level_request`, `test_fan_speed_gets_an_honest_answer_and_switches_nothing`, `test_on_at_full_speed_switches_on_and_says_the_truth_about_speed`, `test_a_dimmed_light_is_never_a_timed_switch` |
| 3a | Five replies in a row said a song was found in his Spotify library and "playing now" with no tool call | The media claim patterns did not know "located/found/initiated/brought ... playing now"; once a correction had been said, `_said_lately` muted it, so the reply shrank to a pleasantry | New media patterns (`playing now`, `I've located/found/initiated/opened/brought ...`, `I'll bring/open/find ...` with a 90-character look-ahead for library/Spotify). A **rescue** (`core/tools/rescue.py`): when he asked for something to be played and a title is known (quoted in the model's own sentence, else the last title JARVIS named), the guard calls `play_media` and says the receipt's sentence instead | `test_invented_playback_is_a_media_claim`, `test_a_claimed_play_is_turned_into_a_real_one`, `test_without_a_play_request_a_claim_is_only_corrected` |
| 3b | "Play that" after JARVIS suggested a song searched YouTube for the word "that" | No pronoun resolution | `media.resolve()`: that/this/it/the one you suggested/wo/woh → the last title JARVIS suggested (quoted, or "how about X by Y"); "play it" only right after a suggestion, otherwise it still resumes; nothing suggested → "Which song shall I play?". A long sentence naming "the song you suggested" plus a play verb resolves too | `test_play_that_plays_the_song_jarvis_suggested`, `test_play_that_on_spotify_keeps_the_source`, `test_play_it_right_after_a_suggestion_...`, `test_play_that_with_nothing_suggested_...`, `test_a_long_request_for_the_suggested_song_plays_it`, `test_the_last_suggested_title_is_read_from_a_reply` |
| 3c | "Play X on Spotify" | Already handled by the app's `spotify:search:` path, which says honestly that one click on the top result is his | Kept; tested end to end through the agent | `test_play_on_spotify_uses_spotify_search` |
| 4 | "I have no internet access, so I can't search ..." in the same session in which `play_media` had opened YouTube's top result | `CANNOT_SAY["web"]` and `registry.CANNOT["web"]` said "no internet" | Both now say he cannot browse or search the web, and that the one thing he opens online is a song through `play_media` | `test_the_web_line_no_longer_denies_what_play_media_does`, `test_search_it_online_plays_the_song_already_named`, `test_capability_block_is_generated_from_the_registry` |
| 5 | A reply promised a diagnostic on a board and a report back in minutes | No claim kind for work done later or on hardware no tool reaches | New kind `promise` (get back to you, follow up, keep looking, run a diagnostic/scan/check, reset/fix/update/adjust ..., "I've checked the port/board ...", "I'll ... in N minutes" unless it is a reminder or timed switch). No tool backs it, so it is always replaced by "I can't do that on my own or come back to you later; I only act while you're talking to me." `registry.CANNOT["promise"]` puts the rule in the persona's "You cannot" list, plus one line under TRUTH | `test_promises_are_claims` (7), `test_advice_and_real_tools_are_not_promises` (4), `test_a_promised_follow_up_is_replaced_by_the_truth`, `test_the_persona_says_he_acts_only_while_spoken_to` |
| 6 | A requested story stopped mid-sentence | `num_predict=400` on every reply | `core/longform.py`: story/tale/poem/"in detail"/"step by step"/kahani → 1200 tokens for that turn (`model_copy`, also through `bind_tools`) and an instruction to finish on a whole sentence. Whenever Ollama reports `done_reason == "length"`, `Guard.finish(capped=True)` drops the unfinished tail (or marks it "…" if nothing complete was said) | `test_long_requests_are_recognised`, `test_a_bigger_budget_for_one_turn_on_the_real_model_classes`, `test_a_story_gets_the_long_instruction_and_ends_on_a_whole_sentence`, `test_an_uncapped_reply_keeps_its_last_words`, `test_a_capped_reply_with_no_full_sentence_is_marked_cut` |
| 7 | Canned tails on unrelated replies (light/fan, "can't track", "haven't saved") | Mostly REAL claims with an irrelevant correction; some false positives; one false correction | (a) a state claim is now made true: the guard reads `room_state` (T0) and says the reading; (b) "on/off" followed by a determiner is a preposition ("the fan is on a relay"); "quiet" no longer a room-switch word; an AC/room-temperature claim gets "I can't control that" instead of the light/fan line; "I'm counting on you" / "watching the clock" are not tracking; (c) a PAST-tense switch/media claim may cite a receipt from the last 180 s, so "I've turned the light on" the turn after the fast path did it is no longer called false; a new promise still needs this turn's receipt. Memory ("remember that") lines were left alone: another agent owns that feature | `test_figures_of_speech_are_not_claims` (5), `test_claims_the_live_model_slipped_past` (2), `test_a_slow_reply_question_gets_no_light_and_fan_tail`, `test_last_turns_switch_backs_a_past_claim_but_not_a_new_promise`, `test_a_room_claim_about_the_ac_does_not_blame_the_light_and_fan`, `test_the_rescue_runs_once_per_reply`, updated `test_tools_without_a_call_mean_no_claim` |
| 8 | "Hey Jarvis!" got a sensor report | Went to the model with the movement line | `wake.name_only()` + `wake.acknowledgement()` (rotating "Sir?", "At your service, sir.", ...), a fast path before the model, staff and Aankhen | `test_name_only_is_recognised` (5), `test_a_request_is_not_name_only` (4), `test_his_name_gets_a_butlers_word_and_no_sensor_report` |
| 9 | Short nonsense lines heard while he was silent were answered | Per-segment filtering only, with Whisper's 30-second-window thresholds | `stt.unsure_short()`: a transcript of at most 4 words is dropped when max `no_speech_prob` > 0.5 or mean `avg_logprob` < -0.8 (English) / -1.0 (Hindi); a transcript that names him is never dropped. Logged as `low_confidence` in `stt_meta` | `app/tests/test_stt.py`: 5 new tests with a fake Whisper |

### How the STT thresholds were chosen

Whisper's own decoder (openai/whisper `transcribe()`) treats a window as silence when
`no_speech_prob > 0.6` and `avg_logprob < -1.0`, and retries when the compression ratio
is above 2.4. Those were tuned on 30-second windows. A 1-4 word clip has only a few tokens,
so one bad token moves its mean log-probability a lot, and a wrong short line costs a whole
wrong turn. Each bar is tightened by one step (0.6 → 0.5, -1.0 → -0.8). Hindi decodes less
confidently on this model, so its log-probability bar stays at -1.0. The transcripts
stored no STT confidences, so these are starting values; `stt_meta` now logs `avg_logprob`,
`no_speech_prob` and `low_confidence` per turn so they can be tuned on real turns.

## Live check with the real model (qwen3:4b-instruct-2507 via Ollama, no app, stub memory)

- A long story request: 17.7 s, about 700 words, finished on a whole sentence.
- "Make the fan a bit faster" and "why can't you make the fan go faster?" (3 runs):
  the regulator line every time, 0.0 s, no model call.
- "Why are you taking so long? the fan is already on" (3 runs): the reply made a fan-state
  claim in 2 of 3. One was caught and replaced by a real reading of the (virtual) room;
  one, "the fan is indeed on", slipped past, so "indeed/definitely/certainly/clearly/also"
  were added to the state pattern. An invented "by my sensors, you're at your desk" (no
  sensor line in the prompt) also slipped past and is now a presence claim.
- A missing USB board (3 runs): the model said it cannot act on hardware; no promise made.
- "Hey Jarvis!": "Sir?" in 0.0 s.

## Tests

- Before (branch base after merging main): core 389 passed; app 660 passed, 14 skipped.
- After: core 465 passed; app 665 passed, 14 skipped.

## Sources

- openai/whisper, `transcribe()` defaults (no_speech_threshold 0.6, logprob_threshold
  -1.0, compression_ratio_threshold 2.4): https://github.com/openai/whisper/blob/main/whisper/transcribe.py
- faster-whisper `Segment` fields (avg_logprob, no_speech_prob, compression_ratio):
  https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py
- Koenecke et al., "Careless Whisper: Speech-to-Text Hallucination Harms" (2024), on
  Whisper inventing text in silences and pauses: https://arxiv.org/abs/2402.08021
- Ollama chat API, `done_reason` ("stop" | "length") on the final streamed message:
  https://github.com/ollama/ollama/blob/main/docs/api.md
- langchain-ollama 1.1.0 (installed): `response_metadata["done_reason"]` on the last chunk;
  `num_predict` read from the model's fields in `_chat_params`.

## Left open

- The relay board cannot set speed or brightness; scenes still store levels in the app's
  virtual state (the app owns that).
- Memory corrections ("I haven't saved that ...") were not changed (another agent's area).
- The STT thresholds need real `stt_meta` data to tune.

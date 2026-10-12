"""The end-pointer (core/endpoint.py): when has Aman finished speaking?

Two kinds of test:
  - Logic, with a scripted VAD (a list of probabilities): hysteresis, tails, the
    judge, the pre-roll, the cap and the timeouts, exactly and fast.
  - Speech: Kokoro sentences laid on pink noise and fan hum with 1.5-2.5 s pauses,
    scored by the real Silero model (endpoint_clips.py). These skip, saying why, when
    Kokoro or its model files are missing. The judge there is an oracle (it "hears"
    perfectly) answering 1.0 s later, the median Whisper took on this laptop's GPU for
    such clips (2026-10-12: median 0.97 s, max 1.41 s); what the real Whisper writes
    for these fragments is recorded in DECISIONS.md, not assumed here.
No microphone, no GPU, no network.
"""
import time

import numpy as np
import pytest

from jarvis_app.paths import ensure_jarvis_importable

ensure_jarvis_importable()
import endpoint as E  # noqa: E402
import endpoint_clips as C  # noqa: E402

SR = E.SAMPLE_RATE
_KOKORO_OK, _KOKORO_WHY = C.kokoro_ready()
needs_kokoro = pytest.mark.skipif(not _KOKORO_OK, reason=_KOKORO_WHY)
JUDGE_LATENCY_S = 1.0


# ------------------------------------------------------------------ a scripted VAD
class ScriptedVad:
    """Speech probabilities from a list, one per 32 ms frame (then silence)."""

    def __init__(self, probs):
        self.probs = list(probs)
        self.i = 0

    def reset(self):
        self.i = 0

    def __call__(self, x):
        n = len(x) // E.FRAME
        out = self.probs[self.i:self.i + n]
        self.i += n
        return np.array(out + [0.02] * (n - len(out)), dtype=np.float32)


def nf(seconds):
    return int(round(seconds / E.FRAME_S))


def script(*spans):
    """script(("speech", 1.0), ("quiet", 2.0), (0.4, 1.0)) -> frame probabilities."""
    out = []
    for what, sec in spans:
        p = {"speech": 0.95, "quiet": 0.02}.get(what, what)
        out += [p] * nf(sec)
    return out


def run_scripted(probs, config=None, judge=None, hold=None, extra_s=0.0):
    ep = E.EndPointer(config, vad=ScriptedVad(probs), judge=judge, hold=hold)
    total = (len(probs) + nf(extra_s)) * E.FRAME
    return ep, E.run_clip(np.zeros(total, np.float32), ep)


def close(a, b, tol=E.FRAME_S * 1.01):
    return abs(a - b) <= tol


# ------------------------------------------------------------------ the VAD itself
def test_streamed_silero_equals_faster_whisper_batch_scores():
    """Carrying the LSTM state between calls must not change a single score."""
    from faster_whisper.vad import get_vad_model
    rng = np.random.default_rng(3)
    t = np.arange(4 * SR) / SR
    x = (0.1 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 3 * t) > 0) +
         0.01 * rng.standard_normal(t.size)).astype(np.float32)
    if _KOKORO_OK:
        x = np.concatenate([x, C.speech("What time is it?", "am_michael", "en-us")])
    x = np.pad(x, (0, E.FRAME - x.size % E.FRAME))
    batch = get_vad_model()(x).reshape(-1)
    s = E.SileroStream()
    got, i = [], 0
    while i < x.size // E.FRAME:
        k = int(rng.integers(1, 6))
        got.append(s(x[i * E.FRAME:(i + k) * E.FRAME]))
        i += k
    assert np.abs(np.concatenate(got) - batch).max() < 1e-6


@pytest.mark.parametrize("name,make", [
    ("pink -50 dBFS", lambda n: C.pink(n, 10 ** (-50 / 20))),
    ("pink -30 dBFS", lambda n: C.pink(n, 10 ** (-30 / 20))),
    ("pink -20 dBFS", lambda n: C.pink(n, 10 ** (-20 / 20))),
    ("fan -35 dBFS", lambda n: C.fan(n, 10 ** (-35 / 20))),
    ("fan -20 dBFS", lambda n: C.fan(n, 10 ** (-20 / 20))),
    ("keyboard clicks", lambda n: C.clicks(n, 0.5)),
    ("appliance beeps", lambda n: C.beeps(n, 0.1)),
])
def test_noise_alone_never_opens_an_utterance(name, make):
    """Silero scored these at most 0.12 (the chime 0.29) when measured; 0.5 opens."""
    ep = E.EndPointer(E.EndpointConfig(start_timeout_s=9.0))
    utt = E.run_clip(make(10 * SR), ep)
    assert not utt.has_speech and utt.reason == "timeout", name


def test_the_wake_chime_is_not_speech():
    import chimes  # noqa: F401  (only to be sure the tones below are the real ones)
    fs = SR
    t1 = np.linspace(0, 0.15, int(fs * 0.15), endpoint=False)
    t2 = np.linspace(0, 0.25, int(fs * 0.25), endpoint=False)
    chime = np.concatenate([0.5 * np.sin(2 * np.pi * 440 * t1) + 0.5 * np.sin(2 * np.pi * 880 * t1),
                            np.zeros(int(fs * 0.05)),
                            0.5 * np.sin(2 * np.pi * 554.37 * t2) + 0.5 * np.sin(2 * np.pi * 1108.73 * t2)]) * 0.2
    x = np.tile(np.concatenate([chime, np.zeros(SR // 2)]), 8).astype(np.float32)
    utt = E.run_clip(x, E.EndPointer(E.EndpointConfig(start_timeout_s=5.0)))
    assert not utt.has_speech


# ------------------------------------------------------------------ logic, scripted
def test_a_blip_shorter_than_192_ms_does_not_open_an_utterance():
    _, utt = run_scripted(script(("quiet", 1), ("speech", 0.128), ("quiet", 3)),
                          E.EndpointConfig(start_timeout_s=3.0))
    assert not utt.has_speech and utt.reason == "timeout"


def test_speech_opens_after_192_ms_with_half_a_second_of_pre_roll():
    ep, utt = run_scripted(script(("quiet", 2), ("speech", 1.0), ("quiet", 3)))
    assert utt.has_speech and close(utt.speech_start_s, 2.0)
    assert close(ep.audio_start / SR, 1.5)                       # 0.5 s before the first syllable
    assert close(utt.audio.size / SR, 0.5 + 1.0 + 0.4)            # pre-roll + speech + tail pad


def test_middling_scores_hold_speech_open_and_a_single_click_does_not_end_a_pause():
    # 0.4 sits between the thresholds: it continues speech but cannot start it.
    _, utt = run_scripted(script(("speech", 1.0), (0.4, 1.0), ("quiet", 0.5), ("speech", 0.032),
                                 ("quiet", 3)))
    assert close(utt.speech_end_s, 2.0)                           # the lone frame was not a resume
    assert close(utt.endpoint_s, 1.2)


def test_without_a_judge_the_tail_is_a_fixed_1_2_s():
    _, utt = run_scripted(script(("speech", 1.5), ("quiet", 4)))
    assert utt.reason == "silence" and close(utt.speech_end_s, 1.5) and close(utt.endpoint_s, 1.2)
    assert utt.judgement is None and utt.verdict is None


@pytest.mark.parametrize("said,verdict,tail", [
    ("What time is it?", E.REQUEST, 0.8),
    ("Light band karo", E.REQUEST, 0.8),
    ("I feel tired today.", E.STATEMENT, 1.3),
    ("I was thinking about the weather today and", E.INCOMPLETE, 3.5),
    ("", E.UNKNOWN, 1.2),                       # the judge heard no words (a cough)
])
def test_the_words_choose_the_tail(said, verdict, tail):
    judge = E.ClockedJudge(lambda a: said, latency_s=0.1)
    _, utt = run_scripted(script(("speech", 1.5), ("quiet", 5)), judge=judge)
    assert utt.verdict == verdict and close(utt.endpoint_s, tail)
    assert utt.judgement.text == said            # handed on, so it is not decoded twice


def test_a_slow_judge_is_waited_for_not_guessed():
    judge = E.ClockedJudge(lambda a: "What time is it?", latency_s=6.0)
    _, utt = run_scripted(script(("speech", 1.5), ("quiet", 6)), judge=judge)
    assert close(utt.endpoint_s, 3.5) and utt.judgement is None
    assert utt.judge_upto is not None            # its job covers all of the speech: wait for it


def test_a_judgement_made_before_speech_resumed_is_ignored():
    said = iter(["Turn on the light.", "Turn on the light and"])
    judge = E.ClockedJudge(lambda a: next(said), latency_s=0.5)
    _, utt = run_scripted(script(("speech", 1.0), ("quiet", 0.6), ("speech", 1.0), ("quiet", 5)),
                          judge=judge)
    # pause 1: a request was judged at 0.8 s - after speech resumed at 0.6 s - so it is stale
    assert len(judge.calls) == 2 and utt.verdict == E.INCOMPLETE
    assert close(utt.speech_end_s, 2.6) and close(utt.endpoint_s, 3.5)


def test_the_utterance_is_capped_at_45_s():
    _, utt = run_scripted(script(("speech", 60)))
    assert utt.reason == "cap" and close(utt.cut_s, 45.0)


def test_the_follow_up_clock_waits_while_jarvis_is_talking():
    ep = None

    def talking():                               # JARVIS speaks for the first 6 s
        return ep.clock < 6 * SR
    probs = script(("quiet", 14))
    ep = E.EndPointer(E.EndpointConfig(start_timeout_s=5.0), vad=ScriptedVad(probs), hold=talking)
    utt = E.run_clip(np.zeros(len(probs) * E.FRAME, np.float32), ep)
    assert utt.reason == "timeout" and close(utt.cut_s, 11.0)


def test_a_closed_stream_returns_what_was_said():
    ep = E.EndPointer(vad=ScriptedVad(script(("speech", 1.0))))
    ep.feed(np.zeros(nf(1.0) * E.FRAME, np.float32))
    utt = ep.result()
    assert utt.reason == "closed" and utt.has_speech


def test_odd_block_sizes_give_the_same_answer():
    probs = script(("quiet", 1), ("speech", 1.2), ("quiet", 0.5), ("speech", 0.8), ("quiet", 3))
    cuts = set()
    for chunk in (160, 441, 512, 1024, 3000):
        ep = E.EndPointer(vad=ScriptedVad(probs))
        cuts.add(round(E.run_clip(np.zeros(len(probs) * E.FRAME, np.float32), ep, chunk=chunk).cut_s, 3))
    assert len(cuts) == 1


# ------------------------------------------------------------------ driving it live (listen)
def test_listen_drives_a_live_source_and_reports_the_start_once():
    probs = script(("quiet", 1), ("speech", 1.0), ("quiet", 0.5), ("speech", 0.5), ("quiet", 3))
    blocks = [np.zeros(E.FRAME, np.float32) for _ in probs]
    seen, levels = [], []
    ep = E.EndPointer(vad=ScriptedVad(probs))
    utt = E.listen(ep, lambda timeout: blocks.pop(0) if blocks else None,
                   on_event=lambda kind, t, info: seen.append(kind), on_block=levels.append)
    assert seen.count("start") == 1 and seen[-1] == "end" and utt.reason == "silence"
    assert len(levels) == len(probs) - len(blocks)          # every block it used was shown
    assert close(utt.speech_end_s, 3.0)                     # held through the 0.5 s gap


def test_a_microphone_that_stops_sending_does_not_hang_the_loop():
    probs = script(("speech", 1.0))
    blocks = [np.zeros(E.FRAME, np.float32) for _ in probs]
    ep = E.EndPointer(vad=ScriptedVad(probs))
    calls = []

    def source(timeout):
        calls.append(timeout)
        return blocks.pop(0) if blocks else None             # then nothing, for ever

    utt = E.listen(ep, source, poll_s=0.25, starve_s=3.0)
    assert utt.reason == "closed" and utt.has_speech
    assert len(calls) - len(probs) == 12                      # 12 empty polls x 0.25 s = 3 s


# ------------------------------------------------------------------ how the words end
@pytest.mark.parametrize("text,verdict", [
    ("What time is it?", E.REQUEST),
    ("Switch on the fan.", E.REQUEST),
    ("Turn the light on.", E.REQUEST),                     # "on" ends requests, not thoughts
    ("Hey Jarvis, tell me a joke", E.REQUEST),
    ("Light band karo", E.REQUEST),
    ("fan thoda tez kar do", E.REQUEST),
    ("kal mera kaun sa paper hai?", E.REQUEST),
    ("लाइट बंद करो।", E.REQUEST),
    ("I was thinking about the weather today and…", E.INCOMPLETE),
    ("Tell me the plan for tomorrow because.", E.INCOMPLETE),  # what Whisper really wrote
    ("So the thing I wanted to ask is about the", E.INCOMPLETE),
    ("main soch raha tha ki", E.INCOMPLETE),
    ("मुझे बताओ कि", E.INCOMPLETE),
    ("I wanted to ask you,", E.INCOMPLETE),
    ("I feel demotivated today.", E.STATEMENT),
    ("I didn't know that.", E.STATEMENT),
    ("main thak gaya hoon", E.STATEMENT),
    # What large-v3-turbo really wrote for Kokoro fragments (2026-10-12, stt.transcribe
    # + hinglish.romanize), so the rules are checked against Whisper, not against me:
    ("main soch raha tha ki|", E.INCOMPLETE),
    ("aj sham ko ham aur", E.INCOMPLETE),
    ("Light band karo aur", E.INCOMPLETE),
    ("So what I wanted to say is that.", E.INCOMPLETE),
    ("Remind me to call my father when.", E.INCOMPLETE),
    ("I want to go to Germany, but...", E.INCOMPLETE),
    ("mujhe batao kiye|", E.STATEMENT),   # "मुझे बताओ कि" misheard: the known miss (DECISIONS)
    ("", E.UNKNOWN),
    ("...", E.UNKNOWN),
])
def test_text_finality(text, verdict):
    assert E.text_finality(text) == verdict


# ------------------------------------------------------------------ the threaded judge
def test_thread_judge_runs_off_thread_and_the_newest_request_wins():
    seen = []

    def slow(audio):
        seen.append(len(audio))
        time.sleep(0.15)
        return "What time is it?", {"n": len(audio)}

    j = E.ThreadJudge(slow)
    j.submit(np.zeros(100), upto=100, now=0)
    time.sleep(0.03)                            # job 1 is running
    j.submit(np.zeros(200), upto=200, now=0)    # queued...
    j.submit(np.zeros(300), upto=300, now=0)    # ...and replaced before it starts
    got = j.wait_for(300, timeout=2.0)
    assert got is not None and got.upto == 300 and got.payload == {"n": 300} and got.verdict == E.REQUEST
    assert seen == [100, 300]


def test_thread_judge_survives_a_failing_transcriber():
    def broken(audio):
        raise RuntimeError("CUDA out of memory")

    j = E.ThreadJudge(broken)
    j.submit(np.zeros(10), upto=10, now=0)
    got = j.wait_for(10, timeout=2.0)
    assert got.verdict == E.UNKNOWN and j.errors == 1


def test_a_reset_judge_forgets_the_last_utterance():
    j = E.ThreadJudge(lambda a: "hello")
    j.submit(np.zeros(10), upto=10, now=0)
    assert j.wait_for(10, timeout=2.0) is not None
    j.submit(np.zeros(10), upto=20, now=0)
    time.sleep(0.1)
    j.reset()
    assert j.poll(0) is None and j.wait_for(20, timeout=0.2) is None


# ------------------------------------------------------------------ the setting
def test_the_old_rule_is_one_setting_away():
    assert E.mode_from([], {}) == "silero"
    assert E.mode_from([], {"JARVIS_ENDPOINTER": "energy"}) == "energy"
    assert E.mode_from(["jarvis.py", "--endpointer=energy"], {}) == "energy"
    assert E.mode_from(["--endpointer=silero"], {"JARVIS_ENDPOINTER": "energy"}) == "silero"


def test_the_old_rule_model_counts_blocks_not_seconds():
    """62.5 quiet BLOCKS: 4 s only at 1024-sample blocks, 1 s at 256; a noise floor
    above -75 dBFS (at 1024) never counts as quiet, so it never ends."""
    speech_then_silence = np.concatenate([0.1 * np.ones(SR, np.float32), np.zeros(8 * SR, np.float32)])
    for block, expect in ((1024, 4.0), (512, 2.0), (256, 1.0)):
        old = E.EnergyEndPointer(block=block)
        old.feed(speech_then_silence)
        assert old.done and expect <= old.cut / SR - 1.0 <= expect + 0.2, block
    hiss = speech_then_silence + C.pink(speech_then_silence.size, 10 ** (-50 / 20))
    old = E.EnergyEndPointer(block=1024)
    old.feed(hiss)
    assert not old.done


# ------------------------------------------------------------------ real speech (Kokoro)
def _mid_clip(voice, lang, a, b, pause, noise_db=-45.0):
    return C.compose([(a, C.speech(a, voice, lang)), (b, C.speech(b, voice, lang))], [pause],
                     noise_db=noise_db)


def _run_with_oracle(clip, latency=JUDGE_LATENCY_S):
    ep = E.EndPointer()
    ep.judge = E.ClockedJudge(C.oracle(clip, ep), latency_s=latency)
    ep.reset()
    return ep, E.run_clip(clip.audio, ep)


@needs_kokoro
@pytest.mark.parametrize("pause", [1.5, 2.0, 2.5])
@pytest.mark.parametrize("item", C.MID_SENTENCE, ids=["en-gb", "en-us", "hi"])
def test_a_mid_sentence_pause_does_not_end_the_utterance(item, pause):
    clip = _mid_clip(*item, pause)
    ep, utt = _run_with_oracle(clip)
    first, last = clip.parts
    assert utt.reason == "silence"
    assert utt.speech_start_s <= first.start_s + 0.1               # began with the first word...
    assert utt.speech_end_s >= last.end_s - 0.1                    # ...and held through the pause
    assert ep.audio_start / SR <= first.start_s - 0.3              # pre-roll kept the first syllable
    assert utt.cut_s - last.end_s <= 1.5                           # and still ended promptly
    assert utt.judgement.text == clip.text_upto(10 ** 9)           # the whole sentence, once


@needs_kokoro
def test_a_mid_sentence_pause_holds_in_louder_noise_too():
    clip = _mid_clip(*C.MID_SENTENCE[0], 2.5, noise_db=-35.0)     # SNR ~15 dB
    _, utt = _run_with_oracle(clip)
    assert utt.speech_end_s >= clip.parts[-1].end_s - 0.1 and utt.cut_s - clip.end_s <= 1.5


@needs_kokoro
@pytest.mark.parametrize("item", C.REQUESTS, ids=["en-us", "en-gb", "hi"])
def test_a_finished_request_ends_within_1_5_s(item):
    voice, lang, text = item
    clip = C.compose([(text, C.speech(text, voice, lang))], [], tail_s=5.0)
    _, utt = _run_with_oracle(clip)
    assert utt.verdict == E.REQUEST and utt.cut_s - clip.end_s <= 1.5
    # with no judge at all the fixed 1.2 s tail applies
    utt2 = E.run_clip(clip.audio, E.EndPointer())
    assert utt2.cut_s - clip.end_s <= 1.35


@needs_kokoro
def test_old_rule_vs_new_on_the_same_clips(capsys):
    """The measurement asked for in ROADMAP A1: end of speech -> cut, old vs new.

    Two rooms for the old rule: a real noise floor (-45 dBFS pink + fan), and the
    near-digital silence a noise-suppressing mic DSP leaves between phrases ("gated").
    The old rule's block size was never chosen, so 256/512/1024 are all shown."""
    rows, new_lat = [], []
    cut_mid_256, n_mid = 0, 0
    for item in C.MID_SENTENCE:
        for pause in (1.5, 2.0, 2.5):
            clip = _mid_clip(*item, pause)
            _, utt = _run_with_oracle(clip)
            new_lat.append(utt.cut_s - clip.end_s)
            gated = np.zeros_like(clip.audio)
            for p in clip.parts:
                s, e = int(p.start_s * SR), int(p.end_s * SR)
                gated[s:e] = clip.audio[s:e]
            olds = {}
            for blk in (256, 512, 1024):
                o = E.EnergyEndPointer(block=blk)
                o.feed(clip.audio)
                assert not o.done                                  # a noise floor: never ends
                g = E.EnergyEndPointer(block=blk)
                g.feed(gated)
                olds[blk] = g.cut / SR - clip.end_s if g.done else None
                if blk == 256 and g.done and g.cut / SR < clip.parts[1].start_s:
                    cut_mid_256 += 1
            n_mid += 1
            rows.append((item[2][:28], pause, utt.cut_s - clip.end_s, olds))
    for item in C.REQUESTS:
        clip = C.compose([(item[2], C.speech(item[2], item[0], item[1]))], [], tail_s=6.0)
        _, utt = _run_with_oracle(clip)
        new_lat.append(utt.cut_s - clip.end_s)
        gated = np.zeros_like(clip.audio)
        s, e = int(clip.parts[0].start_s * SR), int(clip.parts[0].end_s * SR)
        gated[s:e] = clip.audio[s:e]
        olds = {}
        for blk in (256, 512, 1024):
            g = E.EnergyEndPointer(block=blk)
            g.feed(gated)
            olds[blk] = g.cut / SR - clip.end_s if g.done else None
        rows.append((item[2][:28], 0.0, utt.cut_s - clip.end_s, olds))

    with capsys.disabled():
        print("\n  end of speech -> cut (s); old rule on a gated mic (it never ends on a noise floor)")
        print(f"  {'clip':30s} pause   new   old/256 old/512 old/1024")
        f = lambda v: "  never" if v is None else f"{v:7.2f}"
        for name, pause, new, olds in rows:
            print(f"  {name:30s} {pause:4.1f} {new:6.2f} {f(olds[256])} {f(olds[512])} {f(olds[1024])}")
        print(f"  new: median {np.median(new_lat):.2f} s, max {max(new_lat):.2f} s; "
              f"old/256 cut {cut_mid_256} of {n_mid} mid-sentence pauses")
    assert np.median(new_lat) <= 1.5 and max(new_lat) <= 1.5
    assert all(o[1024] is not None and o[1024] >= 4.0 for _, _, _, o in rows)
    assert cut_mid_256 == n_mid           # the 10-10 failure, reproduced: cut while still speaking

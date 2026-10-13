"""Fixes from the 2026-10-14 transcript review (docs/research/2026-10-14-conversation-fixes.md).

Every phrase here is invented: the conversations are private and the repo is public.
The fakes (model, app) come from test_agent_tools.py.
"""
import pytest
from langchain_core.messages import AIMessageChunk

import longform
import room
import wake
from tools import honesty
from tools import media as media_words
from tools.builtin import default_registry
from tools.registry import Receipt

from test_agent_tools import FakeApp, agent, brain, receipts, run, words  # noqa: F401  (fixtures)

REG = default_registry()


def posts(app, prefix):
    return [c for c in app.calls if c[0] == "POST" and c[1].startswith(prefix)]


# ------------------------------------------------------------------ 1. one verb per clause
@pytest.mark.parametrize("said, expected", [
    ("switch the light on and turn the fan off", [("light", "on", None), ("fan", "off", None)]),
    ("light on, fan off please", [("light", "on", None), ("fan", "off", None)]),
    ("batti jala do aur pankha band karo", [("light", "on", None), ("fan", "off", None)]),
    ("turn on the fan and the light", [("fan", "on", None), ("light", "on", None)]),
    ("the light and the fan off", [("light", "off", None), ("fan", "off", None)]),
    ("turn the fan off and the light on", [("fan", "off", None), ("light", "on", None)]),
    ("light band karo", [("light", "off", None)]),                       # one clause still works
])
def test_each_clause_gets_its_own_verb(said, expected):
    assert room.parse(said) == expected


def test_a_mixed_command_switches_each_device_its_own_way(brain):
    app = brain.use_app(FakeApp(usb=True))
    app.state = {"light": {"on": False, "level": 100}, "fan": {"on": True, "level": 60}}
    out = run(brain.agent, "switch the light on and turn the fan off")
    assert ("POST", "/api/limbs/light", {"action": "on", "value": None}) in app.calls
    assert ("POST", "/api/limbs/fan", {"action": "off", "value": None}) in app.calls
    assert out == "The light is on. The fan is off."


# ------------------------------------------------------------------ 2. speed and brightness: the truth
@pytest.mark.parametrize("said, device", [
    ("make the fan faster", "fan"),
    ("fan ki speed badhao", "fan"),
    ("dim the light a little", "light"),
    ("why can't you raise the fan speed?", "fan"),
    ("fan 70 percent", "fan"),
])
def test_a_speed_or_brightness_request_is_a_level_request(said, device):
    assert room.parse(said) == [(device, "level", None)]


def test_fan_speed_gets_an_honest_answer_and_switches_nothing(brain):
    app = brain.use_app(FakeApp(usb=True))
    out = run(brain.agent, "make the fan faster")
    assert out == room.LEVEL_SAY["fan"] and "regulator" in out
    assert posts(app, "/api/limbs") == []
    assert brain.plain.seen == [] and brain.bound.seen == []                 # no model, no guard tail
    assert "haven't checked" not in out


def test_on_at_full_speed_switches_on_and_says_the_truth_about_speed(brain):
    app = brain.use_app(FakeApp(usb=True))
    app.state["fan"] = {"on": False, "level": 60}
    out = run(brain.agent, "turn on the fan at full speed")
    assert ("POST", "/api/limbs/fan", {"action": "on", "value": None}) in app.calls
    assert out == "The fan is on. " + room.LEVEL_SAY["fan"]


def test_a_dimmed_light_is_never_a_timed_switch(brain):
    """when.py must not schedule a "level" (the switch_later tool has no such action)."""
    app = brain.use_app()
    brain.bound.rounds.append(words("The light has no dimmer, I'm afraid."))
    run(brain.agent, "dim the light in 10 minutes")
    assert not any(c[1] == "/api/reminders" for c in app.calls)


# ------------------------------------------------------------------ 3. media claims with no media receipt
@pytest.mark.parametrize("sentence", [
    "I've located “Neon Rivers” by The Glass Owls in your Spotify library, playing now from your device.",
    "I’ve found “Neon Rivers” in your Spotify library.",
    "I've initiated “Neon Rivers” from your music folder.",
    "I’ll bring “Neon Rivers” to your Spotify now.",
    "It is playing now, sir.",
])
def test_invented_playback_is_a_media_claim(sentence):
    assert "media" in {k for k, m in honesty.claims(sentence) if m == "assert"}
    assert honesty.unbacked(sentence, REG, [])


@pytest.mark.parametrize("sentence", [
    "Nothing is playing now.",
    "I've found nothing in your music folder for that.",
])
def test_honest_media_sentences_pass(sentence):
    assert "media" not in {k for k, _ in honesty.claims(sentence)}


SPOTIFY_SEARCH = {"ok": True, "confirmed": False, "source": "spotify", "needs_click": True,
                  "say": "Opened Spotify on a search for “Neon Rivers by The Glass Owls”. Spotify needs one click on "
                         "the top result to start it; I can't press play on a search without its paid Web API."}


def test_a_claimed_play_is_turned_into_a_real_one(brain):
    app = brain.use_app()
    app.media_reply = SPOTIFY_SEARCH
    brain.bound.rounds.append(words("I've located “Neon Rivers” by The Glass Owls in your Spotify library — "
                                    "playing now from your device. Enjoy it, sir."))
    out = run(brain.agent, "come on, the track I told you about, Neon Rivers by The Glass Owls, on spotify, play it")
    assert ("POST", "/api/media/play", {"query": "Neon Rivers by The Glass Owls", "source": "spotify"}) in app.calls
    assert out.startswith("Opened Spotify on a search") and "playing now" not in out
    assert out.count("Opened Spotify") == 1
    assert honesty.unbacked(out, brain.agent.REGISTRY, receipts(brain.agent)) == []


def test_without_a_play_request_a_claim_is_only_corrected(brain):
    app = brain.use_app()
    brain.bound.rounds.append(words("Now playing “Neon Rivers” on Spotify."))
    out = run(brain.agent, "do you like spotify's sound quality")
    assert not any(c[1] == "/api/media/play" for c in app.calls)
    assert "Now playing" not in out


SUGGESTION = "How about “Velvet Static” by Lumen Park? It hums like a circuit at rest."


def test_play_that_plays_the_song_jarvis_suggested(brain):
    app = brain.use_app()
    brain.bound.rounds.append(words(SUGGESTION))
    assert run(brain.agent, "suggest a song for a late night") == SUGGESTION
    run(brain.agent, "play that")
    assert ("POST", "/api/media/play", {"query": "Velvet Static by Lumen Park", "source": "auto"}) in app.calls
    assert not any(c[2] and c[2].get("query") == "that" for c in app.calls)


def test_play_that_on_spotify_keeps_the_source(brain):
    app = brain.use_app()
    app.media_reply = SPOTIFY_SEARCH
    brain.bound.rounds.append(words(SUGGESTION))
    run(brain.agent, "suggest a song for a late night")
    out = run(brain.agent, "play the one you suggested on spotify")
    assert ("POST", "/api/media/play", {"query": "Velvet Static by Lumen Park", "source": "spotify"}) in app.calls
    assert "needs one click" in out                                     # he must press play: said so


def test_play_it_right_after_a_suggestion_plays_it_and_otherwise_resumes(brain):
    app = brain.use_app()
    brain.bound.rounds.append(words(SUGGESTION))
    run(brain.agent, "suggest a song for a late night")
    run(brain.agent, "play it")
    assert ("POST", "/api/media/play", {"query": "Velvet Static by Lumen Park", "source": "auto"}) in app.calls
    brain.agent.reset_conversation()
    run(brain.agent, "play it")
    assert ("POST", "/api/media/control", {"action": "play"}) in app.calls


def test_a_long_request_for_the_suggested_song_plays_it(brain):
    app = brain.use_app()
    brain.bound.rounds.append(words(SUGGESTION))
    run(brain.agent, "suggest a song for a late night")
    run(brain.agent, "yes I agreed with you, now search online for the song you suggested and play it")
    assert ("POST", "/api/media/play", {"query": "Velvet Static by Lumen Park", "source": "youtube"}) in app.calls


def test_play_that_with_nothing_suggested_asks_instead_of_searching_that(brain):
    app = brain.use_app()
    out = run(brain.agent, "play that")
    assert out == "Which song shall I play? I haven't suggested one yet."
    assert not any(c[1] == "/api/media/play" for c in app.calls)


def test_play_on_spotify_uses_spotify_search(brain):
    app = brain.use_app()
    app.media_reply = SPOTIFY_SEARCH
    out = run(brain.agent, "play Velvet Static by Lumen Park on Spotify")
    assert ("POST", "/api/media/play", {"query": "Velvet Static by Lumen Park", "source": "spotify"}) in app.calls
    assert "needs one click" in out


@pytest.mark.parametrize("reply, title", [
    (SUGGESTION, "Velvet Static by Lumen Park"),
    ("We've had “Glass Rain” already; try “Low Orbit” by Kite Hours instead.", "Low Orbit by Kite Hours"),
    ("I haven't played anything yet; say \"play\" and the song, for example \"play Blinding Lights\".", ""),
    ("You said “if you are like” and then stopped.", ""),                  # a quote, not a song
])
def test_the_last_suggested_title_is_read_from_a_reply(reply, title):
    assert media_words.last_title([reply]) == title


# ------------------------------------------------------------------ 4. the canned web line matches the tools
def test_the_web_line_no_longer_denies_what_play_media_does(brain):
    brain.plain.rounds.append(words("According to the latest headlines, markets rallied today."))
    out = run(brain.agent, "anything big in the headlines today")
    assert "no internet access" not in out
    assert "the one thing I can open online is a song" in out
    assert "no internet access" not in REG.capability_block()


def test_search_it_online_plays_the_song_already_named(brain):
    app = brain.use_app()
    app.media_reply = {"ok": True, "confirmed": False, "source": "youtube",
                       "say": "Opened YouTube's top result for “Low Orbit by Kite Hours” in your browser; Windows "
                              "hasn't reported it playing yet."}
    brain.bound.rounds.append(words("Try “Low Orbit” by Kite Hours, a fine late-night song."))
    run(brain.agent, "suggest a song for the drive")
    brain.bound.rounds.append(words("I'll search YouTube for it right away."))
    out = run(brain.agent, "just find that song online in the browser and play it")
    assert ("POST", "/api/media/play", {"query": "Low Orbit by Kite Hours", "source": "youtube"}) in app.calls
    assert out.startswith("Opened YouTube's top result")


# ------------------------------------------------------------------ 5. promises he cannot keep
@pytest.mark.parametrize("sentence", [
    "Let me run a quick scan of the board.",
    "Right, I'll report back in ten minutes.",
    "I'll keep searching for it.",
    "I've checked the serial port twice.",
    "I've adjusted my microphone settings.",
    "I'll recalibrate my hearing threshold.",
    "I'll reset the board for you.",
])
def test_promises_are_claims(sentence):
    assert "promise" in {k for k, m in honesty.claims(sentence) if m == "assert"}
    assert honesty.unbacked(sentence, REG, [])


@pytest.mark.parametrize("sentence", [
    "I'll remind you in 10 minutes.",             # a reminder: its own kind, backed by a tool
    "Try unplugging the board and plugging it back in.",
    "If it still fails, check the cable first.",
    "I'll turn the fan off in 30 minutes.",
])
def test_advice_and_real_tools_are_not_promises(sentence):
    assert "promise" not in {k for k, _ in honesty.claims(sentence)}


def test_a_promised_follow_up_is_replaced_by_the_truth(brain):
    said = "my sensor board isn't showing up, sort it out"
    (brain.bound if brain.agent.REGISTRY.wants_tools(said) else brain.plain).rounds.append(words(
        "The cable may be loose. Let me run a full check on it. I'll report back in a few minutes."))
    out = run(brain.agent, said)
    assert "full check" not in out and "report back" not in out
    assert out.startswith("The cable may be loose.")
    assert out.count(honesty.CANNOT_SAY["promise"]) == 1


def test_the_persona_says_he_acts_only_while_spoken_to(agent):
    p = agent.persona(text_mode=False)
    assert "never promise a follow-up" in p and "nothing more happens" in p


# ------------------------------------------------------------------ 6. long answers, whole sentences
def test_long_requests_are_recognised():
    assert longform.wants_long("tell me a long story about a lighthouse keeper")
    assert longform.wants_long("explain the CMOS inverter in detail")
    assert longform.wants_long("ek kahani sunao")
    assert not longform.wants_long("explain setup time")
    assert not longform.wants_long("turn off the light")


def test_a_bigger_budget_for_one_turn_on_the_real_model_classes():
    from langchain_ollama import ChatOllama
    m = ChatOllama(model="qwen3:4b-instruct-2507", num_predict=400)
    big = longform.with_budget(m)
    assert big.num_predict == longform.LONG_FORM_TOKENS and m.num_predict == 400
    bound = m.bind_tools(REG.schemas())
    big_bound = longform.with_budget(bound)
    assert big_bound.bound.num_predict == longform.LONG_FORM_TOKENS and bound.bound.num_predict == 400
    assert longform.with_budget("a fake") == "a fake"


def capped_reply(text):
    return words(text) + [AIMessageChunk(content="", response_metadata={"done_reason": "length"})]


def test_a_story_gets_the_long_instruction_and_ends_on_a_whole_sentence(brain):
    brain.plain.rounds.append(capped_reply("Once a keeper lived by the sea. He lit the lamp each night. "
                                           "The moral is that habit is not"))
    out = run(brain.agent, "tell me a long story about a lighthouse keeper")
    assert out == "Once a keeper lived by the sea. He lit the lamp each night."
    assert longform.INSTRUCTION in brain.plain.seen[-1][-1].content


def test_an_uncapped_reply_keeps_its_last_words():
    g = honesty.Guard(REG, [])
    out = g.feed("All good here. And that is that") + g.finish(capped=False)
    assert out == "All good here. And that is that"


def test_a_capped_reply_with_no_full_sentence_is_marked_cut():
    g = honesty.Guard(REG, [])
    out = g.feed("The answer begins with") + g.finish(capped=True)
    assert out == "The answer begins with…"


# ------------------------------------------------------------------ 7. tails only where the claim was made
@pytest.mark.parametrize("sentence, kind", [
    ("The fan is on a relay, so its speed is set by the regulator.", "switch_state"),
    ("The light is on the same circuit as the socket.", "switch_state"),
    ("I'm counting on you to finish this chapter.", "track"),
    ("I'm watching the clock with you, sir.", "track"),
    ("The room is quiet now.", "switch_state"),
])
def test_figures_of_speech_are_not_claims(sentence, kind):
    assert kind not in {k for k, _ in honesty.claims(sentence)}


@pytest.mark.parametrize("sentence, kind", [
    ("The fan is indeed on, as you say.", "switch_state"),               # live run, 10-14: missed before
    ("By my sensors, you're at your desk, typing.", "presence"),        # live run, 10-14, no sensor line
])
def test_claims_the_live_model_slipped_past(sentence, kind):
    assert kind in {k for k, m in honesty.claims(sentence) if m == "assert"}


def test_a_slow_reply_question_gets_no_light_and_fan_tail(brain):
    brain.plain.rounds.append(words("That one took a moment to think, sir; the model was busy."))
    out = run(brain.agent, "why are you so slow today?")
    assert out == "That one took a moment to think, sir; the model was busy."


def test_last_turns_switch_backs_a_past_claim_but_not_a_new_promise(brain):
    a = brain.agent
    run(a, "light on karo")                                             # the fast path really switched it
    brain.plain.rounds.append(words("I've turned the light on for you, as you asked."))
    out = run(a, "tell me more about that")
    assert out.startswith("I've turned the light on for you, as you asked.")   # + the virtual-room note
    assert "haven't switched" not in out
    brain.plain.rounds.append(words("I'll turn the fan off as well."))
    out = run(a, "anything else you could do")
    assert "turn the fan off" not in out and "haven't switched" in out


def test_a_room_claim_about_the_ac_does_not_blame_the_light_and_fan():
    log = []
    out = honesty.check("The room is now comfortably cool.", REG, [], log)
    assert out == honesty.UNREACHABLE and "haven't checked the light" not in out


def test_the_rescue_runs_once_per_reply():
    calls = []

    def rescue(kind, sentence):
        calls.append(kind)
        return Receipt("room_state", "T0", True, "The light is off. The fan is on.", source="test",
                       backs=("switch_state",))
    g = honesty.Guard(REG, [], rescue=rescue)
    out = g.feed("The light is on. The fan is spinning fast. ") + g.finish()
    assert calls == ["switch_state"]
    assert out == "The light is off. The fan is on."


# ------------------------------------------------------------------ 8. his name alone
@pytest.mark.parametrize("said", ["Hey Jarvis!", "Jarvis?", "jarvis", "Okay Jarvis.", "Jarvis, you there?"])
def test_name_only_is_recognised(said):
    assert wake.name_only(said)


@pytest.mark.parametrize("said", ["Hey Jarvis, turn off the light", "Jarvis what time is it", "hi there",
                                  "good evening jarvis"])
def test_a_request_is_not_name_only(said):
    assert not wake.name_only(said)


def test_his_name_gets_a_butlers_word_and_no_sensor_report(brain, monkeypatch):
    a = brain.agent
    monkeypatch.setattr(a, "_app_get", lambda path, timeout=0.4: (_ for _ in ()).throw(AssertionError(path)))
    first = run(a, "Hey Jarvis!")
    second = run(a, "Jarvis?")
    assert first in wake.ACKNOWLEDGE and second in wake.ACKNOWLEDGE and first != second
    assert brain.plain.seen == [] and brain.bound.seen == []           # no model, no staff, no Aankhen

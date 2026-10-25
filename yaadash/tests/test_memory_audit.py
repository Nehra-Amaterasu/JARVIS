"""The gaps the 2026-10-23 test audit found in the chat-memory loop, one test each.

docs/research/2026-10-25-yaadash-test-audit.md maps every Yaadash honesty rule to its
tests. Everything here is invented (people, boards, songs); the transcripts and the
learned store are scratch folders; the model is a scripted fake (no Ollama)."""
import json
import os
import time

import pytest

import chat_memory as cm
import learn_chats as lc
from test_learn_chats import DAY, FakeLLM, Transcript, env, mem  # noqa: F401  (env is a fixture)


def saver():
    saved = []

    def save(words):
        new = words not in saved
        saved.append(words)
        return new
    save.saved = saved
    return save


# ------------------------------------------------ "remember that." (anaphora)
def test_remember_that_skips_a_line_jarvis_did_not_catch():
    save = saver()
    got = cm.handle_command("Remember that.", [
        ("The aquarium heater runs on the Arduino Nano now, not the ESP32.", "Noted, sir."),
        ("the render wala thing fan light haan bolo", "That one got lost on its way to me, sir. Once more?"),
    ], save)
    assert save.saved == ["The aquarium heater runs on the Arduino Nano now, not the ESP32"]
    assert got.ok and "Arduino Nano" in got.reply


@pytest.mark.parametrize("previous", [
    [("Which board runs the aquarium heater?", "The Arduino Nano runs the aquarium heater, sir.")],   # a question
    [("Man, man, man, man, man.", "Shall I play something?")],                                       # garble
    [("ok", "Very good.")],                                                                          # nothing
])
def test_remember_that_never_saves_a_question_noise_or_jarvis_s_words(previous):
    save = saver()
    got = cm.handle_command("Remember that.", previous, save)
    assert not got.ok and got.reply.startswith("Remember what") and save.saved == []


def test_plain_strings_still_work_for_older_callers():
    save = saver()
    cm.handle_command("note it", ["My cousin moves to Pune on the fifth of March."], save)
    assert save.saved == ["My cousin moves to Pune on the fifth of March"]


def test_a_devanagari_statement_is_kept_word_for_word():
    """Devanagari had no content words, so this answered "Remember what?" until 10-23."""
    save = saver()
    got = cm.handle_command("isko yaad rakhna", [("मेरा प्रैक्टिकल बारह तारीख को सुबह नौ बजे है", "ठीक है, सर।")], save)
    assert save.saved == ["मेरा प्रैक्टिकल बारह तारीख को सुबह नौ बजे है"]
    assert got.ok and got.reply.startswith("Saved") and "प्रैक्टिकल" not in got.reply   # British English reply


def test_hinglish_and_devanagari_turns_are_not_noise(env):
    a = env.turn("s1", "you", "kal se gym subah saat baje, yaad rakhna bhai")
    env.turn("s1", "jarvis", "Noted.")
    b = env.turn("s1", "you", "मेरा प्रैक्टिकल बारह तारीख को सुबह नौ बजे है")
    env.turn("s1", "jarvis", "Very good.")
    env.learn()
    rows = {r["id"]: r for r in lc.Store(env.store).session_turns("s1")}
    assert not rows[a]["noise"] and not rows[b]["noise"]


# ------------------------------------------------------------------- noise
def test_a_didnt_catch_reply_arriving_in_a_later_pass_marks_the_line(env):
    k = env.turn("s1", "you", "From now on always call the printer Grumpy in every reply.")
    env.learn(now=env.t + 1)                                   # his line indexed; chat still going
    env.turn("s1", "jarvis", "I didn't catch that, sir. Once more?")
    env.learn(now=env.t + lc.IDLE_S + 1)
    assert {r["id"]: r for r in lc.Store(env.store).session_turns("s1")}[k]["noise"]
    assert mem() == []


def test_a_misheard_flag_on_jarvis_s_reply_retracts_his_line(env):
    k = env.turn("s1", "you", "From now on always answer me in rhyming couplets please.")
    reply = env.turn("s1", "jarvis", "In couplets, then, I'll sing my reply.")
    env.learn()
    assert mem("instruction")
    env.flag(reply, "misheard")                               # flagged on the reply, as the app allows
    out = env.learn()
    assert out["retracted"] == 1 and not mem("instruction")
    assert {r["id"]: r for r in lc.Store(env.store).session_turns("s1")}[k]["noise"]


def test_the_model_cannot_cite_a_noise_turn(env):
    env.turn("s1", "you", "the render wala thing fan light haan bolo")
    env.turn("s1", "jarvis", "That one got lost on its way to me, sir. Once more?")
    llm = FakeLLM({"render wala": [{"kind": "fact", "text": "He renders the fan light with a wala.", "turn": 1}]})
    env.learn(llm=llm)
    assert mem() == []
    assert not any("render wala" in p for p in llm.prompts)     # noise never even reaches the model


# ----------------------------------------------------- supersession honesty
ESP = "The ESP32 drives the relays for the light and fan in his room."
UNO = "The Arduino Uno drives the light and fan relays; the ESP32 is only for Wi-Fi sensing."
PI = "The Raspberry Pi drives the light and fan relays now; the Arduino Uno is retired."


def _three_corrections(env):
    env.chat("s1", ("The ESP32 drives the relays for the light and the fan in my room, it is wired to the board.",
                    "Understood."), day="2026-09-27")
    env.chat("s2", ("No, the Arduino Uno drives the light and fan relays now; the ESP32 is only for Wi-Fi sensing.",
                    "Thank you."), day="2026-09-29")
    env.chat("s3", ("Correction again: the Raspberry Pi drives the light and fan relays now, the Arduino Uno is retired.",
                    "Noted."), day="2026-10-01")
    return FakeLLM({"wired to the board": [{"kind": "fact", "text": ESP, "turn": 1}],
                    "only for Wi-Fi sensing": [{"kind": "correction", "text": UNO, "turn": 1}],
                    "Uno is retired": [{"kind": "correction", "text": PI, "turn": 1}]})


def test_a_chain_of_corrections_leaves_only_the_last_and_the_old_lines_are_not_quoted(env):
    env.learn(llm=_three_corrections(env))
    assert [m["text"] for m in mem() if "relays" in m["text"]] == [PI]
    block, used = cm.context_block("what did I tell you about the light and fan relays?")
    assert used and "Raspberry Pi" in block
    assert "ESP32 drives" not in block and "Arduino Uno drives" not in block     # no excerpt brings them back
    assert block.index("LEARNED") < block.index("EARLIER") if "EARLIER" in block else True


def test_an_old_session_read_late_by_the_model_does_not_bring_the_old_fact_back(env, monkeypatch):
    llm = _three_corrections(env)
    monkeypatch.setattr(lc, "ollama_up", lambda timeout=0.5: False)
    env.learn(use_llm=True)                                   # Ollama down: the rules read all three
    env.learn(llm=llm)                                        # back up: the model re-reads them, oldest first
    active = [m["text"] for m in mem() if "relays" in m["text"]]
    assert ESP not in active and UNO not in active and PI in active
    (env.store / "cursor.json").unlink()                      # a lost cursor: everything read once more
    env.learn(llm=llm)
    assert [m["text"] for m in mem() if "relays" in m["text"]] == active


def test_a_correction_is_never_crowded_out_by_long_excerpts(env):
    long = " ".join(["the light and fan relays"] + ["and the wiring of the relays under the desk"] * 12)
    env.chat("s1", (long, "Understood."), (long + " again", "Understood."), day="2026-09-27")
    env.chat("s2", ("No, the Arduino Uno drives the light and fan relays now; the ESP32 is only for Wi-Fi sensing.",
                    "Thank you."), day="2026-09-29")
    env.learn(llm=FakeLLM({"only for Wi-Fi sensing": [{"kind": "correction", "text": UNO, "turn": 1}]}))
    block, _ = cm.context_block("what did I tell you about the light and fan relays?")
    assert UNO[:40] in block and len(block) <= cm.BLOCK_MAX_CHARS


def test_a_learned_memory_counts_as_found_so_no_record_is_not_claimed(env):
    """agent.py says "the archive has NO record of this" when Instagram recall (whose gate
    fires on "remember") finds nothing, unless this block reports a find. A learned
    memory answering the question is a find; until 10-23 only an excerpt counted."""
    env.chat("s1", ("Which board is on COM9?", "The ESP32 is on COM9, sir."),
             ("Actually, we are not using the ESP32 on COM9 any more, we are using the Arduino Nano on COM4.",
              "Thank you, sir."))
    env.learn()
    assert mem("correction")
    block, used = cm.context_block("do you remember what I said about using the ESP32 on COM9?")
    assert "Arduino Nano" in block and "EARLIER CHATS" not in block and used


def test_nothing_learned_about_it_means_an_empty_block(env):
    env.chat("s1", ("The spare key for the shed is under the blue flowerpot by the gate.", "Noted, sir."))
    env.learn()
    assert cm.context_block("what did I tell you about my trip to Iceland?") == ("", False)


# --------------------------------------------------------------- the budget
def test_the_block_stays_under_250_tokens_for_adversarial_memories(env, monkeypatch):
    monkeypatch.setattr(cm, "_query_vec", lambda q: None)     # word overlap alone: every memory qualifies
    words = "relay fan light board pump heater"
    rows = []
    for i in range(40):
        text = (f"{words} " + ("मेरा पंखा और बत्ती रिले से चलते हैं " if i % 2 else "x" * 40 + " ") * 20)
        rows.append({"id": f"m{i}", "kind": "correction" if i % 3 == 0 else "fact", "text": text, "src": text,
                     "evidence": [f"s#{i}"], "confidence": 0.8, "support": 1, "first_seen": 1.0, "last_seen": 2.0,
                     "status": "active"})
    rows.append({"id": "e1", "kind": "exemplar", "text": "x", "evidence": ["s#99"], "confidence": 0.6, "support": 9,
                 "first_seen": 1.0, "last_seen": 2.0, "status": "active",
                 "meta": {"he": "😂" * 300, "you": "हा" * 400}})
    env.store.mkdir(parents=True, exist_ok=True)
    (env.store / cm.MEMORIES_FILE).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    for q in (f"what about the {words}?", (words + " ") * 400, "बत्ती " * 300 + words):
        block, _ = cm.context_block(q)
        assert block and len(block) <= cm.BLOCK_MAX_CHARS and cm.approx_tokens(block) <= cm.BLOCK_MAX_TOKENS


def test_approx_tokens_counts_non_latin_as_a_token_each():
    assert cm.approx_tokens("a" * 400) == 100
    assert cm.approx_tokens("बत्ती" * 10) == 50


# ------------------------------------------------------------ cross-person
@pytest.mark.parametrize("text, src, wrong", [
    ("He is allergic to peanuts.", "My friend Kabir is allergic to peanuts, so no peanut chutney when he visits.", True),
    ("His friend Kabir is allergic to peanuts.", "My friend Kabir is allergic to peanuts, so no chutney.", False),
    ("He loves octopuses.", "My sister studies marine biology in Kochi and loves octopuses.", True),
    ("His sister studies marine biology in Kochi.", "My sister studies marine biology in Kochi.", False),
    ("He drinks his tea without sugar.", "I drink my tea without sugar every morning.", False),
    ("The Arduino Nano runs the heater.", "My brother says the Arduino Nano runs the heater.", False),  # not about him
])
def test_misattributed(text, src, wrong):
    assert lc.misattributed(text, src) is wrong


def test_a_friends_fact_is_never_stored_as_his(env):
    env.chat("s1", ("My friend Kabir is allergic to peanuts, so no peanut chutney when he visits on Sunday.", "Noted."),
             ("My sister Tara studies marine biology in Kochi and loves octopuses.", "Remarkable."))
    llm = FakeLLM({"peanut": [{"kind": "fact", "text": "He is allergic to peanuts.", "turn": 1},
                              {"kind": "fact", "text": "He loves octopuses and marine biology.", "turn": 3},
                              {"kind": "fact", "text": "His sister Tara studies marine biology in Kochi.", "turn": 3}]})
    env.learn(llm=llm)
    assert [m["text"] for m in mem()] == ["His sister Tara studies marine biology in Kochi."]
    block, _ = cm.context_block("am I allergic to peanuts?")
    assert "allergic" not in block


def test_an_older_memory_arriving_late_is_born_superseded():
    """A lost cursor re-reads every session, oldest first: the old fact meets the active
    correction that replaced it. Until 10-23 it was added as active ("an older memory
    never replaces a newer one" skipped the check the other way round)."""
    store = lc.Store.__new__(lc.Store)
    store.memories = []
    new = dict(kind="correction", text="Actually the Arduino Uno drives the relays; the ESP32 is for sensing.",
               evidence="b#1", ts=2.0, confidence=0.6)
    old = dict(kind="fact", text="The ESP32 drives the relays.", evidence="a#1", ts=1.0, confidence=0.6)
    lc.add_memory(store, new, lc.rule_judge, embed=None)
    lc.add_memory(store, old, lc.rule_judge, embed=None)
    assert [(m["text"][:9], m["status"]) for m in store.memories] == [("Actually ", "active"), ("The ESP32", "superseded")]
    lc.add_memory(store, dict(old), lc.rule_judge, embed=None)          # and read once more: still not back
    assert [m["status"] for m in store.memories] == ["active", "superseded"]


# --------------------------------------------- ingest after crashes and edits
def test_a_pass_that_dies_after_indexing_still_reads_the_session_later(env, monkeypatch):
    env.chat("s1", ("From now on always keep your replies under two sentences.", "Of course."))

    def die(self, ids):
        raise RuntimeError("the app closed")
    with monkeypatch.context() as mp:
        mp.setattr(lc.Store, "mark_noise", die)
        with pytest.raises(RuntimeError):
            env.learn()                                       # rows are in the table, the cursor is not saved
    assert lc.Store(env.store).table().count_rows() == 2
    out = env.learn()
    assert out["new_turns"] == 0 and out["sessions"] == 1 and mem("instruction")


def test_a_rewritten_transcript_is_read_again_without_duplicates(env):
    env.chat("s1", ("The greenhouse sensor runs on a solar panel now.", "Noted, sir."))
    env.learn()
    day = env.root / f"{DAY}.jsonl"
    day.write_text(day.read_text(encoding="utf-8").splitlines()[0] + "\n", encoding="utf-8")   # shorter file
    assert env.learn()["new_turns"] == 0
    assert lc.Store(env.store).table().count_rows() == 2


def test_an_unreadable_memories_file_is_set_aside_not_overwritten(env):
    env.store.mkdir(parents=True, exist_ok=True)
    (env.store / cm.MEMORIES_FILE).write_text('[{"id": "a1", "kind": "fact", "te', encoding="utf-8")
    env.chat("s1", ("From now on always keep your replies under two sentences.", "Of course."))
    env.learn()
    kept = list(env.store.glob(cm.MEMORIES_FILE + ".unreadable-*"))
    assert len(kept) == 1 and kept[0].read_text(encoding="utf-8").startswith('[{"id": "a1"')


def test_a_second_pass_while_one_runs_does_nothing(env):
    env.chat("s1", ("From now on always keep your replies under two sentences.", "Of course."))
    env.store.mkdir(parents=True, exist_ok=True)
    (env.store / "learn.lock").write_text("123", encoding="utf-8")
    assert env.learn()["skipped"] == "another run holds the lock" and mem() == []


# --------------------------------------------- never while JARVIS is answering
def test_a_fresh_transcript_line_means_he_is_talking_so_the_pass_waits(env):
    env.chat("s1", ("From now on always keep your replies under two sentences.", "Of course."))
    day = env.root / f"{DAY}.jsonl"
    os.utime(day, None)                                       # a line written just now
    out = env.learn(busy=None)                                # the default check, on the real mtime
    assert out["skipped"] == "he is talking" and out["new_turns"] == 0
    os.utime(day, (time.time() - 3600, time.time() - 3600))
    assert env.learn(busy=None)["sessions"] == 1


def test_he_starts_talking_mid_pass_and_the_model_is_not_called_again(env):
    for s in ("s1", "s2"):
        env.chat(s, ("My sister studies marine biology in Kochi and loves octopuses.", "Remarkable."))
    llm = FakeLLM({"marine biology": [{"kind": "fact", "text": "His sister studies marine biology in Kochi.",
                                       "turn": 1}]})
    out = env.learn(llm=llm, busy=lambda: len(llm.prompts) >= 1)
    assert len(llm.prompts) == 1 and out["skipped"] == "he started talking"
    cur = lc.Store(env.store).cursor["sessions"]
    assert cur["s1"]["upto"] == 2 and cur["s2"]["upto"] == 0          # s1 was read whole; s2 not at all
    out = env.learn(llm=llm)
    assert out["sessions"] == 1 and len(llm.prompts) == 2 and mem("fact")


# ------------------------------------------------------------ the model failing
def test_the_judge_failing_falls_back_to_the_rule(env):
    def flaky(prompt):
        if prompt.startswith("Two notes"):
            raise ConnectionError("Ollama went away")
        return FakeLLM({"ESP32 drives": [{"kind": "fact", "text": "The ESP32 drives the relays for his fan.", "turn": 1}],
                        "Arduino Uno": [{"kind": "correction", "text": "The Arduino Uno drives the relays for his fan.",
                                         "turn": 1}]})(prompt)
    env.chat("s1", ("The ESP32 drives the relays for my fan, wired last week.", "Understood."), day="2026-09-29")
    env.chat("s2", ("No, the Arduino Uno drives the relays for my fan, not the ESP32.", "Thank you."))
    out = env.learn(llm=flaky)
    assert out["sessions"] == 2 and out["superseded"] >= 1
    assert [m["text"] for m in mem("fact", status="superseded")] == ["The ESP32 drives the relays for his fan."]


def test_the_model_dying_mid_pass_keeps_the_rules_and_reads_it_later(env):
    env.chat("s1", ("Don't call me Aman anymore, call me chief, always.", "Very good, chief."),
             ("My sister studies marine biology in Kochi and loves octopuses.", "Remarkable."))

    def dead(prompt):
        raise ConnectionError("Ollama crashed")
    out = env.learn(llm=dead)
    assert out["by"] == "rules" and cm.address()[0] == "chief"
    assert lc.Store(env.store).cursor["sessions"]["s1"]["by"] == "rules"
    llm = FakeLLM({"marine biology": [{"kind": "fact", "text": "His sister studies marine biology in Kochi.",
                                       "turn": 3}]})
    env.learn(llm=llm)
    assert [m["text"] for m in mem("fact")] == ["His sister studies marine biology in Kochi."]


# ---------------------------------------- 10-25 audit: attribution loopholes
@pytest.mark.parametrize("text, src, wrong", [
    # A place in the memory is not the person the line is about (passed before 10-25).
    ("He is moving to Lisbon in January.", "My sister Tara is moving to Lisbon in January for her design job.", True),
    ("His sister Tara is moving to Lisbon.", "My sister Tara is moving to Lisbon in January.", False),
    # "bhai" said to JARVIS is "bro", not a brother (his own gym fact was dropped before 10-25).
    ("He goes to the gym at seven from tomorrow.", "Kal se gym subah saat baje, yaad rakhna bhai, gym ka bag ready.", False),
    ("He goes to the gym at seven.", "Mera bhai Rohan kal se gym jaata hai subah saat baje.", True),
])
def test_misattributed_places_and_vocatives(text, src, wrong):
    assert lc.misattributed(text, src) is wrong


# ------------------------------------------------- privacy: nothing goes public
def _git(*args):
    import subprocess
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if r.returncode not in (0, 1):
        pytest.skip("not a git checkout")
    return r


def test_the_real_stores_live_in_git_ignored_folders():
    """Every place a memory, a transcript or a flag is written by default is ignored by
    git: his chats can never be committed to the public repo by accident."""
    for rel in ("data/yaadash/learned/memories.json", "data/app/transcripts/2026-10-25.jsonl",
                "data/app/transcripts/flags.jsonl", "data/yaadash/chat_turns.lance/x"):
        assert _git("check-ignore", "-q", "--no-index", rel).returncode == 0, rel


def test_no_memory_or_transcript_file_is_tracked():
    tracked = _git("ls-files").stdout.splitlines()
    leaks = [p for p in tracked if any(k in p for k in
             ("memories.json", "prefs_live.json", "transcripts/", "flags.jsonl", ".lance/", "learn_cursor"))]
    assert leaks == []


# ------------------------------------------------- Keep / Wrong feedback edges
def test_wrong_without_the_right_answer_and_keep_on_a_receipt_store_nothing(env):
    """Wrong with no correction typed cannot become a "the right answer was" memory (it
    would be an empty claim), and Keep on "The light is on." is not a style to copy."""
    env.chat("s1", ("What year did the bridge open?", "It opened in 1999."),
             ("Turn on the light.", "The light is on."))
    env.flag("s1#2", "wrong", "   ")
    env.flag("s1#4", "good")
    env.learn()
    assert mem("correction") == [] and mem("exemplar") == []

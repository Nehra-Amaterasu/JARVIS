"""The conversation -> memory feedback loop (learn_chats.py writes, chat_memory.py reads).

Synthetic transcripts only, in a scratch folder: invented people and facts, never his.
The model is a scripted fake (no Ollama); the embedder is conftest's (bge-small offline,
else the hashing stand-in; nothing here depends on bge distances)."""
import json
import time
from pathlib import Path

import pytest

import chat_memory as cm
import learn_chats as lc

DAY = "2026-10-01"


class Transcript:
    """Writes the app's transcript format: one JSON line per turn, flags.jsonl beside."""

    def __init__(self, root: Path, t0: float):
        self.root, self.t = root, t0
        root.mkdir(parents=True, exist_ok=True)
        self.ids = {}

    def turn(self, session, role, text, day=DAY, gap=20.0):
        self.t += gap
        n = self.ids[session] = self.ids.get(session, 0) + 1
        obj = {"kind": "turn", "session": session, "id": n, "role": role, "text": text, "ts": self.t, "mode": "voice"}
        if role == "jarvis":
            obj.update(seconds=1.2, timings={"first_token": 0.6})
        with open(self.root / f"{day}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(obj) + "\n")
        return f"{session}#{n}"

    def chat(self, session, *pairs, day=DAY):
        for he, jarvis in pairs:
            self.turn(session, "you", he, day)
            if jarvis is not None:
                self.turn(session, "jarvis", jarvis, day)

    def flag(self, key, verdict, expected=""):
        s, n = key.rsplit("#", 1)
        with open(self.root / "flags.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"session": s, "id": int(n), "verdict": verdict, "note": "", "expected": expected,
                                "ts": self.t}) + "\n")


@pytest.fixture
def env(tmp_path, monkeypatch, embedder):
    store = tmp_path / "learned"
    monkeypatch.setenv("JARVIS_LEARNED_DIR", str(store))
    tr = Transcript(tmp_path / "transcripts", time.time() - 3 * 86400)

    def learn(llm=None, now=None, use_llm=False, **kw):
        return lc.run(transcripts=tr.root, store_dir=store, llm=llm, use_llm=use_llm or llm is not None,
                      now=now, **kw)
    tr.learn, tr.store = learn, store
    return tr


def mem(kind=None, status="active"):
    return [m for m in cm.memories(active_only=False)
            if (kind is None or m["kind"] == kind) and m.get("status", "active") == status]


class FakeLLM:
    """Answers the distil prompt from a script keyed by a phrase in the chunk; the judge
    prompt with `replaces`."""

    def __init__(self, distil=None, replaces=True):
        self.distil, self.replaces, self.prompts = distil or {}, replaces, []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        if prompt.startswith("Two notes"):
            return json.dumps({"replaces": self.replaces})
        for phrase, items in self.distil.items():
            if phrase in prompt:
                return json.dumps({"memories": items})
        return json.dumps({"memories": []})


# ------------------------------------------------------------------ ingest
def test_ingest_is_incremental_and_idempotent(env):
    env.chat("s1", ("The greenhouse sensor runs on a solar panel now.", "Noted, sir."))
    with open(env.root / f"{DAY}.jsonl", "a", encoding="utf-8") as f:
        f.write('{"kind": "turn", "session": "s1", "id": 3, "role": "you", "te')     # torn mid-write
    first = env.learn()
    assert first["new_turns"] == 2
    assert env.learn()["new_turns"] == 0                       # nothing read twice
    with open(env.root / f"{DAY}.jsonl", "a", encoding="utf-8") as f:
        f.write('xt": "and it charges by noon", "ts": %f}\n' % (env.t + 5))
    assert env.learn()["new_turns"] == 1                       # the finished line, once
    (env.store / "cursor.json").unlink()                       # cursor lost: re-read, nothing doubled
    assert env.learn()["new_turns"] == 0
    assert lc.Store(env.store).table().count_rows() == 3


def test_noise_never_becomes_a_memory(env):
    a = env.turn("s1", "you", "Man, man, man, man, man.")
    env.turn("s1", "jarvis", "Shall I play something?")
    b = env.turn("s1", "you", "the render wala thing fan light haan bolo")
    env.turn("s1", "jarvis", "That one got lost on its way to me, sir. Once more?")
    c = env.turn("s1", "you", "From now on always reply to me in rhyming couplets please.")
    env.turn("s1", "jarvis", "Very well.")
    env.flag(c, "misheard", "I said nothing at all")
    env.learn()
    rows = {r["id"]: r for r in lc.Store(env.store).session_turns("s1")}
    assert rows[a]["noise"] and rows[b]["noise"] and rows[c]["noise"]
    assert mem() == []


# ------------------------------------------------------------------ rules
def test_rules_alone_learn_address_corrections_style_and_donts(env):
    env.chat("s1",
             ("Don't call me Aman anymore, call me boss, always.", "Understood, boss."),
             ("Which board runs the aquarium heater?", "The ESP32 runs the aquarium heater."),
             ("Actually, we are not using the ESP32 for that, we are using the Arduino Nano for the heater.",
              "Thank you, boss."),
             ("Tell me something cheerful about Mondays.",
              "Mondays are merely Fridays wearing a disguise, boss, and I can see through it."),
             ("Haha, love this, spot on.", "Glad it landed."),
             ("Play the celebration song.", "Now playing Golden Hour by Kavya Ray in Spotify."),
             ("Yes! I love this song, this is the best thing ever.", "Enjoy it."),
             ("You keep saying the same thing again and again and not actually doing it.", "I'm sorry."))
    out = env.learn()
    assert out["by"] == "rules" and out["sessions"] == 1
    assert cm.address() == ("boss", ["Aman"])
    fix = mem("correction")
    assert len(fix) == 1 and "Arduino Nano" in fix[0]["text"] and fix[0]["evidence"] == ["s1#5"]
    ex = mem("exemplar")
    assert len(ex) == 1 and "disguise" in ex[0]["meta"]["you"] and "Mondays" in ex[0]["meta"]["he"]
    assert any("Golden Hour by Kavya Ray" in m["text"] for m in mem("preference"))
    donts = {m["meta"]["category"] for m in mem("dont")}
    assert {"loops", "false_claims"} <= donts
    persona = cm.adjust_persona('Call him "sir" now and then, Aman otherwise.\nYou: Fine, Aman.\n\nLENGTH: short.')
    assert 'Address him as "boss", always' in persona and "You: Fine, boss." in persona
    assert "HE DISLIKED" in persona and persona.index("HE DISLIKED") < persona.index("LENGTH:")


def test_his_flags_become_exemplars_and_corrections(env):
    env.chat("s1", ("What should I cook tonight?", "Dal and rice, sir: honest, quick, and forgiving of a late start."),
             ("What year did the bridge open?", "It opened in 1999."))
    env.flag("s1#2", "good")
    env.flag("s1#4", "wrong", "It opened in 2004.")
    env.learn()
    assert mem("exemplar")[0]["meta"]["you"].startswith("Dal and rice")
    assert "2004" in mem("correction")[0]["text"]


def test_a_chat_still_going_is_not_distilled(env):
    env.chat("s1", ("From now on always keep your replies under two sentences.", "Of course."))
    out = env.learn(now=env.t + 60)                           # a minute later: still talking
    assert out["sessions"] == 0 and mem() == []
    out = env.learn(now=env.t + lc.IDLE_S + 1)
    assert out["sessions"] == 1 and mem("instruction")


# ------------------------------------------------------------------ the model
def test_model_memories_must_point_at_his_line_and_share_its_words(env):
    env.chat("s1", ("My sister studies marine biology in Kochi and loves octopuses.", "Remarkable creatures."),
             ("Let's call the old printer Grumpy from now on, it hates Mondays.", "Grumpy it is."))
    llm = FakeLLM({"marine biology": [
        {"kind": "fact", "text": "His sister studies marine biology in Kochi.", "turn": 1, "confidence": 0.8},
        {"kind": "fact", "text": "He owns a red bicycle.", "turn": 1, "confidence": 0.9},          # not said
        {"kind": "fact", "text": "Octopuses are remarkable creatures.", "turn": 2, "confidence": 0.9},  # JARVIS's line
        {"kind": "callback", "text": "He calls the old printer Grumpy because it hates Mondays.", "turn": 3},
        {"kind": "opinion", "text": "Kochi is lovely.", "turn": 1},                                   # no such kind
    ]})
    out = env.learn(llm=llm)
    assert out["by"] == "llm+rules"
    texts = sorted(m["text"] for m in mem())
    assert texts == ["He calls the old printer Grumpy because it hates Mondays.",
                     "His sister studies marine biology in Kochi."]
    assert all(m["by"] == "llm" for m in mem())


def test_a_correction_supersedes_the_old_fact_and_only_the_new_one_is_shown(env):
    env.chat("s1", ("The ESP32 drives the relays for the light and the fan in my room.", "Understood."), day="2026-09-29")
    env.chat("s2", ("No, the Arduino Uno drives the light and fan now; the ESP32 is only for the Wi-Fi sensing.",
                    "Thank you, sir."), day="2026-10-01")
    llm = FakeLLM({"ESP32 drives the relays": [
        {"kind": "fact", "text": "The ESP32 drives the relays for the light and fan in his room.", "turn": 1}],
        "Arduino Uno drives": [
        {"kind": "correction", "text": "The Arduino Uno drives the light and fan; the ESP32 is only for Wi-Fi sensing.",
         "turn": 1}]})
    env.learn(llm=llm)
    old = mem("fact", status="superseded")
    assert len(old) == 1 and "ESP32 drives the relays" in old[0]["text"]
    new = [m for m in mem() if "Arduino Uno" in m["text"]]
    assert new and old[0]["superseded_by"] in {m["id"] for m in new}
    block, _ = cm.context_block("which board drives the light and fan relays?")
    assert "Arduino Uno" in block and "ESP32 drives the relays" not in block
    assert len(block) <= cm.BLOCK_MAX_CHARS


def test_the_models_wording_never_unseats_the_parsed_address_and_replaces_raw_rule_text(env):
    env.chat("s1", ("Don't call me Aman anymore, call me boss, always.", "Very good, boss."),
             ("Which board runs the aquarium heater?", "The ESP32 does."),
             ("Actually, we are not using the ESP32 for that, we are using the Arduino Nano for the heater, "
              "because the breadboard broke.", "Understood."))
    llm = FakeLLM({"aquarium": [
        {"kind": "instruction", "text": "Call him 'Boss' instead of 'Aman' at all times.", "turn": 1},
        {"kind": "correction", "text": "The Arduino Nano runs the aquarium heater; the ESP32 does not.", "turn": 5}]},
        replaces=True)
    env.learn(llm=llm)
    assert cm.address() == ("boss", ["Aman"])
    fixes = mem("correction")
    assert [m["text"] for m in fixes] == ["The Arduino Nano runs the aquarium heater; the ESP32 does not."]
    assert mem("correction", status="superseded")[0]["by"] == "rules"     # his raw words, replaced by the write-up


def test_without_the_model_a_correction_naming_the_same_thing_still_supersedes():
    store = lc.Store.__new__(lc.Store)
    store.memories = []
    old = dict(kind="fact", text="The ESP32 drives the relays.", evidence="a#1", ts=1.0, confidence=0.6)
    new = dict(kind="correction", text="Actually the Arduino Uno drives the relays; the ESP32 is for sensing.",
               evidence="b#1", ts=2.0, confidence=0.6)
    lc.add_memory(store, old, lc.rule_judge, embed=None)
    assert lc.add_memory(store, new, lc.rule_judge, embed=None) == "added+superseded"
    assert [m["status"] for m in store.memories] == ["superseded", "active"]


def test_the_same_memory_twice_raises_support_instead_of_duplicating():
    store = lc.Store.__new__(lc.Store)
    store.memories = []
    a = dict(kind="preference", text="He likes his tea without sugar.", evidence="a#1", ts=1.0, confidence=0.5)
    b = dict(kind="preference", text="He likes his tea without sugar.", evidence="b#3", ts=5.0, confidence=0.5)
    lc.add_memory(store, a, lc.rule_judge, embed=None)
    assert lc.add_memory(store, b, lc.rule_judge, embed=None) == "merged"
    (m,) = store.memories
    assert m["support"] == 2 and m["evidence"] == ["a#1", "b#3"] and m["last_seen"] == 5.0 and m["confidence"] > 0.5


def test_when_ollama_is_down_rules_run_and_the_model_reads_it_later(env, monkeypatch):
    env.chat("s1", ("My sister studies marine biology in Kochi and loves octopuses.", "Remarkable."))
    monkeypatch.setattr(lc, "ollama_up", lambda timeout=0.5: False)
    out = env.learn(use_llm=True)
    assert out["by"] == "rules" and lc.Store(env.store).cursor["sessions"]["s1"]["by"] == "rules"
    llm = FakeLLM({"marine biology": [{"kind": "fact", "text": "His sister studies marine biology in Kochi.",
                                       "turn": 1}]})
    out = env.learn(llm=llm)
    assert out["sessions"] == 1 and lc.Store(env.store).cursor["sessions"]["s1"]["by"] == "llm"
    assert [m["text"] for m in mem("fact")] == ["His sister studies marine biology in Kochi."]
    assert env.learn(llm=llm)["sessions"] == 0                 # and never again


def test_a_late_misheard_flag_retracts_what_rested_on_it(env):
    k = env.turn("s1", "you", "From now on always answer me in French please.")
    env.turn("s1", "jarvis", "Très bien.")
    env.learn()
    assert mem("instruction")
    env.flag(k, "misheard", "I never said that")
    out = env.learn()
    assert out["retracted"] == 1 and not mem("instruction")


def test_earlier_chats_come_back_when_he_asks_about_them(env):
    env.chat("s1", ("The spare key for the shed is under the blue flowerpot by the gate.", "Noted, sir."),
             ("Thanks.", "Any time."))
    env.learn()
    block, from_chats = cm.context_block("what did I tell you about the spare key for the shed?")
    assert from_chats and "blue flowerpot" in block and "EARLIER CHATS" in block
    _, from_chats = cm.context_block("what is a flip-flop?")
    assert not from_chats


def test_the_cli_backfills_and_reports(env, capsys):
    env.chat("s1", ("Don't call me Aman, call me chief, always.", "Very good, chief."))
    assert lc.main(["--transcripts", str(env.root), "--store", str(env.store), "--no-llm", "--since", "3650d"]) == 0
    out = capsys.readouterr().out
    assert '"new_turns": 2' in out and '"turns_indexed": 2' in out
    assert cm.address()[0] == "chief"


# --------------------------------------------------------- the read side alone
@pytest.mark.parametrize("said, bare", [
    ("Remember that.", True), ("remember it", True), ("Note it.", True), ("note that down please", True),
    ("Jarvis, I want you to note it. That's why I am saying it again and again. I want you to remember it. "
     "Also, yeah, that's all.", True),
    ("isko yaad rakhna", True), ("Save that, Jarvis.", True),
    ("Do you remember that?", False), ("remember that my exam is on the 12th", False),
    ("I want you to remember to buy milk tomorrow", False), ("what was that?", False),
])
def test_bare_memory_commands(said, bare):
    assert cm.is_bare_memory_command(said) is bare


@pytest.mark.parametrize("said, want", [
    ("Don't call me Aman anymore, call me sir, always.", {"address": "sir", "avoid": ["Aman"]}),
    ("I want you to not call me Aman, you have to call me sir, not Aman, okay?", {"address": "sir", "avoid": ["Aman"]}),
    ("call me boss from now on", {"address": "boss", "avoid": []}),
    ("call me at 9 tomorrow", None), ("can you call me back later", None), ("stop calling me sir", None),
])
def test_address_requests(said, want):
    assert cm.parse_address(said) == want

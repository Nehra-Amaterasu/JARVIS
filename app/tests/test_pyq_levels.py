"""Wave EW13 L1, a level on every question (ww_pyq/levels.py, the task level_pick in ww_counsel.py, R-75 in
routes_ww_pyq_prep.py, the step `levels` of R-72, and `level` in R-07's set).

Every question here is invented in the phrasing styles of the fixtures and the seed; no real paper text is copied. The
store is under tmp_path, the model a counting fake that answers from the prompt, and nothing reads the real data
directory, the network, the local model or the Claude tool.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq
from jarvis_app import ww_counsel as c
from jarvis_app.ww_pyq import levels, prep, settings
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from test_pyq_prep import B, Model, add_q, env, envelope, fake_cli, paper  # noqa: F401

# ------------------------------------------------------------------ the rule
CASES = {
    1: ["Define aliasing.",
        "State the sampling theorem.",
        "List four advantages of FIR filters over IIR filters.",
        "Name the windows used in filter design.",
        "What is meant by quantisation noise?",
        "Q3. Enumerate the properties of the Fourier transform. (5 marks)",
        "(a) Define aliasing. (b) Define the Nyquist rate."],
    2: ["Explain the working of a successive approximation converter.",
        "Why is a guard band needed between two channels?",
        "Compare FIR and IIR filters.",
        "Derive the expression for the output of an RC low pass filter.",
        "State and prove the convolution property of the DFT.",
        "Differentiate between energy and power signals.",
        "With a neat diagram, describe the superheterodyne receiver."],
    3: ["Calculate the Nyquist rate of a signal band limited to 4 kHz.",
        "Find the DFT of x(n) = {1, 2, 3, 4}.",
        "Determine the cutoff frequency of an RC filter with R = 10 kohm and C = 1 uF.",
        "Compute the energy of the signal x(t) = 5 cos(200 pi t) over 2 s.",
        "Evaluate the gain in dB of an amplifier with an output of 5 V for an input of 50 mV.",
        "A carrier of 1 MHz is modulated by a tone of 5 kHz. Find the bandwidth of the AM signal."],
    4: ["Calculate the order of a Butterworth filter for a passband edge of 1 kHz and a stopband edge of 2 kHz, and justify "
        "the choice of the bilinear transform.",
        "Find the output of the system for x(n) = {1, 1} and explain why the result is causal.",
        "Design a low pass filter with fc = 1 kHz and find its order; comment on its stability.",
        "Determine the sampling rate for a 3 kHz voice signal and discuss the effect of aliasing.",
        "Compute the SNR of an 8 bits quantiser with a 10 V range and explain how it changes with each added bit.",
        "Calculate the time constant for R = 5 ohm and L = 10 mH, then interpret what it means for the current."],
    5: ["Case study: a company that makes hearing aids wants a filter bank that splits speech into eight bands for its new "
        "product. Analyse the requirements and propose a design, stating the trade offs you would accept.",
        "You are working as an engineer at a firm that monitors bridges with vibration sensors. The sensors sample at an "
        "unknown rate and the data shows false peaks. Identify the cause and recommend changes to the acquisition chain.",
        "A hospital wants to send patient heart signals from wards to a central desk over a shared radio channel. As a "
        "consultant, suggest a modulation scheme and plan the channel allocation for forty beds, giving reasons.",
        "Scenario: a startup is building a smart doorbell that streams audio to a phone. Compare a sampling rate of "
        "8 kHz with one of 16 kHz for the product and recommend one with reasons for the client.",
        "Suppose you are the engineer of a small factory whose motors trip on a weak supply line. Analyse the readings "
        "the operators log each shift and propose a protection scheme the factory can afford.",
        "A bank wants its branch network to carry voice and data over one leased line per branch. Imagine you are the "
        "designer: develop a plan for the multiplexing and recommend the line rate it needs."],
}
SILENT = [
    "(a) Define aliasing. (b) Find the Nyquist rate of a 4 kHz signal.",        # lettered parts of different kinds
    "Explain aliasing. OR Calculate the Nyquist rate for a 5 kHz tone.",        # an OR between two kinds
    "Write short notes on window functions.",                                   # no asking verb
    "Draw the state diagram of a mod 4 counter.",                               # "state" as a noun is no verb
    "Hamming window.",                                                          # a heading
    "What is the Nyquist rate of a signal band limited to 4 kHz?",              # a recall verb over a given value
    "Define the 3 dB bandwidth of a filter.",                                   # a bare value in a definition
    "Find the Thevenin equivalent of the network shown.",                       # its values are in a figure
    "Differentiate x(t) = t^2 with respect to t.",                              # a derivative, not "differentiate between"
    "",
    # the review of 28 Nov: each of these got a certain level that was wrong (invented in the shapes it found)
    "Determine whether the system y(n) = 2x(n) + 3 is linear and time invariant.",   # "whether" asks for a property
    "Find whether the system with h(n) = 0.5^n u(n) is stable.",
    "Check if the system with h(n) = 2^n u(n) is causal for x(n) = {1, 2}.",
    "Find the equivalent resistance of the network shown in the figure. 5 m",      # the 5 is its marks
    "Find the current in the branch shown in the circuit. [4]",
    "What is meant by resonance? Calculate the resonant frequency for L = 1 mH and C = 1 uF.",   # two kinds
    "Define gain margin. Determine it for G(s) = 10/(s(s + 1)(s + 2)).",
    "Explain the sampling theorem with a numerical example.",
    "Case study: a company that sells sensors wants to price its new product line for small schools and clinics. "
    "Calculate the break-even quantity for a fixed cost of 5000 and analyse the plan.",   # a case asking for a number
]
NOT_FIVE = {
    # a noun alone ("a bank") is no case: plain concept verbs, so it reads as concept
    "Explain the role of the central server in the network of a bank. Describe how the branches connect to it, "
    "identify the protocols used at each layer and draw the arrangement with a neat diagram.": 2,
    # "a firm has" is no case and "evaluate the profit at Q = 40" asks for a quantity
    "A firm has the cost function C = 500 + 20Q and the revenue function R = 45Q for its single product line. Calculate "
    "the break-even quantity and evaluate the profit at Q = 40 units when the firm plans to expand.": 3,
}


@pytest.mark.parametrize("level,text", [(n, t) for n, ts in CASES.items() for t in ts])
def test_the_rule_gives_each_invented_question_its_level(level, text):
    assert len(CASES[level]) >= 6
    assert levels.rule_level(text) == level


@pytest.mark.parametrize("text", SILENT)
def test_the_rule_is_silent_when_it_is_not_certain(text):
    assert levels.rule_level(text) is None


@pytest.mark.parametrize("text,level", list(NOT_FIVE.items()))
def test_a_noun_alone_is_no_case_and_a_quantity_verb_with_values_is_a_numerical(text, level):
    assert len(text) >= levels.CASE_MIN and levels.rule_level(text) == level


def test_a_bare_count_is_no_given_value_and_a_short_case_is_no_case():
    assert not levels.has_values("List 4 advantages of DSP.") and levels.has_values("a 4 kHz tone")
    assert levels.has_values("for R = 10 and C = 2") and not levels.has_values("Q2. (10 marks) CO3 BL2")
    assert levels.rule_level("Case study: a company. Analyse it.") is None        # under CASE_MIN characters


# ------------------------------------------------------------------ the task
def test_level_pick_has_a_prompt_and_its_checker_drops_what_it_did_not_send():
    assert "level_pick" in c.TASKS and c.TASKS.index("level_pick") == c.TASKS.index("tag_topics") + 1
    f = {"question_ids": "Q1,Q2,Q3,Q4"}
    out = c.check_output("level_pick", {"picks": [{"id": "Q1", "level": 2}, {"id": "q2", "level": 3.0},
                                                 {"id": "Q9", "level": 1}, {"id": "Q3", "level": 6},
                                                 {"id": "Q4", "level": "4"}, {"id": "Q1", "level": 5},
                                                 {"id": "Q4", "level": True}]}, f)
    # Q1 named with 2 and with 5: the model did not decide, both rows go; Q9, the 6, the "4" and the true go too
    assert out == {"picks": [{"id": "Q2", "level": 3}], "dropped": 6}
    out = c.check_output("level_pick", {"picks": [{"id": "Q1", "level": 2}, {"id": "Q1", "level": 2}]}, f)
    assert out == {"picks": [{"id": "Q1", "level": 2}], "dropped": 1}
    for bad in ({"picks": [{"id": "Q1", "level": 2, "why": "it asks to explain"}]}, {"picks": "Q1"},
                {"picks": [], "note": "x"}, {"picks": [["Q1", 2]]}):
        assert c.check_output("level_pick", bad, f) is None
    sent = []
    r = c.counsel("level_pick", {"subject": "Signals", "questions": "Q1: Write short notes on windows.", "question_ids": "Q1"},
                  lambda s, u: sent.append((s, u)) or json.dumps({"picks": [{"id": "Q1", "level": 2}]}), "fake")
    assert r["status"] == "ok" and r["picks"] == [{"id": "Q1", "level": 2}]
    system, user = sent[0]
    assert "1 recall" in system and "5 case" in system and "Q1: Write short notes" in user


# ------------------------------------------------------------------ R-75
class LModel(Model):
    """The fake of test_pyq_prep, which also answers level_pick: a level by a word in each question, else none."""

    def __init__(self, level_by_word=None, hook=None, **kw):
        super().__init__(**kw)
        self.level_by_word = level_by_word or {}
        self.hook = hook

    def __call__(self, system, user):
        if "1 recall" not in system:
            return super().__call__(system, user)
        self.calls.append((system, user))
        if len(self.calls) in self.fail_calls:
            raise ConnectionError("down")
        if self.raw is not None:
            return self.raw
        if self.hook:
            self.hook()
        picks = []
        for qid, text in re.findall(r"^(Q\d+): (.+)$", user, re.M):
            n = next((v for w, v in self.level_by_word.items() if w in text.lower()), None)
            if n is not None:
                picks.append({"id": qid, "level": n})
        return json.dumps({"picks": picks})


SILENT_WORDS = {"notes": 2, "bizarre": 9}          # "sketch" gets no answer: it counts in none


def seed(st, extra=0):
    pid = paper(st, "Signals paper", "signals")
    ids = {"r1": add_q(st, pid, "Define aliasing in a sampled signal."),
           "r3": add_q(st, pid, "Calculate the Nyquist rate of a signal band limited to 4 kHz."),
           "m2": add_q(st, pid, "Write short notes on window functions."),
           "none": add_q(st, pid, "Sketch the spectrum of a sampled tone."),
           "drop": add_q(st, pid, "Write a bizarre essay on filters."),
           "hand": add_q(st, pid, "Explain the Gibbs effect, levelled by hand."),
           "picture": add_q(st, pid, "", text_status="none")}
    st.update_question(ids["hand"], {"level": 4})
    for i in range(extra):
        add_q(st, pid, f"Write short notes on window number {i}.")
    return ids


def lmodel(env, **kw):
    m = LModel(level_by_word=dict(SILENT_WORDS), **kw)
    env.app.state.pyq_prep_provider = m
    return m


def test_rule_first_then_the_model_counts_names_and_a_second_call_writes_nothing(env):
    ids = seed(env.st)
    m = lmodel(env)
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True}).json()
    envelope(j)
    # apply false: the model is not called, the answer says how many it would be sent
    assert (j["rule"], j["model"], j["none"], j["left"], j["would_ask"], j["held_by_hand"], j["no_text"]) == \
        (2, 0, 0, 3, 3, 1, 1) and m.calls == [] and "3 questions would go to the model" in j["reason"]
    assert env.st.get_question(ids["r1"])["level"] is None                         # apply false: nothing written
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    envelope(j)
    q = {k: env.st.get_question(v) for k, v in ids.items()}
    assert (q["r1"]["level"], q["r1"]["level_source"]) == (1, "rule")
    assert (q["r3"]["level"], q["r3"]["level_source"]) == (3, "rule")
    assert (q["m2"]["level"], q["m2"]["level_source"], q["m2"]["level_model"]) == (2, "model", "fake:test-model")
    assert q["none"]["level"] is None and q["drop"]["level"] is None and j["dropped"] == 1     # level 9 is dropped
    assert (q["hand"]["level"], q["hand"]["level_source"]) == (4, "hand")
    sent = "\n".join(u for _, u in m.calls)
    assert "levelled by hand" not in sent and "Define aliasing" not in sent    # only what the rule left goes out
    snap = (env.st.root / "questions" / f"{q['r1']['paper_id']}.json").read_text(encoding="utf-8")
    calls = len(m.calls)
    j2 = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert (j2["rule"], j2["model"]) == (0, 0)
    assert (env.st.root / "questions" / f"{q['r1']['paper_id']}.json").read_text(encoding="utf-8") == snap
    assert len(m.calls) == calls + 1          # only the two the model gave nothing for are asked again


def test_r75_reads_each_question_file_once_plus_one_read_a_write(env, monkeypatch):
    seed(env.st, extra=30)                    # two model batches
    other = paper(env.st, "Circuits paper", "circuits")
    add_q(env.st, other, "Define a node.")
    lmodel(env)
    reads, writes = [], []
    real_q, real_u = Store._questions_of, Store.update_questions
    monkeypatch.setattr(Store, "_questions_of", lambda self, pid: reads.append(pid) or real_q(self, pid))
    monkeypatch.setattr(Store, "update_questions", lambda self, *a, **k: writes.append(1) or real_u(self, *a, **k))
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert j["model"] == 31 and j["rule"] == 2
    # one read of the subject's one paper for the whole call, then one pass a write (the rule's levels 1 and 3, and
    # one level 2 write for each of the two model batches), each pass reading at most the two question files once
    assert len(writes) == 4 and len(reads) <= 1 + 2 * len(writes), reads
    assert reads[0] != other                                          # the call's one read is the subject's paper


def test_a_question_too_long_to_send_whole_stays_without_a_level(env):
    pid = seed(env.st)["r1"]
    long_id = add_q(env.st, env.st.get_question(pid)["paper_id"], "Write short notes on " + "window shapes " * 40)
    m = lmodel(env)
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert j["too_long"] == 1 and env.st.get_question(long_id)["level"] is None
    assert "window shapes window shapes" not in "\n".join(u for _, u in m.calls) and "too long" in j["reason"]


def test_update_questions_reads_each_file_once_saves_each_once_and_is_all_or_none(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    ids = []
    for k in range(20):
        pid = paper(st, f"Paper {k}", "signals")
        ids += st.add_questions(pid, [{"text": f"Define item {k}-{i}.", "marks": 2} for i in range(10)])
    reads, saves = [], []
    real_q, real_s = Store._questions_of, Store._save
    monkeypatch.setattr(Store, "_questions_of", lambda self, pid: reads.append(pid) or real_q(self, pid))
    monkeypatch.setattr(Store, "_save", lambda self, path, data: saves.append(path) or real_s(self, path, data))
    st.update_questions(ids, {"level": 1, "level_source": "rule"}, "rule")
    assert len(ids) == 200 and len(reads) <= 20 and len(set(reads)) == len(reads) and len(saves) == 20
    snap = {f.name: f.read_text(encoding="utf-8") for f in (st.root / "questions").glob("*.json")}
    reads.clear(), saves.clear()
    with pytest.raises(KeyError):                                     # one unknown id in the middle: nothing saved
        st.update_questions(ids[:100] + ["q-000000000000"] + ids[100:], {"level": 2, "level_source": "rule"}, "rule")
    assert saves == [] and snap == {f.name: f.read_text(encoding="utf-8") for f in (st.root / "questions").glob("*.json")}
    st.update_question(ids[150], {"level": 3})                       # his level on one in the middle
    snap = {f.name: f.read_text(encoding="utf-8") for f in (st.root / "questions").glob("*.json")}
    saves.clear()
    with pytest.raises(ValueError):                                   # the rule refused on it: nothing saved
        st.update_questions(ids, {"level": 2, "level_source": "rule"}, "rule")
    assert saves == [] and snap == {f.name: f.read_text(encoding="utf-8") for f in (st.root / "questions").glob("*.json")}
    assert st.get_question(ids[0])["level"] == 1 and st.update_question(ids[0], {"level": 2})["level_source"] == "hand"


def test_hand_beats_rule_beats_model_on_rewrite(env):
    st = env.st
    ids = seed(st)
    st.update_question(ids["r1"], {"level": 2, "level_source": "model", "level_model": "fake:old"}, "rule")
    lmodel(env)
    env.c.post(f"{B}/levels", json={"subject": "signals", "apply": True})
    q = st.get_question(ids["r1"])
    assert (q["level"], q["level_source"], q["level_model"]) == (1, "rule", "")          # the rule replaces the model's
    with pytest.raises(ValueError):
        st.update_question(ids["r1"], {"level": 3, "level_source": "model", "level_model": "x"}, "rule")
    with pytest.raises(ValueError):
        st.update_question(ids["hand"], {"level": 1, "level_source": "rule"}, "rule")
    st.update_question(ids["r1"], {"level": 5})                                            # his click over the rule
    env.c.post(f"{B}/levels", json={"subject": "signals", "apply": True})
    assert (st.get_question(ids["r1"])["level"], st.get_question(ids["r1"])["level_source"]) == (5, "hand")
    # he sets a level while the model is thinking: the model's answer for it is not written
    target = ids["m2"]
    m = lmodel(env, hook=lambda: st.update_question(target, {"level": 3}))
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    assert m.calls and (st.get_question(target)["level"], st.get_question(target)["level_source"]) == (3, "hand")
    assert j["model"] == 0


def test_batches_of_twenty_a_failed_batch_is_counted_and_untouched_and_limit_bounds_a_call(env):
    seed(env.st, extra=42)                    # 45 the rule leaves: notes, sketch, bizarre and 42 extra notes
    m = lmodel(env, fail_calls={2})
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True, "limit": 45}).json()
    sizes = [len(re.findall(r"^Q\d+: ", u, re.M)) for _, u in m.calls]
    assert sizes == [20, 20, 5] and j["asked"] == 45 and j["failed_batches"] == 1
    by_model = [q for q in env.st.list_questions(subject="signals") if q["level_source"] == "model"]
    # batch 1: the notes item and 17 extras get level 2, the sketch none (no word), bizarre dropped; batch 3: 5 extras
    assert len(by_model) == j["model"] == 23 and j["none"] == 2 and j["left"] == 20
    assert "1 batch of the model failed" in j["reason"]
    for bad in ({"subject": "signals", "limit": 0}, {"subject": "signals", "limit": 201}, {"subject": "signals", "limit": None},
                {}, {"subject": "signals", "apply": "yes"}, {"subject": "signals", "x": 1}):
        assert env.c.post(f"{B}/levels", json=bad).status_code == 400, bad
    assert env.c.post(f"{B}/levels", json={"subject": "nope"}).status_code == 404


def test_409_while_the_run_goes_and_planned_for_the_model_part_under_rules_only(env):
    ids = seed(env.st)
    m = lmodel(env)
    env.app.state.pyq_prep_job = SimpleNamespace(running=lambda: True)
    assert env.c.post(f"{B}/levels", json={"subject": "signals", "apply": True}).status_code == 409
    assert env.c.post(f"{B}/levels", json={"subject": "signals"}).status_code == 200          # a look writes nothing
    env.app.state.pyq_prep_job = prep.PrepJob()
    settings.save(env.st, True)
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True, "apply": True}).json()
    envelope(j)
    assert j["state"] == "planned" and "rules only" in j["reason"] and m.calls == []
    assert j["rule"] == 2 and env.st.get_question(ids["r1"])["level_source"] == "rule"         # the rule part ran
    settings.save(env.st, False)
    env.mp.setattr(prep, "_cli", lambda: fake_cli(mode="off"))
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "use_model": True}).json()
    assert j["state"] == "planned" and "the model is off" in j["reason"] and m.calls == []
    j = env.c.post(f"{B}/levels", json={"subject": "signals"}).json()
    assert j["state"] == "live"                                                                # no model asked for: live


def test_an_empty_subject_waits_and_solutions_are_left_out(env):
    j = env.c.post(f"{B}/levels", json={"subject": "signals"}).json()
    assert j["state"] == "waiting"
    sol = paper(env.st, "ZX4101_CIE2SOLUTION_2026-27", "signals")
    env.st.update_paper(sol, {"role": "solution"})
    add_q(env.st, sol, "Define aliasing as the overlap of shifted spectra.")
    j = env.c.post(f"{B}/levels", json={"subject": "signals", "apply": True}).json()
    assert j["solution_items"] == 1 and j["rule"] == 0


def test_the_job_runs_levels_in_its_place(env):
    seed(env.st)
    lmodel(env)
    assert prep.check_steps(["accept", "levels", "tags", "reread"]) == ["reread", "tags", "levels", "accept"]
    r = env.c.post(f"{B}/run", json={"steps": ["accept", "levels", "tags"], "subjects": ["signals"], "use_model": True})
    assert r.status_code == 200, r.text
    job = env.app.state.pyq_prep_job.wait(60)
    assert job["status"] == "done" and job["steps"] == ["tags", "levels", "accept"]
    assert job["results"]["levels"]["signals"] == {"rule": 2, "model": 1, "none": 2, "left": 0, "failed_batches": 0}
    srcs = sorted(q["level_source"] for q in env.st.list_questions(subject="signals"))
    assert srcs == ["hand", "model", "none", "none", "none", "rule", "rule"]


# ------------------------------------------------------------------ R-07 and the reread
def test_r07_takes_a_level_by_hand_and_refuses_one_out_of_range(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = FastAPI()
    routes_ww_pyq.register(app, SimpleNamespace(), SimpleNamespace(publish=lambda *a, **k: None))
    pid = paper(st, "Signals paper", "signals")
    qid = add_q(st, pid, "Define aliasing.")
    st.update_question(qid, {"level": 1, "level_source": "rule"}, "rule")
    with TestClient(app) as cl:
        for bad in (0, 6, "3", True, 2.5, [3]):
            assert cl.patch("/api/mission/pyq/questions", json={"ids": [qid], "set": {"level": bad}}).status_code == 400, bad
        assert st.get_question(qid)["level_source"] == "rule"
        r = cl.patch("/api/mission/pyq/questions", json={"ids": [qid], "set": {"level": 3}})
        assert r.status_code == 200 and (r.json()["items"][0]["level"], r.json()["items"][0]["level_source"]) == (3, "hand")
        r = cl.patch("/api/mission/pyq/questions", json={"ids": [qid], "set": {"level": None}})
        assert r.status_code == 200 and (r.json()["items"][0]["level"], r.json()["items"][0]["level_source"]) == (None, "hand")
        assert cl.patch("/api/mission/pyq/questions", json={"ids": [qid], "set": {"level_source": "rule"}}).status_code == 400
    assert levels.rule_level(st.get_question(qid)["text"]) == 1
    with pytest.raises(ValueError):                         # a null he set is his too: the rule does not fill it
        st.update_question(qid, {"level": 1, "level_source": "rule"}, "rule")


def test_a_level_set_by_hand_keeps_the_paper_from_being_replaced(tmp_path):
    st = Store(tmp_path / "pyq")
    pid = paper(st, "Signals paper", "signals")
    a, b = add_q(st, pid, "Define aliasing."), add_q(st, pid, "Explain aliasing.")
    st.update_question(a, {"level": 1, "level_source": "rule"}, "rule")
    assert prep.held_by_him(st.list_questions(paper_id=pid)) == ""          # a rule's level is not his
    st.update_question(b, {"level": 2})
    assert prep.held_by_him(st.list_questions(paper_id=pid)) == "1 given a level by you"

    def before(cur):
        why = prep.held_by_him(cur)
        if why:
            raise ValueError(why)
    with pytest.raises(ValueError):
        st.replace_questions(pid, [{"text": "Define aliasing again.", "marks": 5}], before)
    assert {q["id"] for q in st.list_questions(paper_id=pid)} == {a, b}

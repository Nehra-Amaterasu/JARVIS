"""Counsel (ww_counsel.py): prompts from files, any provider, strict output checks, and
graceful answers when the model is down or rambles. A fake provider stands in for a model."""
import json

import pytest

from jarvis_app import ww_counsel as c


def fake(answer):
    """A provider that returns `answer` (a dict is sent as JSON) and records what it was asked."""
    calls = []
    def run(system, user):
        calls.append((system, user))
        return json.dumps(answer) if isinstance(answer, dict) else answer
    run.calls = calls
    return run


def test_every_task_has_a_prompt_file_with_a_system_and_a_user_part():
    for t in c.TASKS:
        text = c.load_prompt(t)
        assert "\n---\n" in text and "JSON" in text.split("\n---\n")[0]


def test_grade_explain_fills_the_prompt_and_clamps_the_score():
    p = fake({"score": 2, "missing": ["the tail node is an AC ground"], "note": "Nearly there."})
    r = c.counsel("grade_explain", {"title": "Differential pair", "summary": "S", "explanation": "E"}, p)
    assert r["status"] == "ok" and r["score"] == 2 and r["missing"] == ["the tail node is an AC ground"]
    assert "Differential pair" in p.calls[0][1] and "E" in p.calls[0][1]
    assert c.counsel("grade_explain", {}, fake({"score": 9}))["status"] == "unparsed"


def test_quiz_keeps_three_well_formed_questions():
    p = fake({"questions": [{"q": "Why?", "a": "Because."}, {"q": "", "a": "x"}, {"q": "How?", "a": "So."}, {"q": "4", "a": "4"}, {"q": "5", "a": "5"}]})
    r = c.counsel("quiz_from_text", {"subject": "X", "text": "notes"}, p)
    assert [q["q"] for q in r["questions"]] == ["Why?", "How?", "4"]


def test_parse_day_only_accepts_known_counters_and_whole_numbers():
    p = fake({"counts": {"cigs": "3", "bogus": 1, "water": -2}, "items": [{"kind": "meal", "text": "rajma rice"}]})
    r = c.counsel("parse_day", {"counters": "cigs: cigarettes; water: glasses", "counter_ids": "cigs,water", "sentence": "s"}, p)
    assert r["counts"] == {"cigs": 3} and r["items"] == [{"kind": "meal", "text": "rajma rice"}]


def test_summarise_caps_at_five_lines_and_json_inside_chatter_is_found():
    raw = "Sure! Here you go:\n```json\n" + json.dumps({"summary": [str(i) for i in range(8)], "questions": ["q1"]}) + "\n```"
    r = c.counsel("summarise", {"source": "reel", "text": "t"}, fake(raw))
    assert r["status"] == "ok" and len(r["summary"]) == 5 and r["questions"] == ["q1"]


def test_a_dead_model_and_a_rambling_model_are_answers_not_crashes():
    def down(system, user):
        raise ConnectionError("refused")
    r = c.counsel("summarise", {"source": "x", "text": "t"}, down)
    assert r["status"] == "no_model" and "Ollama" in r["say"]
    r = c.counsel("summarise", {"source": "x", "text": "t"}, fake("I cannot help with that."))
    assert r["status"] == "unparsed" and r["raw"].startswith("I cannot")
    with pytest.raises(KeyError):
        c.counsel("dance", {}, fake({}))


def test_the_provider_comes_from_the_environment_when_set():
    p, name = c.default_provider({"COUNSEL_API_URL": "https://example.org/v1", "COUNSEL_API_KEY": "k"})
    assert name == "api" and callable(p)
    p, name = c.default_provider({})
    assert name == "ollama"


def test_long_inputs_are_cut_before_the_prompt():
    p = fake({"summary": ["a"], "questions": []})
    c.counsel("summarise", {"source": "x", "text": "y" * 50000}, p)
    assert len(p.calls[0][1]) < 13000

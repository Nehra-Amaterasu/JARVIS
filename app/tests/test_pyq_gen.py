"""E08, the pure half: blueprint (validate, infer, store), the generator around ww_generator.generate,
the print set and the numeric check. Every paper and question here is invented; the on-disk bank
is pointed at an empty scratch folder so the tests decide exactly what the generator sees."""
import json
import re

import pytest

from jarvis_app import ww_generator
from jarvis_app.ww_pyq import blueprint as bpm
from jarvis_app.ww_pyq import check as chk
from jarvis_app.ww_pyq import generate as gen
from jarvis_app.ww_pyq import printset
from jarvis_app.ww_pyq.store import Store

BANNED = ("important", "likely", "expected", "will be asked", "probability", "chance")

# topics no numerical template matches (ww_numericals.TEMPLATES keywords), so the bank alone fills seats
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Series", "topics": ["fourier series", "z domain"], "exam_weight": "med"}]
# one topic a template matches ("time constant" -> rc_tau), for the template fill
UNITS_T = UNITS + [{"n": 3, "title": "Circuits", "topics": ["time constant"], "exam_weight": "low"}]
EXAM = {"id": "cie-sig", "subject": "signals", "title": "Signals mid", "max": 60, "units": []}


@pytest.fixture(autouse=True)
def empty_disk_bank(tmp_path, monkeypatch):
    d = tmp_path / "disk-bank"
    d.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(d))


def sec(name, q, a, m, **kw):
    return {"name": name, "questions": q, "attempt": a, "marks": m, **kw}


def blueprint(sections=None, total=60, **kw):
    sections = sections if sections is not None else [sec("A", 5, 5, 2), sec("B", 6, 4, 7), sec("C", 4, 2, 11)]
    return bpm.normalize_blueprint({"exam": "cie-sig", "total": total, "duration_min": 90, "sections": sections, **kw})


def row(i, marks, section, unit=1, topic="sampling theorem", typ="descriptive", by="hand"):
    return {"id": f"q-{i:012x}", "question": f"Explain invented idea number {i} in a few lines.", "unit": unit, "topic": topic,
            "marks": marks, "section": section, "tier": "exam", "type": typ, "sitting": "Invented mid 2025",
            "origin": "own-paper", "status_by": by, "has_crop": False}


def bank40():
    out, i = [], 0
    for marks, section, n in ((2, "A", 12), (7, "B", 16), (11, "C", 12)):
        for k in range(n):
            out.append(row(i, marks, section, unit=1 + k % 2, topic=("sampling theorem", "fourier series")[k % 2]))
            i += 1
    return out


def generate(bp=None, bank=None, seed=1, units=UNITS, exam=EXAM, **kw):
    return gen.generate_paper(bp or blueprint(), exam, {"id": "signals", "units": units}, bank if bank is not None else bank40(),
                              {}, {}, seed, today=kw.pop("today", "2026-11-14"), **kw)


def slots(paper):
    return [s for x in paper["sections"] for s in x["slots"]]


def qids(paper):
    return [s["question_id"] for s in slots(paper) if s["source"] != "hollow"]


def all_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from all_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from all_strings(v)


# ------------------------------------------------------------------ 2. validate_blueprint, each rule fails
def test_a_balanced_blueprint_has_no_issues():
    assert bpm.validate_blueprint(blueprint()) == []


def test_rule_one_the_sum_of_attempt_times_marks_equals_total():
    issues = bpm.validate_blueprint(blueprint(total=20))
    assert [i["code"] for i in issues] == ["total"]
    assert "60" in issues[0]["text"] and "20" in issues[0]["text"] and issues[0]["section"] is None


def test_rule_two_questions_is_at_least_attempt():
    issues = bpm.validate_blueprint(blueprint([sec("A", 3, 5, 2), sec("B", 6, 4, 7), sec("C", 4, 2, 11)], total=60))
    assert issues[0]["code"] == "attempt" and issues[0]["section"] == "A"


def test_rule_three_or_pairs_need_an_even_count_with_half_attempted():
    odd = blueprint([sec("A", 5, 5, 2), sec("B", 5, 4, 7, choice="or-pairs"), sec("C", 4, 2, 11)])
    assert [i["code"] for i in bpm.validate_blueprint(odd)] == ["or_pairs"]
    not_half = blueprint([sec("A", 5, 5, 2), sec("B", 8, 4, 7, choice="or-pairs"), sec("C", 4, 2, 11)])
    assert bpm.validate_blueprint(not_half) == []
    wrong = blueprint([sec("A", 5, 5, 2), sec("B", 6, 4, 7, choice="or-pairs"), sec("C", 4, 2, 11)])
    assert bpm.validate_blueprint(wrong)[0]["code"] == "or_pairs"


@pytest.mark.parametrize("sections,total,code", [
    ([], 60, "no_sections"),
    ([sec("A", 0, 0, 2)], 0, "bad_number"),
    ([sec("A", 5, 5, -2)], 10, "bad_number"),
    ([sec("A", 5, 5, 2), sec("a", 5, 5, 2)], 20, "duplicate"),
    ([sec("A", 2.5, 2, 2)], 4, "bad_number"),
])
def test_malformed_values_are_issues(sections, total, code):
    assert bpm.validate_blueprint(blueprint(sections, total=total))[0]["code"] == code


@pytest.mark.parametrize("raw", [None, [], {"sections": "A"}, {"sections": ["A"]},
                                 {"sections": [{"name": "A", "questions": 1, "attempt": 1, "marks": 2, "types": ["essay"]}]},
                                 {"sections": [{"name": "A", "questions": 1, "attempt": 1, "marks": 2, "choice": "some"}]}])
def test_a_malformed_shape_is_a_value_error(raw):
    with pytest.raises(ValueError):
        bpm.normalize_blueprint(raw)


def test_the_exam_row_maximum_must_match_the_blueprint_total():
    issues = bpm.exam_issues(blueprint(), {"id": "cie-sig", "max": 20})
    assert [i["code"] for i in issues] == ["exam_max"] and "20" in issues[0]["text"]
    assert bpm.exam_issues(blueprint(), {"id": "cie-sig", "max": 60}) == []


# ------------------------------------------------------------------ 1. infer_blueprint
def _paper(total=50):
    return {"id": "p-aaaaaaaaaaaa", "title": "Invented mid", "total_marks": total, "subject": "signals"}


def _q(i, page, section, marks, group="", status="pending"):
    return {"id": f"q-{i:012x}", "paper_id": "p-aaaaaaaaaaaa", "page": page, "section": section, "marks": marks,
            "choice_group": group, "status": status, "text": f"Invented question {i}.", "type": "descriptive"}


def three_sections():
    qs = [_q(i, 1, "A", 2) for i in range(5)]
    qs += [_q(10 + i, 2, "B", 10, group=f"b{i // 2}") for i in range(6)]
    qs += [_q(20 + i, 3, "C", 5) for i in range(4)] + [_q(24, 3, "C", 4)]
    qs += [_q(30, 3, "C", 5, status="rejected"), _q(31, 3, "C", None)]
    return qs


def test_infer_reads_three_sections_and_balances_to_the_printed_total():
    bp, trace = bpm.infer_with_trace(_paper(50), list(reversed(three_sections())))
    got = [(s["name"], s["questions"], s["attempt"], s["marks"], s["choice"]) for s in bp["sections"]]
    assert got == [("A", 5, 5, 2, "all"), ("B", 6, 3, 10, "or-pairs"), ("C", 5, 2, 5, "any")]
    assert bp["total"] == 50 and bp["origin"] == "rule" and bp["source_paper"] == "p-aaaaaaaaaaaa"
    assert bpm.validate_blueprint(bp) == []
    assert any("printed total" in t and "Section C" in t for t in trace)
    assert any("OR pairs" in t for t in trace)
    assert bpm.infer_blueprint(_paper(50), three_sections()) == bp


def test_infer_without_a_printed_total_sums_the_sections():
    qs = [q for q in three_sections() if q["section"] != "C"]
    bp = bpm.infer_blueprint(_paper(None), qs)
    assert bp["total"] == 10 + 30 and bpm.validate_blueprint(bp) == []


def test_a_paper_with_no_sections_is_one_section_a():
    qs = [{**_q(i, 1, "", 5)} for i in range(4)]
    bp = bpm.infer_blueprint(_paper(None), qs)
    assert [(s["name"], s["questions"], s["attempt"], s["marks"]) for s in bp["sections"]] == [("A", 4, 4, 5)]


def test_infer_refuses_a_paper_with_no_questions_with_marks():
    with pytest.raises(ValueError):
        bpm.infer_blueprint(_paper(), [_q(1, 1, "A", None)])


# ------------------------------------------------------------------ the blueprint store
def test_blueprint_round_trip_and_the_exam_id_is_checked(tmp_path):
    st = Store(tmp_path / "pyq")
    assert bpm.load_blueprint(st, "cie-sig") is None
    saved = bpm.save_blueprint(st, "cie-sig", blueprint())
    assert saved["exam"] == "cie-sig" and saved["updated"]
    assert bpm.load_blueprint(st, "cie-sig") == saved
    assert (st.paths.blueprints / "cie-sig.json").is_file()
    assert not list(st.paths.blueprints.glob("*.tmp"))
    for bad in ("../x", "a/b", "a\\b", "", ".hidden", "c:x", "x" * 200):
        with pytest.raises(ValueError):
            bpm.save_blueprint(st, bad, blueprint())
        with pytest.raises(ValueError):
            bpm.load_blueprint(st, bad)
    assert sorted(p.name for p in (tmp_path / "pyq").rglob("*.json")) == ["cie-sig.json"]


# ------------------------------------------------------------------ 3. seeded: same seed same paper, new seed new paper
def test_same_seed_same_paper_byte_for_byte_and_another_seed_another_paper():
    a, b = generate(seed=7), generate(seed=7)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert a["made"] is None and a["seed"] == 7
    c = generate(seed=8)
    assert qids(a) != qids(c) and a["id"] != c["id"]
    assert re.fullmatch(r"g-[0-9a-f]{12}", a["id"])
    assert a["header"] == "Practice paper from your bank. Not an official paper."
    assert a["total_marks"] == 60 and a["invariants"] == [] and a["shortfall"] == []
    assert len(set(qids(a))) == len(qids(a)) == 15
    assert a["duration_min"] == 90 and a["minutes_per_mark"] == 1.5
    for s in a["sections"]:
        assert all(x["marks"] == s["marks"] for x in s["slots"])
    for text in all_strings(a):
        assert not any(w in text.lower() for w in BANNED), text


def test_the_generator_is_called_once_with_the_blueprint_as_the_pattern(monkeypatch):
    seen = []
    real = ww_generator.generate

    def spy(exam, *a, **k):
        seen.append(exam)
        return real(exam, *a, **k)
    monkeypatch.setattr(ww_generator, "generate", spy)
    generate(seed=3)
    assert len(seen) == 1
    assert seen[0]["pattern"] == [{"name": "A", "questions": 5, "attempt": 5, "marks": 2},
                                  {"name": "B", "questions": 6, "attempt": 4, "marks": 7},
                                  {"name": "C", "questions": 4, "attempt": 2, "marks": 11}]
    assert "pattern" not in EXAM


# ------------------------------------------------------------------ 4. an unbalanced blueprint is refused before anything is drawn
def test_an_unbalanced_blueprint_is_refused_with_its_first_issue(monkeypatch):
    monkeypatch.setattr(ww_generator, "generate", lambda *a, **k: pytest.fail("drew a paper from an unbalanced blueprint"))
    with pytest.raises(ValueError) as e:
        generate(bp=blueprint(total=50))
    assert str(e.value).startswith("The blueprint does not balance: ") and "60" in str(e.value)


def test_the_9_nov_bug_a_20_mark_row_never_borrows_a_60_mark_shape(monkeypatch):
    monkeypatch.setattr(ww_generator, "generate", lambda *a, **k: pytest.fail("drew a paper for the wrong total"))
    with pytest.raises(ValueError) as e:
        generate(exam={**EXAM, "max": 20})
    assert str(e.value).startswith("The blueprint does not balance: ") and "20" in str(e.value)


# ------------------------------------------------------------------ 5. families and the 14-day thinning
def test_a_family_appears_at_most_once_and_the_choice_is_seeded():
    bank = bank40()
    b_rows = [r["id"] for r in bank if r["section"] == "B"]
    families = {qid: f"f{k // 2}" for k, qid in enumerate(b_rows)}      # 8 families of two in section B
    seen_members = set()
    for seed in range(30):
        p = generate(bank=bank, seed=seed, families=families)
        fams = [families[q] for q in qids(p) if q in families]
        assert len(fams) == len(set(fams)), (seed, fams)
        seen_members.update(q for q in qids(p) if q in families)
    assert len(seen_members) > 8                                        # both members of a family turn up across seeds


def test_a_question_attempted_in_the_last_14_days_is_thinned_to_about_0_3():
    # Section A sets 5 and the bank has exactly 5 two-mark rows, so an unthinned row is on every paper.
    bank = [row(i, 2, "A") for i in range(5)]
    attempted, twin = bank[0]["id"], bank[1]["id"]
    bp = blueprint([sec("A", 5, 5, 2)], total=10)
    attempts = [{"question_id": attempted, "date": "2026-11-05"}, {"question_id": bank[2]["id"], "date": "2026-10-01"}]
    on_a = on_twin = on_old = 0
    for seed in range(200):
        p = gen.generate_paper(bp, {**EXAM, "max": 10}, {"id": "signals", "units": UNITS}, bank, {}, {}, seed,
                               attempts=attempts, today="2026-11-14")
        ids = qids(p)
        on_a += attempted in ids
        on_twin += twin in ids
        on_old += bank[2]["id"] in ids
        assert p["total_marks"] == 10 and p["invariants"] == []
    assert on_twin == 200 and on_old == 200                       # older than 14 days: not thinned
    assert 0.15 < on_a / on_twin < 0.5, on_a


# ------------------------------------------------------------------ 6. hollow slots keep the paper balanced
def test_a_slot_nothing_can_fill_is_hollow_named_in_shortfall_and_the_paper_balances():
    bank = [row(i, 2, "A") for i in range(5)] + [row(10 + i, 7, "B") for i in range(3)]
    p = generate(bank=bank, seed=2)
    hollow = [s for s in slots(p) if s["source"] == "hollow"]
    assert len(hollow) == 3 + 4                                   # 3 seats of B and every seat of C
    assert all(s["text"] == "" and s["question_id"] is None and s["reason"] for s in hollow)
    assert any(s["reason"] == "needs 1 more 11-mark question" for s in hollow)
    assert any("Section B" in line and "3 more 7-mark" in line for line in p["shortfall"])
    assert any("Section C" in line and "4 more 11-mark" in line for line in p["shortfall"])
    assert p["total_marks"] == 60 and p["invariants"] == []
    assert [len(s["slots"]) for s in p["sections"]] == [5, 6, 4]


def test_a_row_of_other_marks_never_sits_in_a_section():
    bank = [row(i, 2, "B") for i in range(20)]                    # two-mark rows wrongly lettered B
    p = generate(bank=bank, seed=4)
    for s in p["sections"]:
        for x in s["slots"]:
            if x["source"] != "hollow":
                assert x["marks"] == s["marks"] and s["name"] == "A", (s["name"], x)


def test_a_type_the_section_does_not_allow_never_takes_a_seat():
    bank = [row(i, 2, "A", typ="mcq") for i in range(5)] + [row(10 + i, 2, "A", typ="short") for i in range(5)]
    bp = blueprint([sec("A", 5, 5, 2, types=["short"])], total=10)
    for seed in range(5):
        p = generate(bp=bp, bank=bank, seed=seed, exam={**EXAM, "max": 10})
        assert {s["type"] for s in slots(p)} == {"short"} and len(qids(p)) == 5


def test_templates_fill_what_the_bank_cannot_with_their_keys():
    bank = [row(i, 2, "A") for i in range(5)]
    bp = blueprint([sec("A", 5, 5, 2), sec("B", 2, 2, 5, types=["numerical"])], total=20)
    p = generate(bp=bp, bank=bank, seed=5, units=UNITS_T, exam={**EXAM, "max": 20})
    b = p["sections"][1]["slots"]
    assert [s["source"] for s in b] == ["template", "template"]
    assert all(s["key"] and s["question_id"].startswith("n:rc_tau:") and s["type"] == "numerical" for s in b)
    assert len({s["question_id"] for s in b}) == 2 and p["shortfall"] == []
    assert all("key" not in s for s in p["sections"][0]["slots"])
    # a section that allows only descriptive questions gets no template: it is hollow instead
    bp2 = blueprint([sec("A", 5, 5, 2), sec("B", 2, 2, 5, types=["descriptive"])], total=20)
    p2 = generate(bp=bp2, bank=bank, seed=5, units=UNITS_T, exam={**EXAM, "max": 20})
    assert [s["source"] for s in p2["sections"][1]["slots"]] == ["hollow", "hollow"]


def test_slot_source_says_who_accepted_the_question():
    bank = [row(i, 2, "A", by="rule" if i % 2 else "hand") for i in range(5)]
    p = generate(bp=blueprint([sec("A", 5, 5, 2)], total=10), bank=bank, exam={**EXAM, "max": 10})
    by_id = {r["id"]: r["status_by"] for r in bank}
    assert all(s["source"] == by_id[s["question_id"]] for s in slots(p))
    assert {s["source"] for s in slots(p)} == {"hand", "rule"}


def test_a_question_from_outside_his_bank_never_takes_a_seat(tmp_path, monkeypatch):
    # a harvested disk-bank row has no source in this paper's vocabulary: its seat goes to a template or stays hollow
    disk = tmp_path / "disk-bank"
    real = ww_generator.ww_bank_store.load_for
    monkeypatch.setattr(ww_generator.ww_bank_store, "load_for",
                        lambda s, t=None: [{"id": f"h:signals:{i}", "question": f"Harvested {i}", "unit": 1, "topic": "aliasing",
                                            "marks": 2, "section": "A", "type": "harvested", "sitting": "x"} for i in range(5)])
    p = generate(bp=blueprint([sec("A", 5, 5, 2)], total=10), bank=[row(1, 2, "A")], exam={**EXAM, "max": 10})
    assert set(qids(p)) <= {row(1, 2, "A")["id"]} and p["invariants"] == []
    assert sum(s["source"] == "hollow" for s in slots(p)) >= 4 and p["total_marks"] == 10
    assert real is not None and disk.is_dir()


# ------------------------------------------------------------------ the generated-paper store
def test_generated_papers_are_stored_by_a_checked_id(tmp_path):
    st = Store(tmp_path / "pyq")
    p = {**generate(seed=1), "made": "2026-11-14T10:00:00"}
    gen.save_generated(st, p)
    assert gen.load_generated(st, p["id"]) == p
    assert [x["id"] for x in gen.list_generated(st)] == [p["id"]]
    assert gen.list_generated(st, exam="other") == []
    for bad in ("../g-000000000000", "g-xyz", "g-0000000000001"):
        with pytest.raises(KeyError):
            gen.load_generated(st, bad)
    gen.append_attempts(st, [{"question_id": "q-1", "paper_id": p["id"], "got": 1, "max": 2, "marked_by": "you", "date": "2026-11-14"}])
    assert gen.read_attempts(st)[0]["question_id"] == "q-1"


# ------------------------------------------------------------------ 7. the print set
def _printable(text="<script>alert(1)</script>"):
    bank = [row(i, 2, "A") for i in range(5)]
    bank[0]["question"] = text
    bp = blueprint([sec("A", 5, 5, 2), sec("B", 2, 2, 5, types=["numerical"]), sec("C", 2, 1, 3, types=["descriptive"])], total=23)
    return generate(bp=bp, bank=bank, seed=11, units=UNITS_T, exam={**EXAM, "max": 23, "title": "Signals <b>mid</b>"})


def test_print_paper_has_the_header_the_seed_and_no_key():
    p = _printable()
    html = printset.render_print(p, "paper")
    assert html.lstrip().lower().startswith("<!doctype html>")
    assert "Practice paper from your bank. Not an official paper." in html
    assert "Seed 11" in html and "@page" in html and "18mm" in html.replace(" ", "")
    assert "Answer any 1 of 2" in html and "Answer all 5" in html
    keys = [s["key"] for s in slots(p) if s.get("key")]
    assert keys and not any(k in html for k in keys)
    assert "key" not in html.lower()
    assert "needs 1 more 3-mark question" in html


def test_print_key_lists_template_keys_and_says_no_key_on_file_for_the_others():
    p = _printable()
    html = printset.render_print(p, "key")
    for s in slots(p):
        if s.get("key"):
            assert s["key"] in html
    assert "no key on file" in html


def test_print_marking_is_a_table_with_a_blank_got_column():
    html = printset.render_print(_printable(), "marking")
    assert "<table" in html and ">Got<" in html and ">Marks<" in html


@pytest.mark.parametrize("kind", ["paper", "key", "marking"])
def test_print_escapes_everything_and_loads_nothing(kind):
    html = printset.render_print(_printable(), kind)
    assert "<script" not in html.lower() and "<b>mid" not in html
    assert "Signals &lt;b&gt;mid&lt;/b&gt;" in html
    if kind == "paper":                       # the answer and marking sheets list seats by number, not their words
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert not re.search(r"(?:src|href)\s*=\s*['\"]?(?:https?:|//)", html, re.I)
    assert "http://" not in html and "https://" not in html


def test_print_unknown_kind_is_refused():
    with pytest.raises(ValueError):
        printset.render_print(_printable(), "night")


def test_print_embeds_a_crop_first_and_text_only_when_verified(tmp_path):
    st = Store(tmp_path / "pyq")
    pid = st.add_paper({"title": "Invented", "subject": "signals", "sha256": "a" * 64})
    ids = st.add_questions(pid, [{"text": "Crop and verified words.", "text_status": "verified", "marks": 2, "section": "A"},
                                 {"text": "Recognised words not yet read.", "text_status": "unverified", "marks": 2, "section": "A"}])
    for qid in ids:
        png = st.paths.crops / pid / f"{qid}.png"
        png.parent.mkdir(parents=True, exist_ok=True)
        png.write_bytes(b"\x89PNG\r\n\x1a\nfake")
        st.set_crop(qid, {"page": 1, "bbox": [0, 0, 50, 50], "png": f"crops/{pid}/{qid}.png"})
    bank = [{**row(0, 2, "A"), "id": ids[0], "question": "Crop and verified words.", "has_crop": True},
            {**row(1, 2, "A"), "id": ids[1], "question": "Recognised words not yet read.", "has_crop": True}]
    p = generate(bp=blueprint([sec("A", 2, 2, 2)], total=4), bank=bank, exam={**EXAM, "max": 4})
    html = printset.render_print(p, "paper", store=st)
    assert html.count("data:image/png;base64,") == 2
    assert "Crop and verified words." in html and "Recognised words not yet read." not in html


# ------------------------------------------------------------------ 8. the numeric check
@pytest.mark.parametrize("key,answer,match", [
    ("12.5 ms", "12.5 ms", True),
    ("12.5 ms", "12.6 ms", True),            # 1 percent of 12.5 is 0.125; half the last digit is 0.05
    ("12.5 ms", "12.7 ms", False),
    ("12.5 ms", "0.0125 s", True),           # SI prefixes
    ("12.5 ms", "1.25e-2 s", True),          # scientific notation
    ("12.5 ms", "12.5 V", False),            # units that differ
    ("0.12", "0.124", True),                 # half of the last printed digit (0.005) beats 1 percent (0.0012)
    ("0.12", "0.126", False),
    ("0.125", "1/8", True),                  # a fraction
    ("3", "3", True),
    ("3", "4", False),
    ("4.7 kΩ", "4700 ohm", True),
    ("45.3 %", "45.1 %", True),
    ("2 mA", "2000 uA", True),
    ("-3.2", "-3.21", True),
])
def test_check_numeric_matches_within_the_larger_tolerance(key, answer, match):
    r = chk.check_numeric(key, answer)
    assert r["match"] is match, r
    assert "marks" not in r and "got" not in r and set(r) >= {"match", "key", "parsed", "tolerance", "note"}


def test_a_bare_number_is_read_in_the_keys_unit_and_says_so():
    r = chk.check_numeric("12.5 ms", "12.5")
    assert r["match"] is True and "ms" in r["note"]


def test_a_key_that_is_not_a_number_answers_none_with_a_note():
    r = chk.check_numeric("Explain aliasing in words.", "3")
    assert r["match"] is None and r["note"]


@pytest.mark.parametrize("answer", ["", "abc", "twelve", "1/0", "1e999", None])
def test_an_answer_that_is_not_a_number_is_a_value_error(answer):
    with pytest.raises(ValueError):
        chk.check_numeric("12.5 ms", answer)

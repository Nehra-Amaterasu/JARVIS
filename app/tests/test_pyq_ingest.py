"""E06: PDFs and slide decks become crop-first question drafts (ww_pyq/ingest.py, segment.py, crops.py,
slides.py). Every paper is invented (pyq_fixtures/papers.py) and built into a PDF in tmp_path at test
time. Acceptance checks of plan 9.1.6, E06, are numbered (1) to (10) in the test names' comments."""
from __future__ import annotations

import hashlib
import re
import threading
import time
import tracemalloc
from pathlib import Path

import pytest

from jarvis_app.ww_pyq import api, crops, ingest, segment
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, DECK, PAPERS, build_pdf, build_pptx, long_paper

FORBIDDEN = re.compile(r"important|likely|expected|will be asked|probability|chance|predict", re.I)


@pytest.fixture()
def store(tmp_path):
    return Store(tmp_path / "pyq")


def run(spec, store, tmp_path, **kw):
    return ingest.ingest_pdf(build_pdf(spec, tmp_path / "in"), store=store, **kw)


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", text)


# ------------------------------------------------------------------ (1) the ten papers against the hand count
def test_ten_papers_question_count_and_printed_marks_against_the_hand_count(store, tmp_path, capsys):
    exact, marks_expected, marks_found, rows = 0, 0, 0, []
    for spec in PAPERS:
        res = run(spec, store, tmp_path)
        want = spec["expect"]["questions"]
        got = res["drafts"]
        exact += len(got) == len(want)
        found_here = 0
        for w, g in zip(want, got):
            if w["marks"] is not None:
                marks_expected += 1
                if g.get("marks") == w["marks"] and g.get("marks_source") in ("printed", "table"):
                    marks_found += 1
                    found_here += 1
            else:
                assert g.get("marks") is None and g.get("marks_source") == "missing", (spec["name"], g)
        rows.append(f"{spec['name']:<18} questions {len(got)}/{len(want)}  printed marks found {found_here}/{sum(w['marks'] is not None for w in want)}")
    share = marks_found / marks_expected
    with capsys.disabled():
        print("\n" + "\n".join(rows) + f"\nexact counts {exact}/10, printed marks found {marks_found}/{marks_expected} = {share:.1%}")
    assert exact >= 9
    assert share >= 0.9


def test_each_paper_reads_its_labels_total_and_types(store, tmp_path):
    for spec in PAPERS:
        res = run(spec, store, tmp_path)
        exp = spec["expect"]
        assert [d["label"] for d in res["drafts"]] == [q["label"] for q in exp["questions"]], spec["name"]
        if "total" in exp:
            assert res["paper"]["total_marks"] == exp["total"], spec["name"]
        for w, g in zip(exp["questions"], res["drafts"]):
            for k in ("type", "section", "co", "bl", "difficulty", "page"):
                if k in w:
                    assert g.get(k) == w[k], (spec["name"], w["label"], k, g.get(k))
            if "parts" in w:
                assert [p["label"] for p in g.get("parts") or []] == w["parts"], (spec["name"], w["label"])


def test_marks_never_come_from_text_length(store, tmp_path):
    q = run(BY_NAME["marks_forms"], store, tmp_path)["drafts"][-1]
    assert q["label"] == "6" and q["marks"] is None and q["marks_source"] == "missing"
    assert segment.read_marks("Explain in detail " * 40) is None
    assert segment.read_marks("") is None


@pytest.mark.parametrize("text, marks", [
    ("Define a signal. [5]", 5), ("Define a signal. (5)", 5), ("Define a signal. (5 marks)", 5),
    ("Define a signal. 5 M", 5), ("Define a signal. 5M", 5), ("Define a signal. 5 Marks", 5),
    ("Define a signal. [2.5]", 2.5), ("Define a signal [10 Marks]", 10), ("Define a signal. (3 M)", 3),
    ("Find x(5)", None), ("A beam of length 5 m", None), ("Define a signal.", None), ("Q has 500 marks", None),
    ("(5) Find the energy", None), ("Find f(t) for t = 2", None),
])
def test_read_marks_reads_only_printed_forms(text, marks):
    assert segment.read_marks(text) == marks


@pytest.mark.parametrize("text, qtype", [
    ("Find the current through a 10 ohm resistor.", "numerical"), ("Calculate the power in watts for 2 A.", "numerical"),
    ("Determine the gain in dB of the amplifier at 1 kHz.", "numerical"), ("Compute the mean of 3, 4 and 5.", "numerical"),
    ("Derive the wave equation.", "derivation"), ("Prove that the system is stable.", "derivation"),
    ("Show that the energy is conserved.", "derivation"), ("Define entropy.", "short"), ("State Ohm's law.", "short"),
    ("List three logic gates.", "short"), ("What is a filter?", "short"),
    ("Which gate is universal? (a) AND (b) OR (c) NAND (d) XOR", "mcq"),
    ("Explain the working of a relay.", "descriptive"), ("Find the meaning of feedback in words.", "descriptive"),
])
def test_guess_type_by_pattern(text, qtype):
    assert segment.guess_type(text) == qtype


def test_sections_or_pairs_parts_and_mcq(store, tmp_path):
    d = run(BY_NAME["circuits_sections"], store, tmp_path)["drafts"]
    assert [q["section"] for q in d] == ["A", "A", "A", "B", "B", "B"]
    d = run(BY_NAME["or_pairs"], store, tmp_path)["drafts"]
    groups = [q["choice_group"] for q in d]
    assert all(groups) and groups[0] == groups[1] and groups[2] == groups[3] and groups[4] == groups[5]
    assert len(set(groups)) == 3
    d = run(BY_NAME["subparts"], store, tmp_path)["drafts"]
    one = d[0]
    assert [(p["label"], p["marks"]) for p in one["parts"]] == [("a", 2), ("b", 3)]
    assert one["marks"] == 5 and one["marks_source"] == "printed"
    assert "slip of an induction motor" in one["text"] and "1440 rpm" in one["text"] and "[2]" not in one["text"]
    d = run(BY_NAME["types_mcq"], store, tmp_path)["drafts"]
    assert d[0]["type"] == "mcq" and d[0]["parts"] == [] and "(d) PWM" in d[0]["text"]


def test_a_question_that_runs_onto_the_next_page_keeps_its_first_page_box(store, tmp_path):
    res = run(BY_NAME["multipage"], store, tmp_path)
    q4 = next(d for d in res["drafts"] if d["label"] == "4")
    assert q4["page"] == 1 and q4["crop"]["page"] == 1 and q4["marks"] == 10
    assert "root locus" in q4["text"]
    assert any(e["kind"] == "segment" and "runs onto p. 2" in e["text"] for e in res["trace"])


# ------------------------------------------------------------------ (2) the table paper
def test_table_paper_is_read_as_rows_with_a_trace_line_naming_its_columns(store, tmp_path):
    res = run(BY_NAME["table_paper"], store, tmp_path)
    tables = [e for e in res["trace"] if e["kind"] == "table"]
    assert [e["text"] for e in tables] == ["p1 table 5 cols: Q, Question, Marks, CO, BL"]
    d = res["drafts"]
    assert [q["marks_source"] for q in d] == ["table"] * 5
    assert d[2]["text"] == "Find the field of an infinite line charge of 2 nC/m at 1 m."
    assert [q["difficulty_source"] for q in d] == ["bloom"] * 5
    q = store.get_question(res["question_ids"][4])
    assert (q["co"], q["bl"], q["difficulty"], q["difficulty_source"]) == ("CO3", 6, "hard", "bloom")


# ------------------------------------------------------------------ (3) every draft has a crop that holds its text
def test_every_text_layer_draft_has_a_crop_png_whose_box_holds_its_words(store, tmp_path):
    import fitz
    from PIL import Image
    checked = 0
    for spec in PAPERS:
        if spec["name"] == "slides_pdf":
            continue
        path = build_pdf(spec, tmp_path / "in")
        res = ingest.ingest_pdf(path, store=store)
        with fitz.open(str(path)) as doc:
            for qid, d in zip(res["question_ids"], res["drafts"]):
                q = store.get_question(qid)
                png = store.crop_path(qid)
                assert png is not None and png.is_file(), (spec["name"], d["label"])
                bbox = q["crop"]["bbox"]
                page = doc[q["crop"]["page"] - 1]
                inside = set(words(page.get_text("text", clip=fitz.Rect(bbox))))
                need = words(q["text"])
                if spec["name"] == "multipage" and d["label"] == "4":
                    need = need[:12]                        # the rest of its words sit on p. 2
                missing = [w for w in need if w not in inside]
                assert not missing, (spec["name"], d["label"], missing)
                with Image.open(png) as im:
                    assert abs(im.width - (bbox[2] - bbox[0]) * 150 / 72) <= 3
                    assert abs(im.height - (bbox[3] - bbox[1]) * 150 / 72) <= 3
                assert 0 <= bbox[0] < bbox[2] <= page.rect.width and 0 <= bbox[1] < bbox[3] <= page.rect.height
                checked += 1
    assert checked == sum(len(p["expect"]["questions"]) for p in PAPERS if p["name"] != "slides_pdf")


def test_every_page_is_rendered_once_and_the_original_is_kept(store, tmp_path):
    path = build_pdf(BY_NAME["scanned_page"], tmp_path / "in")
    res = ingest.ingest_pdf(path, store=store)
    pid = res["paper"]["id"]
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    assert pid == f"p-{sha[:12]}" and res["paper"]["sha256"] == sha
    assert (store.paths.originals / f"{sha}.pdf").read_bytes() == path.read_bytes()
    assert sorted(p.name for p in (store.paths.pages / pid).iterdir()) == ["p001.png", "p002.png", "p003.png"]
    from PIL import Image
    with Image.open(store.paths.pages / pid / "p001.png") as im:
        assert abs(im.width - 1240) <= 1 and abs(im.height - 1754) <= 1          # 150 dpi of an A4 page


# ------------------------------------------------------------------ (4) a page with no text layer
def test_a_page_without_a_text_layer_is_a_fault_and_the_rest_imports(store, tmp_path):
    res = run(BY_NAME["scanned_page"], store, tmp_path)
    assert res["paper"]["faults"] == ["p. 2: no text layer; OCR arrives in EW8"]
    assert [d["label"] for d in res["drafts"]] == ["1", "2", "4"]
    assert [e["page"] for e in res["trace"] if e["kind"] == "fault"] == [2]
    assert store.get_paper(res["paper"]["id"])["faults"] == res["paper"]["faults"]


def test_the_text_layer_test_of_the_specification():
    assert segment.has_text_layer("Find the current in a 10 ohm resistor for a 5 V source.")
    assert not segment.has_text_layer("Find it.")                                  # under 40 characters
    assert not segment.has_text_layer("���  " * 6 + "words here")    # glyph soup
    assert segment.has_text_layer("x(t) = 2 sin(3t) + 4 cos(5t); y = x^2 / 3 >= 0 and z <= 9")


# ------------------------------------------------------------------ (5) the same file twice
def test_the_same_file_twice_is_a_duplicate_and_adds_nothing(store, tmp_path):
    path = build_pdf(BY_NAME["signals_basic"], tmp_path / "in")
    first = ingest.ingest_pdf(path, store=store)
    n = len(store.list_questions())
    again = ingest.ingest_pdf(path, store=store)
    assert again["duplicate"] is True and again["question_ids"] == [] and again["drafts"] == []
    assert again["paper"]["id"] == first["paper"]["id"]
    assert len(store.list_papers()) == 1 and len(store.list_questions()) == n
    assert [e["kind"] for e in again["trace"]] == ["open", "skip", "done"]


# ------------------------------------------------------------------ (6) a slide deck
def test_a_pptx_deck_gives_one_verified_slide_unit_per_slide_without_crop_or_notes(store, tmp_path):
    path = build_pptx(DECK, tmp_path / "in")
    res = ingest.ingest_file(path, store=store, meta={"subject": "signals"})
    d = res["drafts"]
    assert [q["label"] for q in d] == ["Convolution", "Impulse Response", "Stability"]
    assert all(q["kind"] == "slide" and q["type"] == "slide" and q["text_status"] == "verified" and q["crop"] is None for q in d)
    assert [q["page"] for q in d] == [1, 2, 3]
    joined = " ".join(q["text"] for q in d).lower()
    assert "graphical method" not in joined and "speaker notes" not in joined and "unstable example" not in joined
    assert "flip, shift, multiply, add" in joined
    p = res["paper"]
    assert (p["kind"], p["method"], p["pages"], p["subject"]) == ("pptx", "slides", 3, "signals")
    assert (store.paths.originals / f"{p['sha256']}.pptx").is_file()
    assert all(store.crop_path(i) is None for i in res["question_ids"])


def test_a_landscape_pdf_with_no_question_start_is_a_slide_export(store, tmp_path):
    res = run(BY_NAME["slides_pdf"], store, tmp_path)
    d = res["drafts"]
    assert [q["label"] for q in d] == BY_NAME["slides_pdf"]["expect"]["slides"]
    assert all(q["kind"] == "slide" and q["type"] == "slide" and q["text_status"] == "verified" for q in d)
    assert all(q["crop"]["bbox"] == [0, 0, 842, 595] for q in d)
    assert res["paper"]["method"] == "slides"
    assert all(store.crop_path(i) is not None for i in res["question_ids"])


# ------------------------------------------------------------------ (8) the trace holds what happened
def test_the_trace_counts_match_the_fixture_and_on_event_saw_each_one(store, tmp_path):
    seen = []
    res = run(BY_NAME["multipage"], store, tmp_path, on_event=seen.append)
    kinds = [e["kind"] for e in res["trace"]]
    assert seen == res["trace"]
    assert kinds[0] == "open" and kinds[-1] == "done"
    assert kinds.count("open") == 1 and kinds.count("done") == 1
    assert kinds.count("page") == 3 and kinds.count("crop") == 8 and kinds.count("table") == 0 and kinds.count("fault") == 0
    assert [e["page"] for e in res["trace"] if e["kind"] == "page"] == [1, 2, 3]
    ts = [e["t"] for e in res["trace"]]
    assert ts == sorted(ts) and ts[0] >= 0
    crop_q = [e["text"].split()[1] for e in res["trace"] if e["kind"] == "crop"]
    assert crop_q == res["question_ids"]
    res = run(BY_NAME["scanned_page"], store, tmp_path)
    kinds = [e["kind"] for e in res["trace"]]
    assert kinds.count("fault") == 1 and kinds.count("page") == 2 and kinds.count("crop") == 3
    res = run(BY_NAME["table_paper"], store, tmp_path)
    assert [e["kind"] for e in res["trace"]].count("table") == 1


def test_no_output_string_uses_a_forbidden_word(store, tmp_path):
    for spec in PAPERS:
        res = run(spec, store, tmp_path)
        texts = [e["text"] for e in res["trace"]] + list(res["paper"]["faults"])
        for t in texts:
            assert not FORBIDDEN.search(t), (spec["name"], t)


# ------------------------------------------------------------------ (9) time and memory for 20 pages
def test_twenty_pages_time_per_page_and_peak_memory(store, tmp_path, capsys):
    spec = long_paper(20)
    path = build_pdf(spec, tmp_path / "in")
    tracemalloc.start()
    t0 = time.perf_counter()
    res = ingest.ingest_pdf(path, store=store)
    took = time.perf_counter() - t0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert len(res["drafts"]) == 100 and all(d["marks"] == 5 for d in res["drafts"])
    with capsys.disabled():
        print(f"\n20-page fixture: {took:.2f} s, {took / 20 * 1000:.0f} ms per page, peak traced memory {peak / 1e6:.1f} MB, "
              f"{len(res['drafts'])} questions")
    assert took / 20 < 2.0                                   # far above what this laptop measures; a guard against a hang
    assert peak < 300e6


# ------------------------------------------------------------------ (10) read_pdf_text against the library reader
def test_read_pdf_text_has_the_same_words_as_the_library_extract(tmp_path):
    from jarvis_app.paths import ensure_jarvis_importable
    ensure_jarvis_importable()
    import library
    path = build_pdf(BY_NAME["multipage"], tmp_path / "in")
    ours = words(ingest.read_pdf_text(path.read_bytes()))
    theirs = words(" ".join(s.text for s in library.extract(path).sections))
    assert ours == theirs and len(ours) > 100
    p2 = words(ingest.read_pdf_text(path.read_bytes(), 2, 2))
    assert p2 == words(next(s.text for s in library.extract(path).sections if s.page == 2))
    assert ingest.read_pdf_text(path.read_bytes(), 3) == ingest.read_pdf_text(path.read_bytes(), 3, 3)


# ------------------------------------------------------------------ segment_page on a page dict
def _page(lines, width=595, height=842):
    """A page in the shape of PyMuPDF get_text("dict"): (x, y, text) per line, 11 pt."""
    blocks = [{"type": 0, "lines": [{"bbox": [x, y, x + 6 * len(t), y + 14], "spans": [{"text": t, "size": 11}]}]}
              for x, y, t in lines]
    return {"width": width, "height": height, "blocks": blocks}


def test_a_numbered_list_indented_inside_a_question_is_not_a_new_question():
    page = _page([(72, 100, "1. Find the current in the network below, given that:"),
                  (100, 116, "1) the source is 5 V,"), (100, 132, "2) the load is 10 ohm. [5]"),
                  (72, 160, "2. Define a node. [2]"), (72, 176, "3. Define a branch. [2]"),
                  (290, 820, "3")])                                        # a page number in the bottom band
    qs = [b for b in segment.segment_page(page, page_no=1) if b["kind"] == "question"]
    assert [q["label"] for q in qs] == ["1", "2", "3"]
    assert qs[0]["marks"] == 5 and "1) the source is 5 V" in qs[0]["text"] and "the load is 10 ohm." in qs[0]["text"]
    assert qs[0]["bbox"][0] == 66 and qs[0]["bbox"][1] == 94                # the rows plus 6 pt
    assert all("3" != q["text"] for q in qs) and qs[2]["text"] == "Define a branch."


def test_rows_on_one_baseline_join_and_a_lone_right_number_is_marks():
    page = _page([(72, 100, "4. Determine the gain of the stage"), (530, 101, "7"),
                  (72, 116, "5. Explain feedback in words."), (300, 116, "at length")])
    qs = [b for b in segment.segment_page(page, page_no=2) if b["kind"] == "question"]
    assert [(q["label"], q["marks"], q["text"]) for q in qs] == [
        ("4", 7, "Determine the gain of the stage"), ("5", None, "Explain feedback in words. at length")]
    assert qs[0]["page"] == 2


# ------------------------------------------------------------------ crops.py
def test_render_page_and_render_crop(tmp_path):
    import fitz
    from PIL import Image
    path = build_pdf(BY_NAME["signals_basic"], tmp_path / "in")
    with fitz.open(str(path)) as doc:
        png = crops.render_page(doc, 1, tmp_path / "out" / "p001.png")
    with Image.open(png) as im:
        assert abs(im.width - 595 * 150 / 72) <= 1 and abs(im.height - 842 * 150 / 72) <= 1
    out = crops.render_crop(png, [72, 100, 372, 200], (595, 842), tmp_path / "out" / "c.png")
    with Image.open(out) as im:
        assert abs(im.width - 625) <= 1 and abs(im.height - 208) <= 1
    out = crops.render_crop(png, [-50, -50, 9999, 9999], (595, 842), tmp_path / "out" / "c2.png")   # clipped to the page
    with Image.open(out) as im:
        assert abs(im.width - 1240) <= 1
    assert not list((tmp_path / "out").glob("*.tmp*"))


# ------------------------------------------------------------------ refusals of the reader
def test_a_broken_file_is_refused_and_leaves_nothing(store, tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.7 this is not a pdf at all")
    with pytest.raises(ValueError):
        ingest.ingest_pdf(bad, store=store)
    assert store.list_papers() == [] and not list(store.paths.originals.iterdir())
    with pytest.raises(ValueError):
        ingest.ingest_file(tmp_path / "notes.txt", store=store)


def test_meta_is_checked_and_applied(store, tmp_path):
    path = build_pdf(BY_NAME["signals_basic"], tmp_path / "in")
    with pytest.raises(ValueError):
        ingest.ingest_pdf(path, store=store, meta={"subject": "Bad Slug"})
    with pytest.raises(ValueError):
        ingest.ingest_pdf(path, store=store, meta={"exam_kind": "party"})
    assert store.list_papers() == []
    res = ingest.ingest_pdf(path, store=store, meta={"subject": "signals", "year": 2024, "exam_kind": "cie"})
    p = res["paper"]
    assert (p["subject"], p["year"], p["exam_kind"], p["filename"], p["kind"], p["method"], p["pages"]) == \
        ("signals", 2024, "cie", "signals_basic.pdf", "pdf", "text-layer", 1)
    assert p["source_note"] == "manual drop-in" and p["title"] == "signals_basic"


# ------------------------------------------------------------------ IngestJob
def test_ingest_job_one_at_a_time_one_bad_file_does_not_stop_the_rest(store, tmp_path, monkeypatch):
    events = []

    class Bus:
        def publish(self, *a, **k):
            events.append(a)

    good = build_pdf(BY_NAME["signals_basic"], tmp_path / "in")
    bad = tmp_path / "in" / "broken.pdf"
    bad.write_bytes(b"%PDF-1.4 broken")
    other = build_pdf(BY_NAME["or_pairs"], tmp_path / "in")
    job = ingest.IngestJob(Bus())
    gate = threading.Event()
    real = ingest.ingest_file

    def slow(path, **kw):
        gate.wait(5)
        return real(path, **kw)

    monkeypatch.setattr(ingest, "ingest_file", slow)
    info = job.start([good, bad, other], store=store)
    assert info["status"] == "running" and info["total"] == 3 and info["done"] == 0 and info["id"].startswith("j-")
    with pytest.raises(api.Busy):
        job.start([good], store=store)
    gate.set()
    info = job.wait(30)
    assert info["status"] == "done" and info["done"] == 3
    assert [f["status"] for f in info["files"]] == ["added", "failed", "added"]
    assert info["files"][1]["note"] and info["files"][0]["questions"] == 6 and info["files"][0]["method"] == "text-layer"
    assert info["files"][0]["pages"] == 1 and info["files"][0]["paper_id"].startswith("p-")
    assert info["took_s"] >= 0 and info["trace"] and info["trace"][0]["kind"] == "open"
    assert events and events[-1][0] == "mission"
    assert job.get("last")["id"] == info["id"] and job.get(info["id"])["id"] == info["id"]
    with pytest.raises(KeyError):
        job.get("j-nosuchjob")
    again = job.start([good], store=store)
    assert job.wait(30)["files"][0]["status"] == "duplicate" and again["id"] != info["id"]

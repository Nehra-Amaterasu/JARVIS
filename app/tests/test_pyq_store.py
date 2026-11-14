"""The private review-staging store (ww_pyq/store.py, ww_pyq/folder.py): acceptance checks 1 to 4,
6 and 7 of plan 9.1.6 and the ten stale-entry cases T1 to T10. Every paper is invented ("signals",
"circuits") and every folder is a scratch one under tmp_path; nothing touches the real data."""
import hashlib
import json
import threading
from pathlib import Path

import pytest

from jarvis_app import paths, ww_generator
from jarvis_app.ww_pyq import folder
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store


@pytest.fixture()
def st(tmp_path):
    return Store(tmp_path / "pyq")


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def paper(text="a", subject="signals", **kw):
    return {"sha256": sha(text), "filename": f"{text}.pdf", "kind": "pdf", "method": "text-layer",
            "subject": subject, "title": f"Signals {text}", "year": 2025, "pages": 2, **kw}


def draft(text="Define a signal.", marks=5, **kw):
    return {"label": "1", "text": text, "marks": marks, "section": "A", **kw}


def qrows(st, pid):
    return json.loads((st.root / "questions" / f"{pid}.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ 1. idempotent by sha256
def test_the_same_file_added_twice_is_one_paper(st):
    a = st.add_paper(paper("x"))
    b = st.add_paper(paper("x", title="renamed"))
    assert a == b == "p-" + sha("x")[:12]
    assert len(st.list_papers()) == 1
    assert st.find_by_sha(sha("x")) == a and st.find_by_sha(sha("zzz")) is None


def test_a_typed_paper_gets_a_hand_id_and_never_collides(st):
    ids = {st.add_paper({"kind": "hand", "title": f"t{i}"}) for i in range(5)}
    assert len(ids) == 5 and all(i.startswith("p-hand-") and len(i) == 15 for i in ids)


def test_update_and_delete_a_paper(st):
    pid = st.add_paper(paper("u"))
    st.add_questions(pid, [draft()])
    assert st.update_paper(pid, {"title": "New", "year": 2024})["title"] == "New"
    with pytest.raises(ValueError):
        st.update_paper(pid, {"subject": "Bad Subject!"})
    with pytest.raises(ValueError):
        st.update_paper(pid, {"sha256": "x"})
    st.delete_paper(pid)
    assert st.list_papers() == [] and st.list_questions() == []
    assert not (st.root / "questions" / f"{pid}.json").exists()
    with pytest.raises(KeyError):
        st.get_paper(pid)
    assert st.add_paper(paper("u")) == pid               # a deleted file can be read again


# ------------------------------------------------------------------ stale entries T1 to T10
def test_T1_a_questions_file_without_its_paper_row_is_not_listed(st):
    pid = st.add_paper(paper("a"))
    st.add_questions(pid, [draft()])
    (st.root / "questions" / "p-ghost.json").write_text(json.dumps([{"id": "q-aaa111", "text": "orphan", "marks": 3}]), encoding="utf-8")
    assert [q["text"] for q in st.list_questions()] == ["Define a signal."]
    assert st.coverage("signals")["questions"] == 1


def test_T2_a_paper_row_without_its_questions_file_has_no_questions(st):
    pid = st.add_paper(paper("a"))
    assert st.list_questions(paper_id=pid) == []
    assert st.coverage("signals")["papers"] == 1 and st.coverage("signals")["questions"] == 0


def test_T3_a_crop_path_that_is_gone_is_none_not_an_error(st):
    pid = st.add_paper(paper("a"))
    [qid] = st.add_questions(pid, [draft()])
    assert st.crop_path(qid) is None                                      # no crop at all
    png = st.paths.crops / pid / f"{qid}.png"
    png.parent.mkdir(parents=True)
    png.write_bytes(b"\x89PNG")
    rel = f"crops/{pid}/{qid}.png"
    q = st.set_crop(qid, {"page": 1, "bbox": [0, 0, 100, 50], "png": rel, "dpi": 150})
    assert q["crop"]["png"] == rel and st.crop_path(qid) == png.resolve()
    png.unlink()
    assert st.crop_path(qid) is None


def test_a_crop_cannot_point_outside_the_crops_folder(st):
    pid = st.add_paper(paper("a"))
    [qid] = st.add_questions(pid, [draft()])
    for bad in ("../secret.png", "/etc/x.png", "C:/x.png", "crops/../../x.png"):
        with pytest.raises(ValueError):
            st.set_crop(qid, {"page": 1, "png": bad})
    outside = st.root / "papers.json"
    outside.write_text("{}", encoding="utf-8")
    rows = qrows(st, pid)                                                 # a hand-edited file naming a path outside crops/
    rows[0]["crop"] = {"page": 1, "png": "papers.json"}
    (st.root / "questions" / f"{pid}.json").write_text(json.dumps(rows), encoding="utf-8")
    assert st.crop_path(qid) is None


def test_T4_a_truncated_json_file_is_set_aside_and_read_as_empty(st):
    pid = st.add_paper(paper("a"))
    st.add_questions(pid, [draft()])
    f = st.root / "questions" / f"{pid}.json"
    f.write_text(f.read_text(encoding="utf-8")[:20], encoding="utf-8")
    assert st.list_questions() == []
    assert (st.root / "questions" / f"{pid}.json.corrupt").exists() and not f.exists()
    assert st.problems and "could not be parsed" in st.problems[-1]
    st.add_questions(pid, [draft("again")])                              # carries on with a fresh file
    assert [q["text"] for q in st.list_questions()] == ["again"]
    (st.root / "papers.json").write_text('{"p-x', encoding="utf-8")
    assert st.list_papers() == [] and (st.root / "papers.json.corrupt").exists()


def test_T5_an_unknown_status_reads_as_pending_never_accepted(st):
    pid = st.add_paper(paper("a"))
    [qid] = st.add_questions(pid, [draft()])
    rows = qrows(st, pid)
    rows[0]["status"] = "approved-by-magic"
    (st.root / "questions" / f"{pid}.json").write_text(json.dumps(rows), encoding="utf-8")
    assert st.get_question(qid)["status"] == "pending"
    assert st.bank_for("signals") == []


def test_T6_a_schema_zero_record_reads_with_the_defaults_and_keeps_unknown_keys(st):
    pid = st.add_paper(paper("a"))
    (st.root / "questions" / f"{pid}.json").write_text(json.dumps([{"id": "q-old000000001", "text": "Old one", "future": {"k": 1}}]), encoding="utf-8")
    q = st.get_question("q-old000000001")
    assert q["status"] == "pending" and q["marks"] is None and q["marks_source"] == "missing"
    assert q["type"] == "unknown" and q["tag_source"] == "none" and q["edited"] is False and q["crop"] is None
    assert q["paper_id"] == pid and q["future"] == {"k": 1}
    st.update_question("q-old000000001", {"marks": 4})
    assert qrows(st, pid)[0]["future"] == {"k": 1}                       # kept through a write
    (st.root / "papers.json").write_text(json.dumps({pid: {"sha256": sha("a")}}), encoding="utf-8")
    p = st.get_paper(pid)
    assert p["title"] == "" and p["faults"] == [] and p["subject"] == "" and p["id"] == pid


def test_T7_a_duplicate_question_id_in_a_file_keeps_the_first(st):
    pid = st.add_paper(paper("a"))
    row = {"id": "q-dup000000001", "text": "first", "marks": 2}
    (st.root / "questions" / f"{pid}.json").write_text(json.dumps([row, {**row, "text": "second"}]), encoding="utf-8")
    assert [q["text"] for q in st.list_questions()] == ["first"]
    ids = st.add_questions(pid, [draft("new")])                          # a fresh id never reuses it
    assert ids[0] != "q-dup000000001"


def test_T8_a_watched_folder_that_vanished_is_a_fault_not_a_crash(st, tmp_path):
    d = tmp_path / "papers"
    d.mkdir()
    folder.set_folder(st, str(d))
    d.rmdir()
    s = folder.scan(st)
    assert s["path"] and s["exists"] is False and s["pending_files"] == [] and s["files_seen"] == 0
    assert folder.pending_paths(st) == []


@pytest.mark.parametrize("bad", ["../x", "a/b", "a\\b", "q-", "Q-abc", "", "q-" + "a" * 41, "q-a/../../etc", "q-a\x00b", None, 7])
def test_T9_an_id_with_a_path_separator_is_an_unknown_record(st, bad):
    for call in (st.get_question, st.get_paper, st.crop_path, lambda i: st.update_question(i, {"text": "x"}),
                 st.delete_paper, lambda i: st.add_questions(i, [draft()])):
        with pytest.raises(KeyError):
            call(bad)
    if bad is not None:                                                   # None means "every paper"
        with pytest.raises(KeyError):
            st.list_questions(paper_id=bad)
    assert not (st.root.parent / "etc").exists()


def test_T10_twenty_writer_threads_lose_nothing(st):
    pid = st.add_paper(paper("a"))
    errs = []

    def writer(n):
        try:
            st.add_questions(pid, [draft(f"q{n}-{k}") for k in range(5)])
            st.add_paper(paper(f"t{n}", title=f"T{n}"))
        except Exception as e:                                           # pragma: no cover
            errs.append(e)

    ts = [threading.Thread(target=writer, args=(n,)) for n in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs
    qs = st.list_questions(paper_id=pid)
    assert len(qs) == 100 and len({q["id"] for q in qs}) == 100
    assert len(st.list_papers()) == 21
    assert not list(st.root.rglob("*.tmp")) and not list(st.root.rglob("*.corrupt"))


# ------------------------------------------------------------------ 3. marks first
def test_accepting_a_question_without_marks_is_refused_and_changes_nothing(st):
    pid = st.add_paper(paper("a"))
    ids = st.add_questions(pid, [draft("no marks", marks=None), draft("has marks", marks=5)])
    before = qrows(st, pid)
    with pytest.raises(ValueError, match="Give its marks first."):
        st.update_question(ids[0], {"status": "accepted"})
    with pytest.raises(ValueError, match="Give its marks first."):
        st.set_status(ids[0], "accepted", "hand")
    with pytest.raises(ValueError, match="Give its marks first."):
        st.update_questions(ids, {"status": "accepted"})                  # one bad question stops the whole batch
    assert qrows(st, pid) == before
    q = st.update_question(ids[0], {"marks": 3, "status": "accepted"})    # marks and status in one change is fine
    assert q["status"] == "accepted" and q["marks"] == 3 and q["marks_source"] == "hand"


def test_hand_rules_edited_marks_source_tag_source_and_status_by(st):
    pid = st.add_paper(paper("a"))
    [qid] = st.add_questions(pid, [draft(marks=None, marks_source="missing")])
    q = st.update_question(qid, {"text": "Better words.", "marks": 6, "unit": 2, "topic": "convolution", "status": "accepted"})
    assert q["edited"] is True and q["marks_source"] == "hand" and q["tag_source"] == "hand"
    assert q["status_by"] == "hand" and q["text_status"] == "verified" and q["unit"] == 2
    r = st.update_question(qid, {"status": "rejected"}, by="rule")
    assert r["status_by"] == "rule" and r["tag_source"] == "hand"        # a rule's status does not rewrite a tag
    with pytest.raises(ValueError):
        st.update_question(qid, {"marks": -1})
    with pytest.raises(ValueError):
        st.update_question(qid, {"marks": True})
    with pytest.raises(ValueError):
        st.update_question(qid, {"text": "x" * 2001})
    with pytest.raises(ValueError):
        st.update_question(qid, {"status": "maybe"})
    with pytest.raises(ValueError):
        st.update_question(qid, {"type": "essay"})
    with pytest.raises(ValueError):
        st.update_question(qid, {"paper_id": "p-other"})
    assert st.get_question(qid)["status"] == "rejected"


def test_a_batch_with_one_unknown_id_changes_nothing(st):
    pid = st.add_paper(paper("a"))
    ids = st.add_questions(pid, [draft(), draft("two")])
    before = qrows(st, pid)
    with pytest.raises(KeyError):
        st.update_questions([ids[0], "q-nosuchone01"], {"status": "rejected"})
    assert qrows(st, pid) == before
    out = st.update_questions(ids, {"status": "rejected"})
    assert [q["status"] for q in out] == ["rejected", "rejected"]


def test_list_filters_and_coverage_counts(st):
    a = st.add_paper(paper("a"))
    b = st.add_paper(paper("b", subject="circuits"))
    ia = st.add_questions(a, [draft("1"), draft("2"), draft("3", marks=None)])
    st.add_questions(b, [draft("c1")])
    st.update_question(ia[0], {"status": "accepted", "unit": 1, "topic": "t"})
    st.update_question(ia[1], {"status": "rejected"})
    assert len(st.list_questions()) == 4
    assert [q["text"] for q in st.list_questions(subject="circuits")] == ["c1"]
    assert [q["id"] for q in st.list_questions(paper_id=a, status="accepted")] == [ia[0]]
    with pytest.raises(ValueError):
        st.list_questions(status="bogus")
    cov = st.coverage("signals")
    assert (cov["papers"], cov["questions"], cov["pending"], cov["accepted"], cov["rejected"]) == (1, 3, 1, 1, 1)
    assert cov["tagged"] == 1 and cov["marks_missing"] == 1 and cov["floor_met"] is False
    assert cov["floor_papers"] == 3 and cov["floor_questions"] == 20
    for i in range(2):
        pid = st.add_paper(paper(f"more{i}"))
        ids = st.add_questions(pid, [draft(f"m{i}-{k}") for k in range(10)])
        st.update_questions(ids, {"status": "accepted"})
    assert st.coverage("signals")["floor_met"] is True                    # 3 papers, 21 accepted
    with pytest.raises(ValueError):
        st.coverage("Not A Slug")


# ------------------------------------------------------------------ 4. the bank
UNITS = [{"n": u, "title": f"U{u}", "exam_weight": "high", "topics": [f"t{u}"]} for u in (1, 2)]


def test_bank_for_gives_only_accepted_questions_with_text_and_marks_and_the_generator_takes_them(st):
    pid = st.add_paper(paper("a"))
    other = st.add_paper(paper("b", subject="circuits"))
    ids = st.add_questions(pid, [draft(f"Question {i} about t{1 + i % 2}", marks=7, section="B") for i in range(12)]
                           + [draft("pending one"), draft("", marks=5), draft("rejected one")])
    st.add_questions(other, [draft("other subject")])
    for i, qid in enumerate(ids[:12]):
        st.update_question(qid, {"status": "accepted", "unit": 1 + i % 2, "topic": f"t{1 + i % 2}"})
    st.update_question(ids[13], {"status": "accepted"})                  # accepted but no text: crop only
    st.update_question(ids[14], {"status": "rejected"})
    for q in st.list_questions(paper_id=other):
        st.update_question(q["id"], {"status": "accepted"})
    bank = st.bank_for("signals")
    assert [r["id"] for r in bank] == ids[:12]
    r = bank[0]
    assert set(r) == {"id", "question", "unit", "topic", "marks", "section", "tier", "type", "sitting", "origin"}
    assert (r["tier"], r["origin"], r["marks"], r["section"]) == ("exam", "own-paper", 7, "B")
    assert st.bank_for("nothing") == []
    exam = {"id": "x", "subject": "signals", "title": "X", "units": [], "max": 14,
            "pattern": [{"name": "B", "questions": 4, "attempt": 2, "marks": 7}]}
    out = ww_generator.generate(exam, bank, UNITS, {}, {}, seed=3)
    picked = [q["id"] for sec in out["sections"] for q in sec.get("questions", sec.get("slots", []))]
    assert out and picked and set(picked) <= set(ids[:12])


# ------------------------------------------------------------------ 6. the folder
def make_pdf(d: Path, name: str, body: str) -> Path:
    p = d / name
    p.write_bytes(b"%PDF-1.4 " + body.encode())
    return p


def test_set_folder_refuses_relative_missing_file_and_drive_root(st, tmp_path):
    f = tmp_path / "file.pdf"
    f.write_bytes(b"x")
    for bad in ("papers", "./papers", "", "   ", str(tmp_path / "nope"), str(f), tmp_path.anchor, 5):
        with pytest.raises(ValueError):
            folder.set_folder(st, bad)
    assert folder.get_folder(st)["path"] is None


def test_scan_lists_only_unread_pdf_and_pptx_directly_in_the_folder(st, tmp_path):
    d = tmp_path / "papers"
    (d / "sub").mkdir(parents=True)
    one = make_pdf(d, "one.pdf", "one")
    make_pdf(d, "two.PDF", "two")
    (d / "deck.pptx").write_bytes(b"PK deck")
    (d / "notes.txt").write_text("not a paper")
    make_pdf(d / "sub", "deep.pdf", "deep")
    s = folder.set_folder(st, str(d))
    assert s["exists"] and s["files_seen"] == 3
    assert s["pending_files"] == ["deck.pptx", "one.pdf", "two.PDF"]
    assert [p.name for p in folder.pending_paths(st)] == s["pending_files"]
    assert all(p.parent == d.resolve() for p in folder.pending_paths(st))
    st.add_paper({"sha256": hashlib.sha256(one.read_bytes()).hexdigest(), "title": "one", "kind": "pdf"})
    s = folder.scan(st)
    assert s["pending_files"] == ["deck.pptx", "two.PDF"] and s["files_seen"] == 3     # compared by hash, not by name
    one.rename(d / "renamed.pdf")
    assert "renamed.pdf" not in folder.scan(st)["pending_files"]
    assert folder.get_folder(st)["last_scan"]
    assert folder.set_folder(st, None)["path"] is None and folder.pending_paths(st) == []


def test_scan_never_follows_a_link_out_of_the_folder(st, tmp_path):
    d, outside = tmp_path / "papers", tmp_path / "outside"
    d.mkdir()
    outside.mkdir()
    secret = make_pdf(outside, "secret.pdf", "secret")
    try:
        (d / "link.pdf").symlink_to(secret)
        (d / "linkdir").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks need a privilege on this machine")
    make_pdf(d, "real.pdf", "real")
    s = folder.set_folder(st, str(d))
    assert s["pending_files"] == ["real.pdf"]


def test_an_unchanged_file_is_not_hashed_twice(st, tmp_path, monkeypatch):
    d = tmp_path / "papers"
    d.mkdir()
    make_pdf(d, "a.pdf", "a")
    folder.set_folder(st, str(d))
    calls = []
    real = folder._sha
    monkeypatch.setattr(folder, "_sha", lambda p: calls.append(p) or real(p))
    folder.scan(st)
    folder.scan(st)
    assert calls == []
    make_pdf(d, "a.pdf", "a changed")
    folder.scan(st)
    assert len(calls) == 1


# ------------------------------------------------------------------ 7. nothing outside the scratch directory
def test_the_store_writes_only_under_its_root(tmp_path):
    root = tmp_path / "scratch" / "pyq"
    before = {p for p in tmp_path.rglob("*")}
    s = Store(root)
    pid = s.add_paper(paper("a"))
    s.add_questions(pid, [draft()])
    s.update_paper(pid, {"title": "t"})
    d = tmp_path / "watched"
    d.mkdir()
    folder.set_folder(s, str(d))
    new = {p for p in tmp_path.rglob("*")} - before
    assert all(root in p.parents or p == root or p in (root.parent, d) or d in p.parents for p in new)
    assert {p.name for p in root.iterdir()} >= {"papers.json", "questions", "originals", "pages", "crops", "inbox",
                                                 "blueprints", "generated", "folder.json"}


def test_default_store_is_one_per_process_under_the_data_directory():
    a = store_mod.default_store()
    assert a is store_mod.default_store()
    assert a.root == Path(paths.DATA) / "pyq"
    assert a.paths.inbox == a.root / "inbox" and a.paths.generated.is_dir()


# ------------------------------------------------------------------ review fixes
@pytest.mark.parametrize("bad", ["../../../evil/file", "ABCDEF" * 11, "abc", "a/b" + "0" * 61])
def test_a_file_hash_that_is_not_64_lowercase_hex_is_refused(st, bad):
    with pytest.raises(ValueError):
        st.add_paper({"sha256": bad, "title": "x", "kind": "pdf"})
    assert st.list_papers() == []


def test_a_draft_arrives_pending_even_if_it_says_accepted(st):
    pid = st.add_paper(paper("d"))
    qid = st.add_questions(pid, [draft(status="accepted", status_by="rule")])[0]
    assert st.get_question(qid)["status"] == "pending"
    assert st.bank_for("signals") == []

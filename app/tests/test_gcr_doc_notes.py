"""An old .doc from Classroom gets a note: the local Word prints it, the PDF is read (ww_gcr/sync._make_note).

Word is never started here: the printer is a fake that hands back an invented PDF.
"""
from pathlib import Path

import pytest

from jarvis_app.ww_gcr import sync
from pyq_fixtures import BY_NAME, build_pdf


class Store:
    def __init__(self, root):
        self.root = Path(root)


def rec_for(tmp_path, ext="doc"):
    (tmp_path / "originals" / "c").mkdir(parents=True)
    (tmp_path / "originals" / "c" / f"f1.{ext}").write_bytes(b"old word bytes")
    return {"id": "f1", "ext": ext, "path": f"originals/c/f1.{ext}", "course_slug": "c", "title": "Unit 2 notes",
            "course_name": "Signals", "post": {"title": "Week 3"}, "fetched_at": "2026-11-22T10:00:00", "modified": "2026-10-01T00:00:00Z"}


def real_extract(path):
    from jarvis_app.paths import ensure_jarvis_importable
    ensure_jarvis_importable()
    import library
    return library.extract(path)


def test_a_doc_file_gets_a_note_from_its_printed_pdf_and_the_temporary_pdf_is_removed(tmp_path):
    rec = rec_for(tmp_path)
    made = []

    def printer(path):
        assert path.name == "f1.doc"
        out = build_pdf(BY_NAME["circuits_sections"], tmp_path / "made")
        made.append(out)
        return out

    sync._make_note(Store(tmp_path), rec, real_extract, word_pdf=printer)
    assert rec["note_state"] == "live" and rec["note"] == "notes/c/f1.md" and rec["words"] > 40 and rec["pages"] == 1
    text = (tmp_path / rec["note"]).read_text(encoding="utf-8")
    assert "# Unit 2 notes" in text and "Kirchhoff" in text and "original: originals/c/f1.doc" in text
    assert not made[0].exists()
    assert rec["note_tried"] == "2026-10-01T00:00:00Z"


def test_a_doc_word_cannot_print_waits_with_the_sentence_and_is_tried_once_per_version(tmp_path):
    rec = rec_for(tmp_path)

    def printer(path):
        raise ValueError("Word is not installed on this PC, so a Word file cannot be read. Save it as PDF and drop that.")

    sync._make_note(Store(tmp_path), rec, real_extract, word_pdf=printer)
    assert rec["note"] == "" and rec["note_state"] == "waiting" and rec["note_reason"].startswith("Word is not installed")
    assert rec["note_tried"] == rec["modified"]


def test_an_old_powerpoint_still_has_no_note_and_says_so(tmp_path):
    rec = rec_for(tmp_path, "ppt")
    sync._make_note(Store(tmp_path), rec, real_extract, word_pdf=lambda p: pytest.fail("Word is not for .ppt"))
    assert rec["note_state"] == "waiting" and "old PowerPoint" in rec["note_reason"]

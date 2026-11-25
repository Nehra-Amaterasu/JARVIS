"""Word papers into the paper desk (ww_pyq/word.py, ingest_word): the local Word prints the file, the PDF is read.

No test here starts Word: a fake converter or a fake runner stands in, so the suite runs on a PC without it. The one
real conversion is opt-in (WW_WORD_TEST=1), because it starts a program and takes up to half a minute.
"""
import io
import os
import zipfile

import pytest

from jarvis_app.ww_pyq import ingest, word
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, build_pdf


def docx_bytes(extra=None, declared=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return buf.getvalue()


def fixture_pdf(tmp_path, name="circuits_sections"):
    return build_pdf(BY_NAME[name], tmp_path / "made").read_bytes()


def test_a_word_paper_is_read_through_its_printed_pdf_and_keeps_the_word_original(tmp_path):
    st = Store(tmp_path / "pyq")
    src = tmp_path / "Internal test 1.docx"
    src.write_bytes(docx_bytes())
    pdf = fixture_pdf(tmp_path)
    seen = []
    r = ingest.ingest_word(src, store=st, convert=lambda data, suffix: seen.append((len(data), suffix)) or pdf)
    assert seen == [(src.stat().st_size, ".docx")]
    assert len(r["drafts"]) == 6 and all(d["crop"] and d["marks"] for d in r["drafts"])
    p = r["paper"]
    assert p["filename"] == "Internal test 1.docx" and p["kind"] == "pdf" and p["pages"] == 1
    assert (st.paths.originals / f"{p['sha256']}.docx").read_bytes() == src.read_bytes()      # the Word file is the original kept
    assert any("printed by Word to 1 page" in e["text"] for e in r["trace"])
    again = ingest.ingest_file(src, store=st)                                                  # found by the Word file's hash: Word is not started
    assert again["duplicate"] is True and again["paper"]["id"] == p["id"]


def test_a_word_file_that_cannot_be_printed_adds_nothing_and_says_why(tmp_path):
    st = Store(tmp_path / "pyq")
    src = tmp_path / "paper.doc"
    src.write_bytes(word.MAGIC[".doc"] + b"\0" * 600)

    def fails(data, suffix):
        raise ValueError("Word could not print this file to PDF. Open it in Word, save it as PDF and drop that.")

    with pytest.raises(ValueError, match="save it as PDF"):
        ingest.ingest_word(src, store=st, convert=fails)
    assert st.list_papers() == [] and not list(st.paths.originals.glob("*"))


def test_ingest_file_sends_both_word_suffixes_to_the_word_door(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    pdf = fixture_pdf(tmp_path)
    monkeypatch.setattr(word, "to_pdf", lambda data, suffix, **k: pdf)
    a = tmp_path / "a.DOCX"
    a.write_bytes(docx_bytes())
    assert len(ingest.ingest_file(a, store=st)["drafts"]) == 6
    assert ".docx" in ingest.SUFFIXES and ".doc" in ingest.SUFFIXES
    with pytest.raises(ValueError, match=r"\.docx and \.doc files"):
        ingest.ingest_file(tmp_path / "x.odt", store=st)


@pytest.mark.parametrize("data, suffix, sentence", [
    (b"%PDF-1.7 not word", ".docx", "does not open as a Word file"),
    (b"PK\x03\x04 broken zip", ".docx", "does not open as a Word file"),
    (b"plain text", ".doc", "does not open as a Word file"),
    (b"anything", ".rtf", "not a Word file"),
])
def test_what_is_not_a_word_file_never_reaches_word(data, suffix, sentence):
    calls = []
    with pytest.raises(ValueError, match=sentence):
        word.to_pdf(data, suffix, runner=lambda cmd, t: calls.append(cmd) or (0, "ok"))
    assert calls == []


def test_a_zip_that_is_not_a_document_or_expands_enormously_is_refused():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "no document part")
    with pytest.raises(ValueError, match="does not open as a Word file"):
        word.check(buf.getvalue(), ".docx")
    bomb = docx_bytes({"word/media/big.bin": b"\0" * (word.MAX_UNZIPPED // 50)})
    assert len(bomb) < 2_000_000                                # it is small on disk
    orig = word.MAX_UNZIPPED
    try:
        word.MAX_UNZIPPED = orig // 100
        with pytest.raises(ValueError, match="expands to far more"):
            word.check(bomb, ".docx")
    finally:
        word.MAX_UNZIPPED = orig


def test_the_runner_gets_a_private_copy_and_fixed_arguments_and_the_folder_is_removed():
    data = docx_bytes()
    got = {}

    def runner(cmd, timeout):
        got["cmd"], got["timeout"] = cmd, timeout
        src, dst = cmd[cmd.index("-Source") + 1], cmd[cmd.index("-Target") + 1]
        got["src"], got["same"] = src, open(src, "rb").read() == data
        open(dst, "wb").write(b"%PDF-1.7\n" + b"x" * 200)
        return 0, "pid 4242\nok"

    out = word.to_pdf(data, ".DOCX", timeout=7, runner=runner)
    assert out.startswith(b"%PDF-") and got["same"] and got["timeout"] == 7
    assert got["cmd"][got["cmd"].index("-File") + 1] == str(word.SCRIPT) and word.SCRIPT.is_file()
    assert "-NonInteractive" in got["cmd"] and os.path.basename(got["src"]) == "paper.docx"      # never his file name on a command line
    assert not os.path.exists(os.path.dirname(got["src"]))


@pytest.mark.parametrize("answer, sentence", [
    ((124, "timeout"), "did not finish printing this file in 3 seconds"),
    ((1, "pid 9\nfail The password is incorrect. Word cannot open the document."), "locked with a password"),
    ((1, "pid 9\nfail The object invoked has disconnected from its clients."), "could not print this file"),
    ((0, "pid 9\nok"), "could not print this file"),                # said ok and wrote no PDF
])
def test_a_failed_conversion_is_a_sentence_never_a_traceback(answer, sentence):
    with pytest.raises(ValueError, match=sentence) as e:
        word.to_pdf(docx_bytes(), ".docx", timeout=3, runner=lambda cmd, t: answer)
    assert "Traceback" not in str(e.value) and "\\" not in str(e.value)      # no path of this PC in the answer


def test_without_word_the_answer_is_a_sentence(monkeypatch):
    monkeypatch.setattr(word, "_found", (False, word.NO_WORD))
    with pytest.raises(ValueError, match="Word is not installed"):
        word.to_pdf(docx_bytes(), ".docx")


@pytest.mark.skipif(os.environ.get("WW_WORD_TEST") != "1" or not word.available()[0], reason="starts Word: set WW_WORD_TEST=1 to run")
def test_the_real_word_prints_a_docx(tmp_path):
    import docx
    d = docx.Document()
    d.add_paragraph("Max. Marks: 4")
    d.add_paragraph("1. State the sampling theorem. (2 marks)")
    d.add_paragraph("2. Define aliasing. (2 marks)")
    p = tmp_path / "real.docx"
    d.save(str(p))
    r = ingest.ingest_word(p, store=Store(tmp_path / "pyq"))
    assert [q["marks"] for q in r["drafts"]] == [2, 2]

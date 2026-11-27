"""E17: a Classroom export .zip, listed before anything is extracted (ww_pyq/takeout.py, routes_ww_pyq_takeout.py, R-46 and R-47).
Every zip is built here from invented bytes at test time; nothing binary is committed. An archive is hostile input, so
most tests here are one refusal each."""
from __future__ import annotations

import io
import json
import re
import stat
import struct
import zipfile
from urllib.parse import quote

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_takeout as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import api, schema, takeout
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, DECK, build_pdf, build_pptx

TOKEN = "t" * 32
B = "/api/mission/pyq/takeout"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq_ingest", "ww_pyq_takeout"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, tmp_path


def make_zip(path, members: dict, compress=zipfile.ZIP_STORED):
    with zipfile.ZipFile(path, "w", compress) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return path


def a_pdf(tmp) -> bytes:
    return build_pdf(BY_NAME["signals_basic"], tmp / "src").read_bytes()


def good_zip(tmp):
    pdf = a_pdf(tmp)
    pptx = build_pptx(DECK, tmp / "src").read_bytes()
    return make_zip(tmp / "export.zip", {"Class A/paper one.pdf": pdf, "Class A/deck.pptx": pptx, "Class A/notes.txt": b"hello",
                                         "Class B/second.pdf": pdf + b"\n%extra"})


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]


def listing(c, path):
    r = c.post(B, json={"path": str(path)})
    assert r.status_code == 200, r.text
    envelope(r.json())
    return r.json()["listing"]


def inbox_files(st):
    return sorted(p.name for p in st.paths.inbox.iterdir())


def tree(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))


def refused_and_never_extracted(c, st, ls, name, word="refused"):
    by = {e["name"]: e for e in ls["entries"]}
    assert by[name]["refused"], name
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": [name]})
    assert r.status_code == 400 and word in r.json()["detail"], (name, r.text)
    assert inbox_files(st) == []
    return by[name]["refused"]


# ------------------------------------------------------------------ (1) listed, nothing extracted; (5) the note
def test_a_zip_is_listed_and_nothing_is_extracted(env):
    c, st, tmp = env
    z = good_zip(tmp)
    before = tree(st.root)
    ls = listing(c, z)
    assert re.fullmatch(r"tk-[0-9a-f]{10}", ls["id"]) and ls["name"] == "export.zip"
    kinds = {e["name"]: (e["kind"], e["refused"]) for e in ls["entries"]}
    assert kinds["Class A/paper one.pdf"] == ("pdf", None) and kinds["Class A/deck.pptx"] == ("pptx", None)
    assert kinds["Class A/notes.txt"] == ("other", None)
    assert ls["total_size"] == sum(e["size"] for e in ls["entries"])
    assert inbox_files(st) == []
    new = set(tree(st.root)) - set(before)
    assert new <= {"takeout", f"takeout/{ls['id']}.zip", f"takeout/{ls['id']}.json"}      # only the copy and its listing
    assert json.loads((st.root / "takeout" / f"{ls['id']}.json").read_text("utf-8"))["id"] == ls["id"]
    assert not list((st.root / "takeout").glob(".*part"))


def test_the_listing_carries_the_note_about_files_owned_by_others(env):
    c, _, tmp = env
    assert listing(c, good_zip(tmp))["note"] == "Files owned by others may be missing from your export."


def test_a_raw_zip_body_with_a_name_is_listed_the_same(env):
    c, st, tmp = env
    data = good_zip(tmp).read_bytes()
    r = c.post(f"{B}?name=my%20export.zip", content=data)
    assert r.status_code == 200, r.text
    ls = r.json()["listing"]
    assert ls["name"] == "my export.zip" and len(ls["entries"]) == 4 and inbox_files(st) == []


# ------------------------------------------------------------------ (2) hostile names refused and never extracted
HOSTILE = ["../evil.pdf", "a/../../evil.pdf", "/abs/evil.pdf", "C:/evil.pdf", "C:evil.pdf", "..\\evil.pdf", "x\\..\\..\\evil.pdf",
           "\\abs\\evil.pdf", "nul.pdf", "sub/CON.pdf", "aux", "com1.pptx", "lpt9.txt", "con .pdf", "ok/\x01bad.pdf",
           "ok/paper.pdf:hidden", "ok\x7f.pdf"]


@pytest.mark.filterwarnings("ignore:Duplicate name")      # on Windows "..\\evil.pdf" and "../evil.pdf" are one name
def test_escapes_absolute_drive_device_and_stream_names_are_refused_and_never_extracted(env):
    c, st, tmp = env
    pdf = a_pdf(tmp)
    z = make_zip(tmp / "hostile.zip", {**{n: pdf for n in HOSTILE}, "fine.pdf": pdf})
    outside = tree(tmp)
    ls = listing(c, z)
    by = {e["name"]: e for e in ls["entries"]}
    norm = {n: n.replace("\\", "/") for n in HOSTILE}   # zipfile on Windows turns a backslash into a slash in a name
    for n in HOSTILE:
        refused_and_never_extracted(c, st, ls, norm[n])
    assert by["fine.pdf"]["refused"] is None
    assert not (tmp / "evil.pdf").exists() and not (tmp.parent / "evil.pdf").exists() and not (tmp / "abs").exists()
    assert set(tree(tmp)) - set(outside) <= {f"pyq/{p}" for p in tree(st.root)}      # nothing written outside the store


def test_a_backslash_name_written_raw_is_read_as_separators(tmp_path):
    # zipfile keeps a backslash in a name on Linux; the rule must not depend on the machine that made the zip
    for n in ("..\\..\\evil.pdf", "x\\..\\..\\evil.pdf", "\\abs\\evil.pdf"):
        assert takeout.refusal(n, 10), n
    assert takeout.refusal("Class A\\paper.pdf", 10) is None


def test_a_symlink_entry_is_refused_and_never_extracted(env):
    c, st, tmp = env
    link = zipfile.ZipInfo("Class A/link.pdf")
    link.create_system = 3                                   # unix
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    z = tmp / "link.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr(link, "../../../../Windows/win.ini")
        zf.writestr("Class A/real.pdf", a_pdf(tmp))
    ls = listing(c, z)
    assert "link" in refused_and_never_extracted(c, st, ls, "Class A/link.pdf")
    assert {e["name"]: e["refused"] for e in ls["entries"]}["Class A/real.pdf"] is None


def test_names_that_differ_only_by_case_are_both_refused(env):
    c, st, tmp = env
    pdf = a_pdf(tmp)
    z = make_zip(tmp / "case.zip", {"Unit 1/Paper.pdf": pdf, "unit 1/paper.PDF": pdf + b"\n%other", "Unit 1/other.pdf": pdf})
    ls = listing(c, z)
    for n in ("Unit 1/Paper.pdf", "unit 1/paper.PDF"):
        assert "capital" in refused_and_never_extracted(c, st, ls, n)
    assert {e["name"]: e["refused"] for e in ls["entries"]}["Unit 1/other.pdf"] is None


def test_an_exact_duplicate_name_is_refused_both_times(env, tmp_path):
    c, st, tmp = env
    z = tmp / "dup.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("a.pdf", a_pdf(tmp))
        with pytest.warns(UserWarning):
            zf.writestr("a.pdf", b"%PDF-1.4 second")
    ls = listing(c, z)
    assert len(ls["entries"]) == 2 and all(e["refused"] for e in ls["entries"])
    assert c.post(f"{B}/{ls['id']}/accept", json={"entries": ["a.pdf"]}).status_code == 400 and inbox_files(st) == []


def test_refusal_function_accepts_plain_nested_names():
    for n in ("a.pdf", "Class A/Unit 1/paper.pdf", "x/./y.pptx", "dots.in.name.pdf", "..name.pdf", "console.pdf", "com.pdf"):
        assert takeout.refusal(n, 10) is None, n
    assert takeout.refusal("a.pdf", takeout.MAX_ENTRY + 1)
    assert takeout.refusal("a.pdf", 10, encrypted=True)
    assert takeout.refusal("a.pdf", 10, symlink=True)


# ------------------------------------------------------------------ (3) bombs refused before any reading
def test_an_entry_declaring_over_100_mb_is_refused_in_the_listing(env):
    c, st, tmp = env
    z = make_zip(tmp / "big.zip", {"zeros.pdf": b"%PDF-" + b"\0" * (101 * 1024 * 1024)}, zipfile.ZIP_DEFLATED)   # 101 MB from about 100 KB
    assert z.stat().st_size < 1024 * 1024
    ls = listing(c, z)
    e = ls["entries"][0]
    assert e["size"] > takeout.MAX_ENTRY and "MB" in e["refused"]
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["zeros.pdf"]})
    assert r.status_code == 400 and inbox_files(st) == []


def test_an_entry_over_the_compression_ratio_is_refused_and_a_stored_one_of_the_same_size_is_not(env):
    c, st, tmp = env
    zeros = b"%PDF-" + b"\0" * (2 * 1024 * 1024)                      # 2 MB, under the 100 MB cap, shrinks about 1000 times
    z = tmp / "ratio.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("bomb.pdf", zeros, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("plain.pdf", zeros, compress_type=zipfile.ZIP_STORED)
    ls = listing(c, z)
    assert "inflate" in refused_and_never_extracted(c, st, ls, "bomb.pdf")
    assert {e["name"]: e["refused"] for e in ls["entries"]}["plain.pdf"] is None


def test_a_small_file_that_shrinks_a_lot_is_not_refused():
    assert takeout.refusal("note.pdf", 50_000, compressed=100) is None              # under 1 MB: harmless
    assert takeout.refusal("note.pdf", 2 * 1024 * 1024, compressed=0)               # a 2 MB claim packed in nothing


def test_an_archive_over_5000_entries_or_1_gb_declared_is_refused_whole(env, monkeypatch):
    c, st, tmp = env
    z = make_zip(tmp / "many.zip", {f"f{i}.txt": b"" for i in range(takeout.MAX_ENTRIES + 1)})
    r = c.post(B, json={"path": str(z)})
    assert r.status_code == 400 and "entries" in r.json()["detail"]
    monkeypatch.setattr(takeout, "MAX_DECLARED", 1000)
    z2 = make_zip(tmp / "heavy.zip", {"a.pdf": b"%PDF-" + b"x" * 600, "b.pdf": b"%PDF-" + b"x" * 600})
    r = c.post(B, json={"path": str(z2)})
    assert r.status_code == 400 and "in all" in r.json()["detail"]
    assert list((st.root / "takeout").glob("tk-*")) == []        # a refused archive leaves no copy


def _patch_eocd(path, count=None, cd_size=None):
    raw = bytearray(path.read_bytes())
    i = raw.rindex(b"PK\x05\x06")
    if count is not None:
        raw[i + 8:i + 12] = struct.pack("<HH", count, count)
    if cd_size is not None:
        raw[i + 12:i + 16] = struct.pack("<I", cd_size)
    path.write_bytes(bytes(raw))


def test_a_forged_entry_count_or_directory_size_is_refused_before_zipfile_parses_it(env, monkeypatch):
    c, st, tmp = env
    z = make_zip(tmp / "forged.zip", {"a.pdf": b"%PDF-1.4"})
    z2 = make_zip(tmp / "forged2.zip", {"a.pdf": b"%PDF-1.4"})
    _patch_eocd(z, count=60000)
    _patch_eocd(z2, cd_size=100 * 1024 * 1024)
    reached = []
    monkeypatch.setattr(takeout.zipfile, "ZipFile", lambda *a, **k: reached.append(a))   # must never be called
    r = c.post(B, json={"path": str(z)})
    assert r.status_code == 400 and "60000 entries" in r.json()["detail"]
    with pytest.raises(ValueError, match="table of contents"):
        takeout.list_archive(z2)
    assert reached == []


def _with_zip64_record(raw: bytes, count: int, cd_size: int) -> bytes:
    """A zip64 record and locator put before the end record, which keeps small 32-bit numbers (1 entry, 46 bytes)."""
    i = raw.rindex(b"PK\x05\x06")
    sig, d, dcd, _, _, _, cd_off, _ = struct.unpack("<4sHHHHIIH", raw[i:i + 22])
    rec = struct.pack("<4sQHHIIQQQQ", b"PK\x06\x06", 44, 45, 45, 0, 0, count, count, cd_size, cd_off)
    loc = struct.pack("<4sIQI", b"PK\x06\x07", 0, i, 1)
    return raw[:i] + rec + loc + struct.pack("<4sHHHHIIH", sig, d, dcd, 1, 1, 46, cd_off, 0)


def test_a_zip64_record_is_read_even_when_the_32_bit_end_record_looks_small(env, monkeypatch):
    # zipfile takes the zip64 numbers whenever a locator sits before the end record, not only at 0xFFFF; a precheck
    # that reads them only at 0xFFFF lets a forged 60000-entry or 100 MB directory reach zipfile
    c, st, tmp = env
    z = make_zip(tmp / "z64.zip", {"a.pdf": b"%PDF-1.4"})
    raw = z.read_bytes()
    z.write_bytes(_with_zip64_record(raw, 60000, 50))
    z2 = tmp / "z64b.zip"
    z2.write_bytes(_with_zip64_record(raw, 1, 100 * 1024 * 1024))
    real = tmp / "real64.zip"                                   # a true zip64 archive of one small entry is still listed
    with zipfile.ZipFile(real, "w") as zf, zf.open("a.pdf", "w", force_zip64=True) as w:
        w.write(b"%PDF-1.4 small")
    assert listing(c, real)["entries"][0]["refused"] is None
    reached = []
    monkeypatch.setattr(takeout.zipfile, "ZipFile", lambda *a, **k: reached.append(a))   # must never be called
    r = c.post(B, json={"path": str(z)})
    assert r.status_code == 400 and "60000 entries" in r.json()["detail"]
    with pytest.raises(ValueError, match="table of contents"):
        takeout.list_archive(z2)
    assert reached == []


def test_a_file_with_no_end_record_is_not_a_zip(tmp_path):
    p = tmp_path / "x.zip"
    p.write_bytes(b"PK\x03\x04" + b"\0" * 100)
    with pytest.raises(ValueError, match="not a readable"):
        takeout.list_archive(p)


def test_an_entry_that_inflates_past_its_declared_size_is_cut_and_refused(env, tmp_path):
    z = tmp_path / "liar.zip"
    make_zip(z, {"liar.pdf": b"%PDF-" + b"A" * 5000})
    raw = bytearray(z.read_bytes())
    # lie in both the local header and the central directory: declare 100 bytes for a 5005-byte stored entry
    for sig, off in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):
        i = raw.index(sig)
        raw[i + off:i + off + 4] = struct.pack("<I", 100)
    z.write_bytes(bytes(raw))
    with zipfile.ZipFile(z) as zf:
        info = zf.infolist()[0]
        assert info.file_size == 100
        dest = tmp_path / "out.pdf"
        # zipfile stops at the declared size itself and then fails the CRC; either way nothing is kept
        with pytest.raises(ValueError, match="inflates past|could not be read"):
            takeout.extract_entry(zf, info, dest)
    assert not dest.exists() and not list(tmp_path.glob(".*.part"))


def test_the_byte_cap_holds_even_if_the_reader_returns_more_than_declared(tmp_path):
    # our own count, not zipfile's, is the guard: a reader that hands back 10 MB for a 100-byte claim is cut at 101
    class Endless(io.RawIOBase):
        def __init__(self):
            self.given = 0

        def read(self, n=-1):
            n = 1024 * 1024 if n is None or n < 0 else n
            self.given += n
            return b"%PDF-" + b"\0" * (n - 5) if self.given <= 10 * 1024 * 1024 else b""

    src = Endless()

    class FakeZip:
        def open(self, info):
            return src

    info = zipfile.ZipInfo("x.pdf")
    info.file_size = 100
    dest = tmp_path / "x.pdf"
    with pytest.raises(ValueError, match="inflates past"):
        takeout.extract_entry(FakeZip(), info, dest)
    assert src.given == 101 and not dest.exists() and not list(tmp_path.glob(".*.part"))


# ------------------------------------------------------------------ (4) accepting two entries extracts only those and starts the ingest
def test_accepting_two_entries_extracts_only_those_into_the_inbox_and_starts_the_ingest(env):
    c, st, tmp = env
    ls = listing(c, good_zip(tmp))
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["Class A/paper one.pdf", "Class A/deck.pptx"]})
    assert r.status_code == 200, r.text
    j = r.json()
    envelope(j)
    assert j["state"] == "live" and j["job"]["total"] == 2
    info = c.app.state.pyq_ingest.wait(60)
    assert info["status"] == "done" and sorted(f["status"] for f in info["files"]) == ["added", "added"]
    names = inbox_files(st)
    assert names == sorted([f"{ls['id']}-1-paper-one.pdf", f"{ls['id']}-2-deck.pptx"])          # names the code made
    assert len(st.list_papers()) == 2
    assert all(p.get("source_note", "").startswith("Classroom export") for p in st.list_papers())


def test_a_second_accept_never_writes_over_a_file_already_in_the_inbox(env):
    # "A/x y.pdf" and "B/x-y.pdf" both flatten to x-y; accepted one after the other, both were number 1 and the second
    # replaced the first (and a failed second accept would then have deleted it)
    c, st, tmp = env
    pdf = a_pdf(tmp)
    z = make_zip(tmp / "same.zip", {"A/x y.pdf": pdf, "B/x-y.pdf": pdf + b"\n%second"})
    ls = listing(c, z)
    assert c.post(f"{B}/{ls['id']}/accept", json={"entries": ["A/x y.pdf"]}).status_code == 200
    c.app.state.pyq_ingest.wait(60)
    first = st.paths.inbox / f"{ls['id']}-1-x-y.pdf"
    assert first.read_bytes() == pdf
    assert c.post(f"{B}/{ls['id']}/accept", json={"entries": ["B/x-y.pdf"]}).status_code == 200
    c.app.state.pyq_ingest.wait(60)
    assert first.read_bytes() == pdf and len(inbox_files(st)) == 2


def test_extract_never_replaces_an_existing_file(tmp_path):
    z = make_zip(tmp_path / "a.zip", {"a.pdf": b"%PDF-1.4 new"})
    dest = tmp_path / "a.pdf"
    dest.write_bytes(b"%PDF-1.4 old")
    with zipfile.ZipFile(z) as zf, pytest.raises(ValueError, match="already"):
        takeout.extract_entry(zf, zf.infolist()[0], dest)
    assert dest.read_bytes() == b"%PDF-1.4 old" and not list(tmp_path.glob(".*.part"))


def test_safe_flat_name_is_made_by_the_code():
    aid = "tk-0123456789"
    assert takeout.safe_flat_name(aid, 3, "a/b/../CON.PDF") == f"{aid}-3-CON.pdf"     # prefixed, so never a device
    assert takeout.safe_flat_name(aid, 1, "x/-- ..pdf") == f"{aid}-1-file.pdf"
    assert takeout.safe_flat_name(aid, 1, "Unit 1/Fourier: part 2 (b).pptx") == f"{aid}-1-Fourier-part-2-(b).pptx"
    for bad in (("../x", 1, "a.pdf"), (aid, 0, "a.pdf"), (aid, 1, "a.txt")):
        with pytest.raises(ValueError):
            takeout.safe_flat_name(*bad)


def test_accept_refuses_unknown_entries_other_kinds_bad_bodies_and_ids(env):
    c, st, tmp = env
    ls = listing(c, good_zip(tmp))
    a = f"{B}/{ls['id']}/accept"
    for body in ({"entries": ["nope.pdf"]}, {"entries": ["Class A/notes.txt"]}, {"entries": []}, {"entries": "x"},
                 {"entries": [3]}, {}, {"entries": ["Class A/deck.pptx", "nope.pdf"]}):
        assert c.post(a, json=body).status_code == 400, body
    assert c.post(f"{B}/tk-0123456789/accept", json={"entries": ["a.pdf"]}).status_code == 404
    for bad in ("..", "tk-..%2F..%2Fx", "x", "tk-ZZZZZZZZZZ"):
        assert c.post(f"{B}/{bad}/accept", json={"entries": ["a.pdf"]}).status_code == 404, bad
    assert inbox_files(st) == [] and c.app.state.pyq_ingest.get("last") is None


def test_accept_while_an_ingest_runs_is_409_and_leaves_nothing_in_the_inbox(env):
    c, st, tmp = env
    ls = listing(c, good_zip(tmp))
    runner = c.app.state.pyq_ingest
    runner.running = lambda: True
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["Class A/deck.pptx"]})
    assert r.status_code == 409 and inbox_files(st) == []
    del runner.running

    def busy(*a, **k):                                   # the race: the check passed and the slot was taken before start()
        raise api.Busy("Already reading files; wait for that to finish.")
    runner.start = busy
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["Class A/deck.pptx", "Class A/paper one.pdf"]})
    assert r.status_code == 409 and inbox_files(st) == []


def test_a_body_that_is_not_the_type_its_name_claims_is_not_read(env):
    c, st, tmp = env
    z = make_zip(tmp / "fake.zip", {"fake.pdf": b"this is not a pdf at all", "real.pdf": a_pdf(tmp)})
    ls = listing(c, z)
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["real.pdf", "fake.pdf"]})
    assert r.status_code == 400 and "not a pdf" in r.json()["detail"]
    assert inbox_files(st) == []                         # the good one extracted first is taken back too


def test_an_archive_changed_after_listing_is_refused(env):
    c, st, tmp = env
    ls = listing(c, good_zip(tmp))
    make_zip(st.root / "takeout" / f"{ls['id']}.zip", {"Class A/deck.pptx": b"PK\x03\x04 different"})
    r = c.post(f"{B}/{ls['id']}/accept", json={"entries": ["Class A/deck.pptx"]})
    assert r.status_code == 400 and "changed" in r.json()["detail"] and inbox_files(st) == []


def test_only_the_last_listings_are_kept(env, monkeypatch):
    c, st, tmp = env
    monkeypatch.setattr(R, "KEEP_LISTINGS", 2)
    z = good_zip(tmp)
    ids = [listing(c, z)["id"] for _ in range(3)]
    d = st.root / "takeout"
    assert sorted(p.name for p in d.glob("tk-*")) == sorted(f"{i}.{x}" for i in ids[1:] for x in ("json", "zip"))
    assert c.post(f"{B}/{ids[0]}/accept", json={"entries": ["Class A/deck.pptx"]}).status_code == 404


# ------------------------------------------------------------------ R-46 input rules
def test_r46_refuses_bad_paths_names_and_non_zips(env):
    c, st, tmp = env
    (tmp / "notes.txt").write_text("hi")
    (tmp / "dir.zip").mkdir()
    (tmp / "fake.zip").write_bytes(b"not a zip")
    for body in ({"path": "relative.zip"}, {"path": str(tmp / "missing.zip")}, {"path": str(tmp / "notes.txt")},
                 {"path": str(tmp / "dir.zip")}, {"path": str(tmp / "fake.zip")}, {"path": ""}, {"path": 7}, {},
                 {"path": "\\\\host\\share\\a.zip"}, {"path": "//host/share/a.zip"}, {"path": "\\\\?\\C:\\a.zip"},
                 {"path": tmp.anchor}, {"path": str(tmp.anchor) + "."}):
        r = c.post(B, json=body)
        assert r.status_code == 400 and r.json()["detail"], body
    assert c.post(B, content=b"{not json", headers={"content-type": "application/json"}).status_code == 400
    assert c.post(B, json=["a list"]).status_code == 400
    data = good_zip(tmp).read_bytes()
    for name in ("", "a.pdf", "../a.zip", "a/b.zip", "nul.zip", "CON.zip", ".hidden.zip", "a\nb.zip", "a.zip\n"):
        assert c.post(f"{B}?name={quote(name)}", content=data).status_code == 400, name
    assert c.post(f"{B}?name=a.zip", content=b"").status_code == 400
    assert c.post(f"{B}?name=a.zip", content=b"plain text here").status_code == 400
    assert c.post(f"{B}?name=a.zip", content=b"PK\x03\x04 but no real archive").status_code == 400
    assert list((st.root / "takeout").glob("tk-*")) == [] and not list((st.root / "takeout").glob(".*"))


def test_r46_over_500_mb_is_413_by_header_and_at_the_cap_while_reading(env, monkeypatch):
    c, st, tmp = env
    monkeypatch.setattr(takeout, "MAX_ARCHIVE", 2000)
    data = good_zip(tmp).read_bytes()
    assert len(data) > 2000
    assert c.post(f"{B}?name=a.zip", content=data).status_code == 413              # Content-Length says it

    def gen():                                                        # no Content-Length: chunked, stopped at the cap
        yield b"PK\x03\x04"
        for _ in range(10):
            yield b"x" * 500
    assert c.post(f"{B}?name=a.zip", content=gen()).status_code == 413
    assert c.post(B, json={"path": str(good_zip(tmp))}).status_code == 413     # a path to a big file, by its size
    assert list((st.root / "takeout").glob("tk-*")) == [] and not list((st.root / "takeout").glob(".*"))


# ------------------------------------------------------------------ every route answers and is in the docstring
def test_every_route_is_in_the_docstring_and_needs_the_token(env):
    c, _, tmp = env
    doc = R.__doc__
    for rid in ("R-46", "R-47"):
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    documented = {(m, p.split("?")[0]) for m, p in rows}
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(B) and m != "HEAD"}
    assert len(rows) == 2 and documented == defined
    assert c.post(B, json={"path": "x"}, headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


def test_no_forecast_words_in_any_output_string(env):
    c, _, tmp = env
    ls = c.post(B, json={"path": str(good_zip(tmp))}).json()
    text = json.dumps(ls).lower()
    for w in ("important", "likely", "expected", "will be asked", "probability", "chance"):
        assert w not in text

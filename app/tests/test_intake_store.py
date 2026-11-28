"""The intake store (C02): rows from pasted lines and calendar files, duplicates by hash, owned-file deletion,
folder rows, suggestions, restart. Every title, file and folder is invented; every store lives under tmp_path."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from jarvis_app.ww_intake import parse_ics, parse_paste
from jarvis_app.ww_intake import store as S
from jarvis_app.ww_pyq import folder
from jarvis_app.ww_pyq.store import Store

NOW = datetime(2026, 11, 14, 10, 0, tzinfo=timezone.utc)
TODAY = NOW.date().isoformat()
ROW_KEYS = {"id", "source", "kind", "state", "title", "date", "time", "readings", "ambiguous", "subject",
            "subject_suggestion", "repeats", "file", "raw", "raw_hash", "added", "updated"}


def cal(*events: str) -> str:
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", *events, "END:VCALENDAR"]) + "\r\n"


def vev(*lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", *lines, "END:VEVENT"])


@pytest.fixture()
def st(tmp_path):
    return S.IntakeStore(tmp_path / "intake")


def his_file(tmp_path, name="precious.pdf", data=b"keep me") -> Path:
    d = tmp_path / "his own folder"
    d.mkdir(exist_ok=True)
    f = d / name
    f.write_bytes(data)
    return f


def owned_row(st, name: str, digest="ab") -> dict:
    """A hand-made row that claims ownership: the store must not believe the claim."""
    row = st.make_row(source="folder", kind="file", title="x.pdf", raw_hash=digest * 32,
                      file={"name": name, "size": 7, "owned": True})
    return st.put(row)


# ------------------------------------------------------------------ acceptance 1 and 5: rows in state new, no duplicates
def test_paste_makes_rows_in_state_new_and_the_same_paste_twice_adds_none(st):
    res = parse_paste("Widget lab report due 2026-11-20\nGizmo quiz 2026-11-22 5pm", NOW)
    first = st.add_paste(res)
    assert len(first) == 2 and {r["state"] for r in first} == {"new"}
    assert {r["source"] for r in first} == {"paste"} and {r["kind"] for r in first} == {"deadline"}
    assert first[1]["time"] == "17:00"
    assert st.add_paste(res) == [] and st.add_paste(parse_paste("Gizmo quiz 2026-11-22 5pm", NOW)) == []
    assert len(st.list_rows()) == 2


def test_the_same_relative_line_on_another_day_is_another_deadline(st):
    st.add_paste(parse_paste("Gizmo quiz tomorrow", NOW))
    later = datetime(2026, 11, 21, 10, 0, tzinfo=timezone.utc)
    again = st.add_paste(parse_paste("Gizmo quiz tomorrow", later))
    assert len(again) == 1 and again[0]["date"] == "2026-11-22"


def test_row_has_every_field_of_the_plan_record(st):
    r = st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))[0]
    assert set(r) == ROW_KEYS
    assert S.valid_id(r["id"]) and r["date"] == "2026-11-20" and r["file"] is None and r["subject"] == ""
    assert r["readings"] == [{"date": "2026-11-20", "order": ""}] and r["ambiguous"] is False


def test_an_ambiguous_paste_keeps_both_readings_and_no_date(st):
    r = st.add_paste(parse_paste("Widget viva 03/04", NOW))[0]
    assert r["ambiguous"] is True and r["date"] is None
    assert [x["order"] for x in r["readings"]] == ["day-month", "month-day"]


def test_calendar_events_become_rows_and_the_same_uid_and_start_adds_none(st):
    text = cal(vev("UID:a1@x", "SUMMARY:Gizmo seminar", "DTSTART:20261120T090000Z"),
               vev("UID:a2@x", "SUMMARY:Widget exam", "DTSTART;VALUE=DATE:20261125"))
    new, skipped, past = st.add_events(parse_ics(text, NOW), today=TODAY)
    assert len(new) == 2 and (skipped, past) == (0, 0) and {r["source"] for r in new} == {"ics"}
    assert {r["kind"] for r in new} == {"event"}
    exam = next(r for r in new if r["title"] == "Widget exam")
    assert exam["date"] == "2026-11-25" and exam["time"] is None
    again, _, _ = st.add_events(parse_ics(text, NOW), today=TODAY)
    assert again == [] and len(st.list_rows()) == 2


def test_a_weekly_repeat_gives_one_row_per_occurrence(st):
    text = cal(vev("UID:w@x", "SUMMARY:Widget tutorial", "DTSTART:20261116T090000Z", "RRULE:FREQ=WEEKLY;COUNT=3"))
    new, _, _ = st.add_events(parse_ics(text, NOW), today=TODAY)
    assert [r["date"] for r in new] == ["2026-11-16", "2026-11-23", "2026-11-30"]
    assert len({r["id"] for r in new}) == 3 and {r["repeats"] for r in new} == {"expanded"}


def test_a_skipped_event_is_counted_and_a_past_event_is_left_out(st):
    broken = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Cut off\r\nDTSTART:20261120T090000Z\r\n"
    new, skipped, past = st.add_events(parse_ics(broken, NOW), today=TODAY)
    assert new == [] and skipped == 1 and st.list_rows() == []
    old = cal(vev("UID:o@x", "SUMMARY:Old lecture", "DTSTART:20260101T090000Z"))
    new, skipped, past = st.add_events(parse_ics(old, NOW), today=TODAY)
    assert new == [] and (skipped, past) == (0, 1)


def test_a_due_property_makes_a_deadline(st):
    text = cal(vev("UID:d@x", "SUMMARY:Gizmo essay", "DTSTART:20261118T090000Z", "DUE:20261120T120000Z"))
    new, _, _ = st.add_events(parse_ics(text, NOW), today=TODAY)
    assert new[0]["kind"] == "deadline" and new[0]["date"] == "2026-11-20" and new[0]["time"] == "12:00"


# ------------------------------------------------------------------ disk: atomic, restart, corrupt, schema
def test_the_rows_file_is_written_whole_and_a_new_store_reloads_it(st, tmp_path):
    st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))
    st.update(st.list_rows()[0]["id"], {"state": "accepted", "subject": "widgets"})
    again = S.IntakeStore(tmp_path / "intake")                     # a restart
    rows = again.list_rows()
    assert len(rows) == 1 and rows[0]["state"] == "accepted" and rows[0]["subject"] == "widgets"
    assert not [p for p in (tmp_path / "intake").iterdir() if p.name.endswith(".tmp")]


def test_rows_json_carries_its_schema_version_and_keeps_unknown_keys(st, tmp_path):
    p = tmp_path / "intake" / "rows.json"
    p.write_text(json.dumps({"version": 1, "rows": [], "dismissed": [], "later_wave": {"x": 1}}), encoding="utf-8")
    st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["version"] == S.SCHEMA_VERSION and data["later_wave"] == {"x": 1} and len(data["rows"]) == 1


def test_a_corrupt_rows_file_is_set_aside_not_overwritten(st, tmp_path):
    (tmp_path / "intake" / "rows.json").write_text("{not json", encoding="utf-8")
    assert st.list_rows() == []
    assert st.problems and any(p.name.endswith(".corrupt") for p in (tmp_path / "intake").iterdir())


def test_rows_with_a_bad_id_in_the_file_are_dropped_on_read(st, tmp_path):
    good = st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))[0]
    p = tmp_path / "intake" / "rows.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data["rows"].append({**good, "id": "../../evil"})
    p.write_text(json.dumps(data), encoding="utf-8")
    assert [r["id"] for r in st.list_rows()] == [good["id"]]


# ------------------------------------------------------------------ ids and updates
@pytest.mark.parametrize("bad", ["i-000000000000", "../etc", "i-ABCDEF012345", "", "i-0123456789ab\n", None, 5,
                                 "i-" + "a" * 500, "I-0123456789ab"])
def test_an_unknown_or_hostile_id_is_a_keyerror_everywhere(st, bad):
    calls = [st.get, st.delete, lambda r: st.update(r, {"state": "accepted"})]
    if not S.valid_id(bad):
        calls.append(st.dismiss)      # dismiss takes any well-formed id: a scanned folder row is not stored yet
    for call in calls:
        with pytest.raises(KeyError):
            call(bad)


def test_update_changes_a_row_but_never_its_identity(st):
    r = st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))[0]
    out = st.update(r["id"], {"state": "accepted", "id": "i-ffffffffffff", "raw_hash": "x", "file": {"owned": True}})
    assert out["state"] == "accepted" and out["id"] == r["id"] and out["raw_hash"] == r["raw_hash"]
    assert out["file"] is None and st.get(r["id"])["state"] == "accepted"


# ------------------------------------------------------------------ owned copies
def test_add_file_keeps_an_owned_copy_and_delete_removes_that_copy(st):
    row = st.add_file("notes.pdf", b"%PDF invented")
    assert row["kind"] == "file" and row["file"]["owned"] is True and row["file"]["size"] == 13
    p = st.owned_path(row)
    assert p is not None and p.is_file() and os.path.normcase(p.parent) == os.path.normcase(os.path.realpath(st.files))
    assert st.delete(row["id"]) == {"row": True, "file": True}
    assert not p.exists() and st.list_rows() == []


def test_add_file_strips_a_path_from_the_name_and_refuses_bad_names_and_sizes(st, monkeypatch):
    row = st.add_file("..\\..\\evil.pdf", b"x")
    assert row["title"] == "evil.pdf" and st.owned_path(row) is not None
    for bad in ("..", ".hidden.pdf", "CON.pdf", "nul", "a" * 200 + ".pdf", ""):
        with pytest.raises(ValueError):
            st.add_file(bad, b"x")
    with pytest.raises(ValueError, match="empty"):
        st.add_file("empty.pdf", b"")
    monkeypatch.setattr(S, "MAX_FILE", 10)
    with pytest.raises(ValueError, match="at most"):
        st.add_file("big.pdf", b"x" * 11)


# ------------------------------------------------------------------ acceptance 4: delete never leaves files/
@pytest.mark.parametrize("name", [
    "../../his own folder/precious.pdf",
    "..\\..\\his own folder\\precious.pdf",
    "../../HIS OWN FOLDER/PRECIOUS.PDF",
    "..",
    ".",
    "",
    "C:precious.pdf",
])
def test_delete_never_touches_a_file_outside_files_even_if_the_row_says_owned(st, tmp_path, name):
    precious = his_file(tmp_path)
    row = owned_row(st, name)
    assert st.owned_path(row) is None
    assert st.delete(row["id"]) == {"row": True, "file": False}
    assert precious.read_bytes() == b"keep me"


def test_an_absolute_path_in_the_row_is_refused(st, tmp_path):
    precious = his_file(tmp_path)
    row = owned_row(st, str(precious))
    assert st.owned_path(row) is None and st.delete(row["id"])["file"] is False and precious.exists()


def test_inside_is_a_direct_child_test_that_ignores_case_and_refuses_a_prefix_twin(tmp_path):
    base = tmp_path / "intake" / "files"
    assert S.inside(base, base / "a.pdf")
    assert not S.inside(base, base)
    assert not S.inside(base, tmp_path / "intake" / "files2" / "a.pdf")      # a string prefix is not containment
    assert not S.inside(base, base / "sub" / "a.pdf")
    assert not S.inside(base, base.parent / "a.pdf")
    if os.name == "nt":
        assert S.inside(Path(str(base).upper()), Path(str(base / "a.pdf").lower()))


def test_delete_works_when_the_store_root_is_named_in_odd_case(tmp_path):
    if os.name != "nt":
        pytest.skip("case-insensitive paths are a Windows matter")
    (tmp_path / "intake").mkdir()
    st = S.IntakeStore(Path(str(tmp_path / "intake").upper()))
    row = st.add_file("notes.pdf", b"%PDF invented")
    p = st.owned_path(row)
    assert p is not None and st.delete(row["id"])["file"] is True and not p.exists()


def test_delete_of_a_row_for_his_own_folder_file_leaves_the_file_and_hides_the_row(st, tmp_path):
    f = his_file(tmp_path, "slides.pdf", b"x")
    row = st.make_row(source="folder", kind="file", title="slides.pdf", raw_hash="cd" * 32,
                      file={"name": "slides.pdf", "size": 1, "owned": False})
    st.put(row)
    assert st.delete(row["id"]) == {"row": True, "file": False}
    assert f.exists() and row["id"] in st.hidden()


def test_a_not_owned_row_whose_name_matches_an_owned_copy_still_deletes_nothing(st):
    copy = st.add_file("notes.pdf", b"%PDF invented")
    twin = st.make_row(source="folder", kind="file", title="notes.pdf", raw_hash="ee" * 32,
                       file={"name": copy["file"]["name"], "size": 13, "owned": False})
    st.put(twin)
    assert st.delete(twin["id"])["file"] is False and st.owned_path(copy).is_file()


def _symlink(link: Path, target: Path, is_dir=False):
    try:
        os.symlink(target, link, target_is_directory=is_dir)
    except (OSError, NotImplementedError):
        pytest.skip("this account may not make symbolic links")


def _junction(link: Path, target: Path):
    if os.name != "nt":
        pytest.skip("junctions are a Windows matter")
    import _winapi
    _winapi.CreateJunction(str(target), str(link))


def test_a_symlink_in_files_pointing_out_is_not_followed_for_deletion(st, tmp_path):
    precious = his_file(tmp_path)
    link = st.files / "0123456789ab-link.pdf"
    _symlink(link, precious)
    row = owned_row(st, link.name)
    assert st.owned_path(row) is None and st.delete(row["id"])["file"] is False
    assert precious.read_bytes() == b"keep me"


def test_a_junction_inside_files_pointing_at_his_folder_is_not_followed(st, tmp_path):
    precious = his_file(tmp_path)
    _junction(st.files / "jn", precious.parent)
    for name in ("jn/precious.pdf", "jn\\precious.pdf", "jn"):
        row = owned_row(st, name, digest="f1")
        assert st.owned_path(row) is None and st.delete(row["id"])["file"] is False
    assert precious.read_bytes() == b"keep me" and precious.parent.is_dir()


def test_files_itself_swapped_for_a_junction_to_his_folder_owns_nothing(tmp_path):
    precious = his_file(tmp_path)
    root = tmp_path / "intake"
    root.mkdir()
    _junction(root / "files", precious.parent)        # before the store makes a real files/ folder
    st = S.IntakeStore(root)
    row = owned_row(st, "precious.pdf")
    assert st.owned_path(row) is None and st.delete(row["id"])["file"] is False
    assert precious.read_bytes() == b"keep me"


def test_files_itself_swapped_for_a_symlink_owns_nothing(tmp_path):
    precious = his_file(tmp_path)
    root = tmp_path / "intake"
    root.mkdir()
    _symlink(root / "files", precious.parent, is_dir=True)
    st = S.IntakeStore(root)
    row = owned_row(st, "precious.pdf")
    assert st.owned_path(row) is None and st.delete(row["id"])["file"] is False and precious.exists()


def test_delete_of_an_unknown_row_is_a_keyerror(st):
    with pytest.raises(KeyError):
        st.delete("i-aaaaaaaaaaaa")


# ------------------------------------------------------------------ suggestions
def test_suggest_offers_the_best_subject_at_point_six_and_nothing_below():
    subs = [("sig", "Signals and Systems"), ("thermo", "Thermal Physics")]
    s = S.suggest("Signals and Systems quiz", subs)
    assert s == {"subject": "sig", "score": 0.75}
    assert S.suggest("Gizmo carnival", subs) is None
    assert S.suggest("Signals quiz", subs) is None            # 1 of 4 tokens: 0.25, below the line
    assert S.suggest("anything", []) is None


def test_check_date_and_time_refuse_nonsense():
    assert S.check_date("2026-11-18") == "2026-11-18"
    for bad in ("18/11/2026", "2026-13-40", 5, None, ""):
        with pytest.raises(ValueError):
            S.check_date(bad)
    assert S.check_time("") is None and S.check_time(None) is None and S.check_time("17:30") == "17:30"
    for bad in ("25:00", "5pm", "7:30", 1730):
        with pytest.raises(ValueError):
            S.check_time(bad)


# ------------------------------------------------------------------ folder rows (acceptance 3, store half)
def test_folder_rows_list_unread_files_as_unowned_unstored_rows(st, tmp_path):
    pyq = Store(tmp_path / "pyq")
    his = tmp_path / "watched"
    his.mkdir()
    (his / "paper one.pdf").write_bytes(b"%PDF-1.4 invented one")
    (his / "notes.txt").write_bytes(b"not a paper")
    folder.set_folder(pyq, str(his))
    rows = S.folder_rows(st, pyq)
    assert [r["title"] for r in rows] == ["paper one.pdf"]
    r = rows[0]
    assert set(r) == ROW_KEYS and r["source"] == "folder" and r["kind"] == "file" and r["state"] == "new"
    assert r["file"] == {"name": "paper one.pdf", "size": 21, "owned": False}
    assert st.list_rows() == []                        # not stored until he acts on it
    assert S.file_path(st, r, pyq) == his / "paper one.pdf"
    st.dismiss(r["id"])
    assert S.folder_rows(st, pyq) == []


def test_folder_rows_without_a_chosen_folder_is_empty(st, tmp_path):
    assert S.folder_rows(st, Store(tmp_path / "pyq")) == []


def test_file_path_refuses_a_folder_row_that_names_a_path(st, tmp_path):
    pyq = Store(tmp_path / "pyq")
    his = tmp_path / "watched"
    his.mkdir()
    folder.set_folder(pyq, str(his))
    his_file(tmp_path)
    for name in ("../his own folder/precious.pdf", "..", str(tmp_path / "his own folder" / "precious.pdf")):
        row = st.make_row(source="folder", kind="file", title="x", raw_hash="aa" * 32,
                          file={"name": name, "size": 1, "owned": False})
        assert S.file_path(st, row, pyq) is None
    date_row = st.make_row(source="paste", kind="deadline", title="x", raw_hash="bb" * 32)
    assert S.file_path(st, date_row, pyq) is None


@pytest.mark.parametrize("top", ["\\\\invented-host\\share\\papers", "//invented-host/share/papers",
                                 "\\\\?\\C:\\invented\\papers"])
def test_take_of_a_folder_row_never_touches_a_network_or_device_path(st, tmp_path, monkeypatch, top):
    """A stat on a UNC name opens an SMB connection and offers his Windows login to that host, so the path must
    be refused before any file call; the notes library's check_path has no such rule of its own."""
    monkeypatch.setattr(folder, "get_folder", lambda _s: {"path": top, "exists": True})

    def touched(_p):
        raise AssertionError("the file system was asked about a network path")
    monkeypatch.setattr(S, "_is_link", touched)
    monkeypatch.setattr(Path, "is_file", lambda _p: touched(_p))
    row = st.make_row(source="folder", kind="file", title="paper.pdf", raw_hash="cc" * 32,
                      file={"name": "paper.pdf", "size": 1, "owned": False})
    assert S.file_path(st, row, Store(tmp_path / "pyq")) is None


def test_default_store_follows_paths_data(monkeypatch, tmp_path):
    from jarvis_app import paths
    monkeypatch.setattr(paths, "DATA", tmp_path / "d1")
    assert S.default_store().root == tmp_path / "d1" / "intake"
    monkeypatch.setattr(paths, "DATA", tmp_path / "d2")
    assert S.default_store().root == tmp_path / "d2" / "intake"


def test_a_row_edited_by_hand_without_its_date_or_state_is_mended_and_said_once(tmp_path):
    import json
    from jarvis_app.ww_intake import store as S
    root = tmp_path / "intake"
    root.mkdir()
    good = {"id": "i-" + "a" * 12, "source": "paste", "kind": "deadline", "state": "accepted", "title": "Lab record", "added": "2026-11-20T10:00:00"}
    bare = {"id": "i-" + "b" * 12, "source": "paste", "kind": "deadline", "title": "No date, no state"}
    assert S.valid_id(good["id"]) and S.valid_id(bare["id"])
    (root / "rows.json").write_text(json.dumps({"version": S.SCHEMA_VERSION, "rows": [good, bare]}), encoding="utf-8")
    st = S.IntakeStore(root)
    rows = st.list_rows()
    assert [r["id"] for r in sorted(rows, key=lambda r: (r["added"], r["id"]))] == [bare["id"], good["id"]]
    mended = next(r for r in rows if r["id"] == bare["id"])
    assert mended["added"] == "" and mended["state"] == "new"
    st.list_rows()
    st.list_rows()
    assert len([p for p in st.problems if "no date or state" in p]) == 1, "said once, however often the file is read"



# ------------------------------------------------------------------ request 20
def test_a_problem_goes_once_rows_json_reads_cleanly_again(tmp_path):
    root = tmp_path / "intake"
    st = S.IntakeStore(root)
    (root / "rows.json").write_text("{not json", encoding="utf-8")
    st.list_rows()
    assert st.problems
    st.list_rows()                                   # the file is set aside and missing: the notice still shows
    assert st.problems
    st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))
    st.list_rows()                                   # written anew and read cleanly: the set-aside notice stays,
    assert any(".corrupt" in p for p in st.problems)  # the only pointer at the copy he can still recover
    st.clear_problems()                              # until he dismisses it
    assert st.problems == []
    bare = {"id": "i-" + "c" * 12, "source": "paste", "kind": "deadline", "title": "No state"}
    (root / "rows.json").write_text(json.dumps({"version": S.SCHEMA_VERSION, "rows": [bare]}), encoding="utf-8")
    st.list_rows()
    assert any("no date or state" in p for p in st.problems)
    st.update(bare["id"], {"state": "new"})          # the mend is saved; the next read is clean
    st.list_rows()
    assert st.problems == []


def test_a_pasted_row_keeps_its_line_and_a_calendar_row_keeps_none(st):
    line = "Widget lab report due 2026-11-20"
    r = st.add_paste(parse_paste(line, NOW))[0]
    assert r["raw"] == line
    long = "Gizmo quiz 2026-11-22 " + "x" * 700
    assert len(st.add_paste(parse_paste(long, NOW))[0]["raw"]) == S.MAX_RAW == 500
    ev = st.add_events(parse_ics(cal(vev("UID:z@x", "SUMMARY:Gizmo seminar", "DTSTART:20261120T090000Z")), NOW),
                       today=TODAY)[0][0]
    assert ev["raw"] == ""
    assert st.update(r["id"], {"raw": "changed"})["raw"] == line      # what he pasted is fixed


def test_the_set_aside_notice_outlives_a_mended_notice(tmp_path):
    root = tmp_path / "intake"
    st = S.IntakeStore(root)
    (root / "rows.json").write_text("{not json", encoding="utf-8")
    st.list_rows()
    bare = {"id": "i-" + "d" * 12, "source": "paste", "kind": "deadline", "title": "No state"}
    (root / "rows.json").write_text(json.dumps({"version": S.SCHEMA_VERSION, "rows": [bare]}), encoding="utf-8")
    st.list_rows()
    st.update(bare["id"], {"state": "new"})
    st.list_rows()
    assert len(st.problems) == 1 and ".corrupt" in st.problems[0]


def test_update_refuses_under_the_lock_when_the_state_moved_on(st):
    rid = st.add_paste(parse_paste("Widget lab report due 2026-11-20", NOW))[0]["id"]
    st.update(rid, {"state": "taken"})
    with pytest.raises(ValueError):
        st.update(rid, {"state": "new"}, expect=("accepted", "declined"))
    assert st.get(rid)["state"] == "taken"
    row = st.get(rid)
    with pytest.raises(ValueError):                  # a folder row stored by a take in between is not put back
        st.put({**row, "state": "accepted"}, expect=("new", "accepted", "declined"))
    assert st.get(rid)["state"] == "taken"

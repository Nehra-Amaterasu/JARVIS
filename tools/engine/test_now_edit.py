"""now_edit can change the engine lane's section and add a log line, and nothing else.

Run: python -m pytest tools/engine/test_now_edit.py -q  (invented text; the real state file is never read).
"""
from datetime import datetime
from pathlib import Path

import pytest

import now_edit

TEXT = """# state

## 4. Another chat
- **Next:** the other chat's next step
- **Engine now:** a decoy with the same name, outside section 9

## 6. Log (newest first, one line each)
- 2026-11-13 an older line

## 8. Something else
- **Next:** another decoy

## 9. Engine lane (the engine chat)

- **Engine now:** old
- **Engine next:** old next
"""
NOW = datetime(2026, 11, 14, 21, 30)


def test_set_changes_only_the_bullet_inside_section_9():
    out = now_edit.set_bullet(TEXT, "Engine now", "new   text")
    assert "- **Engine now:** new text\n- **Engine next:** old next" in out
    cut = out.index("## 9. Engine lane")
    assert out[:cut] == TEXT[:TEXT.index("## 9. Engine lane")]          # the decoys above are untouched
    assert out.count("- **Next:** the other chat's next step") == 1


def test_a_bullet_named_like_another_sections_is_not_found_outside_section_9():
    with pytest.raises(ValueError):
        now_edit.set_bullet(TEXT, "Next", "must not land in section 4 or 8")      # the 14 Nov mistake, pinned


def test_a_missing_or_doubled_heading_stops_the_edit():
    with pytest.raises(ValueError):
        now_edit.set_bullet(TEXT.replace("## 9. Engine lane", "## 9. Renamed"), "Engine now", "x")
    with pytest.raises(ValueError):
        now_edit.set_bullet(TEXT + "\n## 9. Engine lane again\n- **Engine now:** twice\n", "Engine now", "x")
    with pytest.raises(ValueError):
        now_edit.add_log(TEXT.replace("## 6. Log", "## 6. Journal"), "a line", NOW)


def test_log_adds_one_line_directly_under_the_heading():
    out = now_edit.add_log(TEXT, "  stage   2 merged ", NOW)
    assert "## 6. Log (newest first, one line each)\n- 2026-11-14 engine lane (21:30): stage 2 merged\n- 2026-11-13 an older line" in out
    assert len(out.splitlines()) == len(TEXT.splitlines()) + 1


def test_the_file_keeps_its_line_endings_and_everything_else(tmp_path: Path, monkeypatch):
    f = tmp_path / "NOW.md"
    f.write_bytes(TEXT.replace("\n", "\r\n").encode("utf-8"))
    monkeypatch.setenv("STATE_FILE", str(f))
    assert now_edit.main(["set", "Engine next", "the wave after"]) == 0
    assert now_edit.main(["log", "a line"]) == 0
    raw = f.read_bytes().decode("utf-8")
    assert "\r\n" in raw and "\n" not in raw.replace("\r\n", "")
    text = raw.replace("\r\n", "\n")
    assert "- **Engine next:** the wave after" in text and "- **Next:** another decoy" in text
    assert len(text.splitlines()) == len(TEXT.splitlines()) + 1

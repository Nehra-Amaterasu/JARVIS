"""The public repo holds no personal data, and no commit carries AI attribution.

Runs the scanner in tests/repo_privacy.py over every tracked file. The name check
needs the private store (data/, git-ignored); on a machine without it, that part is
skipped and said so. The detectors are also tested on synthetic text, so a broken
pattern cannot pass silently by finding nothing.
"""
import pytest

import check_commits
import repo_privacy as rp


def test_no_tracked_file_holds_personal_data():
    found = rp.scan()
    assert not found, "personal data in tracked files (file:line kind [sha256 prefix]):\n" + "\n".join(map(str, found))


def test_the_name_check_ran_against_the_private_store():
    store = rp.private_dir()
    if store is None:
        pytest.skip("no private store on this machine: names not checked")
    names, own = rp.private_names(store)
    assert len(names) >= 20                    # the people list was really read


# ------------------------------------------------------------------ the detectors themselves
# Synthetic values only: valid-looking, belonging to no one.
@pytest.mark.parametrize("line, kind", [
    ("call him on " + "9123" + "456780 tonight", "phone"),
    ("+91 " + "91234 " + "56780", "phone"),
    ("+91-" + "9123" + "456780", "phone"),
    ("roll: J" + "123456789", "register"),
    ("token = github_pat_" + "A1" * 20, "key"),
    ("GH=ghp_" + "a" * 36, "key"),
    ("secret: " + "ab12" * 16, "key"),
    ("KEC-" + "501 backlog cleared on the second try", "marks"),
    ("Scored 38 in " + "BAS" + "103", "marks"),
])
def test_each_detector_fires_on_a_synthetic_value(line, kind):
    kinds = {f.kind for f in rp.scan_text("x.md", line, set())}
    assert kind in kinds


@pytest.mark.parametrize("line", [
    "timestamp 1792762954 in ms",              # unix time starts with 1
    "the build id is 61234567890123",          # longer than a phone number
    "sha256 of the archive:",
    "port COM8 at 115200 baud",
    "KEC-501 is Digital Electronics",          # a subject code alone is fine
    "version 3.4.0 released",
])
def test_ordinary_text_is_not_a_finding(line):
    assert list(rp.scan_text("x.md", line, set())) == []


def test_a_labelled_digest_is_not_a_secret():
    text = "- Registry archive: 376,319 bytes, sha256\n  `" + "0f" * 32 + "`."
    assert list(rp.scan_text("ORIGIN.md", text, set())) == []


def test_names_are_compared_as_hashes_and_reported_without_the_value():
    names = {rp.h("Zorawarine")}               # an invented name
    found = list(rp.scan_text("notes.md", "met Zorawarine at the library", names))
    assert [f.kind for f in found] == ["name"]
    assert "Zorawarine" not in str(found[0]) and found[0].digest == rp.h("zorawarine")[:12]


def test_an_allow_entry_can_be_limited_to_one_file():
    f = rp.Finding("a/b.py", 3, "name", "abc123abc123")
    assert rp.allowed(f, {("name", "abc123abc123")})
    assert rp.allowed(f, {("name", "abc123abc123", "a/b.py")})
    assert not rp.allowed(f, {("name", "abc123abc123", "other.py")})


# ------------------------------------------------------------------ commit messages
def test_no_commit_carries_ai_attribution():
    bad = [(c["sha"][:7], p) for c in check_commits.commits("HEAD") for p in check_commits.problems(c)]
    assert not bad, bad


@pytest.mark.parametrize("body, ok", [
    ("fix(core): the guard\n\nIn the 10-10 session JARVIS promised to upload a file to Claude.", True),
    ("feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", False),
    ("feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)", False),
    ("feat: x\n\nCo-authored-by: a friend <friend@example.com>", True),
])
def test_the_trailer_check(body, ok):
    c = {"sha": "0" * 40, "author": check_commits.AUTHOR, "email": "me@example.com", "body": body}
    assert (check_commits.problems(c) == []) is ok

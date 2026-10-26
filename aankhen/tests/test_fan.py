"""fan.FanLines.remove_lines: the whole matrix through one cached pseudo-inverse must
give what the per-column least-squares fit gave (council review 2026-10-26)."""
import numpy as np

from aankhen.fan import FS, MIN_LINE_HZ, FanLines


def _per_column_lstsq(lines, x):
    """The notch as it was before 2026-10-26: A rebuilt and one lstsq per series."""
    n = x.size
    t = np.arange(n) / FS
    cols = [np.ones(n)]
    for f in lines:
        if MIN_LINE_HZ <= f < FS / 2 - 0.5:
            w = 2 * np.pi * f * t
            cols += [np.cos(w), np.sin(w)]
    A = np.stack(cols, axis=1)
    coef, *_ = np.linalg.lstsq(A, x, rcond=None)
    return x - A @ coef


def _locked(lines):
    fl = FanLines()
    fl.locked, fl.lines = True, list(lines)
    return fl


def test_matrix_equals_per_column_fit():
    rng = np.random.default_rng(3)
    t = np.arange(300) / FS
    lines = [3.1, 7.7, 11.9, 23.0, 0.5, 49.8]          # the last two are skipped (outside the band)
    C = rng.standard_normal((300, 6)) + 0.4 * np.sin(2 * np.pi * 7.7 * t)[:, None]
    fl = _locked(lines)
    ref = np.stack([_per_column_lstsq(lines, C[:, j]) for j in range(6)], axis=1)
    got = fl.remove_lines(C)
    assert got.shape == C.shape
    assert np.max(np.abs(got - ref)) < 1e-12
    # one series still works, and agrees too
    assert np.max(np.abs(fl.remove_lines(C[:, 2]) - ref[:, 2])) < 1e-12


def test_rank_deficient_lines_are_cut_like_lstsq():
    # two lines a hundredth of a bin apart: A is numerically rank-deficient
    rng = np.random.default_rng(4)
    lines = [5.0, 5.0, 12.25]
    C = rng.standard_normal((256, 3))
    fl = _locked(lines)
    ref = np.stack([_per_column_lstsq(lines, C[:, j]) for j in range(3)], axis=1)
    assert np.max(np.abs(fl.remove_lines(C) - ref)) < 1e-12


def test_cache_follows_the_lines_and_the_length():
    rng = np.random.default_rng(5)
    fl = _locked([4.0, 9.0])
    a = rng.standard_normal((300, 2))
    fl.remove_lines(a)
    fl.lines = [6.0]                                    # a new estimate moved the lines
    assert np.max(np.abs(fl.remove_lines(a) - np.stack(
        [_per_column_lstsq([6.0], a[:, j]) for j in range(2)], axis=1))) < 1e-12
    b = rng.standard_normal(128)                        # a shorter window
    assert np.max(np.abs(fl.remove_lines(b) - _per_column_lstsq([6.0], b))) < 1e-12


def test_unlocked_passes_through():
    x = np.arange(10.0)
    assert np.array_equal(FanLines().remove_lines(x), x)

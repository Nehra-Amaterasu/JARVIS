import numpy as np
import pytest

from aankhen.csi import (
    LLTF_KEEP, CsiConditioner, HampelFilter, Sample, UniformResampler, amplitudes,
    bin_of, normalise, subcarrier_of,
)


def _raw_from(amp_by_bin, phase=0.0):
    """Build a 128-byte LLTF buffer: interleaved (imag, real) int8 per bin."""
    out = bytearray()
    for a in amp_by_bin:
        out += bytes([int(round(a * np.sin(phase))) & 0xFF, int(round(a * np.cos(phase))) & 0xFF])
    return bytes(out)


def test_subcarrier_mapping_is_fft_order():
    assert [subcarrier_of(k) for k in (0, 1, 31, 32, 63)] == [0, 1, 31, -32, -1]
    assert all(subcarrier_of(bin_of(s)) == s for s in range(-32, 32))


def test_keep_set_is_51_and_excludes_dc_guard_and_invalid():
    assert len(LLTF_KEEP) == 51
    for s in (0, 1, -27, 27, -32, 31):
        assert s not in LLTF_KEEP


def test_imaginary_comes_first():
    # Only bin 2 (s=+2) carries signal: imag=3, real=4 -> amplitude 5.
    raw = bytearray(128)
    raw[2 * 2], raw[2 * 2 + 1] = 3, 4
    amp = amplitudes(bytes(raw))
    assert amp[LLTF_KEEP.index(2)] == 5.0


def test_negative_int8_values_decode_signed():
    raw = bytearray(128)
    raw[2 * 2], raw[2 * 2 + 1] = (-3) & 0xFF, (-4) & 0xFF
    assert amplitudes(bytes(raw))[LLTF_KEEP.index(2)] == 5.0


def test_guard_band_energy_is_ignored():
    amp_by_bin = np.zeros(64)
    amp_by_bin[bin_of(30)] = 100                  # guard band: must not leak in
    amp_by_bin[bin_of(5)] = 10
    a = amplitudes(_raw_from(amp_by_bin))
    assert a.max() == pytest.approx(10, abs=1)


def test_short_buffer_rejected_and_ht_ltf_tail_ignored():
    assert amplitudes(bytes(100)) is None
    base = _raw_from(np.full(64, 20))
    assert np.allclose(amplitudes(base + bytes(128)), amplitudes(base))   # 256-B capture


def test_normalise_removes_gain_steps():
    a = np.linspace(5, 15, 51)
    assert np.allclose(normalise(a), normalise(a * 3.7))   # AGC step -> identical
    assert normalise(np.zeros(51)) is None


# ------------------------------------------------------------- resampler
def test_resampler_regular_input_passes_through():
    r = UniformResampler(100)
    out = []
    for i in range(10):
        out += r.push(i * 0.01, np.ones(51))
    # a slot is emitted when the next one starts: 10 packets -> 9 samples so far
    assert len(out) == 9 and not any(s.filled for s in out)


def test_resampler_fills_short_gap_and_reports_it():
    r = UniformResampler(100, max_gap_s=0.25)
    out = r.push(0.0, np.ones(51)) + r.push(0.05, np.ones(51) * 2) + r.push(0.06, np.ones(51))
    assert len(out) == 6                           # slot 0, 4 filled, slot 5
    assert sum(s.filled for s in out) == 4
    assert r.fill_ratio() > 0


def test_resampler_breaks_on_long_gap_instead_of_inventing_data():
    r = UniformResampler(100, max_gap_s=0.25)
    r.push(0.0, np.ones(51))
    out = r.push(1.0, np.ones(51))                 # 1 s gap: must not fill 99 slots
    assert len(out) == 1 and not out[0].filled and r.gaps == 1


def test_resampler_averages_packets_in_the_same_slot():
    r = UniformResampler(100)
    r.push(0.0, np.ones(51), level_db=-70.0)
    assert r.push(0.004, np.ones(51) * 3, level_db=-72.0) == []
    out = r.push(0.01, np.ones(51))
    assert r.averaged == 1 and r.dropped_same_slot == 0
    assert np.allclose(out[0].amp, 2.0) and out[0].level_db == -71.0


def test_averaging_fast_packets_keeps_a_fan_out_of_the_human_band():
    """A fan harmonic at 92.3 Hz, sampled once per 10 ms, folds to 7.7 Hz; sampled at
    500 Hz and averaged per 10 ms slot it is attenuated ~20x before it can fold."""
    f_fan, fs = 92.3, 500.0
    def run(rate):
        r = UniformResampler(100)
        out = []
        for i in range(int(4 * rate)):
            t = i / rate
            out += r.push(t, np.ones(51) * (1 + 0.1 * np.sin(2 * np.pi * f_fan * t)))
        x = np.array([s.amp[0] for s in out]) - 1
        return np.abs(np.fft.rfft(x * np.hanning(len(x)))).max()
    assert run(fs) < run(100.0) / 10


# ---------------------------------------------------------------- hampel
def test_hampel_removes_single_spike_keeps_shape():
    h = HampelFilter(7, 5.0)
    rng = np.random.default_rng(0)
    vals = [np.full(51, 1.0) + rng.normal(0, 0.01, 51) for _ in range(20)]
    vals[10] = vals[10].copy()
    vals[10][7] = 9.0                              # one-packet glitch on one subcarrier
    out = [o for v in vals for o in [h.push(Sample(0, v, False))] if o is not None]
    assert max(o.amp[7] for o in out) < 1.2
    assert h.replaced >= 1


def test_hampel_lets_a_real_sustained_change_through():
    h = HampelFilter(7, 5.0)
    vals = [np.full(51, 1.0)] * 10 + [np.full(51, 2.0)] * 10   # body moves into the path
    out = [o for v in vals for o in [h.push(Sample(0, v, False))] if o is not None]
    assert out[-1].amp[0] == pytest.approx(2.0)


# ---------------------------------------------------------------- chain
def test_conditioner_end_to_end_and_rate_measurement():
    c = CsiConditioner(100)
    rng = np.random.default_rng(1)
    got = []
    for i in range(300):
        t = i * 0.0125 + rng.normal(0, 0.001)      # ~80 Hz with jitter
        got += c.push(t, _raw_from(20 + rng.normal(0, 1, 64)), rssi=-55)
    assert 70 < c.rate.hz < 90                     # measured, not assumed
    assert len(got) > 300                          # resampled up to the 100 Hz grid
    assert all(s.amp.shape == (51,) for s in got)


# ---------------------------------------------------------------- vectorised hampel (2026-10-26)
def _spiky(n, seed=0, frac=0.03):
    rng = np.random.default_rng(seed)
    X = 1.0 + 0.02 * rng.standard_normal((n, 51))
    hit = rng.random((n, 51)) < frac                       # 1-5 % one-sample glitches
    X[hit] += rng.choice([-1, 1], hit.sum()) * rng.uniform(0.2, 3.0, hit.sum())
    return [Sample(i * 0.01, X[i], bool(i % 17 == 0), -50.0 - i % 3, i % 2 == 0) for i in range(n)]


def _stream(samples):
    h = HampelFilter()
    return h, [h.push(s) for s in samples]


def test_median7_network_is_the_sorted_middle():
    import itertools
    from aankhen.csi import _median7
    bits = np.array(list(itertools.product([0.0, 1.0], repeat=7)))   # the 0-1 principle
    assert np.array_equal(_median7(list(bits.T)), np.sort(bits, axis=1)[:, 3])
    r = np.random.default_rng(0).random((7, 5000))
    assert np.array_equal(_median7(list(r)), np.sort(r, axis=0)[3])


@pytest.mark.parametrize("n,frac", [(3, 0.03), (7, 0.03), (263, 0.01), (600, 0.05)])
def test_hampel_array_equals_streaming(n, frac):
    from aankhen.csi import hampel_array
    samples = _spiky(n, seed=n, frac=frac)
    h, want = _stream(samples)
    Y, bad = hampel_array(np.stack([s.amp for s in samples]))
    got = [w for w in want if w is not None]
    assert Y.shape[0] == len(got) == max(n - 6, 0)
    if got:
        assert np.array_equal(Y, np.stack([w.amp for w in got]))
        assert int(bad.sum()) == h.replaced > 0 or frac * n < 1


def test_push_many_equals_push_and_can_be_mixed():
    samples = _spiky(900, seed=4)
    ref, want = _stream(samples)
    h = HampelFilter()
    got = h.push_many(samples[:2]) + [h.push(s) for s in samples[2:9]] + h.push_many(samples[9:300]) \
        + h.push_many([]) + h.push_many(samples[300:301]) + [h.push(s) for s in samples[301:320]] \
        + h.push_many(samples[320:])
    assert len(got) == len(want)
    for a, b in zip(got, want):
        assert (a is None) == (b is None)
        if a is not None:
            assert np.array_equal(a.amp, b.amp)
            assert (a.t, a.filled, a.level_db, a.level_fine) == (b.t, b.filled, b.level_db, b.level_fine)
    assert (h.replaced, h.seen) == (ref.replaced, ref.seen)


def _bursty_records(seconds=12.0, seed=0):
    """(host time, bytes) chunks as a weak link delivers them: 100 ms of packets per
    chunk, each chunk up to 0.8 s late (fingerprint's regression fixture, stretched)."""
    from aankhen.tests.test_links import _csi_pkt
    rng = np.random.default_rng(seed)
    pkts = [_csi_pkt(5.0 + i * 0.005, rng, seq=i) for i in range(int(seconds * 200))]
    host0, out = 1_700_000_000.0, []
    for k in range(0, len(pkts), 20):
        chunk = b"".join(p.to_frame().encode() for p in pkts[k:k + 20])
        out.append((host0 + pkts[k + 19].timestamp_us / 1e6 - 5.0 + 0.01 + rng.uniform(0, 0.8), chunk))
    return out


def test_board_time_samples_match_fingerprint_csi_stream():
    """The batch reader stamps and cleans exactly as fingerprint.csi_stream does."""
    from aankhen.csi import board_time_samples
    from aankhen.fingerprint import csi_stream
    recs = _bursty_records()
    want = list(csi_stream(recs))
    got = list(board_time_samples(recs, batch=97))
    assert len(got) == len(want) > 1000
    assert np.array_equal([g[0] for g in got], [w[0] for w in want])
    assert np.array_equal(np.stack([g[1].amp for g in got]), np.stack([w[1] for w in want]))
    assert [g[1].filled for g in got] == [w[2] for w in want]
    assert all(g[2] == -50 for g in got)                       # the packets' rssi rides along
    # stamped by the board clock: 10 ms apart, even though chunks arrived up to 0.8 s late;
    # only the few times the minimum offset drops (a record-early chunk) step back.
    # Chunk-arrival stamps would give 0 between the 10 samples of one chunk (90 % zeros).
    d = np.diff([g[0] for g in got])
    assert np.mean(np.abs(d - 0.01) < 1e-6) > 0.95 and d.min() > -0.81


def test_board_time_samples_skip_a_malformed_payload():
    from aankhen.csi import board_time_samples
    from aankhen.protocol import CsiPacket
    recs = _bursty_records(2.0)
    bad = CsiPacket(5_000_000, 0, -50, -92, 6, 0, 1, 0, 0, 1, b"\x00" * 6, b"\x01")
    frame = bad.to_frame()
    frame.payload = frame.payload[:-1]                     # shorter than its metadata
    recs.insert(3, (recs[3][0], frame.encode()))
    assert len(list(board_time_samples(recs))) > 100


def test_the_gain_branch_median_by_partition_is_bit_identical():
    """np.partition for the 51-value median (council hearing 2, code item 2): same bits as
    np.median for odd n, so every level and normalised amplitude is unchanged."""
    import numpy as np
    from aankhen.csi import CsiConditioner
    rng = np.random.default_rng(3)
    for _ in range(2000):
        a = np.abs(rng.normal(30, 9, 51)) * 10 ** (rng.uniform(-3, 9) / 20)
        assert np.array_equal(np.partition(a, 25)[25], np.median(a))
    c = CsiConditioner()
    out = []
    for k in range(300):
        iq = rng.integers(-40, 40, 128).astype(np.int8).tobytes()
        out += c.push(10 + k / 100, iq, -60, gain_comp_db=float(k % 7))
    # levels are 20 log10 of a median amplitude (~30-50 counts) plus the 0-6 dB gain
    assert out and all(25 < s.level_db < 45 for s in out)
    assert all(s.level_fine for s in out)

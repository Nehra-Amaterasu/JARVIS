"""The QR encoder behind phone pairing (jarvis_app/qr.py).

Published values pin the arithmetic; a small reader written here from the standard
(not from the encoder's tables) decodes every symbol back to its text."""
import pytest

from jarvis_app import qr

# ---------------------------------------------------------------- known answers
def test_reed_solomon_matches_the_published_hello_world_codewords():
    # Thonky's QR tutorial, "HELLO WORLD" at 1-M: 16 data codewords -> these 10 EC codewords.
    data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    assert qr.rs_remainder(data, qr.rs_divisor(10)) == [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]


def test_format_and_version_bits_match_the_standard_tables():
    assert format(qr.format_bits(0), "015b") == "101010000010010"     # level M, mask 0
    assert format(qr.format_bits(5), "015b") == "100000011001110"     # level M, mask 5
    assert format(qr.version_bits(7), "018b") == "000111110010010100"
    assert format(qr.version_bits(10), "018b") == "001010010011010011"


def test_capacity_and_version_choice():
    assert [qr.data_capacity(v) for v in (1, 4, 7, 10)] == [16, 64, 124, 216]
    assert qr.choose_version(14) == 1 and qr.choose_version(15) == 2
    assert qr.choose_version(62) == 4 and qr.choose_version(213) == 10
    with pytest.raises(ValueError):
        qr.choose_version(214)


# ---------------------------------------------------------------- an independent reader
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
         7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}
BLOCKS_M = {1: (10, [16]), 2: (16, [28]), 3: (26, [44]), 4: (18, [32, 32]), 5: (24, [43, 43]),
            6: (16, [27] * 4), 7: (18, [31] * 4), 8: (22, [38, 38, 39, 39]), 9: (22, [36, 36, 36, 37, 37]),
            10: (26, [43, 43, 43, 43, 44])}


def reserved(version):
    n = 17 + 4 * version
    r = [[False] * n for _ in range(n)]

    def box(x0, y0, x1, y1):
        for y in range(max(0, y0), min(n, y1 + 1)):
            for x in range(max(0, x0), min(n, x1 + 1)):
                r[y][x] = True
    box(0, 0, 8, 8)
    box(n - 8, 0, n - 1, 8)
    box(0, n - 8, 8, n - 1)
    box(6, 0, 6, n - 1)
    box(0, 6, n - 1, 6)
    a = ALIGN[version]
    for cx in a:
        for cy in a:
            if (cx, cy) in ((6, 6), (6, a[-1]), (a[-1], 6)):
                continue
            box(cx - 2, cy - 2, cx + 2, cy + 2)
    if version >= 7:
        box(n - 11, 0, n - 9, 5)
        box(0, n - 11, 5, n - 9)
    return r


MASKS = [lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
         lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
         lambda x, y: (x * y) % 2 + (x * y) % 3 == 0, lambda x, y: ((x * y) % 2 + (x * y) % 3) % 2 == 0,
         lambda x, y: ((x + y) % 2 + (x * y) % 3) % 2 == 0]


def read(matrix):
    n = len(matrix)
    version = (n - 17) // 4
    # format: first copy, bits 14..0 read around the top-left finder
    coords = [(8, i) for i in range(6)] + [(8, 7), (8, 8), (7, 8)] + [(14 - i, 8) for i in range(9, 15)]
    fmt = sum(int(matrix[y][x]) << i for i, (x, y) in enumerate(coords)) ^ 0x5412
    ecl, mask = fmt >> 13, (fmt >> 10) & 7
    assert ecl == 0, "level M"
    res = reserved(version)
    bits = []
    right = n - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(n):
            for j in (0, 1):
                x = right - j
                y = n - 1 - vert if ((right + 1) & 2) == 0 else vert
                if not res[y][x]:
                    bits.append(int(matrix[y][x]) ^ int(MASKS[mask](x, y)))
        right -= 2
    words = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits) - 7, 8)]
    ec, sizes = BLOCKS_M[version]
    blocks = [[] for _ in sizes]
    k = 0
    for i in range(max(sizes)):
        for b, s in enumerate(sizes):
            if i < s:
                blocks[b].append(words[k])
                k += 1
    ecs = [[] for _ in sizes]
    for _ in range(ec):
        for b in range(len(sizes)):
            ecs[b].append(words[k])
            k += 1
    for d, e in zip(blocks, ecs):
        assert qr.rs_remainder(d, qr.rs_divisor(ec)) == e, "a block's error correction does not check"
    data = [w for d in blocks for w in d]
    stream = "".join(format(w, "08b") for w in data)
    assert stream[:4] == "0100", "byte mode"
    cbits = 8 if version < 10 else 16
    count = int(stream[4:4 + cbits], 2)
    body = stream[4 + cbits:4 + cbits + 8 * count]
    return bytes(int(body[i:i + 8], 2) for i in range(0, len(body), 8)).decode("utf-8")


@pytest.mark.parametrize("text", [
    "hi",
    "http://192.168.1.23:8778/phone#pair=ABCDEFGH",
    "https://jarvis-laptop.tail1234.ts.net/phone#pair=QRSTUVWX",
    "https://a-much-longer-machine-name.tailabcdef.ts.net:8778/phone#pair=MNPQRSTU&extra=" + "x" * 60,
    "x" * 213,
])
def test_every_symbol_reads_back(text):
    m = qr.encode(text)
    n = len(m)
    assert n == 17 + 4 * qr.choose_version(len(text.encode()))
    # finder patterns in three corners, the dark module, the timing row
    for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
        assert m[cy][cx] and not m[cy - 2][cx] and m[cy - 3][cx]
    assert m[n - 8][8]
    assert [m[6][x] for x in range(8, n - 8)] == [x % 2 == 0 for x in range(8, n - 8)]
    assert read(m) == text


def test_svg_has_the_quiet_zone_and_one_path():
    s = qr.svg("http://192.168.1.23:8778/phone#pair=ABCDEFGH", scale=4)
    assert s.startswith("<svg") and s.count("<path") == 1
    n = 17 + 4 * 4 + 8                                          # version 4 + 4-module border each side
    assert f'viewBox="0 0 {n} {n}"' in s and f'width="{n * 4}"' in s

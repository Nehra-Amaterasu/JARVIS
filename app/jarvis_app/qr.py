"""A small QR code encoder: byte mode, error correction M, versions 1-10, as SVG.

Why it exists: the phone pairs by scanning a code on the desktop, and no QR library
is installed in the venv (none may be downloaded). A pairing URL is under 120 bytes,
so versions 1-10 (14 to 213 bytes at level M) are all that is needed.

The algorithm is ISO/IEC 18004 as laid out in Project Nayuki's reference encoder
(https://www.nayuki.io/page/qr-code-generator-library): Reed-Solomon over GF(256)
(polynomial 0x11D), blocks interleaved, function patterns, the zig-zag data walk,
all eight masks scored with the four penalty rules, BCH-coded format and version
bits. Checked in app/tests/test_qr.py against published values (the Thonky
"HELLO WORLD" codewords, the format bits for M/mask 0, the version-7 bits) and by
decoding every symbol back with an independent reader.
"""
from __future__ import annotations

# version -> (EC codewords per block, [(blocks, data codewords per block), ...]) at level M
_M_BLOCKS = {
    1: (10, [(1, 16)]), 2: (16, [(1, 28)]), 3: (26, [(1, 44)]), 4: (18, [(2, 32)]),
    5: (24, [(2, 43)]), 6: (16, [(4, 27)]), 7: (18, [(4, 31)]), 8: (22, [(2, 38), (2, 39)]),
    9: (22, [(3, 36), (2, 37)]), 10: (26, [(4, 43), (1, 44)]),
}
_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
          7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}
_FORMAT_M = 0b00                                 # error-correction level M in the format bits
MAX_VERSION = 10


# ---------------------------------------------------------------- Reed-Solomon
def _gf_mul(x: int, y: int) -> int:
    z = 0
    for i in range(7, -1, -1):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z & 0xFF


def rs_divisor(degree: int) -> list[int]:
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def rs_remainder(data: list[int], divisor: list[int]) -> list[int]:
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


# ---------------------------------------------------------------- bits
def format_bits(mask: int, ecl: int = _FORMAT_M) -> int:
    data = (ecl << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412


def version_bits(version: int) -> int:
    rem = version
    for _ in range(12):
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
    return (version << 12) | rem


def data_capacity(version: int) -> int:
    """Data codewords at level M."""
    return sum(n * k for n, k in _M_BLOCKS[version][1])


def choose_version(n_bytes: int) -> int:
    for v in range(1, MAX_VERSION + 1):
        count_bits = 8 if v < 10 else 16
        if 4 + count_bits + 8 * n_bytes <= data_capacity(v) * 8:
            return v
    raise ValueError(f"{n_bytes} bytes is too long for a version-{MAX_VERSION} QR code")


def encode_data(payload: bytes, version: int) -> list[int]:
    """Mode, count, bytes, terminator and padding -> data codewords."""
    cap = data_capacity(version) * 8
    bits: list[int] = []

    def put(value: int, n: int) -> None:
        bits.extend((value >> i) & 1 for i in range(n - 1, -1, -1))
    put(0b0100, 4)
    put(len(payload), 8 if version < 10 else 16)
    for b in payload:
        put(b, 8)
    put(0, min(4, cap - len(bits)))
    put(0, (-len(bits)) % 8)
    pad = 0xEC
    while len(bits) < cap:
        put(pad, 8)
        pad ^= 0xEC ^ 0x11
    return [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]


def interleave(data: list[int], version: int) -> list[int]:
    ec_len, groups = _M_BLOCKS[version]
    divisor = rs_divisor(ec_len)
    blocks, k = [], 0
    for n, size in groups:
        for _ in range(n):
            blk = data[k:k + size]
            k += size
            blocks.append((blk, rs_remainder(blk, divisor)))
    out = []
    for i in range(max(len(b) for b, _ in blocks)):
        out.extend(b[i] for b, _ in blocks if i < len(b))
    for i in range(ec_len):
        out.extend(e[i] for _, e in blocks)
    return out


# ---------------------------------------------------------------- the symbol
class _Symbol:
    def __init__(self, version: int):
        self.version = version
        self.size = 17 + 4 * version
        self.mod = [[False] * self.size for _ in range(self.size)]
        self.fn = [[False] * self.size for _ in range(self.size)]
        self._draw_function_patterns()

    def _set(self, x: int, y: int, dark: bool) -> None:
        self.mod[y][x] = dark
        self.fn[y][x] = True

    def _draw_function_patterns(self) -> None:
        s = self.size
        for i in range(s):
            self._set(6, i, i % 2 == 0)
            self._set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (s - 4, 3), (3, s - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < s and 0 <= y < s:
                        dist = max(abs(dx), abs(dy))
                        self._set(x, y, dist not in (2, 4))
        pos = _ALIGN[self.version]
        last = len(pos) - 1
        for i, ax in enumerate(pos):
            for j, ay in enumerate(pos):
                if (i, j) in ((0, 0), (0, last), (last, 0)):
                    continue                       # those corners hold finders
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self._set(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self._draw_format(0)                       # reserve; drawn for real after masking
        if self.version >= 7:
            bits = version_bits(self.version)
            for i in range(18):
                bit = (bits >> i) & 1 == 1
                a, b = s - 11 + i % 3, i // 3
                self._set(a, b, bit)
                self._set(b, a, bit)

    def _draw_format(self, mask: int) -> None:
        bits = format_bits(mask)
        s = self.size

        def bit(i: int) -> bool:
            return (bits >> i) & 1 == 1
        for i in range(6):
            self._set(8, i, bit(i))
        self._set(8, 7, bit(6))
        self._set(8, 8, bit(7))
        self._set(7, 8, bit(8))
        for i in range(9, 15):
            self._set(14 - i, 8, bit(i))
        for i in range(8):
            self._set(s - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self._set(8, s - 15 + i, bit(i))
        self._set(8, s - 8, True)                  # the dark module

    def place(self, codewords: list[int]) -> None:
        s, i, total = self.size, 0, len(codewords) * 8
        right = s - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(s):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = s - 1 - vert if upward else vert
                    if not self.fn[y][x] and i < total:
                        self.mod[y][x] = (codewords[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            right -= 2

    def apply_mask(self, mask: int) -> None:
        for y in range(self.size):
            for x in range(self.size):
                if not self.fn[y][x] and mask_bit(mask, x, y):
                    self.mod[y][x] = not self.mod[y][x]

    def penalty(self) -> int:
        s, m, score = self.size, self.mod, 0
        lines = [row for row in m] + [[m[y][x] for y in range(s)] for x in range(s)]
        finder_a = [True, False, True, True, True, False, True, False, False, False, False]
        finder_b = finder_a[::-1]
        for line in lines:
            run, prev = 0, None
            for v in line:
                if v == prev:
                    run += 1
                else:
                    if run >= 5:
                        score += run - 2
                    run, prev = 1, v
            if run >= 5:
                score += run - 2
            for k in range(s - 10):
                window = line[k:k + 11]
                if window == finder_a or window == finder_b:
                    score += 40
        for y in range(s - 1):
            for x in range(s - 1):
                c = m[y][x]
                if c == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    score += 3
        dark = sum(v for row in m for v in row)
        total = s * s
        k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
        return score + max(0, k) * 10


def mask_bit(mask: int, x: int, y: int) -> bool:
    return [
        (x + y) % 2 == 0,
        y % 2 == 0,
        x % 3 == 0,
        (x + y) % 3 == 0,
        (x // 3 + y // 2) % 2 == 0,
        x * y % 2 + x * y % 3 == 0,
        (x * y % 2 + x * y % 3) % 2 == 0,
        ((x + y) % 2 + x * y % 3) % 2 == 0,
    ][mask]


def encode(text: str) -> list[list[bool]]:
    """The QR matrix for `text` (UTF-8, byte mode, level M): rows of dark=True."""
    payload = text.encode("utf-8")
    version = choose_version(len(payload))
    codewords = interleave(encode_data(payload, version), version)
    best, best_score = None, None
    for mask in range(8):
        sym = _Symbol(version)
        sym.place(codewords)
        sym.apply_mask(mask)
        sym._draw_format(mask)
        score = sym.penalty()
        if best_score is None or score < best_score:
            best, best_score = sym, score
    return best.mod


def svg(text: str, scale: int = 8, quiet: int = 4, dark: str = "#000", light: str = "#fff") -> str:
    """An SVG of the code, with the quiet zone the standard asks for (4 modules)."""
    m = encode(text)
    n = len(m) + 2 * quiet
    path = "".join(f"M{x + quiet},{y + quiet}h1v1h-1z"
                   for y, row in enumerate(m) for x, v in enumerate(row) if v)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n * scale}" '
            f'height="{n * scale}" shape-rendering="crispEdges"><rect width="{n}" height="{n}" fill="{light}"/>'
            f'<path d="{path}" fill="{dark}"/></svg>')

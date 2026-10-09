"""Draw the JARVIS app icon (app/assets/jarvis.ico) — run once, or after a redesign.

The mark is the reactor from the Core tab reduced to its essentials: a black
squircle, the dashed outer ring (the ticks), one grey groove ring (the record) and
the cyan centre (JARVIS is on). Drawn at 1024 px and downsampled for every size
Windows asks for, so the 16 px taskbar version stays crisp.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / "assets"
S = 1024
CYAN = (92, 225, 255, 255)


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=(8, 9, 11, 255))
    c = S / 2
    # outer tick ring: 48 ticks, lit — the instrument is live
    for i in range(48):
        a = -math.pi / 2 + i / 48 * 2 * math.pi
        r0, r1 = S * 0.36, S * 0.41
        w = 18 if i % 6 == 0 else 11
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)],
               fill=CYAN if i % 6 else (255, 255, 255, 255), width=w)
    # the record: two quiet grooves (composited — drawing translucent pixels
    # straight onto the squircle punches see-through holes in it instead)
    grooves = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gdr = ImageDraw.Draw(grooves)
    for r, alpha in ((S * 0.29, 90), (S * 0.23, 60)):
        gdr.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, alpha), width=8)
    img = Image.alpha_composite(img, grooves)
    d = ImageDraw.Draw(img)
    # glow + centre
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gr = S * 0.16
    gd.ellipse([c - gr, c - gr, c + gr, c + gr], fill=(92, 225, 255, 120))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.05)))
    d = ImageDraw.Draw(img)
    r = S * 0.1
    d.ellipse([c - r, c - r, c + r, c + r], fill=CYAN)
    r2 = S * 0.03
    d.ellipse([c - r2, c - r2, c + r2, c + r2], fill=(8, 9, 11, 255))
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    img = draw()
    img.save(OUT / "jarvis.png")
    img.save(OUT / "jarvis.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {OUT / 'jarvis.ico'}")


if __name__ == "__main__":
    main()

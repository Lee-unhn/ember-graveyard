"""Compose the P3c comparison: one column per sheet set, one row per moment, cropped to the fireball's path.
usage: python -I scripts/compose_routes.py <frames dir> <media dir> <moments, comma separated> key=label [key=label ...]
Writes p3c-routes.jpg (fireball and explosion) and p3c-sheets.jpg (each set's flame / explosion / smoke sheets)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

src, dst, moments = Path(sys.argv[1]), Path(sys.argv[2]), [float(m) for m in sys.argv[3].split(",")]
sets = [a.split("=", 1) for a in sys.argv[4:]]
CROP = (300, 120, 900, 380)          # the fireball's path and the hit point in a 960x540 frame
W, H = CROP[2] - CROP[0], CROP[3] - CROP[1]
PAD, LABEL, BG, INK = 8, 24, (14, 13, 18), (230, 220, 200)

sheet = Image.new("RGB", (PAD + len(sets) * (W + PAD), LABEL + len(moments) * (H + LABEL + PAD) + PAD), BG)
d = ImageDraw.Draw(sheet)
for col, (key, label) in enumerate(sets):
    x = PAD + col * (W + PAD)
    d.text((x, 6), label, fill=INK)
    for row, m in enumerate(moments):
        y = LABEL + row * (H + LABEL + PAD)
        d.text((x, y + 6), f"t = {m:.2f} s", fill=(170, 165, 150))
        sheet.paste(Image.open(src / f"{key}_{m:.2f}.png").convert("RGB").crop(CROP), (x, y + LABEL))
dst.mkdir(parents=True, exist_ok=True)
sheet.save(dst / "p3c-routes.jpg", quality=85)
print("wrote", dst / "p3c-routes.jpg", sheet.size)

SW = 768                              # each set's three sheets at 256 px
book = Image.new("RGB", (PAD * 2 + SW, LABEL + len(sets) * (256 + LABEL) + PAD), BG)
d = ImageDraw.Draw(book)
d.text((PAD, 6), "flame / explosion / smoke, after the page's black-to-transparent conversion", fill=INK)
for row, (key, label) in enumerate(sets):
    y = LABEL + row * (256 + LABEL)
    d.text((PAD, y + 6), label, fill=INK)
    book.paste(Image.open(src / f"{key}_sheets.png").convert("RGB").resize((SW, 256), Image.LANCZOS), (PAD, y + LABEL))
book.save(dst / "p3c-sheets.jpg", quality=85)
print("wrote", dst / "p3c-sheets.jpg", book.size)

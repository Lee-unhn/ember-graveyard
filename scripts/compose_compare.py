"""Put matching web and Godot frames side by side: one row per moment, web on the left, Godot on the right.
usage: python -I scripts/compose_compare.py <out dir> <result.jpg> <fps> <moment> [<moment> ...]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

out, dst, fps, moments = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), [float(m) for m in sys.argv[4:]]
W, H, PAD, LABEL = 480, 270, 8, 26
sheet = Image.new("RGB", (W * 2 + PAD * 3, (H + LABEL) * len(moments) + PAD * (len(moments) + 1)), (14, 13, 18))
d = ImageDraw.Draw(sheet)
for row, m in enumerate(moments):
    y = PAD + row * (H + LABEL + PAD)
    web = Image.open(out / f"web_{m:.2f}.png").convert("RGB").resize((W, H), Image.LANCZOS)
    god = Image.open(out / f"frame{round(m * fps):08d}.png").convert("RGB").resize((W, H), Image.LANCZOS)
    sheet.paste(web, (PAD, y + LABEL)); sheet.paste(god, (PAD * 2 + W, y + LABEL))
    d.text((PAD, y + 6), f"Web (Three.js)  t = {m:.2f} s", fill=(230, 220, 200))
    d.text((PAD * 2 + W, y + 6), f"Godot 4.7 (GPUParticles3D)  t = {m:.2f} s", fill=(230, 220, 200))
dst.parent.mkdir(parents=True, exist_ok=True)
sheet.save(dst, quality=85)
print("wrote", dst, sheet.size)

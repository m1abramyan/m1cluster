#!/usr/bin/env python3
"""Render the app icon from the retained Retro DSEG atlas; no BMW assets or SDK."""
import base64
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'apps/manuk_retro_cluster'
atlas = json.loads((APP / 'hud/fonts/d7_sm.json').read_text())
alpha = Image.frombytes('L', (atlas['width'], atlas['height']), base64.b64decode(atlas['alpha']))
digits = Image.new('L', (72, 47))
for index in range(2):
    glyph = atlas['glyphs']['8']
    crop = alpha.crop((glyph['x'], glyph['y'], glyph['x'] + glyph['w'], glyph['y'] + glyph['h']))
    digits.paste(crop, (index * glyph['advance'] + 2 + glyph['ox'], 0))

def render(size):
    # Design in 140px logical coordinates; retain clean fractional alpha for small tiles.
    scale = 4
    out = Image.new('RGBA', (560, 560), (0, 0, 0, 0))
    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle((2*scale, 2*scale, 138*scale, 138*scale), radius=20*scale,
                           fill=(0, 0, 0, 255), outline=(65, 72, 77, 255), width=scale)
    for i in range(20):
        x = 11 + i*6
        color = (190,198,204,255) if i < 15 else (255,224,64,255) if i < 18 else (255,59,48,255)
        draw.rounded_rectangle((x*scale, 28*scale, (x+4)*scale, 41*scale), radius=scale, fill=color)
    mask = digits.resize((108*scale, 70*scale), Image.Resampling.LANCZOS)
    ink = Image.new('RGBA', mask.size, (190,198,204,255))
    out.paste(ink, (16*scale, 53*scale), mask)
    return out.resize((size, size), Image.Resampling.LANCZOS)

render(140).save(APP / 'icon.png', optimize=True)
(ROOT / 'artifacts').mkdir(exist_ok=True)
render(512).save(ROOT / 'artifacts/retro-cluster-icon.png', optimize=True)
assert (APP / 'icon.png').stat().st_size < 128*1024
print('Created apps/manuk_retro_cluster/icon.png (140x140) and artifacts/retro-cluster-icon.png (512x512)')

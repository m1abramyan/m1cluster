#!/usr/bin/env python3
"""Bake Russian label atlases only; original Retro numeric atlases stay untouched.

Local developer tool: Pillow 12.0.0 and fonttools 4.60.1.
    .cache/fonts/venv/bin/python tools/bake_russian_fonts.py

Based on bimmer-lab/apps tools/bake_fonts.py (MIT), pinned in UPSTREAM.lock.json.
Same alpha-byte atlas and glyph metrics contract. No font rasterization on MGU.
"""
import base64
import hashlib
import json
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tools/fonts-src/RobotoCondensed[wght].ttf'
LICENSE = ROOT / 'tools/fonts-src/RobotoCondensed-OFL.txt'
COMMIT = '69d0549e8fc7ad72e1531734c81237be401ec4fd'
FONT_URL = 'https://raw.githubusercontent.com/google/fonts/' + COMMIT + '/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf'
LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/' + COMMIT + '/ofl/robotocondensed/OFL.txt'
CYRILLIC = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/°%>·.: -+!' + CYRILLIC
DIGITS = '0123456789'
ATLAS_WIDTH = 1024
PAD = 2
WEIGHT = 600
SPECS = [('ru_head', 24, 27, 23), ('ru_unit', 34, 37, 31)]
LABELS = [
    ('ru_head', 'МАСЛО', 2, 130), ('ru_head', 'ОХЛАЖД.', 2, 130),
    ('ru_head', 'ТОПЛИВО', 2, 130), ('ru_head', 'ПЕРЕДАЧА', 2, 160),
    ('ru_head', 'НАДДУВ БАР', 1, 240), ('ru_head', 'ВПУСК °C', 1, 240),
    ('ru_head', 'ОБОРОТЫ', 1, 240), ('ru_head', 'ОБОРОТЫ ОБ/МИН', 1, 240),
    ('ru_unit', 'КМ/Ч', 0, 140), ('ru_unit', 'МИЛЬ/Ч', 0, 140),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bake(name, size, height, baseline):
    font = ImageFont.truetype(str(SOURCE), size)
    font.set_variation_by_axes([WEIGHT])
    tab = max(font.getlength(c) for c in DIGITS)
    glyphs, cells = {}, []
    x = y = 0
    for c in CHARS:
        advance = font.getlength(c)
        if c == ' ':
            glyphs[c] = {'x': 0, 'y': 0, 'w': 0, 'h': 0, 'ox': 0, 'advance': round(advance)}
            continue
        left, top, right, bottom = font.getbbox(c, anchor='ls')
        if baseline + top < 0 or baseline + bottom > height:
            raise RuntimeError(f'{name}: glyph {c} cannot fit original cell height {height}')
        width = right - left + PAD * 2
        cell = Image.new('L', (width, height), 0)
        ImageDraw.Draw(cell).text((PAD - left, baseline), c, font=font, fill=255, anchor='ls')
        if x + width > ATLAS_WIDTH:
            x, y = 0, y + height
        digit_shift = (tab - advance) / 2 if c in DIGITS else 0
        glyphs[c] = {'x': x, 'y': y, 'w': width, 'h': height, 'ox': round(left - PAD + digit_shift),
                     'advance': round(tab if c in DIGITS else advance)}
        cells.append((cell, x, y))
        x += width
    atlas = Image.new('L', (ATLAS_WIDTH, y + height), 0)
    for cell, x, y in cells:
        atlas.paste(cell, (x, y))
    result = {'source': SOURCE.name, 'sourceCommit': COMMIT, 'weight': WEIGHT, 'size': size,
              'cellHeight': height, 'baseline': baseline, 'glyphs': glyphs,
              'width': ATLAS_WIDTH, 'height': atlas.height,
              'alpha': base64.b64encode(atlas.tobytes()).decode('ascii')}
    dest = ROOT / 'apps/manuk_retro_cluster/hud/fonts' / (name + '.json')
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return result, dest


def main():
    # Checking cmap avoids silently rasterizing a .notdef box for a missing Russian letter.
    font = TTFont(SOURCE)
    cmap = font.getBestCmap()
    missing = [c for c in CHARS if ord(c) not in cmap]
    if missing:
        raise RuntimeError('Source has missing glyphs: ' + ''.join(missing))
    baked, paths = {}, {}
    for spec in SPECS:
        result, dest = bake(*spec)
        baked[spec[0]], paths[spec[0]] = result, dest
    fits = []
    for name, word, spacing, box in LABELS:
        width = sum(baked[name]['glyphs'][c]['advance'] for c in word) + spacing * max(0, len(word) - 1)
        if width > box:
            raise RuntimeError(f'{word}: {width} pixels exceeds {box}')
        fits.append({'text': word, 'font': name, 'spacing': spacing, 'width': width, 'boxWidth': box})
    for d in [ROOT / 'licenses', ROOT / 'apps/manuk_retro_cluster/licenses']:
        d.mkdir(exist_ok=True)
        shutil.copy2(LICENSE, d / 'RobotoCondensed-OFL.txt')
    record = {
        'family': 'Roboto Condensed', 'license': 'OFL-1.1',
        'copyright': 'Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic)',
        'sourceRepository': 'https://github.com/google/fonts', 'commit': COMMIT,
        'fontUrl': FONT_URL, 'licenseUrl': LICENSE_URL,
        'fontSha256': sha(SOURCE), 'licenseSha256': sha(LICENSE),
        'weight': WEIGHT, 'glyphCount': len(CHARS), 'coverageCheckedAgainstCmap': True,
        'originalNumericAtlasesModified': False,
        'generator': 'tools/bake_russian_fonts.py', 'pillow': '12.0.0', 'fonttools': '4.60.1',
        'atlases': {name: {'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p),
                          'cellHeight': baked[name]['cellHeight'], 'baseline': baked[name]['baseline'],
                          'width': baked[name]['width'], 'height': baked[name]['height']}
                    for name, p in paths.items()},
        'labelWidthChecks': fits,
    }
    (ROOT / 'artifacts/russian-font-provenance.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for fit in fits:
        print(fit['text'], str(fit['width']) + '/' + str(fit['boxWidth']) + ' px')
    print('Original cell heights/baselines preserved; cmap and label bounds passed; DSEG files untouched.')


if __name__ == '__main__':
    main()

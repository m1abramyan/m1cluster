#!/usr/bin/env python3
"""Build the requested full-size segmented transmission alphabet, entirely locally.

Run: .cache/fonts/venv/bin/python tools/bake_drive_font.py
The original d7_big atlas, metrics, digits and '-' are never changed. D/S/M/P/R/N
are a separately attributed extension assembled from its original segments.
The owner explicitly requested diagonal strokes for R/N; M uses the same stroke.
Pillow is used to generate the atlas, never by the vehicle runtime.
"""
import base64
import copy
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'apps/manuk_retro_cluster/hud/fonts'
SOURCE = FONTS / 'd7_big.json'
PREVIEW = ROOT / 'artifacts/drive-glyphs-preview.png'
SUPERSAMPLE = 8
THICKNESS = 22
BEVEL = 11


def components(mask):
    """Connected alpha components of the original 8, including antialias edges."""
    alpha, seen, parts = mask.load(), set(), []
    for y in range(mask.height):
        for x in range(mask.width):
            if not alpha[x, y] or (x, y) in seen:
                continue
            queue, pixels = [(x, y)], []
            seen.add((x, y))
            while queue:
                px, py = queue.pop()
                pixels.append((px, py))
                for nx, ny in [(px+1, py), (px-1, py), (px, py+1), (px, py-1)]:
                    if 0 <= nx < mask.width and 0 <= ny < mask.height and alpha[nx, ny] and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            part = Image.new('L', mask.size, 0)
            into = part.load()
            for px, py in pixels:
                into[px, py] = alpha[px, py]
            parts.append(part)
    assert len(parts) == 7, 'Expected the seven disconnected source segments'
    return dict(zip(['A', 'F', 'B', 'G', 'E', 'C', 'D'], parts))


def stroke(size, start, end):
    """Six-sided segment: same 22px width and 11px pointed facets as source 8."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy * THICKNESS / 2, ux * THICKNESS / 2
    ax, ay = start[0] + BEVEL * ux, start[1] + BEVEL * uy
    bx, by = end[0] - BEVEL * ux, end[1] - BEVEL * uy
    polygon = [start, (ax + nx, ay + ny), (bx + nx, by + ny), end,
               (bx - nx, by - ny), (ax - nx, ay - ny)]
    large = Image.new('L', (size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE), 0)
    ImageDraw.Draw(large).polygon([(round(x * SUPERSAMPLE), round(y * SUPERSAMPLE)) for x, y in polygon], fill=255)
    return large.resize(size, Image.Resampling.LANCZOS)


def main():
    base = json.loads(SOURCE.read_text())
    source_bytes = base64.b64decode(base['alpha'])
    source_atlas = Image.frombytes('L', (base['width'], base['height']), source_bytes)
    g = base['glyphs']['8']
    source_eight = source_atlas.crop((g['x'], g['y'], g['x'] + g['w'], g['y'] + g['h']))
    segments = components(source_eight)
    ink_box = source_eight.getbbox()
    # Restrict new strokes to the original numeral's visible bounds. The pointed
    # stem endpoints extend 1px beyond this clip so the first/last retained rows
    # contain clearly visible pixels, not only a faint resampling halo.
    ink_clip = Image.new('L', source_eight.size, 0)
    ImageDraw.Draw(ink_clip).rectangle((ink_box[0], ink_box[1], ink_box[2] - 1, ink_box[3] - 1), fill=255)
    stem_bands = [(2, 87, 3, 87), (90, 174, 90, 173)]
    # All points use the unchanged source 8 cell: w143/h175, ox-2, advance139.
    recipes = {
        'D': {'segments': 'ABCD', 'strokes': [[[30, 3], [30, 173]]]},
        'S': {'copyGlyph': '5'},
        'M': {'segments': 'FEBC', 'extendStems': [30, 114], 'strokes': [[[45, 19], [71.5, 82]], [[98, 19], [71.5, 82]]]},
        'P': {'segments': 'ABFEG', 'extendStems': [30], 'strokes': []},
        'R': {'segments': 'ABFEG', 'extendStems': [30], 'strokes': [[[73, 101], [120, 174]]]},
        'N': {'segments': 'FEBC', 'extendStems': [30, 114], 'strokes': [[[44, 18], [100, 158]]]},
    }
    out = copy.deepcopy(base)
    out['height'] += base['cellHeight']
    out['derivedFrom'] = 'd7_big.json; original digits and hyphen copied byte-for-byte; separate owner-requested segmented D/S/M/P/R/N extension'
    out['sourceSha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    out['source'] = 'DSEG7 Classic Bold via original bimmer-lab Retro d7_big.json; locally derived transmission letters'
    out['license'] = 'OFL-1.1; DSEG Copyright 2017 keshikan; derivative glyph recipe in tools/bake_drive_font.py'
    out['generator'] = {'path': 'tools/bake_drive_font.py', 'supersample': SUPERSAMPLE,
                        'strokeThickness': THICKNESS, 'bevelLength': BEVEL,
                        'inkClipBox': ink_box, 'stemBands': stem_bands,
                        'derivedGlyphs': recipes}
    atlas = Image.new('L', (out['width'], out['height']), 0)
    atlas.paste(source_atlas, (0, 0))
    x, y = 0, base['height']
    for name, recipe in recipes.items():
        if 'copyGlyph' in recipe:
            out['glyphs'][name] = copy.deepcopy(base['glyphs'][recipe['copyGlyph']])
            continue
        mask = Image.new('L', source_eight.size, 0)
        for segment in recipe['segments']:
            mask = ImageChops.lighter(mask, segments[segment])
        for stem_x in recipe.get('extendStems', []):
            for start_y, end_y, clip_top, clip_bottom in stem_bands:
                stem = stroke(mask.size, (stem_x, start_y), (stem_x, end_y))
                # Preserve the source's break between upper/lower side segments.
                band = Image.new('L', mask.size, 0)
                band.paste(stem.crop((0, clip_top, mask.width, clip_bottom)), (0, clip_top))
                mask = ImageChops.lighter(mask, band)
        for start, end in recipe['strokes']:
            mask = ImageChops.lighter(mask, stroke(mask.size, start, end))
        mask = ImageChops.multiply(mask, ink_clip)
        assert mask.getbbox(), name + ' must not be empty'
        assert mask.getbbox()[1::2] == (ink_box[1], ink_box[3]), name + ' must match numeral ink height'
        bright = mask.point(lambda alpha: 255 if alpha > 100 else 0)
        assert bright.getbbox()[1::2] == (ink_box[1], ink_box[3]), name + ' tips must be visibly bright'
        assert x + g['w'] <= out['width'], 'Extension row overflow'
        atlas.paste(mask, (x, y))
        out['glyphs'][name] = dict(g, x=x, y=y)
        x += g['w']
    raw = atlas.tobytes()
    assert raw[:len(source_bytes)] == source_bytes
    assert all(out['glyphs'][c] == base['glyphs'][c] for c in base['glyphs'])
    out['alpha'] = base64.b64encode(raw).decode('ascii')
    target = FONTS / 'd7_drive.json'
    target.write_text(json.dumps(out, separators=(',', ':')) + '\n')
    # Clean native-size sheet: no alternate font is used to render these samples.
    rows = ['DSMP RN', 'D1 S2 M2', 'P R N 8']
    preview = Image.new('RGB', (1260, 650), (0, 0, 0))
    for row_index, text in enumerate(rows):
        pen = 36
        for char in text:
            if char == ' ':
                pen += 36
                continue
            glyph = out['glyphs'][char]
            mask = atlas.crop((glyph['x'], glyph['y'], glyph['x'] + glyph['w'], glyph['y'] + glyph['h']))
            preview.paste((255, 178, 36), (pen + glyph['ox'], 25 + row_index * 210,
                                          pen + glyph['ox'] + glyph['w'], 25 + row_index * 210 + glyph['h']), mask)
            pen += glyph['advance']
    preview.save(PREVIEW)
    print('d7_drive: full-size segmented D/S/M/P/R/N, unchanged original digits/hyphen')
    print('SHA256 ' + hashlib.sha256(target.read_bytes()).hexdigest())
    print(str(PREVIEW))


if __name__ == '__main__':
    main()

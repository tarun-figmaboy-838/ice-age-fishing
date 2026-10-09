#!/usr/bin/env python3
"""Builds the compressed game assets in assets/ from the untouched originals in asset/.

Backgrounds and sprite sheets are re-encoded as WebP. The two fishing sheets (idle and
casting) get the baked fishing line and hook erased so the game can draw a single
procedural line from the rod tip. Per-frame raft/rod measurements are written to
src/sprite-data.js.

Requires Pillow (pip install Pillow).
"""
import base64
import importlib.util
import json
import math
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'asset')
OUT = os.path.join(ROOT, 'assets')

BACKGROUNDS = [
    'bg6, 2026 at 02_26_02 PM-1.png',
    'bg6, 2026 at 02_26_04 PM-2.png',
    'bg6, 2026 at 02_26_06 PM-3.png',
    'bg6, 2026 at 02_26_08 PM-4.png',
]
SHEETS = {
    'fishing': ('ChatGPT Image Oct 6, 2026 at 04_36_14 PM-1.png', True),
    'casting': ('ChatGPT Image Oct 6, 2026 at 04_36_19 PM-3.png', True),
    'rowing': ('ChatGPT Image Oct 6, 2026 at 04_36_16 PM-2.png', False),
}
FISH_ATLAS = 'Glossy Geometric Fish Sprite Sheet.png'
GRID = 3
# The painted raft differs in length from frame to frame, so every frame is stripped down to
# the character (plus rod or paddle) and the game draws one shared raft prop underneath.
# Thin wood structures (rod, paddle shaft) survive the strip; the raft, rope and bucket do not.
STRIP_KERNEL = 13


def is_grey(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn < 34 and 30 <= mx <= 225


def is_rod(r, g, b, a):
    return a > 160 and r > 140 and 45 < g < 160 and b < 100 and r - g > 45


def is_raft_colour(r, g, b, a):
    if a < 40:
        return False
    wood = r >= 90 and r - b > 50 and 25 < g < 175
    rope = r > 200 and g > 140 and b < 90
    dark = max(r, g, b) < 110 and r - b > 25 and r >= 45
    return wood or rope or dark


def strip_raft(im, frames):
    """Clear the painted raft, rope loops and bucket from each cell, keeping the character."""
    px = im.load()
    for f in frames:
        x0, y0, cell = f['cellX'], f['cellY'], f['cell']
        mask = Image.new('L', (cell, cell), 0)
        mp = mask.load()
        for y in range(cell):
            for x in range(cell):
                if is_raft_colour(*px[x0 + x, y0 + y]):
                    mp[x, y] = 255
        thick = mask.filter(ImageFilter.MinFilter(STRIP_KERNEL)).filter(ImageFilter.MaxFilter(STRIP_KERNEL + 2)).load()
        bottom = f['raftBottom'] - y0
        right = f['raftRight'] - x0
        zone = (0, bottom - 200, right + 6, bottom + 4)
        cleared = Image.new('L', (cell, cell), 0)
        cp = cleared.load()
        for y in range(max(0, zone[1]), min(cell, zone[3])):
            for x in range(zone[0], min(cell, zone[2])):
                if thick[x, y] and mp[x, y]:
                    cp[x, y] = 255
        # rope strands and shading that touch the cleared raft go with it
        grown = cleared.filter(ImageFilter.MaxFilter(7)).load()
        for y in range(max(0, zone[1]), min(cell, zone[3])):
            for x in range(zone[0], min(cell, zone[2])):
                if cp[x, y] or (grown[x, y] and mp[x, y]):
                    px[x0 + x, y0 + y] = (0, 0, 0, 0)


def erase_line_and_hook(im, frames):
    """Remove thin grey structures (line, hook) outside the thick body silhouette."""
    w, h = im.size
    px = im.load()
    alpha = im.getchannel('A').point(lambda v: 255 if v > 20 else 0)
    thick = alpha.filter(ImageFilter.MinFilter(11)).filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MaxFilter(7))
    ap, tp = alpha.load(), thick.load()
    erased = set()
    for f in frames:
        x0, y0, cell = f['cellX'], f['cellY'], f['cell']
        prot = (f['raftLeft'] - x0 - 10, f['raftBottom'] - y0 - 135, f['raftLeft'] - x0 + 160, f['raftBottom'] - y0)
        for y in range(y0, y0 + cell):
            for x in range(x0, x0 + cell):
                if not ap[x, y] or tp[x, y]:
                    continue
                lx, ly = x - x0, y - y0
                if prot[0] <= lx <= prot[2] and prot[1] <= ly <= prot[3]:
                    continue
                r, g, bb, a = px[x, y]
                if is_grey(r, g, bb) or a < 100:
                    erased.add((x, y))
    # grow into leftover specks of the same thin structures
    for _ in range(3):
        extra = set()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if ap[x, y] and not tp[x, y] and (x, y) not in erased:
                    n = sum(((x + dx, y + dy) in erased) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
                    if n >= 3:
                        extra.add((x, y))
        erased |= extra
    # grey line pixels crossing the rod: repaint with the surrounding rod colour
    for y in range(4, h - 4):
        for x in range(4, w - 4):
            if not tp[x, y] or (x, y) in erased:
                continue
            r, g, bb, a = px[x, y]
            mx, mn = max(r, g, bb), min(r, g, bb)
            if not (mx - mn < 30 and 50 <= mx <= 210 and a > 100):
                continue
            rod = [px[x + dx, y + dy][:3] for dy in range(-4, 5) for dx in range(-4, 5) if is_rod(*px[x + dx, y + dy])]
            if len(rod) >= 30:
                px[x, y] = tuple(sum(ch) // len(rod) for ch in zip(*rod)) + (a,)
    for (x, y) in erased:
        px[x, y] = (0, 0, 0, 0)
    # drop small islands (hook knots) that are no longer attached to the character
    remove_islands(im, min_size=2500)


def remove_islands(im, min_size):
    w, h = im.size
    px = im.load()
    seen = set()
    for sy in range(h):
        for sx in range(w):
            if px[sx, sy][3] <= 20 or (sx, sy) in seen:
                continue
            comp = []
            q = deque([(sx, sy)])
            seen.add((sx, sy))
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3] > 20:
                            seen.add((nx, ny))
                            q.append((nx, ny))
            if len(comp) < min_size:
                for p in comp:
                    px[p] = (0, 0, 0, 0)


def clear_neighbour_bleed(im):
    """The fishing sheets paint each raft's rope a little past the cell edge into the next cell.
    Clear raft-level pixels in the last columns of every cell (the rowing sheet is left alone
    because its paddle legitimately reaches that far)."""
    w, h = im.size
    cell = w // GRID
    px = im.load()
    for col in range(GRID):
        for row in range(GRID):
            x0, y0 = col * cell, row * cell
            raft_bottom = y0 + cell - 1
            for y in range(y0 + cell - 1, y0, -1):
                if sum(1 for x in range(x0 + 3, x0 + cell - 3) if px[x, y][3] > 128) > 200:
                    raft_bottom = y
                    break
            for x in range(x0 + cell - 22, x0 + cell):
                for y in range(raft_bottom - 110, y0 + cell):
                    px[x, y] = (0, 0, 0, 0)


def measure_frames(im, with_rod):
    """Per-frame anchors. Frames are registered on the raft's bottom-left corner; the cream
    body area gives a per-sheet scale so Popo stays the same size across sheets."""
    w, h = im.size
    cell = w // GRID
    px = im.load()
    frames = []
    for row in range(GRID):
        for col in range(GRID):
            x0, y0 = col * cell, row * cell
            inner = range(x0 + 3, x0 + cell - 3)
            raft_bottom = None
            for y in range(y0 + cell - 1, y0, -1):
                if sum(1 for x in inner if px[x, y][3] > 128) > 200:
                    raft_bottom = y
                    break
            band = [x for y in range(raft_bottom - 30, raft_bottom + 1) for x in range(x0 + 2, x0 + cell - 2) if px[x, y][3] > 128]
            raft_left, raft_right = min(band), max(band)
            cream = 0
            for y in range(y0, y0 + cell):
                for x in range(x0, x0 + cell):
                    r, g, b, a = px[x, y]
                    if a > 200 and r > 215 and g > 190 and b > 160 and r - b > 15:
                        cream += 1
            frame = dict(row=row, col=col, cell=cell, cellX=x0, cellY=y0,
                         raftLeft=raft_left, raftRight=raft_right, raftBottom=raft_bottom, bodyArea=cream)
            if with_rod:
                frame['rodTip'] = find_rod_tip(px, x0, y0, cell, raft_bottom)
            frames.append(frame)
    return frames


def find_rod_tip(px, x0, y0, cell, raft_bottom):
    """The rod is the largest orange component above the bucket and deck; its tip is the end farthest from the body."""
    cx = cy = n = 0
    for y in range(y0, y0 + cell):
        for x in range(x0, x0 + cell):
            r, g, b, a = px[x, y]
            if a > 200 and r > 215 and g > 190 and b > 160 and r - b > 15:
                cx += x
                cy += y
                n += 1
    body = (cx / n, cy / n)
    rod = set()
    for y in range(y0, raft_bottom - 135):
        for x in range(x0, x0 + cell):
            if is_rod(*px[x, y]):
                rod.add((x, y))
    best, seen = [], set()
    for p in rod:
        if p in seen:
            continue
        comp, q = [], deque([p])
        seen.add(p)
        while q:
            x, y = q.popleft()
            comp.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nb = (x + dx, y + dy)
                    if nb in rod and nb not in seen:
                        seen.add(nb)
                        q.append(nb)
        if len(comp) > len(best):
            best = comp
    tip = max(best, key=lambda p: (p[0] - body[0]) ** 2 + (p[1] - body[1]) ** 2)
    return list(tip)


def content_box(im, f):
    """Opaque bounds of one cell, trimmed of the neighbouring frames' rafts that bleed over the cell edge."""
    x0, y0, cell = f['cellX'], f['cellY'], f['cell']
    alpha = im.crop((x0 + 2, y0 + 2, x0 + cell - 2, y0 + cell - 2)).getchannel('A').point(lambda v: 255 if v > 20 else 0)
    box = alpha.getbbox()
    left, top, right, bottom = x0 + 2 + box[0], y0 + 2 + box[1], x0 + 2 + box[2], y0 + 2 + box[3]
    px = alpha.load()
    raft_top = f['raftBottom'] - 100

    def raft_level_only(x):
        ys = [y for y in range(alpha.size[1]) if px[x - x0 - 2, y]]
        return bool(ys) and min(ys) + y0 + 2 > raft_top - 12

    while right > x0 + cell - 10 and raft_level_only(right - 1):
        right -= 1
    while left < x0 + 10 and raft_level_only(left):
        left += 1
    return [left, top, right, bottom]


def fish_boxes(im):
    """Bounding boxes of the fish in the atlas, row-major."""
    w, h = im.size
    alpha = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).load()
    seen = set()
    boxes = []
    for sy in range(h):
        for sx in range(w):
            if not alpha[sx, sy] or (sx, sy) in seen:
                continue
            q = deque([(sx, sy)])
            seen.add((sx, sy))
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and alpha[nx, ny]:
                            seen.add((nx, ny))
                            q.append((nx, ny))
            if n > 2000:
                boxes.append([x0, y0, x1 + 1, y1 + 1])
    boxes.sort(key=lambda b: (b[1] // 300, b[0]))
    return boxes


def build_props(idle_cell):
    """The shared raft/bucket and rod props, cut from the idle frame by tools/build-popo-layers.py."""
    spec = importlib.util.spec_from_file_location('layers', os.path.join(ROOT, 'tools', 'build-popo-layers.py'))
    layers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(layers)
    layers.build(idle_cell).save(os.path.join(OUT, 'sprites', 'popo-props.webp'), lossless=True)
    for version in ('', '-v2'):
        Image.open(os.path.join(SRC, f'popo-mishap-poses{version}.png')).save(
            os.path.join(OUT, 'sprites', f'popo-mishap-poses{version}.webp'), quality=95, method=6)


def fish_parts(atlas, box):
    """Split one fish into body mask, decoration (fins) and face (eye, mouth) layers."""
    cell = atlas.crop(tuple(box))
    px = cell.load()
    w, h = cell.size
    body = Image.new('L', (w, h), 0)
    bp = body.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and max(r, g, b) - min(r, g, b) > 140 and min(r, g, b) < 85:
                bp[x, y] = 255
    raw = body.load()
    body = body.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    # the hull is the body with its holes (eye, mouth) filled: flood the outside, invert
    outside = body.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    hull = outside.point(lambda v: 0 if v == 128 else 255)
    # the face is the eye (white, black) and mouth (dark) well inside the body, never the outline
    interior = hull.filter(ImageFilter.MinFilter(11)).load()
    face = Image.new('L', (w, h), 0)
    fp = face.load()
    for y in range(h):
        for x in range(w):
            if interior[x, y] and not raw[x, y] and px[x, y][3] > 60:
                r, g, b, a = px[x, y]
                if (r > 215 and g > 215 and b > 215) or max(r, g, b) < 95:
                    fp[x, y] = 255
    face = face.filter(ImageFilter.MaxFilter(3))
    # fins are the bright decoration outside the body; the darker outline ring is dropped
    ring = hull.filter(ImageFilter.MaxFilter(3)).load()
    fins = Image.new('L', (w, h), 0)
    fnp = fins.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 20 and not ring[x, y] and max(px[x, y][:3]) >= 190:
                fnp[x, y] = 255
    return cell, body, fins, face


def body_colour(cell, body, face):
    """Mean body colour in a ring around the face, used to paint the face out."""
    px = cell.load()
    ring = face.filter(ImageFilter.MaxFilter(15)).load()
    bp = body.load()
    fp = face.load()
    acc = [0, 0, 0]
    n = 0
    for y in range(cell.size[1]):
        for x in range(cell.size[0]):
            if ring[x, y] and bp[x, y] and not fp[x, y]:
                r, g, b, a = px[x, y]
                acc[0] += r
                acc[1] += g
                acc[2] += b
                n += 1
    return tuple(v // max(1, n) for v in acc)


def glossy_polygon(size, points, light, mid, dark):
    """A beveled, glossy polygon in the style of the supplied fish bodies."""
    w, h = size
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    inset = lambda k, dx=0, dy=0: [(cx + (x - cx) * k + dx, cy + (y - cy) * k + dy) for x, y in points]
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(points, fill=dark + (255,))
    top = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(top).polygon(inset(0.95, 0, -2), fill=light + (255,))
    layer.alpha_composite(top)
    grad = Image.new('RGBA', size, (0, 0, 0, 0))
    gp = grad.load()
    ys = [p[1] for p in points]
    y0, y1 = min(ys), max(ys)
    for y in range(h):
        t = min(1, max(0, (y - y0) / max(1, y1 - y0)))
        c = tuple(int(mid[i] * (1 - t) + dark[i] * t) for i in range(3))
        for x in range(w):
            gp[x, y] = c + (255,)
    face = Image.new('L', size, 0)
    ImageDraw.Draw(face).polygon(inset(0.9, 0, 2), fill=255)
    layer.paste(grad, (0, 0), face)
    gloss = Image.new('L', size, 0)
    r = (y1 - y0) * 0.16
    ImageDraw.Draw(gloss).ellipse([cx - r * 2.2, y0 + (y1 - y0) * 0.1, cx - r * 0.2, y0 + (y1 - y0) * 0.1 + r], fill=95)
    gloss = gloss.filter(ImageFilter.GaussianBlur(5))
    white = Image.new('RGBA', size, (255, 255, 255, 255))
    layer.paste(white, (0, 0), Image.composite(gloss, Image.new('L', size, 0), face))
    return layer


def make_heptagon(atlas, source_box):
    cell, body, fins, face = fish_parts(atlas, source_box)
    w, h = cell.size
    bb = body.getbbox()
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    radius = (bb[3] - bb[1]) / 2 * 1.06
    pts = [(cx + radius * math.cos(-math.pi / 2 + i * 2 * math.pi / 7), cy + radius * math.sin(-math.pi / 2 + i * 2 * math.pi / 7)) for i in range(7)]
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    # fins sit behind the body; nudge them toward the centre so the new edge covers their roots
    fin_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    fin_layer.paste(cell, (0, 0), fins)
    fp = fins.load()
    for (dx, dy) in ((0, 0),):
        out.alpha_composite(fin_layer, (dx, dy))
    out.alpha_composite(glossy_polygon((w, h), pts, (96, 232, 214), (24, 205, 188), (6, 138, 128)))
    out.paste(cell, (0, 0), face)
    return out


def make_rhombus(atlas, source_box, stretch=1.38):
    cell, body, fins, face = fish_parts(atlas, source_box)
    w, h = cell.size
    # paint the face out, stretch the fish along its horizontal diagonal (sides stay equal),
    # then put the unstretched face back so the eye stays round
    blank = cell.copy()
    blank.paste(Image.new('RGBA', (w, h), body_colour(cell, body, face) + (255,)), (0, 0), face.filter(ImageFilter.MaxFilter(3)))
    wide = blank.resize((round(w * stretch), h), Image.LANCZOS)
    fb = face.getbbox()
    fcx = (fb[0] + fb[2]) / 2
    out = wide.copy()
    patch = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    patch.paste(cell, (0, 0), face)
    out.alpha_composite(patch, (round(fcx * stretch - fcx), 0))
    # recolour the body to violet so it does not read as the blue tilted square
    px = out.load()
    bw = body.filter(ImageFilter.MaxFilter(3)).resize(out.size, Image.NEAREST).load()
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, a = px[x, y]
            if a > 0 and bw[x, y] and b > r + 30 and b >= g and not (r > 200 and g > 200 and b > 200):
                px[x, y] = (min(255, int(b * 0.55 + r * 0.3)), int(g * 0.45), min(255, int(b * 0.98)), a)
    return out


def extend_fish_atlas(atlas):
    """Append a heptagon (built from the second octagon) and a rhombus (from the tilted square)."""
    boxes = fish_boxes(atlas)
    heptagon = make_heptagon(atlas, boxes[11])
    rhombus = make_rhombus(atlas, boxes[5])
    row_h = max(heptagon.size[1], rhombus.size[1]) + 40
    out = Image.new('RGBA', (atlas.size[0], atlas.size[1] + row_h), (0, 0, 0, 0))
    out.alpha_composite(atlas, (0, 0))
    out.alpha_composite(heptagon, (40, atlas.size[1] + 20))
    out.alpha_composite(rhombus, (420, atlas.size[1] + 20))
    return out


def main():
    os.makedirs(os.path.join(OUT, 'backgrounds'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    for i, name in enumerate(BACKGROUNDS, start=1):
        im = Image.open(os.path.join(SRC, name)).convert('RGB')
        im.save(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'WEBP', quality=86, method=6)
        print('background', i, im.size)

    data = {'sheets': {}}
    for key, (name, erase) in SHEETS.items():
        im = Image.open(os.path.join(SRC, name)).convert('RGBA')
        if erase:
            clear_neighbour_bleed(im)
        frames = measure_frames(im, with_rod=erase)
        if erase:
            erase_line_and_hook(im, frames)
        if key == 'fishing':
            build_props(im.crop((418, 0, 836, 418)))
        strip_raft(im, frames)
        for f in frames:
            f['box'] = content_box(im, f)
        im.save(os.path.join(OUT, 'sprites', f'popo-{key}.webp'), 'WEBP', quality=90, method=6)
        data['sheets'][key] = dict(width=im.size[0], height=im.size[1], frames=frames)
        print('sheet', key, 'frames measured and stripped')

    fish = extend_fish_atlas(Image.open(os.path.join(SRC, FISH_ATLAS)).convert('RGBA'))
    fish.save(os.path.join(OUT, 'sprites', 'fish.webp'), 'WEBP', quality=90, method=6)
    data['fish'] = dict(width=fish.size[0], height=fish.size[1], boxes=fish_boxes(fish))
    print('fish atlas', len(data['fish']['boxes']), 'sprites')

    with open(os.path.join(ROOT, 'src', 'background-data.js'), 'w') as fh:
        fh.write('// Generated by tools/build-assets.py: the four backgrounds as data URLs so WebGL can use\n')
        fh.write('// them even when the game is opened straight from the file system.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\nPopoGame.BACKGROUND_DATA = [\n')
        for i in range(1, len(BACKGROUNDS) + 1):
            with open(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'rb') as img:
                fh.write("  'data:image/webp;base64," + base64.b64encode(img.read()).decode() + "',\n")
        fh.write('];\n')

    with open(os.path.join(ROOT, 'src', 'sprite-data.js'), 'w') as fh:
        fh.write('// Generated by tools/build-assets.py from the original sheets. Do not edit by hand.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\n')
        fh.write('PopoGame.SHEET_DATA = ' + json.dumps(data['sheets'], indent=1) + ';\n')
        fh.write('PopoGame.FISH_ATLAS = ' + json.dumps(data['fish']) + ';\n')
    print('wrote src/sprite-data.js')


if __name__ == '__main__':
    sys.exit(main())

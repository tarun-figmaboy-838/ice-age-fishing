#!/usr/bin/env python3
"""Builds the compressed game assets in assets/ from the untouched originals in asset/.

Backgrounds and sprite sheets are re-encoded as WebP. The two fishing sheets (idle and
casting) get the baked fishing line and hook erased so the game can draw a single
procedural line from the rod tip. Per-frame raft/rod measurements are written to
src/sprite-data.js.

Requires Pillow (pip install Pillow).
"""
import base64
import json
import os
import sys
import runpy
from collections import deque

from PIL import Image, ImageFilter

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


def is_grey(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn < 34 and 30 <= mx <= 225


def is_rod(r, g, b, a):
    return a > 160 and r > 140 and 45 < g < 160 and b < 100 and r - g > 45


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
        for f in frames:
            f['box'] = content_box(im, f)
        im.save(os.path.join(OUT, 'sprites', f'popo-{key}.webp'), 'WEBP', quality=90, method=6)
        data['sheets'][key] = dict(width=im.size[0], height=im.size[1], frames=frames)
        print('sheet', key, 'frames measured')

    fish = Image.open(os.path.join(SRC, FISH_ATLAS)).convert('RGBA')
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
    runpy.run_path(os.path.join(ROOT, 'tools', 'build-popo-layers.py'), run_name='__main__')


if __name__ == '__main__':
    sys.exit(main())

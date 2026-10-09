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
TITLE = 'title-banner.png'
PLAY_BUTTON = 'play-button.png'
# The first fishing sheet only supplies the shared raft prop now (cut from its idle frame).
PROP_SOURCE = 'ChatGPT Image Oct 6, 2026 at 04_36_14 PM-1.png'
# Popo's fishing poses: a clean 3x3 sheet of the character and rod only (no raft, line or hook).
FISHING = 'popo-fishing-clean.png'
SHEETS = {
    'rowing': ('ChatGPT Image Oct 6, 2026 at 04_36_16 PM-2.png', False),
}
# Fish sheets, sliced by grid cell. None marks art the game does not use: an irregular
# 9-gon, a capsule with no standard school name, and duplicates of shapes already present.
# The second sheet is drawn at about twice the scale, so it is halved to match.
FISH_SHEETS = [
    ('ChatGPT Image Oct 9, 2026 at 12_57_21 PM-1.png', 4, 1.0, [
        ['triangle', 'square', 'rectangle', 'circle'],
        ['rhombus', 'parallelogram', 'trapezium', 'pentagon'],
        ['hexagon', None, 'octagon', 'nonagon'],
        ['decagon', 'oval', None, 'semicircle'],
    ]),
    ('ChatGPT Image Oct 9, 2026 at 12_57_22 PM-2.png', 2, 0.5, [
        ['triangle-right', None],
        [None, None],
    ]),
]
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
    """Raft wood, rope and the dark gaps between logs. Strict enough that Popo's shaded cream
    fur (warm, but much less saturated than the wood) never matches."""
    if a < 40:
        return False
    wood = r >= 90 and r - b > 75 and r - g > 45 and g < 175
    rope = r > 200 and g > 140 and b < 90
    dark = max(r, g, b) < 110 and r - b > 40 and r - g > 20 and r >= 45
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
        # only the raft's own band (deck, logs, rope loops); the body and rod above it are left alone
        zone = (0, bottom - 100, right + 6, bottom + 4)
        axis = f.get('rodAxis')

        def on_rod(x, y):
            if not axis:
                return False
            ax, ay, ux, uy = axis
            return abs((x + x0 - ax) * uy - (y + y0 - ay) * ux) < 12
        cleared = Image.new('L', (cell, cell), 0)
        cp = cleared.load()
        for y in range(max(0, zone[1]), min(cell, zone[3])):
            for x in range(zone[0], min(cell, zone[2])):
                if thick[x, y] and mp[x, y]:
                    cp[x, y] = 255
        # rope strands and shading that touch the cleared raft go with it. The raft's left end
        # (bucket side, where the character never reaches) is cleared outright, and so is any
        # dark shading in the deck band, which is the painted raft's shadow, not the character.
        grown = cleared.filter(ImageFilter.MaxFilter(7)).load()
        left_end = f['raftLeft'] - x0 + 40
        deck_top = bottom - 95
        for y in range(max(0, zone[1]), min(cell, zone[3])):
            for x in range(zone[0], min(cell, zone[2])):
                r, g, b, a = px[x0 + x, y0 + y]
                if a == 0:
                    continue
                in_deck = y >= deck_top
                dark = max(r, g, b) < 110 and r - b > 40 and r - g > 20 and r >= 45
                if on_rod(x, y):
                    continue
                if cp[x, y] or (mp[x, y] and grown[x, y]) or (in_deck and x < left_end and mp[x, y]) or (in_deck and dark):
                    px[x0 + x, y0 + y] = (0, 0, 0, 0)
        strip_bucket(px, x0, y0, f['raftLeft'] - x0, bottom)


def strip_bucket(px, x0, y0, raft_left, bottom):
    """The shared raft prop has its own bucket, so each frame's painted bucket goes: its paint,
    dark inside, rim highlights and metal handle. Popo's cream fur next to it stays."""
    paint = [(x, y) for y in range(max(0, bottom - 170), bottom)
             for x in range(max(0, raft_left - 10), raft_left + 210)
             if (lambda r, g, b, a: a > 200 and r > 180 and 50 < g < 160 and b < 90 and r - g > 60)(*px[x0 + x, y0 + y])]
    if not paint:
        return
    columns = sorted({x for x, _ in paint})
    left = right = columns[0]
    for x in columns[1:]:
        if x - right > 10:
            break
        right = x
    ys = [y for x, y in paint if left <= x <= right]
    box = (left - 6, min(ys) - 32, right + 6, max(ys) + 4)
    for y in range(max(0, box[1]), box[3]):
        for x in range(max(0, box[0]), box[2]):
            r, g, b, a = px[x0 + x, y0 + y]
            if a == 0:
                continue
            painted = r > 110 and r - g > 45 and r - b > 70
            inside = max(r, g, b) < 90
            handle = max(r, g, b) - min(r, g, b) < 40 and b >= r - 6 and max(r, g, b) > 60
            glint = min(r, g, b) > 185 and b >= r - 12
            if painted or inside or handle or glint:
                px[x0 + x, y0 + y] = (0, 0, 0, 0)
    # whatever is left of the bucket as loose specks goes too
    w, h = box[2] - box[0], box[3] - box[1]
    seen = set()
    for sy in range(max(0, box[1]), box[3]):
        for sx in range(max(0, box[0]), box[2]):
            if (sx, sy) in seen or px[x0 + sx, y0 + sy][3] == 0:
                continue
            part, q = [], deque([(sx, sy)])
            seen.add((sx, sy))
            while q:
                x, y = q.popleft()
                part.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if (nx, ny) not in seen and box[0] <= nx < box[2] and max(0, box[1]) <= ny < box[3] and px[x0 + nx, y0 + ny][3] > 0:
                            seen.add((nx, ny))
                            q.append((nx, ny))
            touches_edge = any(x in (box[0], box[2] - 1) or y in (max(0, box[1]), box[3] - 1) for x, y in part)
            if len(part) < 80 and not touches_edge:
                for x, y in part:
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
    # never bite into the character: a candidate surrounded mostly by colourful opaque pixels
    # (fur, paws, rod) is shading or a reel, not the thin line, so it stays
    body = Image.new('L', (w, h), 0)
    bp = body.load()
    for y in range(h):
        for x in range(w):
            r, g, bb, a = px[x, y]
            if a > 100 and not is_grey(r, g, bb):
                bp[x, y] = 255
    density = body.filter(ImageFilter.BoxBlur(7)).load()
    erased = {(x, y) for (x, y) in erased if density[x, y] < 120}
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
                frame['rodTip'], frame['rodAxis'] = find_rod_tip(px, x0, y0, cell, raft_bottom)
            frames.append(frame)
    return frames


def find_rod_tip(px, x0, y0, cell, raft_bottom, cell_h=None):
    """The rod is the largest orange component above the bucket and deck; its tip is the end farthest from the body."""
    cell_h = cell_h or cell
    cx = cy = n = 0
    for y in range(y0, y0 + cell_h):
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
    return list(tip), rod_axis(best)


def rod_axis(points):
    """Centre and unit direction of the rod (principal axis of its pixels)."""
    n = len(points)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    sxx = sum((p[0] - cx) ** 2 for p in points) / n
    syy = sum((p[1] - cy) ** 2 for p in points) / n
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in points) / n
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    return [cx, cy, math.cos(angle), math.sin(angle)]


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


def measure_character_frames(im):
    """Frames of a character-only sheet: content box, the seat (where Popo sits: the middle of
    his lower body at its lowest point), the rod tip, and the body area used for scaling."""
    px = im.load()
    cw, ch = im.size[0] // GRID, im.size[1] // GRID
    frames = []
    for row in range(GRID):
        for col in range(GRID):
            x0, y0 = col * cw, row * ch
            cream = [(x, y) for y in range(y0, y0 + ch) for x in range(x0, x0 + cw)
                     if (lambda r, g, b, a: a > 200 and r > 215 and g > 190 and b > 160 and r - b > 15)(*px[x, y])]
            top = min(y for _, y in cream)
            bottom = max(y for _, y in cream)
            low = [(x, y) for x, y in cream if y > bottom - (bottom - top) * 0.3]
            seat = [round(sum(x for x, _ in low) / len(low)), bottom]
            box = im.crop((x0, y0, x0 + cw, y0 + ch)).getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
            tip, _ = find_rod_tip(px, x0, y0, cw, y0 + ch + 135, ch)
            frames.append(dict(row=row, col=col, cellX=x0, cellY=y0, cellW=cw, cellH=ch,
                               box=[x0 + box[0], y0 + box[1], x0 + box[2], y0 + box[3]],
                               seat=[seat[0], seat[1]], rodTip=tip, bodyArea=len(cream)))
    return frames


def build_props(idle_cell):
    """The shared raft/bucket and rod props, cut from the idle frame by tools/build-popo-layers.py."""
    spec = importlib.util.spec_from_file_location('layers', os.path.join(ROOT, 'tools', 'build-popo-layers.py'))
    layers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(layers)
    layers.build(idle_cell).save(os.path.join(OUT, 'sprites', 'popo-props.webp'), lossless=True)
    Image.open(os.path.join(SRC, 'popo-mishap-poses-v2.png')).save(
        os.path.join(OUT, 'sprites', 'popo-mishap-poses-v2.webp'), quality=95, method=6)


def largest_part(im):
    """Keep only the largest opaque piece of a cell, dropping stray specks around the fish."""
    w, h = im.size
    alpha = im.getchannel('A').load()
    seen = bytearray(w * h)
    best = []
    for sy in range(h):
        for sx in range(w):
            if alpha[sx, sy] <= 20 or seen[sy * w + sx]:
                continue
            part, q = [], deque([(sx, sy)])
            seen[sy * w + sx] = 1
            while q:
                x, y = q.popleft()
                part.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and alpha[nx, ny] > 20 and not seen[ny * w + nx]:
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
            if len(part) > len(best):
                best = part
    keep = Image.new('L', (w, h), 0)
    kp = keep.load()
    for x, y in best:
        kp[x, y] = 255
    # keep the soft edge pixels around the piece, nothing further out
    keep = keep.filter(ImageFilter.MaxFilter(3))
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(im, (0, 0), keep)
    return out.crop(keep.getbbox())


def build_fish_atlas():
    sprites = []
    for name, grid, scale, names in FISH_SHEETS:
        sheet = Image.open(os.path.join(SRC, name)).convert('RGBA')
        cell = sheet.size[0] // grid
        for row in range(grid):
            for col in range(grid):
                key = names[row][col]
                if not key:
                    continue
                # fish can poke past their grid cell (the rhombus does), so slice with a margin;
                # bits of the neighbouring fish in the margin are smaller pieces and get dropped
                m = cell // 8
                window = (max(0, col * cell - m), max(0, row * cell - m), min(sheet.size[0], (col + 1) * cell + m), min(sheet.size[1], (row + 1) * cell + m))
                piece = largest_part(sheet.crop(window))
                if scale != 1:
                    piece = piece.resize((round(piece.size[0] * scale), round(piece.size[1] * scale)), Image.LANCZOS)
                sprites.append((key, piece))
    pad, width = 8, 2048
    x = y = row_h = 0
    places = []
    for key, piece in sprites:
        if x + piece.size[0] + pad > width:
            x, y, row_h = 0, y + row_h + pad, 0
        places.append((key, piece, x, y))
        x += piece.size[0] + pad
        row_h = max(row_h, piece.size[1])
    atlas = Image.new('RGBA', (width, y + row_h), (0, 0, 0, 0))
    boxes = {}
    for key, piece, px_, py_ in places:
        atlas.alpha_composite(piece, (px_, py_))
        boxes[key] = [px_, py_, px_ + piece.size[0], py_ + piece.size[1]]
    return atlas, boxes


def main():
    os.makedirs(os.path.join(OUT, 'backgrounds'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    for i, name in enumerate(BACKGROUNDS, start=1):
        im = Image.open(os.path.join(SRC, name)).convert('RGB')
        im.save(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'WEBP', quality=86, method=6)
        print('background', i, im.size)
    Image.open(os.path.join(SRC, TITLE)).convert('RGB').save(os.path.join(OUT, 'backgrounds', 'title.webp'), 'WEBP', quality=86, method=6)
    play = largest_part(Image.open(os.path.join(SRC, PLAY_BUTTON)).convert('RGBA'))
    play.thumbnail((512, 512), Image.LANCZOS)
    play.save(os.path.join(OUT, 'sprites', 'play.webp'), 'WEBP', quality=92, method=6)

    data = {'sheets': {}}
    prop = Image.open(os.path.join(SRC, PROP_SOURCE)).convert('RGBA')
    clear_neighbour_bleed(prop)
    erase_line_and_hook(prop, measure_frames(prop, with_rod=True))
    build_props(prop.crop((418, 0, 836, 418)))

    fishing = Image.open(os.path.join(SRC, FISHING)).convert('RGBA')
    remove_islands(fishing, min_size=300)
    fishing.save(os.path.join(OUT, 'sprites', 'popo-fishing.webp'), 'WEBP', quality=90, method=6)
    data['sheets']['fishing'] = dict(width=fishing.size[0], height=fishing.size[1], frames=measure_character_frames(fishing))
    print('sheet fishing (clean) measured')

    for key, (name, erase) in SHEETS.items():
        im = Image.open(os.path.join(SRC, name)).convert('RGBA')
        frames = measure_frames(im, with_rod=erase)
        strip_raft(im, frames)
        for f in frames:
            f['box'] = content_box(im, f)
        im.save(os.path.join(OUT, 'sprites', f'popo-{key}.webp'), 'WEBP', quality=90, method=6)
        data['sheets'][key] = dict(width=im.size[0], height=im.size[1], frames=frames)
        print('sheet', key, 'frames measured and stripped')

    fish, boxes = build_fish_atlas()
    fish.save(os.path.join(OUT, 'sprites', 'fish.webp'), 'WEBP', quality=90, method=6)
    data['fish'] = dict(width=fish.size[0], height=fish.size[1], boxes=boxes)
    print('fish atlas', len(boxes), 'sprites')

    with open(os.path.join(ROOT, 'src', 'background-data.js'), 'w') as fh:
        fh.write('// Generated by tools/build-assets.py: the four backgrounds as data URLs so WebGL can use\n')
        fh.write('// them even when the game is opened straight from the file system.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\nPopoGame.BACKGROUND_DATA = [\n')
        for i in range(1, len(BACKGROUNDS) + 1):
            with open(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'rb') as img:
                fh.write("  'data:image/webp;base64," + base64.b64encode(img.read()).decode() + "',\n")
        fh.write('];\n')
        with open(os.path.join(OUT, 'backgrounds', 'title.webp'), 'rb') as img:
            fh.write("PopoGame.TITLE_DATA = 'data:image/webp;base64," + base64.b64encode(img.read()).decode() + "';\n")
        with open(os.path.join(OUT, 'sprites', 'play.webp'), 'rb') as img:
            fh.write("PopoGame.PLAY_DATA = 'data:image/webp;base64," + base64.b64encode(img.read()).decode() + "';\n")

    with open(os.path.join(ROOT, 'src', 'sprite-data.js'), 'w') as fh:
        fh.write('// Generated by tools/build-assets.py from the original sheets. Do not edit by hand.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\n')
        fh.write('PopoGame.SHEET_DATA = ' + json.dumps(data['sheets'], indent=1) + ';\n')
        fh.write('PopoGame.FISH_ATLAS = ' + json.dumps(data['fish']) + ';\n')
    print('wrote src/sprite-data.js')


if __name__ == '__main__':
    sys.exit(main())

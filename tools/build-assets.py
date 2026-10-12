#!/usr/bin/env python3
"""Builds the compressed game assets in assets/ from the untouched originals in asset/.

Backgrounds and sprites are re-encoded as WebP. Popo's pose sheets are cleaned of generation
specks and repacked so every figure is whole, then measured (seat point, rod tip) into
src/sprite-data.js. The raft and rod props are fitted into the cells the game registers to.

Requires Pillow (pip install Pillow).
"""
import base64
import json
import math
import os
import sys
from collections import deque

from PIL import Image, ImageChops, ImageFilter

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
HINT_HAND = 'hint-hand.png'
SWIFTEE = 'swiftee.png'
# More fish of each shape, in new colours and patterns (a 5x5 sheet on a transparent ground).
# Measured from the art: six of its four-sided fish are trapeziums (one pair of parallel
# sides), used for the end-of-journey mystery fish; two have no parallel sides and are left
# out, because they read as trapeziums and level 4 is "every quadrilateral but the trapezium".
FISH_VARIANT_SHEET = 'fish-variants.png'
VARIANT_GRID = [
    ['triangle-red', 'triangle-orange', 'triangle-yellow', 'triangle-green', 'triangle-pink'],
    ['trapezium-blue', 'trapezium-purple', 'trapezium-red', 'rhombus-teal', 'trapezium-yellow'],
    ['pentagon-pink', 'pentagon-orange', 'pentagon-blue', 'pentagon-green', 'pentagon-purple'],
    ['hexagon-yellow', 'hexagon-teal', 'hexagon-pink', 'hexagon-orange', 'hexagon-blue'],
    ['trapezium-green', None, None, 'trapezium-gold', 'rhombus-red'],
]
# Fish too close in colour to the water vanish in it, so they are left out: blue and teal fish.
# The water behind the fish is about this colour; a body colour must be at least this far away.
WATER_RGB = (1, 132, 242)
MIN_WATER_CONTRAST = 140


def body_colour(piece):
    # the average of the vivid body pixels (pale fins, white eyes and dark outlines left out)
    px = [p for p in piece.resize((max(1, piece.size[0] // 4), max(1, piece.size[1] // 4))).getdata()
          if p[3] > 220 and max(p[:3]) > 60 and (max(p[:3]) - min(p[:3])) / max(p[:3]) > 0.5]
    return tuple(sum(p[i] for p in px) / len(px) for i in range(3)) if px else WATER_RGB
# Popo's poses: 3x3 sheets of the character with his rod or paddle only (no raft, line or hook).
FISHING = 'popo-fishing-clean.png'
ROWING = 'popo-paddling.png'
# The raft with its bucket (left) and the rod (right), drawn under and beside Popo.
PROPS = 'props-new.png'
# Where the game expects the props inside a 418px cell: raft rope-to-rope and its bottom log,
# and the rod's grip end and tip (the wrong-answer reaction rotates the rod about its grip).
RAFT_CELL = dict(left=5, right=367, bottom=383)
ROD_CELL = dict(grip=(205, 303), tip=(356, 129))
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


def is_rod(r, g, b, a):
    return a > 160 and r > 140 and 45 < g < 160 and b < 100 and r - g > 45


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


def figure_masks(mask, min_size=4000):
    """Connected pieces of a mask (8-connected), largest first, as lists of points."""
    w, h = mask.size
    px = mask.load()
    seen = bytearray(w * h)
    pieces = []
    for sy in range(h):
        for sx in range(w):
            if not px[sx, sy] or seen[sy * w + sx]:
                continue
            piece, q = [], deque([(sx, sy)])
            seen[sy * w + sx] = 1
            while q:
                x, y = q.popleft()
                piece.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny * w + nx]:
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
            if len(piece) >= min_size:
                pieces.append(piece)
    return sorted(pieces, key=len, reverse=True)


def is_pure_fringe(r, g, b):
    return (r > 170 and g < 70 and b < 70) or (r > 200 and g > 185 and b < 80)


def cut_figures(im, count, defringe=True):
    """Generated sheets can have red/yellow specks scattered around the figures and figures
    that cross their grid lines. Find each whole figure by shape (thin specks don't survive an
    opening) and cut it out with its soft edge, as (centre y, centre x, cropped figure)."""
    mask = im.getchannel('A').point(lambda v: 255 if v > 20 else 0)
    core = mask.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
    pieces = figure_masks(core)[:count]
    assert len(pieces) == count, f'expected {count} figures, found {len(pieces)}'
    figures = []
    for piece in pieces:
        one = Image.new('L', im.size, 0)
        op = one.load()
        for p in piece:
            op[p] = 255
        keep = ImageChops.multiply(one.filter(ImageFilter.MaxFilter(5)), mask)
        fig = Image.new('RGBA', im.size, (0, 0, 0, 0))
        fig.paste(im, (0, 0), keep)
        fp = fig.load()
        box = keep.getbbox()
        for _ in range(2 if defringe else 0):
            drop = [(x, y) for y in range(max(1, box[1]), min(im.size[1] - 1, box[3]))
                    for x in range(max(1, box[0]), min(im.size[0] - 1, box[2]))
                    if fp[x, y][3] and is_pure_fringe(*fp[x, y][:3])
                    and any(fp[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
            for p in drop:
                fp[p] = (0, 0, 0, 0)
        cy = sum(y for _, y in piece) / len(piece)
        cx = sum(x for x, _ in piece) / len(piece)
        figures.append((cy, cx, fig.crop(fig.getchannel('A').getbbox())))
    return figures


def normalise_sheet(im, count=9, margin=28):
    """Repacks a sheet's whole figures into an even 3x3 grid in reading order with clear space
    around every one."""
    figures = cut_figures(im, count)
    figures.sort(key=lambda f: f[0])
    rows = [sorted(figures[i:i + GRID], key=lambda f: f[1]) for i in range(0, count, GRID)]
    ordered = [f[2] for row in rows for f in row]
    cw = max(f.size[0] for f in ordered) + 2 * margin
    ch = max(f.size[1] for f in ordered) + 2 * margin
    sheet = Image.new('RGBA', (cw * GRID, ch * GRID), (0, 0, 0, 0))
    for i, fig in enumerate(ordered):
        # bottom-aligned in its cell so every figure sits on the same baseline
        x = (i % GRID) * cw + (cw - fig.size[0]) // 2
        y = (i // GRID) * ch + ch - margin - fig.size[1]
        sheet.alpha_composite(fig, (x, y))
    return sheet


def measure_character_frames(im, with_rod=True):
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
            frame = dict(row=row, col=col, cellX=x0, cellY=y0, cellW=cw, cellH=ch,
                         box=[x0 + box[0], y0 + box[1], x0 + box[2], y0 + box[3]],
                         seat=[seat[0], seat[1]], bodyArea=len(cream))
            if with_rod:
                frame['rodTip'], _ = find_rod_tip(px, x0, y0, cw, y0 + ch + 135, ch)
            frames.append(frame)
    return frames


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


def find_mouth(piece):
    """Where a fish's smile is, as a fraction of its sprite (fish face right in the sheets):
    the dark pixels below the big white eye."""
    w, h = piece.size
    px = piece.load()
    white = Image.new('L', (w, h), 0)
    wp = white.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and min(r, g, b) > 225:
                wp[x, y] = 255
    eye = figure_masks(white, min_size=50)[0]
    ex0, ex1 = min(x for x, _ in eye), max(x for x, _ in eye)
    ey0, ey1 = min(y for _, y in eye), max(y for _, y in eye)
    smile = [(x, y) for y in range(ey1 - (ey1 - ey0) // 4, min(h, ey1 + (ey1 - ey0))) for x in range(max(0, ex0), min(w, ex1 + (ex1 - ex0)))
             if not (ex0 <= x <= ex1 and ey0 <= y <= ey1) and px[x, y][3] > 200 and max(px[x, y][:3]) < 90]
    if not smile:
        return [0.9, 0.58]
    mx = sum(x for x, _ in smile) / len(smile)
    my = sum(y for _, y in smile) / len(smile)
    return [round(mx / w, 3), round(my / h, 3)]


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
    boxes, mouths = {}, {}
    for key, piece, px_, py_ in places:
        atlas.alpha_composite(piece, (px_, py_))
        boxes[key] = [px_, py_, px_ + piece.size[0], py_ + piece.size[1]]
        mouths[key] = find_mouth(piece)
    return atlas, boxes, mouths


def build_fish_variants(fish_boxes):
    """Cuts the extra fish out whole (the sheet is clean, so no speck removal, which would
    thin red and yellow outlines), sizes each like the original fish of its shape, and packs
    them into one atlas. Scaling is premultiplied so the coloured glow kept under fully
    transparent pixels can't bleed into the edges."""
    sheet = Image.open(os.path.join(SRC, FISH_VARIANT_SHEET)).convert('RGBA')
    figures = sorted(cut_figures(sheet, 25, defringe=False), key=lambda f: f[0])
    rows = [sorted(figures[i:i + 5], key=lambda f: f[1]) for i in range(0, 25, 5)]
    sprites = []
    for r, names in enumerate(VARIANT_GRID):
        for c, key in enumerate(names):
            if not key:
                continue
            fig = rows[r][c][2]
            contrast = math.dist(body_colour(fig), WATER_RGB)
            if contrast < MIN_WATER_CONTRAST:
                print(f'  left out {key}: too close to the water colour ({contrast:.0f})')
                continue
            base = key.split('-')[0]
            x0, y0, x1, y1 = fish_boxes[base]
            k = max(x1 - x0, y1 - y0) / max(fig.size)
            fig = fig.convert('RGBa').resize((round(fig.size[0] * k), round(fig.size[1] * k)), Image.LANCZOS).convert('RGBA')
            sprites.append((key, base, fig))
    pad, width = 8, 2048
    x = y = row_h = 0
    places = []
    for key, base, piece in sprites:
        if x + piece.size[0] + pad > width:
            x, y, row_h = 0, y + row_h + pad, 0
        places.append((key, base, piece, x, y))
        x += piece.size[0] + pad
        row_h = max(row_h, piece.size[1])
    atlas = Image.new('RGBA', (width, y + row_h), (0, 0, 0, 0))
    boxes, mouths, bases = {}, {}, {}
    for key, base, piece, px_, py_ in places:
        atlas.alpha_composite(piece, (px_, py_))
        boxes[key] = [px_, py_, px_ + piece.size[0], py_ + piece.size[1]]
        mouths[key] = find_mouth(piece)
        bases[key] = base
    atlas.save(os.path.join(OUT, 'sprites', 'fish-variants.webp'), 'WEBP', quality=90, method=6)
    print('fish variants', len(boxes), atlas.size)
    return dict(width=atlas.size[0], height=atlas.size[1], boxes=boxes, mouths=mouths, bases=bases)


def water_mask(im):
    """Where the surface waves may move the painting: open water, not the snow, ice shelves and
    icebergs along the shoreline. Light pixels in the shoreline band that join the snow above are
    land; thin foam on the waves is not. Feathered so the waves fade out before the ice."""
    w, h = im.size
    band = (0, 250, w, 440)
    r = im.crop(band).getchannel('R')
    light = r.point(lambda v: 255 if v > 105 else 0).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    lp = light.load()
    bw, bh = light.size
    land = Image.new('L', light.size, 0)
    seen = set()
    q = deque((x, 0) for x in range(bw) if lp[x, 0])
    seen.update(q)
    while q:
        x, y = q.popleft()
        land.putpixel((x, y), 255)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < bw and 0 <= ny < bh and (nx, ny) not in seen and lp[nx, ny]:
                seen.add((nx, ny))
                q.append((nx, ny))
    land = land.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(8))
    mask = Image.new('L', (w, h), 0)
    mask.paste(255, (0, band[3], w, h))
    mask.paste(Image.eval(land, lambda v: 255 - v), (0, band[1]))
    return mask.resize((w // 2, h // 2), Image.LANCZOS)


def build_props():
    """Fit the raft and the rod from the props art into two 418px cells (see RAFT_CELL, ROD_CELL)."""
    art = Image.open(os.path.join(SRC, PROPS)).convert('RGBA')
    split = art.size[0] * 5 // 8
    raft_art = art.crop((0, 0, split, art.size[1]))
    px = raft_art.load()
    w, h = raft_art.size
    wide = [y for y in range(h) if sum(1 for x in range(0, w, 2) if px[x, y][3] > 128) * 2 > w * 0.4]
    band = [x for y in wide for x in range(w) if px[x, y][3] > 128]
    left, right, bottom = min(band), max(band), max(wide)
    k = (RAFT_CELL['right'] - RAFT_CELL['left']) / (right - left)
    raft = raft_art.resize((round(w * k), round(h * k)), Image.LANCZOS)
    atlas = Image.new('RGBA', (836, 418), (0, 0, 0, 0))
    atlas.alpha_composite(raft, (round(RAFT_CELL['left'] - left * k), round(RAFT_CELL['bottom'] - bottom * k)))

    rod_art = art.crop((split, 0, art.size[0], art.size[1]))
    rod_art = rod_art.crop(rod_art.getchannel('A').getbbox())
    rp = rod_art.load()
    pts = [(x, y) for y in range(rod_art.size[1]) for x in range(rod_art.size[0]) if rp[x, y][3] > 128]
    grip = min(pts, key=lambda p: p[0] - p[1])
    tip = max(pts, key=lambda p: p[0] - p[1])
    (gx, gy), (tx, ty) = ROD_CELL['grip'], ROD_CELL['tip']
    scale = math.dist((gx, gy), (tx, ty)) / math.dist(grip, tip)
    turn = math.atan2(ty - gy, tx - gx) - math.atan2(tip[1] - grip[1], tip[0] - grip[0])
    small = rod_art.resize((round(rod_art.size[0] * scale), round(rod_art.size[1] * scale)), Image.LANCZOS)
    sgx, sgy = grip[0] * scale, grip[1] * scale
    cos, sin = math.cos(-turn), math.sin(-turn)
    # inverse map: cell point -> scaled art point, rotating about the grip
    rod = small.transform((418, 418), Image.AFFINE, (cos, -sin, sgx - cos * gx + sin * gy, sin, cos, sgy - sin * gx - cos * gy), Image.BICUBIC)
    atlas.alpha_composite(rod, (418, 0))
    atlas.save(os.path.join(OUT, 'sprites', 'popo-props.webp'), lossless=True)


def character_sheet(name, key, with_rod=True, repack=True):
    sheet = Image.open(os.path.join(SRC, name)).convert('RGBA')
    if repack:
        sheet = normalise_sheet(sheet)
    sheet.save(os.path.join(OUT, 'sprites', f'popo-{key}.webp'), 'WEBP', quality=92, method=6)
    print('sheet', key, sheet.size)
    return dict(width=sheet.size[0], height=sheet.size[1], frames=measure_character_frames(sheet, with_rod))


def is_belly(r, g, b, a):
    return a > 200 and r > 220 and 150 < g < 215 and b < 140


def build_swiftee(size=260, margin=12):
    """Swiftee's four wing beats in one row. The wings change every frame's outline, so the
    frames register by the yellow belly to keep the body still while the wings flap."""
    figures = sorted(cut_figures(Image.open(os.path.join(SRC, SWIFTEE)).convert('RGBA'), 4), key=lambda f: f[1])
    k = size / max(f[2].size[1] for f in figures)
    frames, bellies = [], []
    for _, _, fig in figures:
        fig = fig.resize((round(fig.size[0] * k), round(fig.size[1] * k)), Image.LANCZOS)
        px = fig.load()
        pts = [(x, y) for y in range(fig.size[1]) for x in range(fig.size[0]) if is_belly(*px[x, y])]
        frames.append(fig)
        bellies.append((sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)))
    left = max(b[0] for b in bellies) + margin
    top = max(b[1] for b in bellies) + margin
    cw = math.ceil(left + max(f.size[0] - b[0] for f, b in zip(frames, bellies)) + margin)
    ch = math.ceil(top + max(f.size[1] - b[1] for f, b in zip(frames, bellies)) + margin)
    atlas = Image.new('RGBA', (cw * len(frames), ch), (0, 0, 0, 0))
    for i, (fig, (bx, by)) in enumerate(zip(frames, bellies)):
        atlas.alpha_composite(fig, (i * cw + round(left - bx), round(top - by)))
    atlas.save(os.path.join(OUT, 'sprites', 'swiftee.webp'), 'WEBP', quality=92, method=6)
    print('swiftee', atlas.size)
    return dict(width=cw, height=ch, frames=len(frames), belly=[round(left), round(top)])


def main():
    os.makedirs(os.path.join(OUT, 'backgrounds'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    for i, name in enumerate(BACKGROUNDS, start=1):
        im = Image.open(os.path.join(SRC, name)).convert('RGB')
        im.save(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'WEBP', quality=86, method=6)
        water_mask(im).save(os.path.join(OUT, 'backgrounds', f'water-{i}.png'), optimize=True)
        print('background', i, im.size)
    Image.open(os.path.join(SRC, TITLE)).convert('RGB').save(os.path.join(OUT, 'backgrounds', 'title.webp'), 'WEBP', quality=86, method=6)
    hand = Image.open(os.path.join(SRC, HINT_HAND)).convert('RGBA')
    hand.thumbnail((180, 216), Image.LANCZOS)
    hand.save(os.path.join(OUT, 'sprites', 'hint-hand.webp'), 'WEBP', quality=92, method=6)
    play = largest_part(Image.open(os.path.join(SRC, PLAY_BUTTON)).convert('RGBA'))
    play.thumbnail((512, 512), Image.LANCZOS)
    play.save(os.path.join(OUT, 'sprites', 'play.webp'), 'WEBP', quality=92, method=6)

    build_props()
    data = {'sheets': {
        # already clean and evenly gridded; the wrong-answer reaction cuts Popo and his rod out
        # of its idle cell by position, so it keeps its original layout
        'fishing': character_sheet(FISHING, 'fishing', repack=False),
        'rowing': character_sheet(ROWING, 'rowing', with_rod=False),
    }}

    fish, boxes, mouths = build_fish_atlas()
    fish.save(os.path.join(OUT, 'sprites', 'fish.webp'), 'WEBP', quality=90, method=6)
    data['fish'] = dict(width=fish.size[0], height=fish.size[1], boxes=boxes, mouths=mouths)
    data['variants'] = build_fish_variants(boxes)
    data['swiftee'] = build_swiftee()
    print('fish atlas', len(boxes), 'sprites')

    with open(os.path.join(ROOT, 'src', 'background-data.js'), 'w') as fh:
        fh.write('// Generated by tools/build-assets.py: the four backgrounds as data URLs so WebGL can use\n')
        fh.write('// them even when the game is opened straight from the file system.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\nPopoGame.BACKGROUND_DATA = [\n')
        for i in range(1, len(BACKGROUNDS) + 1):
            with open(os.path.join(OUT, 'backgrounds', f'location-{i}.webp'), 'rb') as img:
                fh.write("  'data:image/webp;base64," + base64.b64encode(img.read()).decode() + "',\n")
        fh.write('];\nPopoGame.WATER_MASKS = [\n')
        for i in range(1, len(BACKGROUNDS) + 1):
            with open(os.path.join(OUT, 'backgrounds', f'water-{i}.png'), 'rb') as img:
                fh.write("  'data:image/png;base64," + base64.b64encode(img.read()).decode() + "',\n")
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
        fh.write('PopoGame.FISH_VARIANT_ATLAS = ' + json.dumps(data['variants']) + ';\n')
        fh.write('PopoGame.SWIFTEE_DATA = ' + json.dumps(data['swiftee']) + ';\n')
    print('wrote src/sprite-data.js')


if __name__ == '__main__':
    sys.exit(main())

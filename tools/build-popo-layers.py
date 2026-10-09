#!/usr/bin/env python3
"""Cut the raft/bucket and the rod out of Popo's idle frame as registered prop layers.

Coordinates are manually traced in the 418px idle cell, not trimmed per part. The deck
hidden by the seated feet is filled with adjacent deck texture. Called by build-assets.py
with the hook-erased idle cell; the generated character pose atlas supplies the body.
"""
from PIL import Image, ImageDraw

body_outline = [(96,278),(104,255),(118,231),(137,210),(140,190),
    (150,171),(166,149),(182,146),(198,154),(209,169),(214,191),
    (227,195),(242,195),(248,202),(244,216),(226,229),(216,244),
    (225,251),(237,251),(247,261),(247,272),(241,281),(232,288),
    (232,298),(246,302),(256,313),(255,324),(248,334),(238,339),
    (216,337),(194,329),(181,339),(166,343),(149,340),(131,334),
    (117,326),(109,312),(110,290)]
rod_outline = [(201,300),(214,269),(225,245),(244,216),(264,187),
    (286,162),(313,141),(338,126),(348,119),(358,122),(364,133),
    (357,145),(345,148),(321,167),(304,183),(282,212),(259,243),
    (242,270),(222,306)]

def mask(size, points):
    m = Image.new('L', size)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return m


def build(cell):
    """Return the 836x418 props atlas (raft with bucket, then rod) for one 418px idle cell."""
    cut = lambda m: Image.composite(cell, Image.new('RGBA', cell.size), m)
    body_mask = mask(cell.size, body_outline)
    rod_mask = mask(cell.size, rod_outline)
    rod = cut(rod_mask)
    rod.paste((0, 0, 0, 0), (0, 0, 418, 418), body_mask)
    raft = cell.copy()
    raft.paste((0, 0, 0, 0), (0, 0, 418, 418), rod_mask)
    raft.paste((0, 0, 0, 0), (0, 0, 418, 418), body_mask)
    # Continue the existing straight handle underneath the occluding paws. This is
    # visible only when released; no missing body pixels are fabricated.
    handle = Image.new('RGBA', cell.size)
    draw = ImageDraw.Draw(handle)
    draw.line([(209, 305), (245, 240)], fill=(105, 49, 19, 255), width=10)
    draw.line([(208, 303), (244, 240)], fill=(198, 100, 29, 255), width=6)
    handle.alpha_composite(rod)
    rod = handle
    # Exposed deck texture, with original horizontal plank seams retained.
    deck = cell.crop((264, 301, 291, 344)).resize((153, 43))
    raft.alpha_composite(deck, (109, 301))
    # The traced body outline leaves a sliver of fur beside the bucket; fur is never raft.
    p = raft.load()
    for y in range(240, 301):
        for x in range(0, 140):
            r, g, b, a = p[x, y]
            if a and r > 170 and g > 140 and b > 110 and r - g < 60 and r - b > 10:
                p[x, y] = (0, 0, 0, 0)
    # Remove residual line/hook islands, keeping the original bucket and raft.
    for layer in (raft, rod):
        p = layer.load()
        for y in range(418):
            for x in range(418):
                r, g, b, a = p[x, y]
                if a < 32 or (layer is raft and (y < 273 or (x > 112 and y < 301))):
                    p[x, y] = (0, 0, 0, 0)
    atlas = Image.new('RGBA', (836, 418))
    for i, layer in enumerate((raft, rod)):
        atlas.alpha_composite(layer, (i * 418, 0))
    return atlas


if __name__ == '__main__':
    print('Run tools/build-assets.py; it builds the props from the processed idle frame.')

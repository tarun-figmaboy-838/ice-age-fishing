# Asset review

Automated scan of every sprite cell for clipping at cell or atlas edges, stray fragments
from neighbouring cells, and grey leftovers of the erased fishing line. `damaged-cells.png`
is the contact sheet; each flagged cell is also saved on its own, and `findings.json` has
the boxes.

| Sheet | Cell | Problem | Status |
| --- | --- | --- | --- |
| popo-casting | row 1, col 2 | The raft's left end is cut off at the cell edge in the source art. | Excluded from the game; regenerate if that frame is wanted. |
| popo-mishap-poses-v2 | wet | The crop box started 5 rows above the body and caught a sliver of the pose above. | Fixed in `src/popo.js` (box top moved to row 450). |

Clean: all nine fishing frames, the other eight casting frames, all nine rowing frames,
the raft and rod props, the other seven poses, and all 15 fish (no atlas-edge contact, no
overlaps).

"""End-to-end playthrough in headless Chromium: python3 tests/playthrough.py [correct|wrong|both].

Plays the whole journey through the real taps (every level is "catch them all"), checks that
fish swim out of view and come back, that the tutorial hand and the idle hint only pick fish in
view, that pause freezes the game, that Next is ignored while paused, and that Next ends the
journey back on the title. Fails on any console error.
"""
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / 'index.html').as_uri() + '?debug'
TOTAL = 13  # 3 triangles + 3 pentagons + 3 hexagons + 4 quadrilaterals

STATE = '''() => { const d = window.popoDebug, s = d.state, g = d.game;
  return { phase: s.phase, loc: s.locationIndex, caught: s.collected.length, paused: s.paused,
           next: !document.getElementById('btn-next').hidden, start: !document.getElementById('screen-start').hidden,
           hand: !document.getElementById('hand').hidden, handFish: g.handFish ? !g.handFish.offstage : null }; }'''

# the client point of a fish to tap: an in-view target (right) or distractor (wrong), well inside the stage
PICK = '''(right) => { const d = window.popoDebug, s = d.state, g = d.game, k = g.stage.scale;
  const c = document.getElementById('stage').getBoundingClientRect();
  const f = s.fish.find(f => !f.gone && !f.offstage && !f.escaping && f.x > 120 && f.x < 1550
                       && PopoGame.matchesTarget(f.key, s.target) === right);
  return f ? [f.x * k + c.left, f.y * k + c.top] : null; }'''


def check(ok, what, detail=''):
    print(('PASS ' if ok else 'FAIL ') + what + (f' -- {detail}' if detail else ''), flush=True)
    if not ok:
        raise SystemExit(1)


def state(page):
    return page.evaluate(STATE)


def wait_for(page, cond, timeout=60, soft=False):
    end = time.time() + timeout
    while time.time() < end:
        st = state(page)
        if cond(st):
            return st
        page.wait_for_timeout(100)
    if soft:
        return None
    raise SystemExit(f'FAIL timed out waiting; last state {state(page)}')


def tap_fish(page, right, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        point = page.evaluate(PICK, right)
        if point:
            page.mouse.click(*point)
            return True
        page.wait_for_timeout(100)
    return False


def play(mode):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(URL)
        page.wait_for_function('() => !document.getElementById("btn-play").disabled', timeout=30000)
        page.click('#btn-play', force=True)
        st = wait_for(page, lambda s: s['phase'] == 'ready')
        check(st['hand'] and st['handFish'], f'{mode}: tutorial hand points at a fish in view')

        # fish swim out of view and come back
        seen = page.evaluate('''async () => { const s = window.popoDebug.state; const out = new Set(), back = new Set();
          for (let i = 0; i < 160; i++) { for (const f of s.fish) { if (f.offstage) out.add(f); else if (out.has(f)) back.add(f); }
            await new Promise(r => setTimeout(r, 100)); }
          return [out.size, back.size]; }''')
        check(seen[0] > 0 and seen[1] > 0, f'{mode}: fish swim out of view and come back', f'{seen[0]} left, {seen[1]} returned')

        # pause freezes the game clock
        page.evaluate('() => window.popoDebug.game.togglePause()')
        before = page.evaluate('() => PopoGame.clock.time')
        page.wait_for_timeout(600)
        check(page.evaluate('() => PopoGame.clock.time') == before, f'{mode}: pause freezes the game')
        page.evaluate('() => window.popoDebug.game.togglePause()')

        level_wrong = set()
        while True:
            st = wait_for(page, lambda s: s['phase'] in ('ready', 'levelTransition') or s['next'], 90)
            if st['next'] or st['phase'] == 'levelTransition' and st['caught'] >= TOTAL:
                break
            if st['phase'] != 'ready':
                page.wait_for_timeout(200)  # rowing to the next level
                continue
            caught = st['caught']
            if mode == 'wrong' and st['loc'] not in level_wrong:
                check(tap_fish(page, False), f'{mode}: found a wrong fish in level {st["loc"] + 1}')
                if wait_for(page, lambda s: s['phase'] != 'ready', 3, soft=True):  # else the tap missed a moving fish
                    level_wrong.add(st['loc'])
                    wait_for(page, lambda s: s['phase'] == 'ready', 30)
                continue
            if not tap_fish(page, True):
                raise SystemExit(f'FAIL {mode}: no fish to catch in view; {state(page)}')
            if wait_for(page, lambda s: s['phase'] != 'ready', 3, soft=True):
                wait_for(page, lambda s: s['caught'] > caught, 30)
        check(state(page)['caught'] == TOTAL, f'{mode}: all {TOTAL} fish caught across the four levels', str(state(page)['caught']))
        if mode == 'wrong':
            check(len(level_wrong) == 4, f'{mode}: a wrong fish was tapped (and recovered from) in every level')

        st = wait_for(page, lambda s: s['next'], 60)
        page.evaluate('() => window.popoDebug.game.togglePause()')
        page.evaluate('() => window.popoDebug.game.next()')
        check(state(page)['next'] and state(page)['phase'] != 'intro', f'{mode}: Next is ignored while paused')
        page.evaluate('() => window.popoDebug.game.togglePause()')
        page.click('#btn-next')
        st = wait_for(page, lambda s: s['phase'] == 'intro' and s['start'], 10)
        check(not st['next'], f'{mode}: Next ends the journey on the title, ready to play again')
        page.click('#btn-play', force=True)
        wait_for(page, lambda s: s['phase'] == 'ready', 60)
        check(state(page)['caught'] == 0, f'{mode}: playing again starts fresh')
        check(not errors, f'{mode}: no console errors', '; '.join(errors[:3]))
        browser.close()


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'both'
    for m in (['correct', 'wrong'] if mode == 'both' else [mode]):
        play(m)

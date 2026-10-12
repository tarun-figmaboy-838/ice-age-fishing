"""Fish diversity and generated-sprite catch regression: python3 tests/fish_variation.py."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BOOT = (ROOT / 'tests/mishap.py').read_text().split("BOOT = '''", 1)[1].split("'''", 1)[0]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((ROOT / 'index.html').as_uri() + '?debug')
    page.wait_for_function('window.PopoGame.assets.fish?.variants')
    result = page.evaluate('''() => {
      const P = PopoGame;
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      for (const fixed of [false, true]) {
        const random = Math.random;
        if (fixed) Math.random = () => 0;
        try {
          for (const location of P.LOCATIONS) {
            const ch = location.challenges[0];
            let last = '';
            for (let i = 0; i < 100; i++) {
              const keys = P.challengeFish(ch);
              const targets = keys.filter(k => P.matchesTarget(k, ch.target));
              check(keys.length === 6 && new Set(keys).size === 6, 'Duplicate fish: ' + keys);
              check(targets.length === (ch.target === 'quadrilateral' ? 4 : 3), 'Wrong count');
              const signature = [...targets].sort().join(',');
              check(signature !== last, 'Repeated school: ' + signature);
              last = signature;
              check(!keys.some(k => P.getShape(k).shape === 'trapezium'), 'Spoiled mystery fish');
              if (ch.target === 'quadrilateral') {
                check(new Set(targets.map(k => P.getShape(k).shape)).size === 4, 'Lost quad types');
              }
            }
          }
        } finally { Math.random = random; }
      }
      for (const [key, variant] of Object.entries(P.FISH_VARIANTS)) {
        const shape = P.getShape(key), base = P.getShape(variant.base);
        check(shape.sides === base.sides, 'Changed side count');
        check(base.categories.every(c => P.matchesTarget(key, c)), 'Lost shape family');
        const fish = new P.Fish(key, 700, 650, 1);
        check(fish.w > 0 && fish.h > 0 && fish.mouth.every(n => n > 0 && n < 1), 'Invalid sprite');
      }
      return Object.keys(P.FISH_VARIANTS);
    }''')
    print('PASS: 800 schools, unique fish, stable target counts, varied replay sets, shape families', flush=True)

    page.evaluate(BOOT)
    for key in result:
        page.evaluate('''key => {
          const P = PopoGame, {game:g, state:s} = popoDebug;
          P.newToken(); P.clock.cancelAll(); g.endLine();
          s.target = P.getShape(key).shape;
          const fish = new P.Fish(key, 700, 650, 1);
          // A second target keeps this regression in the same challenge after the catch.
          const remaining = new P.Fish(key, 1200, 720, -1);
          s.fish = [fish, remaining]; s.phase = P.PHASE.READY; s.selectedFish = null;
          g.draw(); window.beforeCatch = s.collected.length;
          window.testFish = fish;
          g.onFishTap(fish);
        }''', key)
        page.evaluate('step(12000)')
        assert page.evaluate('''() => testFish.gone &&
          popoDebug.state.collected.length === beforeCatch + 1 &&
          popoDebug.state.collected.at(-1) === testFish.key && popoDebug.state.phase === 'ready'
        '''), key
    print(f'PASS: all {len(result)} new fish caught and collected through real catch animations', flush=True)

    # Contact sheet for visual review of the actual cached sprites at game size.
    page.evaluate('''() => {
      const P = PopoGame;
      const canvas = document.createElement('canvas'); canvas.id = 'fish-preview';
      canvas.width = 1400; canvas.height = 920;
      canvas.style = 'position:fixed;inset:0;z-index:9999;width:1400px;height:920px';
      document.body.append(canvas);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e7f5ff'; ctx.fillRect(0,0,1400,920);
      const of = base => Object.keys(P.FISH_VARIANTS).filter(k => P.FISH_VARIANTS[k].base === base);
      const groups = [of('triangle'), of('pentagon'), of('hexagon'), [...of('rhombus'), ...of('trapezium')].slice(0, 5)];
      groups.forEach((keys,row) => keys.forEach((key,col) => {
        const f = new P.Fish(key,140+col*275,110+row*225,1,1.25);
        f.draw(ctx); ctx.fillStyle='#173b52'; ctx.font='17px sans-serif';ctx.textAlign='center';
        ctx.fillText(key,f.x,215+row*225);
      }));
    }''')
    page.locator('#fish-preview').screenshot(path='/tmp/popo-fish-variants.png')
    assert not errors, errors
    browser.close()
print('PASS: no browser errors; preview saved to /tmp/popo-fish-variants.png')

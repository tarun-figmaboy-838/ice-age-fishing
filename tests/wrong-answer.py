#!/usr/bin/env python3
"""Browser integration checks. Requires an installed Python Playwright + Chromium.
Run: python3 tests/wrong-answer.py (opens the local index.html, no server required).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # Drive the real game loop at a deterministic 60Hz, including promise continuations.
    page.add_init_script('window.requestAnimationFrame = () => 0')
    page.goto((ROOT / 'index.html').as_uri() + '?debug')
    page.wait_for_function('window.popoDebug && PopoGame.assets.mishapPoses')
    page.click('#btn-play')
    page.wait_for_timeout(550)  # Let the existing DOM start-screen fade complete.
    page.evaluate('''() => {
      window.qa = { sounds: [], phases: [], impacts: [] };
      const { game, state } = popoDebug;
      const play = game.audio.play.bind(game.audio);
      game.audio.play = name => { qa.sounds.push(name); play(name); };
      const splash = game.fx.splash.bind(game.fx);
      game.fx.splash = (x, y, big) => {
        qa.impacts.push({ phase: state.phase, x, y,
          foot: game.popo.mishap ? game.popo.bodyLandmark('contact') : null });
        splash(x,y,big);
      };
      window.tick = async (count, stop) => {
        for (let i=0; i<count; i++) {
          game.loop(game.lastFrame + 1000/60);
          await Promise.resolve(); await Promise.resolve();
          if (qa.phases.at(-1) !== state.phase) qa.phases.push(state.phase);
          if (stop && state.phase === stop) break;
        }
      };
      window.wrong = () => game.onFishTap(state.fish.find(f=>!PopoGame.matchesTarget(f.key,state.target)));
    }''')

    def tick(n=600, stop=None):
        page.evaluate('([n,s]) => tick(n,s)', [n, stop])

    def check(expression, label):
        assert page.evaluate('() => ' + expression), label
        print('PASS:', label, flush=True)

    tick(220, 'ready')
    page.evaluate('''() => {
      qa.before = { target: popoDebug.state.target, fish: popoDebug.state.fish.slice(),
        challenge: popoDebug.state.challengeIndex };
      wrong(); qa.token = popoDebug.state.token;
      for (let i=0;i<20;i++) popoDebug.game.onFishTap(popoDebug.state.fish[i%3]);
    }''')
    check('popoDebug.state.token === qa.token && !popoDebug.game.ui.hitsEnabled', 'Rapid taps create one sequence and lock input')
    tick(100, 'wrongPull')
    check("popoDebug.game.popo.line.mode === 'attached' && Math.hypot(popoDebug.game.popo.line.hook.x-PopoGame.mouthOf(popoDebug.state.selectedFish).x,popoDebug.game.popo.line.hook.y-PopoGame.mouthOf(popoDebug.state.selectedFish).y)<0.01", 'Tug starts at hook/mouth contact')
    for phase in ['losingBalance', 'falling', 'submerged', 'resurfacing', 'recovering']:
        tick(100, phase)
        check('popoDebug.state.phase === ' + repr(phase), 'Reached ' + phase)
        if phase == 'falling': tick(12)
        if phase == 'resurfacing': tick(18)
        page.evaluate('popoDebug.game.draw()')
        page.screenshot(path='/tmp/popo-qa-' + phase + '.png')
        page.evaluate('''() => { popoDebug.game.togglePause(); qa.frozen = JSON.stringify(popoDebug.game.popo.mishap); qa.time = PopoGame.clock.time; }''')
        tick(60)
        check('JSON.stringify(popoDebug.game.popo.mishap) === qa.frozen && PopoGame.clock.time === qa.time', 'Pause freezes ' + phase)
        page.evaluate('popoDebug.game.togglePause()')
        if phase == 'submerged':
            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate('popoDebug.game.resize()')
            check('JSON.stringify(popoDebug.game.popo.mishap) === qa.frozen', 'Orientation change preserves logical scene positions')
            page.screenshot(path='/tmp/popo-qa-portrait.png')
            page.set_viewport_size({'width': 1280, 'height': 800})
            page.wait_for_timeout(100)
            page.evaluate('popoDebug.game.resize(); popoDebug.game.draw()')
    tick(250, 'ready')
    check("popoDebug.state.phase === 'ready' && popoDebug.game.ui.hitsEnabled && !popoDebug.game.popo.mishap && !popoDebug.state.selectedFish", 'Recovery restores idle, rod and input')
    check('popoDebug.state.target === qa.before.target && popoDebug.state.challengeIndex === qa.before.challenge && popoDebug.state.collected.length === 0 && qa.before.fish.every(f=>popoDebug.state.fish.includes(f) && !f.gone && !f.escaping)', 'Question, score and all fish choices preserved')
    check("qa.impacts.filter(i=>i.phase==='falling').length === 1 && qa.impacts.filter(i=>i.phase==='falling').every(i=>i.y===popoDebug.game.waterline && i.foot.y>=i.y && i.foot.y-i.y<12)", 'Exactly one body splash at water crossing')
    check("['tug','slip','bubbles','drip'].every(n=>qa.sounds.filter(s=>s===n).length===1)", 'Mishap audio events fire once')
    page.screenshot(path='/tmp/popo-qa-idle.png')

    page.evaluate('wrong()'); tick(500, 'ready')
    check("popoDebug.state.phase === 'ready' && !popoDebug.game.popo.mishap", 'Second wrong answer recovers cleanly')

    # Test cancellation in every phase, including the brief dip and pickup.
    for phase in ['casting', 'wrongPull', 'losingBalance', 'falling', 'submerged', 'resurfacing', 'recovering']:
        page.evaluate('wrong()'); tick(200, phase)
        page.evaluate('popoDebug.game.restart()')
        check('!popoDebug.game.popo.mishap && popoDebug.game.fx.drops.every(p=>p.life<=0) && popoDebug.game.audio.effectSources.size===0', 'Restart cleans effects and animation during ' + phase)
        tick(300, 'ready')
        check("popoDebug.state.phase==='ready' && popoDebug.game.ui.hitsEnabled", 'Restart unlocks after tutorial: ' + phase)

    # Different layout/depth, with muted and throwing audio.
    for index in range(4):
        page.evaluate('''index => {
          const {game,state}=popoDebug; state.locationIndex=index; state.challengeIndex=0;
          game.applyLocation(); game.setupChallenge();
          const f=state.fish.find(f=>!PopoGame.matchesTarget(f.key,state.target));
          f.x=index%2 ? game.area.right-f.w/2-10 : game.area.left+f.w/2+10;
          f.y=index%2 ? game.area.bottom-f.h/2 : game.area.top+f.h/2;
          game.audio.setMuted(true); game.onFishTap(f);
        }''', index)
        tick(500, 'ready')
        check("popoDebug.state.phase==='ready' && !popoDebug.game.popo.mishap", 'Muted recovery at layout ' + str(index))
    page.evaluate("() => { qa.savedPlay=popoDebug.game.audio.play; popoDebug.game.audio.play=()=>{throw Error('missing audio')}; wrong(); }")
    tick(500, 'ready')
    check("popoDebug.state.phase==='ready' && popoDebug.game.ui.hitsEnabled", 'Failed audio cannot block recovery')
    page.evaluate('popoDebug.game.audio.play=qa.savedPlay')
    page.emulate_media(reduced_motion='reduce')
    page.evaluate('popoDebug.game.fx.reduced=true; wrong()')
    tick(500, 'ready')
    check("popoDebug.state.phase==='ready' && !popoDebug.game.popo.mishap", 'Reduced-motion sequence completes')

    # Run every correct answer through collection, rewards, travel, and summary.
    page.evaluate('popoDebug.game.restart()'); tick(300, 'ready')
    catches = 0
    while page.evaluate('popoDebug.state.phase') != 'complete':
        assert catches < 20, 'Progression did not terminate'
        page.evaluate('popoDebug.game.onFishTap(popoDebug.state.fish.find(f=>PopoGame.matchesTarget(f.key,popoDebug.state.target)))')
        tick(500, 'celebrating')
        check("popoDebug.state.phase==='celebrating' && !popoDebug.game.ui.el.reward.hidden", 'Correct catch/reward ' + str(catches + 1))
        page.evaluate('popoDebug.game.onContinue()')
        tick(500, 'ready')
        catches += 1
    check('popoDebug.state.collected.length===14 && !popoDebug.game.ui.el.summary.hidden', 'All 14 correct catches, travel and final summary')
    page.evaluate('popoDebug.game.restart()'); tick(300, 'ready')
    page.evaluate('wrong()'); tick(200, 'submerged')
    page.evaluate('popoDebug.game.dispose(); qa.time=PopoGame.clock.time')
    tick(100)
    check('!popoDebug.game.running && !popoDebug.game.popo.mishap && PopoGame.clock.time===qa.time && popoDebug.game.audio.effectSources.size===0', 'Scene disposal cancels the dip and stops the loop')
    assert not errors, errors
    print('PASS: no browser runtime errors', flush=True)
    browser.close()

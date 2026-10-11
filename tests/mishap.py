"""Browser gameplay regression checks. Run: python3 tests/mishap.py.
Requires Python Playwright and its Chromium browser; the game has no build step.
Artifacts are written to /tmp/popo-qa (screenshots + JSON measurements).
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/popo-qa')
OUT.mkdir(exist_ok=True)
URL = (ROOT / 'index.html').as_uri() + '?debug'
BOOT = '''async () => {
 const {game:g,state:s}=popoDebug, P=PopoGame;
 g.running=false; g.audio.init(); g.ui.hideStart();g.ui.showHud();
 P.newToken();P.clock.cancelAll();g.endLine();g.applyLocation();g.setupChallenge();
 P.newToken();P.clock.cancelAll();s.phase=P.PHASE.READY;s.selectedFish=null;
 for(const f of s.fish)f.frozen=false;
 g.titleFade=0;g.tutorialPending=false;g.ui.setHitsEnabled(true);
 window.qa={sounds:[],splashes:[],phases:[],errors:[]};
 const play=g.audio.play.bind(g.audio);g.audio.play=n=>{qa.sounds.push([n,P.clock.time]);play(n);};
 const splash=g.fx.splash.bind(g.fx);g.fx.splash=(x,y,b)=>{qa.splashes.push({x,y,b,time:P.clock.time});splash(x,y,b);};
 window.step=async(ms,fps=60)=>{for(let n=0;n<ms-0.001;){const d=Math.min(1000/fps,ms-n); if(!s.paused)g.update(d/1000); n+=d;await Promise.resolve();await Promise.resolve();if(qa.phases.at(-1)!==s.phase)qa.phases.push(s.phase);}g.draw();};
 window.wrong=()=>s.fish.find(f=>!P.matchesTarget(f.key,s.target));
 window.right=()=>s.fish.find(f=>P.matchesTarget(f.key,s.target));
 g.draw();
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    results = []
    for name, width, height, fps, reduced in [
        ('desktop', 1600,900,60,False),('laptop',1024,640,30,False),
        ('tablet',768,1024,15,False),('mobile',390,844,60,False),
        ('reduced',844,390,30,True)]:
        page = browser.new_page(viewport={'width':width,'height':height},
                                reduced_motion='reduce' if reduced else 'no-preference')
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_function('window.PopoGame.assets.fish')
        page.evaluate(BOOT)
        page.screenshot(path=str(OUT / (name+'-idle.png')))
        page.evaluate('''()=>{qa.start=PopoGame.clock.time;qa.anchor={...popoDebug.game.popo.anchor};qa.idleTip=popoDebug.game.popo.rodTip();const f=wrong();qa.fish=f;popoDebug.game.onFishTap(f);qa.token=popoDebug.state.token;for(let i=0;i<20;i++)popoDebug.game.onFishTap(f);}''')
        assert page.evaluate('popoDebug.state.token===qa.token && !popoDebug.game.ui.hitsEnabled'), 'Reentrant tap or unlocked input'
        elapsed=0
        for stamp in [900,1100,1500,1850,2200,2600,2950,3300,3650,4200,4800,5300,5700,5900,6600]:
            page.evaluate('([ms,fps])=>step(ms,fps)',[stamp-elapsed,fps])
            elapsed=stamp
            if name=='desktop':
                page.screenshot(path=str(OUT / f'phase-{stamp}.png'))
                print(stamp,page.evaluate('({phase:popoDebug.state.phase,m:popoDebug.game.popo.mishap && {x:popoDebug.game.popo.mishap.x,y:popoDebug.game.popo.mishap.y,pose:popoDebug.game.popo.mishap.pose,mix:popoDebug.game.popo.mishap.mix,contact:popoDebug.game.popo.bodyLandmark("contact")}})'),flush=True)
            if stamp==3650:  # "Whoopsie Doopsie!" as Popo bobs back up
                assert page.locator('#speech').is_visible()
                assert page.locator('#speech .line').text_content().strip()=='Whoopsie Doopsie!'
                assert page.evaluate('!popoDebug.game.ui.hitsEnabled')
            if stamp==2200:
                page.set_viewport_size({'width':height,'height':width})
                page.evaluate('popoDebug.game.resize()')
            if stamp==2600:
                before=page.evaluate('PopoGame.clock.time')
                page.evaluate('popoDebug.state.paused=true')
                page.evaluate('step(500)')
                assert page.evaluate('PopoGame.clock.time')==before
                page.evaluate('popoDebug.state.paused=false')
        result=page.evaluate('''()=>({phase:popoDebug.state.phase, selected:!!popoDebug.state.selectedFish,
          mishap:!!popoDebug.game.popo.mishap, frozen:qa.fish.frozen,
          anchor:popoDebug.game.popo.anchor, expectedAnchor:qa.anchor,
          splashes:qa.splashes,sounds:qa.sounds,phases:qa.phases})''')
        assert result['phase']=='ready' and not result['selected'] and not result['mishap'] and not result['frozen'],result
        assert result['anchor']==result['expectedAnchor']
        assert page.evaluate('popoDebug.game.ui.hitsEnabled')
        assert len([s for s in result['splashes'] if s['b']])==1,result['splashes']
        assert len([s for s in result['sounds'] if s[0]=='splashBig'])==1
        # Immediate retry, then cancellation while airborne. Restart must own the scene.
        page.evaluate('popoDebug.game.onFishTap(wrong())')
        page.evaluate('step(2200)')
        page.evaluate('popoDebug.game.restart()')
        page.evaluate('step(100)')
        assert page.evaluate('!popoDebug.game.popo.mishap && !popoDebug.state.selectedFish')
        # Three full consecutive retries, followed by the unchanged correct catch.
        page.evaluate(BOOT)
        for _ in range(3):
            page.evaluate('popoDebug.game.onFishTap(wrong())')
            page.evaluate('step(6600)')
            assert page.evaluate('popoDebug.state.phase==="ready"')
        # Restart while the recovery line is on screen (Popo bobbing up in the water).
        page.evaluate('popoDebug.game.onFishTap(wrong())');page.evaluate('step(3650)')
        assert page.locator('#speech').is_visible()
        page.evaluate('popoDebug.game.restart()');page.evaluate('step(100)')
        assert page.evaluate('!popoDebug.game.popo.mishap && !popoDebug.state.selectedFish')
        assert not page.locator('#speech').is_visible()
        page.evaluate(BOOT)
        page.evaluate('popoDebug.game.onFishTap(right())')
        page.evaluate('step(3700)')
        assert page.evaluate('popoDebug.state.collected.length===1'), 'Correct catch regression'
        assert not errors,errors
        results.append({'viewport':name,'fps':fps,**result,'errors':errors})
        page.close()
    # Exercise each location's world waterline and optional-audio failure.
    page=browser.new_page(viewport={'width':1280,'height':720})
    page.goto(URL);page.wait_for_function('window.PopoGame.assets.fish');page.evaluate(BOOT)
    for location in range(4):
        page.evaluate('''async i=>{const {game:g,state:s}=popoDebug;await PopoGame.preloadBackground(i);s.locationIndex=i;s.challengeIndex=0;g.applyLocation();g.spawnChallengeFish();s.phase='ready';s.selectedFish=null;g.ui.setHitsEnabled(true);}''',location)
        page.evaluate('popoDebug.game.onFishTap(wrong())');page.evaluate('step(6600,15)')
        assert page.evaluate('popoDebug.state.phase==="ready" && !popoDebug.game.popo.mishap')
    page.evaluate('()=>{popoDebug.game.audio.play=()=>{throw new Error("Optional audio unavailable")};popoDebug.game.audio.duck=()=>{throw new Error("No audio context")};}')
    page.evaluate('popoDebug.game.onFishTap(wrong())');page.evaluate('step(6600)')
    assert page.evaluate('popoDebug.state.phase==="ready" && popoDebug.game.ui.hitsEnabled')
    page.close()
    # One real-time run through the actual keyboard hit target and RAF loop.
    page=browser.new_page(viewport={'width':1280,'height':720})
    page.goto(URL);page.wait_for_function('window.PopoGame.assets.fish');page.evaluate(BOOT)
    page.wait_for_timeout(100)
    page.evaluate('''()=>{const g=popoDebug.game;qa.wallStart=performance.now();qa.frames=[];qa.audio=[];const update=g.update.bind(g);g.update=dt=>{qa.frames.push(dt);update(dt);};const play=g.audio.play.bind(g.audio);g.audio.play=n=>{qa.audio.push({name:n,wall:performance.now(),audio:g.audio.ctx.currentTime});play(n);};g.running=true;g.lastFrame=performance.now();requestAnimationFrame(t=>g.loop(t));}''')
    page.get_by_role('button',name='Circle fish',exact=True).press('Enter')
    page.evaluate('popoDebug.game.audio.resume()')
    page.wait_for_function('popoDebug.state.phase==="ready"',timeout=10000)
    realtime=page.evaluate('''()=>({elapsed:(performance.now()-qa.wallStart)/1000,frames:qa.frames.length,maxFrame:Math.max(...qa.frames),audio:qa.audio,audioState:popoDebug.game.audio.ctx.state})''')
    assert 5.5 < realtime['elapsed'] < 7.5,realtime
    assert len([e for e in realtime['audio'] if e['name']=='splashBig'])==1
    page.screenshot(path=str(OUT/'recovered-realtime.png'))
    results.append({'realtime':realtime,'allLocations':True,'optionalAudioFailure':True})
    page.close()
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
    browser.close()
print('PASS: five layouts, 15/30/60 FPS, pause, resize, repeated taps, retries, restart, correct catch')

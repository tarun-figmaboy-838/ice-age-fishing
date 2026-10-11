"""Paddling asset and browser integration regression: python3 tests/rowing.py."""
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BOOT=(ROOT/'tests/mishap.py').read_text().split("BOOT = '''",1)[1].split("'''",1)[0]
# The pre-rendered stroke (tools/build-rowing-cycle.py): every frame whole inside its cell.
meta=(ROOT/'src/rowing-cycle-data.js').read_text()
cycle=json.loads(meta[meta.index('{',meta.index('ROWING_CYCLE')):meta.rindex('}')+1])
sheet=Image.open(ROOT/'assets/sprites/popo-row-cycle.webp')
assert sheet.mode=='RGBA'
for i in range(cycle['frames']):
    x,y=i%cycle['columns']*cycle['width'],i//cycle['columns']*cycle['height']
    box=sheet.crop((x,y,x+cycle['width'],y+cycle['height'])).getchannel('A').point(lambda v:255 if v>8 else 0).getbbox()
    assert box and min(box[:2])>0 and box[2]<cycle['width'] and box[3]<cycle['height'],(i,box)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=["--allow-file-access-from-files"])
    for width,height,fps,reduced in [(1600,900,60,False),(1024,640,30,False),(390,844,15,False),(768,1024,30,True)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce' if reduced else 'no-preference')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto((ROOT/'index.html').as_uri()+'?debug')
        page.wait_for_function('window.PopoGame.assets.rowCycle')
        page.evaluate(BOOT)
        page.evaluate('()=>{window.trip=PopoGame.travelTo(popoDebug.game,1)}')
        page.evaluate('step(950)')
        page.wait_for_function('popoDebug.game.popo.rowing')
        assert page.evaluate('!popoDebug.game.ui.hitsEnabled')

        assert page.evaluate('''()=>{const p=popoDebug.game.popo;return JSON.stringify(p.rowRig.sample(0))===JSON.stringify(p.rowRig.sample(2100))}''')
        before=page.evaluate('PopoGame.clock.time')
        page.evaluate('popoDebug.state.paused=true')
        page.evaluate('step(300)')
        assert page.evaluate('PopoGame.clock.time')==before
        page.evaluate('popoDebug.state.paused=false')
        page.evaluate('([ms,fps])=>step(ms,fps)',[1000,fps])
        page.screenshot(path=f'/tmp/popo-rowing-{width}.png')
        page.set_viewport_size({'width':height,'height':width})
        page.evaluate('popoDebug.game.resize()')
        page.evaluate('([ms,fps])=>step(ms,fps)',[6000,fps])
        result=page.evaluate('({rowing:!!popoDebug.game.popo.rowing,phase:popoDebug.state.phase,shift:popoDebug.game.popo.travelShift,sounds:qa.sounds.filter(s=>s[0]==="paddle").length})')
        assert not result['rowing'] and result['shift']==0,result
        assert result['sounds']==(1 if reduced else 3),result
        page.evaluate('()=>{window.trip=PopoGame.travelTo(popoDebug.game,0)}')
        page.evaluate('step(950)')
        page.wait_for_function('popoDebug.game.popo.rowing')
        page.evaluate('popoDebug.game.restart()')
        page.evaluate('step(100)')
        # the trip is cancelled; the restart's entrance has Popo row in to his spot again
        assert page.evaluate('!popoDebug.game.transition && popoDebug.state.locationIndex===0')
        page.evaluate('step(6000)')
        assert page.evaluate('!popoDebug.game.popo.rowing && popoDebug.game.popo.travelShift===0')
        assert not errors,errors
        print(width,height,fps,result,flush=True)
        page.close()
    browser.close()
print('PASS: nine alpha frames, margins, 63-frame preview, periodic rig, travel at 15/30/60 FPS, resize, sound count, cleanup.')

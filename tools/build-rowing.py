#!/usr/bin/env python3
"""Pack the regenerated paddling rig and render nine frames with the runtime rig.
Requires Python Playwright + Chromium and Pillow (for the animated PNG preview).
Original game artwork is never overwritten. Run: python3 tools/build-rowing.py
"""
import base64
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import io

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'assets/sprites/paddling'
OUT.mkdir(exist_ok=True, parents=True)
DATA = {
    'bodyBox': [130,80,915,1000], 'paddleBox': [1140,30,1370,1000],
    'seat': [410,854], 'grip': [673,533.5], 'hands': [[655,462],[691,605]],
    'handDistances': [-math.hypot(36,143)/2,math.hypot(36,143)/2],
    'neck': [430,400], 'armLeft': 400, 'armTop': 360,
    'eyes': [[474,201,35,43],[533,177,22,29]], 'furPatch': [360,250,60,35],
    'paddle': {'pivot':[71.5,97.5], 'tip':[72.15,609.7], 'angle':-.4, 'sourceScale':.65},
    'worldScale': .21, 'cycleMs':2100, 'frameSize':[1280,1280], 'frameOrigin':[100,60],
}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1000,'height':900})
    page.goto('about:blank')
    page.evaluate((ROOT/'src/rowing.js').read_text())
    result=page.evaluate('''async ({raw,data})=>{
      const image=new Image();image.src=raw;await image.decode();
      const encode=c=>c.toDataURL('image/png').split(',')[1];
      const cut=box=>{
        const [x,y,x1,y1]=box,w=x1-x,h=y1-y;
        const c=document.createElement('canvas');c.width=w;c.height=h;
        const g=c.getContext('2d');g.drawImage(image,x,y,w,h,0,0,w,h);
        const px=g.getImageData(0,0,w,h),d=px.data;
        const alpha=new Uint8Array(w*h);
        for(let i=0;i<alpha.length;i++) {
          const r=d[i*4],gg=d[i*4+1],b=d[i*4+2],a=d[i*4+3];
          const chroma=(r>210 && gg<45 && b<45)||(r>220 && gg>220 && b<40);
          alpha[i]=a<24||chroma?0:a;
        }
        // Keep the connected subject; separate external specks are not artwork.
        const seen=new Uint8Array(w*h);let largest=[];
        for(let seed=0;seed<alpha.length;seed++){
          if(!alpha[seed]||seen[seed])continue;
          const group=[seed];seen[seed]=1;
          for(let n=0;n<group.length;n++){
            const i=group[n],xx=i%w,yy=Math.floor(i/w);
            for(const j of [xx?i-1:-1,xx<w-1?i+1:-1,yy?i-w:-1,yy<h-1?i+w:-1]){
              if(j<0||seen[j]||!alpha[j])continue;seen[j]=1;group.push(j);
            }
          }
          if(group.length>largest.length)largest=group;
        }
        const keep=new Uint8Array(w*h);for(const i of largest)keep[i]=alpha[i];
        for(let i=0;i<keep.length;i++){
          d[i*4+3]=keep[i]>=245?255:keep[i];
          if(!keep[i])d[i*4]=d[i*4+1]=d[i*4+2]=0;
        }
        g.putImageData(px,0,0);return c;
      };
      const body=cut(data.bodyBox),rawPaddle=cut(data.paddleBox);
      const paddle=document.createElement('canvas');paddle.width=150;paddle.height=631;
      paddle.getContext('2d').drawImage(rawPaddle,0,0,149.5,630.5);
      window.rig=new PopoGame.PaddleRig(body,paddle,data);
      const frames=[],preview=[];
      const atlas=document.createElement('canvas');atlas.width=3840;atlas.height=3840;
      const a=atlas.getContext('2d');
      const render=time=>{
        const c=document.createElement('canvas');c.width=c.height=1280;
        const g=c.getContext('2d');g.translate(...data.frameOrigin);rig.draw(g,time,data.cycleMs);return c;
      };
      for(let i=0;i<9;i++){
        const c=render(i/9*data.cycleMs);frames.push(encode(c));a.drawImage(c,i%3*1280,Math.floor(i/3)*1280);
      }
      // 30 FPS transparent APNG: same renderer, not an approximation using nine stills.
      for(let i=0;i<63;i++){
        const c=render(i/63*data.cycleMs),small=document.createElement('canvas');small.width=small.height=640;
        small.getContext('2d').drawImage(c,0,0,640,640);preview.push(encode(small));
      }
      return {body:encode(body),paddle:encode(paddle),atlas:encode(atlas),frames,preview};
    }''',{'raw':'data:image/png;base64,'+base64.b64encode((ROOT/'asset/popo-paddling-rig-source.png').read_bytes()).decode(),'data':DATA})
    browser.close()
for name in ['body','paddle','atlas']:
    (OUT/f'{name}.png').write_bytes(base64.b64decode(result[name]))
for i,frame in enumerate(result['frames']):
    (OUT/f'frame-{i+1:02d}.png').write_bytes(base64.b64decode(frame))
preview=[Image.open(io.BytesIO(base64.b64decode(frame))).convert('RGBA') for frame in result['preview']]
preview[0].save(OUT/'preview.apng',save_all=True,append_images=preview[1:],duration=[33,33,34]*21,loop=0,disposal=0,blend=0)
manifest={
    'description':'New generated Popo and rigid paddle, articulated with the runtime Canvas rig.',
    'sheet':'atlas.png','grid':[3,3],'frameDimensions':[1280,1280],
    'anchor':[DATA['seat'][0]+100,DATA['seat'][1]+60],
    'cycleMs':2100,'order':list(range(1,10)),
    'frames':[{'file':f'frame-{i+1:02d}.png','timeMs':round(i/9*2100,3),'phase':phase} for i,phase in enumerate([
        'ready','forward reach','entry','start pull','power stroke','finish stroke','lift and blink','return forward','reset'])],
    'paddle':{'file':'paddle.png','dimensions':[150,631],'pivot':DATA['paddle']['pivot'],'tip':DATA['paddle']['tip'],
              'note':'One unchanged texture and length in every frame. Both hands track its shaft.'},
    'runtime':{'file':'../../../src/rowing.js','rendering':'time-based continuous articulated mesh; nine PNGs are sampled key poses'},
    'source':'../../../asset/popo-paddling-rig-source.png','rig':DATA,
}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(ROOT/'src/rowing-data.js').write_text('// Generated by tools/build-rowing.py.\nwindow.PopoGame = window.PopoGame || {};\nPopoGame.ROWING_RIG = '+json.dumps(DATA,indent=2)+';\n')
print('Built new paddling rig, 3x3 PNG, nine frames, manifest and 63-frame looping APNG.')

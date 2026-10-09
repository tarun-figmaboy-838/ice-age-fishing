#!/usr/bin/env python3
"""Pack fresh Popo-only poses with clean alpha and transparent cell gutters.
Uses browser Canvas for deterministic edge masking after image generation.
Run with Python Playwright + Chromium installed: python3 tools/build-mishap.py
Does not rebuild or alter other game artwork.
"""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
POSES = {
 'surprise':dict(box=[45,40,385,425],head=[260,132],top=[225,55],hand=[292,270],contact=[320,404],pivot=[220,320]),
 'brace':dict(box=[510,65,882,425],head=[725,152],top=[680,80],hand=[818,240],contact=[790,401],pivot=[685,320]),
 'slip':dict(box=[942,36,1320,412],head=[1140,130],top=[1100,50],hand=[1280,126],contact=[1130,394],pivot=[1120,285]),
 'surface':dict(box=[1424,15,1685,425],head=[1588,100],top=[1560,25],hand=[1625,240],contact=[1615,410],pivot=[1560,315]),
 'blink':dict(box=[80,450,355,861],head=[266,540],top=[220,462],hand=[285,665],contact=[275,847],pivot=[230,750]),
 'climb':dict(box=[454,456,890,845],head=[592,547],top=[630,470],hand=[490,594],contact=[789,824],pivot=[700,710]),
 'shake':dict(box=[969,488,1300,864],head=[1151,592],top=[1110,506],hand=[1045,590],contact=[1240,831],pivot=[1120,760]),
 'wet':dict(box=[1390,506,1705,865],head=[1580,596],top=[1540,519],hand=[1615,721],contact=[1655,838],pivot=[1540,780]),
}
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 page=b.new_page()
 page.goto((ROOT/'index.html').as_uri())
 data=page.evaluate('''async ({url,poses,cleanSource})=>{
 const im=new Image();im.src=url;await im.decode();
 const atlas=document.createElement('canvas');atlas.width=2048;atlas.height=1024;
 const out=atlas.getContext('2d');const metadata={};
 const source=document.createElement('canvas');source.width=im.width;source.height=im.height;
 const sourceCtx=source.getContext('2d');
 for(const [index,[name,f]] of Object.entries(poses).entries()){
   const [x0,y0,x1,y1]=f.box,w=x1-x0,h=y1-y0;
   const c=document.createElement('canvas');c.width=w;c.height=h;
   const g=c.getContext('2d');g.drawImage(im,x0,y0,w,h,0,0,w,h);
   if(cleanSource) {
   const pixels=g.getImageData(0,0,w,h),d=pixels.data,N=w*h;
   const background=new Uint8Array(N),seen=new Uint8Array(N);
   // Chroma specks are generation artifacts, not cream fur or blue eyes.
   for(let i=0;i<N;i++){
     const [r,gg,bb,a]=d.slice(i*4,i*4+4);
     if(a<20)background[i]=1;
   }
   // Flood only exterior neutral-white matte, protecting interior fur highlights.
   const queue=[];for(let i=0;i<N;i++)if(background[i]){queue.push(i);seen[i]=1;}
   for(let n=0;n<queue.length;n++){
     const i=queue[n],x=i%w,y=Math.floor(i/w);
     for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1]){
       if(j<0 || seen[j])continue;
       const r=d[j*4],gg=d[j*4+1],bb=d[j*4+2];
       if((Math.min(r,gg,bb)>230 && Math.max(r,gg,bb)-Math.min(r,gg,bb)<18) || (r>140 && bb<90 && (gg<100 || (gg>130 && r>gg*.85)))){seen[j]=1;background[j]=1;queue.push(j);}
     }
   }
   seen.fill(0);let largest=[];
   for(let seed=0;seed<N;seed++){
     if(seen[seed]||background[seed])continue;
     const component=[seed];seen[seed]=1;
     for(let n=0;n<component.length;n++){
       const i=component[n],x=i%w,y=Math.floor(i/w);
       for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1]){
         if(j<0||seen[j]||background[j])continue;seen[j]=1;component.push(j);
       }
     }
     if(component.length>largest.length)largest=component;
   }
   const alpha=new Uint8Array(N);for(const i of largest)alpha[i]=d[i*4+3];
   // One-pixel inward matte trim, followed by a subpixel antialiased boundary.
   const inner=new Uint8Array(N);
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
     const i=y*w+x;inner[i]=Math.min(alpha[i],alpha[i-1],alpha[i+1],alpha[i-w],alpha[i+w]);
   }
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const i=y*w+x;let value=inner[i]*4;
     value+=(x?inner[i-1]:0)+(x<w-1?inner[i+1]:0)+(y?inner[i-w]:0)+(y<h-1?inner[i+w]:0);
     d[i*4+3]=Math.min(alpha[i],Math.round(value/8));
     if(!d[i*4+3]){d[i*4]=0;d[i*4+1]=0;d[i*4+2]=0;}
   }
   g.putImageData(pixels,0,0);
   }
   // Generated interiors sometimes arrive at alpha 253; make only the near-opaque
   // pixels solid while retaining all fractional antialiasing at the fur boundary.
   const solid=g.getImageData(0,0,w,h);
   for(let i=3;i<solid.data.length;i+=4)if(solid.data[i]>=245)solid.data[i]=255;
   g.putImageData(solid,0,0);
   sourceCtx.drawImage(c,x0,y0);
   const dx=index%4*512+Math.floor((512-w)/2),dy=Math.floor(index/4)*512+Math.floor((512-h)/2);
   out.drawImage(c,dx,dy);
   metadata[name]={box:[index%4*512,Math.floor(index/4)*512,index%4*512+512,Math.floor(index/4)*512+512]};
   for(const [key,value] of Object.entries(f))if(key!=='box')metadata[name][key]=[value[0]-x0+dx,value[1]-y0+dy];
 }
 return {image:atlas.toDataURL('image/png').split(',')[1],source:source.toDataURL('image/png').split(',')[1],metadata};
}''',dict(url='data:image/png;base64,'+base64.b64encode((ROOT/'asset/popo-mishap-new.png').read_bytes()).decode(),poses=POSES,cleanSource='--clean-source' in sys.argv))
 b.close()
if '--clean-source' in sys.argv or '--save-source' in sys.argv:
 (ROOT/'asset/popo-mishap-new.png').write_bytes(base64.b64decode(data['source']))
(ROOT/'assets/sprites/popo-mishap.png').write_bytes(base64.b64decode(data['image']))
(ROOT/'src/mishap-data.js').write_text('// Generated by tools/build-mishap.py. Registered Popo-only poses.\nwindow.PopoGame = window.PopoGame || {};\nPopoGame.MISHAP_POSES = '+json.dumps(data['metadata'],indent=2)+';\n')
print('Built assets/sprites/popo-mishap.png and src/mishap-data.js')

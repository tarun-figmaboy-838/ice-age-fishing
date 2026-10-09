"""Validate the delivered Popo-only atlas alpha, margins and registration data."""
from pathlib import Path
from PIL import Image
import json
ROOT = Path(__file__).resolve().parents[1]
im = Image.open(ROOT/'assets/sprites/popo-mishap.png')
assert im.mode == 'RGBA' and im.size == (2048,1024)
source = Image.open(ROOT/'asset/popo-mishap-new.png')
assert source.mode == 'RGBA'
for index in range(8):
    cell=im.crop((index%4*512,index//4*512,index%4*512+512,index//4*512+512))
    alpha=cell.getchannel('A')
    box=alpha.getbbox()
    assert box and min(box[0],box[1],512-box[2],512-box[3])>=32,(index,box)
    hist=alpha.histogram()
    assert hist[0]>512*512*.25 and hist[255]>1000 and sum(hist[1:255])>100
    # Detect the saturated red/yellow pixels from the damaged source's exterior.
    bad=0
    px=cell.load()
    for y in range(1,511):
        for x in range(1,511):
            r,g,b,a=px[x,y]
            if a and r>180 and b<35 and (g<55 or g>180):
                if any(px[x+dx,y+dy][3]==0 for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]):
                    bad+=1
    assert bad==0,(index,bad)
    print(f'pose {index+1}: bounds={box}, alpha edge pixels={sum(hist[1:255])}, colored fringe={bad}')
text=(ROOT/'src/mishap-data.js').read_text()
data=json.loads(text.split('PopoGame.MISHAP_POSES = ')[1].rstrip(';\n'))
assert len(data)==8
for pose in data.values():
    x0,y0,x1,y1=pose['box']
    for key,point in pose.items():
        if key!='box':assert x0<point[0]<x1 and y0<point[1]<y1
print('PASS: RGBA, antialiased edges, clean fringe, safe gutters, registered landmarks')

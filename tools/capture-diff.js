'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('../bench/node_modules/pngjs');
const root = path.resolve(__dirname, '..');
const a = PNG.sync.read(fs.readFileSync(path.join(root,'artifacts/reference_retro.png')));
const b = PNG.sync.read(fs.readFileSync(path.join(root,'artifacts/retro_cluster.png')));
if (a.width!==1920 || a.height!==720 || b.width!==a.width || b.height!==a.height) throw new Error('Both images must be 1920x720');
const diff = new PNG({width:a.width,height:a.height});
let pixels=0, max=0, total=0;
let bounds={left:1920,top:720,right:-1,bottom:-1};
for (let i=0;i<a.data.length;i+=4) {
 let changed=false;
 for(let c=0;c<4;c++) { const v=Math.abs(a.data[i+c]-b.data[i+c]); total+=v;max=Math.max(max,v);if(v) changed=true; }
 const px=i/4,x=px%1920,y=Math.floor(px/1920);
 if(changed) {pixels++; bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y);}
 diff.data[i]=changed?255:0;diff.data[i+1]=0;diff.data[i+2]=changed?255:0;diff.data[i+3]=255;
}
fs.writeFileSync(path.join(root,'artifacts/diff.png'),PNG.sync.write(diff));
const report={width:1920,height:720,changedPixels:pixels,totalPixels:1920*720,changedPercent:pixels/(1920*720)*100,maxChannelDelta:max,meanChannelDelta:total/a.data.length,bounds:pixels?bounds:null,exact:pixels===0};
fs.writeFileSync(path.join(root,'artifacts/visual-comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

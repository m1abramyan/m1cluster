'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('../bench/node_modules/playwright');
const fixture = require('../bench/fixture.json');
const { waitForScene } = require('../bench/scene-check');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const port=Number(process.env.BENCH_PORT || 8078), url='http://127.0.0.1:'+port;
  const page=await browser.newPage({viewport:{width:1920,height:720},deviceScaleFactor:1});
  await page.goto(url+'/?only=1&clean=1&car=0');
  await waitForScene(url,page);
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{
    const stream=document.getElementById('hud').captureStream(30), parts=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000});
    window.__video=new Promise(resolve=>{recorder.ondataavailable=e=>parts.push(e.data);recorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let str='';for(let i=0;i<bytes.length;i++)str+=String.fromCharCode(bytes[i]);resolve(btoa(str));};});
    window.__recorder=recorder;recorder.start();
  });
  for(let i=0;i<60;i++) {
   const t=i/59, values=Object.assign({},fixture.signals,{speed:Math.round(t*100),rpm:Math.round(900+Math.sin(t*Math.PI)*4800),gear:t<.15?1:t<.35?2:t<.65?3:4,intake:31});
   await page.request.post(url+'/signals',{data:{mode:'manual',values}});
   await page.waitForTimeout(100);
  }
  await page.evaluate(()=>window.__recorder.stop());
  const data=await page.evaluate(()=>window.__video);
  const out=path.resolve(process.argv[2] || 'artifacts/retro_animation.webm');fs.writeFileSync(out,Buffer.from(data,'base64'));console.log(out);
  await page.request.post(url+'/signals',{data:{mode:'manual',values:fixture.signals}});
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const { chromium }=require('./node_modules/playwright');
const { PNG }=require('./node_modules/pngjs');
const { waitForScene }=require('./scene-check');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const base='http://127.0.0.1:'+(process.env.BENCH_PORT||8078),page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await waitForScene(base,page);await page.waitForTimeout(1000);
  await page.locator('#s_speed').evaluate(e=>{e.value='99';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(async()=>{const s=await(await fetch('/snapshot')).json();return s.values.values.speed===99;});
  await page.click('#mDemo');await page.waitForFunction(async()=>{const s=await(await fetch('/snapshot')).json();return s.values.values.speed===null;});
  await page.click('#fixture');await page.waitForFunction(async()=>{const s=await(await fetch('/snapshot')).json();return s.values.values.speed===88&&s.values.values.intake===null;});
  await page.click('#disable');await page.waitForFunction(()=>document.getElementById('layers').children.length===0);
  await page.click('#enable');await waitForScene(base,page);await page.waitForTimeout(1000);
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#screenshot')]);
  const png=PNG.sync.read(fs.readFileSync(await download.path()));assert.equal(png.width,1920);assert.equal(png.height,720);
  assert.equal(errors.length,0,errors.join('\n'));
  const video=fs.readFileSync(path.join(__dirname,'../artifacts/retro_animation.webm')).toString('base64');
  const dimensions=await page.evaluate(async(data)=>{const v=document.createElement('video');v.src='data:video/webm;base64,'+data;await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=reject;});return{width:v.videoWidth,height:v.videoHeight};},video);
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,720);
  const result={checks:['manual speed slider feeds 99 km/h','missing-source button reports unavailable','fixture button restores exact fixture including absent intake','disable/enable buttons release/rebuild layers','PNG download is 1920x720','no browser JavaScript errors','recorded WebM decodes as 1920x720'],video:dimensions};fs.writeFileSync(path.join(__dirname,'../artifacts/bench-ui-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// Test the live, local transport and the same staged application. Modern Node is bench-only.
const fs=require('fs'),path=require('path'),assert=require('assert');
const scene=require('./scene-check');
const base='http://127.0.0.1:'+(process.env.BENCH_PORT||8078), fixture=require('./fixture.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=async()=>{const r=await fetch(base+'/snapshot');assert(r.ok);return r.json();};
const post=async(p,data)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});assert(r.ok,p+' '+r.status);};
const wait=async(fn,label)=>{const until=Date.now()+15000;while(Date.now()<until){const s=await get();if(fn(s))return s;await sleep(100);}throw new Error('Timed out: '+label);};
(async()=>{
 const checks=[];
 await post('/signals',{mode:'manual',values:fixture.signals});
 await post('/enabled',{value:true});
 let start=await scene.waitForScene(base);
 const layerCount=start.layers.length;assert(start.pixels<=16*1024*1024);const counts={};start.layers.forEach(l=>counts[l.conn]=(counts[l.conn]||0)+1);assert(Object.values(counts).every(n=>n<=8));checks.push(layerCount+' layers, at most 8 per connection, below 16 MiB');
 const diag=start.values.diagnostics;
 await post('/renderer',{online:false});await wait(s=>s.layers.length===0,'disconnect release');
 await post('/renderer',{online:true});await wait(s=>s.layers.length===layerCount,'reconnect');checks.push('renderer disconnect/reconnect releases and reconstructs layers');
 await post('/renderer',{online:false});await post('/restart');await sleep(1000);assert.equal((await get()).layers.length,0);await post('/renderer',{online:true});await wait(s=>s.layers.length===layerCount,'delayed renderer');checks.push('application waits for delayed renderer');
 for(let i=0;i<3;i++){
  await post('/enabled',{value:false});await wait(s=>s.layers.length===0,'disable');
  await post('/enabled',{value:true});await wait(s=>s.layers.length===layerCount,'enable');
 }
 await sleep(600);const end=await get();assert.equal(end.values.diagnostics.subscriptions,diag.subscriptions);assert.equal(end.values.diagnostics.intervals,diag.intervals);checks.push('three disable/enable cycles: layers released, stable subscriptions and intervals');
 await post('/signals',{mode:'missing'});await wait(s=>s.values&&s.values.values.speed===null&&s.values.values.gear===null,'unavailable');checks.push('unavailable sources report null speed/gear; no demo fallback');
 await post('/signals',{mode:'manual',values:Object.assign({},fixture.signals,{speed:0,rpm:0,oil:0,coolant:0,boost:0,fuelL:0,gear:0})});await wait(s=>s.values&&s.values.values.speed===0&&s.values.values.rpm===0,'zeros');checks.push('zero values preserved');
 await post('/signals',{mode:'manual',values:Object.assign({},fixture.signals,{speed:250,rpm:7000,oil:150,coolant:130,boost:2.5,gear:8})});await wait(s=>s.values&&s.values.values.speed===250&&s.values.values.gear===8,'upper values');checks.push('bench upper values delivered');
 await post('/signals',{mode:'manual',values:fixture.signals});await sleep(600);
 await post('/enabled',{value:false});await wait(s=>!s.layers.length,'disabled');await post('/restart');await sleep(1500);assert.equal((await get()).layers.length,0);checks.push('disabled configuration survives process restart');
 await post('/enabled',{value:true});await wait(s=>s.layers.length===layerCount,'restored');
 const result={scope:'Local stand only; does not establish vehicle compatibility',checks,initialDiagnostics:diag,afterCycles:end.values.diagnostics,pixelBytes:start.pixels,layersPerConnection:Object.values(counts)};
 fs.writeFileSync(path.join(__dirname,'../artifacts/bench-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});

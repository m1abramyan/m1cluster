'use strict';
// Real source and lifecycle controller, fake renderer; no SDK, sockets or vehicle.
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const Source=require('../apps/manuk_retro_cluster/retro_source'),config=require('../apps/manuk_retro_cluster/config');
const file=path.resolve(__dirname,'../apps/manuk_retro_cluster/retro_runtime.js'),mod={exports:{}};
vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,exports:mod.exports,
    require:name=>name==='./retro_source'?Source:name==='./hud'?class {}:{},
    setInterval,clearInterval,setTimeout,clearTimeout,console},{filename:file});
const Runtime=mod.exports.RetroRuntime,dir=fs.mkdtempSync(path.join(os.tmpdir(),'retro-engine-start-'));
const log={info(){},warn(){},error(){}};
let timerCount=0,starts=0,stops=0,watches=0,shutdowns=0,refreshes=0,runtime,store,now=10000;
const ctx={log,signals:{watch(){watches++;return Promise.resolve({available:true,
    shutdown(){shutdowns++;},invalidate(){},refresh(){refreshes++;return Promise.resolve([]);}});}}};
class ClockSource extends Source{constructor(ctx,settings){super(ctx,settings,{now:()=>now});}}
class Hud{start(){starts++;}stop(){stops++;}onStatus(){}statusText(){return 'ready';}}
const deps={Source:ClockSource,Hud,setInterval(){timerCount++;return 1;},clearInterval(){timerCount--;}};
function active(s,condition=10){
    s.receive('condition','VehicleCondition',{statusConditionVehicle:condition});
    s.receive('speed','statusCarSpeed2',{speedVehicleCentreOfGravity:0});
    s.receive('gear','statusGearboxDrive',{statusActualStageDrive:'P',statusActualGearDrive:'N_OR_P'});
}
function engine(s,state){s.receive('cds','statusEngineStatus',{statusEngineRunDrive:state});}
function open(){store=new config.ConfigStore(dir,'car',log);store.watch=()=>{};runtime=new Runtime(ctx,store,'car',deps);runtime.start();}
(async()=>{
    store=new config.ConfigStore(dir,'car',log);
    const initial=JSON.parse(JSON.stringify(store.current));initial.enabled=true;initial.startup.onEngineStart=true;store.save(initial);store.stop();
    open();runtime.start();await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(timerCount,1);assert.strictEqual(watches,12);assert.strictEqual(runtime.hud,null);
    const s=runtime.source;active(s);
    s.receive('cds','statusEngineSpeed2',{actualValueRPMEngineCrankshaft:12000});
    assert.strictEqual(runtime.hud,null,'RPM cannot infer engineRunning');
    [null,3,true,'RUNNING','UNKNOWN','MOTOR_AUS','MOTOR_STARTET'].forEach(raw=>{engine(s,raw);assert.strictEqual(runtime.hud,null);});
    engine(s,'MOTOR_LAEUFT');const first=runtime.hud;assert(first);assert.strictEqual(starts,1);
    const token=s.engineEpochToken();
    for(let i=0;i<12;i++){now++;engine(s,2);runtime.evaluate();}
    assert.strictEqual(runtime.hud,first);assert.strictEqual(starts,1);assert.strictEqual(watches,12);assert.strictEqual(refreshes,0);
    now++;engine(s,0);assert.strictEqual(s.engineEpochToken(),token);assert.strictEqual(runtime.hud,first,'known off during start-stop keeps the current active session');
    engine(s,1);assert.strictEqual(runtime.hud,first,'known restart phase also retains the same scene');
    engine(s,3);assert.strictEqual(runtime.hud,null);assert.strictEqual(runtime.engineStarted,false,'unknown state clears the in-memory activation');
    engine(s,0);assert.strictEqual(runtime.hud,null,'off cannot restore activation after an unknown state');
    engine(s,2);assert(runtime.hud);
    s.sources.cds.sub.available=false;s.availability('cds',false);
    assert.strictEqual(s.engineEpochToken(),null);assert.strictEqual(runtime.hud,null);
    s.sources.cds.sub.available=true;s.availability('cds',true);engine(s,0);
    assert.notStrictEqual(s.engineEpochToken(),token);assert.strictEqual(runtime.hud,null,'new provider epoch cannot inherit an earlier running latch');
    engine(s,2);assert(runtime.hud);
    s.receive('condition','VehicleCondition',{statusConditionVehicle:12});
    assert.strictEqual(runtime.hud,null);assert.strictEqual(s.engineEpochToken(),null);
    engine(s,2);assert.strictEqual(s.read('engineRunning'),null,'notifications while asleep are ignored');
    active(s);engine(s,0);assert.strictEqual(runtime.hud,null,'wake with engine off waits for fresh running');
    engine(s,2);assert(runtime.hud);engine(s,0);
    s.sources.speed.sub.available=false;s.availability('speed',false);assert.strictEqual(runtime.hud,null,'engine latch never bypasses critical source release');
    s.sources.speed.sub.available=true;s.availability('speed',true);assert.strictEqual(runtime.hud,null);
    s.receive('speed','statusCarSpeed2',{speedVehicleCentreOfGravity:0});assert(runtime.hud,'current-session latch survives ordinary critical-data recovery');
    runtime.disable();assert.strictEqual(store.current.enabled,false);assert.strictEqual(runtime.engineStarted,false);assert.strictEqual(runtime.hud,null);
    engine(s,2);runtime.evaluate();assert.strictEqual(runtime.hud,null,'running cannot undo explicit disable');
    runtime.setEngineStart(false);assert.strictEqual(store.current.enabled,false);assert.strictEqual(store.current.startup.mode,'manually');
    engine(s,0);runtime.setEnabled(true);assert(runtime.hud,'manual display does not require a running engine');
    runtime.setEngineStart(true);assert.strictEqual(runtime.hud,null,'enabling the option while off waits for confirmation');
    const before=fs.readFileSync(store.file,'utf8');assert.throws(()=>runtime.setEngineStart('true'),/boolean/);assert.strictEqual(fs.readFileSync(store.file,'utf8'),before);
    engine(s,2);assert(runtime.hud);
    // Quality, not a plausible string, authorizes the gate. No cached running
    // state may survive a stale/unverified reading from a future source adapter.
    const actualReading=s.reading.bind(s);
    for(const quality of ['stale','unverified','unavailable','invalid']){
        s.reading=key=>key==='engineRunning'?{value:'running',quality,source:'test fixture'}:actualReading(key);
        runtime.evaluate();assert.strictEqual(runtime.hud,null);
        s.reading=actualReading;engine(s,0);assert.strictEqual(runtime.hud,null);engine(s,2);assert(runtime.hud);
    }
    runtime.stop();assert.strictEqual(runtime.engineStarted,false);assert.strictEqual(s.engineEpochToken(),null);
    assert.strictEqual(timerCount,0);assert.strictEqual(shutdowns,12);assert.throws(()=>runtime.setEngineStart(false),/stopped/);
    open();await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(store.current.startup.onEngineStart,true);assert.strictEqual(store.current.startup.mode,'manually');
    assert.strictEqual(runtime.hud,null,'restart keeps the preference but never the previous engine observation');
    active(runtime.source,7);engine(runtime.source,0);assert.strictEqual(runtime.hud,null);
    engine(runtime.source,2);assert(runtime.hud,'confirmed already-running initial snapshot can activate the existing process');
    // A failed disable still releases drawing and stops this process. Once the
    // storage problem is repaired, the stopped controller cannot re-arm itself.
    const beforeFailure=fs.readFileSync(store.file,'utf8'),rename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to===store.file)throw new Error('synthetic storage failure');return rename(from,to);};
    try{assert.throws(()=>runtime.setEnabled(false),/synthetic storage failure/);}
    finally{fs.renameSync=rename;}
    assert.strictEqual(runtime.stopped,true);assert.strictEqual(runtime.hud,null);
    assert.strictEqual(fs.readFileSync(store.file,'utf8'),beforeFailure,'failed save leaves the prior complete file');
    assert.throws(()=>runtime.setEnabled(true),/stopped/);
    assert.throws(()=>runtime.setEnabled(false),/stopped/);
    assert.strictEqual(fs.readFileSync(store.file,'utf8'),beforeFailure);
    const repaired=JSON.parse(beforeFailure);repaired.enabled=false;repaired.language='en';store.save(repaired);
    assert.strictEqual(store.current.language,'en','safe display preferences may still be saved after shutdown');
    assert.throws(()=>runtime.setEnabled(true),/stopped/);
    assert.strictEqual(JSON.parse(fs.readFileSync(store.file,'utf8')).enabled,false,'late UI enable cannot re-arm a stopped process for the next launch');
    runtime.stop();assert.strictEqual(timerCount,0);assert.strictEqual(watches,24);assert.strictEqual(shutdowns,24);
    assert.deepStrictEqual(fs.readdirSync(dir),['manuk_retro_cluster.json']);
    const saved=JSON.parse(fs.readFileSync(store.file,'utf8'));assert(!saved.engineRunning&&!saved.engineStarted&&!saved.engineEpoch);
    assert.strictEqual(saved.startup.onEngineStart,true);assert.strictEqual(saved.enabled,false);
    assert(starts===stops,'all fake HUD owners were released');
    console.log('PASS engine-start display: direct metadata only, active-session start-stop latch, unknown/epoch/sleep/disable clearing, critical release, persisted preference with manual package, no new timers or polls');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).then(()=>{
    if(runtime)runtime.stop();if(store)store.stop();fs.readdirSync(dir).forEach(name=>fs.unlinkSync(path.join(dir,name)));fs.rmdirSync(dir);
});

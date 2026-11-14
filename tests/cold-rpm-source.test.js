'use strict';
// Offline regression: a prepared presentation contract is not a vehicle source.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const Source=require('../apps/manuk_retro_cluster/retro_source');
const config=require('../apps/manuk_retro_cluster/config');
const spec=require('../apps/manuk_retro_cluster/app.json');
const log={info(){},warn(){},error(){}};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retro-cold-rpm-'));
const store=new config.ConfigStore(dir,'car',log);
let now=1000,source;
const watches=[];
const ctx={dataDir:dir,log,signals:{watch(iface,version,handlers){
    watches.push({iface,fields:Object.keys(handlers)});
    return Promise.resolve({available:false,shutdown(){}});
}}};
function make(){return new Source(ctx,()=>store.current,{now:()=>now});}
function unavailable(s){
    const r=s.reading('coldRpmLimit');
    assert.strictEqual(r.value,null);assert.strictEqual(r.unit,'rpm');assert.strictEqual(r.source,null);
    assert.strictEqual(r.quality,'unavailable');assert.strictEqual(r.receivedAt,null);
    assert(/no confirmed passive source/.test(r.reason));assert.strictEqual(r.active,undefined);
    assert.strictEqual(s.data().coldRpmLimit,null);
    assert.deepStrictEqual(s.diagnostics().readings.coldRpmLimit,r);
}
(async()=>{
    source=make();unavailable(source);source.start();source.start();
    await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(watches.length,12,'no new guessed provider or duplicate subscription');
    watches.forEach(({iface,fields})=>assert.deepStrictEqual(fields.sort(),Object.keys(spec.signals[iface]).filter(f=>f!=='statusInjectionVolume').sort(),'ordinary display never starts the opt-in diagnostic subscriptions'));
    assert(!watches.some(w=>/ResetLogic/.test(w.iface)),'raw consumption inspection starts only from its explicit menu action');
    assert(!JSON.stringify(spec.signals).match(/coldRpm|rpmLimit|RPMMax|redline/i),'manifest has no invented restriction permission');
    source.receive('condition','VehicleCondition',{statusConditionVehicle:10});
    // Extra properties on a real field are untrusted, even if their names look useful.
    const injected={coldRpmLimit:4500,maximumRPM:4500,availableEngineSpeed:4500,
        quality:'valid',unit:'rpm',active:true,source:'untrusted payload'};
    [48,78,148,198,255].forEach(rawOil=>{
        source.receive('cds','statusEngineTemperature',Object.assign({temperatureEngineOilDrive:rawOil,temperatureEngineDrive:138},injected));
        [0,3200,7000].forEach(rpm=>{
            source.receive('cds','statusEngineSpeed2',Object.assign({actualValueRPMEngineCrankshaft:rpm*4},injected));
            source.receive('speed','statusCarSpeed2',{speedVehicleCentreOfGravity:88*64});
            source.setRedline(4500);unavailable(source);
            now+=60000;source.tick();unavailable(source);
        });
    });
    source.receive('cds','coldRpmLimit',injected);unavailable(source);
    source.availability('cds',true);source.availability('cds',false);unavailable(source);
    source.availability('cds',true);unavailable(source);
    source.receive('condition','VehicleCondition',{statusConditionVehicle:12});unavailable(source);
    source.receive('cds','statusEngineSpeed2',Object.assign({actualValueRPMEngineCrankshaft:12800},injected));
    source.receive('condition','VehicleCondition',{statusConditionVehicle:10});unavailable(source);
    for(const profile of ['car','bench'])for(const location of ['root','retro','profiles']){
        const bad=config.defaults(profile);(location==='root'?bad:bad[location]).coldRpmLimit=4500;
        assert.throws(()=>config.validate(bad),/coldRpmLimit.*unknown key/,'configuration cannot authorize or persist a synthetic limit');
    }
    const saved=config.defaults('car');saved.retro.redline=6500;saved.retro.coldGuard=true;store.save(saved);
    source.stop();unavailable(source);source=make();unavailable(source);
    store.load();assert.strictEqual(store.current.retro.redline,6500);unavailable(source);
    assert.deepStrictEqual(fs.readdirSync(dir),['manuk_retro_cluster.json'],'observations never create persisted limiter state');
    assert(!/coldRpmLimit/.test(fs.readFileSync(store.file,'utf8')));
    console.log('PASS cold RPM source: unsupported across temperature/time/epochs/sleep/restart, raw extras and settings rejected, no extra subscriptions or persisted observations');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).then(()=>{
    if(source)source.stop();store.stop();fs.readdirSync(dir).forEach(name=>fs.unlinkSync(path.join(dir,name)));fs.rmdirSync(dir);
});

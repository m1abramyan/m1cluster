'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const config=require('../apps/manuk_retro_cluster/config');
const clone=v=>JSON.parse(JSON.stringify(v));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retro-display-settings-'));
const log={warn(){},error(){}};
try {
    for(const profile of ['car','bench']){
        const base=config.defaults(profile);
        assert.strictEqual(base.startup.onEngineStart,false);
        assert.strictEqual(base.startup.mode,'manually');
        for(const speed of ['kmh','mph'])for(const temperature of ['c','f'])for(const pressure of ['bar','psi'])for(const consumption of ['l100km','mpg']){
            const c=clone(base);c.displayUnits={speed,temperature,pressure,consumption};
            assert.deepStrictEqual(config.validate(c).displayUnits,c.displayUnits,'all independent combinations are supported');
        }
        ['speed','temperature','pressure','consumption'].forEach(key=>{
            const missing=clone(base);delete missing.displayUnits[key];assert.throws(()=>config.validate(missing),/required/);
            [null,true,0,'unknown'].forEach(value=>{const c=clone(base);c.displayUnits[key]=value;assert.throws(()=>config.validate(c),/unsupported/);});
        });
        const extra=clone(base);extra.displayUnits.tankLitres=65;assert.throws(()=>config.validate(extra),/unknown key/);
        const obsolete=clone(base);obsolete.widgets={selected:'dashboard'};assert.throws(()=>config.validate(obsolete),/widgets.*unknown key/);
        [null,1,'true'].forEach(value=>{const c=clone(base);c.startup.onEngineStart=value;assert.throws(()=>config.validate(c),/expected boolean/);});
        const automatic=clone(base);automatic.startup.onEngineStart=true;assert.strictEqual(config.validate(automatic).startup.mode,'manually','engine display option cannot change package start policy');
        const legacy=clone(base);legacy.schemaVersion=6;delete legacy.displayUnits;delete legacy.startup.onEngineStart;legacy.widgets={selected:'navigation'};
        ['metric','us'].forEach(units=>{
            legacy.units=units;
            const migrated=config.validate(legacy);
            assert.strictEqual(migrated.widgets,undefined);assert.strictEqual(migrated.startup.onEngineStart,false);
            assert.deepStrictEqual(migrated.displayUnits,units==='us'?{speed:'mph',temperature:'f',pressure:'psi',consumption:'mpg'}:{speed:'kmh',temperature:'c',pressure:'bar',consumption:'l100km'});
        });
        legacy.displayUnits=base.displayUnits;assert.throws(()=>config.validate(legacy),/unknown key in schema version 6/);
    }
    const store=new config.ConfigStore(dir,'car',log),c=clone(store.current);
    c.language='en';c.displayUnits={speed:'mph',temperature:'c',pressure:'bar',consumption:'mpg'};c.startup.onEngineStart=true;
    store.save(c);const restarted=new config.ConfigStore(dir,'car',log);
    assert.deepStrictEqual(restarted.current,c);assert.strictEqual(restarted.current.enabled,false);
    assert.strictEqual(restarted.current.startup.mode,'manually');
    const before=fs.readFileSync(store.file,'utf8'),bad=clone(c);bad.engineRunning='running';
    assert.throws(()=>store.save(bad),/unknown key/);assert.strictEqual(fs.readFileSync(store.file,'utf8'),before,'vehicle observations cannot be saved with preferences');
    assert(!fs.readdirSync(dir).some(name=>name.indexOf('.tmp-')>=0));store.stop();restarted.stop();
    assert.deepStrictEqual(require('../config/schema.json'),config.schema);
    ['car','bench','car-parked-strip'].forEach(name=>{const example=require('../config/'+name+'.example.json');assert.deepStrictEqual(config.validate(example),example);assert.strictEqual(example.schemaVersion,7);});
    console.log('PASS display settings: 16 independent unit combinations, schema7 migration, strict engine option, atomic persistence without car observations or system autostart changes');
} finally {fs.readdirSync(dir).forEach(name=>fs.unlinkSync(path.join(dir,name)));fs.rmdirSync(dir);}

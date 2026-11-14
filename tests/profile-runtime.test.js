'use strict';
// Exercise the real HUD adapter, not a separate implementation of its tokens or quality policy.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'apps/manuk_retro_cluster'), shared = path.join(root, 'shared');
const kit = path.join(root, 'kit/runtime'), originalLoad = Module._load, pack = require(path.join(kit, 'pack'));
Module._load = function (request, parent, isMain) {
    if (parent && (parent.filename.indexOf(app + path.sep) === 0 || parent.filename.indexOf(shared + path.sep) === 0)) {
        if (request === './hud_data') return pack.open(path.join(app, 'hud'));
        if (request.indexOf('./kit/') === 0) return originalLoad.call(this, path.join(kit, request.slice(6)), parent, isMain);
        if (request.indexOf('./') === 0 && !fs.existsSync(path.resolve(path.dirname(parent.filename), request) + '.js')) {
            const candidate = path.join(shared, request);
            if (fs.existsSync(candidate) || fs.existsSync(candidate + '.js')) return originalLoad.call(this, candidate, parent, isMain);
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};
const Hud = require(path.join(app, 'retro_runtime')).RetroHud;
const ConfigStore = require(path.join(app, 'config')).ConfigStore;
const view = require(path.join(app, 'profile_view'));
Module._load = originalLoad;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-profile-runtime-')), log = { info() {}, warn() {}, error() {} };
const store = new ConfigStore(dir, 'car', log), spec = require(path.join(app, 'app.json'));
const values = { speed: 88, rpm: 3200, gear: 4, stage: 'D', selector: 'D', driveProfile: 'sport', driveMode: 'SPORT', engineProfile: null, gearboxProgram: null, dsc: null, boost: null, oil: 100 };
const simulated = { forceProfile: 'eco', engineProfile: 'SPORT', gearboxProgram: 'M', dsc: 'OFF', boost: 1.2,
    speed: 199, gear: 8, consumption: 8.4, range: 450, fuelFlow: 1.2 };
let coldReading=null;
const source = { data: () => Object.assign({ demo: false }, values), read: (key) => values[key],
    reading: (key) => key==='coldRpmLimit'?coldReading:null, onSample() { return () => {}; } };
const ctx = { log, spec, dataDir: dir, retroBenchValues: () => simulated };
const car = new Hud(ctx, source, store, 'car'), bench = new Hud(ctx, source, store, 'bench');
try {
    const state = car.visualState();
    assert.strictEqual(state.profile, 'sport'); assert.strictEqual(state.engineProfile, null); assert.strictEqual(state.gearboxProgram, null); assert.strictEqual(state.dsc, null);
    assert.strictEqual(car._boost(), null, 'injected bench values are ignored in car runtime');
    assert.strictEqual(car._token('boostGauge'), '--', 'vehicle gauge never displays unconfirmed synthetic boost');
    assert.strictEqual(bench.visualState().profile, 'eco'); assert.strictEqual(bench.visualState().speed, 88); assert.strictEqual(bench.visualState().gear, 4);
    ['comfort', 'sport', 'eco', 'neutral'].forEach((profile) => {
        simulated.forceProfile = profile;
        assert.strictEqual(bench.visualState().profile, profile); assert.strictEqual(bench.visualState().dsc, 'OFF');
        assert.strictEqual(bench.visualState().gear, 4); assert.strictEqual(bench.visualState().speed, 88); assert.strictEqual(bench.visualState().driveMode, 'SPORT');
        assert.strictEqual(bench._mainMetric(), 'consumption', 'left consumption is fixed across visual profiles');
        assert.strictEqual(bench._token('profileMain'), '8.4');
        assert.strictEqual(bench._token('rangeValue'), '450', 'left range is fixed across visual profiles');
        assert.strictEqual(bench._token('boostGauge'), '1.20', 'boost is independent of the selected visual profile');
        const layout = view.layout(require(path.join(app, 'hud/layouts/retro80s.json')), store.current);
        assert(!layout.widgets.some((w) => w.id === 'aux_head' || w.id === 'aux_value'), 'no auxiliary readout in ' + profile);
    });
    assert.strictEqual(values.gear, 4); assert.strictEqual(values.dsc, null); assert.strictEqual(values.driveMode, 'SPORT');
    values.driveMode = 'SPORT+';
    assert.strictEqual(bench._token('modeAndDsc'), 'SPORT+ / DSC OFF');
    simulated.dsc = 'DTC';
    assert.strictEqual(bench._token('modeAndDsc'), 'SPORT+ / TRACTION', 'DTC has its requested label without the DSC prefix');
    assert.strictEqual(bench.visualState().dsc, 'DTC', 'the label does not change the independent source state');
    simulated.dsc = 'OFF';
    assert.strictEqual(car._token('modeAndDsc'), 'SPORT+ / DSC --', 'Sport+ never implies DSC OFF or ON');
    values.dsc = 'ON'; values.driveMode = 'COMFORT'; values.driveProfile = 'comfort';
    assert.strictEqual(car._token('modeAndDsc'), 'COMFORT / DSC ON', 'normalised DSC is independent of mode');
    assert.strictEqual(car._token('gearboxState'), '-', 'selector D never implies the gearbox programme');
    assert.strictEqual(car._token('gearboxCaption'), 'КПП: D', 'caption may report confirmed selector D while programme remains unavailable');
    assert.strictEqual(bench._token('gearboxState'), 'M', 'confirmed programme is displayed once, without duplicating selector D');
    assert.strictEqual(bench._token('gearboxCaption'), 'КПП: M', 'confirmed M is displayed directly, never relabelled D or S');
    assert.strictEqual(bench._token('gearnum'), '4');
    ['D','S','M'].forEach(program => {
        simulated.gearboxProgram=program;
        [1,2,3,4,5,6,7,8].forEach(gear=>{
            values.gear=gear;
            assert.strictEqual(bench._token('gearboxState')+bench._token('gearnum'),program+gear);
            ['comfort','sport','eco'].forEach(profile=>{
                simulated.forceProfile=profile;
                assert.strictEqual(bench._token('gearboxState'),program,'visual profile does not alter gearbox programme');
                assert.strictEqual(bench._token('gearnum'),String(gear),'visual profile does not alter actual gear');
                assert.strictEqual(bench._token('gearboxCaption'),'КПП: '+program);
                assert.strictEqual(bench.visualState().speed,88);assert.strictEqual(bench.visualState().dsc,'OFF');
            });
        });
    });
    simulated.gearboxProgram=null;values.gear=2;
    assert.strictEqual(bench._token('gearboxState'),'-');assert.strictEqual(bench._token('gearnum'),'2');
    simulated.gearboxProgram='M';values.gear=null;
    assert.strictEqual(bench._token('gearboxState'),'M');assert.strictEqual(bench._token('gearnum'),'-');
    assert.strictEqual(car._token('gearboxState'),'-','car still ignores the injected bench programme');
    assert.strictEqual(car._token('gearboxCaption'),'КПП: D','car ignores the injected M caption state as well');
    values.gear=4;
    ['COMFORT','SPORT','SPORT+','SPORT INDIVIDUAL','ECO PRO'].forEach(mode=>{
        values.driveMode=mode;
        values.driveProfile=mode.indexOf('SPORT')===0?'sport':mode==='ECO PRO'?'eco':'comfort';
        [null,'S','M'].forEach(program=>{
            values.gearboxProgram=program;
            assert.strictEqual(car._token('gearboxState'),program||'-','FES never supplies a programme');
            assert.strictEqual(car._token('gearboxCaption'),'КПП: '+(program||'D'),'caption follows only confirmed selector/programme');
            assert.strictEqual(car._token('gearnum'),'4');
            assert.strictEqual(car.visualState().speed,88);assert.strictEqual(car.visualState().dsc,'ON');
            assert.strictEqual(car.visualState().engineProfile,null,'FES does not invent an engine profile');
        });
    });
    values.gearboxProgram=null;
    values.selector=null;values.stage=null;simulated.gearboxProgram=null;
    assert.strictEqual(car._token('gearboxCaption'),'КПП: -','unknown selector/programme cannot become D from the current mode or actual gear');
    assert.strictEqual(car._token('gearnum'),'4','independently confirmed actual gear survives an unavailable selector');
    simulated.gearboxProgram='S';
    assert.strictEqual(bench._token('gearboxCaption'),'КПП: S','independently confirmed S survives an unavailable selector');
    assert.strictEqual(car._token('gearboxCaption'),'КПП: -','car does not use the injected S');
    values.selector='D';values.stage='D';simulated.gearboxProgram='S';
    store.current.language='en';
    assert.strictEqual(bench._token('gearboxCaption'),'GEARBOX: S');
    store.current.language='ru';
    values.gear=4;simulated.gearboxProgram='M';
    values.dsc = 1; assert.strictEqual(car._token('dscState'), 'DSC --', 'raw Boolean-looking DSC code is not interpreted');
    values.dsc = null; values.driveMode = 'SPORT'; values.driveProfile = 'sport';
    values.speed = 0;
    assert.strictEqual(bench._mainMetric(), 'fuelFlow', 'standing consumption uses litres per hour only');
    assert.strictEqual(bench._token('profileMain'), '1.2');
    assert(/Л\/Ч/.test(bench._token('profileMainHead')));
    simulated.fuelFlow = 0; assert.strictEqual(bench._token('profileMain'), '0.0', 'real zero fuel flow remains zero');
    simulated.fuelFlow = null; assert.strictEqual(bench._token('profileMain'), '--', 'standing cannot reuse moving consumption when fuel flow is unavailable');
    assert.strictEqual(car._token('profileMain'), '--', 'car never consumes the explicit bench fuel flow');
    values.speed = null; assert.strictEqual(bench._token('profileMain'), '--', 'unknown speed cannot display consumption per 100 km');
    values.speed = 88; simulated.forceProfile = 'sport';
    const layout = view.layout(require(path.join(app, 'hud/layouts/retro80s.json')), store.current);
    assert.strictEqual(layout.widgets.find((w) => w.id === 'consumption').text, '{{profileMain}}');
    assert.strictEqual(layout.widgets.find((w) => w.id === 'range').text, '{{rangeValue}}');
    assert(!layout.widgets.some((w) => ['slot1', 'slot2', 'slot2_head'].indexOf(w.id) >= 0), 'old readout column is removed');
    assert.strictEqual(store.current.profiles.aux, undefined, 'removed auxiliary configuration cannot restore a readout');
    // Invoke the actual inherited meter updater and inspect its renderer uniforms.
    // No network, sockets or HUD start: this exercises the same clamp/update code as the renderer path.
    function meter(id) {
        const uniforms = {}, w = Object.assign({}, layout.widgets.find((it) => it.id === id));
        const x = { w, ref: 1, c: { uniform(ref, key, value) { uniforms[key] = value; } }, last: null };
        bench._update(x, 1000, true);
        return { fraction: uniforms.u_value[0], max: x.w.max, mid: uniforms.u_midAt, high: uniforms.u_highAt, flash: uniforms.u_flash };
    }
    ['comfort', 'sport', 'eco'].forEach((profile) => {
        simulated.forceProfile = profile;
        simulated.consumption = 0; simulated.range = 0;
        assert.strictEqual(bench._token('profileMain'), '0.0'); assert.strictEqual(bench._token('rangeValue'), '0');
        assert.strictEqual(meter('consumption_bar').fraction, 0); assert.strictEqual(meter('range_bar').fraction, 0);
        simulated.consumption = null; simulated.range = null;
        assert.strictEqual(bench._token('profileMain'), '--'); assert.strictEqual(bench._token('rangeValue'), '--');
        assert.strictEqual(meter('consumption_bar').fraction, 0); assert.strictEqual(meter('range_bar').fraction, 0);
        simulated.consumption = store.current.profiles.gaugeMax.consumption + 10;
        simulated.range = store.current.profiles.gaugeMax.range + 1;
        assert.strictEqual(meter('consumption_bar').fraction, 1); assert.strictEqual(meter('range_bar').fraction, 1);
        simulated.consumption = -1; simulated.range = -1;
        assert.strictEqual(meter('consumption_bar').fraction, 0); assert.strictEqual(meter('range_bar').fraction, 0);
    });
    simulated.range = 4094; assert.strictEqual(bench._token('rangeValue'), '4094', 'four-digit valid range fits without reducing the font');
    values.speed = 0; simulated.fuelFlow = 1.2;
    assert.strictEqual(meter('consumption_bar').max, store.current.profiles.gaugeMax.fuelFlow);
    assert.strictEqual(meter('consumption_bar').fraction, 0.12);
    simulated.fuelFlow = null; assert.strictEqual(meter('consumption_bar').fraction, 0); assert.strictEqual(bench._token('profileMain'), '--');
    values.speed = 88; simulated.consumption = 15;
    assert.strictEqual(meter('consumption_bar').max, store.current.profiles.gaugeMax.consumption);
    assert.strictEqual(meter('consumption_bar').fraction, 0.5);
    values.oil=100;values.coolant=90;
    store.current.units='metric';
    assert.strictEqual(bench._token('u:temp'),'°C');assert.strictEqual(bench._token('oil'),'100');assert.strictEqual(bench._token('coolant'),'90');
    store.current.displayUnits.temperature='f';
    assert.strictEqual(bench._token('u:temp'),'°F');assert.strictEqual(bench._token('oil'),'212');assert.strictEqual(bench._token('coolant'),'194');
    assert.strictEqual(values.oil,100);assert.strictEqual(values.coolant,90,'unit changes do not alter source Celsius readings');
    store.current.displayUnits.temperature='c';
    // Independent categories must change the actual HUD tokens, not just settings.
    values.speed=88;simulated.boost=0.8;simulated.consumption=8.4;simulated.range=450;
    const baseReadings=JSON.stringify(values),baseSimulated=JSON.stringify(simulated);
    store.current.displayUnits={speed:'mph',temperature:'c',pressure:'psi',consumption:'mpg'};
    assert.strictEqual(bench._token('speed'),'55');assert.strictEqual(bench._token('u:speed'),'МИЛЬ/Ч');
    assert.strictEqual(bench._token('oil'),'100');assert.strictEqual(bench._token('u:temp'),'°C');
    assert.strictEqual(bench._token('boostGauge'),'11.6');assert.strictEqual(bench._token('boostUnit'),'PSI');
    assert.strictEqual(bench._token('profileMain'),'28.0');assert.strictEqual(bench._token('consumptionUnit'),'MPG US');
    assert.strictEqual(bench._token('rangeValue'),'280');assert.strictEqual(bench._token('rangeUnit'),'MI');
    assert.strictEqual(JSON.stringify(values),baseReadings);assert.strictEqual(JSON.stringify(simulated),baseSimulated);
    store.current.displayUnits={speed:'kmh',temperature:'c',pressure:'bar',consumption:'l100km'};
    ['oil', 'coolant'].forEach((key) => {
        values[key] = 0; assert.strictEqual(meter(key + '_bar').fraction, 0);
        values[key] = null; assert.strictEqual(meter(key + '_bar').fraction, 0); assert.strictEqual(bench._token(key), '--');
        values[key] = key === 'oil' ? 151 : 131; assert.strictEqual(meter(key + '_bar').fraction, 1);
    });
    simulated.fuelPct = 0; assert.strictEqual(meter('fuel_bar').fraction, 0);
    simulated.fuelPct = null; assert.strictEqual(meter('fuel_bar').fraction, 0); assert.strictEqual(bench._token('fuelPct'), '--');
    simulated.fuelPct = 150; assert.strictEqual(meter('fuel_bar').fraction, 1);
    ['comfort', 'sport', 'eco'].forEach((profile) => {
        simulated.forceProfile = profile;
        simulated.boost = 0; assert.strictEqual(meter('boost_bar').fraction, 0); assert.strictEqual(bench._token('boostGauge'), '0.00');
        simulated.boost = null; assert.strictEqual(meter('boost_bar').fraction, 0); assert.strictEqual(bench._token('boostGauge'), '--');
        simulated.boost = 1.6; assert.strictEqual(meter('boost_bar').fraction, 1);
        simulated.boost = 2; assert.strictEqual(meter('boost_bar').fraction, 1);
        simulated.boost = -1; assert.strictEqual(meter('boost_bar').fraction, 0);
        assert.strictEqual(values.gear, 4); assert.strictEqual(values.driveMode, 'SPORT'); assert.strictEqual(values.dsc, null);
    });
    simulated.boost = 1.2; store.current.retro.warnBoost = 1;
    assert.strictEqual(bench._warning(layout.widgets.find(w=>w.id==='boost')), 'boost', 'relocated boost preserves its configured high-value warning');
    assert.strictEqual(car._warning(layout.widgets.find(w=>w.id==='boost')), null, 'unavailable vehicle boost cannot raise a synthetic warning');
    store.current.retro.warnBoost = 0;
    const redlineBefore = bench.setting('redline');
    bench.flash = true;
    ['comfort', 'sport', 'eco', 'neutral'].forEach(profile => {
        simulated.forceProfile = profile;
        assert.strictEqual(bench._barMax(), 8000);
        assert.strictEqual(bench._token('profileAxis'), 'ОБОРОТЫ /1000');
        [[null,0],[-1,0],[0,0],[199,0],[200,200],[249,200],[250,200],[399,200],[400,400],[499,400],[500,400],[4999,4800],[5000,5000],[5199,5000],[5200,5200],[6999,6800],[7000,7000],[7199,7000],[7200,7200],[7999,7800],[8000,8000],[8500,8000]].forEach(pair => {
            values.rpm=pair[0]; bench.rpmF=249.9;
            const tach=meter('revs');
            assert.strictEqual(tach.fraction,pair[1]/8000,profile+' exact RPM boundary '+pair[0]);
            assert.deepStrictEqual(tach.mid,[6000/8000],'fixed yellow zone starts at 6000rpm in every profile');
            assert.deepStrictEqual(tach.high,[7000/8000],'fixed red zone starts at 7000rpm in every profile');
            assert.deepStrictEqual(tach.flash,[pair[0]>=7000?1:0],'only source RPM in the red zone activates the all-bar flash at 1000ms');
        });
        values.rpm=3200;
        [null,0,100].forEach(v=>{simulated.consumption=v;assert.strictEqual(meter('revs').fraction,3200/8000,'consumption does not control the '+profile+' tachometer');});
    });
    assert.strictEqual(bench.setting('redline'),redlineBefore,'display extent does not change the shift/redline setting');
    bench.flash = false;
    // Exercise phase changes on the real updater at constant RPM. It uses the
    // caller's existing tick timestamp and must not create another timer.
    const writes=[],flashUniforms={},flashWidget={w:Object.assign({},layout.widgets.find(w=>w.id==='revs')),ref:9,last:null,
        c:{uniform(ref,name,value){writes.push({name,value:value.slice()});flashUniforms[name]=value.slice();}}};
    const originalInterval=global.setInterval,originalTimeout=global.setTimeout;
    try {
        global.setInterval=global.setTimeout=()=>{throw new Error('tachometer update must reuse the existing tick, not schedule a timer');};
        values.rpm=7000;bench.rpmF=1000;
        bench._update(flashWidget,0,false);
        assert.deepStrictEqual(flashUniforms.u_value,[7000/8000],'flash does not replace the actual RPM fraction with a fabricated full value');
        assert.deepStrictEqual(flashUniforms.u_flash,[1]);
        let count=writes.length;
        bench._update(flashWidget,249,false);assert.strictEqual(writes.length,count,'same RPM and phase keep the renderer cache');
        bench._update(flashWidget,250,false);
        assert(writes.length>count,'constant RPM still updates when the flash phase changes');
        assert.deepStrictEqual(flashUniforms.u_value,[7000/8000]);assert.deepStrictEqual(flashUniforms.u_flash,[2]);
        count=writes.length;
        bench._update(flashWidget,499,false);assert.strictEqual(writes.length,count,'dim phase remains cached until its boundary');
        bench._update(flashWidget,500,false);assert(writes.length>count);assert.deepStrictEqual(flashUniforms.u_flash,[1]);
        values.rpm=6999;bench._update(flashWidget,501,false);
        assert.deepStrictEqual(flashUniforms.u_flash,[0],'returning below the red zone stops flashing immediately');
        assert.deepStrictEqual(flashUniforms.u_value,[6800/8000]);
        values.rpm=7000;bench._update(flashWidget,750,false);assert.deepStrictEqual(flashUniforms.u_flash,[2]);
        values.rpm=null;bench.rpmF=7800;bench._update(flashWidget,751,false);
        assert.deepStrictEqual(flashUniforms.u_flash,[0],'source invalidation stops flashing even if a smoothed old RPM remains');
        assert.deepStrictEqual(flashUniforms.u_value,[0]);
        values.rpm=7000;bench._update(flashWidget,1000,false);assert.deepStrictEqual(flashUniforms.u_flash,[1]);
        values.rpm=NaN;bench._update(flashWidget,1001,false);
        assert.deepStrictEqual(flashUniforms.u_flash,[0]);assert.deepStrictEqual(flashUniforms.u_value,[0]);
    } finally {
        global.setInterval=originalInterval;global.setTimeout=originalTimeout;values.rpm=3200;bench.rpmF=null;
    }
    // This positive case is an explicit unit-test fixture for a future verified
    // adapter. The current real RetroSource still reports this reading unavailable.
    const confirmedCold={value:4500,unit:'rpm',source:'test fixture: verified passive restriction',quality:'valid',active:true};
    try {
        global.setInterval=global.setTimeout=()=>{throw new Error('cold RPM display must not create a timer');};
        [car,bench].forEach(hud=>{
            const uniforms={},changes=[],x={w:Object.assign({},layout.widgets.find(w=>w.id==='revs')),ref:10,last:null,
                c:{uniform(ref,key,value){uniforms[key]=value.slice();changes.push(key);}}};
            const originalValue=hud._value;
            try {
                values.rpm=3200;values.coldRpmLimit=4500;simulated.coldRpmLimit=confirmedCold;
                hud._value=function(key){return key==='coldRpmLimit'?confirmedCold:originalValue.call(this,key);};
                coldReading=null;hud._update(x,0,false);
                assert.deepStrictEqual(uniforms.u_coldRange,[0,0],'raw data(), read(), _value() and bench callback cannot create a cold restriction');
                coldReading=Object.assign({},confirmedCold);hud._update(x,1,false);
                assert.deepStrictEqual(uniforms.u_coldRange,[1,4500/8000]);
                assert.deepStrictEqual(uniforms.u_value,[3200/8000],'cold boundary never changes actual RPM');
                const count=changes.length;
                [249,250,500,60000].forEach(time=>hud._update(x,time,false));
                assert.strictEqual(changes.length,count,'elapsed time alone neither moves nor fades the blue boundary');
                coldReading=Object.assign({},confirmedCold,{value:6001});hud._update(x,60001,false);
                assert(changes.length>count,'a new limit updates cached uniforms while actual RPM is unchanged');
                assert.deepStrictEqual(uniforms.u_coldRange,[1,6001/8000]);
                [null,{quality:'stale'},{quality:'unverified'},{quality:'invalid'},{quality:'unavailable'},{active:false},{value:null}].forEach(invalid=>{
                    coldReading=Object.assign({},confirmedCold);hud._update(x,60002,false);
                    coldReading=invalid===null?null:Object.assign({},confirmedCold,invalid);hud._update(x,60003,false);
                    assert.deepStrictEqual(uniforms.u_coldRange,[0,0],'missing, inactive or invalidated reading clears a previous boundary immediately');
                });
                [null,undefined,NaN,Infinity].forEach(rpm=>{
                    values.rpm=3200;coldReading=Object.assign({},confirmedCold);hud._update(x,60004,false);
                    values.rpm=rpm;hud.rpmF=3200;hud._update(x,60005,false);
                    assert.deepStrictEqual(uniforms.u_coldRange,[0,0],'loss of current RPM also clears the cold boundary');
                });
                values.rpm=3200;coldReading=Object.assign({},confirmedCold);hud._update(x,60006,true);
                assert.deepStrictEqual(uniforms.u_coldRange,[1,4500/8000],'a fresh renderer snapshot restores only the current normalized reading');
                const readingMethod=source.reading;
                try {
                    delete source.reading;hud._update(x,60007,false);
                    assert.deepStrictEqual(uniforms.u_coldRange,[0,0],'older sources without metadata cannot activate the prepared display');
                } finally { source.reading=readingMethod; }
            } finally { hud._value=originalValue;hud.rpmF=null; }
        });
    } finally {
        global.setInterval=originalInterval;global.setTimeout=originalTimeout;
        coldReading=null;delete values.coldRpmLimit;delete simulated.coldRpmLimit;values.rpm=3200;
    }
    assert.strictEqual(bench._effectShader({id:'revs',type:'shiftbar'}),require('../apps/manuk_retro_cluster/retro_tachometer'));
    assert.strictEqual(bench._effectShader({id:'oil_bar',type:'meter'}),require('../shared/shaders').meter,'other effects retain the original shader');
    store.current.profiles.enabled=false;
    assert.strictEqual(bench._effectShader({id:'revs',type:'shiftbar'}),require('../shared/shaders').shiftbar,'archived reference retains the exact original shader');
    assert.strictEqual(bench._barMax(),Math.ceil(redlineBefore/1000)*1000,'archived reference retains its original scale');
    store.current.profiles.enabled=true; bench.rpmF=null;
    values.stage = 'D';values.selector='D';
    [undefined,null,0,9,10,-1,1.5,'2',NaN,Infinity].forEach(gear=>{
        values.gear=gear;
        assert.strictEqual(bench._token('gearnum'),'-','large gear accepts only confirmed integer 1..8: '+gear);
        assert.strictEqual(car._token('gearnum'),'-');
    });
    ['P', 'R', 'N'].forEach((stage) => {
        values.stage = stage; values.selector=stage;values.gear=4;
        ['S','M'].forEach(program=>{
            simulated.gearboxProgram=program;
            assert.strictEqual(bench._token('gearnum'),stage,'large P/R/N replaces a retained forward gear');
            assert.strictEqual(bench._token('gearboxState'),'',stage+' has no D/S/M programme prefix');
            assert.strictEqual(bench._token('gearboxCaption'),'КПП: '+stage,'confirmed selector has precedence over '+program);
            assert.strictEqual(car._token('gearboxCaption'),'КПП: '+stage);
        });
    });
    console.log('PASS real profile HUD: independent 1..8/P/R/N gear and selector/programme captions, car/bench isolation, six meters, equal 200rpm cells, timer-free cached red-zone flashing and source invalidation, unchanged redline and original reference');
} finally {
    car.stop(); bench.stop(); store.stop();
    const remove = (d) => { fs.readdirSync(d).forEach((name) => { const p = path.join(d, name); if (fs.statSync(p).isDirectory()) remove(p); else fs.unlinkSync(p); }); fs.rmdirSync(d); };
    remove(dir);
}

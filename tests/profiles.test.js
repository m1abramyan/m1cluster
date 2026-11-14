'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = '../apps/manuk_retro_cluster/';
const profiles = require(root + 'profile_view');
const config = require(root + 'config');
const original = require(root + 'hud/layouts/retro80s.json');
const locale = require(root + 'dashboard_locale');
const c = config.defaults('car');
const historical = JSON.stringify(original);
const adapted = profiles.layout(locale.layout(original, c), c);
const widget = id => adapted.widgets.find(w=>w.id===id);
// The original reference remains immutable; the owner's later layout is tested separately.
['oil', 'coolant', 'fuel'].forEach(id => {
    const a = original.widgets.find(w=>w.id===id), b = widget(id);
    ['w','h','font','type'].forEach(k=>assert.deepStrictEqual(b[k],a[k],id+'.'+k));
});
assert.strictEqual(JSON.stringify(original),historical);
assert(!adapted.widgets.some(w=>['slot1','slot1_head','slot2','slot2_head','aux_head','aux_value'].indexOf(w.id)>=0));
assert.strictEqual(widget('consumption').text,'{{profileMain}}');
assert.strictEqual(widget('range').text,'{{rangeValue}}');
const meters=adapted.widgets.filter(w=>w.type==='meter');
assert.strictEqual(meters.length,6);
assert.strictEqual(adapted.widgets.filter(w=>w.type==='shiftbar').length,1);
meters.forEach(w=>assert.strictEqual(w.segments,15,w.id+' must have exactly fifteen segments'));
assert.strictEqual(widget('revs').segments,40,'forty equal cells span 0..8000 RPM in 200 RPM increments');
[0,1,2,3,4,5,6,7,8].forEach(i=>assert.strictEqual(profiles.rpmFraction(i*1000),i/8,'linear position of '+i+'000 RPM'));
assert.strictEqual(profiles.TACHOMETER.flashHalfPeriodMs,250,'two complete red-flash cycles per second');
[[0,1],[249,1],[250,2],[499,2],[500,1]].forEach(([time,phase])=>{
    [7000,7200,8000,8500].forEach(rpm=>assert.strictEqual(profiles.rpmFlash(rpm,time),phase,'red-zone phase at '+rpm+'rpm, '+time+'ms'));
    [undefined,null,NaN,Infinity,-Infinity,'7000',-1,0,6999].forEach(rpm=>assert.strictEqual(profiles.rpmFlash(rpm,time),0,'missing/invalid/below-red-zone RPM never flashes'));
});
// Synthetic normalized reading only: no BMW field is mapped to this contract yet.
const coldReading={value:4500,unit:'rpm',source:'test fixture: verified passive restriction',quality:'valid',active:true};
[1,199,4500,6001,7999].forEach(value=>{
    const range=profiles.coldRpmRange(Object.assign({},coldReading,{value}));
    assert.deepStrictEqual(range,[1,value/8000],'cold restriction keeps its exact boundary without 200rpm rounding');
    assert(range[1]>0&&range[1]<1,'accepted restriction stays inside the original tachometer extent');
});
[undefined,null,{},4500,
    ...[undefined,null,0,-1,8000,8001,Infinity,NaN,'4500'].map(value=>Object.assign({},coldReading,{value})),
    ...['unavailable','invalid','stale','unverified','derived'].map(quality=>Object.assign({},coldReading,{quality})),
    ...[undefined,null,false,1,'true'].map(active=>Object.assign({},coldReading,{active})),
    ...[undefined,null,'',4500].map(source=>Object.assign({},coldReading,{source})),
    ...[undefined,null,'','RPM','r/min'].map(unit=>Object.assign({},coldReading,{unit}))
].forEach(reading=>assert.deepStrictEqual(profiles.coldRpmRange(reading),[0,0],'incomplete or unconfirmed restriction is absent'));
[['consumption',200],['range',345],['fuel',490],['oil',1530],['coolant',1675],['boost',1820]].forEach(([id,centre])=>{
    const bar=widget(id+'_bar');assert.strictEqual(bar.x+bar.w/2,centre,id+' gauge placement');
    assert.strictEqual(bar.vertical,true);assert.strictEqual(bar.w,52);assert.strictEqual(bar.h,262);assert.strictEqual(bar.y,332);
    assert.strictEqual(widget(id).font,'d7_sm');
});
['fuel','fuel_bar','fuel_ghost','fuel_label'].forEach(id=>assert.strictEqual(adapted.widgets.filter(w=>w.id===id).length,1,id+' is moved, not duplicated'));
assert.strictEqual(widget('fuel').text,'{{fuelPct}}');
assert.strictEqual(widget('fuel_bar').signal,'fuel');
[['fuel',490,'%',3],['oil',1530,'{{u:temp}}',2],['coolant',1675,'{{u:temp}}',2]].forEach(([id,centre,text,conn])=>{
    const unit=widget(id+'_unit');
    assert.strictEqual(adapted.widgets.filter(w=>w.id===id+'_unit').length,1,id+' unit appears once');
    assert.deepStrictEqual([unit.x+unit.w/2,unit.y,unit.w,unit.h],[centre,655,130,27]);
    assert.strictEqual(unit.text,text);assert.strictEqual(unit.font,'ru_head');assert.strictEqual(unit.conn,conn);
    assert(unit.y>=widget(id).y+widget(id).h,id+' unit sits below its number');
});
const unitRow=['consumption','range','fuel','oil','coolant','boost'].map(id=>widget(id+'_unit'));
unitRow.forEach((unit,i)=>{
    assert.strictEqual(unit.y,655);assert.strictEqual(unit.h,27);assert(unit.y+unit.h<=720);
    if(i)assert(unitRow[i-1].x+unitRow[i-1].w<=unit.x,'neighbouring unit labels do not overlap');
});
const gaugeUnitFont=require(root+'hud/fonts/ru_head.json');
['%','°C','°F'].forEach(text=>{
    let width=0;for(const ch of text){assert(gaugeUnitFont.glyphs[ch],'missing gauge-unit glyph '+ch);width+=gaugeUnitFont.glyphs[ch].advance;}
    assert(width<=130,text+' fits without replacing the font');
});
['boost','boost_bar','boost_ghost','boost_label','boost_unit'].forEach(id=>assert.strictEqual(adapted.widgets.filter(w=>w.id===id).length,1,id+' appears exactly once'));
assert.strictEqual(widget('boost').text,'{{boostGauge}}');
const originalBoost=original.widgets.find(w=>w.id==='boost_bar');
['min','max','signal','colors','at'].forEach(key=>assert.deepStrictEqual(widget('boost_bar')[key],originalBoost[key],'original boost scale '+key));
assert(!adapted.widgets.some(w=>/avgConsumption|averageConsumption/.test(String(w.text||'')+' '+String(w.signal||''))),'average consumption has not been added to the canvas');
for(const name of profiles.NAMES) { assert.strictEqual(profiles.main(name,88),'consumption'); assert.strictEqual(profiles.slot(c,name,'2'),'range'); }
const speedBox=widget('speed'),gearBox=widget('gear'),gearLabel=widget('gear_label'),modeRow=widget('drive_mode'),speedUnit=widget('speed_unit');
assert.strictEqual(modeRow.text,'{{modeAndDsc}}');
const centre=widget('revs').x+widget('revs').w/2;
assert.strictEqual(modeRow.x+modeRow.w/2,centre,'mode/DSC stay centred independently of the speed');
assert.deepStrictEqual([modeRow.x,modeRow.y,modeRow.w,modeRow.h],[620,332,780,31]);
assert.deepStrictEqual([gearBox.x,gearBox.y,gearBox.w,gearBox.h],[663,387,155,195]);
assert.deepStrictEqual([speedBox.x,speedBox.y,speedBox.w,speedBox.h],[891,387,466,195]);
assert.strictEqual((gearBox.x+speedBox.x+speedBox.w)/2,centre,'reserved gear/speed group remains centred');
assert.strictEqual(speedBox.x+speedBox.w/2,1124);
assert.deepStrictEqual([speedUnit.x,speedUnit.y,speedUnit.w,speedUnit.h],[1064,605,120,37]);
assert.strictEqual(speedUnit.x+speedUnit.w/2,speedBox.x+speedBox.w/2);
assert.deepStrictEqual([gearLabel.x,gearLabel.y,gearLabel.w,gearLabel.h],[650,605,181,37]);
assert.strictEqual(gearLabel.x+gearLabel.w/2,gearBox.x+gearBox.w/2);
assert.strictEqual(gearLabel.text,'{{gearboxCaption}}');assert.strictEqual(gearLabel.font,'ru_unit');assert.strictEqual(gearLabel.spacing,0);
['gear','speed'].forEach(id=>{
    ['x','y','w','h','font','align'].forEach(k=>assert.strictEqual(widget(id+'_ghost')[k],widget(id)[k],id+' ghost '+k));
    assert.strictEqual(widget(id).color,'fg',id+' uses the common white foreground');
});
assert.strictEqual(gearBox.align,'left');assert.strictEqual(speedBox.align,'right');
['gearbox_state','gear_program','clock','clock_ghost','engine_state'].forEach(id=>assert(!widget(id),id+' remains removed from the working display'));
assert.strictEqual((modeRow.y+speedUnit.y+speedUnit.h)/2,(292+682)/2,'whole central group vertically centred in the available area');
const speedFont=require(root+'hud/fonts/'+speedBox.font+'.json'),oldSpeedFont=require(root+'hud/fonts/d7_big.json');
assert.strictEqual(speedBox.font,'d7_gear','use the untouched larger original DSEG atlas');
assert.strictEqual(gearBox.font,speedBox.font,'actual gear and speed use exactly the same original atlas');
assert.strictEqual(speedFont.size,190);assert(speedFont.size>oldSpeedFont.size);
assert.strictEqual(speedBox.h,speedFont.cellHeight);
assert.strictEqual(speedBox.w,3*speedFont.glyphs['8'].advance+1,'three digits fit without clipping or fractional coordinates');
const glyph=speedFont.glyphs['8'],alpha=Buffer.from(speedFont.alpha,'base64');
let inkLeft=glyph.w,inkRight=-1;
for(let y=0;y<glyph.h;y++)for(let x=0;x<glyph.w;x++)if(alpha[(glyph.y+y)*speedFont.width+glyph.x+x]){inkLeft=Math.min(inkLeft,x);inkRight=Math.max(inkRight,x);}
const inkWidth=inkRight-inkLeft+1,nativeGap=glyph.advance-inkWidth;
const gearInkLeft=gearBox.x+glyph.ox+inkLeft,gearInkRight=gearBox.x+glyph.ox+inkRight;
const speedStart=speedBox.x+speedBox.w-3*glyph.advance;
const speedInkLeft=speedStart+glyph.ox+inkLeft,speedInkRight=speedStart+2*glyph.advance+glyph.ox+inkRight;
assert.strictEqual(inkWidth,118);assert.strictEqual(nativeGap,37);
assert.strictEqual(speedInkLeft-gearInkRight-1,3*nativeGap,'gear-to-speed full-digit ink gap is exactly three native digit gaps');
assert.strictEqual((gearInkLeft+speedInkRight)/2,centre,'visible 8 + 888 ink is centred as well as the reserved boxes');
assert.strictEqual(modeRow.font,'ru_status');
assert.strictEqual(require(root+'hud/fonts/ru_status.json').size,28);
assert(modeRow.y+modeRow.h<speedBox.y,'mode and DSC do not overlap speed');
assert(speedUnit.y>=speedBox.y+speedBox.h,'speed units sit below the larger speed');
assert(modeRow.x>widget('fuel_bar').x+widget('fuel_bar').w);
assert(modeRow.x+modeRow.w<widget('oil_bar').x,'central group avoids the side meters');
for(const program of ['D','S','M'])for(let gear=1;gear<=8;gear++)assert.deepStrictEqual(profiles.transmission({selector:'D',gearboxProgram:program,gear}),{program,gear:String(gear)});
['P','R','N'].forEach(selector=>assert.deepStrictEqual(profiles.transmission({selector,gearboxProgram:'S',gear:4}),{program:'',gear:selector},'confirmed P/R/N replaces a retained forward gear in the large readout'));
assert.deepStrictEqual(profiles.transmission({selector:'D',gearboxProgram:null,gear:2,driveMode:'SPORT'}),{program:'-',gear:'2'},'D selector and Sport never imply D or S programme');
[undefined,null,0,9,10,-1,1.5,'2',NaN,Infinity].forEach(gear=>assert.deepStrictEqual(profiles.transmission({selector:'D',gearboxProgram:'M',gear}),{program:'M',gear:'-'}));
assert.deepStrictEqual(profiles.transmission({selector:null,gearboxProgram:'UNKNOWN',gear:null}),{program:'-',gear:'-'});
[['P','S','P'],['R','M','R'],['N','D','N'],['D','S','S'],[null,'S','S'],['D','M','M'],[null,'M','M'],['D',null,'D'],[null,'D','D'],['D','UNKNOWN','D'],[null,null,'-'],[null,'UNKNOWN','-']].forEach(([selector,gearboxProgram,label])=>{
    ['COMFORT','SPORT','SPORT+','SPORT INDIVIDUAL','ECO PRO'].forEach(driveMode=>{
        const state={selector,gearboxProgram,driveMode,gear:4,speed:88,dsc:'ON'},before=JSON.stringify(state);
        assert.strictEqual(profiles.gearboxLabel(state),label,'caption reads independent selector/programme for '+driveMode);
        assert.strictEqual(JSON.stringify(state),before,'presentation does not modify vehicle observations');
    });
});
const baseline = config.defaults('car'); baseline.profiles.enabled=false;
assert.strictEqual(profiles.layout(original,baseline), original);
assert.strictEqual(profiles.choose(c,null,'auto'),'neutral');
assert.strictEqual(profiles.choose(c,'sport','auto'),'sport');
c.profiles.followVehicleMode=false;
assert.strictEqual(profiles.choose(c,'sport','auto'),'neutral');
assert.strictEqual(profiles.choose(c,null,'eco'),'eco');
assert.deepStrictEqual(profiles.NAMES,['comfort','sport','eco']);
for(const lang of ['ru','en']) for(const units of ['metric','us']) {
    const cfg=config.defaults('car'); cfg.language=lang;cfg.units=units;
    const f=require(root+'hud/fonts/'+(lang==='ru'?'ru_head':'head')+'.json');
    for(const id of Object.keys(profiles.CATALOG)) {
        const s=profiles.sensor(id,cfg),text=s.head+' '+s.unit(units==='us');
        let width=0;
        for(const ch of text) { assert(f.glyphs[ch],id+' missing glyph '+ch);width+=f.glyphs[ch].advance; }
        assert(width+text.length-1<=240,id+' heading overflows: '+text);
    }
}
const f=require(root+'hud/fonts/'+modeRow.font+'.json');
for(const [text,width] of [['SPORT+ / TRACTION',modeRow.w],['SPORT+ / DSC OFF',modeRow.w],['ECO PRO INDIVIDUAL / DSC ВМЕШАТ.',modeRow.w],['COMFORT INDIVIDUAL / DSC ОШИБКА',modeRow.w]]) {
    let measured=0;
    for(const ch of text){assert(f.glyphs[ch],text+' missing '+ch);measured+=f.glyphs[ch].advance;}
    assert(measured<=width,text+' clipped');
}
const captionFont=require(root+'hud/fonts/'+gearLabel.font+'.json');
for(const prefix of ['КПП: ','GEARBOX: '])for(const label of ['P','N','D','S','M','R','-']){
    let width=0;for(const ch of prefix+label){assert(captionFont.glyphs[ch],'caption missing glyph '+ch);width+=captionFont.glyphs[ch].advance;}
    assert(width<=gearLabel.w,prefix+label+' fits the unchanged caption box');
}
assert.strictEqual(profiles.format('power',100,config.defaults('car')),'100');
assert.strictEqual(profiles.format('avgConsumption',null,config.defaults('car')),'--');
const us=config.defaults('car');us.units='us';us.displayUnits.consumption='mpg';
assert.strictEqual(profiles.format('consumption',0,us),'--','zero consumption cannot become infinite mpg');
assert.strictEqual(profiles.main('eco',0),'fuelFlow');
assert.strictEqual(profiles.main('eco',null),'consumption');
const theme=profiles.theme(require('../shared/hud_themes').THEMES.retro,'sport',c);
assert.notDeepStrictEqual(theme.hot.slice(0,3),theme.fg.slice(0,3),'Sport is not the warning colour');
['comfort','sport','eco','neutral'].forEach(name=>{
    const palette=profiles.theme(require('../shared/hud_themes').THEMES.retro,name,c);
    assert.deepStrictEqual(palette.fg,[190,198,204,255],'common Adaptive white');
    assert.deepStrictEqual(palette.bar.low,[190,198,204]);
    assert.deepStrictEqual(palette.bar.mid,[255,224,64]);
    assert.deepStrictEqual(palette.bar.high,[255,59,48]);
});
const old=config.defaults('car');old.schemaVersion=1;delete old.profiles;delete old.widgets;delete old.displayUnits;delete old.startup.onEngineStart;old.enabled=true;old.retro.slots['1']='coolant';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retro-migrate-'));
try {
 const file=path.join(dir,'manuk_retro_cluster.json');fs.writeFileSync(file,JSON.stringify(old));
 const store=new config.ConfigStore(dir,'car');
 assert.strictEqual(store.current.schemaVersion,7);assert.strictEqual(store.current.enabled,true);
 assert.strictEqual(store.current.retro.slots['1'],'coolant');
 const v2=config.defaults('car');v2.schemaVersion=2;delete v2.widgets;delete v2.displayUnits;delete v2.startup.onEngineStart;delete v2.profiles.gaugeMax;v2.profiles.ecoMaxConsumption=42;v2.profiles.slots={comfort:{'1':'oil','2':'rpm'},sport:{'1':'power','2':'torque'},eco:{'1':'avgConsumption','2':'tripFuel'}};v2.profiles.aux={comfort:'tripDistance',sport:'gLat',eco:'rpm'};v2.profiles.accents.sport='#FF0000';
 const migrated=config.validate(v2);assert.strictEqual(migrated.schemaVersion,7);assert(!migrated.profiles.slots);assert(!migrated.profiles.aux);assert(!migrated.profiles.ecoMaxConsumption);assert.deepStrictEqual(migrated.profiles.gaugeMax,{consumption:42,range:1000,fuelFlow:10});assert.strictEqual(migrated.profiles.accents.sport,'#FF0000');assert.strictEqual(store.current.retro.tankLitres,null);
 assert.strictEqual(JSON.parse(fs.readFileSync(file,'utf8')).schemaVersion,7);
 const before=fs.readFileSync(file,'utf8');const bad=config.defaults('car');bad.profiles.forceProfile='sport';
 assert.throws(()=>store.save(bad),/unknown key/);assert.strictEqual(fs.readFileSync(file,'utf8'),before);
 bad.profiles=config.defaults('car').profiles;bad.profiles.accents.sport='red;';assert.throws(()=>store.save(bad),/invalid string/);
 const broken=config.defaults('car');delete broken.profiles;assert.throws(()=>config.validate(broken),/required/);
 const invalidMax=config.defaults('car');invalidMax.profiles.gaugeMax.range=0;assert.throws(()=>config.validate(invalidMax),/range|allowed/);
 store.stop();
}finally{fs.readdirSync(dir).forEach(n=>fs.unlinkSync(path.join(dir,n)));fs.rmdirSync(dir);}
console.log('PASS profiles: immutable original, six meters and 40 equal RPM cells with red-zone phases, original DSEG 1..8/P/R/N gear, exact three-gap spacing, centred gear/speed and independent status row, honest gearbox caption and schema-7 migration');

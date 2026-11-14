'use strict';
// Integration test against the real staged app and local renderer, never a vehicle.
const assert = require('assert'), fs = require('fs'), path = require('path');
const base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8078);
const fixture = require('./profiles-fixture.json').signals;
const groups = require('./profile-signals').GROUPS;
const scene = require('./scene-check');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const get = async () => (await fetch(base + '/snapshot')).json();
async function post(url, data) { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }); assert(r.ok, url + ': ' + r.status + ' ' + await r.text()); }
async function wait(fn, label) { const end = Date.now() + 15000; while (Date.now() < end) { const s = await get(); if (fn(s)) return s; await pause(100); } throw new Error('Timed out: ' + label); }
const visual = s => s.values && s.values.visual;
const refs = s => s.layers.map(l => [l.key, l.conn, l.ref, l.x, l.y, l.w, l.h]);
async function input(overrides) { await post('/drive', { value: null }); await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, overrides || {}) }); }
(async () => {
    const checks = [];
    await Promise.all(Object.keys(groups).map(source => post('/source', { source, available: true })));
    await post('/renderer', { online: true }); await post('/enabled', { value: true }); await input();
    let config = (await wait(s => s.values && s.values.configuration, 'configuration')).values.configuration;
    config = JSON.parse(JSON.stringify(config)); config.profiles.enabled = true; config.profiles.followVehicleMode = true;
    await post('/configuration', { configuration: config });
    await wait(s => visual(s) && visual(s).profile === 'comfort', 'comfort');
    const initial = await scene.waitForScene(base), originalRefs = refs(initial), baseline = { speed: 88, gear: 4, gearboxProgram: 'D', dsc: 'ON' };
    const gauges = initial.layers.filter(l => l.uniforms && l.uniforms.u_segs);
    assert.equal(gauges.length, 6, 'Exactly five side gauges and one tachometer');
    assert.equal(gauges.filter(l => l.uniforms.u_segs.v[0] === 15).length, 5, 'Five vertical gauges have fifteen segments');
    const tachometers = gauges.filter(l => l.uniforms.u_segs.v[0] === 80);
    assert.equal(tachometers.length, 1, 'One tachometer has eighty equal segments');
    const tachometer = tachometers[0];
    checks.push('Five vertical gauge shaders have fifteen segments; the common tachometer has eighty equal 100-RPM segments');
    for (const item of [[1, 'sport', 'SPORT'], [7, 'eco', 'ECO PRO'], [2, 'sport', 'SPORT+'], [3, 'sport', 'SPORT INDIVIDUAL'], [4, 'comfort', 'COMFORT'], [99, 'neutral', null]]) {
        await post('/drive', { value: item[0] });
        const s = await wait(s => visual(s) && visual(s).profile === item[1] && visual(s).driveMode === item[2], item[2] || 'unknown mode');
        Object.keys(baseline).forEach(k => assert.equal(visual(s)[k], baseline[k], 'mode changed ' + k));
        assert.equal(s.values.values.consumption, 7.6); assert.equal(s.values.values.range, 450);
        assert.deepStrictEqual(refs(s), originalRefs, 'mode switch rebuilt/repositioned the scene');
        const currentTachometer = s.layers.find(l => l.key === tachometer.key);
        assert.deepStrictEqual(currentTachometer.uniforms.u_segs.v, [80]);
        assert.equal(currentTachometer.uniforms.u_value.v[0], 3200 / 8000, 'All profiles retain the same RPM scale and completed-cell boundary');
        scene.budget(s);
    }
    checks.push('Comfort/Sport/Eco, Sport+, Individual and unknown mode reuse identical layer references and geometry; speed/gear/program/DSC stay independent');
    await input({ driveModeRaw: 4, gearboxProgram: 'S' });
    await wait(s => visual(s) && visual(s).driveMode === 'COMFORT' && visual(s).gearboxProgram === 'S' && visual(s).dsc === 'ON', 'Comfort + S + DSC ON');
    await input({ driveModeRaw: 3, engineProfile: null });
    await wait(s => visual(s) && visual(s).driveMode === 'SPORT INDIVIDUAL' && visual(s).engineProfile === null, 'Individual without engine profile');
    await input({ driveModeRaw: 7, consumption: null, fuelFlow: null, dsc: null });
    await wait(s => visual(s) && visual(s).profile === 'eco' && visual(s).dsc === null && s.values.values.consumption === null, 'Eco unavailable consumption and unknown DSC');
    checks.push('Comfort + S + DSC ON; Sport Individual with unknown engine; Eco Pro with unavailable consumption; unknown DSC');
    for (const selector of ['P', 'R', 'N']) {
        await input({ speed: 0, gear: null, selector });
        await wait(s => visual(s) && visual(s).selector === selector, selector + ' without forward gear');
    }
    checks.push('P/R/N selectors do not require or invent a forward gear');
    await input({ pFL: null, tFL: null });
    await wait(s => s.values && s.values.values.pFL === null && s.values.values.tFL === null && Math.abs(s.values.values.pFR - 2.3) < 1e-9, 'one missing wheel');
    checks.push('One missing TPMS wheel does not erase the other wheels or substitute a neighbour');
    await input({ forceProfile: 'sport' });
    const forced = await wait(s => visual(s) && visual(s).profile === 'sport' && visual(s).driveMode === 'COMFORT', 'bench forced presentation');
    Object.keys(baseline).forEach(k => assert.equal(visual(forced)[k], baseline[k]));
    checks.push('Bench-only forced profile preserves actual drive-mode label and all independent states');
    await input();
    const active = await wait(s => visual(s) && s.layers.length === initial.layers.length, 'active before critical loss');
    await post('/source', { source: 'speed', available: false }); await wait(s => s.layers.length === 0, 'critical speed release');
    await post('/source', { source: 'speed', available: true }); await wait(s => s.layers.length === initial.layers.length, 'speed recovery');
    await input({ condition: 5 }); await wait(s => s.layers.length === 0, 'sleep release');
    await input(); await wait(s => s.layers.length === initial.layers.length && visual(s) && visual(s).driveMode === 'COMFORT', 'fresh wake data');
    checks.push('Critical-source loss and sleep release own layers; fresh data restores them');
    await post('/renderer', { online: false }); await wait(s => s.layers.length === 0, 'renderer disconnect');
    await post('/renderer', { online: true }); await wait(s => s.layers.length === initial.layers.length, 'renderer reconnect');
    const restored = await get(); assert.equal(restored.values.diagnostics.subscriptions, active.values.diagnostics.subscriptions); assert.equal(restored.values.diagnostics.intervals, active.values.diagnostics.intervals);
    checks.push('Renderer reconnection restores the scene without accumulating subscriptions/timers');
    await post('/restart');
    const restarted = await wait(s => visual(s) && s.values.diagnostics.pid !== restored.values.diagnostics.pid && s.layers.length === initial.layers.length, 'restart');
    assert.deepStrictEqual(restarted.values.configuration, config);
    checks.push('Validated profile configuration persists across process restart');
    const complete = await scene.waitForScene(base);
    const report = Object.assign({ scope: 'Local synthetic data only; no BMW connection or vehicle compatibility claim', checks, diagnostics: complete.values.diagnostics }, scene.budget(complete));
    fs.writeFileSync(path.join(__dirname, '../artifacts/profiles-verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

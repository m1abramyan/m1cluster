'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const probe = require('../tools/inspect-signals');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-inspect-test-'));
const runtime = path.join(dir, 'javascript');
fs.mkdirSync(runtime); fs.mkdirSync(path.join(runtime, 'kit'));
const pkgFile = path.join(dir, 'package.json');
const output = path.join(dir, 'report.json');
const writePkg = (extra) => fs.writeFileSync(pkgFile, JSON.stringify(Object.assign({ name: 'manuk_retro_cluster' }, extra || {})));
writePkg();
fs.writeFileSync(path.join(runtime, 'kit/signals.js'), 'module.exports={hasNative:function(){return false;}};');
const opts = { runtime: runtime, output: output, seconds: 1 };
assert.throws(() => probe.loadRuntime(opts), /Native SOME.IP module is unavailable/);
writePkg({ mguBenchOnly: true });
assert.throws(() => probe.loadRuntime(opts), /Bench\/stub runtime refused/);
writePkg({ name: 'cluster_themes' });
assert.throws(() => probe.loadRuntime(opts), /different application/);
writePkg();
[0, 121, 1.5, NaN].forEach((v) => assert.throws(() => probe.parse(['--runtime', runtime, '--output', output, '--seconds', String(v)]), /integer from 1 to 120/));
assert.strictEqual(probe.parse(['--runtime', runtime, '--output', output]).tank_litres, null);
[-1, 0, 201, NaN, Infinity, 'unknown', '60l'].forEach((v) => assert.throws(() => probe.parse(['--runtime', runtime, '--output', output, '--tank-litres', String(v)]), /confirmed number from 1 to 200/));
assert.throws(() => probe.parse(['--runtime', runtime, '--output', output, '--tank-litres']), /confirmed number/);
[1, 62.5, 200].forEach((v) => assert.strictEqual(probe.parse(['--runtime', runtime, '--output', output, '--tank-litres', String(v)]).tank_litres, v));
const tankRule = require('../apps/manuk_retro_cluster/config').schema.properties.retro.properties.tankLitres.anyOf.find(r => r.type === 'number');
assert.strictEqual(tankRule.minimum, 1); assert.strictEqual(tankRule.maximum, 200, 'probe range follows the configuration schema');
assert.throws(() => probe.parse(['--runtime', '.', '--output', output]), /absolute/);
const result = cp.spawnSync(process.execPath, ['tools/inspect-signals.js', '--runtime', runtime, '--output', output, '--seconds', '1'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 4000 });
assert.strictEqual(result.status, 1);
assert(/Native SOME.IP/.test(result.stderr));
assert(!fs.existsSync(output), 'No fabricated report on native failure');
const diag = {
    providers: { speed: { interface: 'de.bmw.infotainment.vehicle.Vehicle2', available: true, epoch: 2, password: 'private' } },
    readings: {
        speed: { value: 0, unit: 'km/h', quality: 'valid', source: 'Vehicle2.statusCarSpeed2', raw: 0, vin: 'private' },
        driveMode: { value: null, raw: 'WBAX1234567890123', quality: 'invalid' },
        dsc: { value: null, quality: 'unverified', reason: 'qualifier semantics are not decoded; no ON/OFF inference', raw: { qualifierFunctionFDR: 0, qualifierFunctionASC: 2, qualifierFunctionABS: 3, VIN: 'private' } },
        boost: { value: null, quality: 'unverified', raw: 80, candidate: 0.8, reason: 'upstream marks boost scaling q:true; requires vehicle comparison' },
        fuelPct: { value: null, unit: '%', quality: 'unavailable', reason: 'tankLitres is not confirmed; fuelL is available in litres' },
        secret: { value: 'private' }
    },
    VIN: 'private'
};
const clean = probe.snapshot({ diagnostics: () => diag });
assert.strictEqual(clean.readings.speed.value, 0);
assert.deepStrictEqual(clean.readings.dsc.raw, { qualifierFunctionFDR: 0, qualifierFunctionASC: 2, qualifierFunctionABS: 3 });
assert.strictEqual(clean.readings.dsc.reason, diag.readings.dsc.reason);
assert.strictEqual(clean.readings.boost.reason, diag.readings.boost.reason);
assert.strictEqual(clean.readings.boost.value, null); assert.strictEqual(clean.readings.boost.candidate, 0.8);
assert.strictEqual(clean.readings.driveMode.raw, '[omitted]');
assert(!JSON.stringify(clean).includes('private'));
const defaultCapacity = probe.snapshot({ diagnostics: () => diag, probeCapacity: { litres: null, supplied: false } });
assert(/probe uses car defaults/.test(defaultCapacity.readings.fuelPct.reason));
const suppliedCapacity = probe.snapshot({ diagnostics: () => diag, probeCapacity: { litres: 62.5, supplied: true } });
assert(!/probe uses car defaults/.test(suppliedCapacity.readings.fuelPct.reason));
let stopped = 0, started = 0, ticks = 0;
const source = { start: () => { started++; return new Promise(() => {}); }, stop: () => { stopped++; },
    tick: () => { ticks++; }, diagnostics: () => diag };
(async () => {
    const t = Date.now();
    source.probeCapacity = { litres: 62.5, supplied: true };
    const report = await probe.collect(source, 1100);
    assert(Date.now() - t < 2200, 'Pending subscription cannot prevent deadline');
    assert.strictEqual(started, 1); assert.strictEqual(stopped, 1); assert.strictEqual(ticks, 1);
    assert.strictEqual(report.reason, 'deadline'); assert.strictEqual(report.readOnly, true);
    assert.deepStrictEqual(report.tankCapacity, { litres: 62.5, supplied: true, origin: 'explicit --tank-litres', confirmation: 'not-verified-by-probe' });
    assert.strictEqual(report.samples.length, 3);
    assert(report.samples.every((s) => s.data.readings.dsc.value === null), 'Raw DSC remains unclassified');
    probe.save(output, report);
    assert.strictEqual(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => probe.save(output, report), /EEXIST/);
    assert(fs.statSync(output).size < probe.MAX_BYTES);
    const script = fs.readFileSync(path.join(__dirname, '../tools/inspect-signals.js'), 'utf8');
    assert(!/require\([^\n]*(mgu\.js|retro_runtime|cluster_render_client|main\.js)/.test(script), 'Probe never loads graphics/SDK entry point');
    require('acorn').parse(script, { ecmaVersion: 2017, sourceType: 'script', allowHashBang: true });
    // Explicit capacity is passed to this temporary source only. The inspector
    // never instantiates ConfigStore or reads/writes the installed user's JSON.
    require(path.join(runtime, 'kit/signals.js')).hasNative = () => true;
    fs.writeFileSync(path.join(runtime, 'config.js'), 'module.exports={defaults:function(){return {retro:{tankLitres:null},safety:{}};}};');
    fs.writeFileSync(path.join(runtime, 'retro_source.js'), 'function Source(ctx,cfg){this.testConfig=cfg;};Source.prototype.diagnostics=function(){return {};};module.exports=Source;');
    const probeDefault = probe.loadRuntime(opts), probeSupplied = probe.loadRuntime(Object.assign({}, opts, { tank_litres: 62.5 }));
    assert.strictEqual(probeDefault.testConfig().retro.tankLitres, null);
    assert.strictEqual(probeDefault.probeCapacity.supplied, false);
    assert.strictEqual(probeSupplied.testConfig().retro.tankLitres, 62.5);
    assert.strictEqual(probeSupplied.probeCapacity.supplied, true);
    assert.strictEqual(probeDefault.testConfig().retro.tankLitres, null, 'one inspection cannot mutate the next/default capacity');
    assert.throws(() => probe.loadRuntime(Object.assign({}, opts, { tank_litres: 500 })), /confirmed number/);
    assert(!fs.existsSync(path.join(dir, 'data')), 'no persistent configuration directory created');
    // Isolated fixture: a blocked native entry cannot keep even this probe alive indefinitely.
    fs.writeFileSync(path.join(runtime, 'kit/signals.js'), 'module.exports={hasNative:function(){return true;}};');
    fs.writeFileSync(path.join(runtime, 'config.js'), 'module.exports={defaults:function(){return {safety:{}};}};');
    fs.writeFileSync(path.join(runtime, 'retro_source.js'), 'function Source(){};Source.prototype.diagnostics=function(){return {};};Source.prototype.start=function(){while(true){}};module.exports=Source;');
    const blockedOutput = path.join(dir, 'blocked.json'), began = Date.now();
    const blocked = cp.spawnSync(process.execPath, ['tools/inspect-signals.js', '--runtime', runtime, '--output', blockedOutput, '--seconds', '1'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 6000 });
    assert.strictEqual(blocked.status, 1); assert(!blocked.error, 'Own supervisor, not test timeout, stops blocked child');
    assert(Date.now() - began < 5000); assert(!fs.existsSync(blockedOutput));
    console.log('PASS bounded read-only signal probe: pending/blocked deadline, native/stub refusal, explicit capacity without persistence, allowlisted raw/reasons, no DSC inference, ES2017');
})().catch((e) => { console.error(e.stack); process.exitCode = 1; }).then(() => {
    ['config.js', 'retro_source.js'].forEach((n) => { const p = path.join(runtime, n); if (fs.existsSync(p)) fs.unlinkSync(p); });
    fs.unlinkSync(path.join(runtime, 'kit/signals.js')); fs.rmdirSync(path.join(runtime, 'kit')); fs.rmdirSync(runtime);
    fs.unlinkSync(pkgFile); if (fs.existsSync(output)) fs.unlinkSync(output); fs.rmdirSync(dir);
});

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
        dsc: { value: null, quality: 'unverified', raw: { qualifierFunctionFDR: 0, qualifierFunctionASC: 2, qualifierFunctionABS: 3, VIN: 'private' } },
        secret: { value: 'private' }
    },
    VIN: 'private'
};
const clean = probe.snapshot({ diagnostics: () => diag });
assert.strictEqual(clean.readings.speed.value, 0);
assert.deepStrictEqual(clean.readings.dsc.raw, { qualifierFunctionFDR: 0, qualifierFunctionASC: 2, qualifierFunctionABS: 3 });
assert.strictEqual(clean.readings.driveMode.raw, '[omitted]');
assert(!JSON.stringify(clean).includes('private'));
let stopped = 0, started = 0, ticks = 0;
const source = { start: () => { started++; return new Promise(() => {}); }, stop: () => { stopped++; },
    tick: () => { ticks++; }, diagnostics: () => diag };
(async () => {
    const t = Date.now();
    const report = await probe.collect(source, 1100);
    assert(Date.now() - t < 2200, 'Pending subscription cannot prevent deadline');
    assert.strictEqual(started, 1); assert.strictEqual(stopped, 1); assert.strictEqual(ticks, 1);
    assert.strictEqual(report.reason, 'deadline'); assert.strictEqual(report.readOnly, true);
    assert.strictEqual(report.samples.length, 3);
    assert(report.samples.every((s) => s.data.readings.dsc.value === null), 'Raw DSC remains unclassified');
    probe.save(output, report);
    assert.strictEqual(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => probe.save(output, report), /EEXIST/);
    assert(fs.statSync(output).size < probe.MAX_BYTES);
    const script = fs.readFileSync(path.join(__dirname, '../tools/inspect-signals.js'), 'utf8');
    assert(!/require\([^\n]*(mgu\.js|retro_runtime|cluster_render_client|main\.js)/.test(script), 'Probe never loads graphics/SDK entry point');
    require('acorn').parse(script, { ecmaVersion: 2017, sourceType: 'script', allowHashBang: true });
    // Isolated fixture: a blocked native entry cannot keep even this probe alive indefinitely.
    fs.writeFileSync(path.join(runtime, 'kit/signals.js'), 'module.exports={hasNative:function(){return true;}};');
    fs.writeFileSync(path.join(runtime, 'config.js'), 'module.exports={defaults:function(){return {safety:{}};}};');
    fs.writeFileSync(path.join(runtime, 'retro_source.js'), 'function Source(){};Source.prototype.diagnostics=function(){return {};};Source.prototype.start=function(){while(true){}};module.exports=Source;');
    const blockedOutput = path.join(dir, 'blocked.json'), began = Date.now();
    const blocked = cp.spawnSync(process.execPath, ['tools/inspect-signals.js', '--runtime', runtime, '--output', blockedOutput, '--seconds', '1'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 6000 });
    assert.strictEqual(blocked.status, 1); assert(!blocked.error, 'Own supervisor, not test timeout, stops blocked child');
    assert(Date.now() - began < 5000); assert(!fs.existsSync(blockedOutput));
    console.log('PASS bounded read-only signal probe: pending/blocked deadline, native/stub refusal, app identity, allowlisted report, no DSC inference, ES2017');
})().catch((e) => { console.error(e.stack); process.exitCode = 1; }).then(() => {
    ['config.js', 'retro_source.js'].forEach((n) => { const p = path.join(runtime, n); if (fs.existsSync(p)) fs.unlinkSync(p); });
    fs.unlinkSync(path.join(runtime, 'kit/signals.js')); fs.rmdirSync(path.join(runtime, 'kit')); fs.rmdirSync(runtime);
    fs.unlinkSync(pkgFile); if (fs.existsSync(output)) fs.unlinkSync(output); fs.rmdirSync(dir);
});

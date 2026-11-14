'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const tool = require('../tools/find-rpm-limit');
const root = path.resolve(__dirname, '..');
// Entirely synthetic names and schemas; these are NOT discovered BMW fields.
const db = {
    interfaces: { 'example.synthetic.Engine': { fields: {
        current: { dataRef: 'Current', getter: { id: 1 }, notifier: {} },
        limits: { dataRef: 'Derived', getter: { id: 2 }, notifier: {} },
        statusEngineWarmup: { dataRef: 'WarmEnum', notifier: {} },
        availableEnginePower: { dataRef: 'Alias', getter: { id: 3 } },
        unused: { dataRef: 'Cycle' }
    } } },
    datatypes: {
        U16: { type: 'uint16' },
        Current: { type: 'struct', members: [{ name: 'actualValueRPMEngineCrankshaft', dataRef: 'U16' }] },
        Base: { type: 'struct', members: [{ name: 'maximumPermittedRPM', dataRef: 'U16' }] },
        Derived: { type: 'struct', extends: 'Base', members: [{ name: 'detail', dataRef: 'Array' }] },
        Array: { type: 'array', elementDataRef: 'Inner' },
        Inner: { type: 'struct', members: [{ name: 'availableEngineSpeedLimit', dataRef: 'Missing' }] },
        Alias: { type: 'typedef', baseType: 'U16' },
        WarmEnum: { type: 'enum', items: { privateSecret: 'do-not-print' }, value: 'WBAX1234567890123' },
        Cycle: { type: 'struct', extends: 'Cycle', members: [] }
    },
    VIN: 'WBAX1234567890123', password: 'do-not-print'
};
const report = tool.scan(db);
assert.strictEqual(report.evidence, 'metadata-only');
assert.strictEqual(report.inspectedFields, 5);
assert.strictEqual(report.cyclicTypes, 1);
assert.strictEqual(report.unresolvedTypes, 1);
assert.strictEqual(report.incomplete, true);
assert(!report.candidates.some((c) => c.field === 'current'), 'Current RPM is not presented as a limit');
const inherited = report.candidates.filter((c) => c.memberPath[0] === 'maximumPermittedRPM')[0];
assert(inherited); assert.strictEqual(inherited.type, 'uint16');
assert.strictEqual(inherited.getter, true); assert.strictEqual(inherited.notifier, true);
assert.strictEqual(inherited.metadataPointer, '/datatypes/Base/members/0');
const nested = report.candidates.filter((c) => c.memberPath.join('.') === 'detail.availableEngineSpeedLimit')[0];
assert(nested); assert.strictEqual(nested.type, null); assert.strictEqual(nested.dataRef, 'Missing');
const power = report.candidates.filter((c) => c.kind === 'power-torque-limit')[0];
assert(power); assert.strictEqual(power.notifier, false);
assert(report.candidates.some((c) => c.kind === 'warmup-state'));
report.candidates.forEach((c) => {
    assert.strictEqual(c.unit, null); assert.strictEqual(c.scale, null);
    assert.strictEqual(c.invalidValues, null); assert.strictEqual(c.updateFrequency, null);
});
assert(!/do-not-print|WBAX1234567890123|privateSecret/.test(JSON.stringify(report)));
assert.deepStrictEqual(tool.scan({ interfaces: {}, datatypes: {} }).candidates, []);
assert.throws(() => tool.scan({ fields: {} }), /master JSON catalog/);
const many = { interfaces: { Synthetic: { fields: {} } }, datatypes: { U16: { type: 'uint16' } } };
for (let i = 0; i <= tool.MAX_RESULTS; i++) many.interfaces.Synthetic.fields['maximumRPM' + i] = { dataRef: 'U16' };
assert.throws(() => tool.scan(many), /Candidate limit/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-catalog-test-'));
const file = path.join(dir, 'synthetic.json');
const exec = (args) => cp.spawnSync(process.execPath, ['tools/find-rpm-limit.js'].concat(args), { cwd: root, encoding: 'utf8', timeout: 5000 });
try {
    fs.writeFileSync(file, JSON.stringify(db));
    const ok = exec([file]); assert.strictEqual(ok.status, 0); assert.deepStrictEqual(JSON.parse(ok.stdout), report);
    assert.strictEqual(exec([]).status, 2);
    assert.strictEqual(exec(['--help']).status, 0);
    assert.strictEqual(exec(['https://example.invalid/catalog.json']).status, 1);
    assert.strictEqual(exec([dir]).status, 1);
    const missing = exec([path.join(dir, 'private-owner-name.json')]);
    assert.strictEqual(missing.status, 1); assert(!missing.stderr.includes('private-owner-name'));
    fs.writeFileSync(file, 'throw new Error("do-not-print");');
    const bad = exec([file]); assert.strictEqual(bad.status, 1); assert(!bad.stderr.includes('do-not-print')); assert(!bad.stdout);
    fs.writeFileSync(file, '{}'); fs.truncateSync(file, tool.MAX_BYTES + 1);
    const huge = exec([file]); assert.strictEqual(huge.status, 1); assert(/40 MiB/.test(huge.stderr)); assert(!huge.stdout);
    const source = fs.readFileSync(path.join(root, 'tools/find-rpm-limit.js'), 'utf8');
    require('acorn').parse(source, { ecmaVersion: 2017, sourceType: 'script', allowHashBang: true });
    const requires = [];
    source.replace(/require\('([^']+)'\)/g, (all, name) => { requires.push(name); return all; });
    assert.deepStrictEqual(requires, ['fs'], 'No SDK, native, network or child-process dependency');
    console.log('PASS offline RPM catalog scan: schema/type inheritance, unknowns, current-RPM exclusion, metadata-only/privacy, input/output bounds and CLI refusal');
} finally { fs.unlinkSync(file); fs.rmdirSync(dir); }

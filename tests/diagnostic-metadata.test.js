'use strict';
const assert = require('assert');
const fs = require('fs');
const metadata = require('../apps/manuk_retro_cluster/diagnostic_metadata');
// Type names, enum labels and values below are synthetic. No BMW code meaning
// is established by this fixture, even though the real allowlisted fields are used.
const db = { interfaces: {}, datatypes: {
    Scalar: { type: 'uint16' }, Bool: { type: 'boolean' }, Text: { type: 'string' },
    Enum: { type: 'enum', items: { SYNTHETIC_A: 4, SYNTHETIC_B: 7 }, description: 'PRIVATE-DESCRIPTION' },
    Alias: { type: 'typedef', dataRef: 'Enum' }, AliasBase: { type: 'typedef', baseType: 'uint16' },
    Base: { type: 'struct', members: [{ name: 'unit', dataRef: 'Alias' }] },
    Array: { type: 'array', elementDataRef: 'Scalar' },
    Struct: { type: 'struct', extends: 'Base', members: [
        { name: 'consumption', dataRef: 'Scalar' }, { name: 'valid', dataRef: 'Bool' },
        { name: 'alternate', dataRef: 'AliasBase' }, { name: 'unresolved', dataRef: 'Missing' },
        { name: 'text', dataRef: 'Text' }, { name: 'array', dataRef: 'Array' },
        { name: 'vin', dataRef: 'Scalar' }, { name: 'vinNumber', dataRef: 'Scalar' },
        { name: 'password', dataRef: 'Scalar' }, { name: 'serialNumber', dataRef: 'Scalar' },
        { name: 'identifier', dataRef: 'Scalar' }, { name: 'location', dataRef: 'Scalar' },
        { name: 'mileageKilometre', dataRef: 'Scalar' }, { name: '__proto__', dataRef: 'Scalar' }
    ] }
}, password: 'PRIVATE-ROOT', VIN: 'WBAX1234567890123' };
metadata.SCOPES.forEach((scope) => {
    if (!db.interfaces[scope[0]]) db.interfaces[scope[0]] = { fields: {} };
    db.interfaces[scope[0]].fields[scope[1]] = { dataRef: 'Struct', getter: { id: 1 }, notifier: {}, description: 'PRIVATE-FIELD' };
});
db.interfaces['unrelated.SecretInterface'] = { fields: { secret: { dataRef: 'PrivateType' } } };
db.datatypes.PrivateType = { type: 'enum', items: { PRIVATE_ENUM: 42 } };
const report = metadata.scan(db);
assert.strictEqual(report.status, 'available'); assert.strictEqual(report.evidence, 'metadata-only');
assert.strictEqual(report.fields.length, 7); assert.strictEqual(report.incomplete, true);
const first = report.fields[0];
assert.strictEqual(first.getter, true); assert.strictEqual(first.notifier, true);
assert.deepStrictEqual(first.members.find((x) => x.path[0] === 'unit').enum, [{ name: 'SYNTHETIC_A', value: 4 }, { name: 'SYNTHETIC_B', value: 7 }]);
assert.deepStrictEqual(metadata.primitivePaths(report, first.interface, first.field), [['unit'], ['consumption'], ['valid'], ['alternate']]);
assert(!/PRIVATE|WBAX|vinNumber|"vin"|"password"|__proto__/.test(JSON.stringify(report)));
assert(Buffer.byteLength(JSON.stringify(report)) <= metadata.MAX_OUTPUT_BYTES);
assert.deepStrictEqual(metadata.primitivePaths(report, 'unrelated.SecretInterface', 'secret'), []);
assert.strictEqual(metadata.scan({}).status, 'invalid');
assert.strictEqual(metadata.scan({ interfaces: {}, datatypes: {} }).status, 'unavailable');
const cycle = JSON.parse(JSON.stringify(db)); cycle.datatypes.Base.extends = 'Struct';
assert.strictEqual(metadata.scan(cycle).incomplete, true, 'Type cycles terminate without guessed definitions');
const many = JSON.parse(JSON.stringify(db));
many.datatypes.Enum.items = {};
for (let i = 0; i < 129; i++) many.datatypes.Enum.items['SYNTHETIC_' + i] = i;
assert.deepStrictEqual(metadata.scan(many).fields, [], 'No partial enum may be used as a complete decode table');
assert.strictEqual(metadata.scan(many).status, 'limited');
const outputHeavy = JSON.parse(JSON.stringify(db));
outputHeavy.datatypes.Enum.items = {};
for (let i = 0; i < 128; i++) outputHeavy.datatypes.Enum.items['SYNTHETIC_' + 'X'.repeat(120) + i] = i;
const bounded = metadata.scan(outputHeavy);
assert.strictEqual(bounded.status, 'limited');
assert.deepStrictEqual(bounded.fields, []);
assert(Buffer.byteLength(JSON.stringify(bounded)) <= metadata.MAX_OUTPUT_BYTES);
const hugeMember = JSON.parse(JSON.stringify(db));
hugeMember.datatypes.Struct.members = Array.from({ length: 2050 }, (x, i) => ({ name: 'field' + i, dataRef: 'Scalar' }));
assert.strictEqual(metadata.scan(hugeMember).status, 'limited');
const enumPrivate = JSON.parse(JSON.stringify(db));
enumPrivate.datatypes.Enum.items = { SYNTHETIC_A: 4, SecretName: 1, OTHER: 'WBAX1234567890123', HUGE: Infinity };
assert.deepStrictEqual(metadata.scan(enumPrivate).fields[0].members[0].enum, [{ name: 'SYNTHETIC_A', value: 4 }]);

function ioFor(text, options) {
    options = options || {};
    const data = Buffer.from(text); let offset = 0, closed = 0;
    return {
        openSync: (file, flags) => { assert.strictEqual(file, metadata.CATALOG); assert.strictEqual(flags & fs.constants.O_WRONLY, 0); return 9; },
        fstatSync: () => ({ size: options.size === undefined ? data.length : options.size, isFile: () => options.regular !== false }),
        readSync: (fd, buf, start, length) => { assert.strictEqual(fd, 9); const n = Math.min(length, data.length - offset); data.copy(buf, start, offset, offset + n); offset += n; return n; },
        closeSync: (fd) => { assert.strictEqual(fd, 9); closed++; },
        closed: () => closed
    };
}
const validIO = ioFor(JSON.stringify(db));
assert.deepStrictEqual(metadata.read(validIO), report); assert.strictEqual(validIO.closed(), 1);
const missingIO = { openSync: () => { const err = new Error('PRIVATE-ERROR'); err.code = 'ENOENT'; throw err; } };
assert.strictEqual(metadata.read(missingIO).status, 'missing'); assert(!JSON.stringify(metadata.read(missingIO)).includes('PRIVATE'));
['{', 'PRIVATE-CONTENT', '[]'].forEach((text) => {
    const io = ioFor(text); assert.strictEqual(metadata.read(io).status, 'invalid'); assert.strictEqual(io.closed(), 1);
});
[{ regular: false }, { size: 2 }].forEach((options) => {
    const io = ioFor(JSON.stringify(db), options); assert.strictEqual(metadata.read(io).status, 'invalid'); assert.strictEqual(io.closed(), 1);
});
const oversizedIO = ioFor('{}', { size: metadata.MAX_INPUT_BYTES + 1 });
let allocated = 0, reads = 0;
const originalAlloc = Buffer.alloc;
oversizedIO.readSync = () => { reads++; throw new Error('Oversized input must never be read'); };
let oversized;
try {
    Buffer.alloc = function () { allocated++; return originalAlloc.apply(Buffer, arguments); };
    oversized = metadata.read(oversizedIO);
} finally { Buffer.alloc = originalAlloc; }
assert.strictEqual(metadata.MAX_INPUT_BYTES, 8 * 1024 * 1024);
assert.strictEqual(oversized.status, 'limited'); assert.deepStrictEqual(oversized.fields, []);
assert.strictEqual(reads, 0); assert.strictEqual(allocated, 0); assert.strictEqual(oversizedIO.closed(), 1);
assert(/8 MiB/.test(oversized.reason));
const code = fs.readFileSync(require.resolve('../apps/manuk_retro_cluster/diagnostic_metadata'), 'utf8');
require('acorn').parse(code, { ecmaVersion: 2017 });
const dependencies = [];
code.replace(/require\('([^']+)'\)/g, (all, name) => { dependencies.push(name); return all; });
assert.deepStrictEqual(dependencies, ['fs'], 'Metadata reader has no SDK/native/network/process code');
assert(!/writeFile|writeSync|createWriteStream|setValue|callMethod|buildProxy/.test(code));
console.log('PASS scoped metadata: seven fields, inherited typedef/enum members, privacy, safe primitive candidates, bounded failures, fixed-path fs-only and Node 8 syntax');

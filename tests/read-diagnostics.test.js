'use strict';
const assert = require('assert'), crypto = require('crypto'), zlib = require('zlib');
const reader = require('../tools/read-diagnostics');
const Diagnostics = require('../apps/manuk_retro_cluster/diagnostics');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const report = { app: 'manuk_retro_cluster', schema: 'm1cluster-diag-1', appVersion: '0.3.2', sessionId: 'abcdef123456',
    environment: 'bench', simulation: true, readOnly: true, rawOnly: true, state: 'complete', reason: 'duration-complete',
    metadata: { status: 'available', evidence: 'synthetic-fixture', fields: [{ members: [{ path: ['unit'], enum: [{ name: 'TEST_ONLY', value: 42 }] }] }] },
    sources: { current: { raw: { consumption: 123 }, observations: 3 } }, samples: [] };
// Nonrepeating samples force multiple pages, proving collection and ordering.
for (let i = 0; i < 200; i++) report.samples.push({ elapsedMs: i * 100, raw: crypto.createHash('sha256').update(String(i)).digest('hex') });
function envelope(text) {
    const encoded = zlib.gzipSync(Buffer.from(text)).toString('base64'), chunks = encoded.match(/.{1,600}/g);
    const sha = crypto.createHash('sha256').update(text).digest('hex');
    return chunks.map((chunk, i) => JSON.stringify({ schema: 'm1cluster-diag-1', encoding: 'gzip+base64', appVersion: '0.3.2',
        sessionId: 'abcdef123456', environment: 'bench', sha256: sha, part: i + 1, total: chunks.length, chunk }));
}
(async () => {
    const pages = Diagnostics.qrPages(report);
    assert(pages.length > 1); assert(pages.length <= 64);
    assert(pages.every((p) => Buffer.byteLength(p) <= 900));
    assert.deepStrictEqual(await reader.decode(pages.slice().reverse()), report, 'Complete raw samples and enum metadata survive the real QR serializer');
    assert.deepStrictEqual(await reader.decode([JSON.stringify(pages.map(JSON.parse))]), report);
    assert.deepStrictEqual(await reader.decode([JSON.stringify(pages)]), report);
    await assert.rejects(reader.decode(pages.slice(1)), /Missing QR pages/);
    await assert.rejects(reader.decode(pages.concat(pages[0])), /Duplicate|Too many/);
    const mixed = pages.slice(); const changed = JSON.parse(mixed[0]); changed.sessionId = '000000000000'; mixed[0] = JSON.stringify(changed);
    await assert.rejects(reader.decode(mixed), /different reports/);
    const checksum = pages.map((p) => { const q = JSON.parse(p); q.sha256 = '0'.repeat(64); return JSON.stringify(q); });
    await assert.rejects(reader.decode(checksum), /checksum mismatch/);
    const spoofed = JSON.parse(JSON.stringify(report)); spoofed.environment = 'car';
    await assert.rejects(reader.decode(envelope(JSON.stringify(spoofed))), /metadata disagree/);
    await assert.rejects(reader.decode(envelope(' '.repeat(reader.MAX_BYTES + 1))), /exceeds the limit/, 'Bound decompression before parsing a malicious QR payload');
    await assert.rejects(reader.decode(['{"schema":"unrelated"}']), /Invalid diagnostic/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-qr-import-'));
    const input = path.join(dir, 'qr.txt'), output = path.join(dir, 'report.json');
    fs.writeFileSync(input, JSON.stringify(pages));
    const args = [path.resolve(__dirname, '../tools/read-diagnostics.js'), input, '--output', output];
    const imported = cp.spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 4000 });
    assert.strictEqual(imported.status, 0, imported.stderr);
    assert.strictEqual(fs.statSync(output).mode & 0o777, 0o600);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);
    const original = fs.readFileSync(output);
    assert.strictEqual(cp.spawnSync(process.execPath, args, { timeout: 4000 }).status, 1, 'CLI refuses to overwrite a private report');
    assert(fs.readFileSync(output).equals(original));
    console.log('PASS QR offline import: complete metadata/raw roundtrip, reordering, missing/duplicate/mixed pages, checksum, simulation label, bounded decompression');
})().catch((e) => { console.error(e); process.exitCode = 1; });

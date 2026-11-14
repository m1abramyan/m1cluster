'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const lock = require('../UPSTREAM.lock.json');
Object.keys(lock.visualAssets).forEach((rel) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
    assert.strictEqual(hash, lock.visualAssets[rel], 'Original visual asset changed: ' + rel);
});
const app = require('../apps/manuk_retro_cluster/app.json');
assert.strictEqual(app.id, 'manuk_retro_cluster');
assert.strictEqual(app.mguAppStartType, 'manually');
assert.deepStrictEqual(app.screens.map((s) => s.name), ['MAIN', 'LANGUAGE', 'UNITS', 'DIAGNOSTICS', 'DIAGNOSTIC_QR']);
assert.deepStrictEqual(app.settings, []);
assert(!Object.keys(app.signals).some((k) => /Tasu/.test(k)));
Object.keys(app.signals).forEach((iface) => Object.keys(app.signals[iface]).forEach((f) => {
    assert(!/_methods|_broadcasts/.test(f));
    assert(!/w/.test(app.signals[iface][f]), 'Vehicle write permission: ' + iface + '.' + f);
}));
const dir = path.join(root, 'apps/manuk_retro_cluster/hud/layouts');
assert.deepStrictEqual(fs.readdirSync(dir), ['retro80s.json']);
const layout = require(path.join(dir, 'retro80s.json'));
assert(!layout.widgets.some((w) => /BMW|540i|G30|2022|Demo|Prototype|Retro Drive|Retro Cluster/i.test(w.text || '')));
assert(layout.widgets.some((w) => w.text === '{{slot:1}}'));
assert(layout.widgets.some((w) => w.text === '{{slot:2}}'));
console.log('PASS original layout/font hashes, application isolation, read-only signal manifest, canvas text');

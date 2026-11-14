'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RetroSource = require('../apps/manuk_retro_cluster/retro_source');
const log = { info() {}, warn() {}, error() {} };

async function run() {
    let availability, receive, resolveRead, reads = 0, stops = 0, callbackCount = 0;
    const proxy = {
        init: () => Promise.resolve(),
        subscribeToAvailability(fn) { availability = fn; return Promise.resolve(); },
        subscribe(o) { receive = o.onReceive; return Promise.resolve(); },
        isAvailable: () => false,
        getValue() { reads++; return new Promise((r) => { resolveRead = r; }); },
        shutdown() { stops++; return Promise.resolve(); },
    };
    const mod = { exports: {} }, state = [];
    const filename = path.resolve(__dirname, '../kit/runtime/signals.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: mod, exports: mod.exports, __dirname: path.dirname(filename),
        require(name) {
            if (name === 'fs') return { readFileSync() { return JSON.stringify({ fields: { speed: { getter: true } } }); } };
            if (name === 'path') return path;
            if (name === 'someip') return { buildProxy: () => Promise.resolve(proxy) };
            throw new Error(name);
        }, setImmediate, setInterval, clearInterval,
    }, { filename });
    const sub = await mod.exports.watch('test.Vehicle', '1', { speed() { callbackCount++; } }, log, { onAvailability: (on) => state.push(on) });
    availability(true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(reads, 1);
    availability(false);
    receive({ value: 88 });
    assert.strictEqual(callbackCount, 0, 'late notification while unavailable is ignored');
    resolveRead({ value: 88 });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(callbackCount, 0, 'late getter reply must not resurrect a departed provider');
    availability(true);
    await new Promise((r) => setImmediate(r));
    resolveRead({ value: 0 });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(callbackCount, 1);
    const pendingRead = sub.refresh(['speed'], 3000);
    sub.invalidate(); // VehicleCondition off, even though the provider remains available.
    resolveRead({ value: 99 }); await pendingRead;
    assert.strictEqual(callbackCount, 1, 'getter from previous drive epoch is ignored');
    await sub.shutdown(); await sub.shutdown();
    receive({ value: 123 });
    assert.strictEqual(callbackCount, 1, 'notifications after shutdown are ignored');
    assert.strictEqual(stops, 1, 'native proxy shuts down once');
    assert.deepStrictEqual(state, [true, false, true]);
    console.log('PASS source epochs reject late getter replies and dispose once');

    const pending = [];
    let shutdowns = 0, watches = 0;
    const ctx = { log, signals: { watch() { watches++; return new Promise((r) => pending.push(r)); } } };
    const source = new RetroSource(ctx, () => ({ enabled: true, safety: { requireVehicleCondition: true, criticalMaxAgeMs: 5000 } }));
    source.start(); source.start();
    await Promise.resolve();
    assert.strictEqual(watches, 12);
    source.stop();
    pending.forEach((resolve) => resolve({ available: true, shutdown() { shutdowns++; return Promise.resolve(); } }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(shutdowns, 12, 'subscriptions resolved after stop are immediately disposed');
    assert.strictEqual(source.listeners.length, 0);
    console.log('PASS late subscription resolution cannot leak or restart a stopped app');
}
run().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });

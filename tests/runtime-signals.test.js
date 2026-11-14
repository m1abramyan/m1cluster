'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RetroSource = require('../apps/manuk_retro_cluster/retro_source');
const log = { info() {}, warn() {}, error() {} };

async function run() {
    let availability, receive, resolveRead, reads = 0, stops = 0, callbackCount = 0;
    const received = [], receives = {}, pendingReads = {};
    const proxy = {
        init: () => Promise.resolve(),
        subscribeToAvailability(fn) { availability = fn; return Promise.resolve(); },
        subscribe(o) { receives[o.name] = o.onReceive; receive = o.onReceive; return Promise.resolve(); },
        isAvailable: () => false,
        getValue(name) { reads++; return new Promise((r) => { resolveRead = r; pendingReads[name] = r; }); },
        shutdown() { stops++; return Promise.resolve(); },
    };
    const mod = { exports: {} }, state = [];
    const filename = path.resolve(__dirname, '../kit/runtime/signals.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: mod, exports: mod.exports, __dirname: path.dirname(filename),
        require(name) {
            if (name === 'fs') return { readFileSync() { return JSON.stringify({ fields: { speed: { getter: true }, oil: { getter: true } } }); } };
            if (name === 'path') return path;
            if (name === 'someip') return { buildProxy: () => Promise.resolve(proxy) };
            throw new Error(name);
        }, setImmediate, setInterval, clearInterval,
    }, { filename });
    const sub = await mod.exports.watch('test.Vehicle', '1', { speed(v) { callbackCount++; received.push(v.value); } }, log, { onAvailability: (on) => state.push(on) });
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
    receive({ value: 77 });
    resolveRead({ value: 0 });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(callbackCount, 1, 'initial getter cannot overwrite a newer notification in the same epoch');
    assert.deepStrictEqual(received, [77]);
    const olderRead = sub.refresh(['speed'], 3000);
    receive({ value: null }); // Invalid observations must also supersede older plausible values.
    resolveRead({ value: 55 }); await olderRead;
    assert.strictEqual(callbackCount, 2);
    assert.deepStrictEqual(received, [77, null], 'periodic getter cannot resurrect a value after newer invalid notification');
    const pendingRead = sub.refresh(['speed'], 3000);
    sub.invalidate(); // VehicleCondition off, even though the provider remains available.
    resolveRead({ value: 99 }); await pendingRead;
    assert.strictEqual(callbackCount, 2, 'getter from previous drive epoch is ignored');
    await sub.shutdown(); await sub.shutdown();
    receive({ value: 123 });
    assert.strictEqual(callbackCount, 2, 'notifications after shutdown are ignored');
    assert.strictEqual(stops, 1, 'native proxy shuts down once');
    assert.deepStrictEqual(state, [true, false, true]);
    console.log('PASS source epochs and same-field notifications reject older getter replies, including initial/wake reads');

    const independent = { speed: [], oil: [] };
    const multi = await mod.exports.watch('test.Vehicle', '1', {
        speed(v) { independent.speed.push(v.value); }, oil(v) { independent.oil.push(v.value); },
    }, log);
    availability(true); await new Promise((r) => setImmediate(r));
    receives.speed({ value: 90 });
    pendingReads.oil({ value: 100 }); pendingReads.speed({ value: 80 });
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(independent, { speed: [90], oil: [100] }, 'other-field notifications never cancel a legitimate getter');
    const plain = multi.refresh(['speed'], 3000);
    pendingReads.speed({ value: 91 }); await plain;
    assert.deepStrictEqual(independent.speed, [90, 91], 'getter without a subsequent notification still renews the reading');
    await multi.shutdown();
    assert.strictEqual(reads, 7, 'ordering guard does not add requests');
    console.log('PASS per-field revisions preserve independent getters and existing read count');

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

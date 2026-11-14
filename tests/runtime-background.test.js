'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');

async function run() {
    const filename = path.resolve(__dirname, '../kit/runtime/mgu.js');
    let initialized = 0, active = 0, backgroundCalls = 0, stops = 0, foregroundCalls = 0, requestedExit = null;
    const deferred = [];
    class FakeOnlineApp extends EventEmitter {
        constructor() { super(); this.rhmiApplication = null; }
        start() { return Promise.resolve(); }
        registerActive() { active++; return Promise.resolve(); }
        initialized() { initialized++; return Promise.resolve(); }
    }
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const mod = { exports: {} };
    const fakeFs = {
        existsSync() { return false; }, readdirSync() { return []; }, appendFileSync() {},
        readFileSync(file) {
            if (/app-spec\.json$/.test(file)) return JSON.stringify({ id: 'manuk_retro_cluster', version: '0.1.0', settings: [], screens: [] });
            throw new Error('not found');
        },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: mod, exports: mod.exports, __dirname: path.dirname(filename),
        require(name) {
            if (name === 'fs') return fakeFs;
            if (name === 'path') return path;
            if (name === 'oap-sdk') return { OnlineApp: FakeOnlineApp, logging: { getSDKLogger() { return logger; } } };
            if (name === './signals') return { tag: 'read-only-test-source' };
            return {};
        }, process: { env: {}, cwd: () => '/temporary-test-data', on() {}, exit(code) { requestedExit = code; }, memoryUsage: () => ({ rss: 0 }) },
        setTimeout(fn) { deferred.push(fn); return deferred.length; }, clearTimeout() {}, Buffer,
    }, { filename });
    const result = await mod.exports.run({
        background(ctx) {
            backgroundCalls++;
            assert.strictEqual(ctx.spec.id, 'manuk_retro_cluster');
            assert.strictEqual(ctx.signals.tag, 'read-only-test-source');
            assert.strictEqual(ctx.ui, undefined);
            return { stop() { stops++; } };
        },
        start() { foregroundCalls++; },
    });
    assert.strictEqual(backgroundCalls, 1);
    assert.strictEqual(foregroundCalls, 0, 'no foreground entry when RHMI does not exist');
    assert.strictEqual(initialized, 1, 'background-only launch completes SDK initialization');
    assert.strictEqual(active, 1);
    result.app.emit('shutdown');
    assert.strictEqual(stops, 1, 'MainApp shutdown releases background rendering before process exit');
    assert.strictEqual(requestedExit, null);
    deferred.forEach((fn) => fn());
    assert.strictEqual(requestedExit, 0);
    console.log('PASS actual mgu.run starts background without RHMI, initializes and cooperatively shuts down');
}
run().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });

'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'apps/manuk_retro_cluster'), shared = path.join(root, 'shared');
const kit = path.join(root, 'kit/runtime'), load = Module._load, pack = require(path.join(kit, 'pack'));
Module._load = function (request, parent, main) {
    if (parent && (parent.filename.indexOf(app + path.sep) === 0 || parent.filename.indexOf(shared + path.sep) === 0)) {
        if (request === './hud_data') return pack.open(path.join(app, 'hud'));
        if (request.indexOf('./kit/') === 0) return load.call(this, path.join(kit, request.slice(6)), parent, main);
        if (request.indexOf('./') === 0 && !fs.existsSync(path.resolve(path.dirname(parent.filename), request) + '.js') && fs.existsSync(path.join(shared, request) + '.js')) return load.call(this, path.join(shared, request), parent, main);
    }
    return load.call(this, request, parent, main);
};
const Hud = require(path.join(app, 'retro_runtime')).RetroHud;
const Store = require(path.join(app, 'config')).ConfigStore;
Module._load = load;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-motion-test-'));
const log = { info() {}, warn() {}, error() {} }, store = new Store(dir, 'car', log);
const values = { speed: 10, rpm: 6000, gear: 4, stage: 'D', selector: 'D', driveMode: 'SPORT', driveProfile: 'sport' };
let now = 1000, stamp = now;
const source = { sources: { speed: { epoch: 0 }, cds: { epoch: 0 } },
    read: key => values[key], data: () => Object.assign({ demo: false }, values),
    reading: key => ({ value: values[key], receivedAt: stamp }), onSample() { return function () {}; } };
const hud = new Hud({ log, spec: require(path.join(app, 'app.json')), dataDir: dir }, source, store, 'car');
hud.theme = require(path.join(app, 'profile_view')).theme(require(path.join(shared, 'hud_themes')).THEMES.retro, 'sport', store.current);
const dateNow = Date.now, nativeSetInterval = global.setInterval, nativeClearInterval = global.clearInterval;
const intervals = new Map(); let timerId = 0;
try {
    Date.now = () => now;
    global.setInterval = (fn, ms) => { const id = ++timerId; intervals.set(id, ms); return id; };
    global.clearInterval = id => intervals.delete(id);
    hud.clients.forEach(c => { c.connect = function () {}; });
    hud.start(); hud.start();
    assert.deepStrictEqual(Array.from(intervals.values()).sort((a, b) => a - b), [34, 5000, 60000], 'one animation timer despite repeated start');
    const layout = hud.layouts.load('retro80s');
    const speed = { w: layout.widgets.find(w => w.id === 'speed'), ref: 1, last: null, lastPaint: 0,
        c: { blocked: false, pixels(ref, rects, buf) { this.uploads = (this.uploads || 0) + 1; this.bytes = (this.bytes || 0) + buf.length; } } };
    const uniforms = {}, revs = { w: layout.widgets.find(w => w.id === 'revs'), ref: 2, last: null,
        c: { blocked: false, uniform(ref, name, value) { uniforms[name] = value; } } };
    hud._smoothRpm(now); hud._update(speed, now, false); hud._update(revs, now, false);
    assert.strictEqual(speed.last.split('|')[0], '10');
    now = stamp = 1100; values.speed = 12; values.rpm = 7000;
    hud._smoothRpm(now); hud._update(speed, now, false); hud._update(revs, now, false);
    assert.deepStrictEqual(uniforms.u_value, [6000 / 8000]);
    assert.deepStrictEqual(uniforms.u_flash, [1], 'raw 7000 activates flash immediately despite interpolation');
    now = 1150; hud._smoothRpm(now); hud._update(speed, now, false); hud._update(revs, now, false);
    assert.strictEqual(speed.last.split('|')[0], '11', 'intermediate display value, not a fabricated source sample');
    assert.strictEqual(source.read('speed'), 12); assert.strictEqual(hud.visualState().speed, 12);
    assert.deepStrictEqual(uniforms.u_value, [6500 / 8000]);
    now = 1200; hud._smoothRpm(now); hud._update(speed, now, false);
    assert.strictEqual(speed.last.split('|')[0], '12', 'target reached within 100ms');
    now = stamp = 1250; values.speed = 18; speed.c.blocked = true; revs.c.blocked = true;
    const uploads = speed.c.uploads, oldRevs = revs.last;
    for (; now <= 1500; now += 34) { hud._smoothRpm(now); hud._update(speed, now, false); hud._update(revs, now, false); }
    assert.strictEqual(speed.c.uploads, uploads); assert.strictEqual(revs.last, oldRevs);
    speed.c.blocked = false; revs.c.blocked = false;
    hud._update(speed, now, false); assert.strictEqual(speed.last.split('|')[0], '18', 'drain sends only current state, never a queue of omitted digits');
    now = stamp = 1600; values.speed = 0; hud._update(speed, now, false);
    assert.strictEqual(speed.last.split('|')[0], '0', 'stop is immediate');
    now = stamp = 1700; values.speed = null; values.rpm = null;
    hud._update(speed, now, false); hud._update(revs, now, false);
    assert.strictEqual(speed.last.split('|')[0], '--'); assert.strictEqual(hud.motion.speed.target, null);
    assert.deepStrictEqual(uniforms.u_value, [0]); assert.deepStrictEqual(uniforms.u_flash, [0]);
    now = stamp = 1800; values.speed = 30; values.rpm = 3000;
    hud._smoothRpm(now); assert.strictEqual(hud._token('speed'), '30');
    now = stamp = 1850; values.speed = 60; values.rpm = 6000; source.sources.speed.epoch++; source.sources.cds.epoch++;
    hud._smoothRpm(now); assert.strictEqual(hud._token('speed'), '60'); assert.strictEqual(hud.rpmF, 6000);
    hud.releaseLayers(); assert.strictEqual(hud.motion.speed.target, null); assert.strictEqual(hud.motion.rpm.target, null);
    // Same real bitmap diff writer with the old 50/200ms pacing and current
    // 34/1ms pacing, driven by identical four-Hz measured-sample fixtures.
    function benchmark(legacy) {
        hud._resetMotion(); hud.started = !legacy; now = stamp = 10000;
        values.speed = 10; values.rpm = 1000;
        const trace = [], stats = { imageWrites: 0, pixelBytes: 0, uniformWrites: 0 };
        const w = Object.assign({}, speed.w); if (legacy) delete w.rate;
        const sx = { w, ref: 1, last: null, lastPaint: 0, c: { pixels(ref, rects, buf) { stats.imageWrites++; stats.pixelBytes += buf.length; } } };
        const rx = { w: revs.w, ref: 2, last: null, c: { uniform() { stats.uniformWrites++; } } };
        hud._update(sx, now, true); hud._update(rx, now, true);
        stats.imageWrites = stats.pixelBytes = stats.uniformWrites = 0;
        const cpu = process.cpuUsage();
        for (let t = 0; t <= 6250; t += legacy ? 50 : 34) {
            now = 10000 + t; stamp = 10000 + Math.floor(t / 250) * 250;
            values.speed = 10 + Math.min(24, Math.floor(t / 250)) * 3;
            values.rpm = 1000 + Math.min(24, Math.floor(t / 250)) * 200;
            hud._smoothRpm(now); hud._update(sx, now, false); hud._update(rx, now, false);
            const rendered = sx.last.split('|')[0];
            if (trace[trace.length - 1] !== rendered) trace.push(rendered);
        }
        const used = process.cpuUsage(cpu);
        stats.pixelBytesPerSecond = Math.round(stats.pixelBytes / 6.25);
        stats.cpuMs = (used.user + used.system) / 1000;
        stats.speedTrace = trace.map(Number); stats.targetTickMs = legacy ? 50 : 34;
        return stats;
    }
    const before = benchmark(true), after = benchmark(false);
    assert(after.imageWrites > before.imageWrites, 'the display actually emits additional intermediate frames');
    assert.deepStrictEqual(after.speedTrace.slice(0, 7), [10, 11, 12, 13, 14, 15, 16]);
    assert.strictEqual(after.speedTrace[after.speedTrace.length - 1], 82);
    assert(after.pixelBytesPerSecond < 2 * 1024 * 1024, 'bounded dirty-rectangle traffic on the explicit test fixture');
    const report = { kind: 'deterministic real HUD raster/diff benchmark, not MGU frame-rate evidence',
        samplePeriodMs: 250, speedStepKmh: 3, rpmStep: 200, durationMs: 6250, before, after };
    if (process.env.MOTION_REPORT) fs.writeFileSync(process.env.MOTION_REPORT, JSON.stringify(report, null, 2) + '\n');
    hud.started = true;
    hud.stop(); hud.stop(); assert.strictEqual(intervals.size, 0, 'stop clears every timer');
    console.log('motion HUD: real tokens/pixels/uniforms, one timer, raw flash threshold, epoch/loss/reset and backpressure OK');
} finally {
    hud.stop(); Date.now = dateNow; global.setInterval = nativeSetInterval; global.clearInterval = nativeClearInterval;
    fs.rmSync(dir, { recursive: true, force: true });
}

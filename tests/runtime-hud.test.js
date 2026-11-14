'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'apps/manuk_retro_cluster');
const shared = path.join(root, 'shared');
const kit = path.join(root, 'kit/runtime');
const pack = require(path.join(kit, 'pack'));
const originalLoad = Module._load;
// Mirror only the builder's flat module placement; all modules/resources are the actual source files.
Module._load = function (request, parent, isMain) {
    if (parent && (parent.filename.indexOf(app + path.sep) === 0 || parent.filename.indexOf(shared + path.sep) === 0)) {
        if (request === './hud_data') return pack.open(path.join(app, 'hud'));
        if (request.indexOf('./kit/') === 0) return originalLoad.call(this, path.join(kit, request.slice(6)), parent, isMain);
        if (request.indexOf('./') === 0 && !fs.existsSync(path.resolve(path.dirname(parent.filename), request) + '.js')) {
            const resolved = path.join(shared, request);
            if (fs.existsSync(resolved) || fs.existsSync(resolved + '.js')) return originalLoad.call(this, resolved, parent, isMain);
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};
const RetroHud = require(path.join(app, 'retro_runtime')).RetroHud;
const ConfigStore = require(path.join(app, 'config')).ConfigStore;
Module._load = originalLoad;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-hud-test-'));
const log = { info() {}, warn() {}, error() {} };
const store = new ConfigStore(dir, 'car', log);
const values = { speed: 0, rpm: 3200, gear: 0, stage: 'P', oil: 100, coolant: 90, fuelL: 40, boost: 0.8 };
let listeners = 0;
const source = { data: () => Object.assign({ demo: false }, values), read: (key) => values[key],
    onSample() { listeners++; return () => { listeners--; }; } };
const spec = require(path.join(app, 'app.json'));
const hud = new RetroHud({ log, spec, dataDir: dir }, source, store, 'car');
try {
    hud.rpmF = 3200; hud.rpmShown = 3200;
    assert.strictEqual(hud._token('rpm'), '3200');
    values.rpm = null;
    assert.strictEqual(hud._token('rpm'), '--');
    assert.strictEqual(hud._raw('rpm'), null);
    assert.strictEqual(hud.rpmShown, null);
    assert.strictEqual(hud._token('fuelPct'), '--', 'unknown tank size is not replaced by donor-car volume');
    assert.strictEqual(hud._token('intake'), '--');
    values.stage = null; values.gear = 0;
    assert.strictEqual(hud._token('gearnum'), '-', 'ambiguous gear is never N');
    assert.strictEqual(hud._boost(), 0.8);
    values.driveProfile = 'sport'; values.driveMode = 'SPORT'; values.dsc = null; values.gearboxProgram = 'D';
    hud.ctx.retroBenchValues = () => ({ forceProfile: 'eco', dsc: 'ON', engineProfile: 'COMFORT', gearboxProgram: 'S' });
    assert.strictEqual(hud.visualState().profile, 'sport', 'car ignores forced bench profile');
    assert.strictEqual(hud.visualState().dsc, null, 'car ignores simulated DSC');
    assert.strictEqual(hud.visualState().gearboxProgram, 'D', 'car ignores simulated programme');
    assert(!hud.visualState().engineProfile, 'general mode and bench state cannot supply engine profile');
    store.current.retro.warnBoost = 0.5;
    assert.strictEqual(hud._mainMetric(), 'fuelFlow', 'all profiles use fuel flow at zero speed, never boost');
    values.oil = 140;
    const oilWidget = hud.layouts.load('retro80s').widgets.find(w => w.id === 'oil');
    assert.strictEqual(hud._warning(oilWidget), 'oil', 'main temperature warning remains active');
    values.driveProfile = 'eco'; values.speed = 0;
    hud.ctx.retroBenchValues = () => ({ consumption: 9 });
    assert.strictEqual(hud._metricValue('consumption'), null, 'standing car never shows l/100km');
    assert.strictEqual(hud.waze, null);
    hud._startDme(); assert.strictEqual(hud.dmeTimer, undefined);
    const beforeLead = hud.cue.learned;
    [[3000, 1000, 2], [4000, 1100, 2], [5200, 1200, 2], [4000, 1300, 3]].forEach((sample) => {
        hud.cue.tick(sample[0], sample[1], 5000, 7000, 200, sample[2], sample[0], () => true, { mode: 'M' });
    });
    assert.strictEqual(hud.cue.learned, beforeLead);
    assert(!fs.existsSync(path.join(dir, 'shift_lead.json')), 'count-in does not persist inferred driver reaction state');
    const clients = [hud.client, hud._clientAt(1), hud._clientAt(2), hud._clientAt(3)];
    clients.forEach((client) => client.effect({ target: 'panel', x: 0, y: 0, w: 1, h: 1, fs: 'void main(){gl_FragColor=vec4(0.0);}' }));
    assert(clients.every((c) => c.layers.size === 1));
    clients[2].emit('disconnected');
    assert(clients.every((c) => c.layers.size === 0), 'one disconnect clears every client replay cache');
    hud.stop(); hud.stop();
    assert.strictEqual(listeners, 0, 'source listeners removed exactly once');
    assert(clients.every((c) => c.closed && !c.timer && !c.sock));
    assert.strictEqual(hud.layouts.watcher, null);
    assert(!fs.existsSync(path.join(dir, 'screen.json')));
    console.log('PASS actual RetroHud clears missing rpm, unknown fuel/intake and ambiguous gear');
    console.log('PASS actual four-client release, stop, watchers and subscriptions are idempotent');
    console.log('PASS count-in retains graphics without inferred manual-shift learning or state writes');
    console.log('PASS car blocks all bench-only forced states, main temperature warning retained, no standstill consumption');
} finally {
    hud.stop(); store.stop();
    function remove(dir) { fs.readdirSync(dir).forEach((f) => { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) remove(p); else fs.unlinkSync(p); }); fs.rmdirSync(dir); }
    remove(dir);
}

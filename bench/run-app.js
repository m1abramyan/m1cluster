'use strict';
/**
 * Bench launcher: runs the BUILT app (dist/<id>, made by kit/tools/build.py, the
 * same build the Store runs on the car) inside the kit's stubbed head unit (kit/tools/hu-stub.js,
 * live mode). No BMW SDK, no SOME/IP:
 *
 *  - The center-screen page is hu-stub's fake RHMI. A setting from the bench panel is sent the way
 *    the car's HMI sends it: an 'action' on the SET_<KEY> component (the drop-down's row, or a
 *    checkbox press), so the kit's own wireSettings() handles it and saves bench/.data/<id>/settings.json.
 *  - The status row (ctx.ui.text('STATUS', ...)) is reported to the page.
 *  - Manual signals go in as RAW SOME/IP values through hu.feed, the scaling car.js undoes on the
 *    car; the FES boost field too. Demo mode is the kit's sim.js (the "demo" setting).
 *  - HUD_CLUSTER_SOCKET points hud.js at the bench's fake cluster-render socket.
 *
 * Run by bench/server.js as a forked child: node bench/run-app.js <stage dir> <data dir>
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const activeIntervals = new Set();
const nativeSetInterval = global.setInterval, nativeClearInterval = global.clearInterval;
global.setInterval = function () { const timer = nativeSetInterval.apply(global, arguments); activeIntervals.add(timer); return timer; };
global.clearInterval = function (timer) { activeIntervals.delete(timer); return nativeClearInterval(timer); };


const stage = process.argv[2], dataDir = process.argv[3];
if (!stage || !dataDir) { console.error('usage: run-app.js <dist/<id>> <data dir>'); process.exit(2); }

const send = (m) => { if (process.connected) process.send(m); };
const fmt = (a) => a.map((x) => (x && x.stack) ? x.stack : (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
const tag = '[' + path.basename(stage) + '] ';
const log = {
    info: (...a) => console.log(tag + fmt(a)),
    warn: (...a) => console.warn(tag + 'WARN ' + fmt(a)),
    error: (...a) => console.warn(tag + 'ERROR ' + fmt(a)),
    debug: () => {},
};
// As on the car, an uncaught exception ends the app (kit/mgu.js): the bench shows the exit.
process.on('uncaughtException', (e) => { log.error('uncaught (the car would exit the app here): ' + (e && e.stack || e)); process.exit(1); });

try { fs.mkdirSync(dataDir); } catch (e) { /* there */ }
const { headUnit } = require(path.join(process.env.BENCH_ROOT || path.join(__dirname, '..'), 'kit', 'tools', 'hu-stub.js'));
const hu = headUnit(stage, { live: true, dataDir, log, image: () => Promise.resolve() });
const { spec, settings, ui } = hu;
let rhmiQueued = false;
hu.on('rhmi', () => {
    if (rhmiQueued) return;
    rhmiQueued = true;
    Promise.resolve().then(() => { rhmiQueued = false; send({ t: 'rhmi', snapshot: hu.uiSnapshot() }); });
});
const localeFile = path.join(stage, 'source', 'javascript', 'locale.js');
const statusText = spec.id === 'manuk_retro_cluster' && fs.existsSync(localeFile) ? require(localeFile).status : String;
// Model the runtime's source-availability notifications and subscription teardown.
const sourceAvailability = {};
const originalWatch = hu.ctx.signals.watch;
hu.ctx.signals.watch = function (iface, inst, handlers, logger, options) {
    return originalWatch(iface, inst, handlers, logger, options).then(function (sub) {
        const list = sourceAvailability[iface] || (sourceAvailability[iface] = []);
        const notify = options && options.onAvailability;
        if (notify) list.push(notify);
        sub.shutdown = function () {
            hu.subs[iface] = (hu.subs[iface] || []).filter(function (s) { return s.res !== sub; });
            if (notify) sourceAvailability[iface] = list.filter(function (fn) { return fn !== notify; });
            return Promise.resolve();
        };
        return sub;
    });
};

// a stand-in for BMW's guidance service (the HUD's directions), driven by POST /nav (fake-nav.js)
const fakeNav = require('./fake-nav').install(hu, log);

// the app's HudApp instance, for the values the page shows (hud.js is loaded by the app's main.js)
let hud = null;
const realLoad = Module._load;
Module._load = function (req) {
    const m = realLoad.apply(this, arguments);
    if (req === './hud' && typeof m === 'function' && !m.__bench) {
        // the status line: the engine's own (the page shows it on its Settings tab; there is no STATUS row any more)
        const Wrapped = class extends m { constructor(ctx) { super(ctx); hud = this; if (process.env.BENCH_CLOCK) { const parts = process.env.BENCH_CLOCK.split(':').map(Number); this._now = function () { return { getHours: function () { return parts[0]; }, getMinutes: function () { return parts[1]; } }; }; } this.onStatus((s) => { status = statusText(s); send({ t: 'status', s: status }); }); } };
        Wrapped.__bench = true;
        return Wrapped;
    }
    return m;
};

// the center screen's status row
let status = '';
const text = ui.text;
ui.text = (n, t, row, cell) => {
    if (n === 'STATUS' && !row) { status = String(t); send({ t: 'status', s: status }); }
    return text(n, t, row, cell);
};

const sendSettings = () => send({ t: 'settings', schema: spec.settings, values: Object.assign({}, settings.values) });
settings.onChange(sendSettings);

/** A setting from the panel, pressed on the fake HMI as the car's HMI would. */
function press(key, value) {
    const s = settings.item(key);
    if (!s) return log.warn('bench: no setting ' + key);
    const comp = ui.comp('SET_' + key.toUpperCase());
    if (s.type === 'bool') {
        if (!!settings.get(key) !== !!value) comp.emit('action', {});      // a checkbox press toggles
        return;
    }
    const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
    const row = rows.indexOf(value);
    if (row < 0) return log.warn('bench: ' + key + ' has no value ' + JSON.stringify(value));
    comp.emit('action', { row });
}

// Raw notifications exercise the real normalizer. Unverified metrics have explicit bench-only values.
let mode = 'manual', manual = {}, drive = null;
const transport = require('./profile-signals').adapter(hu, sourceAvailability);
hu.ctx.retroBenchValues = function () { return transport.values(manual, mode); };
setInterval(() => { if (mode === 'manual') transport.tick(manual, drive); }, 50);

// Report the real app state alongside explicit simulation inputs; neither is labelled as car data.
setInterval(() => {
    const controller = hu.ctx.retroController;
    if (!hud && !controller) return;
    const source = controller && controller.source;
    const d = source ? source.data() : hud.car.data(), simulated = hu.ctx.retroBenchValues(), out = {};
    ['rpm', 'speed', 'oil', 'coolant', 'gear', 'gLong', 'gLat', 'torque', 'power', 'ambient', 'odometer',
        'avgConsumption', 'tripDistance', 'tripMinutes', 'consumption', 'fuelFlow', 'tripFuel',
        'pFL', 'pFR', 'pRL', 'pRR', 'tFL', 'tFR', 'tRL', 'tRR'].forEach(n => {
        out[n] = d[n] !== undefined && d[n] !== null ? d[n] : simulated[n] === undefined ? null : simulated[n];
    });
    out.boost = hud ? hud._boost() : source ? source.read('boost') : null;
    out.intake = hud ? hud._raw('intake') : source ? source.read('intake') : null;
    out.fuelL = source ? source.read('fuelL') : hud.fuelL;
    out.range = source ? source.read('range') : hud.rangeKm;
    const rawVisual = controller && controller.hud && controller.hud.visualState ? controller.hud.visualState() : null;
    const visual = rawVisual ? Object.keys(rawVisual).reduce((result, key) => {
        // Keep absent observations explicit in JSON; undefined would erase the telemetry key.
        result[key] = rawVisual[key] === undefined ? null : rawVisual[key]; return result;
    }, {}) : null;
    const activeHud = controller ? controller.hud : hud;
    const expectedLayers = activeHud && activeHud._layerRefs ? activeHud._layerRefs().length : 0;
    if (visual) Object.keys(visual).forEach(k => { out[k] = visual[k]; });
    send({ t: 'values', mode, values: out, manual, driveRaw: drive,
        visual, readings: source && source.readings ? source.readings() : null,
        configuration: controller ? controller.store.current : null,
        diagnostics: { intervals: activeIntervals.size, subscriptions: Object.keys(hu.subs).reduce(function (n, key) { return n + hu.subs[key].length; }, 0), pid: process.pid, expectedLayers, expectedPixelBytes: activeHud ? activeHud.pixelBytes : 0 } });
}, 250);

process.on('message', (m) => {
    if (!m) return;
    if (m.t === 'signals') {
        mode = m.mode === 'missing' ? 'missing' : 'manual';
        if (mode === 'missing') transport.missing();
        manual = m.values || {};
        // demo drive = the kit's sim; manual = live data (auto: the sim gives way once data arrives)
        const want = 'off';
        // back to the demo drive: the manual car "stops" first (speed 0), else car.js would keep its last manual speed
        // and, over 5 km/h, take it for a moving car (Demo data On gives way to a moving car)
        // Missing source is unavailable; no synthetic zero is fed.
        if (settings.item('demo') && settings.get('demo') !== want) press('demo', want);
    } else if (m.t === 'enabled') { if (hu.ctx.retroController) hu.ctx.retroController.setEnabled(m.value); }
    else if (m.t === 'rhmi-action') {
        Promise.resolve().then(() => hu.uiAction(m.component, m.row)).then(snapshot => {
            send({ t: 'rhmi-action-result', requestId: m.requestId, snapshot });
        }, e => { send({ t: 'rhmi-action-result', requestId: m.requestId, error: String(e && e.message || e) }); });
    }
    else if (m.t === 'set') press(m.key, m.value);
    else if (m.t === 'drive') drive = m.value;
    else if (m.t === 'source') transport.source(m.source, m.available);
    else if (m.t === 'configuration') {
        try {
            if (!hu.ctx.retroController) throw new Error('Application is not ready');
            const configuration = hu.ctx.retroController.store.save(m.configuration);
            send({ t: 'configuration-result', requestId: m.requestId, configuration });
        } catch (e) { send({ t: 'configuration-result', requestId: m.requestId, error: e.message }); }
    }
    else if (m.t === 'shiftTest' && hud) hud.testShift();
    else if (m.t === 'nav') fakeNav.set(m.scenario);
    else if (m.t === 'demo' && hud) { if (m.play) log.info('bench: play demo ' + (hud.playDemo(m.at) ? 'started' : 'refused (' + hud.demoBlocked() + ')')); else hud.stopDemo(); }
});
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

hu.ctx.retroBench = true;
hu.start();
sendSettings();
log.info('bench: app loaded from ' + path.relative(process.cwd(), stage) + ', data in ' + dataDir);

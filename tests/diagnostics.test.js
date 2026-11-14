'use strict';
// Synthetic sources only. These tests never load a BMW SDK, connect to a car,
// make a diagnostic ECU request or exercise the live local bench.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Diagnostics = require('../apps/manuk_retro_cluster/diagnostics');
const metadata = require('../apps/manuk_retro_cluster/diagnostic_metadata');
const Source = require('../apps/manuk_retro_cluster/retro_source');
const config = require('../apps/manuk_retro_cluster/config');
const dirs = [], instances = [];
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function definitions() {
    const db = { interfaces: {}, datatypes: {
        consumption: { type: 'struct', members: [{ name: 'amount', dataRef: 'UInt16' }, { name: 'unit', dataRef: 'consumptionUnit' },
            { name: 'vin', dataRef: 'UInt64' }, { name: 'serialNumber', dataRef: 'UInt64' }, { name: 'name', dataRef: 'String' }, { name: 'locations', dataRef: 'arr' }] },
        consumptionUnit: { type: 'enum', items: { TEST_LPH: 1, TEST_L100KM: 2 } },
        String: { type: 'string' }, arr: { type: 'array', elementDataRef: 'UInt32' },
    } };
    const reset = 'de.bmw.infotainment.resetlogic.ResetLogic';
    db.interfaces[reset] = { fields: { currentConsumption: { dataRef: 'consumption', getter: { id: 1 }, notifier: {} }, averageConsumption: { dataRef: 'consumption', getter: { id: 2 }, notifier: {} } } };
    return metadata.scan(db);
}
function fixture(options) {
    options = options || {};
    let now = 100000, next = 0, refresh = 0, shutdown = 0, notifications = 0;
    const timers = {}, watches = [], pending = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-diagnostics-'));
    dirs.push(dir);
    const cfg = config.defaults('car'); cfg.enabled = false;
    const source = new Source({ log: { warn() {} } }, () => cfg, { now: () => now });
    source.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    source.receive('gear', 'statusGearboxDrive', { statusActualStageDrive: 'P', statusActualGearDrive: 'N_OR_P' });
    source.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    source.sources.speed.sub = { available: true, refresh(fields) {
        refresh++; assert.deepStrictEqual(fields, ['statusCarSpeed2']);
        if (options.refreshSpeed) source.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
        return Promise.resolve([]);
    } };
    const ctx = { dataDir: dir, spec: { version: '0.3.2' }, log: { warn() {}, info() {}, error() {} }, signals: {
        watch(iface, instance, handlers, log, opts) {
            assert.strictEqual(instance, '1'); assert.strictEqual(opts.pollMs, undefined);
            const sub = { available: true, shutdown() { shutdown++; }, refresh() { throw new Error('candidate polling forbidden'); } };
            const w = { iface, handlers, opts, sub }; watches.push(w);
            opts.onAvailability(true);
            if (options.delayed) return new Promise(resolve => pending.push(() => resolve(sub)));
            return Promise.resolve(sub);
        },
        proxy() { throw new Error('diagnostic proxy forbidden'); }, call() { throw new Error('method call forbidden'); }, set() { throw new Error('vehicle write forbidden'); },
    } };
    const d = new Diagnostics(ctx, { profile: options.profile || 'car', source: source, now: () => now,
        readMetadata: () => options.noMetadata ? { status: 'missing', fields: [], incomplete: true } : definitions(),
        setInterval(fn, ms) { assert.strictEqual(ms, 1000); timers[++next] = fn; return next; }, clearInterval(id) { delete timers[id]; } });
    instances.push(d);
    d.onChange(() => { notifications++; });
    return { d, source, cfg, ctx, dir, watches, timers, pending, advance(ms) {
        const end = now + ms;
        while (now + 1000 <= end) { now += 1000; Object.keys(timers).forEach(k => { if (timers[k]) timers[k](); }); }
        now = end;
    }, emit(id, value) {
        const scope = Diagnostics.SCOPES.filter(s => s.id === id)[0], w = watches.filter(w => w.iface === scope.interface)[0];
        assert(w && w.handlers[scope.field], 'fixture subscription exists for ' + id); w.handlers[scope.field](value);
    }, refreshes: () => refresh, shutdowns: () => shutdown, notifications: () => notifications };
}
(async () => {
    const f = fixture(); assert.strictEqual(f.d.snapshot().state, 'idle'); assert.strictEqual(f.watches.length, 0); assert.deepStrictEqual(fs.readdirSync(f.dir), []);
    let started = f.d.start(); assert.strictEqual(started.state, 'collecting'); assert(!started.then, 'start is synchronous; Cancel remains usable');
    f.d.start(); await settle(); assert.strictEqual(f.watches.length, 5); assert.strictEqual(Object.keys(f.timers).length, 1);
    assert.strictEqual(f.refreshes(), 0, 'valid parked source needs no extra getter');
    f.emit('tank', { fluidLevelFuelTank: 36, range: 442, mileageKilometre: 123456, vin: 'WBA12345678901234', fluidLevelFuelTankLeftHand: 50 });
    f.emit('bc', { consumptionAverage1BC1: 92, consumptionAverage2BC2: 105, statusUnitOfMeasurementConsumptionBC: 'VERBRAUCH_IN_L_S_100KM', unrelated: 999 });
    f.emit('boost', { displayBoostPressure: 14, displayMaximumValueBoostPressure: 160 });
    f.emit('dsc', { qualifierFunctionFDR: 7, qualifierFunctionASC: 'TEST_UNDECODED', qualifierFunctionABS: 65535, statusBrakingDriver: 1 });
    f.emit('injection', { injectionVolumeFuelEngine: 65530, oilTemperature: 148, secret: 'do not store' });
    f.emit('current', { amount: 32, unit: 'TEST_LPH', vin: 777, serialNumber: 888, name: 'secret', locations: [1, 2] });
    f.emit('average', { amount: 91, unit: 2 }); f.advance(1000);
    f.emit('injection', { injectionVolumeFuelEngine: 5, oilTemperature: 149 });
    f.emit('current', { amount: 'secret', unit: 'UNDECLARED_ENUM', vin: 999 });
    for (let i = 0; i < 5000; i++) f.emit('boost', { displayBoostPressure: i % 255, displayMaximumValueBoostPressure: 160 });
    f.advance(29000); const done = f.d.snapshot();
    assert.strictEqual(done.state, 'complete'); assert.strictEqual(done.elapsedSeconds, 30); assert.strictEqual(done.error, null);
    assert.strictEqual(f.shutdowns(), 5); assert.strictEqual(Object.keys(f.timers).length, 0); assert.strictEqual(f.source.listeners.length, 0);
    assert.strictEqual(f.cfg.enabled, false, 'diagnostics do not enable drawing or modify settings'); assert.strictEqual(f.source.closed, false, 'shared source remains owned by runtime');
    assert.strictEqual(done.report.sources.injection.stats.injectionVolumeFuelEngine.first, 65530);
    assert.strictEqual(done.report.sources.injection.stats.injectionVolumeFuelEngine.latest, 5);
    assert.strictEqual(done.report.sources.injection.stats.injectionVolumeFuelEngine.min, 5);
    assert.strictEqual(done.report.sources.boost.observations, 5001);
    assert.strictEqual(done.report.sources.current.stats.unit.latest, 'TEST_LPH'); assert.strictEqual(done.report.sources.current.stats.amount.latest, 32);
    assert.strictEqual(done.report.sources.current.rejectedValues, 2);
    assert.deepStrictEqual(Object.keys(done.report.sources.tank.latest).sort(), ['fluidLevelFuelTank', 'range']);
    assert.deepStrictEqual(Object.keys(done.report.sources.dsc.latest).sort(), ['qualifierFunctionABS', 'qualifierFunctionASC', 'qualifierFunctionFDR']);
    assert(done.report.samples.length <= 121); assert(Buffer.byteLength(JSON.stringify(done.report)) <= Diagnostics.MAX_BYTES);
    const stored = fs.readFileSync(path.join(f.dir, 'diagnostics-last.json'), 'utf8');
    assert.strictEqual(fs.statSync(path.join(f.dir, 'diagnostics-last.json')).mode & 0o777, 0o600);
    assert(!/WBA123|mileageKilometre|do not store|UNDECLARED_ENUM/.test(stored));
    assert(!/serialNumber|locations|\"vin\"/.test(JSON.stringify(done.report.sources)), 'metadata names do not authorize private live values');
    assert.deepStrictEqual(JSON.parse(stored), done.report); assert.strictEqual(done.qrPages, undefined, 'no QR encoding work on the vehicle');
    assert(done.report.metadata.fields.some(field => field.members.some(m => m.enum && m.enum.length)), 'full enum evidence survives transfer');
    assert(!/fuelK|litresPerCount|dscOn|boostBar/.test(stored), 'no interpretation or calibration is invented');
    assert(f.notifications() <= 33, 'UI updates are bounded by the 1Hz progress timer, not raw event frequency');
    const oldSession = done.report.sessionId;
    // Restarting collection obtains a new report, never resumes yesterday's values.
    f.source.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    f.d.start(); await settle(); f.d.cancel();
    assert.notStrictEqual(f.d.snapshot().report.sessionId, oldSession); assert.strictEqual(f.d.snapshot().report.sources.tank.observations, 0);
    assert.deepStrictEqual(fs.readdirSync(f.dir), ['diagnostics-last.json']);

    const bench = fixture({ profile: 'bench', noMetadata: true }); bench.d.start(); await settle();
    assert.strictEqual(bench.watches.length, 4, 'no ResetLogic subscription without safe catalog members');
    bench.advance(30000); const br = bench.d.snapshot();
    assert.strictEqual(br.simulation, true); assert.strictEqual(br.report.simulation, true); assert(/Имитация данных/.test(br.summary));
    assert.strictEqual(br.report.confirmation, 'SIMULATION-NOT-VEHICLE-DATA'); assert.strictEqual(br.report.environment, 'bench');
    assert.strictEqual(br.report.sources.current.reason, 'no-safe-catalog-members');
    assert.strictEqual(br.report.sources.injection.observations, 0); assert.deepStrictEqual(br.report.sources.injection.stats, {}, 'missing source remains missing, never a zero fuel rate');

    const actions = [
        s => s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 1 }),
        s => s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 65535 }),
        s => s.receive('gear', 'statusGearboxDrive', { statusActualStageDrive: 'D', statusActualGearDrive: 'G1' }),
        s => s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 12 }),
        s => s.availability('speed', false), s => s.availability('gear', false), s => s.availability('condition', false),
    ];
    for (const action of actions) {
        const g = fixture({ delayed: true }); g.d.start(); await settle(); assert.strictEqual(g.watches.length, 5);
        action(g.source); assert.strictEqual(g.d.snapshot().state, 'cancelled'); assert.strictEqual(Object.keys(g.timers).length, 0);
        g.pending.forEach(resolve => resolve()); await settle(); assert.strictEqual(g.shutdowns(), 5, 'late watcher resolutions are shut down after guard cancellation');
        const before = JSON.stringify(g.d.snapshot().report); g.emit('boost', { displayBoostPressure: 100 });
        assert.strictEqual(JSON.stringify(g.d.snapshot().report), before, 'late callbacks cannot resurrect finished collection');
    }
    const stale = fixture(); stale.advance(6000); stale.d.start(); await settle();
    assert.strictEqual(stale.refreshes(), 1); assert.strictEqual(stale.watches.length, 0); stale.advance(3000);
    assert.strictEqual(stale.d.snapshot().state, 'error'); assert.strictEqual(stale.d.snapshot().error, 'speed-unknown');
    assert(stale.d.snapshot().report.reason === 'speed-unknown', 'refusal remains reviewable without fake observations');
    const refreshed = fixture({ refreshSpeed: true }); refreshed.advance(6000); refreshed.d.start(); await settle();
    assert.strictEqual(refreshed.refreshes(), 1); assert.strictEqual(refreshed.watches.length, 5); refreshed.d.cancel();
    const moving = fixture(); moving.source.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 64 });
    moving.d.start(); await settle(); assert.strictEqual(moving.watches.length, 0); assert.strictEqual(moving.d.snapshot().report.reason, 'vehicle-moving');
    const unknown = fixture(); unknown.source.receive('gear', 'statusGearboxDrive', {}); unknown.d.start(); await settle(); unknown.advance(3000);
    assert.strictEqual(unknown.watches.length, 0); assert.strictEqual(unknown.d.snapshot().report.reason, 'selector-unknown');
    const closed = fixture(); closed.d.start(); await settle(); closed.source.stop(); closed.advance(1000);
    assert.strictEqual(closed.d.snapshot().state, 'cancelled'); assert.strictEqual(closed.shutdowns(), 5);
    const failedSave = fixture(); failedSave.ctx.dataDir = path.join(failedSave.dir, 'does-not-exist'); failedSave.d.start(); await settle(); failedSave.d.cancel();
    assert.strictEqual(failedSave.d.snapshot().error, 'report-save-failed'); assert(failedSave.d.snapshot().report.saveError === 'report-save-failed');
    const stopped = fixture(); stopped.d.stop(); stopped.d.start(); await settle(); assert.strictEqual(stopped.watches.length, 0);
    console.log('PASS diagnostics: explicit synchronous start, parked guard, same-epoch stationary zero, single optional getter, no polls/writes, raw allowlist, complete raw report, bounded progress/storage, cancellation/sleep/late cleanup and bench provenance');
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).then(() => {
    instances.forEach(d => d.stop());
    dirs.forEach(dir => { fs.readdirSync(dir).forEach(name => fs.unlinkSync(path.join(dir, name))); fs.rmdirSync(dir); });
});

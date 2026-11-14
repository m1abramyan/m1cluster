'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RetroSource = require('../apps/manuk_retro_cluster/retro_source');
const log = { info() {}, warn() {}, error() {} };
const config = () => ({ enabled: true, safety: { requireVehicleCondition: true, criticalMaxAgeMs: 5000, criticalReadTimeoutMs: 3000, getterRefreshMs: 1000 } });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function source() { let now = 1000; const s = new RetroSource({ log, signals: {} }, config, { now: () => now }); s.advance = (ms) => { now += ms; }; return s; }
function valid(s) {
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    s.receive('cds', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: 3200 });
    s.receive('gear', 'statusGearboxDrive', { statusActualGearDrive: 'N_OR_P', statusActualStageDrive: 'P' });
}
test('zero speed and parked gear are real valid values', () => {
    const s = source(); valid(s); assert.strictEqual(s.data().speed, 0); assert.strictEqual(s.data().rpm, 800); assert.strictEqual(s.reason(), null);
});
test('ambiguous NP never becomes N and releases car gate', () => {
    const s = source(); valid(s); s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 'NP' });
    assert.strictEqual(s.data().stage, null); assert.strictEqual(s.data().gear, null); assert(/gear/.test(s.reason()));
});
test('invalid value immediately replaces previous valid speed', () => {
    const s = source(); valid(s); s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 65535 });
    assert.strictEqual(s.data().speed, null); assert(/speed/.test(s.reason()));
});
test('malformed fractional gear enums never become invented ratios', () => {
    const s = source(); valid(s);
    s.receive('gear', 'statusGearboxDrive', { statusActualGearDrive: 3.5, statusActualStageDrive: 'D' });
    assert.strictEqual(s.data().gear, null); assert(/gear/.test(s.reason()));
    s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 5.5 });
    assert.strictEqual(s.data().gear, null); assert(/gear/.test(s.reason()));
});
test('provider loss invalidates its fields and reconnection needs new values', () => {
    const s = source(); valid(s); s.availability('gear', false); assert(/gear/.test(s.reason()));
    s.availability('gear', true); assert(/gear/.test(s.reason()));
    s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 'P' }); assert.strictEqual(s.reason(), null);
});
test('late notifications cannot resurrect explicitly unavailable source', () => {
    const s = source(); valid(s); s.availability('speed', false);
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 6400 });
    assert.strictEqual(s.data().speed, undefined); assert(/speed/.test(s.reason()));
});
test('vehicle off then ready cannot reuse observations from previous drive', () => {
    const s = source(); valid(s);
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 12 });
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 'P' });
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    assert(/speed/.test(s.reason()));
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    assert(/gear/.test(s.reason()));
    s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 'P' });
    assert.strictEqual(s.reason(), null);
});
test('condition provider interruption requires new critical observations after recovery', () => {
    const s = source(); valid(s); s.availability('condition', false);
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    s.availability('condition', true);
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    assert(/speed/.test(s.reason()));
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 });
    assert(/gear/.test(s.reason()));
    s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: 'P' });
    assert.strictEqual(s.reason(), null);
});
test('event fields persist in provider epoch; cyclic fields need fresh observations', () => {
    const s = source(); valid(s); s.receive('cds', 'statusEngineTemperature', { temperatureEngineOilDrive: 148, temperatureEngineDrive: 138 });
    s.advance(6000); assert.strictEqual(s.data().speed, null); assert.strictEqual(s.data().rpm, null);
    assert.strictEqual(s.data().stage, 'P'); assert.strictEqual(s.data().oil, 100); assert.strictEqual(s.data().condition, 10);
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 0 }); assert.strictEqual(s.reason(), null);
});
test('unknown and switching-off vehicle conditions release gate', () => {
    [null, 5, 8, 12, 15, 'UNKNOWN'].forEach((n) => { const s = source(); valid(s); s.receive('condition', 'VehicleCondition', { statusConditionVehicle: n }); assert(s.reason()); });
});
test('no simulation and no inferred gear after many speed/rpm observations', () => {
    const s = source(); for (let i = 0; i < 200; i++) { s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 6400 }); s.receive('cds', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: 10000 }); }
    assert.strictEqual(s.data().demo, false); assert.strictEqual(s.data().gear, undefined); assert.strictEqual(s.data().stage, undefined);
});
test('fuel preserves zero; uncertain boost stays a diagnostic candidate', () => {
    const s = source(); s.receive('fuel', 'statusRangeTankStatus', { fluidLevelFuelTank: 0, range: 0 });
    s.receive('boost', 'statusSwitchDriveDynamicSport2', { displayBoostPressure: 0 });
    assert.strictEqual(s.read('fuelL'), 0); assert.strictEqual(s.read('range'), 0); assert.strictEqual(s.read('boost'), null);
    assert.strictEqual(s.reading('boost').candidate, 0); assert.strictEqual(s.reading('boost').quality, 'unverified');
    s.receive('fuel', 'statusRangeTankStatus', { fluidLevelFuelTank: 255, range: 4095 });
    s.receive('boost', 'statusSwitchDriveDynamicSport2', { displayBoostPressure: 255 });
    assert.strictEqual(s.read('fuelL'), null); assert.strictEqual(s.read('range'), null); assert.strictEqual(s.read('boost'), null);
});

// Test the real lifecycle controller with a fake renderer, without constructing vendor pixels.
const runtimeFile = path.resolve(__dirname, '../apps/manuk_retro_cluster/retro_runtime.js');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(runtimeFile, 'utf8'), { module: mod, exports: mod.exports,
    require: (name) => name === './retro_source' ? RetroSource : name === './hud' ? class {} : {},
    setInterval, clearInterval, setTimeout, clearTimeout, console }, { filename: runtimeFile });
const RetroRuntime = mod.exports.RetroRuntime;
test('delayed sources, disable/re-enable and stop create no duplicate timers or subscriptions', () => {
    let sourceStarts = 0, sourceStops = 0, hudStarts = 0, hudStops = 0, timers = 0;
    class FakeSource {
        constructor() { this.ready = false; }
        start() { sourceStarts++; } stop() { sourceStops++; } onSample(fn) { this.fn = fn; return () => { this.fn = null; }; }
        tick() {} reason() { return this.ready ? null : 'waiting'; }
    }
    class FakeHud {
        start() { hudStarts++; } stop() { hudStops++; } onStatus() {} statusText() { return 'renderer waiting'; }
    }
    const store = { current: config(), onChange(fn) { this.change = fn; return () => { this.change = null; }; }, watch() {}, stop() {}, save(v) { this.current = v; this.change(); } };
    const r = new RetroRuntime({ log }, store, 'car', { Source: FakeSource, Hud: FakeHud,
        setInterval() { timers++; return 1; }, clearInterval() { timers--; } });
    r.start(); r.start(); assert.strictEqual(sourceStarts, 1); assert.strictEqual(timers, 1); assert.strictEqual(hudStarts, 0);
    r.source.ready = true; r.evaluate(); r.evaluate(); assert.strictEqual(hudStarts, 1);
    r.source.ready = false; r.evaluate(); assert.strictEqual(hudStops, 1);
    r.source.ready = true; r.evaluate(); assert.strictEqual(hudStarts, 2);
    r.disable(); assert.strictEqual(store.current.enabled, false); assert.strictEqual(hudStops, 2);
    r.setEnabled(true); assert.strictEqual(hudStarts, 3);
    r.stop(); r.stop(); assert.strictEqual(sourceStops, 1); assert.strictEqual(hudStops, 3); assert.strictEqual(timers, 0);
});
test('constructor failure latches until explicit configuration change', () => {
    let attempts = 0;
    const store = { current: config(), onChange(fn) { this.change = fn; return () => {}; }, watch() {}, stop() {} };
    class Ready { start() {} stop() {} tick() {} reason() { return null; } onSample() { return () => {}; } }
    class Broken { constructor() { attempts++; throw new Error('renderer failure'); } }
    const r = new RetroRuntime({ log }, store, 'car', { Source: Ready, Hud: Broken, setInterval() { return 1; }, clearInterval() {} });
    r.start(); r.evaluate(); r.evaluate(); assert.strictEqual(attempts, 1); store.change(); assert.strictEqual(attempts, 2); r.stop();
});
console.log('runtime: ' + passed + ' tests passed');

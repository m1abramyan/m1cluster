'use strict';
const assert = require('assert');
const Source = require('../apps/manuk_retro_cluster/retro_source');
const modes = require('../apps/manuk_retro_cluster/drive_modes');
const spec = require('../apps/manuk_retro_cluster/app.json');
const log = { info() {}, warn() {}, error() {} };
const config = () => ({ enabled: true, safety: { requireVehicleCondition: true, criticalMaxAgeMs: 5000, getterRefreshMs: 1000, criticalReadTimeoutMs: 1000 } });
function setup() {
    let now = 20000;
    const s = new Source({ log, signals: {} }, config, { now: () => now });
    s.advance = (ms) => { now += ms; };
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    s.receive('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 88 * 64 });
    s.receive('cds', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: 3200 * 4 });
    s.receive('gear', 'statusGearboxDrive', { statusActualStageDrive: 'D', statusActualGearDrive: 'G4' });
    return s;
}
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
test('exact drive modes retain variants, Adaptive and unknown use neutral palette', () => {
    assert.deepStrictEqual(modes.decode('SPORT_EXPERT'), { name: 'SPORT+', profile: 'sport', raw: 'SPORT_EXPERT', known: true });
    assert.strictEqual(modes.decode(3).name, 'SPORT INDIVIDUAL');
    assert.strictEqual(modes.decode(9).name, 'ECO PRO INDIVIDUAL');
    assert.strictEqual(modes.decode('ADAPTIVE').profile, null);
    [0, 11, 61, 63, 3.5, 'SPORT_MAYBE', 'UNKNOWN', null].forEach((raw) => assert.strictEqual(modes.decode(raw).name, null));
});
test('drive mode changes cannot infer or modify selector, gear, engine or DSC', () => {
    const s = setup();
    s.receive('dsc', 'StabilizationManagement', { qualifierFunctionFDR: 1, qualifierFunctionASC: 7, qualifierFunctionABS: 0 });
    ['SPORT_DYNAMIC', 'COMFORT', 'ECO_PRO_EFFICIENT', 'SPORT_INDIVIDUAL', 'UNKNOWN'].forEach((raw) => {
        s.receive('boost', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: raw });
        const d = s.data();
        assert.strictEqual(d.speed, 88); assert.strictEqual(d.selector, 'D'); assert.strictEqual(d.actualGear, 4);
        assert.strictEqual(d.gearboxProgram, null); assert.strictEqual(d.engineProfile, null); assert.strictEqual(d.dsc, null);
        assert.deepStrictEqual(s.reading('dsc').raw, { qualifierFunctionFDR: 1, qualifierFunctionASC: 7, qualifierFunctionABS: 0 });
    });
    assert.strictEqual(s.data().driveMode, null); assert.strictEqual(s.data().driveProfile, null);
});
test('Comfort with S is independent; missing MDrive never silently becomes D', () => {
    const s = setup();
    s.receive('mdrive', 'dataDisplayGearbox', { displayProgramGearbox: 'S_MINUS_PROGRAMM' });
    s.receive('boost', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: 'COMFORT' });
    assert.strictEqual(s.data().gearboxProgram, 'S'); assert.strictEqual(s.data().driveMode, 'COMFORT');
    [0, 'D', 'D_MINUS_PROGRAMM', 'SPORT', 99].forEach((raw) => {
        s.receive('mdrive', 'dataDisplayGearbox', { displayProgramGearbox: raw }); assert.strictEqual(s.data().gearboxProgram, null);
    });
    s.receive('mdrive', 'dataDisplayGearbox', { displayProgramGearbox: 2 }); assert.strictEqual(s.data().gearboxProgram, 'M');
    s.availability('mdrive', false); assert.strictEqual(s.data().gearboxProgram, null);
});
test('P/R/N selectors do not create forward gear numbers', () => {
    const s = setup();
    ['P', 'R', 'N'].forEach((stage) => {
        s.receive('gear', 'DataPowerTrain2', { statusGearSelectionDrive: stage });
        assert.strictEqual(s.data().selector, stage); assert.strictEqual(s.data().actualGear, null); assert.strictEqual(s.reason(), null);
    });
});
test('engine run state is a direct observation and never an engine profile', () => {
    const s = setup(); assert.strictEqual(s.data().engineRunning, null);
    s.receive('cds', 'statusEngineStatus', { statusEngineRunDrive: 'MOTOR_AUS' });
    assert.strictEqual(s.data().engineRunning, 'off'); assert.strictEqual(s.data().rpm, 3200); assert.strictEqual(s.data().engineProfile, null);
});
test('all DSC qualifiers remain unverified, including apparent Boolean and enum names', () => {
    const s = setup();
    [0, 1, true, 'ON', 'OFF', 'DTC', 'INTERVENTION', 'FAILURE'].forEach((raw) => {
        s.receive('dsc', 'StabilizationManagement', { qualifierFunctionFDR: raw });
        assert.strictEqual(s.read('dsc'), null); assert.strictEqual(s.reading('dsc').quality, 'unverified');
    });
});
test('torque and calculated power carry units, origin, formula and per-source freshness', () => {
    const s = setup(); s.receive('boost', 'statusActualValueTorque2', { actualValueTorqueCrankshaft: 2647 });
    assert.strictEqual(s.read('torque'), 300); assert.strictEqual(s.read('power'), 300 * 3200 / 9549);
    const r = s.reading('power'); assert.strictEqual(r.unit, 'kW'); assert.strictEqual(r.quality, 'derived'); assert(/9549/.test(r.formula));
    assert(/actualValueTorqueCrankshaft/.test(s.reading('torque').source));
    s.advance(4000); assert.strictEqual(s.read('rpm'), 3200); assert.strictEqual(s.read('torque'), null); assert.strictEqual(s.read('power'), null);
    s.receive('boost', 'statusActualValueTorque2', { actualValueTorqueCrankshaft: 4095 }); assert.strictEqual(s.read('torque'), null);
});
test('questionable scaling remains diagnostic data and cannot become a readout', () => {
    const s = setup();
    s.receive('boost', 'statusSwitchDriveDynamicSport2', { displayBoostPressure: 80 });
    s.receive('fuel', 'statusBordcomputerAverage', { consumptionAverage1BC1: 86, statusUnitOfMeasurementConsumptionBC: 'VERBRAUCH_IN_MPG_UK' });
    s.receive('fuel', 'statusBordcomputerTravelData', { wayPassed: 42, rideDurationHours: 1, rideDurationMinutes: 25 });
    ['boost', 'avgConsumption', 'tripDistance'].forEach((key) => { assert.strictEqual(s.read(key), null); assert.strictEqual(s.reading(key).quality, 'unverified'); });
    assert.strictEqual(s.reading('boost').candidate, 0.8); assert.strictEqual(s.reading('avgConsumption').candidateUnit, 'mpg UK');
    assert.strictEqual(s.read('tripMinutes'), 85);
    ['consumption', 'fuelFlow', 'tripFuel', 'intake'].forEach((key) => assert.strictEqual(s.read(key), null));
});
test('metric BC1 average uses the owner-compared scale without becoming current consumption', () => {
    const s = setup();
    const emit = (raw, unit) => s.receive('fuel', 'statusBordcomputerAverage', {
        consumptionAverage1BC1: raw, consumptionAverage2BC2: 222, statusUnitOfMeasurementConsumptionBC: unit,
    });
    [1, 'VERBRAUCH_IN_L_S_100KM'].forEach((unit) => {
        emit(87, unit); const r = s.reading('avgConsumption');
        assert(Math.abs(r.value - 8.7) < 1e-12); assert.strictEqual(r.quality, 'valid');
        assert.strictEqual(r.unit, 'l/100km'); assert.strictEqual(r.inputUnit, 'l/100km');
        assert.strictEqual(r.interval, 'stock onboard computer BC1'); assert.strictEqual(r.raw, 87);
        assert.strictEqual(r.confirmation, 'metric-scale-owner-G30-single-sample');
        assert(/one sample/.test(r.reason)); assert(/average only/.test(r.reason));
        assert(/consumptionAverage1BC1$/.test(r.source));
        ['consumption', 'fuelFlow', 'tripFuel'].forEach((key) => assert.strictEqual(s.read(key), null));
    });
    emit(0, 1); assert.strictEqual(s.read('avgConsumption'), 0, 'a valid metric zero remains zero');
    emit(65534, 1); assert(Math.abs(s.read('avgConsumption') - 6553.4) < 1e-9);
    [65535, 65536, -1, NaN, Infinity, '87', null, undefined].forEach((raw) => {
        emit(raw, 1); assert.strictEqual(s.read('avgConsumption'), null); assert.strictEqual(s.reading('avgConsumption').quality, 'invalid');
    });
    [0, 'DEFAULT', 2, 3, 4, 'VERBRAUCH_IN_MPG_UK', 'VERBRAUCH_IN_MPG_US', 'VERBRAUCH_IN_KM_S_L', '1', true, null, undefined].forEach((unit) => {
        emit(87, unit); assert.strictEqual(s.read('avgConsumption'), null); assert.strictEqual(s.reading('avgConsumption').quality, 'unverified');
    });
    emit(87, 1); s.advance(35000); assert.strictEqual(s.reading('avgConsumption').quality, 'valid');
    s.advance(1); assert.strictEqual(s.read('avgConsumption'), null); assert.strictEqual(s.reading('avgConsumption').quality, 'stale');
    emit(87, 1); s.availability('fuel', false); assert.strictEqual(s.read('avgConsumption'), null);
    s.availability('fuel', true); assert.strictEqual(s.read('avgConsumption'), null, 'provider recovery needs a new value');
    emit(87, 1); s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 12 });
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    assert.strictEqual(s.read('avgConsumption'), null, 'a new drive cannot reuse the previous average observation');
});
test('TPMS requires explicit units, handles each missing wheel and invalidates on unit loss', () => {
    const s = setup(); const pressure = { actualValuePressureTyreFLH: 25, actualValuePressureTyreFRH: 26, actualValuePressureTyreRLH: 65535, actualValuePressureTyreRRH: 0 };
    s.receive('tyres', 'statusTyrePressure', pressure); assert.strictEqual(s.read('pFL'), null);
    s.receive('units', 'statusNewCurrentUnitsStatusExt', { unitOfMeasurementAirPressure: 'BAR', unitOfMeasurementTemperature: 'C' });
    s.receive('tyres', 'statusTyrePressure', pressure);
    assert.strictEqual(s.read('pFL'), 2.5); assert.strictEqual(s.read('pFR'), 2.6); assert.strictEqual(s.read('pRL'), null); assert.strictEqual(s.read('pRR'), 0);
    s.receive('tyres', 'statusTyreTemperature', { actualValueTemperatureTyreFLH: 72 }); assert.strictEqual(s.read('tFL'), 32); assert.strictEqual(s.read('tFR'), null);
    s.availability('units', false); assert.strictEqual(s.read('pFL'), null); assert.strictEqual(s.read('tFL'), null);
    s.availability('units', true); s.receive('units', 'statusNewCurrentUnitsStatusExt', { unitOfMeasurementAirPressure: 'PSI', unitOfMeasurementTemperature: 'F' });
    assert.strictEqual(s.read('pFL'), null);
    s.receive('tyres', 'statusTyrePressure', { actualValuePressureTyreFLH: 360 }); assert(Math.abs(s.read('pFL') - 36 / 14.5038) < 1e-8);
    s.receive('tyres', 'statusTyreTemperature', { actualValueTemperatureTyreFLH: 108 }); assert.strictEqual(s.read('tFL'), 20);
    s.advance(36000); assert.strictEqual(s.reading('pFL').quality, 'stale'); assert.strictEqual(s.read('pFL'), null);
});
test('sleep invalidates modes, program, DSC, units and all observations from the previous epoch', () => {
    const s = setup(); s.receive('boost', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: 'SPORT_DYNAMIC' });
    s.receive('mdrive', 'dataDisplayGearbox', { displayProgramGearbox: 1 });
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 12 });
    s.receive('boost', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: 'COMFORT' });
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 });
    assert.strictEqual(s.read('driveMode'), null); assert.strictEqual(s.read('gearboxProgram'), null); assert(s.reason());
});
test('new manifest interfaces are read/subscribe only and share existing FES/Kombi providers', () => {
    assert.strictEqual(Object.keys(Source.IF).length, 12);
    Object.keys(Source.IF).forEach((key) => assert(spec.signals[Source.IF[key]], 'missing ' + key));
    Object.keys(spec.signals).forEach((iface) => Object.keys(spec.signals[iface]).forEach((field) => assert(/^(rs|s)$/.test(spec.signals[iface][field]))));
});
console.log('vehicle states: ' + count + ' tests passed');

(async () => {
    const s = setup(), calls = [], cfg = config(); s.config = () => cfg;
    ['speed', 'cds', 'boost', 'fuel', 'tyres', 'units'].forEach((key) => {
        s.availability(key, true);
        s.sources[key].sub = { available: true, invalidate() {}, refresh(fields) { calls.push({ key, fields: fields.slice() }); return Promise.resolve([]); } };
    });
    s.tick(); s.tick();
    assert.strictEqual(calls.length, 5, 'one refresh per eligible provider, not one per tick or field');
    await new Promise((resolve) => setImmediate(resolve));
    s.tick(); assert.strictEqual(calls.length, 5, 'refresh cadence prevents duplicate requests');
    cfg.enabled = false; s.advance(12000); s.tick(); assert.strictEqual(calls.length, 5, 'disabled app does not refresh providers');
    cfg.enabled = true; s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 12 }); s.tick();
    assert.strictEqual(calls.length, 5, 'sleep state does not refresh providers');
    s.receive('condition', 'VehicleCondition', { statusConditionVehicle: 10 }); s.tick();
    assert.strictEqual(calls.length, 11, 'one new snapshot of available providers after sleep');
    assert(calls.slice(5).find((c) => c.key === 'boost').fields.indexOf('statusFESVehicleDynamicSwitchHMI') >= 0, 'wake fetches unchanged mode if its getter exists');
    assert(calls.slice(5).find((c) => c.key === 'units'), 'wake fetches units before fresh TPMS readings can be used');
    s.stop(); s.tick(); assert.strictEqual(calls.length, 11, 'stop cannot trigger another getter');
    console.log('PASS guarded getters: no duplicates, no requests while disabled/asleep, one fresh snapshot after wake');
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });

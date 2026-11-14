'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../apps/manuk_retro_cluster/config');
const clone = (v) => JSON.parse(JSON.stringify(v));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-gauge-config-'));
const file = path.join(dir, 'manuk_retro_cluster.json');
const log = { error: function () {}, warn: function () {} };
function legacy(version) {
    const c = config.defaults('car');
    c.schemaVersion = version;
    delete c.widgets;
    delete c.displayUnits;
    delete c.startup.onEngineStart;
    c.enabled = true; c.units = 'us'; c.clock = '12h'; c.language = 'en';
    c.retro.tankLitres = 71; c.retro.slots['1'] = 'coolant';
    c.logging.level = 'warn'; c.startup.mode = 'manually';
    c.profiles.enabled = false; c.profiles.followVehicleMode = false;
    c.profiles.accents.sport = '#FF0011';
    if (version < 5) {
        c.profiles.ecoMaxConsumption = 45;
        delete c.profiles.gaugeMax;
    } else c.profiles.gaugeMax.consumption = 45;
    if (version === 1) delete c.profiles;
    if (version === 2) c.profiles.slots = { comfort: { 1: 'oil', 2: 'rpm' }, sport: { 1: 'power', 2: 'torque' }, eco: { 1: 'avgConsumption', 2: 'tripFuel' } };
    if (version === 2 || version === 3) c.profiles.aux = { comfort: 'tripDistance', sport: 'gLat', eco: 'rpm' };
    if (version === 6) c.widgets = { selected: 'music' };
    return c;
}
try {
    const car = config.defaults('car'), bench = config.defaults('bench');
    assert.strictEqual(car.schemaVersion, 7);
    assert.strictEqual(car.widgets, undefined);
    assert.deepStrictEqual(car.displayUnits, { speed: 'kmh', temperature: 'c', pressure: 'bar', consumption: 'l100km' });
    assert.deepStrictEqual(bench.displayUnits, car.displayUnits);
    assert.strictEqual(car.startup.onEngineStart, false);
    assert.deepStrictEqual(car.profiles.gaugeMax, { consumption: 30, range: 1000, fuelFlow: 10 });
    assert.deepStrictEqual(bench.profiles.gaugeMax, car.profiles.gaugeMax);
    assert.strictEqual(car.enabled, false); assert.strictEqual(bench.enabled, true);
    assert.strictEqual(car.retro.tankLitres, null); assert.strictEqual(car.startup.mode, 'manually');
    [1, 2, 3, 4, 5, 6].forEach((version) => {
        const old = legacy(version), before = JSON.stringify(old), migrated = config.validate(old);
        assert.strictEqual(JSON.stringify(old), before, 'Validation does not mutate the input');
        assert.strictEqual(migrated.schemaVersion, 7);
        assert.strictEqual(migrated.widgets, undefined);
        assert.deepStrictEqual(migrated.displayUnits, { speed: 'mph', temperature: 'f', pressure: 'psi', consumption: 'mpg' });
        assert.deepStrictEqual(migrated.startup, Object.assign({}, old.startup, { onEngineStart: false }));
        ['enabled', 'units', 'clock', 'language', 'retro', 'logging', 'timeZone', 'safety'].forEach((k) => assert.deepStrictEqual(migrated[k], old[k], 'Migration retains ' + k));
        assert.deepStrictEqual(migrated.profiles.gaugeMax, { consumption: version === 1 ? 30 : 45, range: 1000, fuelFlow: 10 });
        ['ecoMaxConsumption', 'slots', 'aux'].forEach((k) => assert.strictEqual(migrated.profiles[k], undefined));
        if (version > 1) {
            ['enabled', 'followVehicleMode', 'accents'].forEach((k) => assert.deepStrictEqual(migrated.profiles[k], old.profiles[k]));
        }
        fs.writeFileSync(file, before);
        const store = new config.ConfigStore(dir, 'car', log);
        assert.deepStrictEqual(store.current, migrated);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), migrated, 'Migration persists atomically');
        assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
        store.stop();
        const restarted = new config.ConfigStore(dir, 'car', log);
        assert.deepStrictEqual(restarted.current, migrated, 'Restart does not reset migrated choices');
        restarted.stop();
        assert(!fs.readdirSync(dir).some((n) => n.indexOf('.tmp-') >= 0));
    });
    const limits = { consumption: [10, 60], range: [100, 3000], fuelFlow: [1, 100] };
    Object.keys(limits).forEach((key) => {
        const bounds = limits[key];
        bounds.forEach((n) => { const c = clone(car); c.profiles.gaugeMax[key] = n; assert.strictEqual(config.validate(c).profiles.gaugeMax[key], n); });
        [0, -1, bounds[0] - 0.1, bounds[1] + 0.1, '30', null, NaN, Infinity].forEach((n) => {
            const c = clone(car); c.profiles.gaugeMax[key] = n;
            assert.throws(() => config.validate(c), /expected number|outside allowed range/);
        });
        const missing = clone(car); delete missing.profiles.gaugeMax[key];
        assert.throws(() => config.validate(missing), /required/);
    });
    const foreign = clone(car); foreign.profiles.gaugeMax.tankCapacity = 65;
    assert.throws(() => config.validate(foreign), /unknown key/);
    const outdated = clone(car); outdated.profiles.ecoMaxConsumption = 30;
    assert.throws(() => config.validate(outdated), /unknown key/);
    const ambiguous = legacy(4); ambiguous.profiles.gaugeMax = { consumption: 20, range: 500, fuelFlow: 5 };
    assert.throws(() => config.validate(ambiguous), /unknown key in schema version 4/);
    const invalidLegacy = legacy(4); invalidLegacy.profiles.ecoMaxConsumption = -1;
    const invalidText = JSON.stringify(invalidLegacy);
    fs.writeFileSync(file, invalidText);
    const invalidStore = new config.ConfigStore(dir, 'car', log);
    assert.strictEqual(invalidStore.current.enabled, false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), invalidText, 'Invalid legacy file is preserved, not repaired');
    invalidStore.stop();
    console.log('PASS configuration v7: independent display units, removed widget choice, strict validation, atomic v1-v6 migration, retained settings, restart and invalid-file preservation');
} finally {
    fs.readdirSync(dir).forEach((n) => fs.unlinkSync(path.join(dir, n))); fs.rmdirSync(dir);
}

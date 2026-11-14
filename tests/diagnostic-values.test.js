'use strict';
const assert = require('assert');
const values = require('../apps/manuk_retro_cluster/diagnostic_values');
const IF = { tank: 'de.bmw.infotainment.KombiIF', dsc: 'de.bmw.chassis.VehicleStabilizationManagement', reset: 'de.bmw.infotainment.resetlogic.ResetLogic' };
const copy = (v) => JSON.parse(JSON.stringify(v));
function source(paths, latest) {
    const stats = {}; Object.keys(latest).forEach(name => { const v = latest[name]; stats[name] = { first: v, latest: v, min: typeof v === 'number' ? v : null, max: typeof v === 'number' ? v : null, count: 1, firstMs: 0, latestMs: 0 }; });
    return { paths: paths.map(p => p.split('.')), available: true, observations: 1, reason: 'raw-only-unverified', latest, stats };
}
const report = { environment: 'car', simulation: false, state: 'complete', elapsedSeconds: 30, reason: 'duration-complete',
    metadata: { status: 'available', incomplete: false, fields: [] }, sources: {
        tank: source(['fluidLevelFuelTank', 'range'], { fluidLevelFuelTank: 36, range: 442, mileageKilometre: 999999, vin: 'WBA12345678901234' }),
        bc: source(['consumptionAverage1BC1', 'consumptionAverage2BC2', 'statusUnitOfMeasurementConsumptionBC'], { consumptionAverage1BC1: 92, consumptionAverage2BC2: 105, statusUnitOfMeasurementConsumptionBC: 2 }),
        boost: source(['displayBoostPressure', 'displayMaximumValueBoostPressure'], { displayBoostPressure: 0, displayMaximumValueBoostPressure: 160 }),
        dsc: source(['qualifierFunctionFDR', 'qualifierFunctionASC', 'qualifierFunctionABS'], { qualifierFunctionFDR: 0, qualifierFunctionASC: 1, qualifierFunctionABS: 7 }),
        injection: source(['injectionVolumeFuelEngine', 'oilTemperature'], { injectionVolumeFuelEngine: 5, oilTemperature: 148 }),
        current: source(['amount', 'unit', 'vin', 'serialNumber', 'mileage', 'location.latitude', 'freeText'], { amount: 32, unit: 'TEST_LPH', vin: 'WBA12345678901234', serialNumber: 123456, mileage: 55555, 'location.latitude': 43, freeText: 'PRIVATE_IDENTIFIER' }),
        average: source(['amount', 'unit'], { amount: 91, unit: 2 }),
        privateSource: source(['vin'], { vin: 'WBA12345678901234' }),
    } };
const units = [{ name: 'TEST_LPH', value: 1 }, { name: 'TEST_L100KM', value: 2 }];
const dscEnum = [{ name: 'TEST_CODE_ZERO', value: 0 }, { name: 'TEST_CODE_ONE', value: 1 }, { name: 'TEST_CODE_UNKNOWN', value: 7 }];
report.metadata.fields.push({ interface: IF.tank, field: 'statusBordcomputerAverage', present: true, members: [{ path: ['statusUnitOfMeasurementConsumptionBC'], type: 'enum', enum: units }] });
report.metadata.fields.push({ interface: IF.dsc, field: 'StabilizationManagement', present: true, members: ['qualifierFunctionFDR', 'qualifierFunctionASC', 'qualifierFunctionABS'].map(name => ({ path: [name], type: 'enum', enum: dscEnum })) });
['currentConsumption', 'averageConsumption'].forEach(field => report.metadata.fields.push({ interface: IF.reset, field, present: true, members: [
    { path: ['amount'], type: 'UInt16' }, { path: ['unit'], type: 'enum', enum: units }, { path: ['vin'], type: 'UInt64' }, { path: ['serialNumber'], type: 'UInt64' },
    { path: ['mileage'], type: 'UInt64' }, { path: ['location', 'latitude'], type: 'Float64' }, { path: ['freeText'], type: 'string' },
] }));
report.sources.injection.observations = 9;
report.sources.injection.stats.injectionVolumeFuelEngine = { first: 65530, latest: 5, min: 5, max: 65530, count: 9, firstMs: 123, latestMs: 29876 };
function check(result) {
    assert(result.pages.length <= 64);
    result.pages.forEach(page => { assert(page.title); assert(page.rows.length >= 1 && page.rows.length <= 4); page.rows.forEach(row => {
        assert.strictEqual(typeof row.label, 'string'); assert.strictEqual(typeof row.value, 'string');
        assert(!/\.\.\.|…/.test(row.value), 'raw values are never abbreviated with ellipses');
    }); });
    return result.pages.reduce((rows, page) => rows.concat(page.rows), []);
}
const original = JSON.stringify(report), formatted = values.format(report, 'ru'), rows = check(formatted), text = JSON.stringify(formatted);
assert.strictEqual(JSON.stringify(report), original, 'pure formatter never edits report data'); assert.strictEqual(formatted.simulation, false);
assert.strictEqual(formatted.pages[0].title, 'Диагностика · сводка'); assert.strictEqual(formatted.pages[1].title, 'Диагностика · сводка');
assert(rows.some(row => row.label === 'Полнота отображения'), 'four-row pagination retains the sixth summary row');
['Топливо · KombiIF', 'Расход · BC1 / BC2', 'Наддув · FES', 'Стабилизация · DSC', 'Расход · впрыск CDS2', 'Расход · ResetLogic текущий', 'Расход · ResetLogic средний'].forEach(title => assert(formatted.pages.some(p => p.title === title), 'source visible: ' + title));
assert(rows.some(r => /fluidLevelFuelTank/.test(r.label) && r.value === '36'));
assert(rows.some(r => /displayBoostPressure/.test(r.label) && r.value === '0'), 'zero remains a raw zero, not unavailable');
assert(rows.some(r => /qualifierFunctionFDR/.test(r.label) && r.value === '0'));
assert(!/DSC ON|DSC OFF|bar|л\/ч|л\/100|fuelK/.test(text), 'no invented scales, units or DSC state');
assert(rows.some(r => /первое raw/.test(r.label) && r.value === '65530'));
assert(rows.some(r => /min \/ max/.test(r.label) && r.value === '5 / 65530'));
assert(rows.some(r => /число значений/.test(r.label) && r.value === '9'));
assert(rows.some(r => /первое \/ последнее, мс/.test(r.label) && r.value === '123 / 29876'));
assert(rows.some(r => /Код единиц BC · имя/.test(r.label) && r.value === 'statusUnitOfMeasurementConsumptionBC'), 'long field name gets its own readable value row');
assert(rows.some(r => r.value === '2 = TEST_L100KM'), 'observed raw value maps only to a catalog enum');
const tableRows = formatted.pages.filter(p => /Таблица enum/.test(p.title)).reduce((a, p) => a.concat(p.rows), []);
assert.strictEqual(tableRows.filter(r => r.label === 'Код 7' && r.value === 'TEST_CODE_UNKNOWN').length, 1, 'identical DSC tables are shown once');
assert.strictEqual(tableRows.filter(r => r.label === 'Код 1' && r.value === 'TEST_LPH').length, 1, 'BC and ResetLogic share the exact same unit enum table');
assert(!/WBA123|mileageKilometre|serialNumber|location|PRIVATE_IDENTIFIER|999999|55555/.test(text), 'out-of-scope fields, names and values never enter UI');
assert.strictEqual(text.indexOf('privateSource'), -1);
const english = values.format(report, 'en'); const erows = check(english);
assert(erows.some(r => r.label === 'Display completeness')); assert(english.pages.some(p => p.title === 'Stabilization · DSC'));
assert(!/[А-Яа-яЁё]/.test(JSON.stringify(english)), 'English formatting has no Russian UI strings');
const simulator = copy(report); simulator.environment = 'bench'; simulator.simulation = false;
assert.strictEqual(values.format(simulator, 'ru').simulation, true); assert(JSON.stringify(values.format(simulator, 'ru')).includes('ИМИТАЦИЯ ДАННЫХ'));
const unknown = { environment: 'car', state: 'error', elapsedSeconds: 3, reason: 'speed-unknown', metadata: { status: 'limited', incomplete: true }, sources: {} };
const unavailable = values.format(unknown, 'ru'); check(unavailable);
assert(JSON.stringify(unavailable).includes('Скорость неизвестна')); assert(JSON.stringify(unavailable).includes('Не прочитан: лимит размера'));
assert(JSON.stringify(unavailable).includes('нет данных')); assert(unavailable.pages.some(p => p.title === 'Расход · ResetLogic текущий'));
assert.deepStrictEqual(values.format(null, 'ru'), { pages: [], simulation: false });
// A missing latest response cannot be replaced with an earlier observation.
const omitted = copy(report); omitted.sources.injection.latest = {}; omitted.sources.injection.reason = 'no-safe-values-in-observation';
const orows = check(values.format(omitted, 'ru'));
assert(orows.some(r => /injectionVolumeFuelEngine/.test(r.label) && r.value === 'нет данных'));
assert(orows.some(r => /последнее ранее raw/.test(r.label) && r.value === '5'));
const exact = copy(report); exact.sources.tank.latest.fluidLevelFuelTank = 1.2345678901234567e42;
assert(check(values.format(exact, 'ru')).some(r => r.value === String(1.2345678901234567e42)), 'full numeric precision survives unchanged');
const typed = copy(report); typed.sources.current.latest.amount = 'UNDECLARED_STRING'; typed.sources.current.stats.amount.first = 'UNDECLARED_STRING';
assert(!JSON.stringify(values.format(typed, 'ru')).includes('UNDECLARED_STRING'), 'numeric metadata never authorizes a live string');
// A long but valid enum is split with explicit part numbers, not clipped.
const longName = 'TEST_' + 'SEGMENT_'.repeat(12) + 'END';
const long = copy(report); long.metadata.fields[1].members[0].enum = [{ name: longName, value: 123 }]; long.sources.dsc.latest.qualifierFunctionFDR = 123;
const lrows = check(values.format(long, 'ru'));
const chunks = lrows.filter(r => /^Код 123 \(/.test(r.label)).map(r => r.value);
assert.strictEqual(chunks.join(''), longName); assert(chunks.every(s => s.length <= 48));
// Large enum tables remain bounded and their omissions are explicitly visible.
const large = copy(report);
large.metadata.fields[1].members.forEach((member, idx) => {
    member.enum = Array.from({ length: 128 }, (_, i) => ({ value: i, name: 'SCOPE_' + idx + '_CODE_' + i + '_' + 'SEGMENT_'.repeat(12) }));
});
const many = values.format(large, 'ru'), mrows = check(many);
assert.strictEqual(many.pages.length, 64); assert(mrows.some(r => r.label === 'Полнота отображения' && /Не показано строк: [1-9]/.test(r.value)));
const lastRaw = many.pages.map(p => p.title).lastIndexOf('Расход · ResetLogic средний');
const firstEnum = many.pages.findIndex(p => /Таблица enum/.test(p.title)); assert(lastRaw >= 0 && firstEnum > lastRaw, 'all raw source pages precede optional enum pages');
console.log('PASS diagnostic values: seven sources, four rows per page, raw precision, missing/history distinction, counter timing, scoped complete/deduplicated enums, RU/EN, privacy, purity and explicit 64-page limit (' + formatted.pages.length + ' normal fixture pages)');

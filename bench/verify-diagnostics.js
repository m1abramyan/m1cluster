'use strict';
// The real generated native RHMI text lists, collector and cluster on an isolated Mac bench.
// Every report/image produced here is explicitly simulation, never vehicle evidence.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { chromium } = require('./node_modules/playwright');
const { waitForScene, budget, signature } = require('./scene-check');
const values = require('../apps/manuk_retro_cluster/diagnostic_values');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8092);
assert(!base.endsWith(':8078'), 'Never mutate the live user bench');
const dataDir = process.env.BENCH_DATA_DIR;
assert(dataDir && path.isAbsolute(dataDir), 'Supply the isolated bench data directory');
const fixture = Object.assign({}, require('./profiles-fixture.json').signals, { speed: 0, gear: 0, selector: 'P', gearboxProgram: 'P' });
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 }), external = [];
        page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
        const post = async (url, data) => { const r = await page.request.post(base + url, { data }); assert(r.ok(), url + ': ' + r.status()); return r; };
        const snapshot = async () => (await page.request.get(base + '/snapshot')).json();
        const rhmi = async () => (await (await page.request.get(base + '/rhmi')).json()).snapshot;
        const component = (s, name) => s.screens.reduce((a, x) => a.concat(x.components), []).find(x => x.name === name);
        const text = (s, name) => component(s, name).rows[0].Text;
        async function wait(fn, what, timeout) {
            const until = Date.now() + (timeout || 10000);
            while (Date.now() < until) { const s = await rhmi(); if (fn(s)) return s; await page.waitForTimeout(100); }
            throw new Error('RHMI timeout: ' + what);
        }
        async function press(name) { const r = await post('/rhmi-action', { component: name, row: 0 }); await page.waitForTimeout(100); return (await r.json()).snapshot; }
        async function shot(file) { await page.screenshot({ path: path.join(root, 'artifacts', file), fullPage: true }); }
        await post('/drive', { value: 4 }); await post('/signals', { mode: 'manual', values: fixture });
        await page.goto(base + '/idrive'); const initial = await waitForScene(base), scene = signature(initial), subscriptions = initial.values.diagnostics.subscriptions;
        assert.equal(initial.values.configuration.language, 'ru');
        const config = JSON.stringify(initial.values.configuration);
        const reportPath = path.join(dataDir, 'diagnostics-last.json'), priorReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null;
        await press('BTN_DIAGNOSTICS');
        let state = await wait(s => s.activeState === 'DIAGNOSTICS' && /Готово/.test(text(s, 'DIAG_STATUS')), 'Idle diagnostics');
        assert(/ИМИТАЦИЯ/.test(text(state, 'DIAG_NOTE'))); assert.equal(component(state, 'DIAG_CANCEL').enabled, false);
        assert.equal(fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null, priorReport, 'Opening diagnostics must not collect or write a report');
        await shot('diagnostic_values_menu_ru.png');
        await press('DIAG_START'); await wait(s => component(s, 'DIAG_CANCEL').enabled, 'Collecting');
        await page.waitForTimeout(1100); await shot('diagnostic_values_collecting_SIMULATION.png');
        await press('DIAG_CANCEL'); state = await wait(s => /отменён/.test(text(s, 'DIAG_STATUS')), 'Cancellation');
        assert.equal(component(state, 'DIAG_SHOW_VALUES').enabled, true, 'A cancelled partial report is still exportable');
        // RHMI ACK and the independent 250-ms source telemetry are not one snapshot.
        // Let a post-cancel telemetry generation arrive before checking disposal.
        await page.waitForTimeout(500);
        await page.waitForFunction(async expected => {
            const s = await (await fetch('/snapshot')).json();
            return s.childPid === expected.pid && s.values.diagnostics.pid === expected.pid && s.values.diagnostics.subscriptions === expected.count;
        }, { pid: initial.childPid, count: subscriptions });
        const afterCancel = await snapshot();
        assert.equal(afterCancel.childPid, initial.childPid, 'Source rebuild interrupted the isolated test');
        assert.equal(afterCancel.values.diagnostics.subscriptions, subscriptions, 'Cancel subscription count ' + afterCancel.values.diagnostics.subscriptions + ', expected ' + subscriptions);
        await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { speed: 1 }) }); await page.waitForTimeout(400);
        await press('DIAG_START'); state = await wait(s => /движется/.test(text(s, 'DIAG_STATUS')), 'Moving guard refusal');
        assert.equal(component(state, 'DIAG_SHOW_VALUES').enabled, true, 'Guard refusal can be exported without claiming success');
        await shot('diagnostic_values_guard_SIMULATION.png');
        await post('/signals', { mode: 'manual', values: fixture }); await page.waitForTimeout(400);
        await press('DIAG_START'); await wait(s => /Сбор завершён/.test(text(s, 'DIAG_STATUS')), 'Full bounded collection', 36000);
        const report = JSON.parse(fs.readFileSync(path.join(dataDir, 'diagnostics-last.json'))), formatted = values.format(report, 'ru');
        assert.equal(report.simulation, true); assert.equal(report.confirmation, 'SIMULATION-NOT-VEHICLE-DATA'); assert.equal(report.state, 'complete');
        assert.equal(report.sources.tank.latest.fluidLevelFuelTank, 40);
        assert.equal(report.sources.bc.latest.consumptionAverage1BC1, 84);
        assert.equal(report.sources.boost.latest.displayBoostPressure, 80);
        assert.equal(report.sources.dsc.observations, 0, 'The bench display state DSC ON is never guessed into native raw qualifiers');
        assert(report.elapsedSeconds >= 29 && report.elapsedSeconds <= 30); assert(formatted.pages.length > 0);
        assert(formatted.simulation); assert(formatted.pages.every(p => p.rows.length <= 4));
        assert.equal(fs.statSync(path.join(dataDir, 'diagnostics-last.json')).mode & 0o777, 0o600);
        await shot('diagnostic_values_complete_SIMULATION.png'); await press('DIAG_SHOW_VALUES');
        const pages = [];
        async function checkValues(index, expected, language) {
            const current = await wait(s => s.activeState === 'DIAGNOSTIC_VALUES' && text(s, 'DIAGNOSTIC_VALUES_TITLE').includes((index + 1) + '/' + expected.length), 'Native values page');
            const title = text(current, 'DIAGNOSTIC_VALUES_TITLE'); assert(title.startsWith(expected[index].title));
            assert(!current.screens.some(s => /QR/.test(s.name)));
            assert(!current.screens.some(s => s.components.some(c => c.image || c.rows.some(r => Object.prototype.hasOwnProperty.call(r, 'Graphic')))), 'There must be no image path behind the native list');
            for (let row = 0; row < 4; row++) {
                const c = component(current, 'DIAG_VALUE_' + (row + 1)), actual = c.rows[0], expectedRow = expected[index].rows[row];
                assert.equal(c.visible, !!expectedRow);
                assert.equal(actual.Text1stRow, expectedRow ? expectedRow.label : '');
                assert.equal(actual.Text2ndRow, expectedRow ? expectedRow.value : '');
            }
            assert.equal(component(current, 'DIAG_VALUES_PREV').enabled, index > 0);
            assert.equal(component(current, 'DIAG_VALUES_NEXT').enabled, index + 1 < expected.length);
            // Confirm the rendered browser list contains both real RHMI text cells, not a hidden snapshot only.
            await page.waitForFunction(title => document.getElementById('screenTitle').textContent === title, title);
            const dom = await page.locator('.row.twoRows').allTextContents();
            assert.equal(dom.length, expected[index].rows.length);
            expected[index].rows.forEach((row, i) => { assert(dom[i].includes(row.label)); assert(dom[i].includes(row.value)); });
            await page.waitForTimeout(250);
            await page.evaluate(() => document.fonts.ready);
            const file = 'diagnostic_values_' + language + '_page' + String(index + 1).padStart(2, '0') + '_SIMULATION.png';
            await shot(file);
            return { title, rows: expected[index].rows, file };
        }
        for (let i = 0; i < formatted.pages.length; i++) {
            pages.push(await checkValues(i, formatted.pages, 'ru'));
            if (i + 1 < formatted.pages.length) await press('DIAG_VALUES_NEXT');
        }
        if (pages.length > 1) { await press('DIAG_VALUES_PREV'); state = await rhmi(); assert(text(state, 'DIAGNOSTIC_VALUES_TITLE').includes((pages.length - 1) + '/' + pages.length)); }
        assert.equal(signature(await snapshot()), scene, 'Collection and values navigation preserve every cluster layer ID and pixel budget');
        await press('DIAG_VALUES_BACK'); await press('DIAG_BACK'); await press('BTN_LANGUAGE'); await press('LANG_EN'); await press('BTN_LANGUAGE_BACK'); await press('BTN_DIAGNOSTICS');
        state = await rhmi(); assert(/SIMULATED DATA/.test(text(state, 'DIAG_NOTE'))); assert(/Collection complete/.test(text(state, 'DIAG_STATUS')));
        assert(!/[А-Яа-яЁё]/.test(JSON.stringify(state.screens.find(s => s.name === 'DIAGNOSTICS').components.map(c => c.rows))));
        await shot('diagnostic_values_menu_en.png');
        await press('DIAG_SHOW_VALUES'); await checkValues(0, values.format(report, 'en').pages, 'en'); await press('DIAG_VALUES_BACK');
        await press('DIAG_BACK'); await press('BTN_LANGUAGE'); await press('LANG_RU'); await press('BTN_LANGUAGE_BACK');
        const final = await waitForScene(base);
        assert.equal(final.values.diagnostics.subscriptions, subscriptions); assert.equal(JSON.stringify(final.values.configuration), config);
        assert.equal(final.values.diagnostics.intervals, initial.values.diagnostics.intervals, 'No collector interval survives completion');
        assert.deepStrictEqual(external, [], 'No automatic remote requests');
        fs.writeFileSync(path.join(root, 'artifacts/diagnostic_values_report_SIMULATION.json'), JSON.stringify(report, null, 2) + '\n');
        const result = { status: 'passed', scope: 'Isolated Mac bench only; simulated input, no car connection and no live 8078 changes',
            checks: ['Real generated RHMI components and app handlers', 'No collection on menu open', 'Explicit start, cancel, parked guard refusal and 30-second completion', 'Cancelled/error reports exported honestly',
                'Every native two-row value exactly matches the report formatter, with bounded previous/next navigation', 'No canvas screen, Graphic cell, image or QR path', 'RU/EN labels and explicit simulation marker', 'Collector subscriptions disposed; cluster geometry/memory preserved', 'No automatic remote request'],
            durationSeconds: report.elapsedSeconds, valuePages: pages, scene: budget(final), sourceStatuses: Object.keys(report.sources).reduce((a, k) => { a[k] = report.sources[k].reason || report.sources[k].status; return a; }, {}),
            testServerStopped: false };
        fs.writeFileSync(path.join(root, 'artifacts/diagnostic-values-ui-verification.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ passed: true, pages: pages.length, seconds: report.elapsedSeconds, scene: result.scene }));
    } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

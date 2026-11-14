'use strict';
// The real generated RHMI UI, collector, QR encoder and cluster on an isolated Mac bench.
// Every report/image produced here is explicitly simulation, never vehicle evidence.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./node_modules/playwright');
const { waitForScene, budget, signature } = require('./scene-check');
const Diagnostic = require('../apps/manuk_retro_cluster/diagnostics');
const qr = require('../apps/manuk_retro_cluster/diagnostic_qr');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8092);
assert(!base.endsWith(':8078'), 'Never mutate the live user bench');
const dataDir = process.env.BENCH_DATA_DIR;
assert(dataDir && path.isAbsolute(dataDir), 'Supply the isolated bench data directory');
const fixture = Object.assign({}, require('./profiles-fixture.json').signals, { speed: 0, gear: 0, selector: 'P', gearboxProgram: 'P' });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
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
        await shot('diagnostics_menu_ru.png');
        await press('DIAG_START'); await wait(s => component(s, 'DIAG_CANCEL').enabled, 'Collecting');
        await page.waitForTimeout(1100); await shot('diagnostics_collecting_SIMULATION.png');
        await press('DIAG_CANCEL'); state = await wait(s => /отменён/.test(text(s, 'DIAG_STATUS')), 'Cancellation');
        assert.equal(component(state, 'DIAG_SHOW_QR').enabled, true, 'A cancelled partial report is still exportable');
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
        assert.equal(component(state, 'DIAG_SHOW_QR').enabled, true, 'Guard refusal can be exported without claiming success');
        await shot('diagnostics_guard_SIMULATION.png');
        await post('/signals', { mode: 'manual', values: fixture }); await page.waitForTimeout(400);
        await press('DIAG_START'); await wait(s => /Сбор завершён/.test(text(s, 'DIAG_STATUS')), 'Full bounded collection', 36000);
        const report = JSON.parse(fs.readFileSync(path.join(dataDir, 'diagnostics-last.json'))), payloads = Diagnostic.qrPages(report);
        assert.equal(report.simulation, true); assert.equal(report.confirmation, 'SIMULATION-NOT-VEHICLE-DATA'); assert.equal(report.state, 'complete');
        assert.equal(report.sources.tank.latest.fluidLevelFuelTank, 40);
        assert.equal(report.sources.bc.latest.consumptionAverage1BC1, 84);
        assert.equal(report.sources.boost.latest.displayBoostPressure, 80);
        assert.equal(report.sources.dsc.observations, 0, 'The bench display state DSC ON is never guessed into native raw qualifiers');
        assert(report.elapsedSeconds >= 29 && report.elapsedSeconds <= 30); assert(payloads.length > 0 && payloads.length <= 64);
        assert(payloads.every(p => Buffer.byteLength(p) <= 900));
        assert.equal(fs.statSync(path.join(dataDir, 'diagnostics-last.json')).mode & 0o777, 0o600);
        await shot('diagnostics_complete_SIMULATION.png'); await press('DIAG_SHOW_QR');
        const pages = [];
        for (let i = 0; i < payloads.length; i++) {
            state = await wait(s => s.activeState === 'DIAGNOSTIC_QR' && text(s, 'DIAGNOSTIC_QR_TITLE').includes((i + 1) + '/' + payloads.length), 'QR page');
            const image = component(state, 'DIAG_QR_GFX').image;
            assert(image && image.mimeType === 'image/png'); const png = Buffer.from(image.data, 'base64');
            assert(png.equals(qr.encode(payloads[i]).png), 'Actual RHMI image equals the application QR payload encoder');
            const file = 'diagnostic_qr_page' + String(i + 1).padStart(2, '0') + '_SIMULATION.png'; fs.writeFileSync(path.join(root, 'artifacts', file), png);
            const env = JSON.parse(payloads[i]); assert.equal(env.environment, 'bench');
            pages.push({ file, width: image.width, height: image.height, payloadBytes: Buffer.byteLength(payloads[i]), pngSHA256: sha(png) });
            if (i === 0) await shot('diagnostics_qr_preview_SIMULATION.png');
            assert.equal(component(state, 'DIAG_QR_PREV').enabled, i > 0); assert.equal(component(state, 'DIAG_QR_NEXT').enabled, i + 1 < payloads.length);
            if (i + 1 < payloads.length) await press('DIAG_QR_NEXT');
        }
        if (pages.length > 1) { await press('DIAG_QR_PREV'); state = await rhmi(); assert(text(state, 'DIAGNOSTIC_QR_TITLE').includes((pages.length - 1) + '/' + pages.length)); }
        assert.equal(signature(await snapshot()), scene, 'Collection and QR navigation preserve every cluster layer ID and pixel budget');
        await press('DIAG_QR_BACK'); await press('DIAG_BACK'); await press('BTN_LANGUAGE'); await press('LANG_EN'); await press('BTN_LANGUAGE_BACK'); await press('BTN_DIAGNOSTICS');
        state = await rhmi(); assert(/SIMULATED DATA/.test(text(state, 'DIAG_NOTE'))); assert(/Collection complete/.test(text(state, 'DIAG_STATUS')));
        assert(!/[А-Яа-яЁё]/.test(JSON.stringify(state.screens.find(s => s.name === 'DIAGNOSTICS').components.map(c => c.rows))));
        await shot('diagnostics_menu_en.png');
        await press('DIAG_BACK'); await press('BTN_LANGUAGE'); await press('LANG_RU'); await press('BTN_LANGUAGE_BACK');
        const final = await waitForScene(base);
        assert.equal(final.values.diagnostics.subscriptions, subscriptions); assert.equal(JSON.stringify(final.values.configuration), config);
        assert.equal(final.values.diagnostics.intervals, initial.values.diagnostics.intervals, 'No collector interval survives completion');
        assert.deepStrictEqual(external, [], 'No automatic remote requests');
        fs.writeFileSync(path.join(root, 'artifacts/diagnostics_report_SIMULATION.json'), JSON.stringify(report, null, 2) + '\n');
        fs.writeFileSync(path.join(root, 'artifacts/diagnostics_qr_payloads_SIMULATION.json'), JSON.stringify(payloads, null, 2) + '\n');
        const result = { status: 'passed', scope: 'Isolated Mac bench only; simulated input, no car connection and no live 8078 changes',
            checks: ['Real generated RHMI components and app handlers', 'No collection on menu open', 'Explicit start, cancel, parked guard refusal and 30-second completion', 'Cancelled/error reports exported honestly',
                'Actual application PNG for every variable-length QR page, native previous/next limits', 'RU/EN labels and explicit simulation marker', 'Collector subscriptions disposed; cluster geometry/memory preserved', 'No automatic remote request'],
            durationSeconds: report.elapsedSeconds, qrPages: pages, scene: budget(final), sourceStatuses: Object.keys(report.sources).reduce((a, k) => { a[k] = report.sources[k].reason || report.sources[k].status; return a; }, {}),
            independentQrDecode: 'Pending independent decoder; image equality alone does not prove scan readability', testServerStopped: false };
        fs.writeFileSync(path.join(root, 'artifacts/diagnostics-ui-verification.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ passed: true, pages: pages.length, seconds: report.elapsedSeconds, scene: result.scene }));
    } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

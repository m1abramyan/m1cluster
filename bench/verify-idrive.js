'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./node_modules/playwright'), { PNG } = require('./node_modules/pngjs');
const scene = require('./scene-check'), fixture = require('./profiles-fixture.json').signals;
const view = require('../apps/manuk_retro_cluster/profile_view'), locale = require('../apps/manuk_retro_cluster/dashboard_locale');
const original = require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json'), labels = require('../apps/manuk_retro_cluster/settings_ui').LABELS;
const base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8090);
assert(!base.endsWith(':8078'), 'Use an isolated settings bench; never mutate the live user session');
function glyphCheck(png, config, id, value) {
    const box = view.layout(locale.layout(original, config), config).widgets.find(w => w.id === id); assert(box, id);
    const font = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/manuk_retro_cluster/hud/fonts', box.font + '.json'))), alpha = Buffer.from(font.alpha, 'base64');
    const chars = Array.from(value), width = chars.reduce((n, c) => n + font.glyphs[c].advance, 0), mask = Buffer.alloc(box.w * box.h);
    let pen = box.align === 'right' ? box.w - width : box.align === 'center' ? Math.round((box.w - width) / 2) : 0;
    chars.forEach(c => { const g = font.glyphs[c], left = Math.round(pen + g.ox);
        for (let y = 0; y < Math.min(g.h, box.h); y++) for (let x = 0; x < g.w; x++) if (left + x >= 0 && left + x < box.w) {
            const p = y * box.w + left + x; mask[p] = Math.max(mask[p], alpha[(g.y + y) * font.width + g.x + x]);
        } pen += g.advance;
    });
    let solid = 0, dark = 0;
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
        const a = mask[y * box.w + x], p = ((box.y + y) * png.width + box.x + x) * 4;
        if (a === 255) { solid++; assert([190, 198, 204].every((v, i) => Math.abs(png.data[p + i] - v) <= 2), id + ' contains the expected solid glyph pixels for ' + value); }
        if (a === 0) { dark++; assert(Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) <= 50, id + ' has no extra bright segments outside ' + value); }
    }
    assert(solid > 10); return { id, value, font: box.font, solidPixels: solid, darkOrGhostPixels: dark };
}
(async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const cluster = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 });
    const errors = []; [page, cluster].forEach(p => p.on('pageerror', e => errors.push(e.message)));
    const get = async () => (await page.request.get(base + '/snapshot')).json();
    const rhmi = async () => (await (await page.request.get(base + '/rhmi')).json()).snapshot;
    const post = async (url, data) => { const r = await page.request.post(base + url, { data: data || {} }); assert(r.ok(), url + ': ' + r.status()); return r; };
    async function wait(fn, label) { const until = Date.now() + 20000; let last; while (Date.now() < until) { last = await get(); if (fn(last)) return last; await page.waitForTimeout(100); } throw new Error('Timed out ' + label + ': ' + JSON.stringify(last && last.values && last.values.configuration)); }
    const component = (s, id) => s.screens.reduce((all, screen) => all.concat(screen.components), []).find(c => c.name === id);
    async function press(id) { await page.locator('[data-component="' + id + '"]').click(); await page.waitForFunction(() => Array.from(document.querySelectorAll('#components button')).every(b => !b.disabled)); await page.waitForTimeout(120); return rhmi(); }
    async function state(name) { await page.waitForFunction(name => document.getElementById('nativeScreen').dataset.state === name, name); }
    const screenShot = async name => page.screenshot({ path: path.resolve('artifacts/' + name), fullPage: true });
    const frame = async file => PNG.sync.read(await cluster.locator('#hud').screenshot(file ? { path: path.resolve('artifacts/' + file) } : {}));
    let restoredConfig;
    try {
        const initial = await get(); assert.equal(initial.clock, '14:36'); restoredConfig = JSON.parse(JSON.stringify(initial.values.configuration));
        const config = JSON.parse(JSON.stringify(restoredConfig)); config.enabled = true; config.language = 'ru'; config.startup.onEngineStart = false;
        config.displayUnits = { speed: 'kmh', temperature: 'c', pressure: 'bar', consumption: 'l100km' }; config.profiles.enabled = true;
        await post('/configuration', { configuration: config }); await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 });
        await page.goto(base + '/idrive'); await cluster.goto(base + '/?only=1&clean=1&car=0'); await state('MAIN');
        const start = await scene.waitForScene(base, cluster), resources = { layers: start.layers.length, pixels: start.pixels, subscriptions: start.values.diagnostics.subscriptions, intervals: start.values.diagnostics.intervals };
        assert(!('widgets' in start.values.configuration)); assert(!('currentWidget' in start.values)); assert.equal((await page.request.post(base + '/widget', { data: { id: 'music' } })).status(), 404);
        let s = await rhmi(); assert.equal(s.activeState, 'MAIN');
        assert.deepStrictEqual(s.screens.find(x => x.name === 'MAIN').components.filter(c => c.focusable).map(c => c.name), ['SET_ENABLED', 'SET_ENGINE_START', 'BTN_LANGUAGE', 'BTN_UNITS', 'BTN_DIAGNOSTICS']);
        assert.equal(component(s, 'SET_ENABLED').rows[0].Text, labels.ru.enabled); assert.equal(component(s, 'SET_ENGINE_START').rows[0].Text, labels.ru.engine);
        await page.waitForFunction(() => document.getElementById('appIcon').naturalWidth > 0);
        const icon = await (await page.request.get(base + '/rhmi-icon')).body(), packedIcon = fs.readFileSync(path.join(start.stage, 'rhmiData/resources', s.app.icon));
        assert(icon.equals(packedIcon), 'Preview uses the actual packaged app icon');
        const iconSha256 = crypto.createHash('sha256').update(icon).digest('hex');
        await screenShot('idrive_settings_ru.png');
        for (const request of [{ component: 'NO_SUCH_COMPONENT' }, { component: 'LANG_EN' }, { component: 'SET_ENABLED', row: -1 }, { component: 'SET_ENABLED', row: 4 }, { component: 'ENGINE_START_NOTE' }]) {
            assert.equal((await page.request.post(base + '/rhmi-action', { data: request })).status(), 422, 'Reject invalid or invisible RHMI action');
        }
        await press('SET_ENABLED'); await wait(s => s.values.configuration.enabled === false && s.layers.length === 0, 'checkbox disables own scene');
        assert.equal(component(await rhmi(), 'SET_ENABLED').rows[0].eParam_RowSelected, false);
        await press('SET_ENABLED'); await scene.waitForScene(base, cluster);
        const checks = ['Actual generated RHMI state/component definitions, live text/cells/checkbox values and packaged icon', 'Invalid, hidden and non-focusable actions rejected; enable checkbox releases and restores the own scene'];
        await press('BTN_LANGUAGE'); await state('LANGUAGE'); await screenShot('idrive_language_ru.png');
        await press('LANG_EN'); await wait(s => s.values.configuration.language === 'en', 'English saved');
        s = await rhmi(); assert.equal(component(s, 'LANG_EN').rows[0].eParam_RowSelected, true); assert.equal(component(s, 'LANG_RU').rows[0].eParam_RowSelected, false);
        await press('BTN_LANGUAGE_BACK'); await state('MAIN'); await scene.waitForScene(base, cluster);
        s = await rhmi(); const mainRows = s.screens.find(x => x.name === 'MAIN').components;
        assert(!/[А-Яа-яЁё]/.test(JSON.stringify(mainRows.map(c => c.rows))), 'All MAIN application labels/status are English');
        assert.equal(component(s, 'SET_ENABLED').rows[0].Text, labels.en.enabled); assert.equal(component(s, 'SET_ENGINE_START').rows[0].Text, labels.en.engine);
        await screenShot('idrive_settings_en.png');
        await press('BTN_UNITS'); await state('UNITS');
        const expected = { speed: 'kmh', temperature: 'c', pressure: 'bar', consumption: 'l100km' }, conversions = [];
        const unitCases = [
            ['UNIT_SPEED', 'speed', 'mph', [['speed', '55'], ['range', '280'], ['oil', '100'], ['boost', '0.80'], ['consumption', '7.6']]],
            ['UNIT_TEMPERATURE', 'temperature', 'f', [['speed', '55'], ['oil', '212'], ['coolant', '194'], ['boost', '0.80'], ['consumption', '7.6']]],
            ['UNIT_PRESSURE', 'pressure', 'psi', [['speed', '55'], ['oil', '212'], ['boost', '11.6'], ['consumption', '7.6']]],
            ['UNIT_CONSUMPTION', 'consumption', 'mpg', [['speed', '55'], ['oil', '212'], ['boost', '11.6'], ['consumption', '30.9']]]
        ];
        for (const [id, kind, value, fields] of unitCases) {
            await press(id); expected[kind] = value;
            const changed = await wait(s => JSON.stringify(s.values.configuration.displayUnits) === JSON.stringify(expected), 'independent unit ' + kind);
            await scene.waitForScene(base, cluster); await page.waitForTimeout(600);
            const png = await frame(); fields.forEach(([key, text]) => conversions.push(glyphCheck(png, changed.values.configuration, key, text)));
            assert.equal(changed.values.values.speed, 88); assert.equal(changed.values.values.oil, 100); assert.equal(changed.values.values.boost, 0.8); assert.equal(changed.values.values.consumption, 7.6);
        }
        await screenShot('idrive_units_en.png'); await frame('idrive_units_cluster.png');
        checks.push('Language updates all actual MAIN labels/status; four unit actions save independently and real canvas atlas pixels show conversions while source values remain canonical');
        await press('BTN_UNITS_BACK'); await state('MAIN');
        const stopped = Object.assign({}, fixture, { speed: 0, rpm: 0, gear: null, selector: 'P', engineRunning: false });
        await post('/signals', { mode: 'manual', values: stopped }); await wait(s => s.values.readings.engineRunning.value === 'off', 'real normalizer engine-off observation');
        await press('SET_ENGINE_START'); await wait(s => s.values.configuration.startup.onEngineStart && s.layers.length === 0, 'waiting for first engine start');
        await screenShot('idrive_engine_waiting.png');
        const persisted = (await get()).values.configuration, oldPid = (await get()).childPid;
        await post('/restart'); await wait(s => s.childPid !== oldPid && s.values && s.values.diagnostics.pid === s.childPid && s.values.configuration.startup.onEngineStart && s.layers.length === 0, 'restart without first HUD');
        await state('MAIN'); assert.deepStrictEqual((await get()).values.configuration, persisted);
        assert.equal(component(await rhmi(), 'SET_ENGINE_START').rows[0].eParam_RowSelected, true);
        await post('/signals', { mode: 'manual', values: Object.assign({}, stopped, { engineRunning: true, rpm: 900 }) }); await scene.waitForScene(base, cluster);
        await post('/signals', { mode: 'manual', values: stopped }); await wait(s => s.values.readings.engineRunning.value === 'off', 'stop-start off within same epoch'); await page.waitForTimeout(450);
        assert.equal((await get()).layers.length, resources.layers, 'Automatic stop/start does not discard the observed start in the same lifecycle');
        await post('/signals', { mode: 'manual', values: Object.assign({}, stopped, { condition: 5 }) }); await wait(s => s.layers.length === 0, 'sleep releases scene');
        await post('/signals', { mode: 'manual', values: stopped }); await wait(s => s.values.readings.engineRunning.value === 'off', 'wake with engine still off'); await page.waitForTimeout(450);
        assert.equal((await get()).layers.length, 0, 'A new vehicle epoch requires a new confirmed start');
        await press('SET_ENGINE_START'); await scene.waitForScene(base, cluster);
        checks.push('Engine gate waits for confirmed running, persists over process restart, survives stop/start within one epoch and resets after sleep; no process autostart is simulated');
        await post('/signals', { mode: 'manual', values: fixture }); await press('BTN_LANGUAGE'); await state('LANGUAGE'); await press('LANG_RU'); await press('BTN_LANGUAGE_BACK'); await state('MAIN');
        await press('BTN_UNITS'); await state('UNITS');
        for (const [id] of unitCases) await press(id);
        await screenShot('idrive_units.png'); await press('BTN_UNITS_BACK'); await state('MAIN');
        const complete = await scene.waitForScene(base, cluster); assert.equal(complete.layers.length, resources.layers); assert.equal(complete.pixels, resources.pixels);
        assert.equal(complete.values.diagnostics.subscriptions, resources.subscriptions); assert.equal(complete.values.diagnostics.intervals, resources.intervals);
        const pkg = JSON.parse(fs.readFileSync(path.join(complete.stage, 'source/package.json'))); assert.equal(pkg.mguAppStartType, 'manually');
        assert.deepStrictEqual(errors, []);
        const report = { scope: 'Local adapter of real app RHMI calls and generated package UI; not a BMW display or installation test. No car access.',
            checks, iconSha256, conversions, engineStartUsesReadOnlySource: true, storeStartType: pkg.mguAppStartType, resources, browserErrors: errors,
            images: ['idrive_settings_ru.png', 'idrive_settings_en.png', 'idrive_language_ru.png', 'idrive_units_en.png', 'idrive_units.png', 'idrive_units_cluster.png', 'idrive_engine_waiting.png'] };
        fs.writeFileSync(path.resolve('artifacts/idrive-verification.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
    } finally {
        try { if (restoredConfig) await post('/configuration', { configuration: restoredConfig }); await post('/signals', { mode: 'manual', values: fixture }); }
        finally { await browser.close(); }
    }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

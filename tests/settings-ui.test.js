'use strict';
// Exercise the real settings handlers and real atomic ConfigStore; no vehicle or native SDK.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const spec = require('../apps/manuk_retro_cluster/app.json');
const settings = require('../apps/manuk_retro_cluster/settings_ui');
const diagnosticValues = require('../apps/manuk_retro_cluster/diagnostic_values');
const locale = require('../apps/manuk_retro_cluster/locale');
const ConfigStore = require('../apps/manuk_retro_cluster/config').ConfigStore;
const copy = (v) => JSON.parse(JSON.stringify(v));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-settings-ui-'));
const errors = [], log = { info() {}, warn(s) { errors.push(s); }, error(s) { errors.push(s); } };

function fakeUi() {
    const components = {}, handlers = {}, visible = [], opens = [], closes = []; let current = 'MAIN';
    spec.screens.forEach((s) => {
        components[s.name + '_TITLE'] = { kind: 'title', text: s.title };
        (s.items || []).forEach((item) => { components[item[1]] = { kind: item[0], text: item[2] }; });
        if (s.graphic) components[s.graphic] = { kind: 'graphic' };
        (s.buttons || []).forEach(item => { components[item[0]] = { kind: 'barbutton', text: item[1] }; });
    });
    function component(name) { assert(components[name], 'Unknown RHMI component: ' + name); return components[name]; }
    return {
        components, handlers, opens, closes,
        text(name, value) { component(name).text = value; return Promise.resolve(); },
        cells(name, row, values) { assert.strictEqual(row, 0); assert(['twocol', 'tworow'].includes(component(name).kind)); component(name).cells = copy(values); return Promise.resolve(); },
        checked(name, checked) { assert.strictEqual(component(name).kind, 'checkbox'); component(name).checked = checked; return Promise.resolve(); },
        enabled(name, value) { component(name).enabled = value; return Promise.resolve(); },
        visible(name, value) { component(name).visible = value; return Promise.resolve(); },
        image() { throw new Error('Diagnostic values must use native text, never an image'); },
        onClick(name, fn) { assert(['checkbox', 'twocol', 'button', 'barbutton'].indexOf(component(name).kind) >= 0); assert(!handlers[name]); handlers[name] = fn; },
        onVisible(fn) { visible.push(fn); },
        isVisible(name) { return current === name; },
        open(name) { assert(spec.screens.some((s) => s.name === name)); opens.push(name); current = name; visible.forEach(fn => fn(name, true)); return Promise.resolve(); },
        close(name) { closes.push(name); current = name === 'DIAGNOSTIC_VALUES' ? 'DIAGNOSTICS' : 'MAIN'; return Promise.resolve(); },
        show(name) { visible.forEach((fn) => fn(name, true)); },
        click(name) { assert(handlers[name], 'Missing RHMI handler: ' + name); return handlers[name]({ row: 0 }); }
    };
}
function controller(store) {
    const c = { store, currentStatus: 'not started', listeners: [], enabledCalls: [], engineCalls: [] };
    c.setEnabled = (value) => { c.enabledCalls.push(value); const next = copy(store.current); next.enabled = value; store.save(next); };
    c.setEngineStart = (value) => { c.engineCalls.push(value); const next = copy(store.current); next.startup.onEngineStart = value; store.save(next); };
    c.onStatus = (fn) => { c.listeners.push(fn); fn(c.currentStatus); return () => { c.listeners = c.listeners.filter((v) => v !== fn); }; };
    c.status = (value) => { c.currentStatus = value; c.listeners.slice().forEach((fn) => fn(value)); };
    let d = { state: 'idle', elapsedSeconds: 0, report: null };
    c.diagnostics = { listeners: [], starts: 0, cancels: 0, snapshot: () => d,
        onChange(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; },
        set(value) { d = value; this.listeners.slice().forEach(fn => fn(d)); },
        start() { this.starts++; this.set({ state: 'collecting', elapsedSeconds: 0, report: null }); return new Promise(() => {}); },
        cancel() { this.cancels++; this.set({ state: 'cancelled', elapsedSeconds: 2, report: null }); }
    };
    return c;
}

(async () => {
    const store = new ConfigStore(dir, 'car', log), c = controller(store), ui = fakeUi();
    const screen = settings.attach({ ui, log }, c);
    await screen.ready;
    assert.strictEqual(spec.version, require('../package.json').version, 'Application and development package versions must agree');
    assert.strictEqual(spec.title, 'Retro Cluster');
    assert.strictEqual(spec.mguAppStartType, 'manually');
    assert.deepStrictEqual(spec.settings, [], 'Generic settings.json must not become a second state owner');
    assert.deepStrictEqual(spec.screens.map((s) => s.name), ['MAIN', 'LANGUAGE', 'UNITS', 'DIAGNOSTICS', 'DIAGNOSTIC_VALUES']);
    assert(!JSON.stringify(spec.screens).match(/WIDGET|BTN_STOP|BTN_START|QR|GFX/));
    assert(spec.screens.every(s => s.kind === 'menu'), 'No canvas may activate the central renderer');
    assert.deepStrictEqual(ui.opens, [], 'Background initialization must never open a page');
    assert.strictEqual(ui.components.SET_ENABLED.checked, false);
    assert.strictEqual(ui.components.SET_ENGINE_START.checked, false);
    assert.strictEqual(ui.components.LANG_RU.checked, true);
    assert.strictEqual(ui.components.LANG_EN.checked, false);
    assert(/ручной запуск/.test(ui.components.ENGINE_START_NOTE.text));
    assert.strictEqual(store.listeners.length, 1);
    assert.strictEqual(c.listeners.length, 1);
    assert.strictEqual(c.diagnostics.starts, 0, 'Collection never begins during initialization');

    const protectedConfig = copy(store.current);
    await ui.click('SET_ENABLED');
    await ui.click('SET_ENGINE_START');
    assert.deepStrictEqual(c.enabledCalls, [true]);
    assert.deepStrictEqual(c.engineCalls, [true]);
    assert.strictEqual(store.current.enabled, true);
    assert.strictEqual(store.current.startup.onEngineStart, true);
    assert.strictEqual(store.current.startup.mode, 'manually', 'Engine gate does not enable Store autostart');
    assert.strictEqual(ui.components.SET_ENABLED.checked, true);
    assert.strictEqual(ui.components.SET_ENGINE_START.checked, true);

    await ui.click('BTN_LANGUAGE');
    assert.deepStrictEqual(ui.opens, ['LANGUAGE']);
    await ui.click('LANG_EN');
    assert.strictEqual(store.current.language, 'en');
    assert.strictEqual(ui.components.SET_ENABLED.text, 'Enable cluster display');
    assert.strictEqual(ui.components.SET_ENGINE_START.text, 'Enable when the engine starts');
    assert(/manually/.test(ui.components.ENGINE_START_NOTE.text));
    assert.strictEqual(ui.components.LANGUAGE_TITLE.text, 'Language');
    assert.strictEqual(ui.components.UNITS_TITLE.text, 'Units');
    assert.strictEqual(ui.components.LANG_RU.checked, false);
    assert.strictEqual(ui.components.LANG_EN.checked, true);
    assert.deepStrictEqual(ui.components.BTN_LANGUAGE.cells, { Text1stCol: 'Language', Text2ndCol: 'English' });
    assert.strictEqual(ui.components.BTN_LANGUAGE_BACK.text, 'Back');
    assert.strictEqual(ui.components.BTN_UNITS_BACK.text, 'Back');
    await ui.click('BTN_LANGUAGE_BACK');
    await ui.click('BTN_UNITS');
    assert.deepStrictEqual(ui.closes, ['LANGUAGE']);
    assert.deepStrictEqual(ui.opens, ['LANGUAGE', 'UNITS']);

    const keys = ['speed', 'temperature', 'pressure', 'consumption'];
    const ids = ['UNIT_SPEED', 'UNIT_TEMPERATURE', 'UNIT_PRESSURE', 'UNIT_CONSUMPTION'];
    const selections = ['mph', 'f', 'psi', 'mpg'];
    const labels = ['mph', '°F', 'psi', 'mpg (US)'];
    for (let i = 0; i < keys.length; i++) {
        const before = copy(store.current.displayUnits);
        await ui.click(ids[i]);
        assert.strictEqual(store.current.displayUnits[keys[i]], selections[i]);
        keys.filter((key) => key !== keys[i]).forEach((key) => assert.strictEqual(store.current.displayUnits[key], before[key], 'Units remain independent'));
        assert.strictEqual(ui.components[ids[i]].cells.Text2ndCol, labels[i]);
    }
    assert.strictEqual(store.current.units, protectedConfig.units, 'Legacy archived Retro preset is not overwritten by independent units');
    assert.deepStrictEqual(store.current.safety, protectedConfig.safety);
    assert.deepStrictEqual(store.current.retro, protectedConfig.retro);
    assert.deepStrictEqual(store.current.profiles, protectedConfig.profiles);
    assert.deepStrictEqual(store.current.renderer, protectedConfig.renderer);
    await ui.click('BTN_UNITS_BACK');
    assert.deepStrictEqual(ui.closes, ['LANGUAGE', 'UNITS']);
    const reopened = new ConfigStore(dir, 'car', log);
    assert.deepStrictEqual(reopened.current, store.current, 'All settings survive a new ConfigStore instance');
    assert.strictEqual(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(dir), ['manuk_retro_cluster.json']);
    reopened.stop();

    await Promise.all([ui.click('UNIT_SPEED'), ui.click('UNIT_SPEED')]);
    assert.strictEqual(store.current.displayUnits.speed, 'mph', 'Rapid actions are serialized against the latest saved state');
    await ui.click('SET_ENABLED');
    await ui.click('SET_ENGINE_START');
    assert.deepStrictEqual(c.enabledCalls, [true, false]);
    assert.deepStrictEqual(c.engineCalls, [true, false]);

    const external = copy(store.current); external.language = 'ru'; external.displayUnits.pressure = 'bar';
    store.save(external);
    await screen.refresh();
    assert.strictEqual(ui.components.UNIT_PRESSURE.cells.Text2ndCol, 'бар');
    assert.strictEqual(ui.components.SET_ENABLED.text, 'Включить приборку');
    assert.strictEqual(ui.components.LANG_RU.checked, true);

    c.status('waiting for confirmed engine state; own layers released');
    await screen.refresh();
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, 'Ожидание данных о двигателе');
    assert(/подтверждённого состояния двигателя/.test(locale.status(c.currentStatus)));
    c.status('waiting for engine start; own layers released');
    await screen.refresh();
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, 'Ожидание запуска двигателя');
    assert(/Ожидание запуска двигателя/.test(locale.status(c.currentStatus)));
    await ui.click('LANG_EN');
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, 'Waiting for the engine to start');

    // Fail the actual atomic rename, after the temporary file has been written and fsynced.
    const rename = fs.renameSync, persisted = fs.readFileSync(store.file, 'utf8'), actual = copy(store.current);
    fs.renameSync = (from, to) => { if (to === store.file) throw new Error('synthetic write failure'); return rename(from, to); };
    try {
        for (const id of ['SET_ENABLED', 'SET_ENGINE_START', 'LANG_RU', 'UNIT_TEMPERATURE']) {
            if (ui.components[id].kind === 'checkbox') ui.components[id].checked = true;
            await ui.click(id);
            assert.deepStrictEqual(store.current, actual, 'Failed atomic save cannot become current UI state');
            assert.strictEqual(fs.readFileSync(store.file, 'utf8'), persisted);
            assert.strictEqual(ui.components.SET_ENABLED.checked, actual.enabled);
            assert.strictEqual(ui.components.SET_ENGINE_START.checked, actual.startup.onEngineStart);
            assert.strictEqual(ui.components.LANG_RU.checked, false);
            assert.strictEqual(ui.components.LANG_EN.checked, true);
            assert.strictEqual(ui.components.UNIT_TEMPERATURE.cells.Text2ndCol, '°F');
            assert.strictEqual(ui.components.SETTINGS_STATUS.text, settings.LABELS.en.saveError);
            assert.deepStrictEqual(fs.readdirSync(dir), ['manuk_retro_cluster.json'], 'Temporary files are cleaned on a failed save');
        }
    } finally { fs.renameSync = rename; }
    assert.strictEqual(errors.filter((s) => s === 'settings persistence failed').length, 4);
    await ui.click('LANG_RU');
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, 'Ожидание запуска двигателя', 'Successful retry clears the save error');

    const open = ui.open;
    ui.open = () => Promise.reject(new Error('synthetic HMI rejection'));
    await ui.click('BTN_LANGUAGE');
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, settings.LABELS.ru.screenError);
    assert.deepStrictEqual(store.current.language, 'ru');
    ui.open = open;
    await ui.click('BTN_LANGUAGE');
    assert.strictEqual(ui.components.SETTINGS_STATUS.text, 'Ожидание запуска двигателя');

    ui.show('MAIN'); await screen.refresh();
    assert.strictEqual(store.listeners.length, 1);
    assert.strictEqual(c.listeners.length, 1);
    const beforeDiagnosticConfig = copy(store.current);
    await ui.click('BTN_DIAGNOSTICS');
    assert.strictEqual(c.diagnostics.starts, 0, 'Opening diagnostics only presents controls');
    assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, false);
    await ui.click('DIAG_START');
    assert.strictEqual(c.diagnostics.starts, 1);
    assert.strictEqual(ui.components.DIAG_START.enabled, false);
    assert.strictEqual(ui.components.DIAG_CANCEL.enabled, true);
    await ui.click('DIAG_CANCEL');
    assert.strictEqual(c.diagnostics.cancels, 1, 'Cancel works while start has an unresolved completion promise');
    assert.strictEqual(ui.components.DIAG_STATUS.text, settings.LABELS.ru.diagCancelled);
    await ui.click('DIAG_START');
    const report = { schema: 'manuk-retro-diagnostics', simulation: true, environment: 'bench', state: 'complete', elapsedSeconds: 30,
        metadata: {}, sources: {
            tank: { interface: 'de.bmw.infotainment.KombiIF', field: 'statusRangeTankStatus', available: true, observations: 2,
                latest: { fluidLevelFuelTank: 40, range: 450 }, reason: 'raw-only-unverified', stats: {} },
            bc: { interface: 'de.bmw.infotainment.KombiIF', field: 'statusBordcomputerAverage', available: true, observations: 2,
                latest: { consumptionAverage1BC1: 84, consumptionAverage2BC2: 65535, statusUnitOfMeasurementConsumptionBC: 1 }, reason: 'raw-only-unverified', stats: {} }
        } };
    const pages = diagnosticValues.format(report, 'ru').pages;
    assert(pages.length > 1); assert(pages.every(page => page.rows.length <= 4));
    c.diagnostics.set({ state: 'complete', elapsedSeconds: 30, report, simulation: true });
    await screen.refresh();
    assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, true);
    assert(/ИМИТАЦИЯ/.test(ui.components.DIAG_NOTE.text));
    assert(!ui.opens.includes('DIAGNOSTIC_VALUES'), 'A completed report never opens values automatically');
    await ui.click('DIAG_SHOW_VALUES');
    function assertPage(index, expected) {
        const title = ui.components.DIAGNOSTIC_VALUES_TITLE.text;
        assert(title.includes((index + 1) + '/' + expected.length));
        for (let i = 0; i < 4; i++) {
            const row = expected[index].rows[i], component = ui.components['DIAG_VALUE_' + (i + 1)];
            assert.strictEqual(component.visible, !!row);
            assert.deepStrictEqual(component.cells, { Text1stRow: row ? row.label : '', Text2ndRow: row ? row.value : '' });
        }
        assert.strictEqual(ui.components.DIAG_VALUES_PREV.enabled, index > 0);
        assert.strictEqual(ui.components.DIAG_VALUES_NEXT.enabled, index + 1 < expected.length);
    }
    assertPage(0, pages);
    assert(/ИМИТАЦИЯ/.test(ui.components.DIAGNOSTIC_VALUES_TITLE.text));
    await ui.click('DIAG_VALUES_PREV'); assertPage(0, pages);
    for (let i = 1; i < pages.length; i++) { await ui.click('DIAG_VALUES_NEXT'); assertPage(i, pages); }
    await ui.click('DIAG_VALUES_NEXT'); assertPage(pages.length - 1, pages);
    await ui.click('DIAG_VALUES_PREV'); assertPage(pages.length - 2, pages);
    const partial = copy(report); partial.state = 'cancelled'; partial.reason = 'vehicle-moving';
    c.diagnostics.set({ state: 'cancelled', report: partial, simulation: true });
    await screen.refresh();
    assert(/автомобиль движется/.test(ui.components.DIAG_STATUS.text));
    assert(/частичн/.test(ui.components.DIAG_STATUS.text));
    assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, true, 'Failed guard still exposes an explicitly partial report');
    c.diagnostics.set({ state: 'error', report, simulation: true });
    await screen.refresh(); assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, true);
    c.diagnostics.set({ state: 'complete', report: null, simulation: true });
    await screen.refresh(); assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, false, 'No report means no values to show');
    c.diagnostics.set({ state: 'complete', error: 'report-save-failed', report, simulation: true });
    await screen.refresh(); assert.strictEqual(ui.components.DIAG_SHOW_VALUES.enabled, true);
    assert.strictEqual(ui.components.DIAG_STATUS.text, settings.LABELS.ru.diagSaveError);
    await ui.click('LANG_EN');
    assert.strictEqual(ui.components.DIAG_START.text, settings.LABELS.en.diagStart);
    assert.strictEqual(ui.components.DIAG_VALUES_NEXT.text, 'Next'); assert(/SIMULATION/.test(ui.components.DIAGNOSTIC_VALUES_TITLE.text));
    await ui.click('DIAG_SHOW_VALUES'); assertPage(0, diagnosticValues.format(report, 'en').pages);
    await ui.click('LANG_RU'); await ui.click('DIAG_VALUES_BACK'); await ui.click('DIAG_BACK');
    assert.deepStrictEqual(store.current, beforeDiagnosticConfig, 'Collection/navigation never alters display or settings');
    assert.strictEqual(c.diagnostics.listeners.length, 1);
    screen.stop(); screen.stop();
    assert.strictEqual(store.listeners.length, 0);
    assert.strictEqual(c.listeners.length, 0);
    assert.strictEqual(c.diagnostics.listeners.length, 0);
    const afterStop = copy(store.current), openCount = ui.opens.length;
    await ui.click('SET_ENABLED'); await ui.click('BTN_UNITS');
    assert.deepStrictEqual(store.current, afterStop);
    assert.strictEqual(ui.opens.length, openCount);
    // The effective build metadata informs the explanation, never an open action
    // or a change to the driver's enabled / engine-start preferences.
    const autoUi = fakeUi(), autoController = controller(store);
    const autoScreen = settings.attach({ ui: autoUi, log, spec: { mguAppStartType: 'autostart' } }, autoController);
    await autoScreen.ready;
    assert.strictEqual(autoUi.components.ENGINE_START_NOTE.text, settings.LABELS.ru.engineNoteAuto);
    assert.deepStrictEqual(autoUi.opens, []);
    assert.deepStrictEqual(store.current, afterStop);
    await autoUi.click('LANG_EN');
    assert.strictEqual(autoUi.components.ENGINE_START_NOTE.text, settings.LABELS.en.engineNoteAuto);
    assert.strictEqual(store.current.enabled, afterStop.enabled);
    assert.strictEqual(store.current.startup.onEngineStart, afterStop.startup.onEngineStart);
    assert.deepStrictEqual(autoUi.opens, []);
    autoScreen.stop();
    assert.strictEqual(store.listeners.length, 0);
    assert.strictEqual(autoController.listeners.length, 0);
    store.stop();
    console.log('PASS genuine RHMI settings: verified components, manual navigation, RU/EN, independent units, serialized actions, atomic restart persistence, failed-save rollback and lifecycle');
})().catch((e) => { console.error(e.stack || e); process.exitCode = 1; }).then(() => {
    fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    fs.rmdirSync(dir);
});

'use strict';
// Genuine RHMI list/checkbox controls. ConfigStore is the only persisted settings owner.
const LABELS = {
    ru: {
        title: 'Retro Cluster', enabled: 'Включить приборку', engine: 'Включать при запуске двигателя',
        engineNote: 'После выключения автомобиля нужен ручной запуск приложения.', language: 'Язык', units: 'Единицы измерения',
        speed: 'Скорость', temperature: 'Температура', pressure: 'Давление', consumption: 'Расход', back: 'Назад',
        saveError: 'Не удалось сохранить настройки. Проверьте журнал приложения.', screenError: 'Не удалось открыть экран настроек.',
        kmh: 'км/ч', mph: 'миль/ч', c: '°C', f: '°F', bar: 'бар', psi: 'psi', l100km: 'л/100 км', mpg: 'mpg (US)'
    },
    en: {
        title: 'Retro Cluster', enabled: 'Enable cluster display', engine: 'Enable when the engine starts',
        engineNote: 'After the vehicle switches off, start the app manually.', language: 'Language', units: 'Units',
        speed: 'Speed', temperature: 'Temperature', pressure: 'Pressure', consumption: 'Consumption', back: 'Back',
        saveError: 'Could not save settings. Check the application log.', screenError: 'Could not open the settings screen.',
        kmh: 'km/h', mph: 'mph', c: '°C', f: '°F', bar: 'bar', psi: 'psi', l100km: 'l/100 km', mpg: 'mpg (US)'
    }
};
const UNITS = { speed: ['kmh', 'mph'], temperature: ['c', 'f'], pressure: ['bar', 'psi'], consumption: ['l100km', 'mpg'] };
const UNIT_IDS = { speed: 'UNIT_SPEED', temperature: 'UNIT_TEMPERATURE', pressure: 'UNIT_PRESSURE', consumption: 'UNIT_CONSUMPTION' };
const copy = (v) => JSON.parse(JSON.stringify(v));
const STATUS = {
    'not started': ['Ожидание запуска приложения', 'Waiting for the app to start'],
    'disabled in configuration': ['Отображение выключено', 'Display disabled'],
    'waiting for active vehicle state': ['Ожидание готовности автомобиля', 'Waiting for the vehicle'],
    'waiting for confirmed engine state': ['Ожидание данных о двигателе', 'Waiting for engine data'],
    'waiting for engine start': ['Ожидание запуска двигателя', 'Waiting for the engine to start'],
    'speed unavailable': ['Ожидание данных скорости', 'Waiting for speed data'],
    'gear unavailable or ambiguous': ['Ожидание данных передачи', 'Waiting for gear data'],
    'own rendering disabled; verify the stock display': ['Отображение выключено. Проверьте штатную приборку.', 'Display disabled. Check the original cluster.'],
    'stopped; own layers released, verify the stock display': ['Приложение остановлено. Проверьте штатную приборку.', 'App stopped. Check the original cluster.']
};
function status(value, language) {
    const raw = String(value || '').replace(/; own layers released$/, ''), en = language === 'en';
    if (STATUS[raw]) return STATUS[raw][en ? 1 : 0];
    if (/refused|could not start|exceeds|error/i.test(raw)) return en ? 'Display unavailable. Check the application log.' : 'Отображение недоступно. Проверьте журнал приложения.';
    if (/connecting|waiting|parked|suspended|stalled|not installed|not running/.test(raw)) return en ? 'Waiting for the instrument cluster' : 'Ожидание готовности приборной панели';
    if (/ on: /.test(raw)) return en ? 'Application running' : 'Приложение работает';
    return en ? 'Waiting for status' : 'Ожидание состояния приложения';
}

function attach(ctx, controller) {
    const ui = ctx.ui, store = controller.store, log = ctx.log || {};
    if (!ui || !store) throw new Error('Settings require RHMI and ConfigStore');
    let stopped = false, error = null, currentStatus = controller.currentStatus;
    let refreshQueue = Promise.resolve(), actionQueue = Promise.resolve();
    function refresh() {
        refreshQueue = refreshQueue.catch(() => {}).then(() => {
            if (stopped) return;
            const c = store.current, t = LABELS[c.language] || LABELS.ru, units = c.displayUnits;
            const jobs = [
                ui.text('MAIN_TITLE', t.title), ui.text('LANGUAGE_TITLE', t.language), ui.text('UNITS_TITLE', t.units),
                ui.text('SET_ENABLED', t.enabled), ui.checked('SET_ENABLED', c.enabled === true),
                ui.text('SET_ENGINE_START', t.engine), ui.checked('SET_ENGINE_START', c.startup.onEngineStart === true),
                ui.text('ENGINE_START_NOTE', t.engineNote),
                ui.cells('BTN_LANGUAGE', 0, { Text1stCol: t.language, Text2ndCol: c.language === 'en' ? 'English' : 'Русский' }),
                ui.cells('BTN_UNITS', 0, { Text1stCol: t.units, Text2ndCol: [t[units.speed], t[units.temperature], t[units.pressure]].join(' · ') }),
                ui.text('LANG_RU', 'Русский'), ui.checked('LANG_RU', c.language === 'ru'),
                ui.text('LANG_EN', 'English'), ui.checked('LANG_EN', c.language === 'en'),
                ui.text('BTN_LANGUAGE_BACK', t.back), ui.text('BTN_UNITS_BACK', t.back),
                ui.text('SETTINGS_STATUS', error ? t[error] : status(currentStatus, c.language))
            ];
            Object.keys(UNITS).forEach((key) => jobs.push(ui.cells(UNIT_IDS[key], 0, { Text1stCol: t[key], Text2ndCol: t[units[key]] })));
            return Promise.all(jobs);
        }).catch(() => { if (log.warn) log.warn('settings screen update failed'); });
        return refreshQueue;
    }
    function action(fn, failure) {
        actionQueue = actionQueue.catch(() => {}).then(() => {
            if (stopped) return;
            return Promise.resolve().then(fn).then(() => { error = null; }, () => {
                error = failure || 'saveError';
                if (log.error) log.error(error === 'saveError' ? 'settings persistence failed' : 'settings screen navigation failed');
            });
        }).then(refresh);
        return actionQueue;
    }
    const bind = (id, fn, failure) => ui.onClick(id, () => action(fn, failure));
    const save = (edit) => { const next = copy(store.current); edit(next); store.save(next); };
    bind('SET_ENABLED', () => controller.setEnabled(store.current.enabled !== true));
    bind('SET_ENGINE_START', () => controller.setEngineStart(store.current.startup.onEngineStart !== true));
    bind('BTN_LANGUAGE', () => ui.open('LANGUAGE'), 'screenError');
    bind('BTN_UNITS', () => ui.open('UNITS'), 'screenError');
    bind('BTN_LANGUAGE_BACK', () => ui.close('LANGUAGE'), 'screenError');
    bind('BTN_UNITS_BACK', () => ui.close('UNITS'), 'screenError');
    ['ru', 'en'].forEach((language) => bind('LANG_' + language.toUpperCase(), () => {
        if (store.current.language !== language) save((next) => { next.language = language; });
    }));
    Object.keys(UNITS).forEach((key) => bind(UNIT_IDS[key], () => save((next) => {
        const options = UNITS[key];
        next.displayUnits[key] = options[(options.indexOf(next.displayUnits[key]) + 1) % options.length];
    })));
    const off = store.onChange(() => { refresh(); });
    const offStatus = controller.onStatus ? controller.onStatus((value) => { currentStatus = value; refresh(); }) : null;
    if (ui.onVisible) ui.onVisible((name, visible) => {
        if (!stopped && visible && ['MAIN', 'LANGUAGE', 'UNITS'].indexOf(name) >= 0) refresh();
    });
    return { ready: refresh(), refresh: refresh, stop: () => { if (stopped) return; stopped = true; if (off) off(); if (offStatus) offStatus(); } };
}

module.exports = { attach, LABELS, UNITS, status };

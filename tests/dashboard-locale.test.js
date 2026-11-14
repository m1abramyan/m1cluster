'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base = '../apps/manuk_retro_cluster/';
const locale = require(base + 'dashboard_locale');
const config = require(base + 'config');
const original = require(base + 'hud/layouts/retro80s.json');
const before = JSON.stringify(original);
const ru = config.defaults('car');
const result = locale.layout(original, ru);
assert.strictEqual(locale.layout(original, { language: 'en' }), original);
assert.strictEqual(JSON.stringify(original), before, 'Russian labels do not mutate the pinned reference');
original.widgets.forEach((w, i) => {
    const translated = result.widgets[i];
    Object.keys(w).filter((k) => k !== 'font' && k !== 'text').forEach((k) => assert.deepStrictEqual(translated[k], w[k], 'Geometry/palette changed: ' + w.id + '.' + k));
    if (/^d7_/.test(w.font || '')) assert.deepStrictEqual(translated, w, 'Seven-segment widget changed');
});
const fonts = {};
function fits(text, fontName, width, spacing) {
    const f = fonts[fontName] || (fonts[fontName] = require(base + 'hud/fonts/' + fontName + '.json'));
    const bytes = Buffer.from(f.alpha, 'base64');
    assert.strictEqual(bytes.length, f.width * f.height);
    let used = 0;
    Array.from(text).forEach((ch, i) => {
        const glyph = f.glyphs[ch];
        assert(glyph, 'Missing glyph ' + ch + ' in ' + fontName);
        used += glyph.advance + (i ? spacing || 0 : 0);
    });
    assert(used <= width, text + ' overflows its original box');
}
result.widgets.filter((w) => w.font === 'ru_head' || w.font === 'ru_unit').forEach((w) => {
    if (!/\{\{/.test(w.text)) fits(w.text, w.font, w.w, w.spacing);
});
const sensors = require('../shared/sensors');
Object.keys({ intake: 1, rpm: 1, oil: 1, coolant: 1, boost: 1, fuel: 1, speed: 1, range: 1 }).forEach((id) => {
    const s = locale.sensor(sensors.get(id), ru);
    [false, true].forEach((us) => fits(s.head + ' ' + (s.unit ? s.unit(us) : ''), 'ru_head', 240, 1));
});
['metric', 'us'].forEach((units) => {
    fits(locale.token('u:speed', { units }), 'ru_unit', 140, 0);
    fits('НАДДУВ ' + locale.token('u:boost', { units }), 'ru_head', 240, 1);
});
const oldConfig = config.defaults('car'); delete oldConfig.language;
assert.strictEqual(config.toSettings(config.validate(oldConfig)).language, 'ru', 'Existing config defaults to Russian without losing settings');
assert.throws(() => config.validate(Object.assign({}, ru, { language: 'fr' })), /unsupported/);
console.log('PASS Russian labels fit original boxes, cover every slot, preserve DSEG/geometry and keep English reference intact');

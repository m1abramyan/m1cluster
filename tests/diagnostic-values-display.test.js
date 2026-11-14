'use strict';
// Use the real Display constructor. A native text menu must never ask a central
// renderer to cover RHMI, even when its socket is installed on the vehicle.
const assert = require('assert');
const spec = require('../apps/manuk_retro_cluster/app.json');
const { Display } = require('../kit/runtime/display');
const { RenderClient } = require('../kit/runtime/renderd');
const originalAvailable = RenderClient.available;
let rendererLookups = 0;
RenderClient.available = () => { rendererLookups++; throw new Error('Native menus must not probe the graphics renderer'); };
try {
    const display = new Display({ onVisible() { throw new Error('No canvas visibility handler is needed'); } },
        { info() {}, warn() {}, error() {} }, spec,
        { get() { throw new Error('Native menus must not initialize graphics mode'); }, onChange() {} }, () => ({}));
    assert.strictEqual(display.screen, null);
    assert.strictEqual(display.gpu, null);
    assert.strictEqual(display.poll, undefined);
    assert.strictEqual(rendererLookups, 0);
    assert(spec.screens.every(screen => screen.kind === 'menu'));
    const values = spec.screens.find(screen => screen.name === 'DIAGNOSTIC_VALUES');
    assert(values);
    assert.strictEqual(values.items.filter(item => item[0] === 'tworow').length, 4);
    assert(!spec.screens.some(screen => screen.graphic));
    console.log('PASS real Display stays inactive for diagnostic native text menus: no GPU probe, surface or polling timer');
} finally { RenderClient.available = originalAvailable; }

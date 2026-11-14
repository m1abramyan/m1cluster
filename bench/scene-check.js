'use strict';
// Shared by local verification/capture tools. Counts come from the real HUD's completed plan.
const assert = require('assert');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function drawable(snapshot) { return snapshot.layers.filter(layer => layer.kind !== 'asset'); }
function ready(snapshot) {
    const diagnostics = snapshot.values && snapshot.values.diagnostics;
    if (!snapshot.running || snapshot.restarting || !diagnostics || diagnostics.expectedLayers <= 0) return false;
    if (snapshot.childPid && diagnostics.pid !== snapshot.childPid) return false;
    const layers = drawable(snapshot);
    return layers.length === diagnostics.expectedLayers && layers.every(layer => layer.state === 'shown')
        && snapshot.pixels === diagnostics.expectedPixelBytes;
}
function budget(snapshot) {
    const layers = drawable(snapshot), assets = snapshot.layers.filter(layer => layer.kind === 'asset');
    const byConnection = {}, assetsByConnection = {};
    layers.forEach(layer => { byConnection[layer.conn] = (byConnection[layer.conn] || 0) + 1; });
    assets.forEach(layer => { assetsByConnection[layer.conn] = (assetsByConnection[layer.conn] || 0) + 1; });
    assert(layers.length > 0 && layers.length <= 32, 'Total renderer layer budget');
    assert(Object.values(byConnection).every(count => count <= 8), 'Per-connection renderer layer budget');
    assert(assets.length <= 32 && Object.values(assetsByConnection).every(count => count <= 16), 'Atlas asset budget');
    assert(snapshot.pixels <= 16 * 1024 * 1024, 'Pixel memory budget');
    assert.equal(layers.length, snapshot.values.diagnostics.expectedLayers, 'Rendered layer count differs from real HUD plan');
    assert.equal(snapshot.pixels, snapshot.values.diagnostics.expectedPixelBytes, 'Renderer memory differs from real HUD plan');
    return { layers: layers.length, assets: assets.length, layersPerConnection: Object.values(byConnection), pixelBytes: snapshot.pixels };
}
function signature(snapshot) {
    return JSON.stringify({ pid: snapshot.childPid, pixels: snapshot.pixels, layers: snapshot.layers.map(layer => [layer.key, layer.kind, layer.x, layer.y, layer.w, layer.h]) });
}
async function waitForScene(base, page) {
    const until = Date.now() + 20000;
    let previous = null, stable = 0, last = null;
    while (Date.now() < until) {
        let fresh = null;
        try { const response = await fetch(base + '/snapshot'); if (response.ok) fresh = await response.json(); } catch (_) {}
        if (fresh) last = fresh;
        if (fresh && ready(fresh)) {
            const current = signature(last);
            stable = current === previous ? stable + 1 : 1; previous = current;
            if (stable >= 3) {
                budget(last);
                if (page) await page.waitForFunction(count => document.getElementById('layers').children.length === count, last.layers.length);
                return last;
            }
        } else { stable = 0; previous = null; }
        await sleep(150);
    }
    throw new Error('Incomplete renderer scene: ' + JSON.stringify(last && { running: last.running, layers: last.layers.length, diagnostics: last.values && last.values.diagnostics, status: last.status }));
}
module.exports = { ready, budget, waitForScene, signature };

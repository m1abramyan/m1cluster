'use strict';
// Run against an isolated loopback bench, never the user's live 8078 session.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { waitForScene, budget } = require('./scene-check');
const port = Number(process.env.BENCH_PORT || 8094);
assert(port !== 8078, 'Use an isolated bench port for the motion/lifecycle fixture');
const base = 'http://127.0.0.1:' + port, fixture = require('./profiles-fixture.json').signals;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = async (route, data) => { const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); assert(r.ok, route); };
const snapshot = async () => (await fetch(base + '/snapshot')).json();
async function until(test) { for (let n = 0; n < 50; n++) { const s = await snapshot(); if (test(s)) return s; await sleep(100); } throw new Error('Bench lifecycle timeout'); }
(async () => {
    let controller;
    try {
        await post('/drive', { value: null });
        await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { speed: 10, rpm: 1000 }) });
        const initial = await waitForScene(base), diagnostics = initial.values.diagnostics;
        const layout = require('../apps/manuk_retro_cluster/profile_view').layout(require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json'), initial.values.configuration);
        const speed = layout.widgets.find(w => w.id === 'speed'), tach = layout.widgets.find(w => w.id === 'revs');
        const layer = initial.layers.find(l => l.kind === 'image' && l.z === speed.z && l.x <= speed.x && l.y <= speed.y && l.x + l.w >= speed.x + speed.w && l.y + l.h >= speed.y + speed.h);
        const tachLayer = initial.layers.find(l => l.kind === 'effect' && l.x === tach.x && l.y === tach.y);
        assert(layer && tachLayer);
        controller = new AbortController();
        const stream = await fetch(base + '/events', { signal: controller.signal });
        const px = [], rpm = []; let active = false, pending = '', lastRpm = null;
        const reader = (async () => {
            try {
                for await (const chunk of stream.body) {
                    pending += Buffer.from(chunk).toString();
                    let end;
                    while ((end = pending.indexOf('\n\n')) >= 0) {
                        const line = pending.slice(0, end); pending = pending.slice(end + 2);
                        if (!line.startsWith('data: ')) continue;
                        const m = JSON.parse(line.slice(6)); if (!active) continue;
                        if (m.t === 'px' && m.key === layer.key) px.push({ at: Date.now(), bytes: m.w * m.h * 4 });
                        if (m.t === 'scene') {
                            const t = m.layers.find(l => l.key === tachLayer.key), q = t && t.uniforms.u_value.v[0];
                            if (q !== undefined && q !== lastRpm) { rpm.push({ at: Date.now(), rpm: Math.round(q * 8000) }); lastRpm = q; }
                        }
                    }
                }
            } catch (error) { if (!controller.signal.aborted) throw error; }
        })();
        await sleep(200); active = true; const began = Date.now();
        for (let step = 1; step <= 24; step++) {
            await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { speed: 10 + 3 * step, rpm: 1000 + 200 * step }) });
            await sleep(250);
        }
        await sleep(150); active = false; const elapsed = Date.now() - began;
        controller.abort(); await reader;
        const deltas = px.slice(1).map((p, i) => p.at - px[i].at).filter(ms => ms < 100).sort((a, b) => a - b);
        assert(px.length > 48, 'More than one rendered intermediate digit per input step');
        assert(deltas.length > 20 && deltas[Math.floor(deltas.length / 2)] < 60, 'Active transition frames are not limited by the old 200ms text gate');
        const completed = await snapshot();
        assert.equal(completed.values.visual.speed, 82, 'source retains the actual received final value');
        await post('/source', { source: 'speed', available: false });
        await until(s => s.layers.length === 0);
        await post('/source', { source: 'speed', available: true });
        await waitForScene(base);
        await post('/renderer', { online: false });
        await until(s => s.layers.length === 0);
        await post('/renderer', { online: true });
        const restored = await waitForScene(base);
        assert.equal(restored.values.diagnostics.intervals, diagnostics.intervals, 'Reconnect does not duplicate timers');
        assert.equal(restored.values.diagnostics.subscriptions, diagnostics.subscriptions, 'Reconnect does not duplicate source subscriptions');
        const report = { scope: 'Actual loopback renderer traffic on Mac; synthetic input, not BMW compatibility/FPS',
            durationMs: elapsed, sourceSteps: 24, imageWrites: px.length,
            speedPixelBytes: px.reduce((sum, p) => sum + p.bytes, 0),
            speedPixelBytesPerSecond: Math.round(px.reduce((sum, p) => sum + p.bytes, 0) * 1000 / elapsed),
            transitionFrameMedianMs: deltas[Math.floor(deltas.length / 2)], tachometerVisibleChanges: rpm.length,
            budget: budget(restored), intervals: diagnostics.intervals, subscriptions: diagnostics.subscriptions,
            sourceLossReleases: true, rendererRecovery: true, duplicateTimers: false, duplicateSubscriptions: false };
        fs.writeFileSync(path.join(__dirname, '../artifacts/motion-loopback.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        if (controller) controller.abort();
        await post('/signals', { mode: 'manual', values: fixture });
    }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

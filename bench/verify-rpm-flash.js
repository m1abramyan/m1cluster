'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { chromium } = require('./node_modules/playwright'), { PNG } = require('./node_modules/pngjs');
const { waitForScene } = require('./scene-check'), fixture = require('./profiles-fixture.json').signals;
const profileView = require('../apps/manuk_retro_cluster/profile_view'), original = require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8078);
const profiles = [[4, 'comfort'], [1, 'sport'], [7, 'eco'], [99, 'neutral']], highs = [7000, 7099, 7100, 7199, 7200, 7999, 8000, 8200];
(async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 });
    const post = async (url, data) => { const r = await page.request.post(base + url, { data }); assert(r.ok(), url); };
    const snap = async () => (await page.request.get(base + '/snapshot')).json();
    try {
        await post('/drive', { value: null }); await post('/signals', { mode: 'manual', values: fixture });
        await page.goto(base + '/?only=1&clean=1&car=0');
        const initial = await waitForScene(base, page), layout = profileView.layout(original, initial.values.configuration), bar = layout.widgets.find(w => w.id === 'revs');
        const refs = initial.layers.map(l => [l.key, l.x, l.y, l.w, l.h]);
        const layer = s => s.layers.find(l => l.x === bar.x && l.y === bar.y && l.w === bar.w && l.h === bar.h && l.uniforms && l.uniforms.u_segs);
        async function input(raw, profile, rpm) {
            await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { driveModeRaw: raw, rpm }) });
            await page.waitForFunction(async v => {
                const s = await (await fetch('/snapshot')).json();
                return s.values && s.values.visual.profile === v.profile && s.values.values.rpm === v.rpm;
            }, { profile, rpm });
            await waitForScene(base, page); await page.waitForTimeout(100);
            const s = await snap(), l = layer(s); assert.equal(l.uniforms.u_segs.v[0], 80);
            assert.equal(l.uniforms.u_value.v[0], typeof rpm === 'number' ? Math.floor(Math.min(8000, rpm) / 100) * 100 / 8000 : 0);
            assert.deepStrictEqual(s.layers.map(l => [l.key, l.x, l.y, l.w, l.h]), refs, 'Flash never rebuilds or moves layers');
            return l;
        }
        async function phases(save) {
            const result = await page.evaluate(async ({ bar, save }) => {
                const hud = document.getElementById('hud'), crop = document.createElement('canvas'); crop.width = bar.w; crop.height = bar.h;
                const ctx = crop.getContext('2d', { willReadFrequently: true }), phases = {}; let frames = 0;
                const until = performance.now() + 2500;
                while (Object.keys(phases).length < 2 && performance.now() < until) {
                    await new Promise(requestAnimationFrame); ctx.drawImage(hud, bar.x, bar.y, bar.w, bar.h, 0, 0, bar.w, bar.h);
                    const d = ctx.getImageData(0, 0, bar.w, bar.h).data, samples = [];
                    for (let i = 0; i < 80; i++) { const p = (Math.floor(bar.h / 2) * bar.w + Math.floor((i + 0.5) * bar.w / 80 - 1.5)) * 4; samples.push([d[p], d[p + 1], d[p + 2]]); }
                    const matches = colour => samples.every(rgb => rgb.every((v, c) => Math.abs(v - colour[c]) <= 2));
                    const phase = matches([255, 59, 48]) ? 'bright' : matches([46, 11, 9]) ? 'dim' : null;
                    if (!phase) throw new Error('Mixed or non-red flash frame: ' + JSON.stringify(samples));
                    frames++;
                    if (!phases[phase]) {
                        phases[phase] = { cells: samples.length, rgb: samples[0] };
                        if (save) { const full = document.createElement('canvas'); full.width = hud.width; full.height = hud.height; full.getContext('2d').drawImage(hud, 0, 0); phases[phase].png = full.toDataURL('image/png').split(',')[1]; }
                    }
                }
                return { phases, frames };
            }, { bar, save });
            assert.deepStrictEqual(Object.keys(result.phases).sort(), ['bright', 'dim']);
            if (save) for (const phase of ['bright', 'dim']) { fs.writeFileSync(path.join(root, 'artifacts/rpm_flash_' + phase + '.png'), Buffer.from(result.phases[phase].png, 'base64')); delete result.phases[phase].png; }
            return result;
        }
        async function normalCells(expectedCount) {
            const results = await page.evaluate(async bar => {
                const c = document.createElement('canvas'); c.width = bar.w; c.height = bar.h; const ctx = c.getContext('2d', { willReadFrequently: true }), results = [];
                for (let n = 0; n < 4; n++) {
                    await new Promise(resolve => setTimeout(resolve, 160)); ctx.drawImage(document.getElementById('hud'), bar.x, bar.y, bar.w, bar.h, 0, 0, bar.w, bar.h);
                    const d = ctx.getImageData(0, 0, bar.w, bar.h).data, lit = [];
                    for (let i = 0; i < 80; i++) { const p = (Math.floor(bar.h / 2) * bar.w + Math.floor((i + 0.5) * bar.w / 80 - 1.5)) * 4; lit.push(Math.max(d[p], d[p + 1], d[p + 2]) > 120); }
                    results.push(lit);
                }
                return results;
            }, bar);
            results.forEach(lit => assert.deepStrictEqual(lit, Array.from({ length: 80 }, (_, i) => i < expectedCount), 'Returning below threshold or losing RPM stops flashing'));
        }
        const results = [], recovery = [];
        for (const [raw, profile] of profiles) {
            for (const rpm of highs) {
                const l = await input(raw, profile, rpm); assert([1, 2].includes(l.uniforms.u_flash.v[0]));
                results.push({ profile, rpm, segments: 80, uValue: l.uniforms.u_value.v[0], normalFillCells: Math.floor(Math.min(rpm, 8000) / 100), alarmCells: 80, ...(await phases(profile === 'comfort' && rpm === 7000)), evidence: 'Fresh browser pixels after whole-bar flash change' });
            }
            for (const rpm of [6999, null]) { const l = await input(raw, profile, rpm); assert.equal(l.uniforms.u_flash.v[0], 0); await normalCells(rpm === null ? 0 : 69); recovery.push({ profile, rpm, uFlash: 0, samplesAcrossFullFlashCycle: 4 }); }
        }
        await input(1, 'sport', 7000);
        const video = await page.evaluate(async () => {
            const recorder = new MediaRecorder(document.getElementById('hud').captureStream(30), { mimeType: 'video/webm;codecs=vp9' }), chunks = [];
            const done = new Promise(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = async () => { const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); resolve(btoa(s)); }; });
            recorder.start(); await new Promise(resolve => setTimeout(resolve, 2200)); recorder.stop(); return done;
        });
        fs.writeFileSync(path.join(root, 'artifacts/rpm_flash.webm'), Buffer.from(video, 'base64'));
        const report = { scope: 'Local synthetic canvas only', thresholdRpm: 7000, cycleMs: 500, brightMs: 250, dimMs: 250, results, recovery, stableLayers: initial.layers.length, pixelBytes: initial.pixels, video: 'artifacts/rpm_flash.webm' };
        fs.writeFileSync(path.join(root, 'artifacts/rpm-flash-verification.json'), JSON.stringify(report, null, 2) + '\n');
        // Keep this run independent; never splice fresh cases into another run's evidence.
        console.log(JSON.stringify({ highCases: results.length, recoveryCases: recovery.length, layers: initial.layers.length, pixelBytes: initial.pixels, screenshots: ['rpm_flash_bright.png', 'rpm_flash_dim.png'], video: report.video }));
    } finally { try { await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 }); } finally { await browser.close(); } }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

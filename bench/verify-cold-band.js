'use strict';
// No car source is invented here. Positive cases change a shader uniform in an
// isolated browser response only; they never enter the application's data path.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./node_modules/playwright'), { PNG } = require('./node_modules/pngjs');
const { waitForScene, budget } = require('./scene-check'), fixture = require('./profiles-fixture.json').signals;
const base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8090);
assert(!base.endsWith(':8078'), 'Use an isolated bench, never the live user session');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const same = (a, b, message) => assert(a.data.equals(b.data), message);
const hook = `
  // Test response only: absent from the served source file and from car builds.
  window.__coldShaderFixture = function (range, flash) {
    const original = scene.find(l => l.uniforms && l.uniforms.u_coldRange);
    if (!original) throw new Error('No production tachometer layer');
    const layer = Object.assign({}, original, { uniforms: JSON.parse(JSON.stringify(original.uniforms)) });
    if (range === null) { delete layer.uniforms.u_coldRange; layer.fs += '\\n// fresh GL program verifies disabled default'; }
    else layer.uniforms.u_coldRange.v = range;
    if (flash !== null) layer.uniforms.u_flash.v = [flash];
    const image = drawEffect(layer, performance.now()), output = document.createElement('canvas');
    output.width = canvas.width; output.height = canvas.height;
    const c = output.getContext('2d'); c.drawImage(canvas, 0, 0);
    c.fillStyle = '#000'; c.fillRect(layer.x, layer.y, layer.w, layer.h); c.drawImage(image, layer.x, layer.y);
    return output.toDataURL('image/png').split(',')[1];
  };
`;
(async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const post = async (url, data) => { const r = await page.request.post(base + url, { data }); assert(r.ok(), url); };
    const snapshot = async () => (await page.request.get(base + '/snapshot')).json();
    const capture = async () => PNG.sync.read(await page.locator('#hud').screenshot());
    const render = async (range, flash = null) => PNG.sync.read(Buffer.from(await page.evaluate(({ range, flash }) => window.__coldShaderFixture(range, flash), { range, flash }), 'base64'));
    const layer = s => s.layers.find(l => l.uniforms && l.uniforms.u_coldRange);
    const state = s => ({ layers: s.layers.length, pixels: s.pixels, subscriptions: s.values.diagnostics.subscriptions, intervals: s.values.diagnostics.intervals });
    try {
        await page.route(base + '/?*', async route => {
            const response = await route.fetch(), html = await response.text(), marker = '})();\n</script>';
            assert(html.includes(marker), 'Known bench closure for isolated shader-test hook');
            await route.fulfill({ response, body: html.replace(marker, hook + marker) });
        });
        const before = await snapshot(); assert.equal(before.clock, '14:36');
        const config = JSON.parse(JSON.stringify(before.values.configuration));
        config.enabled = true; config.language = 'ru'; config.units = 'metric'; config.profiles.enabled = true; config.profiles.followVehicleMode = true;
        await post('/configuration', { configuration: config }); await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 });
        await page.goto(base + '/?only=1&clean=1&car=0');
        const initial = await waitForScene(base, page); await page.waitForTimeout(1000);
        const baseline = await capture(), initialState = state(initial), bar = layer(initial);
        assert(bar); assert.deepStrictEqual(bar.uniforms.u_coldRange.v, [0, 0]); budget(initial);
        assert.equal(initial.values.readings.coldRpmLimit.value, null); assert.equal(initial.values.readings.coldRpmLimit.quality, 'unavailable');
        assert((await page.locator('#coldRpmStatus').textContent()).includes('нет подтверждённых данных'));
        assert.equal(await page.locator('#coldRpmStatus input, #s_coldRpmLimit, #a_coldRpmLimit').count(), 0, 'No invented cold-limit control');
        assert.equal(await page.locator('aside #coldRpmStatus').count(), 1, 'Status stays outside the canvas');
        fs.writeFileSync(path.resolve('artifacts/cold_band_unavailable.png'), PNG.sync.write(baseline));
        same(await render([0, 0]), baseline, 'Explicitly disabled uniform preserves every RGBA byte');
        same(await render(null), baseline, 'Fresh GL default zero preserves every RGBA byte');
        const reference = PNG.sync.read(fs.readFileSync(path.resolve('artifacts/comfort.png')));
        same(reference, baseline, 'No-data production scene remains byte-identical to the last accepted Comfort capture');
        const injections = [4000, { value: 4000, unit: 'rpm', source: 'injected-not-car', quality: 'valid', active: true }];
        for (const coldRpmLimit of injections) {
            await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { coldRpmLimit }) }); await page.waitForTimeout(800);
            const s = await snapshot(); assert.deepStrictEqual(layer(s).uniforms.u_coldRange.v, [0, 0]);
            assert.equal(s.values.readings.coldRpmLimit.value, null); assert.equal(s.values.readings.coldRpmLimit.quality, 'unavailable');
            same(await capture(), baseline, 'Arbitrary bench input cannot enable a real-source-only display'); assert.deepStrictEqual(state(s), initialState);
        }
        const previousPid = (await snapshot()).childPid;
        await post('/restart', {}); const restarted = await waitForScene(base, page); await page.waitForTimeout(1000);
        assert.notEqual(restarted.childPid, previousPid); assert.deepStrictEqual(state(restarted), initialState);
        assert.deepStrictEqual(layer(restarted).uniforms.u_coldRange.v, [0, 0]); same(await capture(), baseline, 'Restart preserves unavailable appearance');
        const shaderCases = [];
        for (const limit of [4000, 4450]) {
            const png = await render([1, limit / 8000], 0); let changed = 0, firstBlue = Infinity;
            for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
                const p = (y * png.width + x) * 4;
                if (png.data.subarray(p, p + 4).equals(baseline.data.subarray(p, p + 4))) continue;
                changed++;
                assert(x >= bar.x && x < bar.x + bar.w && y >= bar.y && y < bar.y + 6, 'Fixture changes only the six-pixel top cap');
                assert((x - bar.x + 0.5) / bar.w >= limit / 8000, 'Blue cannot precede the supplied test boundary');
                if (y === bar.y + 3 && png.data[p + 2] === 255) firstBlue = Math.min(firstBlue, x);
            }
            assert(changed > 1000); assert.equal(firstBlue, bar.x + Math.ceil(limit / 8000 * bar.w - 0.5));
            for (let i = 0; i < 40; i++) {
                const x = bar.x + i * 43 + 20, y = bar.y + 3, p = (y * png.width + x) * 4;
                if ((x - bar.x + 0.5) / bar.w >= limit / 8000) assert.deepStrictEqual(Array.from(png.data.subarray(p, p + 3)), [57, 139, 255]);
                for (let gap = 40; gap < 43; gap++) {
                    const q = (y * png.width + bar.x + i * 43 + gap) * 4;
                    assert.deepStrictEqual(Array.from(png.data.subarray(q, q + 3)), [0, 0, 0], 'Native three-pixel gaps remain empty');
                }
            }
            shaderCases.push({ testOnlyUniform: [1, limit / 8000], changedPixels: changed, firstBluePixel: firstBlue, capHeight: 6, gapPixels: 3 });
            if (limit === 4000) fs.writeFileSync(path.resolve('artifacts/cold_band_SHADER_FIXTURE_ONLY.png'), PNG.sync.write(png));
        }
        same(await render([0, 0]), baseline, 'Clearing the test uniform restores all pixels');
        for (const flash of [1, 2]) same(await render([1, 0.5], flash), await render([0, 0], flash), 'Whole-bar red flash has exact pixel priority over test blue');
        same(await capture(), baseline, 'Shader fixture never mutates the production scene');
        const final = await snapshot(); assert.deepStrictEqual(state(final), initialState); assert.deepStrictEqual(errors, []);
        const report = { scope: 'Local stand. No vehicle data. Source unavailable; positive blue images are isolated shader-uniform fixtures only.',
            production: { reading: final.values.readings.coldRpmLimit, uniform: layer(final).uniforms.u_coldRange.v, baselineRgbaSha256: hash(baseline.data), acceptedComfortRgbaIdentical: true,
                explicitZeroIdentical: true, freshGLDefaultIdentical: true, injectedBenchValuesIgnored: injections.length, restartIdentical: true, externalReadOnlyRussianStatus: true, ...initialState },
            shaderFixtures: shaderCases, clearIdentical: true, redFlashPriorityBothPhases: true, productionSceneUnaffected: true, browserErrors: errors,
            images: ['cold_band_unavailable.png', 'cold_band_SHADER_FIXTURE_ONLY.png'] };
        fs.writeFileSync(path.resolve('artifacts/cold-band-verification.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally { try { await post('/signals', { mode: 'manual', values: fixture }); } finally { await browser.close(); } }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

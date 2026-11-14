'use strict';
// Inspect the actual renderer uniforms and WebGL pixels; never connect to a vehicle.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./node_modules/playwright'), { PNG } = require('./node_modules/pngjs');
const scene = require('./scene-check'), fixture = require('./profiles-fixture.json').signals;
const profileView = require('../apps/manuk_retro_cluster/profile_view');
const originalLayout = require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8078);
const profiles = [[4, 'comfort', 'COMFORT'], [1, 'sport', 'SPORT'], [7, 'eco', 'ECO PRO'], [99, 'neutral', null]];
const points = [null, 0, 99, 100, 199, 200, 399, 400, 5999, 6000, 6099, 6100, 6199, 6200, 6999, 7000, 7099, 7100, 7199, 7200, 7999, 8000, 8200];
const CELL_COUNT = 80, RPM_PER_CELL = 100;
const boundaries = Array.from({ length: CELL_COUNT + 1 }, (_, i) => i * RPM_PER_CELL);
const filledCells = rpm => typeof rpm === 'number' ? boundaries.slice(1).filter(value => value <= Math.max(0, Math.min(8000, rpm))).length : 0;
const fillValue = rpm => boundaries[filledCells(rpm)] / 8000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function crop(png, box, binary) {
    const out = [];
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
        const i = (y * png.width + x) * 4;
        if (binary) out.push(Math.max(png.data[i], png.data[i + 1], png.data[i + 2]) > 100 ? 255 : 0);
        else out.push(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]);
    }
    return Buffer.from(out);
}
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 });
    const post = async (url, data) => { const response = await page.request.post(base + url, { data }); assert(response.ok(), url); };
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
        await post('/drive', { value: null }); await post('/signals', { mode: 'manual', values: fixture });
        await page.goto(base + '/?only=1&clean=1&car=0');
        const initial = await scene.waitForScene(base, page), layout = profileView.layout(originalLayout, initial.values.configuration);
        const bar = layout.widgets.find(w => w.id === 'revs'), axis = layout.widgets.find(w => w.id === 'revs_scale'), caption = layout.widgets.find(w => w.id === 'profile_axis');
        const axisFont = JSON.parse(fs.readFileSync(path.join(root, 'apps/manuk_retro_cluster/hud/fonts', axis.font + '.json'), 'utf8'));
        const axisAlpha = Buffer.from(axisFont.alpha, 'base64');
        assert.equal(bar.segments, CELL_COUNT);
        const findBar = s => s.layers.find(l => l.x === bar.x && l.y === bar.y && l.w === bar.w && l.h === bar.h && l.uniforms && l.uniforms.u_segs);
        async function input(raw, profile, label, rpm, consumption) {
            await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { driveModeRaw: raw, rpm, consumption }) });
            const expected = fillValue(rpm);
            await page.waitForFunction(async wanted => {
                const s = await (await fetch('/snapshot')).json(), v = s.values && s.values.visual;
                if (!v || v.profile !== wanted.profile || v.driveMode !== wanted.label || s.values.values.rpm !== wanted.rpm) return false;
                const b = s.layers.find(l => l.x === wanted.bar.x && l.y === wanted.bar.y && l.w === wanted.bar.w && l.h === wanted.bar.h && l.uniforms && l.uniforms.u_segs);
                return b && b.uniforms.u_segs.v[0] === wanted.cells && b.uniforms.u_value && b.uniforms.u_value.v[0] === wanted.expected;
            }, { profile, label, rpm, expected, bar, cells: CELL_COUNT });
            const stable = await scene.waitForScene(base, page); await page.waitForTimeout(120);
            return stable;
        }
        function pixelFill(png, layer) {
            const track = layer.uniforms.u_track.v, trackMax = Math.max(...track.slice(0, 3)) * track[3] * 255;
            const litMin = Math.min(...['u_low', 'u_mid', 'u_high'].map(key => Math.max(...layer.uniforms[key].v) * 255));
            assert(litMin > trackMax + 50, 'Lit and unlit colours are separable in the fixture');
            const threshold = (litMin + trackMax) / 2, lit = [];
            for (let i = 0; i < CELL_COUNT; i++) {
                const x = Math.floor(bar.x + (boundaries[i] + boundaries[i + 1]) / 2 / 8000 * bar.w - 1.5), y = Math.floor(bar.y + bar.h / 2), p = (y * png.width + x) * 4;
                const on = Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) > threshold;
                lit.push(on);
                if (on) {
                    const midRpm = (boundaries[i] + boundaries[i + 1]) / 2;
                    const expected = midRpm >= 7000 ? [255, 59, 48] : midRpm >= 6000 ? [255, 224, 64] : [80, 255, 120];
                    assert(expected.every((v, channel) => Math.abs(png.data[p + channel] - v) <= 2), 'Lit segment ' + i + ' has its fixed green/yellow/red zone colour');
                }
            }
            return lit;
        }
        function pixelGeometry(png) {
            const runs = []; let start = null;
            for (let x = bar.x; x <= bar.x + bar.w; x++) {
                const i = (Math.floor(bar.y + bar.h / 2) * png.width + x) * 4;
                const visible = x < bar.x + bar.w && Math.max(png.data[i], png.data[i + 1], png.data[i + 2]) > 10;
                if (visible && start === null) start = x;
                if (!visible && start !== null) { runs.push({ left: start, right: x - 1, width: x - start }); start = null; }
            }
            assert.equal(runs.length, CELL_COUNT, 'Canvas has exactly eighty equal physical segments');
            runs.forEach((run, i) => {
                const left = bar.x + boundaries[i] / 8000 * bar.w, width = (boundaries[i + 1] - boundaries[i]) / 8000 * bar.w - 3;
                assert(Math.abs(run.left - left) <= 1.5, 'Segment ' + i + ' begins at its linear RPM position');
                assert(Math.abs(run.width - width) <= 2, 'Segment ' + i + ' width is proportional to its RPM interval');
            });
            return runs;
        }
        function pixelLabels(png, layer) {
            const labels = [];
            for (let number = 0; number <= 8; number++) {
                const glyph = axisFont.glyphs[String(number)];
                const pen = Math.round(Math.max(0, Math.min(axis.w - glyph.advance, number / 8 * axis.w - glyph.advance / 2)));
                const left = Math.round(pen + glyph.ox), colour = number >= 7 ? [255, 59, 48] : number >= 6 ? [255, 224, 64] : [190, 198, 204];
                const maxColour = Math.max(...colour); let mismatches = 0, foreground = 0, colourSamples = 0;
                for (let y = 0; y < axis.h; y++) for (let x = Math.max(0, left - 2); x < Math.min(axis.w, left + glyph.w + 2); x++) {
                    const alpha = y < glyph.h && x >= left && x < left + glyph.w ? axisAlpha[(glyph.y + y) * axisFont.width + glyph.x + x - left] : 0;
                    const expected = Math.round(alpha * maxColour / 255) > 100;
                    const p = ((axis.y + y) * png.width + axis.x + x) * 4;
                    const actual = Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) > 100;
                    if (actual) foreground++;
                    if (actual !== expected) mismatches++;
                    if (alpha === 255) { colourSamples++; assert(colour.every((v, channel) => Math.abs(png.data[p + channel] - v) <= 2), 'Label ' + number + ' has the prescribed zone colour'); }
                }
                assert(foreground > 20, 'Visible scale label ' + number);
                assert(mismatches <= 4, 'Scale label ' + number + ' is the expected glyph at its linear position; mismatches=' + mismatches);
                labels.push({ label: String(number), axisPosition: number / 8, mismatches, foregroundPixels: foreground, colourSamples, colour });
            }
            return labels;
        }
        const results = [], invariance = [];
        let commonAxisMask = null, commonCaptionMask = null, commonBarPixels = null;
        for (const [raw, profile, label] of profiles) {
            const previewState = await input(raw, profile, label, fixture.rpm, fixture.consumption);
            const preview = PNG.sync.read(await page.locator('#hud').screenshot(profile === 'neutral' ? { path: path.join(root, 'artifacts/rpm_neutral.png') } : {}));
            const axisMask = sha(crop(preview, axis, true)), captionMask = sha(crop(preview, caption, true));
            const barPixels = sha(crop(preview, bar, false));
            if (commonAxisMask === null) { commonAxisMask = axisMask; commonCaptionMask = captionMask; commonBarPixels = barPixels; }
            assert.equal(axisMask, commonAxisMask, 'The 0..8 scale labels must be identical across all profiles');
            assert.equal(captionMask, commonCaptionMask, 'The RPM caption must be identical across all profiles');
            assert.equal(barPixels, commonBarPixels, 'Tachometer pixels and zone colours are identical across all profiles');
            const physicalSegments = pixelGeometry(preview);
            const labels = pixelLabels(preview, findBar(previewState));
            for (const rpm of points) {
                const s = await input(raw, profile, label, rpm, fixture.consumption), layer = findBar(s);
                assert.deepStrictEqual(layer.uniforms.u_segs.v, [CELL_COUNT]);
                assert.equal(layer.uniforms.u_value.v[0], fillValue(rpm));
                assert.equal(layer.uniforms.u_midAt.v[0], 6000 / 8000);
                assert.equal(layer.uniforms.u_highAt.v[0], 7000 / 8000);
                const alarm = typeof rpm === 'number' && rpm >= 7000;
                assert(alarm ? [1, 2].includes(layer.uniforms.u_flash.v[0]) : layer.uniforms.u_flash.v[0] === 0, 'Flash follows only fresh RPM at or above 7000');
                const file = profile === 'comfort' ? 'artifacts/rpm_' + (rpm === null ? 'missing' : String(rpm).padStart(4, '0')) + '.png' : null;
                const png = PNG.sync.read(await page.locator('#hud').screenshot(file ? { path: path.join(root, file) } : {}));
                let flashPhase = null, litCells = null;
                if (alarm) {
                    const samples = Array.from({ length: CELL_COUNT }, (_, i) => { const p = (Math.floor(bar.y + bar.h / 2) * png.width + Math.floor(bar.x + (i + 0.5) * bar.w / CELL_COUNT - 1.5)) * 4; return Array.from(png.data.subarray(p, p + 3)); });
                    const match = colour => samples.every(rgb => rgb.every((v, i) => Math.abs(v - colour[i]) <= 2));
                    flashPhase = match([255, 59, 48]) ? 'bright' : match([46, 11, 9]) ? 'dim' : null;
                    assert(flashPhase, 'All eighty cells share one complete red flash phase');
                } else {
                    const lit = pixelFill(png, layer), expected = Array.from({ length: CELL_COUNT }, (_, i) => i < filledCells(rpm));
                    assert.deepStrictEqual(lit, expected, profile + ' RPM ' + rpm + ' segment pixels'); litCells = lit.filter(Boolean).length;
                }
                results.push({ profile, rpm, segments: CELL_COUNT, uValue: layer.uniforms.u_value.v[0], litCells, flashPhase, fixedZoneColoursVerified: !alarm, file });
            }
            let unchanged = null;
            for (const consumption of [0, 7.6, 30, null]) {
                const s = await input(raw, profile, label, fixture.rpm, consumption), layer = findBar(s);
                assert.equal(layer.uniforms.u_value.v[0], fillValue(fixture.rpm));
                const png = PNG.sync.read(await page.locator('#hud').screenshot()), current = sha(crop(png, bar, false));
                if (unchanged === null) unchanged = current;
                assert.equal(current, unchanged, profile + ' consumption must not alter the tachometer pixels');
            }
            invariance.push({ profile, axisMask, captionMask, barPixels, physicalSegments, labels, consumptionValuesChecked: [0, 7.6, 30, null], rpm: fixture.rpm });
        }
        assert.deepStrictEqual(errors, []);
        const report = { scope: 'Synthetic local renderer only; no vehicle data', rpmMaximum: 8000, cells: CELL_COUNT, rpmPerCell: RPM_PER_CELL, settledPresentation: true, cellBoundariesRpm: boundaries, rounding: 'Completed cells only; physical fill boundary / 8000; unavailable is empty', results, invariance, browserErrors: errors };
        fs.writeFileSync(path.join(root, 'artifacts/rpm-scale-verification.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        try { await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 }); }
        finally { await browser.close(); }
    }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

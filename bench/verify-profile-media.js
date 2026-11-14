'use strict';
// Browser regression check for independent actual gear, speed and truthful DSC labels.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./node_modules/playwright');
const { PNG } = require('./node_modules/pngjs');
const { waitForScene } = require('./scene-check');
const fixture = require('./profiles-fixture.json').signals;
const profileView = require('../apps/manuk_retro_cluster/profile_view');
const originalLayout = require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json');
const originalSpeedFont = require('../apps/manuk_retro_cluster/hud/fonts/d7_big.json');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8078);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fontFor(box) { return JSON.parse(fs.readFileSync(path.join(root, 'apps/manuk_retro_cluster/hud/fonts', box.font + '.json'), 'utf8')); }
function textMask(box, text, font, parts) {
    const alpha = Buffer.from(font.alpha, 'base64'), mask = new Uint8Array(box.w * box.h), brightness = new Float64Array(box.w * box.h);
    const colours = parts ? parts.flatMap(p => [...p.text].map(() => p.maxColour)) : [...text].map(() => 204);
    const chars = [...text], spacing = box.spacing || 0;
    const width = chars.reduce((sum, c, i) => { assert(font.glyphs[c], 'Missing glyph ' + c); return sum + font.glyphs[c].advance + (i < chars.length - 1 ? spacing : 0); }, 0);
    let pen = box.align === 'right' ? box.w - width : box.align === 'center' ? Math.round((box.w - width) / 2) : 0;
    chars.forEach((c, index) => {
        const glyph = font.glyphs[c], left = Math.round(pen + glyph.ox);
        for (let y = 0; y < Math.min(glyph.h, box.h); y++) for (let x = 0; x < glyph.w; x++) {
            const dx = left + x;
            if (dx >= 0 && dx < box.w) {
                const a = alpha[(glyph.y + y) * font.width + glyph.x + x], pixel = y * box.w + dx;
                mask[pixel] = Math.max(mask[pixel], a); brightness[pixel] = Math.max(brightness[pixel], a * colours[index] / 255);
            }
        }
        pen += glyph.advance + spacing;
    });
    return { alpha: mask, brightness };
}
function verifyTextPixels(png, box, text, font, parts) {
    const expected = textMask(box, text, font, parts), ghost = ['speed', 'gear'].includes(box.id) ? textMask(box, box.id === 'speed' ? '888' : '8', font).alpha : null;
    let expectedPixels = 0, actualPixels = 0, mismatches = 0;
    let top = box.h, bottom = -1;
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
        const p = ((box.y + y) * png.width + box.x + x) * 4;
        const actual = Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) > 100;
        const pixel = y * box.w + x;
        const ghostContribution = ghost ? ghost[pixel] / 255 * (40 / 255) * 204 * (1 - expected.alpha[pixel] / 255) : 0;
        const wanted = Math.round(expected.brightness[pixel] + ghostContribution) > 100;
        if (wanted) expectedPixels++;
        if (actual) { actualPixels++; top = Math.min(top, y); bottom = Math.max(bottom, y); }
        if (actual !== wanted) mismatches++;
    }
    assert(expectedPixels > 100 && actualPixels > 100, 'Text has visible foreground: ' + text);
    assert(mismatches / (box.w * box.h) <= 0.001, 'Canvas pixels differ from the expected text ' + text + ': ' + mismatches);
    return { text, expectedPixels, actualPixels, mismatches, inkHeight: bottom - top + 1 };
}
function verifyPartColours(png, box, font, parts) {
    const chars = parts.flatMap(part => [...part.text].map(character => ({ character, rgb: part.rgb })));
    const alpha = Buffer.from(font.alpha, 'base64'), width = chars.reduce((sum, item) => sum + font.glyphs[item.character].advance, 0);
    let pen = box.align === 'right' ? box.w - width : box.align === 'center' ? Math.round((box.w - width) / 2) : 0, samples = 0, mismatches = 0;
    chars.forEach(item => {
        const glyph = font.glyphs[item.character], left = Math.round(pen + glyph.ox);
        for (let y = 0; y < Math.min(glyph.h, box.h); y++) for (let x = 0; x < glyph.w; x++) {
            if (left + x < 0 || left + x >= box.w || alpha[(glyph.y + y) * font.width + glyph.x + x] !== 255) continue;
            const pixel = ((box.y + y) * png.width + box.x + left + x) * 4;
            samples++; if (item.rgb.some((channel, i) => Math.abs(png.data[pixel + i] - channel) > 2)) mismatches++;
        }
        pen += glyph.advance;
    });
    assert(samples > 50, 'Enough fully covered pixels for independent colour verification');
    assert.equal(mismatches, 0, 'Text parts have the prescribed independent colours');
    return { samples, mismatches, parts };
}
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const post = async (url, data) => { const r = await page.request.post(base + url, { data }); assert(r.ok(), url); };
    const screenshot = async file => PNG.sync.read(await page.locator('#hud').screenshot(file ? { path: path.join(root, file) } : {}));
    async function input(overrides) {
        const values = Object.assign({}, fixture, overrides || {});
        await post('/signals', { mode: 'manual', values });
        await page.waitForFunction(async expected => {
            const s = await (await fetch('/snapshot')).json(), v = s.values.visual;
            return v.speed === expected.speed && v.gear === expected.gear && v.selector === expected.selector && v.gearboxProgram === expected.gearboxProgram && v.dsc === expected.dsc && v.driveMode === expected.expectedDriveLabel;
        }, Object.assign({}, values, { expectedDriveLabel: values.driveModeRaw === 2 ? 'SPORT+' : 'COMFORT' }));
        await waitForScene(base, page); await page.waitForTimeout(300);
    }
    try {
        await post('/drive', { value: null }); await post('/signals', { mode: 'manual', values: fixture });
        await page.goto(base + '/?only=1&clean=1&car=0');
        const scene = await waitForScene(base, page), layout = profileView.layout(originalLayout, scene.values.configuration);
        const find = id => layout.widgets.find(w => w.id === id), speed = find('speed'), gear = find('gear'), caption = find('gear_label'), mode = find('drive_mode'), unit = find('speed_unit'), revs = find('revs');
        const removed = ['gear_program', 'gearbox_state'];
        removed.forEach(id => assert(!find(id), 'Transmission widget must be absent: ' + id));
        assert(gear && caption && find('gear_ghost'), 'Actual gear and its independent caption exist');
        assert(!layout.widgets.some(w => /\{\{gearboxState\}\}/.test(w.text || '')), 'No programme prefix is rendered beside the digit');
        const centre = revs.x + revs.w / 2;
        assert.deepStrictEqual([mode.x, mode.y, mode.w, mode.h], [570, 332, 780, 31], 'Mode/DSC keeps its size at the centred panel position');
        assert.equal(mode.x + mode.w / 2, centre);
        assert.equal((gear.x + speed.x + speed.w) / 2, centre, 'Reserved gear/speed group remains centred on the panel');
        assert.equal(unit.x + unit.w / 2, speed.x + speed.w / 2, 'Speed unit is centred under speed');
        assert.equal(caption.x + caption.w / 2, gear.x + gear.w / 2, 'Gear caption is centred under the actual gear');
        assert.equal((mode.y + unit.y + unit.h) / 2, (292 + 682) / 2, 'Central group is vertically centred between gauge headings and units');
        const speedFont = fontFor(speed), modeFont = fontFor(mode), gearFont = fontFor(gear), captionFont = fontFor(caption);
        assert(speedFont.size > originalSpeedFont.size, 'Speed glyphs are larger than the original 170px atlas');
        assert.equal(speed.h, speedFont.cellHeight);
        assert.equal(gear.font, speed.font); assert.equal(gear.h, speed.h); assert.equal(gear.y, speed.y);
        await input();
        const initial = await screenshot('artifacts/speed_center.png');
        const speedPixels = verifyTextPixels(initial, speed, '88', speedFont);
        const normalModePixels = verifyTextPixels(initial, mode, 'COMFORT / DSC ON', modeFont, [{ text: 'COMFORT', maxColour: 255 }, { text: ' / DSC ON', maxColour: 204 }]);
        const colour = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), white = [190, 198, 204];
        const speedColour = verifyPartColours(initial, speed, speedFont, [{ text: '88', rgb: white }]);
        const normalModeColours = verifyPartColours(initial, mode, modeFont, [{ text: 'COMFORT', rgb: colour(scene.values.configuration.profiles.accents.comfort) }, { text: ' / DSC ON', rgb: white }]);
        const capturedProfiles = ['comfort', 'sport', 'eco'].map(name => PNG.sync.read(fs.readFileSync(path.join(root, 'artifacts', name + '.png'))));
        const staticWidgets = layout.widgets.filter(w => !['bg', 'drive_mode'].includes(w.id));
        function regionHash(png, box) {
            const pixels = [];
            for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const p = (y * png.width + x) * 4; pixels.push(...png.data.subarray(p, p + 4)); }
            return hash(Buffer.from(pixels));
        }
        staticWidgets.forEach(widget => {
            const reference = regionHash(capturedProfiles[0], widget);
            capturedProfiles.slice(1).forEach(png => assert.equal(regionHash(png, widget), reference, widget.id + ' retains its white base palette across profiles'));
        });
        const modeHash = regionHash(initial, mode), gearCases = [];
        const cases = Array.from({ length: 8 }, (_, i) => ({ name: 'gear_' + (i + 1), values: { gear: i + 1 }, digit: String(i + 1), caption: 'D' }));
        cases.push({ name: 'gear_s', values: { gear: 4, gearboxProgram: 'S' }, digit: '4', caption: 'S' });
        cases.push({ name: 'gear_m', values: { gear: 4, gearboxProgram: 'M' }, digit: '4', caption: 'M' });
        cases.push({ name: 'gear_unknown_program', values: { gear: 4, gearboxProgram: null }, digit: '4', caption: 'D' });
        cases.push({ name: 'gear_unknown_selector', values: { gear: 4, selector: null, gearboxProgram: null }, digit: '4', caption: '-' });
        cases.push({ name: 'gear_invalid_9', values: { gear: 9 }, digit: '-', caption: 'D' });
        ['P', 'R', 'N'].forEach(selector => {
            cases.push({ name: 'selector_' + selector.toLowerCase(), values: { speed: 0, gear: null, selector, gearboxProgram: 'S' }, digit: selector, caption: selector });
            cases.push({ name: 'selector_' + selector.toLowerCase() + '_retained', values: { speed: 0, gear: 4, selector, gearboxProgram: 'S' }, digit: selector, caption: selector });
        });
        await post('/signals', { mode: 'manual', values: Object.assign({}, fixture, { selector: 'D', gear: null, simulateCarSafety: true }) });
        await page.waitForFunction(async () => (await (await fetch('/snapshot')).json()).layers.length === 0);
        cases.push({ name: 'gear_unavailable', values: { gear: null, gearboxProgram: null, simulateCarSafety: false }, digit: '-', caption: 'D' });
        cases.push({ name: 'gear_unknown_all', values: { gear: null, selector: null, gearboxProgram: null, simulateCarSafety: false }, digit: '-', caption: '-' });
        for (const item of cases) {
            await input(item.values);
            const file = 'artifacts/' + item.name + '.png', png = await screenshot(file);
            assert.equal(regionHash(png, mode), modeHash, 'Mode/DSC pixels do not change with gear/selector/program');
            const digit = verifyTextPixels(png, gear, item.digit, gearFont);
            const label = verifyTextPixels(png, caption, 'КПП: ' + item.caption, captionFont);
            const digitColour = verifyPartColours(png, gear, gearFont, [{ text: item.digit, rgb: white }]);
            const captionColour = verifyPartColours(png, caption, captionFont, [{ text: 'КПП: ' + item.caption, rgb: white }]);
            gearCases.push({ name: item.name, file, digit, label, digitColour, captionColour, safetyPreviewException: item.values.simulateCarSafety === false });
        }
        const speedCases = [];
        for (const value of [0, 1, 10, 88, 123, 250]) {
            await input({ speed: value }); const png = await screenshot();
            assert.equal(regionHash(png, mode), modeHash, 'Mode/DSC pixels do not change with speed');
            speedCases.push(verifyTextPixels(png, speed, String(value), speedFont));
        }
        await input({ driveModeRaw: 2, dsc: 'DTC' });
        const traction = await screenshot('artifacts/traction.png');
        const tractionPixels = verifyTextPixels(traction, mode, 'SPORT+ / TRACTION', modeFont, [{ text: 'SPORT+', maxColour: 255 }, { text: ' / ', maxColour: 204 }, { text: 'TRACTION', maxColour: 255 }]);
        const tractionColours = verifyPartColours(traction, mode, modeFont, [{ text: 'SPORT+', rgb: colour(scene.values.configuration.profiles.accents.sport) }, { text: ' / ', rgb: white }, { text: 'TRACTION', rgb: [255, 224, 64] }]);
        verifyTextPixels(traction, speed, '88', speedFont);
        const videoFile = 'artifacts/profile-switching.webm', bytes = fs.readFileSync(path.join(root, videoFile));
        const dimensions = await page.evaluate(async data => {
            const video = document.createElement('video'); video.src = 'data:video/webm;base64,' + data;
            await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
            await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; video.currentTime = 2; });
            return { width: video.videoWidth, height: video.videoHeight, decodedFrameSeconds: video.currentTime };
        }, bytes.toString('base64'));
        assert.equal(dimensions.width, 1920); assert.equal(dimensions.height, 720); assert.equal(dimensions.decodedFrameSeconds, 2);
        assert.deepStrictEqual(errors, []);
        const report = { scope: 'Local synthetic canvas only', file: videoFile, bytes: bytes.length, ...dimensions,
            removedTransmissionWidgets: removed, gearCases, speedCases, modePixelsInvariant: true, missingForwardGearReleasesScene: true,
            centreX: centre, speedFont: { name: speed.font, size: speedFont.size, cellHeight: speedFont.cellHeight },
            speedPixels, normalModePixels, tractionPixels, speedColour, normalModeColours, tractionColours, staticPaletteWidgets: staticWidgets.map(w => w.id), browserErrors: errors };
        fs.writeFileSync(path.join(root, 'artifacts/profiles-video-verification.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        try { await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 }); }
        finally { await browser.close(); }
    }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

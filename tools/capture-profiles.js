'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('../bench/node_modules/playwright');
const fixture = require('../bench/profiles-fixture.json').signals;
const groups = require('../bench/profile-signals').GROUPS;
const { waitForScene, budget } = require('../bench/scene-check');
const { PNG } = require('../bench/node_modules/pngjs');
const checkUnits = require('../bench/check-display-units');
const profileView = require('../apps/manuk_retro_cluster/profile_view'), originalLayout = require('../apps/manuk_retro_cluster/hud/layouts/retro80s.json');
(async () => {
    const base = 'http://127.0.0.1:' + (process.env.BENCH_PORT || 8078);
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1920, height: 720 }, deviceScaleFactor: 1 });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const post = async (url, data) => { const r = await page.request.post(base + url, { data: data || {} }); assert(r.ok(), url); };
        const snapshot = async () => (await page.request.get(base + '/snapshot')).json();
        const before = await snapshot(); assert.equal(before.clock, '14:36', 'Start bench with BENCH_CLOCK=14:36 for repeatable captures');
        const config = JSON.parse(JSON.stringify(before.values.configuration));
        config.profiles.enabled = true; config.profiles.followVehicleMode = true; config.language = 'ru'; config.units = 'metric'; config.clock = '24h';
        await post('/configuration', { configuration: config });
        await Promise.all(Object.keys(groups).map(source => post('/source', { source, available: true })));
        await post('/renderer', { online: true }); await post('/enabled', { value: true });
        await post('/signals', { mode: 'manual', values: fixture }); await post('/drive', { value: 4 });
        await page.goto(base + '/?only=1&clean=1&car=0');
        await waitForScene(base, page); await page.waitForTimeout(1500);
        const results = [];
        function assertProfile(snapshot, profile, label) {
            assert.equal(snapshot.values.visual.profile, profile, 'Profile changed during capture');
            assert.equal(snapshot.values.visual.driveMode, label, 'FES state changed during capture');
            assert.equal(snapshot.values.visual.speed, 88); assert.equal(snapshot.values.values.rpm, 3200);
            assert.equal(snapshot.values.visual.gear, 4); assert.equal(snapshot.values.visual.dsc, 'ON'); assert.equal(snapshot.values.visual.gearboxProgram, 'D');
            assert.equal(snapshot.values.values.consumption, 7.6); assert.equal(snapshot.values.values.range, 450);
            assert.equal(snapshot.values.values.fuelL, 40); assert.equal(snapshot.values.values.boost, 0.8);
        }
        for (const [name, raw, profile, label] of [['comfort', 4, 'comfort', 'COMFORT'], ['sport', 1, 'sport', 'SPORT'], ['eco', 7, 'eco', 'ECO PRO'], ['adaptive', 10, 'neutral', 'ADAPTIVE']]) {
            await post('/drive', { value: raw });
            await page.waitForFunction(async expected => { const s = await (await fetch('/snapshot')).json(); return s.values.visual && s.values.visual.profile === expected.profile && s.values.visual.driveMode === expected.label; }, { profile, label });
            await page.waitForTimeout(700);
            const s = await waitForScene(base, page); assertProfile(s, profile, label); budget(s);
            const file = 'artifacts/' + name + '.png', temporary = 'artifacts/.' + name + '.capture.png';
            const png = PNG.sync.read(await page.locator('#hud').screenshot({ path: path.resolve(temporary) }));
            const displayUnits = checkUnits(png, profileView.layout(originalLayout, s.values.configuration), s.values.configuration);
            assertProfile(await snapshot(), profile, label);
            fs.renameSync(path.resolve(temporary), path.resolve(file));
            results.push({ file, expectedProfile: profile, width: 1920, height: 720, visual: s.values.visual, displayUnits,
                leftGauges: { consumption: s.values.values.consumption, range: s.values.values.range, fuelLitres: s.values.values.fuelL },
                rightGauges: { oil: s.values.values.oil, coolant: s.values.values.coolant },
                layers: s.layers.length, pixelBytes: s.pixels, layerReferences: s.layers.map(l => [l.key, l.x, l.y, l.w, l.h]) });
        }
        await post('/drive', { value: 4 }); await page.waitForTimeout(700);
        const supported = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
        let video = null;
        if (supported) {
            await page.evaluate(() => {
                const recorder = new MediaRecorder(document.getElementById('hud').captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 3000000 }), parts = [];
                window.profileVideo = new Promise(resolve => { recorder.ondataavailable = e => parts.push(e.data); recorder.onstop = async () => { const bytes = new Uint8Array(await new Blob(parts).arrayBuffer()); let text = ''; for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]); resolve(btoa(text)); }; });
                window.profileRecorder = recorder; recorder.start();
            });
            for (const raw of [4, 1, 7, 4]) {
                await post('/drive', { value: raw }); await page.waitForTimeout(1800);
                assertProfile(await snapshot(), { 4: 'comfort', 1: 'sport', 7: 'eco' }[raw], { 4: 'COMFORT', 1: 'SPORT', 7: 'ECO PRO' }[raw]);
            }
            await page.evaluate(() => window.profileRecorder.stop());
            const data = await page.evaluate(() => window.profileVideo);
            video = 'artifacts/profile-switching.webm'; fs.writeFileSync(path.resolve(video), Buffer.from(data, 'base64'));
        }
        assert.deepStrictEqual(errors, []);
        const report = { scope: 'Synthetic local stand, identical speed/RPM/gear/DSC and fixed 14:36; no vehicle readings', screenshots: results, video, browserErrors: errors };
        fs.writeFileSync(path.resolve('artifacts/profiles-captures.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

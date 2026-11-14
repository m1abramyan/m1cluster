'use strict';
// Local development only. No application runtime dependency.
const fs = require('fs');
const path = require('path');
const { waitForScene } = require('../bench/scene-check');
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, '../bench/node_modules/playwright'].filter(Boolean)) {
  try { playwright = require(name); break; } catch (_) {}
}
if (!playwright) throw new Error('Install bench dependencies: npm --prefix bench install; or set PLAYWRIGHT_MODULE');
(async () => {
 const port = Number(process.env.BENCH_PORT || 8078);
 const out = path.resolve(process.argv[2] || 'artifacts/retro_current.png');
 if (fs.existsSync(out) && path.basename(out) === 'reference_retro.png') throw new Error('Reference is immutable; choose a different file to re-check it.');
 if (path.basename(out) === 'retro_cluster.png') {
  const snapshot = await (await fetch('http://127.0.0.1:'+port+'/snapshot')).json();
  const expected = require('../artifacts/comparison-config.json');
  const fixture = require('../bench/fixture.json');
  const actual = snapshot.values && snapshot.values.configuration;
  if (!actual || actual.language !== 'en' || !actual.profiles || actual.profiles.enabled !== false || snapshot.clock !== fixture.clock || snapshot.signals.mode !== 'manual' || JSON.stringify(snapshot.signals.values) !== JSON.stringify(fixture.signals) || ['units','clock','timeZone','retro'].some(k=>JSON.stringify(actual[k])!==JSON.stringify(expected[k]))) {
   throw new Error('Refusing to overwrite comparison with a different profile, signals or clock. Use artifacts/retro_current.png for current/metric captures.');
  }
 }
 const browser = await playwright.chromium.launch({executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page = await browser.newPage({viewport:{width:1920,height:720},deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:'+port+'/?only=1&clean=1&car=0');
  await waitForScene('http://127.0.0.1:'+port,page);
  await page.waitForTimeout(2500);
  const errors = await page.locator('#log .error').allTextContents();
  if (errors.length) throw new Error(errors.join('\n'));
  await page.locator('#hud').screenshot({path:out});
  console.log(out);
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

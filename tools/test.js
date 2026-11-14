#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
const names = fs.readdirSync(path.join(root, 'tests')).filter((f) => /(?:\.test|_test|runtime[^.]*)\.js$/.test(f)).sort();
let failed = false;
names.forEach((f) => {
    const r = cp.spawnSync(process.execPath, [path.join(root, 'tests', f)], { stdio: 'inherit', timeout: 30000 });
    if (r.status !== 0) { console.error('FAIL ' + f, r.error ? r.error.message : ''); failed = true; }
});
const py = cp.spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', '*_test.py', '-v'], { cwd: root, stdio: 'inherit', timeout: 60000 });
if (py.status !== 0) failed = true;
const compat = cp.spawnSync(process.execPath, ['tools/check-compat.js'], { cwd: root, stdio: 'inherit', timeout: 30000 });
if (compat.status !== 0) failed = true;
process.exitCode = failed ? 1 : 0;

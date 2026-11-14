#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) { fs.readdirSync(dir).forEach((n) => { const f = path.join(dir, n); if (fs.statSync(f).isDirectory()) walk(f); else if (/\.js$/.test(n)) files.push(f); }); }
['apps/manuk_retro_cluster', 'shared', 'kit/runtime'].forEach((d) => walk(path.join(root, d)));
const forbidden = /\b(?:Object\.fromEntries|Promise\.allSettled|structuredClone|queueMicrotask|fs\.promises|fs\.rmSync|fs\.cpSync|globalThis)\b|\.flatMap\(|\.replaceAll\(|\brequire\(['"](?:node:|worker_threads)/;
let bad = 0;
files.forEach((f) => {
    const source = fs.readFileSync(f, 'utf8');
    try { acorn.parse(source, { ecmaVersion: 2017, sourceType: 'script', allowHashBang: true }); } catch (e) { console.error(path.relative(root, f) + ': ' + e.message); bad++; }
    // Audit known common post-Node-8 API mistakes. This is deliberately not a runtime claim.
    if (forbidden.test(source)) { console.error('Post-Node-8 API needs review: ' + path.relative(root, f)); bad++; }
});
console.log((bad ? 'FAIL' : 'PASS') + ' compatibility static check: ' + files.length + ' JS files (ES2017 + common API audit). Actual Node 8 execution is a separate check.');
process.exitCode = bad ? 1 : 0;

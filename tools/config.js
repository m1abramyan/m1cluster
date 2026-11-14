#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../apps/manuk_retro_cluster/config');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
const file = option('--file');
const profile = option('--profile') || 'car';
const action = args[0] || 'validate';
try {
    if (!file || args.length > 1 || ['validate', 'init', 'enable', 'disable'].indexOf(action) < 0) throw new Error('Usage: node tools/config.js --file /absolute/config.json [--profile car|bench] init|validate|enable|disable');
    if (action === 'init') {
        if (fs.existsSync(file)) throw new Error('File already exists; not overwritten');
        config.writeAtomic(file, config.defaults(profile));
    } else {
        const value = config.validate(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (action !== 'validate') { value.enabled = action === 'enable'; config.writeAtomic(file, value); }
    }
    console.log(action + ': ' + path.resolve(file));
} catch (e) { console.error(e.message); process.exitCode = 1; }

#!/usr/bin/env node
'use strict';
// Bounded, explicit read-only inspection. This file never loads mgu.js, main.js or a renderer.
// The staged kit/signals.js resolves the same native someip binding and per-app generated definitions.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const KEYS = ['speed', 'rpm', 'coldRpmLimit', 'oil', 'coolant', 'gear', 'stage', 'condition', 'fuelL', 'range',
    'driveMode', 'driveProfile', 'selector', 'actualGear', 'mode', 'engineRunning', 'engineProfile', 'program', 'gearboxProgram', 'dsc', 'asc', 'abs',
    'torque', 'power', 'boost', 'ambient', 'outside', 'odo', 'odometer', 'gLat', 'gLong', 'intake',
    'avgConsumption', 'averageConsumption', 'avgCons1', 'avgCons2', 'tripDistance', 'tripTime', 'tripMinutes',
    'instantConsumption', 'consumption', 'fuelRate', 'fuelFlow', 'tripFuel', 'pressureUnit', 'temperatureUnit',
    'pFL', 'pFR', 'pRL', 'pRR', 'tFL', 'tFR', 'tRL', 'tRR'];
const READING_FIELDS = ['value', 'unit', 'source', 'quality', 'receivedAt', 'active', 'raw', 'candidate', 'candidateUnit', 'inputUnit', 'interval', 'formula', 'reason', 'confirmation'];
const RAW_MEMBERS = { dsc: ['qualifierFunctionFDR', 'qualifierFunctionASC', 'qualifierFunctionABS'], tripMinutes: ['rideDurationHours', 'rideDurationMinutes'] };
const PROVIDERS = ['cds', 'speed', 'gear', 'condition', 'fuel', 'boost', 'accel', 'units', 'tyres', 'ambient', 'mdrive', 'dsc'];
const MAX_BYTES = 256 * 1024, MAX_SAMPLES = 121;
function scalar(v) {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string') return /^[A-Za-zА-Яа-яЁё0-9 ._:/+−()*=%°?,-]{0,512}$/.test(v) && !/\b[A-HJ-NPR-Z0-9]{17}\b/.test(v) ? v : '[omitted]';
    return null;
}
function snapshot(source) {
    const all = source.diagnostics(), out = { providers: {}, readings: {} };
    PROVIDERS.forEach((key) => {
        if (!all.providers || !all.providers[key]) return;
        const p = all.providers[key] || {};
        out.providers[key] = { interface: scalar(p.interface), available: p.available === true, epoch: scalar(p.epoch) };
    });
    KEYS.forEach((key) => {
        const r = all.readings && all.readings[key];
        if (!r || typeof r !== 'object') return;
        const clean = {};
        READING_FIELDS.forEach((f) => {
            if (r[f] === undefined) return;
            if (RAW_MEMBERS[key] && f === 'raw' && r[f] && typeof r[f] === 'object') {
                clean.raw = {};
                RAW_MEMBERS[key].forEach((q) => {
                    if (r.raw[q] !== undefined) clean.raw[q] = scalar(r.raw[q]);
                });
            } else clean[f] = scalar(r[f]);
        });
        out.readings[key] = clean;
    });
    return out;
}
function parse(argv) {
    const o = { seconds: 30, worker: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--worker') o.worker = true;
        else if (a === '--runtime' || a === '--output' || a === '--native-dir') {
            if (!argv[i + 1] || argv[i + 1].slice(0, 2) === '--') throw new Error('Missing value for ' + a);
            o[a.slice(2).replace('-', '_')] = argv[++i];
        } else if (a === '--seconds') o.seconds = Number(argv[++i]);
        else throw new Error('Unknown argument ' + a);
    }
    if (!o.runtime || !path.isAbsolute(o.runtime) || !o.output || !path.isAbsolute(o.output)) throw new Error('Use absolute --runtime and --output paths');
    if (!Number.isInteger(o.seconds) || o.seconds < 1 || o.seconds > 120) throw new Error('--seconds must be an integer from 1 to 120');
    if (o.native_dir && !path.isAbsolute(o.native_dir)) throw new Error('--native-dir must be absolute');
    if (!fs.statSync(path.dirname(o.output)).isDirectory()) throw new Error('Output parent must already exist');
    if (fs.existsSync(o.output)) throw new Error('Output already exists; choose a new file');
    return o;
}
function loadRuntime(o) {
    const pkg = JSON.parse(fs.readFileSync(path.join(o.runtime, '..', 'package.json'), 'utf8'));
    if (pkg.name !== 'manuk_retro_cluster') throw new Error('Runtime belongs to a different application');
    if (pkg.mguBenchOnly === true) throw new Error('Bench/stub runtime refused; this probe is for actual signals only');
    if (o.native_dir) {
        // Node 8 supports this resolver refresh. Only this probe process is affected.
        process.env.NODE_PATH = o.native_dir + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
        require('module')._initPaths();
    }
    const signals = require(path.join(o.runtime, 'kit/signals.js'));
    if (!signals.hasNative || !signals.hasNative()) throw new Error('Native SOME/IP module is unavailable; no signal inspection performed');
    const Source = require(path.join(o.runtime, 'retro_source.js'));
    if (!Source.prototype.diagnostics) throw new Error('This installed version has no diagnostic metadata; update only our source package first');
    const config = require(path.join(o.runtime, 'config.js')).defaults('car');
    // No persistent configuration is loaded/written. This only permits the source's guarded getters.
    config.enabled = true;
    config.safety.requireVehicleCondition = true;
    const log = { info: function () {}, warn: function () {}, error: function () {}, debug: function () {} };
    return new Source({ signals: signals, log: log }, function () { return config; });
}
function collect(source, durationMs, opts) {
    opts = opts || {};
    const now = opts.now || Date.now;
    const samples = [], start = now();
    let stopped = false, tick, deadline, unlisten, droppedSamples = 0;
    return new Promise((resolve, reject) => {
        const take = () => {
            const sample = { elapsedMs: now() - start, data: snapshot(source) };
            samples.push(sample);
            // Keep the first and newest observations within the bound, so late availability is visible.
            while (samples.length > MAX_SAMPLES || Buffer.byteLength(JSON.stringify({ samples: samples }, null, 2), 'utf8') >= MAX_BYTES - 2048) {
                samples.splice(samples.length > 2 ? 1 : 0, 1); droppedSamples++;
            }
        };
        const finish = (reason, error) => {
            if (stopped) return; stopped = true;
            clearInterval(tick); clearTimeout(deadline);
            if (unlisten) unlisten();
            try { take(); } catch (e) { if (!error) error = e; }
            try { source.stop(); } catch (e) { if (!error) error = e; }
            if (error) reject(error);
            else resolve({ schemaVersion: 1, app: 'manuk_retro_cluster', readOnly: true,
                confirmation: 'not-verified-on-this-car', durationMs: now() - start, reason: reason, droppedSamples: droppedSamples, samples: samples });
        };
        // Set deadline before source.start: unresolved watch promises cannot prolong the run.
        deadline = setTimeout(() => finish('deadline'), durationMs);
        if (opts.onStop) unlisten = opts.onStop(() => finish('interrupted'));
        try {
            source.start(); take();
            tick = setInterval(() => { try { source.tick(); take(); } catch (e) { finish('error', e); } }, Math.min(1000, durationMs));
        } catch (e) { finish('error', e); }
    });
}
function save(file, report) {
    const text = JSON.stringify(report, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Report exceeded maximum size');
    fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
}
function worker(o) {
    const source = loadRuntime(o);
    return collect(source, o.seconds * 1000, { onStop: (fn) => {
        process.once('SIGTERM', fn); process.once('SIGINT', fn);
        return () => { process.removeListener('SIGTERM', fn); process.removeListener('SIGINT', fn); };
    } }).then((report) => { save(o.output, report); process.stdout.write('Read-only report: ' + o.output + '\n'); });
}
function supervise(o, args) {
    // Only this child is stopped on timeout. No BMW, renderer, MainApp or Store process is touched.
    const child = cp.spawn(process.execPath, [__filename, '--worker'].concat(args), {
        stdio: 'inherit', env: Object.assign({}, process.env, { RETRO_PROBE_CHILD: '1' })
    });
    let forced, interrupted = false;
    const interrupt = () => {
        if (interrupted) return; interrupted = true;
        child.kill('SIGTERM');
        forced = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const deadline = setTimeout(interrupt, o.seconds * 1000 + 1500);
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    child.on('error', () => { clearTimeout(deadline); clearTimeout(forced); process.exitCode = 1; });
    child.on('exit', (code) => {
        clearTimeout(deadline); clearTimeout(forced);
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
        process.exitCode = code === 0 ? 0 : 1;
        if (code !== 0) process.stderr.write('Inspection did not complete; do not treat a missing report as valid data.\n');
    });
}
if (require.main === module) {
    try {
        const args = process.argv.slice(2), opts = parse(args);
        if (opts.worker && process.env.RETRO_PROBE_CHILD !== '1') throw new Error('--worker is an internal supervisor option');
        if (opts.worker) worker(opts).then(() => setTimeout(() => process.exit(0), 250), (e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
        else supervise(opts, args);
    } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
module.exports = { parse: parse, loadRuntime: loadRuntime, snapshot: snapshot, collect: collect, save: save, KEYS: KEYS, MAX_BYTES: MAX_BYTES };

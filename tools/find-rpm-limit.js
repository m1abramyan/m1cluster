#!/usr/bin/env node
'use strict';
// Offline metadata inspection only. Schema evidence: pinned idrive7-apps
// kit/tools/sigdoc.py and check_signals.py. Never load SDK/native code or values.
const fs = require('fs');
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_STEPS = 200000;
const MAX_RESULTS = 500;
const MAX_DEPTH = 16;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const map = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v) => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_.:-]{0,239}$/.test(v) && !/^[A-HJ-NPR-Z0-9]{17}$/.test(v);

function category(names) {
    const s = names.join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(rpm|enginespeed|speedengine|enginerevol|revolutionengine|drehzahl|crankshaft)/.test(s) &&
        /(max|limit|allow|avail|permit|restrict|cold|warm|redline|range)/.test(s)) return 'rpm-limit';
    if (/(coldstart|warmup|enginewarm|warmengine|enginecold|coldengine)/.test(s)) return 'warmup-state';
    if (/(power|torque).*(limit|avail|reduc|restrict)|(limit|avail|reduc|restrict).*(power|torque)/.test(s)) return 'power-torque-limit';
    return null;
}

function scan(db) {
    if (!map(db) || !map(db.interfaces) || !map(db.datatypes)) throw new Error('Expected a master JSON catalog with interfaces and datatypes maps.');
    let steps = 0, fields = 0, unresolved = 0, cycles = 0, omitted = 0;
    const candidates = [], seen = Object.create(null);
    const step = () => { if (++steps > MAX_STEPS) throw new Error('Catalog traversal limit exceeded; no complete report produced.'); };
    function emit(ctx, members, ref, type, pointer) {
        const kind = category([ctx.iface, ctx.field].concat(members, identifier(ref) ? [ref] : []));
        if (!kind) return;
        const key = [ctx.iface, ctx.field].concat(members).join('/');
        if (seen[key]) {
            if (!seen[key].type && identifier(type)) seen[key].type = type;
            return;
        }
        if (candidates.length >= MAX_RESULTS) throw new Error('Candidate limit exceeded; narrow the local catalog before inspection.');
        const candidate = { interface: ctx.iface, field: ctx.field, memberPath: members,
            dataRef: identifier(ref) ? ref : null, type: identifier(type) ? type : null,
            kind: kind, metadataPointer: pointer, getter: ctx.getter, notifier: ctx.notifier,
            evidence: 'metadata-only', unit: null, scale: null, invalidValues: null, updateFrequency: null };
        seen[key] = candidate;
        candidates.push(candidate);
    }
    function walk(ref, ctx, members, stack, pointer) {
        step();
        if (stack.length >= MAX_DEPTH) { omitted++; return; }
        if (!identifier(ref)) { omitted++; return; }
        if (stack.indexOf(ref) >= 0) { cycles++; return; }
        const d = own(db.datatypes, ref) ? db.datatypes[ref] : null;
        if (!map(d)) { unresolved++; emit(ctx, members, ref, null, pointer); return; }
        const next = stack.concat(ref), type = identifier(d.type) ? d.type : null;
        emit(ctx, members, ref, type, pointer);
        if (type === 'struct') {
            if (d.extends) walk(d.extends, ctx, members, next, '/datatypes/' + ref + '/extends');
            if (Array.isArray(d.members)) d.members.forEach((m, i) => {
                step();
                if (!map(m) || !identifier(m.name)) { omitted++; return; }
                const p = '/datatypes/' + ref + '/members/' + i;
                // Even an unresolved leaf can contain a useful candidate name.
                emit(ctx, members.concat(m.name), m.dataRef, null, p);
                walk(m.dataRef, ctx, members.concat(m.name), next, p);
            });
        } else if (type === 'typedef') {
            walk(d.dataRef || d.baseType, ctx, members, next, '/datatypes/' + ref);
        } else if (type === 'array') {
            walk(d.elementDataRef, ctx, members, next, '/datatypes/' + ref + '/elementDataRef');
        }
        // Enum item values, descriptions, defaults and live-value properties are never emitted.
    }
    Object.keys(db.interfaces).sort().forEach((iface) => {
        step();
        const i = db.interfaces[iface];
        if (!identifier(iface) || !map(i) || !map(i.fields)) { omitted++; return; }
        Object.keys(i.fields).sort().forEach((field) => {
            step();
            const f = i.fields[field];
            if (!identifier(field) || !map(f)) { omitted++; return; }
            fields++;
            const ctx = { iface: iface, field: field, getter: !!(map(f.getter) && f.getter.id), notifier: !!f.notifier };
            const pointer = '/interfaces/' + iface + '/fields/' + field;
            emit(ctx, [], f.dataRef, null, pointer);
            walk(f.dataRef, ctx, [], [], pointer);
        });
    });
    return { schemaVersion: 1, offlineOnly: true, evidence: 'metadata-only',
        conclusion: 'Names are candidates only; availability, meaning, units and live values are unverified.',
        inspectedFields: fields, unresolvedTypes: unresolved, cyclicTypes: cycles,
        omittedEntries: omitted, incomplete: !!(unresolved || cycles || omitted), candidates: candidates };
}

function read(file) {
    if (typeof file !== 'string' || !file || /^[a-z][a-z0-9+.-]*:\/\//i.test(file)) throw new Error('Provide one explicit local JSON catalog path.');
    let fd;
    try {
        const before = fs.statSync(file);
        if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Input must be a regular local file no larger than 40 MiB.');
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Input must be a regular local file no larger than 40 MiB.');
        const data = Buffer.alloc(stat.size + 1);
        let length = 0, n;
        while (length < data.length && (n = fs.readSync(fd, data, length, data.length - length, null)) > 0) length += n;
        if (length > stat.size) throw new Error('Catalog changed while reading; retry with a stable local copy.');
        let db;
        try { db = JSON.parse(data.slice(0, length).toString('utf8')); }
        catch (e) { throw new Error('Input is not valid JSON; no content was printed.'); }
        return scan(db);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function main(argv) {
    if (argv.length !== 1 || argv[0] === '--help') {
        process.stderr.write('Usage: node tools/find-rpm-limit.js /absolute/local/someip-interfaces.json\nOffline metadata inspection only; never connects to a vehicle.\n');
        return argv[0] === '--help' ? 0 : 2;
    }
    try { process.stdout.write(JSON.stringify(read(argv[0]), null, 2) + '\n'); return 0; }
    catch (e) {
        // Filesystem errors can contain personal paths; JSON parser errors can contain data.
        process.stderr.write('Catalog scan failed: ' + (e.code ? 'cannot read the supplied local file.' : e.message) + '\n');
        return 1;
    }
}
module.exports = { scan, read, category, MAX_BYTES, MAX_RESULTS };
if (require.main === module) process.exitCode = main(process.argv.slice(2));

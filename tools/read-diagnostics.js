#!/usr/bin/env node
'use strict';
// Offline import of the text from every diagnostic QR page. Never contacts a car.
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const MAX_BYTES = 256 * 1024, MAX_PAGES = 64;
function pagesFrom(texts) {
    const pages = [];
    texts.forEach((text) => {
        if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('QR input exceeds the limit');
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { throw new Error('Use the scanned JSON text, or a JSON array of QR pages'); }
        (Array.isArray(parsed) ? parsed : [parsed]).forEach((page) => {
            if (typeof page === 'string') {
                if (Buffer.byteLength(page) > 1200) throw new Error('QR text exceeds the limit');
                try { page = JSON.parse(page); } catch (_) { throw new Error('Invalid JSON in scanned QR text'); }
            }
            if (!page || page.schema !== 'm1cluster-diag-1' || page.encoding !== 'gzip+base64' ||
                !/^[a-f0-9]{12}$/.test(page.sessionId) || !/^[a-f0-9]{64}$/.test(page.sha256) ||
                !/^\d+\.\d+\.\d+$/.test(page.appVersion) || ['bench', 'car'].indexOf(page.environment) < 0 ||
                !Number.isInteger(page.total) || page.total < 1 || page.total > MAX_PAGES ||
                !Number.isInteger(page.part) || page.part < 1 || page.part > page.total ||
                typeof page.chunk !== 'string' || !/^[A-Za-z0-9+/=]{1,600}$/.test(page.chunk)) throw new Error('Invalid diagnostic QR page');
            if (pages.length >= MAX_PAGES) throw new Error('Too many QR pages');
            pages.push(page);
        });
    });
    if (!pages.length) throw new Error('No QR pages supplied');
    const first = pages[0], seen = {};
    pages.forEach((page) => {
        ['sessionId', 'sha256', 'appVersion', 'environment', 'total'].forEach((key) => {
            if (page[key] !== first[key]) throw new Error('Pages belong to different reports');
        });
        if (seen[page.part]) throw new Error('Duplicate QR page ' + page.part);
        seen[page.part] = true;
    });
    if (pages.length !== first.total) throw new Error('Missing QR pages: received ' + pages.length + ' of ' + first.total);
    return pages.sort((a, b) => a.part - b.part);
}
function decode(texts) {
    return Promise.resolve().then(() => {
        const pages = pagesFrom(texts), text = pages.map((p) => p.chunk).join(''), compressed = Buffer.from(text, 'base64');
        if (compressed.toString('base64') !== text) throw new Error('Invalid base64 data');
        return new Promise((resolve, reject) => {
            const gunzip = zlib.createGunzip(), chunks = [];
            let size = 0, failed = false;
            const fail = (error) => { if (failed) return; failed = true; gunzip.destroy(); reject(error); };
            gunzip.on('error', () => fail(new Error('Compressed report is damaged')));
            gunzip.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_BYTES) return fail(new Error('Unpacked report exceeds the limit'));
                chunks.push(chunk);
            });
            gunzip.on('end', () => {
                if (failed) return;
                try {
                    const data = Buffer.concat(chunks);
                    if (crypto.createHash('sha256').update(data).digest('hex') !== pages[0].sha256) throw new Error('Report checksum mismatch');
                    const report = JSON.parse(data.toString('utf8')), first = pages[0];
                    if (report.app !== 'manuk_retro_cluster' || report.schema !== 'm1cluster-diag-1' || report.sessionId !== first.sessionId || report.environment !== first.environment || report.appVersion !== first.appVersion ||
                        report.readOnly !== true || report.rawOnly !== true || !report.sources || typeof report.sources !== 'object') throw new Error('Report and QR metadata disagree');
                    resolve(report);
                } catch (e) { fail(e instanceof SyntaxError ? new Error('Invalid report JSON') : e); }
            });
            gunzip.end(compressed);
        });
    });
}
async function main(args) {
    const files = []; let output = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--output') { if (output || !args[i + 1]) throw new Error('Specify one --output path'); output = args[++i]; }
        else if (args[i].slice(0, 2) === '--') throw new Error('Unknown option');
        else files.push(args[i]);
    }
    if (!files.length) throw new Error('Usage: node tools/read-diagnostics.js qr-1.txt qr-2.txt ... --output diagnostics-private/report.json');
    const texts = files.map((file) => {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Input must be a small regular file');
        return fs.readFileSync(file, 'utf8');
    });
    const report = await decode(texts);
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ environment: report.environment, simulation: report.environment === 'bench', version: report.appVersion,
        state: report.state, reason: report.reason, elapsedSeconds: report.elapsedSeconds, sources: Object.keys(report.sources),
        metadataStatus: report.metadata && report.metadata.status,
        note: 'Raw observations only. Checksum detects damage, not authenticity or correct vehicle interpretation.', saved: !!output }, null, 2) + '\n');
}
if (require.main === module) main(process.argv.slice(2)).catch((e) => { process.stderr.write(e.code ? 'Could not read input or create a new private output file.\n' : e.message + '\n'); process.exitCode = 1; });
module.exports = { decode, pagesFrom, MAX_BYTES, MAX_PAGES };

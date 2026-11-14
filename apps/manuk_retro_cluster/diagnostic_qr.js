'use strict';
// QR matrix: unmodified Project Nayuki v1.5.0, MIT (licenses/Nayuki-QR-MIT.txt).
// Pure Node 8 PNG encoding; no network, filesystem, timer or application state.
const zlib = require('zlib');
const qr = require('./diagnostic_qrcodegen');
const MAX_BYTES = 1200, QUIET = 4, MAX_SIDE = 420, WIDTH = 832, HEIGHT = 480;
const CRC = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length, 0); let c = 0xffffffff;
    for (let i = 0; i < body.length; i++) c = CRC[(c ^ body[i]) & 255] ^ (c >>> 8);
    sum.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0); return Buffer.concat([size, body, sum]);
}
function encode(text) {
    if (typeof text !== 'string' || !text.length || Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('diagnostic QR payload exceeds the readable size limit');
    const matrix = qr.QrCode.encodeText(text, qr.QrCode.Ecc.MEDIUM), modules = matrix.size + QUIET * 2;
    const scale = Math.floor(MAX_SIDE / modules);
    if (scale < 3) throw new Error('diagnostic QR modules would be too small');
    const side = modules * scale, left = Math.floor((WIDTH - side) / 2), top = Math.floor((HEIGHT - side) / 2);
    const stride = WIDTH * 4 + 1, raw = Buffer.alloc(stride * HEIGHT, 0);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const p = y * stride + 1 + x * 4; raw[p + 3] = 255;
            if (x < left || x >= left + side || y < top || y >= top + side) continue;
            const mx = Math.floor((x - left) / scale) - QUIET, my = Math.floor((y - top) / scale) - QUIET;
            const white = mx < 0 || my < 0 || mx >= matrix.size || my >= matrix.size || !matrix.getModule(mx, my);
            if (white) raw[p] = raw[p + 1] = raw[p + 2] = 255;
        }
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(WIDTH, 0); ihdr.writeUInt32BE(HEIGHT, 4); ihdr[8] = 8; ihdr[9] = 6;
    return { png: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]),
        width: WIDTH, height: HEIGHT, size: matrix.size, version: matrix.version, scale: scale, quiet: QUIET, left: left, top: top };
}
module.exports = { encode: encode, MAX_BYTES: MAX_BYTES };

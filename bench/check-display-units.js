'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
module.exports = function (png, layout, configuration) {
    return [['fuel_unit', '%'], ['oil_unit', configuration.units === 'us' ? '°F' : '°C'], ['coolant_unit', configuration.units === 'us' ? '°F' : '°C']].map(([id, text]) => {
        const box = layout.widgets.find(w => w.id === id); assert(box, id + ' exists');
        const font = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/manuk_retro_cluster/hud/fonts', box.font + '.json'), 'utf8')), alpha = Buffer.from(font.alpha, 'base64');
        const mask = new Uint8Array(box.w * box.h), chars = [...text];
        let pen = Math.round((box.w - chars.reduce((n, c) => n + font.glyphs[c].advance, 0)) / 2);
        chars.forEach(c => { const g = font.glyphs[c], left = Math.round(pen + g.ox);
            for (let y = 0; y < Math.min(g.h, box.h); y++) for (let x = 0; x < g.w; x++) if (left + x >= 0 && left + x < box.w) mask[y * box.w + left + x] = Math.max(mask[y * box.w + left + x], alpha[(g.y + y) * font.width + g.x + x]);
            pen += g.advance;
        });
        let foreground = 0, mismatches = 0, colourSamples = 0;
        for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
            const p = ((box.y + y) * png.width + box.x + x) * 4, a = mask[y * box.w + x];
            const expected = Math.round(a * 204 / 255) > 100, actual = Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) > 100;
            if (actual) foreground++; if (expected !== actual) mismatches++;
            if (a === 255) { colourSamples++; assert([190, 198, 204].every((v, i) => Math.abs(png.data[p + i] - v) <= 2), id + ' is white'); }
        }
        assert(foreground > 20 && colourSamples > 10, id + ' is visible'); assert(mismatches <= 4, id + ' matches its atlas glyphs');
        return { id, text, foreground, colourSamples, mismatches };
    });
};

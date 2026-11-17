// camoImage.js — the picture of `تمويه` / `camo`: a word or a number drawn big with the bundled Tajawal font (pango,
// so Arabic is joined and right to left) over a noisy background, made to slow down OCR bots and quick copying
// while people still read it: every letter its own clashing colour, the digits nudged up and down, the text turned
// a few degrees, blobs, dots and wavy lines behind it and a few thin wavy lines and dots over it in the same colours.
//
// renderCamo({ text, random, width, height }) → Promise<Buffer> (a PNG, `width` × `height`).

import { escapeMarkup, FONT_BOLD, loadSharp } from '../../engine/imageCard.js';

const rand = (random, min, max) => min + random() * (max - min);
/** An HSL colour as '#rrggbb' (pango markup only takes hex or names). */
function hsl(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const sat = s / 100;
    const light = l / 100;
    const a = sat * Math.min(light, 1 - light);
    const channel = (n) => {
        const k = (n + hue / 30) % 12;
        return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** A wavy line across the picture (a sine path with a random phase, period and height). */
function wave(random, width, height, color, strokeWidth, opacity) {
    const y0 = rand(random, height * 0.15, height * 0.85);
    const amplitude = rand(random, 8, height * 0.18);
    const period = rand(random, 90, 220);
    const phase = rand(random, 0, Math.PI * 2);
    const tilt = rand(random, -0.25, 0.25);
    const points = [];
    for (let x = -10; x <= width + 10; x += 8) points.push(`${x},${(y0 + tilt * (x - width / 2) + amplitude * Math.sin(phase + (x / period) * Math.PI * 2)).toFixed(1)}`);
    return `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(1)}" stroke-opacity="${opacity.toFixed(2)}" stroke-linecap="round"/>`;
}

function backSvg(random, width, height, hue, inks) {
    const parts = [];
    for (let i = 0; i < 26; i += 1) {
        parts.push(`<circle cx="${rand(random, 0, width).toFixed(0)}" cy="${rand(random, 0, height).toFixed(0)}" r="${rand(random, 12, 70).toFixed(0)}" fill="${hsl(hue + rand(random, -70, 70), rand(random, 35, 70), rand(random, 22, 42))}" fill-opacity="${rand(random, 0.35, 0.8).toFixed(2)}"/>`);
    }
    for (let i = 0; i < 9; i += 1) parts.push(wave(random, width, height, inks[i % inks.length], rand(random, 2, 6), rand(random, 0.35, 0.7)));
    for (let i = 0; i < 420; i += 1) {
        parts.push(`<circle cx="${rand(random, 0, width).toFixed(1)}" cy="${rand(random, 0, height).toFixed(1)}" r="${rand(random, 0.8, 3.2).toFixed(1)}" fill="${inks[i % inks.length]}" fill-opacity="${rand(random, 0.25, 0.75).toFixed(2)}"/>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${hsl(hue, 45, 30)}"/>${parts.join('')}</svg>`);
}

function frontSvg(random, width, height, inks) {
    const parts = [];
    for (let i = 0; i < 4; i += 1) parts.push(wave(random, width, height, inks[i % inks.length], rand(random, 1.2, 2.6), rand(random, 0.5, 0.8)));
    for (let i = 0; i < 160; i += 1) {
        parts.push(`<circle cx="${rand(random, 0, width).toFixed(1)}" cy="${rand(random, 0, height).toFixed(1)}" r="${rand(random, 0.8, 2.4).toFixed(1)}" fill="${inks[(i + 1) % inks.length]}" fill-opacity="${rand(random, 0.4, 0.85).toFixed(2)}"/>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`);
}

/** The camo picture of `text` (see the header). */
export async function renderCamo({ text, random = Math.random, width = 720, height = 300 } = {}) {
    const value = String(text ?? '').trim();
    if (!value) throw new TypeError('renderCamo needs a text');
    const sharp = await loadSharp();
    const hue = rand(random, 0, 360);
    // Light inks in hues far from the background (and from each other): readable, but no single colour to key on.
    const inks = Array.from({ length: 5 }, (_, i) => hsl(hue + 120 + i * 47 + rand(random, -15, 15), rand(random, 70, 95), rand(random, 72, 86)));
    const digits = /^\d+$/u.test(value);
    const spans = [...value].map((char, i) => {
        const nudge = digits ? ` rise="${Math.round(rand(random, -14, 14) * 1024)}" letter_spacing="${Math.round(rand(random, 4, 14) * 1024)}"` : '';
        return `<span foreground="${inks[i % inks.length]}"${nudge}>${escapeMarkup(char)}</span>`;
    }).join('');
    const size = digits ? 104 : 128;
    const layer = await sharp({ text: { text: spans, font: `Tajawal Bold ${size}`, fontfile: FONT_BOLD, rgba: true, dpi: 72 } }).png().toBuffer();
    const angle = rand(random, 4, 9) * (random() < 0.5 ? -1 : 1);
    const turned = await sharp(layer).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .resize({ width: Math.round(width * 0.86), height: Math.round(height * 0.86), fit: 'inside', withoutEnlargement: true })
        .png().toBuffer({ resolveWithObject: true });
    return sharp(backSvg(random, width, height, hue, inks))
        .composite([
            { input: turned.data, left: Math.round((width - turned.info.width) / 2 + rand(random, -20, 20)), top: Math.max(0, Math.round((height - turned.info.height) / 2 + rand(random, -8, 8))) },
            { input: frontSvg(random, width, height, inks), left: 0, top: 0 },
        ])
        .png({ compressionLevel: 0 }).toBuffer(); // an intermediate: the picture card compresses the final PNG
}

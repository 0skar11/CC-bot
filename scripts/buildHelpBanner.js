// buildHelpBanner.js — renders the help menu's banner, assets/help-banner.png (committed; the bot only reads it:
// src/games/helpMenu.js attaches it as attachment://help-banner.png). A dark purple gradient panel, `CC BOT` and
// `HELP MENU` in big bold silver letters, and a small Arabic subtitle, drawn with sharp and the bundled Tajawal font
// (assets/fonts/, OFL) so no system font is used. Run it again after a change: `node scripts/buildHelpBanner.js`.
// With a picture it uses that as the background instead of the drawn panel: `node scripts/buildHelpBanner.js bg.jpg [out.png]`.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = new URL('../', import.meta.url);
const OUT = fileURLToPath(new URL('assets/help-banner.png', ROOT));
const FONT_BOLD = fileURLToPath(new URL('assets/fonts/Tajawal-Bold.ttf', ROOT));
const FONT_MEDIUM = fileURLToPath(new URL('assets/fonts/Tajawal-Medium.ttf', ROOT));
const WIDTH = 1200;
const HEIGHT = 400;
const SUBTITLE = 'كل أوامر البوت والألعاب في مكان واحد';

const escapeMarkup = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** A text layer (alpha PNG) in `color`, laid out by pango with the bundled font. */
async function textLayer({ text, file, font, size, color, letterSpacing = 0 }) {
    const spacing = letterSpacing ? ` letter_spacing="${letterSpacing * 1024}"` : '';
    const markup = `<span foreground="${color}"${spacing}>${escapeMarkup(text)}</span>`;
    return sharp({ text: { text: markup, font: `${font} ${size}`, fontfile: file, rgba: true, dpi: 72, align: 'centre' } })
        .png().toBuffer({ resolveWithObject: true });
}

/** The same text filled with a vertical silver gradient (the text's alpha cuts the gradient). */
async function silverText(options) {
    const { data, info } = await textLayer({ ...options, color: '#ffffff' });
    const gradient = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#e9e6f2"/><stop offset="0.62" stop-color="#b9b3c9"/><stop offset="1" stop-color="#f4f1fa"/>
</linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/></svg>`);
    const filled = await sharp(gradient).composite([{ input: data, blend: 'dest-in' }]).png().toBuffer();
    return { data: filled, info };
}

function backgroundSvg() {
    const dots = [];
    // A fixed pattern (no randomness) so the committed file only changes when the design does.
    for (let i = 0; i < 90; i += 1) {
        const x = (i * 137.5) % WIDTH;
        const y = (i * 71.3 + (i % 7) * 23) % HEIGHT;
        const r = 0.8 + (i % 4) * 0.5;
        dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${i % 3 ? '#ffffff' : '#d9b8ff'}" fill-opacity="${(0.08 + (i % 5) * 0.03).toFixed(2)}"/>`);
    }
    const stripes = [];
    for (let i = 0; i < 9; i += 1) {
        const x = -200 + i * 170;
        stripes.push(`<polygon points="${x},${HEIGHT} ${x + 60},${HEIGHT} ${x + 260},0 ${x + 200},0" fill="#ffffff" fill-opacity="0.025"/>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12051f"/><stop offset="0.55" stop-color="#3a1257"/><stop offset="1" stop-color="#6b2c92"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.42" r="0.55"><stop offset="0" stop-color="#b56cff" stop-opacity="0.38"/><stop offset="1" stop-color="#b56cff" stop-opacity="0"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9a227" stop-opacity="0"/><stop offset="0.5" stop-color="#e8c65a"/><stop offset="1" stop-color="#c9a227" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
${stripes.join('\n')}
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
${dots.join('\n')}
<rect x="16" y="16" width="${WIDTH - 32}" height="${HEIGHT - 32}" rx="28" fill="#ffffff" fill-opacity="0.04" stroke="#e0c8ff" stroke-opacity="0.28" stroke-width="2"/>
<rect x="300" y="276" width="600" height="3" rx="1.5" fill="url(#gold)"/>
</svg>`);
}

/** A picture (any size, wide) as the banner's background: cropped to 3:1 around its centre, with a soft dark pool under the text. */
async function pictureBackground(file) {
    const meta = await sharp(file).metadata();
    const height = Math.round(meta.width / 3);
    const top = Math.max(0, Math.round((meta.height - height) / 2));
    const base = await sharp(file).extract({ left: 0, top, width: meta.width, height: Math.min(height, meta.height) }).resize(WIDTH, HEIGHT).toBuffer();
    const pool = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
<defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#12072b" stop-opacity="0.55"/><stop offset="1" stop-color="#12072b" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="${WIDTH / 2}" cy="${HEIGHT / 2}" rx="520" ry="190" fill="url(#v)"/>
<rect x="300" y="276" width="600" height="3" rx="1.5" fill="#e3d6ff" fill-opacity="0.8"/></svg>`);
    return sharp(base).composite([{ input: pool }]).png().toBuffer();
}

/** The banner as a PNG Buffer. `background` (a picture file) replaces the drawn gradient panel. */
export async function renderHelpBanner(background = null) {
    const title = await silverText({ text: 'CC BOT', file: FONT_BOLD, font: 'Tajawal Bold', size: 128, letterSpacing: 6 });
    const titleShadow = await textLayer({ text: 'CC BOT', file: FONT_BOLD, font: 'Tajawal Bold', size: 128, color: '#1a0629', letterSpacing: 6 });
    const menu = await silverText({ text: 'HELP MENU', file: FONT_BOLD, font: 'Tajawal Bold', size: 70, letterSpacing: 10 });
    const menuShadow = await textLayer({ text: 'HELP MENU', file: FONT_BOLD, font: 'Tajawal Bold', size: 70, color: '#1a0629', letterSpacing: 10 });
    const subtitle = await textLayer({ text: SUBTITLE, file: FONT_MEDIUM, font: 'Tajawal Medium', size: 32, color: '#e3cffa' });
    const centre = (layer) => Math.round((WIDTH - layer.info.width) / 2);
    const titleTop = background ? 74 : 44; // the picture version sits lower on the banner
    const menuTop = titleTop + title.info.height + 22;
    const subtitleTop = 304;
    return sharp(background ? await pictureBackground(background) : backgroundSvg()).composite([
        { input: titleShadow.data, left: centre(titleShadow) + 5, top: titleTop + 6 },
        { input: title.data, left: centre(title), top: titleTop },
        { input: menuShadow.data, left: centre(menuShadow) + 4, top: menuTop + 4 },
        { input: menu.data, left: centre(menu), top: menuTop },
        { input: subtitle.data, left: centre(subtitle), top: subtitleTop },
    ]).png({ compressionLevel: 9 }).toBuffer();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    // `node scripts/buildHelpBanner.js [background picture] [output file]`
    const out = process.argv[3] || OUT;
    const png = await renderHelpBanner(process.argv[2] || null);
    await writeFile(out, png);
    console.log(`Wrote ${out} (${png.length} bytes)`);
}

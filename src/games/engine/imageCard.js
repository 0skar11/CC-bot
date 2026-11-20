// imageCard.js — the picture cards of the picture games (src/games/games/map.js, camo.js): the question IS a
// picture (a country's outline, a hidden word or number), posted as one PNG the bot renders itself with sharp,
// so the question cannot be copied. Same rules as the text cards of engine/card.js: no question or answer text in
// the message (content, embed or file name), a plain text embed when rendering fails, sharp loaded on first use.
//
// renderPictureCard({ picture, title, hint, theme, width, height }) → Promise<Buffer> (a PNG): a card (`dark`: the
//   purple of the question cards, `light`: a pale card for dark pictures) with a small header (`title`), the picture fitted
//   in the middle (aspect kept) and a small footer (`hint`). `picture`: an image Buffer (PNG...) or an SVG string.
// pictureCardPayload(ctx, { title, picture, heading, hint, note, footer, theme, width, height, fallback }) →
//   Promise<payload>: one embed (`title`, `note` or the fixed "the question is in the image" line, the image
//   `attachment://q.png`) and the PNG as its only file. `picture` may be a function (async) returning the picture:
//   it runs inside the guard, so a picture that cannot be made falls back too. On any error: logs, returns `fallback`.
// setPictureRenderer(fn): swaps the renderer (tests); null restores renderPictureCard. Returns the previous one.

import { fileURLToPath } from 'node:url';
import { AttachmentBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { CARD_FILE, cardNote, plainText } from './card.js';
import { isRedesignEnabled } from '../ui/theme.js';

const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
export const FONT_BOLD = `${FONT_DIR}Tajawal-Bold.ttf`;
export const FONT_MEDIUM = `${FONT_DIR}Tajawal-Medium.ttf`;

export const PICTURE_THEMES = Object.freeze({
    dark: Object.freeze({ from: '#1c0b2b', mid: '#4a2163', to: '#6d3590', panel: '#ffffff', panelOpacity: 0.06, title: '#dcc8f0', hint: '#c3a9dd', dot: '#c79bea' }),
    light: Object.freeze({ from: '#fbf8fe', mid: '#f3ecfa', to: '#e9def5', panel: '#ffffff', panelOpacity: 0.85, title: '#5b2a78', hint: '#7a5a96', dot: '#b99bd6' }),
});

let sharpModule = null;
/** sharp, loaded on first use: a missing native binary only fails the render (→ the text fallback), never the bot. */
export async function loadSharp() {
    if (!sharpModule) sharpModule = (await import('sharp')).default;
    return sharpModule;
}

export const escapeMarkup = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

async function textLayer(sharp, { text, size, color, width }) {
    return sharp({ text: { text: `<span foreground="${color}">${escapeMarkup(text)}</span>`, font: `Tajawal Medium ${size}`, fontfile: FONT_MEDIUM, width, align: 'centre', rgba: true, dpi: 72 } })
        .png().toBuffer({ resolveWithObject: true });
}

const rand = (random, min, max) => min + random() * (max - min);

function backgroundSvg(width, height, theme, random) {
    const dots = [];
    for (let i = 0; i < 90; i += 1) {
        dots.push(`<circle cx="${rand(random, 0, width).toFixed(1)}" cy="${rand(random, 0, height).toFixed(1)}" r="${rand(random, 0.6, 2).toFixed(1)}" fill="${theme.dot}" fill-opacity="${rand(random, 0.08, 0.22).toFixed(2)}"/>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.from}"/><stop offset="0.55" stop-color="${theme.mid}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="26" fill="${theme.panel}" fill-opacity="${theme.panelOpacity}" stroke="${theme.title}" stroke-opacity="0.18" stroke-width="2"/>
${dots.join('\n')}
</svg>`);
}

/** The picture card as a PNG Buffer. Throws only when the picture is missing or sharp cannot read it. */
export async function renderPictureCard({ picture, title = '', hint = '', theme = 'dark', width = 800, height = 520, random = Math.random } = {}) {
    if (!picture || (!Buffer.isBuffer(picture) && typeof picture !== 'string')) throw new TypeError('renderPictureCard needs a picture (a Buffer or an SVG string)');
    const sharp = await loadSharp();
    const colors = typeof theme === 'object' && theme ? { ...PICTURE_THEMES.dark, ...theme } : (PICTURE_THEMES[theme] || PICTURE_THEMES.dark);
    const w = Math.max(400, Math.min(1200, Math.round(width)));
    const h = Math.max(300, Math.min(900, Math.round(height)));
    const header = plainText(title, 80);
    const footer = plainText(hint, 80);
    const top = header ? 72 : 40;
    const bottom = footer ? 62 : 40;
    const boxWidth = w - 100;
    const boxHeight = h - top - bottom;

    const layers = [];
    if (header) {
        const layer = await textLayer(sharp, { text: header, size: 24, color: colors.title, width: boxWidth });
        layers.push({ input: layer.data, left: Math.round((w - layer.info.width) / 2), top: Math.max(24, Math.round(44 - layer.info.height / 2)) });
    }
    const source = Buffer.isBuffer(picture) ? picture : Buffer.from(picture);
    const fitted = await sharp(source, { density: 144 })
        .resize({ width: boxWidth, height: boxHeight, fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer({ resolveWithObject: true });
    layers.push({
        input: fitted.data,
        left: Math.round((w - fitted.info.width) / 2),
        top: Math.round(top + (boxHeight - fitted.info.height) / 2),
    });
    if (footer) {
        const layer = await textLayer(sharp, { text: footer, size: 18, color: colors.hint, width: boxWidth });
        layers.push({ input: layer.data, left: Math.round((w - layer.info.width) / 2), top: Math.round(h - 34 - layer.info.height / 2) });
    }
    return sharp(backgroundSvg(w, h, colors, random)).composite(layers).png({ compressionLevel: 3 }).toBuffer();
}

let renderer = renderPictureCard;
/** Swaps the picture renderer (tests: a recorder, a failing one); null puts renderPictureCard back. */
export function setPictureRenderer(fn) {
    const previous = renderer;
    renderer = typeof fn === 'function' ? fn : renderPictureCard;
    return previous;
}

/** A message payload with the picture card as its only file (see the header). On a render error: `fallback`. */
export async function pictureCardPayload(ctx, { title, picture, heading = '', hint = '', note = null, footer = '', theme = 'dark', width, height, fallback = null } = {}) {
    try {
        const image = typeof picture === 'function' ? await picture() : picture;
        const activeTheme = (theme === 'dark' && isRedesignEnabled(ctx?.guildId))
            ? { from: '#0f172a', mid: '#1e293b', to: '#0b1120', panel: '#ffffff', panelOpacity: 0.08, title: '#7dd3fc', hint: '#bae6fd', dot: '#38bdf8' }
            : theme;
        const png = await renderer({ picture: image, title: heading, hint, theme: activeTheme, width, height, random: ctx?.random || Math.random });
        if (!Buffer.isBuffer(png) || !png.length) throw new Error('the picture renderer returned no image');
        const embed = { ...ctx.embed(title, note ?? cardNote(ctx?.lang), footer ? { footer } : {}), image: { url: `attachment://${CARD_FILE}` } };
        return { embeds: [embed], files: [new AttachmentBuilder(png, { name: CARD_FILE })] };
    } catch (error) {
        logger.warn(`[GAMES] Could not render a picture card, posting text: ${error?.message || error}`);
        return fallback;
    }
}

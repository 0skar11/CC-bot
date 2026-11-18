// card.js — the question cards: a typed game's question is posted as a PNG the bot renders itself (sharp + the
// bundled Tajawal font, OFL, assets/fonts/), so nobody can copy-paste the question or select its text. Pango shapes
// and orders Arabic (joined letters, right to left), English, digits and mixed lines; no system font is used.
//
// renderCard({ title, text, lines, hint, theme, width, height }) → Promise<Buffer> (a PNG): a dark purple card, a small
//   header (`title`), the question big and centred (auto-sized, wrapped, up to ~220 characters, longer is cut), a
//   small footer (`hint`). Light noise (faint lines and dots, a random background shift) that never bends a glyph.
// cardPayload(ctx, { title, heading, text, lines, hint, note, theme, fallback }) → Promise<payload>: one embed (the
//   game title, a fixed "the question is in the image" note, the image `attachment://q.png`) and the PNG as its
//   only file. No question text anywhere in the payload. When rendering fails it logs and returns `fallback` (the
//   old text embed), so the game never breaks.
// setCardRenderer(fn): swaps the renderer (tests); null restores renderCard. Returns the previous one.

import { fileURLToPath } from 'node:url';
import { AttachmentBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { isRedesignEnabled, PALETTE } from '../ui/theme.js';

export const CARD_FILE = 'q.png';
export const MAX_CHARS = 220;
const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
const FONT_BOLD = `${FONT_DIR}Tajawal-Bold.ttf`;
const FONT_MEDIUM = `${FONT_DIR}Tajawal-Medium.ttf`;
const DEFAULT_THEME = { from: '#1c0b2b', mid: '#5b2a78', to: '#8e44ad', panel: '#ffffff', text: '#ffffff', title: '#dcc8f0', hint: '#c3a9dd' };
const NOTE = {
    ar: '🖼️ السؤال في الصورة',
    en: '🖼️ The question is in the image',
};

let sharpModule = null;
/** sharp, loaded on first use: a missing native binary only fails the render (→ the text fallback), never the bot. */
async function loadSharp() {
    if (!sharpModule) sharpModule = (await import('sharp')).default;
    return sharpModule;
}

const escapeMarkup = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
// Emoji are not in the bundled font (and no system font is relied on): they are left out of the card.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu;

/** Discord markdown and emoji out (`**bold**`, `inline`, code blocks), whitespace tidied, cut to `max` characters. */
export function plainText(value, max = MAX_CHARS) {
    const text = String(value ?? '').replace(EMOJI, '').replace(/```/gu, '').replace(/\*\*|__|`/gu, '').replace(/[ \t]+/gu, ' ')
        .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
    const chars = [...text];
    return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/** The big text's font size: short texts big, long ones smaller (then shrunk until they fit). */
function startSize(text) {
    const length = [...text].length;
    if (length <= 12) return 72;
    if (length <= 24) return 58;
    if (length <= 40) return 46;
    if (length <= 80) return 38;
    if (length <= 140) return 34;
    return 30;
}

/** A text layer (PNG with alpha) rendered by pango with the bundled font. */
async function textLayer(sharp, { text, file, font, size, color, width }) {
    const markup = `<span foreground="${color}">${escapeMarkup(text)}</span>`;
    return sharp({ text: { text: markup, font: `${font} ${size}`, fontfile: file, width, align: 'centre', rgba: true, dpi: 72, wrap: 'word-char', spacing: Math.round(size * 0.3) } })
        .png().toBuffer({ resolveWithObject: true });
}

const rand = (random, min, max) => min + random() * (max - min);

/** The background: a gradient (randomly shifted), a rounded panel, faint noise lines and dots. Shapes only, no text. */
function backgroundSvg(width, height, theme, random) {
    const shift = rand(random, -0.15, 0.15);
    const parts = [];
    for (let i = 0; i < 14; i += 1) {
        const opacity = rand(random, 0.05, 0.13).toFixed(2);
        parts.push(`<line x1="${rand(random, 0, width).toFixed(1)}" y1="${rand(random, 0, height).toFixed(1)}" x2="${rand(random, 0, width).toFixed(1)}" y2="${rand(random, 0, height).toFixed(1)}" stroke="#ffffff" stroke-opacity="${opacity}" stroke-width="${rand(random, 0.8, 2).toFixed(1)}"/>`);
    }
    for (let i = 0; i < 160; i += 1) {
        const opacity = rand(random, 0.06, 0.2).toFixed(2);
        const color = random() < 0.5 ? '#ffffff' : '#c79bea';
        parts.push(`<circle cx="${rand(random, 0, width).toFixed(1)}" cy="${rand(random, 0, height).toFixed(1)}" r="${rand(random, 0.6, 2.2).toFixed(1)}" fill="${color}" fill-opacity="${opacity}"/>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="${(0 + shift).toFixed(2)}" y1="0" x2="${(1 - shift).toFixed(2)}" y2="1">
<stop offset="0" stop-color="${theme.from}"/><stop offset="${(0.55 + shift / 2).toFixed(2)}" stop-color="${theme.mid}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="26" fill="${theme.panel}" fill-opacity="0.07" stroke="${theme.panel}" stroke-opacity="0.16" stroke-width="2"/>
${parts.join('\n')}
</svg>`);
}

/** The question card as a PNG Buffer. Never throws for odd input (empty, huge): only when sharp itself fails. */
export async function renderCard({ title = '', text = '', lines = null, hint = '', theme = {}, width = 800, height = null, random = Math.random } = {}) {
    const sharp = await loadSharp();
    const colors = { ...DEFAULT_THEME, ...theme };
    const body = plainText(Array.isArray(lines) && lines.length ? lines.join('\n') : text) || '…';
    const header = plainText(title, 80);
    const footer = plainText(hint, 80);
    const long = [...body].length > 80 || body.split('\n').length > 3;
    const w = Math.max(400, Math.min(1200, Math.round(width)));
    const h = Math.max(200, Math.min(800, Math.round(height || (long ? 380 : 300))));
    const innerWidth = w - 100;
    const top = header ? 70 : 40;
    const bottom = footer ? 62 : 40;
    const room = h - top - bottom;

    const layers = [];
    if (header) {
        const layer = await textLayer(sharp, { text: header, file: FONT_MEDIUM, font: 'Tajawal Medium', size: 22, color: colors.title, width: innerWidth });
        layers.push({ input: layer.data, left: Math.round((w - layer.info.width) / 2), top: Math.max(26, Math.round(42 - layer.info.height / 2)) });
    }
    // Shrinks the big text until it fits the space between the header and the footer.
    let main = null;
    for (let size = startSize(body); size >= 14; size = Math.floor(size * 0.85)) {
        main = await textLayer(sharp, { text: body, file: FONT_BOLD, font: 'Tajawal Bold', size, color: colors.text, width: innerWidth });
        if (main.info.height <= room && main.info.width <= innerWidth) break;
    }
    if (main.info.height > room || main.info.width > innerWidth) {
        main = { data: await sharp(main.data).resize({ width: innerWidth, height: room, fit: 'inside' }).png().toBuffer(), info: null };
        main.info = await sharp(main.data).metadata();
    }
    const jitterX = Math.round(rand(random, -8, 8));
    const jitterY = Math.round(rand(random, -5, 5));
    layers.push({
        input: main.data,
        left: Math.max(0, Math.round((w - main.info.width) / 2) + jitterX),
        top: Math.max(0, Math.round(top + (room - main.info.height) / 2) + jitterY),
    });
    if (footer) {
        const layer = await textLayer(sharp, { text: footer, file: FONT_MEDIUM, font: 'Tajawal Medium', size: 18, color: colors.hint, width: innerWidth });
        layers.push({ input: layer.data, left: Math.round((w - layer.info.width) / 2), top: Math.round(h - 34 - layer.info.height / 2) });
    }
    return sharp(backgroundSvg(w, h, colors, random)).composite(layers).png({ compressionLevel: 6 }).toBuffer();
}

let renderer = renderCard;
/** Swaps the card renderer (tests: a recorder, a failing one); null puts renderCard back. Returns the previous one. */
export function setCardRenderer(fn) {
    const previous = renderer;
    renderer = typeof fn === 'function' ? fn : renderCard;
    return previous;
}

/** The "question in the image" line of the embed (plus `extra`, e.g. the time left). */
export const cardNote = (lang, extra = '') => [NOTE[lang === 'en' ? 'en' : 'ar'], extra].filter(Boolean).join('\n');

/**
 * A message payload: one embed (`title`, `note` or the fixed note, the image) and the rendered card as its only
 * file. `heading` / `text` / `lines` / `hint` / `theme` go to the card only. On a render error: `fallback`.
 */
export async function cardPayload(ctx, { title, heading = '', text = '', lines = null, hint = '', note = null, theme, footer = '', fallback = null } = {}) {
    try {
        const activeTheme = theme ?? (isRedesignEnabled(ctx?.guildId) ? PALETTE.single.card : DEFAULT_THEME);
        const png = await renderer({ title: heading, text, lines, hint, theme: activeTheme, random: ctx?.random || Math.random });
        if (!Buffer.isBuffer(png) || !png.length) throw new Error('the card renderer returned no image');
        const description = note ?? cardNote(ctx?.lang);
        const embed = { ...ctx.embed(title, description, footer ? { footer } : {}), image: { url: `attachment://${CARD_FILE}` } };
        return { embeds: [embed], files: [new AttachmentBuilder(png, { name: CARD_FILE })] };
    } catch (error) {
        logger.warn(`[GAMES] Could not render a question card, posting text: ${error?.message || error}`);
        return fallback;
    }
}

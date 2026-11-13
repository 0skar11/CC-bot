// emojis.js — the casino's emoji registry: every emoji the casino messages show (src/services/cc/casinoUi.js for
// the solo games, the roulette parts of casinoGroupUi.js) comes from here by its meaning (`mines.safe`,
// `slots.cherry`, `chicken.car`...), so the server's own custom emojis can replace them without touching the code.
//
// CASINO_EMOJIS (optional, JSON) overrides any of them, for example
//   CASINO_EMOJIS={"slots.cherry":"<a:cherry:123456789012345678>","mines.safe":"<:gem:123456789012345678>"}
// A value is either a Unicode emoji (`🍓`) or a Discord custom emoji tag (`<:name:id>`, `<a:name:id>` when
// animated). A custom emoji only shows when it lives in a server the bot is in. Unknown keys and invalid values
// are skipped with a warning (the default stays); nothing here ever throws. Empty = the Unicode defaults below.
//
// Discord shows a custom emoji tag as plain text in an embed footer, an author name, a button label or a form
// title, so those spots use plainEmoji(): the override when it is Unicode, else the Unicode default. Embed titles
// use it too, so the language read from a title (src/services/cc/lang.js) never depends on an emoji. The engine
// keeps its own symbols (the slot reels are '🍒', '🍋'... in src/config/casino.js): SLOT_SYMBOL_KEYS maps them here.
// The rocket's messages keep their own emojis (casinoGroupUi.js).

import 'dotenv/config';
import { logger } from '../utils/logger.js';

/** Every key and its Unicode default (what the casino shows when CASINO_EMOJIS doesn't set it). */
export const CASINO_EMOJI_DEFAULTS = Object.freeze({
    // Blackjack cards: `blackjack.card<rank><suit>` (e.g. `blackjack.cardAH`) (rank 2-10, J, Q, K, A; suit S spades, H hearts, D diamonds, C clubs)
    // and `blackjack.cardBack`. The default of a card key is its suit emoji and only marks the key as valid: with no
    // custom emoji the casino draws a text chip (`**「A♥️」**`); a custom emoji tag set here shows instead (a picture of the card).
    ...Object.fromEntries(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].flatMap((rank) => [['S', '♠️'], ['H', '♥️'], ['D', '♦️'], ['C', '♣️']].map(([suit, emoji]) => [`blackjack.card${rank}${suit}`, emoji]))),
    'blackjack.cardBack': '❓',
    // Shared by every game
    'ui.player': '👤',
    'ui.bet': '💵',
    'ui.payout': '💸',
    'ui.balance': '💰',
    'ui.profit': '🟢',
    'ui.loss': '🔴',
    'ui.push': '⚪',
    'ui.win': '🎉',
    'ui.lose': '❌',
    'ui.cashout': '💰',
    'ui.next': '⏭️',
    'ui.ladder': '📈',
    'ui.timer': '⏰',
    'ui.done': '✅',
    'ui.trophy': '🏆',
    'ui.warning': '⚠️',
    'ui.reveal': '🔍',
    'ui.empty': '😶',
    // The all-in tag on the first line of a game (or a roulette bet) bet with `كل` / `all`.
    'ui.allIn': '🔥',
    // Mines
    'mines.icon': '💣',
    'mines.hidden': '❔',
    'mines.safe': '💎',
    'mines.bomb': '💣',
    'mines.hit': '💥',
    // Coinflip
    'coin.icon': '🪙',
    'coin.heads': '👑',
    'coin.tails': '✍️',
    // Slots: the five reel symbols, the machine's frame and the reactions
    'slots.icon': '🎰',
    'slots.cherry': '🍒',
    'slots.lemon': '🍋',
    'slots.grape': '🍇',
    'slots.diamond': '💎',
    'slots.chaos': '🌀',
    'slots.frameTopLeft': '🟪',
    'slots.frameTop': '🟪',
    'slots.frameTopRight': '🟪',
    'slots.frameLeft': '🟪',
    'slots.frameRight': '🟪',
    'slots.frameBottomLeft': '🟪',
    'slots.frameBottom': '🟪',
    'slots.frameBottomRight': '🟪',
    'slots.winLine': '⬅️',
    'slots.pair': '🙂',
    'slots.miss': '😅',
    // Dice
    'dice.icon': '🎲',
    'dice.marker': '🎲',
    'dice.win': '🟩',
    'dice.lose': '🟥',
    'dice.under': '⬇️',
    'dice.over': '⬆️',
    // Chicken: the road's pieces
    'chicken.icon': '🐔',
    'chicken.alive': '🐔',
    'chicken.dead': '💀',
    'chicken.crossed': '🟩',
    'chicken.next': '⚠️',
    'chicken.road': '⬛',
    'chicken.car': '🚗',
    'chicken.finish': '🏁',
    'chicken.sidewalk': '🟫',
    'chicken.more': '⋯',
    'chicken.food': '🍗',
    // Blackjack
    'blackjack.icon': '🃏',
    'blackjack.hit': '🟢',
    'blackjack.stand': '🛑',
    'blackjack.double': '⚡',
    // Roulette
    'roulette.icon': '🎡',
    'roulette.red': '🔴',
    'roulette.black': '⚫',
    'roulette.green': '🟢',
    'roulette.number': '🔢',
    'roulette.spin': '🌀',
    'roulette.timer': '⏳',
    'roulette.rule': '🎯',
    'roulette.landed': '🎯',
    'roulette.bets': '📋',
    'roulette.won': '🏆',
    'roulette.lost': '💸',
    'roulette.refund': '↩️',
    'roulette.paid': '💰',
});

/** The slot machine's symbols (CASINO.slots.symbols, the engine's own) and their registry keys. */
export const SLOT_SYMBOL_KEYS = Object.freeze({ '🍒': 'slots.cherry', '🍋': 'slots.lemon', '🍇': 'slots.grape', '💎': 'slots.diamond', '🌀': 'slots.chaos' });

// `<:name:id>` / `<a:name:id>`: a name of 2–32 letters, digits or `_`, and a Discord ID (17–19 digits, what
// discord.js reads on a button).
const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,19}>$/u;
// A Unicode emoji: pictographs and what builds them (skin tones, ZWJ sequences, variation selectors, keycaps,
// flags and their tag sequences), with at least one pictograph, flag letter or keycap.
const EMOJI_PIECES = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[‍︎️⃣]|[\u{E0020}-\u{E007F}])+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = /^[0-9#*]️?⃣$/u;
export const EMOJI_LIMITS = Object.freeze({ custom: 64, unicode: 32, json: 16_384 });

export const isCustomEmoji = (value) => typeof value === 'string' && value.length <= EMOJI_LIMITS.custom && CUSTOM_EMOJI.test(value);

/** A Unicode emoji (one emoji or a short sequence), not text. */
export function isUnicodeEmoji(value) {
    if (typeof value !== 'string' || !value || value.length > EMOJI_LIMITS.unicode) return false;
    return KEYCAP.test(value) || (EMOJI_PIECES.test(value) && EMOJI_CORE.test(value));
}

export const isEmojiValue = (value) => isCustomEmoji(value) || isUnicodeEmoji(value);

const shown = (text) => JSON.stringify(String(text).slice(0, 40));

/**
 * Reads a CASINO_EMOJIS value (a JSON object as text, or an object): `{ overrides, warnings }`, with only the known
 * keys whose value is a valid emoji. Never throws.
 */
export function readCasinoEmojis(raw) {
    const overrides = {};
    const warnings = [];
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return { overrides, warnings };
    let parsed = raw;
    if (typeof raw === 'string') {
        if (raw.length > EMOJI_LIMITS.json) return { overrides, warnings: [`CASINO_EMOJIS is longer than ${EMOJI_LIMITS.json} characters; using the default emojis`] };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { overrides, warnings: ['CASINO_EMOJIS is not valid JSON; using the default emojis'] };
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { overrides, warnings: ['CASINO_EMOJIS must be a JSON object like {"slots.cherry":"<:cherry:123456789012345678>"}; using the default emojis'] };
    try {
        for (const [key, value] of Object.entries(parsed)) {
            if (!Object.hasOwn(CASINO_EMOJI_DEFAULTS, key)) {
                warnings.push(`CASINO_EMOJIS: unknown key ${shown(key)} skipped`);
                continue;
            }
            const emoji = typeof value === 'string' ? value.trim() : value;
            if (!isEmojiValue(emoji)) {
                warnings.push(`CASINO_EMOJIS: ${shown(key)} must be a Unicode emoji or <:name:id> / <a:name:id>; kept ${CASINO_EMOJI_DEFAULTS[key]}`);
                continue;
            }
            overrides[key] = emoji;
        }
    } catch {
        return { overrides: {}, warnings: [...warnings, 'CASINO_EMOJIS could not be read; using the default emojis'] };
    }
    return { overrides, warnings };
}

// The overrides in use (no prototype, so only real keys are ever found).
let active = Object.create(null);
const fallback = (key) => (Object.hasOwn(CASINO_EMOJI_DEFAULTS, key) ? CASINO_EMOJI_DEFAULTS[key] : '');

/** Uses the overrides of `raw` (replacing the previous ones) and logs what was skipped. Returns the warnings. */
export function applyCasinoEmojis(raw, { warn = (message) => logger.warn(`[CASINO] ${message}`) } = {}) {
    const { overrides, warnings } = readCasinoEmojis(raw);
    active = Object.assign(Object.create(null), overrides);
    for (const message of warnings) {
        try { warn(message); } catch { /* a warning never breaks the bot */ }
    }
    return warnings;
}

/** Back to the Unicode defaults (tests). */
export function resetCasinoEmojis() {
    active = Object.create(null);
}

/** The emoji for `key`: the override (Unicode or a custom emoji tag), else the default. */
export function casinoEmoji(key) {
    return active[key] ?? fallback(key);
}

/** The emoji for `key` where Discord can't show a custom emoji (footers, labels, titles): always Unicode. */
export function plainEmoji(key) {
    const override = active[key];
    return override && !isCustomEmoji(override) ? override : fallback(key);
}

/** The registry as it is now (defaults plus overrides). */
export const casinoEmojis = () => ({ ...CASINO_EMOJI_DEFAULTS, ...active });

applyCasinoEmojis(process.env.CASINO_EMOJIS);

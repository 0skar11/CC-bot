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

// ---- Emojis uploaded to the servers (names are derived from the registry keys) ----
// A custom emoji named `cc_<rank><suit>` (`cc_AH`, `cc_10S`), `cc_back` or `cc_<key with the dot as _>` (`cc_chicken_car`)
// on any server the bot is in replaces that key's default, unless CASINO_EMOJIS sets the key itself. DISbot uploads
// the card pictures (src/assets/emojis/cc_*.png); this bot only looks them up by name.
const fromEnv = new Set(Object.keys(readCasinoEmojis(process.env.CASINO_EMOJIS).overrides));

/** The server emoji name for a registry key, or null. */
export function guildEmojiName(key) {
    const card = /^blackjack\.card(10|[2-9JQKA])([SHDC])$/u.exec(key);
    if (card) return `cc_${card[1]}${card[2]}`;
    if (key === 'blackjack.cardBack') return 'cc_back';
    return `cc_${key.replace(/\./gu, '_')}`;
}

/** Uses the server emojis (any iterable of `{ name, id, animated }`) for the keys they are named for. Returns how many. */
export function applyGuildEmojis(emojis) {
    const byName = new Map();
    for (const emoji of emojis) if (emoji?.name && emoji.id && !byName.has(emoji.name)) byName.set(emoji.name, emoji);
    let used = 0;
    for (const key of Object.keys(CASINO_EMOJI_DEFAULTS)) {
        if (fromEnv.has(key)) continue;
        const emoji = byName.get(guildEmojiName(key));
        if (!emoji) continue;
        const tag = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
        if (!isCustomEmoji(tag)) continue;
        active[key] = tag;
        used += 1;
    }
    return used;
}

// Only the owner's servers may supply the pictures (a server the bot is added to can't change what players see):
// CHAOS Club, Zenith and any ids in EMOJI_GUILD_IDS (comma separated).
const EMOJI_GUILDS = new Set(['1155236281706627173', '1569932761471524874', ...String(process.env.EMOJI_GUILD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)]);

const loggedCards = new Map();

/** Reads the emojis of the trusted servers the bot is in and applies them. Never throws. */
export async function refreshGuildEmojis(client) {
    try {
        const all = [];
        for (const guild of client.guilds.cache.values()) {
            if (!EMOJI_GUILDS.has(guild.id)) continue;
            const fetched = await guild.emojis.fetch().catch((error) => { logger.warn(`[CASINO] could not fetch the emojis of ${guild.name}: ${error.message}`); return null; });
            const list = [...(fetched ? fetched.values() : guild.emojis.cache.values())];
            const cards = list.filter((emoji) => /^cc_/u.test(emoji.name)).length;
            if (loggedCards.get(guild.id) !== cards) logger.info(`[CASINO] ${guild.name}: ${list.length} emojis, ${cards} named cc_`);
            loggedCards.set(guild.id, cards);
            all.push(...list);
        }
        return applyGuildEmojis(all);
    } catch (error) {
        logger.warn(`[CASINO] could not read the server emojis: ${error.message}`);
        return 0;
    }
}

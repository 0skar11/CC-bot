// registry.js — every native chat game and general games command (plan: docs/GAMES_PLAN.md). A game is one file
// in src/games/games/ whose default export is its definition; loadGames() registers the general commands
// (src/games/general.js) and then every file there, in name order. A word used twice (two games, or a game and an
// existing bot command such as `مينز`, `تحويل` or `help`) throws at load, so a clash fails the boot and the tests,
// never a live room. Words are compared after normalize() (src/games/engine/text.js): `تجربه` finds `تجربة`.
//
// ─── CONTRACT (phase 1+ games) ─────────────────────────────────────────────────────────────────────────────────
// export default {
//     id: 'fast',                                   unique, no spaces or ':'
//     kind: 'single' | 'dual' | 'group',            ('general' is for the commands in src/games/general.js)
//     names: { ar: ['اسرع'], en: ['fast'] },        typed after the PREFIX or a dot: `.اسرع`, `!fast`; one word each
//     description: { ar: '...', en: '...' },        optional: the `اوامر` line
//     minPlayers, maxPlayers,                       whole numbers; defaults single 1/1, dual 2/2, group GAMES.lobby
//     eventAdminOnly: false,                        true: trusted members only, even in the open channels
//     acceptArgs: (args) => args.length === 0,      optional: which words may follow the game word (default none);
//                                                   anything else is left to the rest of the bot (`توب cc` stays cctop)
//     async run(ctx) { ... },                       the game; the room is held until it returns (or 30 min)
// };
// The router (src/games/router.js) has already checked who may start it where (a trusted member anywhere in an
// allowed guild, anyone in the open channels OPEN_GAMES_CHANNEL_IDS; eventAdminOnly: trusted only) and that the room
// is free, and started the session. ctx:
//     client, message (the typed command), channel, guild, guildId, channelId,
//     starter (the User who typed it), member (their GuildMember or null), args (words after the game word),
//     lang ('ar' | 'en', from the script of the typed word), game (this definition),
//     session   the room's GameSession (engine/session.js): session.setTimeout/clearTimeout (cleared at the end),
//               session.onEnd(fn), session.ended / endReason, session.data (free space), session.clock
//     askRound(options)  → engine/round.js askRound(ctx, options): { winner, member, message, result, elapsedMs,
//                          prompt } | { timeout: true, prompt } | { cancelled: true, reason }
//     openLobby(options) → engine/lobby.js openLobby(ctx, options): { players, reason } | { cancelled, reason, players }
//     rewardWin(userId, kind = 'answer' | 'group') → engine/rewards.js rewardWin(client, guildId, userId, kind, game.id):
//                          { ok, amount, balance, points, totalPoints, wins, capped }; show it with announceWin
//     announceWin(round, reward, kind, { again }) → engine/rewards.js announceWin: the win line as a reply to the
//                          winner's message (pinging only the winner), with the 🔁 play-again button
//                          (engine/again.js) unless again: false (not the game's last message). Every game uses it.
//                          A 'single' game's time's-up reveal (askRound) carries the button too.
//     embed(title, description, options) → a ccEmbed() in the games colour
//     send(input) → posts a text / embed / payload / function result in the room without pings (engine/payload.js)
//     random() → a number in [0, 1) (Math.random; tests replace it)
// A game must not throw for a normal end (a timeout, a cancelled lobby); a throw is logged, the room gets a short
// error line and the session ends. Rounds and lobbies resolve as cancelled once the session ends: return then.

import { readdir } from 'node:fs/promises';
import { BOURSE_GUILD_COMMANDS } from '../config/bourseGuild.js';
import { GAMES_COMMAND } from '../config/casino.js';
import { commandArgAliases } from '../config/commands/commandAliases.js';
import { GAMES } from '../config/games.js';
import { GUIDE_PHRASES } from '../services/cc/guideUi.js';
import { normalize } from './engine/text.js';

export const KINDS = ['single', 'dual', 'group', 'general'];
const GAMES_DIR = new URL('./games/', import.meta.url);
// The streak's own one-word commands (src/services/cc/streakService.js PROFILE_WORDS).
const STREAK_WORDS = ['ستريك', 'streak', 'الستريك'];
const PLAYERS = {
    single: [1, 1], dual: [2, 2], general: [1, 1],
    get group() { return [GAMES.lobby.minPlayers, GAMES.lobby.maxPlayers]; },
};

/**
 * The normalized one-word commands the rest of the bot already answers: no game may take them. The games menu's
 * words (`العاب`, `games`: GAMES_COMMAND and its aliases) are not reserved: they are the general command `menu`
 * (src/games/general.js), the same menu the casino rooms show.
 */
export function reservedWords() {
    const oneWord = (word) => !/\s/u.test(word);
    const menuWord = (word) => word === GAMES_COMMAND || commandArgAliases[word] === GAMES_COMMAND;
    const words = [
        ...Object.keys(commandArgAliases).filter((word) => oneWord(word) && !menuWord(word)),
        ...[...BOURSE_GUILD_COMMANDS].filter((word) => !menuWord(word)),
        ...[...GUIDE_PHRASES].filter(oneWord), ...STREAK_WORDS,
    ];
    return new Set(words.map(normalize));
}

function words(list, label, id) {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`Game ${id}: names.${label} must be a list of words`);
    return list.map((word) => {
        if (typeof word !== 'string' || !normalize(word) || /\s/u.test(word.trim())) throw new Error(`Game ${id}: "${word}" must be one word`);
        return word.trim();
    });
}

function players(value, fallback, label, id) {
    if (value === undefined || value === null) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error(`Game ${id}: ${label} must be a whole number from 1 to 100`);
    return value;
}

/** A checked, frozen copy of a game definition (defaults filled in). Throws with the reason when it is not valid. */
export function validateGame(input) {
    if (!input || typeof input !== 'object') throw new Error('A game definition must be an object');
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id || /[\s:]/u.test(id)) throw new Error(`Invalid game id: ${JSON.stringify(input.id)}`);
    if (!KINDS.includes(input.kind)) throw new Error(`Game ${id}: kind must be one of ${KINDS.join(', ')}`);
    const names = { ar: words(input.names?.ar, 'ar', id), en: words(input.names?.en, 'en', id) };
    if (!names.ar.length && !names.en.length) throw new Error(`Game ${id}: it needs at least one word`);
    if (typeof input.run !== 'function') throw new Error(`Game ${id}: run(ctx) is missing`);
    if (input.acceptArgs !== undefined && typeof input.acceptArgs !== 'function') throw new Error(`Game ${id}: acceptArgs must be a function`);
    const [minDefault, maxDefault] = PLAYERS[input.kind];
    const minPlayers = players(input.minPlayers, minDefault, 'minPlayers', id);
    const maxPlayers = players(input.maxPlayers, Math.max(minPlayers, maxDefault), 'maxPlayers', id);
    if (maxPlayers < minPlayers) throw new Error(`Game ${id}: maxPlayers is smaller than minPlayers`);
    const description = { ar: String(input.description?.ar ?? ''), en: String(input.description?.en ?? input.description?.ar ?? '') };
    return Object.freeze({
        ...input, id, kind: input.kind, names: Object.freeze({ ar: Object.freeze(names.ar), en: Object.freeze(names.en) }),
        description: Object.freeze(description), minPlayers, maxPlayers,
        eventAdminOnly: input.eventAdminOnly === true,
        acceptArgs: input.acceptArgs || ((args) => args.length === 0),
        run: input.run,
    });
}

/** An empty registry. `reserved`: normalized words no game may use (default: the bot's existing commands). */
export function createRegistry({ reserved = reservedWords() } = {}) {
    const games = new Map();
    const byWord = new Map();

    function register(input) {
        const game = validateGame(input);
        if (games.has(game.id)) throw new Error(`Duplicate game id: ${game.id}`);
        const own = new Set();
        for (const word of [...game.names.ar, ...game.names.en]) {
            const key = normalize(word);
            if (reserved.has(key)) throw new Error(`Game ${game.id}: "${word}" is already a bot command`);
            const other = byWord.get(key);
            if (other) throw new Error(`Duplicate game word "${word}": ${other.id} and ${game.id}`);
            own.add(key);
        }
        // Nothing is added until every word passed, so a failed game leaves the registry as it was.
        games.set(game.id, game);
        for (const key of own) byWord.set(key, game);
        return game;
    }

    async function load(dir = GAMES_DIR) {
        const added = [];
        const files = (await readdir(dir)).filter((name) => name.endsWith('.js')).sort();
        for (const file of files) {
            const { default: game } = await import(new URL(file, dir));
            try { added.push(register(game)); } catch (error) { throw new Error(`${file}: ${error.message}`); }
        }
        return added;
    }

    return {
        register,
        load,
        find: (word) => {
            const key = normalize(word);
            if (key === 'روليت' || key === 'roulette') return games.get('roulette') || null;
            return byWord.get(key) || null;
        },
        get: (id) => games.get(id) || null,
        list: ({ kind = null } = {}) => [...games.values()].filter((game) => !kind || game.kind === kind),
        words: () => [...byWord.keys()],
    };
}

const TEXT = {
    ar: { admin: '🛡️ للأدمن', players: (min, max) => (min === max ? `👥 ${min}` : `👥 ${min}-${max}`) },
    en: { admin: '🛡️ admins', players: (min, max) => (min === max ? `👥 ${min}` : `👥 ${min}-${max}`) },
};
const KIND_EMOJI = { single: '🎯', dual: '⚔️', group: '👥', general: '📋' };

/** One line about a game: its words (Arabic and English), what it does, who may start it and how many play. */
export function describeGame(game, lang = 'ar') {
    if (!game) return '';
    const text = TEXT[lang === 'en' ? 'en' : 'ar'];
    const shown = lang === 'en' ? [...game.names.en, ...game.names.ar] : [...game.names.ar, ...game.names.en];
    const about = (lang === 'en' ? game.description.en : game.description.ar) || '';
    const extras = [
        ...(game.kind === 'dual' || game.kind === 'group' ? [text.players(game.minPlayers, game.maxPlayers)] : []),
        ...(game.eventAdminOnly ? [text.admin] : []),
    ];
    return `${KIND_EMOJI[game.kind] || '🎮'} ${shown.map((word) => `\`.${word}\``).join(' ')}${about ? ` — ${about}` : ''}${extras.length ? ` ・ ${extras.join(' ・ ')}` : ''}`;
}

// ─── The bot's registry ───
const registry = createRegistry();
let loading = null;

export const registerGame = (game) => registry.register(game);
export const findGame = (word) => registry.find(word);
export const getGame = (id) => registry.get(id);
export const listGames = (options) => registry.list(options);

/** Registers the general commands and every game file, once (later calls wait for the same load). */
export function loadGames() {
    loading ||= (async () => {
        const { GENERAL_COMMANDS } = await import('./general.js');
        for (const command of GENERAL_COMMANDS) registry.register(command);
        await registry.load(GAMES_DIR);
        return registry.list();
    })();
    return loading;
}

// router.js — the typed chat games (src/events/messageCreate.js calls handleGamesMessage before its own parsing).
// Only a message that starts with the PREFIX or a dot, then a registered game word (Arabic or English, compared
// after normalize()), is a games command, so plain chat never starts a game; the words that may follow are the
// game's acceptArgs (none by default), anything else goes on to the rest of the bot unchanged (`!توب cc` is still
// cctop, `!توب ستريك` the streak top). A picture or sticker post is never a command (it may count for the streak).
// - General commands (`اوامر`, `توب`, `نقاط`...) answer at once for everyone, in the games rooms
//   (GAMES_CHANNEL_IDS, or the bot's channels) or the bot's channels.
// - Games (any kind) are started by a trusted member (engine/admin.js isTrustedMember) in any channel of an allowed
//   guild, and by anyone in the open channels (OPEN_GAMES_CHANNEL_IDS, src/config/games.js), one game per room.
//   A member who is not trusted typing a game word anywhere else gets no reply at all (the message is consumed),
//   so the room stays clean. The games marked eventAdminOnly (the sample game `test`) need a trusted member even in
//   an open channel: there a member who is not trusted gets the admin notice at most every GAMES.noticeGapMs.
//   Group games keep their lobby minimum (minPlayers). A game word in a busy room gets one short "a game is
//   running" reply per member for that game.
// - The game runs detached from the message handler: its session holds the room until run() returns (or the safety
//   lifetime ends it), and any error is logged with a short line in the room, never thrown.

import { ccEmbed } from '../config/cc.js';
import { commandArgAliases } from '../config/commands/commandAliases.js';
import { GAMES, isGamesChannel, isOpenGamesChannel } from '../config/games.js';
import { isAllowedChannel, isAllowedGuild } from '../config/runtime.js';
import { inLang, wordLanguage } from '../services/cc/lang.js';
import { logger } from '../utils/logger.js';
import { isTrustedMember } from './engine/admin.js';
import { openLobby } from './engine/lobby.js';
import { postIn, replyTo } from './engine/payload.js';
import { rewardWin } from './engine/rewards.js';
import { askRound } from './engine/round.js';
import { getSession, realClock, startSession } from './engine/session.js';
import { findGame, loadGames } from './registry.js';

const TEXT = {
    ar: {
        busy: '⏳ في لعبة شغالة في الروم ده، استنى لما تخلص.',
        admin: '🛡️ اللعبة دي للأدمن ومنظمين الفعاليات بس.',
        failed: '❌ حصل خطأ في اللعبة واتقفلت.',
        commandFailed: '❌ حصل خطأ. حاول تاني بعد شوية.',
        expired: '⌛ اللعبة طولت أوي واتقفلت.',
    },
    en: {
        busy: '⏳ A game is already running in this room, wait for it to end.',
        admin: '🛡️ This game is for admins and event hosts only.',
        failed: '❌ Something went wrong, the game was closed.',
        commandFailed: '❌ Something went wrong. Try again in a bit.',
        expired: '⌛ The game ran too long and was closed.',
    },
};
const say = (lang) => inLang(lang, TEXT);

// `<userId>:<notice>` → when that member last got that notice (GAMES.noticeGapMs).
const lastNotice = new Map();
function noticeDue(key, now) {
    const last = lastNotice.get(key);
    if (last !== undefined && now - last < GAMES.noticeGapMs) return false;
    lastNotice.delete(key);
    lastNotice.set(key, now);
    if (lastNotice.size > 1000) lastNotice.delete(lastNotice.keys().next().value);
    return true;
}

/**
 * `{ word, args }` when `content` starts with the PREFIX or a dot directly followed by a word (`.top`, not `. top`),
 * else null (nothing is looked up).
 */
export function parseGamesCommand(content) {
    const text = String(content ?? '').trim();
    const start = GAMES.prefixes.find((word) => text.startsWith(word) && /^\S/u.test(text.slice(word.length)));
    if (!start) return null;
    const [word = '', ...args] = text.slice(start.length).trim().split(/\s+/u);
    return word ? { word, args } : null;
}

/** The ctx a game's run() gets (the contract is at the top of src/games/registry.js). */
export function buildContext({ client, message, game, session = null, args = [], lang = 'ar', random = Math.random }) {
    const channel = message.channel;
    const guildId = message.guildId || message.guild?.id || null;
    const ctx = {
        client, message, channel, guild: message.guild ?? null, guildId, channelId: message.channelId || channel?.id || null,
        starter: message.author, member: message.member ?? null, args, lang, game, session, random,
        embed: (title, description = '', options = {}) => ccEmbed(title, description, { color: GAMES.color, ...options }),
        send: (input) => postIn(channel, input),
    };
    ctx.askRound = (options) => askRound(ctx, options);
    ctx.openLobby = (options) => openLobby(ctx, options);
    ctx.rewardWin = (userId, kind = 'answer') => rewardWin(client, guildId, userId, kind, game.id);
    return ctx;
}

async function runGame(game, ctx) {
    try {
        await game.run(ctx);
    } catch (error) {
        logger.error(`[GAMES] ${game.id} failed`, error?.code || error?.message || error);
        if (!ctx.session.ended) await postIn(ctx.channel, say(ctx.lang).failed).catch(() => {});
    } finally {
        ctx.session.end('done');
    }
}

/**
 * messageCreate hook. Returns true when the message was a games command (handled here), false to let the rest of
 * the bot read it. Never throws. `options` ({ clock, random }) are for tests.
 */
export async function handleGamesMessage(message, client, { clock = realClock, random = Math.random } = {}) {
    let claimed = false;
    let lang = 'ar';
    try {
        if (!message || message.author?.bot || message.webhookId) return false;
        if (message.attachments?.size > 0 || message.stickers?.size > 0) return false;
        const command = parseGamesCommand(message.content);
        if (!command) return false;
        // The two-word commands of the rest of the bot keep their route (`!توب cc`, `!top cc`).
        if (command.args.length && Object.hasOwn(commandArgAliases, `${command.word.toLowerCase()} ${command.args[0].toLowerCase()}`)) return false;
        await loadGames();
        const game = findGame(command.word);
        if (!game || !game.acceptArgs(command.args)) return false;
        const channelId = message.channelId || message.channel?.id;
        if (!channelId || typeof message.channel?.send !== 'function') return false;
        const general = game.kind === 'general';
        if (general) {
            if (!isGamesChannel(message.channel, channelId) && !isAllowedChannel(message.channel, channelId)) return false;
            claimed = true;
            lang = wordLanguage(command.word);
            await game.run(buildContext({ client, message, game, args: command.args, lang, random }));
            return true;
        }
        if (!isAllowedGuild(message.guildId || message.guild?.id)) return false;
        const trusted = isTrustedMember(message.member);
        // Not trusted outside an open channel: no reply at all, and the message goes nowhere else.
        if (!trusted && !isOpenGamesChannel(message.channel, channelId)) return true;
        claimed = true;
        lang = wordLanguage(command.word);
        const ctx = buildContext({ client, message, game, args: command.args, lang, random });
        const userId = message.author.id;
        if (game.eventAdminOnly && !trusted) {
            if (noticeDue(`${userId}:admin`, clock.now())) await replyTo(message, say(lang).admin);
            return true;
        }
        const session = startSession({ channelId, guildId: ctx.guildId, gameId: game.id, starterId: userId, clock });
        if (!session) {
            const running = getSession(channelId);
            if (running && !running.notices.has(userId)) {
                running.notices.add(userId);
                await replyTo(message, say(lang).busy);
            }
            return true;
        }
        ctx.session = session;
        session.onEnd((reason) => {
            if (reason === 'expired') return postIn(message.channel, say(lang).expired).catch(() => {});
            return null;
        });
        logger.info(`[GAMES] ${game.id} started in ${channelId} by ${userId}`);
        session.running = runGame(game, ctx);
        return true;
    } catch (error) {
        logger.error('[GAMES] A typed games command failed', error?.code || error?.message || error);
        if (claimed) await postIn(message.channel, say(lang).commandFailed).catch(() => {});
        return claimed;
    }
}

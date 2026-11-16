// router.js — the typed chat games (src/events/messageCreate.js calls handleGamesMessage before its own parsing).
// Only a message that starts with the PREFIX or a dot, then a registered game word (Arabic or English, compared
// after normalize()), is a games command, so plain chat never starts a game; the words that may follow are the
// game's acceptArgs (none by default), anything else goes on to the rest of the bot unchanged (`!توب cc` is still
// cctop, `!توب ستريك` the streak top). A picture or sticker post is never a command (it may count for the streak).
// - General commands (`اوامر`, `توب`, `نقاط`...) answer at once for everyone, in the games rooms
//   (GAMES_CHANNEL_IDS, or the bot's channels) or the bot's channels. The games menu (`العاب` / `games`, marked
//   everyGamesRoom) also answers in the casino rooms, the open channels, and anywhere for a trusted member.
// - Games (any kind) are started by a trusted member (engine/admin.js isTrustedMember) in any channel of an allowed
//   guild, and by anyone in the open channels (OPEN_GAMES_CHANNEL_IDS, src/config/games.js), one game per room
//   (startRule: the same rule for the typed command, the play-again button and the games menu).
//   A member who is not trusted typing a game word anywhere else gets no reply at all (the message is consumed),
//   so the room stays clean. The games marked eventAdminOnly (the sample game `test`) need a trusted member even in
//   an open channel: there a member who is not trusted gets the admin notice at most every GAMES.noticeGapMs.
//   Group games keep their lobby minimum (minPlayers). A game word in a busy room gets one short "a game is
//   running" reply per member for that game.
// - `g:again:<gameId>` (engine/again.js), the help menu's game select (`g:help:<token>:play:<n>`, helpMenu.js) and
//   the old games menu's select (`g:menu:...`, on menus posted before the help menu) start a round exactly like the typed command
//   (same ctx, rewards and daily cap); a press that cannot start one gets a short private reply.
// - The game runs detached from the message handler: its session holds the room until run() returns (or the safety
//   lifetime ends it), and any error is logged with a short line in the room, never thrown.

import { MessageFlags } from 'discord.js';
import { GAMES_COMMAND } from '../config/casino.js';
import { ccEmbed } from '../config/cc.js';
import { commandArgAliases } from '../config/commands/commandAliases.js';
import { GAMES, isGamesChannel, isOpenGamesChannel } from '../config/games.js';
import { isAllowedChannel, isAllowedGuild, isCommandChannel } from '../config/runtime.js';
import { buttonLanguage, inLang, wordLanguage } from '../services/cc/lang.js';
import { logger } from '../utils/logger.js';
import { isTrustedMember } from './engine/admin.js';
import { armedAgain, cooldownLeft, disarm, markStarted, removeAgain } from './engine/again.js';
import { openLobby } from './engine/lobby.js';
import { postIn, replyTo } from './engine/payload.js';
import { announceWin, rewardWin } from './engine/rewards.js';
import { askRound } from './engine/round.js';
import { getSession, isBusy, realClock, startSession } from './engine/session.js';
import { HELP_CATEGORIES, helpMenuPayload, helpMenuState, helpNotice } from './helpMenu.js';
import { findGame, getGame, loadGames } from './registry.js';

const TEXT = {
    ar: {
        busy: '⏳ في لعبة شغالة في الروم ده، استنى لما تخلص.',
        admin: '🛡️ اللعبة دي للأدمن ومنظمين الفعاليات بس.',
        failed: '❌ حصل خطأ في اللعبة واتقفلت.',
        commandFailed: '❌ حصل خطأ. حاول تاني بعد شوية.',
        expired: '⌛ اللعبة طولت أوي واتقفلت.',
        cannot: '🚫 مينفعش تبدأ ألعاب في الروم ده.',
        foreign: '🚫 الزرار ده مش للروم ده.',
        stale: '⌛ الزرار ده خلص، اكتب أمر اللعبة تاني.',
        unknown: '❌ اللعبة دي مش موجودة.',
        wait: (seconds) => `⏳ استنى **${seconds}** ثانية وجرّب تاني.`,
    },
    en: {
        busy: '⏳ A game is already running in this room, wait for it to end.',
        admin: '🛡️ This game is for admins and event hosts only.',
        failed: '❌ Something went wrong, the game was closed.',
        commandFailed: '❌ Something went wrong. Try again in a bit.',
        expired: '⌛ The game ran too long and was closed.',
        cannot: "🚫 You can't start games in this room.",
        foreign: "🚫 This button isn't for this room.",
        stale: '⌛ This button has expired, type the game command again.',
        unknown: "❌ This game doesn't exist.",
        wait: (seconds) => `⏳ Wait **${seconds}** second(s) and try again.`,
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
export function buildContext({ client, message, game, session = null, args = [], lang = 'ar', random = Math.random, clock = realClock }) {
    const channel = message.channel;
    const guildId = message.guildId || message.guild?.id || null;
    const ctx = {
        client, message, channel, guild: message.guild ?? null, guildId, channelId: message.channelId || channel?.id || null,
        starter: message.author, member: message.member ?? null, args, lang, game, session, random, clock,
        embed: (title, description = '', options = {}) => ccEmbed(title, description, { color: GAMES.color, ...options }),
        send: (input) => postIn(channel, input),
    };
    ctx.askRound = (options) => askRound(ctx, options);
    ctx.openLobby = (options) => openLobby(ctx, options);
    ctx.rewardWin = (userId, kind = 'answer') => rewardWin(client, guildId, userId, kind, game.id);
    ctx.announceWin = (round, reward, kind = 'answer', options) => announceWin(ctx, round, reward, kind, options);
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
 * Who may start `game` (not a general command) in this room, the one rule of the typed command, the play-again
 * button and the menu: 'ok'; 'guild' (not an allowed guild); 'closed' (a member who is not trusted, outside the
 * open channels); 'admin' (an eventAdminOnly game and a member who is not trusted).
 */
export function startRule(game, { member, channel, channelId, guildId }) {
    if (!isAllowedGuild(guildId)) return 'guild';
    const trusted = isTrustedMember(member);
    if (!trusted && !isOpenGamesChannel(channel, channelId)) return 'closed';
    if (game.eventAdminOnly && !trusted) return 'admin';
    return 'ok';
}

/** The rooms of a general command; the games menu (everyGamesRoom) also answers in every games room. */
function generalRoom(game, { member, channel, channelId }) {
    if (isGamesChannel(channel, channelId) || isAllowedChannel(channel, channelId)) return true;
    if (!game.everyGamesRoom) return false;
    return isCommandChannel(GAMES_COMMAND, channel, channelId) || isOpenGamesChannel(channel, channelId) || isTrustedMember(member);
}

/**
 * Starts `game` in the room of `message` (a typed command, or a press dressed as one: pressMessage) once
 * startRule allowed it: holds the room and runs the game detached. Returns { session }, or { busy } (the room's
 * running session) when the room already has a game.
 */
export function launchGame({ client, message, game, args = [], lang = 'ar', random = Math.random, clock = realClock }) {
    const channelId = message.channelId || message.channel?.id;
    const ctx = buildContext({ client, message, game, args, lang, random, clock });
    const userId = message.author.id;
    const session = startSession({ channelId, guildId: ctx.guildId, gameId: game.id, starterId: userId, clock });
    if (!session) return { busy: getSession(channelId) };
    ctx.session = session;
    session.onEnd((reason) => {
        if (reason === 'expired') return postIn(message.channel, say(lang).expired).catch(() => {});
        return null;
    });
    logger.info(`[GAMES] ${game.id} started in ${channelId} by ${userId}`);
    session.running = runGame(game, ctx);
    return { session };
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
        const room = { member: message.member, channel: message.channel, channelId, guildId: message.guildId || message.guild?.id };
        if (game.kind === 'general') {
            if (!generalRoom(game, room)) return false;
            claimed = true;
            lang = wordLanguage(command.word);
            await game.run(buildContext({ client, message, game, args: command.args, lang, random, clock }));
            return true;
        }
        const rule = startRule(game, room);
        if (rule === 'guild') return false;
        // Not trusted outside an open channel: no reply at all, and the message goes nowhere else.
        if (rule === 'closed') return true;
        claimed = true;
        lang = wordLanguage(command.word);
        const userId = message.author.id;
        if (rule === 'admin') {
            if (noticeDue(`${userId}:admin`, clock.now())) await replyTo(message, say(lang).admin);
            return true;
        }
        const { busy } = launchGame({ client, message, game, args: command.args, lang, random, clock });
        if (busy && !busy.notices.has(userId)) {
            busy.notices.add(userId);
            await replyTo(message, say(lang).busy);
        }
        return true;
    } catch (error) {
        logger.error('[GAMES] A typed games command failed', error?.code || error?.message || error);
        if (claimed) await postIn(message.channel, say(lang).commandFailed).catch(() => {});
        return claimed;
    }
}

// ─── A round started from a button (play again) or the games menu ───

/** A press, shaped like the typed command a game's ctx expects (no id: it is never an answer). */
function pressMessage(interaction) {
    const channel = interaction.channel;
    return {
        id: null, content: '', author: interaction.user, member: interaction.member ?? null,
        guild: interaction.guild ?? null, guildId: interaction.guildId || interaction.guild?.id || null,
        channel, channelId: interaction.channelId || channel?.id || null,
        attachments: new Map(), stickers: new Map(), mentions: { users: new Map() },
    };
}

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

/**
 * Starts `game` for a press under startRule, one round at a time per room and at most one from a press every
 * AGAIN_COOLDOWN_MS (engine/again.js). Returns null when it started, else the private notice to answer.
 */
function startFromPress(interaction, client, game, lang, { clock, random }) {
    const text = say(lang);
    const message = pressMessage(interaction);
    if (!message.author?.id || message.author.bot) return text.cannot;
    if (!message.channelId || typeof message.channel?.send !== 'function' || typeof message.channel?.createMessageCollector !== 'function') return text.foreign;
    const rule = startRule(game, message);
    if (rule === 'guild') return text.foreign;
    if (rule === 'closed') return text.cannot;
    if (rule === 'admin') return text.admin;
    if (isBusy(message.channelId)) return text.busy;
    const wait = cooldownLeft(message.channelId, clock.now());
    if (wait > 0) return text.wait(Math.ceil(wait / 1000));
    if (launchGame({ client, message, game, lang, random, clock }).busy !== undefined) return text.busy;
    markStarted(message.channelId, clock.now());
    return null;
}

/** A press on `g:again:<gameId>`: a new round of the same game in the same room. Never throws. */
export async function handleAgainButton(interaction, client, [gameId] = [], { clock = realClock, random = Math.random } = {}) {
    const messageId = interaction.message?.id;
    const state = armedAgain(messageId);
    const lang = state?.lang ?? buttonLanguage(interaction);
    try {
        await loadGames();
        const game = getGame(String(gameId || ''));
        if (!game || game.kind === 'general') return await privately(interaction, say(lang).unknown);
        if (!state || state.gameId !== game.id) {
            // Used, timed out or from before a restart: it goes away so nobody else presses it.
            await privately(interaction, say(lang).stale);
            if (!state) await removeAgain(interaction.message);
            return undefined;
        }
        if (state.channelId && state.channelId !== String(interaction.channelId || interaction.channel?.id || '')) return await privately(interaction, say(lang).foreign);
        const notice = startFromPress(interaction, client, game, lang, { clock, random });
        if (notice) return await privately(interaction, notice);
        // One use: the button goes away with this press.
        disarm(messageId);
        await Promise.resolve().then(() => interaction.update({ components: [] })).catch(() => removeAgain(interaction.message));
    } catch (error) {
        logger.warn(`[GAMES] A play-again button failed: ${error?.message || error}`);
        await privately(interaction, say(lang).commandFailed);
    }
    return undefined;
}

/** A pick in the games menu (`g:menu:<lang>:<n>`, the game id as the value). Never throws. */
export async function handleMenuSelect(interaction, client, [menuLang] = [], { clock = realClock, random = Math.random } = {}) {
    const lang = menuLang === 'en' || menuLang === 'ar' ? menuLang : buttonLanguage(interaction);
    try {
        await loadGames();
        const game = getGame(String(interaction.values?.[0] || ''));
        if (!game || game.kind === 'general') return await privately(interaction, say(lang).unknown);
        const notice = startFromPress(interaction, client, game, lang, { clock, random });
        if (notice) return await privately(interaction, notice);
        await Promise.resolve().then(() => interaction.deferUpdate()).catch(() => {});
    } catch (error) {
        logger.warn(`[GAMES] A games menu pick failed: ${error?.message || error}`);
        await privately(interaction, say(lang).commandFailed);
    }
    return undefined;
}

/**
 * A pick in the help menu (`g:help:<token>:cat` a category, `g:help:<token>:play:<n>` a game; src/games/helpMenu.js).
 * Only the member who opened it, in its room, while it lives. A category edits the same message; a game starts
 * like the typed command (startRule). Never throws.
 */
export async function handleHelpSelect(interaction, client, [token, action] = [], { clock = realClock, random = Math.random } = {}) {
    const state = helpMenuState(token, clock.now());
    const lang = state?.lang ?? buttonLanguage(interaction);
    try {
        if (!state) return await privately(interaction, helpNotice(lang).expired);
        if (String(interaction.user?.id || '') !== state.requesterId) return await privately(interaction, helpNotice(lang).notYours(state.requesterId));
        if (state.channelId && state.channelId !== String(interaction.channelId || interaction.channel?.id || '')) return await privately(interaction, say(lang).foreign);
        await loadGames();
        const value = String(interaction.values?.[0] || '');
        if (action === 'cat') {
            if (!HELP_CATEGORIES.includes(value)) return await privately(interaction, say(lang).unknown);
            state.category = value;
            if (typeof interaction.message?.edit === 'function') state.target = interaction.message;
            // No files: the banner already on the message stays (an edit keeps its attachments).
            await interaction.update(helpMenuPayload(state));
            return undefined;
        }
        if (action === 'play') {
            const game = getGame(value);
            if (!game || game.kind === 'general' || game.eventAdminOnly) return await privately(interaction, say(lang).unknown);
            const notice = startFromPress(interaction, client, game, lang, { clock, random });
            if (notice) return await privately(interaction, notice);
            await Promise.resolve().then(() => interaction.deferUpdate()).catch(() => {});
            return undefined;
        }
        await privately(interaction, say(lang).unknown);
    } catch (error) {
        logger.warn(`[GAMES] A help menu pick failed: ${error?.message || error}`);
        await privately(interaction, say(lang).commandFailed);
    }
    return undefined;
}

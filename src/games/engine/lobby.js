// lobby.js — the join lobby of the dual and group games: one message with the players and three buttons,
// ✅ Join, 🚪 Leave and ▶️ Start (the host only, once there are `min` players). The lobby closes when the host
// starts it, when it is full (`max`) or when its time runs out (it starts then if `min` players joined, else it is
// cancelled); the countdown is edited every GAMES.lobby.tickMs and the buttons go away when it closes.
// Buttons are `g:<join|leave|start>:<lobbyId>` (GAMES_BUTTON_PREFIX, src/interactions/buttons/store/games.js):
// lobbies live in memory, so a button of a lobby that is gone (it closed, or the bot restarted) only answers,
// privately, that the game ended, and its message loses its buttons.
//
// openLobby(ctx, { min, max, joinSeconds, title, description, hostPlays }) resolves to
//   { players: [userId...], reason: 'start' | 'full' | 'time' }       the game can begin with these players
//   { cancelled: true, reason, players }                              'players' (fewer than min when the time ran
//                                                                     out), 'send', or the session's end reason
// min / max default to the game's minPlayers / maxPlayers, joinSeconds to GAMES.lobby.joinSeconds; the host
// (ctx.starter) is the first player unless hostPlays is false.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { ccEmbed } from '../../config/cc.js';
import { GAMES, GAMES_BUTTON_PREFIX } from '../../config/games.js';
import { buttonLanguage, inLang } from '../../services/cc/lang.js';
import { logger } from '../../utils/logger.js';

const TEXT = {
    ar: {
        host: (id) => `👑 صاحب اللعبة: <@${id}>`,
        count: (n, max, min) => `👥 اللاعبين: **${n}/${max}** (أقل عدد ${min})`,
        empty: 'لسه محدش دخل.',
        left: (seconds) => `⏳ باقي **${seconds}** ثانية، دوس ✅ عشان تدخل.`,
        started: '▶️ اللعبة بدأت!',
        cancelled: {
            players: (min) => `❌ اللعبة اتلغت: محتاجين ${min} لاعبين على الأقل.`,
            other: '❌ اللعبة اتلغت.',
        },
        join: 'ادخل', leave: 'اخرج', start: 'ابدأ',
        ended: '⌛ اللعبة دي خلصت.',
        already: '✅ انت داخل أصلاً.',
        full: '❌ اللوبي كمل.',
        notIn: '❌ انت مش داخل اللعبة.',
        hostStays: '❌ انت صاحب اللعبة، مينفعش تخرج.',
        onlyHost: '❌ صاحب اللعبة بس اللي يقدر يبدأ.',
        need: (n) => `❌ لسه محتاجين **${n}** لاعب كمان.`,
    },
    en: {
        host: (id) => `👑 Host: <@${id}>`,
        count: (n, max, min) => `👥 Players: **${n}/${max}** (at least ${min})`,
        empty: 'Nobody joined yet.',
        left: (seconds) => `⏳ **${seconds}** seconds left, press ✅ to join.`,
        started: '▶️ The game started!',
        cancelled: {
            players: (min) => `❌ Game cancelled: it needs at least ${min} players.`,
            other: '❌ Game cancelled.',
        },
        join: 'Join', leave: 'Leave', start: 'Start',
        ended: '⌛ This game has ended.',
        already: "✅ You're already in.",
        full: '❌ The lobby is full.',
        notIn: "❌ You're not in this game.",
        hostStays: "❌ You're the host, you can't leave.",
        onlyHost: '❌ Only the host can start.',
        need: (n) => `❌ It still needs **${n}** more player(s).`,
    },
};
const say = (lang) => inLang(lang, TEXT);

// lobbyId → the open lobby.
const lobbies = new Map();
export const openLobbies = () => [...lobbies.values()];

const playerLines = (lobby) => lobby.players.slice(0, 40).map((id, index) => `${index + 1}. <@${id}>`).join('\n')
    + (lobby.players.length > 40 ? `\n… +${lobby.players.length - 40}` : '');

function lobbyEmbed(lobby, status) {
    const text = say(lobby.lang);
    return ccEmbed(lobby.title, [
        ...(lobby.description ? [lobby.description, ''] : []),
        text.host(lobby.hostId),
        text.count(lobby.players.length, lobby.max, lobby.min),
        playerLines(lobby) || text.empty,
        '',
        status,
    ].join('\n'), { color: GAMES.color });
}

function buttons(lobby) {
    const text = say(lobby.lang);
    const id = (action) => `${GAMES_BUTTON_PREFIX}:${action}:${lobby.id}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('join')).setLabel(text.join).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(id('leave')).setLabel(text.leave).setEmoji('🚪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('start')).setLabel(text.start).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(lobby.players.length < lobby.min),
    );
}

const secondsLeft = (lobby) => Math.max(0, Math.ceil((lobby.closesAt - lobby.session.clock.now()) / 1000));

/** The open lobby's message: players, countdown and buttons. */
export function lobbyPayload(lobby) {
    return { embeds: [lobbyEmbed(lobby, say(lobby.lang).left(secondsLeft(lobby)))], components: [buttons(lobby)], allowedMentions: { parse: [] } };
}

function closedPayload(lobby, result) {
    const text = say(lobby.lang);
    const status = !result.cancelled ? text.started : result.reason === 'players' ? text.cancelled.players(lobby.min) : text.cancelled.other;
    return { embeds: [lobbyEmbed(lobby, status)], components: [], allowedMentions: { parse: [] } };
}

const editMessage = (lobby, payload) => lobby.message?.edit?.(payload)?.catch?.((error) => logger.warn(`[GAMES] Could not edit a lobby: ${error.code || error.message}`));

/** Closes the lobby once; `interaction` (a button press) acknowledges the press with the final message. */
function closeLobby(lobby, result, interaction = null) {
    if (lobby.done) return null;
    lobby.done = true;
    lobbies.delete(lobby.id);
    lobby.session.clearTimeout(lobby.deadline);
    lobby.session.clearTimeout(lobby.tick);
    lobby.offEnd();
    const final = result.cancelled ? { cancelled: true, reason: result.reason, players: [...lobby.players] } : { players: [...lobby.players], reason: result.reason };
    const payload = closedPayload(lobby, final);
    const shown = interaction ? updatePress(interaction, lobby, payload) : editMessage(lobby, payload);
    lobby.resolve(final);
    return shown;
}

// Acknowledges a press by editing its message; edits the lobby message directly if that fails.
function updatePress(interaction, lobby, payload) {
    return Promise.resolve().then(() => interaction.update(payload)).catch(() => editMessage(lobby, payload));
}

function scheduleTick(lobby) {
    lobby.tick = lobby.session.setTimeout(() => {
        if (lobby.done) return;
        editMessage(lobby, lobbyPayload(lobby));
        scheduleTick(lobby);
    }, GAMES.lobby.tickMs);
}

const wholeNumber = (value, fallback) => (Number.isSafeInteger(value) && value >= 1 ? value : fallback);

export async function openLobby(ctx, { min, max, joinSeconds, title, description = '', hostPlays = true } = {}) {
    const { session, channel, starter, game } = ctx;
    if (!session || session.ended) return { cancelled: true, reason: session?.endReason || 'ended', players: [] };
    const low = wholeNumber(min, wholeNumber(game?.minPlayers, GAMES.lobby.minPlayers));
    const high = Math.max(low, wholeNumber(max, wholeNumber(game?.maxPlayers, GAMES.lobby.maxPlayers)));
    const seconds = wholeNumber(joinSeconds, GAMES.lobby.joinSeconds);
    const lobby = {
        id: randomBytes(6).toString('hex'), session, lang: ctx.lang, hostId: starter.id, hostPlays: hostPlays !== false,
        title: String(title || game?.names?.[ctx.lang]?.[0] || game?.id || '🎮').slice(0, 256), description,
        min: low, max: high, players: hostPlays !== false ? [starter.id] : [],
        closesAt: session.clock.now() + seconds * 1000, done: false, message: null, deadline: null, tick: null, offEnd: () => {},
    };
    try { lobby.message = await channel.send(lobbyPayload(lobby)); } catch (error) {
        logger.warn(`[GAMES] Could not post a lobby: ${error.code || error.message}`);
        return { cancelled: true, reason: 'send', players: [] };
    }
    if (session.ended) {
        editMessage(lobby, closedPayload(lobby, { cancelled: true, reason: session.endReason }));
        return { cancelled: true, reason: session.endReason, players: [] };
    }
    return new Promise((resolve) => {
        lobby.resolve = resolve;
        lobbies.set(lobby.id, lobby);
        lobby.offEnd = session.onEnd((reason) => closeLobby(lobby, { cancelled: true, reason }));
        lobby.deadline = session.setTimeout(() => {
            closeLobby(lobby, lobby.players.length >= lobby.min ? { reason: 'time' } : { cancelled: true, reason: 'players' });
        }, seconds * 1000);
        scheduleTick(lobby);
        if (lobby.players.length >= lobby.max) closeLobby(lobby, { reason: 'full' });
    });
}

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

/** A press on a `g:` button. Never throws. */
export async function handleLobbyButton(interaction, [action, lobbyId] = []) {
    try {
        const lobby = lobbies.get(String(lobbyId || ''));
        if (!lobby || lobby.done) {
            await privately(interaction, say(lobby?.lang ?? buttonLanguage(interaction)).ended);
            // A lobby from before a restart: its buttons go away so nobody else presses them.
            if (!lobby) await interaction.message?.edit?.({ components: [] })?.catch?.(() => {});
            return;
        }
        const text = say(lobby.lang);
        const userId = interaction.user?.id;
        if (!userId || interaction.user.bot) return;
        const has = lobby.players.includes(userId);
        if (action === 'join') {
            if (has) return privately(interaction, text.already);
            if (lobby.players.length >= lobby.max) return privately(interaction, text.full);
            lobby.players.push(userId);
            if (lobby.players.length >= lobby.max) return closeLobby(lobby, { reason: 'full' }, interaction);
        } else if (action === 'leave') {
            if (userId === lobby.hostId && lobby.hostPlays) return privately(interaction, text.hostStays);
            if (!has) return privately(interaction, text.notIn);
            lobby.players.splice(lobby.players.indexOf(userId), 1);
        } else if (action === 'start') {
            if (userId !== lobby.hostId) return privately(interaction, text.onlyHost);
            if (lobby.players.length < lobby.min) return privately(interaction, text.need(lobby.min - lobby.players.length));
            return closeLobby(lobby, { reason: 'start' }, interaction);
        } else {
            return privately(interaction, text.ended);
        }
        await updatePress(interaction, lobby, lobbyPayload(lobby));
    } catch (error) {
        logger.warn(`[GAMES] A lobby button failed: ${error?.message || error}`);
        await privately(interaction, say(buttonLanguage(interaction)).ended);
    }
}

// duel.js — the two-player board games (kind 'dual': xo, حجره, توصيل). One flow for all of them:
// 1. findOpponent(): the challenger (ctx.starter) opens a lobby of exactly two (engine/lobby.js); the first member
//    to press ✅ within GAMES.duel.joinSeconds is the opponent, else the game is cancelled.
// 2. playBoard(): one board message whose buttons (and select) are `g:duel:<boardId>:<move>` (GAMES_BUTTON_PREFIX,
//    src/interactions/buttons/store/games.js). Only the two players may press (anyone else gets a private line);
//    in a turn game only the player whose turn it is. Each move (each round of a game with `simultaneous`) has
//    GAMES.duel.moveSeconds, shown as the live countdown line of engine/countdown.js; when it runs out the player
//    who did not move forfeits. The challenger moves first.
// 3. finishDuel(): a winner is paid once (ctx.rewardWin with GAMES.duel.winKind, 'answer': 500 CC within the
//    shared daily cap) and announced with
//    ctx.announceWin (a reply to the board, with play-again); a draw or a game nobody played gets a line with
//    the play-again button.
// Boards live in memory: a press on a board that is gone (it ended, or the bot restarted) answers privately that
// the game ended, and its message loses its buttons. The session ending (shutdown, the safety lifetime) closes it.
//
// A game hands playBoard a `rules` object:
//   state                       the board's starting state (the game's own)
//   simultaneous                true: both players move in the same round (حجره); false: turn by turn
//   move(board, index, move)    applies `move` (a string from the customId or the select) of players[index];
//                               returns { error: 'text' } (a private reply, nothing changes), or
//                               { over: { winner: index | null, reason: 'win' | 'draw' } } (the game ended), or
//                               { private: 'text' } (answered privately, the board message is edited),
//                               or {} / { next: true } (the move counted; a turn game passes the turn)
//                               `next: false` keeps the turn (or the round's timer) where it is
//   timeout(board)              optional: { winner: index | null, reason } when the time runs out (default: the
//                               player whose turn it is forfeits)
//   render(board)               the message payload ({ content?, embeds, components }); board.done and
//                               board.outcome are set for the last render
// playBoard resolves { winner, loser, reason, board }: winner / loser are user ids (null for a draw), reason
// 'win' | 'draw' | 'forfeit' | 'idle' (nobody moved) | 'send' | the session's end reason.

import { randomBytes } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { GAMES, GAMES_BUTTON_PREFIX } from '../../config/games.js';
import { buttonLanguage, inLang } from '../../services/cc/lang.js';
import { logger } from '../../utils/logger.js';
import { armAgain, withAgain } from './again.js';
import { roundCountdown, withCountdown } from './countdown.js';
import { postIn } from './payload.js';

export const DUEL_ACTION = 'duel';
export const END_REASONS = ['win', 'draw', 'forfeit', 'idle'];

const TEXT = {
    ar: {
        challenge: (id) => `⚔️ <@${id}> بيتحدى أي حد! دوس ✅ ادخل عشان تلعب قصاده.`,
        notPlayer: '🚫 اللعبة دي بين اللاعبين الاتنين بس.',
        notTurn: '⏳ مش دورك، استنى.',
        ended: '⌛ اللعبة دي خلصت.',
        turn: (id) => `🎯 الدور على <@${id}>`,
        forfeit: (id) => `⌛ <@${id}> وقته خلص وخسر اللعبة.`,
        draw: '🤝 تعادل! محدش كسب.',
        idle: '⌛ الوقت خلص ومحدش لعب.',
        won: (id) => `🏆 <@${id}> كسب!`,
    },
    en: {
        challenge: (id) => `⚔️ <@${id}> challenges anyone! Press ✅ Join to play against them.`,
        notPlayer: '🚫 This game is between its two players only.',
        notTurn: "⏳ It's not your turn, wait.",
        ended: '⌛ This game has ended.',
        turn: (id) => `🎯 <@${id}>'s turn`,
        forfeit: (id) => `⌛ <@${id}> ran out of time and lost.`,
        draw: '🤝 A draw! Nobody won.',
        idle: "⌛ Time's up and nobody played.",
        won: (id) => `🏆 <@${id}> won!`,
    },
};
const say = (lang) => inLang(lang, TEXT);
export const duelText = say;

// boardId → the live board.
const boards = new Map();
export const openBoards = () => [...boards.values()];

export const duelCustomId = (boardId, move) => `${GAMES_BUTTON_PREFIX}:${DUEL_ACTION}:${boardId}:${move}`;

/**
 * The challenge lobby: the challenger and one opponent. Resolves [challengerId, opponentId], or null when nobody
 * joined in time or the session ended.
 */
export async function findOpponent(ctx, { title, description = '', joinSeconds = GAMES.duel.joinSeconds } = {}) {
    const lead = say(ctx.lang).challenge(ctx.starter.id);
    const result = await ctx.openLobby({ min: 2, max: 2, joinSeconds, title, description: description ? `${lead}\n${description}` : lead });
    if (result?.cancelled || !Array.isArray(result?.players) || result.players.length < 2) return null;
    return result.players.slice(0, 2);
}

/** The status line of a board: whose turn it is, or how it ended. */
export function statusLine(board) {
    const text = say(board.lang);
    const outcome = board.outcome;
    if (!outcome) return board.simultaneous ? '' : text.turn(board.players[board.turn]);
    if (outcome.reason === 'forfeit') return text.forfeit(outcome.loser);
    if (outcome.reason === 'draw') return text.draw;
    if (outcome.reason === 'idle') return text.idle;
    if (outcome.winner) return text.won(outcome.winner);
    return text.ended;
}

function payloadOf(board) {
    const payload = { allowedMentions: { parse: [] }, ...board.rules.render(board) };
    if (board.done) return payload;
    return withCountdown(payload, roundCountdown(board.lang, board.endsAt));
}

const editBoard = (board) => Promise.resolve()
    .then(() => board.message?.edit?.(payloadOf(board)))
    .catch((error) => logger.warn(`[GAMES] Could not edit a board: ${error?.code || error?.message || error}`));

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

// Acknowledges a press by editing its message; edits the board message directly when that fails.
const updatePress = (interaction, board) => Promise.resolve()
    .then(() => interaction.update(payloadOf(board)))
    .catch(() => editBoard(board));

function armDeadline(board) {
    board.session.clearTimeout(board.deadline);
    board.endsAt = board.session.clock.now() + board.moveMs;
    board.deadline = board.session.setTimeout(() => timeUp(board), board.moveMs);
}

/** Ends the board once with `result` ({ winner: index | null, reason } or { cancelled }); `interaction` shows it. */
function finish(board, result, interaction = null) {
    if (board.done) return null;
    board.done = true;
    boards.delete(board.id);
    board.session.clearTimeout(board.deadline);
    board.offEnd();
    const winner = Number.isInteger(result.winner) ? board.players[result.winner] : null;
    const loser = Number.isInteger(result.winner) ? board.players[1 - result.winner] : (result.loser ?? null);
    board.outcome = { winner, loser, reason: result.reason };
    const shown = interaction ? updatePress(interaction, board) : editBoard(board);
    board.resolve({ winner, loser, reason: result.reason, board });
    return shown;
}

function timeUp(board) {
    if (board.done) return;
    const result = board.rules.timeout?.(board) ?? { winner: 1 - board.turn, reason: 'forfeit' };
    finish(board, result);
}

/** Plays one board between `players` ([challengerId, opponentId]); see the top of this file. */
export async function playBoard(ctx, { players, rules, moveSeconds = GAMES.duel.moveSeconds }) {
    const { session, channel } = ctx;
    if (!session || session.ended) return { winner: null, loser: null, reason: session?.endReason || 'ended', board: null };
    const board = {
        id: randomBytes(6).toString('hex'), session, lang: ctx.lang === 'en' ? 'en' : 'ar', gameId: ctx.game?.id ?? null,
        players: [...players], turn: 0, simultaneous: rules.simultaneous === true, rules, state: rules.state,
        moveMs: Math.max(1, Number(moveSeconds) || GAMES.duel.moveSeconds) * 1000,
        endsAt: session.clock.now() + Math.max(1, Number(moveSeconds) || GAMES.duel.moveSeconds) * 1000,
        done: false, outcome: null, message: null, deadline: null, offEnd: () => {}, resolve: () => {},
    };
    try { board.message = await postIn(channel, payloadOf(board)); } catch (error) {
        logger.warn(`[GAMES] Could not post a board: ${error?.code || error?.message || error}`);
        return { winner: null, loser: null, reason: 'send', board };
    }
    if (session.ended) {
        board.done = true;
        board.outcome = { winner: null, loser: null, reason: session.endReason };
        editBoard(board);
        return { winner: null, loser: null, reason: session.endReason, board };
    }
    return new Promise((resolve) => {
        board.resolve = resolve;
        boards.set(board.id, board);
        board.offEnd = session.onEnd((reason) => finish(board, { winner: null, reason }));
        armDeadline(board);
    });
}

/** A press on `g:duel:<boardId>:<move>` (or the board's select, `move` = its value). Never throws. */
export async function handleDuelPress(interaction, [boardId, move] = []) {
    try {
        const board = boards.get(String(boardId || ''));
        if (!board || board.done) {
            await privately(interaction, say(board?.lang ?? buttonLanguage(interaction)).ended);
            // A board from before a restart: its buttons go away so nobody else presses them.
            if (!board) await Promise.resolve().then(() => interaction.message?.edit?.({ components: [] })).catch(() => {});
            return;
        }
        const text = say(board.lang);
        const userId = String(interaction.user?.id || '');
        const index = board.players.indexOf(userId);
        if (index === -1 || interaction.user?.bot) return privately(interaction, text.notPlayer);
        if (!board.simultaneous && index !== board.turn) return privately(interaction, text.notTurn);
        const result = board.rules.move(board, index, String(move ?? '')) || {};
        if (result.error) return privately(interaction, result.error);
        if (result.over) {
            if (result.private) await privately(interaction, result.private);
            return finish(board, result.over, result.private ? null : interaction);
        }
        if (result.next !== false) {
            if (!board.simultaneous) board.turn = 1 - board.turn;
            armDeadline(board);
        }
        if (result.private) {
            await privately(interaction, result.private);
            await editBoard(board);
            return;
        }
        await updatePress(interaction, board);
    } catch (error) {
        logger.warn(`[GAMES] A board press failed: ${error?.message || error}`);
        await privately(interaction, say(buttonLanguage(interaction)).ended);
    }
}

/** A pick in a board's select (`g:duel:<boardId>:<name>`): the picked value is the move. */
export const handleDuelSelect = (interaction, [boardId] = []) => handleDuelPress(interaction, [boardId, interaction.values?.[0]]);

/**
 * Shows how a board ended: a winner is paid once (GAMES.duel.winKind) and announced as a reply to the board with
 * play-again; a draw or a game nobody played gets its line with play-again. Resolves { reward } (null without a
 * winner). A cancelled board (the session ended, no board posted) shows nothing.
 */
export async function finishDuel(ctx, outcome) {
    if (!outcome || !END_REASONS.includes(outcome.reason)) return { reward: null };
    if (outcome.winner) {
        const reward = await ctx.rewardWin(outcome.winner, GAMES.duel.winKind);
        // The head is always "won the game" (announceWin 'group' only picks that line); the pay part follows the
        // reward itself: the CC paid, or the daily-limit notice once the cap is reached (winKind 'answer').
        await ctx.announceWin({ winner: { id: outcome.winner }, message: outcome.board?.message ?? null }, reward, 'group');
        return { reward };
    }
    const lang = ctx.lang === 'en' ? 'en' : 'ar';
    const line = outcome.reason === 'idle' ? say(lang).idle : say(lang).draw;
    try {
        const sent = await postIn(ctx.channel, ctx.game?.id ? withAgain({ content: line }, ctx.game.id, lang) : line);
        if (sent && ctx.game?.id) armAgain(sent, { gameId: ctx.game.id, lang, channelId: ctx.channelId, clock: ctx.session?.clock });
    } catch (error) {
        logger.warn(`[GAMES] Could not post a draw: ${error?.code || error?.message || error}`);
    }
    return { reward: null };
}

/** The whole dual game: the challenge lobby, the board, the result. Resolves the board's outcome (null: no opponent). */
export async function runDuel(ctx, { title, description = '', rules, moveSeconds } = {}) {
    const players = await findOpponent(ctx, { title, description });
    if (!players || ctx.session?.ended) return null;
    const outcome = await playBoard(ctx, { players, rules: typeof rules === 'function' ? rules(players) : rules, moveSeconds });
    const { reward } = await finishDuel(ctx, outcome);
    return { ...outcome, reward };
}

/** For tests: forgets every board. */
export function forgetBoards() {
    for (const board of boards.values()) board.session.clearTimeout(board.deadline);
    boards.clear();
}

// rps.js — `حجره` / `rps`: rock, paper, scissors for two, best of 3 (kind 'dual', engine/duel.js). The challenger
// opens the challenge, the first member to join plays against them. Each round both players pick at the same
// time with the board's buttons (`g:duel:<boardId>:<rock|paper|scissors>`): a pick is answered privately (an
// ephemeral reply) and the board only shows THAT a player picked, never what, until both have; then the round is
// shown and the next one starts. GAMES.duel.rpsWins round wins take the match; a tied round is played again, at
// most GAMES.duel.rpsMaxRounds rounds (then the higher score wins, or it is a draw). Each round has
// GAMES.duel.moveSeconds: a player who has not picked when it runs out loses (nobody picked: nobody wins).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GAMES } from '../../config/games.js';
import { duelCustomId, runDuel, statusLine } from '../engine/duel.js';

export const HANDS = ['rock', 'paper', 'scissors'];
const EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };
// What each hand beats.
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const TEXT = {
    ar: {
        title: '🪨📄✂️ حجره ورقة مقص',
        rules: `🔒 كل واحد بيختار في السر، والأول اللي يكسب ${GAMES.duel.rpsWins} جولات يكسب.`,
        names: { rock: 'حجره', paper: 'ورقة', scissors: 'مقص' },
        picked: (hand) => `🔒 اخترت ${EMOJI[hand]}، استنى التاني.`,
        already: '🔒 انت اخترت خلاص في الجولة دي.',
        invalid: '❌ اختار حجره أو ورقة أو مقص.',
        round: (n) => `🔁 الجولة ${n}`,
        ready: '✅ اختار',
        waiting: '⏳ لسه',
        score: (a, b, sa, sb) => `<@${a}> **${sa}** - **${sb}** <@${b}>`,
        result: (n, a, b, winner) => `${n}. ${EMOJI[a]} ・ ${EMOJI[b]} → ${winner === null ? 'تعادل' : `<@${winner}>`}`,
        revealed: (line) => `🔓 ${line}`,
    },
    en: {
        title: '🪨📄✂️ Rock paper scissors',
        rules: `🔒 Each player picks in secret; first to win ${GAMES.duel.rpsWins} rounds wins.`,
        names: { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' },
        picked: (hand) => `🔒 You picked ${EMOJI[hand]}, wait for the other player.`,
        already: '🔒 You already picked this round.',
        invalid: '❌ Pick rock, paper or scissors.',
        round: (n) => `🔁 Round ${n}`,
        ready: '✅ picked',
        waiting: '⏳ not yet',
        score: (a, b, sa, sb) => `<@${a}> **${sa}** - **${sb}** <@${b}>`,
        result: (n, a, b, winner) => `${n}. ${EMOJI[a]} ・ ${EMOJI[b]} → ${winner === null ? 'draw' : `<@${winner}>`}`,
        revealed: (line) => `🔓 ${line}`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

/** The winner of one round: 0 (hand `a` wins), 1 (hand `b` wins) or null (a tie). */
export function rpsRound(a, b) {
    if (a === b) return null;
    return BEATS[a] === b ? 0 : 1;
}

/** The rules of one rock-paper-scissors match (engine/duel.js playBoard). */
export function rpsRules(ctx, { wins = GAMES.duel.rpsWins, maxRounds = GAMES.duel.rpsMaxRounds } = {}) {
    const text = textOf(ctx.lang);
    const lineOf = (board, entry, n) => text.result(n, entry.hands[0], entry.hands[1], entry.winner === null ? null : board.players[entry.winner]);
    return {
        simultaneous: true,
        state: { picks: [null, null], score: [0, 0], rounds: [] },
        move(board, index, move) {
            const { state } = board;
            if (!HANDS.includes(move)) return { error: text.invalid };
            if (state.picks[index] !== null) return { error: text.already };
            state.picks[index] = move;
            if (state.picks[1 - index] === null) return { private: text.picked(move), next: false };
            const hands = [...state.picks];
            const winner = rpsRound(hands[0], hands[1]);
            state.rounds.push({ hands, winner });
            state.picks = [null, null];
            if (winner !== null) state.score[winner] += 1;
            const shown = text.revealed(lineOf(board, state.rounds.at(-1), state.rounds.length));
            if (winner !== null && state.score[winner] >= wins) return { private: shown, over: { winner, reason: 'win' } };
            if (state.rounds.length >= maxRounds) {
                const [a, b] = state.score;
                return { private: shown, over: a === b ? { winner: null, reason: 'draw' } : { winner: a > b ? 0 : 1, reason: 'win' } };
            }
            return { private: shown, next: true };
        },
        timeout(board) {
            const missing = [0, 1].filter((index) => board.state.picks[index] === null);
            if (missing.length === 2) return { winner: null, reason: 'idle' };
            return { winner: 1 - missing[0], reason: 'forfeit' };
        },
        render(board) {
            const { state, players } = board;
            const picks = board.done ? [] : players.map((id, index) => `<@${id}>: ${state.picks[index] === null ? text.waiting : text.ready}`);
            const lines = [
                text.score(players[0], players[1], state.score[0], state.score[1]),
                ...state.rounds.slice(-maxRounds).map((entry, n) => lineOf(board, entry, n + 1)),
                ...(board.done ? [] : ['', text.round(state.rounds.length + 1), ...picks]),
            ];
            const buttons = HANDS.map((hand) => new ButtonBuilder().setCustomId(duelCustomId(board.id, hand)).setEmoji(EMOJI[hand])
                .setLabel(text.names[hand]).setStyle(ButtonStyle.Primary).setDisabled(board.done));
            return {
                content: statusLine(board),
                embeds: [ctx.embed(text.title, lines.join('\n'))],
                components: [new ActionRowBuilder().addComponents(buttons)],
            };
        },
    };
}

export default {
    id: 'rps',
    kind: 'dual',
    names: { ar: ['حجره'], en: ['rps'] },
    description: { ar: 'حجره ورقة مقص بين اتنين، أحسن من 3', en: 'rock paper scissors for two, best of 3' },
    async run(ctx) {
        const text = textOf(ctx.lang);
        await runDuel(ctx, { title: text.title, description: text.rules, rules: rpsRules(ctx) });
    },
};

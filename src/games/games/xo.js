// xo.js — `xo` / `اكس`: tic-tac-toe for two (kind 'dual', engine/duel.js). The challenger opens the challenge, the
// first member to join plays against them; the board is a 3x3 grid of buttons (`g:duel:<boardId>:<cell 0-8>`),
// the challenger is ❌ and moves first, each move has GAMES.duel.moveSeconds (the player whose time runs out
// loses), three in a row wins and a full board is a draw.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { duelCustomId, runDuel, statusLine } from '../engine/duel.js';
import { isRedesignEnabled } from '../ui/theme.js';

export const MARKS = ['❌', '⭕'];
const EMPTY = '➖';
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

const TEXT = {
    ar: {
        title: '❌⭕ اكس او',
        rules: '❌ صاحب التحدي بيبدأ، وأول واحد يعمل 3 في صف يكسب.',
        taken: '❌ المربع ده متاخد، اختار غيره.',
        players: (a, b) => `❌ <@${a}> ・ ⭕ <@${b}>`,
    },
    en: {
        title: '❌⭕ Tic-tac-toe',
        rules: '❌ The challenger starts; three in a row wins.',
        taken: '❌ That square is taken, pick another.',
        players: (a, b) => `❌ <@${a}> ・ ⭕ <@${b}>`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

/** The mark (0 or 1) that has three in a row on `cells` (9 entries of 0, 1 or null), else null. */
export function xoWinner(cells) {
    for (const [a, b, c] of LINES) if (cells[a] !== null && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
    return null;
}

/** The 3 winning cell indices on `cells`, or null. */
export function xoWinningLine(cells) {
    for (const line of LINES) {
        const [a, b, c] = line;
        if (cells[a] !== null && cells[a] === cells[b] && cells[a] === cells[c]) return line;
    }
    return null;
}

/** The rules of one xo board (engine/duel.js playBoard). */
export function xoRules(ctx) {
    const text = textOf(ctx.lang);
    const redesign = isRedesignEnabled(ctx?.guildId);
    return {
        state: { cells: Array(9).fill(null) },
        move(board, index, move) {
            const cell = Number(move);
            if (!/^[0-8]$/u.test(move)) return { error: text.taken };
            if (board.state.cells[cell] !== null) return { error: text.taken };
            board.state.cells[cell] = index;
            if (xoWinner(board.state.cells) === index) return { over: { winner: index, reason: 'win' } };
            if (board.state.cells.every((value) => value !== null)) return { over: { winner: null, reason: 'draw' } };
            return { next: true };
        },
        render(board) {
            const winningLine = redesign && board.done ? xoWinningLine(board.state.cells) : null;
            const rows = [0, 1, 2].map((row) => new ActionRowBuilder().addComponents([0, 1, 2].map((col) => {
                const cell = row * 3 + col;
                const value = board.state.cells[cell];
                const isWinningCell = winningLine ? winningLine.includes(cell) : false;
                const style = isWinningCell
                    ? ButtonStyle.Success
                    : value === 0 ? ButtonStyle.Danger : value === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary;
                return new ButtonBuilder().setCustomId(duelCustomId(board.id, cell)).setEmoji(value === null ? EMPTY : MARKS[value])
                    .setStyle(style)
                    .setDisabled(board.done || value !== null);
            })));
            return {
                content: statusLine(board),
                embeds: [ctx.embed(text.title, text.players(board.players[0], board.players[1]))],
                components: rows,
            };
        },
    };
}

export default {
    id: 'xo',
    kind: 'dual',
    names: { ar: ['اكس'], en: ['xo', 'tictactoe'] },
    description: { ar: 'اكس او بين اتنين بالزراير', en: 'tic-tac-toe for two, with buttons' },
    async run(ctx) {
        const text = textOf(ctx.lang);
        await runDuel(ctx, { title: text.title, description: text.rules, rules: xoRules(ctx) });
    },
};

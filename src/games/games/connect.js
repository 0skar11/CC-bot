// connect.js — `توصيل` / `connect`: connect four for two (kind 'dual', engine/duel.js). The challenger opens the
// challenge, the first member to join plays against them; the board (6 rows, 7 columns) is an emoji grid in the
// message, and a disc is dropped with a column button (`g:duel:<boardId>:<column 0-6>`, two rows: 1-4 and 5-7) or
// the column select (`g:duel:<boardId>:col`, the column as its value). The challenger is 🔴 and moves first, each
// move has GAMES.duel.moveSeconds (the player whose time runs out loses), four in a row (across, down or
// diagonal) wins and a full board is a draw.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { duelCustomId, runDuel, statusLine } from '../engine/duel.js';

export const ROWS = 6;
export const COLS = 7;
export const DISCS = ['🔴', '🟡'];
const EMPTY = '⚪';
// The keycap digits 1-7 (digit, U+FE0F, U+20E3), built from code points so no invisible character is in the source.
export const NUMBERS = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n}${String.fromCharCode(0xfe0f, 0x20e3)}`);

const TEXT = {
    ar: {
        title: '🔴🟡 توصيل 4',
        rules: '🔴 صاحب التحدي بيبدأ، وأول واحد يوصّل 4 في صف (عرض أو طول أو مايل) يكسب.',
        full: '❌ العمود ده مليان، اختار غيره.',
        pick: '⬇️ اختار العمود',
        column: (n) => `العمود ${n}`,
        players: (a, b) => `🔴 <@${a}> ・ 🟡 <@${b}>`,
    },
    en: {
        title: '🔴🟡 Connect four',
        rules: '🔴 The challenger starts; four in a row (across, down or diagonal) wins.',
        full: '❌ That column is full, pick another.',
        pick: '⬇️ Pick a column',
        column: (n) => `Column ${n}`,
        players: (a, b) => `🔴 <@${a}> ・ 🟡 <@${b}>`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

/** An empty grid: ROWS rows (top first) of COLS cells, each 0, 1 or null. */
export const emptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

/** Drops a disc of `player` in `col`; returns the row it landed on, or -1 when the column is full (or not one). */
export function dropDisc(grid, col, player) {
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return -1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
        if (grid[row][col] === null) {
            grid[row][col] = player;
            return row;
        }
    }
    return -1;
}

/** True when the disc at (row, col) is part of four in a row. */
export function connectsFour(grid, row, col) {
    const player = grid[row]?.[col];
    if (player === null || player === undefined) return false;
    const count = (dr, dc) => {
        let n = 0;
        for (let r = row + dr, c = col + dc; grid[r]?.[c] === player; r += dr, c += dc) n += 1;
        return n;
    };
    return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => 1 + count(dr, dc) + count(-dr, -dc) >= 4);
}

/** The columns that still take a disc. */
export const openColumns = (grid) => [...Array(COLS).keys()].filter((col) => grid[0][col] === null);

/** The grid as emoji lines, the column numbers on top. */
export const gridText = (grid) => [NUMBERS.join(''), ...grid.map((row) => row.map((cell) => (cell === null ? EMPTY : DISCS[cell])).join(''))].join('\n');

/** The rules of one connect-four board (engine/duel.js playBoard). */
export function connectRules(ctx) {
    const text = textOf(ctx.lang);
    return {
        state: { grid: emptyGrid() },
        move(board, index, move) {
            const col = /^[0-6]$/u.test(move) ? Number(move) : -1;
            const row = dropDisc(board.state.grid, col, index);
            if (row === -1) return { error: text.full };
            if (connectsFour(board.state.grid, row, col)) return { over: { winner: index, reason: 'win' } };
            if (!openColumns(board.state.grid).length) return { over: { winner: null, reason: 'draw' } };
            return { next: true };
        },
        render(board) {
            const open = new Set(openColumns(board.state.grid));
            const button = (col) => new ButtonBuilder().setCustomId(duelCustomId(board.id, col)).setEmoji(NUMBERS[col])
                .setStyle(ButtonStyle.Secondary).setDisabled(board.done || !open.has(col));
            const components = [
                new ActionRowBuilder().addComponents([0, 1, 2, 3].map(button)),
                new ActionRowBuilder().addComponents([4, 5, 6].map(button)),
            ];
            if (!board.done && open.size) {
                components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                    .setCustomId(duelCustomId(board.id, 'col')).setPlaceholder(text.pick)
                    .addOptions([...open].map((col) => new StringSelectMenuOptionBuilder().setValue(String(col)).setLabel(text.column(col + 1)).setEmoji(NUMBERS[col])))));
            }
            return {
                content: statusLine(board),
                embeds: [ctx.embed(text.title, `${text.players(board.players[0], board.players[1])}\n\n${gridText(board.state.grid)}`)],
                components,
            };
        },
    };
}

export default {
    id: 'connect',
    kind: 'dual',
    names: { ar: ['توصيل'], en: ['connect', 'connectfour'] },
    description: { ar: 'توصيل 4 بين اتنين بالزراير', en: 'connect four for two, with buttons' },
    async run(ctx) {
        const text = textOf(ctx.lang);
        await runDuel(ctx, { title: text.title, description: text.rules, rules: connectRules(ctx) });
    },
};

// snake.js — `ثعبان` / `snake`: classic snake game on a 5x5 emoji grid (kind 'single').
// Move using arrow buttons ⬆️ ⬇️ ⬅️ ➡️ to eat 5 apples without crashing into walls or yourself.
// Pays 500 CC + 1 point on victory (capped).

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';

const GRID_SIZE = 5;
const TARGET_APPLES = 5;

const TEXT = {
    ar: {
        title: '🐍 لعبة الثعبان',
        how: (apples) => `تحكم بالثعبان واجمع **${apples}** تفاحات للفوز بالجائزة! انتبه من الجدران وجسمك.`,
        score: (n, target) => `🍎 التفاح: **${n}/${target}**`,
        lostWall: '💥 **خبطت في الجدار!** خسرت اللعبة.',
        lostSelf: '💥 **خبطت في نفسك!** خسرت اللعبة.',
        won: `🎉 **مبروك! جمعت ${TARGET_APPLES} تفاحات وفزت باللعبة!**`,
        timeout: '⌛ انتهى وقت الحركة بسبب عدم النشاط.',
        notYourGame: '❌ اللعبة دي لصاحب الأمر فقط!',
        ended: '⌛ اللعبة دي خلصت.',
    },
    en: {
        title: '🐍 Snake Game',
        how: (apples) => `Control the snake and eat **${apples}** apples to win! Avoid walls and yourself.`,
        score: (n, target) => `🍎 Apples: **${n}/${target}**`,
        lostWall: '💥 **Hit the wall!** Game over.',
        lostSelf: '💥 **Ran into yourself!** Game over.',
        won: `🎉 **Congratulations! You collected ${TARGET_APPLES} apples and won!**`,
        timeout: '⌛ Game ended due to inactivity.',
        notYourGame: '❌ This game is only for the person who started it!',
        ended: '⌛ This game has ended.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const activeSnakeGames = new Map();

function spawnApple(snake) {
    const occupied = new Set(snake.map(([r, c]) => `${r},${c}`));
    const free = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
        for (let c = 0; c < GRID_SIZE; c += 1) {
            if (!occupied.has(`${r},${c}`)) free.push([r, c]);
        }
    }
    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)];
}

function renderBoard(snake, apple) {
    const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill('⬛'));
    if (apple) {
        grid[apple[0]][apple[1]] = '🍎';
    }
    // Body
    for (let i = 1; i < snake.length; i += 1) {
        grid[snake[i][0]][snake[i][1]] = '🟩';
    }
    // Head
    if (snake.length > 0) {
        grid[snake[0][0]][snake[0][1]] = '🟢';
    }
    return grid.map((row) => row.join('')).join('\n');
}

function buildControls(gameId, disabled = false) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${GAMES_BUTTON_PREFIX}:snake:${gameId}:left`).setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${GAMES_BUTTON_PREFIX}:snake:${gameId}:up`).setEmoji('⬆️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${GAMES_BUTTON_PREFIX}:snake:${gameId}:down`).setEmoji('⬇️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${GAMES_BUTTON_PREFIX}:snake:${gameId}:right`).setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    );
    return [row];
}

const DIRECTIONS = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1],
};

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

export async function handleSnakeButton(interaction, [gameId, dir] = []) {
    const game = activeSnakeGames.get(String(gameId || ''));
    const lang = game?.lang || 'ar';
    const text = textOf(lang);

    if (!game || game.done) return privately(interaction, text.ended);
    if (interaction.user?.id !== game.playerId) return privately(interaction, text.notYourGame);

    const delta = DIRECTIONS[dir];
    if (!delta) return privately(interaction, text.ended);

    const [headR, headC] = game.snake[0];
    const newHead = [headR + delta[0], headC + delta[1]];

    // Wall collision
    if (newHead[0] < 0 || newHead[0] >= GRID_SIZE || newHead[1] < 0 || newHead[1] >= GRID_SIZE) {
        game.done = true;
        game.outcome = 'wall';
        await interaction.update({
            embeds: [game.embed(`${text.lostWall}\n\n${renderBoard(game.snake, game.apple)}\n\n${text.score(game.apples, TARGET_APPLES)}`)],
            components: buildControls(gameId, true),
        }).catch(() => {});
        game.resolve?.('lost');
        return;
    }

    // Self collision
    if (game.snake.some(([r, c]) => r === newHead[0] && c === newHead[1])) {
        game.done = true;
        game.outcome = 'self';
        await interaction.update({
            embeds: [game.embed(`${text.lostSelf}\n\n${renderBoard(game.snake, game.apple)}\n\n${text.score(game.apples, TARGET_APPLES)}`)],
            components: buildControls(gameId, true),
        }).catch(() => {});
        game.resolve?.('lost');
        return;
    }

    // Move snake
    game.snake.unshift(newHead);
    if (game.apple && newHead[0] === game.apple[0] && newHead[1] === game.apple[1]) {
        game.apples += 1;
        if (game.apples >= TARGET_APPLES) {
            game.done = true;
            game.outcome = 'won';
            await interaction.update({
                embeds: [game.embed(`${text.won}\n\n${renderBoard(game.snake, null)}\n\n${text.score(game.apples, TARGET_APPLES)}`)],
                components: buildControls(gameId, true),
            }).catch(() => {});
            game.resolve?.('won');
            return;
        }
        game.apple = spawnApple(game.snake);
    } else {
        game.snake.pop();
    }

    // Refresh display
    await interaction.update({
        embeds: [game.embed(`${text.how(TARGET_APPLES)}\n\n${renderBoard(game.snake, game.apple)}\n\n${text.score(game.apples, TARGET_APPLES)}`)],
        components: buildControls(gameId, false),
    }).catch(() => {});
}

export default {
    id: 'snake',
    kind: 'single',
    names: { ar: ['ثعبان'], en: ['snake'] },
    description: {
        ar: 'لعبة الثعبان: اتحكم بالأسهم واجمع 5 تفاحات من غير ما تخبط',
        en: 'snake game: move with arrows to eat 5 apples without crashing',
    },
    async run(ctx) {
        const text = textOf(ctx.lang);
        const gameId = randomBytes(4).toString('hex');
        const initialSnake = [[2, 2], [2, 1]];
        const initialApple = spawnApple(initialSnake);

        const game = {
            gameId,
            playerId: ctx.starter.id,
            lang: ctx.lang,
            snake: initialSnake,
            apple: initialApple,
            apples: 0,
            done: false,
            outcome: null,
            embed: (desc) => ctx.embed(text.title, desc),
        };
        activeSnakeGames.set(gameId, game);
        ctx.session.onEnd(() => {
            game.done = true;
            game.resolve?.('ended');
            activeSnakeGames.delete(gameId);
        });

        const boardDesc = [
            text.how(TARGET_APPLES),
            '',
            renderBoard(game.snake, game.apple),
            '',
            text.score(0, TARGET_APPLES),
        ].join('\n');

        const message = await ctx.channel.send({
            embeds: [ctx.embed(text.title, boardDesc)],
            components: buildControls(gameId, false),
        }).catch(() => null);

        if (!message) {
            activeSnakeGames.delete(gameId);
            return;
        }

        const outcome = await new Promise((resolve) => {
            if (ctx.session?.ended) return resolve('ended');
            game.resolve = resolve;
            const off = ctx.session.onEnd(() => resolve('ended'));
            const h = ctx.session.setTimeout(() => {
                if (!game.done) {
                    game.done = true;
                    message.edit({ components: buildControls(gameId, true) }).catch(() => {});
                    off();
                    resolve('timeout');
                }
            }, 45_000);
            if (!h) { off(); resolve('ended'); }
        });

        activeSnakeGames.delete(gameId);

        if (outcome === 'won' && !ctx.session.ended) {
            const reward = await ctx.rewardWin(ctx.starter.id, 'answer');
            await ctx.announceWin({ winner: { id: ctx.starter.id }, message }, reward, 'answer');
        }
    },
};

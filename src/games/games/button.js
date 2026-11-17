// button.js — `زر` / `button`: reaction speed game (kind 'single').
// Waits a random delay, then a green button appears. First player to click it wins 500 CC + 1 point.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';

const TEXT = {
    ar: {
        title: '⚡ تحدي سرعة رد الفعل',
        ready: '⏳ **خليك جاهز... الزرار هيظهر في أي لحظة!**\nأول واحد يدوس عليه هيكسب الجائزة.',
        clickNow: '🎯 **اضغط هنا بسرعة!!**',
        btnLabel: 'اضغط هنا! ⚡',
        won: (id, ms) => `🎉 <@${id}> داس على الزرار أول واحد في **${ms}** ملي ثانية وكسب!`,
        timeout: '⌛ محدش داس على الزرار في الوقت المحدد.',
        ended: '⌛ اللعبة دي خلصت.',
    },
    en: {
        title: '⚡ Reaction Speed Challenge',
        ready: '⏳ **Get ready... the button will appear at any second!**\nFirst one to click wins the reward.',
        clickNow: '🎯 **CLICK HERE FAST!!**',
        btnLabel: 'Click Here! ⚡',
        won: (id, ms) => `🎉 <@${id}> clicked the button first in **${ms}ms** and won!`,
        timeout: '⌛ Nobody clicked the button in time.',
        ended: '⌛ This game has ended.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const activeButtons = new Map();

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

export async function handleReactionButton(interaction, [gameId] = []) {
    const game = activeButtons.get(String(gameId || ''));
    const lang = game?.lang || 'ar';
    const text = textOf(lang);

    if (!game || game.done) return privately(interaction, text.ended);
    const userId = interaction.user?.id;
    if (!userId || interaction.user.bot) return;

    game.done = true;
    game.winnerId = userId;
    const elapsed = Date.now() - game.appearedAt;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${GAMES_BUTTON_PREFIX}:btn:${gameId}`)
            .setLabel(text.btnLabel)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
    );

    await Promise.resolve()
        .then(() => interaction.update({
            embeds: [game.embed(text.won(userId, elapsed))],
            components: [row],
        }))
        .catch(() => {});

    game.resolve?.({ winnerId: userId, elapsed });
}

export default {
    id: 'button',
    kind: 'single',
    names: { ar: ['زر'], en: ['button'] },
    description: {
        ar: 'سرعة رد الفعل: خليك جاهز وأول واحد يدوس على الزرار يكسب',
        en: 'reaction speed: get ready, first to click the button wins',
    },
    async run(ctx) {
        const text = textOf(ctx.lang);
        const gameId = randomBytes(4).toString('hex');

        const message = await ctx.channel.send({
            embeds: [ctx.embed(text.title, text.ready)],
        }).catch(() => null);

        if (!message) return;

        // Random suspense delay (2.5 to 6 seconds)
        const delayMs = 2500 + Math.floor(ctx.random() * 3500);
        await new Promise((resolve) => {
            if (ctx.session?.ended) return resolve();
            const off = ctx.session.onEnd(resolve);
            const h = ctx.session.setTimeout(() => {
                off();
                resolve();
            }, delayMs);
            if (!h) {
                off();
                resolve();
            }
        });

        if (ctx.session.ended) return;

        const game = {
            gameId,
            lang: ctx.lang,
            appearedAt: Date.now(),
            done: false,
            winnerId: null,
            embed: (desc) => ctx.embed(text.title, desc),
        };
        activeButtons.set(gameId, game);
        ctx.session.onEnd(() => {
            game.done = true;
            game.resolve?.(null);
            activeButtons.delete(gameId);
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:btn:${gameId}`)
                .setLabel(text.btnLabel)
                .setStyle(ButtonStyle.Success),
        );

        await message.edit({
            embeds: [ctx.embed(text.title, text.clickNow)],
            components: [row],
        }).catch(() => {});

        const result = await new Promise((resolve) => {
            if (ctx.session?.ended) return resolve(null);
            game.resolve = resolve;
            const h = ctx.session.setTimeout(() => {
                if (!game.done) {
                    game.done = true;
                    row.components[0].setDisabled(true);
                    message.edit({
                        embeds: [ctx.embed(text.title, text.timeout)],
                        components: [row],
                    }).catch(() => {});
                    resolve(null);
                }
            }, 15_000);
            if (!h) resolve(null);
        });

        activeButtons.delete(gameId);

        if (result?.winnerId && !ctx.session.ended) {
            const reward = await ctx.rewardWin(result.winnerId, 'answer');
            await ctx.announceWin({ winner: { id: result.winnerId }, message }, reward, 'answer');
        }
    },
};

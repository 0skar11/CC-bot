// hideAndSeek.js — `غميضة` / `hide`: hide and seek group game (kind 'group', engine/lobby.js).
// 1 Seeker chosen from lobby; other players hide in 1 of 5 spots using ephemeral buttons.
// Seeker chooses a spot to search. Caught hiders are eliminated.
// If Seeker finds everyone in 3 rounds, Seeker wins. If hiders survive, a surviving hider wins.
// Reward: 2,000 CC and 5 points.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';

const SPOTS = [
    { id: 'tree', emoji: '🌳', ar: 'الشجرة', en: 'Tree' },
    { id: 'box', emoji: '📦', ar: 'الصندوق', en: 'Box' },
    { id: 'closet', emoji: '🚪', ar: 'الدولاب', en: 'Closet' },
    { id: 'car', emoji: '🚗', ar: 'العربية', en: 'Car' },
    { id: 'tent', emoji: '⛺', ar: 'الخيمة', en: 'Tent' },
];

const TEXT = {
    ar: {
        title: '🙈 لعبة الغميضة (استغماية)',
        rules: '🔍 واحد بيبحث والباقي بيستخبوا في 5 أماكن سرية! الباحث ليه 3 محاولات يقفشهم.',
        seekerChosen: (id) => `👑 <@${id}> هو **الباحث**! الباقيين عندهم 15 ثانية يستخبوا!`,
        hidingPhase: '🤫 **وقت الاختباء!** دوس على الزرار عشان تستخبى في مكان سري:',
        hidingSuccess: (spot) => `✅ استخبيت ورا ${spot.emoji} ${spot.ar}! استنى الباحث لما يفتش.`,
        alreadyHidden: '✅ أنت اخترت مكانك خلاص في الجولة دي.',
        notHider: '❌ أنت مش من المستخبيين في الجولة دي.',
        seekingPhase: (id) => `👀 **دور الباحث!** <@${id}> اختار المكان اللي عايز تفتش فيه:`,
        seekerSearched: (spot) => `🔍 الباحث فتش في: ${spot.emoji} **${spot.ar}**!`,
        caughtList: (list) => `💥 **قفش الحرامية!** تم استبعاد:\n${list.map((id) => `• <@${id}>`).join('\n')}`,
        noneCaught: '💨 **ملقاش حد هناك!** كل اللي استخبوا هناك أذكياء.',
        remainingHiders: (count, list) => `🛡️ المتبقي من المستخبيين (${count}): ${list.map((id) => `<@${id}>`).join(' ، ')}`,
        seekerWins: (id) => `🎉 <@${id}> قفش كل المستخبيين وفاز باللعبة!`,
        hidersWin: (id) => `🎉 <@${id}> استخبى بذكاء وعدى كل الجولات وفاز باللعبة!`,
        ended: '⌛ اللعبة دي خلصت.',
    },
    en: {
        title: '🙈 Hide and Seek',
        rules: '🔍 1 seeker searches and others hide in 5 secret spots! Seeker has 3 rounds to catch them all.',
        seekerChosen: (id) => `👑 <@${id}> is the **Seeker**! Others have 15s to hide!`,
        hidingPhase: '🤫 **Hiding Phase!** Press a button to hide in a secret spot:',
        hidingSuccess: (spot) => `✅ You hid at ${spot.emoji} ${spot.en}! Wait for seeker to search.`,
        alreadyHidden: '✅ You already chose your hiding spot this round.',
        notHider: "❌ You are not a hider in this round.",
        seekingPhase: (id) => `👀 **Seeker's Turn!** <@${id}> pick a spot to search:`,
        seekerSearched: (spot) => `🔍 Seeker searched: ${spot.emoji} **${spot.en}**!`,
        caughtList: (list) => `💥 **Caught!** Eliminated:\n${list.map((id) => `• <@${id}>`).join('\n')}`,
        noneCaught: '💨 **Nobody was there!** They got away safely.',
        remainingHiders: (count, list) => `🛡️ Remaining hiders (${count}): ${list.map((id) => `<@${id}>`).join(', ')}`,
        seekerWins: (id) => `🎉 <@${id}> caught all hiders and won the game!`,
        hidersWin: (id) => `🎉 <@${id}> survived all rounds and won the game!`,
        ended: '⌛ This game has ended.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const activeHideGames = new Map();

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

function buildSpotButtons(gameId, action, lang, disabled = false) {
    const row = new ActionRowBuilder();
    for (const spot of SPOTS) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:hide:${action}:${gameId}:${spot.id}`)
                .setEmoji(spot.emoji)
                .setLabel(lang === 'en' ? spot.en : spot.ar)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
        );
    }
    return [row];
}

export async function handleHideButton(interaction, [action, gameId, spotId] = []) {
    const game = activeHideGames.get(String(gameId || ''));
    const lang = game?.lang || 'ar';
    const text = textOf(lang);

    if (!game || game.done) return privately(interaction, text.ended);
    const userId = interaction.user?.id;
    if (!userId || interaction.user.bot) return;

    const spot = SPOTS.find((s) => s.id === spotId);
    if (!spot) return privately(interaction, text.ended);

    if (action === 'hide') {
        if (!game.hiders.includes(userId)) return privately(interaction, text.notHider);
        if (game.hiddenSpots.has(userId)) return privately(interaction, text.alreadyHidden);

        game.hiddenSpots.set(userId, spot.id);
        await privately(interaction, text.hidingSuccess(spot));

        if (game.hiddenSpots.size >= game.hiders.length) {
            game.resolveHide?.('all_hidden');
        }
    } else if (action === 'seek') {
        if (userId !== game.seekerId) return privately(interaction, '❌ دور الباحث فقط!');
        game.searchSpot = spot.id;
        await Promise.resolve()
            .then(() => interaction.update({ components: buildSpotButtons(gameId, 'seek', lang, true) }))
            .catch(() => {});
        game.resolveSeek?.('searched');
    }
}

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

export default {
    id: 'hide',
    kind: 'group',
    names: { ar: ['غميضة'], en: ['hide'] },
    description: {
        ar: 'استغماية: واحد بيبحث والباقي بيستخبوا في أماكن مختلفة',
        en: 'hide and seek: one seeker searches and others hide in different spots',
    },
    minPlayers: 2,
    maxPlayers: 15,
    async run(ctx) {
        const text = textOf(ctx.lang);
        const lobby = await ctx.openLobby({
            title: text.title,
            description: text.rules,
            min: 2,
            max: 15,
        });
        if (lobby.cancelled || ctx.session.ended) return;

        const players = [...lobby.players];
        const seekerIdx = Math.floor(ctx.random() * players.length);
        const seekerId = players[seekerIdx];
        let hiders = players.filter((id) => id !== seekerId);

        await ctx.send({
            embeds: [ctx.embed(text.title, text.seekerChosen(seekerId))],
        });
        await delay(ctx, 2000);

        const gameId = randomBytes(4).toString('hex');
        const game = {
            gameId,
            lang: ctx.lang,
            seekerId,
            hiders,
            hiddenSpots: new Map(),
            searchSpot: null,
            done: false,
        };
        activeHideGames.set(gameId, game);

        const MAX_ROUNDS = 3;
        let winnerId = null;

        for (let round = 1; round <= MAX_ROUNDS && hiders.length > 0 && !ctx.session.ended; round += 1) {
            game.hiddenSpots.clear();
            game.searchSpot = null;
            game.hiders = [...hiders];

            // 1. Hiding phase
            const hideMsg = await ctx.channel.send({
                embeds: [ctx.embed(text.title, `${text.hidingPhase} (الجولة ${round}/${MAX_ROUNDS})`)],
                components: buildSpotButtons(gameId, 'hide', ctx.lang),
            }).catch(() => null);

            await new Promise((resolve) => {
                if (ctx.session?.ended) return resolve('timeout');
                game.resolveHide = resolve;
                const off = ctx.session.onEnd(() => resolve('timeout'));
                const h = ctx.session.setTimeout(() => {
                    off();
                    resolve('timeout');
                }, 15_000);
                if (!h) { off(); resolve('timeout'); }
            });

            // Assign random spots to hiders who didn't pick
            for (const hider of hiders) {
                if (!game.hiddenSpots.has(hider)) {
                    const randomSpot = SPOTS[Math.floor(ctx.random() * SPOTS.length)].id;
                    game.hiddenSpots.set(hider, randomSpot);
                }
            }

            if (hideMsg) {
                hideMsg.edit({ components: buildSpotButtons(gameId, 'hide', ctx.lang, true) }).catch(() => {});
            }
            if (ctx.session.ended) break;

            // 2. Seeking phase
            const seekMsg = await ctx.channel.send({
                embeds: [ctx.embed(text.title, text.seekingPhase(seekerId))],
                components: buildSpotButtons(gameId, 'seek', ctx.lang),
            }).catch(() => null);

            await new Promise((resolve) => {
                if (ctx.session?.ended) return resolve('timeout');
                game.resolveSeek = resolve;
                const off = ctx.session.onEnd(() => resolve('timeout'));
                const h = ctx.session.setTimeout(() => {
                    off();
                    resolve('timeout');
                }, 15_000);
                if (!h) { off(); resolve('timeout'); }
            });

            if (!game.searchSpot) {
                game.searchSpot = SPOTS[Math.floor(ctx.random() * SPOTS.length)].id;
            }
            if (seekMsg) {
                seekMsg.edit({ components: buildSpotButtons(gameId, 'seek', ctx.lang, true) }).catch(() => {});
            }

            const searchedSpotObj = SPOTS.find((s) => s.id === game.searchSpot);
            const caught = hiders.filter((id) => game.hiddenSpots.get(id) === game.searchSpot);
            hiders = hiders.filter((id) => !caught.includes(id));

            const outcomeLines = [
                text.seekerSearched(searchedSpotObj),
                '',
                caught.length ? text.caughtList(caught) : text.noneCaught,
                '',
                text.remainingHiders(hiders.length, hiders),
            ].join('\n');

            await ctx.send({
                embeds: [ctx.embed(text.title, outcomeLines)],
            });

            if (hiders.length === 0) {
                winnerId = seekerId;
                break;
            }

            if (round < MAX_ROUNDS) {
                await delay(ctx, 2500);
            }
        }

        game.done = true;
        activeHideGames.delete(gameId);

        if (!winnerId && hiders.length > 0) {
            // Hiders survived! Pick one surviving hider as the grand winner
            const survivorIdx = Math.floor(ctx.random() * hiders.length);
            winnerId = hiders[survivorIdx];
        }

        if (winnerId && !ctx.session.ended) {
            const reward = await ctx.rewardWin(winnerId, 'group');
            await ctx.announceWin({ winner: { id: winnerId }, message: null }, reward, 'group');
        }
    },
};

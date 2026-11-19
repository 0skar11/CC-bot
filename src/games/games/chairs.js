// chairs.js — `كراسي` / `chairs`: musical chairs game (kind 'group', engine/lobby.js).
// Players join the lobby (min 2, max 15). Each round music plays, then stops.
// N-1 chair buttons appear for N players. Fast clickers grab seats; the one left standing is eliminated.
// The last player remaining wins 2,000 CC and 5 points.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';

const TEXT = {
    ar: {
        title: '🪑 لعبة الكراسي الموسيقية',
        rules: '🎵 الموسيقى بتشتغل وبعدين بتقف فجأة، احجز كرسي بسرعة واللي ملوش كرسي بيخرج!',
        musicPlaying: (round) => `🎶 **الموسيقى شغالة... استعدوا!** (الجولة ${round})`,
        musicStopped: '🪑 **الموسيقى وقفت!! احجز كرسي بسرعة!**',
        seatTaken: '✅ قعدت على كرسي بنجاح!',
        alreadySeated: '✅ أنت حجزت كرسي بالفعل!',
        seatTakenByOther: '❌ الكرسي ده اتاخد خلاص! الحق غيره!',
        notInGame: '❌ أنت مش في اللعبة دي.',
        gameEnded: '⌛ الجولة دي خلصت.',
        eliminatedSingle: (id) => `❌ **تم استبعاد <@${id}> لعدم وجود كرسي!**`,
        eliminatedMulti: (ids) => `❌ **تم استبعاد:\n${ids.map((id) => `• <@${id}>`).join('\n')}\nلعدم وجود كراسي!**`,
        remaining: (count, list) => `🛡️ المتأهلين للجولة القادمة (${count}): ${list.map((id) => `<@${id}>`).join(' ، ')}`,
        chairLabel: (index) => `كرسي ${index + 1} 🪑`,
        takenLabel: (tag) => `محجوز (${tag})`,
    },
    en: {
        title: '🪑 Musical Chairs',
        rules: '🎵 Music plays and stops suddenly! Grab a chair fast, the one left out is eliminated!',
        musicPlaying: (round) => `🎶 **Music is playing... get ready!** (Round ${round})`,
        musicStopped: '🪑 **Music stopped!! Grab a chair fast!**',
        seatTaken: '✅ You sat on a chair!',
        alreadySeated: '✅ You already have a chair!',
        seatTakenByOther: '❌ This chair was taken! Find another one!',
        notInGame: "❌ You're not in this game.",
        gameEnded: '⌛ This round has ended.',
        eliminatedSingle: (id) => `❌ **<@${id}> was eliminated (no chair)!**`,
        eliminatedMulti: (ids) => `❌ **Eliminated (no chairs):\n${ids.map((id) => `• <@${id}>`).join('\n')}**`,
        remaining: (count, list) => `🛡️ Moving to next round (${count}): ${list.map((id) => `<@${id}>`).join(', ')}`,
        chairLabel: (index) => `Chair ${index + 1} 🪑`,
        takenLabel: (tag) => `Taken (${tag})`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

// Active chair rounds in memory: roundId -> roundState
const activeRounds = new Map();

function buildChairButtons(roundState) {
    const { roundId, count, seats, lang } = roundState;
    const text = textOf(lang);
    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < count; i += 1) {
        const takenUser = seats.get(i);
        const button = new ButtonBuilder()
            .setCustomId(`${GAMES_BUTTON_PREFIX}:chairs:${roundId}:${i}`)
            .setStyle(takenUser ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setDisabled(Boolean(takenUser || roundState.done));

        if (takenUser) {
            button.setLabel(text.takenLabel(takenUser.tag || 'محجوز')).setEmoji('👤');
        } else {
            button.setLabel(text.chairLabel(i)).setEmoji('🪑');
        }

        currentRow.addComponents(button);
        if (currentRow.components.length === 5 || i === count - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    }
    return rows;
}

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

export async function handleChairsButton(interaction, [roundId, seatStr] = []) {
    const roundState = activeRounds.get(String(roundId || ''));
    const seatIndex = Number.parseInt(seatStr, 10);
    const lang = roundState?.lang || 'ar';
    const text = textOf(lang);

    if (!roundState || roundState.done) {
        return privately(interaction, text.gameEnded);
    }
    const userId = interaction.user?.id;
    if (!userId || interaction.user.bot) return;

    if (!roundState.alive.includes(userId)) {
        return privately(interaction, text.notInGame);
    }
    if (roundState.seatedPlayers.has(userId)) {
        return privately(interaction, text.alreadySeated);
    }
    if (roundState.seats.has(seatIndex)) {
        return privately(interaction, text.seatTakenByOther);
    }

    // Claim seat
    const tag = interaction.user.displayName || interaction.user.username || userId.slice(-4);
    roundState.seats.set(seatIndex, { id: userId, tag });
    roundState.seatedPlayers.add(userId);

    // Update message components
    const components = buildChairButtons(roundState);
    await Promise.resolve()
        .then(() => interaction.update({ components }))
        .catch(() => interaction.message?.edit?.({ components }).catch(() => {}));

    if (roundState.seatedPlayers.size >= roundState.count) {
        roundState.resolve?.('all_seated');
    }
}

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

export default {
    id: 'chairs',
    kind: 'group',
    names: { ar: ['كراسي'], en: ['chairs'] },
    description: {
        ar: 'لعبة الكراسي الموسيقية: الحجز أول بأول واللي ملوش كرسي بيخرج',
        en: 'musical chairs: grab a chair when music stops, last one without a chair is eliminated',
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

        let alive = [...lobby.players];
        let round = 1;

        while (alive.length > 1 && !ctx.session.ended) {
            const chairsCount = alive.length - 1;
            // Phase 1: Music is playing
            await ctx.send({
                embeds: [ctx.embed(text.title, text.musicPlaying(round))],
            });

            // Random delay for music (2 to 4.5 seconds)
            const musicDuration = 2000 + Math.floor(ctx.random() * 2500);
            await delay(ctx, musicDuration);
            if (ctx.session.ended) break;

            // Phase 2: Music stopped! Show chairs
            const roundId = randomBytes(4).toString('hex');
            const roundState = {
                roundId,
                lang: ctx.lang,
                alive: [...alive],
                count: chairsCount,
                seats: new Map(),
                seatedPlayers: new Set(),
                done: false,
            };
            activeRounds.set(roundId, roundState);
            ctx.session.onEnd(() => {
                roundState.done = true;
                roundState.resolve?.('ended');
                activeRounds.delete(roundId);
            });

            const components = buildChairButtons(roundState);
            const chairMsg = await ctx.channel.send({
                embeds: [ctx.embed(text.title, text.musicStopped)],
                components,
            }).catch(() => null);

            // Wait for all seats to fill or timeout (15s)
            await new Promise((resolve) => {
                if (ctx.session?.ended) return resolve('timeout');
                roundState.resolve = resolve;
                const off = ctx.session.onEnd(() => resolve('timeout'));
                const h = ctx.session.setTimeout(() => {
                    off();
                    resolve('timeout');
                }, 15_000);
                if (!h) { off(); resolve('timeout'); }
            });

            roundState.done = true;
            activeRounds.delete(roundId);

            // Disable buttons on chairMsg
            if (chairMsg) {
                chairMsg.edit({ components: buildChairButtons(roundState) }).catch(() => {});
            }

            // Determine who didn't get a chair (GH-289: anyone who didn't sit in time is eliminated)
            const seated = roundState.seatedPlayers;
            const unseated = alive.filter((id) => !seated.has(id));

            alive = alive.filter((id) => !unseated.includes(id));

            const elimMsg = unseated.length === 1
                ? text.eliminatedSingle(unseated[0])
                : text.eliminatedMulti(unseated);

            await ctx.send({
                embeds: [ctx.embed(text.title, `${elimMsg}\n\n${text.remaining(alive.length, alive)}`)],
            });

            if (alive.length === 0) {
                // Everyone was AFK/unseated
                break;
            }

            round += 1;
            if (alive.length > 1) {
                await delay(ctx, 2500);
            }
        }

        if (alive.length === 1 && !ctx.session.ended) {
            const winnerId = alive[0];
            const reward = await ctx.rewardWin(winnerId, 'group');
            await ctx.announceWin({ winner: { id: winnerId }, message: null }, reward, 'group');
        }
    },
};

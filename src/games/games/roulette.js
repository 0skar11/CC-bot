// roulette.js — `روليت` / `قرعة` / `groulette`: group roulette game (kind 'group', engine/lobby.js).
// Players join the lobby (min 2, max 25). Once started, each round spins the roulette and randomly eliminates
// players until exactly 1 survivor remains. The winner receives 2,000 CC and 5 points (uncapped).
// acceptArgs: only 0 args so `!روليت 100 احمر` is left to casino roulette.

const TEXT = {
    ar: {
        title: '🎡 روليت جماعي',
        rules: '👥 استبعاد عشوائي في كل لفة لحد ما يفضل فائز واحد!',
        spin: (round) => `🔄 **العجلة بتلف... (الجولة ${round})**`,
        eliminatedSingle: (id) => `💥 رصاصة الحظ استبعدت: <@${id}>!`,
        eliminatedMulti: (ids) => `💥 رصاصة الحظ استبعدت:\n${ids.map((id) => `• <@${id}>`).join('\n')}`,
        remaining: (count, list) => `🛡️ الباقيين (${count}): ${list.map((id) => `<@${id}>`).join(' ، ')}`,
        winner: (id) => `👑 <@${id}> نجا من الروليت وكسب اللعبة!`,
    },
    en: {
        title: '🎡 Group Roulette',
        rules: '👥 Random elimination each round until 1 winner survives!',
        spin: (round) => `🔄 **Spinning the wheel... (Round ${round})**`,
        eliminatedSingle: (id) => `💥 Elimination hit: <@${id}>!`,
        eliminatedMulti: (ids) => `💥 Elimination hit:\n${ids.map((id) => `• <@${id}>`).join('\n')}`,
        remaining: (count, list) => `🛡️ Remaining (${count}): ${list.map((id) => `<@${id}>`).join(', ')}`,
        winner: (id) => `👑 <@${id}> survived the roulette and won!`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

export default {
    id: 'roulette',
    kind: 'group',
    names: { ar: ['قرعة', 'روليت-جروب'], en: ['groulette', 'roulette-group'] },
    description: {
        ar: 'روليت جماعي: استبعاد عشوائي للاعبين لحد ما يفضل فائز واحد',
        en: 'group roulette: random elimination until 1 winner remains',
    },
    minPlayers: 2,
    maxPlayers: 25,
    acceptArgs: (args) => args.length === 0,
    async run(ctx) {
        const text = textOf(ctx.lang);
        const lobby = await ctx.openLobby({
            title: text.title,
            description: text.rules,
            min: 2,
            max: 25,
        });
        if (lobby.cancelled || ctx.session.ended) return;

        let alive = [...lobby.players];
        let round = 1;

        while (alive.length > 1 && !ctx.session.ended) {
            // Determine how many to eliminate this round
            const countToEliminate = alive.length > 10 ? Math.ceil(alive.length / 4) : 1;
            const victims = [];

            for (let i = 0; i < countToEliminate && alive.length > 1; i += 1) {
                const index = Math.floor(ctx.random() * alive.length);
                const [victim] = alive.splice(index, 1);
                victims.push(victim);
            }

            const eliminationMsg = victims.length === 1
                ? text.eliminatedSingle(victims[0])
                : text.eliminatedMulti(victims);

            const roundDesc = [
                text.spin(round),
                '',
                eliminationMsg,
                '',
                text.remaining(alive.length, alive),
            ].join('\n');

            await ctx.send({
                embeds: [ctx.embed(text.title, roundDesc)],
            });

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

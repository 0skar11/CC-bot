// mafia.js — `مافيا` / `mafia`: classic mafia role-playing game (kind 'group', engine/lobby.js).
// Roles: Mafia, Doctor, Detective, Citizen (assigned secretly with ephemeral buttons).
// Night phase: Mafia votes to kill, Doctor heals, Detective investigates.
// Day phase: Town discussion and voting to execute a suspect.
// Win condition: Town wins if all Mafia are eliminated; Mafia wins if they equal or outnumber the Town.
// Reward: 2,000 CC and 5 points.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';

const ROLES = {
    mafia: { id: 'mafia', emoji: '🔪', ar: 'مافيا', en: 'Mafia', team: 'mafia' },
    doctor: { id: 'doctor', emoji: '💉', ar: 'دكتور', en: 'Doctor', team: 'town' },
    detective: { id: 'detective', emoji: '🔎', ar: 'محقق', en: 'Detective', team: 'town' },
    citizen: { id: 'citizen', emoji: '👤', ar: 'مواطن شريف', en: 'Citizen', team: 'town' },
};

const TEXT = {
    ar: {
        title: '🕵️ لعبة المافيا الكلاسيكية',
        rules: '🎭 أدوار سرية! المافيا بتغتال بالليل، الدكتور بيعالج، المحقق بيكشف، وبالنهار المدينة بتصوّت على الإعدام.',
        rolesAssigned: '🎭 تم توزيع الأدوار سرًا! اضغط على الزرار تحت لمعرفة دورك:',
        checkRoleBtn: 'اعرف دورك 🎭',
        yourRole: (role) => `🎭 دورك السري هو: ${role.emoji} **${role.ar}**!\n${role.team === 'mafia' ? '🔴 هدفك القضاء على أهل المدينة.' : '🟢 هدفك كشف المافيا وإعدامهم.'}`,
        nightFalls: (n) => `🌙 **حل الليل ونامت المدينة... (الليلة ${n})**\nالمافيا بتختار الضحية، الدكتور بيعالج، والمحقق بيبحث. دوس على زرار أي لاعب لاختياره.`,
        nightActionDoctor: (target) => `💉 اخترت حماية <@${target}> الليلة!`,
        nightActionMafia: (target) => `🔪 اخترت اغتيال <@${target}> الليلة!`,
        nightActionDetective: (target, isMafia) => `🔎 التحقيق كشف أن <@${target}> هو: **${isMafia ? '🔴 عضو مافيا!!' : '🟢 مواطن بريء شريف'}**!`,
        nightActionCitizen: '😴 أنت مواطن، نام الليلة بسلام واستنى الصباح.',
        morningDoctorSaved: '✨ **طلع النهار!** حمى الدكتور الضحية ولم يمت أحد الليلة!',
        morningVictim: (id) => `💀 **طلع النهار مع مأساة!** عثر أهل المدينة على جثة <@${id}> مقتولاً!`,
        dayDiscussion: (n) => `☀️ **النهار طلع والنقاش بدأ (اليوم ${n})!**\nاتناقشوا في الشات وقرروا مين المشتبه فيه.`,
        votePhase: '⚖️ **حان وقت التصويت على الإعدام!** اختار مين يتعدم من الأزرار تحت:',
        skipVote: 'تخطي ⏩',
        votedFor: (target) => `✅ تم تسجيل صوتك ضد <@${target}>.`,
        votedSkip: '✅ اخترت تخطي الإعدام.',
        alreadyVoted: '✅ أنت صوّت بالفعل في هذه الجولة.',
        executed: (id, role) => `⚖️ قررت المدينة إعدام <@${id}>! وكان دوره: ${role.emoji} **${role.ar}**!`,
        noExecution: '🕊️ قرر أهل المدينة عدم إعدام أي شخص اليوم!',
        aliveTown: (list) => `👥 الأحياء (${list.length}): ${list.map((id) => `<@${id}>`).join(' ، ')}`,
        mafiaWon: '🏆 **فازت المافيا بالسيطرة على المدينة!**',
        townWon: '🏆 **فاز أهل المدينة الشرفاء بالقضاء على المافيا!**',
        revealRoles: (list) => `📜 كشف الأدوار للجميع:\n${list.map(([id, r]) => `• <@${id}>: ${r.emoji} **${r.ar}**`).join('\n')}`,
        ended: '⌛ اللعبة دي خلصت.',
    },
    en: {
        title: '🕵️ Classic Mafia Game',
        rules: '🎭 Secret roles! Mafia kills at night, Doctor heals, Detective investigates, Town votes by day.',
        rolesAssigned: '🎭 Roles assigned in secret! Click below to see your role:',
        checkRoleBtn: 'Check Role 🎭',
        yourRole: (role) => `🎭 Your secret role is: ${role.emoji} **${role.en}**!\n${role.team === 'mafia' ? '🔴 Goal: Eliminate the town.' : '🟢 Goal: Eliminate the mafia.'}`,
        nightFalls: (n) => `🌙 **Night falls... (Night ${n})**\nMafia chooses a victim, Doctor heals, Detective investigates. Click a player button to act.`,
        nightActionDoctor: (target) => `💉 You chose to protect <@${target}> tonight!`,
        nightActionMafia: (target) => `🔪 You voted to eliminate <@${target}> tonight!`,
        nightActionDetective: (target, isMafia) => `🔎 Investigation revealed <@${target}> is: **${isMafia ? '🔴 Mafia Member!!' : '🟢 Innocent Citizen'}**!`,
        nightActionCitizen: '😴 You are a citizen. Sleep safely and await morning.',
        morningDoctorSaved: '✨ **Morning comes!** The Doctor protected the victim, nobody died!',
        morningVictim: (id) => `💀 **Morning comes with a tragedy!** Town found <@${id}> murdered!`,
        dayDiscussion: (n) => `☀️ **Day breaks and discussion begins (Day ${n})!**\nDiscuss in chat who the suspect is.`,
        votePhase: '⚖️ **Voting Time!** Pick who to execute from the buttons below:',
        skipVote: 'Skip ⏩',
        votedFor: (target) => `✅ Voted against <@${target}>.`,
        votedSkip: '✅ Chose to skip execution.',
        alreadyVoted: '✅ You already voted this round.',
        executed: (id, role) => `⚖️ The town executed <@${id}>! Their role was: ${role.emoji} **${role.en}**!`,
        noExecution: '🕊️ The town decided not to execute anyone today!',
        aliveTown: (list) => `👥 Alive (${list.length}): ${list.map((id) => `<@${id}>`).join(', ')}`,
        mafiaWon: '🏆 **Mafia won and took over the city!**',
        townWon: '🏆 **Town won and eradicated the mafia!**',
        revealRoles: (list) => `📜 Role Reveal:\n${list.map(([id, r]) => `• <@${id}>: ${r.emoji} **${r.en}**`).join('\n')}`,
        ended: '⌛ This game has ended.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const activeMafiaGames = new Map();

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

function buildPlayerButtons(gameId, action, players, lang, includeSkip = false) {
    const text = textOf(lang);
    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < players.length; i += 1) {
        const id = players[i];
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:mafia:${action}:${gameId}:${id}`)
                .setLabel(`<@${id.slice(-4)}>`)
                .setStyle(ButtonStyle.Secondary),
        );
        if (currentRow.components.length === 5 || i === players.length - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    }
    if (includeSkip) {
        const lastRow = rows.at(-1)?.components.length < 5 ? rows.at(-1) : new ActionRowBuilder();
        lastRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:mafia:${action}:${gameId}:skip`)
                .setLabel(text.skipVote)
                .setStyle(ButtonStyle.Primary),
        );
        if (!rows.includes(lastRow)) rows.push(lastRow);
    }
    return rows;
}

export async function handleMafiaButton(interaction, [action, gameId, targetId] = []) {
    const game = activeMafiaGames.get(String(gameId || ''));
    const lang = game?.lang || 'ar';
    const text = textOf(lang);

    if (!game || game.done) return privately(interaction, text.ended);
    const userId = interaction.user?.id;
    if (!userId || interaction.user.bot) return;

    if (action === 'role') {
        const role = game.roles.get(userId);
        if (!role) return privately(interaction, '❌ أنت مش في اللعبة دي.');
        return privately(interaction, text.yourRole(role));
    }

    if (!game.alive.includes(userId)) {
        return privately(interaction, '❌ أنت متوفى ومتقدرش تشارك في التصويت.');
    }

    if (action === 'night') {
        const role = game.roles.get(userId);
        if (!role) return privately(interaction, text.ended);

        if (role.id === 'citizen') {
            return privately(interaction, text.nightActionCitizen);
        }
        if (role.id === 'doctor') {
            game.nightHeal = targetId;
            return privately(interaction, text.nightActionDoctor(targetId));
        }
        if (role.id === 'detective') {
            const targetRole = game.roles.get(targetId);
            const isMafia = targetRole?.id === 'mafia';
            return privately(interaction, text.nightActionDetective(targetId, isMafia));
        }
        if (role.id === 'mafia') {
            game.nightKills.set(userId, targetId);
            return privately(interaction, text.nightActionMafia(targetId));
        }
    }

    if (action === 'vote') {
        if (game.dayVotes.has(userId)) {
            return privately(interaction, text.alreadyVoted);
        }
        game.dayVotes.set(userId, targetId);
        if (targetId === 'skip') {
            await privately(interaction, text.votedSkip);
        } else {
            await privately(interaction, text.votedFor(targetId));
        }
        if (game.dayVotes.size >= game.alive.length) {
            game.resolveDay?.('all_voted');
        }
    }
}

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => {
        off();
        resolve();
    }, ms);
    if (!h) {
        off();
        resolve();
    }
});

export default {
    id: 'mafia',
    kind: 'group',
    names: { ar: ['مافيا'], en: ['mafia'] },
    description: {
        ar: 'لعبة المافيا: أدوار سرية، اغتيال بالليل ومحاكمة وتصويت بالنهار',
        en: 'classic mafia: secret roles, night assassinations, and daytime trials',
    },
    minPlayers: 4,
    maxPlayers: 16,
    async run(ctx) {
        const text = textOf(ctx.lang);
        const lobby = await ctx.openLobby({
            title: text.title,
            description: text.rules,
            min: 4,
            max: 16,
        });
        if (lobby.cancelled || ctx.session.ended) return;

        const players = [...lobby.players];
        const shuffled = [...players].sort(() => ctx.random() - 0.5);

        // Assign roles:
        // 1 or 2 Mafia (2 if >= 7 players), 1 Doctor, 1 Detective, rest Citizens
        const mafiaCount = players.length >= 7 ? 2 : 1;
        const roles = new Map();

        for (let i = 0; i < players.length; i += 1) {
            const id = shuffled[i];
            if (i < mafiaCount) {
                roles.set(id, ROLES.mafia);
            } else if (i === mafiaCount) {
                roles.set(id, ROLES.doctor);
            } else if (i === mafiaCount + 1) {
                roles.set(id, ROLES.detective);
            } else {
                roles.set(id, ROLES.citizen);
            }
        }

        const gameId = randomBytes(4).toString('hex');
        const game = {
            gameId,
            lang: ctx.lang,
            roles,
            alive: [...players],
            nightKills: new Map(),
            nightHeal: null,
            dayVotes: new Map(),
            done: false,
        };
        activeMafiaGames.set(gameId, game);
        ctx.session.onEnd(() => {
            game.done = true;
            game.resolveDay?.('ended');
            activeMafiaGames.delete(gameId);
        });

        // Announce role distribution with button
        const roleBtnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${GAMES_BUTTON_PREFIX}:mafia:role:${gameId}`)
                .setLabel(text.checkRoleBtn)
                .setStyle(ButtonStyle.Success),
        );
        await ctx.send({
            embeds: [ctx.embed(text.title, text.rolesAssigned)],
            components: [roleBtnRow],
        });
        await delay(ctx, 8000);

        let round = 1;
        let winningTeam = null;

        while (!winningTeam && !ctx.session.ended) {
            // ─── NIGHT PHASE ───
            game.nightKills.clear();
            game.nightHeal = null;

            const nightComponents = buildPlayerButtons(gameId, 'night', game.alive, ctx.lang);
            const nightMsg = await ctx.channel.send({
                embeds: [ctx.embed(text.title, text.nightFalls(round))],
                components: nightComponents,
            }).catch(() => null);

            await new Promise((resolve) => {
                if (ctx.session.ended) return resolve('ended');
                const off = ctx.session.onEnd(resolve);
                const h = ctx.session.setTimeout(() => {
                    off();
                    resolve('timeout');
                }, 18_000);
                if (!h) {
                    off();
                    resolve('ended');
                }
            });
            if (nightMsg) nightMsg.edit({ components: [] }).catch(() => {});
            if (ctx.session.ended) break;

            // Resolve Night:
            // Tally mafia kills
            const targetCounts = new Map();
            for (const target of game.nightKills.values()) {
                if (game.alive.includes(target)) {
                    targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
                }
            }
            let victim = null;
            let maxVotes = 0;
            for (const [t, count] of targetCounts.entries()) {
                if (count > maxVotes) {
                    maxVotes = count;
                    victim = t;
                }
            }

            let morningText = '';
            if (victim && victim === game.nightHeal) {
                morningText = text.morningDoctorSaved;
            } else if (victim) {
                game.alive = game.alive.filter((id) => id !== victim);
                morningText = text.morningVictim(victim);
            } else {
                morningText = text.morningDoctorSaved;
            }

            await ctx.send({
                embeds: [ctx.embed(text.title, `${morningText}\n\n${text.aliveTown(game.alive)}`)],
            });

            // Check Win Condition after night
            const aliveMafia = game.alive.filter((id) => game.roles.get(id).team === 'mafia');
            const aliveTown = game.alive.filter((id) => game.roles.get(id).team === 'town');

            if (aliveMafia.length === 0) {
                winningTeam = 'town';
                break;
            }
            if (aliveMafia.length >= aliveTown.length) {
                winningTeam = 'mafia';
                break;
            }

            await delay(ctx, 3000);

            // ─── DAY PHASE ───
            game.dayVotes.clear();
            await ctx.send({
                embeds: [ctx.embed(text.title, text.dayDiscussion(round))],
            });
            await delay(ctx, 7000);
            if (ctx.session.ended) break;

            // Voting
            const voteComponents = buildPlayerButtons(gameId, 'vote', game.alive, ctx.lang, true);
            const voteMsg = await ctx.channel.send({
                embeds: [ctx.embed(text.title, text.votePhase)],
                components: voteComponents,
            }).catch(() => null);

            await new Promise((resolve) => {
                if (ctx.session.ended) return resolve('ended');
                const off = ctx.session.onEnd(resolve);
                game.resolveDay = (res) => {
                    off();
                    resolve(res);
                };
                const h = ctx.session.setTimeout(() => {
                    off();
                    resolve('timeout');
                }, 18_000);
                if (!h) {
                    off();
                    resolve('ended');
                }
            });
            if (voteMsg) voteMsg.edit({ components: [] }).catch(() => {});
            if (ctx.session.ended) break;

            // Tally day votes
            const dayCounts = new Map();
            for (const vote of game.dayVotes.values()) {
                if (vote !== 'skip' && game.alive.includes(vote)) {
                    dayCounts.set(vote, (dayCounts.get(vote) || 0) + 1);
                }
            }
            let executed = null;
            let topVotes = 0;
            for (const [t, c] of dayCounts.entries()) {
                if (c > topVotes) {
                    topVotes = c;
                    executed = t;
                }
            }

            if (executed && topVotes >= 2) {
                const execRole = game.roles.get(executed);
                game.alive = game.alive.filter((id) => id !== executed);
                await ctx.send({
                    embeds: [ctx.embed(text.title, `${text.executed(executed, execRole)}\n\n${text.aliveTown(game.alive)}`)],
                });
            } else {
                await ctx.send({
                    embeds: [ctx.embed(text.title, `${text.noExecution}\n\n${text.aliveTown(game.alive)}`)],
                });
            }

            // Check Win Condition after day
            const aliveMafiaPost = game.alive.filter((id) => game.roles.get(id).team === 'mafia');
            const aliveTownPost = game.alive.filter((id) => game.roles.get(id).team === 'town');

            if (aliveMafiaPost.length === 0) {
                winningTeam = 'town';
                break;
            }
            if (aliveMafiaPost.length >= aliveTownPost.length) {
                winningTeam = 'mafia';
                break;
            }

            round += 1;
            await delay(ctx, 3000);
        }

        game.done = true;
        activeMafiaGames.delete(gameId);

        if (winningTeam && !ctx.session.ended) {
            const roleList = [...game.roles.entries()];
            const winBanner = winningTeam === 'mafia' ? text.mafiaWon : text.townWon;

            // Choose MVP / winner from winning team
            const winners = players.filter((id) => game.roles.get(id).team === winningTeam);
            const livingWinners = winners.filter((id) => game.alive.includes(id));
            const winnerId = livingWinners.length ? livingWinners[0] : winners[0];

            await ctx.send({
                embeds: [ctx.embed(text.title, `${winBanner}\n\n${text.revealRoles(roleList)}`)],
            });

            const reward = await ctx.rewardWin(winnerId, 'group');
            await ctx.announceWin({ winner: { id: winnerId }, message: null }, reward, 'group');
        }
    },
};

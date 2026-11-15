// general.js — the games' general commands, registered like games (kind 'general', src/games/registry.js) but
// answered at once and never holding the room: `اوامر` / `commands` (every game and command, from the registry),
// `توب` / `top` (this server's points), `عالمي` / `global` (every server), `نقاط` / `points` (yours or a member's)
// and `تحويل_نقاط` / `convert` (points to CC; `تحويل` alone stays the CC transfer). Typed after the PREFIX or a dot.

import { CC, formatCC } from '../config/cc.js';
import { GAMES, gamesChannelIds } from '../config/games.js';
import { ALL_IN_WORDS } from '../config/casino.js';
import { inLang } from '../services/cc/lang.js';
import { convertPoints } from './engine/rewards.js';
import { normalize } from './engine/text.js';
import { getPoints, globalBoard, serverBoard } from './engine/points.js';
import { describeGame, listGames } from './registry.js';

const USER = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u;
const MEDALS = ['🥇', '🥈', '🥉'];
const number = (value) => Number(value || 0).toLocaleString('en-US');
const noArgs = (args) => args.length === 0;

const TEXT = {
    ar: {
        title: '🎮 ألعاب الشات',
        how: (prefixes) => `⌨️ اكتب اسم اللعبة بعد ${prefixes.join(' أو ')} (مثال: \`.توب\`). لعبة واحدة بس في الروم في نفس الوقت.`,
        rooms: (rooms) => `🚪 الألعاب شغالة في ${rooms}`,
        rewards: () => `🌀 إجابة صح: **${number(CC.gamesBot.answer)}** ${CC.short} + ${GAMES.points.answer} نقطة ・ فوز في لعبة جماعية: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} نقاط ・ أقصى **${number(CC.gamesBot.dailyCap)}** ${CC.short} في اليوم من الألعاب.`,
        kinds: { single: '🎯 فردية — أول واحد يجاوب صح يكسب', dual: '⚔️ لاتنين', group: '👥 جماعية — للأدمن ومنظمين الفعاليات', general: '📋 عامة' },
        none: 'لسه مفيش ألعاب هنا.',
        topTitle: '🏆 توب نقاط السيرفر',
        globalTitle: '🌍 توب نقاط كل السيرفرات',
        noPoints: 'لسه محدش معاه نقاط. العب واكسب!',
        row: (row) => `**${number(row.points)}** نقطة ・ ${number(row.wins)} فوز`,
        rank: (rank) => `👤 ترتيبك: ${rank ? `**#${rank}**` : '—'}`,
        points: (id, server, global) => `🏅 نقاط <@${id}>: **${number(server.points)}** في السيرفر ده (${number(server.wins)} فوز) ・ **${number(global.points)}** في كل السيرفرات`,
        convertHint: (rate, min) => `🔁 اكتب \`.تحويل_نقاط 10\` (أو \`.تحويل_نقاط كل\`) وكل نقطة بـ **${number(rate)}** ${CC.short}، أقل حاجة ${min} نقاط.`,
        bots: '❌ البوتات مالهاش نقاط.',
        converted: (result) => `✅ حوّلت **${number(result.points)}** نقطة لـ ${formatCC(result.amount)} ・ رصيدك: ${formatCC(result.balance)} ・ باقيلك **${number(result.left)}** نقطة.`,
        min: (min) => `❌ أقل تحويل **${min}** نقاط.`,
        notEnough: (have) => `❌ معاكش نقاط كفاية، معاك **${number(have)}** نقطة بس في السيرفر ده.`,
        usage: '❌ اكتب: `.تحويل_نقاط 10` أو `.تحويل_نقاط كل`',
    },
    en: {
        title: '🎮 Chat games',
        how: (prefixes) => `⌨️ Type the game word after ${prefixes.join(' or ')} (for example \`.top\`). One game at a time per room.`,
        rooms: (rooms) => `🚪 Games run in ${rooms}`,
        rewards: () => `🌀 Right answer: **${number(CC.gamesBot.answer)}** ${CC.short} + ${GAMES.points.answer} point ・ group game win: **${number(CC.gamesBot.win)}** ${CC.short} + ${GAMES.points.group} points ・ at most **${number(CC.gamesBot.dailyCap)}** ${CC.short} a day from games.`,
        kinds: { single: '🎯 Solo — first right answer wins', dual: '⚔️ Two players', group: '👥 Group — admins and event hosts', general: '📋 General' },
        none: 'No games here yet.',
        topTitle: '🏆 Server points top',
        globalTitle: '🌍 Points top, all servers',
        noPoints: 'Nobody has points yet. Play and win!',
        row: (row) => `**${number(row.points)}** points ・ ${number(row.wins)} wins`,
        rank: (rank) => `👤 Your rank: ${rank ? `**#${rank}**` : '—'}`,
        points: (id, server, global) => `🏅 <@${id}>'s points: **${number(server.points)}** in this server (${number(server.wins)} wins) ・ **${number(global.points)}** in all servers`,
        convertHint: (rate, min) => `🔁 Type \`.convert 10\` (or \`.convert all\`): each point is **${number(rate)}** ${CC.short}, at least ${min} points.`,
        bots: '❌ Bots have no points.',
        converted: (result) => `✅ Converted **${number(result.points)}** points into ${formatCC(result.amount)} ・ balance: ${formatCC(result.balance)} ・ **${number(result.left)}** points left.`,
        min: (min) => `❌ The smallest conversion is **${min}** points.`,
        notEnough: (have) => `❌ Not enough points: you have **${number(have)}** in this server.`,
        usage: '❌ Type: `.convert 10` or `.convert all`',
    },
};
const say = (lang) => inLang(lang, TEXT);

/** Lines as embed fields of at most 1024 characters each (a long kind continues in a second field). */
function fieldsOf(name, lines) {
    const fields = [];
    let value = '';
    for (const line of lines) {
        const piece = line.slice(0, 1000);
        if (value && value.length + piece.length + 1 > 1024) {
            fields.push({ name: fields.length ? `${name} (${fields.length + 1})` : name, value });
            value = '';
        }
        value = value ? `${value}\n${piece}` : piece;
    }
    if (value) fields.push({ name: fields.length ? `${name} (${fields.length + 1})` : name, value });
    return fields;
}

/** The `اوامر` embed: the games by kind (singles, two players, group, general), each with its Arabic and English words. */
export function commandsPayload(ctx) {
    const text = say(ctx.lang);
    const rooms = gamesChannelIds.size ? [...gamesChannelIds].map((id) => `<#${id}>`).join(' ') : '';
    const intro = [text.how(GAMES.prefixes.map((word) => `\`${word}\``)), ...(rooms ? [text.rooms(rooms)] : [])].join('\n');
    const footer = text.rewards();
    // Discord refuses an embed over 6000 characters in all: the fields stop before that (the list is long only
    // once there are many games; each still has its own line in its kind).
    let room = 5900 - text.title.length - intro.length - footer.length;
    const fields = [];
    for (const field of ['single', 'dual', 'group', 'general'].flatMap((kind) => fieldsOf(text.kinds[kind], listGames({ kind }).map((game) => describeGame(game, ctx.lang))))) {
        room -= field.name.length + field.value.length;
        if (room < 0 || fields.length === 25) break;
        fields.push(field);
    }
    const embed = ctx.embed(text.title, intro, { fields: fields.length ? fields : [{ name: text.kinds.general, value: text.none }], footer });
    return { embeds: [embed], allowedMentions: { parse: [] } };
}

function boardPayload(ctx, title, rows) {
    const text = say(ctx.lang);
    const lines = rows.slice(0, GAMES.topSize).map((row, index) => `${MEDALS[index] || `**#${index + 1}**`} <@${row.userId}> — ${text.row(row)}`);
    const rank = rows.findIndex((row) => row.userId === ctx.starter.id) + 1;
    return { embeds: [ctx.embed(title, [lines.join('\n') || text.noPoints, '', text.rank(rank)].join('\n'))], allowedMentions: { parse: [] } };
}

const commands = {
    id: 'commands', kind: 'general', names: { ar: ['اوامر', 'الاوامر'], en: ['commands'] },
    description: { ar: 'كل الألعاب والأوامر', en: 'every game and command' },
    acceptArgs: noArgs,
    run: (ctx) => ctx.send(commandsPayload(ctx)),
};

const top = {
    id: 'top', kind: 'general', names: { ar: ['توب'], en: ['top'] },
    description: { ar: 'توب نقاط السيرفر', en: 'this server’s points top' },
    acceptArgs: noArgs,
    run: async (ctx) => ctx.send(boardPayload(ctx, say(ctx.lang).topTitle, await serverBoard(ctx.client, ctx.guildId))),
};

const global = {
    id: 'global', kind: 'general', names: { ar: ['عالمي'], en: ['global'] },
    description: { ar: 'توب نقاط كل السيرفرات', en: 'points top across all servers' },
    acceptArgs: noArgs,
    run: async (ctx) => ctx.send(boardPayload(ctx, say(ctx.lang).globalTitle, await globalBoard(ctx.client, ctx.guildId))),
};

const points = {
    id: 'points', kind: 'general', names: { ar: ['نقاط', 'نقاطي'], en: ['points'] },
    description: { ar: 'نقاطك أو نقاط عضو', en: 'your points or a member’s' },
    acceptArgs: (args) => args.length === 0 || (args.length === 1 && USER.test(args[0])),
    async run(ctx) {
        const text = say(ctx.lang);
        const match = ctx.args.length ? USER.exec(ctx.args[0]) : null;
        const userId = match ? match[1] || match[2] : ctx.starter.id;
        if (ctx.message.mentions?.users?.get?.(userId)?.bot) return ctx.send(text.bots);
        const { server, global: all } = await getPoints(ctx.client, ctx.guildId, userId);
        return ctx.send([text.points(userId, server, all), text.convertHint(GAMES.convert.ccPerPoint, GAMES.convert.minPoints)].join('\n'));
    },
};

const convert = {
    id: 'convert', kind: 'general', names: { ar: ['تحويل_نقاط'], en: ['convert'] },
    description: { ar: 'حوّل نقاطك لـ CC', en: 'turn your points into CC' },
    acceptArgs: (args) => args.length <= 1,
    async run(ctx) {
        const text = say(ctx.lang);
        const word = normalize(ctx.args[0]);
        if (!word) {
            const { server, global: all } = await getPoints(ctx.client, ctx.guildId, ctx.starter.id);
            return ctx.send([text.points(ctx.starter.id, server, all), text.convertHint(GAMES.convert.ccPerPoint, GAMES.convert.minPoints)].join('\n'));
        }
        let amount;
        if (ALL_IN_WORDS.has(word)) amount = (await getPoints(ctx.client, ctx.guildId, ctx.starter.id)).server.points;
        else if (/^\d{1,9}$/u.test(word)) amount = Number(word);
        else return ctx.send(text.usage);
        const result = await convertPoints(ctx.client, ctx.guildId, ctx.starter.id, amount);
        if (result.ok) return ctx.send(text.converted(result));
        return ctx.send(result.reason === 'not_enough' ? text.notEnough(result.have) : text.min(result.min));
    },
};

export const GENERAL_COMMANDS = [commands, top, global, points, convert];

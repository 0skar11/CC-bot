// gamesMenuUi.js — the games menu: `/games` and the typed `العاب` (src/commands/Games/games.js). One message,
// three embeds: how betting works, the solo games (فردية: you against the house) and the group games (جماعية: one
// round for the whole room). Every game shows what it is, a typed example, its slash command, the smallest bet
// and its house edge. Every number is read from CASINO and casinoEdges(), so the menu never drifts from what the
// games really do. Each line starts with Arabic or an emoji so Discord doesn't reorder it.

import { CC, ccEmbed } from '../../config/cc.js';
import { CASINO, GROUP_GAMES, SOLO_GAMES } from '../../config/casino.js';
import { casinoChannelIds, prefix } from '../../config/runtime.js';
import { casinoEdges } from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const seconds = (ms) => Math.round(ms / 1000);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));

/** Every game of the menu: its title, what it is, and how to type it. */
export function menuGames() {
    const { mines, coinflip, crash, dice, roulette, rocket } = CASINO;
    return {
        mines: {
            title: '💣 ماينز',
            about: `لوحة ${mines.columns}×${mines.cells / mines.columns} فيها من ${mines.min} لـ ${mines.max} ألغام: كل خانة أمان بتفتحها بتكبّر المضاعف، واعمل كاش أوت قبل ما تلاقي لغم.`,
            examples: [`مينز 100 ${mines.default}`],
        },
        coinflip: {
            title: '🪙 ملك ولا كتابة',
            about: `اختار 👑 ملك أو ✍️ كتابة، ولو العملة وقعت على اختيارك تاخد **×${(coinflip.payoutPercent / 100).toFixed(2)}**.`,
            examples: ['عملة 100 ملك'],
        },
        slots: {
            title: '🎰 سلوت',
            about: `تلات بكرات: 3 زي بعض تكسب لحد **×${topSlots()}**، واتنين زي بعض رهانك يرجعلك.`,
            examples: ['سلوت 100'],
        },
        crash: {
            title: '📈 كراش',
            about: `اختار مضاعف من ${multiplierText(crash.minTarget)} لـ ${multiplierText(crash.maxTarget)} والصاروخ يطلع: لو وصله قبل ما ينفجر تكسب رهانك × المضاعف (من غير مضاعف بيبقى ${multiplierText(crash.defaultTarget)}).`,
            examples: ['كراش 100 2.5'],
        },
        dice: {
            title: '🎲 نرد',
            about: `النرد بيطلع رقم من 0.00 لـ 99.99: قول \`فوق\` أو \`تحت\` رقم، وكل ما الفرصة أقل المكسب أكبر (فرصة ${dice.defaultNumber}% = ×${((100 - dice.edgePercent) / dice.defaultNumber).toFixed(2)}).`,
            examples: ['نرد 100 فوق 70', 'نرد 100 تحت 30'],
        },
        roulette: {
            title: '🎡 روليت',
            about: `أول رهان بيفتح جولة **${seconds(roulette.joinMs)} ثانية** للروم كله: راهنوا على 🔴 أحمر أو ⚫ أسود (**×${roulette.colorPays}**) أو رقم من 0 لـ 36 (**×${roulette.numberPays}**)، وبعدين العجلة بتلف مرة واحدة للكل.`,
            examples: ['روليت 100 احمر', 'روليت 50 17'],
        },
        rocket: {
            title: '🚀 صاروخ (كراش جماعي)',
            about: `اركبوا في **${seconds(rocket.joinMs)} ثانية** والصاروخ بيطلع بالكل مع بعض: دوس 💰 **كاش أوت** قبل ما ينفجر، أو حط مضاعف يخرّجك لوحده. أقصاه ${multiplierText(crash.maxTarget)}.`,
            examples: ['صاروخ 100', 'صاروخ 100 2'],
        },
    };
}

function gameField(name, game, edge) {
    const typed = game.examples.map((example) => `\`${example}\``).join(' ・ ');
    return {
        name: game.title,
        value: [
            game.about,
            `⌨️ ${typed} ・ \`/casino ${name}\``,
            `💵 من **${number(CASINO.minBet)}** ${CC.short} ・ ⚖️ نسبة البيت **${edge}%**`,
        ].join('\n'),
    };
}

/** The menu's three embeds. */
export function gamesMenuEmbeds() {
    const games = menuGames();
    const edges = casinoEdges();
    const rooms = casinoChannelIds.size ? [`🚪 الألعاب شغالة في: ${[...casinoChannelIds].map((id) => `<#${id}>`).join(' ')}`] : [];
    const intro = ccEmbed('🎮 ألعاب CC bot', [
        `${CC.emoji} كل الألعاب بالـ ${CC.short}: الرهان من **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' لحد رصيدك' : ` لـ **${number(CASINO.maxBet)}** ${CC.short} (ومايزيدش عن رصيدك)`}.`,
        ...rooms,
        `⌨️ اكتب الأمر زي ما هو في روم الكازينو (من غير \`${prefix}\`)، أو استخدم \`/casino\`.`,
        `🎯 **فردية** (${SOLO_GAMES.length}): انت والبيت بس، والنتيجة على طول.`,
        `👥 **جماعية** (${GROUP_GAMES.length}): جولة واحدة للروم كله، الكل بيراهن ونتيجة واحدة للكل.`,
    ].join('\n'));
    const solo = ccEmbed('🎯 الألعاب الفردية', '', { fields: SOLO_GAMES.map((name) => gameField(name, games[name], edges[name])) });
    const group = ccEmbed('👥 الألعاب الجماعية', '', { fields: GROUP_GAMES.map((name) => gameField(name, games[name], edges[name])) });
    group.footer = { text: '⚖️ كل لعبة ليها نسبة صغيرة للبيت، فعلى المدى الطويل الكازينو بيكسب. العب بمزاج وماتراهنش بحاجة مش مستعد تخسرها ・ للشرح الكامل اكتب: شرح' };
    return [intro, solo, group];
}

/** The whole reply (no pings). */
export function gamesMenuPayload() {
    return { content: '', embeds: gamesMenuEmbeds(), components: [], allowedMentions: { parse: [] } };
}

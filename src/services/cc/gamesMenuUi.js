// gamesMenuUi.js — the games menu: `/games` and the typed `العاب` / `games` (src/commands/Games/games.js), in
// Arabic or English. ONE embed that is quick to read: a short intro, the solo games and the group games as two
// blocks (each game is a title line with what it does, then a line with the typed example), and one footer line
// with every house edge. The rocket also shows `كراش` / `crash`, which is the same game. Every number is read from
// CASINO and casinoEdges(), so the menu never drifts from what the games really do. Each line starts with an emoji
// so Discord keeps the Arabic lines in order.

import { CC, ccEmbed } from '../../config/cc.js';
import { CASINO } from '../../config/casino.js';
import { casinoChannelIds, prefix } from '../../config/runtime.js';
import { casinoEdges } from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const seconds = (ms) => Math.round(ms / 1000);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));
const code = (words) => words.map((word) => `\`${word}\``).join(' ・ ');
const block = (title, about, examples) => `${title} — ${about}\n╰ ${code(examples)}`;

/** The text of the menu in one language. Every game is a block of two lines. */
function menuText(lang) {
    const { mines, coinflip, roulette, crash } = CASINO;
    const edges = casinoEdges();
    const slots = topSlots();
    const wait = seconds(roulette.joinMs);
    const rooms = casinoChannelIds.size ? [...casinoChannelIds].map((id) => `<#${id}>`).join(' ') : '';
    const maxBet = CASINO.unlimited ? '' : number(CASINO.maxBet);
    const board = `${mines.columns}×${mines.cells / mines.columns}`;
    const coin = (coinflip.payoutPercent / 100).toFixed(2);
    if (lang === 'en') {
        return {
            title: '🎮 CC bot games',
            intro: [
                `${CC.emoji} Bets from **${number(CASINO.minBet)} ${CC.short}**${maxBet ? ` up to **${maxBet} ${CC.short}**` : ''}, never more than your balance.`,
                `⌨️ Type the command in the casino room (no \`${prefix}\` needed) or use \`/casino\`.`,
                ...(rooms ? [`🚪 Games run in ${rooms}`] : []),
            ],
            soloTitle: '🎯 Solo — you against the house',
            solo: [
                block('💣 **Mines**', `a ${board} board: open safe tiles, cash out before a mine`, [`mines 100 ${mines.default}`]),
                block('🪙 **Coinflip**', `heads or tails, a win pays ×${coin}`, ['coinflip 100 heads']),
                block('🎰 **Slots**', `three of a kind pays up to ×${slots}, a pair gives your bet back`, ['slots 100']),
                block('🎲 **Dice**', 'it rolls 0.00-99.99: call over or under a number', ['dice 100 over 70', 'dice 100 under 30']),
            ],
            groupTitle: '👥 Group — one round for the whole room',
            group: [
                block('🎡 **Roulette**', `🔴 red or ⚫ black ×${roulette.colorPays}, a number 0-36 ×${roulette.numberPays}; the wheel spins ${wait}s after the first bet`, ['roulette 100 red', 'roulette 50 17']),
                block('🚀 **Rocket** (same as `crash`)', `everyone rides together: press 💰 Cash out before it crashes (up to ${multiplierText(crash.maxTarget)}), or add a target to cash out by itself`, ['rocket 100', 'rocket 100 2']),
            ],
            footer: `⚖️ House edge: Mines ${edges.mines}% · Coinflip ${edges.coinflip}% · Slots ${edges.slots}% · Dice ${edges.dice}% · Roulette ${edges.roulette}% · Rocket ${edges.rocket}%  ・  Play for fun  ・  العربية: العاب`,
        };
    }
    return {
        title: '🎮 ألعاب CC bot',
        intro: [
            `${CC.emoji} الرهان من **${number(CASINO.minBet)} ${CC.short}**${maxBet ? ` لحد **${maxBet} ${CC.short}**` : ''} ومايزيدش عن رصيدك.`,
            `⌨️ اكتب الأمر في روم الكازينو (من غير \`${prefix}\`) أو استخدم \`/casino\`.`,
            ...(rooms ? [`🚪 الألعاب شغالة في ${rooms}`] : []),
        ],
        soloTitle: '🎯 فردية — انت والبيت بس',
        solo: [
            block('💣 **ماينز**', `لوحة ${board}: افتح خانات أمان واعمل كاش أوت قبل اللغم`, [`مينز 100 ${mines.default}`]),
            block('🪙 **ملك ولا كتابة**', `المكسب ×${coin}`, ['عملة 100 ملك']),
            block('🎰 **سلوت**', `٣ زي بعض لحد ×${slots}، واتنين زي بعض رهانك يرجعلك`, ['سلوت 100']),
            block('🎲 **نرد**', 'رقم من 0.00 لـ 99.99: قول فوق أو تحت رقم', ['نرد 100 فوق 70', 'نرد 100 تحت 30']),
        ],
        groupTitle: '👥 جماعية — جولة واحدة للروم كله',
        group: [
            block('🎡 **روليت**', `🔴 أحمر أو ⚫ أسود ×${roulette.colorPays}، رقم 0-36 ×${roulette.numberPays}؛ العجلة بتلف بعد ${wait} ثانية من أول رهان`, ['روليت 100 احمر', 'روليت 50 17']),
            block('🚀 **صاروخ** (هو نفسه `كراش`)', `الكل بيركب مع بعض: دوس 💰 كاش أوت قبل ما ينفجر (لحد ${multiplierText(crash.maxTarget)}) أو حط هدف يخرّجك لوحده`, ['صاروخ 100', 'صاروخ 100 2']),
        ],
        footer: `⚖️ نسبة البيت: ماينز ${edges.mines}% · عملة ${edges.coinflip}% · سلوت ${edges.slots}% · نرد ${edges.dice}% · روليت ${edges.roulette}% · صاروخ ${edges.rocket}%  ・  العب بمزاج  ・  English: games`,
    };
}

/** The menu: one embed, Arabic by default (`العاب`), English for `games`. */
export function gamesMenuEmbeds(lang = 'ar') {
    const text = menuText(lang === 'en' ? 'en' : 'ar');
    const embed = ccEmbed(text.title, text.intro.join('\n'), {
        fields: [
            { name: text.soloTitle, value: text.solo.join('\n\n') },
            { name: text.groupTitle, value: text.group.join('\n\n') },
        ],
    });
    embed.footer = { text: text.footer };
    return [embed];
}

/** The whole reply (no pings). */
export function gamesMenuPayload(lang = 'ar') {
    return { content: '', embeds: gamesMenuEmbeds(lang), components: [], allowedMentions: { parse: [] } };
}

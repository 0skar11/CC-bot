// gamesMenuUi.js — the games menu: `/games` and the typed `العاب` / `games` (src/commands/Games/games.js), in
// Arabic or English. One message, three embeds: how betting works, the solo games (فردية: you against the house)
// and the group games (جماعية: one round for the whole room). Every game shows what it is, a typed example, its
// slash command, the smallest bet and its house edge; the rocket also shows `كراش` / `crash`, which is the same
// game. Every number is read from CASINO and casinoEdges(), so the menu never drifts from what the games really
// do. Each Arabic line starts with Arabic or an emoji so Discord doesn't reorder it.

import { CC, ccEmbed } from '../../config/cc.js';
import { CASINO, GROUP_GAMES, SOLO_GAMES } from '../../config/casino.js';
import { casinoChannelIds, prefix } from '../../config/runtime.js';
import { casinoEdges } from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const seconds = (ms) => Math.round(ms / 1000);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));

/** Every game of the menu: its title, what it is, and how to type it. */
export function menuGames(lang = 'ar') {
    const { mines, coinflip, crash, dice, roulette, rocket } = CASINO;
    if (lang === 'en') return englishGames();
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
            about: `اركبوا في **${seconds(rocket.joinMs)} ثانية** والصاروخ بيطلع بالكل مع بعض: دوس 💰 **كاش أوت** قبل ما ينفجر، أو حط مضاعف يخرّجك لوحده. أقصاه ${multiplierText(crash.maxTarget)}. \`كراش\` هو نفس الصاروخ ونفس الجولة.`,
            // `كراش` is the same command: crash is played as this group rocket.
            examples: ['صاروخ 100', 'صاروخ 100 2', 'كراش 100 2.5'],
        },
    };
}

/** The English `games` menu: the same games, with the English typed commands. */
function englishGames() {
    const { mines, coinflip, crash, dice, roulette, rocket } = CASINO;
    return {
        mines: {
            title: '💣 Mines',
            about: `A ${mines.columns}×${mines.cells / mines.columns} board hiding ${mines.min} to ${mines.max} mines: every safe tile you open raises the multiplier, so cash out before you hit a mine.`,
            examples: [`mines 100 ${mines.default}`],
        },
        coinflip: {
            title: '🪙 Coinflip',
            about: `Pick 👑 heads or ✍️ tails. If the coin lands on your side you win **×${(coinflip.payoutPercent / 100).toFixed(2)}**.`,
            examples: ['coinflip 100 heads'],
        },
        slots: {
            title: '🎰 Slots',
            about: `Three reels: three of a kind pays up to **×${topSlots()}**, two of a kind gives your bet back.`,
            examples: ['slots 100'],
        },
        dice: {
            title: '🎲 Dice',
            about: `The dice rolls 0.00 to 99.99: call \`over\` or \`under\` a number. The smaller your chance, the bigger the win (a ${dice.defaultNumber}% chance pays ×${((100 - dice.edgePercent) / dice.defaultNumber).toFixed(2)}).`,
            examples: ['dice 100 over 70', 'dice 100 under 30'],
        },
        roulette: {
            title: '🎡 Roulette',
            about: `The first bet opens a **${seconds(roulette.joinMs)} second** round for the whole room: bet on 🔴 red or ⚫ black (**×${roulette.colorPays}**) or on a number from 0 to 36 (**×${roulette.numberPays}**), then the wheel spins once for everybody.`,
            examples: ['roulette 100 red', 'roulette 50 17'],
        },
        rocket: {
            title: '🚀 Rocket (group crash)',
            about: `Board within **${seconds(rocket.joinMs)} seconds** and the rocket flies with everyone together: press 💰 **Cash out** before it crashes, or set a multiplier that cashes you out by itself. It tops out at ${multiplierText(crash.maxTarget)}. \`crash\` is the same rocket and the same round.`,
            // `crash` is the same command: crash is played as this group rocket.
            examples: ['rocket 100', 'rocket 100 2', 'crash 100 2.5'],
        },
    };
}

function gameField(name, game, edge, lang = 'ar') {
    const typed = game.examples.map((example) => `\`${example}\``).join(' ・ ');
    return {
        name: game.title,
        value: [
            game.about,
            `⌨️ ${typed} ・ \`/casino ${name}\``,
            lang === 'en' ? `💵 From **${number(CASINO.minBet)}** ${CC.short} ・ ⚖️ House edge **${edge}%**` : `💵 من **${number(CASINO.minBet)}** ${CC.short} ・ ⚖️ نسبة البيت **${edge}%**`,
        ].join('\n'),
    };
}

/** The English menu's three embeds. */
function englishMenuEmbeds() {
    const games = menuGames('en');
    const edges = casinoEdges();
    const rooms = casinoChannelIds.size ? [`🚪 Games run in: ${[...casinoChannelIds].map((id) => `<#${id}>`).join(' ')}`] : [];
    const intro = ccEmbed('🎮 CC bot games', [
        `${CC.emoji} Every game is played with ${CC.short}: bets start at **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' and go up to your balance' : ` and go up to **${number(CASINO.maxBet)}** ${CC.short} (never more than your balance)`}.`,
        ...rooms,
        `⌨️ Type the command exactly as shown in the casino room (no \`${prefix}\` needed), or use \`/casino\`.`,
        `🎯 **Solo** (${SOLO_GAMES.length}): just you against the house, and the result is instant.`,
        `👥 **Group** (${GROUP_GAMES.length}): one round for the whole room, everybody bets and gets the same result.`,
        '🇪🇬 Arabic commands answer in Arabic (for the Arabic menu type: العاب)',
    ].join('\n'));
    const solo = ccEmbed('🎯 Solo games', '', { fields: SOLO_GAMES.map((name) => gameField(name, games[name], edges[name], 'en')) });
    const group = ccEmbed('👥 Group games', '', { fields: GROUP_GAMES.map((name) => gameField(name, games[name], edges[name], 'en')) });
    group.footer = { text: '⚖️ Every game has a small house edge, so over time the casino wins. Play for fun and never bet what you cannot afford to lose ・ Full guide: type help' };
    return [intro, solo, group];
}

/** The menu's three embeds: Arabic by default (`العاب`), English for `games`. */
export function gamesMenuEmbeds(lang = 'ar') {
    if (lang === 'en') return englishMenuEmbeds();
    const games = menuGames();
    const edges = casinoEdges();
    const rooms = casinoChannelIds.size ? [`🚪 الألعاب شغالة في: ${[...casinoChannelIds].map((id) => `<#${id}>`).join(' ')}`] : [];
    const intro = ccEmbed('🎮 ألعاب CC bot', [
        `${CC.emoji} كل الألعاب بالـ ${CC.short}: الرهان من **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' لحد رصيدك' : ` لـ **${number(CASINO.maxBet)}** ${CC.short} (ومايزيدش عن رصيدك)`}.`,
        ...rooms,
        `⌨️ اكتب الأمر زي ما هو في روم الكازينو (من غير \`${prefix}\`)، أو استخدم \`/casino\`.`,
        `🎯 **فردية** (${SOLO_GAMES.length}): انت والبيت بس، والنتيجة على طول.`,
        `👥 **جماعية** (${GROUP_GAMES.length}): جولة واحدة للروم كله، الكل بيراهن ونتيجة واحدة للكل.`,
        '🇬🇧 الأوامر بالإنجليزي بترد بالإنجليزي (للقايمة بالإنجليزي اكتب: games)',
    ].join('\n'));
    const solo = ccEmbed('🎯 الألعاب الفردية', '', { fields: SOLO_GAMES.map((name) => gameField(name, games[name], edges[name])) });
    const group = ccEmbed('👥 الألعاب الجماعية', '', { fields: GROUP_GAMES.map((name) => gameField(name, games[name], edges[name])) });
    group.footer = { text: '⚖️ كل لعبة ليها نسبة صغيرة للبيت، فعلى المدى الطويل الكازينو بيكسب. العب بمزاج وماتراهنش بحاجة مش مستعد تخسرها ・ للشرح الكامل اكتب: شرح' };
    return [intro, solo, group];
}

/** The whole reply (no pings). */
export function gamesMenuPayload(lang = 'ar') {
    return { content: '', embeds: gamesMenuEmbeds(lang), components: [], allowedMentions: { parse: [] } };
}

// casinoUi.js — the casino's solo-game embeds and buttons, shared by the `casino` command
// (src/commands/Games/casino.js), the mines and chicken buttons (src/interactions/buttons/store/casino.js) and
// the timeout and restart check of those saved games (casinoSessions.js). The group rounds are casinoGroupUi.js.
// Plain embed objects so the emojis stay; each Arabic line starts with Arabic or an emoji so Discord doesn't
// reorder it. Every text exists in Arabic and English (TEXT below, 'ar' by default); the language comes from the
// command (src/services/cc/lang.js), and a mines board or a chicken keeps the language it was opened in (its
// saved `lang`). gameResultPayload, gameNoticeText, previousGameNote and the 'active' refusal show whichever
// saved game they are about (a result's `game.game`, or `kind` for a damaged one; mines when it can't be told).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CC, ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, COIN_SIDES, DICE_DIRECTIONS } from '../../config/casino.js';
import {
    chickenMultiplierHundredths, chickenPayout, chickenSurvivePercent, diceMultiplierHundredths, diceWins, minesPayout, minesMultiplierHundredths,
} from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';
import { inLang, readLang } from './lang.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const idleSeconds = Math.round(CASINO.idleMs / 1000);
const times = (hundredths) => `×${(hundredths / 100).toFixed(2)}`;
const coinflipTimes = () => times(CASINO.coinflip.payoutPercent);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));
const lanes = () => CASINO.chicken.maxSteps;
const topChicken = () => times(chickenMultiplierHundredths(CASINO.chicken.maxSteps));
const quiet = (embed, components = []) => ({ content: '', embeds: [embed], components, allowedMentions: { parse: [] } });

const TEXT = {
    ar: {
        profitUp: (cc) => `🟢 مكسب ${cc}`,
        profitDown: (cc) => `🔴 خسارة ${cc}`,
        profitEven: '⚪ رهانك رجعلك زي ما هو',
        balance: (cc) => `💰 رصيدك: ${cc}`,
        won: (cc, multiplier) => `🎉 كسبت! خدت ${cc} (${multiplier})`,
        lost: (cc) => `❌ خسرت ${cc}`,
        // Mines
        minesTitle: '💣 ماينز',
        minesLine: (userId, cc, mines) => `<@${userId}> ・ 💵 الرهان: ${cc} ・ 💣 الألغام: **${mines}**`,
        opened: (picks, safe) => `💎 فتحت **${picks}** من **${safe}** خانات أمان`,
        cashOutNow: (multiplier, cc) => `💰 الكاش أوت دلوقتي: **${multiplier}** ← ${cc}`,
        nextCell: (multiplier, cc) => `⏭️ الخانة الجاية: **${multiplier}** ← ${cc}`,
        idleRule: `⏰ لو سبت اللعبة ${idleSeconds} ثانية من غير لعب، بتعمل كاش أوت لوحدها بالمضاعف الحالي (ولو مافتحتش ولا خانة رهانك بيرجعلك كامل).`,
        cashOutButton: (amount) => `كاش أوت · ${amount} ${CC.short}`,
        minesBroken: (cc) => `⚠️ لعبة ماينز قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${cc}.`,
        minesLost: (cc) => `💥 **بوم!** لقيت لغم وخسرت ${cc}.`,
        minesCleared: (multiplier, cc) => `🏆 فتحت كل خانات الأمان! خدت **${multiplier}** ← ${cc}.`,
        minesTimeout: (multiplier, cc) => `⏰ اللعبة فضلت ${idleSeconds} ثانية من غير لعب فعملت كاش أوت لوحدها بـ **${multiplier}** ← ${cc}.`,
        minesCashedOut: (multiplier, cc) => `✅ عملت كاش أوت بـ **${multiplier}** وخدت ${cc}.`,
        previousGame: (cc) => `⏰ لعبة الماينز اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${cc}.`,
        // Coinflip
        coinflipTitle: '🪙 ملك ولا كتابة',
        sideName: (side) => COIN_SIDES[side].name,
        picked: (user, side, emoji, cc) => `${user} اختار **${side}** ${emoji} وراهن بـ ${cc}`,
        landed: (side, emoji) => `🪙 العملة وقعت: **${side}** ${emoji}`,
        winPays: (multiplier) => `المكسب ${multiplier} من الرهان`,
        // Slots
        slotsTitle: '🎰 سلوت',
        slotsPair: 'اتنين زي بعض = رهانك يرجع',
        betBy: (user, cc) => `${user} راهن بـ ${cc}`,
        slotsLost: (cc) => `😅 حظ أوفر المرة الجاية، خسرت ${cc}`,
        slotsTriple: (symbol, multiplier, cc) => `🎉 **3 ${symbol} زي بعض!** ×${multiplier} ← ${cc}`,
        slotsBack: (cc) => `🙂 اتنين زي بعض: رهانك رجعلك (${cc})`,
        // Dice
        diceTitle: '🎲 نرد',
        directionName: (direction) => DICE_DIRECTIONS[direction].name,
        diceRule: (direction, line) => (direction === 'under' ? `أقل من ${line}.00` : `${line}.00 أو أكتر`),
        diceBet: (user, cc, side, line, emoji, rule) => `${user} راهن بـ ${cc} على **${side} ${line}** ${emoji} (لازم يطلع ${rule})`,
        diceFooter: (chance, multiplier) => `فرصة المكسب ${chance}% ・ المكسب ${multiplier} من الرهان`,
        // Chicken
        chickenTitle: '🐔 الفرخة',
        chickenLine: (userId, cc) => `<@${userId}> ・ 💵 الرهان: ${cc}`,
        crossed: (steps, all) => `🐔 الفرخة عدّت **${steps}** من **${all}** حارة`,
        nextLane: (multiplier, cc, chance) => `⏭️ الحارة الجاية: **${multiplier}** ← ${cc} (فرصة إنها تعدّي ${chance}%)`,
        chickenIdleRule: `⏰ لو سبت الفرخة ${idleSeconds} ثانية من غير ما تتقدّم، بتعمل كاش أوت لوحدها بالمضاعف الحالي (ولو ماعدّتش ولا حارة رهانك بيرجعلك كامل).`,
        stepButton: 'تقدّم',
        chickenBroken: (cc) => `⚠️ لعبة فرخة قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${cc}.`,
        chickenLost: (lane, cc) => `💀 **الفرخة اتفرمت!** عربية خبطتها في الحارة **${lane}** وخسرت ${cc}. 🍗`,
        chickenCrossed: (multiplier, cc) => `🏆 الفرخة عدّت الطريق كله! خدت **${multiplier}** ← ${cc}.`,
        chickenTimeout: (multiplier, cc) => `⏰ الفرخة فضلت واقفة ${idleSeconds} ثانية من غير لعب فعملت كاش أوت لوحدها بـ **${multiplier}** ← ${cc}.`,
        chickenCashedOut: (multiplier, cc) => `✅ عملت كاش أوت بـ **${multiplier}** وخدت ${cc}.`,
        chickenFate: (lane) => (lane === null ? '🔍 كانت هتعدّي الطريق كله سليمة.' : `🔍 العربية كانت مستنياها في الحارة **${lane}**.`),
        previousChicken: (cc) => `⏰ لعبة الفرخة اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${cc}.`,
        chickenActive: (ends) => `⚠️ عندك لعبة فرخة شغالة، كملها أو اعمل كاش أوت الأول${ends}.`,
        // Usage: one typed example per game. `كراش` is the rocket.
        usage: {
            mines: () => `💣 \`مينز 100 3\` ・ ماينز: افتح خانات من غير ما تلاقي لغم (من ${CASINO.mines.min} لـ ${CASINO.mines.max} ألغام) واعمل كاش أوت وقت ما تحب`,
            coinflip: () => `🪙 \`عملة 100 ملك\` ・ ملك ولا كتابة، المكسب ${coinflipTimes()}`,
            slots: () => `🎰 \`سلوت 100\` ・ سلوت، 3 زي بعض لحد ×${topSlots()}`,
            dice: () => `🎲 \`نرد 100 فوق 70\` أو \`نرد 100 تحت 30\` ・ نرد من 0.00 لـ 99.99، وكل ما الفرصة أقل المكسب أكبر`,
            chicken: () => `🐔 \`فرخة 100\` ・ الفرخة: كل حارة تعدّيها بتكبّر المضاعف (لحد ${topChicken()} بعد ${lanes()} حارة)، واعمل كاش أوت قبل ما عربية تخبطها`,
            roulette: () => `🎡 \`روليت 100 احمر\` أو \`روليت 100 17\` ・ روليت جماعي: 🔴 / ⚫ ×${CASINO.roulette.colorPays}، رقم من 0 لـ 36 ×${CASINO.roulette.numberPays}`,
            rocket: () => `🚀 \`صاروخ 100\` أو \`صاروخ 100 2\` (أو \`كراش 100 2.5\`) ・ صاروخ (كراش جماعي): اركب مع الروم واعمل كاش أوت قبل ما ينفجر`,
        },
        casinoHead: () => `🎰 **الكازينو** ・ الرهان من ${number(CASINO.minBet)} ${CC.short} لحد رصيدك${CASINO.unlimited ? '' : ` (أقصى رهان ${number(CASINO.maxBet)})`}`,
        menuHint: '🎮 اكتب `العاب` تشوف كل الألعاب وشرحها.',
        writeItSo: (example) => `❌ اكتبها كده: ${example}`,
        gamesHint: '🎮 اكتب `العاب` تشوف كل الألعاب.',
        // Failures
        badBet: () => `❌ الرهان لازم يكون رقم صحيح من **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' وفوق' : ` لـ **${number(CASINO.maxBet)}** ${CC.short}`}.`,
        noCC: (cc) => `❌ رصيدك ${cc} مش كفاية للرهان ده.`,
        active: (ends) => `⚠️ عندك لعبة ماينز شغالة، كملها أو اعمل كاش أوت الأول${ends}.`,
        activeEnds: (at) => ` (هتقفل لوحدها <t:${at}:R> لو مالعبتش)`,
        badTarget: () => `❌ المضاعف لازم يكون من **${multiplierText(CASINO.crash.minTarget)}** لـ **${multiplierText(CASINO.crash.maxTarget)}** (مثلًا \`2.5\`).`,
        badDice: (minChance, maxChance) => `❌ اختار \`تحت\` رقم من ${minChance} لـ ${maxChance} أو \`فوق\` رقم من ${100 - maxChance} لـ ${100 - minChance} (مثلًا \`نرد 100 فوق 70\`).`,
        tooMany: () => `❌ أقصى حاجة ${CASINO.roulette.maxBetsPerMember} رهانات ليك في الجولة الواحدة.`,
        failures: {
            bad_mines: `❌ عدد الألغام لازم يكون من ${CASINO.mines.min} لـ ${CASINO.mines.max}.`,
            bad_side: '❌ اختار `ملك` أو `كتابة`.',
            cooldown: '⏳ استنى ثانية قبل اللعبة الجاية.',
            bad_choice: '❌ اختار 🔴 `احمر` أو ⚫ `اسود` أو 🟢 `اخضر` أو رقم من 0 لـ 36.',
            busy: '⏳ فيه جولة شغالة في الروم دلوقتي، استنى لما تخلص وابدأ اللي بعدها.',
            full: '❌ الجولة دي اتملت، استنى اللي بعدها.',
            joined: '🧑‍🚀 انت راكب الصاروخ ده خلاص، استنى الإقلاع.',
        },
        unknown: '❌ حصلت مشكلة، جرب تاني.',
        error: '❌ حصل خطأ. حاول تاني بعد شوية.',
    },
    en: {
        profitUp: (cc) => `🟢 Profit ${cc}`,
        profitDown: (cc) => `🔴 Loss ${cc}`,
        profitEven: '⚪ You got your bet back',
        balance: (cc) => `💰 Your balance: ${cc}`,
        won: (cc, multiplier) => `🎉 You won! You took ${cc} (${multiplier})`,
        lost: (cc) => `❌ You lost ${cc}`,
        // Mines
        minesTitle: '💣 Mines',
        minesLine: (userId, cc, mines) => `<@${userId}> ・ 💵 Bet: ${cc} ・ 💣 Mines: **${mines}**`,
        opened: (picks, safe) => `💎 You opened **${picks}** of **${safe}** safe tiles`,
        cashOutNow: (multiplier, cc) => `💰 Cash out now: **${multiplier}** → ${cc}`,
        nextCell: (multiplier, cc) => `⏭️ Next tile: **${multiplier}** → ${cc}`,
        idleRule: `⏰ Leave the board alone for ${idleSeconds} seconds and it cashes out by itself at the current multiplier (with no tile opened you get your whole bet back).`,
        cashOutButton: (amount) => `Cash out · ${amount} ${CC.short}`,
        minesBroken: (cc) => `⚠️ An old mines game was damaged, so it was closed and your bet of ${cc} was given back.`,
        minesLost: (cc) => `💥 **Boom!** You hit a mine and lost ${cc}.`,
        minesCleared: (multiplier, cc) => `🏆 You opened every safe tile! You took **${multiplier}** → ${cc}.`,
        minesTimeout: (multiplier, cc) => `⏰ The board sat idle for ${idleSeconds} seconds, so it cashed out by itself at **${multiplier}** → ${cc}.`,
        minesCashedOut: (multiplier, cc) => `✅ You cashed out at **${multiplier}** and took ${cc}.`,
        previousGame: (cc) => `⏰ Your last mines board was left idle, so it closed by itself and paid you ${cc}.`,
        // Coinflip
        coinflipTitle: '🪙 Coinflip',
        sideName: (side) => ({ heads: 'Heads', tails: 'Tails' })[side],
        picked: (user, side, emoji, cc) => `${user} picked **${side}** ${emoji} and bet ${cc}`,
        landed: (side, emoji) => `🪙 The coin landed on **${side}** ${emoji}`,
        winPays: (multiplier) => `A win pays ${multiplier} the bet`,
        // Slots
        slotsTitle: '🎰 Slots',
        slotsPair: 'two of a kind = your bet back',
        betBy: (user, cc) => `${user} bet ${cc}`,
        slotsLost: (cc) => `😅 Better luck next time, you lost ${cc}`,
        slotsTriple: (symbol, multiplier, cc) => `🎉 **Three ${symbol}!** ×${multiplier} → ${cc}`,
        slotsBack: (cc) => `🙂 Two of a kind: your bet is back (${cc})`,
        // Dice
        diceTitle: '🎲 Dice',
        directionName: (direction) => direction,
        diceRule: (direction, line) => (direction === 'under' ? `below ${line}.00` : `${line}.00 or more`),
        diceBet: (user, cc, side, line, emoji, rule) => `${user} bet ${cc} on **${side} ${line}** ${emoji} (it needs ${rule})`,
        diceFooter: (chance, multiplier) => `Win chance ${chance}% ・ A win pays ${multiplier} the bet`,
        // Chicken
        chickenTitle: '🐔 Chicken',
        chickenLine: (userId, cc) => `<@${userId}> ・ 💵 Bet: ${cc}`,
        crossed: (steps, all) => `🐔 The chicken crossed **${steps}** of **${all}** lanes`,
        nextLane: (multiplier, cc, chance) => `⏭️ Next lane: **${multiplier}** → ${cc} (${chance}% chance to make it)`,
        chickenIdleRule: `⏰ Leave the chicken alone for ${idleSeconds} seconds and it cashes out by itself at the current multiplier (with no lane crossed you get your whole bet back).`,
        stepButton: 'Step',
        chickenBroken: (cc) => `⚠️ An old chicken game was damaged, so it was closed and your bet of ${cc} was given back.`,
        chickenLost: (lane, cc) => `💀 **Splat!** A car hit the chicken on lane **${lane}** and you lost ${cc}. 🍗`,
        chickenCrossed: (multiplier, cc) => `🏆 The chicken crossed the whole road! You took **${multiplier}** → ${cc}.`,
        chickenTimeout: (multiplier, cc) => `⏰ The chicken stood still for ${idleSeconds} seconds, so it cashed out by itself at **${multiplier}** → ${cc}.`,
        chickenCashedOut: (multiplier, cc) => `✅ You cashed out at **${multiplier}** and took ${cc}.`,
        chickenFate: (lane) => (lane === null ? '🔍 It would have crossed the whole road safely.' : `🔍 The car was waiting on lane **${lane}**.`),
        previousChicken: (cc) => `⏰ Your last chicken game was left idle, so it closed by itself and paid you ${cc}.`,
        chickenActive: (ends) => `⚠️ You have a chicken game running: finish it or cash out first${ends}.`,
        // Usage: one typed example per game. `crash` is the rocket.
        usage: {
            mines: () => `💣 \`mines 100 3\` ・ Mines: open tiles without hitting a mine (${CASINO.mines.min} to ${CASINO.mines.max} mines) and cash out whenever you like`,
            coinflip: () => `🪙 \`coinflip 100 heads\` ・ Heads or tails, a win pays ${coinflipTimes()}`,
            slots: () => `🎰 \`slots 100\` ・ Slots, three of a kind pays up to ×${topSlots()}`,
            dice: () => '🎲 `dice 100 over 70` or `dice 100 under 30` ・ Dice from 0.00 to 99.99: the smaller your chance, the bigger the win',
            chicken: () => `🐔 \`chicken 100\` ・ Chicken: every lane it crosses raises the multiplier (up to ${topChicken()} after ${lanes()} lanes); cash out before a car hits it`,
            roulette: () => `🎡 \`roulette 100 red\` or \`roulette 100 17\` ・ Group roulette: 🔴 / ⚫ ×${CASINO.roulette.colorPays}, a number from 0 to 36 ×${CASINO.roulette.numberPays}`,
            rocket: () => '🚀 `rocket 100` or `rocket 100 2` (or `crash 100 2.5`) ・ Rocket (group crash): ride with the room and cash out before it blows up',
        },
        casinoHead: () => `🎰 **Casino** ・ Bets from ${number(CASINO.minBet)} ${CC.short} up to your balance${CASINO.unlimited ? '' : ` (max bet ${number(CASINO.maxBet)})`}`,
        menuHint: '🎮 Type `games` to see every game and how it works.',
        writeItSo: (example) => `❌ Type it like this: ${example}`,
        gamesHint: '🎮 Type `games` to see every game.',
        // Failures
        badBet: () => `❌ The bet must be a whole number from **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' up' : ` to **${number(CASINO.maxBet)}** ${CC.short}`}.`,
        noCC: (cc) => `❌ Your balance ${cc} is not enough for this bet.`,
        active: (ends) => `⚠️ You have a mines game running: finish it or cash out first${ends}.`,
        activeEnds: (at) => ` (it closes by itself <t:${at}:R> if you don't play)`,
        badTarget: () => `❌ The multiplier must be from **${multiplierText(CASINO.crash.minTarget)}** to **${multiplierText(CASINO.crash.maxTarget)}** (for example \`2.5\`).`,
        badDice: (minChance, maxChance) => `❌ Pick \`under\` a number from ${minChance} to ${maxChance} or \`over\` a number from ${100 - maxChance} to ${100 - minChance} (for example \`dice 100 over 70\`).`,
        tooMany: () => `❌ At most ${CASINO.roulette.maxBetsPerMember} bets each in one round.`,
        failures: {
            bad_mines: `❌ The number of mines must be from ${CASINO.mines.min} to ${CASINO.mines.max}.`,
            bad_side: '❌ Pick `heads` or `tails`.',
            cooldown: '⏳ Wait a second before the next game.',
            bad_choice: '❌ Pick 🔴 `red`, ⚫ `black`, 🟢 `green` or a number from 0 to 36.',
            busy: '⏳ A round is being played in this room right now: wait for it to end and start the next one.',
            full: '❌ This round is full, wait for the next one.',
            joined: '🧑‍🚀 You are already on this rocket, wait for take-off.',
        },
        unknown: '❌ Something went wrong, try again.',
        error: '❌ Something went wrong. Try again in a moment.',
    },
};

const say = (lang) => inLang(lang, TEXT);

function profitLine(bet, payout, lang) {
    const text = say(lang);
    if (payout > bet) return text.profitUp(formatCC(payout - bet));
    if (payout < bet) return text.profitDown(formatCC(bet - payout));
    return text.profitEven;
}

const balanceLine = (balance, lang) => (Number.isSafeInteger(balance) ? [say(lang).balance(formatCC(balance))] : []);

/**
 * The 3×3 board as buttons (`casino:pick:<gameId>:<cell>:<userId>`). While it runs a closed cell looks the
 * same whether it hides a mine or not; at the end every cell shows (💥 the mine that was hit).
 */
function boardRows(game, userId, { over = false } = {}) {
    const { cells, columns } = CASINO.mines;
    const rows = [];
    for (let start = 0; start < cells; start += columns) {
        const row = new ActionRowBuilder();
        for (let cell = start; cell < start + columns; cell += 1) {
            const button = new ButtonBuilder().setCustomId(`${CASINO_BUTTON_PREFIX}:pick:${game.id}:${cell}:${userId}`);
            if (game.picks.includes(cell)) button.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
            else if (!over) button.setEmoji('❔').setStyle(ButtonStyle.Secondary);
            else if (cell === game.hit) button.setEmoji('💥').setStyle(ButtonStyle.Danger).setDisabled(true);
            else if (game.mines.includes(cell)) button.setEmoji('💣').setStyle(ButtonStyle.Secondary).setDisabled(true);
            else button.setEmoji('💎').setStyle(ButtonStyle.Secondary).setDisabled(true);
            row.addComponents(button);
        }
        rows.push(row);
    }
    return rows;
}

const gameLine = (game, userId, lang) => say(lang).minesLine(userId, formatCC(game.bet), game.mines.length);

/**
 * A running mines board: what cashing out pays now, what the next safe cell would pay, and the timeout rule. In
 * the board's own language (`game.lang`, saved when it opened) unless `lang` says otherwise.
 */
export function minesBoardPayload(game, userId, { note = '', lang = game.lang } = {}) {
    const text = say(lang);
    const mines = game.mines.length;
    const picks = game.picks.length;
    const safe = CASINO.mines.cells - mines;
    const now = minesPayout(game.bet, mines, picks);
    const embed = ccEmbed(text.minesTitle, [
        ...(note ? [note, ''] : []),
        gameLine(game, userId, lang),
        text.opened(picks, safe),
        '',
        text.cashOutNow(times(minesMultiplierHundredths(mines, picks)), formatCC(now)),
        ...(picks < safe ? [text.nextCell(times(minesMultiplierHundredths(mines, picks + 1)), formatCC(minesPayout(game.bet, mines, picks + 1)))] : []),
        '',
        text.idleRule,
    ].join('\n'));
    const cashOut = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:cashout:${game.id}:${userId}`)
            .setLabel(text.cashOutButton(number(now)))
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary),
    );
    return { content: '', embeds: [embed], components: [...boardRows(game, userId), cashOut], allowedMentions: { parse: [] } };
}

/** The language of an ended board: the board's own (a damaged board, whose language can't be read, is Arabic). */
const resultLanguage = (result, lang) => readLang(lang ?? result.game?.lang);

/** The line about an ended board, also sent alone when its message can't be edited any more. */
function minesEndLine(result, lang) {
    const text = say(lang);
    const { game, payout, outcome } = result;
    if (!game) return text.minesBroken(formatCC(payout));
    const multiplier = times(minesMultiplierHundredths(game.mines.length, game.picks.length));
    if (outcome === 'lost') return text.minesLost(formatCC(game.bet));
    if (outcome === 'cleared') return text.minesCleared(multiplier, formatCC(payout));
    if (outcome === 'timeout') return text.minesTimeout(multiplier, formatCC(payout));
    return text.minesCashedOut(multiplier, formatCC(payout));
}

/** An ended board (lost, cashed out, cleared or timed out): every cell shown, no button works any more. */
export function minesResultPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    if (!result.game) return { content: minesNoticeText(result, userId, shown), embeds: [], components: [], allowedMentions: { parse: [] } };
    const embed = ccEmbed(say(shown).minesTitle, [
        gameLine(result.game, userId, shown),
        '',
        minesEndLine(result, shown),
        `📊 ${profitLine(result.game.bet, result.payout, shown)}`,
        ...balanceLine(result.balance, shown),
    ].join('\n'));
    return { content: '', embeds: [embed], components: boardRows(result.game, userId, { over: true }), allowedMentions: { parse: [] } };
}

/** `<@member> …` in the board's room when its message is gone (timeout after a restart, or a damaged game). */
export function minesNoticeText(result, userId, lang = null) {
    return `<@${userId}> ${minesEndLine(result, resultLanguage(result, lang))}`;
}

// ---- Chicken ----

// How many lanes the road shows at once: the chicken, a couple of lanes behind it and the lanes ahead.
const ROAD_LANES = 8;

/**
 * The road as one line of emojis: `🟫🟩🟩🐔⬜⬛⬛⬛⬛⋯` — 🟩 the lanes crossed, 🐔 the chicken (💀 where a car got it),
 * ⬜ the next lane, ⬛ the road ahead, 🏁 the far side (⋯ for lanes off screen, 🟫 the sidewalk it started on).
 * At the end (`over`) the lane where the car was waiting shows 🚗.
 */
export function chickenRoad(game, { over = false, dead = false } = {}) {
    const all = CASINO.chicken.maxSteps;
    const at = dead ? game.deathStep : game.steps;
    const first = Math.max(1, Math.min(at - 2, all - ROAD_LANES + 1));
    const last = Math.min(all, first + ROAD_LANES - 1);
    const lane = (n) => {
        if (n === at) return dead ? '💀' : '🐔';
        if (n < at) return '🟩';
        if (over) return n === game.deathStep ? '🚗' : '⬛';
        return n === at + 1 ? '⬜' : '⬛';
    };
    const start = first > 1 ? '⋯' : (at === 0 ? '🐔' : '🟫');
    const road = Array.from({ length: last - first + 1 }, (_, i) => lane(first + i)).join('');
    return `${start}${road}${last === all ? '🏁' : '⋯'}`;
}

const chickenLine = (game, userId, lang) => say(lang).chickenLine(userId, formatCC(game.bet));

/**
 * A running chicken: the road, what cashing out pays now, what the next lane would pay (and its chance), the
 * timeout rule and its two buttons, 🐔 Step (`casino:chick:<gameId>:<steps>:<userId>`, with the lanes crossed so far,
 * so a second press of the same board can't move the chicken again) and 💰 Cash out
 * (`casino:chickout:<gameId>:<userId>`). In the game's own language (`game.lang`) unless `lang` says otherwise.
 * Nothing on it tells where the car waits.
 */
export function chickenBoardPayload(game, userId, { note = '', lang = game.lang } = {}) {
    const text = say(lang);
    const all = CASINO.chicken.maxSteps;
    const now = chickenPayout(game.bet, game.steps);
    const embed = ccEmbed(text.chickenTitle, [
        ...(note ? [note, ''] : []),
        chickenLine(game, userId, lang),
        text.crossed(game.steps, all),
        chickenRoad(game),
        '',
        text.cashOutNow(times(chickenMultiplierHundredths(game.steps)), formatCC(now)),
        ...(game.steps < all ? [text.nextLane(times(chickenMultiplierHundredths(game.steps + 1)), formatCC(chickenPayout(game.bet, game.steps + 1)), chickenSurvivePercent())] : []),
        '',
        text.chickenIdleRule,
    ].join('\n'));
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:chick:${game.id}:${game.steps}:${userId}`)
            .setLabel(text.stepButton)
            .setEmoji('🐔')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:chickout:${game.id}:${userId}`)
            .setLabel(text.cashOutButton(number(now)))
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary),
    );
    return { content: '', embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

/** The line about an ended chicken, also sent alone when its message can't be edited any more. */
function chickenEndLine(result, lang) {
    const text = say(lang);
    const { game, payout, outcome } = result;
    if (!game) return text.chickenBroken(formatCC(payout));
    if (outcome === 'lost') return text.chickenLost(game.deathStep, formatCC(game.bet));
    const multiplier = times(chickenMultiplierHundredths(game.steps));
    if (outcome === 'crossed') return text.chickenCrossed(multiplier, formatCC(payout));
    if (outcome === 'timeout') return text.chickenTimeout(multiplier, formatCC(payout));
    return text.chickenCashedOut(multiplier, formatCC(payout));
}

/**
 * An ended chicken (run over, cashed out, timed out or across the whole road): the road with the chicken where it
 * stopped (💀 where it died, 🚗 where the car was waiting), the payout, the profit and the balance. No buttons.
 */
export function chickenResultPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    if (!result.game) return { content: chickenNoticeText(result, userId, shown), embeds: [], components: [], allowedMentions: { parse: [] } };
    const text = say(shown);
    const { game, outcome } = result;
    const dead = outcome === 'lost';
    const embed = ccEmbed(text.chickenTitle, [
        chickenLine(game, userId, shown),
        chickenRoad(game, { over: true, dead }),
        '',
        chickenEndLine(result, shown),
        ...(outcome === 'cashout' || outcome === 'timeout' ? [text.chickenFate(game.deathStep)] : []),
        `📊 ${profitLine(game.bet, result.payout, shown)}`,
        ...balanceLine(result.balance, shown),
    ].join('\n'));
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** `<@member> …` in the chicken's room when its message is gone (timeout after a restart, or a damaged game). */
export function chickenNoticeText(result, userId, lang = null) {
    return `<@${userId}> ${chickenEndLine(result, resultLanguage(result, lang))}`;
}

// ---- Either saved game ----

/** Which saved game a result, a refusal or a game settled on the way is about: 'chicken', else 'mines'. */
const kindOf = (result) => ((result?.game?.game ?? result?.kind) === 'chicken' ? 'chicken' : 'mines');

/** An ended saved game, with its own embed (a mines board or a chicken). */
export function gameResultPayload(result, userId, lang = null) {
    return kindOf(result) === 'chicken' ? chickenResultPayload(result, userId, lang) : minesResultPayload(result, userId, lang);
}

/** The short notice of an ended saved game whose message is gone. */
export function gameNoticeText(result, userId, lang = null) {
    return kindOf(result) === 'chicken' ? chickenNoticeText(result, userId, lang) : minesNoticeText(result, userId, lang);
}

/** The line shown with a new game when an older board or chicken was settled first (in the new command's language). */
export function previousGameNote(previous, lang) {
    const text = say(lang);
    return (kindOf(previous) === 'chicken' ? text.previousChicken : text.previousGame)(formatCC(previous.payout));
}

export function coinflipPayload(result, user, lang) {
    const text = say(lang);
    const chosen = COIN_SIDES[result.side];
    const landed = COIN_SIDES[result.landed];
    const embed = ccEmbed(text.coinflipTitle, [
        text.picked(user, text.sideName(result.side), chosen.emoji, formatCC(result.bet)),
        text.landed(text.sideName(result.landed), landed.emoji),
        '',
        result.payout > 0 ? text.won(formatCC(result.payout), coinflipTimes()) : text.lost(formatCC(result.bet)),
        ...balanceLine(result.balance, lang),
    ].join('\n'));
    embed.footer = { text: text.winPays(coinflipTimes()) };
    return quiet(embed);
}

/** `🌀🌀🌀 ×25 ・ … ・ اتنين زي بعض = رهانك يرجع`, best first. */
export function slotsTableText(lang) {
    const triples = Object.entries(CASINO.slots.triple).sort((a, b) => b[1] - a[1]).map(([symbol, multiplier]) => `${symbol.repeat(3)} ×${multiplier}`);
    return [...triples, say(lang).slotsPair].join(' ・ ');
}

export function slotsPayload(result, user, lang) {
    const text = say(lang);
    const { bet, payout, kind, symbol, multiplier, reels } = result;
    let line = text.slotsLost(formatCC(bet));
    if (kind === 'triple') line = text.slotsTriple(symbol, multiplier, formatCC(payout));
    else if (kind === 'pair') line = text.slotsBack(formatCC(payout));
    const embed = ccEmbed(text.slotsTitle, [
        text.betBy(user, formatCC(bet)),
        '',
        `# ${reels.join(' | ')}`,
        '',
        line,
        ...balanceLine(result.balance, lang),
    ].join('\n'));
    embed.footer = { text: slotsTableText(lang) };
    return quiet(embed);
}

// ---- Dice ----

const rollText = (roll) => (roll / 100).toFixed(2);

/** `0 🟩🟩🟩🎲🟥🟥🟥🟥🟥🟥 100`: the win zone (🟩), the lose zone (🟥) and where the dice landed (🎲). */
export function diceBar(result) {
    const cells = 10;
    const width = CASINO.dice.faces / cells;
    const bar = Array.from({ length: cells }, (_, cell) => {
        if (Math.floor(result.roll / width) === cell) return '🎲';
        return diceWins(cell * width + width / 2, result.direction, result.number) ? '🟩' : '🟥';
    });
    return `0 ${bar.join('')} 100`;
}

export function dicePayload(result, user, lang) {
    const text = say(lang);
    const side = DICE_DIRECTIONS[result.direction];
    const multiplier = diceMultiplierHundredths(result.chance);
    const embed = ccEmbed(text.diceTitle, [
        text.diceBet(user, formatCC(result.bet), text.directionName(result.direction), result.number, side.emoji, text.diceRule(result.direction, result.number)),
        '',
        `# 🎲 ${rollText(result.roll)}`,
        diceBar(result),
        '',
        result.payout > 0 ? text.won(formatCC(result.payout), times(multiplier)) : text.lost(formatCC(result.bet)),
        ...balanceLine(result.balance, lang),
    ].join('\n'));
    embed.footer = { text: text.diceFooter(result.chance, times(multiplier)) };
    return quiet(embed);
}

// ---- Usage and failures ----

/** One typed example per game, for the usage answers, in each language (`GAME_USAGE.en.rocket()`...). */
export const GAME_USAGE = { ar: TEXT.ar.usage, en: TEXT.en.usage };

/** `مينز 100 3` … / `mines 100 3` …: how to play, for a typed casino command without a game or a bet. */
export function casinoUsageText(lang) {
    const text = say(lang);
    return [text.casinoHead(), ...Object.values(text.usage).map((line) => line()), text.menuHint].join('\n');
}

/** How to play one game, for its typed command with words that don't fit. */
export function gameUsageText(game, lang) {
    const text = say(lang);
    return [text.writeItSo(text.usage[game]()), text.gamesHint].join('\n');
}

/** Why a game didn't start, as a message. */
export function casinoFailureText(result, lang) {
    const text = say(lang);
    if (result.reason === 'bad_bet') return text.badBet();
    if (result.reason === 'no_cc') return text.noCC(formatCC(result.balance ?? 0));
    if (result.reason === 'active') {
        const ends = Number.isFinite(result.game?.lastActionAt) ? text.activeEnds(Math.ceil((result.game.lastActionAt + CASINO.idleMs) / 1000)) : '';
        return kindOf(result) === 'chicken' ? text.chickenActive(ends) : text.active(ends);
    }
    if (result.reason === 'bad_target') return text.badTarget();
    if (result.reason === 'bad_dice') return text.badDice(CASINO.dice.minChance, CASINO.dice.maxChance);
    if (result.reason === 'too_many') return text.tooMany();
    return text.failures[result.reason] || text.unknown;
}

/** The answer when a casino command or button failed unexpectedly. */
export const casinoErrorText = (lang) => say(lang).error;

// casinoUi.js — the casino's solo-game embeds and buttons, shared by the `casino` command
// (src/commands/Games/casino.js), the mines and chicken buttons (src/interactions/buttons/store/casino.js) and
// the timeout and restart check of those saved games (casinoSessions.js). The group rounds are casinoGroupUi.js.
// Plain embed objects so the emojis stay; each Arabic line starts with Arabic or an emoji so Discord doesn't
// reorder it. Every text exists in Arabic and English (TEXT below, 'ar' by default); the language comes from the
// command (src/services/cc/lang.js), and a mines board or a chicken keeps the language it was opened in (its
// saved `lang`). gameResultPayload, gameNoticeText, previousGameNote and the 'active' refusal show whichever
// saved game they are about (a result's `game.game`, or `kind` for a damaged one; mines when it can't be told).
//
// A game bet all-in (`كل` / `all`: its result's or saved game's `allIn`) ends its first line with the all-in tag
// (`🔥 كل فلوسه` / `🔥 all-in`); its bet shows the real number taken. Without it every line is as it was.
//
// Every message has the same shape: the game in the title (its own colour while it runs, green / red / gold by
// the outcome once it ends: CASINO_COLORS), a first line with the player and the bet, the game's picture (the
// board, the coin, the reels, the roll, the road), the result in big letters, the money in a quote block (bet,
// payout, profit or loss, balance) and the odds or a hint in the footer. Every emoji comes from the registry
// (src/config/emojis.js, CASINO_EMOJIS swaps in the server's custom emojis): E() where Discord shows custom
// emojis (descriptions, buttons), P() where it can't (titles, footers, labels), always Unicode.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CC, ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, COIN_SIDES, DICE_DIRECTIONS, HORSES_COUNT, casinoColor, outcomeOf } from '../../config/casino.js';
import { SLOT_SYMBOL_KEYS, casinoEmoji as E, plainEmoji as P } from '../../config/emojis.js';
import {
    blackjackPayout, chickenMultiplierHundredths, chickenPayout, chickenSurvivePercent, diceMultiplierHundredths, diceWins,
    handScore, isNaturalBlackjack, isSoftHand, minesPayout, minesMultiplierHundredths,
} from './casinoService.js';
import { multiplierText } from './casinoGroupUi.js';
import { placesLine } from './casinoHorses.js';
import { inLang, readLang } from './lang.js';

const number = (value) => Number(value || 0).toLocaleString('en-US');
const idleSeconds = Math.round(CASINO.idleMs / 1000);
const times = (hundredths) => `×${(hundredths / 100).toFixed(2)}`;
const coinflipTimes = () => times(CASINO.coinflip.payoutPercent);
const topSlots = () => Math.max(...Object.values(CASINO.slots.triple));
const lanes = () => CASINO.chicken.maxSteps;
const topChicken = () => times(chickenMultiplierHundredths(CASINO.chicken.maxSteps));
const quiet = (embed, components = []) => ({ content: '', embeds: [embed], components, allowedMentions: { parse: [] } });
// How many multipliers the ladder shows after the next tile or lane.
const LADDER_STEPS = 3;
/** `from`, `from + 1`, … `to` (nothing when `to < from`). */
const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const TEXT = {
    ar: {
        profitUp: (cc) => `${E('ui.profit')} مكسب ${cc}`,
        profitDown: (cc) => `${E('ui.loss')} خسارة ${cc}`,
        profitEven: () => `${E('ui.push')} رهانك رجعلك زي ما هو`,
        balance: (cc) => `${E('ui.balance')} رصيدك: ${cc}`,
        stake: (bet, payout) => `${E('ui.bet')} الرهان: ${bet} ・ ${E('ui.payout')} خدت: ${payout}`,
        won: (cc, multiplier) => `${E('ui.win')} كسبت! خدت ${cc} (${multiplier})`,
        lost: (cc) => `${E('ui.lose')} خسرت ${cc}`,
        ladder: (steps) => `${E('ui.ladder')} بعدها: ${steps.join(' ← ')}`,
        allIn: () => `${E('ui.allIn')} **كل فلوسه**`,
        // Mines
        minesTitle: () => `${P('mines.icon')} ماينز`,
        minesLine: (userId, cc, mines) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} الرهان: ${cc} ・ ${E('mines.bomb')} الألغام: **${mines}**`,
        opened: (picks, safe) => `${E('mines.safe')} فتحت **${picks}** من **${safe}** خانات أمان`,
        cashOutNow: (multiplier, cc) => `${E('ui.cashout')} الكاش أوت دلوقتي: **${multiplier}** ← ${cc}`,
        nextCell: (multiplier, cc) => `${E('ui.next')} الخانة الجاية: **${multiplier}** ← ${cc}`,
        idleRule: () => `${P('ui.timer')} لو سبت اللعبة ${idleSeconds} ثانية من غير لعب، بتعمل كاش أوت لوحدها بالمضاعف الحالي (ولو مافتحتش ولا خانة رهانك بيرجعلك كامل).`,
        cashOutButton: (amount) => `كاش أوت · ${amount} ${CC.short}`,
        minesBroken: (cc) => `${E('ui.warning')} لعبة ماينز قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${cc}.`,
        minesLost: (cc) => `${E('mines.hit')} **بوم!** لقيت لغم وخسرت ${cc}.`,
        minesCleared: (multiplier, cc) => `${E('ui.trophy')} فتحت كل خانات الأمان! خدت **${multiplier}** ← ${cc}.`,
        minesTimeout: (multiplier, cc) => `${E('ui.timer')} اللعبة فضلت ${idleSeconds} ثانية من غير لعب فعملت كاش أوت لوحدها بـ **${multiplier}** ← ${cc}.`,
        minesCashedOut: (multiplier, cc) => `${E('ui.done')} عملت كاش أوت بـ **${multiplier}** وخدت ${cc}.`,
        minesOdds: (mines, safe, top) => `${P('mines.bomb')} الألغام: ${mines} ・ ${P('mines.safe')} خانات الأمان: ${safe} ・ ${P('ui.trophy')} أقصى مضاعف: ${top}`,
        previousGame: (cc) => `${E('ui.timer')} لعبة الماينز اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${cc}.`,
        // Coinflip
        coinflipTitle: () => `${P('coin.icon')} ملك ولا كتابة`,
        sideName: (side) => COIN_SIDES[side].name,
        picked: (user, side, emoji, cc) => `${E('ui.player')} ${user} اختار **${side}** ${emoji} وراهن بـ ${cc}`,
        landed: (side, emoji) => `${E('coin.icon')} العملة وقعت: **${side}** ${emoji}`,
        winPays: (multiplier) => `المكسب ${multiplier} من الرهان`,
        // Slots
        slotsTitle: () => `${P('slots.icon')} سلوت`,
        slotsPair: 'اتنين زي بعض = رهانك يرجع',
        betBy: (user, cc) => `${E('ui.player')} ${user} راهن بـ ${cc}`,
        slotsLost: (cc) => `${E('slots.miss')} حظ أوفر المرة الجاية، خسرت ${cc}`,
        slotsTriple: (symbol, multiplier, cc) => `${E('ui.win')} **3 ${symbol} زي بعض!** ×${multiplier} ← ${cc}`,
        slotsBack: (cc) => `${E('slots.pair')} اتنين زي بعض: رهانك رجعلك (${cc})`,
        // Dice
        diceTitle: () => `${P('dice.icon')} نرد`,
        directionName: (direction) => DICE_DIRECTIONS[direction].name,
        diceRule: (direction, line) => (direction === 'under' ? `أقل من ${line}.00` : `${line}.00 أو أكتر`),
        diceBet: (user, cc, side, line, emoji, rule) => `${E('ui.player')} ${user} راهن بـ ${cc} على **${side} ${line}** ${emoji} (لازم يطلع ${rule})`,
        diceFooter: (chance, multiplier) => `فرصة المكسب ${chance}% ・ المكسب ${multiplier} من الرهان`,
        // Chicken
        chickenTitle: () => `${P('chicken.icon')} الفرخة`,
        chickenLine: (userId, cc) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} الرهان: ${cc}`,
        crossed: (steps, all) => `${E('chicken.alive')} الفرخة عدّت **${steps}** من **${all}** حارة`,
        nextLane: (multiplier, cc, chance) => `${E('ui.next')} الحارة الجاية: **${multiplier}** ← ${cc} (فرصة إنها تعدّي ${chance}%)`,
        chickenIdleRule: () => `${P('ui.timer')} لو سبت الفرخة ${idleSeconds} ثانية من غير ما تتقدّم، بتعمل كاش أوت لوحدها بالمضاعف الحالي (ولو ماعدّتش ولا حارة رهانك بيرجعلك كامل).`,
        stepButton: 'تقدّم',
        chickenBroken: (cc) => `${E('ui.warning')} لعبة فرخة قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${cc}.`,
        chickenLost: (lane, cc) => `${E('chicken.dead')} **الفرخة اتفرمت!** عربية خبطتها في الحارة **${lane}** وخسرت ${cc}. ${E('chicken.food')}`,
        chickenCrossed: (multiplier, cc) => `${E('ui.trophy')} الفرخة عدّت الطريق كله! خدت **${multiplier}** ← ${cc}.`,
        chickenTimeout: (multiplier, cc) => `${E('ui.timer')} الفرخة فضلت واقفة ${idleSeconds} ثانية من غير لعب فعملت كاش أوت لوحدها بـ **${multiplier}** ← ${cc}.`,
        chickenCashedOut: (multiplier, cc) => `${E('ui.done')} عملت كاش أوت بـ **${multiplier}** وخدت ${cc}.`,
        chickenFate: (lane) => (lane === null ? `${E('ui.reveal')} كانت هتعدّي الطريق كله سليمة.` : `${E('ui.reveal')} العربية كانت مستنياها في الحارة **${lane}**.`),
        chickenOdds: (chance, top, all) => `${P('chicken.alive')} كل حارة فرصة إنها تعدّيها ${chance}% ・ ${P('ui.trophy')} أقصى مضاعف ${top} بعد ${all} حارة`,
        previousChicken: (cc) => `${E('ui.timer')} لعبة الفرخة اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${cc}.`,
        chickenActive: (ends) => `⚠️ عندك لعبة فرخة شغالة، كملها أو اعمل كاش أوت الأول${ends}.`,
        // Blackjack
        blackjackTitle: () => `${P('blackjack.icon')} بلاك جاك`,
        blackjackLine: (userId, cc) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} الرهان: ${cc}`,
        dealerName: (score) => `🤵 الموزع ・ [ ${score} ]`,
        playerName: (score) => `🧑 انت ・ [ ${score} ]`,
        blackjackPlaying: () => '🎲 اللعبة شغالة',
        blackjackLegend: () => `🃏 سحب = كارت زيادة ・ ✋ وقف = الموزع يلعب ・ 💰 دبل = ضعف الرهان وكارت واحد ・ ℹ️ شرح`,
        blackjackHelp: () => [
            '🎯 **الهدف:** مجموع كروتك يقرّب من 21 من غير ما يعدّيها، وأحسن من الموزع.',
            '🃏 **سحب:** كارت زيادة (لو عدّيت 21 بتخسر).',
            '✋ **وقف:** بتثبّت إيدك والموزع يلعب (بيقف عند 17).',
            '💰 **دبل:** بتضاعف الرهان وتاخد كارت واحد بس وتقف (في أول كارتين بس).',
            '🏆 **الدفع:** بلاك جاك (آص + 10 من أول كارتين) ×2.50 ・ كسب عادي ×2 ・ تعادل رهانك يرجع.',
            '💡 **نصايح:** دبل على 10 أو 11 ・ وقف على 17 أو أكتر ・ اسحب لو مجموعك 11 أو أقل.',
            `⏰ لو سبت اللعبة ${idleSeconds} ثانية بتعمل وقف لوحدها والنتيجة بتتحسب عادي.`,
        ].join('\n'),
        hitButton: 'سحب',
        standButton: 'وقف',
        doubleButton: 'دبل',
        blackjackBroken: (cc) => `${E('ui.warning')} لعبة بلاك جاك قديمة كانت بايظة فاتقفلت ورجعلك رهانك ${cc}.`,
        blackjackNatural: (cc) => `${E('ui.trophy')} **بلاك جاك!** كسبت +${cc}`,
        blackjackWon: (cc) => `${E('ui.win')} **كسبت** +${cc}`,
        blackjackPush: (cc) => `${E('ui.push')} **تعادل**، رهانك رجعلك (${cc})`,
        blackjackLost: (cc) => `${E('ui.lose')} **خسرت** -${cc}`,
        blackjackBust: (cc) => `${E('ui.lose')} **احترقت** -${cc}`,
        blackjackOdds: () => `🃏 البلاك جاك يدفع 3:2 (×2.50) ・ الموزع يقف إجبارياً عند 17 أو أكثر`,
        previousBlackjack: (cc) => `${E('ui.timer')} لعبة البلاك جاك اللي فاتت كانت واقفة فاتقفلت لوحدها، واتصرفلك منها ${cc}.`,
        blackjackActive: (ends) => `⚠️ عندك لعبة بلاك جاك شغالة، كملها أو اقف الأول${ends}.`,
        // Usage: one typed example per game. `كراش` is the rocket.
        usage: {
            mines: () => `💣 \`مينز 100 3\` ・ ماينز: افتح خانات من غير ما تلاقي لغم (من ${CASINO.mines.min} لـ ${CASINO.mines.max} ألغام) واعمل كاش أوت وقت ما تحب`,
            coinflip: () => `🪙 \`عملة 100 ملك\` ・ ملك ولا كتابة، المكسب ${coinflipTimes()}`,
            slots: () => `🎰 \`سلوت 100\` ・ سلوت، 3 زي بعض لحد ×${topSlots()}`,
            dice: () => `🎲 \`نرد 100 فوق 70\` أو \`نرد 100 تحت 30\` ・ نرد من 0.00 لـ 99.99، وكل ما الفرصة أقل المكسب أكبر`,
            chicken: () => `🐔 \`فرخة 100\` ・ الفرخة: كل حارة تعدّيها بتكبّر المضاعف (لحد ${topChicken()} بعد ${lanes()} حارة)، واعمل كاش أوت قبل ما عربية تخبطها`,
            roulette: () => `🎡 \`روليت 100 احمر\` أو \`روليت 100 17\` ・ روليت جماعي: 🔴 / ⚫ ×${CASINO.roulette.colorPays}، رقم من 0 لـ 36 ×${CASINO.roulette.numberPays}`,
            rocket: () => `🚀 \`صاروخ 100\` أو \`صاروخ 100 2\` (أو \`كراش 100 2.5\`) ・ صاروخ (كراش جماعي): اركب مع الروم واعمل كاش أوت قبل ما ينفجر`,
            blackjack: () => '🃏 `بلاك جاك 100` ・ بلاك جاك: العب ضد الموزع للوصول لـ 21، سحب ووقف ودبل، ومكسب البلاك جاك ×2.50',
            horses: () => `🏇 \`احصنة 100 3\` ・ سباق جماعي: راهن على حصان واحد من 1 لـ ${HORSES_COUNT}، وأول 3 بيكسبوا (${placesLine()})، والسباق بيبدأ بعد ${Math.round(CASINO.horses.joinMs / 1000)} ثانية`,
        },
        casinoHead: () => `🎰 **الكازينو** ・ الرهان من ${number(CASINO.minBet)} ${CC.short} لحد رصيدك${CASINO.unlimited ? '' : ` (أقصى رهان ${number(CASINO.maxBet)})`}`,
        allInHint: () => `🔥 اكتب \`كل\` مكان الرهان وتدخل بكل فلوسك${CASINO.unlimited ? '' : ` (لحد ${number(CASINO.maxBet)})`}: \`صاروخ كل\` ・ \`مينز كل 3\` ・ \`نرد كل فوق 70\``,
        menuHint: '🎮 اكتب `العاب` تشوف كل الألعاب وشرحها.',
        writeItSo: (example) => `❌ اكتبها كده: ${example}`,
        gamesHint: '🎮 اكتب `العاب` تشوف كل الألعاب.',
        // Failures
        badBet: () => `❌ الرهان لازم يكون رقم صحيح من **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' وفوق' : ` لـ **${number(CASINO.maxBet)}** ${CC.short}`}.`,
        noCC: (cc) => `❌ رصيدك ${cc} مش كفاية للرهان ده.`,
        active: (ends) => `⚠️ عندك لعبة ماينز شغالة، كملها أو اعمل كاش أوت الأول${ends}.`,
        activeEnds: (at) => ` (هتقفل لوحدها <t:${at}:R> لو مالعبتش)`,
        // The live countdown on a running board (mines, chicken, blackjack): Discord counts it down, every move resets it.
        idleEnds: (at) => `${E('ui.timer')} هتقفل لوحدها <t:${at}:R> لو مالعبتش`,
        badTarget: () => `❌ المضاعف لازم يكون من **${multiplierText(CASINO.crash.minTarget)}** لـ **${multiplierText(CASINO.crash.maxTarget)}** (مثلًا \`2.5\`).`,
        badDice: (minChance, maxChance) => `❌ اختار \`تحت\` رقم من ${minChance} لـ ${maxChance} أو \`فوق\` رقم من ${100 - maxChance} لـ ${100 - minChance} (مثلًا \`نرد 100 فوق 70\`).`,
        tooMany: (max) => `❌ أقصى حاجة ${max} رهانات ليك في الجولة الواحدة.`,
        otherHorse: (horse) => `❌ إنت راهنت على الحصان \`#${horse}\` خلاص: حصان واحد بس في السباق، تقدر تزود على نفس الحصان.`,
        failures: {
            bad_mines: `❌ عدد الألغام لازم يكون من ${CASINO.mines.min} لـ ${CASINO.mines.max}.`,
            bad_side: '❌ اختار `ملك` أو `كتابة`.',
            cooldown: '⏳ استنى ثانية قبل اللعبة الجاية.',
            bad_choice: '❌ اختار 🔴 `احمر` أو ⚫ `اسود` أو 🟢 `اخضر` أو رقم من 0 لـ 36.',
            bad_horse: `❌ اختار حصان من 1 لـ ${HORSES_COUNT} (مثلًا \`احصنة 100 3\`).`,
            busy: '⏳ فيه جولة شغالة في الروم دلوقتي، استنى لما تخلص وابدأ اللي بعدها.',
            full: '❌ الجولة دي اتملت، استنى اللي بعدها.',
            joined: '🧑‍🚀 انت راكب الصاروخ ده خلاص، استنى الإقلاع.',
        },
        unknown: '❌ حصلت مشكلة، جرب تاني.',
        error: '❌ حصل خطأ. حاول تاني بعد شوية.',
    },
    en: {
        profitUp: (cc) => `${E('ui.profit')} Profit ${cc}`,
        profitDown: (cc) => `${E('ui.loss')} Loss ${cc}`,
        profitEven: () => `${E('ui.push')} You got your bet back`,
        balance: (cc) => `${E('ui.balance')} Your balance: ${cc}`,
        stake: (bet, payout) => `${E('ui.bet')} Bet: ${bet} ・ ${E('ui.payout')} Payout: ${payout}`,
        won: (cc, multiplier) => `${E('ui.win')} You won! You took ${cc} (${multiplier})`,
        lost: (cc) => `${E('ui.lose')} You lost ${cc}`,
        ladder: (steps) => `${E('ui.ladder')} Then: ${steps.join(' → ')}`,
        allIn: () => `${E('ui.allIn')} **all-in**`,
        // Mines
        minesTitle: () => `${P('mines.icon')} Mines`,
        minesLine: (userId, cc, mines) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} Bet: ${cc} ・ ${E('mines.bomb')} Mines: **${mines}**`,
        opened: (picks, safe) => `${E('mines.safe')} You opened **${picks}** of **${safe}** safe tiles`,
        cashOutNow: (multiplier, cc) => `${E('ui.cashout')} Cash out now: **${multiplier}** → ${cc}`,
        nextCell: (multiplier, cc) => `${E('ui.next')} Next tile: **${multiplier}** → ${cc}`,
        idleRule: () => `${P('ui.timer')} Leave the board alone for ${idleSeconds} seconds and it cashes out by itself at the current multiplier (with no tile opened you get your whole bet back).`,
        cashOutButton: (amount) => `Cash out · ${amount} ${CC.short}`,
        minesBroken: (cc) => `${E('ui.warning')} An old mines game was damaged, so it was closed and your bet of ${cc} was given back.`,
        minesLost: (cc) => `${E('mines.hit')} **Boom!** You hit a mine and lost ${cc}.`,
        minesCleared: (multiplier, cc) => `${E('ui.trophy')} You opened every safe tile! You took **${multiplier}** → ${cc}.`,
        minesTimeout: (multiplier, cc) => `${E('ui.timer')} The board sat idle for ${idleSeconds} seconds, so it cashed out by itself at **${multiplier}** → ${cc}.`,
        minesCashedOut: (multiplier, cc) => `${E('ui.done')} You cashed out at **${multiplier}** and took ${cc}.`,
        minesOdds: (mines, safe, top) => `${P('mines.bomb')} Mines: ${mines} ・ ${P('mines.safe')} Safe tiles: ${safe} ・ ${P('ui.trophy')} Top multiplier: ${top}`,
        previousGame: (cc) => `${E('ui.timer')} Your last mines board was left idle, so it closed by itself and paid you ${cc}.`,
        // Coinflip
        coinflipTitle: () => `${P('coin.icon')} Coinflip`,
        sideName: (side) => ({ heads: 'Heads', tails: 'Tails' })[side],
        picked: (user, side, emoji, cc) => `${E('ui.player')} ${user} picked **${side}** ${emoji} and bet ${cc}`,
        landed: (side, emoji) => `${E('coin.icon')} The coin landed on **${side}** ${emoji}`,
        winPays: (multiplier) => `A win pays ${multiplier} the bet`,
        // Slots
        slotsTitle: () => `${P('slots.icon')} Slots`,
        slotsPair: 'two of a kind = your bet back',
        betBy: (user, cc) => `${E('ui.player')} ${user} bet ${cc}`,
        slotsLost: (cc) => `${E('slots.miss')} Better luck next time, you lost ${cc}`,
        slotsTriple: (symbol, multiplier, cc) => `${E('ui.win')} **Three ${symbol}!** ×${multiplier} → ${cc}`,
        slotsBack: (cc) => `${E('slots.pair')} Two of a kind: your bet is back (${cc})`,
        // Dice
        diceTitle: () => `${P('dice.icon')} Dice`,
        directionName: (direction) => direction,
        diceRule: (direction, line) => (direction === 'under' ? `below ${line}.00` : `${line}.00 or more`),
        diceBet: (user, cc, side, line, emoji, rule) => `${E('ui.player')} ${user} bet ${cc} on **${side} ${line}** ${emoji} (it needs ${rule})`,
        diceFooter: (chance, multiplier) => `Win chance ${chance}% ・ A win pays ${multiplier} the bet`,
        // Chicken
        chickenTitle: () => `${P('chicken.icon')} Chicken`,
        chickenLine: (userId, cc) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} Bet: ${cc}`,
        crossed: (steps, all) => `${E('chicken.alive')} The chicken crossed **${steps}** of **${all}** lanes`,
        nextLane: (multiplier, cc, chance) => `${E('ui.next')} Next lane: **${multiplier}** → ${cc} (${chance}% chance to make it)`,
        chickenIdleRule: () => `${P('ui.timer')} Leave the chicken alone for ${idleSeconds} seconds and it cashes out by itself at the current multiplier (with no lane crossed you get your whole bet back).`,
        stepButton: 'Step',
        chickenBroken: (cc) => `${E('ui.warning')} An old chicken game was damaged, so it was closed and your bet of ${cc} was given back.`,
        chickenLost: (lane, cc) => `${E('chicken.dead')} **Splat!** A car hit the chicken on lane **${lane}** and you lost ${cc}. ${E('chicken.food')}`,
        chickenCrossed: (multiplier, cc) => `${E('ui.trophy')} The chicken crossed the whole road! You took **${multiplier}** → ${cc}.`,
        chickenTimeout: (multiplier, cc) => `${E('ui.timer')} The chicken stood still for ${idleSeconds} seconds, so it cashed out by itself at **${multiplier}** → ${cc}.`,
        chickenCashedOut: (multiplier, cc) => `${E('ui.done')} You cashed out at **${multiplier}** and took ${cc}.`,
        chickenFate: (lane) => (lane === null ? `${E('ui.reveal')} It would have crossed the whole road safely.` : `${E('ui.reveal')} The car was waiting on lane **${lane}**.`),
        chickenOdds: (chance, top, all) => `${P('chicken.alive')} Each lane: ${chance}% chance to make it ・ ${P('ui.trophy')} Top multiplier ${top} after ${all} lanes`,
        previousChicken: (cc) => `${E('ui.timer')} Your last chicken game was left idle, so it closed by itself and paid you ${cc}.`,
        chickenActive: (ends) => `⚠️ You have a chicken game running: finish it or cash out first${ends}.`,
        // Blackjack
        blackjackTitle: () => `${P('blackjack.icon')} Blackjack`,
        blackjackLine: (userId, cc) => `${E('ui.player')} <@${userId}> ・ ${E('ui.bet')} Bet: ${cc}`,
        dealerName: (score) => `🤵 Dealer ・ [ ${score} ]`,
        playerName: (score) => `🧑 You ・ [ ${score} ]`,
        blackjackPlaying: () => '🎲 Game in progress',
        blackjackLegend: () => `🃏 Hit = one more card ・ ✋ Stand = dealer plays ・ 💰 Double = 2× bet, 1 card ・ ℹ️ help`,
        blackjackHelp: () => [
            '🎯 **Goal:** get closer to 21 than the dealer without going over.',
            '🃏 **Hit:** one more card (over 21 you lose).',
            '✋ **Stand:** keep your hand and the dealer plays (dealer stands on 17).',
            '💰 **Double:** double the bet, take exactly one card and stand (first two cards only).',
            '🏆 **Payouts:** blackjack (ace + 10 on the first two cards) ×2.50 ・ a normal win ×2 ・ a tie returns your bet.',
            '💡 **Tips:** double on 10 or 11 ・ stand on 17 or more ・ hit on 11 or less.',
            `⏰ Idle for ${idleSeconds}s and you stand automatically, settled as usual.`,
        ].join('\n'),
        hitButton: 'Hit',
        standButton: 'Stand',
        doubleButton: 'Double',
        blackjackBroken: (cc) => `${E('ui.warning')} An old broken blackjack game was settled and refunded ${cc}.`,
        blackjackNatural: (cc) => `${E('ui.trophy')} **Blackjack!** You won +${cc}`,
        blackjackWon: (cc) => `${E('ui.win')} **You won** +${cc}`,
        blackjackPush: (cc) => `${E('ui.push')} **Push**, your bet is back (${cc})`,
        blackjackLost: (cc) => `${E('ui.lose')} **You lost** -${cc}`,
        blackjackBust: (cc) => `${E('ui.lose')} **Bust** -${cc}`,
        blackjackOdds: () => `🃏 Blackjack pays 3:2 (×2.50) ・ Dealer stands on 17`,
        previousBlackjack: (cc) => `${E('ui.timer')} Your previous blackjack game was idle, so you stood automatically and it paid ${cc}.`,
        blackjackActive: (ends) => `⚠️ You have a blackjack game running: finish it or stand first${ends}.`,
        // Usage: one typed example per game. `crash` is the rocket.
        usage: {
            mines: () => `💣 \`mines 100 3\` ・ Mines: open tiles without hitting a mine (${CASINO.mines.min} to ${CASINO.mines.max} mines) and cash out whenever you like`,
            coinflip: () => `🪙 \`coinflip 100 heads\` ・ Heads or tails, a win pays ${coinflipTimes()}`,
            slots: () => `🎰 \`slots 100\` ・ Slots, three of a kind pays up to ×${topSlots()}`,
            dice: () => '🎲 `dice 100 over 70` or `dice 100 under 30` ・ Dice from 0.00 to 99.99: the smaller your chance, the bigger the win',
            chicken: () => `🐔 \`chicken 100\` ・ Chicken: every lane it crosses raises the multiplier (up to ${topChicken()} after ${lanes()} lanes); cash out before a car hits it`,
            roulette: () => `🎡 \`roulette 100 red\` or \`roulette 100 17\` ・ Group roulette: 🔴 / ⚫ ×${CASINO.roulette.colorPays}, a number from 0 to 36 ×${CASINO.roulette.numberPays}`,
            rocket: () => '🚀 `rocket 100` or `rocket 100 2` (or `crash 100 2.5`) ・ Rocket (group crash): ride with the room and cash out before it blows up',
            blackjack: () => '🃏 `blackjack 100` ・ Blackjack: beat the dealer to 21, hit, stand or double, pays ×2.50',
            horses: () => `🏇 \`horses 100 3\` ・ Group race: bet on one horse 1-${HORSES_COUNT}, the first 3 pay (${placesLine()}), the race starts ${Math.round(CASINO.horses.joinMs / 1000)}s after the first bet`,
        },
        casinoHead: () => `🎰 **Casino** ・ Bets from ${number(CASINO.minBet)} ${CC.short} up to your balance${CASINO.unlimited ? '' : ` (max bet ${number(CASINO.maxBet)})`}`,
        allInHint: () => `🔥 Type \`all\` instead of the bet to go all-in${CASINO.unlimited ? '' : ` (up to ${number(CASINO.maxBet)})`}: \`rocket all\` ・ \`mines all 3\` ・ \`dice all over 70\``,
        menuHint: '🎮 Type `games` to see every game and how it works.',
        writeItSo: (example) => `❌ Type it like this: ${example}`,
        gamesHint: '🎮 Type `games` to see every game.',
        // Failures
        badBet: () => `❌ The bet must be a whole number from **${number(CASINO.minBet)}** ${CC.short}${CASINO.unlimited ? ' up' : ` to **${number(CASINO.maxBet)}** ${CC.short}`}.`,
        noCC: (cc) => `❌ Your balance ${cc} is not enough for this bet.`,
        active: (ends) => `⚠️ You have a mines game running: finish it or cash out first${ends}.`,
        activeEnds: (at) => ` (it closes by itself <t:${at}:R> if you don't play)`,
        idleEnds: (at) => `${E('ui.timer')} Closes by itself <t:${at}:R> if you don't play`,
        badTarget: () => `❌ The multiplier must be from **${multiplierText(CASINO.crash.minTarget)}** to **${multiplierText(CASINO.crash.maxTarget)}** (for example \`2.5\`).`,
        badDice: (minChance, maxChance) => `❌ Pick \`under\` a number from ${minChance} to ${maxChance} or \`over\` a number from ${100 - maxChance} to ${100 - minChance} (for example \`dice 100 over 70\`).`,
        tooMany: (max) => `❌ At most ${max} bets each in one round.`,
        otherHorse: (horse) => `❌ You already bet on horse \`#${horse}\`: one horse per race, you can only add to that same horse.`,
        failures: {
            bad_mines: `❌ The number of mines must be from ${CASINO.mines.min} to ${CASINO.mines.max}.`,
            bad_side: '❌ Pick `heads` or `tails`.',
            cooldown: '⏳ Wait a second before the next game.',
            bad_choice: '❌ Pick 🔴 `red`, ⚫ `black`, 🟢 `green` or a number from 0 to 36.',
            bad_horse: `❌ Pick a horse from 1 to ${HORSES_COUNT} (for example \`horses 100 3\`).`,
            busy: '⏳ A round is being played in this room right now: wait for it to end and start the next one.',
            full: '❌ This round is full, wait for the next one.',
            joined: '🧑‍🚀 You are already on this rocket, wait for take-off.',
        },
        unknown: '❌ Something went wrong, try again.',
        error: '❌ Something went wrong. Try again in a moment.',
    },
};

const say = (lang) => inLang(lang, TEXT);

// ---- The pieces every message shares ----

/** A game's first line, with the all-in tag at its end when the game was bet all-in. */
const withAllIn = (line, allIn, lang) => (allIn ? `${line} ・ ${say(lang).allIn()}` : line);

function profitLine(bet, payout, lang) {
    const text = say(lang);
    if (payout > bet) return text.profitUp(formatCC(payout - bet));
    if (payout < bet) return text.profitDown(formatCC(bet - payout));
    return text.profitEven();
}

/** The money of an ended game, as a quote block: the bet and the payout, the profit or loss, the balance. */
function summaryLines(bet, payout, balance, lang) {
    const text = say(lang);
    return [
        text.stake(formatCC(bet), formatCC(payout)),
        profitLine(bet, payout, lang),
        ...(Number.isSafeInteger(balance) ? [text.balance(formatCC(balance))] : []),
    ].map((line) => `> ${line}`);
}

/** The big line of a message: `# 💥 ×0.00`, `# 🎲 73.42`. */
const heroLine = (icon, value) => `# ${icon} ${value}`;
/** The result in big letters. */
const resultLine = (line) => `### ${line}`;

/**
 * The member's name and avatar above the title of a game played in one go (coinflip, slots, dice), when the
 * command gave a Discord user. A mines board or a chicken is drawn again from its saved game, which has no avatar.
 */
function playerAuthor(user) {
    if (typeof user?.displayAvatarURL !== 'function') return null;
    try {
        const name = user.displayName ?? user.globalName ?? user.username;
        return name ? { name, iconURL: user.displayAvatarURL({ size: 64 }) } : null;
    } catch {
        return null;
    }
}

// ---- Mines ----

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
            if (game.picks.includes(cell)) button.setEmoji(E('mines.safe')).setStyle(ButtonStyle.Success).setDisabled(true);
            else if (!over) button.setEmoji(E('mines.hidden')).setStyle(ButtonStyle.Secondary);
            else if (cell === game.hit) button.setEmoji(E('mines.hit')).setStyle(ButtonStyle.Danger).setDisabled(true);
            else if (game.mines.includes(cell)) button.setEmoji(E('mines.bomb')).setStyle(ButtonStyle.Secondary).setDisabled(true);
            else button.setEmoji(E('mines.safe')).setStyle(ButtonStyle.Secondary).setDisabled(true);
            row.addComponents(button);
        }
        rows.push(row);
    }
    return rows;
}

const gameLine = (game, userId, lang) => withAllIn(say(lang).minesLine(userId, formatCC(game.bet), game.mines.length), game.allIn, lang);

/** A running board's live countdown to its idle close (CASINO.idleMs after its last move), as a list of 0 or 1 line. */
const idleLines = (game, lang) => (Number.isFinite(game?.lastActionAt) ? [say(lang).idleEnds(Math.ceil((game.lastActionAt + CASINO.idleMs) / 1000))] : []);

/**
 * A running mines board: what cashing out pays now (in big letters), what the next safe cell would pay, the
 * multipliers after it, and the timeout rule in the footer. In the board's own language (`game.lang`, saved when
 * it opened) unless `lang` says otherwise.
 */
export function minesBoardPayload(game, userId, { note = '', lang = game.lang } = {}) {
    const text = say(lang);
    const mines = game.mines.length;
    const picks = game.picks.length;
    const safe = CASINO.mines.cells - mines;
    const now = minesPayout(game.bet, mines, picks);
    const ladder = range(picks + 2, Math.min(safe, picks + 1 + LADDER_STEPS)).map((tiles) => times(minesMultiplierHundredths(mines, tiles)));
    const embed = ccEmbed(text.minesTitle(), [
        ...(note ? [note, ''] : []),
        gameLine(game, userId, lang),
        text.opened(picks, safe),
        ...idleLines(game, lang),
        resultLine(text.cashOutNow(times(minesMultiplierHundredths(mines, picks)), formatCC(now))),
        ...(picks < safe ? [text.nextCell(times(minesMultiplierHundredths(mines, picks + 1)), formatCC(minesPayout(game.bet, mines, picks + 1)))] : []),
        ...(ladder.length ? [text.ladder(ladder)] : []),
    ].join('\n'), { color: casinoColor('mines'), footer: text.idleRule() });
    const cashOut = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:cashout:${game.id}:${userId}`)
            .setLabel(text.cashOutButton(number(now)))
            .setEmoji(E('ui.cashout'))
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

/** The emoji of an ended game's big line, by how it ended. */
function endIcon(outcome, lostIcon) {
    if (outcome === 'lost') return E(lostIcon);
    if (outcome === 'cleared' || outcome === 'crossed') return E('ui.trophy');
    return E(outcome === 'timeout' ? 'ui.timer' : 'ui.done');
}

/**
 * An ended board (lost, cashed out, cleared or timed out): the multiplier it ended on in big letters (×0.00 on a
 * mine), the money, the board's odds in the footer, every cell shown on the buttons, none of them working.
 */
export function minesResultPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    if (!result.game) return { content: minesNoticeText(result, userId, shown), embeds: [], components: [], allowedMentions: { parse: [] } };
    const text = say(shown);
    const { game, payout, outcome } = result;
    const mines = game.mines.length;
    const safe = CASINO.mines.cells - mines;
    const reached = outcome === 'lost' ? 0 : minesMultiplierHundredths(mines, game.picks.length);
    const embed = ccEmbed(text.minesTitle(), [
        gameLine(game, userId, shown),
        heroLine(endIcon(outcome, 'mines.hit'), times(reached)),
        minesEndLine(result, shown),
        ...summaryLines(game.bet, payout, result.balance, shown),
    ].join('\n'), {
        color: casinoColor('mines', outcomeOf(game.bet, payout)),
        footer: text.minesOdds(mines, safe, times(minesMultiplierHundredths(mines, safe))),
    });
    return { content: '', embeds: [embed], components: boardRows(game, userId, { over: true }), allowedMentions: { parse: [] } };
}

/** `<@member> …` in the board's room when its message is gone (timeout after a restart, or a damaged game). */
export function minesNoticeText(result, userId, lang = null) {
    return `<@${userId}> ${minesEndLine(result, resultLanguage(result, lang))}`;
}

// ---- Chicken ----

// How many lanes the road shows at once: the chicken, a couple of lanes behind it and the lanes ahead.
const ROAD_LANES = 8;

/**
 * The road as one line of emojis: `🟫🟩🟩🐔⚠️⬛⬛⬛⬛⋯` — 🟩 the lanes crossed, 🐔 the chicken (💀 where a car got it),
 * ⚠️ the next lane (the danger), ⬛ the road ahead, 🏁 the far side (⋯ for lanes off screen, 🟫 the sidewalk it
 * started on). At the end (`over`) the lane where the car was waiting shows 🚗. Each piece is a registry emoji.
 */
export function chickenRoad(game, { over = false, dead = false } = {}) {
    const all = CASINO.chicken.maxSteps;
    const at = dead ? game.deathStep : game.steps;
    const first = Math.max(1, Math.min(at - 2, all - ROAD_LANES + 1));
    const last = Math.min(all, first + ROAD_LANES - 1);
    const lane = (n) => {
        if (n === at) return E(dead ? 'chicken.dead' : 'chicken.alive');
        if (n < at) return E('chicken.crossed');
        if (over) return E(n === game.deathStep ? 'chicken.car' : 'chicken.road');
        return E(n === at + 1 ? 'chicken.next' : 'chicken.road');
    };
    const start = first > 1 ? E('chicken.more') : E(at === 0 ? 'chicken.alive' : 'chicken.sidewalk');
    const road = Array.from({ length: last - first + 1 }, (_, i) => lane(first + i)).join('');
    return `${start}${road}${E(last === all ? 'chicken.finish' : 'chicken.more')}`;
}

const chickenLine = (game, userId, lang) => withAllIn(say(lang).chickenLine(userId, formatCC(game.bet)), game.allIn, lang);

/**
 * A running chicken: the road, what cashing out pays now (in big letters), what the next lane would pay (and its
 * chance), the multipliers after it, the timeout rule in the footer and its two buttons, 🐔 Step
 * (`casino:chick:<gameId>:<steps>:<userId>`, with the lanes crossed so far, so a second press of the same board
 * can't move the chicken again) and 💰 Cash out (`casino:chickout:<gameId>:<userId>`). In the game's own language
 * (`game.lang`) unless `lang` says otherwise. Nothing on it tells where the car waits.
 */
export function chickenBoardPayload(game, userId, { note = '', lang = game.lang } = {}) {
    const text = say(lang);
    const all = CASINO.chicken.maxSteps;
    const now = chickenPayout(game.bet, game.steps);
    const ladder = range(game.steps + 2, Math.min(all, game.steps + 1 + LADDER_STEPS)).map((steps) => times(chickenMultiplierHundredths(steps)));
    const embed = ccEmbed(text.chickenTitle(), [
        ...(note ? [note, ''] : []),
        chickenLine(game, userId, lang),
        text.crossed(game.steps, all),
        chickenRoad(game),
        ...idleLines(game, lang),
        resultLine(text.cashOutNow(times(chickenMultiplierHundredths(game.steps)), formatCC(now))),
        ...(game.steps < all ? [text.nextLane(times(chickenMultiplierHundredths(game.steps + 1)), formatCC(chickenPayout(game.bet, game.steps + 1)), chickenSurvivePercent())] : []),
        ...(ladder.length ? [text.ladder(ladder)] : []),
    ].join('\n'), { color: casinoColor('chicken'), footer: text.chickenIdleRule() });
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:chick:${game.id}:${game.steps}:${userId}`)
            .setLabel(text.stepButton)
            .setEmoji(E('chicken.alive'))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:chickout:${game.id}:${userId}`)
            .setLabel(text.cashOutButton(number(now)))
            .setEmoji(E('ui.cashout'))
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
 * An ended chicken (run over, cashed out, timed out or across the whole road): the multiplier it ended on in big
 * letters (×0.00 when a car got it), the road with the chicken where it stopped (💀 where it died, 🚗 where the
 * car was waiting), the money and the odds in the footer. No buttons.
 */
export function chickenResultPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    if (!result.game) return { content: chickenNoticeText(result, userId, shown), embeds: [], components: [], allowedMentions: { parse: [] } };
    const text = say(shown);
    const { game, outcome } = result;
    const dead = outcome === 'lost';
    const embed = ccEmbed(text.chickenTitle(), [
        chickenLine(game, userId, shown),
        heroLine(endIcon(outcome, 'chicken.dead'), times(dead ? 0 : chickenMultiplierHundredths(game.steps))),
        chickenRoad(game, { over: true, dead }),
        chickenEndLine(result, shown),
        ...(outcome === 'cashout' || outcome === 'timeout' ? [text.chickenFate(game.deathStep)] : []),
        ...summaryLines(game.bet, result.payout, result.balance, shown),
    ].join('\n'), {
        color: casinoColor('chicken', outcomeOf(game.bet, result.payout)),
        footer: text.chickenOdds(chickenSurvivePercent(), topChicken(), lanes()),
    });
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** `<@member> …` in the chicken's room when its message is gone (timeout after a restart, or a damaged game). */
export function chickenNoticeText(result, userId, lang = null) {
    return `<@${userId}> ${chickenEndLine(result, resultLanguage(result, lang))}`;
}

// ---- Blackjack ----

const CARD_SUIT_EMOJI = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
const isCustomTag = (value) => /^<a?:\w{2,32}:\d{17,20}>$/u.test(String(value));
const CARD_SUIT_KEY = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

/**
 * One card as a bold chip: `**「A♥️」**`. With custom card emojis in the registry (`blackjack.cardAH` ... `blackjack.cardKC`,
 * rank 2-10/J/Q/K/A then the suit S/H/D/C, and `blackjack.cardBack`) the chip is that emoji instead (CASINO_EMOJIS).
 */
export function cardChip(card, hidden = false) {
    if (hidden) {
        const back = E('blackjack.cardBack');
        return isCustomTag(back) ? back : '**「❓」**';
    }
    const custom = E(`blackjack.card${card.rank}${CARD_SUIT_KEY[card.suit]}`);
    return isCustomTag(custom) ? custom : `**「${card.rank}${CARD_SUIT_EMOJI[card.suit] ?? card.suit}」**`;
}

export function formatHandCards(hand, hideSecond = false) {
    if (!Array.isArray(hand)) return '';
    const chips = hand.map((card, idx) => cardChip(card, hideSecond && idx === 1));
    // Pictures only: no gaps, so the cards sit together like a hand (any text chip keeps the spaces).
    return chips.join(chips.every(isCustomTag) ? '' : ' ');
}

/** `11+` for a dealer showing one card, `19` or `19 / 9` (soft hand) for a player. */
function handTotal(hand, { hidden = false } = {}) {
    if (hidden) {
        const first = hand?.[0];
        return `${first?.rank === 'A' ? 11 : (['K', 'Q', 'J', '10'].includes(first?.rank) ? 10 : first?.rank)}+`;
    }
    const score = handScore(hand);
    return isSoftHand(hand) && score < 21 ? `${score} / ${score - 10}` : `${score}`;
}

const handFields = (text, game, { hideDealer }) => [
    { name: text.dealerName(handTotal(game.dealerHand, { hidden: hideDealer })), value: formatHandCards(game.dealerHand, hideDealer), inline: true },
    { name: text.playerName(handTotal(game.playerHand)), value: formatHandCards(game.playerHand), inline: true },
];

export function blackjackBoardPayload(game, userId, { note = '', lang = game.lang } = {}) {
    const text = say(lang);
    const playerLine = withAllIn(text.blackjackLine(userId, formatCC(game.bet)), game.allIn, lang);
    const embed = ccEmbed(text.blackjackTitle(), [
        ...(note ? [note, ''] : []),
        playerLine,
        text.blackjackPlaying(),
        ...idleLines(game, lang),
    ].join('\n'), { color: casinoColor('blackjack'), fields: handFields(text, game, { hideDealer: true }), footer: text.blackjackLegend() });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:bjhit:${game.id}:${game.playerHand.length}:${userId}`)
            .setLabel(text.hitButton)
            .setEmoji(E('blackjack.hit'))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:bjstand:${game.id}:${userId}`)
            .setLabel(text.standButton)
            .setEmoji(E('blackjack.stand'))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:bjdouble:${game.id}:${userId}`)
            .setLabel(text.doubleButton)
            .setEmoji(E('blackjack.double'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(Boolean(game.doubled || game.playerHand?.length !== 2)),
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:bjinfo:${game.id}:${userId}`)
            .setEmoji('ℹ️')
            .setStyle(ButtonStyle.Secondary),
    );
    return { content: '', embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

function blackjackEndLine(result, lang) {
    const text = say(lang);
    const { game, payout, outcome } = result;
    if (!game) return text.blackjackBroken(formatCC(payout));
    if (outcome === 'natural') return text.blackjackNatural(formatCC(payout - game.bet));
    if (outcome === 'win') return text.blackjackWon(formatCC(payout - game.bet));
    if (outcome === 'push') return text.blackjackPush(formatCC(payout));
    const pScore = handScore(game.playerHand);
    if (pScore > 21) return text.blackjackBust(formatCC(game.bet));
    return text.blackjackLost(formatCC(game.bet));
}

/** Whether the card flip can be shown: the card back and the edge-on frame are both custom emojis (cc_back, cc_edge). */
export const canFlipCards = () => isCustomTag(E('blackjack.cardBack')) && isCustomTag(E('blackjack.cardEdge'));

/** The frame before a blackjack result: the dealer's hidden card turning (seen edge-on), nothing else said yet. */
export function blackjackRevealPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    const text = say(shown);
    const { game } = result;
    const dealer = `${formatHandCards(game.dealerHand.slice(0, 1))} ${E('blackjack.cardEdge')}`;
    const embed = ccEmbed(text.blackjackTitle(), withAllIn(text.blackjackLine(userId, formatCC(game.bet)), game.allIn, shown), {
        color: casinoColor('blackjack'),
        fields: [
            { name: text.dealerName(handTotal(game.dealerHand, { hidden: true })), value: dealer, inline: true },
            { name: text.playerName(handTotal(game.playerHand)), value: formatHandCards(game.playerHand), inline: true },
        ],
    });
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

export function blackjackResultPayload(result, userId, lang = null) {
    const shown = resultLanguage(result, lang);
    if (!result.game) return { content: blackjackNoticeText(result, userId, shown), embeds: [], components: [], allowedMentions: { parse: [] } };
    const text = say(shown);
    const { game, payout, outcome } = result;
    const playerLine = withAllIn(text.blackjackLine(userId, formatCC(game.bet)), game.allIn, shown);
    // Simple: who bet how much, won or lost how much, the balance, and both hands.
    const embed = ccEmbed(text.blackjackTitle(), [
        playerLine,
        blackjackEndLine(result, shown),
        `${E('ui.balance')} ${formatCC(result.balance)}`,
    ].join('\n'), {
        color: casinoColor('blackjack', outcomeOf(game.bet, payout)),
        fields: handFields(text, game, { hideDealer: false }),
    });
    return { content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** The short how-to: what the buttons do, the payouts and a few tips (the ℹ️ button and `شرح بلاك جاك`). */
export function blackjackHelpText(lang = null) {
    return say(lang).blackjackHelp();
}

export function blackjackHelpPayload(lang = null) {
    const text = say(lang);
    return { content: '', embeds: [ccEmbed(text.blackjackTitle(), text.blackjackHelp(), { color: casinoColor('blackjack') })], components: [], allowedMentions: { parse: [] } };
}

export function blackjackNoticeText(result, userId, lang = null) {
    return `<@${userId}> ${blackjackEndLine(result, resultLanguage(result, lang))}`;
}

// ---- Either saved game ----

/** Which saved game a result, a refusal or a game settled on the way is about: 'blackjack', 'chicken', else 'mines'. */
const kindOf = (result) => {
    const k = result?.game?.game ?? result?.kind;
    if (k === 'blackjack') return 'blackjack';
    if (k === 'chicken') return 'chicken';
    return 'mines';
};

/** An ended saved game, with its own embed (a mines board, a chicken, or blackjack). */
export function gameResultPayload(result, userId, lang = null) {
    const k = kindOf(result);
    if (k === 'blackjack') return blackjackResultPayload(result, userId, lang);
    return k === 'chicken' ? chickenResultPayload(result, userId, lang) : minesResultPayload(result, userId, lang);
}

/** The short notice of an ended saved game whose message is gone. */
export function gameNoticeText(result, userId, lang = null) {
    const k = kindOf(result);
    if (k === 'blackjack') return blackjackNoticeText(result, userId, lang);
    return k === 'chicken' ? chickenNoticeText(result, userId, lang) : minesNoticeText(result, userId, lang);
}

/** The line shown with a new game when an older board, chicken or blackjack was settled first (in the new command's language). */
export function previousGameNote(previous, lang) {
    const text = say(lang);
    const k = kindOf(previous);
    if (k === 'blackjack') return text.previousBlackjack(formatCC(previous.payout));
    return (k === 'chicken' ? text.previousChicken : text.previousGame)(formatCC(previous.payout));
}

// ---- Coinflip ----

/** The coin: the side picked and the bet, the side it landed on in big, the result and the money. */
export function coinflipPayload(result, user, lang) {
    const text = say(lang);
    const chosen = E(`coin.${result.side}`);
    const landed = E(`coin.${result.landed}`);
    const embed = ccEmbed(text.coinflipTitle(), [
        withAllIn(text.picked(user, text.sideName(result.side), chosen, formatCC(result.bet)), result.allIn, lang),
        `# ${landed}`,
        text.landed(text.sideName(result.landed), landed),
        resultLine(result.payout > 0 ? text.won(formatCC(result.payout), coinflipTimes()) : text.lost(formatCC(result.bet))),
        ...summaryLines(result.bet, result.payout, result.balance, lang),
    ].join('\n'), {
        color: casinoColor('coinflip', outcomeOf(result.bet, result.payout)),
        footer: text.winPays(coinflipTimes()),
        author: playerAuthor(user),
    });
    return quiet(embed);
}

// ---- Slots ----

/** A reel symbol of the engine (`'🍒'`) as the registry shows it (`plain` for footers: always Unicode). */
const slotSymbol = (symbol, { plain = false } = {}) => (SLOT_SYMBOL_KEYS[symbol] ? (plain ? P : E)(SLOT_SYMBOL_KEYS[symbol]) : symbol);

/** `🌀🌀🌀 ×25 ・ … ・ اتنين زي بعض = رهانك يرجع`, best first (Unicode: it goes in footers and the guide). */
export function slotsTableText(lang) {
    const triples = Object.entries(CASINO.slots.triple).sort((a, b) => b[1] - a[1]).map(([symbol, multiplier]) => `${slotSymbol(symbol, { plain: true }).repeat(3)} ×${multiplier}`);
    return [...triples, say(lang).slotsPair].join(' ・ ');
}

/**
 * The slot machine: the three reels as ONE big heading line (Discord shows emojis in a heading at full size),
 * separated by bars, so they are easy to read on a phone. The result line under it says what was won.
 *   # 🍒 ┃ 🍒 ┃ 🍒
 */
export function slotMachine(reels) {
    return [`# ${reels.map((symbol) => slotSymbol(symbol)).join(' ┃ ')}`];
}

export function slotsPayload(result, user, lang) {
    const text = say(lang);
    const { bet, payout, kind, symbol, multiplier, reels } = result;
    let line = text.slotsLost(formatCC(bet));
    if (kind === 'triple') line = text.slotsTriple(slotSymbol(symbol), multiplier, formatCC(payout));
    else if (kind === 'pair') line = text.slotsBack(formatCC(payout));
    const embed = ccEmbed(text.slotsTitle(), [
        withAllIn(text.betBy(user, formatCC(bet)), result.allIn, lang),
        ...slotMachine(reels),
        resultLine(line),
        ...summaryLines(bet, payout, result.balance, lang),
    ].join('\n'), {
        color: casinoColor('slots', outcomeOf(bet, payout)),
        footer: slotsTableText(lang),
        author: playerAuthor(user),
    });
    return quiet(embed);
}

// ---- Dice ----

const rollText = (roll) => (roll / 100).toFixed(2);

/** `0 🟩🟩🟩🎲🟥🟥🟥🟥🟥🟥 100`: the win zone (🟩), the lose zone (🟥) and where the dice landed (🎲). */
export function diceBar(result) {
    const cells = 10;
    const width = CASINO.dice.faces / cells;
    const bar = Array.from({ length: cells }, (_, cell) => {
        if (Math.floor(result.roll / width) === cell) return E('dice.marker');
        return E(diceWins(cell * width + width / 2, result.direction, result.number) ? 'dice.win' : 'dice.lose');
    });
    return `0 ${bar.join('')} 100`;
}

/** The dice: the bet and what it needs, the roll in big, the bar from 0 to 100, the result and the money. */
export function dicePayload(result, user, lang) {
    const text = say(lang);
    const multiplier = diceMultiplierHundredths(result.chance);
    const embed = ccEmbed(text.diceTitle(), [
        withAllIn(text.diceBet(user, formatCC(result.bet), text.directionName(result.direction), result.number, E(`dice.${result.direction}`), text.diceRule(result.direction, result.number)), result.allIn, lang),
        heroLine(E('dice.icon'), rollText(result.roll)),
        diceBar(result),
        resultLine(result.payout > 0 ? text.won(formatCC(result.payout), times(multiplier)) : text.lost(formatCC(result.bet))),
        ...summaryLines(result.bet, result.payout, result.balance, lang),
    ].join('\n'), {
        color: casinoColor('dice', outcomeOf(result.bet, result.payout)),
        footer: text.diceFooter(result.chance, times(multiplier)),
        author: playerAuthor(user),
    });
    return quiet(embed);
}

// ---- Usage and failures ----

/** One typed example per game, for the usage answers, in each language (`GAME_USAGE.en.rocket()`...). */
export const GAME_USAGE = { ar: TEXT.ar.usage, en: TEXT.en.usage };

/** `مينز 100 3` … / `mines 100 3` …: how to play, for a typed casino command without a game or a bet (and all-in). */
export function casinoUsageText(lang) {
    const text = say(lang);
    return [text.casinoHead(), ...Object.values(text.usage).map((line) => line()), text.allInHint(), text.menuHint].join('\n');
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
        const k = kindOf(result);
        if (k === 'blackjack') return text.blackjackActive(ends);
        return k === 'chicken' ? text.chickenActive(ends) : text.active(ends);
    }
    if (result.reason === 'bad_target') return text.badTarget();
    if (result.reason === 'bad_dice') return text.badDice(CASINO.dice.minChance, CASINO.dice.maxChance);
    if (result.reason === 'too_many') return text.tooMany(result.max ?? CASINO.roulette.maxBetsPerMember);
    if (result.reason === 'other_horse') return text.otherHorse(result.horse ?? '?');
    return text.failures[result.reason] || text.unknown;
}

/** The answer when a casino command or button failed unexpectedly. */
export const casinoErrorText = (lang) => say(lang).error;

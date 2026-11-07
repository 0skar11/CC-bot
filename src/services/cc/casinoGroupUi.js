// casinoGroupUi.js — the embeds and the cash-out button of the casino's group rounds (roulette and rocket), for
// casinoGroupSessions.js, the casino command and its buttons. Plain embed objects so the emojis stay; each Arabic
// line starts with Arabic or an emoji so Discord doesn't reorder it. Mentions are shown, never pinged.
// Every text exists in Arabic and English (TEXT below). The round's message (table, flight, end, restart notice,
// its buttons) is written in the round's own language (`round.lang`, its opener's), so a room that mixes
// languages sees the opener's language there; the private answers (cash-out clicks, the join form) take the
// language of the member they answer.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, ROULETTE_COLORS } from '../../config/casino.js';
import { pocketColor, roundLanguage } from './casinoGroupService.js';
import { inLang } from './lang.js';

const seconds = (ms) => Math.ceil(ms / 1000);
const quiet = (embeds, components = []) => ({ content: '', embeds, components, allowedMentions: { parse: [] } });
const total = (bets) => bets.reduce((sum, entry) => sum + entry.bet, 0);

/** `×2.50`, `×1,234.00`: a multiplier kept in hundredths. */
export function multiplierText(hundredths) {
    return `×${(hundredths / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TEXT = {
    ar: {
        colorName: (color) => ROULETTE_COLORS[color].name,
        // The join button and its form
        betButton: 'راهن',
        rideButton: 'اركب',
        amountLabel: 'كام CC عايز تدخل بيها؟',
        amountHint: (min) => `الرقم بس، من ${min}`,
        choiceLabel: 'تراهن على إيه؟',
        choiceHint: 'احمر أو اسود أو رقم من 0 لـ 36',
        rouletteForm: '🎡 راهن على الروليت',
        rocketForm: '🚀 اركب الصاروخ',
        // Roulette
        rouletteTitle: '🎡 روليت',
        noBets: '😶 لسه محدش راهن.',
        spinning: '🌀 **العجلة بتلف...** خلاص مفيش رهانات تاني.',
        spinsAt: (at) => `⏳ العجلة بتلف <t:${at}:R> ・ دوس 🎡 **راهن** أو اكتب \`روليت 100 احمر\` / \`روليت 100 17\``,
        rouletteRule: (red, black, colorPays, green, numberPays) => `🎯 ${red} أو ${black} ×${colorPays} ・ رقم من 0 لـ 36 (${green}) ×${numberPays}`,
        betsHead: (count, max, cc) => `📋 **الرهانات** (${count}/${max}) ・ 💵 ${cc}`,
        refunded: (head, cc) => `↩️ ${head} ・ رجعله رهانه ${cc}`,
        stakeWon: (head, bet, cc) => `🏆 ${head} ・ راهن ${bet} ← كسب ${cc}`,
        stakeLost: (head, cc) => `💸 ${head} ・ خسر ${cc}`,
        nobodyBet: '😶 محدش كان راهن.',
        paid: (cc, bets) => `💰 اتدفع ${cc} من رهانات ${bets}`,
        landed: (pocket) => `🎯 الكورة وقفت على ${pocket}`,
        on: (choice) => `على ${choice}`,
        // Rocket
        rocketTitle: '🚀 صاروخ',
        cashedOut: (auto, userId, multiplier, won, cc) => `${auto ? '🎯' : '✅'} <@${userId}> ${auto ? 'خرج لوحده' : 'خرج'} عند **${multiplier}** ← ${won ? 'كسب ' : ''}${cc}`,
        noRiders: '😶 لسه محدش ركب.',
        cashOutButton: (multiplier) => `كاش أوت · ${multiplier}`,
        overButton: 'خلصت',
        takeOff: (at) => `⏳ الإقلاع <t:${at}:R> ・ دوس 🚀 **اركب** أو اكتب \`صاروخ 100\` / \`صاروخ 100 2\` (يخرجك لوحده عند ×2)`,
        afterTakeOff: (top) => `💰 بعد الإقلاع دوس **كاش أوت** قبل ما ينفجر ・ 🏁 أقصاه ${top}`,
        ridersHead: (count, max, cc) => `👥 **الركاب** (${count}/${max}) ・ 💵 ${cc}`,
        climbing: '📈 طالع... دوس 💰 **كاش أوت** قبل ما ينفجر!',
        topped: (multiplier) => `🏁 الصاروخ وصل لآخره ${multiplier} واللي فضلوا راكبين خدوه!`,
        blewUp: (multiplier) => `💥 الصاروخ انفجر عند **${multiplier}**!`,
        autoAt: (multiplier) => `خرج لوحده عند **${multiplier}**`,
        rodeTo: (multiplier) => `فضل راكب لـ **${multiplier}**`,
        riderWon: (userId, at, cc) => `🎯 <@${userId}> ${at} ← كسب ${cc}`,
        riderLost: (userId, cc) => `💀 <@${userId}> فضل راكب وخسر ${cc}`,
        nobodyRode: '😶 محدش كان راكب.',
        // Joining, clicks and restarts
        balance: (cc) => `\n💰 رصيدك: ${cc}`,
        joinedRoulette: (userId, cc, choice, at, balance) => `✅ <@${userId}> راهن ${cc} على ${choice} ・ العجلة بتلف <t:${at}:R>${balance}`,
        autoExit: (multiplier) => ` ・ 🎯 هيخرج لوحده عند ${multiplier}`,
        joinedRocket: (userId, cc, auto, at, balance) => `🧑‍🚀 <@${userId}> ركب الصاروخ بـ ${cc}${auto} ・ الإقلاع <t:${at}:R>${balance}`,
        clickPaid: (multiplier, cc, balance) => `✅ عملت كاش أوت عند **${multiplier}** وخدت ${cc}${balance}`,
        clickNotIn: '❌ انت مش راكب الصاروخ ده. اركب الجولة الجاية بـ `صاروخ 100`.',
        clickAlready: (multiplier, cc) => `✅ انت خرجت خلاص عند **${multiplier}** (${cc}).`,
        clickNotStarted: '⏳ الصاروخ لسه ماطلعش، استنى الإقلاع.',
        clickTopped: (multiplier) => `🏁 الصاروخ وصل لآخره ${multiplier} واللي فضلوا راكبين بياخدوه لوحدهم.`,
        clickLate: '💥 اتأخرت! الصاروخ انفجر خلاص.',
        clickOver: '⌛ الجولة دي خلصت خلاص.',
        recoveryOpen: '⚠️ الجولة دي اتقطعت قبل ما تبدأ لما البوت عمل ريستارت، ورجعنا كل الرهانات لأصحابها.',
        recoverySpun: (pocket) => `🎯 الكورة كانت وقفت على ${pocket} قبل ما البوت يعمل ريستارت، ودي النتيجة:`,
        recoveryFlying: (crash) => `⚠️ الصاروخ اتقطع وهو طاير لما البوت عمل ريستارت (كان هينفجر عند **${crash}**): اللي حاطط خروج تلقائي اتحسبله، والباقي رجعله رهانه.`,
        recoveryCrashed: (crash) => `💥 الصاروخ كان انفجر عند **${crash}** قبل ما البوت يعمل ريستارت، ودي النتيجة:`,
    },
    en: {
        colorName: (color) => ({ red: 'Red', black: 'Black' })[color],
        // The join button and its form
        betButton: 'Bet',
        rideButton: 'Ride',
        amountLabel: 'How much CC do you want to bet?',
        amountHint: (min) => `Just the number, from ${min}`,
        choiceLabel: 'What do you bet on?',
        choiceHint: 'red, black or a number from 0 to 36',
        rouletteForm: '🎡 Bet on the roulette',
        rocketForm: '🚀 Ride the rocket',
        // Roulette
        rouletteTitle: '🎡 Roulette',
        noBets: '😶 No bets yet.',
        spinning: '🌀 **The wheel is spinning...** No more bets.',
        spinsAt: (at) => `⏳ The wheel spins <t:${at}:R> ・ press 🎡 **Bet** or type \`roulette 100 red\` / \`roulette 100 17\``,
        rouletteRule: (red, black, colorPays, green, numberPays) => `🎯 ${red} or ${black} ×${colorPays} ・ a number from 0 to 36 (${green}) ×${numberPays}`,
        betsHead: (count, max, cc) => `📋 **Bets** (${count}/${max}) ・ 💵 ${cc}`,
        refunded: (head, cc) => `↩️ ${head} ・ got the bet back ${cc}`,
        stakeWon: (head, bet, cc) => `🏆 ${head} ・ bet ${bet} → won ${cc}`,
        stakeLost: (head, cc) => `💸 ${head} ・ lost ${cc}`,
        nobodyBet: '😶 Nobody bet.',
        paid: (cc, bets) => `💰 Paid ${cc} out of ${bets} in bets`,
        landed: (pocket) => `🎯 The ball landed on ${pocket}`,
        on: (choice) => `on ${choice}`,
        // Rocket
        rocketTitle: '🚀 Rocket',
        cashedOut: (auto, userId, multiplier, won, cc) => `${auto ? '🎯' : '✅'} <@${userId}> ${auto ? 'cashed out automatically' : 'cashed out'} at **${multiplier}** → ${won ? 'won ' : ''}${cc}`,
        noRiders: '😶 Nobody on board yet.',
        cashOutButton: (multiplier) => `Cash out · ${multiplier}`,
        overButton: 'Over',
        takeOff: (at) => `⏳ Take-off <t:${at}:R> ・ press 🚀 **Ride** or type \`rocket 100\` / \`rocket 100 2\` (cashes you out by itself at ×2)`,
        afterTakeOff: (top) => `💰 After take-off press **Cash out** before it blows up ・ 🏁 It tops out at ${top}`,
        ridersHead: (count, max, cc) => `👥 **Riders** (${count}/${max}) ・ 💵 ${cc}`,
        climbing: '📈 Climbing... press 💰 **Cash out** before it blows up!',
        topped: (multiplier) => `🏁 The rocket reached its top ${multiplier} and everyone still on board takes it!`,
        blewUp: (multiplier) => `💥 The rocket blew up at **${multiplier}**!`,
        autoAt: (multiplier) => `cashed out automatically at **${multiplier}**`,
        rodeTo: (multiplier) => `rode it to **${multiplier}**`,
        riderWon: (userId, at, cc) => `🎯 <@${userId}> ${at} → won ${cc}`,
        riderLost: (userId, cc) => `💀 <@${userId}> stayed on board and lost ${cc}`,
        nobodyRode: '😶 Nobody was on board.',
        // Joining, clicks and restarts
        balance: (cc) => `\n💰 Your balance: ${cc}`,
        joinedRoulette: (userId, cc, choice, at, balance) => `✅ <@${userId}> bet ${cc} on ${choice} ・ the wheel spins <t:${at}:R>${balance}`,
        autoExit: (multiplier) => ` ・ 🎯 cashes out by itself at ${multiplier}`,
        joinedRocket: (userId, cc, auto, at, balance) => `🧑‍🚀 <@${userId}> boarded the rocket with ${cc}${auto} ・ take-off <t:${at}:R>${balance}`,
        clickPaid: (multiplier, cc, balance) => `✅ You cashed out at **${multiplier}** and took ${cc}${balance}`,
        clickNotIn: '❌ You are not on this rocket. Ride the next round with `rocket 100`.',
        clickAlready: (multiplier, cc) => `✅ You already cashed out at **${multiplier}** (${cc}).`,
        clickNotStarted: '⏳ The rocket has not taken off yet, wait for take-off.',
        clickTopped: (multiplier) => `🏁 The rocket reached its top ${multiplier}, and everyone still on board gets it automatically.`,
        clickLate: '💥 Too late! The rocket already blew up.',
        clickOver: '⌛ This round is already over.',
        recoveryOpen: '⚠️ This round was cut off before it started when the bot restarted, and every bet was given back.',
        recoverySpun: (pocket) => `🎯 The ball had landed on ${pocket} before the bot restarted. The result:`,
        recoveryFlying: (crash) => `⚠️ The rocket was cut off mid-flight when the bot restarted (it would have blown up at **${crash}**): automatic cash-outs were paid and everyone else got their bet back.`,
        recoveryCrashed: (crash) => `💥 The rocket had blown up at **${crash}** before the bot restarted. The result:`,
    },
};

const say = (lang) => inLang(lang, TEXT);

/** `🔴 أحمر` / `🔴 Red`, `⚫ أسود` / `⚫ Black`, `🟢 0`, `🔢 17`. */
export function choiceLabel(choice, lang) {
    if (choice === 'red' || choice === 'black') return `${ROULETTE_COLORS[choice].emoji} ${say(lang).colorName(choice)}`;
    return choice === 0 ? `${ROULETTE_COLORS.green.emoji} 0` : `🔢 ${choice}`;
}

/** `🔴 **32**`: where the ball landed. */
export function pocketLabel(pocket) {
    return `${ROULETTE_COLORS[pocketColor(pocket)].emoji} **${pocket}**`;
}

// ---- The join button and its form ----

/** The button under an open round (in the round's language): it opens a small form for the amount (and the pick). */
function joinRow(round) {
    const roulette = round.game === 'roulette';
    const text = say(roundLanguage(round));
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:join:${round.game}:${round.id}`)
            .setLabel(roulette ? text.betButton : text.rideButton)
            .setEmoji(roulette ? '🎡' : '🚀')
            .setStyle(ButtonStyle.Primary),
    );
}

/** The form a join button opens, in the language of the member who clicked: the amount, and for roulette the pick. */
export function joinModal(game, roundId, lang) {
    const text = say(lang);
    const roulette = game === 'roulette';
    const amount = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(text.amountLabel)
        .setPlaceholder(text.amountHint(CASINO.minBet.toLocaleString('en-US')))
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(16)
        .setRequired(true);
    const rows = [new ActionRowBuilder().addComponents(amount)];
    if (roulette) {
        rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('choice')
            .setLabel(text.choiceLabel)
            .setPlaceholder(text.choiceHint)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(12)
            .setRequired(true)));
    }
    return new ModalBuilder()
        .setCustomId(`${CASINO_BUTTON_PREFIX}:joinm:${game}:${roundId}`)
        .setTitle(roulette ? text.rouletteForm : text.rocketForm)
        .addComponents(...rows);
}

/** The whole number of CC typed in the form (`5000`, `5,000`, `٥٠٠٠`), or null. */
export function parseFormAmount(text) {
    const digits = String(text ?? '').trim()
        .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[,\s_٬]/gu, '');
    return /^\d{1,16}$/u.test(digits) ? Number(digits) : null;
}

// ---- Roulette ----

function rouletteBetLines(round, lang) {
    if (!round.bets.length) return [say(lang).noBets];
    return round.bets.map((entry) => `${choiceLabel(entry.choice, lang)} ・ <@${entry.userId}> ・ ${formatCC(entry.bet)}`);
}

/** The roulette round taking bets (or, `spinning`, the wheel turning with no more bets). */
export function rouletteTablePayload(round, { spinning = false } = {}) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const { colorPays, numberPays, maxBets } = CASINO.roulette;
    return quiet([ccEmbed(text.rouletteTitle, [
        spinning ? text.spinning : text.spinsAt(seconds(round.closesAt)),
        text.rouletteRule(choiceLabel('red', lang), choiceLabel('black', lang), colorPays, choiceLabel(0, lang), numberPays),
        '',
        text.betsHead(round.bets.length, maxBets, formatCC(total(round.bets))),
        ...rouletteBetLines(round, lang),
    ].join('\n'))], spinning ? [] : [joinRow(round)]);
}

/** One line per settled stake: won, lost or given back. */
function stakeLines(results, label, lang) {
    const text = say(lang);
    const lines = [];
    for (const result of results) {
        for (const stake of result.settled) {
            const head = [`<@${result.userId}>`, label(stake)].filter(Boolean).join(' ');
            if (stake.refunded) lines.push(text.refunded(head, formatCC(stake.bet)));
            else if (stake.payout > 0) lines.push(text.stakeWon(head, formatCC(stake.bet), formatCC(stake.payout)));
            else lines.push(text.stakeLost(head, formatCC(stake.bet)));
        }
    }
    return lines.length ? lines : [text.nobodyBet];
}

function paidLine(results, lang) {
    const stakes = results.flatMap((result) => result.settled);
    return say(lang).paid(formatCC(stakes.reduce((sum, stake) => sum + stake.payout, 0)), formatCC(total(stakes)));
}

/** The spun roulette: the pocket, then every bet won or lost. */
export function rouletteResultPayload(round, results) {
    const lang = roundLanguage(round);
    const text = say(lang);
    return quiet([ccEmbed(text.rouletteTitle, [
        text.landed(pocketLabel(round.pocket)),
        '',
        ...stakeLines(results, (stake) => text.on(choiceLabel(stake.choice, lang)), lang),
        '',
        paidLine(results, lang),
    ].join('\n'))]);
}

// ---- Rocket ----

const targetText = (target) => (target ? ` ・ 🎯 ${multiplierText(target)}` : '');

/** A rider who left: by their automatic cash-out (🎯) or by the button (✅). */
function cashedLine(entry, lang, won = false) {
    const auto = Boolean(entry.target && entry.cashedOut === entry.target);
    return say(lang).cashedOut(auto, entry.userId, multiplierText(entry.cashedOut), won, formatCC(entry.payout));
}

function riderLines(round, lang) {
    if (!round.bets.length) return [say(lang).noRiders];
    return round.bets.map((entry) => (entry.cashedOut ? cashedLine(entry, lang) : `🧑‍🚀 <@${entry.userId}> ・ ${formatCC(entry.bet)}${targetText(entry.target)}`));
}

function cashOutRow(round, multiplier, { disabled = false } = {}) {
    const text = say(roundLanguage(round));
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:rocket:${round.id}`)
            .setLabel(disabled ? text.overButton : text.cashOutButton(multiplierText(multiplier)))
            .setEmoji('💰')
            .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(disabled),
    );
}

/** The rocket boarding: who rides, with their automatic cash-out. */
export function rocketTablePayload(round) {
    const lang = roundLanguage(round);
    const text = say(lang);
    return quiet([ccEmbed(text.rocketTitle, [
        text.takeOff(seconds(round.closesAt)),
        text.afterTakeOff(multiplierText(CASINO.crash.maxTarget)),
        '',
        text.ridersHead(round.bets.length, CASINO.rocket.maxPlayers, formatCC(total(round.bets))),
        ...riderLines(round, lang),
    ].join('\n'))], [joinRow(round)]);
}

/** The rocket climbing at `multiplier`, with the cash-out button. */
export function rocketFlightPayload(round, multiplier) {
    const lang = roundLanguage(round);
    const text = say(lang);
    return quiet([ccEmbed(text.rocketTitle, [
        `# 🚀 ${multiplierText(multiplier)}`,
        text.climbing,
        '',
        ...riderLines(round, lang),
    ].join('\n'))], [cashOutRow(round, multiplier)]);
}

/**
 * The rocket after the crash (or at the top). `results` are the riders who were still on board, once settled;
 * before that it only says what happened.
 */
export function rocketEndPayload(round, results = null) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const top = round.capped && round.crash >= CASINO.crash.maxTarget;
    const lines = [
        `# ${top ? '🏁' : '💥'} ${multiplierText(Math.max(100, round.crash))}`,
        top ? text.topped(multiplierText(round.crash)) : text.blewUp(multiplierText(Math.max(100, round.crash))),
        '',
    ];
    const settled = new Map((results || []).map((result) => [result.userId, result]));
    for (const entry of round.bets) {
        if (entry.cashedOut) {
            lines.push(cashedLine(entry, lang, true));
            continue;
        }
        const result = settled.get(entry.userId);
        if (!result) {
            if (!results) lines.push(`🧑‍🚀 <@${entry.userId}> ・ ${formatCC(entry.bet)}${targetText(entry.target)}`);
            continue;
        }
        if (result.payout > 0) {
            const at = entry.target && entry.target <= round.crash ? text.autoAt(multiplierText(entry.target)) : text.rodeTo(multiplierText(round.crash));
            lines.push(text.riderWon(entry.userId, at, formatCC(result.payout)));
        } else {
            lines.push(text.riderLost(entry.userId, formatCC(entry.bet)));
        }
    }
    if (!round.bets.length) lines.push(text.nobodyRode);
    return quiet([ccEmbed(text.rocketTitle, lines.join('\n'))], [cashOutRow(round, round.crash, { disabled: true })]);
}

// ---- Joining, clicks and restarts ----

/** The short answer to a member who joined a round someone else opened (in `lang`, the round's by default). */
export function groupJoinText(result, userId, lang = roundLanguage(result.round)) {
    const text = say(lang);
    const { round, stake } = result;
    const balance = Number.isSafeInteger(result.balance) ? text.balance(formatCC(result.balance)) : '';
    if (round.game === 'roulette') {
        return text.joinedRoulette(userId, formatCC(stake.bet), choiceLabel(stake.choice, lang), seconds(round.closesAt), balance);
    }
    const auto = stake.target ? text.autoExit(multiplierText(stake.target)) : '';
    return text.joinedRocket(userId, formatCC(stake.bet), auto, seconds(round.closesAt), balance);
}

/** The private answer to a cash-out click, in the language of the member who clicked. */
export function rocketClickText(result, lang) {
    const text = say(lang);
    if (result.ok) {
        const balance = Number.isSafeInteger(result.balance) ? text.balance(formatCC(result.balance)) : '';
        return text.clickPaid(multiplierText(result.multiplier), formatCC(result.payout), balance);
    }
    if (result.reason === 'not_in') return text.clickNotIn;
    if (result.reason === 'already') return text.clickAlready(multiplierText(result.multiplier), formatCC(result.payout));
    if (result.reason === 'not_started') return text.clickNotStarted;
    if (result.reason === 'crashed') return result.round?.capped ? text.clickTopped(multiplierText(result.round.crash)) : text.clickLate;
    return text.clickOver;
}

/** A round finished by the restart check: what happened to every stake (given back, paid or lost). */
export function groupRecoveryPayload(round, results) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const title = round.game === 'roulette' ? text.rouletteTitle : text.rocketTitle;
    const crash = round.crash ? multiplierText(Math.max(100, round.crash)) : '';
    const heads = {
        open: text.recoveryOpen,
        spun: text.recoverySpun(pocketLabel(round.pocket)),
        flying: text.recoveryFlying(crash),
        crashed: text.recoveryCrashed(crash),
    };
    const head = heads[round.status] || heads.open;
    const label = round.game === 'roulette'
        ? (stake) => text.on(choiceLabel(stake.choice, lang))
        : (stake) => (stake.target ? `(🎯 ${multiplierText(stake.target)})` : '');
    return quiet([ccEmbed(title, [head, '', ...stakeLines(results, label, lang), '', paidLine(results, lang)].join('\n'))]);
}

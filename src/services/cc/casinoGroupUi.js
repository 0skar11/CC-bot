// casinoGroupUi.js — the embeds and the cash-out button of the casino's group rounds (roulette and rocket), for
// casinoGroupSessions.js, the casino command and its buttons. The horse race's messages are casinoHorsesUi.js; its
// join button and form are here with the others. Plain embed objects so the emojis stay; each Arabic
// line starts with Arabic or an emoji so Discord doesn't reorder it. Mentions are shown, never pinged.
// Every text exists in Arabic and English (TEXT below). The round's message (table, flight, end, restart notice,
// its buttons) is written in the round's own language (`round.lang`, its opener's), so a room that mixes
// languages sees the opener's language there; the private answers (cash-out clicks, the join form) take the
// language of the member they answer.
// The roulette's emojis come from the casino's emoji registry (src/config/emojis.js: E() where Discord shows
// custom emojis, P() in titles, footers and the form title) and its embeds have their own colours (CASINO_COLORS:
// the felt green while it takes bets, the pocket's colour once it spun). The rocket's messages keep their own
// emojis and the CC gold, exactly as they were.
// A bet placed all-in (`روليت كل احمر`, `صاروخ كل`, `كل` in the join form: its entry's or stake's `allIn`) ends its
// line with the all-in tag (`🔥 كل فلوسه` / `🔥 all-in`; the roulette's 🔥 from the registry, the rocket's its own),
// with the amount bet where its line doesn't show it already. Every other line is as it was.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, CASINO_COLORS, ROULETTE_COLORS, casinoColor } from '../../config/casino.js';
import { casinoEmoji as E, plainEmoji as P } from '../../config/emojis.js';
import { pocketColor, roundLanguage } from './casinoGroupService.js';
import { inLang } from './lang.js';

const seconds = (ms) => Math.ceil(ms / 1000);
const quiet = (embeds, components = []) => ({ content: '', embeds, components, allowedMentions: { parse: [] } });
const total = (bets) => bets.reduce((sum, entry) => sum + entry.bet, 0);
// Discord's limit on an embed's description.
const DESCRIPTION_LIMIT = 4096;
// The pockets in the order they sit on a single-zero wheel, for the strip drawn on the roulette table.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

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
        horseLabel: 'رقم الحصان (1-6)',
        horseHint: 'مثلًا 3',
        rouletteForm: () => `${P('roulette.icon')} راهن على الروليت`,
        rocketForm: '🚀 اركب الصاروخ',
        horsesForm: '🏇 راهن على حصان',
        // Roulette
        rouletteTitle: () => `${P('roulette.icon')} روليت`,
        noBets: () => `${E('ui.empty')} لسه محدش راهن.`,
        spinning: () => `${E('roulette.spin')} **العجلة بتلف...** خلاص مفيش رهانات تاني.`,
        spinsAt: (at) => `${E('roulette.timer')} العجلة بتلف <t:${at}:R> ・ دوس ${E('roulette.icon')} **راهن** أو اكتب \`روليت 100 احمر\` / \`روليت 100 17\``,
        rouletteRule: (red, black, colorPays, green, numberPays) => `${E('roulette.rule')} ${red} أو ${black} ×${colorPays} ・ رقم من 0 لـ 36 (${green}) ×${numberPays}`,
        betsHead: (count, max, cc) => `${E('roulette.bets')} **الرهانات** (${count}/${max}) ・ ${E('ui.bet')} ${cc}`,
        moreBets: (count) => `${E('roulette.bets')} رهانات تانية: **${count}**`,
        tableFooter: (perMember, max) => `${P('roulette.icon')} لحد ${perMember} رهانات ليك في الجولة ・ ${max} رهان في الجولة كلها`,
        resultFooter: () => `${P('roulette.icon')} العب تاني: روليت 100 احمر أو روليت 100 17`,
        // The stake lines are shared with the rocket's restart notice, which keeps the default emojis.
        refunded: (head, cc, icon = '↩️') => `${icon} ${head} ・ رجعله رهانه ${cc}`,
        stakeWon: (head, bet, cc, icon = '🏆') => `${icon} ${head} ・ راهن ${bet} ← كسب ${cc}`,
        stakeLost: (head, cc, icon = '💸') => `${icon} ${head} ・ خسر ${cc}`,
        nobodyBet: (icon = '😶') => `${icon} محدش كان راهن.`,
        paid: (cc, bets, icon = '💰') => `${icon} اتدفع ${cc} من رهانات ${bets}`,
        landed: (pocket) => `${E('roulette.landed')} الكورة وقفت على ${pocket}`,
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
        allIn: 'كل فلوسه',
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
        horseLabel: 'Horse number (1-6)',
        horseHint: 'for example 3',
        rouletteForm: () => `${P('roulette.icon')} Bet on the roulette`,
        rocketForm: '🚀 Ride the rocket',
        horsesForm: '🏇 Bet on a horse',
        // Roulette
        rouletteTitle: () => `${P('roulette.icon')} Roulette`,
        noBets: () => `${E('ui.empty')} No bets yet.`,
        spinning: () => `${E('roulette.spin')} **The wheel is spinning...** No more bets.`,
        spinsAt: (at) => `${E('roulette.timer')} The wheel spins <t:${at}:R> ・ press ${E('roulette.icon')} **Bet** or type \`roulette 100 red\` / \`roulette 100 17\``,
        rouletteRule: (red, black, colorPays, green, numberPays) => `${E('roulette.rule')} ${red} or ${black} ×${colorPays} ・ a number from 0 to 36 (${green}) ×${numberPays}`,
        betsHead: (count, max, cc) => `${E('roulette.bets')} **Bets** (${count}/${max}) ・ ${E('ui.bet')} ${cc}`,
        moreBets: (count) => `${E('roulette.bets')} More bets: **${count}**`,
        tableFooter: (perMember, max) => `${P('roulette.icon')} Up to ${perMember} bets each per round ・ ${max} bets per round in all`,
        resultFooter: () => `${P('roulette.icon')} Play again: roulette 100 red or roulette 100 17`,
        // The stake lines are shared with the rocket's restart notice, which keeps the default emojis.
        refunded: (head, cc, icon = '↩️') => `${icon} ${head} ・ got the bet back ${cc}`,
        stakeWon: (head, bet, cc, icon = '🏆') => `${icon} ${head} ・ bet ${bet} → won ${cc}`,
        stakeLost: (head, cc, icon = '💸') => `${icon} ${head} ・ lost ${cc}`,
        nobodyBet: (icon = '😶') => `${icon} Nobody bet.`,
        paid: (cc, bets, icon = '💰') => `${icon} Paid ${cc} out of ${bets} in bets`,
        landed: (pocket) => `${E('roulette.landed')} The ball landed on ${pocket}`,
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
        allIn: 'all-in',
    },
};

const say = (lang) => inLang(lang, TEXT);

/**
 * ` ・ 🔥 all-in` after the line of a bet placed all-in (`entry.allIn`), with its amount when `amount` (the line
 * doesn't show the bet); '' for any other bet. `icon` is the roulette's registry emoji; the rocket keeps 🔥.
 */
function allInTag(entry, lang, { icon = '🔥', amount = false } = {}) {
    if (!entry?.allIn) return '';
    return ` ・ ${icon} ${say(lang).allIn}${amount ? ` ${formatCC(entry.bet)}` : ''}`;
}

/** `🔴 أحمر` / `🔴 Red`, `⚫ أسود` / `⚫ Black`, `🟢 0`, `🔢 17`. */
export function choiceLabel(choice, lang) {
    if (choice === 'red' || choice === 'black') return `${E(`roulette.${choice}`)} ${say(lang).colorName(choice)}`;
    return choice === 0 ? `${E('roulette.green')} 0` : `${E('roulette.number')} ${choice}`;
}

/** `🔴 **32**`: where the ball landed. */
export function pocketLabel(pocket) {
    return `${E(`roulette.${pocketColor(pocket)}`)} **${pocket}**`;
}

/** `🔴⚫🔴⚫🟢🔴⚫🔴⚫`: the pockets around `center` (a pocket number) in the wheel's own order. */
export function wheelStrip(center = 0, side = 4) {
    const at = Math.max(0, WHEEL.indexOf(center));
    return Array.from({ length: side * 2 + 1 }, (_, i) => E(`roulette.${pocketColor(WHEEL[(at - side + i + WHEEL.length * 2) % WHEEL.length])}`)).join('');
}

/**
 * `head`, then as many of `items` as fit in an embed description with `tail` after them; the ones that don't fit
 * become one `more(count)` line (40 bets with long names and custom emojis can pass Discord's 4,096 characters).
 */
export function fitLines(head, items, more, tail = []) {
    const fixed = [...head, ...tail].reduce((sum, line) => sum + line.length + 1, 0);
    const room = DESCRIPTION_LIMIT - fixed - more(items.length).length - 1;
    const shown = [];
    let used = 0;
    for (const line of items) {
        if (used + line.length + 1 > room) break;
        shown.push(line);
        used += line.length + 1;
    }
    const rest = items.length - shown.length;
    return [...head, ...shown, ...(rest ? [more(rest)] : []), ...tail].join('\n');
}

// ---- The join button and its form ----

/** The button under an open round (in the round's language): it opens a small form for the amount (and the pick). */
export function joinRow(round) {
    const text = say(roundLanguage(round));
    const look = {
        roulette: { label: text.betButton, emoji: E('roulette.icon') },
        horses: { label: text.betButton, emoji: '🏇' },
    }[round.game] || { label: text.rideButton, emoji: '🚀' };
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:join:${round.game}:${round.id}`)
            .setLabel(look.label)
            .setEmoji(look.emoji)
            .setStyle(ButtonStyle.Primary),
    );
}

/** The form a join button opens, in the language of the member who clicked: the amount, and the pick (roulette, horses). */
export function joinModal(game, roundId, lang) {
    const text = say(lang);
    const roulette = game === 'roulette';
    const horses = game === 'horses';
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
    if (horses) {
        rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('choice')
            .setLabel(text.horseLabel)
            .setPlaceholder(text.horseHint)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(12)
            .setRequired(true)));
    }
    const title = roulette ? text.rouletteForm() : (horses ? text.horsesForm : text.rocketForm);
    return new ModalBuilder()
        .setCustomId(`${CASINO_BUTTON_PREFIX}:joinm:${game}:${roundId}`)
        // Discord caps a form's title at 45 characters: an unusually long emoji override is cut, never an error.
        .setTitle(String(title).slice(0, 45))
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
    return round.bets.map((entry) => `${choiceLabel(entry.choice, lang)} ・ <@${entry.userId}> ・ ${formatCC(entry.bet)}${allInTag(entry, lang, { icon: E('ui.allIn') })}`);
}

/**
 * The roulette round taking bets (or, `spinning`, the wheel turning with no more bets): a strip of the wheel,
 * the countdown (or the spin in big letters), what pays what, then every bet with its colour chip.
 */
export function rouletteTablePayload(round, { spinning = false } = {}) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const { colorPays, numberPays, maxBets, maxBetsPerMember } = CASINO.roulette;
    const head = [
        `${E('roulette.icon')} ${wheelStrip(0)}`,
        spinning ? `### ${text.spinning()}` : text.spinsAt(seconds(round.closesAt)),
        text.rouletteRule(choiceLabel('red', lang), choiceLabel('black', lang), colorPays, choiceLabel(0, lang), numberPays),
        '',
        text.betsHead(round.bets.length, maxBets, formatCC(total(round.bets))),
    ];
    const bets = round.bets.length ? rouletteBetLines(round, lang) : [text.noBets()];
    return quiet([ccEmbed(text.rouletteTitle(), fitLines(head, bets, text.moreBets), {
        color: casinoColor('roulette'),
        footer: text.tableFooter(maxBetsPerMember, maxBets),
    })], spinning ? [] : [joinRow(round)]);
}

/** The roulette's stake emojis (registry); the rocket's restart notice keeps the TEXT defaults. */
const rouletteIcons = () => ({ won: E('roulette.won'), lost: E('roulette.lost'), refunded: E('roulette.refund'), none: E('ui.empty'), paid: E('roulette.paid'), allIn: E('ui.allIn') });

/**
 * One line per settled stake: won, lost or given back (`icons` for the roulette's emojis; `sorted` puts the
 * winners first, biggest payout first, then the bets given back, then the losses).
 */
function stakeLines(results, label, lang, { icons = {}, sorted = false } = {}) {
    const text = say(lang);
    const lines = [];
    for (const result of results) {
        for (const stake of result.settled) {
            const head = [`<@${result.userId}>`, label(stake)].filter(Boolean).join(' ') + allInTag(stake, lang, { icon: icons.allIn });
            if (stake.refunded) lines.push({ rank: 1, payout: stake.payout, line: text.refunded(head, formatCC(stake.bet), icons.refunded) });
            else if (stake.payout > 0) lines.push({ rank: 0, payout: stake.payout, line: text.stakeWon(head, formatCC(stake.bet), formatCC(stake.payout), icons.won) });
            else lines.push({ rank: 2, payout: 0, line: text.stakeLost(head, formatCC(stake.bet), icons.lost) });
        }
    }
    if (sorted) lines.sort((a, b) => a.rank - b.rank || b.payout - a.payout);
    return lines.length ? lines.map((entry) => entry.line) : [text.nobodyBet(icons.none)];
}

function paidLine(results, lang, icon = undefined) {
    const stakes = results.flatMap((result) => result.settled);
    return say(lang).paid(formatCC(stakes.reduce((sum, stake) => sum + stake.payout, 0)), formatCC(total(stakes)), icon);
}

/**
 * The spun roulette: the pocket in big letters (the embed takes its colour), where the ball landed, every bet won,
 * given back or lost (winners first), and what was paid out of what was bet.
 */
export function rouletteResultPayload(round, results) {
    const lang = roundLanguage(round);
    const text = say(lang);
    const icons = rouletteIcons();
    const color = pocketColor(round.pocket);
    const head = [`# ${E(`roulette.${color}`)} ${round.pocket}`, text.landed(pocketLabel(round.pocket)), ''];
    const lines = stakeLines(results, (stake) => text.on(choiceLabel(stake.choice, lang)), lang, { icons, sorted: true });
    return quiet([ccEmbed(text.rouletteTitle(), fitLines(head, lines, text.moreBets, ['', `> ${paidLine(results, lang, icons.paid)}`]), {
        color: CASINO_COLORS.pockets[color],
        footer: text.resultFooter(),
    })]);
}

// ---- Rocket ----

const targetText = (target) => (target ? ` ・ 🎯 ${multiplierText(target)}` : '');

/** A rider who left: by their automatic cash-out (🎯) or by the button (✅). An all-in rider's line also says what they bet. */
function cashedLine(entry, lang, won = false) {
    const auto = Boolean(entry.target && entry.cashedOut === entry.target);
    return say(lang).cashedOut(auto, entry.userId, multiplierText(entry.cashedOut), won, formatCC(entry.payout)) + allInTag(entry, lang, { amount: true });
}

/** A rider still on board: their bet, their automatic cash-out, the all-in tag. */
const boardedLine = (entry, lang) => `🧑‍🚀 <@${entry.userId}> ・ ${formatCC(entry.bet)}${targetText(entry.target)}${allInTag(entry, lang)}`;

function riderLines(round, lang) {
    if (!round.bets.length) return [say(lang).noRiders];
    return round.bets.map((entry) => (entry.cashedOut ? cashedLine(entry, lang) : boardedLine(entry, lang)));
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
            if (!results) lines.push(boardedLine(entry, lang));
            continue;
        }
        if (result.payout > 0) {
            const at = entry.target && entry.target <= round.crash ? text.autoAt(multiplierText(entry.target)) : text.rodeTo(multiplierText(round.crash));
            lines.push(text.riderWon(entry.userId, at, formatCC(result.payout)) + allInTag(entry, lang, { amount: true }));
        } else {
            lines.push(text.riderLost(entry.userId, formatCC(entry.bet)) + allInTag(entry, lang));
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
        return text.joinedRoulette(userId, formatCC(stake.bet), `${choiceLabel(stake.choice, lang)}${allInTag(stake, lang, { icon: E('ui.allIn') })}`, seconds(round.closesAt), balance);
    }
    const auto = stake.target ? text.autoExit(multiplierText(stake.target)) : '';
    return text.joinedRocket(userId, formatCC(stake.bet), `${auto}${allInTag(stake, lang)}`, seconds(round.closesAt), balance);
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
    const roulette = round.game === 'roulette';
    const title = roulette ? text.rouletteTitle() : text.rocketTitle;
    const crash = round.crash ? multiplierText(Math.max(100, round.crash)) : '';
    const heads = {
        open: text.recoveryOpen,
        spun: text.recoverySpun(pocketLabel(round.pocket)),
        flying: text.recoveryFlying(crash),
        crashed: text.recoveryCrashed(crash),
    };
    const head = heads[round.status] || heads.open;
    const label = roulette
        ? (stake) => text.on(choiceLabel(stake.choice, lang))
        : (stake) => (stake.target ? `(🎯 ${multiplierText(stake.target)})` : '');
    // The roulette's notice takes its emojis and colours (the pocket's once it spun); the rocket's stays as it was.
    const icons = roulette ? rouletteIcons() : {};
    const lines = stakeLines(results, label, lang, { icons, sorted: roulette });
    const description = fitLines([head, ''], lines, text.moreBets, ['', paidLine(results, lang, icons.paid)]);
    if (!roulette) return quiet([ccEmbed(title, description)]);
    const spun = round.status === 'spun' && Number.isInteger(round.pocket);
    return quiet([ccEmbed(title, description, { color: spun ? CASINO_COLORS.pockets[pocketColor(round.pocket)] : casinoColor('roulette') })]);
}

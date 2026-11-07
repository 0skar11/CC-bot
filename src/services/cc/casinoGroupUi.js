// casinoGroupUi.js — the embeds and the cash-out button of the casino's group rounds (roulette and rocket), for
// casinoGroupSessions.js, the casino command and its buttons. Plain embed objects so the emojis stay; each line
// starts with Arabic or an emoji so Discord doesn't reorder it. Mentions are shown, never pinged.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ccEmbed, formatCC } from '../../config/cc.js';
import { CASINO, CASINO_BUTTON_PREFIX, ROULETTE_COLORS } from '../../config/casino.js';
import { pocketColor } from './casinoGroupService.js';

const seconds = (ms) => Math.ceil(ms / 1000);
const quiet = (embeds, components = []) => ({ content: '', embeds, components, allowedMentions: { parse: [] } });
const total = (bets) => bets.reduce((sum, entry) => sum + entry.bet, 0);

/** `×2.50`, `×1,234.00`: a multiplier kept in hundredths. */
export function multiplierText(hundredths) {
    return `×${(hundredths / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `🔴 أحمر`, `⚫ أسود`, `🟢 0`, `🔢 17`. */
export function choiceLabel(choice) {
    if (choice === 'red' || choice === 'black') return `${ROULETTE_COLORS[choice].emoji} ${ROULETTE_COLORS[choice].name}`;
    return choice === 0 ? `${ROULETTE_COLORS.green.emoji} 0` : `🔢 ${choice}`;
}

/** `🔴 **32**`: where the ball landed. */
export function pocketLabel(pocket) {
    return `${ROULETTE_COLORS[pocketColor(pocket)].emoji} **${pocket}**`;
}

// ---- Roulette ----

function rouletteBetLines(round) {
    if (!round.bets.length) return ['😶 لسه محدش راهن.'];
    return round.bets.map((entry) => `${choiceLabel(entry.choice)} ・ <@${entry.userId}> ・ ${formatCC(entry.bet)}`);
}

/** The roulette round taking bets (or, `spinning`, the wheel turning with no more bets). */
export function rouletteTablePayload(round, { spinning = false } = {}) {
    const { colorPays, numberPays, maxBets } = CASINO.roulette;
    return quiet([ccEmbed('🎡 روليت', [
        spinning
            ? '🌀 **العجلة بتلف...** خلاص مفيش رهانات تاني.'
            : `⏳ العجلة بتلف <t:${seconds(round.closesAt)}:R> ・ راهن بـ \`روليت 100 احمر\` أو \`روليت 100 17\``,
        `🎯 ${choiceLabel('red')} أو ${choiceLabel('black')} ×${colorPays} ・ رقم من 0 لـ 36 (${choiceLabel(0)}) ×${numberPays}`,
        '',
        `📋 **الرهانات** (${round.bets.length}/${maxBets}) ・ 💵 ${formatCC(total(round.bets))}`,
        ...rouletteBetLines(round),
    ].join('\n'))]);
}

/** One line per settled stake: won, lost or given back. */
function stakeLines(results, label) {
    const lines = [];
    for (const result of results) {
        for (const stake of result.settled) {
            const head = [`<@${result.userId}>`, label(stake)].filter(Boolean).join(' ');
            if (stake.refunded) lines.push(`↩️ ${head} ・ رجعله رهانه ${formatCC(stake.bet)}`);
            else if (stake.payout > 0) lines.push(`🏆 ${head} ・ راهن ${formatCC(stake.bet)} ← كسب ${formatCC(stake.payout)}`);
            else lines.push(`💸 ${head} ・ خسر ${formatCC(stake.bet)}`);
        }
    }
    return lines.length ? lines : ['😶 محدش كان راهن.'];
}

function paidLine(results) {
    const stakes = results.flatMap((result) => result.settled);
    return `💰 اتدفع ${formatCC(stakes.reduce((sum, stake) => sum + stake.payout, 0))} من رهانات ${formatCC(total(stakes))}`;
}

/** The spun roulette: the pocket, then every bet won or lost. */
export function rouletteResultPayload(round, results) {
    return quiet([ccEmbed('🎡 روليت', [
        `🎯 الكورة وقفت على ${pocketLabel(round.pocket)}`,
        '',
        ...stakeLines(results, (stake) => `على ${choiceLabel(stake.choice)}`),
        '',
        paidLine(results),
    ].join('\n'))]);
}

// ---- Rocket ----

const targetText = (target) => (target ? ` ・ 🎯 ${multiplierText(target)}` : '');

/** A rider who left: by their automatic cash-out (🎯) or by the button (✅). */
function cashedLine(entry, won = '') {
    const auto = entry.target && entry.cashedOut === entry.target;
    return `${auto ? '🎯' : '✅'} <@${entry.userId}> ${auto ? 'خرج لوحده' : 'خرج'} عند **${multiplierText(entry.cashedOut)}** ← ${won}${formatCC(entry.payout)}`;
}

function riderLines(round) {
    if (!round.bets.length) return ['😶 لسه محدش ركب.'];
    return round.bets.map((entry) => (entry.cashedOut ? cashedLine(entry) : `🧑‍🚀 <@${entry.userId}> ・ ${formatCC(entry.bet)}${targetText(entry.target)}`));
}

function cashOutRow(round, multiplier, { disabled = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CASINO_BUTTON_PREFIX}:rocket:${round.id}`)
            .setLabel(disabled ? 'خلصت' : `كاش أوت · ${multiplierText(multiplier)}`)
            .setEmoji('💰')
            .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(disabled),
    );
}

/** The rocket boarding: who rides, with their automatic cash-out. */
export function rocketTablePayload(round) {
    const top = multiplierText(CASINO.crash.maxTarget);
    return quiet([ccEmbed('🚀 صاروخ', [
        `⏳ الإقلاع <t:${seconds(round.closesAt)}:R> ・ اركب بـ \`صاروخ 100\` أو \`صاروخ 100 2\` (يخرجك لوحده عند ×2)`,
        `💰 بعد الإقلاع دوس **كاش أوت** قبل ما ينفجر ・ 🏁 أقصاه ${top}`,
        '',
        `👥 **الركاب** (${round.bets.length}/${CASINO.rocket.maxPlayers}) ・ 💵 ${formatCC(total(round.bets))}`,
        ...riderLines(round),
    ].join('\n'))]);
}

/** The rocket climbing at `multiplier`, with the cash-out button. */
export function rocketFlightPayload(round, multiplier) {
    return quiet([ccEmbed('🚀 صاروخ', [
        `# 🚀 ${multiplierText(multiplier)}`,
        '📈 طالع... دوس 💰 **كاش أوت** قبل ما ينفجر!',
        '',
        ...riderLines(round),
    ].join('\n'))], [cashOutRow(round, multiplier)]);
}

/**
 * The rocket after the crash (or at the top). `results` are the riders who were still on board, once settled;
 * before that it only says what happened.
 */
export function rocketEndPayload(round, results = null) {
    const top = round.capped && round.crash >= CASINO.crash.maxTarget;
    const lines = [
        `# ${top ? '🏁' : '💥'} ${multiplierText(Math.max(100, round.crash))}`,
        top ? `🏁 الصاروخ وصل لآخره ${multiplierText(round.crash)} واللي فضلوا راكبين خدوه!` : `💥 الصاروخ انفجر عند **${multiplierText(Math.max(100, round.crash))}**!`,
        '',
    ];
    const settled = new Map((results || []).map((result) => [result.userId, result]));
    for (const entry of round.bets) {
        if (entry.cashedOut) {
            lines.push(cashedLine(entry, 'كسب '));
            continue;
        }
        const result = settled.get(entry.userId);
        if (!result) {
            if (!results) lines.push(`🧑‍🚀 <@${entry.userId}> ・ ${formatCC(entry.bet)}${targetText(entry.target)}`);
            continue;
        }
        if (result.payout > 0) {
            const at = entry.target && entry.target <= round.crash ? `خرج لوحده عند **${multiplierText(entry.target)}**` : `فضل راكب لـ **${multiplierText(round.crash)}**`;
            lines.push(`🎯 <@${entry.userId}> ${at} ← كسب ${formatCC(result.payout)}`);
        } else {
            lines.push(`💀 <@${entry.userId}> فضل راكب وخسر ${formatCC(entry.bet)}`);
        }
    }
    if (!round.bets.length) lines.push('😶 محدش كان راكب.');
    return quiet([ccEmbed('🚀 صاروخ', lines.join('\n'))], [cashOutRow(round, round.crash, { disabled: true })]);
}

// ---- Joining, clicks and restarts ----

/** The short answer to a member who joined a round someone else opened. */
export function groupJoinText(result, userId) {
    const { round, stake } = result;
    const balance = Number.isSafeInteger(result.balance) ? `\n💰 رصيدك: ${formatCC(result.balance)}` : '';
    if (round.game === 'roulette') {
        return `✅ <@${userId}> راهن ${formatCC(stake.bet)} على ${choiceLabel(stake.choice)} ・ العجلة بتلف <t:${seconds(round.closesAt)}:R>${balance}`;
    }
    const auto = stake.target ? ` ・ 🎯 هيخرج لوحده عند ${multiplierText(stake.target)}` : '';
    return `🧑‍🚀 <@${userId}> ركب الصاروخ بـ ${formatCC(stake.bet)}${auto} ・ الإقلاع <t:${seconds(round.closesAt)}:R>${balance}`;
}

/** The private answer to a cash-out click. */
export function rocketClickText(result) {
    if (result.ok) {
        const balance = Number.isSafeInteger(result.balance) ? `\n💰 رصيدك: ${formatCC(result.balance)}` : '';
        return `✅ عملت كاش أوت عند **${multiplierText(result.multiplier)}** وخدت ${formatCC(result.payout)}${balance}`;
    }
    if (result.reason === 'not_in') return '❌ انت مش راكب الصاروخ ده. اركب الجولة الجاية بـ `صاروخ 100`.';
    if (result.reason === 'already') return `✅ انت خرجت خلاص عند **${multiplierText(result.multiplier)}** (${formatCC(result.payout)}).`;
    if (result.reason === 'not_started') return '⏳ الصاروخ لسه ماطلعش، استنى الإقلاع.';
    if (result.reason === 'crashed') {
        return result.round?.capped
            ? `🏁 الصاروخ وصل لآخره ${multiplierText(result.round.crash)} واللي فضلوا راكبين بياخدوه لوحدهم.`
            : '💥 اتأخرت! الصاروخ انفجر خلاص.';
    }
    return '⌛ الجولة دي خلصت خلاص.';
}

/** A round finished by the restart check: what happened to every stake (given back, paid or lost). */
export function groupRecoveryPayload(round, results) {
    const title = round.game === 'roulette' ? '🎡 روليت' : '🚀 صاروخ';
    const crash = round.crash ? multiplierText(Math.max(100, round.crash)) : '';
    const heads = {
        open: '⚠️ الجولة دي اتقطعت قبل ما تبدأ لما البوت عمل ريستارت، ورجعنا كل الرهانات لأصحابها.',
        spun: `🎯 الكورة كانت وقفت على ${pocketLabel(round.pocket)} قبل ما البوت يعمل ريستارت، ودي النتيجة:`,
        flying: `⚠️ الصاروخ اتقطع وهو طاير لما البوت عمل ريستارت (كان هينفجر عند **${crash}**): اللي حاطط خروج تلقائي اتحسبله، والباقي رجعله رهانه.`,
        crashed: `💥 الصاروخ كان انفجر عند **${crash}** قبل ما البوت يعمل ريستارت، ودي النتيجة:`,
    };
    const head = heads[round.status] || heads.open;
    const label = round.game === 'roulette'
        ? (stake) => `على ${choiceLabel(stake.choice)}`
        : (stake) => (stake.target ? `(🎯 ${multiplierText(stake.target)})` : '');
    return quiet([ccEmbed(title, [head, '', ...stakeLines(results, label), '', paidLine(results)].join('\n'))]);
}
